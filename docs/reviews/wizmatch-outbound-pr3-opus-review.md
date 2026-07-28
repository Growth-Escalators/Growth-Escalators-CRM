# WizMatch Outbound OS — PR 3 review (Opus)

**Reviewed** 2026-07-26 · **Branch** `ge/outbound-03-policy-enforcement` ·
**Parent** `ge/outbound-02-policy-schema-service` · **Reviewer** Claude (Opus), senior architect role
**Implementation reviewed as submitted:** `726a01b` · **Corrective commit:** `21b3bc3`
**Spec** PRD-005 §8.10, §8.10.1, §8.10.2, §9, §16, §18.3, §22.3 · ADR-006 (D-5, D-11, D-4/D-15) · ADR-007
**Marker reviewed:** `.ai/OUTBOUND_PR3_IMPLEMENTED`

**Verdict: fix-then-ship.** The caller migration is real and unusually complete — all 30 §8.10.1 rows
are closed, 16 call sites gate on one shared helper, and **no call site blocks in shadow mode**, which
is the property PR 3 most had to get right. But six defects contradicted §8.4/§8.5/§8.10 and are fixed
in `21b3bc3`; two of them made a gate that *reported* a block while permitting the state it existed to
prevent. Three items remain genuinely open and need an owner decision, and one is a **hard deploy-order
prerequisite that nothing in the branch records** (§11).

Method: three read-only Explore subagents in parallel (caller checklist / bypass paths; suppression,
unsubscribe, bounce and tenant; shadow semantics, mailbox health and test quality), with **every**
Critical and High finding re-read by hand against the source before any fix. Two subagent findings were
downgraded on that re-check and one was upgraded (§10). Every fix carries a **control run** that
reintroduces the defect and confirms the new test goes red (§9).

---

## 1. Gates

| Gate | Result |
|---|---|
| `git diff --check` | clean |
| `npm run build` | **exit 0** |
| `npm test` (as submitted, `726a01b`) | 103 files / **896** tests passed |
| `npm test` (after fixes, `21b3bc3`) | 103 files / **916** tests passed (+20) |
| Guarded paths | `src/db/schema.ts`, `src/db/migrations/`, `auth.ts`, `rbac.ts`, `cashfree.ts`, `sodEodService.ts` — **all untouched** (verified by `git diff --name-only`) |
| `admin/`, `client/`, `scripts/`, `package.json`, `package-lock.json` | **untouched** |

---

## 2. §22.3 completeness

| # | Criterion | Verdict |
|---|---|---|
| 1 | Every §8.10.1 row closed | **PASS** — 29 migrated, row 9 classified (§3) |
| 2 | Zero duplicate suppression/policy reads outside the gate | **PASS with a wording caveat** (§5) |
| 3 | `bulk-email` gates or rejects every WizMatch-linked contact, reports rejections | **PASS** |
| 4 | Warm-up honours mailbox health, not company policy | **PASS** |
| 5 | A-1: suppression union reads both grains, both sides lowercased | ⚠️→**PASS** (was PARTIAL — D-5 fixed) |
| 6 | A-4: hard bounces written, not discarded | ⚠️→**PASS** (flag gone; failure now logged at ERROR) |
| 7 | Mailer fails closed behind `WIZMATCH_MAILER_EMERGENCY_OVERRIDE`, logs + alerts | **PASS** |
| 8 | Unsubscribe HMAC mint/verify same normalised address; write uses sending tenant | **PASS** (mint/verify byte-identical, §6); tenant resolution has an open ambiguity (§11 U-8) |
| 9 | `shadow` is the shipped default; §16 semantics hold | **PARTIAL** — rules 1-4 pass; rule 5's Slack-alert-on-flip is unimplemented **and was undisclosed** (§11 O-1) |
| 10 | Shadow-vs-enforce equivalence harness exists and passes | ⚠️→**PASS** (was ceremonial — D-6 fixed) |
| 11 | Both kill-switches off and unmodified | **PASS** |

**No PR 4 work is mixed in.** No policy write API, no RBAC change, no provenance/duplicate UI, no
backfill script, no readiness endpoint, no persisted observation table. Confirmed by file-level diff.

