// 2026-08-01 — `src/config/wizmatchPolicyEnums.ts` is the single runtime source
// for the policy dropdown vocabularies, imported by BOTH the backend
// (`src/modules/outreach/policyService.ts`) and the admin SPA
// (`WizmatchCompaniesPage.jsx`, `CompanyPolicySection.jsx`).
//
// The four arrays were previously byte-identical copies in the two JSX files,
// where a drift showed up as `unknown_reason_code`-style per-company failures
// AFTER an operator had already selected 200 companies for a bulk write.
//
// This is the second module to cross the backend/frontend boundary; the first,
// `wizmatchReasonCodes.ts`, has the same guard for the same reason. The coupling
// is only safe while the module stays PURE DATA. The day someone adds
// `import { db } from '../db'` here, the admin bundle either fails to build or
// ships broken — and the cause would be a long way from the symptom.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ELIGIBILITY_OPTIONS,
  HIRING_POLICY_OPTIONS,
  RELATIONSHIP_OPTIONS,
  EVIDENCE_KIND_OPTIONS,
  UI_SCOPE_TYPE_OPTIONS,
  REGION_SCOPE_LABELS,
} from '../config/wizmatchPolicyEnums';

const SOURCE = join(__dirname, '..', 'config', 'wizmatchPolicyEnums.ts');
const source = readFileSync(SOURCE, 'utf8');

const bare = source
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  })
  .join('\n');

describe('wizmatchPolicyEnums stays importable from the browser bundle', () => {
  it('has no imports at all', () => {
    expect(bare).not.toMatch(/^\s*import\s/m);
    expect(bare).not.toMatch(/\brequire\s*\(/);
  });

  it('touches no Node-only runtime', () => {
    for (const forbidden of ['process.env', 'node:', '__dirname', 'readFileSync', 'fetch(']) {
      expect(bare, `${forbidden} makes this unusable in the admin bundle`).not.toContain(forbidden);
    }
  });

  it('both admin files import from it rather than redeclaring the arrays', () => {
    const admin = join(__dirname, '..', '..', 'admin', 'src');
    for (const rel of [['pages', 'WizmatchCompaniesPage.jsx'], ['components', 'wizmatch', 'CompanyPolicySection.jsx']]) {
      const src = readFileSync(join(admin, ...rel), 'utf8');
      expect(src, `${rel.join('/')} does not import the shared enums`)
        .toMatch(/from\s+'[^']*config\/wizmatchPolicyEnums/);
      // The copies must be GONE, not merely shadowed by an import.
      expect(src, `${rel.join('/')} still declares its own ELIGIBILITY_OPTIONS`)
        .not.toMatch(/const ELIGIBILITY_OPTIONS\s*=/);
      expect(src).not.toMatch(/const HIRING_POLICY_OPTIONS\s*=/);
      expect(src).not.toMatch(/const RELATIONSHIP_OPTIONS\s*=/);
    }
  });
});

describe('the vocabularies agree with what the server will accept', () => {
  it('every list is non-empty and free of duplicates', () => {
    for (const [name, list] of Object.entries({
      ELIGIBILITY_OPTIONS, HIRING_POLICY_OPTIONS, RELATIONSHIP_OPTIONS,
      EVIDENCE_KIND_OPTIONS, UI_SCOPE_TYPE_OPTIONS, REGION_SCOPE_LABELS,
    })) {
      expect(list.length, `${name} is empty`).toBeGreaterThan(0);
      expect(new Set(list).size, `${name} has duplicates`).toBe(list.length);
    }
  });

  it('REGION_SCOPE_LABELS matches the DB CHECK exactly', () => {
    // migration 0037: CHECK (scope_type <> 'region' OR scope_ref_label IN ('india','us'))
    // A label outside this set is a constraint violation for EVERY company in a
    // bulk write, which is why the dialog offers a select rather than free text.
    const migrations = readFileSync(
      join(__dirname, '..', 'db', 'migrations', '0037_unknown_siren.sql'), 'utf8',
    );
    const m = migrations.match(/scope_type <> 'region' OR scope_ref_label IN \(([^)]+)\)/);
    expect(m, 'region label CHECK not found in 0037').toBeTruthy();
    const allowed = m![1].split(',').map((s) => s.trim().replace(/'/g, ''));
    expect([...REGION_SCOPE_LABELS].sort()).toEqual(allowed.sort());
  });

  it('policyService derives its validation lists from this module', () => {
    // Otherwise the browser could offer a value the server rejects — the exact
    // drift this extraction removes.
    const svc = readFileSync(join(__dirname, '..', 'modules', 'outreach', 'policyService.ts'), 'utf8');
    expect(svc).toMatch(/from\s+'[^']*config\/wizmatchPolicyEnums/);
    expect(svc).toMatch(/ELIGIBILITY_OPTIONS/);
  });

  it('UI_SCOPE_TYPE_OPTIONS is a SUBSET of the canonical scope types, not a rival list', () => {
    // It deliberately omits specific_signal/specific_requirement, which need a
    // per-row id and cannot be offered in a bulk dialog. The canonical 6-member
    // vocabulary lives in policyTypes.ts and is held in set-equality with the
    // migration by wizmatchPolicyScopeTypeParity.test.ts — do NOT "fix" this to six.
    const types = readFileSync(join(__dirname, '..', 'modules', 'outreach', 'policyTypes.ts'), 'utf8');
    const m = types.match(/SCOPE_TYPES\s*=\s*\[([\s\S]*?)\]/);
    expect(m, 'SCOPE_TYPES not found in policyTypes.ts').toBeTruthy();
    const canonical = (m![1].match(/'([a-z_]+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
    for (const opt of UI_SCOPE_TYPE_OPTIONS) {
      expect(canonical, `${opt} is not a real scope type`).toContain(opt);
    }
    expect(UI_SCOPE_TYPE_OPTIONS.length).toBeLessThan(canonical.length);
  });
});
