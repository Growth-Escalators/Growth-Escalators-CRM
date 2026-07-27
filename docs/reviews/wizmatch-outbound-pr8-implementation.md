# WizMatch Outbound OS — PR 8 implementation (self-reported)

- **Branch:** `ge/outbound-08-outreach-adapter` · **Parent:** `ge/outbound-07-free-prep` (code-ready at `70c310b5`)
- **Implemented at:** 2026-07-27
- **Status:** self-reported, **not independently reviewed**. Do not start PR 9 before that review.

## Scope delivered

Provider-neutral outreach-adapter boundary per PRD-005 §15/§16 and ADR-007 D-1/D-9: contracts,
capability model, a deterministic in-memory mock provider, and a factory/registry with test-injection
hooks. **No Smartlead code, no credentials, no network call, no sending, no enrolment/suppression
write.**

New files, all under `src/modules/outreach/`:

- `providers/outreach-provider.interface.ts` — vendor-neutral types (`OutreachContactRow`,
  `OutreachBatchMeta`, `OutreachExportResult`, `OutreachEventType`, `OutreachResultEvent`), the explicit
  typed `OutreachProviderCapabilities` (11 flags — export vs API submission, sends, result import,
  polling, bounce/unsubscribe/reply reporting, reply-ingestion declaration, provider-side suppression,
  idempotent-submission support), `OutreachProviderIdentity`, `OutreachProviderConfigStatus`, the
  `OutreachProvider` interface itself (`getConfigStatus`, `prepareExportBatch`, `parseResultFeed` —
  exactly two operations, no generic execute/request escape hatch), the structured
  `OutreachProviderError` (7 codes: `unknown_provider`, `unsupported_capability`,
  `missing_configuration`, `invalid_input`, `duplicate_operation`, `provider_unavailable`,
  `provider_response_invalid`), and the two enforcement helpers
  `assertOutreachProviderCapability`/`assertOutreachProviderReady`.
- `providers/mock.provider.ts` — `MockOutreachProvider`: deterministic in-memory, zero network/credential
  code, per-tenant call capture and id sequencing (no shared counters or capture arrays across tenants),
  controllable `success | unsupported | failure | duplicate` scenarios per tenant, `__reset()` /
  `__setScenario()` / `__setConfigStatus()` / `__getCalls()` test hooks explicitly marked "not part of
  the interface", mirroring `src/modules/esign/providers/mock.provider.ts`'s `__view`/`__sign`/`__reject`/
  `__reset` convention exactly.
- `providers/index.ts` — lazy singleton factory mirroring
  `src/modules/esign/providers/index.ts`: `getOutreachProvider()`, `setOutreachProvider()`,
  `resetOutreachProvider()`, `listKnownOutreachProviders()`. `KNOWN_PROVIDERS = ['mock']` — an
  allow-list, not a map with a default fallback branch. `OUTREACH_PROVIDER` is read only inside
  `getOutreachProvider()`, never at module-import time; unset resolves to the PRD-005 §16-documented
  default `'smartlead_csv'`, which has no builder in this PR and therefore fails closed with
  `unknown_provider` rather than silently substituting `mock` or anything else.
- `outreachIdempotencyKey.ts` — `deriveOutreachIdempotencyKey()`, the ADR-007 D-3 four-tier order
  (`external_event_id` > `external_message_id` > `external_lead_ref:event_type:event_at` >
  `sha256(batch_ref|email|event_type|event_at)`), returning `{ key, keySource }` matching
  `wizmatch_outreach_events.key_source`'s CHECK values exactly. Provider-neutral — no provider
  implementation in this PR calls it yet (there is nothing to call it from until PR 9/10), but it exists
  now so both future PRs derive keys identically rather than reinventing the order.

## Design notes and deliberate departures from ADR-007's literal draft interface

