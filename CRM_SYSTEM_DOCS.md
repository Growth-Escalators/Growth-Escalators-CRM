# Growth Escalators CRM — Full System Documentation

## Overview

A custom-built CRM + automation backend for Growth Escalators, a digital marketing agency. The system handles the full customer lifecycle: lead capture → qualification → pipeline tracking → outreach → client onboarding. Deployed on **Railway** at `web-production-311da.up.railway.app`.

- **CRM Admin Panel**: `web-production-311da.up.railway.app/crm`
- **D2C Frontend** (sales page + payments): `web-production-311da.up.railway.app/`
- **Stack**: Node.js + Express (backend) · React + Vite + Tailwind (frontend) · PostgreSQL + Drizzle ORM (database) · Railway (hosting)

---

## Architecture

```
[D2C Landing Page]  [Cal.com]  [Meta WhatsApp]  [Cashfree Payments]  [Tally Forms]  [Chatwoot]
        |               |              |                  |                  |              |
        └───────────────┴──────────────┴──────────────────┴──────────────────┴──────────────┘
                                          |
                               Express.js Backend (Railway)
                                          |
                    ┌─────────────────────┼──────────────────────┐
                    |                     |                       |
              REST API Routes      Background Workers       Webhook Handlers
              (JWT protected)    (stuckJob + sequence)    (Meta WA, Cal.com, etc.)
                    |
              PostgreSQL (Railway)
```

**Single repo, unified deployment.** The backend serves the React admin panel as static files from `/crm`, and the D2C landing page from `/`.

---

## Database Schema (18 Tables)

| Table | Purpose |
|-------|---------|
| `tenants` | Multi-tenant root. Growth Escalators = slug `growth-escalators` |
| `contacts` | Every lead/prospect. Has `tags[]`, `metadata{}`, `status`, `score`, `doNotContact` |
| `contact_channels` | Phone numbers, WhatsApp, emails per contact (unique per contact+type+value) |
| `deals` | Pipeline cards. Has `stage`, `serviceType` (ecom/direct), `metadata.archived` |
| `clients` | Converted clients (won deals), with retainer/performance fee info |
| `events` | Append-only audit log of all events (payments, bookings, messages, etc.) |
| `messages` | Outbound + inbound message log (WA + email) |
| `sequences` | Automation sequences. Each has `steps[]` (JSONB array of {templateName, delayDays, channel}) |
| `sequence_enrolments` | Tracks each contact's position in a sequence (currentStep, nextStepAt, status) |
| `bookings` | Cal.com bookings with qualification score + tier |
| `jobs` | Background job queue (pending/processing/done/failed). Idempotency key prevents double-processing |
| `processed_events` | Idempotency guard for all incoming webhooks |
| `wa_templates` | Registry of approved WhatsApp templates |
| `tasks` | Manual tasks assigned to contacts/deals |
| `funnels` | Round-robin booking rotation groups |
| `funnel_members` | Individual members in a funnel (calcom URL + weight + assignment count) |
| `funnel_assignments` | Full audit log of every booking redirect |
| `users` | CRM admin login accounts (email + bcrypt password hash) |

---

## Backend API Routes

All routes under `/api/*` are JWT-protected (except `/api/auth/*` and webhooks).

### Authentication — `/api/auth`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/login` | Email + password → returns JWT token |

### Contacts — `/api/contacts`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/contacts` | List contacts. Filters: `status`, `source`, `search`, `dateFrom`, `segment`, `limit`, `offset` |
| GET | `/api/contacts/:id` | Single contact with all channels |
| GET | `/api/contacts/:id/channels` | Contact channels only |
| POST | `/api/contacts` | Create contact |
| PATCH | `/api/contacts/:id` | Update contact (status, tags, metadata, DNC, etc.) |
| POST | `/api/contacts/:id/channels` | Add a channel (whatsapp/email/phone/etc.) |
| POST | `/api/contacts/bulk-tag` | Bulk tag contacts. Body: `{ contactIds[], tags[], mode: 'add' \| 'replace' }` |

### Deals (Pipeline) — `/api/deals`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/deals` | List deals. Filters: `stage`, `contactId`, `serviceType`, `includeArchived` (default: archived excluded) |
| POST | `/api/deals` | Create deal |
| PATCH | `/api/deals/:id` | Update stage/value/metadata. Auto-sets `closedAt` when moved to 'won'/'lost' |
| POST | `/api/deals/bulk-create` | Add multiple contacts to a pipeline stage. Skips existing. Body: `{ contactIds[], stage, serviceType }` |

