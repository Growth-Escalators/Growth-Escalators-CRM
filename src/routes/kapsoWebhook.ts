import { Router, type Request, type Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db, contacts, contactChannels, messages, processedEvents } from '../db/index';
import { verifyWebhookSignature } from '../services/whatsapp/kapsoClient';
import { isOptOutMessage } from '../services/whatsapp/outboundPolicy';
import { normalizeChannelValue } from '../services/contactService';
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
  data?: Record<string, unknown>;
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

  const data = body.data ?? {};
  const { origin, direction } = classifyEvent(data);

  if (origin === 'history_sync') {
    logger.debug('[kapso-webhook] ignoring history_sync backfill event');
    return;
  }

  const mappedStatus = STATUS_EVENTS[eventType];
  if (mappedStatus || (!eventType && data.status)) {
    await applyStatus(
      String(data.message_id ?? data.id ?? ''),
      mappedStatus ?? String(data.status ?? ''),
      tenantId,
    );
    return;
  }

  const looksLikeMessage = eventType === INBOUND_EVENT || (!eventType && (data.text || data.body));
  if (!looksLikeMessage) {
    logger.debug('[kapso-webhook] unhandled event type: ' + (eventType || '(none)'));
    return;
  }

  const text = String(
    (data.text as Record<string, string> | undefined)?.body ?? data.body ?? data.content ?? '',
  );

  if (direction === 'outbound' || origin === 'business_app') {
    await recordAgentMessage({
      externalId: String(data.id ?? data.message_id ?? ''),
      to: String(data.to ?? data.phone_number ?? ''),
      text,
    }, tenantId);
    return;
  }

  await handleInbound({
    externalId: String(data.id ?? data.message_id ?? ''),
    from: String(data.from ?? data.phone_number ?? ''),
    text,
    conversationId: data.conversation_id ? String(data.conversation_id) : null,
  }, tenantId);
}

async function recordAgentMessage(msg: { externalId: string; to: string; text: string }, tenantId: string): Promise<void> {
  if (!msg.to || !msg.externalId) return;
  const normalized = normalizeChannelValue('whatsapp', msg.to);

  const [channel] = await db
    .select({ contactId: contactChannels.contactId, tenantId: contactChannels.tenantId })
    .from(contactChannels)
    .where(and(
      eq(contactChannels.tenantId, tenantId),
      eq(contactChannels.channelType, 'whatsapp'),
      eq(contactChannels.channelValue, normalized),
    ))
    .limit(1);
  if (!channel) return;

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
  if (!msg.from) return;

  const normalized = normalizeChannelValue('whatsapp', msg.from);

  const [channel] = await db
    .select({ contactId: contactChannels.contactId, tenantId: contactChannels.tenantId })
    .from(contactChannels)
    .where(and(
      eq(contactChannels.tenantId, tenantId),
      eq(contactChannels.channelType, 'whatsapp'),
      eq(contactChannels.channelValue, normalized),
    ))
    .limit(1);

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
