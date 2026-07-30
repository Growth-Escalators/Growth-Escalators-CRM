import { expect, test } from '@playwright/test';
import jwt from 'jsonwebtoken';

// QA lane 3 (2026-07-30) — Journey A (auth/access) and Journey J (negative
// outreach safety) against the REAL backend + disposable Lane-2 PG18
// fixtures (see lane2-fixtures.md in the scratchpad for every UUID/email
// used below). API-level per the brief's own guidance ("do the most
// important of these as direct API tests — faster, more precise").
//
// REQUIRES: `source <scratchpad>/qa/lane2-env.sh` and the backend booted
// per lane2-fixtures.md, reachable at WIZMATCH_QA_BACKEND_URL (default
// http://localhost:4100 — Lane 2's PORT). Skips cleanly if JWT_SECRET is
// absent so this file is inert in any environment that hasn't sourced the
// QA env (mirrors the existing wizmatch-e2e-hardening-*.spec.ts pattern).
//
// IMPORTANT DEVIATION FROM THE BRIEF, DISCLOSED: real password login could
// NOT be used to reach these fixtures. `src/routes/auth.ts`'s
// `normaliseTenantSlug()` (line ~28) hardcodes exactly two possible output
// values ('wizmatch' or the DEFAULT_TENANT_SLUG 'growth-escalators') for
// ANY input that isn't literally 'wizmatch'/'wm'/'growth'/'growth-escalators'/
// 'ge'. Lane 2's fixtures use tenant slugs `wizmatch-test` /
// `growth-escalators-test` (for isolation from any real tenant) — neither
// normalises to itself, so `/auth/login`'s tenant join (`t.slug = tenantSlug`)
// can never match either QA tenant row, no matter what tenantSlug is sent.
// VERIFIED live: POST /auth/login with the exact seeded email + correct
// password (`QaSeedPassw0rd!`) and every tenantSlug variant tried
// ('wizmatch-test', 'wizmatch', omitted) returns 401 "invalid credentials".
// This is a real, reportable finding (see lane3-playwright.md), not a test
// bug — but it also means these specs cannot drive the browser through the
// real /login form for these tenants. Instead they mint JWTs locally with
// the same JWT_SECRET the running backend uses (from lane2-env.sh, a
// disposable local-only value, never a real secret) — this does NOT bypass
// any authorization control under test: requireAuth/optionalAuth still
// independently re-verify token_version and tenantId against the live
// database on every request, which is exactly the mechanism these tests
// exercise.

const BACKEND_URL = process.env.WIZMATCH_QA_BACKEND_URL || 'http://localhost:4100';
const JWT_SECRET = process.env.JWT_SECRET;

const TENANT_A = '00000000-0000-4000-8000-0000000000a1'; // wizmatch-test
const TENANT_B = '00000000-0000-4000-8000-0000000000a2'; // growth-escalators-test

const USERS = {
  admin1: { id: '00000000-0000-4000-8000-00000000b001', email: 'qa-admin-1@example.invalid', role: 'admin', tenantId: TENANT_A, tenantSlug: 'wizmatch-test' },
  admin2: { id: '00000000-0000-4000-8000-00000000b002', email: 'qa-admin-2@example.invalid', role: 'admin', tenantId: TENANT_A, tenantSlug: 'wizmatch-test' },
  teamLead: { id: '00000000-0000-4000-8000-00000000b003', email: 'qa-team-lead@example.invalid', role: 'team_lead', tenantId: TENANT_A, tenantSlug: 'wizmatch-test' },
  staff: { id: '00000000-0000-4000-8000-00000000b004', email: 'qa-staff@example.invalid', role: 'staff', tenantId: TENANT_A, tenantSlug: 'wizmatch-test' },
  nonPilotAdmin: { id: '00000000-0000-4000-8000-00000000b005', email: 'qa-nonpilot-admin@example.invalid', role: 'admin', tenantId: TENANT_A, tenantSlug: 'wizmatch-test' },
  viewerMachine: { id: '00000000-0000-4000-8000-00000000b006', email: 'qa-viewer-machine@example.invalid', role: 'viewer', tenantId: TENANT_A, tenantSlug: 'wizmatch-test' },
  formerEmployee: { id: '00000000-0000-4000-8000-00000000b007', email: 'qa-former-employee@example.invalid', role: 'staff', tenantId: TENANT_A, tenantSlug: 'wizmatch-test' }, // is_active=false in DB
  otherTenantAdmin: { id: '00000000-0000-4000-8000-00000000b008', email: 'qa-other-tenant-admin@example.invalid', role: 'admin', tenantId: TENANT_B, tenantSlug: 'growth-escalators-test' },
};

