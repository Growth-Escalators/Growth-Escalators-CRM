// Duck-types a cron's return value for a per-item error count. Covers the
// two shapes already used across worker.ts's crons: { errors: string[] }
// (Morning/Evening Briefing, Monthly Invoice Drafts) and { errors: number }.
// Returns 0 for any other shape (including void/undefined) — crons that
// don't track per-item errors are unaffected.
export function extractErrorCount(result: unknown): number {
  if (!result || typeof result !== 'object') return 0;
  const errors = (result as { errors?: unknown }).errors;
  if (Array.isArray(errors)) return errors.length;
  if (typeof errors === 'number' && Number.isFinite(errors)) return errors;
  return 0;
}
