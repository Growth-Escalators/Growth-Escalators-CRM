# Wizmatch — Client-Acquisition Funnel Audit

> **Historical evidence, not current status or implementation authority.** Re-verify every finding
> against current code/environment. Current remediation status lives in
> [`docs/wizmatch/WIZMATCH_STAFFING_OS_DEFECT_REGISTER.md`](../wizmatch/WIZMATCH_STAFFING_OS_DEFECT_REGISTER.md),
> and the exact execution slice lives in [`.ai/CURRENT_TASK.md`](../../.ai/CURRENT_TASK.md).
> Suggested fixes below require design review when they could remove existing behavior.

- **Date:** 2026-07-12
- **Auditor:** Claude (per `docs/wizmatch/CLIENT_FUNNEL_TEST_PLAN.md`)
- **Surface tested:** **Live production** — `crm.growthescalators.com`, Wizmatch tenant, authenticated admin session. Findings reflect real production data, not a local seed.
- **Scope:** Client-acquisition (demand) side only — Dashboard → Review Workbench → Client Discovery → Signals → Contact Intelligence → Requirement Priority → Requirements → Placements → Analytics → AI Intelligence, plus a light System check and the Client-Lead view of Contacts. Candidate/talent side out of scope.
- **Nature:** Read-only audit. No sends, no paid discovery confirmations, no edits to `schema.ts`, `migrations/`, `auth.ts`, `rbac.ts`, `cashfree.ts`, or `sodEodService.ts`. Test records I created are listed in §6.
- **Method:** Every button clicked in the live UI; every suspicious result cross-checked against the source in `src/routes/wizmatch.ts`, `src/services/wizmatch*.ts`, and `admin/src/pages/Wizmatch*.jsx`, and against `docs/wizmatch/DATAFLOW.md`. Every claim below cites a file:line or an exact repro.

---

## 1. Verdict

**Not ready to run real client-acquisition work today.** The guardrails are excellent and nothing dangerous is happening — no outreach can be sent, no meaningful money can be spent, and the team is not going to embarrass itself. But the funnel is **structurally incapable of producing its output**: a named decision-maker at a qualified hiring company. It is a very well-built, very safe machine that is not connected to anything.

**The single biggest blocker is that contact discovery is unreachable from the live UI.** The cost-guarded preview → confirm → run-discovery flow *is fully implemented* (`WizmatchNewPages.jsx:1125`, `:1145`), but it is only routed at `/wizmatch/contact-intelligence-new-demo` (demo mode). The live route `/wizmatch/contact-intelligence` renders a **different component** (`WizmatchContactIntelligencePage.jsx`) that has **no discovery call in it at all** and hardcodes `paidDiscoveryEnabled: false, maxPaidDiscoveryPerCompany: 0` (`:253-254`). `/wizmatch/contact-intelligence-new` redirects *back* to the non-discovery page (`App.jsx:242`). Net effect: of 50 "qualified" companies, **48 show "0 contacts"**, and the only contacts that exist in the entire system are 3 guessed generic inboxes (`contact@infosys.com`, `info@infosys.com`) plus whatever an operator types in by hand.

Two more failures sit right behind it, each independently fatal to the intended workflow:

- **"Parse with AI" returns HTTP 401 100% of the time.** `WizmatchRequirementsPage.jsx:30` reads `localStorage.getItem('ge_crm_token')` — the *Growth Escalators* tenant's key. The Wizmatch token lives under `wizmatch_crm_token` (`auth.js:7,14,88`). A Wizmatch user always sends `Authorization: Bearer null`. The JD-paste/upload → Claude-parse → confirm flow, which the plan calls out specifically, **has never worked in production for any Wizmatch user.**
- **Automated sourcing produces zero usable demand.** There are **6,492 signals**. Filtering Signals to "7+ (Priority)" returns **3** — and all 3 are `source = manual`, hand-typed, with a score of 8 that is **hardcoded, not computed** (`wizmatch.ts:1895` — `VALUES (..., 8, 'scored')`, bypassing `scoreSignal()` entirely). The Analytics page's own Signals-by-Source table is the proof: Greenhouse 5,436 signals @ **avg score 1.2**, Lever 896 @ **avg 0.1**, RemoteOK 79 @ **avg 0.2**, Dice 78 @ **avg 2.0**, Manual 3 @ **avg 8.0**. The enrichment gate is ≥7. **Not one of the ~6,489 automatically-sourced signals has ever cleared it.**

Fix those three and the funnel has a spine. Everything else in this report is downstream of them.

---

## 2. Functionality matrix

