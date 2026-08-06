# Owner action list

**Updated 2026-08-06.** Most of this list is now done. What remains needs
account access, or a decision an agent should not take alone.

---

## ✅ DONE — branch pushed, merged with main, migration collision resolved

[PR #163](https://github.com/Growth-Escalators/Growth-Escalators-CRM/pull/163)
is open, `MERGEABLE`, **CI green**. #108 closed as superseded — its fix is
included here as `688553fd`.

`main` had independently used `0045` (roles/RBAC) and `0046` (user_invites)
while this branch used them for SEO. This branch's five migrations are
renumbered **`0047`–`0051`**; SQL bodies unchanged.

Verified by applying all 52 migrations to a clean scratch database: 111 tables,
both sides' tables present, `site_changes_approved_requires_approver` in place.
File numbers agreeing is necessary but not sufficient — that restore is the
check that actually matters.

---

## ✅ DONE — backups, without paying Railway

Railway's managed backups are out on budget. The free route — the same one used
on 28 Jul — is an encrypted `pg_dump` to local disk:

```bash
cd input-data/g1-backups
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
railway run --service Postgres -- sh -c \
  "/opt/homebrew/opt/postgresql@18/bin/pg_dump --format=custom --no-owner --no-acl \
   --dbname=\"\$DATABASE_PUBLIC_URL\" -f prod-$STAMP.dump"
```

Three things worth keeping for next time:

- **`DATABASE_URL` will not work from your laptop.** It resolves to
  `postgres.railway.internal`, which exists only inside Railway's network. Use
  `DATABASE_PUBLIC_URL`.
- **`railway run` never prints the credential** — it injects it into the
  subprocess environment, so the connection string stays out of shell history
  and out of any transcript. Do not use `railway variables` to read it; that
  prints plaintext secrets, which is the last thing wanted mid-exposure.
- Local `pg_dump` must be **v18**. v16 refuses to dump an 18 server.

**`input-data/` is now in `.gitignore`.** It was previously ignored only via
`.git/info/exclude` — local-only, so a fresh clone would not have it and the
first `git add -A` there would have staged an encrypted production dump.

---

## ⛔ YOURS — 1. Encrypt, restore-test, then merge #163

**A dump that has never been restored is not a backup.** Do this before merging.

```bash
cd input-data/g1-backups
openssl enc -aes-256-cbc -pbkdf2 -salt -in prod-<STAMP>.dump -out prod-<STAMP>.dump.enc
rm prod-<STAMP>.dump                      # remove the plaintext
shasum -a 256 prod-<STAMP>.dump.enc

createdb restore_test
openssl enc -d -aes-256-cbc -pbkdf2 -in prod-<STAMP>.dump.enc | \
  /opt/homebrew/opt/postgresql@18/bin/pg_restore -d restore_test --no-owner
psql restore_test -c "SELECT count(*) FROM contacts;"
dropdb restore_test
```

Then merge. CI is green and the migrations are verified, but merging
**auto-deploys** and applies five migrations on boot — a production event, and
the moment should be a human's choice.

After deploying, check `/api/system/health`: 30 previously-unmonitored crons
became visible, so expect more rows than before. That is the change, not a
fault.

---

## ⛔ YOURS — 2. Rotate the leaked credentials

Checklist:
`~/repo-comparison/v2/.claude/worktrees/feat+contracts-esign/SECRETS-ROTATION.md`

Needs WordPress, GCP, Anthropic, Apollo, Hunter, MillionVerifier, GitHub and
CRM logins. An agent holds none of those and should not.

Two traps that would otherwise cost you time mid-rotation:

- **WordPress: UPDATE the `WP_AGEDDENTISTRY_*` Railway vars — do not delete
  them.** Nothing on `main` reads WordPress credentials from the encrypted
  store yet; `programmaticSeoService.publishToWordPress()` is still the only
  reader and it reads `process.env`. Deleting them stops publishing silently,
  with no error.
- **`GOOGLE_SEO_OAUTH_*` is a different client and is not leaked.** Only
  `GCP_OAUTH_CLIENT_SECRET` needs rotating. Rotating the SEO one "to be safe"
  breaks the weekly Search Console pull until the refresh token is re-minted.

---

## 🕓 DEFERRED — 3. The retired-client purge

aarohaom.com, blackpandaenterprises.com, ageddentistry.org. Plan and script:
[`SEO_CLIENT_DATA_PURGE_PLAN.md`](./SEO_CLIENT_DATA_PURGE_PLAN.md) and
`scripts/seo-client-purge.ts` — dry-run by default, and incapable of deleting
without `--execute`, a typed confirmation string, and `--allow-non-local`.

**Recommendation: leave it.** It is irreversible and that data is inert — it
costs nothing to keep. Do it only if you actively want the rows gone, and only
behind a restore-tested backup.

---

## Known gaps in the shipped work

Stated rather than hidden:

- **GA4 calls are not counted by the cost guard** — `SeoCostGuardEstimatedCalls`
  has no `ga4Calls` field, and reusing `gscCalls` would corrupt the real GSC
  daily-cap counter with GA4 traffic.
- **The drift sweep's third URL source** (top GSC URLs by impressions, the one
  that catches pages the agency never touched) is unimplemented — no per-URL
  GSC table exists, and inventing one was declined rather than guessed at.
- **`hot_lead_alert` jobs have had no consumer since n8n died.**
  `bookingService.ts` still creates one per hot lead and nothing drains them.
  Pre-existing, documented in `jobDrainer.ts`, worth its own ticket.
- **`.claude/agents/seo-debugger.md`** still describes the retired n8n system.
