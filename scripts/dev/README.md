# Local stack — from clean checkout to a logged-in app

A disposable local environment with synthetic data, so write-based testing
(clicking every button, creating and deleting records) never touches production.

Everything here is verified against a real run on macOS with Homebrew
PostgreSQL 16 on 2026-08-02, not written from the docs.

---

## Why this exists

The standing safety rule on this repo is that **all write-based testing runs
against a disposable local environment with synthetic data; production is
read-only unless explicitly approved.** Without a local stack there is nowhere
safe to click a Delete button, so the audit is blocked. This directory removes
that block.

---

## Prerequisites

- Node 20 (`.nvmrc` pins it)
- PostgreSQL running on `localhost:5432`
- `npm install` already run in the repo root and in `admin/`

Check Postgres is up:

```bash
psql -h localhost -p 5432 -d postgres -c 'select version();'
```

---

## Bring the stack up

```bash
# 1. Create a disposable database. Nothing in this repo is allowed to write
#    anywhere else — the seed script enforces it.
createdb ge_local_dev

# 2. Create your .env from the safe local template, then edit it.
cp scripts/dev/env.local.example .env
```

Edit `.env` and set three things:

| Variable | What to put |
|---|---|
| `DATABASE_URL` | `postgresql://$(whoami)@localhost:5432/ge_local_dev` — run `whoami` and paste the result |
| `JWT_SECRET` | `openssl rand -hex 32` — throwaway, local only |
| `SOCIAL_ENCRYPTION_KEY` | `openssl rand -hex 32` — throwaway, local only |

Leave `WIZMATCH_TENANT_ID` as the placeholder for now; step 3 prints the value.

```bash
# 3. Apply migrations, then seed. `dev:setup` runs both.
npm run dev:setup

#    ...or run them separately:
#    npm run db:migrate
#    npm run dev:seed
```

`npm run dev:seed` prints the login credentials and the WizMatch tenant UUID.
Paste that UUID into `WIZMATCH_TENANT_ID` in `.env`.

```bash
# 4. Start the API (terminal 1)
npm run dev

# 5. Start the admin SPA (terminal 2)
npm run admin:dev
```

Open **http://localhost:5174** and sign in.

| Tenant | Email | Password |
|---|---|---|
| Growth Escalators | `test-admin-one@example.invalid` | `LocalDevOnly-2026!` |
| Wizmatch | `test-admin-two@example.invalid` | `LocalDevOnly-2026!` |

Both users are `admin` role. The login page has a tenant picker — the two valid
slugs are `growth-escalators` and `wizmatch` (`src/routes/auth.ts:29-34`).

---

## Ports

| Process | Port | Notes |
|---|---|---|
| API (`npm run dev`) | **3000** | `PORT` in `.env`. |
| Admin SPA (`npm run admin:dev`) | **5174** | Hardcoded in `admin/vite.config.js:15`, not a fallback. |

5174 is the **configured** port, not a collision fallback — `admin/vite.config.js`
sets `server.port: 5174` explicitly. If something else already holds 5174, Vite
will step to 5175 and print the port it actually chose; read the Vite banner
rather than assuming.

The admin SPA needs **no** `VITE_*` environment variables. `admin/vite.config.js`
proxies `/api` and `/auth` to `http://localhost:3000`, so if you change `PORT`
you must change that proxy target too.

---

## Two things that surprised us — read these

### 1. `npm run dev` does NOT run migrations

`src/index.ts:12` says migrations run via `dist/scripts/migrate.js`, which is
Railway's `startCommand`. The dev process skips it entirely. **You must run
`npm run db:migrate` by hand**, or the API boots against an empty database and
every page 500s.

### 2. Some columns only exist after the API has booted once

A freshly migrated database is *not* the full schema. `src/index.ts:719-737`
runs `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` at boot for:

- `deals.source`, `deals.probability`
- `pipelines.stage_config`
- the whole `deal_activities` table

plus roughly twenty `ensure*` service hooks that create their own tables
(`short_links`, `finance_*`, `tasks` v1 columns, SEO tables, and more). None of
those are in `src/db/migrations/`.

`scripts/dev/seed-local.ts` deliberately avoids every boot-created column so it
works immediately after `db:migrate`. If you write your own SQL against a fresh
local DB and hit `column "source" of relation "deals" does not exist`, this is
why — boot the API once and it resolves itself.

---

## What the seed creates

All synthetic. Every email address is on `@example.invalid`, a reserved TLD that
can never resolve. Every person and company name is invented. No production row
is copied.

