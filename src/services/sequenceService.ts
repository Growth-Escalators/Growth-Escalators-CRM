import { eq, and } from 'drizzle-orm';
import { db, sequences, sequenceEnrolments, contacts } from '../db/index';
import { resolveWizmatchLinkage } from '../modules/outreach/wizmatchLinkage';
import { evaluateWizmatchOutreachGate, shouldBlock } from '../modules/outreach/outreachGate';

type Enrolment = typeof sequenceEnrolments.$inferSelect;

// ---------------------------------------------------------------------------
// enrolContact
// Finds the sequence, validates the contact, prevents duplicate active enrolments.
// ---------------------------------------------------------------------------
export async function enrolContact(
  tenantId: string,
  contactId: string,
  sequenceName: string,
  startAfterMinutes = 0,
): Promise<Enrolment> {
  // Find the active sequence
  const seqRows = await db
    .select()
    .from(sequences)
    .where(
      and(
        eq(sequences.name, sequenceName),
        eq(sequences.tenantId, tenantId),
        eq(sequences.isActive, true),
      ),
    )
    .limit(1);

  if (seqRows.length === 0) {
    throw new Error('Sequence not found: ' + sequenceName);
  }
  const sequence = seqRows[0];

  // Check doNotContact
  const contactRows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (contactRows.length > 0 && contactRows[0].doNotContact) {
    throw new Error('Contact is marked do not contact');
  }

  // §8.10.1 row 24 — add the gate alongside the existing do_not_contact check.
  const linkage = await resolveWizmatchLinkage(tenantId, contactId);
  if (linkage) {
    const decision = await evaluateWizmatchOutreachGate({ tenantId, action: 'enrol', companyId: linkage.companyId, contactId });
    if (shouldBlock({ tenantId, action: 'enrol', companyId: linkage.companyId, contactId }, decision)) {
      throw new Error(`Blocked by outreach policy: ${decision.reasonCodes.join(', ') || decision.decision}`);
    }
  }

  // Check for existing active enrolment in this sequence (no duplicates)
  const existing = await db
    .select()
    .from(sequenceEnrolments)
    .where(
      and(
        eq(sequenceEnrolments.contactId, contactId),
        eq(sequenceEnrolments.sequenceId, sequence.id),
        eq(sequenceEnrolments.status, 'active'),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return existing[0];
  }

  // Create the enrolment
  const nextStepAt = new Date(Date.now() + startAfterMinutes * 60 * 1000);
  const [enrolment] = await db
    .insert(sequenceEnrolments)
    .values({
      tenantId,
      contactId,
      sequenceId: sequence.id,
      currentStep: 0,
      status: 'active',
      nextStepAt,
    })
    .returning();

  return enrolment;
}

// ---------------------------------------------------------------------------
// cancelEnrolment
// ---------------------------------------------------------------------------
export async function cancelEnrolment(enrolmentId: string): Promise<Enrolment> {
  const [updated] = await db
    .update(sequenceEnrolments)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(eq(sequenceEnrolments.id, enrolmentId))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// pauseEnrolment
// ---------------------------------------------------------------------------
export async function pauseEnrolment(enrolmentId: string): Promise<Enrolment> {
  const [updated] = await db
    .update(sequenceEnrolments)
    .set({ status: 'paused' })
    .where(eq(sequenceEnrolments.id, enrolmentId))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// resumeEnrolment
// ---------------------------------------------------------------------------
export async function resumeEnrolment(enrolmentId: string): Promise<Enrolment> {
  const [updated] = await db
    .update(sequenceEnrolments)
    .set({ status: 'active' })
    .where(eq(sequenceEnrolments.id, enrolmentId))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// getActiveEnrolments
// Returns active enrolments joined with their sequence name.
// ---------------------------------------------------------------------------
export async function getActiveEnrolments(
  contactId: string,
): Promise<(Enrolment & { sequenceName: string })[]> {
  const rows = await db
    .select({
      enrolment: sequenceEnrolments,
      sequenceName: sequences.name,
    })
    .from(sequenceEnrolments)
    .innerJoin(sequences, eq(sequenceEnrolments.sequenceId, sequences.id))
    .where(eq(sequenceEnrolments.contactId, contactId));

  return rows.map((r) => ({ ...r.enrolment, sequenceName: r.sequenceName }));
}

// ---------------------------------------------------------------------------
// cancelAllEnrolments
// Cancels all active enrolments for a contact (used on opt-out).
// ---------------------------------------------------------------------------
export async function cancelAllEnrolments(contactId: string): Promise<number> {
  const active = await db
    .select({ id: sequenceEnrolments.id })
    .from(sequenceEnrolments)
    .where(
      and(
        eq(sequenceEnrolments.contactId, contactId),
        eq(sequenceEnrolments.status, 'active'),
      ),
    );

  if (active.length === 0) return 0;

  await db
    .update(sequenceEnrolments)
    .set({ status: 'cancelled', completedAt: new Date() })
    .where(
      and(
        eq(sequenceEnrolments.contactId, contactId),
        eq(sequenceEnrolments.status, 'active'),
      ),
    );

  return active.length;
}
