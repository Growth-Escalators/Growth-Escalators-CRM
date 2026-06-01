#!/usr/bin/env npx tsx
/**
 * One-shot: replace Tushar Jangid with Kanishk Khandelwal.
 *
 * - Creates user Kanishk.khandelwal@growthescalators.com (role=team_lead,
 *   same tenant as Tushar) with password 'Kanishk@#2026'. Idempotent on
 *   email — re-running updates the password + role.
 * - Reassigns all of Tushar's open tasks (tasks.assigned_to) to Kanishk.
 * - Soft-deletes Tushar: is_active=false + token_version+1 (invalidates any
 *   existing JWT). Preserves audit_events + historical references.
 *
 * Run:
 *   railway run --service web npx tsx scripts/onboarding/replace-tushar-with-kanishk.ts
 *   (or set DATABASE_URL=$DATABASE_PUBLIC_URL when running from a laptop)
 */

import dotenv from 'dotenv';
dotenv.config();

import { hash } from '@node-rs/argon2';
import { pool } from '../../src/db/index';

const TUSHAR_ID = 'dcdeda02-479a-4d54-949d-b138d4dd30a8';
// Lowercased — auth.ts lookups via email.toLowerCase(), so storing mixed-case
// would silently make login fail.
const KANISHK_EMAIL = 'kanishk.khandelwal@growthescalators.com';
const KANISHK_NAME = 'Kanishk Khandelwal';
const KANISHK_PASSWORD = 'Kanishk@#2026';

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set. Run via `railway run --service web ...` or export DATABASE_PUBLIC_URL as DATABASE_URL.');
    process.exit(1);
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1) Confirm Tushar exists and grab tenant.
    const tushar = await client.query(
      `SELECT id, tenant_id, role, is_active FROM users WHERE id = $1 FOR UPDATE`,
      [TUSHAR_ID],
    );
    if (tushar.rowCount === 0) throw new Error(`Tushar user ${TUSHAR_ID} not found`);
    const { tenant_id: tenantId, role: tusharRole } = tushar.rows[0];
    console.log(`[replace] Tushar: tenant=${tenantId} role=${tusharRole} is_active=${tushar.rows[0].is_active}`);

    // 2) Upsert Kanishk with the same tenant + role.
    const passwordHash = await hash(KANISHK_PASSWORD);
    const upsert = await client.query(
      `INSERT INTO users (tenant_id, name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, true)
       ON CONFLICT (email) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             role = EXCLUDED.role,
             is_active = true,
             token_version = COALESCE(users.token_version, 1) + 1
       RETURNING id, email, role, is_active`,
      [tenantId, KANISHK_NAME, KANISHK_EMAIL, passwordHash, tusharRole],
    );
    const kanishk = upsert.rows[0];
    console.log(`[replace] Kanishk: id=${kanishk.id} role=${kanishk.role} is_active=${kanishk.is_active}`);

    // 3) Reassign Tushar's open tasks to Kanishk.
    const reassign = await client.query(
      `UPDATE tasks SET assigned_to = $1 WHERE assigned_to = $2 RETURNING id`,
      [kanishk.id, TUSHAR_ID],
    );
    console.log(`[replace] Reassigned ${reassign.rowCount} task(s) from Tushar to Kanishk`);

    // 4) Soft-delete Tushar: deactivate + bump token_version to invalidate JWTs.
    const deactivate = await client.query(
      `UPDATE users
         SET is_active = false,
             token_version = COALESCE(token_version, 1) + 1
       WHERE id = $1
       RETURNING id, email, is_active, token_version`,
      [TUSHAR_ID],
    );
    console.log(`[replace] Deactivated Tushar: is_active=${deactivate.rows[0].is_active} token_version=${deactivate.rows[0].token_version}`);

    await client.query('COMMIT');
    console.log('\n✅ Done.');
    console.log(`   New login: ${KANISHK_EMAIL}  /  ${KANISHK_PASSWORD}`);
    console.log(`   Tushar (${TUSHAR_ID}) deactivated; ${reassign.rowCount} task(s) reassigned.`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  await pool.end();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('[replace] FAILED:', e instanceof Error ? e.message : e);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
