# n8n Railway Configuration Reference

## Service: n8n
Deployed via Railway template on the `adaptable-kindness` project.

## Backend API base URL
https://web-production-311da.up.railway.app

## Required Environment Variables

```env
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=***REDACTED-ROTATED-2026-07-23***
N8N_ENCRYPTION_KEY=***REDACTED-ROTATED-2026-07-23***
WEBHOOK_URL=https://[n8n-public-url-after-deploy]
N8N_HOST=0.0.0.0
N8N_PORT=5678
N8N_PROTOCOL=https
DB_TYPE=postgresdb
DB_POSTGRESDB_DATABASE=railway
DB_POSTGRESDB_HOST=postgres.railway.internal
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_USER=postgres
DB_POSTGRESDB_PASSWORD=***REDACTED-ROTATED-2026-07-23***
DB_POSTGRESDB_SCHEMA=n8n
```

## Workflow Files
All workflow JSON files are in `n8n-workflows/` — import them in order after n8n is deployed.

## For full step-by-step deployment instructions, see DEPLOY_N8N_RAILWAY.md
