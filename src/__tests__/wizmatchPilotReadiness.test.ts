// PR 8A hardening (task 13) — the go-live readiness report must be read-only
// (no DB, no network, no migration/backfill) and must exit non-zero on every
// dangerous configuration named in the task's own test plan. This suite
// drives the pure `assessWizmatchPilotReadiness` function directly against
// the real repo filesystem (`.ai/`, `src/db/migrations/`) — read-only file
// access only, no network, no DB.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
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

// PR 8A REVIEW fixes — two required danger conditions were not actually
// implemented as dangers, and one "roster configured" state was reported as a
// restricted pilot when it is an open deployment.
describe('assessWizmatchPilotReadiness — review fixes', () => {
  it('an unrecognised OUTREACH_PROVIDER is dangerous even while the adapter flag is OFF', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ OUTREACH_PROVIDER: 'smartlead_csv' }), repoRoot });
    expect(report.dangerous).toBe(true);
    expect(report.findings.find((f) => f.code === 'provider:selection')?.severity).toBe('danger');
  });

  it("the one provider that IS implemented ('mock') is not flagged while the adapter is off", () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ OUTREACH_PROVIDER: 'mock' }), repoRoot });
    expect(report.findings.find((f) => f.code === 'provider:selection')?.severity).toBe('ok');
    expect(report.dangerous).toBe(false);
  });

  it('an absent pilot roster is dangerous when the operator asserts a production target, without NODE_ENV', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot, assumeProductionTarget: true });
    expect(report.dangerous).toBe(true);
    expect(report.findings.find((f) => f.code === 'pilot-roster')?.severity).toBe('danger');
  });

  it('without the production assertion an absent roster stays a warning (unchanged local behaviour)', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot });
    expect(report.findings.find((f) => f.code === 'pilot-roster')?.severity).toBe('warning');
    expect(report.dangerous).toBe(false);
  });

  it('asserting --production while NODE_ENV is not exactly "production" is dangerous', () => {
    // The pilot roster gate fails closed ONLY on `NODE_ENV === 'production'`.
    // Nothing in the repo records that it is set at runtime, so a mismatch
    // between the asserted target and the actual value IS the finding.
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ WIZMATCH_STAFFING_PILOT_USER_IDS: 'user-a' }),
      repoRoot,
      assumeProductionTarget: true,
    });
    expect(report.dangerous).toBe(true);
    const finding = report.findings.find((f) => f.code === 'runtime:NODE_ENV');
    expect(finding?.severity).toBe('danger');
    expect(finding?.message).toMatch(/every pilot-eligible role/);
  });

  it('NODE_ENV=production with a roster is clean — no runtime finding fires', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ NODE_ENV: 'production', WIZMATCH_STAFFING_PILOT_USER_IDS: 'user-a' }),
      repoRoot,
      assumeProductionTarget: true,
    });
    expect(report.findings.find((f) => f.code === 'runtime:NODE_ENV')?.severity).toBe('ok');
    expect(report.dangerous).toBe(false);
  });

  it('the all-users override is NOT reported as a configured pilot roster in production', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ NODE_ENV: 'production', WIZMATCH_STAFFING_PILOT_ALL_USERS: 'true' }),
      repoRoot,
    });
    expect(report.dangerous).toBe(true);
    expect(report.findings.find((f) => f.code === 'pilot-roster')?.message).toMatch(/open deployment, not a restricted pilot/);
  });

  it('an explicit user-id roster in production passes and never prints the ids', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ NODE_ENV: 'production', WIZMATCH_STAFFING_PILOT_USER_IDS: 'user-aaa,user-bbb' }),
      repoRoot,
    });
    expect(report.findings.find((f) => f.code === 'pilot-roster')?.severity).toBe('ok');
    expect(report.findings.map((f) => f.message).join('\n')).not.toContain('user-aaa');
  });
});

// The pure assessor is only as good as what the CLI feeds it. These are
// static assertions on the CLI wrapper because the defect they pin is an
// ABSENT import, which no behavioural test of the assessor can observe.
describe('scripts/wizmatch-pilot-readiness.ts — the CLI wrapper', () => {
  const cliSource = readFileSync(join(repoRoot, 'scripts', 'wizmatch-pilot-readiness.ts'), 'utf8');
  /**
   * Comment-stripped, so a guard here can never be satisfied by a
   * commented-out or merely DOCUMENTED occurrence. The first draft of this
   * suite asserted against the raw text and passed with the dotenv import
   * commented out — the same evadable-static-guard class the PR 2 / PR 5 /
   * PR 7 / PR 8 reviews each found. Verified by a control run.
   */
  const cliCode = cliSource
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n');

  it("loads .env before reading process.env — the runbook's G3 step runs it against a copied .env", () => {
    // Without this, every safety flag in that file reads `undefined` -> "off"
    // -> exit 0: the CLI reports SAFE against a configuration with sending on.
    expect(cliCode).toMatch(/^\s*import\s+['"]dotenv\/config['"]/m);
  });

  it('threads the --production assertion through INTO the assessor call, not merely into a local', () => {
    expect(cliCode).toMatch(/--production/);
    // Asserting the identifier merely EXISTS is satisfied by its own `const`
    // declaration, so deleting the pass-through left this green (control run).
    // Pin the call site itself.
    expect(cliCode).toMatch(/assessWizmatchPilotReadiness\(\s*\{[^}]*assumeProductionTarget[^}]*\}\s*\)/);
  });

  it('opens no database connection and makes no network call', () => {
    expect(cliCode).not.toMatch(/\b(?:from\s+['"](?:pg|\.\.\/src\/db)|drizzle|fetch\s*\(|axios|https?:\/\/)/);
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