---

## 3. The §8.10.1 caller checklist — all 30 rows

| Row | Path | Verdict | Note |
|---|---|---|---|
| 1 | `sendColdEmail` | MIGRATED | gated by its caller before dispatch |
| 2 | `sendSignalDraftEmail` | MIGRATED | inline suppression query genuinely **deleted** |
| 3 | Follow-up re-enrolment | MIGRATED | `re_enrol` gate precedes the insert |
| 4 | `generateSignalDraftEmails` | ⚠️→MIGRATED | **D-1**: hand-rolled predicate missed `review`; fixed |
| 5 | `POST /signals/:id/send` | MIGRATED | `WIZMATCH_SENDING_ENABLED` read unchanged |
| 6 | `POST /signals/:id/draft` | MIGRATED | inherited D-1; fixed with it |
| 7 | `POST /signals/:id/enrich` | MIGRATED | prep gate before the side effect |
| 8 | `POST /signals/:id/discover-poc` | MIGRATED | correct order |
| 9 | `POST /signals/ingest` | **CLASSIFIED** | sound — see below |
| 10 | `POST /classify-reply` | ⚠️→MIGRATED | retry gated; **D-3/D-6** on the suppression half; fixed |
| 11 | `link-crm-contact` | MIGRATED | correct order |
| 12 | `contacts/:id/review` | ⚠️→MIGRATED | **D-2**: approval committed *before* the gate; fixed |
| 13 | `companies/:id/discover` | MIGRATED | correct order |
| 14 | `companies/:id/contacts/manual` | MIGRATED | correct order |
| 15 | `POST /companies/:id/contacts` | MIGRATED (prep-level) | see **U-9** — interpretive |
| 16 | `POST /requirements/:id/contacts` | MIGRATED (prep-level) | see **U-9** |
| 17 | `POST /requirements/:id/next-action` | MIGRATED (prep-level) | see **U-9**; rolls back correctly (§4) |
| 18 | `startSequenceWorker` | MIGRATED | per-dispatch gate, cancels on DENY |
| 19 | `POST /contacts/bulk-email` | MIGRATED | reports `rejected` + `rejectedDetail` |
| 20 | `POST /contacts/export` | MIGRATED | denied rows never enter the CSV; header stamped |
| 21 | `email-templates/:id/send-test` | ⚠️→MIGRATED | **D-5**: gated on address only; fixed |
| 22 | `POST /email/manual` | MIGRATED | |
| 23 | `POST /email/send` | MIGRATED | route tenant check **plus** service-level defence in depth |
| 24 | `POST /sequences/enrol` | MIGRATED | gate alongside the existing `do_not_contact` throw |
| 25 | Bounce write | ⚠️→MIGRATED | flag deleted; failure now ERROR-logged |
| 26 | Unsubscribe write | ⚠️→MIGRATED | **D-6** lowercase fix; U-8 open |
| 27 | `POST /suppression` | ⚠️→MIGRATED | **D-3** grain collapse; fixed |
| 28 | `GET /suppression` | ⚠️→PARTIAL | input lowercased; **stored column still not** — see U-10 |
| 29 | The sole enforcing suppression read | MIGRATED | both sides lowercased |
| 30 | `sendWarmupEmails` | MIGRATED | domain-health check added; no company policy |
| — | Out-of-tenant list | **RE-VERIFIED UNCHANGED** | `routes/outbound.ts`, `outreachEnrichmentService.ts`, `saleshandyStatsService.ts`, `seoWeeklyEmailService.ts`, `assetDeliveryService.ts`, `deals.ts`, `billing.ts`, `cashfreeEventProcessor.ts`, `auth.ts`, `esign.service.ts` — none appear in the diff |

**Row 9's classification is sound**, checked rather than accepted: `/signals/ingest` is a bulk raw-signal
insert with no single company target per call; companies it creates receive a root policy through PR 2's
§22.2 #16 atomic bootstrap CTE; and every send path it feeds is gated downstream at rows 1-2. It creates
no bypass.

