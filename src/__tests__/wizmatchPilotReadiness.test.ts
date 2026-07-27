// PR 8A hardening (task 13) — the go-live readiness report must be read-only
// (no DB, no network, no migration/backfill) and must exit non-zero on every
// dangerous configuration named in the task's own test plan. This suite
// drives the pure `assessWizmatchPilotReadiness` function directly against
// the real repo filesystem (`.ai/`, `src/db/migrations/`) — read-only file
// access only, no network, no DB.

import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { assessWizmatchPilotReadiness } from '../services/wizmatchPilotReadiness';

const repoRoot = join(__dirname, '..', '..');

function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...overrides,
  } as NodeJS.ProcessEnv;
}

describe('assessWizmatchPilotReadiness — the safe shadow/all-off configuration', () => {
  it('passes with no dangerous findings when every flag is at its safe default', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot });
    expect(report.dangerous).toBe(false);
    expect(report.findings.filter((f) => f.severity === 'danger')).toEqual([]);
  });

  it('never includes a raw secret-shaped value in any finding message', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ SMARTLEAD_API_KEY: 'sk-super-secret-value-12345' }),
      repoRoot,
    });
    const joined = report.findings.map((f) => f.message).join('\n');
    expect(joined).not.toContain('sk-super-secret-value-12345');
  });
});

describe('assessWizmatchPilotReadiness — dangerous configurations (each must flip `dangerous` to true)', () => {
  it('enforce mode fails', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ WIZMATCH_POLICY_ENFORCEMENT_MODE: 'enforce' }), repoRoot });
    expect(report.dangerous).toBe(true);
  });

  it('a near-miss spelling of enforce does NOT fail (mirrors outreachGate.ts §16 rule 3 exactly)', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ WIZMATCH_POLICY_ENFORCEMENT_MODE: 'ENFORCE' }), repoRoot });
    expect(report.dangerous).toBe(false);
  });

  it('sending enabled fails', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ WIZMATCH_SENDING_ENABLED: 'true' }), repoRoot });
    expect(report.dangerous).toBe(true);
  });

  it('automated emails enabled fails', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ AUTOMATED_EMAILS_ENABLED: 'true' }), repoRoot });
    expect(report.dangerous).toBe(true);
  });

  it('adapter enabled fails', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ WIZMATCH_OUTREACH_ADAPTER_ENABLED: 'true' }), repoRoot });
    expect(report.dangerous).toBe(true);
  });

  it('preparation enabled fails for initial deployment', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ WIZMATCH_AUTO_PREP_ENABLED: 'true' }), repoRoot });
    expect(report.dangerous).toBe(true);
  });

  it('a Smartlead credential present fails, without printing the value', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ SMARTLEAD_API_KEY: 'sk-abc123' }), repoRoot });
    expect(report.dangerous).toBe(true);
    expect(report.findings.map((f) => f.message).join('\n')).not.toContain('sk-abc123');
  });

  it('any SMARTLEAD-shaped variable name fails, not only a specific known one', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ SMARTLEAD_WORKSPACE_TOKEN: 'x' }), repoRoot });
    expect(report.dangerous).toBe(true);
  });

  it('missing pilot roster in production fails', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ NODE_ENV: 'production' }), repoRoot });
    expect(report.dangerous).toBe(true);
  });

  it('missing pilot roster OUTSIDE production is a warning only, not dangerous', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot });
    expect(report.findings.find((f) => f.code === 'pilot-roster')?.severity).toBe('warning');
    expect(report.dangerous).toBe(false);
  });

  it('a configured pilot roster in production is fine (no roster-related danger)', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ NODE_ENV: 'production', WIZMATCH_STAFFING_PILOT_USER_IDS: 'user-1,user-2' }),
      repoRoot,
    });
    expect(report.findings.find((f) => f.code === 'pilot-roster')?.severity).toBe('ok');
  });

  it('an unrecognised/unimplemented provider combined with the adapter flag on fails', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ WIZMATCH_OUTREACH_ADAPTER_ENABLED: 'true', OUTREACH_PROVIDER: 'some_future_provider' }),
      repoRoot,
    });
    expect(report.dangerous).toBe(true);
  });

  it('paid discovery flags enabled fail', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ WIZMATCH_PAID_DISCOVERY_ENABLED: 'true' }), repoRoot });
    expect(report.dangerous).toBe(true);
  });

  it('a missing PR code-ready marker fails', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot: join(__dirname, 'fixtures', 'does-not-exist') });
    expect(report.dangerous).toBe(true);
    expect(report.findings.some((f) => f.code.startsWith('marker:') && f.severity === 'danger')).toBe(true);
  });
});

describe('assessWizmatchPilotReadiness — safety properties', () => {
  it('never throws even when the repo root is bogus (fails closed, reports what it can)', () => {
    expect(() => assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot: '/definitely/not/a/real/path' })).not.toThrow();
  });

  it('reports migration status as informational, never asserts anything about production application', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot });
    const migrationFinding = report.findings.find((f) => f.code === 'migration:status');
    expect(migrationFinding?.message).toMatch(/not checkable without a DB connection/);
  });

  it('reports backfill status as informational, never asserts anything about whether it was applied', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot });
    const backfillFinding = report.findings.find((f) => f.code === 'backfill:status');
    expect(backfillFinding?.message).toMatch(/not checkable without a DB connection/);
  });
});
