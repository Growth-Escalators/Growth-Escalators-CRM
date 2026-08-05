# Railway Backup Plan — GE-Backend-Server Production Postgres

**Status:** Investigation complete, read-only. No Railway resource was created, modified, deleted, deployed, scaled, or restarted while producing this document.
**Date:** 5 Aug 2026
**Author:** lane-backup-plan (read-only Railway investigation)

---

## 0. TL;DR — what to do first

1. Open the Railway dashboard → project **GE-Backend-Server** → service **Postgres** (production environment) → **Backups** tab. This is a read-only look — it will show whether a schedule is *actually* configured and whether PITR is on, which this investigation could **not** confirm through the CLI/API (see §3).
2. If nothing is configured (expected, per the standing "zero backups" finding from 3 Aug), turn on **Daily** backups. This does **not** require a restart (§4.1) — safe to do at any time, including during business hours.
3. Enable **PITR** in the same tab as a follow-up (§4.2) — this **does** trigger one redeploy of the Postgres service (a few seconds of unavailability). Schedule this for a low-traffic window and confirm with Jatin first.
4. Either way: come back in 24–48 hours and confirm a backup actually landed (§6). A schedule that produces nothing is the real failure mode here.

---

## 1. Findings

### 1.1 Identifying the genuine production Postgres

Confirmed via `railway project list --json` (read-only) and cross-checked against the project's service map:

| Fact | Value |
|---|---|
| Project | `GE-Backend-Server` — id `eef927aa-8e3a-4515-85fd-781b7d1d95c1` |
| Environment | `production` — id `81b087de-6c7d-493c-94f0-50c8180c47da` |
| Service | `Postgres` — id `0c31ec38-0433-46c6-9fbb-5dd2859d1a08` |
| Volume | `postgres-volume` — id `3c413aaa-49e0-4258-a308-a2cf6b2ac055`, mounted at `/var/lib/postgresql/data` |

**Evidence, not just trust:**
- The `production` environment contains exactly one service named plain `Postgres` (id above). It is running (`status: SUCCESS`, `stopped: false`, confirmed via `railway service status --all`), on a single deployment (`fb971f16-2b55-4d44-bd4a-af9fd3d7831d`) that has been live since **2026-03-17T21:33:21Z** with no redeploys since — this is the long-lived, stable production instance, not a scratch or staging resource.
- Its container image is `ghcr.io/railwayapp-templates/postgres-ssl:18` — a **major-version-only tag**, consistent with the earlier identification of the server as Postgres 18.x (prior session's `server_version 18.3` claim). I did not re-verify the exact minor version by connecting to the database (that would need a live DB credential, and the task explicitly bars pulling secrets — see §3).

**How the others were ruled out**, all present in the same project:
- **`Postgres-Bhky`** (id `a78f7108-45b1-46c8-bd8e-682edae2ff1f`) is deployed to the **`staging`** environment, not `production` — it is `web-staging`'s database. Confirmed by environment membership in `railway project list --json`. This matches the standing note that Postgres-Bhky is staging's real DB and must never be treated as disposable; I did not touch it.
- **`Postgres-K0lx`** (id `d9f7c3a7-a7f9-4016-8767-dc9636d3ed7e`) *is* deployed to `production`, alongside the CRM's `Postgres` — but it backs the separate `Documenso` service in the same project (both `Postgres-K0lx` and `Documenso` show up together, and `Documenso` is a distinct e-signature app, not the CRM). Its volume is `postgres-volume-rY9N` (5000 MB quota, 234 MB used) — a different volume from the CRM's `postgres-volume`. This matches the standing note that Postgres-K0lx is Documenso's, not the CRM's.
- A fifth volume, `postgres-vfmc-volume` (438 MB used, `serviceName: null` — orphaned, no service attached), is the previously-identified n8n leftover volume pending Jatin's manual deletion. It is unrelated to this task; I did not touch it.

### 1.2 Current backup state — **could not be fully verified via API; needs a dashboard look**

This is the most important caveat in this report, so it's stated plainly: **I could not read the actual backup/PITR configuration through either the Railway MCP tools or the Railway GraphQL API**, despite the same authenticated session working normally for every other read (projects, services, deployments, volumes, environment status).

What I tried and what happened:
- The Railway MCP tools (`mcp__railway__*`) were not authenticated in this session (`whoami` / `list_projects` returned "Unauthorized. Please run `railway login` again.") — I did not attempt to log in, since that's a session/auth action, not a data mutation, but I also didn't want to burn a login flow mid-investigation; I fell back to the already-authenticated Railway CLI instead.
- Via the CLI's stored OAuth token (used read-only, over GraphQL, exactly the way `railway`'s own subcommands do internally — I did not print the token anywhere), I could confirm the GraphQL schema **does** expose exactly the read queries you'd want:
  - `volumeInstance(id: ...)`
  - `volumeInstanceBackupList(volumeInstanceId: ...)`
  - `volumeInstanceBackupScheduleList(volumeInstanceId: ...)`

  All three returned **`"Not Authorized"`** (an authorization-layer rejection, not "not found" or a validation error) when queried against the CRM Postgres volume instance (`3c413aaa-...`), while ordinary queries against the same project/environment/service (`project(id)`, `environment(id)`, `service(id)`, deployment history) succeeded normally with the same token.
