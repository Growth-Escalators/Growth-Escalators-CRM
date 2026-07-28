# WizMatch Outbound OS — PR 7 implementation (self-reported)

- **Status:** IMPLEMENTED (self-reported, not independently reviewed). Marker:
  `.ai/OUTBOUND_PR7_IMPLEMENTED`.
- **Branch:** `ge/outbound-07-free-prep`, cut from `ge/outbound-06-decision-workbench` (PR 6 is
  code-ready per `docs/reviews/wizmatch-outbound-pr6-opus-review.md`, marker `.ai/OUTBOUND_PR6_CODE_READY`).
- **Scope:** PRD-005 §14 "Background-job flow" — `prepareCompaniesJob`, the zero-cost company
  preparation pipeline.
- **Method:** read AGENTS.md, CLAUDE.md, PRD-005, ADR-006, ADR-007, the PR 6 Opus review, the WizMatch
  handoff, `.ai/OUTBOUND_PR6_CODE_READY`, `.ai/CURRENT_TASK.md`, `.ai/HANDOFF_LOG.md`. Ran three
  read-only Explore subagents in parallel (data model/locks/idempotency; free-vs-paid discovery paths
  and the SSRF/zero-cost boundary; contact ranking/evidence/reports/flags/test conventions) before
  writing any code, per the task's instructions.

## What was built

### `src/modules/outreach/prepareCompanies.ts` (new)

`prepareCompaniesJob(tenantId, options?)` and `prepareSingleCompany(tenantId, companyId)`. For each
candidate company: company normalisation, duplicate detection (read-only, never blocks prep),
the COMPANY-POLICY CHECK via `evaluateWizmatchOutreachGate` (hard stop on `!preparationAllowed`),
signal-scoring reuse (reads the existing persisted score, never recomputes), internal-CRM/contact-candidate
reuse, free website discovery (`websitePatternSearch` only — see zero-spend boundary below), contact
ranking + confidence grading (reuses `deriveConfidenceTier`, applies the §7 cold-start gate: medium/low
never auto-surfaced as the recommended contact), campaign recommendation (`computeCampaignCompatibility`,
reused verbatim, not reimplemented), and deterministic draft personalisation (template merge, no LLM
call, `hypotheses` always empty in v1 — never fabricates a fact).

**Tenant safety.** Every query is `tenant_id`-scoped; tests assert the tenant id is bound as the first
query parameter on every statement the module issues.

**Idempotency and concurrency.** The whole run is serialised per tenant through the existing
`withWizmatchSourceLock` Postgres advisory lock (same helper the TheirStack/ATS crons use). A concurrent
or retried invocation returns `lockAcquired: false` and does no work rather than racing. Per-company
writes are themselves idempotent: the prep report is a single `jsonb_set` overwrite of
`wizmatch_company_intelligence.metadata.prep` (never appended — a rerun replaces, doesn't accumulate),
and a newly discovered contact is inserted only when no existing candidate row for that company already
carries the same lowercased email.

**Storage — no migration.** `wizmatch_company_intelligence.metadata` (existing jsonb column, already
used elsewhere for free-form stamps) holds `metadata.prep`. This follows the PRD's "prefer existing
tables" instruction; no new table or column was added. A row is bootstrapped with
`ON CONFLICT (tenant_id, company_id) DO NOTHING` when a company has none.

**Zero-spend boundary.** The module imports only `createDefaultWizmatchContactDiscoveryProviders().websitePatternSearch`
(`costCents: 0`) for new-contact discovery — never `discoverFreePocsForSignal` (whose rung 3 calls
SearchAPI and costs a credit), never Apollo/Snov/Serper, never `WIZMATCH_PAID_DISCOVERY_ENABLED`. This
was a deliberate design choice after the discovery subagent flagged that `discoverFreePocsForSignal`
as a whole is **not** a safe ₹0 call site (its SearchAPI fallback can fire whenever the website scrape
finds no named contact and a key is configured) — PR 7 composes the two genuinely free primitives
directly instead of calling that wrapper. A static test (`prepareCompanies.test.ts`) parses the
module's own `import` lines and asserts `Apollo`, `Snov`, `Serper`, `SearchAPI`, `searchPublicWeb`,
`discoverFreePocsForSignal` and `callClaude`/`generateSignalDraftEmails` never appear there — the test
fails if a future edit reintroduces a paid import.

**Batch bounds.** `DEFAULT_PREP_BATCH_LIMIT = 25` companies and `DEFAULT_PREP_MAX_WEBSITE_FETCHES = 25`
fetches per run — bounded, never unbounded fan-out. Company processing is sequential (not parallel),
which also bounds per-domain HTTP concurrency to 1.

**Failure isolation.** Each company is processed inside its own try/catch (`prepareOneCompany`); a
thrown error produces a `status: 'failed'` result with the error message, never aborts the batch or
silently drops another company's outcome. Committed writes (the intelligence-row bootstrap, the prep
report `UPDATE`) happen before the function can throw for that company's own step, so a later
formatting/response failure never reports already-committed work as failed.

