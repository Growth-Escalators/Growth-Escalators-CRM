# Wizmatch — Operator Guide

**For:** the Wizmatch operator (Kanishk). **Updated:** 2026-07-10.
A single guide to what the system does, how to run it day to day, how people get
contacted, and the few external details still to fetch.

---

## 1. What Wizmatch is (one minute)

Wizmatch is a staffing/recruitment engine with **two funnels**:

- **Demand** — find **companies that are hiring**, reach the **decision-maker**, and pitch them your candidates.
- **Supply** — maintain a pool of **candidates**, match them to open roles, and place them.

You win when a demand signal (a hiring company) meets a matching candidate and you connect the two.

---

## 2. Logging in

- URL: **https://crm.growthescalators.com** → choose product/tenant **Wizmatch**.
- Login: `kanishk.khandelwal@growthescalators.com` / `Kanishk@#2026` → **change the password after first login**.
- You are **admin** on the Wizmatch tenant (full access: pipeline, templates, all Wizmatch screens).

---

## 3. Your daily loop (start here every morning)

Open **Home → "What needs attention"** (or **Review Workbench**) — it lists everything waiting for you. Then:

1. **Client Discovery** — review newly-found hiring companies (auto-sourced overnight). **Qualify** the good ones → *Send to Contact Intelligence*.
2. **Contact Intelligence** — for a qualified company, find the named decision-maker → **Approve** → **Link to CRM**.
3. **Reach out** (manual — see §5) → **log the activity**, create a **follow-up task**, move the **pipeline stage**.
4. **Candidate Intelligence** — review candidates, match them to open requirements.
5. **Inbox** — read replies, advance deals: `New → Contacted → Replied → Meeting → Won/Lost`.

---

## 4. Where the demand data comes from (runs automatically)

You don't have to source manually — these feed the system on a schedule:

| Source | What it brings | When | Cost |
|---|---|---|---|
| **Dice** | US tech/contract job signals | on run | $0 |
| **ATS boards** (Greenhouse/Lever/Ashby) | Open roles at 26 seeded companies (Airbnb, Stripe, Datadog…) | daily 6 AM IST | $0 |
| **RemoteOK** | Remote tech/contract roles | daily 7 AM IST | $0 |
| **LCA / H-1B filers** | C2C-friendly company signal | weekly | $0 |
| **X-Ray + GitHub miner** | **Candidates** (supply) | daily | $0 |
| **TheirStack** (India, incl. Naukri) | India job signals | weekly | $0 free tier — **needs API key (see §7)** |

Every job signal is auto-**scored** (0–10) and flagged **C2C-friendly** when it mentions corp-to-corp / 1099 / visa-open language. Higher-scoring, C2C-flagged signals are your priorities.

---

## 5. How people actually get contacted

**Sending is manual right now** (automated cold email is deliberately off). You email/call from your own inbox using the templates on the **Email Templates** page, then log it in the CRM.

### Companies (decision-makers) — automatic email discovery
When you approve a company contact, the system finds the decision-maker's email for free:
pattern-guess → **Reacher verification** (only "verified" emails are used) → paid finders stay off.
The email shows on the contact card — copy it, personalise a template, send.

### Candidates — reachability reality (read this)
- **All current candidates (from GitHub) have a real email** → you can email them. **They have no phone numbers and no resumes**, and they're **passive** (sourced, not applicants), so treat as cold: verify the email, personalise, expect modest reply rates.
- **For phone-reachable, placeable candidates**, use **Candidate Profile Intake (CSV / form)** — when someone applies, is referred, or is on your bench, enter their **email + phone + resume + availability**. That opt-in pool is what you actually place.
- **Phone numbers** only come from opt-in intake (or paid enrichment later). Don't expect phones on GitHub-sourced candidates.

---

## 6. Pipeline & templates

- Pipeline stages are editable any time via **Pipeline Manager** (you're admin). Suggested client-acquisition stages: `New → Contacted → Replied → Meeting → Won/Lost`.
- 3 starter outreach templates are pre-loaded; add/edit your own on **Email Templates** (merge fields `{{firstName}}` `{{company}}` `{{title}}` `{{senderName}}`).

---

## 7. Details still to fetch (and how)

1. **TheirStack API key (free) — unlocks India/Naukri demand at $0.**
   - Sign up at **theirstack.com** (free tier, no card: 200 job credits/month).
   - Copy your API key from their dashboard → **send it to Jatin/Claude** to set `THEIRSTACK_API_KEY`.
   - The weekly India importer then wakes up automatically.
2. **More ATS target companies** — to widen demand, give a list of companies you want targeted (ideally your client-type / C2C-friendly firms). They get added to the daily ATS harvest.
3. **Opt-in candidates** — start collecting real applicants/bench with **phone + resume** via Candidate Intake; that's the placeable pool.

---

## 8. Known limits (so nothing surprises you)

- **Automated sending is OFF** — outreach is manual from your inbox. (Turning on throttled auto-send is a separate, deliberate step for later.)
- **Candidate phones/resumes** — not available for the GitHub-sourced pool; come from opt-in intake.
- **Naukri direct scraping is blocked** (their bot-wall blocks our servers). India demand comes via TheirStack instead (§7).
- **WhatsApp inbound** has been down since 29 Jun — email replies are unaffected; a WhatsApp reply may not show yet.

---

## 9. Who to ping for what

- **Set an API key / env / add ATS companies / turn on sending** → Jatin (or Claude).
- **Day-to-day operating** (qualify, approve, outreach, match, pipeline) → all self-serve in the admin.
- **Something looks broken / a screen 500s** → note the screen + time and flag it.
