# WizMatch Outbound OS — PR 8 independent code-readiness review

- **Branch:** `ge/outbound-08-outreach-adapter` · **Parent:** `ge/outbound-07-free-prep` (code-ready at `70c310b5`)
- **Submitted at:** `2e329c12` · **Reviewed and fixed at:** `1b4b59fa`
- **Reviewed:** 2026-07-27 · **Method:** three parallel read-only Explore subagents (provider
  contract/capability/factory/tenancy; mock/isolation/idempotency/structured errors; scope boundary,
  PR 9 checklist, PR 10 event map, test quality), reconciled with an independent hand review and
  **ten control mutations**.
- **Marker:** `.ai/OUTBOUND_PR8_CODE_READY` created at `1b4b59fa`.

---

## Final verdict

**NOT READY as submitted at `2e329c12`. READY at `1b4b59fa`** after one Critical-adjacent class of
test-quality defect and nine behavioural/guard defects were fixed during the review.

The distinction that matters: **the production code in PR 8 is genuinely good** — the contract is
clean, the factory is fail-closed (and materially safer than the e-sign precedent it copies), the
mock is inert, and the scope discipline is real and provable from the diff. What failed review was
the **evidence layer**. Four of ten control mutations survived the submitted suite, and all four were
in the "did PR 8 leak policy logic, a network call, or a DB write into the provider boundary?"
category — precisely the property ADR-007's entire seam argument rests on. A reviewer reading the
green suite would have concluded the boundary was mechanically enforced. It was not.

This is the **fourth recurrence** of the project's documented mock/guard-vacuity defect class (PR 2,
PR 5, PR 7 T-3, now PR 8), and the second time a PR's own review doc has claimed to have avoided it
while reintroducing it.

### Control-mutation ledger

Every mutation was run against the real suite, before and after the fix.

| # | Mutation | Submitted `2e329c12` | Fixed `1b4b59fa` |
|---|---|---|---|
| A | multi-line `import { evaluateWizmatchOutreachGate } from '../outreachGate'` in the mock | **35/35 GREEN** | 1 failed ✅ |
| B | `import https from 'https'` in the mock | **35/35 GREEN** | 1 failed ✅ |
| C | `db.execute('INSERT ...')` in the mock | **35/35 GREEN** | 1 failed ✅ |
| D | delete both in-method `assertOutreachProviderCapability` calls | **35/35 GREEN** | 1 failed ✅ |
| E | move `applyScenario` below the work (ids burned, CSV built, then throw) | not run pre-fix¹ | 1 failed ✅ |
| F | `__reset` no longer restores `configStatus` | not run pre-fix¹ | 1 failed ✅ |
| G | drop CSV formula-injection neutralisation | n/a (defect) | 1 failed ✅ |
| H | drop idempotency-tier trimming | n/a (defect) | 2 failed ✅ |
| I | drop the strict-ISO timestamp check | n/a (defect) | 1 failed ✅ |
| J | drop the blank-`tenantId` guard | n/a (defect) | 1 failed ✅ |

¹ E and F were identified by subagent 2 by inspection and are green-on-submitted by construction (the
assertions that would catch them did not exist); they were confirmed failing only after the fix.

---

## Contract/capability verdict — **PASS**

`src/modules/outreach/providers/outreach-provider.interface.ts`.

- **No eligibility or policy engine in the provider layer.** The interface file has **zero imports**.
  The mock imports one module (the interface). The factory imports two. Nothing anywhere references
  `outreachGate`, `policyService`, `policyResolver`, `decisionWorkbench` or `campaignCompatibility` —
  all of which sit one directory up, so the omission is a real boundary, not an accident of absence.
- **No escape hatch.** Three methods total: `getConfigStatus`, `prepareExportBatch`, `parseResultFeed`.
  No `execute`/`request`/`invoke`/`send`/`submit`, no index signature, no `Record<string, Function>`.