ADR-007's draft (`exportBatch`/`parseResults`, `capabilities: { sends, polls }`) is a two-field sketch of
the *shape*; PR 8's actual task scope asked for a materially richer contract (typed capability model
covering export-vs-API/import/bounce/unsubscribe/reply/reply-ingestion/provider-suppression/idempotent-
submission separately, explicit identity+version, health/config status, structured error taxonomy). The
implementation keeps every ADR-007 noun (`OutreachContactRow`, `OutreachEventType`,
`OutreachResultEvent`, the five-value provider event vocabulary, the provider-event-vs-enrolment-state
separation) verbatim, and extends the two-method interface's *capabilities* field into the fuller typed
object the task required, without adding any operation ADR-007 doesn't call for (no `send()` method
exists anywhere — `capabilities.sends` is declarative metadata only, consistent with "V1 is CSV export
plus CSV result import, and nothing else").

`getConfigStatus()`/`assertOutreachProviderReady()` exist so "missing configuration fails closed" is
independently testable even though the only real provider today (`mock`) needs no configuration —
`MockOutreachProvider.__setConfigStatus()` lets a test simulate a not-ready provider without waiting for
a real one to exist.

## What PR 8 explicitly does NOT do (by instruction, verified)

- No Smartlead API or CSV column mapping — `docs/handoffs/WIZMATCH_PR9_SANITISED_FIXTURE_CHECKLIST.md`
  records what's needed instead, without inventing a single Smartlead field name.
- No IMAP, mailbox polling, reply classification, or conversation-lock code —
  `docs/handoffs/WIZMATCH_PR10_PROVIDER_EVENT_MAP.md` maps only what already exists.
- No policy/eligibility decision inside the provider layer — the provider receives only rows a caller
  has already gated; `src/__tests__/wizmatchOutreachProvider.test.ts` asserts no provider file imports
  `outreachGate`/`policyService`/`policyResolver`/`decisionWorkbench` and no provider file calls
  `db.insert|update|delete`.
