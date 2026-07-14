# Wizmatch Staffing OS — Defect and Remediation Register

- **Status:** Canonical current remediation register
- **Updated:** 2026-07-14
- **Evidence source:** [`../reviews/wizmatch-client-funnel-audit-2026-07-12.md`](../reviews/wizmatch-client-funnel-audit-2026-07-12.md)
- **Product target:** [`../prd/004-wizmatch-staffing-operating-system.md`](../prd/004-wizmatch-staffing-operating-system.md)

This register tracks the dated audit findings without turning its suggested fixes into automatic
implementation authority. Current code/tests define AS-IS, approved owner inputs/PRD/ADRs define
TARGET, and `.ai/CURRENT_TASK.md` defines the current execution slice.

All `implemented_local` and `verified_local` entries below are **uncommitted and undeployed** unless
the evidence explicitly says otherwise. Never promote a status based only on an agent report.

## Status vocabulary

| Status | Meaning |
|---|---|
| `open` | Confirmed gap; no accepted local implementation. |
| `in_progress` | A scoped repair is underway or only part of the finding is addressed. |
| `implemented_local` | Code exists locally and compiles, but required user-path verification remains. |
| `verified_local` | Focused tests/builds and the available safe local checks pass. Production is unchanged. |
| `deployed` | Approved change reached production; production verification is still pending. |
| `production_verified` | The real authenticated production path was re-tested successfully. |
| `deferred` | Deliberately postponed with an owner/architecture/approval reason. |

## Current register

