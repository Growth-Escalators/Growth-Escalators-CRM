// The owner's day, walked read-only against live data.
//
// Ordering mirrors the real job — find who's hiring, find who to contact, track
// what came back — rather than the sidebar's order, because severity should be
// weighted by where the time actually goes.
//
// Nothing here clicks a write. The route guard makes writes harmless; the
// denylist in readonly-guard.ts makes them un-attempted; and the assertion at the
// end of the run fails if either was wrong.

import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { ReadOnlyGuard } from './readonly-guard';
import { attachCollectors, visit, type StopObservation } from './observe';

const ARTIFACTS = process.env.WALKTHROUGH_ARTIFACT_DIR
  || `${process.env.HOME}/.walkthrough-artifacts`;

// Deep stops: the daily job, in order.
const DAILY = [
  ['today', '/wizmatch/today'],
  ['job-leads', '/wizmatch/job-leads'],
  ['companies', '/wizmatch/companies'],
  ['hiring-contacts', '/wizmatch/hiring-contacts'],
  ['requirements', '/wizmatch/requirements'],
  ['candidates', '/wizmatch/candidates'],
  ['submissions', '/wizmatch/submissions'],
  ['placements', '/wizmatch/placements'],
  ['reports', '/wizmatch/reports'],
] as const;

// Sweep: everything else in the registry. One navigation each — enough to answer
// "does it load, does it error, does it have data", which is what the report
// needs from routes nobody may be opening.
const SWEEP = [
  ['hiring-contacts-queue', '/wizmatch/hiring-contacts?tab=queue'],
  ['find-contact', '/wizmatch/find-contact'],
  ['talent-matching', '/wizmatch/talent-matching'],
  ['primes', '/wizmatch/primes'],
  ['duplicates', '/wizmatch/duplicates'],
  ['system', '/wizmatch/system'],
  ['system-nav-usage', '/wizmatch/system?tab=nav-usage'],
  ['intelligence', '/wizmatch/intelligence'],
  ['inbox', '/wizmatch/inbox'],
  ['contacts', '/wizmatch/contacts'],
  ['pipeline', '/wizmatch/pipeline'],
  ['tasks', '/wizmatch/tasks'],
  ['emails', '/wizmatch/emails'],
  ['whatsapp-templates', '/wizmatch/whatsapp-templates'],
  ['billing', '/wizmatch/billing'],
  ['contracts', '/wizmatch/contracts'],
  ['finance', '/wizmatch/finance'],
  ['permissions', '/wizmatch/settings/permissions'],
  ['audit', '/wizmatch/settings/audit'],
  ['pipeline-manager', '/wizmatch/pipelines/settings'],
  ['my-work', '/wizmatch/my-work'],
  ['review-workbench', '/wizmatch/review-workbench'],
  ['client-discovery', '/wizmatch/client-discovery'],
  ['requirement-priority', '/wizmatch/requirement-priority-new'],
  ['candidate-intelligence', '/wizmatch/candidate-intelligence'],
  ['source-candidates', '/wizmatch/source-candidates'],
] as const;

test('owner day — read-only walkthrough of the live app', async ({ page, context, baseURL }) => {
  test.setTimeout(30 * 60_000);
  mkdirSync(ARTIFACTS, { recursive: true });

  const guard = new ReadOnlyGuard();
  await guard.install(context, new URL(baseURL!).hostname);
  const collectors = attachCollectors(page);

  const startedAt = new Date().toISOString();
  const observations: StopObservation[] = [];

  // CANARY FIRST. /wizmatch/reports is the only primary page with zero write
  // surface, so if anything beyond the suppressed beacon is attempted here the
  // guard or the app is doing something unexpected and the run must not continue.
  const canary = await visit(page, guard, collectors, ARTIFACTS, 'canary-reports', '/wizmatch/reports');
  // Fail fast and legibly on a dead session. Without this the run walks all 37
  // stops against a login page and reports timeouts, which reads as "the app is
  // broken" when it means "re-capture the session".
  expect(
    canary.paint.outcome,
    'landed on /login — the saved session is missing, expired or for the wrong tenant. '
    + 'Re-run the session capture; nothing else in this report would be meaningful.',
  ).not.toBe('login-redirect');

  const canaryWrites = guard.attempts.filter((a) => a.kind === 'blocked-write');
  expect(
    canaryWrites,
    `canary attempted ${canaryWrites.length} write(s): ${JSON.stringify(canaryWrites)}`,
  ).toEqual([]);
  observations.push(canary);

  // Flush after EVERY stop, not at the end.
  //
  // The first live run against production was interrupted after 13 of 37 stops
  // and lost every measurement, because both JSON files were written only after
  // the loop. Thirteen stops of real production data existed and were thrown
  // away by the harness. A long run against a system you cannot re-drive cheaply
  // must checkpoint, not accumulate.
  const flush = () => {
    writeFileSync(`${ARTIFACTS}/observations.json`, JSON.stringify(
      { startedAt, endedAt: new Date().toISOString(), complete: false, observations }, null, 2));
    writeFileSync(`${ARTIFACTS}/write-attempts.json`, JSON.stringify(guard.attempts, null, 2));
  };
  flush();

  for (const [routeId, path] of [...DAILY, ...SWEEP]) {
    // eslint-disable-next-line no-await-in-loop
    observations.push(await visit(page, guard, collectors, ARTIFACTS, routeId, path));
    flush();
    // Fail at the stop that caused it, not 20 stops later — the guard makes the
    // write harmless, but knowing WHICH page attempted it is the finding.
    const soFar = guard.attempts.filter((a) => a.kind === 'blocked-write');
    if (soFar.length) throw new Error(`write attempted at "${routeId}": ${JSON.stringify(soFar)}`);
  }

  const endedAt = new Date().toISOString();

  writeFileSync(`${ARTIFACTS}/observations.json`, JSON.stringify(
    { startedAt, endedAt, complete: true, observations }, null, 2));
  writeFileSync(`${ARTIFACTS}/write-attempts.json`, JSON.stringify(guard.attempts, null, 2));

  // eslint-disable-next-line no-console
  console.log([
    '',
    `  stops: ${observations.length}`,
    `  rows / empty / error / timeout: ${(['rows', 'empty-state', 'error-state', 'timeout'] as const)
      .map((o) => observations.filter((s) => s.paint.outcome === o).length).join(' / ')}`,
    `  blocked writes: ${guard.attempts.filter((a) => a.kind === 'blocked-write').length}`,
    `  suppressed beacons: ${guard.attempts.filter((a) => a.kind === 'suppressed-telemetry').length}`,
    `  window: ${startedAt} .. ${endedAt}`,
    '',
  ].join('\n'));

  // The run must never have touched an auth endpoint.
  expect(guard.hasAuthAlarm, 'an auth endpoint was contacted — this must never happen').toBe(false);

  // Navigation alone must not write. Anything here is either an app bug (a write
  // on mount) or a harness bug (a click that slipped the denylist) — both are
  // findings, and both should stop the run rather than be logged and shrugged at.
  const blocked = guard.attempts.filter((a) => a.kind === 'blocked-write');
  expect(
    blocked,
    `navigation-only walkthrough attempted ${blocked.length} write(s) — see write-attempts.json`,
  ).toEqual([]);
});
