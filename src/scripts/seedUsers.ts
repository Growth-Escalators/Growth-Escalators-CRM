import dotenv from 'dotenv';
dotenv.config();

import { hash } from '@node-rs/argon2';
import { db } from '../db/index';
import { users } from '../db/schema';
import { eq } from 'drizzle-orm';

function requireEnv(name: string, label: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${label} missing — set ${name} in the environment before running seedUsers`);
  return v;
}

const SEED_USERS = [
  { name: 'Jatin Agrawal', email: 'jatin@growthescalators.com', password: requireEnv('SEED_JATIN_PASSWORD', 'Jatin seed password') },
  { name: 'Sales Rep',     email: 'sales@growthescalators.com', password: requireEnv('SEED_SALES_PASSWORD', 'Sales seed password') },
];

async function seedUsers() {
  console.log('Seeding CRM users...');

  // Look up tenant by slug so this works in both local and production DB
  const { tenants } = await import('../db/schema');
  const [tenant] = await db.select().from(tenants).where(eq(tenants.slug, 'growth-escalators')).limit(1);
  if (!tenant) { console.error('Tenant growth-escalators not found'); process.exit(1); }
  const tenantId = tenant.id;
  console.log(`  Using tenant: ${tenantId}`);

  for (const u of SEED_USERS) {
    const existing = await db.select().from(users).where(eq(users.email, u.email)).limit(1);
    if (existing.length > 0) {
      console.log(`  ✓ ${u.email} already exists — skipping`);
      continue;
    }
    const passwordHash = await hash(u.password);
    await db.insert(users).values({ tenantId, name: u.name, email: u.email, passwordHash });
    console.log(`  ✓ Created ${u.email}`);
  }

  console.log('Done.');
  process.exit(0);
}

seedUsers().catch((e) => { console.error(e); process.exit(1); });
