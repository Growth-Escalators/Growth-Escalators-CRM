import logger from '../utils/logger';
import { eq } from 'drizzle-orm';
import { db, tenants, bookings, deals } from '../db/index';
import { findOrCreateContact, updateContactScore } from './contactService';
import { enrolContact } from './sequenceService';
import { insertJob } from './jobQueue';
import { scoreBooking, determineSequence, buildDealTitle } from './qualificationService';
import { sendLeadEvent, sendScheduleEvent } from './metaCapi';
import {
  ensureContactInMasterSalesPipeline,
  ensureMasterSalesPipeline,
  moveMasterSalesContactToStage,
} from './masterSalesPipelineService';

type Answers = Record<string, unknown>;

// ---------------------------------------------------------------------------
// processBooking
// Full booking pipeline: score → contact → deal → booking → enrolment → jobs
// ---------------------------------------------------------------------------
export async function processBooking(payload: Record<string, unknown>) {
  const p = payload.payload as Record<string, unknown> | undefined;

  // -------------------------------------------------------------------------
  // 1. Extract fields
  // -------------------------------------------------------------------------
  const bookingUid = p?.uid as string | undefined;
  const attendees = p?.attendees as
    | Array<{ name?: string; email?: string; phone?: string }>
    | undefined;
  const attendee = attendees?.[0];

  if (!attendee) throw new Error('No attendee in booking payload');
  if (!bookingUid) throw new Error('No booking uid in payload');

  const nameParts = (attendee.name ?? 'Unknown').trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(' ');

  const attendeeEmail = attendee.email;

  // Phone from attendee or from responses
  const responses = (p?.responses ?? p?.customInputs ?? {}) as Answers;
  let attendeePhone = attendee.phone;
  if (!attendeePhone) {
    for (const [key, val] of Object.entries(responses)) {
      if (key.toLowerCase().includes('phone')) {
        attendeePhone = String(val ?? '');
        break;
      }
    }
  }

  const scheduledAt = new Date(p?.startTime as string);
  const qualificationAnswers = responses;
  const eventTitle = ((p?.title ?? p?.eventTitle) as string | undefined) ?? 'Discovery Call';

  // -------------------------------------------------------------------------
  // 2. Validate contact info
  // -------------------------------------------------------------------------
  if (!attendeeEmail && !attendeePhone) {
    throw new Error('No contact information in booking');
  }

  // -------------------------------------------------------------------------
  // 3. Build channels
  // -------------------------------------------------------------------------
  const channels: Array<{ channelType: string; channelValue: string }> = [];
  if (attendeeEmail) channels.push({ channelType: 'email', channelValue: attendeeEmail });
  if (attendeePhone) channels.push({ channelType: 'whatsapp', channelValue: attendeePhone });

  // -------------------------------------------------------------------------
  // 4. Get Growth Escalators tenant
  // -------------------------------------------------------------------------
  const tenantRows = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, 'growth-escalators'))
    .limit(1);
  if (tenantRows.length === 0) throw new Error('Growth Escalators tenant not found');
  const tenantId = tenantRows[0].id;
  const masterSalesPipeline = await ensureMasterSalesPipeline(tenantId);

  // -------------------------------------------------------------------------
  // 5. Find or create contact
  // -------------------------------------------------------------------------
  const { contact, created } = await findOrCreateContact(tenantId, {
    firstName,
    lastName,
    source: 'calcom',
    sourceDetail: eventTitle,
    channels,
  });

  // -------------------------------------------------------------------------
  // 6. Score the booking
  // -------------------------------------------------------------------------
  const score = scoreBooking(qualificationAnswers);
  const { tier } = score;

  // -------------------------------------------------------------------------
  // 7. Update contact score
  // -------------------------------------------------------------------------
  await updateContactScore(contact.id, score.totalScore);

  // -------------------------------------------------------------------------
  // 8. Insert or update the existing booking-linked deal.
  // Keep this legacy/ecom booking relationship intact, but explicitly exclude
  // the Master Sales Pipeline deal so an ecom website lead is never moved to
  // an old `appointment_booked` stage that does not exist on the master board.
  // -------------------------------------------------------------------------
  const contactName = [firstName, lastName].filter(Boolean).join(' ');

  const existingEcomDeals = await db
    .select()
    .from(deals)
    .where(eq(deals.contactId, contact.id))
    .limit(10);

  const ecomDeal = existingEcomDeals.find((d) =>
    d.serviceType === 'ecom' && d.pipelineId !== masterSalesPipeline?.id
  );

  let deal: typeof deals.$inferSelect;

  if (ecomDeal) {
    // Advance existing Ecom deal to appointment_booked
    const [updated] = await db
      .update(deals)
      .set({ stage: 'appointment_booked', updatedAt: new Date() })
      .where(eq(deals.id, ecomDeal.id))
      .returning();
    deal = updated;
  } else {
    // New contact — create Direct pipeline deal
    const [inserted] = await db
      .insert(deals)
      .values({
        tenantId,
        contactId: contact.id,
        title: buildDealTitle(qualificationAnswers, contactName),
        stage: 'booked',
        serviceType: 'direct',
        metadata: { qualificationBreakdown: score.breakdown },
      })
      .returning();
    deal = inserted;
  }

  // The Master Sales Pipeline is the sales team's operating view. A confirmed
  // Cal.com booking should move there automatically, even when the booking must
  // retain its existing legacy/ecom deal relationship for downstream workflows.
  try {
    await ensureContactInMasterSalesPipeline({
      tenantId,
      contactId: contact.id,
      title: buildDealTitle(qualificationAnswers, contactName),
      service: eventTitle,
      source: 'calcom',
    });
    await moveMasterSalesContactToStage({
      tenantId,
      contactId: contact.id,
      stage: 'meeting-booked',
      createdBy: 'calcom',
    });
  } catch (error) {
    logger.error({ error }, '[booking] master sales pipeline sync failed');
  }

  // -------------------------------------------------------------------------
  // 9. Insert booking
  // -------------------------------------------------------------------------
  const [booking] = await db
    .insert(bookings)
    .values({
      tenantId,
      contactId: contact.id,
      dealId: deal.id,
      calBookingUid: bookingUid,
      status: 'confirmed',
      scheduledAt,
      qualificationAnswers,
      qualificationScore: score.totalScore,
      qualificationTier: tier,
    })
    .returning();

  // -------------------------------------------------------------------------
  // 10. Enrol contact in sequence
  // -------------------------------------------------------------------------
  const startAfterMinutes = tier === 'hot' ? 0 : tier === 'warm' ? 30 : 120;
  const sequenceName = determineSequence(tier, qualificationAnswers);
  const enrolment = await enrolContact(tenantId, contact.id, sequenceName, startAfterMinutes);

  // -------------------------------------------------------------------------
  // 11. booking_processed job
  // -------------------------------------------------------------------------
  await insertJob(
    tenantId,
    'booking_processed',
    {
      contactId: contact.id,
      dealId: deal.id,
      bookingId: booking.id,
      tier,
      score: score.totalScore,
      contactName,
      scheduledAt,
      qualificationAnswers,
    },
    `booking_processed:${bookingUid}`,
  );

  // -------------------------------------------------------------------------
  // 12. hot_lead_alert job (hot only)
  // -------------------------------------------------------------------------
  if (tier === 'hot') {
    await insertJob(
      tenantId,
      'hot_lead_alert',
      {
        contactId: contact.id,
        contactName,
        score: score.totalScore,
        tier,
        scheduledAt,
        dealTitle: deal.title,
      },
      `hot_alert:${bookingUid}`,
    );
  }

  // -------------------------------------------------------------------------
  // 13. CAPI Lead + Schedule events (fire-and-forget)
  // ClickUp call-prep task creation removed — ClickUp dropped 2026-05-09
  // -------------------------------------------------------------------------
  const estimatedValue = tier === 'hot' ? 25000 : tier === 'warm' ? 10000 : 5000;

  sendLeadEvent({
    contact: { id: contact.id, email: attendeeEmail, phone: attendeePhone, firstName, lastName },
    estimatedValue,
  }).catch((e: Error) => logger.error('[booking] CAPI lead error:', e.message));

  sendScheduleEvent({
    contact: { id: contact.id, email: attendeeEmail, phone: attendeePhone, firstName, lastName },
  }).catch((e: Error) => logger.error('[booking] CAPI schedule error:', e.message));

  // -------------------------------------------------------------------------
  // 14. Return result
  // -------------------------------------------------------------------------
  return {
    contact: { ...contact, isNew: created },
    booking,
    deal,
    enrolment,
    score: score.totalScore,
    tier,
  };
}