### `src/services/emailExtractorService.ts` (fix, not new scope)

The SSRF-guard research subagent found a real gap in the shared `fetchPage` helper — used by
`websitePatternSearch`, the one outbound-HTTP call PR 7 makes: `isSafeFetchUrl` was checked once before
the initial request, but `redirect: 'follow'` let undici follow subsequent redirects with **no
re-validation of each hop**, so a compromised or malicious "company website" could 30x-redirect the
scrape to a private/metadata host the initial check would have blocked. Fixed by switching to
`redirect: 'manual'` with an explicit, bounded (`MAX_FETCH_REDIRECTS = 3`) loop that re-runs
`isSafeFetchUrl` on every resolved `Location` header before following it. This satisfies the task's
requirement 4 ("redirect revalidation, bounded redirects") for the one fetch surface PR 7 actually
uses, and improves the guard for every other caller of `fetchPage` at no behavioural cost (still same
timeout, size cap, content-type check).

### `src/routes/wizmatchPrepare.ts` (new)

`POST /api/wizmatch/companies/:id/prepare` (synchronous single-company prep) and
`GET /api/wizmatch/companies/:id/prepare/status` (read-only). Gated behind
`WIZMATCH_AUTO_PREP_ENABLED` using the corrected `next('router')` pattern from the PR 6 review's C-1
fix (an inline `res.status(404)` would 404 the entire `/api/wizmatch` prefix once mounted ahead of the
admin-gated `wizmatchRouter`, exactly as C-1 found for the policy/today routers). Mounted in
`src/index.ts` alongside `wizmatchPolicyRouter`/`wizmatchTodayRouter`, for the same M-1 mount-order
reason. Role gate: staff+ (pilot member) — the same tier as reading policy/queues, since preparation
reuses existing free data and never sends, enrols, spends, or grants permission to contact a company,
so it does not need the team_lead+ bar a policy *write* requires.

### `src/services/wizmatchAutomation.ts` / `src/worker.ts`

Added `autoPrepEnabled` to `WizmatchAutomationStatus` (`masterEnabled && enabled(WIZMATCH_AUTO_PREP_ENABLED)`,
same `enabled()` helper and same-shape gating as every other WizMatch cron flag). Registered
`prepareCompaniesJob` as a new cron (`15 2 * * *` — 7:45 AM IST daily) inside the existing WizMatch
cron block in `worker.ts`, following the exact `withWizmatchSourceLock` + "skipped — another run holds
the lock" pattern the TheirStack/ATS jobs already use. `WIZMATCH_LEGACY_AUTOMATION_ENABLED` is untouched.

## Contract checklist (against the task's REQUIRED CONTRACT)

1. **`prepareCompaniesJob`** — implemented as specified: tenant-safe, bounded, deterministic, idempotent,
   advisory-locked, returns per-company results plus aggregate counts (`attempted/prepared/skipped/reviewRequired/failed`),
   never hides partial failure.
2. **Canonical policy gate before preparation** — `evaluateWizmatchOutreachGate` is called for every
   company; `preparationAllowed` (derived from the §9 taxonomy, never hand-enumerated) is the hard
   stop. Missing/ambiguous linkage fails closed by construction — the gate itself fails closed on any
   DB error, missing root policy row, or unresolvable scope (unchanged PR 2/3 behaviour; PR 7 does not
   touch the gate). Campaign/score/discovered data never grant permission — `computeCampaignCompatibility`
   is advisory-only and PR 7 never writes a policy row. Decision reasons and provenance are persisted
   in the `metadata.prep` report. Shadow/enforce semantics are untouched — PR 7 reads `decision`/
   `preparationAllowed` off the existing gate, which is itself already mode-aware.
