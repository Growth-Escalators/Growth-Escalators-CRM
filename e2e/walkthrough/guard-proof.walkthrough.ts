// Proves the read-only guard actually blocks, against a LOCAL target.
//
// This exists because "the guard works" must be demonstrated, not assumed —
// and demonstrating it on production is precisely what the guard exists to
// prevent. Deliberately attempts writes that the real walkthrough never would.
import { test, expect } from '@playwright/test';
import { ReadOnlyGuard, FORBIDDEN_CONTROL } from './readonly-guard';

test('the guard blocks every non-GET and records it', async ({ page, context, baseURL }) => {
  // HARD LOCAL-ONLY GATE. This spec deliberately fires DELETE and discovery
  // POSTs to prove they are blocked. If the guard ever regressed, running this
  // against production would delete a real signal and call a paid provider — the
  // exact outcomes the guard exists to prevent. It must therefore be impossible
  // to point at anything but loopback, regardless of what the config allows.
  //
  // It shares the walkthrough's testMatch, so a bare run of that config would
  // otherwise pick it up alongside the real walkthrough.
  const host = new URL(baseURL!).hostname;
  if (host !== 'localhost' && host !== '127.0.0.1') {
    throw new Error(`guard-proof is local-only and refuses to run against ${host} — it attempts real writes on purpose.`);
  }

  const guard = new ReadOnlyGuard();
  await guard.install(context, new URL(baseURL!).hostname);
  guard.setStop('guard-proof');

  await page.goto('/login');

  // Fire the writes the walkthrough must never allow, straight from the page.
  const results = await page.evaluate(async () => {
    const hit = async (method: string, url: string) => {
      try {
        const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: method === 'GET' ? undefined : '{}' });
        return { url, status: r.status };
      } catch (e) { return { url, status: 'network-error' }; }
    };
    return Promise.all([
      hit('DELETE', '/api/wizmatch/signals/00000000-0000-0000-0000-000000000000'),
      hit('POST', '/api/wizmatch/companies/x/contact-intelligence/discover'),
      hit('PUT', '/api/wizmatch/placements/x'),
      hit('POST', '/api/wizmatch/telemetry/route-view'),
      hit('POST', '/auth/forgot-password'),
    ]);
  });

  // Every product write got the synthetic 405 — not a network error (which the
  // app would render as a generic outage) and not a 401 (which would wipe session).
  for (const r of results.slice(0, 3)) expect(r.status, `${r.url}`).toBe(405);
  expect(results[3].status, 'telemetry beacon should get the real 204 contract').toBe(204);
  expect(results[4].status, 'auth endpoint must be blocked').toBe(405);

  const blocked = guard.attempts.filter((a) => a.kind === 'blocked-write');
  const beacon = guard.attempts.filter((a) => a.kind === 'suppressed-telemetry');
  const alarm = guard.attempts.filter((a) => a.kind === 'auth-alarm');
  expect(blocked.length, 'three product writes recorded').toBe(3);
  expect(beacon.length, 'beacon recorded separately, not as a product write').toBe(1);
  expect(alarm.length).toBe(1);
  expect(guard.hasAuthAlarm).toBe(true);

  // No query strings leaked into the record.
  for (const a of guard.attempts) expect(a.pathname).not.toContain('?');

  // The denylist covers the money and destructive controls.
  for (const name of ['Run discovery', 'Source public candidate leads', 'Delete permanently', 'Reject', 'Generate drafts', 'Forgot password?']) {
    expect(FORBIDDEN_CONTROL.test(name), `${name} must be on the denylist`).toBe(true);
  }
});
