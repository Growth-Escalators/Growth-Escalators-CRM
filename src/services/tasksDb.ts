/**
 * Tasks v1 runtime DDL.
 *
 * Adds:
 *   - `priority` column on the existing `tasks` table (low|medium|high)
 *   - supporting indexes (priority / assigned_to / status)
 *   - `task_comments` table (with threading via parent_comment_id, mentions[])
 *   - `task_attachments` table (URL entries + uploaded files share the table)
 *
 * Idempotent — safe to run on every boot. Mirrors the ensure*() pattern used by
 * src/services/financeService.ts ensureFinanceTables and
 * src/services/attendanceColumns.ts ensureAttendanceColumns.
 */

import { pool } from '../db/index';
import logger from '../utils/logger';

export async function ensureTasksV1Tables(): Promise<void> {
  const stmts: string[] = [
    // 1. Priority on tasks
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS priority TEXT DEFAULT 'medium'`,
    // CHECK constraint added separately so re-running is safe
    `DO $$
     BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM pg_constraint WHERE conname = 'tasks_priority_check'
       ) THEN
         ALTER TABLE tasks
           ADD CONSTRAINT tasks_priority_check
           CHECK (priority IN ('low','medium','high'));
       END IF;
     END $$`,
    `CREATE INDEX IF NOT EXISTS tasks_priority_idx ON tasks(priority)`,
    `CREATE INDEX IF NOT EXISTS tasks_assigned_to_idx ON tasks(assigned_to)`,
    `CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks(status)`,

    // 2. Comments + threading
    `CREATE TABLE IF NOT EXISTS task_comments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      parent_comment_id UUID REFERENCES task_comments(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      author_user_id UUID NOT NULL,
      mentions UUID[] DEFAULT '{}',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`,
    `ALTER TABLE task_comments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`,
    `CREATE INDEX IF NOT EXISTS task_comments_task_idx ON task_comments(task_id, created_at)`,

    // 3. Attachments (URL entries OR uploaded files)
    `CREATE TABLE IF NOT EXISTS task_attachments (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      comment_id UUID REFERENCES task_comments(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('url','upload')),
      label TEXT,
      url TEXT,
      storage_path TEXT,
      mime_type TEXT,
      size_bytes BIGINT,
      added_by_user_id UUID,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS task_attachments_task_idx ON task_attachments(task_id)`,
    `CREATE INDEX IF NOT EXISTS task_attachments_comment_idx ON task_attachments(comment_id) WHERE comment_id IS NOT NULL`,
  ];

  try {
    for (const sql of stmts) {
      await pool.query(sql);
    }
    logger.info('[tasks-v1] tables/columns ensured');
  } catch (e) {
    logger.warn(
      `[tasks-v1] ensure tables failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}
