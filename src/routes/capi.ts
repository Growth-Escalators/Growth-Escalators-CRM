import logger from '../utils/logger';
import { Router } from 'express';
import { and, desc, like, eq } from 'drizzle-orm';
import { db, events, contacts, tenants } from '../db/index';
import { sendCapiEvent } from '../services/metaCapi';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/capi/status
// Returns pixel config and last 10 CAPI events
// ---------------------------------------------------------------------------
router.get('/status', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;

    const recentEvents = await db
      .select()
      .from(events)
      .where(and(eq(events.tenantId, tenantId), like(events.eventType, 'capi_%')))
      .orderBy(desc(events.createdAt))
      .limit(10);

    res.json({
      pixelId: process.env.META_PIXEL_ID || null,
      tokenConfigured: !!process.env.META_CAPI_TOKEN,
      recentEvents: recentEvents.map((e) => ({
        id: e.id,
        type: e.eventType,
        contactId: e.contactId,
        payload: e.payload,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[capi] status error:', msg);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/capi/test
// Fires a test event to Meta CAPI and returns the event ID
// ---------------------------------------------------------------------------
router.post('/test', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { eventName = 'PageView', value } = req.body as { eventName?: string; value?: number };

    const result = await sendCapiEvent({
      eventName,
      customer: {
        contactId: 'test-event-123',
        email: 'test@growthescalators.com',
        phone: '917733888883',
        firstName: 'Test',
        lastName: 'Event',
        country: 'in',
      },
      ...(value !== undefined ? { value, currency: 'INR' } : {}),
      contentName: 'Test Event from Growth Escalators CRM',
      eventSourceUrl: 'https://web-production-311da.up.railway.app/crm',
    });

    // Log to events table
    if (result.success) {
      const [tenant] = await db
        .select()
        .from(tenants)
        .where(eq(tenants.id, tenantId))
        .limit(1);

      if (tenant) {
        await db.insert(events).values({
          tenantId,
          eventType: 'capi_test_sent',
          payload: { eventName, eventId: result.eventId, value },
        });
      }
    }

    res.json({
      success: result.success,
      eventId: result.eventId,
      error: result.error,
      testEventsUrl: `https://business.facebook.com/events_manager/pixel/test_events?pixel_id=751407320872307`,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[capi] test error:', msg);
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/capi/manual
// Manually fire a CAPI event for a real contact
// Body: { contactId, eventName, value, currency, contentName }
// ---------------------------------------------------------------------------
router.post('/manual', async (req, res) => {
  try {
    const tenantId = req.user!.tenantId;
    const { contactId, eventName, value, currency = 'INR', contentName } = req.body as {
      contactId?: string;
      eventName?: string;
      value?: number;
      currency?: string;
      contentName?: string;
    };

    if (!contactId || !eventName) {
      res.status(400).json({ error: 'contactId and eventName are required' });
      return;
    }

    // Look up real contact
    const [contact] = await db
      .select()
      .from(contacts)
      .where(eq(contacts.id, contactId))
      .limit(1);

    if (!contact || contact.tenantId !== tenantId) {
      res.status(404).json({ error: 'contact not found' });
      return;
    }

    const result = await sendCapiEvent({
      eventName,
      customer: {
        contactId: contact.id,
        firstName: contact.firstName ?? undefined,
        lastName: contact.lastName ?? undefined,
        country: 'in',
      },
      ...(value !== undefined ? { value, currency } : {}),
      ...(contentName ? { contentName } : {}),
    });

    // Log to events table
    if (result.success) {
      await db.insert(events).values({
        tenantId,
        contactId,
        eventType: 'capi_manual_sent',
        payload: { eventName, eventId: result.eventId, value, contentName },
      });
    }

    res.json({ success: result.success, eventId: result.eventId, error: result.error });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('[capi] manual error:', msg);
    res.status(500).json({ error: msg });
  }
});

export default router;
