// One-off seed script — creates the `creative_assistant` user for Kratika
// Gangwal. Run once via:
//
//   railway run npx tsx src/scripts/seedKratika.ts
//
// or locally with DATABASE_URL pointed at prod. Idempotent: re-running after
// success will log "already exists" and exit 0 — safe to invoke again.
//
// After the user changes their password (via "Forgot password" on login),
// this script becomes dead code. Delete it or leave it as a historical
// artefact — it can't re-create the user once it exists.
import { sql } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import { db, tenants, users } from '../db/index';
import { eq } from 'drizzle-orm';

const EMAIL = 'kratika.gangwal@growthescalators.com';
const NAME  = 'Kratika Gangwal';
const ROLE  = 'creative_assistant';
const PASSWORD = '***REDACTED-ROTATED-2026-07-23***'; // CHANGE-AT-FIRST-LOGIN — share securely

async function main() {
  // 1. Find the Growth Escalators tenant (single-tenant install but matches
  //    the lookup pattern used in src/db/seed.ts so this stays correct if
  //    tenant IDs ever shift).
  const [geTenant] = await db
    .select()
    .from(tenants)
    .where(eq(tenants.slug, 'growth-escalators'))
    .limit(1);

  if (!geTenant) {
    console.error('FATAL: Growth Escalators tenant not found. Aborting.');
    process.exit(1);
  }
  console.log(`Tenant: ${geTenant.name} (${geTenant.id})`);

  // 2. Idempotency — bail if the user already exists.
  const normalisedEmail = EMAIL.toLowerCase().trim();
  const existing = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, normalisedEmail))
    .limit(1);

  if (existing.length > 0) {
    console.log(`User ${normalisedEmail} already exists (id=${existing[0].id}, role=${existing[0].role}). Nothing to do.`);
    process.exit(0);
  }

  // 3. Hash + insert. Mirrors the INSERT used by POST /api/permissions/users
  //    so the row shape matches what the rest of the CRM expects.
  const passwordHash = await hash(PASSWORD);

  const result = await db.execute(sql`
    INSERT INTO users (tenant_id, name, email, password_hash, role, token_version)
    VALUES (${geTenant.id}, ${NAME}, ${normalisedEmail}, ${passwordHash}, ${ROLE}, 1)
    RETURNING id, name, email, role, created_at
  `) as unknown as Array<{ id: string; name: string; email: string; role: string; created_at: string }>;

  const inserted = result[0];

  // 4. Seed empty user_permissions row so they appear in the admin's user list
  //    filters (same as the POST /api/permissions/users handler does).
  await db.execute(sql`
    INSERT INTO user_permissions (user_id, is_owner)
    VALUES (${inserted.id}, false)
    ON CONFLICT (user_id) DO NOTHING
  `).catch(() => { /* table may not have unique constraint; ignore */ });

  console.log('\n✓ Created user');
  console.log(`  Name:     ${inserted.name}`);
  console.log(`  Email:    ${inserted.email}`);
  console.log(`  Role:     ${inserted.role}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`  ID:       ${inserted.id}`);
  console.log('\nShare the password securely (WhatsApp/Signal — NOT email).');
  console.log('Tell Kratika to change it via "Forgot password" on the login page.');
  process.exit(0);
}

main().catch(e => {
  console.error('Script failed:', e);
  process.exit(1);
});
