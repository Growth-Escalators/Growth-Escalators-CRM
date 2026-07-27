/**
 * PR 8A hardening (task 13) — Smartlead-free live-pilot go-live readiness
 * check. Read-only:
 *   - no database connection, no migration, no backfill
 *   - no network or provider call
 *   - reveals presence only for anything credential-shaped, never a value
 *
 * Usage:
 *   npm run wizmatch:pilot-readiness -- --audit-env-file <path>
 *       # assess the audited env file at <path>, deterministically —
 *       # resolved independent of the current working directory, and its
 *       # values win over any stale shell export.
 *   npm run wizmatch:pilot-readiness -- --production --audit-env-file <path>
 *       # assert that the environment being assessed is the PRODUCTION pilot
 *       # target. An absent pilot roster is a danger in every runtime (PR 8B —
 *       # the staffing gate no longer has a permissive non-production branch),
 *       # so this flag is no longer what catches that. It still escalates the
 *       # all-users override, and it turns a NODE_ENV that disagrees with the
 *       # asserted target into its own danger.
 *   npm run wizmatch:pilot-readiness
 *       # assess process.env as-is — NO file is read. Use this only when the
 *       # environment to be audited is already the process's own env (e.g. a
 *       # deployed service's live env), never as a substitute for
 *       # --audit-env-file.
 *
 * Exits non-zero when a dangerous configuration is detected, or when
 * --audit-env-file is supplied but does not resolve to a readable file
 * (fails closed — never silently falls back to cwd `.env` or to
 * process.env).
 */
// D-R3 (owner-ratified) — H-2/H-3 fix. The previous implementation did
// `import 'dotenv/config'`, which resolves `.env` relative to
// `process.cwd()` — silently diverging from `repoRoot` below (resolved from
// `__dirname`) whenever this CLI ran from any other directory, exactly what
// the go-live runbook's G3 step used to instruct ("copy .env, cd there, run
// this"). Worse, dotenv's `config()` never overrides an already-set
// `process.env` key, so a stale shell export (e.g. WIZMATCH_SENDING_ENABLED
// left on from an earlier dev session) would silently outrank a clean
// `.env`'s safe value. Both together meant this CLI — the mechanical G3
// go-live gate — could report SAFE against a dangerous real configuration.
//
// This CLI now takes an explicit `--audit-env-file <path>` argument,
// resolves it independent of cwd, parses it with zero side effects
// (`dotenv.parse`, never `dotenv.config`, so `process.env` itself is never
// mutated), and merges the file's values OVER `process.env` so the audited
// file is authoritative over any stale export. With no `--audit-env-file`,
// it reads `process.env` only — it never goes looking for a `.env` anywhere.
//
// TWO DOCUMENTED DEVIATIONS FROM THE OWNER-RATIFIED D-R3 CONTRACT AS
// LITERALLY WRITTEN (neither silent — both verified empirically, see this
// task's final report for the full transcript):
//
// 1. FLAG NAME: the contract as written named this flag `--env-file`.
//    Empirically verified (three independent methods, including this repo's
//    actual npm wrapper) that `--env-file` collides with Node.js's OWN
//    native `--env-file` CLI flag (added Node 20.6+): Node's bootstrap argv
//    parser intercepts it and attempts to load the path as ITS OWN env file
//    — before this script's code runs at all — regardless of where the flag
//    appears in argv, INCLUDING after the script path, e.g.:
//      node script.js --env-file /missing/path        -> "node: /missing/path: not found", exit 9
//      npx tsx script.ts --env-file /missing/path      -> same interception
//      npm run wizmatch:pilot-readiness -- --env-file /missing/path -> same interception
//    A literal `--` immediately before the flag works around it
//    (`tsx script.ts -- --env-file <path>`), but the natural single-`--` npm
//    form this repo's package.json script actually produces is exactly the
//    broken form, and the workaround requires editing package.json (out of
//    this change's ownership) to make ergonomic. Silently forgetting the
//    extra `--` would mean Node's OWN env loader activates instead of this
//    script's deterministic, file-authoritative one — a subtler and more
//    dangerous failure mode than the bug this fix exists to close.
//    `--audit-env-file` is not a reserved Node flag and was verified
//    collision-free in the identical invocation forms above.
//
// 2. MERGE SEMANTICS: the contract as written specifies merging as
//    `{ ...processEnv, ...parsedFileValues }` (file overrides only the keys
//    it explicitly sets; any OTHER ambient process.env key passes through
//    unchanged). That literal formula cannot satisfy the contract's own
//    required test scenario "a stale shell Smartlead credential ABSENT from
//    the audited file must report clean" — under the literal formula, a
//    credential the file does not mention still flows through from
//    processEnv untouched and is (correctly, under that formula) flagged
//    dangerous, which contradicts "must report clean". Verified empirically
//    by implementing the literal formula and observing exactly this failure.
//    Resolved as: when `--audit-env-file` IS supplied, the assessed env is
//    the file's parsed values ONLY — process.env is not consulted at all for
//    keys the file doesn't set. This is the only reading that satisfies both
//    "file wins on a key both sides set" and "file is authoritative full
//    stop, including for what it omits", and it is the stricter, more
//    secure reading of "the audited file is authoritative": a deterministic
//    audit should depend solely on what's in the file, never on whatever a
//    calling shell happens to have lying around. With NO `--audit-env-file`,
//    the assessed env remains `process.env` unchanged, as specified.
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parse as parseDotenv } from 'dotenv';
import { assessWizmatchPilotReadiness, formatWizmatchPilotReadinessReport } from '../src/services/wizmatchPilotReadiness';

