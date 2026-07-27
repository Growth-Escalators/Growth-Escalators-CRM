/**
 * PR 8A hardening (task 13) — Smartlead-free live-pilot go-live readiness
 * check. Read-only:
 *   - no database connection, no migration, no backfill
 *   - no network or provider call
 *   - reveals presence only for anything credential-shaped, never a value
 *
 * Usage:
 *   npm run wizmatch:pilot-readiness
 *
 * Exits non-zero when a dangerous configuration is detected.
 */
import { join } from 'node:path';
import { assessWizmatchPilotReadiness, formatWizmatchPilotReadinessReport } from '../src/services/wizmatchPilotReadiness';

const report = assessWizmatchPilotReadiness({ env: process.env, repoRoot: join(__dirname, '..') });
console.log(formatWizmatchPilotReadinessReport(report));
if (report.dangerous) process.exitCode = 1;
