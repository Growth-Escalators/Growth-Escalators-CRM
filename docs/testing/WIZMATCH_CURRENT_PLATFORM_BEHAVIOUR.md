# WizMatch — how the platform actually works today

Written 2026-07-30, against `qa/wizmatch-full-playwright-flow-remediation`
(from `origin/main` at `f8036120`).

This describes what the system **does now**, not what it is designed to do eventually. Where a
capability is target-only, it says so. Status labels are used exactly as defined:

| Label | Meaning |
|---|---|
| **IMPLEMENTED AND TESTED** | Code exists and automated tests cover its behaviour. |
| **IMPLEMENTED BUT DISABLED** | Code exists and works; a flag holds it off. |
| **IMPLEMENTED BUT NOT FULLY VERIFIED** | Code exists; this QA run did not exercise it end to end. |
| **PARTIALLY IMPLEMENTED** | Some of the intended behaviour exists. |
| **NOT IMPLEMENTED** | No code. |
| **DEFERRED** | Deliberately postponed. |

---

## The business in one paragraph

WizMatch is a staffing business run as software. It watches the market for signs that a company is
hiring, decides whether that company is someone Growth Escalators is allowed and willing to
approach, finds a real human there to talk to, and — only after a person approves — turns that into
a confirmed role to fill. It then matches candidates to that role, puts them forward, and tracks
them through to placement. **The outreach half of that loop is currently switched off**: the system
prepares work for a human to review, but sends nothing.

**The most important thing to understand:** almost nothing advances on its own. Automation gathers
and ranks; a human decides. Every stage that could contact a person, spend money, or commit the
business is gated behind an explicit human action, an explicit feature flag, or both.

---

## The pipeline, stage by stage

### 1. Hiring signal → Job Lead · IMPLEMENTED AND TESTED

**What starts it:** a scheduled background job, not a person. Three importers run on a timer — an
ATS poller, a RemoteOK importer and a TheirStack importer — each behind its own flag.

**What the backend does:** writes rows to `wizmatch_job_signals`, deduplicating so the same posting
seen twice does not become two leads, then scores them.

**Which page:** *Job Leads*, and *Lead Discovery* for the raw feed.

**Who may act:** any pilot-roster user at staff tier or above can view. Only admin/team-lead can act
on the results.

**Automatic:** collection, dedup, scoring.
**Manual:** everything after that.

**Load-bearing rule:** a signal is *evidence that a company might be hiring*. It is **not** a job to
fill. Nothing turns a signal into a confirmed requirement automatically — that is a human action,
and the system has an explicit test asserting it.

---

### 2. Job Lead → Company · IMPLEMENTED AND TESTED

**What the backend does:** creates or links a company record, and — in the same transaction — a
**cold-start root policy** for it. That matters: a company cannot exist in this system without a
policy governing whether it may be approached.

**Automatic:** company creation and policy bootstrap.
**Manual:** qualification.

---

### 3. Company → Company Policy · IMPLEMENTED AND TESTED

This is the compliance heart of the product, and the part most worth understanding.

Every company carries a policy answering: *may we approach this company, and on what basis?*
Policies resolve to **ALLOW**, **REVIEW** or **DENY**, and can be set at several scopes — the whole
company, a region, a location, a specific hiring signal, or a specific requirement.

**The rules that actually hold:**

- A company with **no root policy resolves DENY**, not "allow by default". Absence is refusal.
- An **unknown** root resolves REVIEW — it goes to a human, it does not proceed.
- A **standard** block can be overridden by an admin. A **compliance** or **legal** block **cannot
  be overridden by anyone**, including an admin.
- Blocks for *competitor*, *irrelevant* and *no-external-agencies* deny outright. *Irrelevant* also
  prevents preparation work.
- A narrow block (one region, one location, one signal, one requirement) affects **only** that
  scope, and does not erase unrelated broader settings.
- An **unresolvable or malformed scope fails closed** — it denies rather than accidentally allowing.

**Who may act:** team leads can set ordinary policy. Only admins can override an overridable block,
and nobody can override a compliance or legal block.

