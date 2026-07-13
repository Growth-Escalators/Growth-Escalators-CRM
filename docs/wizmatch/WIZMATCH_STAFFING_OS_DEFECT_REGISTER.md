# Wizmatch Staffing OS — Defect and Remediation Register

- **Status:** Canonical current remediation register
- **Updated:** 2026-07-13
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
| D-6 | P1 | 0 | `implemented_local` | Intelligence input is compact/capped at 40 KB, output at 1,500 tokens, timeout at 20 seconds, and provider failures map to safe reason codes/details without demo substitution. | Add a mocked provider timeout/rejection route test; then authenticated patched-build smoke without a real provider call. |
| D-7 | P1 | 0 | `verified_local` | Existing hot >=80 threshold is retained; legitimate role, signal, candidate, relationship and safety evidence can reach hot/Tier A, while missing components remain zero. | Calibrate weights against pilot outcomes; do not change thresholds from production anecdotes. |
| D-8 | P1 | 0 | `in_progress` | Client, Contact, Candidate and Requirement queue APIs now return independent database totals plus returned-row counts; their headline consumers use the true totals. Workbench summary still reflects its bounded computed action set. | Add a server-side workbench count contract that exactly mirrors executable-action predicates without loading the full queue. |
| D-9 | P1 | 0/1 | `verified_local` | Approved Contact Intelligence links now classify both new and deduplicated CRM contacts with `Client Lead`, company name, provenance metadata, and `lastActivityAt`; service tests cover channel normalization and existing-link behavior. | Authenticated created/existing CRM-link smoke; Phase 1 still needs the durable company-contact relationship. |
| D-10 | P1 | 0 | `verified_local` | Shared contact search now matches combined full name and tenant-scoped email/phone/WhatsApp channels through a correlated `EXISTS`; focused SQL-generation tests pass. | Authenticated Contacts-page smoke with fictional full-name and email queries. |
| D-11 | P2 | 0 | `verified_local` | Review Workbench filters non-executable outcomes/dead cards from the action queue; blockers remain in Safety Center. Focused workbench tests pass. | Browser-smoke a live-shaped blocked queue. |
| D-12 | P2 | 0 | `verified_local` | Success text states that no discovery was queued/run and points to manual preview; mocked demo click verifies inline result. | Authenticated workbench smoke after release. |
| D-13 | P2 | 1 | `open` | Requirement form still lacks explicit company and source-contact attribution. | Requires approved Phase 1 domain/schema proposal; do not hide in JSON. |
| D-14 | P2 | 0 | `verified_local` | Empty Requirement Priority explains the dependency and links to Add Requirement; mocked Chromium covers the zero-item path. | Authenticated empty-state smoke after release. |
| D-15 | P2 | 0/1 | `open` | Review-plan action still produces no durable plan artifact. | Decide whether to create a real task/shortlist plan or remove/rename the action. |
| D-16 | P2 | 0 | `in_progress` | Canonical Contact Intelligence no longer asserts universal ₹0/paid-disabled behavior; other surfaces may still do so. | Inventory remaining zero-cost copy against live cost-control data. |
| D-17 | P2 | 0/1 | `deferred` | Requirement sheets can expose confidential client data through public object URLs. | Owner decision on signed/private document policy, then architecture proposal. |
| D-18 | P2 | 0 | `in_progress` | DATAFLOW schema, scoring transport, topology, and supply/demand errors corrected locally. | Re-verify live Dice/TheirStack configuration and counts before calling either source healthy. |
| D-19 | P3 | 0 | `verified_local` | Readiness now reports schema status separately from usable-funnel status and states that table presence alone is insufficient. | Authenticated patched-build readiness smoke. |
| D-20 | P3 | 0 | `verified_local` | Open Tasks helper describes tasks instead of displaying the unrelated tenant-contact count; mocked dashboard check passes. | Authenticated dashboard smoke after release. |
| D-21 | P3 | 0 | `verified_local` | Dashboard work order follows the canonical sidebar sequence and includes omitted stages; mocked dashboard check passes. | Responsive authenticated dashboard smoke after release. |
| D-22 | P3 | 0/5 | `open` | Mixed currency presentation remains. | Approve currency normalization policy before cross-module changes. |
| D-23 | P3 | 0 | `implemented_local` | CRM-link success now reports created/existing in plain language; it no longer exposes a raw UUID. | Verify created and existing-link branches. |
| D-24 | P3 | 0 | `open` | DKIM health is not represented. | Confirm available DNS/provider evidence before adding a check. |
| D-25 | P3 | 0 | `open` | Same role under multiple URLs can produce duplicate signals/actions. | Define canonical signal identity and safe dedupe/backfill plan. |
| D-26 | P0 | 0 | `verified_local` | Authenticated Dashboard, Workbench, Requirement Priority, Client Discovery, Candidate Intelligence, Analytics, AI Intelligence and System use honest error/empty states; failed live data never enables demo-ID actions. Shared forced-outage Chromium coverage passes. | Authenticated patched-build outage smoke after release. |
| D-27 | P1 | 0 | `verified_local` | Pipeline list/deal loads have catch/finally handling, clear stale rows and render Retry. Mocked Chromium failure passes. | Authenticated patched-build smoke. |
| D-28 | P2 | 0 | `verified_local` | All 11 demo routes are compiled only in Vite development mode; production bundle inspection finds no demo route paths. | Keep the production-bundle route check in release QA. |
| D-29 | P1 | 0 | `verified_local` | Server no longer serves tracked `public/admin`; missing current `dist/public/admin` returns an explicit CRM 503 while API routes continue. Admin production build passes. | Decide separately whether to delete the now-unused tracked artifact directory. |
| D-30 | P3 | 0 | `verified_local` | Private routes preserve `tenant=wizmatch` and a same-origin return path; Login restores the safe path after success. Direct-route Chromium test passes. | Authenticated post-release login smoke. |
| D-31 | P2 | 0 | `implemented_local` | Route error-boundary reset key includes pathname and search params, so System tab query changes clear a prior boundary state. | Add a deliberately-throwing query-tab recovery fixture before release if the route remains high risk. |

## Release gates for the current local bundle

- No schema, migration, auth/RBAC middleware, payment, scheduled Slack-DM, deployment, environment,
  sending, provider-enable, cap, budget, or production-data change is included.
- A real Contact Intelligence discovery run can spend configured provider budget and is not part of
  safe verification.
- A real uploaded requirement can write a source file and call the AI provider; start with a pasted,
  sanitized JD in a patched local/staging build.
- The worktree contains unrelated user WIP. Stage only explicitly reviewed paths, never `git add .`.