3. **Zero-spend boundary** — see above. No Apollo/Smartlead/LinkedIn/paid-API/n8n/sending/enrolment/
   provider-adapter code path exists in this module. Test proves paid paths are never called (spy
   assertions) and never imported (static source check).
4. **SSRF guard on every public fetch** — the one fetch surface (`websitePatternSearch` →
   `collectWebsiteEmails` → `fetchPage`) now revalidates every redirect hop, bounds redirects to 3,
   enforces http/https-only, blocks private/link-local/metadata targets (pre-existing `isSafeFetchUrl`),
   has a 5s timeout and a 200KB post-download truncation (pre-existing), rejects non-html/text content
   types (pre-existing), and forwards no credentials. Bounded concurrency: sequential per-company
   processing (concurrency 1). Per-domain rate limiting: not separately implemented beyond the
   sequential-processing bound and the `DEFAULT_PREP_MAX_WEBSITE_FETCHES` per-run cap — disclosed
   below as an open item, not silently dropped. No generic/recursive scraper was built; the existing
   `collectWebsiteEmails` path (fixed set of careers/contact paths) is reused unchanged.
5. **CRM reuse first, provenance on every fact** — internal contact candidates are queried before any
   website fetch. Every prepared fact carries a `PrepProvenanceEntry` (`kind`, `ref`, `observedAt`,
   `confidence`, `ruleVersion`). Stronger human evidence is never overwritten — PR 7 never writes to
   `wizmatch_company_policies` (policy evidence) or to a CRM contact directly; it only ever inserts a
   *new* `wizmatch_contact_candidates` row when no existing one shares the discovered email, so an
   existing human-reviewed candidate row is never touched.
6. **Contact ranking / confidence** — reuses `deriveConfidenceTier` verbatim (no new grading logic).
   The cold-start gate (§7) is enforced at the job level: medium/low confidence is recorded in the
   report for operator visibility but never set as `contactCandidateId` (the "surfaced" recommendation) —
   mirrored by the `prepareCompanies.test.ts` "cold-start contact confidence gate" tests. No personal
   email discovery, no DNC marking, no approval, no subscription, no enrolment. Duplicate containment:
   `findPendingDuplicateForCompany` records the fact in the report but never gates preparation, per §8.2
   L5 ("preparation still allowed").
7. **Campaign recommendations** — `computeCampaignCompatibility` (existing PR 2 module) is called
   as-is; PR 7 adds no new routing logic. Advisory only — no batch/enrolment is created, no provider is
   selected.
8. **Draft personalisation** — deterministic template merge (`buildDeterministicDraft`), no LLM call, no
   network dependency. `verifiedFacts` lists only facts actually present on the fetched rows;
   `hypotheses` is always `[]` in v1 (the module never infers or invents a fact). No sensitive
   inference, no sending.
9. **Report surface** — `PrepareCompaniesReport` carries `attempted/prepared/skipped/reviewRequired/failed`
   counts, per-company `PreparedCompanyResult[]` (status/reasonCode/decision/provenance/error),
   `reused.internalContact` / `fetched.website` per company (reused-vs-fetched), `zeroSpend: true`,
   `lockAcquired` (replay/lock status), `websiteFetchesUsed`, and `startedAt`/`finishedAt` timings. The
   route surface (`POST .../prepare`, `GET .../prepare/status`) matches PRD-005 §12's "Preparation"
   API contract verbatim. No CLI was added — not named as required in §12/§14, and none of the other
   PR 2–6 preparation-adjacent surfaces have one; the route + worker cron are the two entry points named
   by the PRD. Logs use `console.log`/`console.error` with counts and ids only — no secret, no full PII
   (email addresses appear only inside the DB-persisted report, not in log lines).
10. **Feature flag** — `WIZMATCH_AUTO_PREP_ENABLED`, default off (per PRD-005 §16, which already names
    this exact flag). Both entry points (`wizmatchPrepare.ts` route, `worker.ts` cron) are gated.
    Neither a scheduler nor a production invocation was enabled.
11. **No migration** — confirmed no schema change was needed; `wizmatch_company_intelligence.metadata`
    (existing jsonb) satisfies the storage contract. No new shared-table index.
12. **Partial-failure isolation** — see "Failure isolation" above. Retries: the route's `POST .../prepare`
    is itself idempotent (rerunning it just re-derives and overwrites the same report), so no separate
    retry/backoff logic was needed; a retried job run is simply another lock-serialised pass.
