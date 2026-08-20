export const WIZMATCH_STAFFING_REMINDER_CRON = '47 3 * * 1-6';
export const WIZMATCH_STAFFING_REMINDER_SCHEDULE = '09:17 IST Monday-Saturday';

function enabled(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

/**
 * The single reading of a WizMatch on/off env flag, exported so an HTTP route
 * gate and the cron that shares its flag cannot disagree.
 *
 * PR 6's review recorded M-D: the workbench UI accepted `1|true|yes|on` while
 * its backend required the exact string `'true'`. PR 7's flag had the same split
 * — `WIZMATCH_AUTO_PREP_ENABLED=1` started the CRON (which scrapes websites)
 * while both HTTP routes stayed 404, i.e. the automated side ran and the manual
 * side the operator would use to inspect it did not. Unset is still off; the
 * asymmetry is what is removed, not the default.
 */
export function isWizmatchFlagEnabled(value: string | undefined): boolean {
  return enabled(value);
}

export interface WizmatchAutomationStatus {
  execution: 'web-in-process' | 'disabled';
  masterEnabled: boolean;
  legacyAutomationEnabled: boolean;
  staffingAutomationRequested: boolean;
  staffingGateCEnabled: boolean;
  staffingRemindersEnabled: boolean;
  sendingEnabled: boolean;
  /** PRD-005 §16 `WIZMATCH_AUTO_PREP_ENABLED` — gates `prepareCompaniesJob`'s cron (PR 7). */
  autoPrepEnabled: boolean;
  schedule: string;
  nextExpectedRunAt: string | null;
  sourcing: ReturnType<typeof getWizmatchSourcingConfig>;
}

export function nextStaffingReminderAt(now = new Date()): string {
  const candidate = new Date(now);
  candidate.setUTCHours(3, 47, 0, 0);
  if (candidate.getTime() <= now.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
  while (candidate.getUTCDay() === 0) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate.toISOString();
}

export function getWizmatchAutomationStatus(
  env: NodeJS.ProcessEnv = process.env,
  now = new Date(),
): WizmatchAutomationStatus {
  // WizMatch was retired into Growth Escalators in August 2026. Keep the code
  // available for local/test history, but production must stay hard-off even if
  // stale Railway environment variables still exist. This avoids deleting any
  // shared Railway service or database while guaranteeing no WizMatch cron,
  // sourcing, sending, company-prep or staffing-reminder workload can start.
  const retiredInProduction = env.NODE_ENV === 'production';
  const masterEnabled = !retiredInProduction && env.DISABLE_BACKGROUND_JOBS !== 'true' && Boolean(env.WIZMATCH_TENANT_ID);
  const legacyAutomationEnabled = masterEnabled && enabled(env.WIZMATCH_LEGACY_AUTOMATION_ENABLED);
  const staffingAutomationRequested = enabled(env.WIZMATCH_STAFFING_AUTOMATION_ENABLED);
  const staffingGateCEnabled = enabled(env.WIZMATCH_STAFFING_GATE_C_ENABLED);
  const staffingRemindersEnabled = masterEnabled && staffingAutomationRequested && staffingGateCEnabled;
  return {
    execution: masterEnabled ? 'web-in-process' : 'disabled',
    masterEnabled,
    legacyAutomationEnabled,
    staffingAutomationRequested,
    staffingGateCEnabled,
    staffingRemindersEnabled,
    sendingEnabled: !retiredInProduction && enabled(env.WIZMATCH_SENDING_ENABLED),
    autoPrepEnabled: masterEnabled && enabled(env.WIZMATCH_AUTO_PREP_ENABLED),
    schedule: WIZMATCH_STAFFING_REMINDER_SCHEDULE,
    nextExpectedRunAt: staffingRemindersEnabled ? nextStaffingReminderAt(now) : null,
    sourcing: getWizmatchSourcingConfig(env),
  };
}
import { getWizmatchSourcingConfig } from './wizmatchSourcing';
