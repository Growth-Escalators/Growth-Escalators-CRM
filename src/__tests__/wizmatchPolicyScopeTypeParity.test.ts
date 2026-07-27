// D-R2 (owner-ratified, code review revoking PR 8B CODE_READY) — parity guard
// between the database-layer CHECK constraint and the TypeScript-layer
// SCOPE_TYPES source of truth.
//
// migration 0037's `wizmatch_company_policies_scope_type_chk` CHECK is
// hand-authored SQL, not generated from `SCOPE_TYPES` — there is no build
// step that keeps them in sync. This test is that sync check, run at test
// time instead: it reads the raw SQL, regex-extracts the CHECK's `IN (...)`
// value list, and asserts it is set-equal to the imported `SCOPE_TYPES`
// array from `policyTypes.ts`. Either side drifting — a value added to one
// but not the other, a typo, a value removed from one but not the other —
// must fail this test.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SCOPE_TYPES } from '../modules/outreach/policyTypes';

const MIGRATION_PATH = join(__dirname, '../db/migrations/0037_unknown_siren.sql');

/** Regex-extracts the exact value list inside `wizmatch_company_policies_scope_type_chk`'s CHECK (...). */
function extractScopeTypeCheckValues(sql: string): string[] {
  const match = sql.match(
    /CONSTRAINT "wizmatch_company_policies_scope_type_chk" CHECK \(scope_type IN \(([^)]+)\)\)/,
  );
  if (!match) {
    throw new Error('wizmatch_company_policies_scope_type_chk CHECK not found in 0037_unknown_siren.sql');
  }
  return match[1]
    .split(',')
    .map((raw) => raw.trim())
    .map((raw) => {
      const unquoted = raw.match(/^'(.*)'$/);
      if (!unquoted) throw new Error(`Unexpected value token in scope_type CHECK: '${raw}'`);
      return unquoted[1];
    });
}

describe('migration 0037 scope_type CHECK <-> SCOPE_TYPES parity', () => {
  it('the CHECK constraint value list is set-equal to policyTypes.ts SCOPE_TYPES', () => {
    const sql = readFileSync(MIGRATION_PATH, 'utf8');
    const checkValues = extractScopeTypeCheckValues(sql);

    expect(new Set(checkValues)).toEqual(new Set(SCOPE_TYPES));
    // Also catch a duplicate entry on either side, which set-equality alone
    // would silently hide (two equal sets can still have different lengths
    // if one side has a repeated value).
    expect(checkValues).toHaveLength(SCOPE_TYPES.length);
  });

  // CONTROL — proves the extractor itself is not vacuously matching
  // everything: an intentionally wrong fixture must be rejected.
  it('the extractor correctly rejects a mismatched fixture (mutation-proof for this guard itself)', () => {
    const fixtureWithExtraValue = `
      CONSTRAINT "wizmatch_company_policies_scope_type_chk" CHECK (scope_type IN ('entire_company','region','business_unit','location','specific_signal','specific_requirement','bogus_scope')),
    `;
    const values = extractScopeTypeCheckValues(fixtureWithExtraValue);
    expect(new Set(values)).not.toEqual(new Set(SCOPE_TYPES));

    const fixtureMissingValue = `
      CONSTRAINT "wizmatch_company_policies_scope_type_chk" CHECK (scope_type IN ('entire_company','region','business_unit','location','specific_signal')),
    `;
    const missingValues = extractScopeTypeCheckValues(fixtureMissingValue);
    expect(new Set(missingValues)).not.toEqual(new Set(SCOPE_TYPES));
  });

  it('throws when the CHECK constraint is absent entirely, rather than silently passing', () => {
    expect(() => extractScopeTypeCheckValues('-- no such constraint here')).toThrow();
  });
});