- **Capability checks fail closed, strictly.** `assertOutreachProviderCapability` uses
  `!== true` (`:168`), not the merely-acceptable `!caps[k]` and nowhere near the defective
  `=== false`. Verified against `undefined`, `'false'`, `1`, `{}`, and inherited prototype members
  (`toString`, `constructor`) — every one throws.
- Counts in the implementation doc are accurate: 11 capability flags, 7 error codes, 35 tests
  (pre-fix), `KNOWN_PROVIDERS = ['mock']`.

Deviations from ADR-007's literal draft (`exportBatch`→`prepareExportBatch`,
`parseResults`→`parseResultFeed`, `name`→`identity`, `{sends, polls}`→11 flags, `polls`→
`pollsForResults`) are all improvements and all safe given the fail-closed assert — but **ADR-007 was
not amended**, so it still documents names that do not exist. Recorded as M-14.

## Factory/configuration verdict — **PASS, and stronger than precedent**

`src/modules/outreach/providers/index.ts`.

- **Lazy.** No import-time env read, provider construction, connection or credential access in any of
  the three files. `OUTREACH_PROVIDER` is read only inside `getOutreachProvider()` (`:52`). The
  singleton is assigned only at `:56`; if resolution throws, `singleton` stays `null` and a later call
  retries rather than caching a failure.
- **Fail-closed on every input.** Traced: unset, `''`, `'   '`, `'mock'`, `'MOCK'`, `' mock '`,
  `'smartlead_csv'`, `'garbage'`, `'__proto__'`, `'constructor'`, `'toString'`. Every non-`mock` value
  throws `OutreachProviderError('unknown_provider')`. `isKnownProvider` uses `Array.includes` on a
  literal array — **no object indexing anywhere**, so no inherited property is reachable, and the
  allow-list check strictly precedes `buildProvider`.
- **No live provider is selectable.** There is literally no builder but `mock`; no
  `smartlead-csv.provider.ts` exists on disk.
- **This deliberately does NOT copy the e-sign precedent**, which is the right call:
  `src/modules/esign/providers/index.ts` does `which === 'mock' ? mock : new DocumensoProvider()`, so
  *any* unrecognised `ESIGN_PROVIDER` silently selects the **live** provider. PR 8 refuses to
  substitute anything. This is the single best decision in the PR.
- **Sending cannot be enabled by anything this PR reads.** Repo-wide, `sends: true` appears in prose
  docs only, never in a `.ts` file. No send/enrol/submit method exists. This PR reads exactly one env
  var, and the only constructible provider hardcodes `sends: false` as a class field.

## Mock/idempotency/isolation verdict — **PASS after fixes**

`src/modules/outreach/providers/mock.provider.ts`.

- **Deterministic**: no `Math.random`, `Date.now`, `randomUUID`, unordered iteration, or locale-
  dependent operation. Per-tenant integer id sequence. Notably better than the e-sign mock, which
  uses `Math.random()` in its id. Two identical calls after `__reset()` produce byte-identical
  `{csv, filename, rowCount}`.
- **Inert**: imports exactly one module, which itself imports nothing. No env, no fs, no db, no
  network.
- **Isolated**: captured calls, scenarios and the id counter are all keyed by `tenantId`; ids embed
  the tenant, so cross-tenant collision is structurally impossible. `configStatus` is deliberately
  *not* tenant-keyed (it models a provider-level fact matching `getConfigStatus()`'s tenant-free
  signature) — the file comment claiming per-tenant keying "throughout" was **false** and is corrected.
- **Resettable**: `__reset()` clears all four mutable fields; a bare call is a full clear.
- **Unsupported operations cannot execute** — now actually pinned (control D and E).

## Error/observability verdict — **PASS with recorded gaps**

- `OutreachProviderError extends Error` is safe: `tsconfig.json` targets ES2022, so `instanceof` works
  without `setPrototypeOf`. `name` is set. Seven codes, closed union at compile time.
- **Log-safe at every mock call site.** Messages are index- or count-scoped (`row 0 has an invalid
  email`, the constant `'malformed result line'`) and deliberately never echo the offending line,
  which would contain an email. The error carries only `code` and `provider` — no row array, no
  payload, no `cause`. This is the strongest-designed part of the PR.
