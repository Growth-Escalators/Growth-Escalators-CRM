import logger from '../utils/logger';
import crypto from 'crypto';
import { Router } from 'express';
import { eq, count, desc, sql } from 'drizzle-orm';
import { db, processedEvents, jobs, messages, contacts, contactChannels } from '../db/index';
import { insertJob } from '../services/jobQueue';
import { validateMetaWebhook } from '../middleware/validateWebhook';
import { processBooking } from '../services/bookingService';
import { emitNewMessage, emitStatusUpdate } from './inbox';
import {
  extractFacebookLeadgenChanges,
  processFacebookLeadgenChange,
  verifyMetaLeadSignature,
} from '../services/facebookLeadForms';

// Webhook signature verification helper. Fails CLOSED when the secret is
// unset — a missing secret previously meant every request was accepted
// unverified, letting anyone who discovers a webhook URL inject fabricated
// bookings/form-submits/conversation events. Exported for direct unit testing.
export function verifyWebhookSignature(secret: string | undefined, rawBody: string, signature: string | undefined, algorithm = 'sha256'): boolean {
  if (!secret) { logger.error('[webhook] signature secret not configured — rejecting request'); return false; }
  if (!signature) return false;
  const expected = crypto.createHmac(algorithm, secret).update(rawBody).digest('hex');
  const sigValue = signature.startsWith('sha256=') ? signature.slice(7) : signature;
  try { return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sigValue)); } catch { return false; }
}

const router = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function isAlreadyProcessed(eventId: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(processedEvents)
    .where(eq(processedEvents.eventId, eventId))
    .limit(1);
  return rows.length > 0;
}

async function markProcessed(eventId: string, source: string): Promise<void> {
  await db.insert(processedEvents).values({ eventId, source }).onConflictDoNothing();
}