**`imapService`'s bounce half is correctly treated as in-tenant** (the PRD's own "surprise" #1), and its
reply-matching half is untouched — the only edit to that file is the removal of the dead flag import.

---

## 4. Shadow semantics — the property PR 3 most had to get right

**Shadow blocks nothing.** All 16 wired call sites were enumerated and each one's blocking predicate
read. Every one resolves to `false` whenever the mode is not exactly `enforce`:

- 13 sites call `evaluateWizmatchOutreachGate` + `shouldBlock(...)`.
- 3 preparation-only sites use `!decision.preparationAllowed && shouldBlock(...)` (§8.8-correct: an
  ordinary review or a cold-email lock does not stop free preparation; a permanent or non-overridable
  block does).
- 1 site (row 4) hand-rolled the predicate. It was still `enforce`-conditional, so it was **not** a
  shadow-blocking defect — but it disagreed with the canonical predicate on `review`. Fixed as **D-1**.
- `assertWizmatchOutreachAllowed` has **zero** production callers; every site uses the
  evaluate-then-`shouldBlock` form so it can return a route-appropriate 403 body. Defensible, and now
  the harness pins the throw/no-throw distinction directly.

**§16 rules, checked individually:**

1. *Full ladder, never short-circuits* — **PASS**, and structurally so: `evaluateWizmatchOutreachGate`
   never branches on the mode. `readEnforcementMode()` is consulted only inside `makeDecision`, after the
   ladder has already run.
2. *Logs the decision, writes a `gate_denied` observation, blocks nothing* — **PARTIAL**. Blocks nothing:
   confirmed. The observation is a structured `console.warn`, not the `wizmatch_outreach_events` row
   §8.10 rule 6 specifies. Honestly disclosed as PR 4 scope (**U-11**).
3. *Anything but exactly `enforce` is shadow* — **PASS**, strict `===` with no trim or case-fold. This was
   **unpinned by any test**; eight near-miss cases are now pinned (§9 control run 2).
4. *Read per request, not cached at boot* — **PASS**. `process.env` is read fresh per evaluation; no
   constant is exported, so no boot-time capture exists.
5. *Mode recorded on every decision; a change emits a Slack alert* — **PARTIAL**. Recording holds. The
   alert-on-flip has **no implementation anywhere in the repo**, and unlike the other two deferrals it is
   **not** in the marker's disclosed scope-limits list (**O-1**).

**On the disclosed "not fully transactional" preparation gates:** this disclosure is *more pessimistic
than reality for two of the three sites and hid a real defect in the third.* The three
`wizmatchStaffingDomain.ts` sites (rows 15-17) run inside an explicit `BEGIN`/`COMMIT`/`ROLLBACK`, so a
`StaffingDomainError` thrown after the `UPDATE` genuinely rolls the row back — no partial write. But row
12 (`contacts/:id/review`) is plain autocommit: its `status='approved'` UPDATE committed and *then* the
gate returned 403, so the block was cosmetic and the state it existed to prevent was already durable.
That is a data-integrity defect, not the benign ordering nit the marker describes. Fixed as **D-2**.

---

## 5. Duplicate-read assessment (§22.3 #2)

**Clean on the policy grain.** No read of `wizmatch_company_policies` or `wizmatch_company_duplicates`
decision columns exists anywhere outside `src/modules/outreach/` and `src/__tests__/`. The inline
suppression query formerly at `wizmatchOutreachService.ts:183-189` is genuinely **deleted** — not moved,
not commented — verified against the parent branch.

**Suppression-grain reads outside the gate: 12, all advisory or CRUD, none an enforcement path.** They
are `suppressed_count` dashboard tiles, `doNotContact` display badges on the contact-candidate picker,
the `GET /suppression` viewer itself, and `sequenceService`'s `do_not_contact` throw — which §8.10.1 row
24 *explicitly names as the check to keep* and add the gate alongside. None can disagree with the gate on
an actual send/enrol/export decision.

So §22.3 #2 holds in substance. The criterion's literal wording ("a review grep for a second suppression
or policy read outside the gate module fails the PR") would flag those 12; the marker's self-report is
narrower than the PRD text. Worth a §22.3 wording correction in a docs pass so the next reviewer does not
read a display counter as a violation (**U-12**).

