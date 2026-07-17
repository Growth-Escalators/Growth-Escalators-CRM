# Progress — Contracts & E-Signature (loop memory)

> Updated after every meaningful cycle. Survives context compaction — resume from here.

## Current status
- **Branch:** `feat/contracts-esign` (worktree `.claude/worktrees/feat+contracts-esign`, off `origin/main` 1b78a62).
- **Phase:** P1 — schema + state machine + migration 0034 (DONE). Next: P2 — storage + hash.
- **Next:** P2 — `%PDF` sniff + key scheme + document-storage/hash services.

## Completed
- Discovery (read-only): architecture, tenancy, storage audit, deployment, webhooks, permissions. See
  STORAGE_AUDIT.md + DECISIONS.md.
- P0: retired 3 stale native-signing worktrees; added `R2_PRIVATE_BUCKET_NAME`, `DOCUMENSO_*`,
  `ESIGN_PROVIDER`, `CONTRACTS_SIGNING_SECRET`, contract placeholders to `.env.example`; seeded docs/esign/*.
- P1: 5 tables (`contract_templates/contracts/contract_recipients/contract_consents/contract_events`,
  tenantId-scoped, partial-unique idempotency index on contract_events) + `contract-state-machine.ts`
  (pure module) + migration `0034_lame_proemial_gods.sql` (drift-stripped to contract-only — see D9).

## Tests
- `contractStateMachine.test.ts`: 13 passed. Migration chain 0000→0034 applied clean on fresh Postgres 16.
- tsc build: green.

## Outstanding defects
- None. (Handled pre-existing 0033-snapshot drift in D9 — not a defect I introduced.)

## Decisions / assumptions
- See DECISIONS.md (D1–D8). Assumptions: countersign after client signs; authorized signer =
  `CONTRACTS_SIGN` holders (admins default); placeholder legal entities.

## Current blocker
- None. (Local Node is v24 vs repo-pinned Node 20 — will fall back to `nvm use 20` if build/test misbehaves.)
