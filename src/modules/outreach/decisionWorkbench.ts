// PRD-005 PR 6 — Decision Workbench: re-buckets the WizMatch Today page into
// four canonical decision queues (Ready to Contact / Needs Review / Replies
// Needing Action / Paused or Blocked), §13.
//
// This module creates NO second eligibility engine. Every company's queue
// assignment comes from `resolveCanonicalCompanyEligibilityBatch`
// (`legacyEligibilityAdapter.ts`, PR 5) which itself only ever wraps
// `resolveCompanyStatus` (`outreachGate.ts`, PR 2/3) — the same canonical
// resolver every other migrated caller in this stack uses. This module reads
// company/policy/duplicate/contact-confidence context to decide WHICH
// companies to ask the resolver about and how to sub-bucket a `review`/`deny`
// decision for display; it never computes `allow`/`review`/`deny` itself.
//
// D-31, enforced rather than merely asserted: `canonicalDecision`/
// `canonicalReasonCode`/`canonicalBlockerCode` are ALWAYS attached from the
// same batch call the rest of the stack uses, so an operator can always see
// what the canonical resolver thinks. But the *behavioural* output —
// `effectiveDecision`, which drives queue placement, `requiresExplicitApproval`
// and `disabledReason` — only follows the canonical decision when
// `canonical.actsOnDecision` is true (the exact string `enforce` plus a
// non-allow decision). In shadow it follows the STORED policy row, exactly as
// PRD-005 §13's queue table defines the queues ("policy `eligible`", "policy
// `needs_review`", "policy `paused` or `blocked`").
//
// This distinction is load-bearing, not pedantry. The gate ladder denies well
// past the policy row — L5 duplicate suspicion, L6b company cold-email lock,
// L7 suppression. Keying buckets on the raw canonical decision meant a company
// with `outreach_eligibility = 'eligible'` and an open conversation (L6b) was
// filed under "Paused or Blocked" with an action-disabling reason and a
// "Reclassify" primary action, in SHADOW — a new hidden work item and a new
// disabled action caused solely by a canonical deny, which §16 rule 2 and gate
// G3 forbid. It also rendered a self-contradictory card ("Eligibility:
// eligible" inside the blocked queue) and invited an operator to write
// `needs_review` over a company that was merely mid-conversation.
//
// Malformed-item safety: every per-company fold is wrapped so one bad row
// cannot fail the whole response — it is dropped into `partial.skippedCompanyIds`
// and reported, never silently discarded and never allowed to 500 the request.

import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import {
  db,
  wizmatchCompanies,
  wizmatchCompanyPolicies,
  wizmatchCompanyDuplicates,
  wizmatchContactCandidates,
  wizmatchOutreachEnrolments,
} from '../../db';
import { resolveCanonicalCompanyEligibilityBatch, type CanonicalCompanyEligibility } from './legacyEligibilityAdapter';
import { deriveConfidenceTier } from '../../services/wizmatchContactIntelligenceRepo';

// PRD-005 §13 — "every live conversation state, since all of them hold the
// company lock (§10.6.1)". Deliberately excludes the three pre-reply live
// states (`queued`, `exported`, `sent`) — those are outreach in flight, not a
// reply awaiting a human decision.
const REPLY_NEEDS_ACTION_STATES = [
  'replied',
  'awaiting_action',
  'positive_reply',
  'referral_received',
  'conversation_open',
] as const;

export interface DecisionWorkbenchCompanyItem {
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  accountOwnerUserId: string | null;
  /** Raw canonical resolver decision. ALWAYS attached, display-only in shadow (D-31). */
  canonicalDecision: CanonicalCompanyEligibility['decision'];
  canonicalReasonCode: string | null;
  canonicalBlockerCode: string | null;
  /**
   * The decision this item is actually BUCKETED and gated on. Equals
   * `canonicalDecision` under `enforce`; in shadow it is derived from the
   * stored policy row so shadow blocks nothing (D-31, §16 rule 2).
   */
  effectiveDecision: CanonicalCompanyEligibility['decision'];
  enforcementMode: CanonicalCompanyEligibility['enforcementMode'];
  requiresExplicitApproval: boolean;
  outreachEligibility: string | null;
  externalHiringPolicy: string | null;
  relationshipType: string | null;
  blockClass: string | null;
  isNonOverridable: boolean;
  reviewDate: string | null;
  policyReasonCode: string | null;
  policyScopeKey: string | null;
  contactConfidenceTier: 'high' | 'medium' | 'low' | null;
  duplicatePending: boolean;
  duplicateId: string | null;
  disabledReason: string | null;
}

