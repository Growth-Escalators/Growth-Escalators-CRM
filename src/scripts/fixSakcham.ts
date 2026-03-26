// NOTE: do NOT import dotenv — railway run injects env vars directly
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { sql } from 'drizzle-orm';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

async function main() {
  console.log('=== Fixing Sakcham user record ===\n');
  console.log('DB host:', process.env.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'unknown');

  // Update users table
  const userResult = await db.execute(sql`
    UPDATE users
    SET name = 'Sakcham', email = 'sakcham@growthescalators.com'
    WHERE name ILIKE '%sak%'
    RETURNING id, name, email, role
  `);
  console.log('Updated users:', userResult.rows);

  // Update funnel_members table
  const funnelResult = await db.execute(sql`
    UPDATE funnel_members
    SET member_name = 'Sakcham'
    WHERE calcom_url LIKE '%sakcham-ge%'
    RETURNING id, member_name, calcom_url
  `);
  console.log('Updated funnel_members:', funnelResult.rows);

  // Print all users for verification
  const allUsers = await db.execute(sql`
    SELECT id, name, email, role FROM users ORDER BY name
  `);
  console.log('\n=== All Users ===');
  for (const u of allUsers.rows as Array<Record<string, unknown>>) {
    console.log(`  ${u.name} | ${u.email} | ${u.role}`);
  }

  console.log('\nDone.');
  await pool.end();
  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
