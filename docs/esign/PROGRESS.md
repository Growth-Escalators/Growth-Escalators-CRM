# Progress — Contracts & E-Signature (loop memory)

> Updated after every meaningful cycle. Survives context compaction — resume from here.

## Current status
- **Branch:** `feat/contracts-esign` (worktree `.claude/worktrees/feat+contracts-esign`, off `origin/main` 1b78a62).
- **Phase:** ALL PHASES P0–P9 DONE. See ACCEPTANCE.md for the criteria report + remaining live steps.
- **State:** build + tests green (706); admin build green; migration clean on fresh DB; live drive of the
  real HTTP+DB+auth+RBAC+numbering+audit paths passed; fail-closed HMAC verified live; no bundle secrets.

## Completed
- Discovery (read-only): architecture, tenancy, storage audit, deployment, webhooks, permissions. See
  STORAGE_AUDIT.md + DECISIONS.md.
- P0: retired 3 stale native-signing worktrees; added `R2_PRIVATE_BUCKET_NAME`, `DOCUMENSO_*`,
  `ESIGN_PROVIDER`, `CONTRACTS_SIGNING_SECRET`, contract placeholders to `.env.example`; seeded docs/esign/*.
- P1: 5 tables (`contract_templates/contracts/contract_recipients/contract_consents/contract_events`,
  tenantId-scoped, partial-unique idempotency index on contract_events) + `contract-state-machine.ts`
  (pure module) + migration `0034_lame_proemial_gods.sql` (drift-stripped to contract-only — see D9).

## Tests
- `contractStateMachine.test.ts`: 13 passed. `contractDocumentStorage.test.ts`: 11 passed (24 total).
- Migration chain 0000→0034 applied clean on fresh Postgres 16. tsc build: green.
- P2: added `%PDF` to `sniffFileType` + `application/pdf` to the R2 allow-list; `document-hash.service`
  (sha256 + constant-time verify) + `document-storage.service` (immutable versioned keys, private-only,
  PDF-magic-byte validation).
- P3: vendor-neutral `ESignatureProvider` interface + `esign.types.ts` + `MockESignProvider` (in-memory,
  full lifecycle) + `DocumensoProvider` (v1 REST, server-to-server, fail-closed config) + factory
  (`ESIGN_PROVIDER`) + `docs/esign/docker-compose.documenso.yml` (pinned). `esignProvider.test.ts`: 11 passed.

- P4: `CONTRACTS_*` in `PERMISSION_MAP` (fail-closed); `contract-numbering` (invoice_series
  series_type=contract); `contract-pdf` (pdfkit); `esign.repository` (tenant-scoped);
  `esign.service` (create/generate/approve/send/void/clone/download + audit events);
  `esign.controller` + `esign.routes` (`/api/contracts`, permission-gated); mounted in `index.ts`.
  Tests: `contractService.test.ts` (7), `contractRoutesAndPermissions.test.ts` (5).

- P5: `contract-signing-link` (HMAC token mint/verify/hash, fail-closed); `esign.signing.service`
  (public flow — token+stored-hash auth, signable-state/expiry/signing-order checks, 4 unchecked
  consents recorded with ip/ua/doc-hash, provider signing session); `esign.public.controller/routes`
  mounted at `/api/contracts/sign` BEFORE the auth wall; `sendContract` now mints per-recipient links
  + emails the current-turn signer; `inviteNextSigner` for later signers. Tests:
  `contractSigningLink.test.ts` (6), `contractSigning.test.ts` (7).

- P6: `esign.webhook` (HMAC-verify via reused `verifyWebhookSignature`, fail-closed; processed_events
  idempotency checked-up-front/marked-after-success; **authoritative provider status re-fetch**, never
  the payload); `esign.service.syncFromProvider`/`completeFromProvider` (recipient sync → download →
  hash → store → COMPLETED, storage-failure-safe ordering); public `/webhooks/documenso` mount before
  the auth wall. `contractWebhook.test.ts`: 9 tests covering all 8 scenarios (valid, invalid-auth,
  duplicate/no-double-upload, unknown-doc, cross-tenant, out-of-order, download-fail retry, storage-fail
  no-false-complete) + fail-closed.

- P7: `esign.jobs` — `expireOverdueContracts` (open + past expiresAt → EXPIRED, provider-cancel
  best-effort) + `sendSigningReminders` (throttled to `CONTRACTS_REMINDER_INTERVAL_DAYS`, skips
  expired/never-sent, failure-isolated); `service.expireContract`/`remindCurrentSigner`; two daily
  `cron.schedule` in `src/worker.ts`. `contractJobs.test.ts`: 4 tests.

- P8: admin `ContractsPage.jsx` (mirrors BillingPage shell — Sidebar + apiFetch + status badges;
  list/filter, create, generate/approve/send/void, detail drawer with recipients + audit timeline +
  downloads); public `SignContractPage.jsx` (plain fetch, 4 unchecked consents, embedded signing
  iframe, legal-scope notice); routes in `App.jsx` (`/contracts` authed, `/sign/:token` public) +
  `navEntries.js` (`canContracts` + Finance nav item). Admin build green.

- P9: live drive (real server + scratch DB + mock provider) of boot/health, auth wall, authed list,
  fail-closed public-token + webhook (401), numbering preview/claim, create→DRAFT+recipients+
  countersignature (confirmed in Postgres directly), append-only audit event, graceful R2-missing 500,
  sales RBAC view; secret scan of the admin bundle (no leaks); `git diff --check` clean; fresh-DB
  migration re-confirmed. Wrote ACCEPTANCE.md. Live Documenso (Docker down) + R2-backed
  generate→complete are documented remaining steps (covered by mocked integration tests).

## Regression
- Full suite: **706 passed / 85 files / 0 failures**; `npm run admin:build` green.

## Known verification gaps (not blockers)
- `DocumensoProvider` endpoint paths + embedded-signing token flow are coded to Documenso's documented
  v1 API but **not yet validated against a live instance** — do so when the Docker Documenso is up
  (P6/P9). Automated tests cover the interface via the mock; the real HTTP mapping is the live step.

## Outstanding defects
- None. (Handled pre-existing 0033-snapshot drift in D9 — not a defect I introduced.)

## Decisions / assumptions
- See DECISIONS.md (D1–D8). Assumptions: countersign after client signs; authorized signer =
  `CONTRACTS_SIGN` holders (admins default); placeholder legal entities.

## Current blocker
- None. (Local Node is v24 vs repo-pinned Node 20 — will fall back to `nvm use 20` if build/test misbehaves.)
