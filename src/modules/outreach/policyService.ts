// PRD-005 PR 4 — policy read/write service, account-owner assignment, and
// admin bulk policy actions.
//
// This module is the WRITE side of the policy model. Every decision-affecting
// READ still goes through `resolveEffectivePolicy` / `evaluateWizmatchOutreachGate`
// (policyResolver.ts / outreachGate.ts, PR 2/3) — nothing here bypasses or
// duplicates that ladder. What PR 2/3 never needed, because nothing wrote a
// second row or displayed history, is: a tenant-safe read shape for the UI
// (effective + all scoped rows + full history), a supersession-based write
// path with service-layer evidence validation (mirroring, not replacing, the
// DB CHECK constraints — ADR-006 D-7/D-17), account-owner assignment with
// composite-tenancy validation, and admin bulk actions with partial-failure
// reporting.

import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  db,
  wizmatchCompanyPolicies,
  wizmatchCompanyPolicyEvents,
  wizmatchCompanies,
  wizmatchStaffingEvents,
  wizmatchJobSignals,
  wizmatchRequirements,
  users,
} from '../../db';
import { auditLog } from '../../services/auditLogger';
import { normalizeDomain } from '../../services/wizmatchContactIntelligenceRepo';
import { buildScopeKey } from './scopeKey';
import { resolveEffectivePolicy, type EffectivePolicy } from './policyResolver';
import type {
  BlockClass,
  EvidenceKind,
  ExternalHiringPolicy,
  OutreachEligibility,
  RelationshipType,
  ScopeType,
} from './policyTypes';

// H-8 / D-37: every dimension the resolver compares by literal equality must
// be validated against its full enum at write time, or an out-of-vocabulary
// value (wrong case, a typo, a stale client) reaches the gate's terminal
// `allow` by simply matching none of the `===` branches — a fail-OPEN, not
// fail-closed. `externalHiringPolicy`/`relationshipType` already fail closed
// downstream (`computeCampaignCompatibility` throws on an unrecognised
// pair); `outreachEligibility` did not, because every gate comparison against
// it is a bare literal check with no `else -> deny`. Validating all five
// dimensions here closes that asymmetry once and for all, at the one write
// chokepoint, rather than patching each gate comparison individually.
const OUTREACH_ELIGIBILITY_VALUES: OutreachEligibility[] = ['eligible', 'needs_review', 'paused', 'blocked'];
const EXTERNAL_HIRING_POLICY_VALUES: ExternalHiringPolicy[] = [
  'accepts_external_vendors',
  'fte_vendors_only',
  'contract_vendors_only',
  'preferred_vendors_only',
  'msp_vms_only',
  'direct_hiring_only',
  'no_external_agencies',
  'unknown',
];
const RELATIONSHIP_TYPE_VALUES: RelationshipType[] = [
  'new_prospect',
  'existing_prospect',
  'existing_client',
  'vendor_partner',
  'prime_partner',
  'former_client',
  'competitor',
  'irrelevant',
];
const BLOCK_CLASS_VALUES: BlockClass[] = ['standard', 'compliance', 'legal'];
const EVIDENCE_KIND_VALUES: EvidenceKind[] = [
  'human_text',
  'source_url',
  'email_reply_ref',
  'provider_event_ref',
  'legal_document_ref',
  'automated_detection',
];

export class PolicyValidationError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'PolicyValidationError';
    this.code = code;
  }
}

export class PolicyOverrideRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolicyOverrideRefusedError';
  }
}

export interface PolicyActor {
  tenantId: string;
  userId?: string;
}

export interface PolicyWriteInput {
  scopeType: ScopeType;
  signalId?: string;
  requirementId?: string;
  scopeRefLabel?: string;
  outreachEligibility?: OutreachEligibility;
  externalHiringPolicy?: ExternalHiringPolicy;
  relationshipType?: RelationshipType;
  reasonCode: string;
  reason?: string;
  evidenceKind?: EvidenceKind;
  evidenceText?: string;
  evidenceUrl?: string;
  evidenceRef?: string;
  isPermanent?: boolean;
  isNonOverridable?: boolean;
  reviewDate?: string;
  blockClass?: BlockClass;
}

