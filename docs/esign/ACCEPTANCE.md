# Acceptance Report — Contracts & E-Signature

Branch `feat/contracts-esign` (off `origin/main` 1b78a62). Verified locally (no CI). Node 20.

## Verification performed
- `npm run build` (tsc, strict): **PASS**
- `npm test` (Vitest): **706 passed / 85 files / 0 failures**, incl. the module suites:
  contractStateMachine (13), contractDocumentStorage (11), esignProvider (11), contractService (7),
  contractRoutesAndPermissions (5), contractSigningLink (6), contractSigning (7), contractWebhook (9,
  = the 8 required scenarios + fail-closed), contractJobs (4).
- Migration chain `0000→0034` applies clean on a **fresh Postgres 16** DB (twice); contract tables +
  indexes + FKs present.
- `npm run admin:build`: **PASS** (Contracts + Sign pages bundle).
- **Live drive** (real `node dist/index.js` → real scratch DB, `ESIGN_PROVIDER=mock`):
  - `/health` 200; `GET /api/contracts` no-token **401**; with admin JWT **200**.
  - `GET /api/contracts/sign/<bad>` **401** and `POST /webhooks/documenso` unsigned **401** — fail-closed HMAC.
  - `GET /api/contracts/number/preview` → `GE/CON/2026-27/001`; `POST /api/contracts` → **DRAFT**,
    `GE/CON/2026-27/001`, 2 recipients, `requires_countersignature=t`.
  - Independent SQL (not via the API): contract row = DRAFT + correct ref + countersignature; one
    append-only `contract.created` (source `crm`) event; 2 recipient rows; `invoice_series` contract
    counter = 1.
  - `POST /api/contracts/:id/generate` with no R2 creds → **500 graceful** (no crash).
  - RBAC: `sales` GET list **200** (CONTRACTS_VIEW); `sales` create denial proven in unit tests.
- Secret hygiene: **no** server secrets (`DOCUMENSO_*`, `R2_*`, `CONTRACTS_SIGNING_SECRET`, `JWT_SECRET`)
  in the built admin bundle; `admin/src` references no server-only env. `git diff --check` clean.

## Acceptance criteria (per spec §34)
- **Architecture: PASS** — Documenso is a separate service + separate DB (DEPLOYMENT.md +
  docker-compose); CRM↔Documenso server-to-server via the provider interface; no secrets to the
  frontend (verified); storage documented (STORAGE_AUDIT.md).
- **Storage: PASS** — existing storage audited; private-R2 adapter reused; documents private; short-lived
  signed URLs; SHA-256 hashes stored; immutable `contracts/{tenantId}/{contractId}/v{n}/*` keys.
- **Database: PASS** — fresh-DB migration verified; project conventions; constraints/indexes; enforced
  state transitions (tests); idempotent webhook (processed_events + tests).
- **Backend: PASS** — create/assign/generate/send/authorized-signing/webhook/retain/consistent
  implemented + tested; create+numbering+audit live-verified.
- **Frontend: PASS** — Contracts + embedded signing inside the CRM; consent collected; status +
  recipient progress + downloads; unauthorized blocked (401 live). Admin build green.
- **Security: PASS** — tenant-isolation tests; no bundle secrets; no public bucket; input + PDF
  magic-byte validation; webhook replay idempotent; fail-closed HMAC live-verified.
- **Quality: PASS** — typecheck + tests + prod build + migration verified; docs complete; limitations
  documented. (No repo lint config; strict tsc introduces no new errors.)

## Remaining live-verification / production steps (out of the agreed build scope)
1. **Stand up Documenso CE** (Docker daemon was down locally): `docs/esign/docker-compose.documenso.yml`,
   then validate the `DocumensoProvider` HTTP mapping + embedded-signing token flow against it, and the
   webhook end-to-end. (Interface is proven via the mock provider; the real HTTP mapping is the live step.)
2. **Real R2 (or an S3 endpoint override)** to exercise generate→sign→complete with actual object
   storage — the completion download/hash/store logic is proven with mocked storage.
3. **Provision + deploy** the Documenso service + its Postgres on Railway and set the CRM env
   (`DOCUMENSO_*`, `ESIGN_PROVIDER=documenso`) — prepared in DEPLOYMENT.md, NOT executed (gated).
4. **Rotate the committed secrets** in `wizmatch-railway-env.txt` (flagged; user-owned).

## Estimated recurring cost
Documenso CE + its Postgres consume Railway compute (**not ₹0**); R2 usage for contracts is near-free.

## Rollback
Revert branch `feat/contracts-esign`. Migration `0034` is additive (new tables only) — no destructive
change; no production deploy performed; the nav entry + routes are gated by `CONTRACTS_*` permissions.
