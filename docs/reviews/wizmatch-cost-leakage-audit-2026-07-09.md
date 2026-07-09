# Wizmatch — Cost-Leakage & Relevance Audit (verified against source)

- **Date:** 2026-07-09
- **Author:** Claude (senior architect/engineer role, per `CLAUDE.md`)
- **Trigger:** An external "Cost Leakage & Relevance Audit" brief was handed in, with the explicit
  instruction that *"every item is either a confirmed risk … or an open question that needs a code
  check before you spend real money scaling this up."*
- **Scope:** Read-only verification of all 9 claimed leaks and all 6 open questions against the
  actual repo. **This document changes no product code, schema, migrations, crons, mailer, or
  cost-guard logic.** The backlog in §4 is a menu for later, not work that was done.
- **How to read the verdicts:** every claim is graded `CONFIRMED` / `MITIGATED` / `REFUTED` /
  `MODEL-CORRECTION` / `LOW`, each traceable to a `file:line` you can spot-check (see the Evidence
  index at the end).

---

## TL;DR

1. **The paid discovery path is already well-defended.** Contact-Intelligence "Run discovery" sits
   behind a preview→confirm gate, a cost guard (monthly/daily budget + per-tenant/per-user run caps
   + per-provider daily call caps), **and** a Postgres advisory lock that re-checks the guard
   *inside* the lock before spending. The brief's headline "double-spend race" is largely already
   handled.
2. **The real unmetered spend surface is the *free* enrich cascade.** The hourly enrich cron calls
   Apollo + Snov on the **same accounts** as paid discovery, but through
   `emailExtractorService`, which has **no counter and no cost-guard**. This is the one that can
   quietly drain the quota the paid path assumes it owns.
3. **Deliverability has a silent blind spot.** When every sending domain degrades, there is **no
   alert** and the mailer **keeps sending anyway** (falls back to all inboxes). Decision recorded:
   **alert + keep sending.**
4. **Several brief claims are overstated or already handled** — matching is bounded (not O(n×m)),
   requirement "priming" spends nothing, the env-check runs before any spend, and drafts are not
   regenerated on page load. Detail below so the mental model is corrected, not just patched.

---

## 1. Verdict table

| # | Audit claim | Verdict | Evidence |
|---|---|---|---|
| 1 | Contact-Intelligence double-spend race | **MITIGATED** (narrow residual) | Advisory lock + re-fetch/re-check guard inside lock — `wizmatch.ts:2348`. Lock/idempotency key is `tenant:company:user:day` — `wizmatchCostGuard.ts:295`. |
| 2 | Enrich free-tier burn (Apollo/Snov) | **CONFIRMED** (reframed) | Enrich is gated `score>=7 AND status='scored' AND contact_id IS NULL`, cap 20/run/hr — `worker.ts:1430`. But its free cascade calls Apollo (step 2) + Snov (step 3) with no metering — `emailExtractorService.ts:71-86`. |
| 3 | X-Ray SerpAPI quota | **CONFIRMED** | Only ceiling is `maxQueries = 3` code default + rotation; no internal counter — `wizmatchXrayScraper.ts:135,151`. |
| 4 | Draft regeneration (Sonnet) | **LOW** | Not called on page load — explicit button — `WizmatchReviewQueuePage.jsx:79`, `WizmatchSignalsPage.jsx:282`. But re-click makes 3 fresh Sonnet calls with no reuse of existing drafts — `wizmatch.ts:3107`. |
| 5 | Match cron O(n×m) | **REFUTED** | One query/signal, SQL skill prefilter + `LIMIT 40`, score ≤40 in JS, top-3; 30 signals/run — `wizmatchMatching.ts:61-77,134`. Skill arrays are GIN-indexed (migration `0020_wizmatch_gin_indexes`). |
| 6 | Suppression race on send | **LOW** | Suppression checked immediately before send in the same synchronous request — `wizmatch.ts:3269`. TOCTOU window is theoretical; suppression is manual/rare. |
| 7 | All-domains-unhealthy | **CONFIRMED (worse than stated)** | Health cron only ever sets `warn`/`healthy` (never `unhealthy`), computes SPF/DMARC but doesn't use them, and has **no alert** — `worker.ts:1475-1523`. Mailer falls back to **all** inboxes when none healthy, so it keeps sending from degraded domains — `multiDomainMailer.ts:65-70`. |
| 8 | Dice/Naukri CI dead weight | **LOW** | `workflow_dispatch` only, no `schedule:` — zero ongoing CI burn. Real issue is stale selectors (already a tracked known issue), not cost. |
| 9 | Priming bypasses Client-Discovery gate | **MODEL CORRECTION** | `POST /requirements` is a raw insert that spends nothing and creates no job signal — `wizmatch.ts:4414`. There is no single "Client-Discovery spend gate": enrich is gated by *signal score*, paid discovery by *cost guard + manual confirm*, and Client-Discovery scoring is *advisory* (computed on read). |