| Page | Feature / Button | Works? | Notes |
|---|---|---|---|
| **Dashboard** | Page load, 8 metric tiles | ✅ | Renders fast, real numbers |
| | `Refresh` | ✅ | `GET /api/wizmatch/dashboard` → 200 |
| | `Act in Review Workbench` (×6) | ⚠️ | Links work, but all 6 go to the generic `/wizmatch/review-workbench` — no deep-link to the item you clicked |
| | "Wizmatch funnel" Steps 1–6 | ⚠️ | Links work; order contradicts the sidebar and inserts out-of-scope Candidate Intelligence as Step 4 (D-21) |
| | `REVIEW ACTIONS 22 / 13 safe` | ❌ | Workbench shows 30 / 20 for the same queue — computed with a different fetch limit (D-8) |
| | `OPEN TASKS 0` sub-label | ❌ | Sub-label reads "271 tenant contacts" — unrelated to the metric (D-20) |
| **Review Workbench** | Queue load, filters (Module, Priority) | ✅ | Filters work |
| | Card anatomy (what it is / why it's here / score) | ✅ | Genuinely good — see §5 |
| | `Send to Contact Intelligence` | ✅ | `POST .../send-to-contact-intelligence` → 200, inline green result, button → `Done` |
| | …its success message | ❌ | Says "decision-maker discovery is **queued**". Nothing is queued — no queue, no cron (D-12) |
| | `Approve contact` | ✅ | Works (verified via Contact Intelligence) |
| | `Blocked` (×10) | ❌ | Permanently disabled dead ends — 33% of the queue is unactionable and cannot be dismissed (D-11) |
| **Client Discovery** | Signal list, score-component breakdown | ✅ | The breakdown panel is excellent |
| | `Seed prospect` | ✅ | Creates company + signal + CI snapshot; clear success message |
| | `Bulk import CSV` | — | Not exercised (would create bulk live rows) |
| | `TOTAL SIGNALS 75` | ❌ | Real total is **6,492**. This is the fetch-page size, not a count (D-8) |
| | `HOT 0` | ❌ | Mathematically unreachable — max attainable is 70/100 (D-7) |
| | Queue relevance ("IT/Tech only") | ❌ | Dominated by Spotify Music Editors, Legal Counsel, Government Affairs (D-4, D-5) |
| **Signals** | List, `All Status` / `Any Score` / Source filters | ✅ | All filters work correctly |
| | Auto-refresh 30s, 6,492 total | ✅ | Honest count |
| | Signal quality | ❌ | 3/6,492 clear the priority gate; all 3 manual (D-3) |
| **Contact Intelligence** | Queue, tiers, score components, "Why this company" | ✅ | Well built |
| | `Add manual contact` | ✅ | 201, contact appears, banner confirms |
| | `Approve` / `Reject` (contact) | ✅ | 200, `Status: Needs Review → Approved` |
| | `Link CRM` | ✅ | 200, `Status: Linked To Crm`, real CRM contact created |
| | …its result | ⚠️ | Shows a raw UUID with no link to the contact (D-23) |
| | `Approve company` / `Reject company` / `Watchlist` | ✅ | Persist review state, honestly labelled |
| | **Run contact discovery** | ❌ | **No such button exists on the live page** (D-1) |
| | Discovered "decision-makers" | ❌ | Infosys's 3 contacts are `contact@`/`info@` guessed inboxes, not people (D-1) |
| | `QUALIFIED 50` | ❌ | `queue?limit=50` — a fetch limit, not a count (D-8) |
| | `TIER A 0` | ❌ | Structurally unreachable, same cause as HOT (D-7) |
| **Requirement Priority** | Page with 0 requirements | ❌ | Four zeros, no empty state, no way to add anything, no link to Requirements (D-14) |
| | Page with ≥1 requirement | ✅ | Comes alive: score 81, six component bars, "Why this priority", top-3 matches. Good page |
| | `Prepare review plan` | ⚠️ | 200 + banner that says nothing was performed (D-15) |
| **Requirements** | Empty state | ✅ | "No requirements yet — create one from a client JD." |
| | `New Requirement` drawer | ✅ | Opens, all fields present |
| | `Parse with AI` (Paste JD) | ❌ | **HTTP 401, always** (D-2) |
| | `Parse with AI` (Upload file) | ❌ | Same code path, same 401 (D-2) |
| | …its error handling | ❌ | Blocking native `alert()` freezes the page (`WizmatchRequirementsPage.jsx:181`) |
| | `Save & Generate Sheet` (manual fields) | ✅ | 200 → requirement created → PDF generated and opened |
| | `PDF` / `Regenerate` | ✅ | Both work |
| | Company linkage | ❌ | No company field on the form → requirement shows "No company" (D-13) |
| **Placements** | Kanban (Submitted→Ended), filters, `Export`, `+ Add Placement` | ✅ | Renders; 0 placements (expected) |
| | Currency | ⚠️ | Shows `$0/hr margin`; Analytics shows `₹0` (D-22) |
| **Analytics** | Everything | ✅✅ | **Best page in the product.** See §5 |
| **AI Intelligence** | Page load, tiles | ✅ | Fine |
| | `Generate with Claude` | ❌ | **HTTP 503 after ~70s**; UI shows only "not available" (D-6) |
| **System** | `Readiness` tab | ✅ | Loads; but "ready 100/100" is misleading (D-19) |
| | `Deliverability / Domains` tab | ✅ | 3 domains, SPF ✅ DMARC ✅. No DKIM check (D-24) |
| | `Compliance / Suppression` tab | ✅ | Loads, add-suppression form present |
| | `Cost & Guardrails` tab | ✅ | Clear and real. Reveals D-16 |
| | `System Health / Env` tab | ✅✅ | **Presence-only. Zero secret values leaked.** Exactly right |
| **Contacts** | List, tabs, search | ⚠️ | Loads (272) |
| | Client-Lead segmentation | ❌ | No Client Lead tag/tab exists; linked contact is untagged (D-9) |
| | Search by full name / email | ❌ | "ZZ Test Auditbot" → 0 results; "zz-audit-test" → 0 results; "ZZ" → 1 result (D-10) |

---

## 3. Defects, ranked

### P0 — blocks the funnel from producing its output

**D-1 · Contact discovery is unreachable in the live UI. The funnel cannot produce a decision-maker.**
- **Did:** Opened `/wizmatch/contact-intelligence`, selected every company type (seeded, Infosys, Logix Guru, Databricks). Looked for any way to run the discovery cascade described in `DATAFLOW.md` §3 (website scrape → pattern guess → Reacher verify → Serper).
- **Expected:** A "Preview discovery" → "Run discovery" pair behind a cost-guard confirm, per `DATAFLOW.md` and the 2026-07-09 cost-leakage audit which reviewed exactly that gate.
- **Actual:** No such control exists. Every company shows `DISCOVERY: blocked by cap — Phase 1 internal-only`, and the Reviewable Contacts panel says *"No reusable internal contacts found. Paid discovery is blocked in Phase 1."* The only contact-producing action is **`Add manual contact`** — i.e. type it in yourself.
- **Root cause:** Two Contact Intelligence components exist. `WizmatchNewPages.jsx:1057` (`WizmatchContactIntelligenceNewPage`) **has** the full flow — `previewDiscovery()` → `POST .../discovery-preview` (`:1125`) and `runDiscovery()` → `POST .../discover` with `confirmPreview: true` (`:1145`). But `App.jsx:240` routes it **only** at `/wizmatch/contact-intelligence-new-demo` with `demoMode`. The live route `App.jsx:241` renders `WizmatchContactIntelligencePage.jsx`, which contains **no `discovery-preview` or `/discover` call anywhere** and hardcodes `paidDiscoveryEnabled: false, maxPaidDiscoveryPerCompany: 0` (`:253-254`). And `App.jsx:242` redirects `/wizmatch/contact-intelligence-new` → back to the live (non-discovery) page.
- **Impact:** 48 of 50 "qualified" companies have **0 contacts**. The 3 that exist are `contact@infosys.com` / `info@infosys.com` — MX-validated *pattern guesses at generic role inboxes*, not decision-makers. Yet the Review Workbench presents them as *"A decision-maker was discovered for this company."* The backend endpoints (`wizmatch.ts:3164`, `:3191`) are live and cost-guarded. **This is a routing/wiring bug, not a missing feature** — the fix is likely to point the live route at the `New` component (with `demoMode={false}`).

**D-2 · "Parse with AI" returns 401 for every Wizmatch user. The JD → Requirement flow has never worked in prod.**
- **Did:** Requirements → `New Requirement` → `Paste JD` → pasted a realistic 6–9yr Node.js/K8s JD with budget, positions, location → `Parse with AI`.
- **Expected:** Claude parses the JD and pre-fills Title / Region / Location / Experience / Budget / Positions / Skills.
- **Actual:** `POST /api/wizmatch/requirements/parse` → **HTTP 401**. Nothing is pre-filled. The page then **freezes** because the failure is surfaced via a blocking native `alert()` (`WizmatchRequirementsPage.jsx:181`).
- **Root cause:** `WizmatchRequirementsPage.jsx:30`:
  ```js
  headers: { Authorization: `Bearer ${localStorage.getItem('ge_crm_token')}` },
  ```
  This is the **Growth Escalators** storage key. `auth.js:7,14` define `storagePrefix: 'ge_crm'` for `growth-escalators` and `'wizmatch_crm'` for `wizmatch`; `auth.js:88` builds the key as `${storagePrefix}_token`. So a Wizmatch session's token is at `wizmatch_crm_token`, and `ge_crm_token` is `null` → `Authorization: Bearer null` → 401. This is the **only** hand-rolled `fetch` in the file (the comment at `:23` explains it bypasses `apiFetch` for multipart) — and it's the one that got the key wrong. Every other call in the app goes through `apiFetch` → `getAuthToken()` → correct key, which is why nothing else 401s.
- **Impact:** The headline feature of the Requirements page — and the "Claude-parse → confirm" step the test plan asks about — is 100% broken. Both `Paste JD` and `Upload file` hit the same function. Manual field entry still works, which is the only reason requirements can be created at all.
- **Fix:** one line — use `getAuthToken()` from `lib/auth.js`.

**D-3 · Automated sourcing generates 6,492 signals and zero qualified demand. The 3 "priority signals" are hand-typed and unscored.**
- **Did:** Signals → set score filter to `7+ (Priority)`.
- **Expected:** A working sourcing pipeline surfacing priority hiring signals from Greenhouse/Lever/RemoteOK/TheirStack.
- **Actual:** **3 results out of 6,492.** All three `source = manual`, all score exactly 8 — one of which is the test row I seeded 5 minutes earlier. Analytics → Signals by Source confirms at scale:

  | Source | Signals | Avg score (gate = 7) |
  |---|---:|---:|
  | Greenhouse | 5,436 | **1.2** |
  | Lever | 896 | **0.1** |
  | RemoteOK | 79 | **0.2** |
  | Dice | 78 | **2.0** |
  | Manual | 3 | **8.0** |

- **Root cause (two parts):**
  1. **Manual seeds bypass scoring.** `wizmatch.ts:1892-1895` inserts the signal with a **literal** `score = 8, status = 'scored'` — `scoreSignal()` is never called. My deliberately-garbage company ("ZZ TEST AUDIT - Delete Me Systems Pvt Ltd", no domain, no website) instantly became a joint-top-scoring signal in a 6,492-row database. So the Dashboard's `PRIORITY SIGNALS` metric is not a quality measure — it is **a count of things a human typed in**.
  2. **Auto-sourced signals cannot realistically reach 7.** `wizmatchScoring.ts:98-140`: for US, `daysOpen(0–3) + volume(0–2) + repost(0–3) + keywords(0–2) + lca(0–1)`. Fresh ATS jobs are 1d old → `daysOpen = 0`; the ATS poller never sets `repost_count` → `repost = 0`. That caps a brand-new auto signal at **volume(2) + keywords(2) = 4** — exactly the score every Greenhouse/Lever row displays. A signal must sit open **≥30 days** before `daysOpen` contributes 3 and it can even approach the gate.
- **Impact:** The three automated demand engines are, in their current state, generating 6,489 rows of noise that nothing downstream can act on. Every "qualified" company in Contact Intelligence traces back to a score-4 signal.

### P1 — makes the output wrong or untrustworthy

**D-4 · The ATS poller has no relevance filter. `CONTRACT_KEYWORDS` is declared and never used.**
- **Repro:** Client Discovery → scroll the queue. You will find, in a queue whose header says **"IT/Tech only"**: *Spotify — Senior Music Editor, Taiwan*; *Spotify — Legal Counsel, Platform Liability*; *Spotify — Head of Government Affairs Australia New Zealand*; *Spotify — Marketing Manager UK/IE*; *Spotify — Music Editor, Türkiye*; *Instacart — Field Sales Representative*; *Gusto — Product Designer, Contractors*.
- **Root cause:** `wizmatchAtsPoller.ts:177` defines `const CONTRACT_KEYWORDS = ['contract','c2c','w2','1099',...]` — and `grep` confirms **it is referenced nowhere else in the file**. The poller (`:309-336`) upserts **every job on the company's board**, unfiltered. Dead constant = the filter was intended and never wired.
- **Secondary effect:** the naive `contract` substring also drags in false positives where the filter *is* applied elsewhere — *Stripe — Software Engineer, **Smart Contract**, Bridge* (blockchain), *Samsara — Sales **Contract** Administrator*, *Coinbase — Senior Program Manager, **Contracts** & Analytics*.

**D-5 · "IT/Tech fit" is scored on company + role text combined, so any job at a tech company scores full marks.**
- **Repro:** Client Discovery → click *Stripe — Contracting Operations Specialist* → detail panel shows **`IT/Tech fit 25/25`** for a non-technical operations role.
- **Root cause:** `wizmatchClientDiscovery.ts:182-192`. `itTechFit` tests `TECH_TERMS` against `combinedText(input)`, which is `jobTitle + companyName + companyIndustry + companyCountry + location + source` (`:135-145`). Because "Stripe"/"Spotify"/"Databricks" are software companies, **every** role at them passes the tech gate — including music editors and paralegals. The only thing keeping garbage out is an 11-word `NON_TECH_TERMS` blocklist (`:113-125`), which catches the *word* but not the *concept*.
- **Evidence of the inversion, straight from Contact Intelligence:**
  - *United Infrastructure Ltd — **Mason*** → **qualified**, Tier C, 48/100
  - *OpsArmy Careers — **Australian English Voice Actor**, Perth* → **qualified**, 48/100
  - *Argus Medical Management — **Data Entry Typist*** → **qualified**, 48/100
  - *GitLab — **Site Reliability Engineer, Infrastructure Platforms*** → signal score **0/10**
  A mason and a voice actor are qualified prospects; an SRE — a textbook IT-staffing target — scores zero.

**D-6 · AI Intelligence `Generate with Claude` → HTTP 503.**
- **Repro:** AI Intelligence → `Generate with Claude`. Button shows `Generating…` for **~70 seconds**, then `POST /api/wizmatch/intelligence/generate` → **503**, and the page shows a bare *"Wizmatch AI Intelligence is not available"*. No analysis is ever produced, so the plan's question — *does it cite specific requirements/signals/companies by name?* — cannot be answered: **it produces nothing.**
- **Likely root cause:** `claudeService.ts:48` sets `signal: AbortSignal.timeout(60000)`. The route (`wizmatch.ts:3021`) calls `callClaude(prompt, CLAUDE_MODELS.SONNET, 6000, system)` — a **non-streamed, 6000-max-token** Sonnet call whose prompt embeds the **entire dashboard snapshot as pretty-printed JSON** (`:3017`). A ~70s wall-clock followed by our own 503 catch (`:3029-3035`) is exactly what a 60s abort looks like. **Also worth verifying:** `claudeService.ts:17` pins `SONNET: 'claude-sonnet-4-6'` — confirm that model ID is still valid, since an invalid ID would also fail here.
- **Aggravating:** the API *does* return a `detail` field explaining the failure (`:3033`), but the UI renders only `error`. The operator has no way to self-diagnose.

**D-7 · `HOT` / `Tier A` are mathematically unreachable. The top-priority bucket is permanently empty.**
- **Repro:** `HOT: 0 — Do first` on Review Workbench, Client Discovery, **and** Requirement Priority. `TIER A: 0` on Contact Intelligence. Every single card scores 51 or 61.
- **Root cause:** `wizmatchClientDiscovery.ts:275` — `rawScore = itTechFit(≤25) + signalStrength(≤20) + regionPriority(≤15) + candidateSupply(≤15) + relationshipValue(≤15) + safety(≤10)`. `priorityFor()` (`:162-166`) requires **≥80 for `hot`**. But with 0 requirements, `candidateSupply` is **always 0/15** (`:230-241`), and with no prime/MSA, no prior positive reply and no placements, `relationshipValue` is **always 0/15** (`:244-258`). **Ceiling = 25+20+15+10 = 70.** `hot` cannot be reached, ever, in the current data state.
- **Impact:** The 100-point rubric collapses to two values (51 = US, 61 = India). Region alone decides what gets promoted. The operator gets no real prioritisation — 8 cards tie at exactly 61.

**D-8 · Headline counts are fetch-page sizes, not totals. Three pages disagree about the same queue.**
- **Repro:**
  - Client Discovery says **`TOTAL SIGNALS 75`**. Signals says **`6492 total signals`**. Both read `wizmatch_job_signals`. 6,417 signals are invisible and unworkable in Client Discovery, which has no pagination.
  - Contact Intelligence says **`QUALIFIED 50`**; the network call is literally `GET .../contact-intelligence/queue?limit=50`.
  - Dashboard says **`REVIEW ACTIONS 22 / 13 safe`**; Review Workbench says **`ACTIONS 30 / SAFE 20`** — same queue, viewed 60 seconds apart.
- **Root cause:** both read `workbench.summary.totalActions` (`wizmatch.ts:2931-2933`), but the Dashboard builds it with `buildReviewWorkbenchPayload(tenantId, 10)` (`:2800`) while the Workbench route uses `limit = 30` (`:2617`). `wizmatchReviewWorkbench.ts:251` then computes `totalActions: actions.length` — **the length of the truncated array**. Neither number is a true total.

**D-9 · A linked CRM contact gets no Client Lead tag and no business field — it is indistinguishable from the 270 candidates.**
- **Did:** Contact Intelligence → `Add manual contact` → `Approve` → `Link CRM` (200, "CRM contact linked: 545287d4-…") → opened `/wizmatch/contacts`.
- **Expected (per test plan §4):** contact appears with a **Client Lead tag** and **business fields visible**.
- **Actual:** The contact exists, but its only tag is **`Uncontacted`** and its **`BUSINESS` column is blank (`—`)**. There is no Client Lead tag, no Client Lead tab, and no filter that separates demand-side contacts from the 270 candidates. The `Discovery` tab returns 0.
- **Root cause:** `wizmatch.ts:3564-3575` — `findOrCreateContact()` is called with `source`, `sourceDetail`, `metadata`, and `channels`. **No `tags` are ever set**, and `wizmatch_company_id` is written into `metadata` only, never surfaced to the contact's `business` field.

**D-10 · Contact search fails on full names and on emails.**
- **Repro:** `/wizmatch/contacts` search box (placeholder: *"Search name, phone, company…"*):
  - `ZZ Test Auditbot` (the **exact** string in the CONTACT column) → **"No contacts found"**
  - `zz-audit-test` (the email local-part; EMAIL is a visible column) → **"No contacts found"**
  - `ZZ` → **1 result** ✅
- **Impact:** In a CRM, an operator who searches a contact by their full name or their email address gets zero results. The search appears to match single tokens against a name column only, not a concatenated full name and not email.

### P2 — confusing, misleading, or wasteful

**D-11 · 10 of 30 Review Workbench cards are permanent dead ends.** Cards titled *"Resolve Contact Intelligence blocker for Okta / Elastic / Digital / AECOM / …"* render a **disabled** button labelled **`Blocked`**. `WizmatchOperatingPages.jsx:726,730`: `disabled={!action.allowed}` and the label falls through to `'Blocked'`. The `resolve_safety` verb defined at `:653` (*"Resolve blocker"*) **never renders**. There is no way to resolve, dismiss, or hide any of them, so **33% of the operator's queue is permanently occupied by items that cannot be acted on.** They are also mislabelled: their actual blocker reason is `rejected` (i.e. the company was scored Tier Reject) — that is a *qualification outcome*, not a "safety blocker a human must resolve".

**D-12 · The `Send to Contact Intelligence` success message is false.** It reads *"Sent to Contact Intelligence — **decision-maker discovery is queued**."* (`WizmatchOperatingPages.jsx:630`). Nothing is queued. `POST .../send-to-contact-intelligence` calls `persistContactIntelligenceSnapshot()` (`wizmatch.ts:2205`), a plain upsert into `wizmatch_company_intelligence` with `cost_cents_total = 0`. `grep` finds **no enqueue and no cron for contact discovery anywhere**, and `DATAFLOW.md` §5 confirms *"CONTACT is manual + cost-guarded by design (never auto-spends)"*. An operator will click this and then wait for contacts that will never arrive.

**D-13 · Requirements have no company field, so they are orphaned from the client.** The `New Requirement` form has Title, Region, Location, Work Mode, Employment, Experience, Budget, Positions, Priority, Skills — **but no Company**. The resulting requirement renders as **"No company - INDIA"** in Requirement Priority. The demand funnel's whole purpose is to connect *a role* to *a client you are pitching*; that link doesn't exist. (Suspicious knock-on: my company-less requirement still scored `contactReadiness 15/15` with the reason *"Approved contact path exists."* — worth checking whether contact-readiness is computed tenant-wide rather than per-company.)

**D-14 · Requirement Priority with zero requirements is a dead screen.** Four zero-tiles and nothing else — no empty state, no explanation, no `Add requirement`, no link to `/wizmatch/requirements`. A first-time operator has no idea what to do. (Contrast: the Requirements page's empty state is good.) The page is genuinely strong *once populated* — this is purely a zero-state gap.

**D-15 · `Prepare review plan` succeeds and then tells you it did nothing.** `POST .../requirement-priority/:id/review-plan` → 200, and the banner reads: *"Requirement priority review is planning-only. No candidate submission, outreach, schema, or status update was performed."* It is honest, but no plan artifact is produced, the button stays enabled, and the banner appears at the **top of the page**, ~600px above the button you clicked. The plan file predicted this button would be a no-op; it is.

**D-16 · The "zero paid enrichment" messaging contradicts the Guardrail Center.** Every funnel page displays `cost ₹0`, *"No paid enrichment"*, *"zero paid enrichment"*. But System → Cost & Guardrails shows:
```
paidDiscoveryEnabled     true
googleFallbackEnabled    true          ← Serper is a paid provider
enableApollo             false
enableSnov               false
costGuard                Month Rs 25 / Rs 500
```
and Analytics shows *"Enrichment Cost **₹25** — Phase 1 should stay near zero"*. **₹25 is trivial and well inside the ₹500 cap — this is not an incident.** But the UI asserts zero spend while the guardrail page records real spend with paid discovery enabled. Reconcile the copy with the config, or the team will stop trusting the ₹0 badges.

**D-17 · Requirement-sheet PDFs are served from a public, unauthenticated bucket.** `Save & Generate Sheet` produced `https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/836888d1-…-1783848164084.pdf`, which opens with no auth. These sheets carry client name, role, budget, and rate. Protection is obscurity of the UUID only. Worth a deliberate decision before real client JDs go through this.

**D-18 · `DATAFLOW.md` has drifted from production.** It lists ATS / RemoteOK / TheirStack as the demand engines. Production Analytics shows **`Dice` — 78 signals**, which appears nowhere in the doc, and **TheirStack contributes 0 signals** despite the doc's note that *"TheirStack is live, not dormant — `THEIRSTACK_API_KEY` is configured in production (verified 2026-07-12)"*. Either the weekly importer is silently failing or it has produced nothing.

### P3 — polish

- **D-19 · System → Readiness reports `ready · 100/100`** while Analytics honestly reports the funnel `blocked` at 5 of 7 stages and Client Discovery scoring `0`. Readiness only measures *"do the tables exist and have rows"*. A first-time operator reading "Data Readiness: ready, 100/100" will conclude the system is good to go. Rename it or fold the funnel health into it.
- **D-20 · Dashboard sub-label mismatch:** the `OPEN TASKS · 0` tile's sub-label reads **"271 tenant contacts"** — a number unrelated to the metric above it.
- **D-21 · The Dashboard "Wizmatch funnel" widget disagrees with the sidebar.** It shows 6 steps, inserts **Candidate Intelligence** (supply side) as Step 4 in the middle of the demand funnel, and omits Review Workbench, Signals, and Requirements entirely. The sidebar order is the correct canonical one. This directly undercuts the "one coherent order" goal in test-plan §3.1.
- **D-22 · Resolved for placement-commercial semantics; broader currency normalization remains tracked.** Placements now preserves the stored currency and distinguishes contract hourly margin from permanent fees. Commit `ef2112f` passed focused tests and an authenticated isolated-staging smoke on 2026-07-14 (`₹500/hr contract margin`; `₹2,50,000 permanent fee`; no permanent `/hr` label). Analytics, discovery-cost and guardrail copy still represent different measures and should not be collapsed into one number.
- **D-23 · `Link CRM` reports a raw UUID** (*"CRM contact linked: <redacted-record-id>"*) with no hyperlink. The operator has to go hunt for the contact — and per D-10, searching for it by name won't find it.
- **D-24 · Domain health checks SPF and DMARC but not DKIM**, which is the one most likely to sink cold-email deliverability.
- **D-25 · Duplicate signals reach the operator.** *Databricks — Specialist Solutions Architect, AI/ML* appears **twice**; *Spotify — Head of Backstage Marketing* appears **three times**; *Spotify — Senior ML Engineer, Policy & Safety* and *Manager, Partner Product and Delivery* twice each. `wizmatchAtsPoller.ts:313` dedupes on `job_url` only, so the same role posted under multiple URLs lands multiple times — and then generates multiple identical Review Workbench cards.

---

## 4. UX observations (technically working, would still confuse a first-time operator)

1. **Confirmation banners appear far away from the button that triggered them.** On Contact Intelligence, clicking `Add manual contact` (bottom of a long right-hand panel) renders *"Manual contact added for review."* at the **top** of that panel, off-screen. I genuinely believed the button had done nothing until I scrolled up. Same pattern on Requirement Priority's `Prepare review plan`. Put the result next to the control.
2. **Clicking a card low in the Client Discovery list appears to do nothing.** The detail pane renders at the **top** of the section; if you click row 40, the pane is ~2,000px above your viewport. Needs scroll-into-view or a sticky detail pane.
3. **Two different score scales, both unlabelled.** Signals uses **0–10** (gate ≥7); Client Discovery, Contact Intelligence and Review Workbench use **0–100**. The same Infosys row is "score 8/10" on one page and "62/100" on another. Nothing tells the operator these are different scales.
4. **"WHY IT'S HERE" is identical on every card of a given type.** All eight `Send to Contact Intelligence` cards carry the same four bullets and the same score of 61. It reads as personalised reasoning but is a fixed template — which actively erodes trust once you notice.
5. **The seed form accepts anything and instantly calls it qualified.** "ZZ TEST AUDIT - Delete Me Systems Pvt Ltd", no website, no domain, no industry → immediately **warm, 60/100, eligible for Contact Intelligence handoff**, and its signal is hardcoded to the top score of 8. There is no validation that the company is real.
6. **The Review Workbench mixes supply-side work into a demand queue.** 8 of 30 cards are `review candidate` items, and the Module filter offers `Candidate Intelligence` and `Safety`. For an operator doing client acquisition, a third of the queue is someone else's job and another third (D-11) can't be clicked.
7. **`Act in Review Workbench` doesn't take you to the action.** All six Dashboard attention cards link to the same undeep-linked page; you then have to find the item again by eye.
8. **`Regenerate` on Requirements is visually indistinguishable from disabled** (grey, low contrast) next to the blue `PDF` link.

---

## 5. What is genuinely solid — don't touch this

1. **Analytics / ROI is the best page in the product, and it is *honest*.** It independently diagnosed the product's own biggest problem before I did: it labels 5 of 7 funnel stages **`blocked`**, scores Client Discovery **0**, states plainly *"3/6492 signals are priority; India share is 5.9%"* against an 80% target, and its **Signals-by-Source table** (avg score per source) is the single most valuable diagnostic artifact in the whole system. Whoever built this resisted the urge to make the numbers look good. Keep it exactly as it is.
2. **System → Env Health is a model of how to do this.** *"Presence-only checks — secret values are never shown, only which env var name (if any) satisfied each requirement."* Every one of ~30 rows shows name / present / note and **not one secret value**. It passes the test plan's security check cleanly.
3. **The guardrails actually hold.** Sending is genuinely off (0 sends across 3 healthy domains). Apollo and Snov are genuinely disabled. Manual approval is genuinely enforced. Nothing auto-spends beyond ₹25/₹500. Every mutating action I ran was correctly labelled non-sending, and every one of them told the truth about what it did — *except* D-12. For a pre-launch system touching real inboxes and real money, this is the right posture and it is holding.
4. **The Review Workbench card anatomy is a genuinely good pattern.** *What this is* → *Why it's here* → *guardrail note* → action → **inline result on the card you clicked** → button flips to `Done`. `Send to Contact Intelligence` demonstrated it end to end and it felt great. The pattern is right; it just needs real reasoning behind it (D-4/D-5) and the blocked cards fixed (D-11).
5. **Score-component transparency.** Client Discovery's `IT/Tech fit 25/25 · Signal strength 11/20 · India/US 15/15 · Candidate supply 0/15 · Relationship 0/15 · Safety 10/10`, and the equivalent on Contact Intelligence and Requirement Priority. Showing the operator *exactly* how a number was built is what let me find D-5 and D-7 in minutes. This is excellent design — the arithmetic is just wrong underneath it.
6. **Requirement Priority, once it has data, is a strong page.** Score 81 with six component bars, "Why this priority", `sheet_ready` badge, and top-3 candidate matches inline. It went from a dead screen to a genuinely useful one the moment a single requirement existed.
7. **Requirement sheet generation works and is fast.** `Save & Generate Sheet` → requirement created → branded PDF rendered and opened in one click, with `PDF` / `Regenerate` persisted on the row.
8. **The Contact Intelligence review state machine is correct.** `Needs Review → Approved → Linked To Crm`, each step a clean 200, each with correct button/badge state transitions, and `Link CRM` correctly refuses to run before approval (`wizmatch.ts:3532`).

---

## 6. Test data I created — please clean up

All against **live production**, Wizmatch tenant. Everything is prefixed `ZZ` / `AUDIT TEST` to be unmistakable.

| # | Table | Record | Identifier |
|---|---|---|---|
| 1 | `wizmatch_companies` | `ZZ TEST AUDIT - Delete Me Systems Pvt Ltd` | company_id `<redacted-record-id>` |
| 2 | `wizmatch_job_signals` | `Senior DevOps Engineer (AUDIT TEST)` — source `manual`, score 8 | created by the seed in row 1 |
| 3 | `wizmatch_company_intelligence` | Snapshot for the company in row 1 (Tier B, 67/100) | auto-created by seed |
| 4 | `wizmatch_contact_candidates` | `ZZ Test Auditbot` · VP Engineering (AUDIT TEST) · `zz-audit-test@example.invalid` · status `linked_to_crm` | candidate_id `<redacted-record-id>` |
| 5 | `contacts` (CRM) | CRM contact created by `Link CRM` from row 4 | contact_id `<redacted-record-id>` |
| 6 | `wizmatch_requirements` | `ZZ AUDIT TEST - Senior Backend Engineer (DELETE ME)` | requirement_id `<redacted-record-id>` |
| 7 | R2 (public bucket) | Generated requirement-sheet PDF for row 6 | `<redacted-record-id>-1783848164084.pdf` |

**One touch on a real record:** to test the Review Workbench action end to end I clicked **`Send to Contact Intelligence` on _Stripe — Contracting Operations Specialist_** (company_id `<redacted-record-id>`). Per `wizmatch.ts:2205` this only upserts a `wizmatch_company_intelligence` row with `cost_cents_total = 0` — **no spend, no outreach, no external call**. It can be left as-is or its review state reset; nothing left the building.

**Nothing else was written.** No emails sent, no paid discovery confirmed, no CSV bulk import run, no guardrail/schema/migration file touched, no commits, no pushes.

---

## 7. Suggested fix order

1. **D-1** — point `/wizmatch/contact-intelligence` at the component that has the discovery flow (`WizmatchContactIntelligenceNewPage`, `demoMode={false}`). This alone turns the funnel from a demo into a machine. *(Retest the cost guard immediately after — it's the first thing that can spend real money.)*
2. **D-2** — one line: `getAuthToken()` instead of `localStorage.getItem('ge_crm_token')`. Restores the entire JD → Requirement flow.
3. **D-3 / D-4 / D-5** — wire up `CONTRACT_KEYWORDS` in the ATS poller, score `itTechFit` on the **role title**, not the company name, and either score manual seeds properly or stop calling them "priority signals". Until these land, every number downstream is measuring noise.
4. **D-7 / D-8** — fix the count-vs-fetch-limit bug and re-baseline the `hot` threshold against a reachable maximum.
5. **D-6, D-9, D-10, D-11, D-12** — individually small, collectively the difference between an operator trusting the tool and quietly going back to a spreadsheet.
