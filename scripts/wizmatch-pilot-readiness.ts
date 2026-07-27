/**
 * PR 8A hardening (task 13) — Smartlead-free live-pilot go-live readiness
 * check. Read-only:
 *   - no database connection, no migration, no backfill
 *   - no network or provider call
 *   - reveals presence only for anything credential-shaped, never a value
 *
 * Usage:
 *   npm run wizmatch:pilot-readiness              # assess as-is
 *   npm run wizmatch:pilot-readiness -- --production
 *       # assert that the environment being assessed is the PRODUCTION pilot
 *       # target. Escalates the production-only checks (currently: an absent
 *       # pilot roster) from a warning to a danger, so the runbook's G3 step
 *       # can be run against a copied `.env` — which will not carry
 *       # NODE_ENV=production — and still catch a missing roster.
 *
 * Exits non-zero when a dangerous configuration is detected.
 */
// PR 8A review fix — MUST load `.env` before reading `process.env`. Every
// other readiness/backfill script in this repo does (`wizmatch-policy-readiness.ts`,
// `wizmatch-staffing-backfill-preview.ts`), and the go-live runbook's G3 step
// explicitly tells an operator to run this "against an identical local `.env`
// copy". Without this import the CLI read none of that file, so every safety
// flag resolved to `undefined` -> "off" -> exit 0: it reported SAFE against a
// configuration with sending enabled.
import 'dotenv/config';
import { join } from 'node:path';
import { assessWizmatchPilotReadiness, formatWizmatchPilotReadinessReport } from '../src/services/wizmatchPilotReadiness';

const assumeProductionTarget = process.argv.slice(2).includes('--production');
const report = assessWizmatchPilotReadiness({
  env: process.env,
  repoRoot: join(__dirname, '..'),
  assumeProductionTarget,
});
console.log(formatWizmatchPilotReadinessReport(report));
if (report.dangerous) process.exitCode = 1;
