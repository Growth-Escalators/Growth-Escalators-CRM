// PRD-005 §8.8, §12, §13 — duplicate-company review: list, side-by-side
// comparison and resolution (Merge / Confirm Separate). Detection itself
// (populating `wizmatch_company_duplicates` with `resolution='pending'`) is
// out of PR 4's scope — no caller in this repo writes a duplicate row yet, so
// this module only reads and resolves. Containment (both companies denied at
// L5 while `resolution='pending'`) is already enforced by the gate
// (`findPendingDuplicate` in outreachGate.ts, PR 3) — resolving a pair lifts
// containment simply by changing `resolution` away from `'pending'`, since the
// gate's query filters on that exact value. No separate "unblock" step exists
// or is needed.
//
// "Merge" here means resolving the duplicate-suspect record — the schema
// (PRD-005 §10.3) has no survivor/loser column and no cross-entity data
// migration is specified anywhere in the PRD for this PR. Consolidating the
// two companies' contacts/requirements/signals into one surviving row is not
// in scope for PR 4 and is not implied by the acceptance criteria; it would
// require a schema change (a `survivor_company_id` or similar) that PR 4's
// guardrails do not authorise. This is a disclosed scope limit, not an
// omission.

import { and, desc, eq } from 'drizzle-orm';
import { db, wizmatchCompanies, wizmatchCompanyDuplicates, wizmatchStaffingEvents } from '../../db';
import { auditLog } from '../../services/auditLogger';
import { getReasonCodeMeta } from '../../config/wizmatchReasonCodes';
import type { PolicyActor } from './policyService';

export class DuplicateValidationError extends Error {
  readonly code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = 'DuplicateValidationError';
    this.code = code;
  }
}

export type DuplicateResolution = 'merged' | 'confirmed_separate';

/** GET /api/wizmatch/companies/duplicates?resolution=pending — tenant-scoped list, side-by-side shape. */
export async function listDuplicates(tenantId: string, resolution?: 'pending' | 'merged' | 'confirmed_separate') {
  const conditions = [eq(wizmatchCompanyDuplicates.tenantId, tenantId)];
  if (resolution) conditions.push(eq(wizmatchCompanyDuplicates.resolution, resolution));

  const rows = await db
    .select()
    .from(wizmatchCompanyDuplicates)
    .where(and(...conditions))
    .orderBy(desc(wizmatchCompanyDuplicates.createdAt));

  const companyIds = Array.from(new Set(rows.flatMap((r) => [r.companyAId, r.companyBId])));
  const companies = companyIds.length
    ? await db
        .select({
          id: wizmatchCompanies.id,
          name: wizmatchCompanies.name,
          domain: wizmatchCompanies.domain,
        })
        .from(wizmatchCompanies)
        .where(eq(wizmatchCompanies.tenantId, tenantId))
    : [];
  const byId = new Map(companies.map((c) => [c.id, c] as const));

  return rows.map((r) => ({
    id: r.id,
    similarity: r.similarity,
    detectionRule: r.detectionRule,
    resolution: r.resolution,
    resolvedBy: r.resolvedBy,
    resolvedAt: r.resolvedAt,
    createdAt: r.createdAt,
    companyA: byId.get(r.companyAId) ?? { id: r.companyAId, name: null, domain: null },
    companyB: byId.get(r.companyBId) ?? { id: r.companyBId, name: null, domain: null },
  }));
}

export interface ResolveDuplicateInput {
  resolution: DuplicateResolution;
  reasonCode: string;
  evidence?: string;
}

/**
 * POST /api/wizmatch/companies/duplicates/:id/resolve — team_lead+ (PRD-005 §4).
 * Idempotent: resolving an already-resolved pair is refused rather than
 * silently re-resolved, so `resolvedBy`/`resolvedAt` always name the actual
 * decision-maker.
 */