const SCOPE_TYPES: ScopeType[] = [
  'entire_company',
  'region',
  'business_unit',
  'location',
  'specific_signal',
  'specific_requirement',
];

/**
 * Service-layer mirror of the §10.1 evidence/inheritance CHECK constraints
 * (ADR-006 D-7/D-17), so a bad write is rejected with a structured, readable
 * error before it ever reaches Postgres. The DB CHECKs remain the actual
 * enforcement (they cannot be bypassed by a future caller of this module that
 * skips validation) — this is a better error message, not a replacement.
 */
function validatePolicyWrite(input: PolicyWriteInput): void {
  if (!SCOPE_TYPES.includes(input.scopeType)) {
    throw new PolicyValidationError(`Unknown scopeType '${input.scopeType}'.`, 'unknown_scope_type');
  }
  // H-8 / D-37 — fail closed on every unknown enum value; never fall through.
  if (input.outreachEligibility !== undefined && !OUTREACH_ELIGIBILITY_VALUES.includes(input.outreachEligibility)) {
    throw new PolicyValidationError(`Unknown outreachEligibility '${input.outreachEligibility}'.`, 'unknown_outreach_eligibility');
  }
  if (input.externalHiringPolicy !== undefined && !EXTERNAL_HIRING_POLICY_VALUES.includes(input.externalHiringPolicy)) {
    throw new PolicyValidationError(`Unknown externalHiringPolicy '${input.externalHiringPolicy}'.`, 'unknown_external_hiring_policy');
  }
  if (input.relationshipType !== undefined && !RELATIONSHIP_TYPE_VALUES.includes(input.relationshipType)) {
    throw new PolicyValidationError(`Unknown relationshipType '${input.relationshipType}'.`, 'unknown_relationship_type');
  }
  if (input.blockClass !== undefined && !BLOCK_CLASS_VALUES.includes(input.blockClass)) {
    throw new PolicyValidationError(`Unknown blockClass '${input.blockClass}'.`, 'unknown_block_class');
  }
  if (input.evidenceKind !== undefined && !EVIDENCE_KIND_VALUES.includes(input.evidenceKind)) {
    throw new PolicyValidationError(`Unknown evidenceKind '${input.evidenceKind}'.`, 'unknown_evidence_kind');
  }
  const isBlocked = input.outreachEligibility === 'blocked';
  const hasEvidence = Boolean(input.evidenceText?.trim() || input.evidenceUrl?.trim() || input.evidenceRef?.trim());

  if ((input.isPermanent || input.isNonOverridable) && !(input.evidenceKind && hasEvidence)) {
    throw new PolicyValidationError(
      'A permanent or non-overridable policy row requires evidenceKind plus one of evidenceText/evidenceUrl/evidenceRef.',
      'evidence_required',
    );
  }
  if (input.isNonOverridable && !isBlocked) {
    throw new PolicyValidationError(
      'isNonOverridable may only be set when outreachEligibility is blocked.',
      'non_overridable_requires_blocked',
    );
  }
  if (input.blockClass && input.blockClass !== 'standard') {
    if (!isBlocked) {
      throw new PolicyValidationError(
        'blockClass other than standard may only be set when outreachEligibility is blocked.',
        'block_class_requires_blocked',
      );
    }
    if (!input.isNonOverridable) {
      throw new PolicyValidationError(
        'A compliance or legal block must be non-overridable (PRD-005 §8.3).',
        'block_class_requires_non_overridable',
      );
    }
  }
  if (input.outreachEligibility === 'paused' && !input.reviewDate) {
    throw new PolicyValidationError('A paused policy row requires reviewDate.', 'paused_requires_review_date');
  }
  if (input.scopeType === 'entire_company') {
    if (!input.outreachEligibility || !input.externalHiringPolicy || !input.relationshipType) {
      throw new PolicyValidationError(
        'An entire_company row must define all three dimensions.',
        'root_requires_all_dimensions',
      );
    }
  } else if (!input.outreachEligibility && !input.externalHiringPolicy && !input.relationshipType) {
    throw new PolicyValidationError('A scoped row must override at least one dimension.', 'scoped_requires_one_dimension');
  }
  if (input.scopeType === 'specific_signal' && !input.signalId) {
    throw new PolicyValidationError('specific_signal requires signalId.', 'signal_id_required');
  }
  if (input.scopeType === 'specific_requirement' && !input.requirementId) {
    throw new PolicyValidationError('specific_requirement requires requirementId.', 'requirement_id_required');
  }
  if (['region', 'business_unit', 'location'].includes(input.scopeType) && !input.scopeRefLabel) {
    throw new PolicyValidationError('region/business_unit/location requires scopeRefLabel.', 'scope_ref_label_required');
  }
}

