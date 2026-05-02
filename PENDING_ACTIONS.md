# Pending Manual Actions — Jatin

Running checklist of things that **only Jatin can do** (require Railway
dashboard, n8n UI, or a real laptop). Update this file after each session.

Last updated: 2026-05-03

---

## 1. Cost reduction — Railway services to delete

Decided 2026-05-02. Estimated saving: ~$25/month. The CRM repo and n8n
keep running; only side-tools go.

Delete order matters — apps before their dedicated DBs/queues.

- [ ] postiz-frontend
- [ ] postiz-proxy
- [ ] postiz
- [ ] Postgres-vfMc  (Postiz's dedicated Postgres — only after the 3 above)
- [ ] Redis (capital R — Postiz's dedicated Redis. **Verify first** that
      `web` and `GE-Worker` reference the lowercase `redis` service, not
      this one.)
- [ ] shlink
- [ ] reacher
- [ ] uptime-bridge
- [ ] uptime-kuma
- [ ] gotenberg  (only if no PDF generation is needed — search the
      codebase for "gotenberg" to confirm it isn't used)

Path on iPhone: railway.com/dashboard → `production` project →
service tile → Settings → bottom of page → Danger Zone → Delete.

---

## 2. SEO — pause everything (in progress)

Code changes already shipped on `claude/railway-cost-analysis-EcW4z`
(commit `87539a6`). All 10 worker SEO crons are gated behind
`SEO_ENABLED` and will no-op once deployed. Still need to:

- [ ] Verify after deploy: `GE-Worker` Railway logs show
      `[CRON] SEO crons paused — set SEO_ENABLED=true to re-enable`
      on the next SEO cron firing.
- [ ] Deactivate 12 n8n SEO workflows on
      `https://primary-production-6c6f5.up.railway.app`
      (login `admin / ***REDACTED-ROTATED-2026-07-23***`). Toggle each WF-SEO-01..12
      from Active → Inactive. **Do not delete** — preserves history.
- [ ] Remove paid API keys from Railway → Variables (save them in
      password manager first):
  - [ ] `VALUESREP_API_KEY` (n8n service) — ~$50/mo saved
  - [ ] `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` (n8n service) — ~$30/mo saved
  - [ ] `SERPER_API_KEY` (web service) — variable usage saved

Full inventory + resume instructions: `SEO_PAUSED.md`.

---

## 3. Outreach — n8n WF-02 reply handler manual delete

Repo file already deleted on this branch (commit `b4dbdab`). The live
workflow on n8n still exists.

- [ ] Open n8n panel → find "WF-02 — Reply Handler" → delete it.
      WF-02B (the IMAP poller) is the active replacement and stays.

---

## 4. Branch merge

Everything done in these sessions sits on
`claude/railway-cost-analysis-EcW4z`. To ship to production:

- [ ] On a laptop: `git fetch origin && git checkout main && git merge claude/railway-cost-analysis-EcW4z && git push origin main`.
      Railway auto-deploys main → web + worker services pick up the
      mobile UI changes and the SEO pause flag.

---

## 5. Outreach — Phase 0 pause (in progress)

Code changes shipped on `claude/railway-cost-analysis-EcW4z`. The 3 outbound
crons (Daily Lead Discovery, Outreach Enrichment, Saleshandy Auto-Upload) are
gated behind `OUTREACH_PAUSED` and will no-op once deployed. Reporting,
funnel snapshot, CRM sync of late replies, and the n8n WF-02B reply poller
all keep running. Still need to:

- [ ] Set `OUTREACH_PAUSED=true` on the `GE-Worker` Railway service Variables
      tab. Trigger redeploy. Verify with the log line
      `[CRON] Outreach pipeline paused — unset OUTREACH_PAUSED to resume`.
- [ ] Set `MAX_DAILY_UPLOADS=0` on the `GE-Worker` service as a belt-and-
      braces second guard. (`OUTREACH_PAUSED=true` alone is enough; this is
      a no-cost extra safety net.)
- [ ] Pause **n8n WF-01 Lead Enrichment** on
      `https://primary-production-6c6f5.up.railway.app`. WF-01 has its own
      Saleshandy upload path independent of the worker. Open workflow →
      toggle Active → Inactive. **Don't delete.**
- [ ] In Saleshandy → Settings → Sender Accounts, for each of the 6
      Purelymail inboxes: keep **Warmup ON**, set **Daily limit = 0**.
      Inboxes stay warm without consuming capacity on bad copy.
- [ ] Verify Saleshandy → Sequences → main sequence → Settings:
      "Stop sending on reply" = ON (no change, just confirm).

To resume after offer rewrite (Phase 3 of the plan):
- Unset `OUTREACH_PAUSED` on Railway.
- Set `MAX_DAILY_UPLOADS=50` (small pilot volume).
- Re-activate n8n WF-01 only after deciding whether to keep it or fold its
  path into the backend.
- Bump Saleshandy daily limit per inbox back to 25 (then ramp per runbook).

---

## 6. Optional — Railway hard usage cap

- [ ] Railway → Account → Usage → "Set limits" — set hard cap to ~$30/mo.
      Acts as a safety net while the side-tool deletions and SEO pause
      take effect.

---

## What's already done (no action needed)

- ✅ Mobile-friendly: layout shell, Dashboard, Tasks, Billing, Finance,
  Inbox, Contacts, Pipeline pages
- ✅ Removed `wf-02-reply-handler.json` from the repo
- ✅ Gated all worker SEO crons behind `SEO_ENABLED` env flag
- ✅ Wrote `SEO_PAUSED.md` resume guide
- ✅ Wrote this file
