import { Router, type Request, type Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db, contacts, contactChannels, messages, processedEvents } from '../db/index';
import { verifyWebhookSignature } from '../services/whatsapp/kapsoClient';
import { isOptOutMessage } from '../services/whatsapp/outboundPolicy';
import { sendSlackMessage } from '../services/slackService';
import { getDefaultIngestTenant } from '../services/tenantFeatures';
import { moveMasterSalesContactToStage } from '../services/masterSalesPipelineService';
import { redactPhone } from '../services/phoneService';
import { SLACK_SALES_BD_CHANNEL, CRM_APP_BASE_URL } from '../config/constants';
import logger from '../utils/logger';

/**
 * POST /webhooks/kapso — delivery receipts and inbound replies.
 *
 * Kept separate from /webhooks/meta-wa rather than folded into it. Kapso can
 * forward raw Meta payloads, which would have let the existing handler serve
 * both, but a distinct route means the two transports stay independently
 * switchable: if Kapso is ever dropped for direct Cloud API access, this route
 * is deleted and the Meta one is untouched.
 *
 * The handler acknowledges fast and does the minimum synchronously — signature
 * check, dedupe, and the small state writes that must not be lost. Anything
 * slower belongs in a job.
 */

const router = Router();
let cachedKapsoTenantId: string | null = null;

/**
 * Kapso is currently the Growth Escalators website-lead WhatsApp transport.
 * Resolve the same canonical CRM automation tenant as /api/leads/website and
 * keep every contact/message mutation explicitly tenant-scoped.
 */
async function resolveKapsoTenantId(): Promise<string | null> {
  if (cachedKapsoTenantId) return cachedKapsoTenantId;
  const tenant = await getDefaultIngestTenant('crmAutomation');
  cachedKapsoTenantId = tenant?.id ?? null;
  return cachedKapsoTenantId;
}

/** Replay protection, reusing the table the Meta webhook already uses. */
async function alreadyProcessed(eventId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(processedEvents)
    .where(eq(processedEvents.eventId, eventId))
    .limit(1);
  return rows.length > 0;
}

async function markProcessed(eventId: string): Promise<void> {
  await db.insert(processedEvents).values({ eventId, source: 'kapso' }).onConflictDoNothing();
}

router.post('/kapso', async (req: Request, res: Response): Promise<void> => {
  const signature = req.header('x-webhook-signature');
  if (!verifyWebhookSignature(req.rawBody, signature)) {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }

  const idempotencyKey =
    req.header('x-idempotency-key') ||
    `kapso:${Buffer.from(req.rawBody ?? '').toString('base64').slice(0, 64)}`;
  const eventId = `kapso:${idempotencyKey}`;

  if (await alreadyProcessed(eventId)) {
    res.status(200).json({ status: 'duplicate' });
    return;
  }
  await markProcessed(eventId);

  res.status(200).json({ status: 'ok' });

  void handleEvent(req).catch((e) => {
    logger.error('[kapso-webhook] processing failed', (e as Error).message);
  });
});

type KapsoBody = {
  event?: string;
  /** v1 envelope. v2 puts these same fields at the root instead — see parseKapsoEvent. */
  data?: Record<string, unknown>;
  message?: Record<string, unknown>;
  conversation?: Record<string, unknown>;
  phone_number_id?: string;
  object?: string;
  entry?: Array<{ changes?: Array<{ value?: Record<string, unknown> }> }>;
};

const INBOUND_EVENT = 'whatsapp.message.received';
const STATUS_EVENTS: Record<string, string> = {
  'whatsapp.message.sent': 'sent',
  'whatsapp.message.delivered': 'delivered',
  'whatsapp.message.read': 'read',
  'whatsapp.message.failed': 'failed',
};

export function classifyEvent(data: Record<string, unknown>): { origin: string; direction: string } {
  const kapso = (data.kapso ?? {}) as Record<string, unknown>;
  const message = (data.message ?? {}) as Record<string, unknown>;
  const nested = (message.kapso ?? {}) as Record<string, unknown>;
  return {
    origin: String(kapso.origin ?? nested.origin ?? data.origin ?? 'cloud_api'),
    direction: String(kapso.direction ?? nested.direction ?? data.direction ?? 'inbound'),
  };
}

