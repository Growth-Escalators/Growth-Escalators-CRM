# Owner action list — what only Jatin can do

**As of 2026-08-05.** Everything on this list is blocked on account access, a
browser session, or a permission an agent does not hold. Nothing here is
waiting on more engineering.

Ordered deliberately. The ordering matters in two places and is called out
where it does.

---

## 1. Enable database backups — do this first

**Why first:** production Postgres has **zero backups and no schedule**, and
item 4 below (an irreversible data purge) must not happen without one. It is
also the cheapest item here: ~2 minutes, no restart, no deploy.

Full findings, click-path, risk table and rollback:
[`RAILWAY_BACKUP_PLAN.md`](./RAILWAY_BACKUP_PLAN.md).

**Why an agent cannot do this.** Not caution — a capability limit, established
with evidence:
- The Railway CLI has **no backup subcommand at all** (`railway --help` returns
  zero matches for "backup"; `railway volume` offers only
  list/add/delete/update/detach/attach).
- The GraphQL reads (`volumeInstanceBackupList`,
  `volumeInstanceBackupScheduleList`) return **"Not Authorized"** on the same
  token that reads projects, services, deployments and volumes without issue.
  Backup state appears to be gated to browser-session auth.

**The target, confirmed independently:** project `GE-Backend-Server`,
environment `production`, service `Postgres`, volume `postgres-volume`,
**188 MB / 500 MB**. (Not `Postgres-Bhky` — that is staging's real DB, not an
orphan. Not `Postgres-K0lx` — that is Documenso's.)

**Steps**
1. Railway → `GE-Backend-Server` → `production` → **`Postgres`** → **Backups**
   tab. This is a read-only look; it is also the only way to see the current
   state.
2. Enable **Daily**. No restart, safe during business hours.
3. Leave it a day, then enable **PITR** — this one **triggers a redeploy** of
   the database service, so pick a quiet window. The image is already
   major-version pinned (`postgres-ssl:18`), so nothing else is needed first.

Estimated cost for daily + weekly + monthly + PITR at this volume: **well under
$1/month**.

> A backup nobody has restore-tested is not a backup. Before item 4, restore
> one into a scratch database and confirm the row counts.

---

## 1b. BEFORE MERGING — a migration-number collision will stop the API booting

**Pushing the branch is safe. Merging it to `main` as-is is not.**

While this branch was being built, `main` advanced and independently used the
same two migration numbers for unrelated work:

| Number | `origin/main` | this branch |
|---|---|---|
| `0045` | `quiet_black_bird` — creates `role_permissions` | `typical_toro` — SEO tenant hardening |
| `0046` | `sloppy_zeigeist` — creates `user_invites` | `glossy_leo` — the `seo_sites` registry |

`0047`–`0049` on this branch are free; only these two collide.

**Why it matters.** A merge conflicts on three files that cannot be resolved by
picking a side — `meta/_journal.json`, `meta/0045_snapshot.json` and
`meta/0046_snapshot.json` exist on both sides with different content. The
snapshots are the chain `db:generate` diffs against, so a bad resolution
silently produces wrong SQL on the *next* migration, not this one. And Railway
applies migrations on boot, so a broken journal means the API does not start.
This is exactly risk R1 from the original plan, arrived at from the other
direction: the plan said "rebase first, next is 0045" — that was true when it
was written, and `main` has moved twice since.

**The remedy**, in order:
1. Commit or stash your eight working-tree files (six `.claude/agents/*`
   deletions, `.gitignore`, `CLAUDE.md`). A rebase must not run over unrelated
   dirty files.
2. `git fetch origin && git rebase origin/main`.
3. Renumber this branch's five migrations to `0047`–`0051`, rebuilding
   `meta/_journal.json` entries and renaming each `meta/*_snapshot.json` to
   match. The SQL bodies do not change — only the numbers and the journal.
4. `npm run build && npm test`, then apply to a scratch database and confirm
   all five apply cleanly in order.

An agent did not do this because AGENTS.md forbids rebasing while unrelated
dirty files are present, and step 1 is your call, not an agent's.

---

## 2. Push the branch

**21 commits** are sitting local on `fix/wizmatch-scoring-pipeline`.

```bash
git push origin fix/wizmatch-scoring-pipeline
```

An agent attempted this and was **denied by the permission classifier**; that
denial was not worked around. Either run it yourself or add a Bash permission
rule.

**Lower risk than it sounds:** the branch already exists on the remote, and
**Railway auto-deploys on `main`, not on feature branches**. This push deploys
nothing. Merging to `main` is a separate, production-affecting decision.

---

## 3. Rotate the leaked credentials

Checklist:
`~/repo-comparison/v2/.claude/worktrees/feat+contracts-esign/SECRETS-ROTATION.md`

**Why an agent cannot do this:** it requires being logged in to WordPress, GCP
Console, Anthropic, Apollo, Hunter, MillionVerifier, GitHub and the CRM as
owner. An agent holds none of those accounts and should not.

The checklist has been audited and corrected. Two things worth knowing before
you start, because both would otherwise cost you time mid-rotation:

**WordPress — update the Railway vars, do NOT delete them.** The encrypted
`tenant_integrations` store and its `PUT /api/tenant-integrations/:provider`
route are live on `main` today, but nothing on `main` *reads* WordPress
credentials from it — `programmaticSeoService.publishToWordPress()` is still
the only reader and it reads `process.env`. Deleting `WP_AGEDDENTISTRY_*` stops
WordPress publishing silently (it fails soft, with no error). Rotate the
application password, update the vars with the new value, revoke the old one.

**There are two different Google OAuth clients.** `GCP_OAUTH_CLIENT_SECRET` is
leaked and needs rotating. `GOOGLE_SEO_OAUTH_*` is a **separate** client used
only by the Search Console pull, and a sweep of committed files found no
plaintext value for it — it is not leaked and should not be rotated. Rotating
it "to be safe" breaks the weekly pull until the refresh token is re-minted.

---

## 4. The retired-client data purge — gated on item 1

aarohaom.com, blackpandaenterprises.com, ageddentistry.org.

Plan and dry-run script:
[`SEO_CLIENT_DATA_PURGE_PLAN.md`](./SEO_CLIENT_DATA_PURGE_PLAN.md) and
`scripts/seo-client-purge.ts`.

**Preconditions, all three:**
1. Item 1 done, **and** a backup restore-tested into a scratch database.
2. A dry run reviewed — the script counts and prints by default and cannot
   delete without an explicit flag plus a typed confirmation.
3. Your explicit second confirmation.

This is irreversible. It is last on the list for that reason.

---

## Not on this list

Everything else is done and verified: Phases 1–6 of the multi-tenant SEO
platform — the approval queue, the drift sweep, the per-tenant cost guard, the
GSC/GA4 pulls, and the n8n retirement. See `.ai/HANDOFF_LOG.md` for the narrative and
`.ai/CURRENT_TASK.md` for current state.
