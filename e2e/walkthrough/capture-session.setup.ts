// One-time session capture. The OWNER logs in by hand; this script never reads
// the credential fields and never watches the DOM for them.
//
// Deliberately NOT a reuse of e2e/auth.setup.ts, which is a live silent-pass
// hazard: it targets /crm/login (the route is /login), defaults to a different
// production host than playwright.config.ts, and wraps its whole body in
// `if (await emailInput.isVisible())` — so a selector miss saves an
// UNAUTHENTICATED state and the setup passes green. A walkthrough built on that
// would wander a logged-out app and report "every page is empty" as a product
// finding. Every assertion below exists to make that failure mode impossible.
//
// Trace, video and screenshots are OFF in playwright.session.config.ts: a trace
// serialises input values and request headers.

import { test as setup, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const STATE_PATH = process.env.WALKTHROUGH_STORAGE_STATE;
const BASE = process.env.WALKTHROUGH_BASE_URL;

setup('owner captures a session by hand', async ({ page, context }) => {
  if (!STATE_PATH) throw new Error('WALKTHROUGH_STORAGE_STATE is required');
  if (!BASE) throw new Error('WALKTHROUGH_BASE_URL is required');
  setup.setTimeout(5 * 60_000); // a human is typing

  await page.goto(`${BASE}/login`);

  // eslint-disable-next-line no-console
  console.log([
    '',
    '  ┌─ ACTION NEEDED IN THE BROWSER WINDOW ─────────────────────────┐',
    '  │ 1. Click the WIZMATCH product button FIRST.                   │',
    '  │    It sets crm_active_tenant_slug, which decides the          │',
    '  │    localStorage namespace. Skip it and the whole walkthrough  │',
    '  │    silently runs against Growth CRM instead.                  │',
    '  │ 2. Type your email and password.                              │',
    '  │ 3. Click "Sign in".                                           │',
    '  │                                                               │',
    '  │ Do NOT click "Forgot password?" — it POSTs, does not check     │',
    '  │ the response, and sends you a real email.                     │',
    '  └───────────────────────────────────────────────────────────────┘',
    '',
  ].join('\n'));

  // Wait on STATE, not on a URL. The old setup waited for **/dashboard**, and
  // /wizmatch/dashboard now redirects to /wizmatch/today — so that wait could
  // never succeed.
  await expect(async () => {
    const token = await page.evaluate(() => localStorage.getItem('wizmatch_crm_token'));
    expect(token, 'no wizmatch_crm_token yet — still waiting for sign-in').toBeTruthy();
  }).toPass({ timeout: 4 * 60_000, intervals: [1000] });

  const slug = await page.evaluate(() => localStorage.getItem('crm_active_tenant_slug'));
  expect(
    slug,
    `active tenant is "${slug}", not "wizmatch". The Wizmatch product button was not `
    + 'selected before signing in, so the session is for the wrong product. '
    + 'Nothing has been saved — sign out and re-run.',
  ).toBe('wizmatch');

  // Prove the token actually works against the API before trusting it. A token
  // that is present but rejected produces exactly the same empty screens as no
  // token at all.
  const token = await page.evaluate(() => localStorage.getItem('wizmatch_crm_token'));
  const probe = await page.request.get(`${BASE}/api/permissions/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(
    probe.status(),
    `GET /api/permissions/me returned ${probe.status()} — the captured token is not usable. Nothing saved.`,
  ).toBe(200);

  const state = await context.storageState();
  mkdirSync(dirname(STATE_PATH), { recursive: true });
  writeFileSync(STATE_PATH, JSON.stringify(state), { mode: 0o600 });

  // Never print the path's contents, and never the token. The path itself is
  // fine — the owner needs to know where to delete it from.
  // eslint-disable-next-line no-console
  console.log(`\n  ✓ session captured → ${STATE_PATH}\n    (7-day JWT, treat as a secret; deleted at teardown)\n`);
});
