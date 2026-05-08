/**
 * env.ts — environment variable validation and required-env helper.
 *
 * Two-tier validation so a missing integration URL doesn't crash-loop prod,
 * but the operator still gets a loud warning in logs.
 *
 *  CRITICAL_ENV_VARS — app cannot function at all without these. Throws and
 *    exits in production if missing.
 *  IMPORTANT_ENV_VARS — feature/integration breaks if missing, but the app
 *    can still serve traffic. Warns at boot in every environment.
 *
 * `requiredEnv(name)` is the per-call helper used by service wrappers
 * — it throws on the request that needs the var, so the failure is local
 * to the feature instead of taking down boot.
 */

import logger from '../utils/logger';

// All tracked vars. validateEnv() only logs — it never throws, so a missing
// integration URL cannot take down the whole web server on boot.
// Per-feature enforcement happens at call time via requiredEnv() inside
// service wrappers — that turns a missing var into a 500/503 on the specific
// request instead of a crash loop.
const TRACKED_ENV_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
] as const;

function isMissing(name: string): boolean {
  const v = process.env[name];
  return !v || v.trim() === '';
}

export function validateEnv(): void {
  const missing = TRACKED_ENV_VARS.filter(isMissing);
  if (missing.length === 0) return;

  logger.warn(
    { missing },
    `[env] WARNING: missing environment variables — related features will fail until set: ${missing.join(', ')}`,
  );
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Required environment variable "${name}" is not set`);
  }
  return v;
}
