import dotenv from 'dotenv';
dotenv.config();

import crypto from 'crypto';
import { hash } from '@node-rs/argon2';
import { sql } from 'drizzle-orm';
import { db } from '../db/index';

const email = (process.env.WIZMATCH_ADMIN_EMAIL || 'jatin@growthescalators.com').toLowerCase().trim();
const name = (process.env.WIZMATCH_ADMIN_NAME || 'Wizmatch Admin').trim();
const passwordFromEnv = process.env.WIZMATCH_ADMIN_PASSWORD;
const password = passwordFromEnv && passwordFromEnv.length >= 8
  ? passwordFromEnv
  : crypto.randomBytes(18).toString('base64url');

async function main() {
  const tenantRes = await db.execute(sql`
    INSERT INTO tenants (name, slug, plan, settings, is_active)
    VALUES ('Wizmatch', 'wizmatch', 'wizmatch_internal', '{}'::jsonb, true)
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, is_active = true
    RETURNING id
  `);
  const tenantId = (tenantRes.rows[0] as { id: string } | undefined)?.id;
  if (!tenantId) throw new Error('Wizmatch tenant was not returned');

  const passwordHash = await hash(password);
  const userRes = await db.execute(sql`
    INSERT INTO users (tenant_id, name, email, password_hash, role, token_version)
    VALUES (${tenantId}, ${name}, ${email}, ${passwordHash}, 'admin', 1)
    ON CONFLICT (tenant_id, email) DO UPDATE SET
      name = EXCLUDED.name,
      password_hash = EXCLUDED.password_hash,
      role = 'admin',
      token_version = COALESCE(users.token_version, 1) + 1
    RETURNING id, email
  `);
  const user = userRes.rows[0] as { id: string; email: string } | undefined;
  if (!user) throw new Error('Wizmatch admin user was not returned');

  const permRes = await db.execute(sql`
    SELECT id FROM user_permissions WHERE user_id = ${user.id} LIMIT 1
  `);
  const permissionId = (permRes.rows[0] as { id: string } | undefined)?.id;
  if (permissionId) {
    await db.execute(sql`
      UPDATE user_permissions SET tenant_id = ${tenantId}, is_owner = true WHERE id = ${permissionId}
    `);
  } else {
    await db.execute(sql`
      INSERT INTO user_permissions (user_id, tenant_id, is_owner)
      VALUES (${user.id}, ${tenantId}, true)
    `);
  }

  console.log('Wizmatch admin ready');
  console.log(`  Email: ${user.email}`);
  if (!passwordFromEnv) {
    console.log(`  Temporary password: ${password}`);
    console.log('  Save this now. It will not be printed again.');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
