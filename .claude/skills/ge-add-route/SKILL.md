---
name: ge-add-route
description: Use when adding a new HTTP endpoint to the Express API — new resource, new admin action, new internal webhook, new analytics endpoint. Triggers include "add an endpoint to do X", "I need /api/Y for the admin panel", "expose Z as an API", "wire up GET /foo". Skips: edge functions in client/api/ (those are Vercel, separate skill ge-cashfree-edge / Vercel patterns), CRM admin SPA changes that don't need a new backend route, n8n workflows.
---

# Adding an Express route

The codebase splits cleanly: services own logic + DB access, routes are thin handlers. Tests live at the service layer because routes are mostly plumbing. Skip this split and you'll write logic that can't be tested.

Reference: [`docs/CONVENTIONS.md`](../../../docs/CONVENTIONS.md) "Code organisation" + [`docs/SECURITY.md`](../../../docs/SECURITY.md) for auth/RBAC.

## Steps

1. **Write the service first.** Add a function (or new file) in `src/services/`. The service owns DB calls, third-party calls, business rules. It accepts `tenantId` as the first arg — never reach into Express request objects from a service.

   Example signature:
   ```ts
   export async function archiveDeal(tenantId: string, dealId: string): Promise<Deal> { ... }
   ```

2. **Write a vitest test** in `src/__tests__/<feature>.test.ts`. Mock the DB if needed, but prefer hitting a real test DB if the existing test file does. Cover the happy path + at least one error case (not found, wrong tenant). Existing examples: `src/__tests__/cashfreeWebhook.test.ts`, `src/__tests__/idempotency.test.ts`.

3. **Add the route handler in `src/routes/<resource>.ts`.** Keep it thin: extract `tenantId` from `req.user!.tenantId`, validate input, call the service, return JSON. No business logic.

   ```ts
   router.post('/:id/archive', async (req, res) => {
     try {
       const tenantId = req.user!.tenantId;
       const result = await archiveDeal(tenantId, req.params.id);
       res.json(result);
     } catch (e) {
       logger.error({ err: e }, '[deals] archive failed');
       res.status(500).json({ error: (e as Error).message });
     }
   });
   ```

   Use the Pino `logger` from `src/utils/logger`, not `console.log` (worker boot is the only `console.log` exception — see [`docs/CONVENTIONS.md`](../../../docs/CONVENTIONS.md) Logging).

4. **Mount it in `src/index.ts`.** Match the prefix convention — every CRM-internal endpoint sits under `/api/`. Wrap with `requireAuth` (and `requireRole(...)` if admin-only):

   ```ts
   app.use('/api/deals', requireAuth, dealsRouter);
   ```

   Public webhooks (Cashfree, etc.) skip `requireAuth` and use signature verification instead. Internal cron-triggered endpoints use `X-Internal-Secret` header — see how `outreachLeads.ts` `/funnel` does it.

5. **Tenant-scope every query.** Every `WHERE` clause must include `tenantId`, including indirect joins. Forgetting is a cross-tenant data leak. Pattern: `and(eq(table.tenantId, tenantId), eq(table.id, id))` for single-row lookups too.

6. **Don't `SELECT c.email` or `c.phone` from `contacts`.** Those columns live on `contact_channels` — see [`docs/DATABASE.md`](../../../docs/DATABASE.md). If your route returns email/phone alongside contact data, use a correlated subquery (the deals route has the canonical pattern after commit `36541ee`).

7. **If the route writes to contacts, follow `ge-add-contact-path`** — normalisation, `findOrCreateContact`, `lastActivityAt` bump.

8. **Update admin SPA if relevant.** New endpoints surfaced in the admin panel need a `fetch` call in `admin/src/pages/<Page>.jsx`. Run `npm run admin:build` to refresh the bundle. Railway auto-rebuilds admin on push, but local checks save the round trip.

9. **Verify before commit:** `npm run build` (must exit 0) and `npm test` (must pass). Commit style: `feat(<resource>):` or `fix(<resource>):` matching the convention in `git log`.

## Auth quick reference

| Need | Middleware |
|---|---|
| Logged-in CRM user | `requireAuth` |
| Admin only | `requireAuth, requireRole('admin')` |
| Cashfree webhook | none — signature verified inline |
| Internal cron / scripts | check `X-Internal-Secret` header against env |
| Truly public (health, stats) | none |

`req.user!.tenantId` is set by `requireAuth`. If you skip `requireAuth`, you must pass `tenantId` explicitly (resolve via `DEFAULT_TENANT_SLUG` or the request payload). See [`docs/SECURITY.md`](../../../docs/SECURITY.md).

## Common ways this goes wrong

- Wrote logic in the route handler → can't unit-test → reverts to manual QA → bug ships.
- Forgot `requireAuth` on a write endpoint → unauthenticated POST in prod.
- Forgot `tenantId` in the WHERE → tenant A reads tenant B's rows.
- Wrong mount prefix → frontend hits 404, you waste an hour grepping.
- Path migration miss: changing a mount prefix (e.g. `/contacts` → `/api/contacts`) requires grepping BOTH quoted and backtick-template-literal callers — `sed` misses the latter. See `feedback_path_migration_template_literals.md` in memory.

## Reference

- [`docs/CONVENTIONS.md`](../../../docs/CONVENTIONS.md) — service/route split, logging, multi-tenancy
- [`docs/SECURITY.md`](../../../docs/SECURITY.md) — auth + RBAC trust boundary
- [`docs/DATABASE.md`](../../../docs/DATABASE.md) — contact_channels gotcha
- Canonical examples: [src/routes/contacts.ts](../../../src/routes/contacts.ts), [src/routes/deals.ts](../../../src/routes/deals.ts), [src/services/contactService.ts](../../../src/services/contactService.ts)
- Existing tests: [src/__tests__/](../../../src/__tests__/)
