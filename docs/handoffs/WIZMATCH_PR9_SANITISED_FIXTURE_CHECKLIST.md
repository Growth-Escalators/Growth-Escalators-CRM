# PR 9 sanitised Smartlead fixture checklist

**Status: BLOCKING for PR 9.** ADR-007 D-5 is explicit — the CSV format is not guessed. Nothing in
this checklist invents a Smartlead column name, header, or payload field. PR 9 (`ge/outbound-09-smartlead-csv`)
must not start implementation of the real CSV column mapping until every item below is supplied and
ratified by an owner. This is tracked as **U-6** in `docs/handoffs/WIZMATCH_OUTBOUND_OS_STATUS.md` and
in `docs/prd/005-wizmatch-outbound-operating-system.md` §25.2.

## What is required, per ADR-007 D-5

1. A sanitised real Smartlead **lead-import** CSV sample (the file format Smartlead accepts when a
   list of leads is uploaded to a campaign).
2. A sanitised real Smartlead **campaign-results** CSV sample (the file format Smartlead exports for
   campaign activity/status).
3. A sanitised **bounce** result example (however Smartlead represents a bounced lead in its export —
   a distinct row/column value, a separate export, or both).
4. A sanitised **unsubscribe** result example (however Smartlead represents an unsubscribe).
5. A sanitised **reply** result example (however Smartlead represents "this lead replied" — noting
   ADR-007 D-6: the CSV `replied` event only marks *that* a reply happened; the body and classification
   come from IMAP, not from this file).

**Sanitisation requirement, non-negotiable:** every sample must have all real contact PII removed or
replaced with synthetic values before it reaches this repository, and must contain no credential of any
kind (no API key, no session token, no account identifier that could be replayed against the live
Smartlead account). A fixture that fails this bar must not be committed, and must not be exchanged
over Slack/email attachments if it still contains an un-sanitised original — sanitise first, then
attach.

## What PR 9 will build from these fixtures, once supplied

- A configurable header-alias map, isolated inside `providers/smartlead-csv.provider.ts`, in the same
  shape already used by `src/routes/outbound.ts`'s `HEADER_ALIASES` (`Record<canonicalField, string[]>`,
  matched via `normaliseHeader()`). **The canonical keys used by that existing Growth map
  (`first_name, last_name, title, company, company_size, linkedin_url, email, email_status,
  icp_segment, channel, source`) are Growth's own fields, not Smartlead's** — they establish only the
  *shape* of the pattern to copy, not any of the actual column names PR 9 will map.
- Reuse (not duplicate) of the existing exported CSV primitives already in the repo:
  `parseCsv`, `normaliseHeader`, `normaliseEmail`, `validateEmailAddress`, `mapHeaderIndices`
  (`src/routes/outbound.ts:80-213`). PR 9 imports these; it does not re-implement an RFC4180 parser.
- The idempotency-key derivation already built in this PR
  (`src/modules/outreach/outreachIdempotencyKey.ts`, `deriveOutreachIdempotencyKey`) — PR 9 calls this
  for every parsed result row rather than re-deriving the ADR-007 D-3 order itself.
- A grep-enforced rule (ADR-007 D-4): no Smartlead header literal may appear outside
  `providers/smartlead-csv.provider.ts`. `src/__tests__/wizmatchOutreachProvider.test.ts` already
  asserts today's provider files (`outreach-provider.interface.ts`, `mock.provider.ts`, `index.ts`)
  contain none — PR 9 should extend an equivalent grep to cover the new adapter file's siblings once it
  exists, so the isolation rule stays mechanically checked rather than merely stated.

## What already exists and constrains the eventual mapping (facts, not guesses)

- `wizmatch_outreach_batches.provider` defaults to the literal string `'smartlead_csv'`
  (`src/db/schema.ts`, migration `0037_unknown_siren.sql`) — this is the expected `provider` value on
  batch rows once PR 9 lands; it is not itself a CSV column name.
- `wizmatch_outreach_events` already has the exact idempotency shape PR 9 must populate:
  `provider`, `eventType` (constrained to include `sent|bounced|replied|unsubscribed|completed` among
  the enrolment-transition values), `eventAt`, `externalEventId`, `externalMessageId`, `externalLeadRef`,
  `idempotencyKey` (`UNIQUE (tenant_id, provider, idempotency_key)`), `keySource`
  (`provider_event_id|provider_message_id|lead_ref_composite|fallback_hash|internal_transition`), and a
  `raw` jsonb column for the untouched payload.
- No `fixtures/smartlead` (or similarly named) directory exists anywhere in the repo today — PR 9 is
  starting from zero real samples, not extending a partial set.

## Explicit non-guesses

The research pass for this PR was explicitly instructed not to invent Smartlead column names, and did
not: no CSV header, no field name, and no payload shape from Smartlead itself appears anywhere in PR 8's
code or in this checklist. The only Smartlead-shaped string anywhere in `src/` is the provider-identity
default `'smartlead_csv'`, which is a discriminator value, not a schema guess.
