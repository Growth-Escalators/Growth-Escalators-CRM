// PR 8A hardening (task 13) — Smartlead-free live-pilot go-live readiness
// check. Read-only by construction:
//   - NO database connection, NO migration, NO backfill, NO network or
//     provider call.
//   - Reveals presence only for anything credential-shaped — never a value
//     (same convention as `wizmatchEnvCheck.ts`).
//   - Reports migration/backfill STATUS from the filesystem only (journal +
//     script existence); it never applies either.
//
// This module is the pure, testable core; `scripts/wizmatch-pilot-readiness.ts`
// is the thin CLI wrapper that calls it against real `process.env` and the
// real repo filesystem, and sets `process.exitCode` on a dangerous finding.

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export type PilotReadinessSeverity = 'ok' | 'warning' | 'danger';

export interface PilotReadinessFinding {
  code: string;
  severity: PilotReadinessSeverity;
  message: string;
}

/**
 * D-R3 (owner-ratified) — H-2/H-3 fix. Where the audited environment came
 * from: an explicit `--env-file` (resolved cwd-independently, file values
 * authoritative over any stale shell export) or the ambient `process.env`
 * only (no file read at all). Purely informational — never affects any
 * finding's severity, and never carries a parsed value, only the source kind
 * and the resolved path in file mode.
 */
export interface PilotReadinessConfigurationSource {
  source: 'file' | 'process_environment';
  resolvedPath?: string;
}

export interface PilotReadinessReport {
  findings: PilotReadinessFinding[];
  /** True when ANY finding is `danger` — the CLI exits non-zero exactly on this. */
  dangerous: boolean;
  generatedAt: string;
  /** Optional and additive — omitted when the caller doesn't supply one. */
  configurationSource?: PilotReadinessConfigurationSource;
}

function isEnabled(value: string | undefined): boolean {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase());
}

const REQUIRED_CODE_READY_MARKERS = [
  'OUTBOUND_PR2_CODE_READY',
  'OUTBOUND_PR3_CODE_READY',
  // PR 4 has no marker of its own — its acceptance criteria were folded into
  // the PR 4+5 checkpoint, whose marker is OUTBOUND_PR5_CODE_READY.
  'OUTBOUND_PR5_CODE_READY',
  'OUTBOUND_PR6_CODE_READY',
  'OUTBOUND_PR7_CODE_READY',
  'OUTBOUND_PR8_CODE_READY',
];

export interface PilotReadinessInputs {
  env: NodeJS.ProcessEnv;
  /** Repo root — used to locate `.ai/`, `src/db/migrations/`, and `scripts/`. Never used to open a DB connection. */
  repoRoot: string;
  /**
   * PR 8A review fix — the operator asserts that the environment being
   * assessed is the PRODUCTION pilot target. `NODE_ENV` alone is not enough:
   * the runbook's G3 step tells an operator to run this against a copied
   * `.env`, which does not carry `NODE_ENV=production`, so a production-only
   * check (an absent pilot roster) silently degraded to a warning exactly
   * when it mattered most. Defaults to `false` — unchanged local behaviour.
   */
  assumeProductionTarget?: boolean;
  /**
   * D-R3 (owner-ratified) — where the CLI sourced `env` from. Optional: the
   * assessor's own signature is unchanged for existing callers, this is a
   * purely additive passthrough surfaced in the printed report only.
   */
  configurationSource?: PilotReadinessConfigurationSource;
}

/**
 * The only outreach provider with an implementation on disk
 * (`src/modules/outreach/providers/index.ts`'s `KNOWN_PROVIDERS`). Anything
 * else — including `smartlead_csv`, the documented default and the exact
 * provider this pilot must not use — is an unknown provider.
 */
const KNOWN_OUTREACH_PROVIDERS = ['mock'];

/**
 * PR 8B (P8B-4) — provider name -> the credential environment-variable names
 * that provider's integration would read. A name-substring test on
 * `/SMARTLEAD/i` alone cannot see an alias like `SL_API_KEY`, so a live
 * Smartlead credential could sit in the pilot environment completely
 * unreported. Exact names only — never a `SL_` prefix test, which would
 * false-positive on unrelated variables such as `SL_TIMEZONE`.
 *
 * This module is the only consumer today: PR 9 is gated, so no real
 * `smartlead_csv` provider implementation exists to own this contract. If a
 * provider-configuration contract is added in a later PR, this map moves there.
 */