**Both tenants** (`growth-escalators`, `wizmatch`) and one `admin` user each.
Only `wizmatch` is created by migration `0022`; `growth-escalators` is not, so
the seed creates it.

**Growth CRM slice** — 1 pipeline (`Local Sales`, 5 stages), 3 contacts with
email + phone channels, 3 deals across stages, 1 task list, 3 tasks.

**WizMatch slice**
- 4 companies, **3 of them ATS-ready** with `ats_type` / `ats_slug` /
  `ats_board_url` all populated (greenhouse, lever, ashby — the only three the
  app treats as valid), and a 4th with none so empty states render.
- 5 company policies — 4 root (`entire_company`) covering
  eligible / needs_review / blocked, plus 1 scoped `region:us` override in
  `paused` state with a `review_date`.
- 3 hiring contacts (contact + channels + `wizmatch_company_contacts` join +
  a role row each: talent_acquisition, hiring_manager, vendor_manager).
- 5 job signals spanning `new` → `scored` → `enriched` → `matched` →
  `replied_positive`, so every status filter has a row.
- 4 requirements at stages `draft` / `qualifying` / `sourcing` / `submitted`.
- 4 candidates with skills, visa status, rates, and availability across
  `available` / `submitted` / `interviewing` / `benched`.
- 3 submissions (`draft`, `submitted`, `interviewing`) and 1 `started` placement.

**Boot-backfill claims** — see the safety section below.

The seed is **idempotent**: every row has a fixed UUID and upserts, so re-running
converges rather than duplicating. `wizmatch_company_policies` is insert-only
(`ON CONFLICT DO NOTHING`) because it carries a `BEFORE UPDATE` trigger that
raises on any update outside `superseded_at` / `superseded_by_policy_id`.

---

## Safety

### The guard

`scripts/dev/seed-local.ts` refuses to run unless `DATABASE_URL` **parses** to a
host of `localhost`, `127.0.0.1`, or `::1`, and exits 1 with a clear message
otherwise. It checks the parsed URL host, not a substring, so a production
connection string that merely contains the word "localhost" in its password or
query string is still rejected. Verified against a Railway-style URL, a URL with
`localhost` as the password, and an unset value.

### Boot-time outbound calls that `DISABLE_BACKGROUND_JOBS` does not cover

`src/index.ts:864-906` schedules three one-time jobs on `setTimeout` that run
**regardless** of `DISABLE_BACKGROUND_JOBS`:

| Job | Delay | Outbound effect |
|---|---|---|
| `initial-pagespeed-check` | 10s | Unauthenticated request to `googleapis.com/pagespeedonline`. **No env var can disable it** — there is no API key to withhold. |
| `initial-programmatic-seo-pages` | 15s | Publishes real WordPress drafts *if* `WP_AGEDDENTISTRY_*` credentials are set. Inert when unset. |
| `comprehensive-purchase-backfill` | 20s | Database-only. |

Each is guarded by `claimBootBackfill` (`src/services/bootBackfillGuard.ts`),
which writes a row into `boot_backfills_completed` and skips if it already
exists. **The seed pre-claims all three**, so a local boot after seeding makes no
outbound call at all. This is the only way to close that gap — do not remove
those inserts.

### Tearing down and starting over

```bash
dropdb ge_local_dev && createdb ge_local_dev && npm run dev:setup
```

To reset only the seeded data without re-migrating, drop and recreate — the seed
upserts rather than deletes, so it will not clean up rows you created by hand in
the UI.

Stop the processes with `Ctrl-C` in each terminal. The API installs a graceful
shutdown handler that waits up to 10 seconds for in-flight requests
(`src/index.ts:935-970`), so it is not instant.

`.env` is gitignored. `scripts/dev/env.local.example` contains placeholders only
and is safe to commit.

---

## Verified working

Run on 2026-08-02 against `ge_local_dev`:

- `npx drizzle-kit migrate` — all 39 migrations applied
- `npm run dev:seed` — succeeds, and a second run is a clean no-op
- `GET /health` — `{"status":"healthy", ... "database":{"status":"ok"}}`
- `POST /auth/login` with the seeded Wizmatch admin — returns a valid JWT
- Boot log confirms `[boot] DISABLE_BACKGROUND_JOBS=true — background jobs skipped`

One harmless line appears on every local boot and is not an error:

```
[intelligence] ACTION NEEDED: railway variables set ANTHROPIC_API_KEY=... --service web
```

That is `claudeService` reporting a missing key. Leaving it unset is correct
locally — it makes the AI paths throw on use rather than spend.
