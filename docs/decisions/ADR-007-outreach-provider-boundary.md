# ADR-007: Outreach Provider Boundary

- **Status:** Accepted in principle — no code written; CSV adapter gated on provider fixtures
- **Date:** 2026-07-26
- **Product contract:** `docs/prd/005-wizmatch-outbound-operating-system.md` §15
- **Companion:** `ADR-006-company-outreach-policy.md`

## Context

WizMatch has no sending-provider abstraction. The 2026-07-26 audit of `origin/main` confirmed:

- **"Smartlead" appears nowhere in the repository** — not in `src/`, not in `docs/`.
- WizMatch sends in-process through `sendColdEmail()` (`src/services/multiDomainMailer.ts:47-118`),
  hardcoded to Purelymail SMTP across six inboxes configured as `PURELYMAIL_SMTP_USER_{1..6}` /
  `PURELYMAIL_SMTP_PASS_{1..6}` env pairs.
- In this codebase "provider" has only ever meant a **contact-discovery or enrichment** vendor —
  Apollo, Snov, Reacher, Serper — never a sending vendor.
- The only precedent for an external sending SaaS is Growth's Saleshandy integration
  (`outreachEnrichmentService.ts:205-317`, `saleshandyStatsService.ts:76-111`), which is a **different
  product and tenant** and is documented as out of scope for WizMatch
  (`docs/wizmatch/DATAFLOW.md:38-39`). A misleading Saleshandy "Outreach" nav decoy was recently
  removed from the WizMatch UI specifically to stop the two being conflated.

So "Smartlead as a replaceable sending provider" is **net-new architecture, not a swap**. Introducing
it without a seam would hardcode a second vendor into WizMatch and repeat the Purelymail coupling.

There is, however, a good precedent to copy. `src/modules/esign/providers/` implements a clean
vendor-neutral boundary: an interface typed against shapes the rest of the CRM owns, a real provider,
a mock, and an env-keyed lazy singleton with explicit test-injection hooks
(`esign-provider.interface.ts:15-48`, `providers/index.ts:10-26`). Its own comment states the rule
plainly — *"the rest of the CRM depends ONLY on these shapes — never on the vendor's response models"*.

Two further audit findings constrain the design:

- **The generic job loop is dead.** `sequenceWorker` inserts `jobType='sequence_step'` rows into `jobs`
  that nothing in-process consumes; the intended n8n consumer has not been deployed since 2026-05-03
  (`src/workers/sequenceWorker.ts:59-74`, `n8n-workflows/README.md:3-12`). A new adapter must not rely
  on it for asynchronous execution.
- **IMAP reply plumbing already exists but is wired to the wrong system.** `src/services/imapService.ts`
  polls six inboxes, runs bounce detection and AI reply classification, then matches senders against
  Growth's `outreach_leads` only. `POST /api/wizmatch/classify-reply` is fully implemented but has **no
  caller in the repository** (`src/routes/wizmatch.ts:3690-3762`).

## Decision

### D-1 — Copy the e-sign provider shape exactly

New module `src/modules/outreach/`, mirroring `src/modules/esign/providers/`:

```ts
// outreach.types.ts — vendor-neutral. The rest of WizMatch depends ONLY on these.
export interface OutreachContactRow {
  email: string; firstName?: string; lastName?: string;
  companyName: string; companyDomain?: string; title?: string;
  customFields?: Record<string, string>;
}
export type OutreachEventType = 'sent' | 'bounced' | 'replied' | 'unsubscribed' | 'completed';
export interface OutreachResultEvent {
  email: string; eventType: OutreachEventType; eventAt: Date;
  externalEventId?: string; externalMessageId?: string; externalLeadRef?: string;
  raw: unknown;
}

// outreach-provider.interface.ts
export interface OutreachProvider {
  readonly name: string;                       // 'smartlead_csv' | 'mock'
  readonly capabilities: { sends: boolean; polls: boolean };
  exportBatch(rows: OutreachContactRow[], batch: BatchMeta): Promise<{ csv: string; filename: string }>;
  parseResults(csv: string): Promise<OutreachResultEvent[]>;
}

// providers/index.ts — lazy singleton keyed on OUTREACH_PROVIDER (default 'smartlead_csv'),
// plus setOutreachProvider() / resetOutreachProvider() for test injection.
```

The CSV adapter reports `capabilities: { sends: false, polls: false }`. Callers branch on capabilities,
never on `name`.

### D-2 — V1 is CSV export plus CSV result import, and nothing else

