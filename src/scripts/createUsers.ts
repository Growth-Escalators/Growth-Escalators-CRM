import dotenv from 'dotenv';
dotenv.config();

import { db, users, tenants } from '../db/index';
import { eq, sql } from 'drizzle-orm';
import { hash } from '@node-rs/argon2';
import crypto from 'crypto';

interface UserSeed {
  name: string;
  email: string;
  role: string;
}

const USERS_TO_CREATE: UserSeed[] = [
  { name: 'Jatin Agrawal', email: 'jatin@growthescalators.com', role: 'admin' },
  { name: 'Sakcham', email: 'sakcham@growthescalators.com', role: 'sales' },
  { name: 'Vishal Malakar', email: 'vishal.malakar@growthescalators.com', role: 'manager_ads' },
  { name: 'Nimisha Daiya', email: 'nimisha.daiya@growthescalators.com', role: 'staff' },
  { name: 'Keshav Vaishnav', email: 'keshav.growthescalators@gmail.com', role: 'staff' },
];

function generatePassword(): string {
  return crypto.randomBytes(12).toString('base64url').slice(0, 16);
}

async function main() {
  console.log('=== Creating/Updating User Accounts ===\n');

  // Get tenant
  const tenantResult = await db.execute(sql`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
  const tenantId = (tenantResult.rows[0] as { id: string } | undefined)?.id;
  if (!tenantId) {
    console.error('ERROR: tenant "growth-escalators" not found');
    process.exit(1);
  }

  const credentials: Array<{ name: string; email: string; password: string; role: string }> = [];

  for (const seed of USERS_TO_CREATE) {
    const password = generatePassword();
    const passwordHash = await hash(password);
    const email = seed.email.toLowerCase();

    // Upsert: insert or update
    const existing = await db.select().from(users).where(eq(users.email, email)).limit(1);

    if (existing.length > 0) {
      // Update role, password, tokenVersion
      await db.execute(sql`
        UPDATE users
        SET name = ${seed.name},
            password_hash = ${passwordHash},
            role = ${seed.role},
            token_version = COALESCE(token_version, 0) + 1
        WHERE email = ${email}
      `);
      console.log(`  UPDATED: ${seed.name} (${email}) — role: ${seed.role}`);
    } else {
      await db.insert(users).values({
        tenantId,
        name: seed.name,
        email,
        passwordHash,
        role: seed.role,
        tokenVersion: 1,
      });
      console.log(`  CREATED: ${seed.name} (${email}) — role: ${seed.role}`);
    }

    credentials.push({ name: seed.name, email, password, role: seed.role });
  }

  console.log('\n=== CREDENTIALS (distribute securely) ===\n');
  console.log('┌───────────────────────────┬─────────────────────────────────────────────┬──────────────────┬──────────────┐');
  console.log('│ Name                      │ Email                                       │ Password         │ Role         │');
  console.log('├───────────────────────────┼─────────────────────────────────────────────┼──────────────────┼──────────────┤');
  for (const c of credentials) {
    console.log(`│ ${c.name.padEnd(25)} │ ${c.email.padEnd(43)} │ ${c.password.padEnd(16)} │ ${c.role.padEnd(12)} │`);
  }
  console.log('└───────────────────────────┴─────────────────────────────────────────────┴──────────────────┴──────────────┘');

  // Send Slack DM to Jatin with credentials
  try {
    const { sendSlackDM, SLACK_MEMBERS } = await import('../services/slackService');
    const credList = credentials.map(c => `• *${c.name}* (${c.role})\n  Email: ${c.email}\n  Password: \`${c.password}\``).join('\n\n');
    await sendSlackDM(SLACK_MEMBERS.jatin,
      `🔐 *CRM User Accounts Created/Updated*\n\nLogin at: /login\n\n${credList}\n\n⚠️ Share passwords securely and ask users to change them on first login.`);
    console.log('\n✓ Credentials sent to Jatin via Slack DM');
  } catch (e) {
    console.log('\n⚠ Could not send Slack DM:', e instanceof Error ? e.message : e);
  }

  console.log('\nDone.\n');
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal error:', e);
  process.exit(1);
});
