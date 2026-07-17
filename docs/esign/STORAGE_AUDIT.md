# Storage Audit — Contracts & E-Signature

Evidence-backed audit of current storage, done read-only before implementation. Feeds the R2 reuse
decision. All paths relative to repo root.

| # | Question | Answer (evidence) |
|---|---|---|
| 1 | What is used for file storage? | **AWS S3 SDK v3 (`@aws-sdk/client-s3@^3.1017.0`) pointed at Cloudflare R2.** `src/utils/r2.ts:1,13-17` (`region:'auto'`, R2 endpoint). Also `multer@^2.1.1`, `pdfkit@^0.18.0`. |
| 2 | Where are files physically stored? | **R2** for all sensitive docs (multer `memoryStorage` → buffer → R2). **Local disk only** for task attachments: `src/routes/taskAttachments.ts:84` `fs.writeFileSync` under `TASK_ATTACHMENT_DIR`. No `diskStorage` elsewhere. |
| 3 | Persistent across Railway redeploy? | **R2 yes.** **Local task-attachment disk NO** (ephemeral; no volume in `railway.json`/`nixpacks.toml`; code comment `taskAttachments.ts:10-11` says "mount a volume"). → Contracts must use R2 only. |
| 4 | Is R2 configured? Which vars? Public+private? | **Yes, dual-bucket.** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME` (public, default `ge-media`), `R2_PUBLIC_URL`, `R2_PRIVATE_BUCKET_NAME` (private, required, no default — `resolvePrivateR2Bucket` throws without it, `r2.ts:127-133`). `R2_PRIVATE_BUCKET_NAME` was **missing from `.env.example`** → added in P0. |
| 5 | Reusable S3 abstraction? Full API? | **Yes, reuse as-is.** `src/utils/r2.ts` exports: `sniffFileType`, `R2_ALLOWED_UPLOAD_MIME_TYPES`, `isAllowedUploadContent`, `uploadToR2` (public→https), `uploadPrivateToR2` (→`r2://<bucket>/<key>`), `resolvePrivateR2Bucket`, `parsePrivateR2Reference`, `createSignedR2Url(ref, 300)`, `deleteFromR2` (public only), `R2Object`, `listR2Objects`. |
| 6 | Any DB blobs / bytea / base64? | **No.** Zero `bytea`/`blob` in `src/db/`. `base64` only for Claude-API inline payloads / OAuth state / HMAC — not persistence. |
| 7 | Private files exposed via public URLs? | **No.** `uploadToR2` (public) has one caller (`src/routes/social.ts:373`, marketing media). All sensitive docs use `uploadPrivateToR2` + `createSignedR2Url(...,300)`. Domain guard rejects non-`r2://` consent refs (`wizmatchDeliveryDomain.ts:89`). |
| 8 | Existing file-URL/attachment columns? | `wizmatchRequirements.sourceFileUrl/sheetUrl`, `wizmatchPlacements.rtrDocumentUrl/contractDocumentUrl`, `wizmatchCandidateConsents.documentReference` (enforced `r2://`), plus many `*_url` link cols. `task_attachments` created via raw DDL (`src/services/tasksDb.ts:56`), not in `schema.ts`. |
| 9 | Reuse vs missing for `contracts/{tenant}/{id}/v{n}/*`? | **Reuse:** `uploadPrivateToR2` writes a `/`-containing key verbatim (after per-segment sanitize, `r2.ts:116-124`) → pass the full key directly; `createSignedR2Url`; `pdfkit`; `consentDocumentUpload` multer (`wizmatchStaffing.ts:20-24`, allows `application/pdf`). **Missing:** `v{n}` counter (existing code uses `Date.now()`); `%PDF` byte-sniff; contracts tables; audit-cert generator. |
| 10 | `createSignedR2Url` expiry / clamp? | Default 300s; **clamp `Math.max(60, Math.min(x, 900))`** (`r2.ts:147`) → min 60s, max **900s**. Raise the cap only if longer emailed links are needed. |
| 11 | MIME/size validation — is PDF byte-sniffed? | **No.** `sniffFileType` recognizes images + mp4 only (no `%PDF`); `R2_ALLOWED_UPLOAD_MIME_TYPES` excludes `application/pdf`. PDFs are admitted only via multer mimetype filters (spoofable). → P2 adds a `%PDF` (`0x25504446`) branch + `application/pdf` to the allow-list. |
| 12 | Overwrite / immutability / versioned keys? | Same key = **silent overwrite** (no Object-Lock/bucket-versioning). No private-object delete (`deleteFromR2` = public bucket only). Existing de-facto versioning uses `Date.now()`; no `v{n}`. **Favorable for immutable contracts** — enforce `v{n}` in the caller; never reuse a key. |

## Decision
- Reuse `src/utils/r2.ts` end-to-end (private tier). Never use `uploadToR2` (public) or the
  task-attachment local disk for any contract artifact.
- Key scheme (immutable, versioned, tenant-scoped):
  `contracts/{tenantId}/{contractId}/v{version}/{source|generated|completed|audit-certificate}.pdf`
  and `.../metadata.json`.
- Add `%PDF` magic-byte validation (P2). Store SHA-256 of every artifact in Postgres.