export interface DecisionWorkbenchReplyItem {
  enrolmentId: string;
  companyId: string;
  companyName: string | null;
  contactId: string | null;
  state: string;
  stateAt: string;
}

export interface TodayQueues {
  readyToContact: DecisionWorkbenchCompanyItem[];
  needsReview: DecisionWorkbenchCompanyItem[];
  repliesNeedingAction: DecisionWorkbenchReplyItem[];
  pausedOrBlocked: DecisionWorkbenchCompanyItem[];
  counts: {
    readyToContact: number;
    needsReview: number;
    repliesNeedingAction: number;
    pausedOrBlocked: number;
  };
  partial: {
    skippedCompanyIds: string[];
    skippedEnrolmentIds: string[];
  };
}

interface RawCompanyRow {
  companyId: string;
  companyName: string;
  companyDomain: string | null;
  accountOwnerUserId: string | null;
  policyId: string;
  outreachEligibility: string | null;
  externalHiringPolicy: string | null;
  relationshipType: string | null;
  blockClass: string;
  isNonOverridable: boolean;
  reviewDate: string | null;
  policyReasonCode: string | null;
  policyScopeKey: string;
}

async function fetchRootPolicyCompanies(tenantId: string, limit: number): Promise<RawCompanyRow[]> {
  const rows = await db
    .select({
      companyId: wizmatchCompanies.id,
      companyName: wizmatchCompanies.name,
      companyDomain: wizmatchCompanies.domain,
      accountOwnerUserId: wizmatchCompanies.accountOwnerUserId,
      policyId: wizmatchCompanyPolicies.id,
      outreachEligibility: wizmatchCompanyPolicies.outreachEligibility,
      externalHiringPolicy: wizmatchCompanyPolicies.externalHiringPolicy,
      relationshipType: wizmatchCompanyPolicies.relationshipType,
      blockClass: wizmatchCompanyPolicies.blockClass,
      isNonOverridable: wizmatchCompanyPolicies.isNonOverridable,
      reviewDate: wizmatchCompanyPolicies.reviewDate,
      policyReasonCode: wizmatchCompanyPolicies.reasonCode,
      policyScopeKey: wizmatchCompanyPolicies.scopeKey,
    })
    .from(wizmatchCompanyPolicies)
    .innerJoin(
      wizmatchCompanies,
      and(eq(wizmatchCompanies.tenantId, wizmatchCompanyPolicies.tenantId), eq(wizmatchCompanies.id, wizmatchCompanyPolicies.companyId)),
    )
    .where(
      and(
        eq(wizmatchCompanyPolicies.tenantId, tenantId),
        eq(wizmatchCompanyPolicies.scopeType, 'entire_company'),
        isNull(wizmatchCompanyPolicies.supersededAt),
      ),
    )
    .orderBy(desc(wizmatchCompanyPolicies.createdAt))
    .limit(limit);
  return rows as RawCompanyRow[];
}

/** Maps companyId -> the pending wizmatch_company_duplicates.id it participates in (first match wins if a company somehow has more than one pending pair). */
async function fetchPendingDuplicateIdByCompany(tenantId: string, companyIds: string[]): Promise<Map<string, string>> {
  if (companyIds.length === 0) return new Map();
  const rows = await db
    .select({ id: wizmatchCompanyDuplicates.id, companyAId: wizmatchCompanyDuplicates.companyAId, companyBId: wizmatchCompanyDuplicates.companyBId })
    .from(wizmatchCompanyDuplicates)
    .where(
      and(
        eq(wizmatchCompanyDuplicates.tenantId, tenantId),
        eq(wizmatchCompanyDuplicates.resolution, 'pending'),
        inArray(wizmatchCompanyDuplicates.companyAId, companyIds),
      ),
    );
  const rowsB = await db
    .select({ id: wizmatchCompanyDuplicates.id, companyAId: wizmatchCompanyDuplicates.companyAId, companyBId: wizmatchCompanyDuplicates.companyBId })
    .from(wizmatchCompanyDuplicates)
    .where(
      and(
        eq(wizmatchCompanyDuplicates.tenantId, tenantId),
        eq(wizmatchCompanyDuplicates.resolution, 'pending'),
        inArray(wizmatchCompanyDuplicates.companyBId, companyIds),
      ),
    );
  const map = new Map<string, string>();
  for (const r of [...rows, ...rowsB]) {
    if (!map.has(r.companyAId)) map.set(r.companyAId, r.id);
    if (!map.has(r.companyBId)) map.set(r.companyBId, r.id);
  }
  return map;
}