// ---------------------------------------------------------------------------
// GET /webhooks/meta-leads — Meta Lead Ads webhook verification challenge
// ---------------------------------------------------------------------------
router.get('/meta-leads', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    res.status(200).send(String(challenge));
  } else {
    res.status(403).json({ error: 'verification failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /webhooks/meta-leads — Facebook Lead Ads leadgen events
// ---------------------------------------------------------------------------
router.post('/meta-leads', async (req, res) => {
  const rawBody = req.rawBody || JSON.stringify(req.body ?? {});
  const signature = req.headers['x-hub-signature-256'] as string | undefined;
  if (!verifyMetaLeadSignature(rawBody, signature, process.env.META_APP_SECRET)) {
    res.status(403).json({ error: 'invalid signature' });
    return;
  }

  const changes = extractFacebookLeadgenChanges(req.body);
  if (changes.length === 0) {
    res.status(200).json({ status: 'ignored', reason: 'no_leadgen_changes' });
    return;
  }

  const results: Array<Record<string, unknown>> = [];
  let processed = 0;
  let duplicate = 0;
  let failed = 0;

  for (const change of changes) {
    const eventId = `facebook_leadgen:${change.leadgenId}`;
    if (await isAlreadyProcessed(eventId)) {
      duplicate++;
      results.push({ leadgenId: change.leadgenId, status: 'duplicate' });
      continue;
    }

    try {
      const result = await processFacebookLeadgenChange(change);
      await markProcessed(eventId, 'facebook_leadgen');
      processed++;
      results.push({ ...result, status: 'processed' });
    } catch (error) {
      failed++;
      const message = error instanceof Error ? error.message : String(error);
      logger.error({ error: message, change }, '[facebook-leads webhook] failed');
      try {
        await insertJob(
          null,
          'facebook_lead_failed',
          { change, error: message, payload: req.body },
          `facebook_lead_failed:${change.leadgenId}:${Date.now()}`,
        );
      } catch (jobError) {
        logger.error({ error: jobError }, '[facebook-leads webhook] failed to enqueue failure audit job');
      }
      results.push({ leadgenId: change.leadgenId, status: 'failed', error: message });
    }
  }

  res.status(200).json({ status: 'ok', processed, duplicate, failed, results });
});

// ---------------------------------------------------------------------------
// GET /webhooks/meta-wa — Meta webhook verification challenge
// Meta sends: hub.mode=subscribe, hub.verify_token, hub.challenge
// ---------------------------------------------------------------------------
router.get('/meta-wa', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    res.status(200).send(String(challenge));
  } else {
    res.status(403).json({ error: 'verification failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /webhooks/meta-wa — Inbound WhatsApp messages
// ---------------------------------------------------------------------------
router.post('/meta-wa', validateMetaWebhook, async (req, res) => {
  // Gate on object type — Meta sends other notification types too
  if (req.body.object !== 'whatsapp_business_account') {
    res.status(200).json({ status: 'ignored' });
    return;
  }

  const value = req.body.entry?.[0]?.changes?.[0]?.value;

  // Status updates (delivered, read, failed) — process and return
  if (value?.statuses && !value?.messages) {
    for (const statusUpdate of value.statuses as Array<Record<string,string>>) {
      try {
        const waId = statusUpdate.id;
        const newStatus = statusUpdate.status;
        if (!waId || !newStatus) continue;
        const result = await db.execute(sql`
          UPDATE messages SET status = ${newStatus}
          WHERE external_id = ${waId}
          RETURNING contact_id
        `);
        const contactId = (result.rows[0] as Record<string,string> | undefined)?.contact_id;
        if (contactId) emitStatusUpdate(String(contactId), waId, newStatus);
      } catch { /* non-critical */ }
    }
    res.status(200).json({ status: 'ok', reason: 'status_update' });
    return;
  }

  if (!value?.messages || value.messages.length === 0) {
    res.status(200).json({ status: 'ignored', reason: 'no_messages' });
    return;
  }

  // Process each message independently — idempotency per message id
  let queued = 0;
  for (const message of value.messages) {
    const eventId = `meta_wa:${message.id}`;
    if (await isAlreadyProcessed(eventId)) continue;
    await markProcessed(eventId, 'meta_wa');
    await insertJob(null, 'inbound_wa', req.body, eventId);
    queued++;

    // Also save directly to messages table for inbox real-time display
    try {
      const phone = message.from as string;
      // Find tenant (look up via WABA or default to first tenant)
      const tenantResult = await db.execute(sql`SELECT id FROM tenants LIMIT 1`);
      const tenantId = (tenantResult.rows[0] as { id: string } | undefined)?.id;
      if (!tenantId) continue;

      // Find contact by WhatsApp channel
      const channelRows = await db.select().from(contactChannels)
        .where(eq(contactChannels.channelValue, phone))
        .limit(1);
      let contactId: string | null = channelRows[0]?.contactId || null;

      // Create contact if not found
      if (!contactId) {
        const [newContact] = await db.insert(contacts).values({
          tenantId,
          firstName: phone,
          source: 'whatsapp_inbound',
          status: 'lead',
        }).returning();
        contactId = newContact.id;
        await db.insert(contactChannels).values({
          tenantId,
          contactId,
          channelType: 'whatsapp',
          channelValue: phone,
        });
      }

      const msgType = (message.type as string) || 'text';
      let content = '';
      let mediaUrl: string | null = null;

      if (msgType === 'text') {
        content = (message.text as Record<string,string>)?.body || '';
      } else if (['image','document','audio','video'].includes(msgType)) {
        const mediaObj = (message[msgType as keyof typeof message] as Record<string,string>) || {};
        content = mediaObj.caption || `[${msgType}]`;
        mediaUrl = mediaObj.id ? `media:${mediaObj.id}` : null;
      } else {
        content = `[${msgType}]`;
      }

      const [saved] = await db.insert(messages).values({
        tenantId,
        contactId,
        channel: 'whatsapp',
        direction: 'inbound',
        externalId: message.id as string,
        content,
        messageType: msgType,
        mediaUrl,
        status: 'received',
      }).onConflictDoNothing().returning();

      if (saved) {
        emitNewMessage(contactId, { ...saved });
      }
    } catch (inboxErr) {
      logger.error('[webhook] inbox save error:', inboxErr);
    }
  }

  // Status updates already handled in early return block (lines 57-74)

  res.status(200).json({ status: 'queued', count: queued });
});

// ---------------------------------------------------------------------------
// POST /webhooks/calcom — Cal.com booking webhook
// ---------------------------------------------------------------------------
router.post('/calcom', async (req, res) => {
  // Verify Cal.com webhook signature — signed over the exact bytes Cal.com
  // sent, not a re-serialization of the parsed body.
  const calSig = req.headers['x-cal-signature-256'] as string | undefined;
  if (!verifyWebhookSignature(process.env.CAL_WEBHOOK_SECRET, req.rawBody || JSON.stringify(req.body), calSig)) {
    res.status(401).json({ error: 'invalid signature' }); return;
  }
  const uid: string | undefined = req.body?.payload?.uid;

  if (!uid) {
    res.status(400).json({ error: 'missing booking uid' });
    return;
  }

  const eventId = `calcom:${uid}`;
  if (await isAlreadyProcessed(eventId)) {
    res.status(200).json({ status: 'already_processed' });
    return;
  }

  await markProcessed(eventId, 'calcom');

  try {
    const result = await processBooking(req.body);
    res.status(200).json({
      status: 'processed',
      tier: result.tier,
      score: result.score,
      contactId: result.contact.id,
      dealId: result.deal.id,
      isNewContact: result.contact.isNew,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('[calcom webhook] processBooking failed:', message);
    await insertJob(null, 'booking_failed', { uid, error: message, payload: req.body }, `booking_failed:${uid}`);
    res.status(200).json({ status: 'error', error: message });
  }
});

// ---------------------------------------------------------------------------
// POST /webhooks/tally — Tally form submission webhook
// ---------------------------------------------------------------------------
router.post('/tally', async (req, res) => {
  const tallySig = req.headers['x-tally-signature'] as string | undefined;
  if (!verifyWebhookSignature(process.env.TALLY_WEBHOOK_SECRET, req.rawBody || JSON.stringify(req.body), tallySig)) {
    res.status(401).json({ error: 'invalid signature' }); return;
  }
  const responseId: string | undefined = req.body?.data?.responseId ?? req.body?.eventId;

  if (!responseId) {
    res.status(400).json({ error: 'missing response id' });
    return;
  }

  const eventId = `tally:${responseId}`;
  if (await isAlreadyProcessed(eventId)) {
    res.status(200).json({ status: 'already_processed' });
    return;
  }

  await markProcessed(eventId, 'tally');
  const { job } = await insertJob(null, 'form_submit', req.body, eventId);
  res.status(200).json({ status: 'queued', jobId: job.id });
});

// ---------------------------------------------------------------------------
// POST /webhooks/chatwoot — Chatwoot conversation event webhook
// ---------------------------------------------------------------------------
router.post('/chatwoot', async (req, res) => {
  const chatwootSig = req.headers['x-chatwoot-hmac-sha256'] as string | undefined;
  if (!verifyWebhookSignature(process.env.CHATWOOT_WEBHOOK_SECRET, req.rawBody || JSON.stringify(req.body), chatwootSig)) {
    res.status(401).json({ error: 'invalid signature' }); return;
  }
  const rawId = req.body?.id;

  if (rawId === undefined || rawId === null) {
    res.status(400).json({ error: 'missing event id' });
    return;
  }

  const eventId = `chatwoot:${String(rawId)}`;
  if (await isAlreadyProcessed(eventId)) {
    res.status(200).json({ status: 'already_processed' });
    return;
  }

  await markProcessed(eventId, 'chatwoot');
  const { job } = await insertJob(null, 'chatwoot_event', req.body, eventId);
  res.status(200).json({ status: 'queued', jobId: job.id });
});

// test-queue debug endpoint removed — exposed internal queue state without auth

export default router;
