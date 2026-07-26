# WizMatch Outbound OS — overnight implementation review (Opus lead)

- **Date:** 2026-07-26
- **Reviewer:** Claude Opus (review lead) + three read-only Explore subagents
- **Scope requested:** PRs 1–4 of the `ge/outbound-0X-*` stack
- **Scope actually available:** PR 1 only
- **Contract:** `docs/prd/005-wizmatch-outbound-operating-system.md`, `ADR-006`, `ADR-007`
- **Nothing was applied, pushed, merged, deployed or enabled by this review.**

> **Disposition added 2026-07-26 — see §19.** A specification-repair pass has since been applied to
> PRD-005, ADR-006 and ADR-007 under eight owner decisions (D-1 … D-8, recorded as PRD-005 §25.1
> A-22 … A-30). **All six CRITICAL findings are resolved by specification change.** Twelve of the
> twelve HIGH findings are resolved; one (H-9) is resolved as far as a CSV model permits, with the
> residual limitation stated rather than hidden. §19 gives the per-finding disposition. **The original
> findings below are preserved verbatim** — nothing has been deleted or softened, because a review
> whose findings vanish once they are inconvenient is not a review.

---

## 0. Headline

**PRs 2, 3 and 4 were not implemented.** The review brief assumed an overnight build of the policy
schema, enforcement and UI. No such work exists in any form. Verified four independent ways:

- `git log main..ge/outbound-02-policy-schema-service` — zero commits beyond PR 1's two docs commits.
- `ge/outbound-02-policy-schema-service` and `ge/outbound-01-prd-adrs` both point at `bbe881c`; the
  `02` branch was created but never committed to. Branches `03` and `04` do not exist locally or on
  `origin`.
- `src/db/migrations/` ends at `0036_seo_content_calendar_link`; `meta/_journal.json` ends at
  `idx: 36`. **Migration `0037` does not exist** — no SQL file, no journal entry, no snapshot.
- No policy code exists in `src/`: zero matches for `outreachPolic|outreach_polic|policy_scope|
  scopeKey|scope_key|duplicate_suspect|reply_mailbox`.
- Working tree is clean apart from an unrelated `package-lock.json` modification (§M-2). No stashes
  relevant to this stack, no other worktree holding outbound work.

Therefore the line-by-line review of migration `0037`, Drizzle/SQL agreement, resolver code,
suppression code, UI and tests **could not be performed against an implementation**. What follows is
instead a deep review of (a) what PR 1 actually shipped, and (b) the **specification** that PR 2–4
would be built from — reviewed against every risk dimension in the brief, because those defects are
far cheaper to fix now than after `0037` exists.

Every finding below is a defect **in the specification or in the context layer**, not in shipped code.
That distinction matters: nothing here is currently affecting production.

---

## 1. Completion by PR

| PR | Branch | Status | Evidence |
|---|---|---|---|
| **PR 1** — PRD + ADRs (docs only) | `ge/outbound-01-prd-adrs` | **Complete.** First commit pushed to `origin`; ratification commit local only | `687b8a0`, `bbe881c` |
| **PR 2** — policy schema + service | `ge/outbound-02-policy-schema-service` | **Not started.** Branch exists, zero commits | branch == `bbe881c` |
| **PR 3** — policy enforcement | `ge/outbound-03-policy-enforcement` | **Not started.** Branch does not exist | — |
| **PR 4** — policy UI + backfill | `ge/outbound-04-policy-ui-backfill` | **Not started.** Branch does not exist | — |

PR 1 quality is genuinely high. PRD-005 is 1,351 lines, ADR-006 331, ADR-007 260; the AS-IS baseline
(§5) carries `file:line` evidence for every claim, and the ones spot-checked (`multiDomainMailer.ts`
fallback, `wizmatch_suppression_list` schema, zero triggers, zero CHECKs, `sendSignalDraftEmail`
suppression gap) are **accurate**. The design reasoning in ADR-006 D-3 (per-dimension inheritance),
D-5 (`block_class` vs `is_non_overridable`), D-7 (restriction grains) and ADR-007 D-1/D-9 is sound and
correctly justified against rejected alternatives. The findings below are gaps in an otherwise strong
document, not a verdict on it.

## 2. Branches and SHAs

```
origin/main                                 1e74812   (Merge PR #78, feat/seo-indexing-queue)
 └─ ge/outbound-01-prd-adrs                 bbe881c   docs(wizmatch): ratify PRD-005 reason-code taxonomy, close PR 1
    └─ 687b8a0                              (parent)  docs(wizmatch): PRD-005 outbound operating system + ADR-006/007
       └─ ge/outbound-02-policy-schema-service  bbe881c   (created, no commits)

origin/ge/outbound-01-prd-adrs              687b8a0   ← PUSHED (see M-1)
```

PR 1 diff (`1e74812..bbe881c`): 7 files, +2,212 / −2. All under `docs/` and `.ai/`.

---

## 3. Critical findings

### C-1 — The reviewed scope does not exist
PRs 2–4 were not built. Any plan, schedule or gate that assumes migration `0037`, a policy resolver or
a shadow-mode deployment is currently unbacked. **Failure scenario:** an operator reads
`docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md`, sees "PR 2 is now unblocked", and schedules G1
(apply `0037` to production) against a migration that does not exist.

### C-2 — `resolveCompanyStatus()` is specified fail-**open**, contradicting the entire fail-closed design
`docs/prd/005-…md:845-847` — *"`resolveCompanyStatus(companyId)` returns the policy-derived status and
**falls back to `wizmatch_company_intelligence.status` when no policy row exists**. All five existing
eligibility computations (§5.2 C-2) migrate onto it."* ADR-006 "API and compatibility proposal"
(`:242-244`) repeats it.

This directly contradicts `:310` (*"A company with **no** `entire_company` row resolves to **DENY**"*),
`:335` (*"missing policy row … evaluates to DENY, never ALLOW"*), ADR-006 D-3/D-4, and the test spec at
`:1122`. **Failure scenario:** company has no root policy row and a legacy
`wizmatch_company_intelligence.status='approved'`. Every one of the five migrated eligibility callers
returns ALLOW; `policy_missing_root` (§9.9) never fires; the company is queueable. The single most
load-bearing safety property in the PRD is defeated by its own compatibility shim. Found independently
by two reviewers.