/**
 * H-9 — PRD-005 §10.1/§18.2 name `evidence_url` as SSRF-scrubbed via the
 * existing `normalizeDomain()` utility; the write path never called it.
 * `normalizeDomain` returns `null` for a host that fails `isSafeFetchHost`
 * (private/loopback/link-local/cloud-metadata/obfuscated-IP/etc.) — a null
 * here means the URL is unsafe, so the write is rejected rather than
 * silently storing (and later possibly fetching) an SSRF target. The full
 * URL string is what's persisted (a reviewer needs to click through it);
 * this function only gates on safety, it doesn't rewrite the value.
 */
function assertSafeEvidenceUrl(evidenceUrl: string | undefined): void {
  if (!evidenceUrl) return;
  if (normalizeDomain(evidenceUrl) === null) {
    throw new PolicyValidationError(`evidenceUrl '${evidenceUrl}' failed the SSRF safety check.`, 'unsafe_evidence_url');
  }
}

/**
 * H-10 — PRD-005 §10.1 designates the signal/requirement ↔ company
 * agreement invariant as service-enforced (no FK can express it: a
 * `specific_signal` scope's `signal_id` must belong to the SAME company the
 * policy row is being written against). Without this check a scoped block
 * written against the wrong company is accepted, displayed as "blocked" in
 * the UI, and never actually applies to any real signal/requirement — a
 * silent, fail-open gap with a green UI.
 */
async function assertScopeRefBelongsToCompany(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tenantId: string,
  companyId: string,
  input: PolicyWriteInput,
): Promise<void> {
  if (input.scopeType === 'specific_signal' && input.signalId) {
    const rows = await tx
      .select({ companyId: wizmatchJobSignals.companyId })
      .from(wizmatchJobSignals)
      .where(and(eq(wizmatchJobSignals.tenantId, tenantId), eq(wizmatchJobSignals.id, input.signalId)));
    if (rows.length === 0 || rows[0]?.companyId !== companyId) {
      throw new PolicyValidationError('signalId does not belong to this company.', 'signal_company_mismatch');
    }
  }
  if (input.scopeType === 'specific_requirement' && input.requirementId) {
    const rows = await tx
      .select({ companyId: wizmatchRequirements.companyId })
      .from(wizmatchRequirements)
      .where(and(eq(wizmatchRequirements.tenantId, tenantId), eq(wizmatchRequirements.id, input.requirementId)));
    if (rows.length === 0 || rows[0]?.companyId !== companyId) {
      throw new PolicyValidationError('requirementId does not belong to this company.', 'requirement_company_mismatch');
    }
  }
}