- No schema/migration change — no new table, no `migration 0038`. Everything PR 8 needs (the
  `wizmatch_outreach_*` tables' shape, the `key_source` CHECK values) already exists from PR 2's
  `0037` (still unapplied, unchanged by this PR).
- No shared environment variable changed. `WIZMATCH_OUTREACH_ADAPTER_ENABLED` and `OUTREACH_PROVIDER`
  are read only by code this PR adds; neither is wired into `src/index.ts` or `src/worker.ts` in this
  PR (no route/job exists yet to gate) — flagged explicitly rather than silently deferred, since wiring
  a real caller is PR 9/10 scope, not PR 8's.
- `WIZMATCH_SENDING_ENABLED`/`AUTOMATED_EMAILS_ENABLED` untouched; no capability anywhere claims
  `sends: true`.

## Tests

`src/__tests__/wizmatchOutreachProvider.test.ts` — 35 tests, all non-vacuous against the required
failure list:

| Required failure scenario | Covered by |
|---|---|
| unknown provider falls back to a known one | `fails closed — never falls back to mock or any other provider — for an unknown name`; `fails closed on the documented default (smartlead_csv)` |
| missing configuration treated as ready | `missing configuration is never treated as ready` (via `__setConfigStatus`) |
| sending defaults on | `never claims the sending capability` |
| capability checks bypassed | `assertOutreachProviderCapability` describe block — false, malformed/unknown key, and true cases |
| mock performs network/credential work | `makes no network call of any kind…` (runtime `fetch` spy, not a static import scan) + source-guard tests asserting no `process.env` read and no network-capable import in the mock file |
| provider calls leak between tenants/tests | `captured calls never leak across tenants`; `a scenario set for one tenant does not affect another` |
| reset hooks fail | `__reset clears calls, scenarios, and the id counter for every tenant`; factory's `setOutreachProvider/resetOutreachProvider are effective DI hooks` |
| unsupported operations execute | `scenario=unsupported fails closed and performs no work` (asserts zero calls captured) |
| provider IDs/idempotency values nondeterministic | `produces deterministic provider ids and CSV across repeated calls after reset`; `idempotency-key derivation is stable for identical input`; `…prefers provider ids over the fallback hash, in ADR-007 D-3 order` |
| policy logic inside the provider layer | `no provider file imports the policy gate or reads/writes policy state at runtime` |
| enrolment/send/suppression write in PR 8 | same test (`db.insert|update|delete` grep) |
| unratified Smartlead fields invented | `no provider file references a Smartlead-specific field, header, or module` |
| PR 10 implementation appears early | `no provider file implements or references PR 10 reply-ingestion machinery` |

The runtime-`fetch`-spy idiom (`vi.stubGlobal('fetch', ...)`) was used deliberately instead of a static
import-line scan, per the PR 7 review's own P-5 finding that a static scan is evadable by
`import * as x` or a dynamic `import()` — this PR's "no network call" proof is a live interception, not
a source grep.

## Gates — run for real

| Gate | Result |
|---|---|
| `git diff --check` | clean |
| `npm run build` | exit 0 |
| `npm test` | **120 files / 1154 tests** (was 119/1119 at the PR 7 baseline, +1 file / +35 tests) |
| `npm run admin:build` | exit 0 (no admin files touched) |
| `npx playwright test --config=playwright.wizmatch-local.config.ts` | **99 passed / 15 skipped / 0 failed** — identical to the PR 7 baseline, confirming zero UI regression |

## Method

Three parallel read-only Explore subagents (provider contracts/capability requirements; test/DI/reset
patterns and the recurring mock-vacuity defect class; PR 9/10 fixture and event-field groundwork), per
the PR 2–7 precedent. Findings used directly: the exact e-sign factory/mock shape to mirror (including
its *lack* of an unknown-provider guard, which this PR deliberately does NOT copy — PR 8 fails closed on
an unknown/unimplemented provider name rather than reusing esign's silent fallback-to-default, since the
task explicitly requires "unknown provider fails closed" and "no implicit fallback to another
provider"); the SQL-text-assertion fix for the mock-vacuity defect class (not directly applicable here,
since PR 8's mock has no DB interaction, but informed the decision to assert on captured call arrays
rather than a single loosely-typed field); the runtime-fetch-spy idiom from `emailExtractorService.test.ts`
copied for the "no network call" proof; and the exact existing schema/route surfaces PR 9/10 will build
on, used to write the two handoff docs without inventing any external schema.

## Carry-forward findings (PR 6/PR 7 open items — read, not falsely closed)

No PR 6 or PR 7 open finding (O-1…O-4 from the PR 7 review; the PR 6 §13 approval-capture gap) is
addressed or claimed closed by this PR — none is a direct, unambiguous dependency of the outreach-adapter
boundary. They remain open, unchanged, tracked in `.ai/CURRENT_TASK.md`.

## Not done, deliberately

No Smartlead API/CSV implementation, no IMAP/reply-ingestion implementation, no schema or migration
change, no `WIZMATCH_OUTREACH_ADAPTER_ENABLED`/`OUTREACH_PROVIDER` wiring into a real route or worker
job, no sending enabled, no paid discovery enabled, no guardrail file touched
(`src/db/schema.ts`, `src/db/migrations/`, `src/middleware/auth.ts`, `src/middleware/rbac.ts`,
`src/routes/cashfree.ts`, `src/services/sodEodService.ts` all verified untouched), no
Growth/SEO/n8n/legacy code touched, no `package-lock.json` change, nothing pushed, merged, or deployed,
no Railway or production access, no database mutation.

## Exact next action

Get an independent readiness review of PR 8 (three-subagent method, per the PR 2–7 precedent). Then PR 9
(`ge/outbound-09-smartlead-csv`) remains **GATED** on the sanitised fixtures in
`docs/handoffs/WIZMATCH_PR9_SANITISED_FIXTURE_CHECKLIST.md` (U-6) — do not start it without them. Stop
after PR 8.
