import { Router } from 'express';

/**
 * Compatibility helper retained for generic callers/tests while the retired
 * WizMatch implementation is removed. It performs no WizMatch work.
 */
export function clampListLimit(raw: unknown, fallback: number, max: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number.parseInt(value, 10)
      : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

const router = Router();

/**
 * WizMatch has been retired from Growth Escalators CRM.
 * Keep the old API prefix terminal during the cleanup window so stale clients,
 * bookmarks, scheduled callers, and integrations cannot execute legacy logic.
 */
router.use((_req, res) => {
  res.status(410).json({
    error: 'retired',
    message: 'WizMatch has been retired. Use Growth Escalators CRM.',
  });
});

export default router;