export function isCustomerReply(eventType: string, origin: string, direction: string): boolean {
  if (origin === 'history_sync') return false;
  if (origin === 'business_app') return false;
  if (direction === 'outbound') return false;
  return eventType === INBOUND_EVENT || eventType === '';
}

async function handleEvent(req: Request): Promise<void> {
  const tenantId = await resolveKapsoTenantId();
  if (!tenantId) {
    logger.error('[kapso-webhook] CRM automation tenant not configured; event ignored safely');
    return;
  }

  const body = (req.body ?? {}) as KapsoBody;
  const eventType = req.header('x-webhook-event') || body.event || '';

  const metaValue = body.entry?.[0]?.changes?.[0]?.value;
  if (metaValue) {
    await handleMetaShaped(metaValue, tenantId);
    return;
  }

  const ev = parseKapsoEvent(body);

  if (ev.origin === 'history_sync') {
    logger.debug('[kapso-webhook] ignoring history_sync backfill event');
    return;
  }

  const mappedStatus = STATUS_EVENTS[eventType];
  if (mappedStatus || (!eventType && ev.status)) {
    await applyStatus(ev.externalId, mappedStatus ?? ev.status, tenantId);
    return;
  }

  const looksLikeMessage = eventType === INBOUND_EVENT || (!eventType && ev.text);
  if (!looksLikeMessage) {
    logger.debug('[kapso-webhook] unhandled event type: ' + (eventType || '(none)'));
    return;
  }

  if (ev.direction === 'outbound' || ev.origin === 'business_app') {
    await recordAgentMessage({ externalId: ev.externalId, to: ev.to, text: ev.text }, tenantId);
    return;
  }

  await handleInbound({
    externalId: ev.externalId,
    from: ev.from,
    text: ev.text,
    conversationId: ev.conversationId,
  }, tenantId);
}

/**
 * Normalise a Kapso webhook body into the fields the handlers need.
 *
 * Kapso `payload_version: v2` delivers the event at the ROOT of the body
 * ({ message, conversation, phone_number_id }); v1 wrapped it in `data`.
 * Reading only `body.data` made every v2 event decode to an empty object, so
 * `from` came out blank and handleInbound's `if (!msg.from) return` dropped the
 * message without a log line — inbound replies and delivery receipts were
 * silently discarded from the day the number moved to v2.
 *
 * Kept pure and exported so both shapes stay covered by unit tests: this is a
 * decoding bug that produces no error and no log, so only a test can catch it.
 */
export function parseKapsoEvent(body: KapsoBody): {
  origin: string;
  direction: string;
  externalId: string;
  text: string;
  from: string;
  to: string;
  conversationId: string | null;
  status: string;
} {
  const data = (body.data ?? body) as Record<string, unknown>;
  const message = (data.message ?? {}) as Record<string, unknown>;
  const conversation = (data.conversation ?? {}) as Record<string, unknown>;
  const kapsoMeta = (message.kapso ?? {}) as Record<string, unknown>;
  const { origin, direction } = classifyEvent(data);

  return {
    origin,
    direction,
    // v2 nests these under `message`; v1 kept them flat on `data`.
    externalId: String(message.id ?? data.message_id ?? data.id ?? ''),
    text: String(
      (message.text as Record<string, string> | undefined)?.body
        ?? kapsoMeta.content
        ?? (data.text as Record<string, string> | undefined)?.body
        ?? data.body
        ?? data.content
        ?? '',
    ),
    from: String(message.from ?? data.from ?? conversation.phone_number ?? data.phone_number ?? ''),
    to: String(message.to ?? data.to ?? conversation.phone_number ?? data.phone_number ?? ''),
    conversationId: conversation.id
      ? String(conversation.id)
      : (data.conversation_id ? String(data.conversation_id) : null),
    status: String(data.status ?? kapsoMeta.status ?? ''),
  };
}

/**
 * Find a contact by WhatsApp number, tolerating how the number was stored.
 *
 * contact_channels holds three shapes in practice: the canonical digits-only
 * `91XXXXXXXXXX`, `+91XXXXXXXXXX` with the plus retained (the large majority),
 * and a few saved with no country code at all — the normaliser reads a leading
 * "91" in a 10-digit mobile as a country code that is already there, so those
 * numbers keep their national form. An exact match against the normalised
 * value therefore missed almost every contact, and a reply from a known lead
 * was logged as "unknown number" and dropped.
 *
 * Matching on the trailing 10 digits covers all three shapes. Two Indian
 * mobiles cannot share a 10-digit subscriber number, and the tenant filter
 * bounds the comparison further, so this cannot mis-attribute a message.
 */