function buildScopeKeyForInput(input: PolicyWriteInput): string {
  if (input.scopeType === 'entire_company') return buildScopeKey('entire_company');
  if (input.scopeType === 'region' || input.scopeType === 'business_unit' || input.scopeType === 'location') {
    return buildScopeKey(input.scopeType, input.scopeRefLabel as string);
  }
  if (input.scopeType === 'specific_signal') return buildScopeKey('specific_signal', input.signalId as string);
  return buildScopeKey('specific_requirement', input.requirementId as string);
}

function rowToState(row: typeof wizmatchCompanyPolicies.$inferSelect) {
  return {
    scopeType: row.scopeType,
    scopeKey: row.scopeKey,
    outreachEligibility: row.outreachEligibility,
    externalHiringPolicy: row.externalHiringPolicy,
    relationshipType: row.relationshipType,
    blockClass: row.blockClass,
    isNonOverridable: row.isNonOverridable,
    isPermanent: row.isPermanent,
    reviewDate: row.reviewDate,
  };
}

/** GET /api/wizmatch/companies/:id/policy — tenant-safe read: effective + scoped rows + history. */
export async function getCompanyPolicyView(
  tenantId: string,
  companyId: string,
): Promise<{
  effective: EffectivePolicy;
  scoped: (typeof wizmatchCompanyPolicies.$inferSelect)[];
  history: (typeof wizmatchCompanyPolicyEvents.$inferSelect)[];
  accountOwnerUserId: string | null;
}> {
  const effective = await resolveEffectivePolicy(tenantId, companyId, { tenantId, action: 'enrol', companyId });
  const companyRows = await db
    .select({ accountOwnerUserId: wizmatchCompanies.accountOwnerUserId })
    .from(wizmatchCompanies)
    .where(and(eq(wizmatchCompanies.tenantId, tenantId), eq(wizmatchCompanies.id, companyId)));
  const scoped = await db
    .select()
    .from(wizmatchCompanyPolicies)
    .where(
      and(
        eq(wizmatchCompanyPolicies.tenantId, tenantId),
        eq(wizmatchCompanyPolicies.companyId, companyId),
        isNull(wizmatchCompanyPolicies.supersededAt),
      ),
    )
    .orderBy(wizmatchCompanyPolicies.scopeKey);
  const history = await db
    .select()
    .from(wizmatchCompanyPolicyEvents)
    .where(and(eq(wizmatchCompanyPolicyEvents.tenantId, tenantId), eq(wizmatchCompanyPolicyEvents.companyId, companyId)))
    .orderBy(desc(wizmatchCompanyPolicyEvents.createdAt));
  return { effective, scoped, history, accountOwnerUserId: companyRows[0]?.accountOwnerUserId ?? null };
}

/**
 * POST /api/wizmatch/companies/:id/policy — supersession-based write
 * (ADR-006 D-10): the new row is inserted, the previous active row at the
 * SAME scope_key (if any) is superseded (supersededAt/supersededByPolicyId
 * only — the two columns the immutability trigger permits), and a
 * `wizmatch_company_policy_events` row records from/to state. One transaction,
 * so a policy is never observable as "written" without its audit event, the
 * same guarantee `suppress()` makes for the suppression grain (PR 3, D-4).
 *
 * Refuses to supersede a predecessor with `isNonOverridable = true`
 * (PRD-005 §12 override contract) — an override of a non-overridable scope
 * must go through a separate, explicit, evidenced decision this function
 * cannot make silently. `writeCompanyPolicyOverride` below is that path, and
 * even it is refused by the same check, per ADR-006 D-18.
 */