- I checked whether this was a plan-tier gate: the workspace (`jatin-ge's Projects`, id `6a4dd5f3-b3f6-4b45-84c3-76295cb6af83`) is on the **Hobby plan** (`$5/month` base). Railway's own docs don't state that volume backups or PITR are Pro-only, and Storage Buckets (which PITR depends on) are explicitly available on Hobby (up to 1TB combined). So plan tier does not look like the explanation.
- Most likely explanation: backup/restore state is treated as a more sensitive read than everything else and is gated to browser-session auth (the dashboard), not exposed to CLI/API personal-access tokens. I could not confirm this theory further without either the dashboard itself or credentials I was told not to pull.
- The Railway CLI (v4.35.1) also has **no subcommand at all** for backups or PITR (`railway volume --help` only offers list/add/delete/update/detach/attach/files/browse — nothing backup-related). This is consistent with the docs' own admission that "Backups are a newer feature that is still under development" and may simply not have CLI/API read support yet.

**Bottom line: neither of the two prior claims (backups "unavailable" vs. "just switched off, API-controllable") could be confirmed as fully correct or incorrect from here.** The *mutation* (`volumeInstanceBackupScheduleUpdate`) and its sibling mutations (`volumeInstanceBackupCreate/Delete/Lock/Restore`) do exist in the schema — that part of the earlier finding holds up. But I have **no read-confirmed evidence** of whether a schedule is currently set, whether any backups exist, or whether PITR is on. **The only way to know for certain is the dashboard's Backups tab** (Project → Postgres service → Backups). That is a read-only page view — safe to check any time, and step 1 of the TL;DR above.

### 1.3 Volume size (for cost estimation)

From `railway volume list --json` (read-only, scoped to the production environment):

| Field | Value |
|---|---|
| Current data on disk | **187.8 MB** |
| Configured volume quota | 500 MB |

This is a small database. Everything in the cost section below scales off this number, not a guess.

### 1.4 Restart/redeploy implications

- **Backup schedule** (Daily/Weekly/Monthly toggle in the Backups tab): per Railway's docs, this is a metadata-only change on the volume — "can be modified at any time." Nothing in the docs or the service's deployment history suggests it touches the running container. **Treat as safe to enable at any time, no production event.**
- **PITR**: per Railway's docs, enabling PITR (a) creates a new Bucket, (b) sets `WAL_ARCHIVE_*` env vars on the Postgres service, and (c) **redeploys the service**. For a single-node instance (which this is — no HA cluster configured), that means a real restart: the running container stops and a new one starts with the archive env vars, which is a genuine (if brief) production event, not the ~5-second HA failover described for clustered setups. **This should be scheduled deliberately, not fired off casually**, and needs Jatin's go-ahead per the guardrail on deployment/environment changes.
- One relevant, favorable fact: the current image tag is `ghcr.io/railwayapp-templates/postgres-ssl:18` — already a **major-version-only tag** (not pinned to e.g. `18.3`). PITR's docs explicitly require major-tag pinning ("Minor version pinning is not supported with PITR"). **No image change is needed before enabling PITR** — this box is already checked.