/**
 * H-14 fix: `reasonCode`/`evidence` were validated for shape and then
 * discarded — the UI demands a mandatory justification for lifting L5
 * containment on two companies and the write threw it away, with no audit
 * or event row at all. `wizmatch_company_duplicates` has no `reason_code`/
 * `evidence` columns (schema/migration changes are out of scope here), so
 * both are persisted the same way `assignAccountOwner` persists its change:
 * a `wizmatch_staffing_events` row (so it shows on the company timeline)
 * AND an `audit_events` row via the shared `auditLogger`. The read-then-write
 * is also now a single transaction with a `resolution = 'pending'` predicate
 * on the `UPDATE` itself (not only checked in a prior `SELECT`), closing the
 * race where two reviewers resolving the same pair concurrently could both
 * "succeed" — the same defect class as PR 3's `suppress()` fix.
 */
export async function resolveDuplicate(
  actor: PolicyActor,
  duplicateId: string,
  params: ResolveDuplicateInput,
): Promise<typeof wizmatchCompanyDuplicates.$inferSelect> {
  if (params.resolution !== 'merged' && params.resolution !== 'confirmed_separate') {
    throw new DuplicateValidationError("resolution must be 'merged' or 'confirmed_separate'.", 'invalid_resolution');
  }
  if (!params.reasonCode?.trim()) {
    throw new DuplicateValidationError('reasonCode is required to resolve a duplicate.', 'reason_code_required');
  }
  // PR 8A hardening — same fail-closed taxonomy check as the policy write
  // chokepoint (policyService.ts): a duplicate resolution is a permanent,
  // evidence-required decision, so it gets no less scrutiny than a policy row.
  if (!getReasonCodeMeta(params.reasonCode)) {
    throw new DuplicateValidationError(
      `Unknown reasonCode '${params.reasonCode}'. It is not in the ratified §9 taxonomy.`,
      'unknown_reason_code',
    );
  }

  const updated = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(wizmatchCompanyDuplicates)
      .where(and(eq(wizmatchCompanyDuplicates.tenantId, actor.tenantId), eq(wizmatchCompanyDuplicates.id, duplicateId)));
    const row = rows[0];
    if (!row) {
      throw new DuplicateValidationError('Duplicate record not found.', 'not_found');
    }
    if (row.resolution !== 'pending') {
      throw new DuplicateValidationError(`Already resolved as '${row.resolution}'.`, 'already_resolved');
    }

    const [result] = await tx
      .update(wizmatchCompanyDuplicates)
      .set({
        resolution: params.resolution,
        resolvedBy: actor.userId,
        resolvedAt: new Date(),
      })
      .where(
        and(
          eq(wizmatchCompanyDuplicates.tenantId, actor.tenantId),
          eq(wizmatchCompanyDuplicates.id, duplicateId),
          eq(wizmatchCompanyDuplicates.resolution, 'pending'),
        ),
      )
      .returning();
    if (!result) {
      // Lost the race between the SELECT above and this UPDATE.
      throw new DuplicateValidationError('Already resolved by another reviewer.', 'already_resolved');
    }

    await tx.insert(wizmatchStaffingEvents).values({
      tenantId: actor.tenantId,
      actorUserId: actor.userId,
      eventType: 'company_duplicate_resolved',
      companyId: row.companyAId,
      payload: {
        duplicateId,
        companyAId: row.companyAId,
        companyBId: row.companyBId,
        resolution: params.resolution,
        reasonCode: params.reasonCode,
        evidence: params.evidence ?? null,
      },
    });

    return result;
  });

  await auditLog({
    tenantId: actor.tenantId,
    userId: actor.userId,
    action: 'wizmatch_company_duplicate_resolved',
    entityType: 'wizmatch_company_duplicate',
    entityId: duplicateId,
    oldValues: { resolution: 'pending' },
    newValues: {
      resolution: updated.resolution,
      reasonCode: params.reasonCode,
      evidence: params.evidence ?? null,
    },
  });

  return updated;
}