---

## 6. Unsubscribe HMAC — byte-for-byte

| | Expression | Source |
|---|---|---|
| **Mint** | `createHmac('sha256', unsubSecret).update(toEmail).digest('base64url')` where `toEmail = String(channel_value).trim().toLowerCase()` | `wizmatchOutreachService.ts` |
| **Verify** | `createHmac('sha256', unsubSecret).update(email).digest('base64url')` where `email = (req.query.email).toLowerCase().trim()` | `routes/wizmatch.ts` `/unsubscribe` |

**MATCH.** Same secret constant, same algorithm, same single-component message (no separator to
disagree on), same `base64url` encoding. `.trim().toLowerCase()` and `.toLowerCase().trim()` are
equivalent here — whitespace has no case and case-folding introduces none. `timingSafeEqual` is retained
and the length guard is correctly placed **before** it, so a wrong-length `sig` yields 403 rather than a
500. Both sides fail closed with no configured secret. The row-26 mismatch is genuinely fixed.

One structural note, not a defect: the signature commits to the address only — no tenant, no message, no
expiry. A valid `(email, sig)` pair is therefore replayable across tenants, which is precisely why the
tenant *resolution* below cannot be disambiguated by the token (**U-8**).

---

## 7. Suppression grains after this PR

§8.5's three grains are correctly separated **in the gate**: a hard bounce maps to `email_hard_bounce`
and never to a stated preference; `contacts.do_not_contact` reports `email_unsubscribed`; company removal
remains a non-overridable `compliance` block at L1/L1c. `suppress()` is the sole write path and the
`(tenant_id, email)` unique index is untouched.

The grain separation was **broken at the route layer**, three ways, all fixed:

- `POST /suppression` flipped `contacts.do_not_contact` for **every** reason, `hard_bounce` and
  `complaint` included — three lines below the new `suppress()` call. A dead mailbox is a channel-quality
  fact; promoting it to a stated preference blocks every other channel and every other reason to reach
  that person. That is the exact collapse §8.4 forbids (**D-3**).
- `/classify-reply`'s auto-suppress wrote the email grain **only**, so a prospect who replied "please
  unsubscribe" had the request honoured on that one address and nowhere else — while the other two write
  paths did set the contact grain (**D-6**).
- All three contact-grain writes matched `contact_channels.channel_value` **exactly** against an
  already-lowercased address, so any channel row written by a path that bypassed `normalizeChannelValue`
  silently never matched. This is the H-3 class the gate itself had to fix in PR 2, reappearing one layer
  out. Now `LOWER()`ed, tenant-scoped, and bumping `lastActivityAt` per the repo invariant (**D-6**).

---

## 8. Findings

### Critical
None.

### High — all six fixed in `21b3bc3`

**D-1 — Row 4 hand-rolled the blocking predicate and disagreed with the gate on `review`.**
`generateSignalDraftEmails` used `decision.decision === 'deny' && enforcementMode === 'enforce'`;
`shouldBlock`'s predicate is `decision !== 'allow'`. §8.10 rule 2 forbids a caller deriving its own
partial check, and the gate module's own doc comment says to use the helper. Consequence: under `enforce`,
a company whose policy resolves to `review` (`needs_review`, `preferred_vendors_only`, `former_client`)
had three AI-written drafts queued while every other send/queue site blocked it — and the site emitted no
§16 rule-2 shadow observation at all, so the readiness report under-reported exactly the drafting blocks
it exists to measure. *Not previously covered by any test.*

**D-2 — Row 12 committed the approval, then returned 403.**
`/contact-intelligence/contacts/:id/review` ran `UPDATE ... SET status='approved'` on the shared pool
(autocommit — no transaction), and only afterwards evaluated the gate and returned 403. The candidate was
genuinely `approved`, with `approved_by`/`approved_at` set, on a company the gate had just refused. A gate
that reports a block while permitting the state is worse than no gate: it puts a false negative in the
audit trail PR 4's readiness report will read. Gate now runs before the write.

