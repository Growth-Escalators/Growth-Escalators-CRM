// 2026-07-31 — `src/config/wizmatchReasonCodes.ts` is now imported by the ADMIN
// SPA as well as the backend:
//
//   admin/src/pages/WizmatchCompaniesPage.jsx
//     import { WIZMATCH_REASON_CODES, getReasonCodeMeta } from '../../../src/config/wizmatchReasonCodes.ts'
//
// That crosses the backend/frontend boundary deliberately. The bulk company-
// policy dialog needs the §9 reason-code taxonomy to build its picker, and the
// server rejects anything not in this list with `unknown_reason_code`. The
// alternative — hand-copying ~67 entries into the SPA — drifts silently and
// surfaces as per-company failures during a bulk write, which is strictly
// worse than the coupling.
//
// The coupling is only safe while this module stays PURE DATA. The day someone
// adds `import { db } from '../db'` or reaches for `process.env` here, the
// admin bundle either fails to build or ships a broken chunk — and the cause
// would be a long way from the symptom. This test makes that failure loud,
// early, and self-explaining instead.
//
// If you need runtime/env-dependent logic for reason codes, put it in a
// service that imports this file; do not add it here.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WIZMATCH_REASON_CODES } from '../config/wizmatchReasonCodes';

const SOURCE_PATH = join(__dirname, '..', 'config', 'wizmatchReasonCodes.ts');
const source = readFileSync(SOURCE_PATH, 'utf8');

const codeLines = source
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  })
  .join('\n');

describe('wizmatchReasonCodes stays importable from the admin SPA', () => {
  it('has no imports at all — it must not pull in anything Node-only', () => {
    expect(codeLines).not.toMatch(/^\s*import\s/m);
    expect(codeLines).not.toMatch(/\brequire\s*\(/);
  });

  it('touches no runtime environment (no process/env, fs, db, network)', () => {
    for (const forbidden of ['process.env', 'process.', 'node:', '__dirname', 'readFileSync', 'fetch(']) {
      expect(codeLines, `${forbidden} makes this module unusable in the browser bundle`)
        .not.toContain(forbidden);
    }
  });

  it('exports a non-empty frozen-in-practice array the picker can render', () => {
    expect(Array.isArray(WIZMATCH_REASON_CODES)).toBe(true);
    expect(WIZMATCH_REASON_CODES.length).toBeGreaterThan(0);
  });

  it('every entry has the fields the admin picker groups and labels by', () => {
    for (const entry of WIZMATCH_REASON_CODES) {
      expect(typeof entry.code, `code missing on ${JSON.stringify(entry)}`).toBe('string');
      expect(entry.code.length).toBeGreaterThan(0);
    }
  });

  it('reason codes are unique — a duplicate would render two identical picker rows', () => {
    const codes = WIZMATCH_REASON_CODES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('the admin page still imports it (delete this test if that import goes away)', () => {
    const page = readFileSync(
      join(__dirname, '..', '..', 'admin', 'src', 'pages', 'WizmatchCompaniesPage.jsx'),
      'utf8',
    );
    expect(page).toMatch(/from\s+'[^']*config\/wizmatchReasonCodes/);
  });
});