1. Smartlead-compatible CSV export of approved and queued contacts.
2. Result CSV import for `sent`, `bounced`, `replied`, `unsubscribed`, `completed`.
3. Idempotent re-import.
4. Campaign batch and external provider reference tracking.
5. Suppression updates for bounces and unsubscribes.
6. **Existing IMAP remains the authoritative source for full reply bodies.**
7. **No Smartlead API keys, API calls, credentials or recurring cost.**
8. All Smartlead-specific column mapping isolated inside the adapter.

### D-3 — Idempotency prefers provider IDs; a hash is the last resort

`wizmatch_outreach_events` carries `UNIQUE (tenant_id, provider, idempotency_key)`. The key is derived
first-non-null:

| Order | Source | `key_source` |
|---|---|---|
| 1 | `external_event_id` | `provider_event_id` |
| 2 | `external_message_id` | `provider_message_id` |
| 3 | `external_lead_ref : event_type : event_at` | `lead_ref_composite` |
| 4 | `sha256(batch_ref \| email \| event_type \| event_at)` | `fallback_hash` |

A normalised fallback hash is used **only** when the provider supplies no identifier. `key_source` is
stored per row so import quality is observable rather than assumed: a corpus dominated by
`fallback_hash` is a signal that the export configuration is wrong.

Re-importing the same file is a no-op by constraint, not by application logic.

### D-4 — Column mapping is configurable and isolated

Smartlead header names live **only** in `providers/smartlead-csv.provider.ts`, behind a configurable
header-alias map in the shape already used by `src/routes/outbound.ts:191-203` (`HEADER_ALIASES`).
Nothing outside that file references a Smartlead header.

Enforced by a review grep for Smartlead header literals outside the adapter, which fails review.

### D-5 — The CSV format is not guessed; fixtures are a hard gate

Before the CSV adapter is implemented, the following are required:

- a sanitised real Smartlead **lead-import** sample
- a sanitised real **campaign-results** sample
- available **bounce**, **unsubscribe** and **reply** examples
- a documented, configurable header-alias map derived from them

Without these, both the header map and the idempotency tier in D-3 are guesses. This is recorded as a
blocking gate on the CSV PR, not a nice-to-have. Sanitisation must remove real contact PII; no fixture
may contain a live address or a credential.

### D-6 — Reply bodies come from IMAP, not from CSV

The CSV `replied` event marks *that* a reply happened and drives the Replies Needing Action queue. The
body, the classification and the follow-up task come from the existing IMAP path.

This means connecting two things that already work rather than building new: extend `imapService` to
match WizMatch `contact_channels` in addition to Growth `outreach_leads`, and have it call the already
implemented `POST /api/wizmatch/classify-reply`.

### D-7 — Reply inboxes become a registry, not a hardcoded array

Six Purelymail addresses are hardcoded at `src/services/imapService.ts:30-37`. A single credential
env-var name cannot represent every future provider: IMAP needs host, port, TLS and folder; Microsoft
365 needs an AAD tenant, client id and scopes; Google needs a service account and a delegated subject.

`wizmatch_reply_mailboxes` therefore stores:

- **`provider_config` (jsonb)** — non-secret settings only.
- **`secret_ref` (text)** — an opaque, scheme-prefixed **pointer** resolved at runtime:
  `env:PURELYMAIL_PASS_JATIN_ADSCALELAB`, `railway:IMAP_PASS_1`, `vault:wizmatch/imap/1`.

**No credential value is ever stored in the database.** A write-time validator rejects `provider_config`
keys matching `/pass|secret|token|key|credential/i` and rejects a `secret_ref` without a known scheme.

Paired with a `ReplyInboxProvider` interface (`listMailboxes()`, `fetchUnseen(mailbox)`) whose first and
only implementation is `imap.provider.ts`. Microsoft 365 and Google Workspace become new implementations
with no change to the WizMatch reply model.

### D-8 — WizMatch owns enrolment state; the dead job loop is not used

Outreach enrolment state lives in `wizmatch_outreach_enrolments`, a WizMatch-owned table. This PRD does
**not** use, revive or repair `sequence_enrolments` or the `sequence_step` job loop.

Repairing that loop means reviving or replacing n8n, which is a separate project. It is recorded as a
known-dead path so a future reader does not mistake it for working follow-up.

### D-9 — No automatic sending

The adapter cannot send. `capabilities.sends = false` for every V1 provider, and no milestone in
PRD-005 modifies `WIZMATCH_SENDING_ENABLED` or `AUTOMATED_EMAILS_ENABLED`. Enabling sending remains a
separate go-live decision under `.claude/skills/wizmatch-go-live-sending`.

## Tenant and integrity rules