**D-3 — `POST /suppression` collapsed the hard-bounce grain into `contacts.do_not_contact`.** §7 above.
New `isStatedContactPreference()` confines the contact-grain write to `unsubscribe` / `do_not_contact` /
`manual`.

**D-4 — `suppress()` was two autocommitted statements, not one transaction.**
§8.10 rule 4's whole claim is that routing every caller through the gate makes the append-only event
*"guaranteed rather than remembered."* Two independent inserts only make it *usual*: a failure on the
second leaves a live suppression with no audit history — precisely what an append-only stream exists to
prevent. This is also the failure mode of the deploy-order hazard in §11 B-1. Now `db.transaction`.

**D-5 — `/send-test` gated on the address alone, degrading the A-1 union to one grain.**
`resolveWizmatchLinkageByEmail` resolved a `contactId` from `contact_channels` purely to delegate, then
**discarded it**. Row 21 therefore called the gate with `email` only, and `findSuppression`'s
`if (contactId)` branch never ran. A WizMatch-linked contact with `contacts.do_not_contact = true` but no
row yet in `wizmatch_suppression_list` for that address was returned `allow` and emailed. §22.3 #5 says
the union reads *both* grains; on this route it read one. `contactId` is now carried through.

**D-6 — Contact-grain writes missed mixed-case channel rows; `/classify-reply` omitted them entirely.**
§7 above.

### Medium — open

**U-8 — Unsubscribe tenant resolution: "most recent sender wins" can pick the wrong tenant.**
The new lookup joins `contact_channels` → `messages` and takes `ORDER BY sent_at DESC LIMIT 1` across all
tenants. `contact_channels` has no cross-tenant uniqueness on `channel_value`, and one mailer/IMAP estate
serves both tenants, so the same person can hold separate contact rows under WizMatch and Growth. If
WizMatch mailed on day 3 and Growth on day 5, a click on the day-3 WizMatch link on day 6 writes the
suppression and `do_not_contact` under **Growth** — and WizMatch, the actual sender, never learns of it
and keeps emailing. The HMAC carries no tenant, so the token cannot disambiguate. Not attacker-drivable
(tenant comes entirely from server-side state). **Owner decision:** either sign the tenant into the
unsubscribe token, or narrow the lookup to messages that plausibly carried an unsubscribe link. The
fallback path is safe: unset `WIZMATCH_TENANT_ID` fails closed with a 500 before `suppress()` runs.
This is a strictly better position than the hardcoded env tenant it replaced — §22.3 #8 is met — but the
residual ambiguity should be closed before G4.

**U-9 — Rows 15-17 are gated at preparation level, but the checklist calls them `enrol` / `follow-up`.**
The three `wizmatchStaffingDomain.ts` writers block only when `!decision.preparationAllowed`. §8.8 says
that while a duplicate pair is `resolution='pending'`, "queueing and export are denied" — and
`duplicate_suspected_domain` / `_name` are not among the six reason codes that stop preparation, so a
pending-duplicate company still accrues new company-contact relationships and follow-up tasks. Same for
`policy_paused_by_owner` (L5) and the L3 region/BU/location restrictions. Whether creating a
`wizmatch_company_contacts` row is "preparation" (data-gathering, §8.8-permitted) or the "enrolment" the
checklist literally names is a genuine interpretive question the PR answered deliberately, and PR 4's
duplicate-merge UI assumes no further relationship-building happens on pending-duplicate companies in the
interim. **Not fixed — this needs an owner ruling, not a reviewer's guess.**

**U-13 — `resolveWizmatchLinkage` returns an arbitrary company when a contact is linked to several.**
`wizmatch_company_contacts` is unique on `(tenant_id, company_id, contact_id)`, so one contact **can** be
linked to multiple companies. The canonical lookup is `.limit(1)` with **no `ORDER BY`**, so the company
whose policy gets evaluated is arbitrary. If one linked company is blocked and another eligible, the gate
may evaluate the eligible one and allow the send — a fail-open in a system §8.10 rule 5 requires to fail
closed. Mitigating: for the canonical duplicate-company case, L5 denies *both* halves, so the outcome is
the same either way; divergence needs a contact genuinely linked to two distinct companies with different
policies (a vendor contact at two clients). **Not fixed:** the correct fix is most-restrictive-wins across
all linkages, which means changing the linkage contract and eight call sites — too broad to land safely
inside a review pass. Recommended for PR 4 alongside the duplicate work.

