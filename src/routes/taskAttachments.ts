/**
 * Task Attachments — URL entries + uploaded files share one table.
 *
 * Mounted at /api/tasks (same prefix as routes/tasks.ts) and exposes:
 *   POST   /:id/attachments                   (multipart: file OR url+label)
 *   GET    /:id/attachments
 *   GET    /:id/attachments/:attachmentId/download
 *   DELETE /:id/attachments/:attachmentId
 *
 * Storage: local filesystem at TASK_ATTACHMENT_DIR (default ./storage/task-attachments).
 * On Railway, mount a volume there (e.g. /var/storage/task-attachments).
 */

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { randomUUID } from 'crypto';
import { eq, and } from 'drizzle-orm';
import { db, tasks, pool } from '../db/index';
import logger from '../utils/logger';

const router = Router();

const STORAGE_ROOT =
  process.env.TASK_ATTACHMENT_DIR || path.resolve(process.cwd(), 'storage', 'task-attachments');

function ensureStorageDir(taskId: string): string {
  const dir = path.join(STORAGE_ROOT, taskId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sanitizeFilename(name: string): string {
  return (name || 'file')
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(0, 180);
}

// Multer with disk storage at /tmp first; we move into the per-task dir on success
// so we don't create dangling directories on validation failures.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 }, // 25MB
});

async function loadTaskForTenant(taskId: string, tenantId: string): Promise<boolean> {
  const [t] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.tenantId, tenantId)))
    .limit(1);
  return !!t;
}

// ---------------------------------------------------------------------------
// POST /:id/attachments  (multipart/form-data: file OR url+label)
// ---------------------------------------------------------------------------
router.post('/:id/attachments', upload.single('file'), async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const userId = req.user!.id;
    const taskId = req.params.id as string;

    if (!(await loadTaskForTenant(taskId, tenantId))) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    const file = (req as Request & { file?: Express.Multer.File }).file;
    const { url, label, commentId } = (req.body ?? {}) as {
      url?: string;
      label?: string;
      commentId?: string;
    };

    if (file) {
      const attachmentId = randomUUID();
      const dir = ensureStorageDir(taskId);
      const safeName = sanitizeFilename(file.originalname || 'file');
      const filename = `${attachmentId}-${safeName}`;
      const storagePath = path.join(dir, filename);

      fs.writeFileSync(storagePath, file.buffer);

      const apiUrl = `/api/tasks/${taskId}/attachments/${attachmentId}/download`;
      const inserted = await pool.query(
        `INSERT INTO task_attachments
           (id, task_id, comment_id, kind, label, url, storage_path, mime_type, size_bytes, added_by_user_id)
         VALUES ($1,$2,$3,'upload',$4,$5,$6,$7,$8,$9)
         RETURNING *`,
        [
          attachmentId,
          taskId,
          commentId || null,
          label || file.originalname || null,
          apiUrl,
          storagePath,
          file.mimetype || null,
          file.size,
          userId,
        ],
      );

      res.status(201).json({ attachment: inserted.rows[0] });
      return;
    }

    if (url && typeof url === 'string' && url.trim()) {
      const inserted = await pool.query(
        `INSERT INTO task_attachments
           (task_id, comment_id, kind, label, url, added_by_user_id)
         VALUES ($1,$2,'url',$3,$4,$5)
         RETURNING *`,
        [taskId, commentId || null, label || null, url.trim(), userId],
      );
      res.status(201).json({ attachment: inserted.rows[0] });
      return;
    }

    res.status(400).json({ error: 'file (multipart) or url required' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('File too large')) {
      res.status(413).json({ error: 'file too large (max 25MB)' });
      return;
    }
    logger.error('[taskAttachments] POST error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id/attachments — list all attachments for a task
// ---------------------------------------------------------------------------
router.get('/:id/attachments', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const taskId = req.params.id as string;
    if (!(await loadTaskForTenant(taskId, tenantId))) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    const r = await pool.query(
      `SELECT id, task_id AS "taskId", comment_id AS "commentId",
              kind, label, url, mime_type AS "mimeType", size_bytes AS "sizeBytes",
              added_by_user_id AS "addedByUserId", created_at AS "createdAt"
         FROM task_attachments
        WHERE task_id = $1
        ORDER BY created_at ASC`,
      [taskId],
    );
    res.json({ attachments: r.rows });
  } catch (err) {
    logger.error('[taskAttachments] GET list error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /:id/attachments/:attachmentId/download — stream the file
// ---------------------------------------------------------------------------
router.get('/:id/attachments/:attachmentId/download', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const taskId = req.params.id as string;
    const attachmentId = req.params.attachmentId as string;

    if (!(await loadTaskForTenant(taskId, tenantId))) {
      res.status(403).json({ error: 'forbidden' });
      return;
    }

    const r = await pool.query(
      `SELECT kind, storage_path, mime_type, label
         FROM task_attachments
        WHERE id = $1 AND task_id = $2`,
      [attachmentId, taskId],
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: 'attachment not found' });
      return;
    }
    const row = r.rows[0] as {
      kind: string;
      storage_path: string | null;
      mime_type: string | null;
      label: string | null;
    };

    if (row.kind !== 'upload' || !row.storage_path) {
      res.status(404).json({ error: 'not an uploaded file' });
      return;
    }
    if (!fs.existsSync(row.storage_path)) {
      res.status(404).json({ error: 'file missing on disk' });
      return;
    }

    if (row.mime_type) res.setHeader('Content-Type', row.mime_type);
    if (row.label) {
      res.setHeader(
        'Content-Disposition',
        `inline; filename="${row.label.replace(/"/g, '')}"`,
      );
    }
    fs.createReadStream(row.storage_path).pipe(res);
  } catch (err) {
    logger.error('[taskAttachments] GET download error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /:id/attachments/:attachmentId
// ---------------------------------------------------------------------------
router.delete('/:id/attachments/:attachmentId', async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const taskId = req.params.id as string;
    const attachmentId = req.params.attachmentId as string;

    if (!(await loadTaskForTenant(taskId, tenantId))) {
      res.status(404).json({ error: 'task not found' });
      return;
    }

    const r = await pool.query(
      `SELECT kind, storage_path FROM task_attachments WHERE id = $1 AND task_id = $2`,
      [attachmentId, taskId],
    );
    if (r.rows.length === 0) {
      res.status(404).json({ error: 'attachment not found' });
      return;
    }
    const row = r.rows[0] as { kind: string; storage_path: string | null };

    await pool.query(
      `DELETE FROM task_attachments WHERE id = $1 AND task_id = $2`,
      [attachmentId, taskId],
    );

    if (row.kind === 'upload' && row.storage_path) {
      try {
        fs.unlinkSync(row.storage_path);
      } catch (e) {
        logger.warn(`[taskAttachments] unlink failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    res.json({ ok: true, id: attachmentId });
  } catch (err) {
    logger.error('[taskAttachments] DELETE error:', err);
    res.status(500).json({ error: 'internal server error' });
  }
});

export default router;