### 1.5 What I deliberately did not check

- I did not call `list_variables` or any tool that dumps environment variable values, per the explicit constraint — including to check for existing `WAL_ARCHIVE_*` vars, which would have told us definitively whether PITR is already on. This is exactly the kind of check the dashboard's Backups tab replaces safely (it shows an "Enable PITR" banner if it's off, without exposing any secret value).
- I did not connect to the database directly (no `railway connect` / `railway ssh` / psql), so I did not independently re-verify the `server_version 18.3` claim from the prior session. The image-tag evidence (`postgres-ssl:18`) is consistent with it but isn't a substitute for an actual `SELECT version()`.
- I did not run `railway login` for the MCP session, since establishing a fresh authenticated session wasn't necessary once the CLI's existing session covered every read I needed, and re-authenticating wasn't part of the read-only brief.

---

## 2. The exact change to make

All of this is dashboard click-path, because — per §1.2 — there is no CLI/API path for it right now.

### 2.1 Step A — Enable a backup schedule (safe, no restart)

1. Go to `https://railway.com/project/eef927aa-8e3a-4515-85fd-781b7d1d95c1` (GE-Backend-Server).
2. Make sure the environment selector (top of the canvas) is set to **production**.
3. Click the **Postgres** service card (id `0c31ec38-0433-46c6-9fbb-5dd2859d1a08`).
4. Open the **Backups** tab in the service panel.
5. Under **Backup schedules**, select **Daily** (recommended primary schedule — see §5 for reasoning). Optionally also select **Weekly** and **Monthly** for longer retention.
6. Save. Per Railway's docs this takes effect immediately — no "Deploy" / staged-change step, no restart.

### 2.2 Step B — Enable PITR (touches the running service — schedule deliberately)

1. Same Backups tab as above.
2. If PITR is off, you'll see a **"Point-in-time recovery is off"** banner with an **Enable PITR** button.
3. Click **Enable**, confirm.
4. Railway will: create a bucket named `Postgres-PITR`, set `WAL_ARCHIVE_*` env vars on the Postgres service, and **redeploy it**. Expect a short connection interruption for anything actively querying Postgres during the redeploy (typically the length of a normal Railway deploy — seconds to low tens of seconds, not the ~5s figure Railway quotes specifically for HA failover, since this is single-node).
5. Once the new container is up, the docs describe an in-container watcher automatically taking the first pgBackRest base backup — no manual step needed.
6. After that, the Backups tab will show a **PITR datetime picker** confirming the restore window is live.

**Do Step A first, independently, and let it run for at least a day before doing Step B** — that way, if Step B's redeploy causes any unexpected issue, you already have a Step-A snapshot as a fallback, and the two changes aren't conflated if something needs debugging.

---

## 3. Risk and blast radius per step

| Step | Touches running DB? | Blast radius if it goes wrong | Reversible? |
|---|---|---|---|
| Viewing the Backups tab | No | None — read-only page | N/A |
| Enabling a backup schedule (2.1) | No (per docs — metadata only) | Worst case: schedule doesn't fire, silently (see §6 for how to catch this) | Yes — turn schedules back off any time |
| Enabling PITR (2.2) | **Yes — triggers one redeploy** | A few seconds to ~1 minute of connection interruption for the Postgres service during redeploy; on Railway, a failed redeploy would leave the old container's data untouched (volume isn't recreated) but could leave the service needing a manual retry | Yes for the toggle (see §7); the redeploy itself is not "undoable" as an event, but it isn't destructive to data |
| Restoring a backup or PITR target (not part of this plan — future action) | **Yes — provisions a new sibling service from a snapshot** | None to the *source* service ("the source service is never touched" per docs) — but cutover to the restored copy is a manual step your team would do deliberately, not by accident | The restored fork is a new service; deleting it if unwanted is a separate, explicit action |