**U-10 — `GET /suppression`'s email filter lowercases the input but not the stored column.**
`email = $n` against a lowercased param. Same H-3 class as D-6, but on a read-only viewer, so the
consequence is a missing row in an admin list, not a wrong send. One-line fix; left for the PR 4 pass that
touches this route, and recorded so it is not lost.

**U-14 — Per-recipient gating on `bulk-email` and `export` runs for every tenant, sequentially.**
Both loops call `resolveWizmatchLinkage` (up to 3 queries) then the full ladder (~5 queries) for **each**
row, including Growth-tenant contacts that have no WizMatch linkage at all. A 5,000-row Growth export
becomes tens of thousands of sequential round-trips. Row 23 already short-circuits on
`tenantId === WIZMATCH_TENANT_ID`; rows 19/20/22/24 do not, so the posture is inconsistent. Correct beats
fast, and shadow mode makes it harmless today — but this should be batched or tenant-short-circuited
before enforcement, and before anyone runs a large export on the shared CRM.

**O-1 — §16 rule 5's Slack-alert-on-mode-flip is unimplemented *and* undisclosed.**
Recording the mode on each decision holds; the alert half has no implementation anywhere (grepped
repo-wide). Unlike the `gate_denied` and `sequence_enrolments` deferrals, it is absent from the marker's
scope-limits list, so it reads as an oversight rather than a decision. Rule 5 exists because a mode flip
is an env change that §18.2's audit-row rule does not cover — today a flip to `enforce` would fire no
automated signal at all. **Owner decision:** implement, or disclose explicitly.

**U-11 — §8.10 rule 6's `gate_denied` row is a console log, not a persisted row.**
Honestly disclosed as PR 4 scope. It does not fail §22.3 #9 or #10 on their literal text, but §8.10 rule 6
reads as a PR 3 requirement in the checklist's own prose, and PR 4's readiness report cannot be built from
a console log. Worth an explicit owner confirmation that PR 4 is the agreed landing spot.

**U-12 — §22.3 #2's literal grep wording is broader than its intent.** §5 above. Docs-only.

**M-5 / L-6 (carried from the PR 2 review) — not closed, and not disclosed as deferred.**
Review §16.11 listed *"Close L-6/M-5 — extend predicate capture to the `supersededAt` and `outreachMode`
filters and converge the two gate mocks"* as a **required step before PR 3**.
`wizmatchOutreachGateContract.test.ts` — the one file that already has predicate capture — was **not
touched by this PR at all**, and both new test files repeat the discard-the-`.where()` pattern M-5 named.
Consequence, verified by reading the mocks: deleting `isNull(wizmatchCompanyPolicies.supersededAt)`, or
the `outreachMode`/live-state filters on the cold-email lock, or the `tenantId` predicates in
`resolveWizmatchLinkage`, leaves the entire suite green. A superseded block row leaking back as active, or
a cross-tenant linkage leak, would ship undetected. This is the §14 lesson from the PR 2 review recurring
a third time. **Not fixed here** — converging the mocks is a test-infrastructure change across four files
and belongs in its own commit, not bundled into six behavioural fixes. It should land before G4.

### Low

- **L-7 — `sequenceWorker`'s cancel `UPDATE` has no `tenant_id` predicate.** Safe today (`enrolment.id` is
  a globally unique PK) but breaks the pattern every other new query follows.
- **L-8 — The emergency-override Slack alert is skipped when `WIZMATCH_SYSTEM_CHANNEL` is unset**, and
  `.catch(() => {})` swallows a send failure. §22.3 #7 says "every use". `logger.error` always fires, and
  this matches the repo's established guard convention, so it is flagged for completeness only.
- **L-9 — `bounceSuppressionEnabled()` is now a dead no-op export** with no remaining importers.
- **L-10 — `WizmatchLinkage.relationshipStage` is computed but read by no caller**, despite a comment
  claiming callers use it to reject. Comment corrected in intent by D-5's rework; the field remains unused.