### Sequences (Automations) — `/api/sequences`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sequences` | List all sequences for tenant |
| POST | `/api/sequences` | Create a sequence |
| GET | `/api/sequences/stats` | Sequences with enrolment counts (active/completed/cancelled per sequence) |
| POST | `/api/sequences/enrol` | Enrol a contact into a sequence by name |
| DELETE | `/api/sequences/enrolments/:id` | Cancel a specific enrolment |
| GET | `/api/sequences/enrolments` | Get enrolments for a contact. Query: `?contactId=` |

### Messages — `/api/messages`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/messages` | Log a message (called by n8n/automations) |
| GET | `/api/messages` | Get message history. Query: `?contactId=&limit=` |
| POST | `/api/messages/send/whatsapp` | Send WhatsApp template via Meta Cloud API v21.0 + log it. Requires: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` env vars |

### Email — `/api/email`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/email/send` | Send sequence email (called by n8n). Uses Brevo template |
| POST | `/api/email/contact` | Add/update contact in Brevo mailing list |
| POST | `/api/email/manual` | Send one-off email via Brevo + log it. Body: `{ contactId, subject, body }` |

### Booking Rotation — `/api/book`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/book/:slug` | **Visitor-facing**: round-robin redirect to team member's Cal.com |
| POST | `/api/book/funnels` | Create funnel + members |
| GET | `/api/book/funnels` | List funnels for tenant |
| GET | `/api/book/funnels/:slug/stats` | Assignment stats per member |
| POST | `/api/book/funnels/:slug/members` | Add member to funnel |
| PATCH | `/api/book/funnels/:slug/members/:id` | Update member (URL, weight, active) |
| POST | `/api/book/funnels/:slug/reset` | Reset assignment counts |

### Webhooks — `/api/webhooks`

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/webhooks/meta-wa` | Meta webhook verification challenge |
| POST | `/api/webhooks/meta-wa` | Inbound WhatsApp messages → queued as jobs |
| POST | `/api/webhooks/calcom` | Cal.com booking → immediate processing (contact + deal creation + qualification) |
| POST | `/api/webhooks/tally` | Tally form submission → queued as job |
| POST | `/api/webhooks/chatwoot` | Chatwoot conversation events → queued |

### Cashfree Payments — `/api/cashfree`

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/cashfree/create-order` | Create payment order |
| POST | `/api/cashfree/webhook` | Payment success/failure webhook |

---

## Background Workers

Two workers run continuously alongside the Express server:

### 1. Sequence Worker
Polls `sequence_enrolments` every minute for rows where `status = 'active'` and `nextStepAt <= now`. For each due enrolment:
1. Looks up the sequence's `steps[currentStep]`
2. Sends the message (email via Brevo, WhatsApp via Meta API, or n8n webhook)
3. Increments `currentStep`, sets `nextStepAt = now + step.delayDays`
4. If no more steps: marks enrolment `completed`

### 2. Stuck Job Worker
Polls the `jobs` table for jobs stuck in `processing` state for >10 minutes, resets them to `pending` for retry.

---

## CRM Admin Panel

**URL**: `web-production-311da.up.railway.app/crm`

Built with React + Vite + Tailwind CSS. JWT token stored in `localStorage` as `ge_crm_token`.

### Pages

#### 1. Login Page (`/crm/login`)
Standard email/password login. Calls `POST /api/auth/login`. Stores JWT + user info.