- Two recorded gaps (M-6, L-4): `assertOutreachProviderReady` pipes a provider-supplied free-text
  `reason` straight into a logged message, and `JSON.stringify(err)` silently drops the message
  because `Error.prototype.message` is non-enumerable.

## Safety/scope-boundary verdict — **PASS, proved from the diff**

`git diff --name-only ge/outbound-07-free-prep..HEAD` — 12 files, all additions, **0 deletions**:

- **No guardrail file**: `src/db/schema.ts`, `src/db/migrations/`, `src/middleware/auth.ts`,
  `src/middleware/rbac.ts`, `src/routes/cashfree.ts`, `src/services/sodEodService.ts` all untouched.
- **No migration.** `0037` and its journal/snapshot are byte-identical; no `0038`. Confirmed.
- **No** `package.json`/`package-lock.json`/admin/client/scripts/n8n/`.github` change.
- **No** Smartlead API client, HTTP call, CSV **parse** implementation, credential, API key,
  enrolment write, suppression mutation, or reply ingestion. Every risky-token grep hit is a comment,
  a test name, the `'smartlead_csv'` discriminator, a capability flag name (`exportsCsv`), or the
  mock's own pipe-delimited wire format.
- **Nothing imports the new module** except its own test — no route, cron, worker or service. The
  "no live provider can be selected accidentally" property is true in the strongest sense: nothing can
  select any provider at all.
- Sending kill-switches and paid-discovery flags untouched.

## PR 9 checklist verdict — **PASS after one correction**