async function findWhatsAppChannel(rawNumber: string, tenantId: string) {
  const digits = rawNumber.replace(/[^0-9]/g, '');
  if (digits.length < 10) return undefined;
  const last10 = digits.slice(-10);

  const [channel] = await db
    .select({ contactId: contactChannels.contactId, tenantId: contactChannels.tenantId })
    .from(contactChannels)
    .where(and(
      eq(contactChannels.tenantId, tenantId),
      eq(contactChannels.channelType, 'whatsapp'),
      sql`right(regexp_replace(${contactChannels.channelValue}, '[^0-9]', '', 'g'), 10) = ${last10}`,
    ))
    .limit(1);

  return channel;
}

async function recordAgentMessage(msg: { externalId: string; to: string; text: string }, tenantId: string): Promise<void> {
  if (!msg.to || !msg.externalId) {
    logger.info('[kapso-webhook] business_app echo missing recipient or id; skipped');
    return;
  }

  const channel = await findWhatsAppChannel(msg.to, tenantId);
  if (!channel) {
    logger.info(`[kapso-webhook] business_app echo to unknown number ${redactPhone(msg.to)}`);
    return;
  }

  await db
    .insert(messages)
    .values({
      tenantId,
      contactId: channel.contactId,
      channel: 'whatsapp',
      direction: 'outbound',
      externalId: msg.externalId,
      content: msg.text || '[non-text message]',
      messageType: 'text',
      status: 'sent',
      metadata: { origin: 'business_app', automated: false },
    })
    .onConflictDoNothing();

  const now = new Date();
  const handoff = JSON.stringify({ waHumanHandoffAt: now.toISOString() });
  await db
    .update(contacts)
    .set({
      lastContactedAt: now,
      updatedAt: now,
      metadata: sql`COALESCE(${contacts.metadata}, '{}'::jsonb) || ${handoff}::jsonb`,
    })
    .where(and(eq(contacts.id, channel.contactId), eq(contacts.tenantId, tenantId)));
}

async function handleMetaShaped(value: Record<string, unknown>, tenantId: string): Promise<void> {
  const statuses = value.statuses as Array<Record<string, string>> | undefined;
  if (statuses?.length) {
    for (const s of statuses) {
      await applyStatus(s.id, s.status, tenantId);
    }
    return;
  }

  const msgs = value.messages as Array<Record<string, unknown>> | undefined;
  if (!msgs?.length) return;

  for (const m of msgs) {
    const text = (m.text as Record<string, string> | undefined)?.body ?? '';
    await handleInbound({
      externalId: String(m.id ?? ''),
      from: String(m.from ?? ''),
      text,
      conversationId: null,
    }, tenantId);
  }
}

const STATUS_RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  replied: 4,
  failed: 5,
};

export function shouldApplyStatus(current: string | null | undefined, incoming: string): boolean {
  if (!incoming) return false;
  if (incoming === 'failed') return true;
  const currentRank = STATUS_RANK[current ?? ''] ?? 0;
  const incomingRank = STATUS_RANK[incoming] ?? 0;
  return incomingRank > currentRank;
}

async function applyStatus(externalId: string, status: string, tenantId: string): Promise<void> {
  if (!externalId || !status) return;

  const [existing] = await db
    .select({ id: messages.id, status: messages.status, contactId: messages.contactId })
    .from(messages)
    .where(and(eq(messages.externalId, externalId), eq(messages.tenantId, tenantId)))
    .limit(1);

  if (!existing) return;
  if (!shouldApplyStatus(existing.status, status)) return;

  await db
    .update(messages)
    .set({ status })
    .where(and(eq(messages.id, existing.id), eq(messages.tenantId, tenantId)));

  const ackStatus = status === 'failed' ? 'failed_permanent' : status;
  await db.execute(sql`
    UPDATE wa_lead_acks SET status = ${ackStatus}, updated_at = NOW()
     WHERE message_id = ${externalId}
  `);
}

