// PR 8A hardening (task 13) — the go-live readiness report must be read-only
// (no DB, no network, no migration/backfill) and must exit non-zero on every
// dangerous configuration named in the task's own test plan. This suite
// drives the pure `assessWizmatchPilotReadiness` function directly against
// the real repo filesystem (`.ai/`, `src/db/migrations/`) — read-only file
// access only, no network, no DB.

import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  assessWizmatchPilotReadiness,
  formatWizmatchPilotReadinessReport,
  PROVIDER_CREDENTIAL_ENV_VAR_MAP,
} from '../services/wizmatchPilotReadiness';

const repoRoot = join(__dirname, '..', '..');

/** UUID-shaped, fabricated — matches nothing real. */
const PILOT_ID_A = '11111111-2222-4333-8444-555555555555';
const PILOT_ID_B = '66666666-7777-4888-8999-aaaaaaaaaaaa';

/**
 * PR 8B — a configured roster is now part of the SAFE baseline, not an
 * optional extra: `resolveStaffingAccess` fails closed in every runtime, so an
 * absent roster is dangerous everywhere. Tests that exercise the missing/empty
 * roster cases override this explicitly.
 */
function baseEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    WIZMATCH_STAFFING_PILOT_USER_IDS: `${PILOT_ID_A},${PILOT_ID_B}`,
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
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ NODE_ENV: 'production', WIZMATCH_STAFFING_PILOT_USER_IDS: '' }),
      repoRoot,
    });
    expect(report.dangerous).toBe(true);
  });

  it('a configured pilot roster in production is fine (no roster-related danger)', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ NODE_ENV: 'production' }),
      repoRoot,
    });
    expect(report.findings.find((f) => f.code === 'pilot-roster')?.severity).toBe('ok');
    expect(report.findings.find((f) => f.code === 'pilot-roster:format')?.severity).toBe('ok');
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
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ WIZMATCH_STAFFING_PILOT_USER_IDS: '' }),
      repoRoot,
      assumeProductionTarget: true,
    });
    expect(report.dangerous).toBe(true);
    expect(report.findings.find((f) => f.code === 'pilot-roster')?.severity).toBe('danger');
  });

  it('asserting --production while NODE_ENV is not exactly "production" is dangerous', () => {
    // `NODE_ENV` no longer selects the pilot gate's fail-closed branch (PR 8B),
    // but it still selects production-only Express behaviour, and nothing in
    // the repo records that it is set at runtime — so a mismatch between the
    // asserted target and the actual value IS the finding.
    const report = assessWizmatchPilotReadiness({
      env: baseEnv(),
      repoRoot,
      assumeProductionTarget: true,
    });
    expect(report.dangerous).toBe(true);
    const finding = report.findings.find((f) => f.code === 'runtime:NODE_ENV');
    expect(finding?.severity).toBe('danger');
    expect(finding?.message).toMatch(/production-only Express behaviour/);
  });

  it('NODE_ENV=production with a roster is clean — no runtime finding fires', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ NODE_ENV: 'production' }),
      repoRoot,
      assumeProductionTarget: true,
    });
    expect(report.findings.find((f) => f.code === 'runtime:NODE_ENV')?.severity).toBe('ok');
    expect(report.dangerous).toBe(false);
  });

  // M-2 (PR 8A) — the all-users override must never be reported as a restricted
  // pilot. PR 8B makes it dangerous in EVERY runtime, not only a production
  // target: the staffing gate has no environment condition left, so this admits
  // every pilot-eligible role everywhere.
  it.each([
    ['NODE_ENV=production', { NODE_ENV: 'production' }, false],
    ['no NODE_ENV and no --production', {}, false],
    ['NODE_ENV=development', { NODE_ENV: 'development' }, false],
    ['--production asserted', {}, true],
  ] as const)('the all-users override is dangerous with %s', (_label, envOverrides, assumeProductionTarget) => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({
        ...envOverrides,
        WIZMATCH_STAFFING_PILOT_USER_IDS: '',
        WIZMATCH_STAFFING_PILOT_ALL_USERS: 'true',
      }),
      repoRoot,
      assumeProductionTarget,
    });
    expect(report.dangerous).toBe(true);
    const finding = report.findings.find((f) => f.code === 'pilot-roster');
    expect(finding?.severity).toBe('danger');
    expect(finding?.message).toMatch(/open deployment, not a restricted pilot/);
  });

  it('an explicit user-id roster in production passes and never prints the ids', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ NODE_ENV: 'production' }),
      repoRoot,
    });
    expect(report.findings.find((f) => f.code === 'pilot-roster')?.severity).toBe('ok');
    expect(report.findings.map((f) => f.message).join('\n')).not.toContain(PILOT_ID_A);
  });
});

