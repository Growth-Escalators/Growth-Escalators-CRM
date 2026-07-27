// D-R3 (owner-ratified) — H-2/H-3 fix. Subprocess-integration coverage for
// scripts/wizmatch-pilot-readiness.ts's --audit-env-file contract.
//
// This is the first subprocess-integration test file in this repo. It exists
// because the two defects this task closes — cwd-dependent env resolution,
// and a stale shell export silently outranking a clean .env — are properties
// of a REAL OS process's cwd and a REAL child environment. An in-process
// `import` of the CLI module cannot observe either: importing the script
// runs it in THIS process, sharing this process's cwd and env, which can
// never prove cwd-independence or "process.env was never mutated" in the
// caller. Every test below spawns the actual CLI as a real child process via
// `spawnSync`.
//
// Flag name note: the owner-ratified contract named this flag `--env-file`.
// It is `--audit-env-file` here because `--env-file` collides with Node.js's
// own native `--env-file` CLI flag (Node 20.6+), which intercepts the
// argument before the script ever runs — reproduced empirically against
// plain `node`, against `tsx`, and against this repo's actual
// `npm run wizmatch:pilot-readiness -- --env-file <path>` wrapper form. See
// the header comment in scripts/wizmatch-pilot-readiness.ts and this task's
// final report for the full empirical transcript.
//
// Merge-semantics note: the contract's literal `{ ...processEnv,
// ...parsedFileValues }` formula cannot satisfy its own required scenario
// (a stale shell credential ABSENT from the file must report clean) — see
// the CLI's header comment, deviation #2, for the empirical proof. This
// suite tests the corrected, self-consistent contract: when
// --audit-env-file is supplied, the assessed env is the file's contents
// ONLY (process.env is not consulted for anything the file doesn't set).

