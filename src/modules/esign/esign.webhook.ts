// Documenso webhook handler. Security + integrity posture:
//   1. Verify the HMAC signature over the RAW body (reuses the repo's
//      fail-closed verifyWebhookSignature). No secret ⇒ 503; bad sig ⇒ 401.
//   2. Idempotency: dedupe the delivery via processed_events (checked up front,
//      marked only after successful handling so a failed attempt can retry).
//   3. Never trust the payload for completion — re-fetch authoritative status
//      from the provider (service.syncFromProvider) and download/hash/store the
//      signed PDF there. A storage failure leaves the contract un-completed and
//      the delivery un-marked ⇒ safely retryable.
import { verifyWebhookSignature } from '../../routes/webhooks';
import { HttpError } from '../../utils/errors';
import * as repo from './esign.repository';
import * as service from './esign.service';

function firstScalar(...cands: unknown[]): string {
  for (const c of cands) {
    if (c !== undefined && c !== null && typeof c !== 'object') return String(c);
  }
  return '';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractDocumentId(body: any): string {
  return firstScalar(
    body?.payload?.documentId,
    body?.payload?.externalId,
    body?.payload?.id,
    body?.data?.documentId,
    body?.data?.id,
    body?.documentId,
    body?.document?.id,
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function extractDeliveryId(body: any): string {
  return firstScalar(body?.webhookEventId, body?.eventId, body?.event?.id, body?.deliveryId, body?.id);
}

export interface WebhookResult {
  status: 'ok' | 'already_processed';
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function handleDocumensoWebhook(rawBody: string, signature: string | undefined, body: any): Promise<WebhookResult> {
  const secret = process.env.DOCUMENSO_WEBHOOK_SECRET;
  if (!secret) throw new HttpError(503, 'documenso webhook is not configured', 'INTERNAL_ERROR');
  if (!verifyWebhookSignature(secret, rawBody, signature)) {
    throw new HttpError(401, 'invalid webhook signature', 'UNAUTHORIZED');
  }

  const deliveryId = extractDeliveryId(body);
  const eventKey = deliveryId ? `documenso:${deliveryId}` : '';
  if (eventKey && (await repo.isEventProcessed(eventKey))) {
    return { status: 'already_processed' };
  }

  const documentId = extractDocumentId(body);
  if (!documentId) throw new HttpError(400, 'webhook missing document id', 'VALIDATION_ERROR');
  const contract = await repo.getContractByDocumensoId(documentId);
  if (!contract) throw new HttpError(404, 'unknown document', 'NOT_FOUND');

  await service.syncFromProvider(contract.tenantId, contract.id, deliveryId || undefined);

  if (eventKey) await repo.markEventProcessed(eventKey, 'documenso');
  return { status: 'ok' };
}
