# WizMatch Outbound OS — PR 7 independent code-readiness review

- **Branch:** `ge/outbound-07-free-prep` · **Parent:** `ge/outbound-06-decision-workbench`
- **Submitted at:** `ac2c2b06` ("feat(wizmatch): PR 7 — zero-cost company preparation")
- **Reviewed (fix HEAD):** `70c310b5`
- **Reviewed at:** 2026-07-26T22:36:59Z
- **Verdict:** **NOT READY as submitted at `ac2c2b06`; READY at `70c310b5`** after twelve fixes made
  during this review — five High, seven Medium. None was visible to the five gates the implementing
  session ran; all five gates reproduced exactly, so the `IMPLEMENTED` marker did not overstate itself.
- **Method:** three parallel read-only Explore subagents (tenancy/policy/locking/idempotency;
  zero-cost/SSRF/evidence/confidence/provider-boundary; tests/reports/flag/retries/scope) plus an
  independent hand review by the lead. All three reports returned and were reconciled before this
  verdict. Every fix has a control run proving its new test fails on the defect.

---

## 1. Scope of the change

`git diff ge/outbound-06-decision-workbench..HEAD` at submission: 13 files, +1600/−20.
Backend only — new `src/modules/outreach/prepareCompanies.ts`, new `src/routes/wizmatchPrepare.ts`,
a new default-off cron in `src/worker.ts`, an `autoPrepEnabled` field in `src/services/wizmatchAutomation.ts`,
a redirect-revalidation fix in `src/services/emailExtractorService.ts`, and two new test files.
No migration — reuses `wizmatch_company_intelligence.metadata.prep`.

---

## 2. Findings and dispositions

### High (all fixed in `70c310b5`)

**H-1 — PR 6's H-4 reintroduced: confidence read from the wrong envelope.**
`prepareCompanies.ts` called `deriveConfidenceTier(contact.metadata ?? undefined, …)`. That function
reads the grader's verdict off `raw?.confidenceTier`, and the repo-wide envelope for
`wizmatch_contact_candidates.metadata` is `{ reasons, providerCostCents, discoveryRunId, raw: {…} }`
(`wizmatchContactIntelligenceRepo.ts:1432`). PR 6 fixed exactly this in `decisionWorkbench.ts:238`
and left a comment saying so. Passing the whole column makes `raw?.confidenceTier` `undefined` for
every canonically-written row, silently falling back to the numeric heuristic.
*Failure:* a contact deliberately graded `low` (e.g. downgraded for a catch-all domain) whose
`confidence_score` column sits at 8+ is graded `high`, surfaced as the recommended contact, marked
`prepared`, and has its name written into the draft's `verifiedFacts` — the §7 cold-start gate defeated.
The PR's own test encoded the wrong shape (`metadata: { confidenceTier: 'high' }`), so it could never
have caught this. **Fixed**; test now uses the real shape plus a control case (`raw.confidenceTier:'low'`
with score 10) that fails on the old code.

**H-2 — the discovered-contact write used a non-canonical metadata envelope.**
The INSERT wrote `JSON.stringify(best.raw ?? {})` — the provider's `raw` object *as* the metadata
column. Every correct reader (`mapPersistedCandidate`, `decisionWorkbench.ts`) looks under
`metadata.raw` and finds nothing, so `confidenceTier`, `roleCategory`, `team` and `mxProvider` are
silently dropped for every row PR 7 creates. Masked today only because the provider's numeric
`confidenceScore` happens to agree with the fallback thresholds — a coincidence, not an invariant.
**Fixed** to `{ reasons, providerCostCents, raw }`.

**H-3 — a policy-denied company was reported `prepared`.**
`status` demoted to `review_required` only on `decision.decision === 'review'`. But
`preparationAllowed` is deliberately `true` for many `deny` codes — `policy_paused_by_owner`,
`manual_block_by_operator`, `signal_role_irrelevant`, `relationship_competitor` — only six codes stop
preparation. So an owner-paused or operator-blocked company with a high-confidence contact was
reported `status: 'prepared'` with a full send-ready draft, in the same report where
`campaignRecommendation.decision` said `deny`. `prepared` is the exact word §13 uses for the Ready to
Contact precondition. **Fixed** to `decision.decision !== 'allow'`.

