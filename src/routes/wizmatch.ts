import { Router } from 'express';

/**
 * Compatibility helpers retained for generic callers/tests while the retired
 * WizMatch implementation is removed. They perform no WizMatch work.
 */
export function clampListLimit(raw: unknown, fallback: number, max: number): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(parsed) || parsed === 0) return fallback;
  return Math.min(Math.max(Math.floor(parsed), 1), max);
}

export function clampListOffset(raw: unknown): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string'
      ? Number(value)
      : Number.NaN;

  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.floor(parsed);
}

const router = Router();

/**
 * WizMatch has been retired from Growth Escalators CRM.
 * Keep the old API prefix terminal during the cleanup window so stale clients,
 * bookmarks, scheduled callers, and integrations cannot execute legacy logic.
 * This is intentionally a retirement boundary, not a replacement feature.
 */
router.use((_req, res) => {
  res.status(410).json({
    error: 'retired',
    message: 'WizMatch has been retired. Use Growth Escalators CRM.',
  });
});

export default router;
