/**
 * edgeQueueDrainer
 *
 * Drains the Upstash Redis Stream that Vercel edge functions write to when
 * they receive landing-page traffic (Cashfree webhooks, lead form submits,
 * pre-payment "pending order" pings, Tally beacons).
 *
 * The edge functions stay up even when Railway is down — events accumulate in
 * Upstash and this worker catches up when the API process is healthy again.
 *
 * Idempotency strategy:
 *   1. Cashfree events: edge function does SET NX on cf_payment_id at receive
 *      time, AND processCashfreeEvent() checks the processed_events table
 *      before writing. So even multi-worker drains are safe.
 *   2. Other events: rely on insert-time uniqueness (waitlist email UNIQUE,
 *      contact channel dedup in findOrCreateContact).
 *
 * Failure handling: any handler that throws moves the offending message to a
 * DLQ stream with the error message attached, then ACKs the original so it
 * doesn't block the head of the queue. We do not retry in-place — the edge
 * fn already retried before pushing.
 */

import { eq } from 'drizzle-orm';
import { db, tenants, contacts, pool } from '../db/index';
import { findOrCreateContact } from './contactService';
import { sendSlackMessage } from './slackService';
import {
  processCashfreeEvent,
  recordPendingOrder,
  type CashfreeWebhookBody,
} from './cashfreeEventProcessor';
import { DEFAULT_TENANT_SLUG } from '../config/constants';
import {
  getUpstashClient,
  QUEUE_STREAM,
  QUEUE_DLQ,
  QUEUE_GROUP,
  QUEUE_CONSUMER,
} from './upstashClient';
import logger from '../utils/logger';

// Upstash returns XREADGROUP results as nested arrays:
//   [ [streamKey, [ [entryId, [field1, value1, field2, value2, ...]] ] ] ]
type StreamReply = Array<[string, Array<[string, string[]]>]>;

const POLL_INTERVAL_MS = Number(process.env.EDGE_DRAINER_POLL_MS || 3000);

interface QueueEvent {
  type:
    | 'cashfree_event'
    | 'lead'
    | 'pending_order'
    | 'tally_beacon'
    | 'waitlist'
    | 'agency_lead';
  payload: Record<string, unknown>;
  meta?: Record<string, unknown>;
}

let _running = false;
let _shouldStop = false;

export function stopEdgeQueueDrainer(): void {
  _shouldStop = true;
}