- **L-11 — `getSignalCompanyId` is duplicated** in `routes/wizmatch.ts` and `wizmatchOutreachService.ts`.
- **L-12 — `isPreparationBlocked` logs a shadow would-block for every non-`allow` decision**, including
  ones where preparation *is* allowed and enforce mode would not block. This inflates the would-block
  counts §16 rule 2 feeds to the readiness report with false positives — relevant when that report gates
  promotion to `enforce`.
- **L-13 — A signal with a null `company_id` is ungated** on rows 7/8 (`isPreparationBlocked` returns
  "not blocked" when `companyId` is null). Correct in the sense that no policy is resolvable without a
  company, and preparation-only — but it is a hole shaped like the one PR 2's bootstrap closed.

---

## 9. Fixes made, with control runs

| # | Fix | Control run |
|---|---|---|
| D-1 | Row 4 gates on `shouldBlock` | Restored the inline `=== 'deny'` predicate → the new "blocks queueing on a REVIEW decision in enforce mode" test goes **red**; restored → green |
| D-2 | Row 12 gate moved before the approval write | Verified by reading the reordered handler; the pre-fix ordering is quoted in §8 |
| D-3 | `isStatedContactPreference()` confines the contact-grain write | New grain-separation tests assert `hard_bounce`/`complaint` are **not** contact-grain |
| D-4 | `suppress()` wrapped in `db.transaction` | Replaced the transaction with two independent inserts → *both* new tests ("performs both writes inside one transaction", "rolls the suppression-list row back when the audit-event write fails") go **red**; restored → green |
| D-5 | `contactId` carried through `resolveWizmatchLinkageByEmail` into the gate | New test asserts the resolved `contactId` comes back, with the reason stated in-test |
| D-6 | `LOWER()` + tenant scope + `lastActivityAt` on all three contact-grain writes; `/classify-reply` now writes the grain | Covered by the corrected linkage/route expectations |
| §22.3 #10 | Harness: per-fixture decision/level pins, four more rungs (L1b, L5, L6b, `do_not_contact` grain), fixture-set anti-vacuity guard, **eight §16 rule-3 near-miss cases** | Added `?.trim().toLowerCase()` to `readEnforcementMode()` → **4 near-miss tests go red**; restored → green |

Also: hard-bounce suppression failure logs at ERROR (a swallowed failure *is* A-4 reappearing, and the
message is already `\Seen` so there is no retry); the gate module's stale PR-2 header comment ("NO caller
migrates onto it in this PR") replaced with the real PR-3 state plus the 0037 dependency; the
bounce-parser header's stale `WIZMATCH_BOUNCE_SUPPRESSION_ENABLED` claim removed; stray blank line in
`constants.ts` reverted.

**Why the harness needed strengthening.** As submitted it asserted only that shadow and enforce return
equal decisions. That is *structurally guaranteed* — the evaluator never branches on the mode — so the
assertion could not fail on any realistic regression, and specifically **D-1, a live divergence already
present in the diff, left it green**. Parity is not equivalence: what §22.3 #10 needs is that call-site
*behaviour* is unchanged, and the harness never touched a call site. It now at least pins what each
fixture decides, spans seven ladder rungs, and guards the §16 rule-3 near-misses that nothing pinned.

---

## 10. Subagent findings adjusted on re-check

Recorded so the report is not a transcript of three agents.

- **Downgraded.** The claim that `recordHardBounce`'s hardcoded `WIZMATCH_TENANT_ID` is a PR 3 defect —
  it is byte-for-byte unchanged from before this PR and needs a tenant-resolution design (same shape as
  U-8), so it is an owner item, not a defect introduced here.
- **Downgraded.** "Rows 15-17 gate on the wrong level" was reported as High; on re-reading
  `wizmatchStaffingDomain.ts` in full, those sites *do* run inside `BEGIN`/`COMMIT`/`ROLLBACK`, so no
  partial write occurs and the question is purely interpretive (U-9).