| ID | Priority | Phase | Status | Current evidence | Exact next action / gate |
|---|---|---|---|---|---|
| D-1 | P0 | 0 | `verified_local` | Canonical Contact Intelligence includes read-only preview, explicit cost acknowledgement, confirmed manual discovery, honest live errors, and retains company/contact review, manual add, CRM linking, and Pipeline handoff. Mocked Chromium covers preview/confirm and honest failure. | Authenticated patched-build parity check. Do not run a real provider call without explicit approval. |
| D-2 | P0 | 0 | `verified_local` | Requirement parsing now uses `apiFetch(FormData)`; focused tests prove Wizmatch token selection, multipart headers, and tenant-specific 401 cleanup. | Authenticated patched-build paste/upload smoke before release; upload may write to R2/call AI. |
| D-3 | P0 | 0 | `verified_local` | Manual signals now use the same deterministic scorer; explicit IT-role evidence contributes separately, allowing legitimate demand evidence to reach the score-7 gate without hardcoded score 8. | Re-score historical signals only after count-only dry run and production-data approval. |
| D-4 | P1 | 0 | `verified_local` | ATS ingestion filters on explicit role/description/skill evidence. SAP ABAP/FICO, Java and JavaScript fixtures pass; music/legal/government/voice-actor/mason false positives are rejected. | Observe source acceptance/rejection counts in staging before enabling any larger ingestion cadence. |
| D-5 | P1 | 0 | `verified_local` | Client and Contact Intelligence role fit excludes company name/industry; company ecosystem evidence is a separate supporting component. | Review live-shaped queue samples after release. |
| D-6 | P1 | 0 | `verified_local` | Intelligence input is compact/capped at 40 KB, output at 1,500 tokens, timeout at 20 seconds, and provider failures map to safe reason codes/details without demo substitution. Mocked Chromium verifies safe timeout detail and absence of demo analysis. | Authenticated patched-build smoke without a real provider call. |
| D-7 | P1 | 0 | `verified_local` | Existing hot >=80 threshold is retained; legitimate role, signal, candidate, relationship and safety evidence can reach hot/Tier A, while missing components remain zero. | Calibrate weights against pilot outcomes; do not change thresholds from production anecdotes. |
| D-8 | P1 | 0 | `verified_local` | Client, Contact, Candidate and Requirement APIs return independent database totals plus returned-row counts. Dashboard, Workbench and Guardrails now build one canonical bounded 30-action priority queue from the same 75-row-per-source server window; response card limits no longer change summary totals. Unit coverage proves pagination preserves totals. | Authenticated patched-build comparison of Dashboard and Workbench counts. |
| D-9 | P1 | 0/1 | `verified_local` | Approved Contact Intelligence links classify CRM contacts consistently; Gate A now adds the durable company-contact relationship, multi-role history, tenant checks, canonical channel display, and `lastActivityAt` bumps. | Apply Gate A migration only after separate approval, then run authenticated created/existing CRM-link parity checks. |
| D-10 | P1 | 0 | `verified_local` | Shared contact search now matches combined full name and tenant-scoped email/phone/WhatsApp channels through a correlated `EXISTS`; focused SQL-generation tests pass. | Authenticated Contacts-page smoke with fictional full-name and email queries. |
| D-11 | P2 | 0 | `verified_local` | Review Workbench filters non-executable outcomes/dead cards from the action queue; blockers remain in Safety Center. Focused workbench tests pass. | Browser-smoke a live-shaped blocked queue. |
| D-12 | P2 | 0 | `verified_local` | Success text states that no discovery was queued/run and points to manual preview; mocked demo click verifies inline result. | Authenticated workbench smoke after release. |
| D-13 | P2 | 1 | `verified_local` | Requirement creation requires an explicit company; Requirement 360 attributes a named primary source through a durable company-contact relationship. SAP Person A and Java Person B remain distinct in scratch-schema, HTTP and Chromium checks. | Separately approve migration apply, then run authenticated pilot-record parity checks. |
| D-14 | P2 | 0 | `verified_local` | Empty Requirement Priority explains the dependency and links to Add Requirement; mocked Chromium covers the zero-item path. | Authenticated empty-state smoke after release. |
| D-15 | P2 | 0/1 | `verified_local` | Requirement Priority review plans now create a shared task, staffing task link and append-only timeline event transactionally. A supplied due date also becomes the requirement next action; no submission or outreach occurs. | Apply Gate A migration only after separate approval, then smoke the authenticated button. |
| D-16 | P2 | 0 | `verified_local` | Canonical Contact Intelligence renders live cost-control state. The remaining active Client Discovery `cost ₹0` label describes only its zero-provider snapshot handoff; older universal-cap copy is confined to development-only demo components. | Authenticated patched-build cost-control smoke; do not enable a provider. |
| D-17 | P2 | 0/1 | `verified_local` | Requirement source/sheet and consent/RTR objects use private `r2://` references; authenticated access returns five-minute signed URLs. | Live R2 smoke requires separate staging credentials/approval; do not upload real client/candidate documents during QA. |
| D-18 | P2 | 0/4 | `in_progress` | Results-first source controls, audited in-process ingestion, locks, dedupe, health, ATS/POC staging evidence and production foundation are live on `1112e47`. TheirStack and X-Ray correctly remain off because their keys are absent. | Securely supply TheirStack/SerpAPI keys; run capped staging calls before each production activation. |
| D-19 | P3 | 0 | `verified_local` | Readiness now reports schema status separately from usable-funnel status and states that table presence alone is insufficient. | Authenticated patched-build readiness smoke. |
| D-20 | P3 | 0 | `verified_local` | Open Tasks helper describes tasks instead of displaying the unrelated tenant-contact count; mocked dashboard check passes. | Authenticated dashboard smoke after release. |
| D-21 | P3 | 0 | `verified_local` | Dashboard work order follows the canonical sidebar sequence and includes omitted stages; mocked dashboard check passes. | Responsive authenticated dashboard smoke after release. |
| D-22 | P3 | 0/5 | `verified_local` | Gate B/C preserve original amount/currency/period and optional conversion evidence. The isolated-staging Gate C exercise reconciled permanent fee, contract margin, invoice and collection; deployment `52508e6f-8fdd-475c-a58e-84d31b82d142` reached `SUCCESS`, and authenticated Placements smoke showed `₹500/hr contract margin` separately from `₹2,50,000 permanent fee(s)`. | Pilot admin must enter approved FX evidence where conversion is required; broader non-staffing currency normalization is post-pilot. |
| D-23 | P3 | 0 | `verified_local` | CRM-link success reports created/existing in plain language and never exposes a raw UUID. Focused service tests cover both newly-created and deduplicated CRM contacts. | Authenticated created/existing branch smoke after release. |
| D-24 | P3 | 0 | `verified_local` | Domain health resolves configured DKIM selectors and stores/displays pass/fail; without selector evidence it explicitly displays `unknown`. | Configure only approved selectors, then verify DNS evidence in staging/live diagnostics. |
| D-25 | P3 | 0 | `verified_local` | Signal ingest deduplicates provider ID first, then normalized company/title/location fingerprint, with partial tenant-scoped uniqueness. | Count-only production collision preview before any historical dedupe/backfill. |
| D-26 | P0 | 0 | `verified_local` | Authenticated Dashboard, Workbench, Requirement Priority, Client Discovery, Candidate Intelligence, Analytics, AI Intelligence and System use honest error/empty states; failed live data never enables demo-ID actions. Shared forced-outage Chromium coverage passes. | Authenticated patched-build outage smoke after release. |
| D-27 | P1 | 0 | `verified_local` | Pipeline list/deal loads have catch/finally handling, clear stale rows and render Retry. Mocked Chromium failure passes. | Authenticated patched-build smoke. |
| D-28 | P2 | 0 | `verified_local` | All 11 demo routes are compiled only in Vite development mode; production bundle inspection finds no demo route paths. | Keep the production-bundle route check in release QA. |
| D-29 | P1 | 0 | `verified_local` | Server no longer serves tracked `public/admin`; missing current `dist/public/admin` returns an explicit CRM 503 while API routes continue. Admin production build passes. | Decide separately whether to delete the now-unused tracked artifact directory. |
| D-30 | P3 | 0 | `verified_local` | Private routes preserve `tenant=wizmatch` and a same-origin return path; Login restores the safe path after success. Direct-route Chromium test passes. | Authenticated post-release login smoke. |
| D-31 | P2 | 0 | `verified_local` | Route error-boundary reset key includes pathname and search params. A development-only deliberately-throwing route proves query navigation recovers the boundary in Chromium. | Authenticated System-tab smoke after release. |
| D-32 | P1 | 1/2/3 | `production_verified` | Build-time Vite flags left the deployed staffing navigation hidden after server gates were activated. Commit `9bbb570` now loads `/api/wizmatch/staffing/access` at runtime, fails closed with Error/Retry states, and drives both navigation and direct-route guards. Staging and authenticated production My Work/navigation retests passed. | Monitor access failures during the named pilot. |
| D-33 | P1 | 3 | `production_verified` | The legacy document bucket had a public endpoint. Commit `e38bdb9` requires a dedicated `R2_PRIVATE_BUCKET_NAME`; Gate C was closed until a new private bucket and retained non-PII QA PDF proved failed public/unsigned access and 300-second signed access. | Monitor signed-access failures; never place staffing documents in the legacy bucket. |
| D-34 | P1 | 0 | `production_verified` | Source Candidates still exposed LinkedIn X-Ray while paid discovery and Google fallback were off. Commit `187c741` adds a shared fail-closed cost guard, server 403 before provider use, honest disabled UI, Vitest coverage and a seventeenth Playwright scenario. Staging and production API/UI retests passed. | Keep paid discovery and Google fallback off; any future enablement needs the cost-go-live process. |
| D-35 | P1 | 4 | `production_verified` | Commit `1112e47` deploys independent default-off TheirStack/ATS/X-Ray/POC controls, provider run audit, tenant-scoped signal→POC→requirement traceability and requirement-first candidate sourcing. Controlled staging ATS rerun inserted zero duplicates; production flags-off browser/API smoke passed. | Complete the missing-key TheirStack and X-Ray live staging gates; then activate sequentially with caps. |

## Release gates for the current local bundle

- Additive migrations `0025`–`0028`, the reviewed application and Gate A/B/C are live for the
  named Jatin/Kanishk pilot. The safe staffing reminder runs in the web process. Auth/RBAC
  middleware, payment processing, scheduled Slack-DM, sending, providers, caps and budgets were
  not changed; no fictional production business record was created and no data was deleted.
- A real Contact Intelligence discovery run can spend configured provider budget and is not part of
  safe verification.
- A real uploaded requirement can write a source file and call the AI provider; start with a pasted,
  sanitized JD in a patched local/staging build.
- This branch lives in a separate clean worktree; the original dirty workspace remains preserved.
  The controlled production launch is in its 48-hour observation window. Continue by explicit
  path and never use `git add .`.
