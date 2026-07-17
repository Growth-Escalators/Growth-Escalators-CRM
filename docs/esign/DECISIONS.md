# Decisions — Contracts & E-Signature

Append-only. Each: Decision / Reason / Alternatives / Consequences.

---
**D1 — Signing engine: self-hosted Documenso Community Edition as a separate service.**
Reason: AGPL-free, embeddable, webhook completion; user directive; ₹0 licence.
Alternatives: DocuSeal, paid DocuSign/Zoho, native pdfkit+signature-pad (prior scrapped plan).
Consequences: A separate Railway service + its own Postgres (Railway compute cost — NOT ₹0). Kept
out of the Express process; no Documenso module imports; no Drizzle on Documenso tables (AGPL boundary).

---
**D2 — Tenant scoping column = `tenantId` (uuid → tenants.id). No workspace/organisation.**
Reason: repo has no workspace/org concept; tenants are internal brands (growth-escalators, wizmatch,
city-clinic). Alternatives: introduce workspaceId (rejected — invents a concept). Consequences: spec's
"one tenant per client org" reinterpreted; a client company = a `billing_clients` row (data only).

---
**D3 — External signer access = per-recipient HMAC signed link; no client accounts.**
Reason: no client-company logins exist; lowest cost; reuses `wizmatch.ts` unsubscribe pattern.
Alternatives: full client-login portal (large, touches guarded auth/rbac/schema). Consequences: no
client dashboard in v1; signers reach a tokenized page; `CONTRACTS_SIGNING_SECRET` fails closed.

---
**D4 — Documents in Cloudflare R2 (private tier), reuse `src/utils/r2.ts`.**
Reason: production-ready dual-bucket S3 abstraction already exists; near-free. Alternatives: local
disk (ephemeral on Railway — rejected), DB blobs (none today — rejected). Consequences: add
`R2_PRIVATE_BUCKET_NAME` to `.env.example`; enforce `v{n}` immutable keys; add `%PDF` byte-sniff.

---
**D5 — Verify against local Dockerized Documenso; prepare (not execute) prod deploy.**
Reason: prod deploy/provisioning is gated; keep ₹0 during build. Alternatives: mock-only (weaker
proof), provision real Railway now (gated spend). Consequences: `docs/esign/docker-compose.documenso.yml`
for local verify; `ESIGN_PROVIDER=mock` fallback if Docker unavailable, with the real-cred step documented.

---
**D6 — v1 workflow: internal countersignature, approval-before-send, expiry, reminders (all on).**
Reason: user selected all four. Consequences: state machine adds an approval gate + EXPIRED state;
recipient roles include `internal_countersigner` (signs after client, by `signingOrder`); two crons
(expiry sweep, reminders) wired into `src/worker.ts`.

---
**D7 — Committed secrets in `wizmatch-railway-env.txt`: flagged, no action.**
Reason: user chose flag-only; rotation/history-scrub touch prod creds + shared history (gated).
Consequences: exposure remains until the user rotates + scrubs; not blocking this feature.

---
**D8 — Branch `feat/contracts-esign`; retired 3 stale native-signing worktrees.**
Reason: those scaffolds assumed the scrapped native-signing approach. Consequences: clean single
worktree; migration lands as `0034` off `origin/main`.

---
**D9 — Stripped pre-existing schema drift from the generated migration 0034.**
`npm run db:generate` folded three unrelated statements into 0034 because the 0033 snapshot is drifted:
`ALTER TABLE events ADD COLUMN processed_at` + `events_type_processed_idx` (both already created by
migration 0031) and `invoice_series_tenant_type_fy_uniq_idx` (already created by 0030). Left in, they
would fail on apply ("already exists") on any DB past 0030/0031. Removed all three from
`0034_lame_proemial_gods.sql` so the migration is **contract-only** (5 tables + their indexes/FKs).
The generated `0034_snapshot.json` still reflects the full, correct schema, so future `db:generate`
runs diff against it and won't re-emit the drift — 0034 effectively heals the drift going forward.
Verified: full chain `0000→0034` applies cleanly on a fresh Postgres 16 DB; all contract tables/indexes/
FKs present. Did NOT touch already-applied migrations or the 0033 snapshot (guarded paths).
