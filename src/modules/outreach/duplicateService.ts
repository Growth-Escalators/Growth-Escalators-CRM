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
import { db, wizmatchCompanies, wizmatchCompanyDuplicates } from '../../db';
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
export async function resolveDuplicate(
  actor: PolicyActor,
  duplicateId: string,
  params: ResolveDuplicateInput,
): Promise<typeof wizmatchCompanyDuplicates.$inferSelect> {
  if (params.resolution !== 'merged' && params.resolution !== 'confirmed_separate') {
    throw new DuplicateValidationError("resolution must be 'merged' or 'confirmed_separate'.", 'invalid_resolution');
  }
  const rows = await db
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

  const [updated] = await db
    .update(wizmatchCompanyDuplicates)
    .set({
      resolution: params.resolution,
      resolvedBy: actor.userId,
      resolvedAt: new Date(),
    })
    .where(and(eq(wizmatchCompanyDuplicates.tenantId, actor.tenantId), eq(wizmatchCompanyDuplicates.id, duplicateId)))
    .returning();

  return updated;
}
