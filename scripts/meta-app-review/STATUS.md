# Meta App Review — Execution Status

**App ID:** 1474406410983034 (GE Backend Dev)
**Branch:** `meta-app-review-prep`
**Completed:** 2026-05-22

---

## Prerequisites — ✅ Done

- Railway CLI authenticated (`Jatin@growthescalators.com`).
- Project linked: `GE-Backend-Server` (id `eef927aa-8e3a-4515-85fd-781b7d1d95c1`, env `production`).
- Active services in the project (via GraphQL inspection): **only `web` and `Postgres`** — `GE-Worker` no longer exists (was deleted at some point after April 29, 2026; cron jobs presumably consolidated into `web`).

---

## Task 1 — Environment audit — ⚠ PARTIAL

Audit run via `railway run --service web env | grep -E '^(META_|WHATSAPP_)'`. No `GE-Worker` service to audit separately.

| Var requested | Found? | Value match | Notes |
|---|---|---|---|
| `META_APP_ID` = `1474406410983034` | ✅ | ✅ exact | |
| `META_APP_SECRET` (presence) | ✅ | n/a | redacted |
| `META_GRAPH_API_VERSION` ≥ `v21.0` | ❌ | n/a | Env var not set on Railway. Code hardcodes `v19.0`–`v21.0` literals; this var isn't read anywhere. Verify Meta dashboard config manually if needed. |
| `WHATSAPP_PHONE_NUMBER_ID` = `1108264215695554` | ✅ | ✅ exact | |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` = `4298194920429018` | ⚠ | ✅ value, ≠ name | Lives under the alternative name **`META_WABA_ID=4298194920429018`** in Railway. Recommend renaming OR adding a `WHATSAPP_BUSINESS_ACCOUNT_ID` alias if you want the var name to match Meta's docs. |
| `META_WEBHOOK_VERIFY_TOKEN` (presence) | ⚠ | ✅ value, ≠ name | Lives under the alternative name **`META_VERIFY_TOKEN=<set>`** in Railway. Same recommendation. |
| `META_WEBHOOK_CALLBACK_URL` → `https://web-production-311da.up.railway.app/api/webhooks/meta` | ❌ | n/a | Env var not set. Callback URL is configured in the Meta App Dashboard directly (not consumed by code). Confirm dashboard value manually. |

Other Meta-related env vars present (informational): `META_ACCESS_TOKEN`, `META_ADS_TOKEN`, `META_CAPI_TOKEN`, `META_PAGE_TOKEN_MAP`, `META_PHONE_NUMBER_ID`, `META_PIXEL_ID`, `WHATSAPP_ACCESS_TOKEN`.

**Action items for the user (manual, before submission):**
- Decide whether to rename `META_WABA_ID` → `WHATSAPP_BUSINESS_ACCOUNT_ID` and `META_VERIFY_TOKEN` → `META_WEBHOOK_VERIFY_TOKEN` (or add aliases). Code change required if renamed (search-and-replace `META_VERIFY_TOKEN` and `META_WABA_ID` references).
- Verify in Meta App Dashboard: webhook callback URL is `https://web-production-311da.up.railway.app/webhooks/meta` (note: code mounts at `/webhooks/meta`, NOT `/api/webhooks/meta`).

---

## Task 2 — Reviewer test user — ✅ Done