import { describe, it, expect, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const repoRoot = join(__dirname, '..', '..');
const tsxCli = join(repoRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const scriptPath = join(repoRoot, 'scripts', 'wizmatch-pilot-readiness.ts');

/** UUID-shaped, fabricated — matches nothing real. */
const PILOT_ID = '11111111-2222-4333-8444-555555555555';

interface CliResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawns the real CLI as a real child process. `execPath` + the resolved
 * tsx CLI entry file are used directly (rather than `npx tsx` or the
 * `node_modules/.bin/tsx` shim) so no PATH lookup or shebang resolution is
 * needed — the spawned child's `env` can be a tightly controlled, minimal
 * object with no ambient leakage from this test process, which is exactly
 * what scenarios 3/4/8/9 need to be trustworthy.
 */
function runCli(args: string[], env: NodeJS.ProcessEnv, cwd: string): CliResult {
  const result = spawnSync(process.execPath, [tsxCli, scriptPath, ...args], {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 30_000,
  });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

const tempDirs: string[] = [];
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wmpr-cli-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function writeSafeEnvFile(dir: string, extra: Record<string, string> = {}): string {
  const path = join(dir, 'safe.env');
  const lines = [`WIZMATCH_STAFFING_PILOT_USER_IDS=${PILOT_ID}`, ...Object.entries(extra).map(([k, v]) => `${k}=${v}`)];
  writeFileSync(path, lines.join('\n') + '\n');
  return path;
}

describe('wizmatch-pilot-readiness CLI — scenario 1: explicit safe env file from repo cwd', () => {
  it('exits 0 and reports the file as the configuration source', () => {
    const dir = makeTempDir();
    const envFile = writeSafeEnvFile(dir);
    const result = runCli(['--audit-env-file', envFile], {}, repoRoot);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Configuration source: file (${envFile})`);
    expect(result.stdout).toContain('RESULT: no dangerous configuration detected');
  });
});

describe('wizmatch-pilot-readiness CLI — scenario 2: cwd-independence', () => {
  it('produces an identical result for the same absolute env file from repo cwd and from os.tmpdir()', () => {
    const dir = makeTempDir();
    const envFile = writeSafeEnvFile(dir);
    const fromRepoRoot = runCli(['--audit-env-file', envFile], {}, repoRoot);
    const fromTmpdir = runCli(['--audit-env-file', envFile], {}, tmpdir());

    expect(fromRepoRoot.status).toBe(0);
    expect(fromTmpdir.status).toBe(0);

    // `Generated:` carries a real timestamp that legitimately differs
    // between two spawns a few milliseconds apart — normalise it before
    // comparing so the assertion targets everything ELSE being identical.
    const normalize = (s: string) => s.replace(/^Generated:.*$/m, 'Generated: <normalized>');
    expect(normalize(fromTmpdir.stdout)).toBe(normalize(fromRepoRoot.stdout));
  });
});

describe('wizmatch-pilot-readiness CLI — scenario 3: file overrides a stale shell boolean flag', () => {
  it('reports the safe file state (exit 0) even with WIZMATCH_SENDING_ENABLED=true in the spawned shell env', () => {
    const dir = makeTempDir();
    const envFile = writeSafeEnvFile(dir, { WIZMATCH_SENDING_ENABLED: 'false' });
    const result = runCli(['--audit-env-file', envFile], { WIZMATCH_SENDING_ENABLED: 'true' }, repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('RESULT: no dangerous configuration detected');
    expect(result.stdout).not.toMatch(/DANGER\s+\[flag:WIZMATCH_SENDING_ENABLED\]/);
  });
});

describe('wizmatch-pilot-readiness CLI — scenario 4: file overrides a stale shell credential, never leaked', () => {
  it('reports clean (exit 0) and never prints the canary value when the file has no credential at all', () => {
    const canary = `FAKE-CANARY-DO-NOT-USE-${Math.random().toString(36).slice(2)}-s4`;
    const dir = makeTempDir();
    const envFile = writeSafeEnvFile(dir); // deliberately no credential in the file
    const result = runCli(['--audit-env-file', envFile], { SMARTLEAD_API_KEY: canary }, repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('RESULT: no dangerous configuration detected');
    expect(result.stdout).not.toContain(canary);
    expect(result.stderr).not.toContain(canary);
    expect(result.stdout).not.toMatch(/DANGER\s+\[smartlead:credentials\]/);
  });
});

describe('wizmatch-pilot-readiness CLI — scenario 5: missing --audit-env-file path', () => {
  it('exits non-zero with a clear error naming the resolved path, no fallback', () => {
    const dir = makeTempDir();
    const missingPath = join(dir, 'does-not-exist.env');
    const result = runCli(['--audit-env-file', missingPath], {}, repoRoot);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--audit-env-file not found');
    expect(result.stderr).toContain(missingPath);
    // No report at all — it must not silently fall back to any other source.
    expect(result.stdout).not.toContain('WizMatch Smartlead-free live-pilot readiness');
  });
});

describe('wizmatch-pilot-readiness CLI — scenario 6: unreadable --audit-env-file', () => {
  it('exits non-zero with a clear error when the path is a directory, not a file', () => {
    const dir = makeTempDir();
    const asDir = join(dir, 'this-is-a-directory');
    mkdirSync(asDir);
    const result = runCli(['--audit-env-file', asDir], {}, repoRoot);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('--audit-env-file could not be read');
    expect(result.stderr).toContain(asDir);
  });

  it('exits non-zero with a clear error when the file exists but has no read permission', () => {
    const dir = makeTempDir();
    const envFile = writeSafeEnvFile(dir);
    chmodSync(envFile, 0o000);
    try {
      const result = runCli(['--audit-env-file', envFile], {}, repoRoot);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('--audit-env-file could not be read');
      expect(result.stderr).toContain(envFile);
    } finally {
      // Restore permissions so afterEach's rmSync can clean up the temp dir.
      chmodSync(envFile, 0o644);
    }
  });
});

describe('wizmatch-pilot-readiness CLI — scenario 7: --audit-env-file with dangerous values fails', () => {
  it('exits non-zero when the audited file has sending enabled', () => {
    const dir = makeTempDir();
    const envFile = writeSafeEnvFile(dir, { WIZMATCH_SENDING_ENABLED: 'true' });
    const result = runCli(['--audit-env-file', envFile], {}, repoRoot);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/DANGER\s+\[flag:WIZMATCH_SENDING_ENABLED\]/);
    expect(result.stdout).toContain('RESULT: NOT SAFE');
  });

  it('exits non-zero when the audited file has a Smartlead credential, without printing its value', () => {
    const canary = `FAKE-CANARY-DO-NOT-USE-${Math.random().toString(36).slice(2)}-s7`;
    const dir = makeTempDir();
    const envFile = writeSafeEnvFile(dir, { SMARTLEAD_API_KEY: canary });
    const result = runCli(['--audit-env-file', envFile], {}, repoRoot);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/DANGER\s+\[smartlead:credentials\]/);
    expect(result.stdout).toContain('RESULT: NOT SAFE');
    expect(result.stdout).not.toContain(canary);
    expect(result.stderr).not.toContain(canary);
  });
});

describe('wizmatch-pilot-readiness CLI — scenario 8: no --audit-env-file flag, safe process env', () => {
  it('exits 0 and reports configuration_source=process_environment', () => {
    const result = runCli([], { WIZMATCH_STAFFING_PILOT_USER_IDS: PILOT_ID }, repoRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Configuration source: process_environment');
    expect(result.stdout).toContain('RESULT: no dangerous configuration detected');
  });
});

describe('wizmatch-pilot-readiness CLI — scenario 9: no --audit-env-file flag, dangerous process env', () => {
  it('exits non-zero when a dangerous value is set directly in the process env with no file supplied', () => {
    const result = runCli([], { WIZMATCH_STAFFING_PILOT_USER_IDS: PILOT_ID, WIZMATCH_SENDING_ENABLED: 'true' }, repoRoot);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain('Configuration source: process_environment');
    expect(result.stdout).toMatch(/DANGER\s+\[flag:WIZMATCH_SENDING_ENABLED\]/);
    expect(result.stdout).toContain('RESULT: NOT SAFE');
  });
});

describe('wizmatch-pilot-readiness CLI — scenario 10: no credential value ever appears in captured output', () => {
  // Aggregates a fresh canary per sub-case across every scenario above that
  // involves a credential, re-run here with its own unique canary so a
  // failure in this describe block pinpoints exactly which path leaked.
  it('stale-shell-only credential (scenario 4 shape) never leaks', () => {
    const canary = `FAKE-CANARY-DO-NOT-USE-${Math.random().toString(36).slice(2)}-s10a`;
    const dir = makeTempDir();
    const envFile = writeSafeEnvFile(dir);
    const result = runCli(['--audit-env-file', envFile], { SMARTLEAD_API_KEY: canary }, repoRoot);
    expect(result.stdout).not.toContain(canary);
    expect(result.stderr).not.toContain(canary);
  });

  it('file-supplied credential (scenario 7 shape) never leaks', () => {
    const canary = `FAKE-CANARY-DO-NOT-USE-${Math.random().toString(36).slice(2)}-s10b`;
    const dir = makeTempDir();
    const envFile = writeSafeEnvFile(dir, { SL_API_KEY: canary });
    const result = runCli(['--audit-env-file', envFile], {}, repoRoot);
    expect(result.stdout).not.toContain(canary);
    expect(result.stderr).not.toContain(canary);
  });

  it('process-env-only credential with no file (scenario 8/9 shape) never leaks', () => {
    const canary = `FAKE-CANARY-DO-NOT-USE-${Math.random().toString(36).slice(2)}-s10c`;
    const result = runCli([], { WIZMATCH_STAFFING_PILOT_USER_IDS: PILOT_ID, SMARTLEAD_TOKEN: canary }, repoRoot);
    expect(result.stdout).not.toContain(canary);
    expect(result.stderr).not.toContain(canary);
    expect(result.stdout).toMatch(/DANGER\s+\[smartlead:credentials\]/);
  });
});

describe('wizmatch-pilot-readiness CLI — --production threading still works with --audit-env-file', () => {
  it('flags a NODE_ENV mismatch when --production is asserted against a file that omits NODE_ENV', () => {
    const dir = makeTempDir();
    const envFile = writeSafeEnvFile(dir);
    const result = runCli(['--production', '--audit-env-file', envFile], {}, repoRoot);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toMatch(/DANGER\s+\[runtime:NODE_ENV\]/);
  });

  it('passes when --production is asserted and the file sets NODE_ENV=production', () => {
    const dir = makeTempDir();
    const envFile = writeSafeEnvFile(dir, { NODE_ENV: 'production' });
    const result = runCli(['--production', '--audit-env-file', envFile], {}, repoRoot);

    expect(result.status).toBe(0);
  });
});
