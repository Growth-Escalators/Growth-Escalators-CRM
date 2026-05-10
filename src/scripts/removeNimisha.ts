import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../db/index';

/**
 * Idempotent — safe to run multiple times.
 * 1. Find Nimisha's user (by email or name).
 * 2. Reassign contacts/deals/tasks/outreach_leads → Jatin.
 * 3. Set users.token_version = -1 (sentinel: deactivated; requireStrictAuth dies).
 * 4. Set users.role = 'deactivated'.
 * 5. Insert audit row in audit_events.
 */
async function removeNimisha() {
  console.log('[remove-nimisha] Starting Nimisha removal...');

  // Step 1 — Find Nimisha (try email first, then name fallback)
  let userResult = await pool.query(
    `SELECT id, name, email, role, token_version FROM users WHERE email = 'nimisha.daiya@growthescalators.com' LIMIT 1`,
  );
  if (userResult.rows.length === 0) {
    userResult = await pool.query(
      `SELECT id, name, email, role, token_version FROM users WHERE LOWER(name) LIKE 'nimisha%' LIMIT 1`,
    );
  }

  if (userResult.rows.length === 0) {
    console.log('[remove-nimisha] Nimisha not found — already removed (or never existed)');
    return;
  }

  const nimisha = userResult.rows[0] as { id: string; name: string; email: string; role: string; token_version: number };
  console.log(`[remove-nimisha] Found: ${nimisha.name} (${nimisha.email}) — role: ${nimisha.role}, token_version: ${nimisha.token_version}`);

  // Step 2 — Find Jatin (admin, earliest createdAt for safety)
  const jatinResult = await pool.query(
    `SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`,
  );
  const jatinId = (jatinResult.rows[0] as { id: string } | undefined)?.id;
  if (!jatinId) {
    console.error('[remove-nimisha] No admin user found — cannot reassign. Aborting.');
    return;
  }
  console.log(`[remove-nimisha] Reassigning data to admin user ${jatinId}`);

  const tenantResult = await pool.query(
    `SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`,
  );
  const tenantId = (tenantResult.rows[0] as { id: string } | undefined)?.id;

  let reassignedCount = 0;

  // Step 3a — Reassign contacts
  const contactsReassigned = await pool.query(
    `UPDATE contacts SET assigned_to = $1, updated_at = NOW() WHERE assigned_to = $2`,
    [jatinId, nimisha.id],
  );
  const contactsCount = (contactsReassigned as unknown as { rowCount: number }).rowCount ?? 0;
  reassignedCount += contactsCount;
  console.log(`[remove-nimisha] Reassigned ${contactsCount} contacts`);

  // Step 3b — Reassign deals
  const dealsReassigned = await pool.query(
    `UPDATE deals SET assigned_to = $1, updated_at = NOW() WHERE assigned_to = $2`,
    [jatinId, nimisha.id],
  );
  const dealsCount = (dealsReassigned as unknown as { rowCount: number }).rowCount ?? 0;
  reassignedCount += dealsCount;
  console.log(`[remove-nimisha] Reassigned ${dealsCount} deals`);

  // Step 3c — Reassign tasks
  const tasksReassigned = await pool.query(
    `UPDATE tasks SET assigned_to = $1, updated_at = NOW() WHERE assigned_to = $2`,
    [jatinId, nimisha.id],
  ).catch(() => ({ rowCount: 0 }));
  const tasksCount = (tasksReassigned as unknown as { rowCount: number }).rowCount ?? 0;
  reassignedCount += tasksCount;
  console.log(`[remove-nimisha] Reassigned ${tasksCount} tasks`);

  // Step 3d — Reassign outreach_leads (assigned_to is text — match by id or by lowercase name)
  const outreachReassignedById = await pool.query(
    `UPDATE outreach_leads SET assigned_to = $1, updated_at = NOW() WHERE assigned_to = $2`,
    [jatinId, nimisha.id],
  ).catch(() => ({ rowCount: 0 }));
  const outreachByIdCount = (outreachReassignedById as unknown as { rowCount: number }).rowCount ?? 0;

  const outreachReassignedByName = await pool.query(
    `UPDATE outreach_leads SET assigned_to = $1, updated_at = NOW() WHERE LOWER(assigned_to) = 'nimisha'`,
    [jatinId],
  ).catch(() => ({ rowCount: 0 }));
  const outreachByNameCount = (outreachReassignedByName as unknown as { rowCount: number }).rowCount ?? 0;

  reassignedCount += outreachByIdCount + outreachByNameCount;
  console.log(`[remove-nimisha] Reassigned ${outreachByIdCount + outreachByNameCount} outreach_leads (${outreachByIdCount} by id, ${outreachByNameCount} by name)`);

  // Step 4 — Deactivate: token_version = -1 sentinel + role
  const deactivateResult = await pool.query(
    `UPDATE users SET role = 'deactivated', token_version = -1, updated_at = NOW() WHERE id = $1`,
    [nimisha.id],
  );
  console.log(`[remove-nimisha] Deactivated: ${(deactivateResult as unknown as { rowCount: number }).rowCount} row(s) — token_version set to -1, all sessions invalidated`);

  // Step 5 — Audit row
  if (tenantId) {
    await pool.query(
      `INSERT INTO audit_events (tenant_id, user_id, action, resource_type, resource_id, metadata, created_at)
       VALUES ($1, $2, 'team_member_offboarded', 'user', $3, $4, NOW())`,
      [
        tenantId,
        jatinId,
        nimisha.id,
        JSON.stringify({
          target_user_id: nimisha.id,
          target_email: nimisha.email,
          target_name: nimisha.name,
          actor_user_id: jatinId,
          reassigned_count: reassignedCount,
          slack_id: 'U0ALMKD2XFB',
          clickup_id: '100972807',
          reason: 'Team member offboarded',
        }),
      ],
    ).catch((e) => console.error('[remove-nimisha] audit insert failed:', e));
  }

  console.log('[remove-nimisha] Complete — Nimisha deactivated, data reassigned to Jatin');
  console.log(`[remove-nimisha] Summary: ${reassignedCount} records reassigned (contacts: ${contactsCount}, deals: ${dealsCount}, tasks: ${tasksCount}, outreach: ${outreachByIdCount + outreachByNameCount})`);
}

removeNimisha().catch(console.error).finally(() => process.exit(0));
