# Wizmatch Go-Live Playbook

**Audience:** the Wizmatch operator (Kanishk). **Updated:** 2026-07-10.
**Goal:** work the staffing funnel end-to-end and start converting leads today.

---

## 0. Your access

- **URL:** https://crm.growthescalators.com  → log in with **tenant / product = Wizmatch**.
- **Login account:** `kanishk.khandelwal@growthescalators.com` — obtain or reset the password through the approved secure channel; credentials are never stored in this repo.
  → **change this password after first login** (profile / forgot-password).
- **Role:** admin on the Wizmatch tenant — you can edit pipeline stages, add email
  templates, and manage everything in the Wizmatch nav.
- Outreach is **manual for now**: automated cold-email sending is deliberately off. You
  contact approved leads from your own inbox and log everything in the CRM.

## 1. What's already loaded

| | Count | Notes |
|---|---|---|
| Candidates (supply) | **260** | Rich pool — ready to match/submit |
| Companies (demand) | 2 | Thin — you'll grow this by seeding |
| Requirements | 0 | Enter these as you qualify companies |
| Job signals | 2 (scored) | Scoring pipeline works; volume is the gap |
| Email templates | 3 starters | `Intro`, `Follow-up`, `Value` — edit/add your own |

## 2. The daily loop (do this every morning)

Start on **Home → "What needs attention"** / **Review Workbench** — it lists everything
waiting for you. Then work the two funnels:

### Demand funnel — win clients (manual contact)
1. **Seed / find hiring companies** → *Client Discovery → "Seed a prospect company"* (or CSV).
   Add companies you find hiring (LinkedIn, job boards, referrals). *(Auto-scrapers are
   blocked — see §5 — so demand is seeded by hand for now.)*
2. **Qualify** the good ones → *Send to Contact Intelligence*.
3. **Contact Intelligence** → discover the named contact (TA / HR / Hiring Manager) →
   **Approve** → **Link to CRM**.
4. **Reach out manually**: the linked contact is now in **Contacts / Pipeline**. Copy an
   **Email Template**, personalise it, send from your own inbox. Then **log the activity**,
   **create a follow-up task**, and **move the pipeline stage**.
5. **Reply → convert**: replies land in **Inbox** → log on the contact → advance the deal:
   `New → Contacted → Replied → Meeting → Won / Lost`.

### Supply funnel — candidates
1. **Intake** new candidates → *Candidate Intelligence* (CSV or manual form). 260 already loaded.
2. **Review / enrich** profiles.
3. **Match** candidates to open requirements.
4. **Placements** → track match → placement → margin.

## 3. Pipeline

- Wizmatch has a **"Wizmatch Placements"** pipeline (supply side, 6 stages). For client
  acquisition you can add a **"Client Acquisition"** pipeline via *Pipeline Manager* with the
  stages above (`New → Contacted → Replied → Meeting → Won/Lost`). Stages are editable any time.

## 4. Email templates

- 3 starters are pre-loaded (merge fields `{{firstName}}` `{{company}}` `{{title}}` `{{senderName}}`).
- Add/edit your own from the **Email Templates** page — no code needed.
- Sending is manual: templates are copy you paste into your own email.

## 5. Known limits (be aware, don't fight these)

- **Dice / Naukri auto-scrapers are blocked at the IP level** (Akamai/anti-bot returns
  "Access Denied" to CI runners — verified 2026-07-10). No selector fix helps. Real auto-
  sourcing from these needs a residential proxy or a licensed feed (a separate, paid decision).
  **Until then: seed demand manually + use the working auto-engines.**
- **WhatsApp inbound stopped 2026-06-29** (webhook break). If a lead replies on WhatsApp you
  may not see it yet — email replies are unaffected. Fix tracked separately.
- **Automated cold-email sending is off** by design — outreach is manual.

## 6. When you're ready to scale outreach

Turning on automated, throttled, compliant sending is a separate deliberate step (warm-up
inbox → real prospects under a daily cap). Ask for the sending go-live when manual volume
justifies it.