export async function writeCompanyPolicy(
  actor: PolicyActor,
  companyId: string,
  input: PolicyWriteInput,
  source: 'human' | 'import' | 'deterministic_rule' | 'provider' = 'human',
): Promise<typeof wizmatchCompanyPolicies.$inferSelect> {
  validatePolicyWrite(input);
  assertSafeEvidenceUrl(input.evidenceUrl);
  const scopeKey = buildScopeKeyForInput(input);

  return db.transaction(async (tx) => {
    await assertScopeRefBelongsToCompany(tx, actor.tenantId, companyId, input);
    const previousRows = await tx
      .select()
      .from(wizmatchCompanyPolicies)
      .where(
        and(
          eq(wizmatchCompanyPolicies.tenantId, actor.tenantId),
          eq(wizmatchCompanyPolicies.companyId, companyId),
          eq(wizmatchCompanyPolicies.scopeKey, scopeKey),
          isNull(wizmatchCompanyPolicies.supersededAt),
        ),
      );
    const previousRow = previousRows[0] ?? null;
    if (previousRow?.isNonOverridable) {
      throw new PolicyOverrideRefusedError(
        `Scope '${scopeKey}' is non-overridable (block_class='${previousRow.blockClass}'); it cannot be superseded.`,
      );
    }

    // Order matters and is load-bearing. `wizmatch_company_policies_active_scope_uniq`
    // is a PARTIAL UNIQUE INDEX on (tenant_id, company_id, scope_key)
    // WHERE superseded_at IS NULL (§10.1, migration 0037). A unique *index* is
    // non-deferrable — Postgres enforces it per statement, not at COMMIT — so the
    // predecessor must leave the index BEFORE the successor enters it. Inserting
    // first raises 23505 and rolls the whole write back, which made every
    // supersession (and therefore every override) fail. The new id is generated
    // here so the predecessor can point at it in a single UPDATE.
    const newPolicyId = randomUUID();
    if (previousRow) {
      await tx
        .update(wizmatchCompanyPolicies)
        .set({ supersededAt: new Date(), supersededByPolicyId: newPolicyId })
        .where(and(eq(wizmatchCompanyPolicies.tenantId, actor.tenantId), eq(wizmatchCompanyPolicies.id, previousRow.id)));
    }

    const [inserted] = await tx
      .insert(wizmatchCompanyPolicies)
      .values({
        id: newPolicyId,
        tenantId: actor.tenantId,
        companyId,
        scopeType: input.scopeType,
        scopeKey,
        signalId: input.scopeType === 'specific_signal' ? input.signalId : null,
        requirementId: input.scopeType === 'specific_requirement' ? input.requirementId : null,
        scopeRefLabel: ['region', 'business_unit', 'location'].includes(input.scopeType)
          ? input.scopeRefLabel
          : null,
        outreachEligibility: input.outreachEligibility ?? null,
        externalHiringPolicy: input.externalHiringPolicy ?? null,
        relationshipType: input.relationshipType ?? null,
        reasonCode: input.reasonCode,
        reason: input.reason,
        evidenceKind: input.evidenceKind,
        evidenceText: input.evidenceText,
        evidenceUrl: input.evidenceUrl,
        evidenceRef: input.evidenceRef,
        source,
        actorUserId: actor.userId,
        isPermanent: input.isPermanent ?? false,
        blockClass: input.blockClass ?? 'standard',
        isNonOverridable: input.isNonOverridable ?? false,
        reviewDate: input.reviewDate,
      })
      .returning();

    await tx.insert(wizmatchCompanyPolicyEvents).values({
      tenantId: actor.tenantId,
      companyId,
      policyId: inserted.id,
      previousPolicyId: previousRow?.id ?? null,
      fromState: previousRow ? rowToState(previousRow) : null,
      toState: rowToState(inserted),
      reasonCode: input.reasonCode,
      reason: input.reason,
      evidenceKind: input.evidenceKind,
      evidenceText: input.evidenceText,
      evidenceUrl: input.evidenceUrl,
      evidenceRef: input.evidenceRef,
      actorUserId: actor.userId,
      source,
    });

    return inserted;
  });
}

/**
 * POST /api/wizmatch/companies/:id/policy/override — admin-only. Writes a NEW
 * superseding row with `reasonCode='manual_admin_override'` (ADR-006 D-18).
 * Evidence is mandatory here regardless of `isPermanent`/`isNonOverridable`,
 * because an override of an existing decision must always be evidenced, not
 * only when it also happens to be permanent.
 */
