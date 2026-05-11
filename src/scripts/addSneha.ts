import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../db/index';
import { hash } from '@node-rs/argon2';

/**
 * One-off seeding script: add Sneha Joshi as a staff-role user.
 * Idempotent — re-running prints credentials again without creating a duplicate.
 *
 * Usage on Railway shell:
 *   railway run --service web npx tsx src/scripts/addSneha.ts
 */

const SNEHA = {
  name: 'Sneha Joshi',
  email: 'sneha.joshi@growthescalators.com',
  role: 'staff',
  // Initial password — Sneha can change this any time via "Forgot password" on the login page.
  password: '***REDACTED-ROTATED-2026-07-23***',
};

async function addSneha() {
  console.log('[add-sneha] starting…');

  // Resolve tenant (use the first tenant — single-tenant deployment)
  const tenant = await pool.query(`SELECT id FROM tenants ORDER BY created_at ASC LIMIT 1`);
  if (tenant.rows.length === 0) {
    console.error('[add-sneha] no tenants found — aborting');
    process.exit(1);
  }
  const tenantId = (tenant.rows[0] as { id: string }).id;

  // Idempotency check
  const existing = await pool.query(
    `SELECT id, name, email, role FROM users WHERE email = $1 LIMIT 1`,
    [SNEHA.email],
  );

  if (existing.rows.length > 0) {
    const row = existing.rows[0] as { id: string; name: string; email: string; role: string };
    console.log('[add-sneha] user already exists — not re-creating');
    console.log(`  id:    ${row.id}`);
    console.log(`  name:  ${row.name}`);
    console.log(`  email: ${row.email}`);
    console.log(`  role:  ${row.role}`);
    console.log(`\nIf the password is unknown, send Sneha to /login → "Forgot password" to set a new one.`);
    return;
  }

  // Hash and insert
  const passwordHash = await hash(SNEHA.password);
  const inserted = await pool.query(
    `INSERT INTO users (tenant_id, name, email, password_hash, role, token_version)
     VALUES ($1, $2, $3, $4, $5, 1)
     RETURNING id, name, email, role, created_at`,
    [tenantId, SNEHA.name, SNEHA.email, passwordHash, SNEHA.role],
  );

  const user = inserted.rows[0] as { id: string; name: string; email: string; role: string; created_at: Date };

  // Seed an empty user_permissions row so she shows up in the admin Permissions list
  await pool.query(
    `INSERT INTO user_permissions (user_id, is_owner) VALUES ($1, false) ON CONFLICT DO NOTHING`,
    [user.id],
  ).catch(() => { /* table may not have unique constraint on user_id; ignore */ });

  console.log('\n[add-sneha] ✓ user created');
  console.log('──────────────────────────────────────────────────');
  console.log(`  Name:     ${user.name}`);
  console.log(`  Email:    ${user.email}`);
  console.log(`  Role:     ${user.role}`);
  console.log(`  Password: ${SNEHA.password}`);
  console.log('──────────────────────────────────────────────────');
  console.log('\nShare these credentials securely with Sneha.');
  console.log('She can change her password any time via "Forgot password" on the login page.\n');
}

addSneha()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('[add-sneha] error:', err);
    process.exit(1);
  });
