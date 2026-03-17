# Deploy n8n on Railway — Step-by-Step Instructions

## Overview
n8n is a workflow automation tool that will poll our PostgreSQL jobs table every 30 seconds
and process each job type (WhatsApp messages, email sequences, hot lead alerts, etc.).

---

## HUMAN ACTION NEEDED — Follow these exact steps

### Step 1 — Open Railway Dashboard
Go to: https://railway.app/dashboard
Click on your project: **adaptable-kindness**

### Step 2 — Add n8n Service
1. Click **+ New** (top right of the canvas)
2. Click **Template**
3. Search for **n8n**
4. Click the n8n template → Click **Deploy**
5. Railway will create a new service called "n8n"

### Step 3 — Wait for n8n to provision (~60 seconds)
You will see a new service tile appear on the canvas. Wait for it to turn green.

### Step 4 — Set Environment Variables on the n8n Service
Click on the **n8n** service tile → Click **Variables** tab → Add these one by one:

```
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=admin
N8N_BASIC_AUTH_PASSWORD=***REDACTED-ROTATED-2026-07-23***
N8N_ENCRYPTION_KEY=***REDACTED-ROTATED-2026-07-23***
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

For WEBHOOK_URL — set it AFTER step 5 when you have the public URL.

### Step 5 — Generate Public Domain for n8n
1. Click on the **n8n** service → Click **Settings** tab
2. Scroll to **Networking** → Click **Generate Domain**
3. Railway will give you a URL like: `n8n-production-xxxx.up.railway.app`
4. Copy this URL
5. Go back to **Variables** tab and add:
   ```
   WEBHOOK_URL=https://[your-n8n-url-from-step-5]
   ```

### Step 6 — Redeploy n8n
Click **Deploy** on the n8n service to apply the environment variables.

### Step 7 — Open n8n UI
Go to: `https://[your-n8n-url]/`
Login with:
- Username: `admin`
- Password: `***REDACTED-ROTATED-2026-07-23***`

### Step 8 — Import Workflows
1. In n8n, click **Workflows** (left sidebar)
2. Click **Import from file** (top right)
3. Import these files in order from the `n8n-workflows/` folder:
   - `01-job-queue-processor.json`
   - `02-process-inbound-wa.json`
   - `03-process-sequence-step.json`
   - `04-hot-lead-alert.json`
   - `05-process-form-submit.json`

### Step 9 — Set n8n Credentials
In n8n, go to **Credentials** and add:
1. **Postgres credential** — use the Railway Postgres connection details above
2. **Header Auth credential** named `express-api` — no auth needed (internal)

### Step 10 — Activate All Workflows
Open each imported workflow → Toggle **Active** switch (top right) to ON.

### Step 11 — Verify
- Open the `01-job-queue-processor` workflow
- Click **Execute Workflow** to run it manually once
- Check that it connects to Postgres and returns jobs

---

## Environment Variable Reference

| Variable | Value |
|----------|-------|
| DB host (internal) | `postgres.railway.internal` |
| DB host (external) | `nozomi.proxy.rlwy.net` |
| DB port (internal) | `5432` |
| DB port (external) | `46852` |
| DB name | `railway` |
| DB user | `postgres` |
| DB password | `***REDACTED-ROTATED-2026-07-23***` |
| Express backend | `https://web-production-311da.up.railway.app` |

---

## Troubleshooting

**n8n won't connect to Postgres:**
- Make sure `DB_POSTGRESDB_HOST=postgres.railway.internal` (internal network)
- Both services must be in the same Railway project

**Workflows not triggering:**
- Make sure the workflow is **Active** (toggle is blue)
- Check Railway logs for the n8n service

**n8n UI not loading:**
- Make sure `WEBHOOK_URL` is set to the correct public URL
- Redeploy after adding WEBHOOK_URL
