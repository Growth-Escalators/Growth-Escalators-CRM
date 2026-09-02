import { Router, type Request, type Response } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { db, contacts, contactChannels, messages, processedEvents } from '../db/index';
import { verifyWebhookSignature } from '../services/whatsapp/kapsoClient';
import { isOptOutMessage } from '../services/whatsapp/outboundPolicy';
import { normalizeChannelValue } from '../services/contactService';
import { sendSlackMessage } from '../services/slackService';
import { getDefaultIngestTenant } from '../services/tenantFeatures';
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
  // 1. Signature. Verified against the raw body captured in index.ts's
  //    express.json verify hook — re-serialising req.body would change bytes.
  const signature = req.header('x-webhook-signature');
  if (!verifyWebhookSignature(req.rawBody, signature)) {
    res.status(401).json({ error: 'invalid signature' });
    return;
  }

  // 2. Idempotency. Kapso sends its own key; fall back to a body hash.
  const idempotencyKey =
    req.header('x-idempotency-key') ||
    `kapso:${Buffer.from(req.rawBody ?? '').toString('base64').slice(0, 64)}`;
  const eventId = `kapso:${idempotencyKey}`;

  if (await alreadyProcessed(eventId)) {
    res.status(200).json({ status: 'duplicate' });
    return;
  }
  await markProcessed(eventId);

  // 3. Acknowledge immediately. Kapso should never wait on our database work,
  //    and a slow 200 risks redelivery storms.
  res.status(200).json({ status: 'ok' });

  // 4. Process after responding.
  void handleEvent(req).catch((e) => {
    logger.error('[kapso-webhook] processing failed', (e as Error).message);
  });
});

type KapsoBody = {
  event?: string;
  data?: Record<string, unknown>;
  // Raw-Meta-forwarding shape, supported so a webhook misconfiguration
  // degrades to "handled" rather than "silently dropped".
  object?: string;
  entry?: Array<{ changes?: Array<{ value?: Record<string, unknown> }> }>;
};

/**
 * Kapso native event names. Routed by exact name rather than substring: every
 * one of them contains 'message', so a substring test would send delivery
 * receipts into the inbound-reply path.
 */
const INBOUND_EVENT = 'whatsapp.message.received';
const STATUS_EVENTS: Record<string, string> = {
  'whatsapp.message.sent': 'sent',
  'whatsapp.message.delivered': 'delivered',
  'whatsapp.message.read': 'read',
  'whatsapp.message.failed': 'failed',
};

/**
 * Message origin under WhatsApp Business App coexistence.
 *
 *   cloud_api    - sent through Kapso/our API, or a genuine customer message
 *   business_app - echoed from the team's phone app
 *   history_sync - historical backfill replayed when the number is connected
 *
 * history_sync is the dangerous one. Connecting a number with "share chat
 * history" replays old conversations through this webhook. Treating those as
 * live customer replies would fire a Slack ping per old chat and, far worse,
 * opt out every contact who ever typed "stop" in an unrelated context. It is
 * dropped before anything else looks at it.
 */
export function classifyEvent(data: Record<string, unknown>): { origin: string; direction: string } {
  const kapso = (data.kapso ?? {}) as Record<string, unknown>;
  const message = (data.message ?? {}) as Record<string, unknown>;
  const nested = (message.kapso ?? {}) as Record<string, unknown>;
  return {
    origin: String(kapso.origin ?? nested.origin ?? data.origin ?? 'cloud_api'),
    direction: String(kapso.direction ?? nested.direction ?? data.direction ?? 'inbound'),
  };
}

/** Should this event be treated as a genuine customer reply? */
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

  // Meta-shaped payload (raw forwarding mode).
  const metaValue = body.entry?.[0]?.changes?.[0]?.value;
  if (metaValue) {
    await handleMetaShaped(metaValue, tenantId);
    return;
  }

  const data = body.data ?? {};
  const { origin, direction } = classifyEvent(data);

  // Never replay history as if it just happened.
  if (origin === 'history_sync') {
    logger.debug('[kapso-webhook] ignoring history_sync backfill event');
    return;
  }

  // Delivery receipts.
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

  /**
   * Coexistence: a message typed by a salesperson in the WhatsApp Business App
   * is echoed here with origin business_app. It is our own outgoing message,
   * not a customer reply - recording it keeps the CRM conversation complete and
   * lets the frequency gate see that a human is already talking to this lead,
   * but it must never mark the lead as "replied" or trip the STOP handler.
   */
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

/**
 * Store a message the team sent from the WhatsApp Business App so the CRM
 * conversation stays complete. Deliberately does not touch lead status,
 * consent, or notifications.
 */
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

  // A human is now handling this thread - record it so nothing automated
  // re-enters the conversation.
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

/** Handle a payload in Meta's native envelope. */
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

/**
 * Delivery status. Statuses arrive out of order in practice, so we never move a
 * message backwards: once read, a late "delivered" must not overwrite it.
 */
const STATUS_RANK: Record<string, number> = {
  sent: 1,
  delivered: 2,
  read: 3,
  replied: 4,
  failed: 5,
};

/**
 * Should an incoming status replace the stored one? Exported for testing.
 * Statuses can arrive out of order, so we only ever move forward — except
 * 'failed', which always wins because it is terminal.
 */
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

/**
 * Inbound reply: attach to the lead, honour opt-outs, hand off to a human.
 */
async function handleInbound(msg: {
  externalId: string;
  from: string;
  text: string;
  conversationId: string | null;
}, tenantId: string): Promise<void> {
  if (!msg.from) return;

  // Match using the same normalisation the contact was written with, so
  // "+91 98765 43210" on the form matches "919876543210" from WhatsApp.
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
    // Unknown sender. The existing /webhooks/meta-wa handler owns creating
    // contacts for cold inbound; we do not duplicate that here.
    logger.info(`[kapso-webhook] inbound from unknown number ${redactPhone(msg.from)}`);
    return;
  }

  const now = new Date();

  // Store the reply.
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

  // Opt-out takes precedence over everything else.
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

  // A genuine reply — mark the lead and hand off to the assigned human.
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
      // Once a human owns the conversation nothing automated should re-enter it.
      metadata: sql`COALESCE(${contacts.metadata}, '{}'::jsonb) || ${JSON.stringify({
        waHumanHandoffAt: now.toISOString(),
        ...(msg.conversationId ? { kapsoConversationId: msg.conversationId } : {}),
      })}::jsonb`,
    })
    .where(and(eq(contacts.id, channel.contactId), eq(contacts.tenantId, tenantId)));

  // Mark the most recent acknowledgement for this contact as replied. The
  // ack is keyed by its events row, so this resolves through events rather
  // than storing a duplicate contact reference on the ack itself.
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
