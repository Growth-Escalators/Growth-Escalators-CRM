# Outreach Runbook

Operational tasks that live **outside the codebase** — Saleshandy UI, Purelymail inbox warmup, and day-to-day outreach hygiene.

Updated: 2026-04-18 (zero-budget scale-to-10-15-meetings push)

---

## 1. Saleshandy sequence — add Step 2 and Step 3

**Why**: Single-step sequences cap at ~1.5% reply rate. Steps 2 and 3 typically double total reply rate over the sequence lifespan. Agency outbound benchmarks rank the "break-up" email (Step 3) as the highest-reply-generating message in a cold sequence.

**How**:
1. Open Saleshandy → Sequences → **sequence id in `SALESHANDY_SEQUENCE_ID`**
2. Open the sequence → "Steps" tab
3. **Step 2** — add a new step, day +3 from Step 1
   - Subject: `One more idea on {{company}}`
   - Body (3–4 lines max):
     > Hi {{firstName}},
     >
     > Following my note from Monday — we help {{country}} agencies like {{company}} take performance marketing delivery off their plate, keep quality tight, and run at 60–70% lower fulfilment costs.
     >
     > If there's even a 10-minute window this week, worth a call?
     >
     > — Jatin
4. **Step 3** — add a new step, day +7 from Step 2 (day +10 from Step 1)
   - Subject: `should I stop reaching out, {{firstName}}?`
   - Body (2 lines max):
     > Hi {{firstName}},
     >
     > If this isn't a fit right now, no worries — just reply "pass" and I'll close the loop. Otherwise happy to share a one-pager on how we work.
     >
     > — Jatin

5. Save. Activate.

**Verify**: send a test send to yourself (Saleshandy → Send test). Step 2 and Step 3 should queue at the day offsets above.

---

## 2. Stop sequence on reply (safety check)

**Why**: If a prospect replies to Step 1, Steps 2 and 3 must NOT fire — otherwise we look like a bot and waste the reply window.

**How**:
1. Saleshandy → Sequences → our sequence → Settings
2. Find "Stop sending on reply" — must be **ON**
3. Find "Stop sending on bounce" — must be **ON**

**Verify**: after sequence activation, send Step 1 to your own address, reply, wait 24h. Step 2 should show status `Stopped (Replied)` in the prospect view.

---

## 3. Inbox warmup ramp (per-inbox weekly schedule)

**Why**: All 6 Purelymail inboxes currently send ~25/day. A fully-warmed Purelymail inbox safely sends 50–80/day — we're using half the capacity. Pushing too hard too fast burns reputation; the ramp below stretches the step-up over 4 weeks.

### Schedule (per inbox, in Saleshandy → Settings → Sender Accounts → <inbox> → Daily limit)

| Week | Daily limit per inbox | 6-inbox fleet total |
|------|----------------------:|--------------------:|
| 1    | 25                    | 150                 |
| 2    | 35                    | 210                 |
| 3    | 45                    | 270                 |
| 4+   | 55                    | 330                 |

### How to ramp

- Every Monday morning, bump each inbox's daily limit by 10 (capped at 55).
- Check the "Per-inbox health" strip on [crm.growthescalators.com/outreach-dashboard](https://crm.growthescalators.com/outreach-dashboard) — the bounce-rate tile shows red (≥5%) if a slot is misbehaving. **Never bump a slot that's red.** Pause it for 48h instead, then resume at its previous limit.

### How to tell if warmup is working

- Open rate stays ≥ 40% week-over-week
- Bounce rate stays ≤ 3%
- No single inbox contributes >25% of bounces

---

## 4. Daily upload cap (MAX_DAILY_UPLOADS)

The backend enforces a daily ceiling on prospects uploaded to Saleshandy via env var `MAX_DAILY_UPLOADS` (default 200). This is a safety net — if enrichment has a surge day, we don't accidentally blow through a week of warmup capacity in one afternoon.

Set on Railway:
```
MAX_DAILY_UPLOADS=200
```

Bump to 300 when fleet daily total hits Week 4+ (≥ 330/day).

---

## 5. Manual checks — weekly

- **Monday 10 AM IST** — bump each inbox's daily limit (see §3)
- **Monday 10 AM IST** — open Saleshandy inbox view for each of the 6 inboxes, check for bounce backlog / quarantine
- **Friday 4 PM IST** — eyeball the `replies_total` spark-line on the dashboard; if last 7 days < 15 replies, something is broken (usually: inbox tanked, sequence paused, or enrichment cron errored)

---

## 6. Things that should NEVER be done

- Never re-activate `wf-06-auto-discovery.json` — that workflow is deprecated and will conflict with the worker cron `Daily Lead Discovery`.
- Never drop `Stop sending on reply` in the Saleshandy sequence settings.
- Never upload a CSV directly into Saleshandy — the backend enrichment path is the only sanctioned route (it dedupes, MX-validates, icebreaker-personalises). Manual CSVs bypass all of that.

---

## 7. Env vars checklist (Railway)

The worker boot-time audit Slack-DMs Jatin if any of these are missing. Quick reference:

- `GOOGLE_PLACES_API_KEY`
- `SERPER_API_KEY`
- `HUNTER_API_KEY` + `SNOVIO_API_KEY`
- `SALESHANDY_API_KEY` + `SALESHANDY_SEQUENCE_ID`
- `OUTREACH_INTERNAL_SECRET`
- `PURELYMAIL_PASS_1` .. `PURELYMAIL_PASS_6`
- `ANTHROPIC_API_KEY`
- **`MEETING_BOOKING_URL`** — Jatin's Cal.com / Calendly link (appended to INTERESTED-reply drafts so prospects self-book)
- **`MAX_DAILY_UPLOADS`** — default 200; soft cap on daily Saleshandy uploads