const PROVIDER_CREDENTIAL_ENV_VARS: Readonly<Record<string, readonly string[]>> = {
  smartlead_csv: [
    'SMARTLEAD_API_KEY',
    'SMARTLEAD_KEY',
    'SMARTLEAD_TOKEN',
    'SMARTLEAD_API_TOKEN',
    'SMARTLEAD_SECRET',
    'SMARTLEAD_CLIENT_SECRET',
    'SL_API_KEY',
    'SL_API_TOKEN',
    'SL_TOKEN',
    'SL_SECRET',
  ],
};

/** Exported for tests so the alias suite is data-driven off the map itself. */
export const PROVIDER_CREDENTIAL_ENV_VAR_MAP = PROVIDER_CREDENTIAL_ENV_VARS;

const CREDENTIAL_ALIAS_NAMES: ReadonlySet<string> = new Set(
  Object.values(PROVIDER_CREDENTIAL_ENV_VARS)
    .flat()
    .map((name) => name.toUpperCase()),
);

/** `pilotIds()` in `wizmatchStaffingAccess.ts` parses the roster exactly this way. */
function parsePilotRosterIds(raw: string | undefined): string[] {
  return String(raw ?? '')
    .split(/[\s,]+/)
    .filter((entry) => entry.length > 0);
}

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assessWizmatchPilotReadiness(inputs: PilotReadinessInputs): PilotReadinessReport {
  const { env, repoRoot } = inputs;
  const assumeProductionTarget = inputs.assumeProductionTarget === true;
  const findings: PilotReadinessFinding[] = [];
  const push = (code: string, severity: PilotReadinessSeverity, message: string) => {
    findings.push({ code, severity, message });
  };

  // 1. Code-ready markers through PR 8A (file presence only).
  const aiDir = join(repoRoot, '.ai');
  for (const marker of REQUIRED_CODE_READY_MARKERS) {
    const present = existsSync(join(aiDir, marker));
    push(
      `marker:${marker}`,
      present ? 'ok' : 'danger',
      present ? `${marker} present.` : `${marker} is MISSING — this stack is not code-ready through PR 8.`,
    );
  }
  const pr8aImplemented = existsSync(join(aiDir, 'OUTBOUND_PR8A_IMPLEMENTED'));
  push(
    'marker:OUTBOUND_PR8A_IMPLEMENTED',
    pr8aImplemented ? 'ok' : 'warning',
    pr8aImplemented
      ? 'OUTBOUND_PR8A_IMPLEMENTED present (self-reported; independent review still required for CODE_READY).'
      : 'OUTBOUND_PR8A_IMPLEMENTED not yet present — the PR 8A hardening pass has not been marked complete.',
  );

  // 2. Enforcement mode — expected shadow. Any value other than the exact
  //    string 'enforce' IS shadow (mirrors outreachGate.ts's own §16 rule 3
  //    parsing exactly, so this check can never disagree with runtime
  //    behaviour).
  const enforcementMode = env.WIZMATCH_POLICY_ENFORCEMENT_MODE;
  const isEnforceExact = enforcementMode === 'enforce';
  push(
    'flag:WIZMATCH_POLICY_ENFORCEMENT_MODE',
    isEnforceExact ? 'danger' : 'ok',
    isEnforceExact
      ? "WIZMATCH_POLICY_ENFORCEMENT_MODE='enforce' — the pilot must ship in shadow. Promotion to enforce is a separate, later G4 decision."
      : `WIZMATCH_POLICY_ENFORCEMENT_MODE=${JSON.stringify(enforcementMode ?? null)} (treated as shadow).`,
  );

  // 3-6. Sending / automated emails / auto-prep / outreach adapter — all
  //    expected false for the initial pilot deployment.
  const boolFlagChecks: Array<{ key: string; label: string; initialExpected: boolean }> = [
    { key: 'WIZMATCH_SENDING_ENABLED', label: 'sending', initialExpected: false },
    { key: 'AUTOMATED_EMAILS_ENABLED', label: 'automated emails', initialExpected: false },
    { key: 'WIZMATCH_AUTO_PREP_ENABLED', label: 'automatic/manual preparation trigger', initialExpected: false },
    { key: 'WIZMATCH_OUTREACH_ADAPTER_ENABLED', label: 'outreach adapter', initialExpected: false },
  ];
  for (const check of boolFlagChecks) {
    const on = isEnabled(env[check.key]);
    push(
      `flag:${check.key}`,
      on ? 'danger' : 'ok',
      on
        ? `${check.key} is enabled (${check.label}) — must be false for the initial Smartlead-free pilot.`
        : `${check.key} is off (${check.label}).`,
    );
  }

  // 7. No Smartlead credential configured anywhere, under its own name OR
  //    under a known alias (P8B-4). Two independent detectors, both
  //    presence-only — never prints the value:
  //      - the broad `/SMARTLEAD/i` name test, which catches names nobody
  //        enumerated (e.g. SMARTLEAD_WORKSPACE_TOKEN);
  //      - exact-name membership in PROVIDER_CREDENTIAL_ENV_VARS, which
  //        catches aliases with no "smartlead" in them at all (SL_API_KEY).
  const smartleadKeys = Object.keys(env).filter((k) => {
    if ((env[k] ?? '').trim().length === 0) return false;
    return /SMARTLEAD/i.test(k) || CREDENTIAL_ALIAS_NAMES.has(k.toUpperCase());
  });
  push(
    'smartlead:credentials',
    smartleadKeys.length > 0 ? 'danger' : 'ok',
    smartleadKeys.length > 0
      ? `Smartlead-shaped environment variable(s) are set: ${smartleadKeys.join(', ')} (value not shown). No Smartlead credential may be present for this pilot.`
      : 'No Smartlead-shaped environment variable is set.',
  );

  // 8. Paid-discovery configuration — expected disabled/untouched.
  const paidDiscoveryKeys = ['WIZMATCH_PAID_DISCOVERY_ENABLED', 'WIZMATCH_ENABLE_APOLLO', 'WIZMATCH_ENABLE_SNOV'];
  const enabledPaidDiscovery = paidDiscoveryKeys.filter((k) => isEnabled(env[k]));
  push(
    'paid-discovery',
    enabledPaidDiscovery.length > 0 ? 'danger' : 'ok',
    enabledPaidDiscovery.length > 0
      ? `Paid-discovery flag(s) enabled: ${enabledPaidDiscovery.join(', ')} — must remain disabled for this pilot.`
      : 'Paid-discovery flags remain disabled.',
  );

  // 8b. Email verification provider — presence only, warning (not danger): a
  //     missing verifier doesn't threaten pilot safety, it silently degrades
  //     quality. Neither REACHER_BASE_URL nor MILLIONVERIFIER_API_KEY being set
  //     caps every discovered contact's confidenceScore at 6 ("medium" tier),
  //     so contacts stay stuck in Needs Review and never reach Ready to
  //     Contact — see wizmatchEmailVerificationHealth.ts for the runtime
  //     loud-failure side of this same incident class.
  const hasReacher = Boolean(env.REACHER_BASE_URL);
  const hasMillionVerifier = Boolean(env.MILLIONVERIFIER_API_KEY);
  push(
    'email-verification:provider',
    hasReacher || hasMillionVerifier ? 'ok' : 'warning',
    hasReacher || hasMillionVerifier
      ? `Email verification provider configured (${[hasReacher && 'REACHER_BASE_URL', hasMillionVerifier && 'MILLIONVERIFIER_API_KEY'].filter(Boolean).join(', ')}).`
      : 'No email verification provider configured (REACHER_BASE_URL / MILLIONVERIFIER_API_KEY both unset) — every discovered contact will be capped at confidence tier "medium".',
  );

  // 9. Provider selection. The pilot's configuration contract says "no
  //    provider is selected", so an UNRECOGNISED non-empty `OUTREACH_PROVIDER`
  //    is dangerous on its own — not only when the adapter flag happens to be
  //    on. `smartlead_csv` is the documented default and the exact provider
  //    this pilot must not use; before this fix it passed silently whenever
  //    the adapter was off.
  const outreachProvider = (env.OUTREACH_PROVIDER ?? '').trim();
  const adapterEnabled = isEnabled(env.WIZMATCH_OUTREACH_ADAPTER_ENABLED);
  const providerIsUnknown = outreachProvider.length > 0 && !KNOWN_OUTREACH_PROVIDERS.includes(outreachProvider.toLowerCase());
  if (adapterEnabled) {
    // Compounds the `flag:WIZMATCH_OUTREACH_ADAPTER_ENABLED` danger above
    // rather than restating it: adapter-on plus ANY provider selection is a
    // combination that must not exist in this pilot.
    push(
      'provider:selection',
      'danger',
      `WIZMATCH_OUTREACH_ADAPTER_ENABLED is on AND OUTREACH_PROVIDER=${JSON.stringify(env.OUTREACH_PROVIDER ?? null)} — ` +
        'adapter availability does not imply sending availability, but this combination should not exist in this pilot at all.',
    );
  } else if (providerIsUnknown) {
    push(
      'provider:selection',
      'danger',
      `OUTREACH_PROVIDER=${JSON.stringify(env.OUTREACH_PROVIDER ?? null)} is not a recognised provider ` +
        `(the only implementation on disk is ${JSON.stringify(KNOWN_OUTREACH_PROVIDERS)}). The pilot's configuration ` +
        'contract requires that no provider is selected; a provider name set here would fail closed at the factory, ' +
        'but it must not be present at all.',
    );
  } else {
    push(
      'provider:selection',
      'ok',
      outreachProvider.length === 0
        ? 'Outreach adapter is off and no OUTREACH_PROVIDER is selected.'
        : `Outreach adapter is off; OUTREACH_PROVIDER=${JSON.stringify(env.OUTREACH_PROVIDER ?? null)} is a recognised provider and inert.`,
    );
  }

  // 10. Pilot roster configuration (presence only — never lists user ids).
  //
  //     PR 8B — `resolveStaffingAccess` now computes `allowed = configured &&
  //     pilotAllowed` UNCONDITIONALLY: the old `NODE_ENV === 'production' ?
  //     strict : permissive` branch is gone, so an unset/empty roster fails
  //     closed in EVERY runtime, not only production. An absent roster is
  //     therefore a DANGER regardless of `--production` or `NODE_ENV` — the
  //     deployment is unusable-by-omission everywhere, and reporting that as a
  //     warning would describe a permissive fallback that no longer exists.
  const rosterIds = parsePilotRosterIds(env.WIZMATCH_STAFFING_PILOT_USER_IDS);
  const rosterByIds = rosterIds.length > 0;
  const rosterByAllUsers = isEnabled(env.WIZMATCH_STAFFING_PILOT_ALL_USERS);
  const rosterConfigured = rosterByIds || rosterByAllUsers;

  // PR 8A review fix, retained — `NODE_ENV` no longer selects the pilot gate's
  // fail-closed branch, but it still selects production-only Express behaviour
  // (error-response verbosity, secure cookie flags, and anything else keyed off
  // it). Nothing in this repo (railway.json, nixpacks.toml, docs/DEPLOYMENT.md)
  // records that it is set at runtime; Nixpacks' documented `NODE_ENV=production`
  // applies to the BUILD phase, which says nothing about the running container.
  // So when an operator asserts a production target, disagreement with the
  // actual `NODE_ENV` is itself the finding: the configuration just assessed is
  // not the one the deployed service will run under.
  if (assumeProductionTarget && env.NODE_ENV !== 'production') {
    push(
      'runtime:NODE_ENV',
      'danger',
      `--production was asserted but NODE_ENV=${JSON.stringify(env.NODE_ENV ?? null)}, not 'production'. `
        + 'NODE_ENV selects production-only Express behaviour (error-response verbosity, secure cookie flags); '
        + 'a mismatch means the environment just assessed is not the one the deployed service runs under. '
        + 'Confirm NODE_ENV=production is set on the deployed service before go-live.',
    );
  } else if (env.NODE_ENV === 'production') {
    push('runtime:NODE_ENV', 'ok', 'NODE_ENV=production — production-only Express behaviour is active.');
  }
  if (!rosterConfigured) {
    push(
      'pilot-roster',
      'danger',
      'No pilot roster configured (WIZMATCH_STAFFING_PILOT_USER_IDS unset/blank and ' +
        'WIZMATCH_STAFFING_PILOT_ALL_USERS not set). The staffing pilot gate fails closed in every runtime — ' +
        'no role, not even admin, reaches any pilot surface until this is set.',
    );
  } else if (rosterByAllUsers && !rosterByIds) {
    // A configured roster that is "everyone with a pilot-eligible role" is a
    // legitimate documented override, but it is NOT a restricted pilot and must
    // never be reported as though it were. Dangerous in EVERY runtime for the
    // same reason an absent roster is: `resolveStaffingAccess` has no
    // environment condition left, so this admits everyone everywhere — gating
    // the finding on a production target would leave exactly the hole the
    // absent-roster fix above just closed.
    push(
      'pilot-roster',
      'danger',
      'WIZMATCH_STAFFING_PILOT_ALL_USERS is set with no explicit user-id roster — every pilot-eligible role ' +
        '(admin, team_lead, manager_ops, sales, staff) is admitted. That is an open deployment, not a restricted pilot.',
    );
  } else {
    push('pilot-roster', 'ok', 'Pilot roster is configured with an explicit user-id list (ids not shown).');
  }

  // 10b. Roster entries must be UUID-shaped. A typo'd id grants nobody
  //      unintended access — it simply never matches — so this is not a leak,
  //      but it silently excludes the intended pilot member, which looks
  //      identical to "the gate is broken". Count only: roster ids are not
  //      credentials, but there is no reason to print them either.
  if (rosterByIds) {
    const malformed = rosterIds.filter((id) => !UUID_SHAPE.test(id));
    push(
      'pilot-roster:format',
      malformed.length > 0 ? 'danger' : 'ok',
      malformed.length > 0
        ? `Pilot roster contains ${malformed.length} malformed entr${malformed.length === 1 ? 'y' : 'ies'} ` +
          '(not UUID-shaped; ids not shown). A typo\'d id silently excludes that user without granting anyone ' +
          'unintended access, but the roster must be corrected before go-live.'
        : `Pilot roster entries are all UUID-shaped (${rosterIds.length} entr${rosterIds.length === 1 ? 'y' : 'ies'}; ids not shown).`,
    );
  }

  // 11. Required feature flags for the pilot's own visible surfaces.
  const uiFlags = ['WIZMATCH_COMPANY_POLICY_ENABLED', 'WIZMATCH_DECISION_WORKBENCH_ENABLED'];
  for (const key of uiFlags) {
    const on = isEnabled(env[key]);
    push(
      `flag:${key}`,
      on ? 'ok' : 'warning',
      on ? `${key} is on.` : `${key} is off — the pilot's own surface will 404/hide until this is enabled.`,
    );
  }

  // 12. Migration status — reported, never changed. File-system only.
  try {
    const journalPath = join(repoRoot, 'src', 'db', 'migrations', 'meta', '_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: Array<{ idx: number; tag: string }> };
    const latest = journal.entries[journal.entries.length - 1];
    const sqlFiles = readdirSync(join(repoRoot, 'src', 'db', 'migrations')).filter((f) => f.endsWith('.sql'));
    // The sentinel was previously a bare "does 0038 exist" check, because at the
    // time no migration beyond 0037 was authorised. 0038 (`users.is_active`,
    // failure-matrix M-3) is now authorised and merged, so the high-water mark
    // moves with it rather than the check being deleted: anything ABOVE the mark
    // is still surfaced for authorisation confirmation. Keeping this as a moving
    // mark rather than removing it preserves the original protection — an
    // unreviewed migration appearing in a hardening pass is still reported.
    // 39 = saved_views (admin filter presets), authorised by the owner
    // 2026-08-01. Additive CREATE TABLE only, no ALTER of any existing table.
    // 40 = users.is_platform_superadmin (Phase-1 hardening, security audit
    // 2026-08-03) — the platform-superadmin primitive: an ADD COLUMN with a
    // default on the shared `users` table, plus the (not-yet-wired-in)
    // `requirePlatformSuperadmin` middleware and audit-logging capability.
    // Explicitly authorised as scaffolding-only in that task's own brief.
    // 41 = tenant_branding (white-label admin-SPA branding), authorised as
    // part of the reselling effort.
    // 42 = tenant_integrations (Phase 3 white-label per-tenant credential
    // store — AES-256-GCM encrypted, generic `provider` text column),
    // authorised as part of the white-label reselling effort. Additive
    // CREATE TABLE only, no ALTER of any existing table. The Meta OAuth
    // connect-flow scaffolding (src/services/metaOAuthService.ts) reuses this
    // same table (provider='meta') rather than adding its own — no new
    // migration needed for that scaffolding.
    // Bump this ONLY alongside an explicit authorisation for the migration in
    // question — the point of the mark is that an unreviewed migration showing
    // up in a hardening pass still gets surfaced.
    // 43 = plans + subscriptions (subscription-billing core — reselling this
    // CRM to other agencies via a pluggable Cashfree/Razorpay adapter).
    // Additive CREATE TABLE only (two new tables), no ALTER of any existing
    // table. Renumbered from 40 to 43 during merge — 40/41/42 were already
    // claimed by the time this PR merged.
    // 44 = tenant_branding legal/financial identity columns — reseller-
    // readiness fix so a white-label tenant's own invoices/reports render its
    // own legal name, address, tax ID, and bank details instead of Growth
    // Escalators', owner-approved. Additive ADD COLUMN only (ten nullable
    // text columns on the existing tenant_branding table), no ALTER of any
    // other table, no new table.
    // Bump this ONLY alongside an explicit authorisation for the migration in
    // question — the point of the mark is that an unreviewed migration showing
    // up in a hardening pass still gets surfaced.
    const AUTHORISED_MIGRATION_HIGH_WATER_MARK = 44;
    const unauthorised = sqlFiles
      .map((f) => ({ file: f, idx: parseInt(f.slice(0, 4), 10) }))
      .filter((m) => Number.isFinite(m.idx) && m.idx > AUTHORISED_MIGRATION_HIGH_WATER_MARK)
      .map((m) => m.file)
      .sort();
    push(
      'migration:status',
      unauthorised.length ? 'warning' : 'ok',
      unauthorised.length
        ? `Migration file(s) beyond the authorised high-water mark (00${AUTHORISED_MIGRATION_HIGH_WATER_MARK}) exist: ${unauthorised.join(', ')} — confirm each was authorised separately.`
        : `Migration status (reported only, not changed): latest generated migration is ${latest?.tag ?? 'unknown'} (idx ${latest?.idx ?? '?'}). Whether it is APPLIED to any database is not checkable without a DB connection — see the runbook's G1 gate.`,
    );
  } catch (error) {
    push('migration:status', 'warning', `Could not read migration journal: ${error instanceof Error ? error.message : String(error)}`);
  }

  // 13. Backfill status — reported, never run.
  const backfillScript = join(repoRoot, 'scripts', 'onboarding', 'wizmatch-policy-backfill.ts');
  push(
    'backfill:status',
    existsSync(backfillScript) ? 'ok' : 'warning',
    existsSync(backfillScript)
      ? 'Backfill script exists and is dry-run-by-default (requires --apply). Whether it has been run against any database is not checkable without a DB connection — see the runbook G2 gate.'
      : 'Backfill script not found at the expected path.',
  );

  const dangerous = findings.some((f) => f.severity === 'danger');
  return { findings, dangerous, generatedAt: new Date().toISOString(), configurationSource: inputs.configurationSource };
}

export function formatWizmatchPilotReadinessReport(report: PilotReadinessReport): string {
  const lines = ['WizMatch Smartlead-free live-pilot readiness', `Generated: ${report.generatedAt}`];
  if (report.configurationSource) {
    lines.push(
      report.configurationSource.source === 'file'
        ? `Configuration source: file (${report.configurationSource.resolvedPath ?? 'unknown path'})`
        : 'Configuration source: process_environment (no --env-file supplied)',
    );
  }
  lines.push('');
  for (const f of report.findings) {
    const tag = f.severity === 'danger' ? 'DANGER ' : f.severity === 'warning' ? 'WARN   ' : 'OK     ';
    lines.push(`${tag} [${f.code}] ${f.message}`);
  }
  lines.push('');
  lines.push(
    report.dangerous
      ? `RESULT: NOT SAFE — ${report.findings.filter((f) => f.severity === 'danger').length} dangerous finding(s). Do not go live.`
      : 'RESULT: no dangerous configuration detected (warnings, if any, do not block shadow-mode go-live).',
  );
  lines.push('');
  lines.push('No secret value is printed above — credential checks report presence only.');
  return lines.join('\n');
}