/** Best (highest-confidence) contact-candidate tier per company, §7's cold-start confidence gate — reused, not re-derived. */
async function fetchBestContactConfidenceByCompany(
  tenantId: string,
  companyIds: string[],
): Promise<Map<string, 'high' | 'medium' | 'low'>> {
  if (companyIds.length === 0) return new Map();
  const rows = await db
    .select({
      companyId: wizmatchContactCandidates.companyId,
      confidenceScore: wizmatchContactCandidates.confidenceScore,
      metadata: wizmatchContactCandidates.metadata,
    })
    .from(wizmatchContactCandidates)
    .where(
      and(
        eq(wizmatchContactCandidates.tenantId, tenantId),
        inArray(wizmatchContactCandidates.companyId, companyIds),
        inArray(wizmatchContactCandidates.status, ['approved', 'needs_review', 'new', 'linked_to_crm']),
      ),
    );
  const tierRank: Record<'high' | 'medium' | 'low', number> = { high: 2, medium: 1, low: 0 };
  const best = new Map<string, 'high' | 'medium' | 'low'>();
  for (const row of rows) {
    const tier = deriveConfidenceTier(
      (row.metadata as Record<string, unknown> | null) ?? undefined,
      row.confidenceScore ?? 0,
    );
    const current = best.get(row.companyId);
    if (!current || tierRank[tier] > tierRank[current]) best.set(row.companyId, tier);
  }
  return best;
}

/**
 * The stored-policy-row equivalent of a canonical decision — what the queue
 * assignment falls back to in shadow, per PRD-005 §13's queue table. A row
 * whose `outreach_eligibility` is null or unrecognised resolves to `review`:
 * it surfaces for a human rather than being silently treated as contactable,
 * and `review` (unlike `deny`) hides nothing and disables nothing.
 */
function policyRowDecision(outreachEligibility: string | null): CanonicalCompanyEligibility['decision'] {
  if (outreachEligibility === 'blocked' || outreachEligibility === 'paused') return 'deny';
  if (outreachEligibility === 'eligible') return 'allow';
  return 'review';
}

function disabledReasonFor(item: {
  effectiveDecision: string;
  isNonOverridable: boolean;
  duplicatePending: boolean;
  contactConfidenceTier: 'high' | 'medium' | 'low' | null;
}): string | null {
  if (item.effectiveDecision === 'deny' && item.isNonOverridable) {
    return 'This company has a non-overridable block. No override or reclassify action is available at any scope.';
  }
  if (item.effectiveDecision === 'deny') {
    return 'This company is blocked by policy. Reclassify requires an admin.';
  }
  if (item.duplicatePending) {
    return 'A possible duplicate company is pending review. Queueing and export are disabled until resolved.';
  }
  if (item.contactConfidenceTier === 'low' || item.contactConfidenceTier === null) {
    return 'No high- or medium-confidence contact is available yet.';
  }
  return null;
}

