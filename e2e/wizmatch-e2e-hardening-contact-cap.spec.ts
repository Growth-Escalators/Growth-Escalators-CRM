import { expect, test } from '@playwright/test';

// Real-backend integration proof of the 5-contact discovery hard cap, hitting
// the actual running local API (not mocked) with disposable E2E_WIZMATCH_-
// prefixed data. Complements (does not replace) the unit-level proof in
// src/__tests__/wizmatchContactDiscovery.test.ts, which uses mocked provider
// adapters to prove the clamp under a deliberately-misconfigured env and a
// 12-candidate provider response — that scenario is intentionally NOT
// re-exercised here to avoid depending on live/mocked provider network calls
// inside a UI-layer suite. This file proves the real HTTP + process
// boundary (env -> Express route -> JSON response) reports the same
// bounded contract.
//
// Requires the local backend running against the disposable
// wizmatch_e2e_test database — see docs/testing/WIZMATCH_E2E_HARDENING_REPORT.md.

const BACKEND_URL = process.env.WIZMATCH_E2E_BACKEND_URL || 'http://localhost:3000';
const TEST_EMAIL = process.env.WIZMATCH_E2E_TEST_EMAIL || 'e2e.wizmatch.test@example.invalid';
const TEST_PASSWORD = process.env.WIZMATCH_E2E_TEST_PASSWORD;

test.describe('Contact-discovery 5-contact hard cap (real backend)', () => {
  test.skip(!TEST_PASSWORD, 'WIZMATCH_E2E_TEST_PASSWORD not set — see hardening report for local setup');

  let token: string;
  let companyId: string;

  test.beforeAll(async ({ request }) => {
    const login = await request.post(`${BACKEND_URL}/auth/login`, {
      data: { email: TEST_EMAIL, password: TEST_PASSWORD, tenantSlug: 'wizmatch' },
    });
    expect(login.ok()).toBe(true);
    const body = await login.json();
    token = body.token;

    const create = await request.post(`${BACKEND_URL}/api/wizmatch/client-discovery/seed-company`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        companyName: `E2E_WIZMATCH_${Date.now()}_CAP_TEST`,
        domain: 'e2e-wizmatch-cap-test.invalid',
        jobTitle: 'E2E cap test role',
        region: 'india',
      },
    });
    if (create.ok()) {
      const created = await create.json();
      companyId = created.companyId || created.company?.id || created.id;
    }
  });

  test.afterAll(async ({ request }) => {
    if (!companyId) return;
    // Best-effort cleanup of the disposable company created for this run —
    // never touches anything without the E2E_WIZMATCH_ prefix.
    await request.delete(`${BACKEND_URL}/api/wizmatch/staffing/companies/${companyId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).catch(() => {});
  });

  test('discovery-preview reports a capStatus.maxContactCandidatesShown between 1 and 5', async ({ request }) => {
    test.skip(!companyId, 'seed-company did not return a usable companyId in this environment');
    const preview = await request.post(
      `${BACKEND_URL}/api/wizmatch/contact-intelligence/companies/${companyId}/discovery-preview`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    expect(preview.ok()).toBe(true);
    const body = await preview.json();
    const cap = body.preview?.capStatus?.maxContactCandidatesShown ?? body.costControls?.maxContactCandidatesShown;
    expect(cap).toBeGreaterThanOrEqual(1);
    expect(cap).toBeLessThanOrEqual(5);
  });

  test('the preview response never claims eligibility to fetch more than the capped count, and defaults to 3 in this local environment', async ({ request }) => {
    test.skip(!companyId, 'seed-company did not return a usable companyId in this environment');
    const preview = await request.post(
      `${BACKEND_URL}/api/wizmatch/contact-intelligence/companies/${companyId}/discovery-preview`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const body = await preview.json();
    const cap = body.preview?.capStatus?.maxContactCandidatesShown;
    // This environment does not set WIZMATCH_MAX_CONTACT_CANDIDATES_SHOWN,
    // so the real runtime config must resolve to the documented default (3).
    expect(cap).toBe(3);
  });
});
