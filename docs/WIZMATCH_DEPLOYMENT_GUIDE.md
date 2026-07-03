# Wizmatch Staffing Module — Complete Deployment & Setup Guide

> **Purpose:** Step-by-step instructions for deploying the Wizmatch module, setting up all credentials, and getting it live on `crm.growthescalators.com`.
>
> **Audience:** Jatin (founder) or anyone executing the deployment.
>
> **Prerequisite:** The code is already merged to `main` and pushed to GitHub. Railway is auto-deploying.

---

## Table of Contents

1. [Current Status](#1-current-status)
2. [Railway Deploy — What's Happening Now](#2-railway-deploy--whats-happening-now)
3. [Running the Seed Script](#3-running-the-seed-script)
4. [Environment Variables — Complete Reference](#4-environment-variables--complete-reference)
5. [Setting Env Vars on Railway](#5-setting-env-vars-on-railway)
6. [Pushing GitHub Actions Workflows](#6-pushing-github-actions-workflows)
7. [Testing the Module](#7-testing-the-module)
8. [Architecture: What Lives Where](#8-architecture-what-lives-where)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Current Status

| Task | Status | Notes |
|---|---|---|
| Backend code (6 tables, 25+ routes, 11 services) | ✅ Complete | Merged to `main` |
| Frontend code (8 admin SPA pages) | ✅ Complete | Merged to `main` |
| Cron jobs (10+ in worker.ts) | ✅ Complete | Merged to `main` |
| Tests (162 passing) | ✅ Complete | |
| Pushed to GitHub `main` | ✅ Done | Commit `38370a3` |
| Railway auto-deploy | ✅ Triggered | Building now |
| DB migrations (tables auto-created on startup) | ✅ Automatic | Runs via `node dist/scripts/migrate.js` |
| **Seed script (creates tenant + admin user)** | ⬜ **YOU DO THIS** | See [Section 3](#3-running-the-seed-script) |
| **Environment variables on Railway** | ⬜ **YOU DO THIS** | See [Section 4](#4-environment-variables--complete-reference) |
| **GitHub Actions workflow YAMLs** | ⬜ **YOU DO THIS** | See [Section 6](#6-pushing-github-actions-workflows) |

---

## 2. Railway Deploy — What's Happening Now

When you pushed to `main`, Railway automatically started building. Here's what it does:

1. **Build phase** (~2 min): `npm install --legacy-peer-deps` → `npm run build` (TypeScript compile)
2. **Migration phase** (~10 sec): `node dist/scripts/migrate.js` — this creates all 6 `wizmatch_*` tables and GIN indexes in your PostgreSQL database
3. **Start phase**: `node dist/index.js` — launches the Express server (API + Admin SPA + background worker crons)
4. **Health check**: Railway hits `/health` endpoint to verify the server is up

### How to check Railway deploy status:

1. Go to **[railway.app](https://railway.app)** → log in
2. Click on your **`growth-escalators-backend-v2`** project
3. Click on the **API service** (the main one, not the worker)
4. Go to the **Deployments** tab
5. You'll see the latest deployment in progress or completed
6. Click on it to see real-time build logs
7. When it says **"Active"** with a green dot, it's live

### What's deployed where on Railway:

| Railway Service | Start Command | What It Does |
|---|---|---|
| **API** (main) | `node dist/scripts/migrate.js && node dist/index.js` | Express API + serves Admin SPA at `crm.growthescalators.com` + runs background cron jobs in-process |
| **Worker** (if separate) | `node dist/worker.js` | Standalone worker (only if `DISABLE_BACKGROUND_JOBS=true` on the API service) |

**Important:** By default, background jobs (cron jobs) run inside the API process. If you have `DISABLE_BACKGROUND_JOBS=true` set on the API service, then the Worker service handles crons. Either way, the Wizmatch cron jobs will run.

---

## 3. Running the Seed Script

The seed script creates:
- Wizmatch **tenant** (the multi-tenant org record)
- **Admin user** (`jatin@wizmatch.com` / `Wizmatch2025!`)
- Wizmatch **placements pipeline** (6 stages: Submitted → Interviewing → Offered → Started → Ended → Lost)
- **4-touch follow-up sequence** (Day 0, 3, 7, 14 email templates)
- **3 domain health rows** (getwizmatch.com, wizmatchhq.com, teamwizmatch.com)

### Option A: Run via Railway Shell (Recommended)

1. Go to **[railway.app](https://railway.app)** → your project
2. Click on the **API service**
3. Click the **"Settings"** or **"Data"** tab — look for **"Shell"** or **"Terminal"** or **"Exec"** button
   - In newer Railway UI: Click the three dots `...` next to the service → **"Shell"** or **"Exec"**
   - Or: Go to the deployment → click **"Shell"** tab at the top
4. Once the terminal opens, run:

```bash
npx tsx src/scripts/seedWizmatch.ts
```

5. **Copy the output** — it will print something like:

```
═══════════════════════════════════════════════════
  WIZMATCH SEED COMPLETE
═══════════════════════════════════════════════════
  Tenant ID:     abc123-def456-...
  Admin Email:   jatin@wizmatch.com
  Admin Pass:    Wizmatch2025!
  Pipeline ID:   xyz789-...

  ⚠️  Add to your .env / Railway:
  WIZMATCH_TENANT_ID=abc123-def456-...
═══════════════════════════════════════════════════
```

**Save that `WIZMATCH_TENANT_ID` value** — you need it for the env vars.

### Option B: Run locally (if you have DATABASE_URL)

```bash
# In your local terminal, in the project directory:
DATABASE_URL="postgresql://..." npx tsx src/scripts/seedWizmatch.ts
```

Replace the connection string with your Railway PostgreSQL URL (found in Railway → PostgreSQL service → **Connect** tab → **Database URL**).

---

## 4. Environment Variables — Complete Reference

Below is **every** env var the Wizmatch module needs, where to get the value, and whether it's required.

### 🔴 Required — Module won't work without these

#### `WIZMATCH_TENANT_ID`
- **What:** The UUID of the Wizmatch tenant (from the seed script output)
- **Where to get it:** Run the seed script (Section 3 above) — it prints the ID
- **Example:** `WIZMATCH_TENANT_ID=abc123-def456-789abc...`

#### `WIZMATCH_ANTHROPIC_API_KEY`
- **What:** Claude API key for AI scoring, matching, email drafting, reply classification
- **Where to get it:**
  1. Go to **[console.anthropic.com](https://console.anthropic.com)**
  2. Sign in (or create account with Jatin's email)
  3. Go to **API Keys** in the left sidebar
  4. Click **"Create Key"**
  5. Name it "Wizmatch Production"
  6. Copy the key (starts with `sk-ant-`)
  7. **Set billing:** Go to **Settings → Billing** → add a credit card → set $50/mo spend limit
- **Example:** `WIZMATCH_ANTHROPIC_API_KEY=sk-ant-api03-xxxxxxxxxxxxx`

#### `INTERNAL_API_TOKEN`
- **What:** A secret token that cron jobs use to call internal API routes (instead of JWT auth)
- **Where to get it:** Generate one yourself by running this in terminal:
  ```bash
  openssl rand -hex 32
  ```
  Copy the output (64-character hex string)
- **Example:** `INTERNAL_API_TOKEN=a1b2c3d4e5f6...` (64 chars)

#### `WIZMATCH_UNSUBSCRIBE_HMAC_SECRET`
- **What:** Secret used to sign unsubscribe links in cold emails (CAN-SPAM compliance)
- **Where to get it:** Generate one yourself:
  ```bash
  openssl rand -hex 32
  ```
- **Example:** `WIZMATCH_UNSUBSCRIBE_HMAC_SECRET=f6e5d4c3b2a1...` (64 chars)

---

### 🟡 Required for Candidate Sourcing (Cron Jobs)

#### `GITHUB_TOKEN`
- **What:** GitHub Personal Access Token for the GitHub miner cron (searchs for developers by location + language)
- **Where to get it:**
  1. Go to **[github.com/settings/tokens](https://github.com/settings/tokens)**
  2. Click **"Generate new token"** → **"Generate new token (classic)"**
  3. Name it: "Wizmatch GitHub Miner"
  4. Expiration: 90 days (or "No expiration")
  5. Scopes: Check **`public_repo`** (that's all you need)
  6. Click **"Generate token"**
  7. Copy the token immediately (starts with `ghp_`)
  8. This gives you 5,000 API requests/hour (vs 60/hour unauthenticated)
- **Example:** `GITHUB_TOKEN=ghp_xxxxxxxxxxxxxxxxxxxx`

#### `SERPAPI_API_KEY`
- **What:** SerpAPI key for X-ray LinkedIn searches (candidate sourcing)
- **Where to get it:**
  1. Go to **[serpapi.com](https://serpapi.com)**
  2. Click **"Sign Up"** → create free account
  3. Free tier: 100 searches/month (enough for ~3/day)
  4. Go to **Dashboard** → your API key is displayed at the top
  5. Copy it
- **Example:** `SERPAPI_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

---

### 🟡 Required for Email Enrichment (Finding Decision-Maker Emails)

#### `APOLLO_API_KEY`
- **What:** Apollo.io API key for finding decision-maker email addresses
- **Where to get it:**
  1. Go to **[apollo.io](https://apollo.io)**
  2. Sign up for **Basic plan** ($49/month)
  3. Go to **Settings** (gear icon, top right) → **Integrations** → **API**
  4. Or: Go to **Settings → API Keys**
  5. Copy your API key
- **Example:** `APOLLO_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxx`

#### `HUNTER_API_KEY`
- **What:** Hunter.io API key (backup email finder, used when Apollo returns nothing)
- **Where to get it:**
  1. Go to **[hunter.io](https://hunter.io)**
  2. Sign up for free account (25 searches/month free)
  3. Go to **Dashboard** → **API** tab
  4. Copy your API key
- **Example:** `HUNTER_API_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

#### `MILLIONVERIFIER_API_KEY`
- **What:** Email verification service (checks if emails are valid before sending)
- **Where to get it:**
  1. Go to **[millionverifier.com](https://www.millionverifier.com)**
  2. Sign up → buy 1,000 credits (~$17)
  3. Go to **Dashboard** → **API** tab
  4. Copy your API key
- **Example:** `MILLIONVERIFIER_API_KEY=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`

---

### 🟡 Required for Cold Email Sending (Purelymail — 6 Inboxes)

You need 3 domains registered, each with 2 inboxes (6 total). Purelymail handles SMTP.

#### Registering the 3 domains (if not done already):

1. Go to **[namecheap.com](https://namecheap.com)** (or your registrar)
2. Search for and register: `getwizmatch.com`, `wizmatchhq.com`, `teamwizmatch.com`
3. Total cost: ~$30-45/year for all three

#### Setting up Purelymail:

1. Go to **[purelymail.com](https://purelymail.com)**
2. Sign up for **Standard plan** ($10/month total for all domains)
3. Add each domain:
   - Go to **Domains** → **Add Domain**
   - Enter `getwizmatch.com`
   - Purelymail gives you DNS records (SPF, DKIM, DMARC TXT records)
   - Add those DNS records in Namecheap → **Domain List** → **Manage** → **Advanced DNS**
   - Repeat for `wizmatchhq.com` and `teamwizmatch.com`
4. Create 2 inboxes per domain (6 total):
   - Go to **Email Addresses** → **Add**
   - Create `archit@getwizmatch.com` and `team@getwizmatch.com`
   - Create `archit@wizmatchhq.com` and `team@wizmatchhq.com`
   - Create `archit@teamwizmatch.com` and `team@teamwizmatch.com`
5. Get SMTP credentials for each inbox:
   - Go to each inbox → **Settings** → **SMTP/IMAP**
   - Note the password for each

#### The env vars:

```
PURELYMAIL_SMTP_HOST=smtp.purelymail.com
PURELYMAIL_SMTP_PORT=587
PURELYMAIL_SMTP_USER_1=archit@getwizmatch.com
PURELYMAIL_SMTP_PASS_1=<password from Purelymail for this inbox>
PURELYMAIL_SMTP_USER_2=team@getwizmatch.com
PURELYMAIL_SMTP_PASS_2=<password>
PURELYMAIL_SMTP_USER_3=archit@wizmatchhq.com
PURELYMAIL_SMTP_PASS_3=<password>
PURELYMAIL_SMTP_USER_4=team@wizmatchhq.com
PURELYMAIL_SMTP_PASS_4=<password>
PURELYMAIL_SMTP_USER_5=archit@teamwizmatch.com
PURELYMAIL_SMTP_PASS_5=<password>
PURELYMAIL_SMTP_USER_6=team@teamwizmatch.com
PURELYMAIL_SMTP_PASS_6=<password>
```

---

### 🟢 Optional — Slack Alerts (Recommended)

These are Slack channel IDs where Wizmatch posts alerts (priority signals, positive replies, daily digests, system health).

#### How to get Slack channel IDs:

1. Open Slack → go to the channel you want to use
2. Right-click the channel name → **View channel details**
3. Scroll to the bottom → the channel ID is at the very bottom (starts with `C`)
4. Or: in the Slack web app, the channel ID is in the URL: `slack.com/client/<workspace>/CXXXXXXXX`

You need to create 3 channels first (if they don't exist):
- In Slack: Click `+` next to **Channels** → create:
  - `#wizmatch-leads` — for priority signals, positive replies, RTR signed alerts
  - `#wizmatch-daily` — for daily digest reports, weekly analysis
  - `#wizmatch-system` — for domain health issues, compliance alerts, errors

```
WIZMATCH_LEADS_CHANNEL=Cxxxxxxxx
WIZMATCH_DAILY_CHANNEL=Cxxxxxxxx
WIZMATCH_SYSTEM_CHANNEL=Cxxxxxxxx
```

**Note:** The existing `SLACK_BOT_TOKEN` on Railway is reused — no new Slack setup needed.

---

### 🟢 Optional — Physical Address (CAN-SPAM Compliance)

```
WIZMATCH_PHYSICAL_ADDRESS=Wizmatch LLC, 123 Main St, Newark, DE 19701, USA
```

This appears in the footer of every cold email. Required by CAN-SPAM law. Replace with your actual US business address.

---

### 🟢 Optional — JobSpy Search Queries

```
WIZMATCH_JOBSPY_QUERIES=["Java developer contract Dallas","Python developer W2","DevOps engineer C2C","React developer remote","Data engineer contract",".NET developer contract"]
```

These are the search terms JobSpy uses to find job postings. Edit as needed.

---

### 🟢 Optional — Warmup Contacts

```
WIZMATCH_WARMUP_CONTACTS=archit@wizmatch.com,jatin@wizmatch.com
```

Comma-separated list of friendly email addresses used for domain warmup (the system sends/receives test emails to build sender reputation).

---

### 🔴 Optional — Phone + AI Voice (Stretch Goals — Skip for Now)

Only set these up if you want JustCall phone integration and Vapi AI voice callbacks. These are NOT required for the core module to work.

#### JustCall (Outbound phone calls)
1. Go to **[justcall.io](https://justcall.io)**
2. Sign up for **Solo plan** ($30/month)
3. Pick a US phone number
4. Go to **Settings → API** → copy API Key and API Secret
5. Note your sender number

```
JUSTCALL_API_KEY=...
JUSTCALL_API_SECRET=...
JUSTCALL_SENDER_NUMBER=+1XXXXXXXXXX
```

#### Vapi (AI voice assistant)
1. Go to **[vapi.ai](https://vapi.ai)**
2. Sign up → add $10 credit
3. Go to **API Keys** → create one
4. Create an assistant via the dashboard (the prompt is in `src/services/wizmatchVapi.ts` if you build it later)

```
VAPI_API_KEY=...
VAPI_ASSISTANT_ID=<create via Vapi dashboard later>
```

---

## 5. Setting Env Vars on Railway

1. Go to **[railway.app](https://railway.app)** → log in
2. Click on **`growth-escalators-backend-v2`** project
3. Click on the **API service** (the main web service)
4. Click the **"Variables"** tab in the top navigation
5. Click **"+ New Variable"** (or **"Add Variable"**)
6. Enter the **Key** (e.g., `WIZMATCH_TENANT_ID`) and **Value** (e.g., the UUID from seed)
7. Click **"Add"**
8. Repeat for every variable from Section 4
9. **Important:** After adding all variables, Railway will automatically trigger a **new deployment** with the updated env vars. Wait for it to finish.

### Quick checklist for Railway Variables tab:

| # | Key | Value Source |
|---|---|---|
| 1 | `WIZMATCH_TENANT_ID` | From seed script output |
| 2 | `WIZMATCH_ANTHROPIC_API_KEY` | From console.anthropic.com |
| 3 | `INTERNAL_API_TOKEN` | `openssl rand -hex 32` |
| 4 | `WIZMATCH_UNSUBSCRIBE_HMAC_SECRET` | `openssl rand -hex 32` |
| 5 | `GITHUB_TOKEN` | From github.com/settings/tokens |
| 6 | `SERPAPI_API_KEY` | From serpapi.com dashboard |
| 7 | `APOLLO_API_KEY` | From apollo.io settings |
| 8 | `HUNTER_API_KEY` | From hunter.io dashboard |
| 9 | `MILLIONVERIFIER_API_KEY` | From millionverifier.com dashboard |
| 10 | `PURELYMAIL_SMTP_HOST` | `smtp.purelymail.com` |
| 11 | `PURELYMAIL_SMTP_PORT` | `587` |
| 12-17 | `PURELYMAIL_SMTP_USER_1` through `_6` | The 6 inbox addresses |
| 18-23 | `PURELYMAIL_SMTP_PASS_1` through `_6` | The 6 inbox passwords |
| 24 | `WIZMATCH_PHYSICAL_ADDRESS` | Your US business address |
| 25-27 | `WIZMATCH_LEADS/DAILY/SYSTEM_CHANNEL` | Slack channel IDs |
| 28 | `WIZMATCH_JOBSPY_QUERIES` | JSON array of search terms |
| 29 | `WIZMATCH_WARMUP_CONTACTS` | Comma-separated emails |

---

## 6. Pushing GitHub Actions Workflows

Two workflow files exist locally but couldn't be pushed by the AI agent (GitHub OAuth token lacks `workflow` scope). These power the Dice scraper and JobSpy cron as GitHub Actions.

### Steps:

1. Open your terminal and run:

```bash
gh auth refresh -s workflow
```

2. This will open a browser window asking you to re-authorize with the `workflow` scope added. Click **"Authorize"**.

3. Then push the workflow files:

```bash
cd /Users/jatinagrawal/repo-comparison/v2
git add .github/
git commit -m "ci: add Wizmatch GitHub Actions workflows"
git push origin main
```

4. Verify on GitHub:
   - Go to **[github.com/Growth-Escalators/growth-escalators-backend-v2/actions](https://github.com/Growth-Escalators/growth-escalators-backend-v2/actions)**
   - You should see "Wizmatch Dice Scraper" and "Wizmatch JobSpy Cron" workflows listed

**Note:** If you don't have the `gh` CLI installed, you can install it via `brew install gh` on macOS, or just manually copy the YAML files and push via git with a personal access token that has `workflow` scope.

---

## 7. Testing the Module

Once Railway has deployed with the env vars set:

### Step 1: Log in to the CRM

1. Go to **[crm.growthescalators.com](https://crm.growthescalators.com)**
2. Log in with:
   - **Email:** `jatin@wizmatch.com`
   - **Password:** `Wizmatch2025!`
3. You should see the CRM dashboard

### Step 2: Navigate to Wizmatch pages

In the **left sidebar**, scroll down and you'll see a **"Wizmatch Staffing"** section with these sub-items:

| Page | What to Check |
|---|---|
| **Signals** | Should load an empty table (no signals yet — crons will populate over time) |
| **Candidates** | Empty table (will populate as X-Ray, GitHub, and Naukri crons run) |
| **Review Queue** | Empty cards (will populate after signals are scored, enriched, matched, and drafted) |
| **Domains** | Should show 3 domain cards: getwizmatch.com, wizmatchhq.com, teamwizmatch.com |
| **Compliance** | Should show the compliance log view |
| **Placements** | Should show the Kanban board with 6 empty columns |
| **Primes** | Should show an empty list (no prime vendors yet) |
| **Analytics** | Should show KPI cards with zeros |

### Step 3: Test the API directly

You can hit the API endpoints to verify they respond:

```bash
# Get your JWT token first
curl -X POST https://crm.growthescalators.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"jatin@wizmatch.com","password":"Wizmatch2025!"}'

# Use the returned token to test endpoints
TOKEN="<paste token here>"

# List signals
curl https://crm.growthescalators.com/api/wizmatch/signals \
  -H "Authorization: Bearer $TOKEN"

# List candidates
curl https://crm.growthescalators.com/api/wizmatch/candidates \
  -H "Authorization: Bearer $TOKEN"

# List domain health
curl https://crm.growthescalators.com/api/wizmatch/domains \
  -H "Authorization: Bearer $TOKEN"
```

### Step 4: Add a test candidate manually

Via the admin UI:
1. Go to **Candidates** page
2. Click **"Add Manually"**
3. Fill in: name, email, skills (e.g., Java, Spring, AWS), location, visa status
4. Save
5. Verify it appears in the table

Or via API:
```bash
curl -X POST https://crm.growthescalators.com/api/wizmatch/candidates \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Candidate",
    "email": "test@example.com",
    "skills": ["Java", "Spring", "AWS"],
    "location": "Dallas, TX",
    "visa_status": "H1B",
    "rate_hourly": 85,
    "source": "manual"
  }'
```

---

## 8. Architecture: What Lives Where

### Railway (Everything Wizmatch)

| Component | Where | Details |
|---|---|---|
| **Express API** | Railway → API service | All `/api/wizmatch/*` routes |
| **Admin SPA** | Railway → API service | Built from `admin/` → served as static files at `crm.growthescalators.com` |
| **Cron jobs** | Railway → API service (in-process) | All 10+ Wizmatch crons run via `node-cron` inside the Express process |
| **PostgreSQL DB** | Railway → PostgreSQL service | All 6 `wizmatch_*` tables live here |
| **Migrations** | Railway → API service startup | Auto-run on every deploy via `node dist/scripts/migrate.js` |

### Vercel (NOT Wizmatch)

| Component | Where | Details |
|---|---|---|
| D2C Landing Pages | Vercel → `ecom.growthescalators.com` | Marketing pages only. **Zero Wizmatch code here.** |

### External Services Called by Wizmatch

| Service | Purpose | Called From |
|---|---|---|
| Claude API (Anthropic) | Scoring, matching, email drafting, reply classification | `src/services/claudeService.ts` |
| Apollo.io | Email enrichment (find decision-maker emails) | `src/routes/wizmatch.ts` → `/signals/:id/enrich` |
| Hunter.io | Backup email finder | `src/routes/wizmatch.ts` → `/signals/:id/enrich` |
| MillionVerifier | Email verification | `src/routes/wizmatch.ts` → `/signals/:id/enrich` |
| Purelymail SMTP | Cold email sending | `src/services/multiDomainMailer.ts` |
| SerpAPI | X-ray LinkedIn candidate search | `src/services/wizmatchXrayScraper.ts` |
| GitHub API | Developer candidate mining | `src/services/wizmatchGithubMiner.ts` |
| DOL flcdatacenter.com | H-1B LCA data import | `src/services/wizmatchLcaImporter.ts` |
| Greenhouse/Lever/Ashby APIs | ATS job board polling | `src/services/wizmatchAtsPoller.ts` |
| Cloudflare R2 | Resume + RTR PDF + MSA document storage | `src/utils/r2.ts` |
| Slack | Alerts for signals, replies, digests | `src/services/slackService.ts` |

---

## 9. Troubleshooting

### "I can't log in at crm.growthescalators.com"

1. Check if Railway deploy succeeded: Railway dashboard → API service → Deployments → latest should be "Active"
2. Check if the seed script ran: The admin user `jatin@wizmatch.com` won't exist until you run the seed
3. Try the default password: `Wizmatch2025!` (or whatever `WIZMATCH_ADMIN_PASSWORD` env var you set)

### "The Wizmatch pages are blank / show errors"

1. Check browser console (F12 → Console) for API errors
2. Verify `WIZMATCH_TENANT_ID` is set on Railway and matches the seed output
3. Verify the migration ran (tables exist): Railway Shell → `psql $DATABASE_URL -c "\dt wizmatch*"` → should list 6 tables

### "Cron jobs not running / no signals appearing"

1. Check Railway logs: Railway dashboard → API service → **Logs** tab
2. Look for `[worker]` log lines — crons log when they start/finish
3. JobSpy requires Python on the Railway container — it runs via `child_process.exec`. If Python isn't available, JobSpy cron will log an error but other crons still work
4. ATS Poller, GitHub Miner, X-Ray Scraper don't need Python — they should work if env vars are set

### "Email sending not working"

1. Verify Purelymail SMTP credentials are correct for all 6 inboxes
2. Check that domain health rows exist (seed script creates them)
3. Check DNS records: SPF, DKIM, DMARC must be configured on all 3 domains via your registrar (Namecheap)
4. Test DNS: `dig TXT getwizmatch.com` → should show SPF record with Purelymail include

### "GitHub Actions workflows not running"

1. Verify you pushed the `.github/workflows/*.yml` files (Section 6)
2. Go to GitHub repo → **Actions** tab → check if workflows are visible
3. The workflows need these GitHub Secrets set:
   - Go to repo → **Settings** → **Secrets and variables** → **Actions**
   - Add: `RAILWAY_INTERNAL_API_URL` = your Railway API URL (e.g., `https://crm.growthescalators.com`)
   - Add: `INTERNAL_API_TOKEN` = same value as on Railway

### "I see TypeScript errors in Railway logs"

This shouldn't happen — the build passed locally. But if it does:
1. Check Railway build logs for the specific error
2. The most common cause is a missing env var at build time (shouldn't matter — env vars are read at runtime)

---

## Quick Start Summary (TL;DR)

```bash
# 1. Generate secrets
openssl rand -hex 32  # → INTERNAL_API_TOKEN
openssl rand -hex 32  # → WIZMATCH_UNSUBSCRIBE_HMAC_SECRET

# 2. Wait for Railway deploy, then run seed
# (Railway dashboard → API service → Shell)
npx tsx src/scripts/seedWizmatch.ts
# → Copy WIZMATCH_TENANT_ID from output

# 3. Set env vars on Railway
# (Railway dashboard → API service → Variables tab)
# Add all variables from Section 4

# 4. Push GitHub Actions workflows
gh auth refresh -s workflow
git add .github/
git commit -m "ci: add Wizmatch GitHub Actions workflows"
git push origin main

# 5. Test
# Go to crm.growthescalators.com → log in → check Wizmatch pages
```

---

*Last updated: July 2026. For questions, reference `docs/wizmatch-staffing-module.md` for the technical architecture.*