// PR 8B / P8B-4 — a Smartlead credential parked under an alias that contains
// no "smartlead" anywhere in its name was completely invisible to the old
// substring-only detector.
describe('assessWizmatchPilotReadiness — Smartlead credential alias detection', () => {
  const smartleadAliases = PROVIDER_CREDENTIAL_ENV_VAR_MAP.smartlead_csv;

  it('exposes a non-empty alias list for the smartlead_csv provider', () => {
    expect(smartleadAliases.length).toBeGreaterThan(0);
  });

  it('SL_API_KEY — an alias with no "smartlead" in the name — is dangerous', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ SL_API_KEY: 'fake-not-a-real-key-000' }),
      repoRoot,
    });
    expect(report.dangerous).toBe(true);
    const finding = report.findings.find((f) => f.code === 'smartlead:credentials');
    expect(finding?.severity).toBe('danger');
    expect(finding?.message).toContain('SL_API_KEY');
    expect(report.findings.map((f) => f.message).join('\n')).not.toContain('fake-not-a-real-key-000');
  });

  // Data-driven off the map itself, so a future entry is covered automatically
  // and a duplicated hardcoded list in the assessor could not satisfy it.
  it.each([...smartleadAliases])('%s present with a value is dangerous and its value is never printed', (name) => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ [name]: 'fake-credential-value-zzz' }),
      repoRoot,
    });
    expect(report.dangerous).toBe(true);
    const finding = report.findings.find((f) => f.code === 'smartlead:credentials');
    expect(finding?.severity).toBe('danger');
    expect(finding?.message).toContain(name);
    expect(report.findings.map((f) => f.message).join('\n')).not.toContain('fake-credential-value-zzz');
  });

  it.each([...smartleadAliases])('%s set to an empty/whitespace value is NOT flagged', (name) => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ [name]: '   ' }), repoRoot });
    expect(report.findings.find((f) => f.code === 'smartlead:credentials')?.severity).toBe('ok');
    expect(report.dangerous).toBe(false);
  });

  it('an unrelated SL_-prefixed variable is NOT flagged — detection is exact-name, never a prefix test', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ SL_TIMEZONE: 'Asia/Kolkata', SL_MAX_RETRIES: '3' }),
      repoRoot,
    });
    const finding = report.findings.find((f) => f.code === 'smartlead:credentials');
    expect(finding?.severity).toBe('ok');
    expect(finding?.message).not.toContain('SL_TIMEZONE');
    expect(report.dangerous).toBe(false);
  });
});

// PR 8B — `resolveStaffingAccess` computes `allowed = configured && pilotAllowed`
// unconditionally; the old `NODE_ENV === 'production' ? strict : permissive`
// branch is gone. A missing roster is therefore broken-by-omission in every
// runtime, and a typo'd id silently excludes its intended member.
describe('assessWizmatchPilotReadiness — pilot roster fails closed in every runtime', () => {
  it('a missing roster with no --production and no NODE_ENV is DANGER, not a warning', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ WIZMATCH_STAFFING_PILOT_USER_IDS: '' }),
      repoRoot,
    });
    expect(report.findings.find((f) => f.code === 'pilot-roster')?.severity).toBe('danger');
    expect(report.dangerous).toBe(true);
  });

  it('a whitespace-only roster is DANGER in development', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ NODE_ENV: 'development', WIZMATCH_STAFFING_PILOT_USER_IDS: '   \t ' }),
      repoRoot,
    });
    expect(report.findings.find((f) => f.code === 'pilot-roster')?.severity).toBe('danger');
    expect(report.dangerous).toBe(true);
  });

  it('a whitespace-only roster is DANGER in production too', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ NODE_ENV: 'production', WIZMATCH_STAFFING_PILOT_USER_IDS: '  ' }),
      repoRoot,
    });
    expect(report.findings.find((f) => f.code === 'pilot-roster')?.severity).toBe('danger');
    expect(report.dangerous).toBe(true);
  });

  it('a malformed roster is DANGER and reports a COUNT, never the ids themselves', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ WIZMATCH_STAFFING_PILOT_USER_IDS: 'not-a-uuid, also-bad' }),
      repoRoot,
    });
    const finding = report.findings.find((f) => f.code === 'pilot-roster:format');
    expect(finding?.severity).toBe('danger');
    expect(finding?.message).toContain('2 malformed');
    expect(report.dangerous).toBe(true);
    const joined = report.findings.map((f) => f.message).join('\n');
    expect(joined).not.toContain('not-a-uuid');
    expect(joined).not.toContain('also-bad');
  });

  it('a partially malformed roster counts only the bad entries', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ WIZMATCH_STAFFING_PILOT_USER_IDS: `${PILOT_ID_A} typo-id` }),
      repoRoot,
    });
    const finding = report.findings.find((f) => f.code === 'pilot-roster:format');
    expect(finding?.severity).toBe('danger');
    expect(finding?.message).toContain('1 malformed entry');
  });

  it('a well-formed UUID roster raises no malformed-roster danger', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot });
    expect(report.findings.find((f) => f.code === 'pilot-roster:format')?.severity).toBe('ok');
    expect(report.dangerous).toBe(false);
  });

  it('the all-users override reports no roster-format finding at all (there is no id list to check)', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv({ WIZMATCH_STAFFING_PILOT_USER_IDS: '', WIZMATCH_STAFFING_PILOT_ALL_USERS: 'true' }),
      repoRoot,
    });
    expect(report.findings.find((f) => f.code === 'pilot-roster:format')).toBeUndefined();
  });
});