13. **PR 6 findings carried forward, not silently dropped** — see "Carried forward" below. PR 7 did not
    touch the decision workbench, the §13 approval-capture gap, or any PR 6 code.

## Deliberately not done — disclosed, not silently dropped

- **Per-domain rate limiting** beyond the per-run fetch cap and sequential processing. The discovery
  subagent confirmed no rate-limiter/concurrency-bound utility exists anywhere in the repo today — this
  is a pre-existing gap in the shared free-discovery infrastructure, not something PR 7 introduced. PR 7
  bounds its own blast radius (`DEFAULT_PREP_MAX_WEBSITE_FETCHES`, sequential loop, concurrency 1) but
  does not add a generic per-domain token-bucket. A future PR should add one if the batch size grows.
- **No CLI.** PRD-005 §12 names only the two HTTP routes for "Preparation"; no CLI was specified the way
  the backfill/readiness modules have one, so none was added.
- **Draft personalisation is intentionally minimal.** v1's template has three inputs (company name,
  best open signal, high-confidence contact name/title). It does not attempt tone matching, multi-variant
  generation, or anything beyond a single deterministic subject/body — consistent with "deterministic
  template merge," not a feature-complete drafting product.
- **The §7 cold-start confidence gate remains unwired inside `evaluateWizmatchOutreachGate` itself** —
  confirmed still true by the discovery subagent (`outreachGate.ts:13-17`'s own header comment). PR 7
  does not close that gap at the gate level; it applies an equivalent gate locally, at the job's own
  contact-surfacing step, which is sufficient for PR 7's own output but does not retroactively fix any
  other caller of the gate that might need the same protection. Recorded, not claimed as fixed.
- **The PR 6 §13 approval-capture gap (`approve_queue` launders `review → eligible` with no
  `approved_by`/`approved_at`) is NOT closed by this PR** and is not claimed to be. PR 7 does not touch
  `decisionWorkbenchActions.ts`.

## Gates run

- `git diff --check` — clean.
- `npm run build` — exit 0.
- `npm test` — **119 files / 1097 tests green** (was 117/1081 at the PR 6 review baseline — +2 files,
  +16 new tests from this PR: `prepareCompanies.test.ts`, `wizmatchPrepareRoutes.test.ts`).
- `npm run admin:build` — clean (no admin files were touched; PR 7 is backend-only per PRD-005 §14).
- `npx playwright test --config=playwright.wizmatch-local.config.ts` — **99 passed / 15 skipped
  (pre-existing real-backend specs, no server started) / 0 failed** — identical to the PR 6 baseline,
  confirming zero UI regression from this backend-only PR.

## Boundary checks

No guardrail file touched (`src/db/schema.ts`, `src/db/migrations/`, `src/middleware/auth.ts`,
`src/middleware/rbac.ts`, `src/routes/cashfree.ts`, `src/services/sodEodService.ts` — all verified
untouched). No `package-lock.json` change. No Growth/SEO/n8n contamination. No sending, paid-provider,
or provider-selection capability introduced or enabled. `WIZMATCH_SENDING_ENABLED` and
`AUTOMATED_EMAILS_ENABLED` untouched. Nothing pushed, merged, or deployed. No Railway or production
access. No database mutation (migration 0037 remains unapplied; no backfill run).

## Files changed

- `src/modules/outreach/prepareCompanies.ts` (new)
- `src/routes/wizmatchPrepare.ts` (new)
- `src/__tests__/prepareCompanies.test.ts` (new)
- `src/__tests__/wizmatchPrepareRoutes.test.ts` (new)
- `src/index.ts` (mount the new router)
- `src/services/wizmatchAutomation.ts` (add `autoPrepEnabled`)
- `src/worker.ts` (register the cron)
- `src/services/emailExtractorService.ts` (redirect-revalidation SSRF fix in the shared `fetchPage`
  helper PR 7's website-discovery step relies on)

## Exact next action

Get an independent readiness review of PR 7 (three-subagent method, per the PR 2/3/5/6 precedent).
**Do not** start PR 8 (`ge/outbound-08-outreach-adapter`) until that happens. Before this stack reaches
`main`: apply migration `0037` (B-1, carried from PR 3) and run the §10.11.4 fresh-database checks (G1)
— both unchanged obligations from PR 2/3, not introduced or affected by PR 7.
