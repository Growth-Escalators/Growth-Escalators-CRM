#!/usr/bin/env npx tsx
/**
 * Meta App Review — Seed reviewer test user
 *
 * Creates meta-reviewer@growthescalators.com with admin role, scoped to one
 * test client (Paraiso). Idempotent — re-running upserts the user, regenerates
 * the password, and re-writes REVIEWER_CREDENTIALS.md.
 *
 * Execute via:
 *   railway run --service web npx tsx scripts/meta-app-review/seed-reviewer-user.ts
 *
 * Writes credentials to scripts/meta-app-review/REVIEWER_CREDENTIALS.md
 * (gitignored).
 */

import dotenv from 'dotenv';
dotenv.config();

import { hash } from '@node-rs/argon2';
import { randomBytes } from 'crypto';
import { writeFileSync } from 'fs';
import { resolve } from 'path';
import { eq, or, ilike } from 'drizzle-orm';

import { db, pool, tenants, users, userPermissions, billingClients } from '../../src/db/index';

const REVIEWER_EMAIL = 'meta-reviewer@growthescalators.com';
const REVIEWER_NAME = 'Meta Reviewer';
const PARAISO_AD_ACCOUNT_ID = 'act_689363376592426';
const PARAISO_NAME = 'Paraiso';
const TENANT_SLUG = process.env.DEFAULT_TENANT_SLUG ?? 'growth-escalators';

async function main() {
  console.log('[meta-review/seed] Starting reviewer user seed…');

  if (!process.env.DATABASE_URL) {
    console.error('[meta-review/seed] DATABASE_URL not set. Run via `railway run --service web …`.');
    process.exit(1);
  }

  // 1) Add is_test_account column at runtime (per plan — no migration).
  //    Mirrors the IF NOT EXISTS pattern at src/index.ts:407-425.
  console.log('[meta-review/seed] Ensuring users.is_test_account column exists…');
  await pool.query(`
    ALTER TABLE users ADD COLUMN IF NOT EXISTS is_test_account boolean DEFAULT false;
  `);

  // 2) Resolve default tenant.
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, TENANT_SLUG)).limit(1);
  if (!tenant) {
    console.error(`[meta-review/seed] Tenant '${TENANT_SLUG}' not found. Aborting.`);
    process.exit(1);
  }
  console.log(`[meta-review/seed] Tenant: ${tenant.id} (${TENANT_SLUG})`);

  // 3) Generate fresh password (24 chars, base64url-safe).
  const password = randomBytes(18).toString('base64url');
  const passwordHash = await hash(password);

  // 4) Upsert user. ON CONFLICT (email) refreshes hash + role + flag.
  //    Direct SQL because the new is_test_account column isn't typed in
  //    Drizzle schema (per the constraint — schema.ts is protected).
  const upsertSql = `
    INSERT INTO users (tenant_id, name, email, password_hash, role, is_test_account)
    VALUES ($1, $2, $3, $4, 'admin', true)
    ON CONFLICT (email) DO UPDATE
      SET password_hash = EXCLUDED.password_hash,
          role = 'admin',
          is_test_account = true
    RETURNING id, email, role;
  `;
  const { rows: userRows } = await pool.query(upsertSql, [
    tenant.id, REVIEWER_NAME, REVIEWER_EMAIL, passwordHash,
  ]);
  const reviewerUser = userRows[0];
  console.log(`[meta-review/seed] Reviewer user: ${reviewerUser.id} (${reviewerUser.email}, role=${reviewerUser.role})`);

  // 5) Resolve or create Paraiso billing client.
  let [paraiso] = await db.select().from(billingClients)
    .where(or(
      eq(billingClients.metaAdAccountId, PARAISO_AD_ACCOUNT_ID),
      ilike(billingClients.name, '%paraiso%'),
    ))
    .limit(1);
  if (!paraiso) {
    console.log('[meta-review/seed] Paraiso billing_client not found — creating…');
    const [created] = await db.insert(billingClients).values({
      tenantId: tenant.id,
      name: PARAISO_NAME,
      metaAdAccountId: PARAISO_AD_ACCOUNT_ID,
      isActive: true,
    }).returning();
    paraiso = created;
  }
  console.log(`[meta-review/seed] Paraiso client: ${paraiso.id} (ad account ${paraiso.metaAdAccountId})`);

  // 6) Grant user_permissions row for the reviewer. role='admin' already
  //    grants RBAC access, but an explicit row makes the access visible
  //    in the admin UI's permissions table.
  const existingPerm = await db.select().from(userPermissions)
    .where(eq(userPermissions.userId, reviewerUser.id))
    .limit(1);
  if (existingPerm.length === 0) {
    await db.insert(userPermissions).values({
      userId: reviewerUser.id,
      tenantId: tenant.id,
      isOwner: true,
      contactsView: true, contactsCreate: true, contactsEdit: true,
      contactsExport: true, contactsBulk: true,
      pipelineView: true, pipelineCreate: true, pipelineEdit: true, pipelineManage: true,
      billingView: true, billingCreate: true, billingEdit: true,
      automationsView: true, automationsTrigger: true,
      reportsView: true, reportsMetaAds: true,
      settingsUsers: true, settingsPipelines: true, settingsTemplates: true, settingsBilling: true,
    });
    console.log('[meta-review/seed] Inserted user_permissions row (full admin scope).');
  } else {
    console.log('[meta-review/seed] user_permissions row already exists — left unchanged.');
  }

  // 7) Write credentials to gitignored file.
  const credsPath = resolve(__dirname, 'REVIEWER_CREDENTIALS.md');
  const credsBody = `# Meta App Review — Reviewer Credentials

> **GITIGNORED.** Do not commit. Re-running the seed script regenerates the password.

| Field | Value |
|---|---|
| Email | \`${REVIEWER_EMAIL}\` |
| Password | \`${password}\` |
| Role | admin |
| Test client | ${PARAISO_NAME} (ad account \`${PARAISO_AD_ACCOUNT_ID}\`) |
| Generated | ${new Date().toISOString()} |
| Tenant | ${TENANT_SLUG} (\`${tenant.id}\`) |

## How to log in

\`\`\`bash
curl -X POST https://web-production-311da.up.railway.app/api/auth/login \\
  -H 'Content-Type: application/json' \\
  -d '{"email":"${REVIEWER_EMAIL}","password":"${password}"}'
\`\`\`

Expect HTTP 200 with \`{ token, user: { role: 'admin' } }\`. Note the rate limit is 5 req/min.
`;
  writeFileSync(credsPath, credsBody, { encoding: 'utf8', mode: 0o600 });
  console.log(`[meta-review/seed] Wrote ${credsPath} (mode 600).`);

  console.log('\n✅ Reviewer user seed complete.');
  console.log(`   Email:    ${REVIEWER_EMAIL}`);
  console.log(`   Password: ${password}`);
  console.log(`   Client:   ${PARAISO_NAME} (${PARAISO_AD_ACCOUNT_ID})\n`);

  await pool.end();
  process.exit(0);
}

main().catch((e: unknown) => {
  console.error('[meta-review/seed] FAILED:', e instanceof Error ? e.message : e);
  if (e instanceof Error && e.stack) console.error(e.stack);
  process.exit(1);
});
