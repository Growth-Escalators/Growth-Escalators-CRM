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

export interface PilotReadinessReport {
  findings: PilotReadinessFinding[];
  /** True when ANY finding is `danger` — the CLI exits non-zero exactly on this. */
  dangerous: boolean;
  generatedAt: string;
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
}

export function assessWizmatchPilotReadiness(inputs: PilotReadinessInputs): PilotReadinessReport {
  const { env, repoRoot } = inputs;
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

  // 7. No Smartlead credential configured anywhere. Presence-only — never
  //    prints the value.
  const smartleadKeys = Object.keys(env).filter((k) => /SMARTLEAD/i.test(k) && (env[k] ?? '').trim().length > 0);
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

  // 9. Provider selection. `OUTREACH_PROVIDER` only matters once the adapter
  //    flag is on; still worth reporting so a future flip isn't a surprise.
  const outreachProvider = env.OUTREACH_PROVIDER;
  const adapterEnabled = isEnabled(env.WIZMATCH_OUTREACH_ADAPTER_ENABLED);
  if (adapterEnabled) {
    // Already reported as `danger` above (flag:WIZMATCH_OUTREACH_ADAPTER_ENABLED);
    // this adds the compounding detail rather than a second danger for the same root cause.
    push(
      'provider:selection',
      'danger',
      `WIZMATCH_OUTREACH_ADAPTER_ENABLED is on AND OUTREACH_PROVIDER=${JSON.stringify(outreachProvider ?? null)} — ` +
        'adapter availability does not imply sending availability, but this combination should not exist in this pilot at all.',
    );
  } else {
    push(
      'provider:selection',
      'ok',
      `Outreach adapter is off; OUTREACH_PROVIDER=${JSON.stringify(outreachProvider ?? null)} is inert.`,
    );
  }

  // 10. Pilot roster configuration (presence only — never lists user ids).
  const rosterConfigured = Boolean((env.WIZMATCH_STAFFING_PILOT_USER_IDS ?? '').trim()) || isEnabled(env.WIZMATCH_STAFFING_PILOT_ALL_USERS);
  const isProduction = env.NODE_ENV === 'production';
  if (!rosterConfigured && isProduction) {
    push('pilot-roster', 'danger', 'NODE_ENV=production with no pilot roster configured — every pilot surface fails closed (by design), but nothing will work until this is set.');
  } else if (!rosterConfigured) {
    push('pilot-roster', 'warning', 'Pilot roster is not configured. Fine for local/dev (permissive default); required before production.');
  } else {
    push('pilot-roster', 'ok', 'Pilot roster is configured.');
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
    const has0038 = sqlFiles.some((f) => f.startsWith('0038'));
    push(
      'migration:status',
      has0038 ? 'warning' : 'ok',
      has0038
        ? 'A 0038 migration file exists — task instructions forbid creating one in this hardening pass; confirm it was authorised separately.'
        : `Migration status (reported only, not changed): latest generated migration is ${latest?.tag ?? 'unknown'} (idx ${latest?.idx ?? '?'}). Whether 0037 is APPLIED to any database is not checkable without a DB connection — see the runbook's G1 gate.`,
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
  return { findings, dangerous, generatedAt: new Date().toISOString() };
}

export function formatWizmatchPilotReadinessReport(report: PilotReadinessReport): string {
  const lines = ['WizMatch Smartlead-free live-pilot readiness', `Generated: ${report.generatedAt}`, ''];
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