### C-3 — Tenant-safe FKs are specified for 1 of ~12 cross-table references
ADR-006 (`:222-225`) argues correctly that a plain `REFERENCES users(id)` permits a cross-tenant owner,
and applies a composite `(tenant_id, account_owner_user_id)` FK. **It then applies that reasoning
nowhere else.** Naked single-column FKs remain on `company_id` (`:652`), `actor_user_id` (`:665`),
`superseded_by_policy_id` (`:673`), `approved_by`/`created_by` (`:755-756`), `resolved_by` (`:728`),
`contact_id`/`batch_id` (`:766`), `enrolment_id` (`:796`), `contact_channel_id` (`:810`). Worse,
**`scope_ref_id uuid NULL` (`:655`) has no FK at all** — a `signal:<uuid>` policy may name a signal in
another tenant, or no signal.

Context: the repo has **zero** composite FKs today (`foreignKey(` appears 0 times in `schema.ts`), so
this is a new pattern either way — the marginal cost of applying it consistently is low.
**Failure scenario:** a policy row written under tenant A with `company_id` pointing at tenant B's
company satisfies `UNIQUE (tenant_id, company_id, scope_key)`; the resolver joins on `company_id` and
tenant B's company silently acquires a foreign block or allow.

### C-4 — The policy-immutability trigger is unbuildable under the PRD's own migration rule
ADR-006 D-10 requires *"a DB trigger raising on any UPDATE touching another column"*, repeated at
`:714-716`. But `:644` states *"Generation goes through `npm run db:generate` — never a hand-written
SQL file."* **drizzle-kit does not generate triggers, and the repo contains zero triggers** (verified:
no `CREATE TRIGGER` in any migration, no `check(` in `schema.ts`). The two requirements are mutually
exclusive as written. **Failure scenario:** PR 2 starts, discovers the conflict mid-implementation, and
either ships without the trigger (immutability becomes service-layer-only, and D-10's "enforced three
ways" becomes one way) or hand-appends SQL in violation of the stated rule and of the guarded-path
convention.

### C-5 — The existing `wizmatch_suppression_list` unique index collides with the new two-grain model
`src/db/schema.ts` defines `uniqueIndex('wizmatch_suppression_tenant_email_uniq_idx').on(tenantId,
email)` — **one row per email per tenant**. §10.8 (`:810-814`) adds `contact_channel_id`,
`channel_invalid` and `suppression_scope` but **never revises that index**, while §8.5 (`:374-378`)
requires two rows for the same address: a `suppression_scope='email'` bounce row and a
`suppression_scope='contact'` unsubscribe row.

**Failure scenario:** `john@acme.com` hard-bounces → row written with scope `email`. The same address
later unsubscribes → the §8.5 write violates the unique index and either throws (unsubscribe lost) or
upserts over the bounce (channel-invalid fact lost). Either way one grain is destroyed — the exact
conflation ADR-006 D-7 exists to prevent. Secondary: `email` is nullable, so contact-scope rows with
NULL email are infinitely duplicable under Postgres NULL-distinctness, and there is no
`UNIQUE (tenant_id, contact_id)`. Note this fix is **non-additive** and needs its own dedup dry-run.

### C-6 — No resolver chokepoint is named anywhere in the spec
No line in PRD-005 or either ADR names a single function that every send or enrolment must traverse.
§12 constrains only the batch/export API. §8.9's `PolicyDecision` is a plain interface — no branded
type, no opaque token a sender must present. Enforcement is therefore **convention**.

Existing send paths, none of which the spec places in scope: `sendSignalDraftEmail()`
(`wizmatchOutreachService.ts:151-258`), `sendColdEmail()` (`multiDomainMailer.ts:47-118`),
`sendWarmupEmails()` (`:131-133`, **no suppression check of any kind**), `POST /api/contacts/bulk-email`
(`routes/contacts.ts:594`, loop at `:645-667` reads neither `doNotContact` nor any suppression table),
`sendSequenceEmail()` (`emailService.ts:150-152`). **Failure scenario:** at G7, both kill-switches flip
on; `POST /signals/:id/send` reaches a `no_external_agencies` company with zero policy evaluation,
because nothing ever required it to call the resolver.

---

## 4. High findings

### H-1 — §8.9 `preparationAllowed` contradicts §9.2 and §9.9 — removal-requested companies still get prepared
`:466` — *"`preparationAllowed: boolean; // false only for no_external_agencies and irrelevant`"*. But
§9.2 marks `company_removal_request`, `legal_notice`, `regulator_request` and `privacy_request_pending`
all **Prep ⬜**, and §9.9 marks `policy_resolver_error`, `policy_missing_root` and `scope_unresolvable`
Prep ⬜. Nine codes stop preparation, not two. **Failure scenario:** PR 2 implements §8.9's contract
literally — a company that formally asked to be removed continues to be enriched and prepared, i.e.
continued PII processing and spend on a compliance-blocked company.

### H-2 — Taxonomy invariant 4 is violated by §9.6
`:630` — *"Every code producing a permanent block requires evidence."* `signal_closed`,
`signal_expired` and `signal_filled_internally` (`:574-576`) are each **Perm ✅ / Evid ⬜**.
**Failure scenario:** an automated signal-status inference permanently blocks a signal with no evidence
row; because it is permanent it never comes up for scheduled review, and the block is unfalsifiable.

### H-3 — Taxonomy invariant 3 is violated by §9.9
`:628-629` — *"Only two codes stop preparation outside `compliance`."* Three `operational` codes
(`policy_resolver_error`, `policy_missing_root`, `scope_unresolvable`) are Prep ⬜. Arguably intended —
fail-closed system errors should stop everything — but as written the invariant and the table
contradict, and §20 specifies no test to arbitrate.

### H-4 — `region` / `business_unit` / `location` scopes have no mapping source and fail **open**
`:302` says walk *"scopes applicable to the request context"*, but nothing in the spec maps a signal,
contact or requirement to a location or business-unit label. `scope_ref_label` is free text with no
source table. **Failure scenario:** an operator sets `location:bengaluru → paused`; a Bengaluru signal
enrols anyway because the resolver has no signal→location mapping and never considers the row
"applicable". A pause that silently does nothing is worse than no pause.

### H-5 — `scope_key` is not tied to `scope_ref_id` / `scope_ref_label` by any constraint
`:690` — `CHECK (scope_type = 'entire_company' OR scope_key LIKE scope_type || ':%')` validates the
**prefix only**. ADR-006 D-2's "built only by `buildScopeKey()`" is a convention, not a constraint.
**Failure scenario:** an importer or raw SQL writes `scope_ref_id = X` with `scope_key='signal:X'`
(uppercase UUID) alongside the app's `'signal:x'`. Both are active, both apply to the same signal, and
the inheritance walk's "first non-null" pick becomes order-dependent. Secondary collision: normalising
whitespace to `-` means `business_unit:"Cloud Ops"` and `business_unit:"cloud-ops"` — two genuinely
distinct BUs — produce the identical key and the second is rejected as a duplicate.

### H-6 — `replied` is excluded from the cold-email lock predicate
`:775-783` — all three partial unique indexes use `state IN ('queued','exported','sent')`.
**Failure scenario:** a company replies to campaign A (state → `replied`), the lock releases, and a
second worker enrols the same company in a parallel cold-email campaign while a live conversation is
open. This is precisely the overlap D-9 exists to prevent.

### H-7 — A `compliance` block at any scope narrower than `entire_company` is overridable
`:703` — `CHECK (is_non_overridable = false OR (scope_type = 'entire_company' AND outreach_eligibility
= 'blocked'))`, and L1 keys on `is_non_overridable` (`:350`). But `:704` permits
`block_class='compliance'` on any blocked row, and §9.2 scopes `contractual_restriction` to *"company,
region, BU"*. **Failure scenario:** a contractual restriction covering only the India business unit is
written as `region:india` + `block_class='compliance'`; the CHECK forces `is_non_overridable=false`; L3
treats it as an ordinary overridable restriction and an admin overrides a binding contractual
obligation. §8.3 says compliance override is "none"; the constraints make that impossible to express.

### H-8 — `admin_override` has no constraint tying it to `block_class='standard'`
`:670` declares the column; no CHECK restricts it, and no gate in §8.2 consults it. §8.3 says only
`standard` blocks are admin-overridable. **Failure scenario:** `admin_override=true` is set on a
`compliance` company-removal row; the database accepts it, and only untested application code stands
between that row and outreach to a company that asked to be removed. The column is simultaneously
under-constrained and unused by the specified gate order.

### H-9 — Suppression is enforced at resolver time only; nothing re-syncs to the provider after export
ADR-007 D-2's V1 capability list has no suppression push and no stop-list. §8.5's *"all active
enrolments → `withdrawn`"* is a local DB write with no provider effect. **Failure scenario:** a contact
is exported to Smartlead on Monday and unsubscribes on Tuesday. The suppression row is written and the
enrolment is marked `withdrawn`, but Smartlead keeps sending the remaining steps. This is the
"checked at enrolment, not at send" failure mode, structurally inherent to the CSV model.

### H-10 — UI §13 offers Reclassify on all `blocked` states with no `is_non_overridable` carve-out
`:934` lists **Reclassify (admin)** as the primary action for the whole `blocked` state. `:942`
correctly removes the *override* affordance for compliance/legal, but Reclassify is presented as a
distinct verb with no stated gate. **Failure scenario:** PR 4 is built literally; an admin sees
Reclassify on a `company_removal_request` company, uses it, and the write is refused server-side (best
case) or accepted (worst case). Either way the UI advertises an action the resolver must deny.

### H-11 — `0037`'s ALTERs repeat the exact pattern that broke `0035` in production
`0036_seo_content_calendar_link.sql:8-14` records the lesson verbatim: prod tables had drifted, so
`CREATE TABLE IF NOT EXISTS` silently no-op'd and later statements referencing "new" columns failed.
`db:generate` diffs against `0036_snapshot.json`, **not against production**. §10.8 ALTERs two
long-lived tables (`wizmatch_suppression_list`, `wizmatch_companies`) and specifies no defensive
`IF NOT EXISTS`. **Failure scenario:** `0037` applies cleanly locally and fails mid-migration in
production, leaving the schema half-applied.

### H-12 — Duplicate containment is company-grain and does not prevent two sequences to one human
§8.8 detects **company** duplicates. `UNIQUE (tenant_id, contact_id) WHERE …` (`:779-780`) prevents two
active enrolments per **contact row**, not per person. **Failure scenario:** `john@acme.com` and
`j.doe@acme.com` exist as two contact rows; both enrol and one human receives two cold sequences. No
email-level uniqueness on enrolments is specified. Compounding: `wizmatch_companies` uniqueness is
`(tenant_id, name)` exact-case while `seedProspectCompany` matches `LOWER(name)` (A-5, carried), so
`Acme`/`acme` are already two rows in production.

---

## 5. Medium findings

- **M-1 — The context layer states an untrue safety fact.** `docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md:30`
  says *"**Not pushed. Not merged.**"* and `.ai/CURRENT_TASK.md` was edited to add "NOT PUSHED". But
  `687b8a0` **is on `origin/ge/outbound-01-prd-adrs`** (`git branch -r --contains 687b8a0` confirms).
  Only `bbe881c` is unpushed. A future agent trusting "not pushed" might force-push or rewrite history
  on a branch that already exists remotely.
- **M-2 — The uncommitted `package-lock.json` change would revert CI hotfix `492a6a8`.** The working-tree
  diff (12+/24−) deletes the two
  `node_modules/@rolldown/binding-wasm32-wasi/node_modules/@emnapi/{core,runtime}` entries that
  `492a6a8` ("fix(ci): sync package-lock.json — missing @emnapi entries broke npm ci") **added**.
  Committing it re-breaks `npm ci`. Otherwise it is unrelated local churn (peer/devOptional markers;
  zero new packages, zero version changes). **Do not stage it in PR 2.**
- **M-3 — `users_tenant_id_id_uniq` touches the shared core `users` table.** `:820` creates a unique
  index on `users (tenant_id, id)` — additive and safe in shape, but `users` is core CRM shared with
  the Growth tenant, and a non-`CONCURRENTLY` `CREATE INDEX` blocks writes for the build duration.
  This is a guarded-path change that the PRD frames as a WizMatch-local detail.
- **M-4 — Shadow-mode semantics are one table cell.** `:1029` — *"`shadow` logs would-block without
  blocking; `enforce` blocks."* Unspecified: whether shadow evaluates the full gate ladder or
  short-circuits; behaviour on an unset/misspelled flag value; per-request vs cached read; and whether
  the mode flip is audited (it is an env var, contradicting §18.2's "every policy mutation writes an
  audit row"). Structurally shadow cannot send more than today, since it adds no send path.
- **M-5 — G4 condition 4 is a moving target.** "Zero companies missing an effective policy" (`:1219`)
  is satisfiable only momentarily: nothing in the PRD requires a root policy row on company insert, so
  companies created after the backfill immediately re-break the condition.
- **M-6 — The backfill has no count-deviation abort and no stated re-run idempotency.** `:844`
  correctly defaults to dry-run and requires `--apply`. But "~131 expected" is a human eyeball, not a
  machine guard, and nothing states that a second `--apply` is a no-op.
- **M-7 — `OUTREACH_PROVIDER` defaults to a real provider name.** `:1034` defaults to `smartlead_csv`
  rather than `mock`. Safe today only because `WIZMATCH_OUTREACH_ADAPTER_ENABLED=false`; two
  independent gates would be safer, and the PRD does not say what happens if the adapter flag is on
  and the provider value is unset or typo'd.
- **M-8 — The CHECK-heavy design is unproven in this repo.** `check()` is used **0 times** in
  `schema.ts`; CHECKs exist only in the hand-written `0017`. §10.1 specifies ~10 CHECKs plus a
  composite FK. Round-tripping `check()` and `foreignKey()` through the pinned drizzle-kit should be
  proven on a scratch schema before PR 2 commits to the design.
- **M-9 — `:644`'s "never a hand-written SQL file" is not the repo's actual practice.** `0020`, `0022`,
  `0032`, `0035` and `0036` are hand-authored SQL registered in the journal. The rule is a good one but
  should be stated as a new standard, not as a description of the status quo.
- **M-10 — The UI state table has no precedence rule.** `:930-936` keys actions on a flat company
  state, but a company can be simultaneously duplicate-suspected (L5 deny) and `eligible`. A literal
  implementation renders the `eligible` row and offers Approve & Queue on an L5-denied company. Also,
  `needs_review` shows Approve & Queue as primary with no `approved_by` capture step, while `:407` and
  `:761` require `approved_by`/`approved_at` for a `review` decision.
- **M-11 — Two existing suppression defects the PRD does not list.** (a) Suppression is written
  lowercased (`routes/wizmatch.ts:3542`, `wizmatchBounceParser.ts:68`) but read raw
  (`wizmatchOutreachService.ts:185`), so a mixed-case `channel_value` misses its own suppression row —
  a direct violation of the repo's contact-normalisation invariant. (b) Unsubscribe writes to
  `process.env.WIZMATCH_TENANT_ID` (`routes/wizmatch.ts:3643`) rather than the sending tenant, so a
  multi-tenant unsubscribe lands in the wrong tenant and is invisible to the tenant that sent.
  Both belong in §5.3 alongside A-1/A-4.
- **M-12 — The baseline test suite is red.** See §9.

---

## 6. Low findings

- **L-1** — ADR-006 D-11 (`:202`) cites the cost audit's *"§7"*; its own approval question 2 (`:277`)
  cites *"§4"*. Same item, two numbering schemes — "7" is a verdict-table row, not a section.
- **L-2** — Present-tense wording (`:1081`, and the audit annotation) reads *"the mailer **now** fails
  closed"*. It does not; `multiDomainMailer.ts:70-75` is unchanged and
  `WIZMATCH_MAILER_EMERGENCY_OVERRIDE` does not exist in code. Both passages do say the reversal ships
  in PR 3, so this is wording only — but it is the kind of wording that becomes a false memory.
- **L-3** — The readiness report ships in PR 4 (`:1194`) but G2 (`--apply`) precedes it (`:1185`). The
  dry-run report and the readiness report are different artefacts with no stated consistency check.
- **L-4** — §16 does not state resolver behaviour for an unrecognised
  `WIZMATCH_POLICY_ENFORCEMENT_MODE` value. Should be specified as "anything not `enforce` is `shadow`".
- **L-5** — `UNIQUE (tenant_id, batch_id, contact_id)` (`:774`) does not constrain rows where
  `contact_id IS NULL`, so a `research_only` batch may contain unlimited duplicate rows for one
  company. Partly mitigated by constraint 3 for active states only.

---

## 7. Migration assessment

**Migration `0037` does not exist.** Nothing to review line by line; there is no Drizzle/SQL pair to
check for agreement.

Assessment of the **plan**:

- **Numbering is correct.** Next free index is 37; journal ends at `idx: 36`.
- **Additive/forward-only discipline is correct** and honours ADR-005 explicitly (`:850`).
- **Guardrail honoured in principle** — `schema.ts` and `migrations/` are named as guarded, owner
  approval recorded as §25.1 A-5, generation via `db:generate`.
- **Three blocking problems before generation:** C-4 (trigger unbuildable under the stated rule), C-5
  (suppression unique index needs a **non-additive** change the plan doesn't acknowledge), C-3 (FK
  tenancy).
- **Two blocking problems before application:** H-11 (diff against production DDL, not the snapshot;
  add defensive `IF NOT EXISTS`), M-3 (index build on the shared `users` table).
- **Journal-timestamp caution:** the migrator is timestamp-ordered with no hash integrity, so `0037`'s
  `when` must exceed `1784464092263` or it is silently skipped.

**Verdict: not ready to generate.** Fix C-3, C-4, C-5, H-4, H-5, H-6, H-7, H-8 in the spec first.

## 8. Tenant-isolation assessment

The spec's **intent** is right — every new table carries `tenant_id NOT NULL REFERENCES tenants(id)`,
indexes lead with `tenant_id`, matching all 32 existing `wizmatch_*` tables, and enforcement is
correctly documented as application-level (no RLS in this database).

The **execution is inconsistent**: ADR-006 derives the composite-FK principle from first principles for
`account_owner_user_id`, then applies it to nothing else (C-3), and leaves `scope_ref_id` with no FK at
all. Since the repo has zero composite FKs today, PR 2 is already paying the cost of introducing the
pattern; applying it to one column instead of twelve buys almost none of the benefit.

No tenant-isolation *regression* exists today, because no code was written. Existing cross-tenant
defects found incidentally in legacy code (M-11b, unsubscribe writing to the wrong tenant) predate this
work.

## 9. Policy-bypass assessment

The specified resolver is genuinely fail-closed and the two-phase gate model (§8.2) is well designed —
"most specific wins" is correctly confined to Phase 0, and hard blocks correctly beat specificity in
Phase 1. The problem is that **there is no chokepoint to put it behind**.

Two documented routes around it:

1. **C-2** — the legacy compatibility fallback returns ALLOW where the resolver returns DENY, and all
   five migrated eligibility callers inherit it.
2. **C-6** — no send path is required by any spec text to call the resolver.

Plus **H-4**, where region/BU/location scopes are unresolvable and therefore fail open in practice
despite §8.1's fail-closed prose.

Shadow deployment itself is safe — both kill-switches are off and shadow adds no send path. The risk
crystallises at **G4 and G7**, which is exactly when it is hardest to detect, because a fail-closed
system's failures are silent.

## 10. Suppression-bypass assessment

**Today: fail-open, and the PRD reports this accurately** (A-1, `:206`). `sendSignalDraftEmail()`
checks `wizmatch_suppression_list.email` and never `contacts.do_not_contact`; hard bounces are detected
and discarded because `WIZMATCH_BOUNCE_SUPPRESSION_ENABLED` defaults off (A-4).

**After PR 3 as specified:** closed at resolver time for the paths PR 3 touches, and still open for:

- `sendWarmupEmails()`, `POST /api/contacts/bulk-email`, `sendSequenceEmail()` — no spec text covers
  them (C-6).
- Anything already exported to the provider (H-9).
- Both grains of the same email address, because the write model collides with the existing unique
  index (C-5).
- Mixed-case addresses (M-11a).

The bounce/unsubscribe/removal **semantics** in §8.5 and ADR-006 D-7 are correct and are the strongest
part of this design. The gap is timing and plumbing, not modelling.

## 11. Test assessment

**Baseline, run during this review (real output):**

```
npm test  →  Test Files  2 failed | 91 passed (93)
                  Tests  781 passed (781)
               Duration  6.60s

npm run build  →  tsc, exit 0, no output
```

Both failures are **suite-load errors with zero assertion failures**:
`src/__tests__/adminFrontendHelpers.test.js` and `src/__tests__/wizmatchRouteRegistry.test.js` both
fail with `Cannot find package 'lucide-react'`. Cause is environmental — `admin/node_modules` does not
exist in this worktree (`npm run admin:install` was never run here). **Pre-existing; PR 1 touched no
code.** But it means PR 2 cannot use "green suite" as its gate until admin deps are installed
(**M-12**).

Test surface: 112 test files — 19 Playwright specs under `e2e/`, the rest under `src/__tests__/`.
Runner is vitest. Existing coverage relevant to this work: `outbound.test.ts`,
`outboundTenantIsolation.test.ts`, `wizmatchOutreachRoutes.test.ts`, `wizmatchOutreachService.test.ts`,
`multiDomainMailer.test.ts`, `wizmatchBounceParser.test.ts`, `inboxTenantIsolation.test.ts`.

**Zero tests exist for any PRD-005 behaviour**, correctly — no code exists.

The specified test plan (§20.1, ADR-006 "Required tests", ADR-007 "Required tests") is **unusually
thorough** and is a genuine strength: precedence at every level, per-dimension inheritance including
the location-pause case, scope-key normalisation, the immutability trigger, block-class separation, the
8×8 routing matrix, family-invariance, cold-start confidence at both queue and export, the
bounce/unsubscribe split, the A-1 regression, cross-tenant owner rejection, secret-like key rejection,
and CSV round-trip idempotency.

## 12. Missing tests

Required before PR 2 starts, not currently specified anywhere:

1. **Fail-closed on *partial* failure** — §20 covers DB error / missing row / unresolvable scope, but
   not: resolver timeout; a partially readable ladder (root readable, `location` row read fails); a
   malformed enum already persisted. Each must assert DENY, never last-good.
2. **The compatibility adapter's missing-row behaviour** — the test that would have caught **C-2**.
   Pin `resolveCompanyStatus()` for a company with no policy row.
3. **Resolver tenant isolation** — cross-tenant coverage is specified only for the account-owner FK.
   Missing: resolving company X from tenant B never returns tenant A's policy; readiness report is
   tenant-scoped; bulk policy write cannot span tenants.
4. **Scope-key collisions** — same key string in two tenants must be *allowed*; unicode / NBSP /
   homoglyph normalisation collisions; the `"Cloud Ops"` vs `"cloud-ops"` case from **H-5**.
5. **Suppression added *between* enrolment and send** must be honoured at the send boundary — the
   TOCTOU case the 2026-07-09 audit rated LOW, which becomes load-bearing once the resolver is the
   only gate.
6. **Shadow-vs-enforce equivalence** — run a fixture corpus through both modes and assert identical
   decision logs and identical side effects except the block itself. **This is the single
   highest-value missing test**, because it is the only thing that makes G3's "zero behavioural change
   confirmed" mechanically checkable rather than an eyeball.
7. **Concurrency** — §20 asserts the second cold-email enrolment is rejected, but only sequentially.
   Missing: two concurrent enrolment writes for one company; two simultaneous policy supersessions
   (one must lose cleanly); backfill `--apply` racing company creation; duplicate resolution racing an
   enrolment.
8. **Backfill idempotency and abort** — a second `--apply` writes zero rows; a count deviation aborts.
9. **Readiness correctness** — a company created after the backfill is counted as missing a policy
   (**M-5**).
10. **`replied` and the cold-email lock** (**H-6**) — whichever way the owner decides, pin it.

---

## 13. Required fixes before pushing

PR 1 is documentation only and pushing `bbe881c` carries no production risk. But because PR 2 will be
built directly from these documents, fix the spec-internal contradictions first — they are far cheaper
to fix in prose than in a migration:

1. **C-2** — delete the `resolveCompanyStatus()` legacy fallback, or state explicitly that it returns
   DENY + `policy_missing_root` when no root row exists. Reconcile `:845-847` with `:310`/`:335` and
   ADR-006's API section.
2. **H-1** — reconcile §8.9 `preparationAllowed` with §9.2 and §9.9.
3. **H-2, H-3** — fix §9.11 invariants 3 and 4, or fix the tables they describe. Taxonomy values are
   frozen after PR 2; this must be right now.
4. **C-4** — resolve the trigger vs `db:generate` contradiction before PR 2 starts, not during it.
5. **M-1** — correct "Not pushed" in the handoff and `.ai/CURRENT_TASK.md` (done in this commit for the
   handoff).
6. **M-2** — do not stage `package-lock.json`; it would revert CI hotfix `492a6a8`.
7. **L-1, L-2** — citation and tense corrections.

## 14. Required fixes before applying migration 0037

*(None are actionable yet — `0037` does not exist. These are the gates for when it does.)*

1. **C-3** — convert every §10 cross-table FK to a composite `(tenant_id, x_id)` FK, backed by additive
   `UNIQUE (tenant_id, id)` indexes; give `scope_ref_id` an FK or derive it from `scope_key`.
2. **C-5** — specify the `wizmatch_suppression_list` index replacement explicitly and treat it as
   **non-additive**, with its own dedup dry-run against production data.
3. **H-5, H-7, H-8** — add the missing CHECKs: `scope_key` ↔ `scope_ref_id`/`scope_ref_label`
   agreement; `admin_override = false OR block_class = 'standard'`; and decide how a narrower-scope
   compliance block expresses non-overridability.
4. **H-4** — define the signal/contact → region/BU/location mapping source, or cut those three scope
   types from `0037`.
5. **H-6** — decide whether `replied` holds the cold-email lock; amend all three predicates.
6. **H-11** — diff the generated SQL against **production** `information_schema`, not
   `0036_snapshot.json`; add defensive `IF NOT EXISTS` to every §10.8 ALTER.
7. **M-3** — assess lock duration for `users_tenant_id_id_uniq` on the shared `users` table.
8. **M-8** — prove `check()` and `foreignKey()` round-trip through the pinned drizzle-kit on a scratch
   schema.
9. Verify fresh-DB replay `0000→0037` **and** incremental apply; confirm the journal `when` exceeds
   `1784464092263`.

## 15. Required fixes before shadow deployment

1. **C-6** — name one chokepoint in the spec. Every send/enrol must accept a `PolicyDecision` produced
   by the resolver (branded type or opaque token), and `sendSignalDraftEmail`, `sendColdEmail`,
   `sendWarmupEmails`, `POST /api/contacts/bulk-email` and `sendSequenceEmail` must each be listed as
   in-scope or explicitly out-of-tenant.
2. **M-4** — specify shadow semantics in prose: full ladder always evaluated; unknown flag value →
   `shadow`; mode flip audited.
3. **Missing test 6** — the shadow-vs-enforce equivalence harness, before G3, so "zero behavioural
   change confirmed post-deploy" is mechanical.
4. **H-9** — add a send-time (not only enrolment-time) suppression re-check, and a provider
   stop-list / suppression-push requirement to ADR-007 D-2.
5. **M-11** — normalise the suppression email at read and derive the unsubscribe tenant from the
   message rather than `WIZMATCH_TENANT_ID`.
6. **M-12** — install admin deps so the baseline suite is green before PR 2 uses it as a gate.

---

## 16. Contamination and accidental-activation audit

| Check | Result |
|---|---|
| PR 1 is documentation only | **PASS** — 7 files, all under `docs/` and `.ai/` |
| No `src/`, `client/`, `admin/` change | **PASS** |
| No `package.json`, config, Railway, Vercel or workflow change | **PASS** |
| No migration created or applied | **PASS** — `0037` exists only as prose |
| No feature flag flipped on | **PASS** — flags appear only in §16's table |
| No paid provider enabled (Apollo / Snov / Serper / Smartlead / Saleshandy) | **PASS** — ADR-007 explicitly "no API keys, no recurring cost" |
| No sending path activated | **PASS** — `WIZMATCH_SENDING_ENABLED` and `AUTOMATED_EMAILS_ENABLED` listed as untouched (`:1037-1039`); G7 declares sending out of scope (`:1190`) |
| All 8 new flags default safe | **PASS** — all `false` except `WIZMATCH_POLICY_ENFORCEMENT_MODE=shadow` and `OUTREACH_PROVIDER=smartlead_csv` (see M-7) |
| Growth / SEO / n8n / legacy-outreach contamination | **PASS** — no `docs/seo/`, `scripts/seo-*` or `src/services/seo*` in the diff, per §22.1's own clean-start rule |
| Cost-audit edit is annotation-only | **PASS** — 3 additive hunks; original text, findings and severities preserved verbatim |
| No credential in the new docs | **PASS** — only design prose about `secret_ref` / `provider_config` validators |
| Working tree clean of stray outbound work | **PASS** — only the unrelated `package-lock.json` (M-2) |

**No accidental sending or paid-provider activation occurred.** This is the one dimension of the brief
that can be answered with full confidence, and it is clean.

---

## 17. Genuinely unresolved owner decisions

Distinguishing real owner decisions from things the spec should simply have specified:

1. **U-6 (already recorded, still open)** — sanitised Smartlead fixtures. An input, not a decision.
   Blocks PR 9 only.
2. **Does `replied` hold the company cold-email lock?** (H-6) A real product judgement: does an open
   conversation block a second campaign, or is the reply the point at which a new campaign becomes
   appropriate? Cannot be inferred from the spec.
3. **How does a compliance obligation narrower than the whole company express non-overridability?**
   (H-7) Either widen `is_non_overridable` to any scope, or rule that all compliance blocks are
   company-wide. Both are defensible; the spec must pick one.
4. **Do the three `operational` fail-closed codes stop free preparation?** (H-3) The tables say yes,
   invariant 3 says no. A resolver error arguably should not stop *free* preparation, since preparation
   spends nothing.
5. **Is `admin_override` a real feature or dead weight?** (H-8) The gate order never consults it. If
   overrides are expressed as superseding rows (which D-10 implies), the column should be dropped
   before it acquires data.
6. **Scope of the `users` index** (M-3) — accepting a brief write-lock on a table shared with the
   Growth tenant is an owner call, not an engineering one.

Everything else in this report is a specification defect with a correct answer, not a decision.

---

## 18. Final recommendation

> **Superseded 2026-07-26 by §19.** The four actions below were carried out in the spec-repair pass;
> all six CRITICAL and all twelve HIGH findings are now dispositioned. **PR 2 may proceed against
> PRD-005 §22.2.** The standing prohibitions still hold: do not push, apply `0037`, backfill, or
> enable anything. The original recommendation is preserved below.

**Do not proceed to PR 2 as currently specified. Do not push, apply, backfill, or enable anything.**

Concretely:

1. **Reset the plan of record.** PRs 2–4 do not exist; the handoff doc must say so. The overnight build
   did not happen (corrected in this commit).
2. **Spend one focused pass on PRD-005 and ADR-006 before writing any code.** Fix C-2, C-4, C-5, H-1,
   H-2, H-3, H-7, H-8 — eight spec-internal contradictions. Every one is cheap now and expensive after
   `0037` exists, and two of them (the taxonomy invariants) touch values the PRD itself declares frozen
   after PR 2.
3. **Make three architectural decisions before PR 2:** the FK tenancy pattern (C-3), the immutability
   mechanism given that drizzle-kit cannot emit triggers (C-4), and the named resolver chokepoint (C-6).
4. **Then re-plan PR 2.** The schema as specified is close, but it is not eight small edits away — the
   suppression index change alone (C-5) is non-additive and changes the migration's risk profile.

On the work that *does* exist: **PR 1 is good and should be kept.** The AS-IS baseline is evidence-backed
and accurate where spot-checked, the ADR reasoning is strong, the rejected alternatives are
well-argued, the fail-closed intent is right, the flag defaults are safe, and the guardrail discipline
(dry-run default, `--apply` gating, sending explicitly out of scope, shadow-first) is exactly right.
The defects found are the ordinary consequence of a 1,900-line design document written in one pass —
concentrated in the seams between sections (§8.9 vs §9, §8.1 vs §11.3, §10.8 vs the live schema), which
is precisely where a second reader is worth having.

The single most important finding is **C-2**: as written, the compatibility shim would have quietly
made the whole fail-closed design fail open, through the five callers it was specifically designed to
consolidate.

---

## 19. Disposition — specification-repair pass, 2026-07-26

Applied on `ge/outbound-01-prd-adrs`, documentation only. No code, no migration, no push, no
production action. Owner decisions D-1 … D-8 are recorded in PRD-005 §25.1 A-22 … A-30.

Every finding is marked **resolved by specification change** or **genuinely unresolved with an exact
owner decision required**. Nothing is marked resolved because it became awkward.

### 19.1 CRITICAL — all six resolved by specification change

| # | Finding | Disposition | Where |
|---|---|---|---|
| **C-1** | The reviewed scope does not exist | **Resolved.** The handoff, `.ai/CURRENT_TASK.md` and PRD §22 all state PRs 2–4 are not started. PR 2 now has explicit acceptance criteria to build against, and G1 is gated on ten verification requirements that a non-existent migration cannot satisfy | PRD §22.2, §10.11.4; `docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md` |
| **C-2** | `resolveCompanyStatus()` specified fail-**open** | **Resolved (D-1).** The legacy fallback is **deleted, not softened**. Missing root → `deny` / `policy_missing_root`, unconditionally. New gate level **L0** evaluated before everything else. Legacy intelligence status is display-only. A regression test pins the exact scenario the review described | PRD §8.1, §8.2 L0, §11.3, §20.1; ADR-006 D-13 |
| **C-3** | Tenant-safe FKs for 1 of ~12 references | **Resolved (D-2).** All **22** entity references are composite FKs, with a full matrix, six additive non-partial `(tenant_id, id)` parent indexes, and `ON DELETE SET NULL` on every `users` reference so offboarding is not blocked. `scope_ref_id` is **deleted** and replaced by typed `signal_id` / `requirement_id`. The signals table is named explicitly as `wizmatch_job_signals` — the audit found `signals` is Growth's table with **no `tenant_id` at all**, so a reference to it could never have been tenant-safe | PRD §10.10, §10.10.1, §10.10.2; ADR-006 D-14 |
| **C-4** | Immutability trigger unbuildable under the stated rule | **Resolved (D-3).** Verified against the pinned drizzle-kit: composite FKs, partial unique indexes and CHECKs **are** emittable; only the trigger is not. Hand-authored SQL is approved for that one construct, inside a marked guard block, under a mandatory six-step process. The "never a hand-written SQL file" rule is restated as a standard with one documented exception rather than as a description of a repo where 22 of 37 migrations are hand-authored (this also closes **M-9**) | PRD §10.11.1, §10.11.2; ADR-006 D-10 |
| **C-5** | Suppression unique index collides with the two-grain model | **Resolved (D-4), and the migration is additive again.** `suppression_scope` is **deleted**; `wizmatch_suppression_list` is unconditionally exact email/channel grain; the existing `UNIQUE (tenant_id, email)` is **retained, not dropped**, so no non-additive change and no production dedup dry-run. Contact grain stays `contacts.do_not_contact`; company grain is a compliance policy row; history is the new append-only `wizmatch_suppression_events`. A second event for one address is an idempotent upsert, so neither the bounce fact nor the unsubscribe is lost | PRD §8.5, §10.9, §10.9.1; ADR-006 D-15 |
| **C-6** | No resolver chokepoint named anywhere | **Resolved (D-5).** `evaluateWizmatchOutreachGate` / `assertWizmatchOutreachAllowed` are named, `PolicyDecision` is a branded type constructible only inside the gate module, and a **31-row caller-migration checklist** — built from a full audit of `src/`, with `file:line` for every path — is PR 3's acceptance evidence. All five send paths the review named are on it. `POST /contacts/bulk-email` must gate or reject WizMatch-linked contacts, with the real join mechanism specified rather than guessed. Warm-up is company-policy-exempt but mailbox-health-bound. The audit also surfaced paths the review had not seen: `POST /email-templates/:id/send-test` (arbitrary recipient, neither kill-switch), `POST /email/manual`, `POST /email/send` with a caller-supplied `tenantId`, and `startSequenceWorker` | PRD §8.10, §8.10.1, §8.10.2, §22.3 |

### 19.2 HIGH — twelve of twelve resolved

| # | Disposition |
|---|---|
| **H-1** | **Resolved.** `preparationAllowed` is **derived** from the §9 `Prep` cells, not enumerated. The `Prep ⬜` set is exactly six codes. A removal-requested company is no longer prepared |
| **H-2** | **Resolved (D-7).** `signal_closed`, `signal_expired`, `signal_filled_internally` move `Evid ⬜ → auto`, with the persisted artefact named (source URL + ATS/board state). Invariant 4 now holds |
| **H-3** | **Resolved.** The three `operational` codes move `Prep ⬜ → ✅`. They are fail-closed for every **outbound** action; preparation is free, sends nothing, and is asserted zero-spend. Invariant 3, §8.9 and the tables now agree |
| **H-4** | **Resolved.** §8.1.1 names the source for each scope label and makes an **unresolvable scope DENY with `scope_unresolvable`** rather than silently inapplicable. `business_unit` is retained but has no automatic derivation, and that is stated on the policy card rather than discovered at send time. A pause that silently does nothing is no longer possible |
| **H-5** | **Resolved.** New CHECKs tie `scope_key` to the FK column and to `scope_ref_label`, so an uppercase-UUID key cannot coexist with the app's lowercase one. The `"Cloud Ops"` / `"cloud-ops"` collision is now a rejected duplicate rather than a silent shadow |
| **H-6** | **Resolved (D-6).** A reply does **not** release the lock. Eight live states hold it, seven terminal states release it, `manually_released` requires actor + reason + event. All **four** copies of the predicate — three indexes plus G4 condition 2 — are amended together and derive from one exported constant |
| **H-7** | **Resolved (D-7).** The `entire_company` conjunct is dropped from the non-overridability CHECK, new gate level **L1c** denies at narrower scopes, and `CHECK (block_class = 'standard' OR is_non_overridable = true)` makes §8.3's "override: none" enforced rather than merely stated. A BU-scoped contractual restriction is now expressible |
| **H-8** | **Resolved.** `admin_override` is **deleted** before it acquires data. It was a mutable boolean on an immutable row with no reachable write path, no gate consulting it and no CHECK constraining it. An override is a superseding row with `manual_admin_override`, an actor and evidence |
| **H-9** | **Resolved as far as a CSV model permits, limitation stated.** ADR-007 D-2 now records that V1 has **no suppression push and no provider stop-list**, that this is structurally inherent to a one-way CSV handoff, and that it is why §8.10 requires a **send-time** check and not only an enrolment-time one. Three mitigations are required before G6. A provider API closes it properly and is the recorded FUTURE path. **Not hidden, not overclaimed** |
| **H-10** | **Resolved.** A row with `is_non_overridable = true` shows neither Reclassify nor override, at any scope. The UI no longer advertises an action the resolver must refuse |
| **H-11** | **Resolved.** Every §10.8 ALTER uses `IF NOT EXISTS`, and §10.11.4 requires the generated SQL to be diffed against production `information_schema` rather than `0036_snapshot.json` — naming `0035` as the precedent |
| **H-12** | **Resolved.** New constraint 2b: `UNIQUE (tenant_id, enrolment_email_key)` over the live states, keyed on the normalised email, so two contact rows for one human cannot both hold a live enrolment |

### 19.3 MEDIUM — disposition

| # | Disposition |
|---|---|
| **M-1** | Resolved in the reviewed commit; the handoff records `687b8a0` as pushed and only `bbe881c` as local |
| **M-2** | Carried as a standing instruction. §22.1 and the handoff both say do not stage `package-lock.json` |
| **M-3** | **Resolved as a stated guarded-path change.** §10.10.1 records that three of the six indexes are on core tables shared with Growth, that none can fail or reject a write, and that the lock must be **measured on a production-sized restore**. Owner sign-off is now the explicit open item **U-7**, blocking G1 |
| **M-4** | **Resolved.** §16 specifies shadow semantics in prose: full ladder always evaluated, anything not `enforce` is `shadow`, per-request read, mode change alerted |
| **M-5** | **Resolved.** A root policy row is written in the same transaction as every company insert, so the condition is maintainable rather than momentary |
| **M-6** | **Resolved.** Count-deviation abort and re-run no-op, both asserted by test |
| **M-7** | **Resolved.** With the adapter flag on and `OUTREACH_PROVIDER` unset or unrecognised, the factory **throws at startup** rather than defaulting |
| **M-8** | **Resolved.** §10.11.4 requirement 8 makes the `check()` / `foreignKey()` round-trip proof a blocking gate, with the generated SQL attached. §10.11.3 additionally names the concrete drift risk the review did not: adopting `check()` may make drizzle-kit propose dropping the three pre-existing CHECKs on Growth's `prospects` and `signals` tables |
| **M-9** | **Resolved** — folded into C-4 |
| **M-10** | **Resolved.** §13 gains an explicit top-down state precedence and an approval-capture step for `needs_review` |
| **M-11** | **Resolved and expanded** — now §5.3 A-10, A-11, A-12. The audit found a fourth, worse instance the review had not: the unsubscribe HMAC is minted over the un-lowercased address and verified over the lowercased one, so **every mixed-case recipient has a permanently 403-ing unsubscribe link** (A-13) |
| **M-12** | Carried. §22.2 criterion 18 requires `npm run admin:install` before a green suite is used as a PR 2 gate |

### 19.4 LOW — disposition

**L-1** resolved (both citations now read "§1 verdict row 7 / §4"). **L-2** resolved (both passages
state the code is unchanged and the reversal ships in PR 3). **L-3** resolved (G2 requires the dry-run
and readiness counts to agree). **L-4** resolved (§16: anything not `enforce` is `shadow`).
**L-5** carried — `UNIQUE (tenant_id, batch_id, contact_id)` still does not constrain
`contact_id IS NULL` rows, so a `research_only` batch may hold duplicate company rows; mitigated by
constraint 3 for live states, and low-impact because `research_only` never sends.

### 19.5 Genuinely unresolved — exact owner decisions still required

Of the six items in §17, five are now decided. What remains:

| # | Decision required | Blocks | Why it is a real decision |
|---|---|---|---|
| **U-6** | Supply sanitised Smartlead fixtures — lead-import sample, campaign-results sample, bounce / unsubscribe / reply examples | **PR 9 only** | An input, not a judgement. Without it the header map and the idempotency tier are guesses |
| **U-7** | Sign off the additive `(tenant_id, id)` unique indexes on `users`, `contacts` and `contact_channels` | **G1 only** | These are core CRM tables shared with the Growth tenant. The indexes cannot fail or reject a write — `id` is already the PK — but the build takes a brief write lock on another product's tables. Accepting that is an operational call, not an engineering one. PR 2 writes the schema and **measures** the lock; applying it is G1 |

**Neither blocks PR 2.** §17's other four items — does `replied` hold the lock (H-6), how a narrower
compliance block expresses non-overridability (H-7), whether the `operational` codes stop preparation
(H-3), and whether `admin_override` is real (H-8) — are decided by D-6, D-7, D-7 and D-18
respectively.

### 19.6 What this pass did **not** change

- No code, no schema, no migration. `0037` still does not exist.
- No flag flipped, no provider enabled, no send path activated. Both kill-switches remain off and
  unmodified.
- No finding above was deleted, reworded or downgraded. §§3–18 are the original text.
- `package-lock.json` remains unstaged.

---

## Appendix — method

- Three read-only Explore subagents, run in parallel: (1) migration/constraints/tenant isolation,
  (2) policy/suppression/outreach bypass, (3) UI/feature-flags/test coverage. Each was restricted from
  editing, committing, pushing, deploying, applying migrations, touching Railway, and inspecting
  unrelated Growth/SEO work.
- All CRITICAL and HIGH findings were re-verified by the review lead directly against the source before
  inclusion: `:845-847` fallback; §9.6/§9.9 table cells; `wizmatch_suppression_list` unique index in
  `schema.ts`; zero triggers and zero `check()` in the repo; `0037` absence in both the migrations
  directory and the journal; `492a6a8`'s lockfile contents; `origin` containing `687b8a0`.
- `npm test` and `npm run build` were run by the review lead; results in §11 are real output.
- No migration was generated or applied, no backfill run, no flag changed, no Railway access, no push.
