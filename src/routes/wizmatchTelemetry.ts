import { Router } from 'express';

/** Retained type for compatibility while telemetry callers/tests are removed. */
export interface TelemetryRouteEntry {
  id: string;
  label: string;
}

/** WizMatch navigation telemetry is retired, so there are no tracked routes. */
export const WIZMATCH_TELEMETRY_ROUTES: TelemetryRouteEntry[] = [];

/**
 * Boot compatibility hook. The retired telemetry table is intentionally not
 * created or touched anymore.
 */
export async function ensureWizmatchRouteViewsTable(): Promise<void> {
  return Promise.resolve();
}

/**
 * Compatibility sanitizer retained for any code/tests that still import it.
 * It does not persist or transmit telemetry.
 */
export function sanitizeViewPath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (!raw.startsWith('/') || raw.length > 512) return null;
  const [pathname, query = ''] = raw.split('?');
  if (!pathname || pathname.length > 200) return null;
  const tab = new URLSearchParams(query).get('tab');
  return tab && /^[a-z0-9-]{1,32}$/.test(tab) ? `${pathname}?tab=${tab}` : pathname;
}

const router = Router();

router.use((_req, res) => {
  res.status(410).json({
    error: 'retired',
    message: 'WizMatch telemetry has been retired.',
  });
});

export default router;
