import { eq } from 'drizzle-orm';
import { db, tenants, bookings, deals } from '../db/index';
import { findOrCreateContact, updateContactScore } from './contactService';
import { enrolContact } from './sequenceService';
import { insertJob } from './jobQueue';
import { scoreBooking, determineSequence, buildDealTitle } from './qualificationService';

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
  // 8. Insert or update deal
  // If contact already has an Ecom deal (from a purchase), advance it to
  // appointment_booked. Otherwise create a new Direct pipeline deal.
  // -------------------------------------------------------------------------
  const contactName = [firstName, lastName].filter(Boolean).join(' ');

  const existingEcomDeals = await db
    .select()
    .from(deals)
    .where(eq(deals.contactId, contact.id))
    .limit(10);

  const ecomDeal = existingEcomDeals.find((d) => d.serviceType === 'ecom');

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
  // 13. Return result
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