- **Downgraded.** The `wizmatchContactIntelligenceRepo` suppression reads were reported as possible
  §22.3 #2 violations; each is an advisory display field with no path to a send/enrol/export decision.
- **Upgraded.** Row 12's ordering was reported as Medium and framed by the PR's own marker as "not a data
  integrity issue". It is: the route is autocommit, so the approval was durable while the caller was told
  403. Raised to High and fixed (D-2).
- **Found in main-session review, by neither subagent:** `suppress()`'s hard dependency on the unapplied
  migration 0037 (§11 B-1), the row-12 autocommit distinction, U-13's multi-linkage fail-open, and U-14's
  per-row cost on shared CRM routes.

---

## 11. Blockers and prerequisites

**B-1 — PR 3 must not deploy before 0037 is applied. Nothing in the branch says so.** *(new hard
constraint introduced by this PR)*
`suppress()` writes `wizmatch_suppression_events`, a table **created only by migration 0037**, which is
deliberately unapplied (G1, pending U-7). Every §8.10.1 row 25-29 path now routes through it. In any
environment where 0037 has not been applied:
- `GET /api/wizmatch/unsubscribe` — a public, compliance-critical route — **throws**, so the recipient
  sees an error page. Before this PR it worked.
- `POST /api/wizmatch/suppression` and `/classify-reply`'s auto-suppress return 500.
- Hard bounces are caught and dropped, silently re-creating the A-4 defect §22.3 #6 closes.

The specified rollout order (G1 applies 0037, then G2/G3 deploy shadow) does prevent this — but the repo
**auto-deploys on push to `main`**, so merging the stack in the wrong order breaks the unsubscribe path.
D-4's transaction makes the failure clean (all-or-nothing) rather than a half-applied suppression, and the
dependency is now stated in the gate module's header. **This must be an explicit merge/deploy-order
prerequisite, not an implicit one.**

**B-2 — M-5/L-6 remain open**, contrary to the PR 2 review's stated PR-3 prerequisites, and undisclosed
(§8). Close before G4.

**Owner decisions needed before G4:** U-8 (unsubscribe tenant ambiguity), U-9 (rows 15-17 gate level),
O-1 (§16 rule 5 alert — implement or disclose), U-11 (confirm `gate_denied` persistence is PR 4).

**Unchanged from PR 2, still gating G1:** U-7 (owner sign-off on the three shared-table `(tenant_id, id)`
indexes on `users`, `contacts`, `contact_channels`), the production-sized index-lock measurement, and the
production `information_schema` drift diff (M-10).

**Recommended for PR 4:** U-13 (most-restrictive-wins across multiple linkages), U-14 (batch or
tenant-short-circuit the per-row gating), U-10, U-12, and L-7 through L-13.

---

## 12. Final recommendation

**PR 3 is code-ready at `21b3bc3`**, as a stacked draft on PR 2, with the four owner decisions above
recorded and B-1 treated as a hard deploy-order prerequisite. Marker: `.ai/OUTBOUND_PR3_CODE_READY`.

The caller migration is the strongest part of this work: 30 rows closed, one shared blocking helper,
shadow provably blocking nothing at all 16 sites, and the out-of-tenant list re-verified rather than
asserted. The defects clustered in two familiar places — **the route layer, where the gate's careful grain
separation was undone three lines below the gate call, and the gaps between what a caller does and what it
reports doing.**

The process lesson repeats for a third consecutive review and should now be treated as a rule, not an
observation: **every one of D-1 through D-6 survived a fully green 896-test suite.** D-1 because nothing
tested `review` on that path; D-4 and D-5 because nothing tested the failure mode; D-2 because the test
asserted the 403 the route returns and never asserted the row it leaves behind. And the harness written
specifically to make "zero behavioural change" mechanically checkable was green *while a live divergence
sat in the same diff*, because it compared the gate to itself instead of comparing call sites. Assert the
state, not just the response; and a test that cannot fail is not evidence, however green.

Do not push. Do not merge. Do not apply 0037. Do not promote `enforce`. Do not enable sending or paid
discovery. Do not begin PR 4 until U-8, U-9 and O-1 have an owner decision.
