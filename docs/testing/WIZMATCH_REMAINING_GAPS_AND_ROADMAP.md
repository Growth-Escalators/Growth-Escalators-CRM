# WizMatch — remaining gaps and roadmap after the 2026-07-30 QA run

Branch `qa/wizmatch-full-playwright-flow-remediation`. Ordered by what should be done first.

Nothing here is speculative padding: each item is either something this run **verified and chose not
to fix**, something a lane reported that I **could not confirm**, or coverage the run **did not
reach**. Items in the third category are stated as untested, never as passing.

---

## 1. Owner actions required — do these first

### 1.1 Verify n8n after deploying QA-4 (job-queue tenant scoping) · **blocking**

`/api/jobs` is now tenant-scoped. n8n polls it with a user JWT that is not visible from this repo.
If it relies on processing more than one tenant's `sequence_step` jobs, it will now see only its own
tenant's plus NULL-tenant jobs.

**Check after deploy:** that pending jobs are still being claimed and completed, and that the queue
is not growing. If it breaks, the cause is the tenant predicate in `src/services/jobQueue.ts` and
the fix is to give n8n an account in the right tenant — not to revert the scoping.

### 1.2 Migration 0038 runs on the next deploy · **expected, verify**

The only change in this branch that touches production Postgres. Proven idempotent and proven to
no-op against a database that already has `users.is_active`. Confirm the deploy's `[migrate]` lines
show it applying cleanly.

### 1.3 Add `input-data/` to the tracked `.gitignore` (QA-9) · **HIGH**

~116MB of scraped business data is excluded only by machine-local `.git/info/exclude`. A fresh clone
on any other machine has no rule, and `git add -A` there could commit it — potentially PII, into
shared history.

**Not done in this branch** because `.gitignore` carries an unrelated uncommitted change in the
working tree, and sweeping that into a QA commit would violate the repo's dirty-worktree rule. One
line, owner's call:

```
input-data/
```

### 1.4 Upstash request cap (failure-matrix C-1) · **CRITICAL, unchanged**

`[edge-drainer] loop error` every ~5.2s, cap exhausted. **This is a billing/plan decision, not a
code change**, and is untouched by this run. The read side is safe — `XREADGROUP` never returns, so
nothing is wrongly ACK'd. **The write side remains the urgent unknown:** if the same cap rejects the
edge functions' `XADD`, new leads and payment webhooks are failing to enqueue. Check that first.

### 1.5 Take a fresh encrypted backup (failure-matrix M-5)

The only backup predates migration `0037` and the G2 backfill. Restoring it would drop 8 tables and
183 root-policy rows. With 0038 now added, it is one migration further behind.

---

## 2. Unconfirmed security findings — verify before trusting either way (QA-16)

The security lane reported these as **PLAUSIBLE**. I did **not** independently reproduce them, and
I am not asserting them as real defects. They are the highest-value next investigation because they
are the same class as QA-4, which *was* confirmed and was CRITICAL.

| Claim | Location | What to check |
|---|---|---|
| IDOR — booking detail | `src/routes/bookings.ts:44-63` | `GET /:id` filters only by id, unlike the list route in the same file |
| Tenant-ID tampering | `src/routes/messages.ts:14-45`, `src/routes/sequences.ts:17,87` | `tenantId` destructured from `req.body` |
| IDOR — message read | `src/routes/messages.ts:52-69` | `GET ?contactId=` with no tenant filter |
| IDOR — sequence enrolment | `src/services/sequenceService.ts:93-100,130-143` | cancel/read with no tenant filter |
| Missing role gate | `src/routes/growthOS.ts` GET routes; `growthOSSetup.ts:11-109` | reads with no permission check; those tables reportedly have **no `tenant_id` column at all** |
| Stored content-type trust | `src/routes/taskAttachments.ts:42-45, 201-206` | no `fileFilter`; download serves stored mimetype `inline` |

**Method that worked for QA-4:** read the route, read the service it calls, confirm no tenant
predicate, then write a failing test before changing anything.

---

## 3. Test coverage this run did not reach — stated plainly

The brief specified eleven journeys (A–K), each with 10–20 sub-requirements. **This run completed
A (auth/access), J (outreach safety) and K (accessibility), and did not complete B–I.** That is a
deliberate depth-over-breadth choice, recorded so the journey list cannot be misread as covered.

