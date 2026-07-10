# Wizmatch — verified dataflow (code-traced 2026-07-10)

This is the **authoritative** map of how data moves through the Wizmatch staffing/outreach system,
traced from the actual code (worker crons, services, routes, and the tables they touch) — not from
memory. Use it to (a) ground the Cockpit redesign and (b) feed Claude design when the repo is attached.

> Honesty note: an earlier "5-stage funnel" sketch was directionally right but **incomplete**. It
> missed the four automated sourcing engines, the fact that Wizmatch and Growth use **different**
> senders, that the candidate-supply side is a **separate** funnel, and that Wizmatch tables live in
> ensure-hooks (not `schema.ts`). This doc corrects all four.

---

## 0. Two things to know first

**A) There are TWO funnels, not one.**
- **Demand / outreach funnel** — find companies that are hiring → email the right person. (This is
  what the Cockpit owns.)
- **Candidate / supply funnel** — intake talent → match to open roles → place. (Separate workflow;
  the Cockpit deliberately excludes it.)

**B) There are TWO separate senders — do not confuse them.**
- **Wizmatch outreach → your own mailer.** `sendColdEmail()` in `multiDomainMailer.ts` sends via
  Purelymail SMTP directly (per-inbox cap, suppression, HMAC unsubscribe). Called from
  `routes/wizmatch.ts` (signal send + the PR #24 contact send). **This is the Cockpit's Send stage.**
- **Growth outreach → Saleshandy (external SaaS).** `outreachEnrichmentService.ts` uploads
  `outreach_leads` to a Saleshandy sequence; `saleshandyStatsService.ts` polls stats. This is the
  *Growth Escalators* agency's sender, a different product/tenant. Not part of the Cockpit.

---

## 1. The real tables (all created via `CREATE TABLE IF NOT EXISTS` ensure-hooks in services — NOT in `schema.ts`)

| Table | Funnel role |
|---|---|
| `wizmatch_job_signals` | Raw hiring signals (a detected open role / hiring event). `status='new'` until scored. |
| `wizmatch_companies` | Target companies (the orgs we might pitch). |
| `wizmatch_company_intelligence` | Per-company qualification snapshot: `qualification_tier` (A/B/C/Reject), `qualification_score`, status. |
| `wizmatch_requirements` | Parsed roles / job descriptions (structured). |
| `wizmatch_contact_candidates` | Discovered contacts per company (name/role inbox, confidence tier, team, MX) — output of the discovery cascade. |
| `wizmatch_discovery_runs` | Audit of each discovery run (cost, `paid_provider`, provider calls) — powers the cost guard + cooldown. |
| `wizmatch_domain_health` | Sending domains + health/warmup state. |
| `wizmatch_suppression_list` | Do-not-contact list (manual + auto hard-bounce). |
| `wizmatch_outreach_templates` | Outreach templates with merge fields (PR #24). |
| `wizmatch_candidates`, `wizmatch_candidate_intake`, `wizmatch_certified` | Candidate-supply side (talent pool + certification). |
| `wizmatch_placements` | Placements / closed staffing deals. |
| `outreach_leads` | Reply-tracking bridge — a Wizmatch contact is inserted here as `status='Active'` so the IMAP reply matcher tracks replies. (Table is shared with Growth outreach; the two are distinguished by `source`.) |
| `messages` | Email drafts + sent records (reused CRM table; `metadata` holds candidateId, fromInbox, etc.). |

---

## 2. Scheduled jobs (worker.ts) — all gated behind `DISABLE_BACKGROUND_JOBS !== 'true' && WIZMATCH_TENANT_ID`

If `WIZMATCH_TENANT_ID` is unset, **none of these run** (that's the master on/off for the pipeline).

| Cron | Schedule | Stage | What it does |
|---|---|---|---|
| Wizmatch Signal Scoring | every 30 min | QUALIFY | Reads `wizmatch_job_signals` `status='new'` (≤50), scores → tier, marks processed. Calls the **public web** service via `WIZMATCH_API_BASE_URL` (localhost would stall it — known gotcha). |
| Wizmatch Enrichment | hourly | QUALIFY/CONTACT | Enriches signals/companies (company metadata) before contact discovery. |
| Wizmatch Matching | every 2 h | SUPPLY | Matches `wizmatch_candidates` ↔ `wizmatch_requirements`. (candidate funnel) |
| Wizmatch Domain Health | hourly | SEND infra | Recomputes `wizmatch_domain_health`. |
| Wizmatch Domain Warmup | every 6 h | SEND infra | Advances domain warmup. |
| Wizmatch ATS Poller | daily 00:30 | FIND | Polls ATS/job boards → new `wizmatch_job_signals`. |
| Wizmatch X-Ray Scraper | daily 02:30 | FIND | X-ray sourcing → signals/contacts. |
| Wizmatch GitHub Miner | daily 03:30 | FIND | Mines GitHub for hiring/company signals. |
| Wizmatch LCA Importer | weekly Sun 16:30 | FIND | Imports US LCA (visa) filings as hiring signals. |
| Wizmatch Daily Digest | Mon–Sat 12:30 | reporting | Digest summary. |

> Browser/Python-heavy scrapers run as **GitHub Actions** workflows (not the worker) — the worker
> comment says "HTTP/DB-only jobs (no browser/Python — those run in GitHub Actions)." So some
> FIND-stage sourcing is split between the worker (HTTP) and CI (Playwright).

---

## 3. Demand / outreach funnel — end to end

```
                 (4 auto engines + manual)              every 30 min                 manual, cost-guarded
 SOURCES ───────────────────────────────────▶ wizmatch_job_signals ──▶ SCORING ──▶ wizmatch_company_intelligence
 ATS poll · X-ray · GitHub miner · LCA ·        (+ wizmatch_companies)   (tier A/B/C,   (status='qualified', tier, score)
 seed-company / CSV upload                                               urgency)              │
                                                                                               │  "send to Contact Intelligence"
                                                                                               ▼
                                                        CONTACT DISCOVERY CASCADE (free-first, cost-guarded)
                                                        website scrape → pattern guess → Reacher verify → Serper named-people
                                                                                               │
                                                                                               ▼
                                                        wizmatch_contact_candidates (confidence tier, team, MX)
                                                        + wizmatch_discovery_runs (cost audit)
                                                                                               │  human approve + compose
                                                                                               ▼
                                                        SEND (PR #24, gated WIZMATCH_SENDING_ENABLED)
                                                        template → messages draft → sendColdEmail (multiDomainMailer)
                                                        per-inbox cap + suppression + HMAC unsubscribe
                                                        + insert outreach_leads status='Active'
                                                                                               │
                                                                                               ▼
                                                        TRACK  IMAP reads inbox → match Active outreach_leads → classify (Haiku)
                                                               bounces → wizmatchBounceParser → wizmatch_suppression_list
                                                               wins → wizmatch_placements
```

**Stage-by-stage:**

1. **FIND** — Four automated engines (ATS/X-ray/GitHub/LCA crons) + manual **seed-company** / **CSV
   upload** (`/api/wizmatch/client-discovery/seed-company`) create rows in `wizmatch_job_signals` and
   `wizmatch_companies`.
2. **QUALIFY** — *Signal Scoring* (30 min) scores signals; `qualifyCompanyForContactIntelligence()`
   turns score + hard-blocks into **Tier A/B/C/Reject** + **hiring urgency**, persisted to
   `wizmatch_company_intelligence` (`status='qualified'`). Requirements are parsed into
   `wizmatch_requirements`; *Requirement Priority* ranks which roles to chase.
3. **CONTACT** — A human sends a qualified company from **Client Discovery → Contact Intelligence**
   (`.../companies/:id/send-to-contact-intelligence`). The **discovery cascade** (cost-guarded,
   Apollo/Snov off by default) produces `wizmatch_contact_candidates` with confidence tiers; each run
   is audited in `wizmatch_discovery_runs`.
4. **SEND** — (PR #24, behind `WIZMATCH_SENDING_ENABLED`) pick a template → render merge fields →
   `messages` draft → `sendColdEmail()` with per-inbox daily cap, suppression check, HMAC
   unsubscribe; the contact is registered in `outreach_leads` (`status='Active'`) for reply tracking.
5. **TRACK** — `imapService` reads the inbox, matches Active `outreach_leads`, classifies replies
   (Haiku); hard bounces auto-suppress via `wizmatchBounceParser` → `wizmatch_suppression_list`.
   Closed deals land in `wizmatch_placements`.

---

## 4. Candidate / supply funnel (separate — NOT in the Cockpit)

```
candidate intake ─▶ wizmatch_candidates / wizmatch_candidate_intake
                         │  Matching cron (every 2h)
                         ▼
                    wizmatch_requirements  ──▶ match/shortlist ──▶ wizmatch_certified
                         │                                              │
                         └──────────────▶ RTR generator (right-to-represent) ──▶ wizmatch_placements
```

Services: `wizmatchCandidateIntake`, `wizmatchCandidateIntelligence`, `wizmatchMatching`,
`wizmatchRtrGenerator`, `wizmatchRequirementSheet`. Reference data: `wizmatchPrimes` (prime vendors).

---

## 5. Gotchas that shape the dataflow (record these)

- **Tables aren't in `schema.ts`** — they're ensure-hook `CREATE TABLE IF NOT EXISTS` inside the
  services. To change a table you edit the service's ensure-hook, not a migration.
- **Master switch:** the whole cron pipeline only runs when `WIZMATCH_TENANT_ID` is set and
  `DISABLE_BACKGROUND_JOBS !== 'true'`.
- **Worker→web callback:** signal-scoring (and similar) run in the *worker* service and must reach the
  *web* service over `WIZMATCH_API_BASE_URL` — never localhost.
- **Two senders:** Wizmatch = `multiDomainMailer` (Purelymail SMTP); Growth = Saleshandy. Metrics like
  `saleshandy_uploaded` belong to the Growth funnel, not Wizmatch.
- **CONTACT is manual + cost-guarded** by design (never auto-spends): needs a cost-guard token and
  human review before a contact is used.
- **Sending is gated off** (`WIZMATCH_SENDING_ENABLED=false`) until explicitly enabled.

---

## 6. How this maps to the Cockpit redesign

| Cockpit element | Backed by |
|---|---|
| FIND count | `wizmatch_job_signals` (new) + `wizmatch_companies` |
| QUALIFY (Strong/Maybe/Skip + urgency) | `wizmatch_company_intelligence` tier/score + scoring urgency |
| CONTACT cards (Verified/Likely/Guess, team, mailbox host) | `wizmatch_contact_candidates` (+ `wizmatch_discovery_runs` for cost) |
| SEND (compose, cap, compliance) | `messages` + `multiDomainMailer` + `wizmatch_suppression_list` |
| REPLIES | `outreach_leads` (Active) + IMAP classify; bounces → suppression |
| Status band: Budget | `wizmatch_discovery_runs` cost vs cost-guard cap |
| Status band: Domain health / Sends | `wizmatch_domain_health` + per-inbox counts in `messages` |
| Status band: Pipeline value | `wizmatch_placements` |

**Not in the Cockpit** (separate funnel / back rooms): candidate pool, matching, placements, primes,
analytics/ROI, guardrails detail, data readiness.
