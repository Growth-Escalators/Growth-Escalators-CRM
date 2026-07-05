/**
 * Standalone backfill — repairs deals linked to Wizmatch placements that were
 * created before placement↔deal wiring existed. Idempotent; safe to re-run.
 *
 * For every tenant that has wizmatch_placements it:
 *   1. Ensures the 'wizmatch-placements' pipeline exists (6 stages).
 *   2. Points each placement's deal at that pipeline (was NULL → orphaned).
 *   3. Syncs deal.stage to the placement's current status.
 *   4. Stamps closed_at on deals whose placement is in a terminal stage.
 *
 * Run with: npx tsx src/db/migrations/backfill_wizmatch_placement_deals.ts
 */
import dotenv from 'dotenv';
dotenv.config();

import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const WIZMATCH_PLACEMENT_STAGES = ['submitted', 'interviewing', 'offered', 'started', 'ended', 'lost'];

async function run() {
  const tenants = await pool.query(
    `SELECT DISTINCT tenant_id FROM wizmatch_placements`,
  );
  if (tenants.rows.length === 0) {
    console.log('[backfill] No wizmatch_placements found — nothing to do.');
    return;
  }

  for (const { tenant_id: tenantId } of tenants.rows) {
    // 1. Ensure pipeline exists
    const pipeline = await pool.query(
      `INSERT INTO pipelines (tenant_id, name, slug, stages, color, is_active)
       VALUES ($1, 'Wizmatch Placements', 'wizmatch-placements', $2::jsonb, '#3b82f6', true)
       ON CONFLICT (tenant_id, slug) DO UPDATE SET stages = EXCLUDED.stages
       RETURNING id`,
      [tenantId, JSON.stringify(WIZMATCH_PLACEMENT_STAGES)],
    );
    const pipelineId = pipeline.rows[0].id as string;

    // 2–4. Repair the linked deals
    const updated = await pool.query(
      `UPDATE deals d
       SET pipeline_id = $2,
           stage = wp.status,
           closed_at = CASE WHEN wp.status IN ('ended','lost') THEN COALESCE(d.closed_at, NOW()) ELSE NULL END,
           updated_at = NOW()
       FROM wizmatch_placements wp
       WHERE wp.deal_id = d.id
         AND wp.tenant_id = $1
         AND d.tenant_id = $1
         AND (d.pipeline_id IS DISTINCT FROM $2 OR d.stage IS DISTINCT FROM wp.status)
       RETURNING d.id`,
      [tenantId, pipelineId],
    );

    console.log(`[backfill] tenant ${tenantId}: repaired ${updated.rows.length} placement deal(s)`);
  }
}

run()
  .then(() => { console.log('[backfill] Done'); process.exit(0); })
  .catch((e) => { console.error('[backfill] Failed:', e); process.exit(1); })
  .finally(() => pool.end());