#### 2. Contacts Page (`/crm/contacts`)
Full contact list with:
- **Search** by name, **filter** by source/status/segment
- **Checkbox multi-select** — click any row's checkbox to select; header checkbox selects all
- **BulkActionBar** (appears when contacts selected):
  - **Tag**: type comma-separated tags → adds to all selected contacts (union, doesn't replace existing)
  - **Add to Pipeline**: choose Ecom or Direct pipeline + target stage → creates deal cards for selected contacts (skips any already in that pipeline)
- **Click any contact row** → opens ContactSlideIn panel

#### 3. ContactSlideIn (right-side drawer)
Opens when clicking a contact. Sections:
- **Contact info**: WhatsApp link + "Send WA" button, email + "Send Email" button, status, assigned-to
- **Tags** (editable): existing tags with × remove button, text input to add new tags, Save button → `PATCH /contacts/:id`
- **Pipeline stage**: shows correct stages based on deal type (Ecom = 9 stages, Direct = 5 stages). Click any stage to instantly move the deal
- **Active Sequences**: lists current sequence enrolments with step number, next send time, and Cancel button
- **Recent Messages**: last 5 messages sent/received
- **Notes**: free-text notes saved to `contact.metadata.notes`
- **Actions**: Mark/Remove Do-Not-Contact flag
- **Send Message modal** (WhatsApp tab + Email tab):
  - WhatsApp: template name + optional JSON variables → `POST /messages/send/whatsapp`
  - Email: subject + body → `POST /email/manual`

#### 4. Pipeline Page (`/crm/pipeline`)
Kanban board with drag-and-drop:
- **Two pipelines**: Ecom Buyers (9 stages) and Direct/Booking (5 stages) — switcher at top
- **Segment filter**: All / Ecom Brand / Agency Owner / Freelancer
- **Show Archived toggle**: hides/shows archived deals (default: hidden)
- **Deal cards**: show contact name, days since last update (red if >3 days), segment badge, deal value
- **Three-dot menu on each card**: Archive (soft-hide) or Unarchive → `PATCH /deals/:id { metadata.archived }`
- **Drag card** between stages → `PATCH /deals/:id { stage }` instantly

#### 5. Automations Page (`/crm/automations`)
Sequence visibility dashboard:
- **Stat cards**: Total sequences, Active enrolments, Completed, Running sequences
- **Table**: Sequence name | Channel | Steps count | Active enrolments (pulsing badge) | Completed count | Status (Active/Paused)
- **Expandable rows**: click any row to see each step (step number, template name, channel, delay days)

---

## External Integrations

| Service | Purpose | How |
|---------|---------|-----|
| **Cal.com** | Meeting bookings | Webhook → `POST /webhooks/calcom` → contact + deal creation + qualification scoring |
| **Meta Cloud API** | WhatsApp outbound | `POST https://graph.facebook.com/v21.0/{PHONE_ID}/messages` |
| **Meta Webhooks** | WhatsApp inbound | `POST /webhooks/meta-wa` → job queue |
| **Brevo** | Email sending (sequences + manual) | `POST https://api.brevo.com/v3/smtp/email` |
| **Cashfree** | Ecom product payments (₹9/208/508/707) | `/cashfree/create-order` + webhook |
| **Chatwoot** | Support chat events | Webhook → job queue |
| **Tally** | Lead gen forms | Webhook → job queue |

---

## Environment Variables (Railway)

| Variable | Purpose | Status |
|----------|---------|--------|
| `DATABASE_URL` | PostgreSQL connection | Set |
| `JWT_SECRET` | Auth token signing | Set |
| `BREVO_API_KEY` | Email sending | Set |
| `META_APP_SECRET` | Webhook signature verification | Set |
| `META_VERIFY_TOKEN` | Webhook verification challenge | Set |
| `CASHFREE_APP_ID` | Payment gateway | Set |
| `CASHFREE_SECRET_KEY` | Payment gateway | Set |
| `WHATSAPP_PHONE_NUMBER_ID` | WhatsApp outbound sending | **NOT SET — needed to enable Send WA button** |
| `WHATSAPP_ACCESS_TOKEN` | WhatsApp outbound sending | **NOT SET — needed to enable Send WA button** |

---

## Key Data Flows

### 1. New Lead via Cal.com Booking
```
Cal.com → POST /webhooks/calcom
  → Extract answers from qualification form
  → Score contact (0-100 based on answers)
  → Determine tier (hot/warm/cold)
  → Create/update contact in DB
  → Create deal in appropriate pipeline + stage
  → Save booking record with score + tier
```

### 2. Ecom Buyer Payment (₹9/208/508/707)
```
D2C Landing Page → POST /cashfree/create-order
  → Cashfree payment page
  → Payment success → POST /cashfree/webhook
  → Create/update contact
  → Create deal in Ecom pipeline at paid_{amount} stage
  → Enrol contact in relevant sequence
```

### 3. Sequence Message Send
```
Sequence Worker (cron, every 1 min)
  → Find enrolments where nextStepAt <= now
  → For each: send step message (WA or email)
  → Log to messages table
  → Set nextStepAt = now + delayDays
  → If last step: mark enrolment completed
```

### 4. Manual WhatsApp from CRM
```
CRM User clicks "Send WA" on ContactSlideIn
  → Selects template + variables
  → POST /messages/send/whatsapp
  → Lookup contact's phone number
  → POST Meta Cloud API v21.0
  → Log message to DB
  → Show success/error in modal
```

### 5. Round-Robin Booking
```
Visitor clicks booking link → GET /book/{funnel-slug}
  → Lookup funnel members + their weights
  → Pick member with lowest (totalAssigned/weight) ratio
  → Log to funnel_assignments
  → Increment member.totalAssigned
  → 302 Redirect to member's Cal.com URL
```

---

## What's Pending / Not Yet Done

### 1. WhatsApp Sending — needs env vars only, no code changes needed
The backend endpoint `POST /messages/send/whatsapp` is **fully coded and deployed**. It currently returns a 503 error until you add these two env vars in Railway:
- `WHATSAPP_PHONE_NUMBER_ID` — from Meta Business Manager → WhatsApp → Phone Numbers
- `WHATSAPP_ACCESS_TOKEN` — from Meta Business Manager → WhatsApp → Permanent Access Token

### 2. Custom Domain `crm.growthescalators.com`
Currently the CRM is at the Railway-generated URL. Moving to `crm.growthescalators.com` requires **Railway Pro plan** (custom domains are a paid feature). No code changes needed — just upgrade Railway plan and point DNS.

### 3. WhatsApp Template Management UI
The `wa_templates` table exists in the DB to register approved Meta templates, but there's no CRM page to manage them. Currently templates must be added directly via DB or API. A templates management page in the Automations section would complete this.

### 4. Bulk Remove from Pipeline
Currently bulk actions support "Add to Pipeline". There's no bulk "Remove from Pipeline" or bulk archive. Could be added to BulkActionBar.

### 5. Task Management UI
The `tasks` table exists (with assignedTo, dueAt, status) but there's no CRM UI to create/view/complete tasks linked to contacts or deals.

### 6. Client Onboarding View
The `clients` table exists (created when a deal is marked 'won') with retainer amount, services, performance fee config — but there's no CRM page showing active clients with their billing info.

### 7. Reporting / Analytics Dashboard
No reporting page yet. Revenue pipeline, conversion rates, sequence performance, booking source breakdown — all data is in the DB but no dashboard to visualize it.

---

## File Structure

```
growth-escalators-backend/
├── src/
│   ├── index.ts                    # Express app entry, middleware, route mounting
│   ├── db/
│   │   ├── schema.ts               # All 18 table definitions (Drizzle ORM)
│   │   └── index.ts                # DB connection + table re-exports
│   ├── routes/
│   │   ├── auth.ts                 # Login
│   │   ├── contacts.ts             # Contacts CRUD + bulk-tag
│   │   ├── deals.ts                # Pipeline deals + bulk-create + archive filter
│   │   ├── sequences.ts            # Sequence management + stats + enrolments
│   │   ├── messages.ts             # Message log + send/whatsapp
│   │   ├── email.ts                # Email send (sequence + manual)
│   │   ├── booking.ts              # Round-robin funnels + redirect
│   │   ├── bookings.ts             # Bookings CRUD
│   │   ├── webhooks.ts             # Meta WA, Cal.com, Tally, Chatwoot
│   │   ├── cashfree.ts             # Payment orders + webhook
│   │   └── jobs.ts                 # Job queue inspection
│   ├── services/
│   │   ├── sequenceService.ts      # Enrol, cancel, getActiveEnrolments
│   │   ├── emailService.ts         # sendSequenceEmail, sendManualEmail, addContactToBrevo
│   │   ├── bookingService.ts       # processBooking (Cal.com qualification logic)
│   │   ├── jobQueue.ts             # insertJob, processNextJob
│   │   └── roundRobinService.ts    # getNextMember, createFunnel, getFunnelStats
│   ├── workers/
│   │   ├── sequenceWorker.ts       # Polls + sends due sequence steps
│   │   └── stuckJobWorker.ts       # Resets stuck processing jobs
│   └── middleware/
│       ├── auth.ts                 # JWT verification, attaches req.user
│       └── validateWebhook.ts      # Meta webhook HMAC signature check
│
└── admin/                          # React CRM frontend
    └── src/
        ├── App.jsx                 # Routes: /login, /contacts, /pipeline, /automations
        ├── lib/api.js              # apiFetch wrapper (auto-attaches JWT, handles 401)
        ├── components/
        │   ├── Sidebar.jsx         # Nav: Contacts, Pipeline, Automations + user/logout
        │   ├── ContactSlideIn.jsx  # Full contact detail panel (tags, pipeline, sequences, messaging)
        │   └── BulkActionBar.jsx   # Floating bar for bulk tag/pipeline actions
        └── pages/
            ├── LoginPage.jsx
            ├── ContactsPage.jsx    # Contact list with checkboxes + filters
            ├── PipelinePage.jsx    # Kanban board with archive + drag-drop
            └── AutomationsPage.jsx # Sequence stats dashboard
```
