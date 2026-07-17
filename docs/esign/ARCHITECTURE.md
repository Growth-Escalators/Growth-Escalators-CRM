# Architecture — Contracts & E-Signature

## Target topology
```
CRM (Express, Node 20, CommonJS)                Documenso CE (separate service)
├── /api/contracts (requireAuth)     ──s2s──▶   ├── own runtime (Docker image, pinned)
├── /api/contracts/sign/:token (public HMAC)    └── own Postgres DB (DOCUMENSO_DATABASE_URL)
├── /webhooks/documenso (public, HMAC-verified) ◀──webhook── Documenso
├── src/modules/esign/ (module)
└── Cloudflare R2 (private bucket) ── source/generated/completed/audit PDFs + metadata.json
```

- CRM ↔ Documenso is **server-to-server only** (`DOCUMENSO_API_URL` + `DOCUMENSO_API_TOKEN`). API
  token never reaches the browser.
- Embedded signing = the CRM renders Documenso's signing URL in an `<iframe>`. Framing is governed by
  Documenso's `DOCUMENSO_EMBED_ORIGIN`; the CRM's own headers don't block it (helmet CSP is off; the
  `X-Frame-Options: SAMEORIGIN` it emits only governs the CRM being framed).
- Completion is authoritative only after **verified webhook + server-side status re-fetch**, never a
  browser signal.
- **Boundaries:** no Documenso server modules imported into CRM; no Drizzle access to Documenso tables;
  no shared auth tables; AGPL notices preserved (Documenso stays a separate service).

## Module (`src/modules/esign/`)
`esign.routes.ts` (mount + carve-outs) · `esign.controller.ts` (thin HTTP) · `esign.service.ts`
(orchestration, tenant-scoped) · `esign.repository.ts` (Drizzle) · `esign.webhook.ts` (verify +
idempotent apply) · `esign.validation.ts` · `esign.types.ts` · `contract-state-machine.ts` ·
`document-storage.service.ts` (R2 keys + hashes) · `document-hash.service.ts` (sha256) ·
`providers/esign-provider.interface.ts` · `providers/documenso.provider.ts` · `providers/mock.provider.ts`.

The rest of the CRM depends only on `ESignatureProvider` — never on Documenso response shapes.

## Reuse map
Storage `src/utils/r2.ts`; PDF `pdfkit` + `src/services/pdfService.ts` + `wizmatchRtrGenerator.ts`;
numbering `src/services/invoiceNumberService.ts`; email `src/services/emailService.ts`; signed-link
HMAC `src/routes/wizmatch.ts:4457-4462/5222-5253` + carve-out `src/index.ts:304-311`; webhook verify
`src/middleware/validateWebhook.ts:78-114` + idempotency `src/routes/webhooks.ts:33-44`
(`processed_events`); RBAC `src/middleware/rbac.ts:14-38`; route pattern `.claude/skills/ge-add-route`.
