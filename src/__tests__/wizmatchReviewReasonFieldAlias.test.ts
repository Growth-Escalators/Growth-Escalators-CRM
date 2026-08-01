// 2026-08-01 — the two contact-review routes read the rejection reason from
// DIFFERENT request fields:
//
//   POST /contact-intelligence/contacts/:candidateId/review  -> req.body.rejectionReason
//   POST /contact-intelligence/contacts/bulk-review          -> req.body.reason
//
// The admin UI sent `{ action }` with no reason at all on the single-item path
// while always capturing one on the bulk path, so a single-row rejection was
// stored with no explanation and the detail pane rendered an empty
// "Rejection reason:" block. Rather than pick a winner and force a coordinated
// client+server deploy, BOTH routes now accept BOTH names.
//
// This test pins the alias on both routes. It reads the real source rather than
// booting the router (that would start a Postgres pool), which is the same
// convention used by the other route-shape tests in this suite.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '..', 'routes', 'wizmatch.ts'), 'utf8');

// Line-wise comment removal — NOT a block-comment regex. wizmatch.ts contains
// `*/` inside string literals, and a /\*[\s\S]*?\*\// strip devours the file
// from the first `/*` onwards (this suite has been bitten by that before).
const bare = source
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  })
  .join('\n');

const ALIAS = /firstString\(\s*req\.body\?\.rejectionReason\s*\?\?\s*req\.body\?\.reason\s*\)/g;
// Non-global twin: a /g regex carries lastIndex between .toMatch calls, which
// makes per-handler assertions in a loop pass or fail depending on order.
const ALIAS_SINGLE = /firstString\(\s*req\.body\?\.rejectionReason\s*\?\?\s*req\.body\?\.reason\s*\)/;

describe('both contact-review routes accept either reason field name', () => {
  it('the alias appears exactly twice — once per review route', () => {
    const matches = bare.match(ALIAS) ?? [];
    expect(matches).toHaveLength(2);
  });

  it('neither review handler reads only one of the two names', () => {
    // Scoped to the two review handlers only. Other routes (signal reject,
    // signal delete, requirement delete) legitimately read a bare
    // `req.body?.reason` and are none of this test's business — asserting
    // file-wide would fail on correct, unrelated code.
    for (const marker of [
      "router.post('/contact-intelligence/contacts/bulk-review'",
      "router.post('/contact-intelligence/contacts/:candidateId/review'",
    ]) {
      const start = bare.indexOf(marker);
      expect(start, `review handler not found: ${marker}`).toBeGreaterThan(-1);
      // Handler body up to the next route registration.
      const nextRoute = bare.indexOf('router.', start + marker.length);
      const body = bare.slice(start, nextRoute > -1 ? nextRoute : undefined);

      expect(body, `${marker} still reads only req.body.reason`)
        .not.toMatch(/firstString\(\s*req\.body\?\.reason\s*\)/);
      expect(body, `${marker} still reads only req.body.rejectionReason`)
        .not.toMatch(/firstString\(\s*req\.body\?\.rejectionReason\s*\)(?!\s*\?\?)/);
      expect(body, `${marker} is missing the alias`).toMatch(ALIAS_SINGLE);
    }
  });

  it('rejectionReason is what actually reaches the writer', () => {
    // Both routes funnel into applyContactCandidateReview({ ..., rejectionReason }),
    // which is the single place the column is written. If that name changes, the
    // alias above stops mattering and this test should be revisited.
    expect(bare).toMatch(/const \{ tenantId, userId, candidateId, action, rejectionReason \} = input;/);
  });
});

describe('the alias reads the two names in a stable order', () => {
  it('rejectionReason wins when both are present', () => {
    // `a ?? b` returns `a` unless it is null/undefined. Pinning the ORDER matters:
    // a client migrating from one name to the other may briefly send both, and
    // flipping precedence would silently change which value is stored.
    const pick = (body: Record<string, unknown>) => body?.rejectionReason ?? body?.reason;
    expect(pick({ rejectionReason: 'canonical', reason: 'legacy' })).toBe('canonical');
    expect(pick({ reason: 'legacy' })).toBe('legacy');
    expect(pick({ rejectionReason: 'canonical' })).toBe('canonical');
    expect(pick({})).toBeUndefined();
  });

  it('an empty string is still a value, not a fallthrough', () => {
    // ?? (not ||) so the bulk approve path, which deliberately sends '', does not
    // fall through to the other field.
    const pick = (body: Record<string, unknown>) => body?.rejectionReason ?? body?.reason;
    expect(pick({ rejectionReason: '', reason: 'should not win' })).toBe('');
  });
});
