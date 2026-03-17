# n8n Workflow Files

Import these into n8n **in order** after deploying n8n on Railway.
See `DEPLOY_N8N_RAILWAY.md` for deployment steps.

## Workflows

### 01 - Job Queue Processor
**File:** `01-job-queue-processor.json`
- Runs every **30 seconds** via Schedule Trigger
- Queries the `jobs` table for `pending` jobs due now
- Routes each job to the correct sub-workflow based on `job_type`
- Claims the job (marks it `processing`) before executing
- Handles errors by marking jobs `failed`

**Job types handled:**
| job_type | Sub-workflow |
|----------|-------------|
| `inbound_wa` | 02-process-inbound-wa |
| `sequence_step` | 03-process-sequence-step |
| `hot_lead_alert` | 04-hot-lead-alert |
| `booking_processed` | Mark complete (no action needed) |
| `form_submit` | 05-process-form-submit |

### 02 - Process Inbound WhatsApp
**File:** `02-process-inbound-wa.json`
- Triggered by workflow 01 when job_type = `inbound_wa`
- Extracts phone number, message body, contact name from payload
- Calls `POST /contacts` to find or create the contact
- Enrols contact in `D2C Lead Nurture` sequence
- Sends welcome WhatsApp template via Meta API
- Marks job complete

### 03 - Process Sequence Step
**File:** `03-process-sequence-step.json`
- Triggered by workflow 01 when job_type = `sequence_step`
- Gets contact details to check doNotContact flag
- Routes to email (via `POST /email/send`) or WhatsApp template (via Meta API)
- Logs message record via `POST /messages`
- Marks job complete

### 04 - Hot Lead Alert
**File:** `04-hot-lead-alert.json`
- Triggered by workflow 01 when job_type = `hot_lead_alert`
- Sends a WhatsApp text message to JATIN_WHATSAPP number
- Message format:
  ```
  🔥 HOT LEAD ALERT
  Name: [contactName]
  Score: [score]/100
  Call scheduled: [scheduledAt]
  Deal: [dealTitle]
  Check CRM immediately.
  ```
- Marks job complete

### 05 - Process Form Submit
**File:** `05-process-form-submit.json`
- Triggered by workflow 01 when job_type = `form_submit`
- Extracts name, phone, email, source from Tally form payload
- Finds or creates contact via `POST /contacts`
- Enrols in `D2C Lead Nurture` sequence
- Marks job complete

---

## After Import — Important Steps

1. **Update sub-workflow IDs** in `01-job-queue-processor`:
   - Open workflow 01 in n8n
   - Click each "Run: xxx" node
   - Change the workflowId from placeholder to the actual ID of the imported workflow
   - Save

2. **Set up Postgres credentials** in n8n:
   - Go to Credentials → New → Postgres
   - Host: `postgres.railway.internal` (internal Railway network)
   - Port: `5432`
   - Database: `railway`
   - User: `postgres`
   - Password: (from Railway Postgres service variables)
   - Schema: `public`
   - Name this credential: `Railway Postgres`

3. **Set environment variables** in the n8n Railway service:
   - `META_ACCESS_TOKEN` — from Meta Business Manager
   - `META_PHONE_NUMBER_ID` — from Meta Business Manager
   - `JATIN_WHATSAPP` — Jatin's WhatsApp number (with country code, e.g. 919876543210)

4. **Activate all workflows** — toggle the Active switch on each workflow

---

## Express API Endpoints Used by n8n

| Method | Endpoint | Used By |
|--------|----------|---------|
| GET | `/jobs/pending` | Workflow 01 (alternative polling) |
| PATCH | `/jobs/:id/claim` | Workflow 01 |
| PATCH | `/jobs/:id/complete` | All workflows |
| PATCH | `/jobs/:id/fail` | Error handler |
| POST | `/contacts` | Workflows 02, 05 |
| POST | `/sequences/enrol` | Workflows 02, 05 |
| POST | `/email/send` | Workflow 03 (email channel) |
| POST | `/messages` | Workflow 03 |
| GET | `/contacts/:id` | Workflow 03 |
