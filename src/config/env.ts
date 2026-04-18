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
 * (postizService, shlinkService) — it throws on the request that needs the
 * var, so the failure is local to the feature instead of taking down boot.
 */

import logger from '../utils/logger';

const CRITICAL_ENV_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
] as const;

const IMPORTANT_ENV_VARS = [
  'POSTIZ_BASE_URL',
  'POSTIZ_API_KEY',
  'SHLINK_BASE_URL',
  'SHLINK_API_KEY',
  'REACHER_URL',
  'GOTENBERG_URL',
] as const;

function isMissing(name: string): boolean {
  const v = process.env[name];
  return !v || v.trim() === '';
}

export function validateEnv(): void {
  const missingCritical = CRITICAL_ENV_VARS.filter(isMissing);
  const missingImportant = IMPORTANT_ENV_VARS.filter(isMissing);

  if (missingImportant.length > 0) {
    logger.warn(
      { missing: missingImportant },
      `[env] WARNING: missing integration env vars — related features will fail until set: ${missingImportant.join(', ')}`,
    );
  }

  if (missingCritical.length === 0) return;

  if (process.env.NODE_ENV === 'production') {
    const msg = `[env] FATAL: missing critical environment variables in production: ${missingCritical.join(', ')}`;
    logger.error(msg);
    throw new Error(msg);
  }

  logger.warn(
    { missing: missingCritical },
    `[env] WARNING: missing critical env vars (non-production, continuing): ${missingCritical.join(', ')}`,
  );
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Required environment variable "${name}" is not set`);
  }
  return v;
}