| Journey | State |
|---|---|
| A — Authentication & access | Covered; specs written and run against the real backend |
| B — Today / Decision Workbench | **NOT COVERED.** No executed UI coverage of the five queues, queue precedence, filters, URL-filter persistence, pagination, selection state, bulk-action permissions, disabled-reason accessibility, the eight action flows, or the concurrent-update conflict case |
| C — Company Policy | **PARTIAL.** Rules have unit coverage; not re-verified through the UI or API this run |
| D — Job Leads → Company | **NOT COVERED** end to end |
| E — Contact discovery & confidence | **NOT COVERED.** Confidence-tier transitions, suppression grain (person vs company), bounce/unsubscribe/complaint handling all unverified this run |
| F — Requirements | **NOT COVERED** beyond unit tests |
| G — Candidates & matching | **NOT COVERED.** Specifically **not** verified: Java≠JavaScript, and broad-SAP≠specific-SAP-module |
| H — Submissions / interviews / placements | **NOT COVERED.** Tables and routes exist and are real; behaviour unverified |
| I — CRM ops pages | **NOT COVERED** |
| J — Negative outreach safety | Covered statically for every gate, plus executed specs. **No gate was found fail-open** |
| K — Accessibility | Covered for Login, Job Leads, Requirements, Company Policy, Duplicate Companies + mobile overflow |

**Cross-browser:** Chromium only. Firefox and WebKit runs for the critical journeys were **not
performed**.

**Coverage:** 49.62% statements / 45.74% branch / 51.25% lines across the whole repo.

---

## 4. Known-broken and known-limited, carried forward

| Item | Severity | State |
|---|---|---|
| `GET /health` returns 200 while reporting `unhealthy` (QA-8) | HIGH | **Deliberately not fixed.** Returning 503 would let a transient DB blip restart the service or block a deploy. Needs an ops decision on restart behaviour |
| Coverage blind spot — 5 files invisible to v8 coverage (failure-matrix M-9) | HIGH | Unresolved. One of them is the middleware this run proved non-functional. CI's 30% floor cannot see them |
| `emailService.ts` at 7.93% statement coverage (M-10) | MEDIUM | Unresolved; matters once email is enabled |
| Adapter flag never enforced in the provider factory (QA-11) | MEDIUM (latent) | `getOutreachProvider()` has **zero callers**, so nothing is gated today. **Hard precondition:** before wiring any real provider, enforce the flag *inside* the factory |
| 22 high-severity dependency advisories (M-7) | MEDIUM | Upgrade `nodemailer` and `form-data` **before** email is ever enabled |
| Startup external calls despite `DISABLE_BACKGROUND_JOBS=true` (M-6) | MEDIUM | Verified still present; not fixed |
| Railway topology docs vs reality (QA-10) | MEDIUM | Docs describe `web`+`worker`; repo has one process. `docs/wizmatch/DATAFLOW.md:66` is already correct |
| Migration journal hash drift (M-4) | MEDIUM | Pre-existing. Replay is internally consistent and applies clean on PG18 |
| `list_variables` returns secrets in plaintext (M-11) | MEDIUM | Unchanged. **This is the precondition QA-2 defends against.** Do not use that tool |
| NULL-tenant jobs shared across tenants (QA-4 residual) | MEDIUM | Deliberate. Closing it requires attributing webhook jobs to a tenant at ingestion — a product change |
| 30-second revocation window (L-1) | LOW | Deliberate, documented, fail-closed. QA-2 and QA-6 inherit the same bound |
| `viewer` refused on `/placements` (L-2) | LOW | Pre-existing, by its own role check |

---

## 5. Suggested order of work

1. **Upstash write side** (1.4) — possible live data loss at ingestion; nothing else matters more.
2. **Verify n8n** after this branch deploys (1.1).
3. **`.gitignore` one-liner** (1.3) — one line, removes a real exposure route.
4. **Confirm or dismiss the six unverified IDOR claims** (§2) — same class as the CRITICAL this run
   confirmed.
5. **Fresh backup** (1.5).
6. **Journey B (Decision Workbench) end-to-end coverage** — the single largest untested surface, and
   the one operators use daily.
7. **Journeys E and G** — contact confidence and matching semantics carry the most commercial risk
   from a silent wrong answer.
8. **Health endpoint decision** (QA-8) — decide restart semantics, then implement.
9. **Before any real send:** adapter-flag enforcement in the factory, `nodemailer`/`form-data`
   upgrades, and `emailService` coverage.
