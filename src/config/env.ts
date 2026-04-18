/**
 * env.ts — environment variable validation and required-env helper.
 *
 * Two exports:
 *   - validateEnv(): called once at boot from src/index.ts. In production it
 *     throws if any required env var is missing (fail-fast deploy). In other
 *     environments it logs a warning so local dev isn't blocked.
 *   - requiredEnv(name): used by service wrappers to read an env var that
 *     must be present. Throws synchronously if missing — replaces silent
 *     hardcoded URL fallbacks.
 */

import logger from '../utils/logger';

const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'POSTIZ_BASE_URL',
  'POSTIZ_API_KEY',
  'SHLINK_BASE_URL',
  'SHLINK_API_KEY',
  'REACHER_URL',
  'GOTENBERG_URL',
] as const;

export function validateEnv(): void {
  const missing = REQUIRED_ENV_VARS.filter(name => {
    const v = process.env[name];
    return !v || v.trim() === '';
  });

  if (missing.length === 0) return;

  if (process.env.NODE_ENV === 'production') {
    const msg = `[env] FATAL: missing required environment variables in production: ${missing.join(', ')}`;
    logger.error(msg);
    throw new Error(msg);
  }

  logger.warn(
    { missing },
    `[env] WARNING: missing environment variables (non-production, continuing): ${missing.join(', ')}`,
  );
}

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Required environment variable "${name}" is not set`);
  }
  return v;
}
