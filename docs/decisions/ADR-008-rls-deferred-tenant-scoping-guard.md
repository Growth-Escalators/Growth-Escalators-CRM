# ADR-008: Defer Postgres Row-Level Security — lint/CI check is the tenant-isolation guard

- **Status:** Decided
- **Date:** 2026-08-04
- **Context:** white-label SaaS reselling effort (Phase 1 hardening — see `docs/decisions` sibling
  work and `.ai/HANDOFF_LOG.md` around 2026-08-03/04)

## Context

A security audit during the reselling-as-SaaS effort found this codebase's tenant isolation is
enforced entirely at the application layer — every route filters by `req.user.tenantId` — with no
database-level backstop. That bug class (a dropped `tenant_id` predicate) has recurred multiple
times across this project's history (see `.ai/HANDOFF_LOG.md`), and each occurrence was a real,
exploitable cross-tenant IDOR. Phase 0 of the reselling effort fixed several live instances
(PRs #109–#111, #116).

Postgres Row-Level Security (RLS) was considered as defense-in-depth: a database-level guard that
holds even when application code forgets the predicate. Two things had to be confirmed before RLS
could be evaluated as viable at all — RLS is bypassed unconditionally by a superuser connection,
and independently bypassed by the table owner (unless `FORCE ROW LEVEL SECURITY` is set).

**Confirmed 2026-08-04, via direct query against production** (run by the repo owner through
Railway's query console, since this is a live-prod read the agent tooling wasn't authorized to run
itself):

```sql
SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user;
-- rolname: postgres | rolsuper: true | rolbypassrls: true

SELECT tableowner FROM pg_tables WHERE tablename = 'contacts';
-- tableowner: postgres
```

The app's `DATABASE_URL` connects as `postgres` — Railway's default template role for its
`postgres-ssl` image — which is **both a superuser and the owner of every table**. Enabling RLS
today would be a complete no-op: the connection that runs every query is exempt from RLS twice
over, independently. Worse than doing nothing, since it would read as "protected" in any future
audit while providing zero actual protection.

Separately, this repo's architecture doesn't have a natural place to hook RLS in even if the role
were fixed: no per-request transaction wrapper exists (1,345 direct query call sites, 28 using
explicit transactions), and `SET LOCAL` — the standard mechanism for scoping RLS policies per
request — is transaction-scoped, so it wouldn't reliably hold across a request's several
independent queries without a broader refactor of the calling convention.

## Decision

**Defer RLS.** Rely on the static lint/CI check shipped in PR #114
(`scripts/lint-tenant-scoping.ts`, wired into `.github/workflows/ci.yml`) as the primary structural
guard against this bug class recurring. It directly targets the actual failure mode (a query
missing a `tenant_id`/`tenantId` predicate), needs no infrastructure change, and is already proven:
it caught 4 live gaps in `contacts.ts` during Phase 1 that the original Phase 0 audit missed
(PR #116), and independently rediscovered a `brandHealthService.ts` cross-tenant bug PR #111 had
already flagged as deferred.

RLS is not rejected outright — it's gated on real prerequisites, tracked here so this isn't
re-litigated from scratch later:

1. **Provision a genuinely non-superuser, non-table-owning application role.** This is real
   infrastructure work (new role, precise `GRANT`s per table/operation, careful cutover of
   `DATABASE_URL`) — not a config flag.
2. **Decide the request-scoping mechanism** for `SET LOCAL app.tenant_id`: either wrap every
   request in an explicit transaction (a real behavioral change to the current calling convention),
   or use session-level `SET` with rigorous connection-pool release hooks (risk: an improperly
   reset pooled connection leaking tenant context into the next request — a new bug class, not a
   fix for the old one, if done carelessly).
3. **Audit and fix `tenant_id` coverage on the `ensure*()`-created tables** (the ~41 tables outside
   Drizzle's migration system) — several are already known to have inconsistent coverage
   (`docs/ensure-table-inventory.md`), and RLS can't apply to a table without the column.

## Consequences

- No database-level backstop exists yet for tenant isolation; the lint/CI check plus code review
  are the only guards. This is materially weaker than RLS, but the alternative (RLS on top of a
  bypassing superuser role) is *false* protection, not weaker protection.
- Reintroducing this decision later requires items 1–3 above, roughly in that order — item 1
  (role provisioning) is the actual precondition; items 2–3 can be scoped in parallel once it's
  done.
- The lint/CI check's own limitation: it's a static heuristic (86 pre-existing baselined findings
  as of 2026-08-04, tracked in `scripts/tenant-scoping-baseline.json`) — it reduces but does not
  eliminate the risk of a missed predicate slipping through review.
