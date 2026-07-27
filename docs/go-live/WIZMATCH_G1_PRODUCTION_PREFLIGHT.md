# WizMatch G1 — production preflight (read-only)

- **Performed:** 2026-07-27, read-only production inspection only.
- **Branch under consideration:** `ge/outbound-08b-g3-pilot-completion` (PR #89, draft), CODE READY at `7a0cea20`.
- **Purpose:** establish whether migration `0037_unknown_siren.sql` may be applied to production.

> ## VERDICT: **NO-GO**
>
> Migration `0037` must **not** be applied yet. Five blockers below; three of them cannot be
> resolved from a coding session at all. **No approval token is requested.**
>
> This is a NO-GO on *evidence availability*, not on any defect found in the migration. Nothing
> here suggests `0037` is unsafe — it says the checks that would prove it safe have not been run,
> and three of them cannot be run from here.

---

## Method note

The brief specifies four parallel preflight agents. They were **not** used. The five Phase-1 review
agents all went idle without returning reports, and production database access is not something to
hand to a mechanism that has just failed silently. This preflight was performed directly by the
session lead, read-only throughout.

`mcp__railway__list_variables` was **deliberately not called.** It returns plaintext secret values
rather than presence-only, so calling it would itself be a credential exposure. Every fact below was
obtained without reading a single variable value.

---

## Production target — positively identified

| Attribute | Value |
|---|---|
| Railway project | **GE-Backend-Server** (`eef927aa-8e3a-4515-85fd-781b7d1d95c1`) |
| Environment | **production** |
| Application service | **`web`** (`0ee1b243-97c1-4239-9016-fb7e1578b3d6`) |
| Source repo | `Growth-Escalators/Growth-Escalators-CRM` — matches this repo |
| Public URL | `api.growthescalators.com` |
| Deployment trigger | auto-deploy on push to `main` |
| Database service | **NOT POSITIVELY IDENTIFIED — see Blocker 2** |

### Current deployed state

- **Deployed commit: `1e748125b41f773f46ebb8e4740383aa723eade0`** (deployment `1d0dda9d`, SUCCESS,
  2026-07-23T08:44:39Z).
- This is **exactly `origin/main` HEAD**. Production and `main` are in sync; there is **no unmerged
  drift** and no commit on `main` that production has not deployed.
- Health (`GET /health`, public, read-only): `status: healthy`, `database: ok`, `stuckJobs: 0`,
  uptime ≈ 4.1 days — consistent with the 23 Jul deploy.

### Two repo-vs-reality discrepancies, both resolved empirically

**1. Start command.** `mcp__railway__get_service_config` reports the start command as
`node dist/index.js`, while `railway.json` specifies
`node dist/scripts/migrate.js && node dist/index.js`. These imply *opposite* migration
choreography, so the question was settled from deploy logs rather than by reading config:

```
[migrate] Migrations folder: /app/src/db/migrations
[migrate] Acquiring migration lock...
[migrate] Lock acquired
[migrate] Migration complete
```

**Migrations DO run automatically at container start on every deploy.** The service-config readout is
incomplete; trust the logs. This is the single most consequential fact in this preflight — see
Blocker 5.

**2. Builder.** Service config reports `RAILPACK`; `railway.json` says `NIXPACKS`. Empirically the
build still honours the intended build phase:

```
[stage-0 9/11] RUN ... npm run admin:build && npm run build
```

and emits `dist/public/admin/assets/*`. **The admin SPA is built and shipped on deploy**, so PR 8B's
Decision Workbench UI changes will actually reach users. Risk closed.

### Topology correction — `docs/DEPLOYMENT.md` is stale

`docs/DEPLOYMENT.md` claims a `Worker process` service running `node dist/worker.js` from
`railway.worker.json`, and states "Two separate Railway services share this repo."

**Neither is true.** `railway.worker.json` does not exist in the repo, and the project's service list
contains no worker service. `AGENTS.md` explicitly warns not to take "two services" as given —
verified, and the warning was justified. Services present: `web`, `web-staging`, `Postgres`,
`Postgres-Bhky`, `Postgres-K0lx`, `Redis`, `Documenso`.

**Consequence for the pilot:** any WizMatch cron or background job assumed to run in a separate
worker is running (or not running) inside `web`. This does not block G1, but it must not be assumed
away at G3.

---

## Blockers

### Blocker 1 — no production database access (hard)

The G1 checklist's first item is a production `information_schema` drift review. It could not be
performed. From this session it is not possible to:

- confirm `0037` is genuinely unapplied (the local journal shows idx 37 as the latest *generated*
  migration; that says nothing about what any database has applied);
- diff the live schema against `0037`'s expected pre-state;
- confirm no `0038` was applied out-of-band;
- verify tables/indexes/constraints/triggers after any apply;
- confirm no unexplained drift.

The public `/health` endpoint reports DB connectivity only. `/api/wizmatch/env-check` is
presence-only, requires an authenticated session, and reports environment variables — not schema.

**No safe read-only path to the production schema exists from here.**

### Blocker 2 — the production database cannot be positively identified (hard)

Three Postgres services exist in the project: `Postgres`, `Postgres-Bhky`, `Postgres-K0lx`.
Determining which one `web` uses requires reading `DATABASE_URL`, and the only tool that does returns
plaintext secrets.

This project has a **documented history of database naming traps** — a prior cleanup found services
whose names did not indicate their owner (a `Postgres-*` instance belonging to n8n rather than the
CRM). `Documenso` in this same project has its own database.

**Applying a migration to the wrong Postgres would corrupt an unrelated product.** The brief's own
rule — never access a service other than the one positively identified — is therefore binding here:
the target is not positively identified, so nothing may be applied.

*Resolution needed:* the owner confirms which Postgres service backs `web`, by name, through the
Railway dashboard (not by pasting a connection string into this session).

### Blocker 3 — U-7 shared-index owner sign-off outstanding (hard, carried since PR 2)

`0037` adds three additive `(tenant_id, id)` unique indexes to `users`, `contacts` and
`contact_channels` — **core CRM tables shared with the Growth tenant.** The indexes cannot fail or
reject a write, but building them takes a brief write lock on another product's tables.

This has been an open owner item since PR 2 and no code change can close it.

### Blocker 4 — production-sized lock measurement never performed

Timing the index builds requires a production-sized restore. PR 2's verification ran against
disposable *local* databases, which is correctly out of scope for this measurement. No production-sized
clone is known to exist.

Measuring against live production is forbidden and is not proposed.

### Blocker 5 — G1 and G3 are coupled by the deploy, and the runbook does not say so

Because migrations run at container start (proven above), **merging the outbound stack to `main` will
automatically apply `0037`** as part of the deploy. There is no gate between "merge" and "schema
change".

The go-live runbook states: *"This runbook contains no command that applies `0037` automatically."*
That is true of the runbook and **misleading about the system.** An operator following the runbook
literally could approve G3 believing the migration is still pending, and apply it by merging.

This has a second edge. PR 3's hard prerequisite B-1 says `0037` must be applied before PR 3's code
reaches `main`, because `suppress()` writes `wizmatch_suppression_events`, a table only `0037`
creates. The automatic migrate step *satisfies* B-1 by accident of ordering — migrate runs before the
app boots. But if the migrate step were ever removed, or failed, the app would boot against a schema
missing that table and the **public `GET /api/wizmatch/unsubscribe` route would throw for real
recipients**, `POST /suppression` and `/classify-reply` would 500, and hard bounces would be silently
dropped.

*Decision required from the owner:* either
- **(a)** apply `0037` out-of-band first, via a mechanism nobody has yet specified (a one-off
  `railway run` against `web`, or `npm run db:migrate` pointed at the production database) — which
  preserves G1 and G3 as genuinely separate gates; **or**
- **(b)** accept that G1 and G3 are one combined gate, and that approving the merge *is* approving
  the migration — in which case the runbook must be corrected to say so.

This decision cannot be inferred. It is not a preference; the two paths have different rollback
shapes.

---

## What is NOT blocking

- **`NODE_ENV=production` is confirmed at runtime.** `GET /health` returns `"env":"production"`, and
  `healthRoute.ts:87` maps that field directly to `process.env.NODE_ENV`. This closes a G3 checklist
  item that PR 8A (H-4) and PR 8B both flagged as unverifiable from code — it had been an open
  assumption resting on Nixpacks build-phase behaviour. **It is now verified, not assumed.**
- **Deployed commit has zero drift from `main`**, so the merge base is clean.
- **The admin SPA ships on deploy**, so the Workbench UI will reach users.
- **PR #89 is mergeable/CLEAN** and the whole #80–#89 stack is correctly chained.

---

## Backup and rollback — partially established

- **Rollback of application code** is well understood: Railway retains prior deployments
  (`1d0dda9d` is current; earlier ones show as REMOVED), and redeploying a previous commit restores
  the old code.
- **Rollback of the schema is intentionally not a drop.** Per ADR-004, `0037`'s tables are left in
  place and never dropped; the rollback path is an application-code revert. `0037` was verified
  (PR 2) to contain zero destructive statements, guarded with `IF NOT EXISTS` / `DO $$ EXCEPTION`
  blocks, so it is re-runnable.
- **Backup state: NOT VERIFIED.** Whether Railway Postgres backups are enabled, their schedule, and
  their last successful snapshot were not confirmed — doing so requires identifying the correct
  database service first (Blocker 2). **This must be confirmed before any apply.**

---

## Migration command — deliberately not specified

No exact migration command is given here. Specifying one would require naming a database service
that is not yet positively identified (Blocker 2), and would imply the out-of-band path in Blocker 5
that the owner has not chosen.

The command will be recorded here once Blockers 2 and 5 are resolved, and not before.

---

## Readiness CLI in production-inspection mode

Run locally against the integrated tree — all 17 scenarios pass (see the PR 8B review report). It
**cannot** be run "against production" in any meaningful sense: as the runbook itself states, it only
ever sees the environment of the machine it runs on and cannot reach into Railway. Running it against
a copied production `.env` requires handling production secrets locally, which was not done and is
not recommended from an agent session.

---

## Required before G1 can be re-attempted

1. Owner confirms **which Postgres service** backs `web` (Blocker 2).
2. Owner **signs off U-7** — the three shared-table indexes on Growth-tenant tables (Blocker 3).
3. Owner decides the **migration mechanism**: out-of-band apply, or accept G1+G3 as one gate
   (Blocker 5).
4. A **production `information_schema` drift diff** is produced by someone with database access
   (Blocker 1).
5. **Backup state confirmed** — backups enabled, recent snapshot exists.
6. **Production-sized lock measurement**, or an explicit owner decision to accept the index-build
   lock without it (Blocker 4).

---

## Confirmations

- **Read-only throughout.** No migration applied, no backfill run, no variable changed, no service
  restarted or redeployed, no merge, no schema touched.
- **No secret value was read or printed.** `list_variables` was not called.
- **Only the positively-identified project was accessed** — `GE-Backend-Server` / `production` /
  `web`. `profitleak-prod` was listed but never accessed. No database was connected to.
- Migration `0037` remains **unapplied by this session**; no `0038` exists.
- Sending, automated emails, preparation, the outreach adapter and paid discovery all remain
  disabled; enforcement remains `shadow`.
