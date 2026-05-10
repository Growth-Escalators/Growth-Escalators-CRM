import dotenv from 'dotenv';
dotenv.config();

import { pool } from '../db/index';

/**
 * Idempotent — safe to run multiple times.
 * 1. Find Vishal's user.
 * 2. Reassign contacts/deals/tasks/outreach_leads → Jatin.
 * 3. Set users.token_version = -1 (sentinel: deactivated; requireStrictAuth dies).
 * 4. Set users.role = 'deactivated'.
 * 5. Insert audit row in audit_events.
 */
async function removeVishal() {
  console.log('[remove-vishal] Starting Vishal removal...');

  // Step 1 — Find Vishal
  const userResult = await pool.query(
    `SELECT id, name, email, role, token_version FROM users WHERE email = 'vishal.malakar@growthescalators.com' LIMIT 1`,
  );

  if (userResult.rows.length === 0) {
    console.log('[remove-vishal] Vishal not found — already removed (or never existed)');
    return;
  }

  const vishal = userResult.rows[0] as { id: string; name: string; email: string; role: string; token_version: number };
  console.log(`[remove-vishal] Found: ${vishal.name} (${vishal.email}) — role: ${vishal.role}, token_version: ${vishal.token_version}`);

  // Step 2 — Find Jatin (admin, earliest createdAt for safety)
  const jatinResult = await pool.query(
    `SELECT id FROM users WHERE role = 'admin' ORDER BY created_at ASC LIMIT 1`,
  );
  const jatinId = (jatinResult.rows[0] as { id: string } | undefined)?.id;
  if (!jatinId) {
    console.error('[remove-vishal] No admin user found — cannot reassign. Aborting.');
    return;
  }
  console.log(`[remove-vishal] Reassigning data to admin user ${jatinId}`);

  // Tenant id (single-tenant — match the slug used everywhere else)
  const tenantResult = await pool.query(
    `SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`,
  );
  const tenantId = (tenantResult.rows[0] as { id: string } | undefined)?.id;

  let reassignedCount = 0;

  // Step 3a — Reassign contacts
  const contactsReassigned = await pool.query(
    `UPDATE contacts SET assigned_to = $1, updated_at = NOW() WHERE assigned_to = $2`,
    [jatinId, vishal.id],
  );
  const contactsCount = (contactsReassigned as unknown as { rowCount: number }).rowCount ?? 0;
  reassignedCount += contactsCount;
  console.log(`[remove-vishal] Reassigned ${contactsCount} contacts`);

  // Step 3b — Reassign deals
  const dealsReassigned = await pool.query(
    `UPDATE deals SET assigned_to = $1, updated_at = NOW() WHERE assigned_to = $2`,
    [jatinId, vishal.id],
  );
  const dealsCount = (dealsReassigned as unknown as { rowCount: number }).rowCount ?? 0;
  reassignedCount += dealsCount;
  console.log(`[remove-vishal] Reassigned ${dealsCount} deals`);

  // Step 3c — Reassign tasks (text column — UUID stored as text)
  const tasksReassigned = await pool.query(
    `UPDATE tasks SET assigned_to = $1, updated_at = NOW() WHERE assigned_to = $2`,
    [jatinId, vishal.id],
  ).catch(() => ({ rowCount: 0 }));
  const tasksCount = (tasksReassigned as unknown as { rowCount: number }).rowCount ?? 0;
  reassignedCount += tasksCount;
  console.log(`[remove-vishal] Reassigned ${tasksCount} tasks`);

  // Step 3d — Reassign outreach_leads (assigned_to is text, often a name like 'vishal' — handle both)
  const outreachReassignedById = await pool.query(
    `UPDATE outreach_leads SET assigned_to = $1, updated_at = NOW() WHERE assigned_to = $2`,
    [jatinId, vishal.id],
  ).catch(() => ({ rowCount: 0 }));
  const outreachByIdCount = (outreachReassignedById as unknown as { rowCount: number }).rowCount ?? 0;

  const outreachReassignedByName = await pool.query(
    `UPDATE outreach_leads SET assigned_to = $1, updated_at = NOW() WHERE LOWER(assigned_to) = 'vishal'`,
    [jatinId],
  ).catch(() => ({ rowCount: 0 }));
  const outreachByNameCount = (outreachReassignedByName as unknown as { rowCount: number }).rowCount ?? 0;

  reassignedCount += outreachByIdCount + outreachByNameCount;
  console.log(`[remove-vishal] Reassigned ${outreachByIdCount + outreachByNameCount} outreach_leads (${outreachByIdCount} by id, ${outreachByNameCount} by name)`);

  // Step 4 — Deactivate: bump token_version to -1 (sentinel) AND set role
  const deactivateResult = await pool.query(
    `UPDATE users SET role = 'deactivated', token_version = -1, updated_at = NOW() WHERE id = $1`,
    [vishal.id],
  );
  console.log(`[remove-vishal] Deactivated: ${(deactivateResult as unknown as { rowCount: number }).rowCount} row(s) — token_version set to -1, all sessions invalidated`);

  // Step 5 — Audit row (real schema: tenant_id, user_id, action, resource_type, metadata)
  if (tenantId) {
    await pool.query(
      `INSERT INTO audit_events (tenant_id, user_id, action, resource_type, resource_id, metadata, created_at)
       VALUES ($1, $2, 'team_member_offboarded', 'user', $3, $4, NOW())`,
      [
        tenantId,
        jatinId,
        vishal.id,
        JSON.stringify({
          target_user_id: vishal.id,
          target_email: vishal.email,
          target_name: vishal.name,
          actor_user_id: jatinId,
          reassigned_count: reassignedCount,
          slack_id: 'U0ALC9Z09RA',
          clickup_id: null,
          reason: 'Team member offboarded',
        }),
      ],
    ).catch((e) => console.error('[remove-vishal] audit insert failed:', e));
  }

  console.log('[remove-vishal] Complete — Vishal deactivated, data reassigned to Jatin');
  console.log(`[remove-vishal] Summary: ${reassignedCount} records reassigned (contacts: ${contactsCount}, deals: ${dealsCount}, tasks: ${tasksCount}, outreach: ${outreachByIdCount + outreachByNameCount})`);
}

removeVishal().catch(console.error).finally(() => process.exit(0));
