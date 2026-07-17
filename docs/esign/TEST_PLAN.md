# Test Plan — Contracts & E-Signature

Framework: Vitest (unit/integration, `src/__tests__/`), Playwright (E2E, admin). No CI gate — run locally.

## Test categories
Unit (state machine, hashing, key scheme, HMAC link, webhook verify) · Service (contract lifecycle) ·
DB (migration on fresh DB, constraints/indexes) · Route (auth, validation) · Permission (`CONTRACTS_*`
fail-closed) · Tenant-isolation · Webhook (idempotency) · Storage (R2 adapter, mocked S3) · Frontend
(admin build + drive) .

## End-to-end scenarios (P6 gate)
1. **Internal creation** → template → recipients → generate → `READY_TO_SEND` (after approve).
2. **Sending** → external doc created, recipients mapped, `SENT`, doc immutable.
3. **Embedded signing** → assigned signer opens, unauthorized rejected, consent recorded, session created.
4. **Completion** → valid webhook → status re-confirmed → signed PDF + audit cert downloaded → hashed →
   stored → `COMPLETED` → downloadable.
5. **Duplicate webhook** → applied once, no double upload, state consistent.
6. **Cross-tenant attack** → org A requests org B's contract → denied; no token; no file.
7. **Versioning** → void sent contract → original preserved → new version → old session dead → resend.
8. **Storage failure** → completed-doc upload fails → NOT falsely `COMPLETED` → safe retry → no dup events.

## Independent verification (P9)
DB re-query after service ops · recompute file hashes vs stored · R2 object metadata · repeated webhook
idempotent · grep admin bundle + git history for secrets · fresh-DB migration · prod build boots.