// The pure assessor is only as good as what the CLI feeds it. These are
// static assertions on the CLI wrapper because the defects they pin (an
// absent import, an implicit cwd-relative `.env` load) are import-time /
// argv-parsing behaviour that no behavioural test of the assessor alone can
// observe. Full behavioural coverage of the new --env-file contract
// (cwd-independence, file-over-stale-shell-export authority, credential
// non-leakage) lives in the real subprocess integration suite at
// `src/__tests__/wizmatchPilotReadinessCli.test.ts` — an in-process import
// can't honestly test cwd-independence or "process.env was never mutated".
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

  // D-R3 (owner-ratified) — H-2/H-3 fix. `import 'dotenv/config'` resolved
  // `.env` relative to `process.cwd()`, silently diverging from `repoRoot`
  // (resolved from `__dirname`) whenever the CLI ran from any other
  // directory, and dotenv's `config()` never overrides an already-set
  // `process.env` key. Both are gone: the CLI no longer has any import-time
  // env-loading side effect at all.
  it('no longer has an import-time dotenv/config side effect (cwd-relative .env load is gone)', () => {
    expect(cliCode).not.toMatch(/^\s*import\s+['"]dotenv\/config['"]/m);
  });

  it('imports only the pure, side-effect-free dotenv.parse — never dotenv.config, which mutates process.env', () => {
    expect(cliCode).toMatch(/import\s*\{\s*parse\s+as\s+parseDotenv\s*\}\s*from\s+['"]dotenv['"]/);
    expect(cliCode).not.toMatch(/dotenv\.config\(/);
  });

  it('parses --audit-env-file explicitly rather than relying on any implicit .env lookup', () => {
    // Named --audit-env-file, not the owner-ratified contract's literal
    // --env-file: empirically verified (see this task's final report) that
    // --env-file collides with Node.js's OWN native --env-file CLI flag
    // (Node 20.6+), which intercepts it before this script's code runs at
    // all — reproduced via plain `node`, via `tsx`, and via this repo's
    // actual `npm run wizmatch:pilot-readiness -- --env-file <path>`
    // wrapper form. A non-reserved flag name was required to make the
    // argument actually reach this script.
    expect(cliCode).toMatch(/--audit-env-file/);
    expect(cliCode).toMatch(/resolve\(envFilePathArg\)/);
  });

  it('threads the --production assertion through INTO the assessor call, not merely into a local', () => {
    expect(cliCode).toMatch(/--production/);
    // Asserting the identifier merely EXISTS is satisfied by its own `const`
    // declaration, so deleting the pass-through left this green (control run).
    // Pin the call site itself.
    expect(cliCode).toMatch(/assessWizmatchPilotReadiness\(\s*\{[^}]*assumeProductionTarget[^}]*\}\s*\)/);
  });

  it('threads the resolved configuration source INTO the assessor call, not merely into a local', () => {
    expect(cliCode).toMatch(/assessWizmatchPilotReadiness\(\s*\{[^}]*configurationSource[^}]*\}\s*\)/);
  });

  it('opens no database connection and makes no network call', () => {
    expect(cliCode).not.toMatch(/\b(?:from\s+['"](?:pg|\.\.\/src\/db)|drizzle|fetch\s*\(|axios|https?:\/\/)/);
  });
});

describe('formatWizmatchPilotReadinessReport — configuration source line', () => {
  it('prints the resolved path in file mode, and no other field', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv(),
      repoRoot,
      configurationSource: { source: 'file', resolvedPath: '/tmp/example/.env.audited' },
    });
    const text = formatWizmatchPilotReadinessReport(report);
    expect(text).toContain('Configuration source: file (/tmp/example/.env.audited)');
  });

  it('prints process_environment when no file was used', () => {
    const report = assessWizmatchPilotReadiness({
      env: baseEnv(),
      repoRoot,
      configurationSource: { source: 'process_environment' },
    });
    const text = formatWizmatchPilotReadinessReport(report);
    expect(text).toContain('Configuration source: process_environment');
  });

  it('omits the configuration-source line entirely when the caller supplies none (back-compat)', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot });
    const text = formatWizmatchPilotReadinessReport(report);
    expect(text).not.toContain('Configuration source:');
  });
});