export async function buildTodayQueues(tenantId: string, limit = 200): Promise<TodayQueues> {
  const partial: TodayQueues['partial'] = { skippedCompanyIds: [], skippedEnrolmentIds: [] };

  const rows = await fetchRootPolicyCompanies(tenantId, limit);
  const companyIds = rows.map((r) => r.companyId);

  const [canonicalByCompanyId, duplicateIdByCompany, confidenceByCompanyId] = await Promise.all([
    resolveCanonicalCompanyEligibilityBatch(tenantId, companyIds),
    fetchPendingDuplicateIdByCompany(tenantId, companyIds),
    fetchBestContactConfidenceByCompany(tenantId, companyIds),
  ]);

  const readyToContact: DecisionWorkbenchCompanyItem[] = [];
  const needsReview: DecisionWorkbenchCompanyItem[] = [];
  const pausedOrBlocked: DecisionWorkbenchCompanyItem[] = [];

  for (const row of rows) {
    try {
      const canonical = canonicalByCompanyId.get(row.companyId);
      if (!canonical) {
        partial.skippedCompanyIds.push(row.companyId);
        continue;
      }
      const duplicateId = duplicateIdByCompany.get(row.companyId) ?? null;
      const duplicatePending = duplicateId !== null;
      const contactConfidenceTier = confidenceByCompanyId.get(row.companyId) ?? null;
      // D-31: the canonical decision only becomes behavioural under `enforce`.
      // `actsOnDecision` is the resolver's own `decision !== 'allow' &&
      // enforcementMode === 'enforce'` predicate — never re-derived here.
      const effectiveDecision = canonical.actsOnDecision
        ? canonical.decision
        : policyRowDecision(row.outreachEligibility);
      const item: DecisionWorkbenchCompanyItem = {
        companyId: row.companyId,
        companyName: row.companyName,
        companyDomain: row.companyDomain,
        accountOwnerUserId: row.accountOwnerUserId,
        canonicalDecision: canonical.decision,
        canonicalReasonCode: canonical.reasonCode,
        canonicalBlockerCode: canonical.blockerCode,
        effectiveDecision,
        enforcementMode: canonical.enforcementMode,
        requiresExplicitApproval: effectiveDecision === 'review',
        outreachEligibility: row.outreachEligibility,
        externalHiringPolicy: row.externalHiringPolicy,
        relationshipType: row.relationshipType,
        blockClass: row.blockClass,
        isNonOverridable: row.isNonOverridable,
        reviewDate: row.reviewDate,
        policyReasonCode: row.policyReasonCode,
        policyScopeKey: row.policyScopeKey,
        contactConfidenceTier,
        duplicatePending,
        duplicateId,
        disabledReason: null,
      };
      item.disabledReason = disabledReasonFor(item);

      // State precedence per PRD-005 §13: non-overridable/overridable block →
      // pending duplicate → paused → needs_review → eligible. `deny` covers
      // both "blocked" and "paused" outreachEligibility (both resolve to a
      // deny at the gate, §8.2 L5); the raw `outreachEligibility` field lets
      // the UI group Paused separately from Blocked without a second engine.
      if (effectiveDecision === 'deny') {
        pausedOrBlocked.push(item);
      } else if (duplicatePending || effectiveDecision === 'review') {
        needsReview.push(item);
      } else if (contactConfidenceTier === 'high') {
        readyToContact.push(item);
      } else {
        // allow, but no high-confidence contact yet — never silently drop a
        // company; surface it as needing review rather than hiding it.
        needsReview.push(item);
      }
    } catch {
      partial.skippedCompanyIds.push(row.companyId);
    }
  }

  const repliesNeedingAction: DecisionWorkbenchReplyItem[] = [];
  try {
    const enrolmentRows = await db
      .select({
        enrolmentId: wizmatchOutreachEnrolments.id,
        companyId: wizmatchOutreachEnrolments.companyId,
        contactId: wizmatchOutreachEnrolments.contactId,
        state: wizmatchOutreachEnrolments.state,
        stateAt: wizmatchOutreachEnrolments.stateAt,
        companyName: wizmatchCompanies.name,
      })
      .from(wizmatchOutreachEnrolments)
      .leftJoin(
        wizmatchCompanies,
        and(eq(wizmatchCompanies.tenantId, wizmatchOutreachEnrolments.tenantId), eq(wizmatchCompanies.id, wizmatchOutreachEnrolments.companyId)),
      )
      .where(
        and(
          eq(wizmatchOutreachEnrolments.tenantId, tenantId),
          inArray(wizmatchOutreachEnrolments.state, [...REPLY_NEEDS_ACTION_STATES]),
        ),
      )
      .orderBy(desc(wizmatchOutreachEnrolments.stateAt))
      .limit(limit);

    for (const row of enrolmentRows) {
      try {
        repliesNeedingAction.push({
          enrolmentId: row.enrolmentId,
          companyId: row.companyId,
          companyName: row.companyName ?? null,
          contactId: row.contactId,
          state: row.state,
          stateAt: (row.stateAt as unknown as Date).toISOString?.() ?? String(row.stateAt),
        });
      } catch {
        partial.skippedEnrolmentIds.push(row.enrolmentId);
      }
    }
  } catch {
    // A resolver/DB failure here must not take down the other three queues —
    // report an empty reply queue rather than 500ing the whole response.
  }

  return {
    readyToContact,
    needsReview,
    repliesNeedingAction,
    pausedOrBlocked,
    counts: {
      readyToContact: readyToContact.length,
      needsReview: needsReview.length,
      repliesNeedingAction: repliesNeedingAction.length,
      pausedOrBlocked: pausedOrBlocked.length,
    },
    partial,
  };
}

export { REPLY_NEEDS_ACTION_STATES };