---

## 2. The six open questions, answered

**Q1 — Does Enrich check a Client-Discovery score before running, or run on all raw signals?**
Neither of the brief's framings. The hourly enrich cron selects only
`score >= 7 AND status = 'scored' AND contact_id IS NULL`, `LIMIT 20` (`worker.ts:1430`). So it is
gated — by the deterministic 0–10 *signal* score (`wizmatchScoring.ts`), not by the 0–100
*Client-Discovery* company score, which is a separate, advisory axis. Max ≈ 20 enrich calls/hour.

**Q2 — Any internal quota tracking for Apollo/Snov/SerpAPI free tiers?**
Split answer:
- **Paid path (Contact Intelligence): yes, fully.** `wizmatchCostGuard.ts` tracks monthly/daily
  spend, per-tenant/per-user run counts, and per-provider daily call counts, reconstructed from
  `wizmatch_discovery_runs.metadata.providerCalls` (`fetchWizmatchCostGuardUsage`, line 180).
- **Free paths: no.** `emailExtractorService` (Apollo/Snov, used by the enrich cron) and
  `wizmatchXrayScraper` (SerpAPI) have **no internal counter** — the only ceilings are the
  providers' own limits and the small per-run code caps. Because the enrich cascade and paid
  discovery share the same Apollo/Snov credentials, free-path usage is invisible to the cost guard.

**Q3 — If the provider-env check fails mid-run, does it fail before or after budget decrement?**
Before. The guard evaluates `providerEnv.missing` first and returns `provider_config_missing`
(HTTP 503) before any provider call (`wizmatchCostGuard.ts:264`). There is no "decrement" model —
spend is *recorded after the fact* by inserting a `wizmatch_discovery_runs` row with the actual
`cost_cents`; blocked runs are written with `cost_cents = 0`. No leak.

**Q4 — Is there a lock/transaction preventing a double-spend race?**
Yes, for the common case. `discover` runs inside `withContactDiscoveryAdvisoryLock(idempotencyKey)`
and **re-fetches + re-evaluates the cost guard inside the lock** before executing providers
(`wizmatch.ts:2348-2389`). Same-user, same-company double-click is fully serialized — the second
attempt sees the first's recorded spend. **Residual gap:** the lock key includes `userId`
(`tenant:company:user:day`), so two *different* users acting in the same instant don't share a lock
and could both pass the shared tenant/daily budget check. Bounded by the daily budget cap; narrow
window. (See P1 backlog item.)

**Q5 — What is the insertion path for manually-primed companies/requirements?**
`POST /requirements` (`wizmatch.ts:4414`) is a plain `INSERT INTO wizmatch_requirements` — it costs
nothing, calls no provider, and does not create a `wizmatch_job_signals` row. So manual priming of
requirements cannot bypass any spend gate, because it touches no spend path. The only way to feed
the (score-gated, free-enrich) signal pipeline is injecting `job_signals` directly via
`/signals/ingest`. Client-Discovery scoring is computed on read from company rows and persisted via
snapshot; it is advisory, not an enforced spend gate.

**Q6 — Any alert if all sending domains go unhealthy?**
No. The domain-health cron (`worker.ts:1475-1523`) updates each domain to `warn` or `healthy` and
emits nothing to Slack. The mailer selects `status='healthy'` domains and, if none match, falls
back to **all** inboxes (`multiDomainMailer.ts:65-70`) — sending never stops, and nobody is told.

---

## 3. Verified tunable reference (corrects the brief's §2)

All values below are read from `wizmatchCostGuard.ts:85-105` (paid-discovery cost guard).
**Note on units:** amounts are in *minor currency units* (paise for INR), i.e. `500000` ≈ ₹5,000.