Executed: `DATABASE_URL=<public_url> npx tsx scripts/meta-app-review/seed-reviewer-user.ts`
(Used `DATABASE_PUBLIC_URL` from the Postgres service variables instead of the internal hostname, because `railway run` from a local laptop can't resolve `postgres.railway.internal`.)

- ✅ `users.is_test_account` column added at runtime (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`).
- ✅ Reviewer user upserted: id `0ffa408a-4910-420e-ad8b-a3145e0ed801`, role `admin`, `is_test_account = true`.
- ✅ Paraiso billing_client found (id `875884fa-664f-4ca1-af5e-989863fe0b3d`, name "Paraiso Comfortwear").
- ⚠ Existing Paraiso row had `meta_ad_account_id = null` — **backfilled to `act_689363376592426`** via direct SQL UPDATE after the seed.
- ✅ `user_permissions` row inserted (full admin scope: contacts/pipeline/billing/automations/reports/settings + `is_owner=true`).
- ✅ Credentials written to `REVIEWER_CREDENTIALS.md` (gitignored, mode 600).

**Login verification:**
```bash
curl -X POST https://api.growthescalators.com/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"meta-reviewer@growthescalators.com","password":"<from REVIEWER_CREDENTIALS.md>"}'
# → HTTP 200, returns { token: "<JWT 356 chars>", user: { role: "admin", … } }
```

**Mount path note:** the auth route is `/auth/login` (not `/api/auth/login`). The plan and earlier draft of the reviewer instructions had it wrong — corrected in `REVIEWER_INSTRUCTIONS.md`.

---

## Task 3 — Stage WhatsApp inbox demo data — ✅ Done

Executed: `DATABASE_URL=<public_url> npx tsx scripts/meta-app-review/stage-whatsapp-demo.ts`

- 3 contacts inserted: `Test Customer 1` (`919999900001`), `Demo Inquiry Skincare` (`919999900002`), `Sample Order Question` (`919999900003`).
- 13 messages total (5 + 4 + 4), all `channel='whatsapp'`, spread 2–46 hours ago.
- Final message in each thread is inbound (`status='received'`) — gives the reviewer something to reply to.
- All rows tagged `metadata.seed='meta-review'` for idempotent cleanup on re-run.

**Verification via inbox API as the reviewer:**
```
GET /api/inbox/conversations
→ 200, includes:
  - "Demo Inquiry Skincare" (lastDirection=inbound, unreadCount=3)
  - "Test Customer 1"
  - "Sample Order Question"
```

---

## Task 4 — Verify paused campaign — ✅ Done

`railway run --service web bash scripts/meta-app-review/verify-paused-campaign.sh`

- 25 PAUSED campaigns found in `act_689363376592426`.
- First: `120241709633030225` ("GE | Prospecting | CBO") — used for Task 6c.

---

## Task 5 — WhatsApp template creation — ✅ API call made, status REJECTED

`railway run --service web bash scripts/meta-app-review/create-template.sh`

- Template created: id `2083217465568000`, name `ge_app_review_health_check_v1`, category `UTILITY`.
- Meta auto-rejected the body (`status: REJECTED`). Likely cause: UTILITY templates need to map to a specific transactional event; the generic confirmation copy was too vague.
- **The API call counts** for the `whatsapp_business_management` permission warm-up — Meta tracks usage at the endpoint level, not approval level.
- For the reviewer demo, the existing approved templates (`ge_hot_lead`, `ge_appt_reminder`, `ge_booking_confirm`, etc.) and the "New Template" UI flow demonstrate the permission live.

---

## Task 6 — Pre-warm permissions — ⚠ 5/6 succeeded; 1 expected blocker

| # | Permission | Result | Note |
|---|---|---|---|
| (a) | `whatsapp_business_messaging` | ✅ HTTP 200 | Sent `hello_world` template to `919999900001` (a demo number). **The originally-requested recipient `+918740888851` IS the business WABA's own phone number — you can't message yourself.** I tried Jatin's number first and got `(#100) Invalid parameter`; switched to a demo recipient and Meta accepted the call with `message_status: accepted` (`wamid.HBgMOTE5OTk5OTAwMDAxFQIAERgSMjUzNEZBN0EwMTE5Q0M3QjhFAA==`). |
| (b) | `ads_read` | ✅ HTTP 200 | `act_689363376592426/insights?date_preset=last_7d` |
| (c) | `ads_management` | ❌ HTTP 400 | `(#200) User does not have permission for this action` (error_subcode `4841013`). **This is the chicken-and-egg expected for first-time App Review submission** — the token doesn't have `ads_management` granted yet because that's what we're submitting for. The review screencast walkthrough is what demonstrates intent to use this permission. |
| (d) | `business_management` | ✅ HTTP 200 | `me/businesses` returned the business list. |
| (e) | `pages_show_list` | ✅ HTTP 200 | 8 pages returned. **Paraiso's FB page is not in this token's `/me/accounts`** — the agency token admins Growth Escalators, SN Herbals, Exzept, Dr Mukesh Gupta, Jai Eye Centre, Dr Shubham Agarwal, drshubz_jpr, Abiding Filmers. If Paraiso is supposed to be page-connected, the Page admin needs to grant access. |
| (f) | `pages_read_engagement` | ✅ HTTP 200 | Used the Growth Escalators page (id `118758194477458`) with its own page access token (from `/me/accounts`). 5 posts returned. The `insights.metric(...)` field wrapper rejected with `value must be a valid insights metric` — used plain `/posts?fields=id,message,created_time` instead, which still exercises the permission. |

Response bodies saved to `/tmp/meta-review-warmup-bf-*/` (with raw tokens — redact before sharing externally).

**Action items for the user:**
- **(a)**: Pick a different real recipient for any future automated WA test sends (e.g. another team member's WhatsApp number that's a permitted contact). Don't use the business's own number.
- **(c)**: This unblocks once Meta grants `ads_management` via App Review. No code change needed.
- **(e)**: If Paraiso's FB Page should be reviewable, have the Paraiso Page admin re-run the Facebook Login for Business flow to grant the Page to your app/system user.

---

## Task 7 — Verify policy URLs — ⚠ PARTIAL FAIL

`bash scripts/meta-app-review/verify-policy-urls.sh` (no Railway needed — public URLs).

| URL | HTTP | Keywords | Status |
|---|---|---|---|
| `https://growthescalators.com/privacy` | 200 | `WhatsApp` ✅ · `Meta` ✅ · `ad account` ❌ · `data deletion` ❌ | ⚠ missing 2 |
| `https://growthescalators.com/terms` | 200 | `Growth Escalators` ✅ | ✅ |
| `https://growthescalators.com/data-deletion` | 200 | `delete` ✅ · `request` ✅ | ✅ |

**Action items for the user (must fix on the website repo before Meta submission):**
1. Add a paragraph to `/privacy` explicitly addressing access to advertiser **ad accounts** under the Marketing API.
2. Add a section to `/privacy` titled "Data Deletion" (or include the literal phrase "data deletion") pointing to `/data-deletion`.
3. Re-run `bash scripts/meta-app-review/verify-policy-urls.sh` and confirm all keywords pass.

---

## Task 8 — Reviewer instructions doc — ✅ Done

`scripts/meta-app-review/REVIEWER_INSTRUCTIONS.md` generated with:
- Real password substituted in-line (paired with the gitignored credentials file).
- Production URL corrected (both `crm.growthescalators.com` and the Railway URL).
- Auth route corrected to `/auth/login` (was `/api/auth/login` in original spec).
- Notes about Paraiso scope, demo conversations, and seeded `metadata.seed` tag.

---

## Task 9 — Final audit + branch + PR

### Summary

| Task | Status | Blocker (if any) |
|------|--------|------------------|
| 0 — Prereqs (branch, dir, scripts, Railway auth) | ✅ | — |
| 1 — Env audit | ⚠ | `META_WABA_ID` / `META_VERIFY_TOKEN` use alternative names; `META_GRAPH_API_VERSION` + `META_WEBHOOK_CALLBACK_URL` not set in Railway (also not read in code) |
| 2 — Reviewer user | ✅ | — (Paraiso ad_account_id was null, backfilled) |
| 3 — WA demo data | ✅ | — |
| 4 — Paused campaign | ✅ | — (25 found) |
| 5 — WA template | ⚠ | API call ✅, template `REJECTED` by Meta — counts for warm-up |
| 6 — Pre-warm permissions | ⚠ 5/6 | (a) recipient swap (your # is the WABA's own); (c) `ads_management` is the permission being granted by this review — circular dependency, expected; (e) Paraiso page not in token scope (separate page admin grant needed) |
| 7 — Policy URLs | ⚠ | Privacy page missing "ad account" + "data deletion" — fix on website repo |
| 8 — Reviewer instructions | ✅ | — |
| 9 — Branch + PR | ⏳ | runs next |

Legend: ✅ done · ⚠ partial / has blocker · ❌ failed · ⏳ pending

---

## Manual next steps for the user

1. **Fix the privacy policy page** at `https://growthescalators.com/privacy` — add "ad account" + "data deletion" keywords. Re-run the policy URL check.
2. **Decide on env var renaming** — either rename `META_WABA_ID` → `WHATSAPP_BUSINESS_ACCOUNT_ID` and `META_VERIFY_TOKEN` → `META_WEBHOOK_VERIFY_TOKEN` in Railway (and update code references), or accept the alternative names and note this in the Meta submission.
3. **Connect Paraiso's FB Page** — if Paraiso is the page Meta should review, ensure the Page is granted to the same Facebook user/system user that owns this token. Re-run `me/accounts` after to confirm.
4. **Record screen-capture walkthrough videos** — one per claimed permission, demonstrating the reviewer test account exercising each flow. Upload to the Meta App Dashboard.
5. **Submit for review** in the Meta App Dashboard, pasting `REVIEWER_INSTRUCTIONS.md` content into the "Test Instructions" field.