Nothing in this plan asks you to touch `Postgres-Bhky` (staging) or `Postgres-K0lx` (Documenso) — this is scoped to the CRM's production `Postgres` service only.

---

## 4. Recommended schedule and retention

Context: ~4-person agency CRM holding client and candidate data, currently 188 MB, low absolute write volume implied by that size and by the single-deployment uptime since March.

**Recommendation: enable all three backup schedules, plus PITR.**

- **Daily** (kept 6 days) — the workhorse. Covers "someone fat-fingered a DELETE this morning" and "a bad migration ran last night." 6 days of daily recovery points is enough runway to notice a data problem (most get noticed within a day or two) and still have the pre-incident state available.
- **Weekly** (kept 1 month) — covers slower-burn problems: silent data corruption or a bad backfill script that isn't noticed for 1–3 weeks. Also gives a same-day fallback if daily backups were somehow disabled or failed silently for a stretch (see §6).
- **Monthly** (kept 3 months) — cheap insurance against "we need last quarter's state for an audit / a client dispute / to recover something someone force-deleted weeks ago and only just told us." At this data size the marginal cost of keeping this on is essentially zero.
- **PITR** — the one thing scheduled backups can't give you: recovery to *any second* within roughly the last 4 weeks, not just the last daily snapshot. Given the volume is this small, the WAL archive volume will also be small (§ below), so the cost argument for skipping it doesn't hold. This is the difference between "we lost today's changes" and "we lost the last 40 minutes."

Why not skip PITR and rely on Daily alone: a "someone ran a bad DELETE at 2pm" incident recovered from last night's daily backup means losing every legitimate write between midnight and 2pm — client updates, candidate records, deal changes. For a live CRM that's actively worked in during business hours, that's a real amount of lost work. PITR closes that gap for a cost this investigation estimates at well under $1/month (§5).

## 5. Cost estimate

From real data (§1.3), not a guess: **188 MB** currently on the volume.

**Backup schedule storage** — per Railway's docs, backups are incremental / Copy-on-Write, billed at the same per-GB rate as volume storage (**$0.15/GB/month**), and you're only billed for data exclusive to each snapshot (not full copies each time).

- Worst-case, zero-dedup estimate (all snapshots treated as full independent copies — this deliberately overstates cost): 6 daily + 4 weekly + 3 monthly ≈ 13 copies × 0.188 GB × $0.15/GB/month ≈ **$0.37/month**.
- Realistic estimate, given COW dedup and a low daily change rate for this DB: a few cents to well under $0.20/month.

**PITR storage** — billed through two existing meters, both at Railway's Standard bucket rate of **$0.015/GB-month** for storage, plus standard public egress ($0.05/GB) for the Postgres service pushing WAL segments to the bucket:

- Docs' own rule of thumb: "a few GB of compressed WAL per day under steady write load (idle databases are nearly free)." A 188 MB database being lightly used by a 4-person team is much closer to "idle" than "steady heavy write load" — expect well under 1 GB/day compressed, likely closer to tens of MB/day.
- Base backups (weekly full + daily incremental via pgBackRest) are compressed and deduplicated; pgBackRest's `expire` process keeps the bucket stabilized around ~4 weeks of retained WAL.
- Even a generous estimate — say 500 MB/day compressed WAL, ~15 GB retained over the 4-week window — comes to roughly **$0.23/month** in bucket storage, plus a few cents of egress.