describe('assessWizmatchPilotReadiness — safety properties', () => {
  it('never throws even when the repo root is bogus (fails closed, reports what it can)', () => {
    expect(() => assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot: '/definitely/not/a/real/path' })).not.toThrow();
  });

  it('reports migration status as informational, never asserts anything about production application', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot });
    const migrationFinding = report.findings.find((f) => f.code === 'migration:status');
    // 0038 (users.is_active, failure-matrix M-3) is authorised and at the
    // high-water mark, so the sentinel stays quiet and the informational message
    // is reported. The point of this test is unchanged: whatever it says, it must
    // describe the filesystem and explicitly decline to claim anything about
    // whether a migration is APPLIED to a database.
    expect(migrationFinding?.severity).toBe('ok');
    expect(migrationFinding?.message).toMatch(/not checkable without a DB connection/);
  });

  it('warns when a migration ABOVE the authorised high-water mark appears', () => {
    // The sentinel must still catch an unreviewed migration — moving the mark to
    // 0038 must not have turned it off. Uses a temporary 0039 file so the
    // assertion exercises the real filesystem branch rather than a stub.
    const migrationsDir = join(repoRoot, 'src', 'db', 'migrations');
    const probe = join(migrationsDir, '0039__readiness_sentinel_probe.sql');
    writeFileSync(probe, '-- temporary probe written and removed by wizmatchPilotReadiness.test.ts\n');
    try {
      const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot });
      const migrationFinding = report.findings.find((f) => f.code === 'migration:status');
      expect(migrationFinding?.severity).toBe('warning');
      expect(migrationFinding?.message).toMatch(/beyond the authorised high-water mark/);
      expect(migrationFinding?.message).toContain('0039__readiness_sentinel_probe.sql');
    } finally {
      rmSync(probe, { force: true });
    }
  });

  it('reports backfill status as informational, never asserts anything about whether it was applied', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot });
    const backfillFinding = report.findings.find((f) => f.code === 'backfill:status');
    expect(backfillFinding?.message).toMatch(/not checkable without a DB connection/);
  });
});

describe('assessWizmatchPilotReadiness — email verification provider (warning, not danger)', () => {
  it('warns (never dangers) when neither Reacher nor MillionVerifier is configured', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv(), repoRoot });
    const finding = report.findings.find((f) => f.code === 'email-verification:provider');
    expect(finding?.severity).toBe('warning');
    expect(finding?.message).toMatch(/both unset/);
    // A missing verifier degrades quality, it does not threaten pilot safety.
    expect(report.dangerous).toBe(false);
  });

  it('is ok when REACHER_BASE_URL is configured', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ REACHER_BASE_URL: 'https://reacher.example' }), repoRoot });
    const finding = report.findings.find((f) => f.code === 'email-verification:provider');
    expect(finding?.severity).toBe('ok');
    expect(finding?.message).toContain('REACHER_BASE_URL');
  });

  it('is ok when only MILLIONVERIFIER_API_KEY is configured', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ MILLIONVERIFIER_API_KEY: 'test-key' }), repoRoot });
    const finding = report.findings.find((f) => f.code === 'email-verification:provider');
    expect(finding?.severity).toBe('ok');
    expect(finding?.message).toContain('MILLIONVERIFIER_API_KEY');
  });

  it('never prints the MillionVerifier key value', () => {
    const report = assessWizmatchPilotReadiness({ env: baseEnv({ MILLIONVERIFIER_API_KEY: 'sk-super-secret-mv-key' }), repoRoot });
    const joined = report.findings.map((f) => f.message).join('\n');
    expect(joined).not.toContain('sk-super-secret-mv-key');
  });
});
