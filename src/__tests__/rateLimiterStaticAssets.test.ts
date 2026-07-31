// 2026-07-31 — the general rate limiter must not count static assets.
//
// The admin SPA ships ~140 lazily loaded JS chunks, so ONE page load can issue
// well over 100 requests. With a global 100/min limiter counting every asset, a
// single refresh exhausted the budget and then 429'd the page itself. Observed
// in production HTTP logs:
//
//   GET /assets/ErrorRetry-DGnrOkaB.js  429
//   GET /wizmatch/today                 429   <- the SPA shell, blocked
//   GET /favicon.ico                    429
//   GET /api/inbox/unread-count         429
//
// The fix exempts static assets only. This test pins BOTH halves — assets
// exempt, everything else still limited — because an over-broad skip would
// quietly disable rate limiting for the API and for the scanner traffic the
// limiter is currently catching (/.env, /wp-config.php.bak).

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const source = readFileSync(join(__dirname, '..', 'index.ts'), 'utf8');

// Comments are removed LINE-WISE, not with a block-comment regex. index.ts
// contains `*/` inside string literals (cron expressions like '*/30 * * * *'),
// and a `/\*[\s\S]*?\*/` strip devours the file from the first `/*` to the next
// such string — it cut 49,520 chars down to 21,600 and made every assertion
// here fail against correct code. Dropping whole comment lines is sufficient:
// it still guarantees a commented-out line cannot satisfy an assertion.
const bare = source
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  })
  .join('\n');

/** The pattern as it actually appears in index.ts, so the test can't drift from it. */
function staticAssetPattern(): RegExp {
  const m = bare.match(/const STATIC_ASSET_PATH = (\/.+\/[gimsuy]*);/);
  expect(m, 'STATIC_ASSET_PATH was removed or renamed in index.ts').toBeTruthy();
  // eslint-disable-next-line no-eval
  return eval(m![1]) as RegExp;
}

describe('general rate limiter — static asset exemption', () => {
  it('the limiter declares a skip predicate', () => {
    expect(bare).toMatch(/skip:\s*\(req\)\s*=>\s*STATIC_ASSET_PATH\.test\(req\.path\)/);
  });

  it('is still mounted globally (the exemption must not remove protection)', () => {
    expect(bare).toMatch(/app\.use\(generalLimiter\)/);
  });

  it('keeps the stricter auth and webhook limiters', () => {
    expect(bare).toMatch(/app\.use\('\/auth',\s*authLimiter\)/);
    expect(bare).toMatch(/app\.use\('\/webhooks',\s*webhookLimiter\)/);
  });

  describe('paths that MUST be exempt (they caused the outage)', () => {
    it.each([
      '/assets/ErrorRetry-DGnrOkaB.js',
      '/assets/triangle-alert-CaZpbOuX.js',
      '/assets/index-BgvhrUCB.js',
      '/assets/index-abc123.css',
      '/favicon.ico',
      '/logo.png',
      '/fonts/inter.woff2',
      '/assets/chunk.js.map',
    ])('%s is exempt', (p) => {
      expect(staticAssetPattern().test(p)).toBe(true);
    });
  });

  describe('paths that MUST STAY limited', () => {
    it.each([
      ['/api/inbox/unread-count', 'API calls are the real abuse surface'],
      ['/api/wizmatch/today/queues', 'API'],
      ['/wizmatch/today', 'SPA document route — cheap, but not a static file'],
      ['/auth/login', 'credential stuffing'],
      ['/.env', 'scanner probe the limiter is catching today'],
      ['/wp-config.php.bak', 'scanner probe'],
      ['/staging/.env', 'scanner probe'],
      ['/.bash_profile', 'scanner probe'],
    ])('%s is NOT exempt (%s)', (p) => {
      expect(staticAssetPattern().test(p)).toBe(false);
    });
  });

  it('does not exempt a path merely because an asset extension appears mid-path', () => {
    // `/api/x.js/steal` must not slip through on a naive `.includes('.js')`.
    expect(staticAssetPattern().test('/api/x.js/steal')).toBe(false);
    expect(staticAssetPattern().test('/api/report.css.php')).toBe(false);
  });
});

// 2026-07-31 — limiter ceilings. The general limit was raised from 100 to 600
// because 100/min made the product unusable for a legitimate operator (the SPA
// issues many calls per page, and one page issued one request per row). That is
// HEADROOM while the request fan-out is removed, not a fix for it.
//
// The point of this block is that raising the GENERAL limit must never quietly
// raise the AUTH limit — /auth is the brute-force and credential-stuffing guard,
// and it is the one that actually matters for security.
describe('rate limiter ceilings', () => {
  function maxFor(varName: string): number {
    const idx = bare.indexOf(`const ${varName} = rateLimit({`);
    expect(idx, `${varName} not found in index.ts`).toBeGreaterThan(-1);
    const block = bare.slice(idx, idx + 900);
    const m = block.match(/max:\s*(\d+)/);
    expect(m, `${varName} has no max`).toBeTruthy();
    return Number(m![1]);
  }

  it('keeps the auth limiter strict — this is the brute-force guard', () => {
    // Deliberately pinned low. If someone raises this to "fix" a lockout, it
    // should require changing this test and thinking about it.
    expect(maxFor('authLimiter')).toBeLessThanOrEqual(20);
  });

  it('gives the general limiter enough headroom for a real SPA page load', () => {
    expect(maxFor('generalLimiter')).toBeGreaterThanOrEqual(300);
  });

  it('never lets the general limiter be looser than the webhook limiter by more than 4x', () => {
    // A sanity bound so "raise it until the errors stop" cannot end with an
    // effectively unlimited API.
    expect(maxFor('generalLimiter')).toBeLessThanOrEqual(maxFor('webhookLimiter') * 4);
  });

  it('keeps auth strictly stricter than general', () => {
    expect(maxFor('authLimiter')).toBeLessThan(maxFor('generalLimiter'));
  });
});
