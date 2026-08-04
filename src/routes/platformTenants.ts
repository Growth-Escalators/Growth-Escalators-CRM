import { Router, type Request, type Response } from 'express';
import { requirePlatformSuperadmin } from '../middleware/rbac';
import {
  provisionResellerTenant,
  validateTenantSlug,
  isValidEmail,
  loginUrlForSlug,
} from '../services/tenantProvisioning';

const router = Router();

// Every route on this router is platform-superadmin only. `requirePlatformSuperadmin`
// (src/middleware/rbac.ts) shipped as unused scaffolding in the Phase-1
// hardening pass ("nothing in this codebase wires it into a route yet") — this
// is the first live route to do so, for exactly the "legitimate GE-staff
// cross-tenant support access" case its own doc comment anticipated:
// onboarding a new reseller-pilot tenant from the admin panel instead of a
// terminal. Mounted here (router-level) rather than only at the index.ts
// app.use() site so the gate travels with the router and is exercised by the
// same request-chain test harness this repo's other route tests use (see
// src/__tests__/tenantBranding.test.ts) — a test can walk this router's own
// stack and prove a non-superadmin gets 403 without needing index.ts wired up.
router.use(requirePlatformSuperadmin);

// ---------------------------------------------------------------------------
// POST /api/platform/tenants — provision a new reseller-pilot tenant.
//
// Exposes the exact same, already-reviewed logic
// `npm run onboarding:provision-reseller-tenant` runs from a terminal
// (scripts/onboarding/provisionResellerTenant.ts / src/services/
// tenantProvisioning.ts's provisionResellerTenant()) as an HTTP route, so a
// platform superadmin can onboard a reseller agency from the admin frontend
// instead. No new tenant/user-creation logic lives here — this route is
// input validation + response shaping around the shared service function.
//
// Idempotent, same as the CLI: re-posting the same slug reuses the existing
// tenant/owner/pipeline rows (alreadyExisted: true, temporaryPassword: null)
// instead of erroring or duplicating anything.
//
// Body: { name, slug, ownerEmail, ownerName }
// Response: the created/reused tenant + owner + pipeline, the ready-to-share
// login URL, and — ONLY when a new owner user was actually created — the
// one-time temporary password. That password is never logged: every error
// path below returns a message derived from a thrown Error, never the
// request body or the provisioning result, so it cannot end up in a log line
// by accident (see CLAUDE.md's credential-hygiene rule and the CLI script's
// own console output, which is the only other place this value is ever
// printed, deliberately once, for manual secure handoff).
// ---------------------------------------------------------------------------
router.post('/', async (req: Request, res: Response) => {
  const { name: rawName, slug: rawSlug, ownerEmail: rawOwnerEmail, ownerName: rawOwnerName } = req.body as {
    name?: string;
    slug?: string;
    ownerEmail?: string;
    ownerName?: string;
  };

  const name = rawName?.trim();
  if (!name) {
    res.status(400).json({ error: 'tenant name is required' });
    return;
  }

  const slug = rawSlug?.trim();
  if (!slug) {
    res.status(400).json({ error: 'tenant slug is required' });
    return;
  }
  try {
    validateTenantSlug(slug);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'invalid tenant slug' });
    return;
  }

  const ownerEmail = rawOwnerEmail?.trim().toLowerCase();
  if (!ownerEmail || !isValidEmail(ownerEmail)) {
    res.status(400).json({ error: 'a valid owner email is required' });
    return;
  }

  const ownerName = rawOwnerName?.trim() || 'Owner';

  try {
    const result = await provisionResellerTenant({ name, slug, ownerEmail, ownerName });
    res.json({
      ok: true,
      tenant: result.tenant,
      owner: result.owner,
      pipeline: result.pipeline,
      loginUrl: loginUrlForSlug(result.tenant.slug),
      temporaryPassword: result.temporaryPassword,
      note: result.temporaryPassword
        ? 'Share this password securely with the tenant owner. It is shown ONCE and is not stored or logged anywhere in plaintext beyond this response — the owner can change it any time via "Forgot password" on the login page.'
        : 'This tenant/owner already existed — reused the existing rows. No new password was minted.',
    });
  } catch (e: unknown) {
    // provisionResellerTenant() only reaches here on a genuine unexpected
    // failure (DB error, etc) — the "tenant/owner/pipeline already exists"
    // case is handled internally (idempotent reuse, no throw), same as the
    // CLI script, so it never lands in this catch.
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed to provision tenant' });
  }
});

export default router;