| Env var | Default | Meaning |
|---|---|---|
| `WIZMATCH_COST_CURRENCY` | `INR` | Currency label for budgets. |
| `WIZMATCH_MONTHLY_DISCOVERY_BUDGET_CENTS` | `500000` (≈ ₹5,000) | Monthly paid-discovery budget. |
| `WIZMATCH_DAILY_DISCOVERY_BUDGET_CENTS` | `50000` (≈ ₹500) | Daily paid-discovery budget. |
| `WIZMATCH_MAX_PAID_RUNS_PER_TENANT_DAY` | `20` | Tenant-wide paid runs/day. |
| `WIZMATCH_MAX_PAID_RUNS_PER_USER_DAY` | `5` | Per-user paid runs/day. |
| `WIZMATCH_MAX_APOLLO_CALLS_PER_TENANT_DAY` | `50` | Apollo daily call cap (paid path only). |
| `WIZMATCH_MAX_SNOV_CALLS_PER_TENANT_DAY` | `50` | Snov daily call cap (paid path only). |
| `WIZMATCH_MAX_REACHER_CALLS_PER_TENANT_DAY` | `150` | Reacher daily call cap (paid path only). |
| `WIZMATCH_MAX_GOOGLE_FALLBACK_CALLS_PER_TENANT_DAY` | `25` | Google fallback daily call cap. |
| `WIZMATCH_APOLLO_COST_CENTS` | `1500` (≈ ₹15) | Assumed cost per Apollo call. |
| `WIZMATCH_SNOV_COST_CENTS` | `1000` (≈ ₹10) | Assumed cost per Snov call. |
| `WIZMATCH_REACHER_COST_CENTS` | `200` (≈ ₹2) | Assumed cost per Reacher check. |
| `WIZMATCH_GOOGLE_FALLBACK_COST_CENTS` | `100` (≈ ₹1) | Assumed cost per Google fallback. |

**Important caveat:** these caps and cost accounting govern **only** the paid Contact-Intelligence
path. The hourly enrich cron's Apollo/Snov calls (`emailExtractorService`) and the X-Ray SerpAPI
calls are **not** counted against any of the above.

**Signal pipeline status ladder** (automatic except the final send):
`new → scored → enriched → matched → drafted → sent`. Enrichment + Slack lead-alert both fire at
**score ≥ 7** (`worker.ts:1430`, scoring in `wizmatchScoring.ts`). Cron cadence unchanged from the
system docs (score 30 min, enrich hourly, match 2 h, domain-health hourly, warmup 6 h, ATS daily,
X-Ray daily, GitHub daily, LCA weekly, digest daily).

---

## 4. Prioritized backlog (recommendations only — nothing built here)

### P0 — Meter the free enrich Apollo/Snov cascade
- **Problem:** `emailExtractorService` calls Apollo (`:71-77`) and Snov (`:80-86`) on the same
  credentials as paid discovery, with no counter. The enrich cron can fire ≤20/hr on score-≥7
  signals and silently exhaust the quota the cost guard assumes is available.
- **Fix sketch (pick one):**
  - **(a) Cheapest & safest:** drop Apollo/Snov from the *enrich* path entirely and rely on
    website-scrape → MX-guess → Reacher-verify → Google SERP (all self-hosted/free), reserving the
    paid Apollo/Snov quota for the manual Contact-Intelligence path.
  - **(b) Meter it:** route the enrich cron's Apollo/Snov calls through a shared daily counter
    (extend `wizmatchCostGuard` provider accounting, or add a small `wizmatch_provider_usage`
    table), with a hard daily cap + Slack alert on exhaustion.
- **Files:** `src/services/emailExtractorService.ts`, `src/routes/wizmatch.ts` (`/signals/:id/enrich`),
  `src/services/wizmatchCostGuard.ts`. **Severity: high. Effort: M.**

### P0 — All-domains-unhealthy Slack alert (decision: **alert + keep sending**)
- **Problem:** no alert when domains degrade; mailer keeps sending from `warn`/unmatched domains.
- **Fix sketch:** in the domain-health cron (`worker.ts:~1475`), after recomputing statuses, if
  0 domains are `healthy` (or a domain flips `healthy→warn`), post to `WIZMATCH_SYSTEM_CHANNEL`.
  **Preserve** the mailer's fallback-to-all send behavior (per decision). Optionally fold the
  already-computed SPF/DMARC failures into a `warn` reason so the alert is actionable.
- **Files:** `src/worker.ts` (domain-health cron). Optional one-shot alert when the mailer hits its
  fallback branch: `src/services/multiDomainMailer.ts:68`. **Severity: high (reputation). Effort: S.**

### P1 — Tenant-scope the discovery advisory lock
- **Problem:** lock key includes `userId`, leaving a narrow cross-user tenant-budget race.
- **Fix sketch:** acquire a second advisory lock keyed on `tenant:day` (or drop `userId` from the
  serialization key while keeping it in the audit record) so the tenant-budget check→spend→record
  is serialized across users.
- **Files:** `src/routes/wizmatch.ts:2348`, `src/services/wizmatchCostGuard.ts:295`.
  **Severity: medium (bounded by daily cap). Effort: S.**

### P1 — X-Ray SerpAPI monthly counter + hard stop + alert
- **Problem:** only guard is `maxQueries=3/day` in code; a manual dispatch or misfire can burn the
  SerpAPI monthly quota with no internal backstop.
