// PRD-005 §8.1.1 — where region, business unit and location come from, and
// what it means for a scope to be "applicable" to a request context.
//
// Fail closed on unresolvable applicability (resolves review H-4): if an
// active policy row exists at a scope type the request context cannot
// resolve, the resolver must never silently treat the row as inapplicable —
// that is precisely how a `location:bengaluru` pause could silently do
// nothing. The caller (policyResolver) checks this before walking the ladder.

import { isIndiaLocation, isConfidentUsLocation } from '../../config/constants';
import type { OutreachGateContext } from './policyTypes';
import { normaliseScopeRefLabel } from './scopeKey';

/** region: derived from an explicit ctx.region, else from ctx.location via the existing India/US heuristics. Undefined = unresolved. */
export function resolveRegionLabel(ctx: OutreachGateContext): 'india' | 'us' | undefined {
  if (ctx.region === 'india' || ctx.region === 'us') return ctx.region;
  if (ctx.location) {
    if (isIndiaLocation(ctx.location)) return 'india';
    if (isConfidentUsLocation(ctx.location)) return 'us';
  }
  return undefined;
}

/** location: only resolvable when the context carries a signal/requirement location. */
export function resolveLocationLabel(ctx: OutreachGateContext): string | undefined {
  if (!ctx.location) return undefined;
  return normaliseScopeRefLabel(ctx.location);
}

/**
 * business_unit: has no automatic derivation in v1 (PRD-005 §8.1.1) — only
 * resolvable when explicitly supplied by the caller (policy API, batch API,
 * or workbench action).
 */
export function resolveBusinessUnitLabel(ctx: OutreachGateContext): string | undefined {
  if (!ctx.businessUnit) return undefined;
  return normaliseScopeRefLabel(ctx.businessUnit);
}
