import { Redis } from '@upstash/redis';

let _redis: Redis | null = null;

/**
 * Lazy-initialised Upstash Redis client. Returns null when env vars are
 * missing — callers (drainer, status checks) should treat null as "the queue
 * isn't configured yet" and skip rather than crash.
 */
export function getUpstashClient(): Redis | null {
  if (_redis) return _redis;
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  _redis = new Redis({ url, token });
  return _redis;
}

export const QUEUE_STREAM = process.env.EDGE_QUEUE_STREAM || 'crm:events';
export const QUEUE_DLQ = process.env.EDGE_QUEUE_DLQ || 'crm:events:dlq';
export const QUEUE_GROUP = process.env.EDGE_QUEUE_GROUP || 'railway-drainer';
export const QUEUE_CONSUMER = process.env.EDGE_QUEUE_CONSUMER || `worker-${process.pid}`;
