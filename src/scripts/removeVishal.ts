import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../db/index';

async function removeVishal() {
  console.log('[remove-vishal] Starting Vishal removal...');

  // Step 1 — Find Vishal's user account
  const userResult = await pool.query(
    `SELECT id, name, email, role FROM users WHERE email = 'vishal.malakar@growthescalators.com' LIMIT 1`,
  );

  if (userResult.rows.length === 0) {
    console.log('[remove-vishal] Vishal not found — already removed');
    return;
  }

  const vishal = userResult.rows[0] as { id: string; name: string; email: string; role: string };
  console.log(`[remove-vishal] Found: ${vishal.name} (${vishal.email}) — role: ${vishal.role}`);

  // Step 2 — Reassign any contacts assigned to Vishal → Sakcham
  const sakchamResult = await pool.query(
    `SELECT id FROM users WHERE email = 'sakcham@growthescalators.com' LIMIT 1`,
  );
  const sakchamId = (sakchamResult.rows[0] as { id: string } | undefined)?.id;

  if (sakchamId) {
    const contactsReassigned = await pool.query(
      `UPDATE contacts SET assigned_to = $1, updated_at = NOW() WHERE assigned_to = $2`,
      [sakchamId, vishal.id],
    );
    console.log(`[remove-vishal] Reassigned ${(contactsReassigned as unknown as { rowCount: number }).rowCount} contacts to Sakcham`);

    // Step 3 — Reassign deals
    const dealsReassigned = await pool.query(
      `UPDATE deals SET assigned_to = $1, updated_at = NOW() WHERE assigned_to = $2`,
      [sakchamId, vishal.id],
    );
    console.log(`[remove-vishal] Reassigned ${(dealsReassigned as unknown as { rowCount: number }).rowCount} deals to Sakcham`);
  }

  // Step 4 — Deactivate Vishal's user account (soft delete — preserve audit trail)
  const deactivateResult = await pool.query(
    `UPDATE users SET role = 'deactivated', updated_at = NOW() WHERE id = $1`,
    [vishal.id],
  );
  console.log(`[remove-vishal] Deactivated: ${(deactivateResult as unknown as { rowCount: number }).rowCount} row(s)`);

  // Step 5 — Log the removal as an audit event
  await pool.query(
    `INSERT INTO audit_events (actor_id, actor_email, action, resource_type, details, created_at)
     VALUES ($1, $2, $3, $4, $5, NOW())`,
    ['system', 'system@growthescalators.com', 'DEACTIVATE_USER', 'user',
     JSON.stringify({ userId: vishal.id, name: vishal.name, email: vishal.email, reason: 'Team member removed' })],
  ).catch(() => {});

  console.log('[remove-vishal] Complete — Vishal deactivated, data reassigned to Sakcham');
}

removeVishal().catch(console.error).finally(() => process.exit(0));