**Status caveat:** the *rules* above are covered by unit tests. This QA run did **not** re-verify
all of them through the UI — see the validation report's honest coverage statement.

---

### 4. Company Policy → Decision Workbench (`/wizmatch/today`) · IMPLEMENTED, PARTIALLY VERIFIED

**What it is:** the operator's daily desk. Every company needing attention appears in exactly one of
five queues: *Paused or Blocked*, *Routed*, *Needs Review*, *Replies Needing Action*, *Ready to
Contact*.

**What a human does here:** Approve & Queue, Pause, Set Review Date, Block/Reject,
Resume/Reclassify, Assign Owner, Merge Duplicate, Confirm Separate.

**Every successful action records who did it and why** — actor and reason/provenance are written,
not just the new state.

**Who may act:** bulk actions are admin-only. A single-row action uses that row's own permissions.
Where a mixed selection contains any row the user may not act on, the action is disabled.

**Fixed this run:** the read-only machine account used by the Command Deck sync was being refused on
all 8 of its endpoints. See register QA-1. Human operators were never affected.

**Not verified this run:** the queue flows themselves through the browser. The workbench's
queue-construction logic has unit coverage; its UI behaviour does not have executed end-to-end
coverage from this run.

---

### 5. Decision Workbench → Hiring Contact · IMPLEMENTED AND TESTED (discovery) / NOT VERIFIED (confidence flow)

**What the backend does:** finds a plausible human at an approved company — reusing an existing CRM
contact where one exists, otherwise discovering and ranking candidates — and assigns each a
confidence tier.

**The rules that matter commercially:**

- **High** confidence may become *Ready to Contact* — but only **after the company is approved**.
- **Medium** stays in *Needs Review* until a human approves it.
- **Low or unverified never becomes outreach-ready.**
- A blocked signal cannot raise a contact's readiness.
- An unsubscribe blocks **that person**; a company-wide removal request blocks **the company**.

**Cost control:** paid discovery providers (Apollo, Snov) and the Google fallback are **flag-gated
and off**. The free-first cascade is what runs. Every paid path fails closed when its flag is unset
— verified statically this run.

**Not verified this run:** the confidence-tier transitions end to end.

---

### 6. Human approval → Confirmed Requirement · IMPLEMENTED AND TESTED

**A requirement is created by a person.** A hiring signal never becomes one automatically — this is
asserted by test, not just by convention. Claude can pre-fill a requirement by parsing a job
description, but a human confirms it.

**What gets attached:** the company, the source contact, an owner, a delivery owner, and a
recruiter.

---

### 7. Candidate → Match · IMPLEMENTED AND TESTED

Candidates arrive by manual intake and by supply-side sourcing (a GitHub miner and an X-ray
scraper — these are **supply**, not demand; they find people, not clients). Duplicates are merged
and provenance is preserved.

Matching scores candidates against a requirement. A human reviews, rejects or shortlists. Decisions
are held **per candidate-per-requirement**, so a decision on one role does not overwrite a decision
on another.

**Note:** the mission asked to verify that "Java" does not match "JavaScript" as an exact
equivalence, and that a broad "SAP" skill does not match a specific SAP module without evidence.
**This run did not execute those checks.** The matching domain has unit coverage; these two specific
semantics were not confirmed. Treat them as unverified.

---

### 8. Shortlist → Submission → Interview → Placement · IMPLEMENTED BUT NOT FULLY VERIFIED

The tables and routes exist and are real — `wizmatch_submissions`, `wizmatch_interview_rounds`,
`wizmatch_offers`, `wizmatch_placements`, `wizmatch_candidate_consents`, plus adjustments and
commercials. This is **not** a target-only paper design.

**But this QA run did not exercise them.** Their domain logic shares a test file whose contents were
not opened to confirm submission-specific assertions. Classified honestly as *implemented, not
independently verified this pass* rather than claimed as working.

**Revenue records: PARTIALLY IMPLEMENTED.** A `link-invoice` route bridges a placement into the CRM
billing tables, but no dedicated revenue-reporting path was confirmed.

---

### 9. Outreach / sending · IMPLEMENTED BUT DISABLED

