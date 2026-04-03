/**
 * Standalone migration — creates Agency Owners and Freelancer pipelines.
 * Run with: npx tsx src/db/migrations/add_agency_freelancer_pipelines.ts
 * Safe to run multiple times — skips if pipeline already exists.
 */
import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const AGENCY_STAGES = [
  'Paid ₹9',
  'Paid ₹208',
  'Paid ₹508',
  'Paid ₹707',
  'Appointment Booked',
  'No Show',
  'WL Proposal Sent',
  'WL Active Partner',
];

const FREELANCER_STAGES = [
  'Paid ₹9',
  'Paid ₹208',
  'Paid ₹508',
  'Paid ₹707',
  'Appointment Booked',
  'No Show',
  'Workshop Waitlist',
  'Workshop Paid',
];

async function run() {
  // Get the growth-escalators tenant
  const tenantResult = await pool.query(
    `SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`,
  );
  if (tenantResult.rows.length === 0) {
    throw new Error('Tenant growth-escalators not found');
  }
  const tenantId = tenantResult.rows[0].id as string;
  console.log('[migration] Tenant ID:', tenantId);

  // Agency Owners pipeline
  const agencyExists = await pool.query(
    `SELECT id FROM pipelines WHERE tenant_id = $1 AND name = 'Agency Owners' LIMIT 1`,
    [tenantId],
  );
  if (agencyExists.rows.length > 0) {
    console.log('[migration] "Agency Owners" pipeline already exists — skipping');
  } else {
    await pool.query(
      `INSERT INTO pipelines (id, tenant_id, name, slug, stages, color, is_active, sort_order)
       VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, true, $6)`,
      [tenantId, 'Agency Owners', 'agency-owners', JSON.stringify(AGENCY_STAGES), '#1B2E5E', 1],
    );
    console.log('[migration] Created "Agency Owners" pipeline with', AGENCY_STAGES.length, 'stages');
  }

  // Freelancer pipeline
  const freelancerExists = await pool.query(
    `SELECT id FROM pipelines WHERE tenant_id = $1 AND name = 'Freelancer' LIMIT 1`,
    [tenantId],
  );
  if (freelancerExists.rows.length > 0) {
    console.log('[migration] "Freelancer" pipeline already exists — skipping');
  } else {
    await pool.query(
      `INSERT INTO pipelines (id, tenant_id, name, slug, stages, color, is_active, sort_order)
       VALUES (gen_random_uuid(), $1, $2, $3, $4::jsonb, $5, true, $6)`,
      [tenantId, 'Freelancer', 'freelancer', JSON.stringify(FREELANCER_STAGES), '#7C3AED', 2],
    );
    console.log('[migration] Created "Freelancer" pipeline with', FREELANCER_STAGES.length, 'stages');
  }

  // List all pipelines for verification
  const all = await pool.query(
    `SELECT name, slug, jsonb_array_length(stages) AS stage_count FROM pipelines WHERE tenant_id = $1 ORDER BY sort_order`,
    [tenantId],
  );
  console.log('[migration] All pipelines:');
  for (const row of all.rows) {
    console.log(`  • ${row.name} (${row.stage_count} stages)`);
  }
}

run()
  .then(() => { console.log('[migration] Done'); process.exit(0); })
  .catch((e) => { console.error('[migration] Failed:', e); process.exit(1); })
  .finally(() => pool.end());
