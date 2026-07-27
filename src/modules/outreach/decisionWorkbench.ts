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
  /** The root (`entire_company`) row's id — the stale-state precondition the workbench must round-trip back as `expectedPolicyId` (PR 8A hardening, task 5). */
  policyId: string;
  outreachEligibility: string | null;
  externalHiringPolicy: string | null;
  relationshipType: string | null;
  blockClass: string | null;
  /**
   * PR 8A hardening (task 3) — true when EITHER the root row OR any narrower
   * active scope (region/business_unit/location/specific_*) is a
   * non-overridable block, not only the root. `nonOverridableScopeKey` names
   * whichever scope actually supplies it, so the UI can say WHERE the block
   * lives rather than just that one exists.
   */
  isNonOverridable: boolean;
  nonOverridableScopeKey: string | null;
  reviewDate: string | null;
  /** PR 8A hardening (task 7) — true when `reviewDate` is a UTC calendar date at or before now. Only meaningful when `reviewDate` is set. */
  reviewDateArrived: boolean;
  policyReasonCode: string | null;
  policyScopeKey: string | null;
  contactConfidenceTier: 'high' | 'medium' | 'low' | null;
  duplicatePending: boolean;
  duplicateId: string | null;
  /** PR 8A hardening (task 8) — true when this item is in the `routed` queue rather than Ready/Needs Review. */
  routed: boolean;
  /** The resolver's recommended route (§8.6/§8.7) — e.g. `account_owner`, `msp_vms_research`. `'none'`/`'standard_outreach'` are not routing states. */
  recommendedRoute: string;
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
  /**
   * PR 8A hardening (task 8) — companies the resolver routes to an account
   * owner or a dedicated workflow (§8.6/§8.7: `existing_client`,
   * `vendor_partner`, `prime_partner`, `former_client`, `msp_vms_only`,
   * `preferred_vendors_only`) rather than ordinary cold-outreach review.
   * Derived entirely from the EXISTING `recommendedRoute` (already computed
   * by the resolver) and `wizmatch_companies.account_owner_user_id` (already
   * a column) — no migration. Assignment/routing never grants write
   * permission on its own; every action still goes through the same
   * role/pilot/non-overridable checks as any other queue.
   */
  routed: DecisionWorkbenchCompanyItem[];
  counts: {
    readyToContact: number;
    needsReview: number;
    repliesNeedingAction: number;
    pausedOrBlocked: number;
    routed: number;
  };
  partial: {
    skippedCompanyIds: string[];
    skippedEnrolmentIds: string[];
    /** True when the replies query failed — an empty reply queue that must NOT be read as "no replies". */
    repliesUnavailable?: boolean;
    /** True when more companies matched than `limit` returned, so the queues are a page, not the whole tenant. */
    truncated?: boolean;
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

/**
 * PR 8A hardening (task 3) — maps companyId -> the scope_key of a NARROWER
 * (non-`entire_company`) active non-overridable block, if any. `resolveEffectivePolicy`'s
 * `applicableRows` only considers scopes the request context can resolve a
 * label for (§8.1.1) — a bare company-level display request supplies no
 * signal/region/business-unit/location hint at all, so a real narrower block
 * would otherwise never surface here even though `evaluateWizmatchOutreachGate`'s
 * own L1c gate (outreachGate.ts) correctly denies it once a real send/enrol
 * context IS supplied. This direct query is independent of context
 * resolvability by design: the workbench must show "this company has a
 * narrower non-overridable block" even when it cannot yet say against which
 * specific signal or region a future action would be evaluated.
 */
async function fetchNarrowerNonOverridableBlockByCompany(
  tenantId: string,
  companyIds: string[],
): Promise<Map<string, { scopeKey: string; blockClass: string }>> {
  if (companyIds.length === 0) return new Map();
  const rows = await db
    .select({
      companyId: wizmatchCompanyPolicies.companyId,
      scopeKey: wizmatchCompanyPolicies.scopeKey,
      blockClass: wizmatchCompanyPolicies.blockClass,
    })
    .from(wizmatchCompanyPolicies)
    .where(
      and(
        eq(wizmatchCompanyPolicies.tenantId, tenantId),
        inArray(wizmatchCompanyPolicies.companyId, companyIds),
        isNull(wizmatchCompanyPolicies.supersededAt),
        eq(wizmatchCompanyPolicies.outreachEligibility, 'blocked'),
        eq(wizmatchCompanyPolicies.isNonOverridable, true),
      ),
    );
  const map = new Map<string, { scopeKey: string; blockClass: string }>();
  for (const row of rows) {
    if (row.scopeKey === 'entire_company') continue; // the root row is already surfaced via RawCompanyRow
    if (!map.has(row.companyId)) map.set(row.companyId, { scopeKey: row.scopeKey, blockClass: row.blockClass });
  }
  return map;
}

/**
 * PR 8A hardening (task 7) — explicit, deterministic timezone handling.
 * `review_date` is a DATE column (no time-of-day, no offset) — treated as a
 * UTC calendar date, arrived when `now` is at or past UTC midnight of that
 * date. No scheduler or cron is required: this is evaluated fresh on every
 * queue read, so the resurfacing is a pure function of wall-clock time, not a
 * state transition anything has to remember to perform. A malformed or
 * unparseable date fails closed — it never auto-resurfaces.
 */
function isReviewDateArrived(reviewDate: string | null, now: Date): boolean {
  if (!reviewDate) return false;
  const arrivalUtcMs = Date.parse(`${reviewDate}T00:00:00.000Z`);
  if (Number.isNaN(arrivalUtcMs)) return false;
  return now.getTime() >= arrivalUtcMs;
}

/**
 * PR 8A hardening (task 8) — routes that mean "send this to an account owner
 * or a dedicated workflow", not ordinary cold-outreach review (§8.6/§8.7).
 * `standard_outreach` (normal review), `none` (hard-denied, already bucketed
 * earlier) and `prepare_then_review`/`monitor_only` (cold-start / direct-hire
 * monitoring, not owner-routed) are deliberately excluded.
 */
const ROUTED_ROUTE_CODES = new Set([
  'account_owner',
  'partnership_workflow',
  'account_management',
  'msp_vms_research',
  'vendor_empanelment',
  'reengagement_review',
]);

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
    // `deriveConfidenceTier` reads `confidenceTier` off `metadata.raw`, NOT off
    // `metadata` — that is where the discovery cascade writes it and what the
    // canonical reader (`mapPersistedCandidate`) passes. Passing `metadata`
    // itself meant the stored tier was never found and every row silently fell
    // through to the numeric threshold, which diverges both ways: a
    // cascade-graded `high` scoring 6 became `medium` (company dropped out of
    // Ready to Contact), and a row written on a 0-100 scale scoring 60 became
    // `high` (a low-confidence contact defeated §7's cold-start gate).
    const metadata = row.metadata as { raw?: Record<string, unknown> } | null;
    const tier = deriveConfidenceTier(metadata?.raw ?? undefined, row.confidenceScore ?? 0);
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
  nonOverridableScopeKey: string | null;
  duplicatePending: boolean;
  contactConfidenceTier: 'high' | 'medium' | 'low' | null;
  routed: boolean;
  accountOwnerUserId: string | null;
}): string | null {
  // PR 8A hardening (task 3) — derived from the EFFECTIVE isNonOverridable,
  // which is true when either the root row or any narrower active scope is
  // non-overridable-blocked, not only the root. A narrower-scope block must
  // never present as "Reclassify requires an admin" (implying an admin CAN
  // do something here) when no override is actually possible at any scope.
  // PR 8A review fix — a non-overridable block must surface REGARDLESS of the
  // effective decision, not only when the row itself reads `deny`. In shadow
  // (§16 rule 2) `effectiveDecision` follows the ROOT row, so a company whose
  // root is `eligible` while a narrower scope carries an active
  // non-overridable compliance block resolved to `allow` here — and therefore
  // landed in Ready to Contact with no warning at all. `writeCompanyPolicy`
  // only refuses a supersession at the SAME scope_key, so a root written to
  // `eligible` through the direct or bulk policy route reaches exactly that
  // state. The narrower block is never weakened (the gate re-resolves every
  // active row at send/enrol time and `findUnresolvableScopeType` fails
  // closed), so no send is enabled by this — but the operator was being shown
  // "ready to contact" for a company nobody may contact.
  if (item.isNonOverridable) {
    const where = item.nonOverridableScopeKey && item.nonOverridableScopeKey !== 'entire_company'
      ? ` at scope '${item.nonOverridableScopeKey}'`
      : '';
    return item.effectiveDecision === 'deny'
      ? `This company has a non-overridable block${where}. No override or reclassify action is available at any scope.`
      : `This company has a non-overridable block${where} even though its company-level policy currently reads `
        + `'${item.effectiveDecision}'. No override or reclassify action is available at any scope, and it must not be contacted.`;
  }
  if (item.effectiveDecision === 'deny') {
    return 'This company is blocked by policy. Reclassify requires an admin.';
  }
  if (item.duplicatePending) {
    return 'A possible duplicate company is pending review. Queueing and export are disabled until resolved.';
  }
  // PR 8A review fix — a ROUTED company that already has an account owner has
  // no primary action (§8.6/§8.7 route it to that owner, not to cold
  // outreach), so the UI renders "No action available" for it. Before this
  // branch, `disabledReasonFor` returned null for exactly that state, the UI's
  // `aria-describedby` therefore pointed at nothing, and the affordance was
  // left unexplained — for every user, not only screen-reader users. Placed
  // ahead of the contact-confidence branch because for a routed company the
  // routing, not the contact tier, is the operative reason.
  if (item.routed) {
    return item.accountOwnerUserId
      ? 'This company is routed to its account owner rather than cold outreach. Work it through the owner, or use the menu actions.'
      : 'This company is routed to an owner or a dedicated workflow rather than cold outreach. Assign an owner to proceed.';
  }
  if (item.contactConfidenceTier === 'low' || item.contactConfidenceTier === null) {
    return 'No high- or medium-confidence contact is available yet.';
  }
  return null;
}