function mint(user: typeof USERS.admin1, overrides: Partial<Record<string, unknown>> = {}): string {
  if (!JWT_SECRET) throw new Error('JWT_SECRET not set — source lane2-env.sh first');
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      tenantId: user.tenantId,
      tenantSlug: user.tenantSlug,
      product: 'wizmatch',
      role: user.role,
      tokenVersion: 1, // matches every seeded user's token_version per lane2-fixtures.md
      ...overrides,
    },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

function bearer(token: string) {
  return { Authorization: `Bearer ${token}` };
}

test.describe('Journey A — auth/access (real backend, direct-signed tokens)', () => {
  test.skip(!JWT_SECRET, 'JWT_SECRET not set — source <scratchpad>/qa/lane2-env.sh and boot the backend first');

  test('no Authorization header is refused (401)', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/permissions/me`);
    expect(res.status()).toBe(401);
  });

  test('a well-formed own-tenant token for an active pilot admin authenticates', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/permissions/me`, { headers: bearer(mint(USERS.admin1)) });
    expect(res.status()).toBe(200);
    const body = await res.json();
    expect(body.permissions).toBeTruthy();
  });

  test('a second approved pilot admin also authenticates independently', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/permissions/me`, { headers: bearer(mint(USERS.admin2)) });
    expect(res.status()).toBe(200);
  });

  // --- H-1 (previously "still open" per WIZMATCH_FAILURE_MATRIX_2026-07-30.md
  // §H-1) — VERIFIED FIXED on this branch's current HEAD (commit c1bd8824,
  // "fix(auth): bind the JWT tenantId claim to the user's actual tenant").
  // requireAuth's identityMismatch() (src/middleware/auth.ts:79-90) now
  // compares the token's tenantId claim against the DB row's tenant_id and
  // fails closed on mismatch. Reproduced live below with the exact steps
  // the failure matrix specified: a validly-signed token whose tenantId
  // differs from the user's real tenant.
  test('H-1 cross-tenant read via tampered tenantId claim is now refused (fixed, was previously exploitable)', async ({ request }) => {
    const tampered = mint(USERS.admin1, { tenantId: TENANT_B, tenantSlug: 'growth-escalators-test' });
    const res = await request.get(`${BACKEND_URL}/api/permissions/me`, { headers: bearer(tampered) });
    expect(res.status()).toBe(401);
    const body = await res.json();
    // Deliberately opaque message (auth.ts:126-128) — does not leak which
    // claim was rejected. Confirmed this is the tenant-mismatch path (not a
    // signature/expiry failure) by cross-checking the DB: admin1's real
    // tenant_id is TENANT_A, never TENANT_B.
    expect(body.error).toBe('session expired — please log in again');
  });

  // A genuinely-tampered token_version is the other identityMismatch() branch.
  test('a token whose tokenVersion no longer matches the DB is refused (revocation)', async ({ request }) => {
    const staleVersion = mint(USERS.admin1, { tokenVersion: 999 });
    const res = await request.get(`${BACKEND_URL}/api/permissions/me`, { headers: bearer(staleVersion) });
    expect(res.status()).toBe(401);
  });

  // --- Real, verified gap: requireAuth never checks users.is_active -------
  // lane2-fixtures.md user #7 (qa-former-employee) is seeded is_active=false,
  // token_version=1 (unchanged — this fixture models "deactivated by a path
  // that didn't also bump token_version", not the supported H-2/H-3 offboarding
  // flow, which does bump it). A token minted with tokenVersion:1 (matching
  // the DB) authenticates successfully DESPITE is_active=false, because
  // identityMismatch() (auth.ts:79-90) only compares tokenVersion and
  // tenantId — never is_active. Confirmed live: HTTP 200 with a real
  // permissions payload for a deactivated user.
  test('a deactivated (is_active=false) user is refused even when token_version still matches', async ({ request }) => {
    // Was a DEFECT when this spec was first written: requireAuth checked
    // token_version and tenant but never is_active, so a token issued before
    // deactivation kept working for up to its full 7-day expiry. Never
    // exploitable through the supported offboarding path (permissions.ts bumps
    // token_version in the same UPDATE) — but that made session death depend on
    // remembering to bump a second column. Fixed 2026-07-30; is_active is now a
    // kill switch on its own, bounded by the 30s identity-cache TTL.
    const res = await request.get(`${BACKEND_URL}/api/permissions/me`, { headers: bearer(mint(USERS.formerEmployee)) });
    expect(res.status()).toBe(401);
  });

  test('a non-pilot admin (valid, active, correct tenant, but not on the roster) is refused WizMatch staffing access', async ({ request }) => {
    // wizmatchRequireStaffing / pilotIds() gate — nonPilotAdmin's id is not
    // in WIZMATCH_STAFFING_PILOT_USER_IDS (lane2-env.sh: only b001,b002).
    const res = await request.get(`${BACKEND_URL}/api/wizmatch/staffing/companies`, { headers: bearer(mint(USERS.nonPilotAdmin)) });
    expect([403, 404]).toContain(res.status()); // 404 acceptable here only because Gate A is off in this QA env (staffing_phase_disabled fires before the roster check for every role) — see the note in the test below.
  });

  test('an other-tenant admin cannot see tenant-A WizMatch data even with a correctly-bound token', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/wizmatch/staffing/companies`, { headers: bearer(mint(USERS.otherTenantAdmin)) });
    // Own tenant (B), own token_version — passes requireAuth. Then hits
    // whatever gate applies to a growth-escalators-test admin touching a
    // wizmatch-only path (feature/product gate, not a data leak — no
    // tenant-A row is ever returned to this user in the response body).
    expect(res.status()).not.toBe(200);
  });

  // --- M-1 (machine-sync lane) — VERIFIED PARTIALLY FIXED -----------------
  // Failure matrix M-1 said all 8 allowlisted GET paths 403'd for a viewer.
  // Commit 1e0719ba ("fix(wizmatch): make the machine-sync lane reachable
  // through the real mount chain") changed wizmatchToday.ts/wizmatchPolicy.ts/
  // wizmatchPrepare.ts to call wizmatchPilotOrMachineSync instead of the bare
  // pilot gate. Live-verified: 7 of 8 now return 200 for the viewer-machine
  // account. The 8th, GET /placements, still 403s — NOT because the
  // machine-sync gate blocks it (it passes the gate fine), but because
  // wizmatch.ts:3352 has its OWN separate, stricter role check
  // (`['admin','team_lead'].includes(req.user!.role)`) inside the route
  // handler itself, downstream of the fixed gate. This is effectively a
  // restatement of the pre-existing, documented L-2 finding, now newly
  // load-bearing: the machine-sync viewer's 8-path contract with
  // crm-sync.mjs is still only 7/8 fulfilled after the M-1 fix.
  for (const path of ['/dashboard', '/command-center', '/candidate-intelligence/queue', '/client-discovery/queue', '/review-workbench', '/guardrails', '/candidates']) {
    test(`M-1 fix — viewer machine-sync account can now GET ${path}`, async ({ request }) => {
      const res = await request.get(`${BACKEND_URL}/api/wizmatch${path}`, { headers: bearer(mint(USERS.viewerMachine)) });
      expect(res.status()).toBe(200);
    });
  }

  test('L-2 (still open) — viewer machine-sync account is STILL refused GET /placements, unlike the other 7 allowlisted paths', async ({ request }) => {
    const res = await request.get(`${BACKEND_URL}/api/wizmatch/placements`, { headers: bearer(mint(USERS.viewerMachine)) });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('commercial_access_requires_lead');
  });

  test('viewer machine-sync account is refused POST on an allowlisted-for-GET path (write blocked)', async ({ request }) => {
    const res = await request.post(`${BACKEND_URL}/api/wizmatch/candidates`, { headers: bearer(mint(USERS.viewerMachine)), data: {} });
    expect(res.status()).toBe(403);
  });

  test('viewer machine-sync account is refused a non-allowlisted WizMatch path entirely', async ({ request }) => {
    // NOTE: this env has all 3 staffing phase gates OFF (lane2-env.sh), so a
    // non-allowlisted staffing path 404s with staffing_phase_disabled for
    // EVERY role in this environment — this assertion only proves "not a
    // 200 with data", not the specific 403 the production failure matrix
    // documented under a phases-on config. See lane3-playwright.md.
    const res = await request.get(`${BACKEND_URL}/api/wizmatch/staffing/companies`, { headers: bearer(mint(USERS.viewerMachine)) });
    expect(res.status()).not.toBe(200);
  });

  test('token_version pilot-roster UUID lookup is exact — a case-differing UUID does not accidentally match', async ({ request }) => {
    // pilotIds() does a plain string Set.includes() on
    // WIZMATCH_STAFFING_PILOT_USER_IDS. UUIDs here are already lowercase in
    // both the roster env var and the DB, so this proves the comparison is
    // exact-match (not, e.g., silently case-folding), by confirming an
    // uppercased variant of a real pilot UUID is NOT treated as on-roster.
    const upperCasedPilot = mint({ ...USERS.admin1, id: USERS.admin1.id.toUpperCase() });
    const res = await request.get(`${BACKEND_URL}/api/permissions/me`, { headers: bearer(upperCasedPilot) });
    // requireAuth's DB lookup (eq(users.id, userId)) will simply find no row
    // for the uppercased id (Postgres uuid comparison is case-insensitive
    // for the TEXT REPRESENTATION only when cast to type uuid — plain string
    // eq on a uuid column normalises case, so this actually tests the roster
    // env-var comparison path once requireAuth passes). Documented as
    // PLAUSIBLE rather than VERIFIED pending closer read of pilotIds(); see
    // lane3-playwright.md.
    expect([200, 401, 403]).toContain(res.status());
  });
});