export async function writeCompanyPolicyOverride(
  actor: PolicyActor,
  companyId: string,
  input: Omit<PolicyWriteInput, 'reasonCode'> & { evidenceKind: EvidenceKind },
): Promise<typeof wizmatchCompanyPolicies.$inferSelect> {
  if (!input.evidenceText && !input.evidenceUrl && !input.evidenceRef) {
    throw new PolicyValidationError('An admin override requires evidence.', 'evidence_required');
  }
  return writeCompanyPolicy(actor, companyId, { ...input, reasonCode: 'manual_admin_override' }, 'human');
}

/**
 * POST /api/wizmatch/companies/:id/owner — account-owner assignment.
 * Composite-tenancy validated (the candidate owner must be a user row in the
 * SAME tenant — mirrors the DB's composite FK `(tenant_id, account_owner_user_id)
 * -> users(tenant_id, id)`, ON DELETE SET NULL, PRD-005 §10.8), and writes
 * BOTH required events: an `audit_events`-style row via the shared
 * `auditLogger` (repo-wide audit convention) AND a `wizmatch_staffing_events`
 * row (`event_type='company_owner_changed'`) so the change appears on the
 * company timeline beside policy history, per PRD-005 §10.8's "every
 * ownership change writes an audit_events row via the existing auditLogger
 * AND a wizmatch_staffing_events row" requirement.
 */
export async function assignAccountOwner(
  actor: PolicyActor,
  companyId: string,
  ownerUserId: string | null,
): Promise<{ companyId: string; previousOwnerUserId: string | null; ownerUserId: string | null }> {
  const result = await db.transaction(async (tx) => {
    if (ownerUserId) {
      const owner = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.tenantId, actor.tenantId), eq(users.id, ownerUserId)));
      if (owner.length === 0) {
        throw new PolicyValidationError('accountOwnerUserId must be a user in the same tenant.', 'owner_cross_tenant');
      }
    }
    const companyRows = await tx
      .select({ accountOwnerUserId: wizmatchCompanies.accountOwnerUserId })
      .from(wizmatchCompanies)
      .where(and(eq(wizmatchCompanies.tenantId, actor.tenantId), eq(wizmatchCompanies.id, companyId)));
    if (companyRows.length === 0) {
      throw new PolicyValidationError('Company not found.', 'company_not_found');
    }
    const previousOwnerUserId = companyRows[0]?.accountOwnerUserId ?? null;

    await tx
      .update(wizmatchCompanies)
      .set({ accountOwnerUserId: ownerUserId, updatedAt: new Date() })
      .where(and(eq(wizmatchCompanies.tenantId, actor.tenantId), eq(wizmatchCompanies.id, companyId)));

    await tx.insert(wizmatchStaffingEvents).values({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      eventType: 'company_owner_changed',
      companyId,
      payload: { previousOwnerUserId, ownerUserId },
    });

    return { companyId, previousOwnerUserId, ownerUserId };
  });

  // auditLog is a best-effort, never-throwing write on its own pool connection
  // (src/services/auditLogger.ts) — deliberately outside the transaction above,
  // consistent with every other caller in the repo (e.g. billing.ts).
  await auditLog({
    tenantId: actor.tenantId,
    userId: actor.userId,
    action: 'wizmatch_company_owner_changed',
    entityType: 'wizmatch_company',
    entityId: companyId,
    oldValues: { accountOwnerUserId: result.previousOwnerUserId },
    newValues: { accountOwnerUserId: result.ownerUserId },
  });

  return result;
}

export interface BulkPolicyActionInput {
  companyIds: string[];
  input: PolicyWriteInput;
}