`docs/handoffs/WIZMATCH_PR9_SANITISED_FIXTURE_CHECKLIST.md` is honest. It **invents no Smartlead
column, header, schema, endpoint or event name** — every external unknown is hedged ("however
Smartlead represents a bounced lead…"). Every repo fact it cites was re-verified and is correct
(`HEADER_ALIASES` keys, the `outbound.ts` parser exports, the `provider` default, the
`wizmatch_outreach_events` columns, the absence of any fixture directory). It states the PII/credential
sanitisation bar and correctly records PR 9 as BLOCKED on U-6.

One substantive correction made (M-13): it claimed ADR-007 D-4 was already "mechanically checked".
It is not — the existing guard prevents PR 9 work leaking into PR 8's files; it does not implement
D-4, which constrains where a Smartlead header literal may live once one exists. Corrected in place so
PR 9 does not inherit a false assurance. One precision fix (L-6) on an over-broad "only Smartlead-shaped
string in `src/`" claim.

## PR 10 event-map verdict — **PASS after three additions**

`docs/handoffs/WIZMATCH_PR10_PROVIDER_EVENT_MAP.md` is unusually good: every table, column, service
and line range it cites was verified present, it is provider-neutral, it invents nothing (it explicitly
records the missing `ProspectReply` timestamp as a **gap** rather than inventing a field), it contains
no code or SQL, and it correctly preserves ADR-006 D-16 / ADR-007 D-1 — a `replied` event does not
release the company cold-email lock, and an import may never write `closed`/`disqualified`/
`company_blocked`/`manually_released`. Its route citation is *more* accurate than ADR-007's own.

Three additions made, all forward-safety:

- **H-4 (tenancy)** — §9 told PR 10 to wire a reply poller into `POST /api/wizmatch/classify-reply`
  under a "tenant-safe" heading. That route resolves `const tenantId = process.env.WIZMATCH_TENANT_ID!`
  (`src/routes/wizmatch.ts:3849`), ignoring the caller, then writes signals, tasks, `suppress()` and
  `contacts.do_not_contact` against that one tenant. Feeding a second tenant's replies into it would
  cross-write suppression and do-not-contact state between tenants. Now stated explicitly.
- **M-10** — `OutreachResultEvent` carries no `tenantId`; tenancy rides only on `OutreachBatchMeta`,
  and an IMAP reply may have no batch.
- **M-11** — `wizmatch_outreach_events.enrolmentId` is `NOT NULL` with a composite FK, so the
  recommended dedupe table cannot accept a reply from an unenrolled address; it is not the drop-in
  equivalent of `outreach_processed_replies` the map presented.

## Test-quality verdict — **FAIL as submitted; PASS at `1b4b59fa`**

Submitted: 35 tests, all passing, count accurate. Four of ten control mutations survived — see the
ledger above. The failures were concentrated entirely in the source-guard block, which is the only
evidence for the PR's central boundary claim.

Now 46 tests. Guards glob the directory (plus `outreachIdempotencyKey.ts`, previously covered by
nothing), strip comments, scan whole sources rather than lines matching `/^\s*import\b/`, and cover
bare/`node:`/CJS/dynamic import syntax for the whole network family, all DB access syntaxes including
reads, and credential-shaped literals. The `process.env` guard now also makes the **positive**
assertion that the factory has exactly one read.

Strong tests that were already non-vacuous and I confirmed by mutation: determinism (`Math.random` in
`nextId` fails it), per-tenant id isolation (a shared counter fails it), cross-tenant scenario
isolation, the fail-closed factory tests, and the `!== true` capability assert — the single best test
in the file.

---

## Findings

### Critical

**None.** No defect in this PR can cause data loss, a production outage, a cross-tenant leak, an
unintended send, or a spend. The module is unreachable from any runtime entry point.

### High — all fixed

| # | Finding | Evidence |
|---|---|---|
| **H-1** | **The policy-gate boundary guard was defeated by prettier's own formatting.** The test filtered `/^\s*import\b/` lines, so a multi-line import — the dominant style in this very module, including `mock.provider.ts:11-23` itself — put the specifier on a continuation line the filter discarded. This is PR 7's P-5 defect verbatim, in the guard that is the sole mechanical evidence for "the provider layer contains no eligibility or policy engine". | Control A: mock genuinely imports `evaluateWizmatchOutreachGate`, **35/35 green** |
| **H-2** | **The network guard missed the commonest ESM form.** `/node:https?|require\(['"]https?['"]\)/` does not match `import https from 'https'`, nor axios/node-fetch/got/net/dns. The runtime `fetch` spy — which the implementation doc presents as the *stronger* proof — stubs only `globalThis.fetch` and cannot see any of them. | Control B: **35/35 green** |
| **H-3** | **The DB guard matched one syntax of many.** `/db\.(insert\|update\|delete)\(/` misses `db.execute(sql\`INSERT\`)`, a `tx` handle inside `db.transaction()`, `getDb().insert(`, `db['insert'](`, and prettier's `db\n .insert(`. It also never checked reads, though the provider may not read policy state either. | Control C: **35/35 green** |
| **H-4** | **The PR 10 map routes a multi-tenant reply poller at a tenant-pinned write endpoint**, under a heading claiming tenant safety. `/classify-reply` takes its tenant from `WIZMATCH_TENANT_ID` and cross-writes `suppress()` and `contacts.do_not_contact`. | `src/routes/wizmatch.ts:3849`; doc corrected |
| **H-5** | **Nothing pinned the in-method capability enforcement.** Deleting both `assertOutreachProviderCapability` calls from the mock's two operations left the suite green — so "unsupported operations cannot execute" was unproven. | Control D: **35/35 green** |
| **H-6** | **The guarded file list was hardcoded**, so any new file in `providers/` — most obviously PR 9's smartlead adapter, the exact thing these guards exist to catch — was scanned by nothing. `outreachIdempotencyKey.ts`, also new in this PR, was covered by no guard at all. | inspection; now globbed |

### Medium

| # | Finding | Status |
|---|---|---|
| **M-1** | `deriveOutreachIdempotencyKey` did not trim tiers 1–3. `' evt_1'` and `'evt_1'` derive two keys for one event, so the `UNIQUE (tenant_id, provider, idempotency_key)` constraint that makes a re-import a no-op (ADR-007 D-3) admits a duplicate row. A CSV parser is exactly where stray whitespace originates. | **Fixed** (control H) |
| **M-2** | `csvEscape` did not neutralise CSV formula injection. Export files exist to be opened by an operator in Excel/Sheets (ADR-007 tenant rules), and `companyName`/`title` come from scraped signal data, so `=HYPERLINK("http://evil",…)` in a company name executes on open. This is the escaper PR 9's real exporter will copy. `\r` was also unhandled. | **Fixed** (control G) |
| **M-3** | `parseResultFeed` accepted non-ISO timestamps. `new Date('Jul 27 2026')` is parsed in **local** time, so the same feed yields different `eventAt` — and different tier-3/4 idempotency keys — on an IST laptop and a UTC CI box. | **Fixed** (control I) |
| **M-4** | A blank/whitespace `tenantId` silently collapsed every such caller into one shared Map bucket, sharing scenarios, captured calls and the id counter — the exact leak the per-tenant keying exists to prevent. No validation existed anywhere in the module. | **Fixed** (control J) |
| **M-5** | `capabilities`/`identity` were `readonly` in TS only. `readonly` is erased at runtime and the factory hands out a process-wide singleton, so one `(p.capabilities as any).sends = true` would flip sending for every tenant in the process. | **Fixed** (frozen) |
| **M-6** | `assertOutreachProviderReady` pipes a provider-supplied free-text `reason` straight into a logged error message, two comment-blocks below a rule saying messages must never embed free text. PR 9's Smartlead provider is the first thing to populate it, and the natural mistake is interpolating a key. Constraining `reason` to a code union is a contract decision. | **Recorded** — PR 9 blocker |
| **M-7** | **Readiness is enforced by convention, not construction.** `assertOutreachProviderReady` exists and works, but no provider operation calls it — a `not_configured` mock exports happily. Where the assertion lives is a contract decision, so not fixed here. | **Recorded** — PR 9 blocker |
| **M-8** | `getConfigStatus()` takes no tenant argument, unlike the other two methods, so a provider cannot report per-tenant readiness. Cheapest to change now, at zero callers. Undocumented as a deliberate choice. | **Recorded** — PR 9 blocker |
| **M-9** | `configStatus` is instance-global while the file header claimed state was "keyed per tenantId throughout". The claim was false; the design is defensible given M-8. | **Comment corrected** |
| **M-10** | `OutreachResultEvent` carries no `tenantId`; tenancy rides only on `OutreachBatchMeta`, and an IMAP-originated reply may have no batch. | **Added to PR 10 map** |
| **M-11** | `wizmatch_outreach_events.enrolmentId` is `NOT NULL` with a composite FK, so an unenrolled address's reply cannot be written there — the map presented it as a drop-in for `outreach_processed_replies`. | **Added to PR 10 map** |
| **M-12** | `WIZMATCH_OUTREACH_ADAPTER_ENABLED` is read by **no code anywhere in the repo** — it exists only in comments and prose. PRD-005 §16 promises "two independent gates"; today there is one (the allow-list). Correct for PR 8 (nothing to gate), but the comment at `index.ts:12` leans on it for a safety property it cannot provide. | **Recorded** — PR 9 must enforce it |
| **M-13** | The PR 9 checklist claimed ADR-007 D-4 was already mechanically enforced. It is not. | **Doc corrected** |
| **M-14** | ADR-007 still documents `exportBatch`/`parseResults`/`capabilities {sends, polls}`, none of which exist. A reader greps and finds nothing. Amending an ADR is an owner action. | **Recorded** — owner |

### Low

| # | Finding |
|---|---|
| **L-1** | `MockOutreachCallRecord.at` is wall-clock, so `__getCalls()` output is not byte-reproducible. No test asserts it today; the first PR 9 test that deep-equals a call record will be flaky. Left as-is deliberately — a call log's capture time is a reasonable wall-clock field, and faking a clock is not PR 8's to invent. |
| **L-2** | The cached singleton is not invalidated when `OUTREACH_PROVIDER` changes; `getOutreachProvider()` short-circuits before reading env. Matches the e-sign precedent, blast radius nil with one constructible provider. |
| **L-3** | PRD-005 §16 says the factory "throws at startup"; it throws on first *call*, and nothing calls it at boot. The ADR's "lazy singleton" and the PRD sentence contradict each other; the code follows the ADR. Owner to reconcile. |
| **L-4** | `JSON.stringify(err)` drops the message (`Error.prototype.message` is non-enumerable), and there is no `toJSON` or code→HTTP mapping, so PR 9's routes will invent an ad-hoc one. |
| **L-5** | `supportsIdempotentSubmission: true` while the mock is not idempotent — a repeat `prepareExportBatch` issues fresh ids and a second captured call. The `duplicate` scenario must be set by hand rather than derived from seeing a batch twice. |
| **L-6** | The PR 9 checklist's "only Smartlead-shaped string in `src/`" was over-broad (the word appears in comments). Corrected. |
| **L-7** | Three records call `OutreachProvider` a "two-method interface"; it has three methods (`getConfigStatus` is on it). |
| **L-8** | "`key_source` CHECK values **exactly**" is a 4-of-5 match — the DB also permits `internal_transition`. The omission is semantically correct; "exactly" is the wrong word. |
| **L-9** | `supportsReplyIngestion: true` on a mock with no reply ingestion. A PR 10 caller asserting that capability gets a pass for something that does not exist. |
| **L-10** | Four `try/catch` blocks assert only inside `catch` with no `expect.assertions()`. Not vacuous today — each is preceded by a `rejects`/`toThrow` on the same call — but the coupling is invisible, and weakening the preceding line silently voids four tests at once. |
| **L-11** | Whitespace-only `OUTREACH_PROVIDER` produces `[] unknown_provider: "" is not…`. Fails closed correctly; only the diagnostic degrades. |

### Retracted / not upheld

- Subagent 3 reported "tool-output tampering" after reading an `import https from 'https'` that is not
  in the committed file. **This was my own control mutation B, live in the worktree while that agent
  was reading.** Not tampering — a race with the review's own control runs. The underlying guard
  weakness it would have exposed is real and is H-2. Recorded so the incident is not carried forward
  as a security event.
- Subagent 3's static Playwright count came out one short of the claimed 99. I **ran** the suite: 99
  passed / 15 skipped / 0 failed, both before and after the fixes. The claim was accurate.

---

## Carry-forward honesty — **verified, nothing falsely closed**

PR 7's O-1…O-4 and P-1…P-5, and PR 6's §13 approval-capture gap, all survive verbatim in
`.ai/CURRENT_TASK.md` and are restated as open in the implementation doc and handoff log. No finding
is closed, resolved, or dropped.

One qualification (H-1/H-2/H-3): the implementation doc claimed the runtime fetch spy was chosen
"deliberately instead of a static import-line scan, per the PR 7 review's own P-5 finding". That is
true of one test — and three of the other four guards were the P-5 pattern, one of them the literal
`/^\s*import\b/` line scan P-5 named. **P-5's defect class was reintroduced in the same PR whose doc
claims it was avoided.** Now fixed, and recorded here so the pattern is visible on the fifth occasion.

## Gates — every one run for real, twice

| Gate | Submitted `2e329c12` | Fixed `1b4b59fa` |
|---|---|---|
| `git diff --check` | clean | clean |
| `npm run build` | exit 0 | exit 0 |
| `npm test` | 120 files / **1154** tests | 120 files / **1165** tests (+11) |
| `npm run admin:build` | exit 0 | exit 0 |
| `npx playwright test --config=playwright.wizmatch-local.config.ts` | 99 passed / 15 skipped / 0 failed | 99 passed / 15 skipped / 0 failed |

Every number in the implementation doc reproduced exactly on the submitted tree — the marker did not
overstate itself. The 15 skips are the documented no-password real-backend specs: two hardening specs
skip at describe level on `!WIZMATCH_E2E_TEST_PASSWORD` (2 + 3 tests) across three projects = 15.
Same reason as every prior PR in this stack.

## Fixes made

All in `1b4b59fa`, each with a control run proving the new assertion fails on the defect.

1. Boundary guards rewritten: glob the providers directory plus `outreachIdempotencyKey.ts`, strip
   comments, scan whole sources, cover every import syntax for the whole network family, all DB access
   syntaxes including reads, credential-shaped literals, and a positive assertion that the factory has
   exactly one env read. (H-1, H-2, H-3, H-6)
2. Test pinning in-method capability enforcement via a capability-stripped subclass. (H-5)
3. "performs no work" now also asserts the id counter is untouched. (control E)
4. `__reset` now asserted to restore `configStatus`; the reset test no longer contains a tautological
   empty-log assertion for a tenant that never called. (control F)
5. `deriveOutreachIdempotencyKey` trims tiers 1–3, treats whitespace-only as absent, and throws a
   structured `invalid_input` instead of a bare `RangeError`. (M-1)
6. `csvEscape` neutralises formula-injection prefixes and handles `\r`. (M-2)
7. `parseResultFeed` requires strict ISO-8601 UTC. (M-3)
8. Blank-`tenantId` guard. (M-4)
9. `capabilities`/`identity` frozen. (M-5)
10. Two previously-untested `parseResultFeed` validation branches covered.
11. Corrected the false "keyed per tenantId throughout" and "mirrors esign exactly" comments. (M-9)
12. PR 9 checklist: D-4 enforcement claim corrected; "only Smartlead string" precision fix. (M-13, L-6)
13. PR 10 map: tenant-pinned `/classify-reply` warning, missing `tenantId` on the event shape, and the
    `enrolmentId NOT NULL` caveat. (H-4, M-10, M-11)

## Blockers before PR 9

PR 9 remains **GATED on U-6** — the sanitised Smartlead fixtures (ADR-007 D-5). That gate is
independent of this review and is not lifted by it. In addition, before PR 9 writes a real provider:

- **M-7** decide whether readiness is asserted by the caller or inside each operation, and enforce it.
- **M-8** decide whether `getConfigStatus()` takes a `tenantId` — cheapest now, at zero callers.
- **M-6** constrain `OutreachProviderConfigStatus.reason` (code union, or redact before logging)
  *before* a provider with credentials populates it.
- **M-12** actually enforce `WIZMATCH_OUTREACH_ADAPTER_ENABLED`, or PRD-005 §16's second gate never
  materialises.
- **M-13** implement the real ADR-007 D-4 header-literal grep; the existing guard is not it.
- **M-2** reuse the fixed `csvEscape`; do not re-roll an escaper.
- **L-4** define a code→HTTP mapping once, rather than per route.

## Blockers before PR 10

- **H-4** do not wire a multi-tenant reply poller into `/classify-reply` as-is. Parameterise the
  tenant on the route, or resolve it from the mailbox row and pass it explicitly.
- **M-10** decide the tenant carrier for a batch-less IMAP reply.
- **M-11** decide what happens to a reply from an address with no enrolment — `enrolmentId` is
  `NOT NULL`, and creating an enrolment is a gated write.
- The PR 10 map's own open questions, unchanged: the missing `ProspectReply` timestamp, the recipient
  derivation, and where a reply's raw payload is stored.

## Blockers before real use / G1 / G4 / production

Unchanged from PR 7 and carried forward in full — **none is closed by this PR**:

- **B-1** apply migration `0037` before this stack reaches `main` (**the repo auto-deploys on push**),
  then run the §10.11.4 fresh-database checks (**G1**).
- **O-1, O-3, O-4** before enabling `WIZMATCH_AUTO_PREP_ENABLED` with real data.
- **O-2** plus everything carried from PR 3/5/6 before **G4**/`enforce`.
- **PR 6 §13 approval capture** before the workbench is used for real decisions.
- **P-1…P-5** pre-existing, recorded.
- Sending remains a separate go-live decision under `.claude/skills/wizmatch-go-live-sending`. Nothing
  in PR 8 moves it, and no capability anywhere claims `sends: true`.

**Do not** merge, push, deploy, apply 0037, run backfill `--apply`, promote `enforce`, enable sending,
enable paid discovery, or connect Smartlead on the strength of this review.