export async function buildTodayQueues(tenantId: string, limit = 200): Promise<TodayQueues> {
  const partial: TodayQueues['partial'] = { skippedCompanyIds: [], skippedEnrolmentIds: [] };

  // Fetch one extra row purely to detect truncation: `counts` are otherwise
  // page counts presented as queue counts, so past `limit` companies rows
  // vanish from the operator's view with no signal at all.
  const fetched = await fetchRootPolicyCompanies(tenantId, limit + 1);
  const rows = fetched.slice(0, limit);
  if (fetched.length > limit) partial.truncated = true;
  const companyIds = rows.map((r) => r.companyId);

  const [canonicalByCompanyId, duplicateIdByCompany, confidenceByCompanyId, narrowerNonOverridableByCompany] = await Promise.all([
    resolveCanonicalCompanyEligibilityBatch(tenantId, companyIds),
    fetchPendingDuplicateIdByCompany(tenantId, companyIds),
    fetchBestContactConfidenceByCompany(tenantId, companyIds),
    fetchNarrowerNonOverridableBlockByCompany(tenantId, companyIds),
  ]);
  // Evaluated once per request, not per row, so every item in this response
  // agrees on "now" (task 7 — explicit, deterministic timezone handling).
  const now = new Date();

  const readyToContact: DecisionWorkbenchCompanyItem[] = [];
  const needsReview: DecisionWorkbenchCompanyItem[] = [];
  const pausedOrBlocked: DecisionWorkbenchCompanyItem[] = [];
  const routed: DecisionWorkbenchCompanyItem[] = [];

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

      // Task 3 — non-overridable at every scope. The root row supplies its
      // own isNonOverridable/blockClass; a narrower active scope can ALSO be
      // non-overridable-blocked independent of the root's own state (e.g. a
      // root `standard` block plus a `region:india` compliance removal).
      // Either one must disable every unblocking action.
      const narrower = narrowerNonOverridableByCompany.get(row.companyId) ?? null;
      const isNonOverridable = row.isNonOverridable || narrower !== null;
      const nonOverridableScopeKey = row.isNonOverridable ? row.policyScopeKey : (narrower?.scopeKey ?? null);
      const effectiveBlockClass = row.isNonOverridable ? row.blockClass : (narrower?.blockClass ?? row.blockClass);

      // Task 7 — review-date resurfacing. Only a PAUSED row (never a blocked
      // one — a block's review date is informational only; no override
      // becomes available just because a date passed) whose review_date has
      // arrived re-enters Needs Review. A future date, or no date at all,
      // changes nothing. Purely a display/bucketing concern — it never
      // blocks anything, so it applies identically in shadow and enforce
      // (§16 rule 2).
      const isPausedRow = row.outreachEligibility === 'paused';
      const reviewDateArrived = isReviewDateArrived(row.reviewDate, now);
      const pausedAndDue = isPausedRow && reviewDateArrived;

      // Task 8 — routed/assigned queue. A company the resolver routes to an
      // account owner or a dedicated workflow (§8.6/§8.7), surfaced
      // separately from ordinary Ready/Needs Review so an operator can see
      // who owns it (or that nobody does yet) at a glance. Derived from the
      // EXISTING `recommendedRoute` and `accountOwnerUserId` — no migration.
      const recommendedRoute = canonical.recommendedRoute ?? 'none';
      const isRoutedCandidate = ROUTED_ROUTE_CODES.has(recommendedRoute);
      // PR 8A review fix — resolved BEFORE the item is built, not mutated
      // after bucketing, because `disabledReasonFor` now needs it: an item
      // whose reason is "routed to its account owner" must carry that reason
      // from construction, and `routed` must never be true for a row that
      // precedence sends to Paused or Blocked / Needs Review instead. Mirrors
      // the bucketing chain below exactly.
      const effectiveAccountOwnerUserId = canonical.accountOwnerUserId ?? row.accountOwnerUserId;
      const willBeRouted = isRoutedCandidate && effectiveDecision !== 'deny' && !duplicatePending;

      const item: DecisionWorkbenchCompanyItem = {
        companyId: row.companyId,
        companyName: row.companyName,
        companyDomain: row.companyDomain,
        accountOwnerUserId: effectiveAccountOwnerUserId,
        canonicalDecision: canonical.decision,
        canonicalReasonCode: canonical.reasonCode,
        canonicalBlockerCode: canonical.blockerCode,
        effectiveDecision,
        enforcementMode: canonical.enforcementMode,
        requiresExplicitApproval: effectiveDecision === 'review',
        policyId: row.policyId,
        outreachEligibility: row.outreachEligibility,
        externalHiringPolicy: row.externalHiringPolicy,
        relationshipType: row.relationshipType,
        blockClass: effectiveBlockClass,
        isNonOverridable,
        nonOverridableScopeKey,
        reviewDate: row.reviewDate,
        reviewDateArrived,
        policyReasonCode: row.policyReasonCode,
        policyScopeKey: row.policyScopeKey,
        contactConfidenceTier,
        duplicatePending,
        duplicateId,
        routed: willBeRouted,
        recommendedRoute,
        disabledReason: null,
      };
      item.disabledReason = disabledReasonFor(item);

      // State precedence per PRD-005 §13: non-overridable/overridable block →
      // pending duplicate → paused (unless its review date has arrived) →
      // routed → needs_review → eligible. `deny` covers both "blocked" and
      // "paused" outreachEligibility (both resolve to a deny at the gate,
      // §8.2 L5); the raw `outreachEligibility` field lets the UI group
      // Paused separately from Blocked without a second engine. A pending
      // duplicate is itself a gate-L5 deny (`outreachGate.ts:551`), so under
      // `enforce` a `duplicatePending` company ALWAYS carried
      // `decision === 'deny'` and the duplicate branch below was
      // unreachable — duplicates landed in Paused or Blocked with a block
      // affordance instead of Needs Review with Merge / Confirm Separate.
      const isBlockedRow = row.outreachEligibility === 'blocked';
      // PR 8A review fix — a non-overridable-blocked company NEVER enters
      // Ready to Contact, whatever its root row says. "Ready to Contact" means
      // exactly "you may contact these now", and this company may not be
      // contacted at any scope. This is a display/bucketing decision only —
      // it blocks no write and removes no affordance (the action layer already
      // refuses every unblocking action for it), so it holds identically in
      // shadow and enforce and does not violate §16 rule 2.
      if (isNonOverridable) {
        pausedOrBlocked.push(item);
      } else if (effectiveDecision === 'deny' && isBlockedRow) {
        pausedOrBlocked.push(item);
      } else if (duplicatePending) {
        needsReview.push(item);
      } else if (effectiveDecision === 'deny' && pausedAndDue) {
        // Paused, but the review date has arrived — re-enters Needs Review
        // rather than sitting in Paused or Blocked indefinitely.
        needsReview.push(item);
      } else if (effectiveDecision === 'deny') {
        pausedOrBlocked.push(item);
      } else if (willBeRouted) {
        routed.push(item);
      } else if (effectiveDecision === 'review') {
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
  } catch (error) {
    // A resolver/DB failure here must not take down the other three queues —
    // but it must not read as "no replies waiting" either. This is the one
    // queue holding company locks (§10.6.1), so an unreported empty is the
    // most dangerous possible lie. Report it and log it.
    partial.repliesUnavailable = true;
    console.error('[wizmatch today/queues] replies-needing-action query failed; queue reported unavailable', error);
  }

  return {
    readyToContact,
    needsReview,
    repliesNeedingAction,
    pausedOrBlocked,
    routed,
    counts: {
      readyToContact: readyToContact.length,
      needsReview: needsReview.length,
      repliesNeedingAction: repliesNeedingAction.length,
      pausedOrBlocked: pausedOrBlocked.length,
      routed: routed.length,
    },
    partial,
  };
}

export { REPLY_NEEDS_ACTION_STATES };
