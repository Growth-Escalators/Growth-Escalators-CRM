// PRD-005 §8.1 (Phase 0) — scoped-policy inheritance. Builds the effective
// policy for a company by walking the scope ladder
// specific_signal|specific_requirement -> location -> business_unit -> region
// -> entire_company, resolving each of the three dimensions independently
// and taking the first non-null value. "Most specific wins" is a Phase-0
// rule only (ADR-006 D-4) — Phase 1 (src/modules/outreach/outreachGate.ts)
// applies the enforcement gates to this composite.

import { and, eq, isNull } from 'drizzle-orm';
import { db, wizmatchCompanyPolicies } from '../../db';
import { buildScopeKey } from './scopeKey';
import { resolveBusinessUnitLabel, resolveLocationLabel, resolveRegionLabel } from './scopeApplicability';
import type {
  BlockClass,
  EffectiveDimension,
  EvidenceKind,
  ExternalHiringPolicy,
  OutreachEligibility,
  OutreachGateContext,
  RelationshipType,
  ScopeType,
} from './policyTypes';

export interface PolicyRow {
  id: string;
  companyId: string;
  scopeType: ScopeType;
  scopeKey: string;
  outreachEligibility: OutreachEligibility | null;
  externalHiringPolicy: ExternalHiringPolicy | null;
  relationshipType: RelationshipType | null;
  reasonCode: string | null;
  blockClass: BlockClass;
  isNonOverridable: boolean;
  isPermanent: boolean;
  evidenceKind: EvidenceKind | null;
  evidenceText: string | null;
  evidenceUrl: string | null;
  evidenceRef: string | null;
  source: string;
  actorUserId: string | null;
}

export interface EffectivePolicy {
  rootRow: PolicyRow | null;
  /** Active rows applicable to this request context, in narrow-to-broad order. */
  applicableRows: PolicyRow[];
  /** All active rows for the company, regardless of applicability (needed for L1/L1c non-overridable scans). */
  allActiveRows: PolicyRow[];
  outreachEligibility: EffectiveDimension<OutreachEligibility> | null;
  externalHiringPolicy: EffectiveDimension<ExternalHiringPolicy> | null;
  relationshipType: EffectiveDimension<RelationshipType> | null;
  /** Non-null when an active row exists at a scope type the context cannot resolve (H-4). */
  unresolvableScopeType: 'region' | 'business_unit' | 'location' | null;
}

async function fetchActivePolicyRows(tenantId: string, companyId: string): Promise<PolicyRow[]> {
  const rows = await db
    .select()
    .from(wizmatchCompanyPolicies)
    .where(
      and(
        eq(wizmatchCompanyPolicies.tenantId, tenantId),
        eq(wizmatchCompanyPolicies.companyId, companyId),
        isNull(wizmatchCompanyPolicies.supersededAt),
      ),
    );

  return rows.map((r) => ({
    id: r.id,
    companyId: r.companyId,
    scopeType: r.scopeType as ScopeType,
    scopeKey: r.scopeKey,
    outreachEligibility: r.outreachEligibility as OutreachEligibility | null,
    externalHiringPolicy: r.externalHiringPolicy as ExternalHiringPolicy | null,
    relationshipType: r.relationshipType as RelationshipType | null,
    reasonCode: r.reasonCode,
    blockClass: r.blockClass as BlockClass,
    isNonOverridable: r.isNonOverridable,
    isPermanent: r.isPermanent,
    evidenceKind: r.evidenceKind as EvidenceKind | null,
    evidenceText: r.evidenceText,
    evidenceUrl: r.evidenceUrl,
    evidenceRef: r.evidenceRef,
    source: r.source,
    actorUserId: r.actorUserId,
  }));
}

/** Builds the narrow-to-broad candidate scope-key list for a request context. Does not check DB. */
export function buildCandidateScopeKeys(ctx: OutreachGateContext): {
  candidates: string[];
  unresolvableScopeType: 'region' | 'business_unit' | 'location' | null;
} {
  const candidates: string[] = [];

  if (ctx.signalId) candidates.push(buildScopeKey('specific_signal', ctx.signalId));
  if (ctx.requirementId) candidates.push(buildScopeKey('specific_requirement', ctx.requirementId));

  const location = resolveLocationLabel(ctx);
  if (location) candidates.push(buildScopeKey('location', location));

  const businessUnit = resolveBusinessUnitLabel(ctx);
  if (businessUnit) candidates.push(buildScopeKey('business_unit', businessUnit));

  const region = resolveRegionLabel(ctx);
  if (region) candidates.push(buildScopeKey('region', region));

  candidates.push('entire_company');

  return { candidates, unresolvableScopeType: null };
}

/**
 * §8.1.1 fail-closed check: an active row exists at a scope type the context
 * cannot resolve a label for. Checked independent of whether that row's
 * specific label would have matched, because unresolvability means we
 * cannot tell.
 */
function findUnresolvableScopeType(
  ctx: OutreachGateContext,
  allActiveRows: PolicyRow[],
): 'region' | 'business_unit' | 'location' | null {
  const hasRegionRow = allActiveRows.some((r) => r.scopeType === 'region');
  const hasBuRow = allActiveRows.some((r) => r.scopeType === 'business_unit');
  const hasLocationRow = allActiveRows.some((r) => r.scopeType === 'location');

  if (hasLocationRow && resolveLocationLabel(ctx) === undefined) return 'location';
  if (hasBuRow && resolveBusinessUnitLabel(ctx) === undefined) return 'business_unit';
  if (hasRegionRow && resolveRegionLabel(ctx) === undefined) return 'region';
  return null;
}

function resolveDimension<K extends 'outreachEligibility' | 'externalHiringPolicy' | 'relationshipType'>(
  dimension: K,
  candidates: string[],
  rowsByScopeKey: Map<string, PolicyRow>,
): EffectiveDimension<any> | null {
  for (const scopeKey of candidates) {
    const row = rowsByScopeKey.get(scopeKey);
    if (row && row[dimension] != null) {
      return { value: row[dimension] as any, scopeKey, policyId: row.id };
    }
  }
  return null;
}

export async function resolveEffectivePolicy(
  tenantId: string,
  companyId: string,
  ctx: OutreachGateContext,
): Promise<EffectivePolicy> {
  const allActiveRows = await fetchActivePolicyRows(tenantId, companyId);
  const rootRow = allActiveRows.find((r) => r.scopeType === 'entire_company') ?? null;

  const unresolvableScopeType = findUnresolvableScopeType(ctx, allActiveRows);

  const { candidates } = buildCandidateScopeKeys(ctx);
  const rowsByScopeKey = new Map(allActiveRows.map((r) => [r.scopeKey, r] as const));
  const applicableRows = candidates
    .map((k) => rowsByScopeKey.get(k))
    .filter((r): r is PolicyRow => r != null);

  if (!rootRow) {
    return {
      rootRow: null,
      applicableRows,
      allActiveRows,
      outreachEligibility: null,
      externalHiringPolicy: null,
      relationshipType: null,
      unresolvableScopeType,
    };
  }

  return {
    rootRow,
    applicableRows,
    allActiveRows,
    outreachEligibility: resolveDimension('outreachEligibility', candidates, rowsByScopeKey),
    externalHiringPolicy: resolveDimension('externalHiringPolicy', candidates, rowsByScopeKey),
    relationshipType: resolveDimension('relationshipType', candidates, rowsByScopeKey),
    unresolvableScopeType,
  };
}