async function handleInbound(msg: {
  externalId: string;
  from: string;
  text: string;
  conversationId: string | null;
}, tenantId: string): Promise<void> {
  if (!msg.from) {
    // Never return from here silently: an unparsed payload shape looks
    // identical to "no traffic" from the outside, which is how v2 events went
    // unnoticed for two months while the endpoint answered 200 to every POST.
    logger.warn('[kapso-webhook] inbound event carried no sender number; payload shape unrecognised');
    return;
  }

  const channel = await findWhatsAppChannel(msg.from, tenantId);

  if (!channel) {
    logger.info(`[kapso-webhook] inbound from unknown number ${redactPhone(msg.from)}`);
    return;
  }

  const now = new Date();

  if (msg.externalId) {
    await db
      .insert(messages)
      .values({
        tenantId,
        contactId: channel.contactId,
        channel: 'whatsapp',
        direction: 'inbound',
        externalId: msg.externalId,
        content: msg.text || '[non-text message]',
        messageType: 'text',
        status: 'received',
        metadata: msg.conversationId ? { kapsoConversationId: msg.conversationId } : {},
      })
      .onConflictDoNothing();
  }

  if (isOptOutMessage(msg.text)) {
    await db
      .update(contacts)
      .set({
        doNotContact: true,
        optedInWa: false,
        waOptOutAt: now,
        waOptOutReason: 'inbound STOP-style message',
        updatedAt: now,
        lastActivityAt: now,
      })
      .where(and(eq(contacts.id, channel.contactId), eq(contacts.tenantId, tenantId)));

    await db.execute(sql`
      UPDATE wa_lead_acks SET status = 'opted_out',
             reason = 'customer opted out by reply', updated_at = NOW()
       WHERE event_id IN (
         SELECT id FROM events
          WHERE contact_id = ${channel.contactId}
            AND tenant_id = ${tenantId}
       )
    `);

    logger.info(`[kapso-webhook] opt-out recorded for contact ${channel.contactId}`);
    return;
  }

  const [contact] = await db
    .select({ assignedTo: contacts.assignedTo, firstName: contacts.firstName, status: contacts.status })
    .from(contacts)
    .where(and(eq(contacts.id, channel.contactId), eq(contacts.tenantId, tenantId)))
    .limit(1);

  await db
    .update(contacts)
    .set({
      status: 'whatsapp_replied',
      lastActivityAt: now,
      lastContactedAt: now,
      updatedAt: now,
      metadata: sql`COALESCE(${contacts.metadata}, '{}'::jsonb) || ${JSON.stringify({
        waHumanHandoffAt: now.toISOString(),
        ...(msg.conversationId ? { kapsoConversationId: msg.conversationId } : {}),
      })}::jsonb`,
    })
    .where(and(eq(contacts.id, channel.contactId), eq(contacts.tenantId, tenantId)));

  // A genuine customer reply is concrete progress. Advance only from an earlier
  // stage; moveMasterSalesContactToStage is monotonic and will never regress or
  // reopen a later/closed opportunity.
  void moveMasterSalesContactToStage({
    tenantId,
    contactId: channel.contactId,
    stage: 'contacted',
    createdBy: 'whatsapp_reply',
  }).catch((error) => logger.warn({ error }, '[kapso-webhook] master pipeline reply sync failed'));

  await db.execute(sql`
    UPDATE wa_lead_acks SET status = 'replied', updated_at = NOW()
     WHERE id = (
       SELECT a.id FROM wa_lead_acks a
         JOIN events e ON e.id = a.event_id
        WHERE e.contact_id = ${channel.contactId}
          AND e.tenant_id = ${tenantId}
        ORDER BY a.created_at DESC
        LIMIT 1
     )
  `);

  const owner = contact?.assignedTo ? `<@${contact.assignedTo}>` : 'BD team (unassigned)';
  await sendSlackMessage(
    process.env.SLACK_SALES_BD_CHANNEL || SLACK_SALES_BD_CHANNEL,
    `💬 *WhatsApp reply from ${contact?.firstName ?? 'a lead'}* — ${owner} please take over.\n` +
      `• Reply: ${msg.text.slice(0, 400) || '[non-text message]'}\n` +
      `• CRM: ${CRM_APP_BASE_URL}/contacts/${channel.contactId}`,
  ).catch(() => {});
}

export default router;