**Nothing is sent. This is the single most important operational fact about the platform today.**

Every gate was checked statically this run and every one fails closed when its flag is **unset** —
not merely when set to `false`:

| Gate | Behaviour when the flag is absent |
|---|---|
| `WIZMATCH_SENDING_ENABLED` | Closed — 403 `sending_disabled` |
| `AUTOMATED_EMAILS_ENABLED` | Closed — the mailer throws `cold email suppressed` |
| `WIZMATCH_AUTO_PREP_ENABLED` | Closed |
| `WIZMATCH_PAID_DISCOVERY_ENABLED`, Apollo, Snov | Closed |
| `WIZMATCH_GOOGLE_FALLBACK_ENABLED` | Closed |
| SMTP transport | Never constructed at module load; only inside the gated send path |

Only the **mock** outreach provider can be constructed. An unrecognised provider name is treated as
dangerous by the readiness checker even while the adapter flag is off.

**One deliberate exception:** `WIZMATCH_POLICY_ENFORCEMENT_MODE` defaults to **shadow** (log-only)
rather than enforce. This is intended product behaviour — the brief for this run explicitly
prohibits enabling enforcement beyond shadow. It is a compliance gate layered *on top of* the
already-closed master switches, not a substitute for them.

**Hardened this run:** sequences already in flight now re-check the master send flag on every
dispatch, so turning sending off actually halts them (register QA-5).

---

## Page-by-page operator guide

| Page | What it is for | Who may use it | Current state |
|---|---|---|---|
| **Today** | The daily desk — five queues of companies needing a decision | Pilot roster, staff tier and above; bulk actions admin-only | Working; UI flows not re-verified this run |
| **Job Leads** | Incoming hiring signals | Pilot roster | Working |
| **Companies** | Company records and their intelligence | Pilot roster | Working |
| **Hiring Contacts** | Discovered humans and their confidence tiers | Pilot roster | Working; tier transitions not re-verified |
| **Requirements** | Confirmed roles to fill | Team lead / admin to create | Working |
| **Candidates** | People, skills, availability | Staff and above | Working |
| **Submissions** | Candidates put forward | Team lead / admin | Implemented, not verified this run |
| **Placements** | Closed placements and commercials | Admin / team lead | Implemented, not verified this run. The read-only `viewer` account is refused here by its own role check — known and documented |
| **Reports** | Funnel and ROI analytics | Admin | Implemented, not verified this run |
| **Lead Discovery** | Raw signal feed | Pilot roster | Working |
| **Duplicate Companies** | Merge or confirm-separate pairs | Team lead / admin | Working |
| **Permissions** | User access management. **This is the supported way to offboard someone** — it sets `is_active` and bumps `token_version` together | Admin only | Working |
| **Audit** | Action history | Admin only | Working |
| **Configuration** | Flags and settings | Admin only | Working |

---

## Who can do what

- **Admin** — everything, including bulk actions and overriding an *overridable* block. Cannot
  override a compliance or legal block.
- **Team lead** — ordinary policy actions, requirements, submissions.
- **Staff** — read, plus assigned candidate/requirement work.
- **Viewer** — a read-only *machine* account for the Command Deck sync. Blocked from every non-GET
  request by construction, and admitted to exactly 8 GET paths. Not a human role.
- **Not on the pilot roster** — refused from WizMatch entirely, regardless of role. An unconfigured
  roster fails closed in **every** environment, local included.

**Two independent locks on every WizMatch request:** the right role, *and* membership of the pilot
roster. Both must pass.

---

## What changed in this QA run

Six fixes, each reproduced before being written and mutation-tested after:

1. The Command Deck sync's read-only account can reach its 8 endpoints again.
2. A token's tenant claim is now bound to the user's real tenant.
3. `users.is_active` is backed by a real migration, so a rebuilt database can log in.
4. The job queue is scoped by tenant — this was a cross-tenant data exposure.
5. Sequences re-check the master send flag on every dispatch.
6. Deactivating a user now kills their live session on its own.

**Nothing about sending, spending, or provider invocation was enabled.** All of it remains off.
