import { Redis } from '@upstash/redis';

const QUEUE_STREAM = process.env.EDGE_QUEUE_STREAM || 'crm:events';
const QUEUE_DLQ = process.env.EDGE_QUEUE_DLQ || 'crm:events:dlq';

let _redis: Redis | null = null;
function client(): Redis {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) {
    throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required');
  }
  _redis = new Redis({ url, token });
  return _redis;
}

export type QueueEventType =
  | 'cashfree_event'
  | 'pending_order'
  | 'waitlist'
  | 'agency_lead'
  | 'lead'
  | 'tally_beacon';

export async function enqueue(type: QueueEventType, payload: unknown, meta?: unknown): Promise<string> {
  const redis = client();
  return await redis.xadd(QUEUE_STREAM, '*', {
    data: JSON.stringify({ type, payload, meta }),
  });
}

export async function deadLetter(reason: string, raw: unknown): Promise<void> {
  try {
    const redis = client();
    await redis.xadd(QUEUE_DLQ, '*', {
      reason,
      raw: typeof raw === 'string' ? raw : JSON.stringify(raw),
      ts: new Date().toISOString(),
    });
  } catch {
    // Best-effort — if even the DLQ write fails, there's nothing else to do.
  }
}

/**
 * Idempotency lock for Cashfree webhook delivery.
 * Returns true if this is a *new* event (first time we've seen it).
 * Returns false if we've already processed it — the caller should ack 200
 * and skip downstream work.
 */
export async function tryClaimWebhook(eventKey: string, ttlSeconds = 60 * 60 * 24 * 30): Promise<boolean> {
  const redis = client();
  const result = await redis.set(`cashfree:processed:${eventKey}`, '1', {
    nx: true,
    ex: ttlSeconds,
  });
  return result === 'OK';
}
