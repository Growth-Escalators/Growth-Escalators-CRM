/**
 * Read-only Gate A historical readiness preview.
 *
 * This script never writes. It counts missing attribution/ownership/SLA facts so
 * a human can select the pilot requirement IDs without guessing historical data.
 * Any future write operation must be a separate, explicitly approved script.
 *
 * Usage:
 *   DATABASE_URL=... WIZMATCH_TENANT_ID=... npm run wizmatch:staffing-backfill-preview
 */
import 'dotenv/config';
import { Pool } from 'pg';

async function main() {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  const connectionString = process.env.DATABASE_URL;
  if (!tenantId || !connectionString) throw new Error('DATABASE_URL and WIZMATCH_TENANT_ID are required');

  const pool = new Pool({ connectionString });
  try {
    const summary = await pool.query(`
      SELECT COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE attribution_status='needs_attribution')::int AS needs_attribution,
        COUNT(*) FILTER (WHERE company_id IS NULL)::int AS missing_company,
        COUNT(*) FILTER (WHERE next_action_due_at IS NULL)::int AS missing_dated_next_action,
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM wizmatch_requirement_contacts rc
          WHERE rc.tenant_id=r.tenant_id AND rc.requirement_id=r.id AND rc.active=true AND rc.is_primary_source=true
        ))::int AS missing_primary_source,
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM wizmatch_requirement_assignments a
          WHERE a.tenant_id=r.tenant_id AND a.requirement_id=r.id AND a.active=true AND a.role='account_owner'
        ))::int AS missing_owner,
        COUNT(*) FILTER (WHERE NOT EXISTS (
          SELECT 1 FROM wizmatch_requirement_assignments a
          WHERE a.tenant_id=r.tenant_id AND a.requirement_id=r.id AND a.active=true AND a.role='recruiter'
        ))::int AS missing_recruiter
      FROM wizmatch_requirements r WHERE tenant_id=$1
    `, [tenantId]);
    const candidates = await pool.query(`
      SELECT r.id,r.title,r.status,r.stage,r.attribution_status,c.name AS company_name,r.created_at
      FROM wizmatch_requirements r
      LEFT JOIN wizmatch_companies c ON c.id=r.company_id AND c.tenant_id=r.tenant_id
      WHERE r.tenant_id=$1
      ORDER BY CASE WHEN r.status IN ('open','active','confirmed') THEN 0 ELSE 1 END,r.created_at DESC
      LIMIT 50
    `, [tenantId]);

    console.log(JSON.stringify({ mode: 'count_only_read_only', tenantId, summary: summary.rows[0], pilotCandidates: candidates.rows }, null, 2));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error('[wizmatch staffing backfill preview] failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