export async function startEdgeQueueDrainer(): Promise<void> {
  if (_running) return;
  if (process.env.EDGE_DRAINER_ENABLED === 'false') {
    logger.info('[edge-drainer] disabled via EDGE_DRAINER_ENABLED=false');
    return;
  }
  const redis = getUpstashClient();
  if (!redis) {
    logger.warn('[edge-drainer] UPSTASH_REDIS_REST_URL/TOKEN not set — drainer disabled');
    return;
  }
  _running = true;

  // Ensure the consumer group exists. XGROUP CREATE fails if the group already
  // exists; we swallow that specific error.
  try {
    // MKSTREAM creates the stream if missing. Start at $ (only new entries) so
    // boot-time replays don't reprocess everything since the dawn of time.
    await redis.xgroup(QUEUE_STREAM, { type: 'CREATE', group: QUEUE_GROUP, id: '$', options: { MKSTREAM: true } });
    logger.info(`[edge-drainer] consumer group ${QUEUE_GROUP} created on ${QUEUE_STREAM}`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (!/BUSYGROUP/i.test(msg)) {
      logger.error('[edge-drainer] xgroup create failed:', msg);
    }
  }

  logger.info(`[edge-drainer] started (stream=${QUEUE_STREAM} group=${QUEUE_GROUP} consumer=${QUEUE_CONSUMER})`);

  // Drain loop — runs until process exits.
  void (async function loop() {
    while (!_shouldStop) {
      try {
        // Upstash REST API does not support BLOCK on XREADGROUP, so we
        // short-poll. EDGE_DRAINER_POLL_MS controls the gap between empty reads.
        const reply = (await redis.xreadgroup(
          QUEUE_GROUP,
          QUEUE_CONSUMER,
          QUEUE_STREAM,
          '>',
          { count: 25 },
        )) as StreamReply | null;

        if (!reply || reply.length === 0) {
          await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
          continue;
        }

        for (const [, entries] of reply) {
          for (const [id, fieldsFlat] of entries) {
            await handleEntry(id, fieldsFlat);
          }
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        logger.error('[edge-drainer] loop error:', msg);
        // Back off briefly so we don't hammer Upstash if it's down
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
    logger.info('[edge-drainer] stopped');
    _running = false;
  })();
}

async function handleEntry(id: string, fieldsFlat: string[]): Promise<void> {
  const redis = getUpstashClient();
  if (!redis) return;

  // Upstash returns fields as a flat [k1, v1, k2, v2] array. We only ever
  // write a single field "data" containing the full JSON event.
  const fields: Record<string, string> = {};
  for (let i = 0; i < fieldsFlat.length; i += 2) {
    fields[fieldsFlat[i]] = fieldsFlat[i + 1];
  }
  const raw = fields.data ?? fieldsFlat[1] ?? '';

  let event: QueueEvent;
  try {
    event = JSON.parse(raw) as QueueEvent;
  } catch {
    logger.error(`[edge-drainer] ${id} malformed JSON, sending to DLQ`);
    await redis.xadd(QUEUE_DLQ, '*', { reason: 'malformed_json', raw });
    await redis.xack(QUEUE_STREAM, QUEUE_GROUP, id);
    return;
  }

  try {
    await dispatch(event);
    await redis.xack(QUEUE_STREAM, QUEUE_GROUP, id);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logger.error(`[edge-drainer] ${id} handler failed (${event.type}):`, msg);
    await redis.xadd(QUEUE_DLQ, '*', {
      reason: msg,
      type: event.type,
      payload: JSON.stringify(event.payload),
      ts: new Date().toISOString(),
    });
    // ACK so the head doesn't block — the DLQ holds the original for replay.
    await redis.xack(QUEUE_STREAM, QUEUE_GROUP, id);
  }
}

async function dispatch(event: QueueEvent): Promise<void> {
  switch (event.type) {
    case 'cashfree_event':
      await processCashfreeEvent(event.payload as CashfreeWebhookBody, {
        ipAddress: (event.meta?.ipAddress as string | undefined) || undefined,
        userAgent: (event.meta?.userAgent as string | undefined) || undefined,
      });
      return;

    case 'pending_order':
      await recordPendingOrder(event.payload as Parameters<typeof recordPendingOrder>[0]);
      return;

    case 'waitlist': {
      const p = event.payload as { name?: string; email?: string; source?: string };
      if (!p.name || !p.email) return;
      await pool.query(
        `INSERT INTO funnel_waitlist (name, email, source)
         VALUES ($1, $2, $3)
         ON CONFLICT (email) DO NOTHING`,
        [p.name.trim(), p.email.trim().toLowerCase(), p.source || 'unknown'],
      );
      return;
    }

    case 'agency_lead':
    case 'lead': {
      const p = event.payload as {
        name?: string; email?: string; phone?: string;
        agencyName?: string; adSpend?: string; source?: string;
        tags?: string[]; metadata?: Record<string, unknown>;
      };
      if (!p.name || !p.email) return;
      const [tenant] = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, DEFAULT_TENANT_SLUG)).limit(1);
      if (!tenant) return;

      const cleanPhone = (p.phone || '').replace(/\D/g, '');
      const channels: { channelType: 'email' | 'whatsapp'; channelValue: string; isPrimary?: boolean }[] = [];
      channels.push({ channelType: 'email', channelValue: p.email.trim().toLowerCase(), isPrimary: true });
      if (cleanPhone) channels.push({ channelType: 'whatsapp', channelValue: cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}` });

      const parts = p.name.trim().split(/\s+/);
      const { contact, created } = await findOrCreateContact(tenant.id, {
        firstName: parts[0] ?? p.name,
        lastName: parts.slice(1).join(' ') || undefined,
        source: p.source || 'edge_queue',
        sourceDetail: p.agencyName ? `agency:${p.agencyName}` : undefined,
        channels,
        metadata: { ...(p.metadata || {}), agencyName: p.agencyName, adSpend: p.adSpend },
      });

      // Always bump lastActivityAt so the contact bubbles to the top of the
      // CRM list on any new lead activity (even a repeat waitlist signup with
      // no new tags). Tag merging is conditional — but the activity stamp is not.
      const baseTags = event.type === 'agency_lead' ? ['agency_lead', 'whitelabel_inquiry'] : [];
      const userTags = Array.isArray(p.tags) ? p.tags : [];
      const merged = [...new Set([...baseTags, ...userTags])];
      const now = new Date();
      const existing = await db.select().from(contacts).where(eq(contacts.id, contact.id)).limit(1);
      const existingTags = (existing[0]?.tags ?? []) as string[];
      await db.update(contacts).set({
        tags: merged.length > 0 ? [...new Set([...existingTags, ...merged])] : existingTags,
        status: 'lead',
        updatedAt: now,
        lastActivityAt: now,
      }).where(eq(contacts.id, contact.id));

      if (event.type === 'agency_lead') {
        sendSlackMessage(process.env.SLACK_SOD_EOD_CHANNEL || 'C08EMRX2HHN',
          `🤝 *New Agency Lead* (via edge)\n• Name: ${p.name}\n• Agency: ${p.agencyName || 'N/A'}\n• Email: ${p.email}\n• Phone: ${p.phone || 'N/A'}\n• Ad-spend: ${p.adSpend || 'N/A'}\n• Status: ${created ? 'NEW' : 'EXISTING'}`,
        ).catch(() => {});
      }
      return;
    }

    case 'tally_beacon': {
      // Page-view beacon — no DB write, just an audit log so we can still
      // count landings while Railway was offline.
      logger.info({ payload: event.payload }, '[edge-drainer] tally beacon');
      return;
    }

    default:
      logger.warn(`[edge-drainer] unknown event type: ${(event as { type: string }).type}`);
  }
}
