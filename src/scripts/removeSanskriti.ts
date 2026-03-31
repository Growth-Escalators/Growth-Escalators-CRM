import { db } from '../db';
import { sql } from 'drizzle-orm';

async function removeSanskriti() {
  // Step 1 — Get both user IDs as text
  const sanskritiResult = await db.execute(
    sql`SELECT id::text FROM users WHERE email = 'gupta13sanskriti@gmail.com' LIMIT 1`
  );
  const sakchamResult = await db.execute(
    sql`SELECT id::text FROM users WHERE email = 'sakcham@growthescalators.com' LIMIT 1`
  );

  const sanskritiId = (sanskritiResult.rows[0] as Record<string, string> | undefined)?.id;
  const sakchamId = (sakchamResult.rows[0] as Record<string, string> | undefined)?.id;

  if (!sanskritiId) {
    console.log('Sanskriti not found — already removed');
    return;
  }

  console.log('Sanskriti ID:', sanskritiId);
  console.log('Sakcham ID:  ', sakchamId);

  // Step 2 — Reassign deals
  const dealsResult = await db.execute(
    sql`UPDATE deals SET assigned_to = ${sakchamId} WHERE assigned_to = ${sanskritiId}`
  );
  console.log('Deals reassigned:', (dealsResult as unknown as { rowCount: number }).rowCount);

  // Step 3 — Reassign contacts
  const contactsResult = await db.execute(
    sql`UPDATE contacts SET assigned_to = ${sakchamId} WHERE assigned_to = ${sanskritiId}`
  );
  console.log('Contacts reassigned:', (contactsResult as unknown as { rowCount: number }).rowCount);

  // Step 4 — Find and update any other tables with assigned_to column
  const tablesResult = await db.execute(
    sql`SELECT table_name FROM information_schema.columns
        WHERE column_name = 'assigned_to'
        AND table_schema = 'public'`
  );
  const tableNames = (tablesResult.rows as Array<{ table_name: string }>).map(r => r.table_name);
  console.log('Tables with assigned_to:', tableNames);

  for (const table of tableNames) {
    if (table === 'deals' || table === 'contacts') continue;
    const r = await db.execute(
      sql.raw(`UPDATE "${table}" SET assigned_to = '${sakchamId}' WHERE assigned_to = '${sanskritiId}'`)
    );
    const count = (r as unknown as { rowCount: number }).rowCount;
    if (count > 0) console.log(`  → Updated ${table}: ${count} row(s)`);
  }

  // Step 5 — Delete Sanskriti's user account
  const deleteResult = await db.execute(
    sql`DELETE FROM users WHERE email = 'gupta13sanskriti@gmail.com'`
  );
  console.log('Sanskriti deleted:', (deleteResult as unknown as { rowCount: number }).rowCount, 'row(s)');

  // Step 6 — Verify final user list
  const usersResult = await db.execute(
    sql`SELECT name, email, role FROM users ORDER BY created_at`
  );
  console.log('\nFinal user list:');
  (usersResult.rows as Array<{ name: string; email: string; role: string }>).forEach(u =>
    console.log(' ', u.name, '|', u.email, '|', u.role)
  );
}

removeSanskriti().catch(console.error).finally(() => process.exit(0));