**Total estimated incremental cost: comfortably under $1/month**, likely closer to $0.30–0.60/month combined. This sits inside the Hobby plan's $5/month included resource-usage allowance *if* there's headroom left after existing usage (web, Redis, Documenso, the two other Postgres instances) — worth a 30-second glance at the workspace's Usage page before enabling, but not something this investigation can size without seeing current billing, since env-var/billing dumps were out of scope here.

---

## 6. Verification — how to confirm a backup genuinely exists and is restorable

A schedule that's configured but silently produces nothing is the actual risk here, not "no schedule was configured at all" (that failure is at least visible). Concretely:

1. **Day 1, right after enabling (§2.1):** Open the Backups tab again. Manually trigger one backup immediately (the docs confirm manual triggers are available alongside schedules) rather than waiting for the first scheduled run — this gives you same-day confirmation the mechanism works at all, instead of waiting up to 24 hours to find out it doesn't.
2. **Day 2–3:** Return to the Backups tab and confirm a **dated backup entry actually appears** in the list — not just that the schedule toggle shows "on." The toggle being on and a backup existing are two different facts; only the second one is the thing that matters in an emergency.
3. **Restore-test at least once, on a non-production copy:** Pick any backup and click **Restore**. Per the docs this stages a change that mounts a *new* volume with the backup's data, leaving your live Postgres untouched until you explicitly click Deploy on the staged change — so you can inspect the staged restore's data without committing to anything, then discard the staged change instead of deploying it if you're just testing. This is the only way to know the backups are actually restorable and not just "present in a list." **A backup nobody has restore-tested is not a backup — it's an unverified hope.** Put this on the calendar; it doesn't need to happen today, but it needs to happen before you'd ever trust this in a real incident.
4. **For PITR specifically:** after enabling, the Backups tab should show a live datetime picker with a restore window. Confirm the window's start time roughly matches when you enabled PITR (the docs note the window only starts from the first post-enable base backup — you cannot restore to before you turned it on).
5. **Ongoing:** spot-check the Backups tab monthly. Railway doesn't appear to offer an alert/webhook for "scheduled backup failed" in what I could find in the docs — if that's something you want, it would need to be a manual habit (calendar reminder) rather than an automated check, unless the dashboard surfaces a failure state I didn't have visibility into from here.

---

## 7. Rollback

- **Backup schedules**: fully reversible. Return to the Backups tab, deselect the schedule(s). Per the docs, "these schedules can be modified at any time." Existing backups already taken are **not** automatically deleted when you turn a schedule off — they persist until they age out per their retention window, or you delete them manually.
- **PITR**: reversible via **Disable PITR** on the Backups tab. For single-node Postgres (this service), Railway stages a patch removing the `WAL_ARCHIVE_*` env vars and deleting the `Postgres-PITR` bucket — **nothing changes until you review and click Deploy** on that staged patch. If you want to keep the archived WAL around a bit longer (e.g., to restore from it before fully cleaning up), edit the staged patch to drop the bucket-deletion step before deploying.
- **What is NOT undoable:**
  - The redeploy that enabling PITR triggers is a real event (a container restart) — you can't "undo" the fact that it happened, only disable PITR going forward.
  - **Wiping a volume deletes all its backups** (explicit caveat in Railway's docs) — this is a one-way loss if it ever happens, independent of anything in this plan.
  - Restoring a backup removes any backups newer than the one you restored (you keep everything older). This only matters if you actually click through a restore, which is not part of the recommended plan above — only the restore-test in §6, which should be discarded rather than deployed.

---

## 8. Summary for the owner

- **Do first:** open the Postgres service's Backups tab in the dashboard and look — this investigation could not read that state through the API, so it's the one fact everything else in this plan depends on.
- **Safe to do immediately, any time:** turn on Daily (+ Weekly + Monthly) backup schedules. No restart, no confirmation needed beyond your own judgment.
- **Needs a scheduled window and your explicit go-ahead:** enabling PITR, because it redeploys the live Postgres service.
- **Cost:** trivial — under $1/month combined, given the database is only 188 MB.
- **Don't skip:** the restore-test in §6. An untested backup is not a real safety net.
