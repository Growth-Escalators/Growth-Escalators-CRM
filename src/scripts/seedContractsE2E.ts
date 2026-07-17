/**
 * E2E seed for the Contracts/e-sign spec — creates a growth-escalators tenant +
 * one admin-role test user in the local `wizmatch_e2e_test` database only.
 * (Contracts is a Growth-product page, so the E2E logs in as Growth Escalators.)
 * Never run against a shared/staging/production DB.
 *
 * Usage: DATABASE_URL=...wizmatch_e2e_test npx tsx src/scripts/seedContractsE2E.ts
 */
import { hash } from '@node-rs/argon2';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config();

import { db, pool } from '../db/index';
import { sql } from 'drizzle-orm';

const TENANT_SLUG = 'growth-escalators';
const TEST_EMAIL = 'e2e.contracts@example.invalid';
const TEST_NAME = 'E2E Contracts Admin';

async function seed() {
  const dbUrl = process.env.DATABASE_URL || '';
  if (!dbUrl.includes('wizmatch_e2e_test')) {
    console.error('Refusing to run: DATABASE_URL does not point at the disposable wizmatch_e2e_test database.');
    process.exit(1);
  }

  const password = crypto.randomBytes(18).toString('base64url');

  const tenantResult = await db.execute(sql`SELECT id FROM tenants WHERE slug = ${TENANT_SLUG} LIMIT 1`);
  let tenantId: string;
  if (tenantResult.rows.length === 0) {
    const insertResult = await db.execute(sql`
      INSERT INTO tenants (name, slug, plan, is_active, created_at)
      VALUES ('Growth Escalators', ${TENANT_SLUG}, 'agency_internal', true, NOW())
      RETURNING id
    `);
    tenantId = (insertResult.rows[0] as { id: string }).id;
  } else {
    tenantId = (tenantResult.rows[0] as { id: string }).id;
  }

  const passwordHash = await hash(password);
  await db.execute(sql`
    INSERT INTO users (tenant_id, name, email, password_hash, role, token_version, created_at)
    VALUES (${tenantId}, ${TEST_NAME}, ${TEST_EMAIL}, ${passwordHash}, 'admin', 1, NOW())
    ON CONFLICT (tenant_id, email) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      role = 'admin',
      token_version = users.token_version + 1
  `);

  console.log('\n=== CONTRACTS E2E FIXTURE READY (local disposable DB only) ===');
  console.log(`TENANT_ID=${tenantId}`);
  console.log(`TEST_EMAIL=${TEST_EMAIL}`);
  console.log(`TEST_PASSWORD=${password}`);
  console.log('==============================================================\n');

  await pool.end();
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