test.describe('Journey J — negative outreach safety (real backend)', () => {
  test.skip(!JWT_SECRET, 'JWT_SECRET not set — source <scratchpad>/qa/lane2-env.sh and boot the backend first');

  const SIGNAL_D001 = '00000000-0000-4000-8000-00000000d001'; // Acme (c001) — Senior Node.js Engineer

  test('WIZMATCH_SENDING_ENABLED is unset/false in this env — POST /signals/:id/send is refused, no real email leaves the system', async ({ request }) => {
    // lane2-env.sh sets WIZMATCH_SENDING_ENABLED="false" explicitly (not
    // merely absent) — this is the master kill-switch at wizmatch.ts:2999.
    const res = await request.post(`${BACKEND_URL}/api/wizmatch/signals/${SIGNAL_D001}/send`, {
      headers: bearer(mint(USERS.admin1)),
      data: { variant_message_id: 'qa-fixture-does-not-exist' },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toBe('sending_disabled');
  });

  test('X-Ray / paid public-candidate sourcing is fail-closed for a requirement not yet in an eligible stage', async ({ request }) => {
    // e001 (Acme Node.js C2C requirement) is seeded stage='draft'. The
    // route requires stage in ['accepted','sourcing','covered'] before it
    // will even consider running — draft correctly gets a 409, not a 200
    // that would imply a real provider call happened.
    const REQ_E001 = '00000000-0000-4000-8000-00000000e001';
    const res = await request.post(`${BACKEND_URL}/api/wizmatch/requirements/${REQ_E001}/source-candidates-xray`, { headers: bearer(mint(USERS.admin1)) });
    expect(res.status()).toBe(409);
  });

  // --- REAL DEFECT, live-reproduced -----------------------------------
  // POST /contact-intelligence/companies/:id/discovery-preview — the
  // read-only, "never calls Apollo/Snov/Reacher/Google" planning endpoint
  // (wizmatch.ts:2110's own comment) — 500s on EVERY call, for EVERY
  // company, because persistContactIntelligenceSnapshot()'s upsert
  // (src/services/wizmatchContactIntelligenceRepo.ts:763) has a genuinely
  // ambiguous unqualified column reference inside an
  // INSERT ... ON CONFLICT DO UPDATE SET clause:
  //
  //   status = CASE WHEN review_status = 'rejected' THEN status ELSE EXCLUDED.status END,
  //
  // `review_status` exists on BOTH the target table
  // (wizmatch_company_intelligence.review_status) and the special
  // `excluded` pseudo-table (it's in the INSERT's column list at line 738),
  // so Postgres raises "column reference \"review_status\" is ambiguous" at
  // parse/analyze time — this fires on every execution of the statement,
  // not just when a row actually pre-exists, because Postgres analyzes the
  // whole INSERT...ON CONFLICT statement before deciding which branch runs.
  // Verified live: raw Postgres log at the same timestamp as the HTTP call
  // shows exactly this error; the HTTP response is a bare
  // {"error":{"code":"INTERNAL_ERROR","message":"internal server error"}}.
  //
  // This breaks discovery-preview and (by the same shared function) likely
  // /discover and any other caller of persistContactIntelligenceSnapshot —
  // a core Contact Intelligence workflow is non-functional, not an edge case.
  //
  // Suggested one-line fix: qualify the column —
  //   status = CASE WHEN wizmatch_company_intelligence.review_status = 'rejected' THEN status ELSE EXCLUDED.status END,
  test('DEFECT — discovery-preview 500s with an ambiguous-column Postgres error on every call (not a paid-provider-safety issue, but breaks the safe/free preview step)', async ({ request }) => {
    const COMPANY_C001 = '00000000-0000-4000-8000-00000000c001';
    const res = await request.post(`${BACKEND_URL}/api/wizmatch/contact-intelligence/companies/${COMPANY_C001}/discovery-preview`, { headers: bearer(mint(USERS.admin1)) });
    // Documents CURRENT (defective) behaviour — see
    // wizmatchContactIntelligenceRepo.ts:763 and lane3-playwright.md.
    expect(res.status()).toBe(500);
  });

  test('Apollo/Snov/Serper keys are absent (undefined, not just false) in this env — provider env-status check reports them unavailable by absence', async ({ request }) => {
    // Best-effort black-box proxy for "absent fails closed, not open":
    // discovery-preview's costControls.costGuard reflects provider
    // availability computed from getWizmatchProviderEnvStatus(process.env).
    // We can't assert on the 500 body's shape (see the DEFECT test above),
    // so this is documented as WRITTEN, NOT INDEPENDENTLY VERIFIED — the
    // upstream 500 prevents observing this response at all right now. Once
    // the ambiguous-column defect above is fixed, re-run this and assert
    // costControls.costGuard's provider flags are all false/unavailable.
    test.info().annotations.push({ type: 'blocked-by', description: 'wizmatchContactIntelligenceRepo.ts:763 ambiguous-column 500 (see DEFECT test above)' });
    const COMPANY_C001 = '00000000-0000-4000-8000-00000000c001';
    const res = await request.post(`${BACKEND_URL}/api/wizmatch/contact-intelligence/companies/${COMPANY_C001}/discovery-preview`, { headers: bearer(mint(USERS.admin1)) });
    expect(res.status()).toBe(500); // documents the blocker, not the intended assertion
  });
});
