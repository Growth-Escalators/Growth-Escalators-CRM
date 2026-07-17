# Deployment — Contracts & E-Signature (PREPARE ONLY — do not execute without approval)

> Documenso CE + its Postgres are NEW Railway services. This build does NOT provision or deploy them.
> Filled in detail during P9. Skeleton below.

## Services to create (Railway, same project as CRM)
1. **documenso** — Docker image `documenso/documenso:<pinned-version>` (pin, not `latest`).
   Env: `NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`, `DATABASE_URL` (→ documenso-db),
   SMTP (reuse existing provider), `NEXT_PUBLIC_WEBAPP_URL`, embedding/allowed-origin config
   permitting `crm.growthescalators.com`, API + webhook enabled.
2. **documenso-db** — Postgres (separate from CRM DB). URL only referenced by the documenso service.

## CRM service env additions
`DOCUMENSO_API_URL`, `DOCUMENSO_API_TOKEN`, `DOCUMENSO_WEBHOOK_SECRET`, `DOCUMENSO_EMBED_ORIGIN`,
`ESIGN_PROVIDER=documenso`, `CONTRACTS_SIGNING_SECRET`, `R2_PRIVATE_BUCKET_NAME` (if not already set).

## Local verification (this build)
`docker compose -f docs/esign/docker-compose.documenso.yml up` → set `DOCUMENSO_API_URL=http://localhost:<port>`
→ run the P6 E2E scenarios. If Docker/R2 unavailable, `ESIGN_PROVIDER=mock` + documented real-cred step.

## Migration / rollback / smoke
Migration `0034` is additive (new tables). Rollback: revert branch; no destructive migration; nav gated
by `CONTRACTS_*`. Smoke (post-deploy, when approved): `/health` 200, create→approve→send a TEST contract
to an internal address, sign, confirm webhook→`COMPLETED`, download works, no 5xx.

## Backup / upgrade
Documenso Postgres on Railway's managed backups; pin the image and test upgrades on a staging Documenso
before bumping prod.