**H-4 — a medium-confidence contact was reported `prepared`.**
PRD-005 line 1948 is explicit: "high → Ready; medium → Needs Review; low/unverified cannot be
queued". The code surfaced both high and medium, then only demoted `low`. **Fixed** to
`confidenceTier !== 'high'`. (Note: *surfacing* medium is correct per §7 — it is the `prepared`
label that was wrong. The self-report's claim that "medium/low is never auto-surfaced" is false about
its own code, but the code's surfacing behaviour is right and the status label was the defect.)

**H-5 — the batch selector starved itself.**
Freshness was keyed on `metadata.prep.lastPreparedAt`, written only on the success path. A
policy-denied company (`skipped`, returns before any write) and a persistently erroring company
(`failed`, writes nothing) therefore never age out, and with a fixed `ORDER BY c.updated_at DESC
LIMIT 25` the same dead companies refill every run forever.
*Failure:* a tenant with 25+ permanently `no_external_agencies` companies never prepares any other
company, and the report looks identical every day. **Fixed** with a narrow attempt stamp
(`lastAttemptedAt` / `lastAttemptStatus`) written regardless of outcome, plus a selector and
`ORDER BY` that consume it. The stamp deliberately does **not** bootstrap an intelligence row for a
denied company — see O-1 for the residual.

**H-6 — the feature flag disagreed with itself (PR 6's M-D class, new flag).**
The cron gated on `enabled()` (`1|true|yes|on`); both routes required the exact string `'true'`.
*Failure:* an operator sets `WIZMATCH_AUTO_PREP_ENABLED=1` — the convention every other WizMatch cron
flag accepts — and the daily job starts scraping company websites and writing contact candidates
while `POST/GET .../prepare` stay 404, so the automated side runs and the surface used to inspect it
does not. **Fixed** by exporting one parser (`isWizmatchFlagEnabled`) and using it in both places.
Default-off is unchanged.

### Medium (all fixed in `70c310b5`)

| # | Finding | Fix |
|---|---|---|
| M-1 | Dedup was a read-then-write behind `ON CONFLICT DO NOTHING` with **no matching unique index** (`wizmatch_contact_candidates` has only non-unique indexes, migration 0021) — the clause could never fire, and the TOCTOU window is open against `poc_discovery`, which holds a *different* lock key and writes the same table | One `INSERT … WHERE NOT EXISTS`, the repo's existing idiom |
| M-2 | The INSERT omitted `company_intelligence_id`, which every canonical insert sets | Set via a tenant-scoped scalar subquery |
| M-3 | A website-scraped contact got an `internal_crm` provenance entry *as well as* `website_scrape`, claiming CRM corroboration that did not exist | `internal_crm` only when the contact was genuinely reused |
| M-4 | The draft greeted a published role inbox by "first name" (`websitePatternSearch` synthesises `name` as "<team> (inbox)") and asserted it in `verifiedFacts` as a person | Personal greeting suppressed for `website_manual_pattern` rows |
| M-5 | `DEFAULT_PREP_MAX_WEBSITE_FETCHES` / `websiteFetchesUsed` understated the outbound surface ~11× — one `websitePatternSearch` walks 11 `DISCOVERY_SCRAPE_PATHS` plus an MX lookup, so 25 "fetches" is up to 275 GETs | Renamed to `…_MAX_WEBSITE_COMPANIES` / `websiteScrapedCompanies`, documented explicitly |
| M-6 | The same counter dropped a scrape whose company later failed, understating real budget use | `fetchedWebsite` hoisted so the catch path reports honestly |
| M-7 | A 0-row prep-report `UPDATE` returned `prepared` with `error: null` — a report never persisted, reported as success | Throws, so the company is reported `failed` |
| M-8 | `zeroSpend: true` was a hardcoded literal typed `true`, not a measurement | Measured from the providers' own `costCents`; `observedCostCents` added |
| M-9 | `prepareSingleCompany` returned bare `null` for both "lock held" and "no such company", so the route answered **409** for a nonexistent company and a retry loop never terminated | Tagged outcome; 404 vs 409 |
| M-10 | The report named only the policy reason code, so `review_required` sat next to an *allow*-flavoured code with nothing naming the real cause; `computeCampaignCompatibility`'s own `reasonCode` was computed and discarded | `contactReasonCode` added from the §9 contact-quality codes; campaign `reasonCode` surfaced |
| M-11 | `reportVersion`/`ruleVersion` existed only inside the persisted per-company jsonb, not on the aggregate the cron logs and the route returns | Added to `PrepareCompaniesReport` |

### Test-quality defects fixed (the PR shipped these three gaps)

- **T-1** — `wizmatchIndexMountOrder.test.ts`, whose stated purpose is to catch the M-1/C-1 mount
  regression *mechanically*, was not extended to the new router. The new route test proves
  `next('router')` only on a synthetic bare app; it cannot see a future edit that moves the mount
  below the admin-gated `wizmatchRouter` in the real `index.ts`. **Extended**, including a
  flag-off-does-not-swallow-downstream case.
- **T-2** — the SSRF redirect-revalidation fix, the security-relevant core of the PR's §18.2 claim,
  shipped with **no test at all**; reverting `redirect: 'manual'` → `'follow'` left the suite green.
  **Four tests added** (metadata-host hop refused, `redirect: 'manual'` asserted, chain bound
  enforced, in-bound redirect still readable).
- **T-3** — the tenant-predicate assertions were vacuous: the mock checked only
  `params[0] === 'tenant-1'`, so deleting `WHERE c.tenant_id = $1` while leaving the bound parameter
  in place kept every test green (the PR 2 / PR 5 mock-vacuity finding, third recurrence).
  **Fixed** with a per-statement SQL-text assertion.

### Control runs

| Reverted fix | Failing tests |
|---|---|
| H-1 confidence envelope | 1 |
| H-2 metadata write envelope | 1 |
| H-3 + H-4 status derivation | 2 |
| H-5 starvation selector | 2 |
| H-6 flag parity | 4 |
| T-2 `redirect: 'manual'` → `'follow'` | 1 |

---

## 3. Open findings — NOT fixed, requiring an owner decision

**O-1 (Medium) — a denied company with no intelligence row still churns.**
H-5's attempt stamp deliberately never bootstraps a `wizmatch_company_intelligence` row, so a
policy-denied company that has never had one is not stamped and re-enters every batch. In practice
most companies acquire that row through the existing discovery flows, so the starvation is closed for
them. Closing it fully means deciding whether being *denied* may create an intelligence record as a
side effect. **Decide before enabling the cron with real data.**

**O-2 (Medium) — residual cross-job duplicate-contact race.**
M-1 makes PR 7's own insert atomic, but `poc_discovery` writes the same table under a *different*
advisory-lock key with its own non-atomic `WHERE NOT EXISTS`. Two concurrent runs can still each
insert the same scraped `careers@` address. Options: a partial unique index on
`(tenant_id, company_id, lower(email))` — a **migration**, out of PR 7's scope and blocked behind
0037; a shared lock namespace; or accept the residual. **Decide before G4.**

**O-3 (Medium) — RBAC tier for a write surface.**
`POST /companies/:id/prepare` writes (`wizmatch_contact_candidates` insert, `metadata.prep`
overwrite) and triggers outbound HTTP, and sits at staff+ via `wizmatchRequireStaffing`. Every other
write in this stack is team_lead+ per PRD-005 §4, whose table has **no row** for preparation — so
staff+ is the implementer's judgment call, not a PRD mandate. Left as built; **ratify or change
before real use.** Related and carried from PR 6: M-6, the `WIZMATCH_STAFFING_PILOT_USER_IDS` roster
is not enforced on these mounts, and PR 7 is the first place that gap applies to a **write**.

**O-4 (Low) — PRD §21 G5 calls this job "verified read-only".** It is not: it inserts contact
candidates and overwrites `metadata.prep`. Clarify the gate text so "read-only" is not misread as
"flipping the flag causes zero writes."

## 4. Open findings — recorded, pre-existing, not PR 7's to fix

- **P-1 (Medium)** — `fetchPage` buffers the entire response body via `await res.text()` before the
  200 KB slice. The cap is post-download, so a large body is fully buffered; the 5 s timeout is the
  only real bound. Unchanged by PR 7, but PR 7 makes this surface load-bearing (a daily cron over up
  to 25 companies × 11 paths).
- **P-2 (Medium)** — no per-domain rate limiter anywhere in the repo. Disclosed accurately by the
  self-report; sequential processing (concurrency 1) is the only throttle.
- **P-3 (Low)** — `isPreparationAllowed` returns `true` for an **unknown** reason code
  (`meta ? meta.prepAllowed : true`), i.e. the permission source fails *open* on an unrecognised
  code. Pre-existing in `wizmatchReasonCodes.ts`, not introduced here, but it is the one soft spot in
  "canonical policy is the only permission source".
- **P-4 (Low)** — DNS rebinding remains a residual SSRF risk, explicitly documented in `ssrfGuard.ts`
  and unfixable without socket-address pinning undici does not expose.
- **P-5 (Low)** — the static "no paid import" test only scans lines matching `/^\s*import\b/`, so
  `import * as x from …; x.discoverFreePocsForSignal()` or a dynamic `import()` would evade it. Moot
  today (the runtime spy test proves non-invocation, and only `websitePatternSearch` is called
  anywhere in the module), but it is weaker than it reads.

---

## 5. Verification of the required contract

| Requirement | Result |
|---|---|
| Canonical `policy`/`preparationAllowed` is the only permission source | **Yes.** `evaluateWizmatchOutreachGate` is the sole decision producer; no hand-rolled eligibility anywhere in the new code. The single place `decision.decision` was used to drive behaviour was the report's `status` label — H-3/H-4, now fixed. Correctly *not* gated by `WIZMATCH_POLICY_ENFORCEMENT_MODE`: shadow/enforce governs outreach actions, not preparation. Caveat P-3. |
| Tenant predicates on queries, mutations, locks, reports, keys | **Yes**, all statements; routes take `tenantId` from `req.user`, never from body/param; lock key is `wizmatch-source:${tenantId}:prepare_companies`. Now enforced by SQL-text assertion (T-3). |
| Concurrency/retry cannot duplicate contacts, evidence, reports, drafts | **Yes within the job** (advisory lock + atomic `WHERE NOT EXISTS` + jsonb overwrite). Residual cross-job race is O-2. |
| Paid and unknown providers fail closed and are never called | **Yes, in executable code.** `createDefaultWizmatchContactDiscoveryProviders()` has no construction side effects; `websitePatternSearch` (`costCents: 0`) calls only a free DNS MX lookup and SSRF-guarded scrapes with **no** internal fallback to any paid rung and no consultation of `WIZMATCH_PAID_DISCOVERY_ENABLED`. No dynamic/string-keyed provider dispatch exists, so there is no unknown-provider selection vector. Now also **measured** at runtime (M-8), not just asserted. |
| SSRF: initial URL + redirects, timeout, size, type, redirect, concurrency, rate limits | **Initial URL, every redirect hop, redirect bound (3), timeout (5 s), content-type, protocol, userinfo, obfuscated-IP canonicalisation, private/link-local/metadata ranges, concurrency 1: present.** Size cap is post-download (P-1); per-domain rate limit absent (P-2); DNS rebinding residual (P-4). Redirect logic now has tests (T-2). |
| CRM-first reuse real and measured; weak automation cannot overwrite strong human evidence | **Yes.** Internal reuse is tried first and `reused.internalContact` reports it. The job is insert-only on contacts, never `UPDATE`; the reuse query excludes `rejected`/`do_not_contact`, and the dedup guard is status-blind, so a human rejection cannot be resurrected under a new row. No policy row is ever written. Provenance now names the true source (M-3). |
| Uncertain/mismatch taxonomy and confidence thresholds correct | **Now yes** (H-1, H-4, M-10). `contact_role_uncertain` / `contact_role_confirmed_mismatch` are still unused by this module — no role-verification step exists in §14, so this is a scope limit, not a defect. |
| Email evidence never becomes role/company permission | **Yes.** A scraped address cannot change `preparationAllowed`, write a policy row, or set an eligible status; nothing outside this module reads `metadata.prep`. M-4 closed the one place a scraped inbox was being narrated as a named person. |
| Recommendation and personalisation are deterministic advisory drafts only | **Yes.** No LLM import, no network call in either; `hypotheses` always `[]`; the draft is persisted only into `metadata.prep`, which has no consumer and no send path. |
| Partial failures and retries honest, bounded, deduplicated | **Now yes** (M-6, M-7, H-5). Per-company isolation was already correct. |
| Approved feature flag defaults off and gates every entry point | **Yes**, and now *consistently* (H-6). `next('router')` confirmed, mount order confirmed, and both now pinned mechanically (T-1). |
| Reporting includes safe counts/provenance/lock/replay details | **Now yes** (M-5, M-8, M-10, M-11). |
| Tests non-vacuous; preserve predicates, provider identity, limits | **Now yes** (T-1, T-2, T-3), with six control runs. |
| No PR 8 adapter, Smartlead, sending, paid discovery, migration/backfill, unrelated work | **Confirmed.** `git diff --stat` against `src/db/`, `src/middleware/`, `src/routes/cashfree.ts`, `src/services/sodEodService.ts`, `package-lock.json`, `admin/`, `client/`, `scripts/` is empty. Every "Smartlead/Apollo/Snov/--apply" hit in the diff is documentation prose. |
| PR 6 Medium/Low findings not falsely marked closed | **Confirmed.** No PR 6 M-*/L-* item is claimed closed in `.ai/CURRENT_TASK.md`, `.ai/HANDOFF_LOG.md`, the status handoff, or the PR 7 implementation report. M-D's *class* recurred on a new flag (H-6) and is now closed for `WIZMATCH_AUTO_PREP_ENABLED`; **M-D itself, on `WIZMATCH_DECISION_WORKBENCH_ENABLED`, remains open.** |

---

## 6. Self-report claims found false

1. **"medium/low never auto-surfaced as the recommended contact"** — false about its own code; the
   code surfaced medium (correctly, per §7). The real defect was the `prepared` label (H-4).
2. **"`DEFAULT_PREP_MAX_WEBSITE_FETCHES = 25` fetches per run"** — a scrape walks 11 paths, so the
   real ceiling is ~275 GETs plus 25 MX lookups (M-5).
3. **"never hides partial failure"** — true per company, but `fetched.website` and the aggregate
   dropped a scrape whose company later failed (M-6), and a 0-row report write was reported as
   success (M-7).
4. **"a concurrent or retried invocation … does no work rather than racing"** — true only for the
   same lock name; `poc_discovery` writes the same table under a different key and was not mentioned
   (M-1 / O-2).
5. **"gated end-to-end behind `WIZMATCH_AUTO_PREP_ENABLED`"** — both entry points check the flag, but
   they disagreed on when it is on (H-6).

## 7. Gates — run for real on `70c310b5`

| Gate | Result |
|---|---|
| `git diff --check` | clean |
| `npm run build` | exit 0 |
| `npm test` | **119 files / 1119 tests passed** (baseline at `ac2c2b06`: 119 / 1097 — +22) |
| `npm run admin:build` | exit 0 |
| `npx playwright test --config=playwright.wizmatch-local.config.ts` | **99 passed / 15 skipped / 0 failed** |

The submitted tree's five gates were re-run first and reproduced exactly (119/1097), confirming the
`IMPLEMENTED` marker's numbers.

## 8. Blockers

**Before PR 8:** none. PR 8 (`ge/outbound-08-outreach-adapter` — interface + mock + factory, no
Smartlead) may start from `70c310b5`.

**Before enabling `WIZMATCH_AUTO_PREP_ENABLED` anywhere with real data:** O-1 (denied companies with
no intelligence row still churn), O-3 (ratify staff+ on a write surface, and PR 6's M-6 pilot roster),
O-4 (correct §21 G5's "read-only" wording).

**Before G4 / `enforce`:** O-2 (cross-job duplicate race), plus everything already carried — PR 6's
M-A, M-B, M-D, the §13 approval-capture gap (`approve_queue` has no `approved_by`/`approved_at`),
M-2…M-16, L-1…L-8, and U-7, U-9, O-1 from PR 3.

**Before this stack reaches `main`:** **B-1 — apply migration `0037`.** The repo auto-deploys on push.
Then the §10.11.4 fresh-database checks (G1).
