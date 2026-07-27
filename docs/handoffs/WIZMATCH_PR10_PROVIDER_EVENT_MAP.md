# PR 10 provider-neutral reply-ingestion field map

Documentation only — PR 8 does not implement IMAP, mailbox polling, reply classification, or
conversation locks. This maps the provider-neutral fields PR 10 (`ge/outbound-10-reply-ingestion`) will
need, grounded in what already exists in the repo today. Nothing below is invented; every field either
already exists in a table/route/service or is named in ADR-007 D-6/D-7.

## 1. Tenant-safe mailbox/provider identity

`wizmatch_reply_mailboxes` (`src/db/schema.ts`) already exists from PR 2, with:

- `id`, `tenantId` (fk `tenants.id`)
- `provider` — CHECK `IN ('imap', 'ms365', 'google')`
- `address`, `domain` (nullable)
- `providerConfig` (jsonb) — **non-secret settings only**; a write-time validator rejects keys matching
  `/pass|secret|token|key|credential/i` (ADR-007 D-7)
- `secretRef` (text) — an opaque, scheme-prefixed pointer resolved at runtime
  (`env:...`, `railway:...`, `vault:...`) — **never a credential value**
- `active`, `lastPolledAt`, `createdAt`
- unique on `(tenantId, address)`

**Not yet built, confirmed by grep:** no `ReplyInboxProvider` interface, no `listMailboxes()`, no
`fetchUnseen()`, and no `imap.provider.ts` file exist anywhere in `src/`. PR 10 builds the
`ReplyInboxProvider` interface fresh per ADR-007 D-7, using this table as its only grounded schema.

## 2. Provider message/lead/campaign IDs

Already defined by this PR's provider-neutral event shape
(`src/modules/outreach/providers/outreach-provider.interface.ts`):
`externalEventId`, `externalMessageId`, `externalLeadRef` on `OutreachResultEvent`, and
`externalCampaignRef` on `OutreachBatchMeta`. PR 10's reply-ingestion event should carry the same three
identifier fields so a reply can be correlated back to the batch/enrolment it belongs to, using the same
idempotency-key derivation this PR ships (`deriveOutreachIdempotencyKey`,
`src/modules/outreach/outreachIdempotencyKey.ts`) rather than a second, divergent scheme.

## 3. Normalised sender/recipient

Today's IMAP extraction (`src/services/imapService.ts`, scoped to the legacy `outreach_leads` tenant)
produces, per message: `envelope.from[0].address` → `fromAddr`, `envelope.from[0].name` → `fromName`.
There is no explicit "recipient" field captured (the six inboxes are hardcoded per-tenant, so the
recipient is implicit in which inbox received the message). PR 10 should decide explicitly whether the
recipient is derived from the polled mailbox's own `address` column on `wizmatch_reply_mailboxes`
(recommended, since that row already carries tenant + mailbox identity) or captured from the envelope —
this repo has no existing precedent either way for the WizMatch reply path specifically.

## 4. Occurred-at timestamp

**Gap, stated not invented:** `imapService.ts`'s `RawEmail`/`ProspectReply` shapes capture no
`date`/`received-at` field at all today — confirmed absent by direct read of the file. PR 10 will need
to add this (the IMAP envelope's own date, or the fetch time as a fallback) since
`OutreachResultEvent.eventAt` and `wizmatch_outreach_events.eventAt` are both `NOT NULL` and load-bearing
for idempotency-key tier 3 (`lead_ref_composite`, which embeds `eventAt`).

## 5. Event type

This PR's `OutreachEventType` (`'sent' | 'bounced' | 'replied' | 'unsubscribed' | 'completed'`) is the
provider vocabulary. For reply ingestion specifically, `'replied'` is the only value that originates
from IMAP rather than a provider CSV/API. Per ADR-007 D-6: **a CSV `replied` event only marks that a
reply happened; IMAP is the authoritative source for the body, the classification, and the follow-up
task.** PR 10 does not need to invent new event-type values — it maps IMAP-observed replies onto the
same `'replied'` value already defined here.

## 6. Raw payload reference/hash

`wizmatch_outreach_events.raw` (jsonb, nullable) already exists as the audit-payload column for a
parsed provider event. `wizmatch_suppression_events` carries no equivalent `raw` column, only
`evidenceKind`/`evidenceText`/`evidenceUrl`/`evidenceRef` — worth flagging to PR 10 as an open question:
whether a reply's raw payload (headers + truncated body per the existing 1500-char cap in
`imapService.ts`) is stored on `wizmatch_outreach_events.raw`, on a suppression event's evidence fields,
or on a new column — not decided here, since inventing a new column is a schema change out of PR 8's
scope.

## 7. Idempotency key

`imapService.ts` already has its own dedupe mechanism for the Growth tenant: an `outreach_processed_replies`
table unique on `email_message_id` (`imapService.ts:52-62`). For WizMatch, PR 10 should prefer the
provider-neutral `deriveOutreachIdempotencyKey()` this PR ships, using the IMAP message-id as
`externalMessageId` (tier 2, `provider_message_id`) rather than building a second, WizMatch-specific
dedupe table — `wizmatch_outreach_events`'s existing `UNIQUE (tenant_id, provider, idempotency_key)`
already gives WizMatch the same guarantee `outreach_processed_replies` gives Growth.

## 8. Company/contact linkage inputs

Already built (PR 3): `resolveWizmatchLinkage(tenantId, contactId)` /
`resolveWizmatchLinkageByEmail(tenantId, email)` in `src/modules/outreach/wizmatchLinkage.ts` — the
canonical way any shared-CRM path (including a future reply-ingestion path) decides "is this contact
WizMatch's" and which company it belongs to. PR 10 should call this rather than re-deriving a linkage
check, per the same rule §8.10.2 already enforces on every other caller.

## 9. Classification status

`POST /api/wizmatch/classify-reply` (`src/routes/wizmatch.ts`, ~3848-3945) is fully implemented today
but has no caller. Its categories: `INTERESTED | NOT_NOW | NOT_INTERESTED | UNSUBSCRIBE | UNCATEGORIZED`.
Its current input contract is `{ signal_id, reply_text, contact_email }` — no message-id, timestamp, or
raw-payload field flows in today. PR 10's job (ADR-007 D-6) is to extend `imapService` to also match
WizMatch `contact_channels` (in addition to Growth's `outreach_leads`) and call this already-implemented
route — not to rebuild classification.

## 10. Conversation-lock inputs

Governed entirely by the existing enrolment-state machine (`src/config/wizmatchOutreachStates.ts`,
15 states / 8 live / 7 terminal) and ADR-006 D-16: **a reply does not release the company cold-email
lock.** PR 10 supplies the trigger (a classified reply) but must not itself write a lock-releasing
terminal state (`closed`, `disqualified`, `company_blocked`, `manually_released`) — those remain human
decisions, per ADR-007 D-1's provider-event-to-enrolment-transition table, which already assigns
`'replied' → enrolment state 'replied' → lock holds`.

## Explicit non-guesses

Did not invent: a timestamp field for `ProspectReply` (confirmed absent, not assumed), the contents of
`wizmatch_reply_mailboxes.providerConfig` beyond "non-secret settings" (no shape defined anywhere), or a
`ReplyInboxProvider` method signature beyond the two names ADR-007 D-7 already gives
(`listMailboxes()`, `fetchUnseen(mailbox)`) — their parameter/return shapes are PR 10's decision to make
against real IMAP/MS365/Google client libraries, not this PR's.
