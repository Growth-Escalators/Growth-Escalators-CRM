/**
 * PRD-005 §21.1 — cold-start policy readiness report, CLI form. Read-only:
 * runs the exact same tenant-scoped metrics as `GET /api/wizmatch/policy/readiness`.
 *
 * Usage:
 *   DATABASE_URL=... WIZMATCH_TENANT_ID=... npm run wizmatch:policy-readiness
 */
import 'dotenv/config';
import { getWizmatchPolicyReadiness } from '../src/modules/outreach/policyReadiness';
import { pool } from '../src/db/index';

async function main(): Promise<void> {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  if (!tenantId) {
    throw new Error('WIZMATCH_TENANT_ID is required.');
  }
  const report = await getWizmatchPolicyReadiness(tenantId);
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error) => {
    console.error('[wizmatch policy readiness] failed:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    void pool.end();
  });
