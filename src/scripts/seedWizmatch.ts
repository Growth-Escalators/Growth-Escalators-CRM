/**
 * Wizmatch Staffing Module — Day 0 seed script
 *
 * Creates:
 *   1. Wizmatch tenant
 *   2. Admin user (jatin@wizmatch.com)
 *   3. Wizmatch sales pipeline (7 stages)
 *   4. 4-touch follow-up sequence (Day 3, 7, 14, 21)
 *   5. 3 domain-health rows for the sending domains
 *
 * Usage: npx tsx src/scripts/seedWizmatch.ts
 *
 * After running, capture the tenant ID from the output and set it as
 * WIZMATCH_TENANT_ID in your .env / Railway variables.
 */

import { hash } from '@node-rs/argon2';
import dotenv from 'dotenv';
dotenv.config();

import { db, pool } from '../db/index';
import { sql } from 'drizzle-orm';
import { tenants, pipelines, sequences, wizmatchDomainHealth } from '../db/schema';

const ADMIN_EMAIL = 'jatin@wizmatch.com';
const ADMIN_NAME = 'Jatin';
const ADMIN_PASSWORD = process.env.WIZMATCH_ADMIN_PASSWORD || 'Wizmatch2025!';
const TENANT_SLUG = 'wizmatch';

// 7-stage placements pipeline for Wizmatch staffing
const PLACEMENT_STAGES = [
  { id: 'submitted', name: 'Submitted', color: '#3B82F6' },
  { id: 'interviewing', name: 'Interviewing', color: '#F59E0B' },
  { id: 'offered', name: 'Offered', color: '#8B5CF6' },
  { id: 'started', name: 'Started', color: '#10B981' },
  { id: 'ended', name: 'Ended', color: '#6B7280' },
  { id: 'lost', name: 'Lost', color: '#EF4444' },
];

// 4-touch follow-up sequence for cold outreach
const FOLLOWUP_STEPS = [
  {
    stepNum: 0,
    delayDays: 0,
    subject: 'Quick question about {{job_title}}',
    body: 'Hi {{first_name}},\n\nSaw the {{job_title}} role at {{company_name}} has been open {{days_open}} days. I have 2 candidates with {{top_skill}} experience at {{bill_rate}}/hr — want profiles in 30 minutes?\n\n— Archit, Wizmatch\n\n[UNSUBSCRIBE_LINK]\n[PHYSICAL_ADDRESS]',
  },
  {
    stepNum: 1,
    delayDays: 3,
    subject: 'Re: Quick question about {{job_title}}',
    body: 'Hi {{first_name}},\n\nFollowing up — the 2 candidates I mentioned are still available. Should I send their profiles?\n\n— Archit\n\n[UNSUBSCRIBE_LINK]\n[PHYSICAL_ADDRESS]',
  },
  {
    stepNum: 2,
    delayDays: 7,
    subject: 'Re: Quick question about {{job_title}}',
    body: 'Hi {{first_name}},\n\nLast note from me on this. The role\'s been open a while — happy to send profiles on a quick call if easier: {{calendly_url}}\n\n— Archit\n\n[UNSUBSCRIBE_LINK]\n[PHYSICAL_ADDRESS]',
  },
  {
    stepNum: 3,
    delayDays: 14,
    subject: 'Different candidates for {{company_name}}?',
    body: 'Hi {{first_name}},\n\nThe original candidates got placed elsewhere, but I have a fresh bench. Different skills if the role has evolved. Want me to send updated profiles?\n\n— Archit\n\n[UNSUBSCRIBE_LINK]\n[PHYSICAL_ADDRESS]',
  },
];

// 3 sending domains (reusing Growth Escalators' warmed Purelymail infrastructure)
const SENDING_DOMAINS = [
  { domain: 'adscalelab.co', inboxes: ['jatin@adscalelab.co', 'hello@adscalelab.co'] },
  { domain: 'partnerpeak.co', inboxes: ['jatin@partnerpeak.co', 'hello@partnerpeak.co'] },
  { domain: 'partners-ge.co', inboxes: ['jatin@partners-ge.co', 'hello@partners-ge.co'] },
];

