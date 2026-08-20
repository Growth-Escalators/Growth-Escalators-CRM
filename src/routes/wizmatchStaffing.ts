import { Router } from 'express';

/**
 * Compatibility export retained while WizMatch callers/tests are removed.
 * Staffing phases can no longer be enabled in any runtime.
 */
export function isStaffingPhaseEnabled(_phase: 'A' | 'B' | 'C'): boolean {
  return false;
}

const router = Router();

router.use((_req, res) => {
  res.status(410).json({
    error: 'retired',
    message: 'WizMatch staffing has been retired. Use Growth Escalators CRM.',
  });
});

export default router;