interface ResolvedAuditedEnv {
  env: NodeJS.ProcessEnv;
  source: 'file' | 'process_environment';
  resolvedPath?: string;
}

/**
 * Resolves the environment to assess. Never mutates `process.env` — only
 * builds and returns a new merged object. Fails closed: a supplied
 * `--audit-env-file` that cannot be found or read is a hard error (non-zero
 * exit), never a silent fallback to cwd `.env` or to `process.env` alone.
 */
function resolveAuditedEnv(envFilePathArg: string | undefined, processEnv: NodeJS.ProcessEnv): ResolvedAuditedEnv {
  if (envFilePathArg === undefined) {
    return { env: processEnv, source: 'process_environment' };
  }
  const resolvedPath = resolve(envFilePathArg);
  if (!existsSync(resolvedPath)) {
    console.error(`--audit-env-file not found: ${resolvedPath}`);
    process.exit(1);
  }
  let raw: string;
  try {
    raw = readFileSync(resolvedPath, 'utf8');
  } catch (error) {
    console.error(`--audit-env-file could not be read: ${resolvedPath} (${error instanceof Error ? error.message : String(error)})`);
    process.exit(1);
  }
  const parsedFileValues = parseDotenv(raw);
  // File-only, no merge with process.env (see deviation #2 above) — the
  // audited file is fully authoritative, so a stale shell export the file
  // doesn't mention cannot leak into the assessment at all.
  return { env: parsedFileValues, source: 'file', resolvedPath };
}

const argv = process.argv.slice(2);
const assumeProductionTarget = argv.includes('--production');
const envFileIdx = argv.indexOf('--audit-env-file');
const envFilePathArg = envFileIdx >= 0 ? argv[envFileIdx + 1] : undefined;

const { env: auditedEnv, source: configurationSourceKind, resolvedPath } = resolveAuditedEnv(envFilePathArg, process.env);
const configurationSource = { source: configurationSourceKind, resolvedPath };

const report = assessWizmatchPilotReadiness({
  env: auditedEnv,
  repoRoot: join(__dirname, '..'),
  assumeProductionTarget,
  configurationSource,
});
console.log(formatWizmatchPilotReadinessReport(report));
if (report.dangerous) process.exitCode = 1;