- `wizmatch_outreach_batches`, `wizmatch_outreach_enrolments`, `wizmatch_outreach_events` and
  `wizmatch_reply_mailboxes` all carry `tenant_id uuid NOT NULL REFERENCES tenants(id)`; indexes lead
  with `tenant_id`.
- Import writes suppression rows and enrolment transitions inside one transaction per event batch.
- Export re-evaluates policy **per row at export time** and omits any DENY, recording each omission
  with its reason code. The export is never a stale snapshot of an earlier decision.
- Export files contain contact PII: generated on demand, streamed, never persisted to disk or object
  storage.
- Uploaded result CSVs are size-capped and parsed with the existing hardened parser
  (`src/routes/outbound.ts:80-107`), never a new one.

## Rollout and rollback

The adapter ships behind `WIZMATCH_OUTREACH_ADAPTER_ENABLED` (default false) and
`OUTREACH_PROVIDER` (default `smartlead_csv`), mirroring `ESIGN_PROVIDER`. The interface and mock land
in one PR with no Smartlead code; the CSV provider lands in the next, gated on D-5 fixtures.

Rollback is a flag flip. The tables are additive and are left in place.

## Required tests

- Swapping in `mock.provider` via `setOutreachProvider()` changes no caller — this is the proof the seam
  works.
- Export shape matches the fixture; a policy-DENY row is omitted and reported.
- Re-importing the same result CSV produces zero new events and zero duplicate suppressions.
- Each idempotency tier is selected correctly and `key_source` is recorded.
- A bounce suppresses the channel and does **not** set `contacts.do_not_contact`; an unsubscribe sets it
  and does **not** block the company.
- A `review`-decision batch without `approved_by` is refused at create and at export.
- `provider_config` containing a secret-like key is rejected; a `secret_ref` without a scheme is
  rejected; no fixture contains a real credential.
- Grep: no Smartlead header literal outside `providers/smartlead-csv.provider.ts`.

## Approval questions

1. **Supply the sanitised Smartlead fixtures** required by D-5. Blocking for the CSV PR. **Open.**
2. Confirm CSV-only for V1, with no API integration. **Approved.**
3. Confirm IMAP remains authoritative for reply bodies. **Approved.**

## Consequences

**Positive.** WizMatch remains the system of record; the provider is replaceable. Adding a real
Smartlead API later, or a different vendor entirely, changes no lifecycle state, no table and no caller.
No new credential, no API key, no recurring cost in this release. The reply path reuses working
classification and bounce parsing instead of duplicating it. The mailbox registry removes a hardcoded
array that would otherwise have to be edited in code for every new inbox.

**Negative.** CSV means a manual operator step in each direction, and status lags reality between
imports. Two provider abstractions now exist in the codebase (e-sign and outreach) with the same shape
but no shared base — deliberate, since a premature generic "provider framework" would couple unrelated
domains. The fixture gate means the CSV PR cannot start on schedule if samples are not supplied.

**Neutral.** `capabilities` makes the CSV adapter's inability to send explicit in the type system rather
than implicit in documentation.

## Alternatives considered

### Integrate the Smartlead API directly

Rejected for V1. It requires credentials, introduces recurring cost, and creates a live dependency
before the lifecycle and policy model have been proven. The seam defined here means the API can be
added later as a second implementation with `capabilities.sends = true`, changing nothing else.

### Extend the existing Saleshandy integration

Rejected. Saleshandy belongs to Growth, a different product and tenant, and its hand-rolled
`https.request` calls are inline in the service with no seam. `docs/wizmatch/DATAFLOW.md:38-39` records
the separation explicitly, and a Saleshandy nav decoy was recently removed from WizMatch to stop the
conflation. Extending it would re-merge two pipelines the team just finished separating.

### Reuse `sequence_enrolments` for outreach enrolment

Rejected. It is the shared CRM sequence concept, its worker hands off to a job type nothing consumes,
and "enrolment" is not WizMatch vocabulary today. Reusing it would inherit a dead loop and overload a
Growth-facing table.

### Build a single generic "external provider" framework covering discovery, e-sign and outreach

Rejected. The three domains share a shape, not a contract. A common base would have to be the union of
their needs and would couple unrelated release cycles. Copying a proven small pattern three times is
cheaper than one abstraction that fits none of them well.

### Derive idempotency purely from a content hash

Rejected. It works without provider identifiers, but two genuinely distinct events with identical
content and timestamp would collide, and a provider that later supplies real IDs could not be adopted
without a migration. Preferring provider IDs and recording `key_source` keeps the fallback observable
and the upgrade path open.
