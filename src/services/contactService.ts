import { eq, and, sql } from 'drizzle-orm';
import { db, contacts, contactChannels } from '../db/index';

type Contact = typeof contacts.$inferSelect;
type ContactChannel = typeof contactChannels.$inferSelect;

interface ChannelInput {
  channelType: string;
  channelValue: string;
  isPrimary?: boolean;
}

// Normalize a channel value for deduplication. Email is lowercased + trimmed.
// Phone/whatsapp is stripped to digits and prefixed with `91` if missing.
// Centralized here so every contact-write path applies the same rules — the
// dedup invariant in CLAUDE.md depends on it.
export function normalizeChannelValue(channelType: string, raw: string): string {
  if (!raw) return '';
  if (channelType === 'email') return raw.trim().toLowerCase();
  if (channelType === 'whatsapp' || channelType === 'phone' || channelType === 'sms') {
    const digits = raw.replace(/\D/g, '');
    if (!digits) return '';
    return digits.startsWith('91') ? digits : `91${digits}`;
  }
  return raw.trim();
}

// Same shape as ChannelInput, but the value is already normalized at the call
// site (or pushed through normalizeChannelValue before push).
export function normalizeChannel(ch: ChannelInput): ChannelInput {
  return { ...ch, channelValue: normalizeChannelValue(ch.channelType, ch.channelValue) };
}

interface FindOrCreateData {
  firstName: string;
  lastName?: string;
  source?: string;
  sourceDetail?: string;
  metadata?: object;
  channels: ChannelInput[];
  /** Optional classification set ONLY on create (never overwrites an existing contact). */
  companyName?: string;
  businessType?: string;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// findOrCreateContact
// Deduplicates by checking if any provided channel already exists for this tenant.
// Creates contact + channels atomically if no match found.
// ---------------------------------------------------------------------------
export async function findOrCreateContact(
  tenantId: string,
  data: FindOrCreateData,
): Promise<{ contact: Contact; channels: ContactChannel[]; created: boolean }> {
  // Normalize every incoming channel value before the existence check. This is
  // a defense-in-depth: callers SHOULD normalize, but doing it here means a
  // forgotten lowercase upstream won't fragment contacts.
  const normalizedChannels: ChannelInput[] = data.channels
    .map(normalizeChannel)
    .filter((ch) => ch.channelValue.length > 0);
  data = { ...data, channels: normalizedChannels };

  // Check each channel for an existing match belonging to this tenant
  for (const ch of data.channels) {
    const existing = await db
      .select({ contact: contacts, channel: contactChannels })
      .from(contactChannels)
      .innerJoin(contacts, eq(contactChannels.contactId, contacts.id))
      .where(
        and(
          eq(contactChannels.channelType, ch.channelType),
          eq(contactChannels.channelValue, ch.channelValue),
          eq(contacts.tenantId, tenantId),
        ),
      )
      .limit(1);

    if (existing.length > 0) {
      const existingContact = existing[0].contact;
      // Fetch all channels for this contact
      const allChannels = await db
        .select()
        .from(contactChannels)
        .where(eq(contactChannels.contactId, existingContact.id));
      return { contact: existingContact, channels: allChannels, created: false };
    }
  }

  // No existing contact found — create atomically in a transaction
  const result = await db.transaction(async (tx) => {
    const [newContact] = await tx
      .insert(contacts)
      .values({
        tenantId,
        firstName: data.firstName,
        lastName: data.lastName,
        source: data.source,
        sourceDetail: data.sourceDetail,
        metadata: data.metadata ?? {},
        // Optional classification — Drizzle omits undefined, so unset fields fall
        // back to their column defaults (tags → []). Only applied on create.
        companyName: data.companyName,
        businessType: data.businessType,
        tags: data.tags,
      })
      .returning();

    const newChannels: ContactChannel[] = [];
    for (const ch of data.channels) {
      const [newChannel] = await tx
        .insert(contactChannels)
        .values({
          tenantId,
          contactId: newContact.id,
          channelType: ch.channelType,
          channelValue: ch.channelValue,
          isPrimary: ch.isPrimary ?? false,
        })
        .returning();
      newChannels.push(newChannel);
    }

    return { contact: newContact, channels: newChannels };
  });

  return { ...result, created: true };
}

// ---------------------------------------------------------------------------
// updateContactScore
// Increments score by the given amount. Auto-qualifies at score >= 80.
// ---------------------------------------------------------------------------
export async function updateContactScore(
  contactId: string,
  increment: number,
): Promise<Contact> {
  await db
    .update(contacts)
    .set({
      score: sql`${contacts.score} + ${increment}`,
      updatedAt: new Date(),
    })
    .where(eq(contacts.id, contactId));

  const [updated] = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);

  // Auto-qualify if score crosses the threshold
  if ((updated.score ?? 0) >= 80 && updated.status !== 'qualified') {
    await db
      .update(contacts)
      .set({ status: 'qualified', updatedAt: new Date() })
      .where(eq(contacts.id, contactId));
    return (
      await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1)
    )[0];
  }

  return updated;
}

// ---------------------------------------------------------------------------
// markDoNotContact
// Opts the contact out of all channels.
// ---------------------------------------------------------------------------
export async function markDoNotContact(contactId: string): Promise<Contact> {
  const [updated] = await db
    .update(contacts)
    .set({ doNotContact: true, optedInWa: false, optedInEmail: false, updatedAt: new Date() })
    .where(eq(contacts.id, contactId))
    .returning();
  return updated;
}

// ---------------------------------------------------------------------------
// getContactWithChannels
// Returns the contact row plus all their channel rows.
// ---------------------------------------------------------------------------
export async function getContactWithChannels(
  contactId: string,
): Promise<(Contact & { channels: ContactChannel[] }) | null> {
  const rows = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
  if (rows.length === 0) return null;

  const allChannels = await db
    .select()
    .from(contactChannels)
    .where(eq(contactChannels.contactId, contactId));

  return { ...rows[0], channels: allChannels };
}
