// ADR-007 D-3 — deterministic idempotency-key derivation for a provider result
// event. Provider-neutral: no provider implementation calls this directly for
// PR 8 (there is nothing yet to import it), but PR 9/10 reuse it verbatim so
// every provider derives keys the same way `wizmatch_outreach_events` expects
// (`UNIQUE (tenant_id, provider, idempotency_key)`, `key_source` CHECK values).
import { createHash } from 'node:crypto';

import { OutreachProviderError, type OutreachEventType } from './providers/outreach-provider.interface';

export type OutreachEventKeySource =
  | 'provider_event_id'
  | 'provider_message_id'
  | 'lead_ref_composite'
  | 'fallback_hash';

export interface OutreachIdempotencyInput {
  email: string;
  eventType: OutreachEventType;
  eventAt: Date;
  batchRef: string;
  externalEventId?: string;
  externalMessageId?: string;
  externalLeadRef?: string;
}

export interface OutreachIdempotencyResult {
  key: string;
  keySource: OutreachEventKeySource;
}

/**
 * First-non-null order per ADR-007 D-3: external_event_id > external_message_id
 * > external_lead_ref:event_type:event_at > sha256(batch_ref|email|event_type|event_at).
 * The hash tier is a last resort, used only when the provider supplies no
 * identifier at all — a corpus dominated by it is a signal the export
 * configuration is wrong, which is why `keySource` is always returned alongside
 * the key rather than discarded.
 */
export function deriveOutreachIdempotencyKey(input: OutreachIdempotencyInput): OutreachIdempotencyResult {
  // Provider identifiers arrive from a CSV/API parser, so stray surrounding
  // whitespace is the norm rather than the exception. Trimming every tier (not
  // just the email in tier 4) is load-bearing: without it 'evt_1' and ' evt_1'
  // derive two different keys for one logical event, and the
  // UNIQUE (tenant_id, provider, idempotency_key) constraint that is supposed to
  // make a re-import a no-op (ADR-007 D-3) admits a duplicate row instead.
  // A whitespace-only identifier is treated as absent and falls through.
  const eventId = input.externalEventId?.trim();
  const messageId = input.externalMessageId?.trim();
  const leadRef = input.externalLeadRef?.trim();

  // Serialised into every tier-3/tier-4 key, so an unusable Date must fail as a
  // structured, catchable error rather than a bare RangeError from toISOString().
  const eventAtIso = toIsoOrThrow(input.eventAt);

  if (eventId) {
    return { key: eventId, keySource: 'provider_event_id' };
  }
  if (messageId) {
    return { key: messageId, keySource: 'provider_message_id' };
  }
  if (leadRef) {
    return {
      key: `${leadRef}:${input.eventType}:${eventAtIso}`,
      keySource: 'lead_ref_composite',
    };
  }
  const normalisedEmail = input.email.trim().toLowerCase();
  const hash = createHash('sha256')
    .update(`${input.batchRef}|${normalisedEmail}|${input.eventType}|${eventAtIso}`)
    .digest('hex');
  return { key: hash, keySource: 'fallback_hash' };
}

function toIsoOrThrow(eventAt: Date): string {
  if (!(eventAt instanceof Date) || Number.isNaN(eventAt.getTime())) {
    throw new OutreachProviderError(
      'invalid_input',
      'outreach',
      'eventAt must be a valid Date to derive an idempotency key',
    );
  }
  return eventAt.toISOString();
}
