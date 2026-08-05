import { Router, type Request, type Response } from 'express';
import { eq, desc, sql } from 'drizzle-orm';
import { requirePlatformSuperadmin } from '../middleware/rbac';
import { db, tenants, plans, subscriptions } from '../db/index';
import {
  provisionResellerTenant,
  validateTenantSlug,
  isValidEmail,
  loginUrlForSlug,
} from '../services/tenantProvisioning';
import {
  getTenantFeatures,
  setTenantFeatures,
  setTenantPlan,
  KNOWN_PLANS,
  type TenantFeatureFlags,
} from '../services/tenantFeatures';
import { logAuditEvent } from '../utils/audit';

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

// ---------------------------------------------------------------------------
// Shared enrichment helpers for the list/detail routes below — batched by
// tenant id (ANY(ARRAY[...])), same "one extra query, not N+1" convention
// contacts.ts's GET / uses for its phone/email maps.
// ---------------------------------------------------------------------------

interface TenantOwnerRef {
  id: string;
  name: string;
  email: string;
}

/**
 * "The owner" of a tenant, resolved the same way permissions.ts's own
 * owner-only routes gate on ownership: `user_permissions.is_owner = true`
 * joined to `users`. DISTINCT ON + earliest `created_at` picks a single,
 * stable row for the (should-be-rare, but not schema-enforced) case of more
 * than one owner flag on a tenant — the first/owner user, matching the
 * language tenantProvisioning.ts's ensureOwnerUser() already uses for this
 * exact row ("this IS the tenant's first/owner user").
 */
async function fetchOwnersByTenantIds(tenantIds: string[]): Promise<Record<string, TenantOwnerRef>> {
  if (tenantIds.length === 0) return {};
  const result = await db.execute(sql`
    SELECT DISTINCT ON (u.tenant_id)
      u.tenant_id::text AS tenant_id, u.id::text AS id, u.name AS name, u.email AS email
    FROM users u
    JOIN user_permissions up ON up.user_id = u.id AND up.is_owner = true
    WHERE u.tenant_id = ANY(ARRAY[${sql.join(tenantIds.map((id) => sql`${id}::uuid`), sql`, `)}])
    ORDER BY u.tenant_id, u.created_at ASC
  `);
  const map: Record<string, TenantOwnerRef> = {};
  for (const row of result.rows as Array<{ tenant_id: string; id: string; name: string; email: string }>) {
    map[row.tenant_id] = { id: row.id, name: row.name, email: row.email };
  }
  return map;
}

/**
 * Per-tenant user count. Counts ACTIVE users only (`is_active IS NULL OR
 * is_active = true`) — same predicate permissions.ts's GET /users roster uses
 * — so a suspended tenant's already-deactivated former staff don't inflate
 * the seat count a superadmin is looking at.
 */
async function fetchUserCountsByTenantIds(tenantIds: string[]): Promise<Record<string, number>> {
  if (tenantIds.length === 0) return {};
  const result = await db.execute(sql`
    SELECT tenant_id::text AS tenant_id, COUNT(*)::int AS count
    FROM users
    WHERE tenant_id = ANY(ARRAY[${sql.join(tenantIds.map((id) => sql`${id}::uuid`), sql`, `)}])
      AND (is_active IS NULL OR is_active = true)
    GROUP BY tenant_id
  `);
  const map: Record<string, number> = {};
  for (const row of result.rows as Array<{ tenant_id: string; count: number }>) {
    map[row.tenant_id] = row.count;
  }
  return map;
}

/**
 * A tenant's most recent subscription joined to its `plans` row, for the
 * detail endpoint's "plan limits" — deliberately a DIFFERENT concept from
 * `tenants.plan` (the free-text string PLAN_DEFAULTS/computeTenantFeatures
 * key off, e.g. "reseller_pilot"). `plans`/`subscriptions` are the
 * subscription-billing tables (src/db/schema.ts) with a purchased plan's
 * jsonb `limits`/`feature_entitlements` — a tenant can have `tenants.plan =
 * "reseller_pilot"` and zero rows here (most tenants today, since
 * subscription billing is newer than the tenant model). Returns null rather
 * than throwing when there is no subscription — this is informational
 * enrichment, not a hard dependency of the detail view.
 */
