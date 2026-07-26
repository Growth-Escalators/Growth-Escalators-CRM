import { describe, it, expect } from 'vitest';
import { buildScopeKey, normaliseScopeRefLabel } from '../modules/outreach/scopeKey';

describe('buildScopeKey', () => {
  it('returns the literal entire_company key', () => {
    expect(buildScopeKey('entire_company')).toBe('entire_company');
  });

  it('normalises a region label', () => {
    expect(buildScopeKey('region', 'India')).toBe('region:india');
  });

  it('collapses internal whitespace to a single hyphen for label scopes', () => {
    expect(buildScopeKey('business_unit', 'Cloud Ops')).toBe('business_unit:cloud-ops');
  });

  it('"Cloud Ops" and "cloud-ops" normalise to the identical key by construction (resolves review H-5)', () => {
    // A second write with the differently-formatted label is a rejected
    // duplicate at the database CHECK/unique-index layer, not a silent
    // shadow of the first — because both produce this same scope_key.
    expect(buildScopeKey('business_unit', 'Cloud Ops')).toBe(buildScopeKey('business_unit', 'cloud-ops'));
  });

  it('two distinct business units produce distinct scope keys', () => {
    expect(buildScopeKey('business_unit', 'cloud')).not.toBe(buildScopeKey('business_unit', 'data'));
  });

  it('lowercases a specific_signal UUID ref', () => {
    const upper = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE';
    expect(buildScopeKey('specific_signal', upper)).toBe(
      `specific_signal:${upper.toLowerCase()}`,
    );
  });

  it('rejects a non-UUID ref for specific_signal', () => {
    expect(() => buildScopeKey('specific_signal', 'not-a-uuid')).toThrow();
  });

  it('rejects an empty ref for a label scope', () => {
    expect(() => buildScopeKey('region', '  ')).toThrow();
  });
});

describe('normaliseScopeRefLabel', () => {
  it('matches buildScopeKey label normalisation exactly', () => {
    const label = 'Cloud   Ops';
    expect(`business_unit:${normaliseScopeRefLabel(label)}`).toBe(buildScopeKey('business_unit', label));
  });
});
