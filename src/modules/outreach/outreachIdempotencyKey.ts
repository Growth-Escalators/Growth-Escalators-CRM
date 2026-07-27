// ADR-007 D-3 — deterministic idempotency-key derivation for a provider result
// event. Provider-neutral: no provider implementation calls this directly for
// PR 8 (there is nothing yet to import it), but PR 9/10 reuse it verbatim so
// every provider derives keys the same way `wizmatch_outreach_events` expects
// (`UNIQUE (tenant_id, provider, idempotency_key)`, `key_source` CHECK values).
import { createHash } from 'node:crypto';

import type { OutreachEventType } from './providers/outreach-provider.interface';

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
  if (input.externalEventId) {
    return { key: input.externalEventId, keySource: 'provider_event_id' };
  }
  if (input.externalMessageId) {
    return { key: input.externalMessageId, keySource: 'provider_message_id' };
  }
  if (input.externalLeadRef) {
    return {
      key: `${input.externalLeadRef}:${input.eventType}:${input.eventAt.toISOString()}`,
      keySource: 'lead_ref_composite',
    };
  }
  const normalisedEmail = input.email.trim().toLowerCase();
  const hash = createHash('sha256')
    .update(`${input.batchRef}|${normalisedEmail}|${input.eventType}|${input.eventAt.toISOString()}`)
    .digest('hex');
  return { key: hash, keySource: 'fallback_hash' };
}