- **Fix sketch:** persist a monthly SerpAPI call counter; hard-stop + Slack alert near the cap.
- **Files:** `src/services/wizmatchXrayScraper.ts` (+ shared counter). **Severity: medium. Effort: S.**

### P1 — Cross-source candidate dedupe/reconciliation
- **Problem:** X-Ray candidates are stored with no email, so `findOrCreateContact` (which dedupes on
  `(channel_type, channel_value)`) can't reconcile them against a later GitHub/manual record that
  surfaces the same person *with* an email → duplicate shell candidates inflate the pool.
- **Fix sketch:** add a reconciliation pass keyed on `linkedin_url` (and name+location fallback) to
  merge emailless X-Ray shells when an email later appears for the same person.
- **Files:** `src/services/wizmatchXrayScraper.ts`, `wizmatchGithubMiner.ts`,
  `wizmatchCandidateIntake.ts` + a merge helper. **Severity: medium. Effort: M.**

### P2 — Draft reuse before regenerating
- **Problem:** re-clicking "Generate drafts" makes 3 fresh Sonnet calls with no reuse.
- **Fix sketch:** if unsent `status='draft'` variants already exist for the signal, return them and
  only regenerate on an explicit "regenerate" intent.
- **Files:** `src/routes/wizmatch.ts:3107`. **Severity: low. Effort: S.**

### P2 — Client-Discovery pass-rate monitoring
- **Problem:** if most signals/companies score hot/warm, the gate isn't actually filtering, and
  nobody would notice.
- **Fix sketch:** log the hot/warm pass-rate periodically; alert if it exceeds a threshold so the
  scoring weights get reviewed rather than trusted.
- **Files:** digest cron in `src/worker.ts` or a small weekly check. **Severity: low. Effort: S.**

### P2 — Cost-per-qualified-reply analytics
- **Problem:** scoring weights (H-1B count, contract keywords, repost count) are heuristics with no
  feedback loop against actual outcomes.
- **Fix sketch:** extend `wizmatchRoiAnalytics.ts` to divide `wizmatch_discovery_runs.cost_cents`
  (and enrich/send volume) by positive replies, per source/region, so the heuristics can be tuned.
- **Files:** `src/services/wizmatchRoiAnalytics.ts`. **Severity: low (measurement). Effort: M.**

### Deferred / product — GitHub public-email ceiling & source diversification
- The GitHub miner keeps only candidates with a public email, structurally capping yield. Either
  add a light enrichment pass for skill/location-matched emailless profiles, or diversify sourcing
  (Wellfound, Stack Overflow) rather than over-indexing on one source's limit. Product decision,
  larger scope — not a cost leak.

---

## 5. Non-issues (documented, no action)

- **Match cron cost** — bounded by `LIMIT 40` + top-3 + 30 signals/run + GIN indexes. Monitor only.
- **Draft-on-page-load** — does not happen; drafts are button-triggered.
- **Dice/Naukri CI burn** — manual-dispatch only; no schedule; zero ongoing cost.
- **Requirement priming** — raw insert, no provider call, no signal creation, no spend.
- **Env-check ordering** — correct as-is: provider-config check blocks (503) before any spend.

---

## Evidence index (file:line)

- Advisory lock + in-lock re-check: `src/routes/wizmatch.ts:2348`
- Discover / preview / review routes: `src/routes/wizmatch.ts:3303 / 2276 / 2200`
- Cost guard config + defaults: `src/services/wizmatchCostGuard.ts:85-105`
- Cost guard env-check-first + block order: `src/services/wizmatchCostGuard.ts:264-283`
- Usage reconstructed from discovery_runs (plain SELECT, no row lock): `src/services/wizmatchCostGuard.ts:180-220`
- Idempotency/lock key composition: `src/services/wizmatchCostGuard.ts:295`
- Enrich cron gating: `src/worker.ts:1427-1448` (select `:1430`)
- Free enrich cascade Apollo/Snov: `src/services/emailExtractorService.ts:71-86`
- X-Ray scraper quota/rotation: `src/services/wizmatchXrayScraper.ts:135,151`
- Draft route (no reuse guard): `src/routes/wizmatch.ts:3107`; draft buttons: `admin/src/pages/WizmatchReviewQueuePage.jsx:79`, `admin/src/pages/WizmatchSignalsPage.jsx:282`
- Matching bounded query: `src/services/wizmatchMatching.ts:61-77,134`
- Send route + suppression check: `src/routes/wizmatch.ts:3226`, suppression `:3269`
- Domain-health cron (warn/healthy only, no alert): `src/worker.ts:1475-1523` (status `:1511`)
- Mailer healthy-select + fallback-to-all: `src/services/multiDomainMailer.ts:55-70`
- Requirements raw insert: `src/routes/wizmatch.ts:4414`
