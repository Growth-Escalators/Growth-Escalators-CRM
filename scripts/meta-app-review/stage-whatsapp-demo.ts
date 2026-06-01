#!/usr/bin/env npx tsx
/**
 * Meta App Review — Stage WhatsApp inbox demo conversations
 *
 * Inserts three fictional contacts + 4–5 WhatsApp messages per thread, spread
 * over the last 48 hours, with the last message inbound (so the reviewer has
 * something to reply to). NO real WhatsApp API calls — DB-only.
 *
 * Idempotent — deletes any rows tagged metadata->>'seed' = 'meta-review' before
 * re-inserting.
 *
 * Execute via:
 *   railway run --service web npx tsx scripts/meta-app-review/stage-whatsapp-demo.ts
 */

import dotenv from 'dotenv';
dotenv.config();

import { eq, and } from 'drizzle-orm';
import { sql } from 'drizzle-orm';
import {
  db, pool, tenants, contacts, contactChannels, messages,
} from '../../src/db/index';
import { normalizeChannelValue } from '../../src/services/contactService';

const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? 'growth-escalators';
const SEED_TAG = 'meta-review';

interface DemoMessage {
  hoursAgo: number;
  direction: 'inbound' | 'outbound';
  content: string;
  status: 'received' | 'delivered';
}

interface DemoThread {
  firstName: string;
  lastName?: string;
  phone: string;       // raw — will be normalized via shared helper
  messages: DemoMessage[];
}

const THREADS: DemoThread[] = [
  {
    firstName: 'Test',
    lastName: 'Customer 1',
    phone: '+91 99999 00001',
    messages: [
      { hoursAgo: 46, direction: 'inbound',  content: 'Hi! Saw your ad for the growth bundle. Is it still available?', status: 'received' },
      { hoursAgo: 44, direction: 'outbound', content: 'Hi! Yes — the growth bundle is live. Would you like the full breakdown?', status: 'delivered' },
      { hoursAgo: 24, direction: 'inbound',  content: 'Yes please. What does the bundle include?', status: 'received' },
      { hoursAgo: 20, direction: 'outbound', content: 'Sharing the deck here: https://growthescalators.com/bundle — let me know what stands out.', status: 'delivered' },
      { hoursAgo: 2,  direction: 'inbound',  content: 'Looks great. Can we hop on a call this week?', status: 'received' },
    ],
  },
  {
    firstName: 'Demo Inquiry',
    lastName: 'Skincare',
    phone: '+91 99999 00002',
    messages: [
      { hoursAgo: 38, direction: 'inbound',  content: 'Hello, I run a skincare D2C brand and would like to learn more about your services.', status: 'received' },
      { hoursAgo: 36, direction: 'outbound', content: 'Hi! Happy to help. What\'s your monthly ad spend and primary platforms?', status: 'delivered' },
      { hoursAgo: 18, direction: 'inbound',  content: 'Around 8L/month, mostly Meta + Google. Looking to scale to 25L by Q4.', status: 'received' },
      { hoursAgo: 1,  direction: 'inbound',  content: 'Also — do you handle creative production in-house or outsourced?', status: 'received' },
    ],
  },
  {
    firstName: 'Sample Order',
    lastName: 'Question',
    phone: '+91 99999 00003',
    messages: [
      { hoursAgo: 30, direction: 'inbound',  content: 'My order GE-12345 was placed yesterday but I haven\'t received tracking yet.', status: 'received' },
      { hoursAgo: 28, direction: 'outbound', content: 'Apologies for the delay — checking with our fulfillment partner now. One moment.', status: 'delivered' },
      { hoursAgo: 27, direction: 'outbound', content: 'Tracking will be emailed within 2 hours. Thanks for your patience!', status: 'delivered' },
      { hoursAgo: 4,  direction: 'inbound',  content: 'Got the email, thank you! One more question — can I add gift wrapping?', status: 'received' },
    ],
  },
];

