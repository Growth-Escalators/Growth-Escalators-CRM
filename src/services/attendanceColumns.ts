/**
 * Runtime column migration for self-service attendance hardening.
 *
 * Adds anti-misuse + audit columns to team_attendance and an
 * expected_start_time column to team_payroll for per-member late
 * detection. Idempotent — safe to run on every boot.
 *
 * Pattern matches the other ensure*() helpers in this repo
 * (e.g. ensureEnrichmentColumns, ensureCronJobLogsTable).
 */

import { pool } from '../db/index';
import logger from '../utils/logger';

export async function ensureAttendanceColumns(): Promise<void> {
  try {
    await pool.query(`
      ALTER TABLE team_attendance
        ADD COLUMN IF NOT EXISTS check_in_ip text,
        ADD COLUMN IF NOT EXISTS check_in_user_agent text,
        ADD COLUMN IF NOT EXISTS check_out_ip text,
        ADD COLUMN IF NOT EXISTS check_out_user_agent text,
        ADD COLUMN IF NOT EXISTS is_late boolean DEFAULT false,
        ADD COLUMN IF NOT EXISTS late_minutes integer,
        ADD COLUMN IF NOT EXISTS admin_overridden_by text,
        ADD COLUMN IF NOT EXISTS admin_override_reason text,
        ADD COLUMN IF NOT EXISTS admin_overridden_at timestamp,
        ADD COLUMN IF NOT EXISTS work_location text DEFAULT 'office'
    `);
    await pool.query(`
      ALTER TABLE team_payroll
        ADD COLUMN IF NOT EXISTS expected_start_time time DEFAULT '09:30:00'
    `);
    logger.info('[attendance] columns ensured');
  } catch (e) {
    logger.warn(
      `[attendance] ensure columns failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