async function fetchLatestSubscriptionPlan(tenantId: string) {
  const [row] = await db
    .select({
      subscriptionStatus: subscriptions.status,
      renewalDate: subscriptions.renewalDate,
      paymentProvider: subscriptions.paymentProvider,
      planName: plans.name,
      planPrice: plans.price,
      planCurrency: plans.currency,
      planLimits: plans.limits,
      planFeatureEntitlements: plans.featureEntitlements,
    })
    .from(subscriptions)
    .innerJoin(plans, eq(subscriptions.planId, plans.id))
    .where(eq(subscriptions.tenantId, tenantId))
    .orderBy(desc(subscriptions.createdAt))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// GET /api/platform/tenants — list every tenant.
//
// Pagination matches the established convention (contacts.ts/deals.ts's GET
// / handlers): `limit`/`offset` query params, capped, `total` returned
// alongside the page. A flat, uncapped list would also have been fine per the
// small number of tenants expected today, but matching the existing
// convention costs nothing and this can only grow.
// ---------------------------------------------------------------------------
router.get('/', async (req: Request, res: Response) => {
  try {
    const { limit = '50', offset = '0' } = req.query as Record<string, string>;
    const lim = Math.min(parseInt(limit, 10) || 50, 200);
    const off = Math.max(parseInt(offset, 10) || 0, 0);

    const [rows, countResult] = await Promise.all([
      db
        .select({
          id: tenants.id,
          name: tenants.name,
          slug: tenants.slug,
          plan: tenants.plan,
          isActive: tenants.isActive,
          createdAt: tenants.createdAt,
        })
        .from(tenants)
        .orderBy(desc(tenants.createdAt))
        .limit(lim)
        .offset(off),
      db.select({ count: sql<number>`count(*)::int` }).from(tenants),
    ]);

    const total = countResult[0]?.count ?? 0;
    const tenantIds = rows.map((r) => r.id);
    const [owners, userCounts] = await Promise.all([
      fetchOwnersByTenantIds(tenantIds),
      fetchUserCountsByTenantIds(tenantIds),
    ]);

    const enriched = rows.map((r) => ({
      ...r,
      owner: owners[r.id] ?? null,
      userCount: userCounts[r.id] ?? 0,
    }));

    res.json({ tenants: enriched, total });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed to list tenants' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/platform/tenants/:tenantId — single tenant detail: the list row
// shape plus its resolved feature flags (getTenantFeatures — the same
// resolution every route gated by requireTenantFeature uses) and its most
// recent subscription's plan limits, if any.
//
// No "last login" health signal — `users` has no `lastLoginAt`-style column
// today (grepped the schema; nothing tracks this anywhere in the codebase),
// and inventing one would mean a new migration for a "maybe" in the product
// ask. Skipped rather than guessed at.
// ---------------------------------------------------------------------------
router.get('/:tenantId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.params.tenantId as string;
    const [tenant] = await db
      .select({
        id: tenants.id,
        name: tenants.name,
        slug: tenants.slug,
        plan: tenants.plan,
        isActive: tenants.isActive,
        createdAt: tenants.createdAt,
      })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);

    if (!tenant) {
      res.status(404).json({ error: 'tenant not found' });
      return;
    }

    const [owners, userCounts, features, subscriptionPlan] = await Promise.all([
      fetchOwnersByTenantIds([tenantId]),
      fetchUserCountsByTenantIds([tenantId]),
      getTenantFeatures(tenantId),
      fetchLatestSubscriptionPlan(tenantId),
    ]);

    res.json({
      tenant,
      owner: owners[tenantId] ?? null,
      userCount: userCounts[tenantId] ?? 0,
      features,
      subscriptionPlan,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed to load tenant' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/platform/tenants/:tenantId/status — suspend/reactivate.
//
// Writing `tenants.isActive` alone would have been a no-op: login already
// gated on it (`src/routes/auth.ts`), but nothing re-checked it for an
// already-issued token, so a suspended tenant's existing sessions kept
// working until natural JWT expiry. requireAuth (src/middleware/auth.ts) now
// re-checks `tenants.is_active` on every request through the same identity
// cache it already uses for token_version revocation — see that file's own
// comments for the full reasoning. THIS is what makes flipping the flag here
// an actual lockout rather than a database-only gesture; the two changes
// ship together for exactly that reason.
// ---------------------------------------------------------------------------
router.patch('/:tenantId/status', async (req: Request, res: Response) => {
  try {
    const tenantId = req.params.tenantId as string;
    const { isActive } = req.body as { isActive?: unknown };
    if (typeof isActive !== 'boolean') {
      res.status(400).json({ error: 'isActive (boolean) is required' });
      return;
    }

    const [existing] = await db
      .select({ id: tenants.id, name: tenants.name, isActive: tenants.isActive })
      .from(tenants)
      .where(eq(tenants.id, tenantId))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: 'tenant not found' });
      return;
    }

    await db.update(tenants).set({ isActive }).where(eq(tenants.id, tenantId));

    await logAuditEvent(
      req.user!.id,
      tenantId,
      isActive ? 'platform_superadmin.tenant_reactivated' : 'platform_superadmin.tenant_suspended',
      'tenant',
      tenantId,
      { tenantName: existing.name, previousIsActive: existing.isActive, nextIsActive: isActive },
      req,
    );

    res.json({ ok: true, tenant: { id: existing.id, name: existing.name, isActive } });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed to update tenant status' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/platform/tenants/:tenantId/features — wraps setTenantFeatures()
// (src/services/tenantFeatures.ts) as-is; no new gating logic lives here.
// Body: any subset of { wizmatch, seo, crmAutomation, gstBilling, d2c }
// booleans — matches setTenantFeatures()'s own `Partial<TenantFeatureFlags>`
// signature, merged onto the tenant's existing settings.features.
// ---------------------------------------------------------------------------
const FEATURE_KEYS: Array<keyof TenantFeatureFlags> = ['wizmatch', 'seo', 'crmAutomation', 'gstBilling', 'd2c'];

router.patch('/:tenantId/features', async (req: Request, res: Response) => {
  try {
    const tenantId = req.params.tenantId as string;
    const body = (req.body ?? {}) as Record<string, unknown>;

    const patch: Partial<TenantFeatureFlags> = {};
    for (const key of FEATURE_KEYS) {
      if (key in body) {
        if (typeof body[key] !== 'boolean') {
          res.status(400).json({ error: `${key} must be a boolean` });
          return;
        }
        patch[key] = body[key] as boolean;
      }
    }
    if (Object.keys(patch).length === 0) {
      res.status(400).json({ error: 'at least one feature flag must be provided' });
      return;
    }

    const [existing] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!existing) {
      res.status(404).json({ error: 'tenant not found' });
      return;
    }

    await setTenantFeatures(tenantId, patch);
    const features = await getTenantFeatures(tenantId);

    await logAuditEvent(req.user!.id, tenantId, 'platform_superadmin.tenant_features_changed', 'tenant', tenantId, { patch }, req);

    res.json({ ok: true, features });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed to update tenant features' });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/platform/tenants/:tenantId/plan — changes tenants.plan AND
// resets settings.features to the new plan's defaults via setTenantPlan()
// (src/services/tenantFeatures.ts) — see that function's doc comment for why
// a reset, not a no-op merge, is the correct side effect here.
// ---------------------------------------------------------------------------
router.patch('/:tenantId/plan', async (req: Request, res: Response) => {
  try {
    const tenantId = req.params.tenantId as string;
    const { plan } = req.body as { plan?: unknown };
    if (typeof plan !== 'string' || !plan) {
      res.status(400).json({ error: 'plan is required' });
      return;
    }
    if (!KNOWN_PLANS.includes(plan)) {
      res.status(400).json({ error: `unknown plan "${plan}" — must be one of: ${KNOWN_PLANS.join(', ')}` });
      return;
    }

    const [existing] = await db.select({ id: tenants.id, plan: tenants.plan }).from(tenants).where(eq(tenants.id, tenantId)).limit(1);
    if (!existing) {
      res.status(404).json({ error: 'tenant not found' });
      return;
    }

    await setTenantPlan(tenantId, plan);
    const features = await getTenantFeatures(tenantId);

    await logAuditEvent(
      req.user!.id, tenantId, 'platform_superadmin.tenant_plan_changed', 'tenant', tenantId,
      { previousPlan: existing.plan, nextPlan: plan }, req,
    );

    res.json({ ok: true, plan, features });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'failed to update tenant plan' });
  }
});

export default router;