async function main() {
  console.log('[meta-review/wa-demo] Starting WhatsApp demo data seed…');

  if (!process.env.DATABASE_URL) {
    console.error('[meta-review/wa-demo] DATABASE_URL not set. Run via `railway run --service web …`.');
    process.exit(1);
  }

  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, TENANT_SLUG)).limit(1);
  if (!tenant) { console.error(`Tenant ${TENANT_SLUG} not found`); process.exit(1); }
  const tenantId = tenant.id;
  console.log(`[meta-review/wa-demo] Tenant: ${tenantId}`);

  // 1) Delete any previously seeded messages so re-runs don't duplicate.
  //    Tagged via metadata.seed = 'meta-review'.
  const deleted = await pool.query(
    `DELETE FROM messages WHERE tenant_id = $1 AND metadata->>'seed' = $2 RETURNING id`,
    [tenantId, SEED_TAG],
  );
  console.log(`[meta-review/wa-demo] Cleared ${deleted.rowCount} previously seeded messages.`);

  for (const thread of THREADS) {
    const fullPhone = normalizeChannelValue('whatsapp', thread.phone);
    console.log(`\n[meta-review/wa-demo] Thread: ${thread.firstName} ${thread.lastName ?? ''} (${fullPhone})`);

    // 2) Find or create the contact + whatsapp channel.
    const existingChannel = await db.select({ contactId: contactChannels.contactId })
      .from(contactChannels)
      .where(and(
        eq(contactChannels.channelType, 'whatsapp'),
        eq(contactChannels.channelValue, fullPhone),
        eq(contactChannels.tenantId, tenantId),
      ))
      .limit(1);

    let contactId: string;
    if (existingChannel.length > 0) {
      contactId = existingChannel[0].contactId;
      console.log(`  Contact exists: ${contactId}`);
    } else {
      const [contact] = await db.insert(contacts).values({
        tenantId,
        firstName: thread.firstName,
        lastName: thread.lastName,
        source: 'meta-review-seed',
        tags: ['meta-review', 'demo'],
        metadata: { seed: SEED_TAG },
      }).returning();
      contactId = contact.id;
      await db.insert(contactChannels).values({
        tenantId,
        contactId,
        channelType: 'whatsapp',
        channelValue: fullPhone,
        isPrimary: true,
      });
      console.log(`  Created contact: ${contactId}`);
    }

    // 3) Insert messages.
    const now = Date.now();
    let inserted = 0;
    for (let i = 0; i < thread.messages.length; i++) {
      const m = thread.messages[i];
      const sentAt = new Date(now - m.hoursAgo * 3600 * 1000);
      await db.insert(messages).values({
        tenantId,
        contactId,
        channel: 'whatsapp',
        direction: m.direction,
        content: m.content,
        status: m.status,
        externalId: `seed_review_${contactId}_${i}`,
        messageType: 'text',
        metadata: { seed: SEED_TAG },
        sentAt,
      });
      inserted++;
    }
    console.log(`  Inserted ${inserted} messages.`);
  }

  // 4) Sanity: confirm last message in each thread is inbound.
  const verify = await pool.query(
    `WITH latest AS (
       SELECT DISTINCT ON (contact_id) contact_id, direction, sent_at
       FROM messages
       WHERE tenant_id = $1 AND metadata->>'seed' = $2
       ORDER BY contact_id, sent_at DESC
     )
     SELECT direction, COUNT(*)::int AS cnt FROM latest GROUP BY direction`,
    [tenantId, SEED_TAG],
  );
  console.log('\n[meta-review/wa-demo] Last-message direction summary:');
  for (const row of verify.rows) console.log(`  ${row.direction}: ${row.cnt}`);

  console.log('\n✅ WhatsApp demo data staged.');
  await pool.end();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('[meta-review/wa-demo] FAILED:', e instanceof Error ? e.message : e);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