async function seed() {
  console.log('🚀 Seeding Wizmatch staffing module...\n');

  // 1. Create tenant (or get existing)
  let tenantResult = await db.execute(sql`
    SELECT id FROM tenants WHERE slug = ${TENANT_SLUG} LIMIT 1
  `);
  let tenantId: string;

  if (tenantResult.rows.length === 0) {
    const insertResult = await db.execute(sql`
      INSERT INTO tenants (name, slug, plan, is_active, created_at)
      VALUES ('Wizmatch', ${TENANT_SLUG}, 'staffing', true, NOW())
      RETURNING id
    `);
    tenantId = (insertResult.rows[0] as { id: string }).id;
    console.log(`✅ Created Wizmatch tenant: ${tenantId}`);
  } else {
    tenantId = (tenantResult.rows[0] as { id: string }).id;
    console.log(`ℹ️  Wizmatch tenant already exists: ${tenantId}`);
  }

  // 2. Create admin user (or update if exists)
  const passwordHash = await hash(ADMIN_PASSWORD);
  const userResult = await db.execute(sql`
    INSERT INTO users (tenant_id, name, email, password_hash, role, token_version, created_at)
    VALUES (${tenantId}, ${ADMIN_NAME}, ${ADMIN_EMAIL}, ${passwordHash}, 'admin', 1, NOW())
    ON CONFLICT (email) DO UPDATE SET
      name = EXCLUDED.name,
      password_hash = EXCLUDED.password_hash,
      role = EXCLUDED.role,
      tenant_id = EXCLUDED.tenant_id
    RETURNING id
  `);
  console.log(`✅ Admin user ready: ${ADMIN_EMAIL}`);

  // 3. Create Wizmatch pipeline
  const pipelineResult = await db.execute(sql`
    INSERT INTO pipelines (tenant_id, name, slug, stages, color, is_active, sort_order, created_at)
    VALUES (
      ${tenantId},
      'Wizmatch Placements',
      'wizmatch-placements',
      ${JSON.stringify(PLACEMENT_STAGES)}::jsonb,
      '#7C3AED',
      true,
      100,
      NOW()
    )
    ON CONFLICT (tenant_id, slug) DO UPDATE SET stages = EXCLUDED.stages
    RETURNING id
  `);
  const pipelineId = (pipelineResult.rows[0] as { id: string }).id;
  console.log(`✅ Wizmatch pipeline created: ${pipelineId}`);

  // 4. Create follow-up sequence
  await db.execute(sql`
    INSERT INTO sequences (tenant_id, name, channel, steps, is_active, created_at)
    VALUES (
      ${tenantId},
      'Wizmatch Cold Outreach Follow-up',
      'email',
      ${JSON.stringify(FOLLOWUP_STEPS)}::jsonb,
      true,
      NOW()
    )
    ON CONFLICT DO NOTHING
  `);
  console.log(`✅ Follow-up sequence created (4 steps: Day 0/3/7/14)`);

  // 5. Seed domain health rows
  for (const d of SENDING_DOMAINS) {
    await db.execute(sql`
      INSERT INTO wizmatch_domain_health (tenant_id, domain, inbox_addresses, status, created_at)
      VALUES (
        ${tenantId},
        ${d.domain},
        ARRAY[${sql.join(d.inboxes.map((email) => sql`${email}`), sql`, `)}]::text[],
        'healthy',
        NOW()
      )
      ON CONFLICT (tenant_id, domain) DO NOTHING
    `);
    console.log(`✅ Domain health row: ${d.domain} (${d.inboxes.join(', ')})`);
  }

  // Summary
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  WIZMATCH SEED COMPLETE');
  console.log('═══════════════════════════════════════════════════');
  console.log(`  Tenant ID:     ${tenantId}`);
  console.log(`  Admin Email:   ${ADMIN_EMAIL}`);
  console.log(`  Admin Pass:    ${ADMIN_PASSWORD}`);
  console.log(`  Pipeline ID:   ${pipelineId}`);
  console.log('');
  console.log('  ⚠️  Add to your .env / Railway:');
  console.log(`  WIZMATCH_TENANT_ID=${tenantId}`);
  console.log('═══════════════════════════════════════════════════\n');

  await pool.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});