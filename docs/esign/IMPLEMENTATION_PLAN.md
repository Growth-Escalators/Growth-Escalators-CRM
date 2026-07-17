# Implementation Plan — Contracts & E-Signature

Authoritative plan mirror: `~/.claude/plans/i-want-to-work-purring-harbor.md` (approved).
This file is the in-repo copy; `PROGRESS.md` tracks live status.

## Phases (each: implement → typecheck → lint → unit → integration → update PROGRESS.md)
- **P0** Scaffold: worktree, retire stale worktrees, docs/esign/*, env vars. ✅ verify `npm run build`.
- **P1** Schema (`contract_templates/contracts/contract_recipients/contract_consents/contract_events`,
  all `tenantId`) + `contract-state-machine.ts` + migration `0034`. Verify transition tests + fresh-DB migrate.
- **P2** Storage/hash: `%PDF` sniff + `application/pdf` allow-list in `r2.ts`; `document-storage.service`
  (`contracts/{tenantId}/{contractId}/v{n}/*`) + `document-hash.service`. Verify unit tests.
- **P3** Provider: `esign-provider.interface` + `mock.provider` + `documenso.provider` +
  `docker-compose.documenso.yml` (pinned). Verify provider-contract tests.
- **P4** Contract service + routes + RBAC (`CONTRACTS_*`), numbering (`series_type=contract`), approve gate.
  Verify route/permission/tenant-isolation tests.
- **P5** Signing + consent: HMAC signed-link mint/verify, public sign route (carve-out before auth wall),
  4 unchecked consents + ip/ua/hash, `createSigningSession`. Verify authz tests.
- **P6** Webhook + completion: `validateDocumensoWebhook`, idempotent handler, status re-confirm,
  download→hash→R2→COMPLETED. Verify the 8 scenarios in TEST_PLAN.md.
- **P7** Crons: expiry sweep + reminders → `src/worker.ts`. Verify job tests.
- **P8** Frontend: admin `ContractsPage.jsx` (mirror `BillingPage.jsx`) + signing page. Verify `admin:build`.
- **P9** Independent verification + finalize docs + `DEPLOYMENT.md`. Produce acceptance PASS/PARTIAL/FAIL.

## State machine
`DRAFT→GENERATED→READY_TO_SEND→SENT→VIEWED→PARTIALLY_SIGNED→COMPLETED` + `REJECTED|EXPIRED|VOIDED|FAILED`.
Approval gate on `GENERATED→READY_TO_SEND`. Countersign: client → `PARTIALLY_SIGNED` → internal → `COMPLETED`.
Sent = immutable; change = void + clone `v{n+1}` + resend.

## Non-goals (v1)
Client-login portal; drag-drop PDF editor; Aadhaar-eSign/DSC/QES; paid OTP; prod deploy/provisioning.
