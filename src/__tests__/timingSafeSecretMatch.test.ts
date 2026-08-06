// QA run 2026-07-30 — regression guard for security-lane finding A2.
//
// `requireInternalToken` compared its secret in constant time, but
// `outreachLeads.ts` and `imapReplies.ts` — which guard the SAME
// `OUTREACH_INTERNAL_SECRET` — used a plain `!==`. String `!==` short-circuits
// at the first differing byte, leaking length and prefix through timing. One of
// those endpoints also gates a Google-Places-cost-incurring path, so a recovered
// secret costs money as well as access.
//
// The comparison now lives in one shared helper. These tests pin both the
// helper's behaviour and the fact that the remaining call site uses it — the
// second half matters because the original defect was precisely three call
// sites drifting apart. Two of the three (outreachLeads.ts, imapReplies.ts)
// were removed with the Saleshandy/Google-Places outreach pipeline; the
// helper and its remaining call site in internalAuth.ts still apply to
// Wizmatch's internal-endpoint auth.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { timingSafeSecretMatch } from '../middleware/internalAuth';

describe('timingSafeSecretMatch', () => {
  it('accepts an exact match', () => {
    expect(timingSafeSecretMatch('correct-horse', 'correct-horse')).toBe(true);
  });

  it('rejects a wrong value of the same length', () => {
    expect(timingSafeSecretMatch('correct-horsX', 'correct-horse')).toBe(false);
  });

  it('rejects a correct prefix (the exact case a short-circuiting compare leaks)', () => {
    expect(timingSafeSecretMatch('correct-hors', 'correct-horse')).toBe(false);
  });

  it('rejects undefined and empty without throwing', () => {
    expect(timingSafeSecretMatch(undefined, 'x')).toBe(false);
    expect(timingSafeSecretMatch('', 'x')).toBe(false);
  });

  it('handles the string[] shape Express produces for a repeated header', () => {
    // Must not throw, and must not be satisfied by smuggling the secret into a
    // later array entry.
    expect(timingSafeSecretMatch(['correct-horse'], 'correct-horse')).toBe(true);
    expect(timingSafeSecretMatch(['wrong', 'correct-horse'], 'correct-horse')).toBe(false);
  });

  it('does not throw on a length mismatch (timingSafeEqual would)', () => {
    expect(() => timingSafeSecretMatch('a', 'much-longer-secret')).not.toThrow();
    expect(timingSafeSecretMatch('a', 'much-longer-secret')).toBe(false);
  });
});

describe('every internal-secret call site uses the constant-time helper', () => {
  const files = [
    'middleware/internalAuth.ts',
  ];

  it.each(files)('%s compares via timingSafeSecretMatch and never with !==', (rel) => {
    const source = readFileSync(join(__dirname, '..', rel), 'utf8');
    const bare = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
    expect(bare, `${rel} no longer uses the shared constant-time comparison`)
      .toMatch(/timingSafeSecretMatch\(/);
    // The original defective shape, in any spacing.
    expect(bare, `${rel} reintroduced a short-circuiting secret comparison`)
      .not.toMatch(/provided\s*!==\s*secret|secret\s*!==\s*provided/);
  });
});