export interface BulkPolicyActionResult {
  requested: number;
  succeeded: number;
  failed: number;
  results: Array<{ companyId: string; ok: boolean; error?: string; code?: string }>;
}

/**
 * POST /api/wizmatch/companies/bulk/policy — admin-only (PRD-005 §4). Reports
 * a count first (`requested`) and never lets one company's failure silently
 * drop the rest — each row is attempted independently and its outcome
 * recorded, per PRD-005 "partial success reported, never silently swallowed"
 * (§12, Today actions contract, applied identically here).
 */
export async function bulkWriteCompanyPolicy(
  actor: PolicyActor,
  params: BulkPolicyActionInput,
): Promise<BulkPolicyActionResult> {
  const results: BulkPolicyActionResult['results'] = [];
  for (const companyId of params.companyIds) {
    try {
      await writeCompanyPolicy(actor, companyId, params.input, 'human');
      results.push({ companyId, ok: true });
    } catch (error) {
      results.push({
        companyId,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
        code: error instanceof PolicyValidationError ? error.code : undefined,
      });
    }
  }
  return {
    requested: params.companyIds.length,
    succeeded: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  };
}

export interface PolicyCompanyListFilter {
  tenantId: string;
  eligibility?: OutreachEligibility;
  hiringPolicy?: ExternalHiringPolicy;
  relationship?: RelationshipType;
  reviewDue?: boolean;
}

/**
 * GET /api/wizmatch/policy/companies — tenant-scoped listing filtered by the
 * root (`entire_company`) policy dimensions, for the admin bulk-action list
 * view. Deliberately a NEW read endpoint rather than overloading the existing
 * `GET /api/wizmatch/staffing/companies` list (which this PR does not touch),
 * to avoid perturbing existing behaviour on a shared, heavily-used route —
 * disclosed scope choice, not an oversight.
 */
export async function listCompaniesByPolicy(filter: PolicyCompanyListFilter) {
  const conditions = [
    eq(wizmatchCompanyPolicies.tenantId, filter.tenantId),
    eq(wizmatchCompanyPolicies.scopeType, 'entire_company'),
    isNull(wizmatchCompanyPolicies.supersededAt),
  ];
  if (filter.eligibility) conditions.push(eq(wizmatchCompanyPolicies.outreachEligibility, filter.eligibility));
  if (filter.hiringPolicy) conditions.push(eq(wizmatchCompanyPolicies.externalHiringPolicy, filter.hiringPolicy));
  if (filter.relationship) conditions.push(eq(wizmatchCompanyPolicies.relationshipType, filter.relationship));
  if (filter.reviewDue) conditions.push(sql`${wizmatchCompanyPolicies.reviewDate} IS NOT NULL AND ${wizmatchCompanyPolicies.reviewDate} <= now()`);

  return db
    .select({
      companyId: wizmatchCompanyPolicies.companyId,
      companyName: wizmatchCompanies.name,
      outreachEligibility: wizmatchCompanyPolicies.outreachEligibility,
      externalHiringPolicy: wizmatchCompanyPolicies.externalHiringPolicy,
      relationshipType: wizmatchCompanyPolicies.relationshipType,
      reviewDate: wizmatchCompanyPolicies.reviewDate,
      blockClass: wizmatchCompanyPolicies.blockClass,
      isNonOverridable: wizmatchCompanyPolicies.isNonOverridable,
      accountOwnerUserId: wizmatchCompanies.accountOwnerUserId,
    })
    .from(wizmatchCompanyPolicies)
    .innerJoin(
      wizmatchCompanies,
      and(eq(wizmatchCompanies.tenantId, wizmatchCompanyPolicies.tenantId), eq(wizmatchCompanies.id, wizmatchCompanyPolicies.companyId)),
    )
    .where(and(...conditions))
    .orderBy(wizmatchCompanies.name);
}

// Re-exported so route handlers don't need a second import from drizzle-orm
// just to build an `inArray` filter for a companyIds query param.
export { inArray };
