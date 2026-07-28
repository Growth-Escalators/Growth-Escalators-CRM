// PRD-005 §10.1, ADR-006 D-2 — canonical scope-key construction.
// buildScopeKey() is the ONLY producer of scope_key (PRD-005 §22.2 criterion 17).
// Lowercased, trimmed, internal whitespace collapsed to '-'. The CHECK
// constraints in src/db/schema.ts (wizmatch_company_policies) tie scope_key
// to this exact normalisation, so a row written any other way is rejected by
// the database, not just by this function.

import type { ScopeType } from './policyTypes';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normaliseLabel(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-');
}

export function buildScopeKey(scopeType: 'entire_company'): 'entire_company';
export function buildScopeKey(scopeType: 'region' | 'business_unit' | 'location', ref: string): string;
export function buildScopeKey(scopeType: 'specific_signal' | 'specific_requirement', ref: string): string;
export function buildScopeKey(scopeType: ScopeType, ref?: string): string {
  if (scopeType === 'entire_company') {
    return 'entire_company';
  }
  if (ref == null || ref.trim() === '') {
    throw new Error(`buildScopeKey: scopeType '${scopeType}' requires a non-empty ref`);
  }
  if (scopeType === 'specific_signal' || scopeType === 'specific_requirement') {
    const trimmed = ref.trim().toLowerCase();
    if (!UUID_RE.test(trimmed)) {
      throw new Error(`buildScopeKey: '${scopeType}' ref must be a UUID, got '${ref}'`);
    }
    return `${scopeType}:${trimmed}`;
  }
  // region | business_unit | location — normalised label
  return `${scopeType}:${normaliseLabel(ref)}`;
}

/** Normalises a region/BU/location label the same way buildScopeKey does, for CHECK-agreement writes. */
export function normaliseScopeRefLabel(raw: string): string {
  return normaliseLabel(raw);
}
