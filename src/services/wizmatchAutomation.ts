import { getWizmatchSourcingConfig } from './wizmatchSourcing';

export const WIZMATCH_STAFFING_REMINDER_CRON = '47 3 * * 1-6';
export const WIZMATCH_STAFFING_REMINDER_SCHEDULE = '09:17 IST Monday-Saturday';

function enabled(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

/** Compatibility parser retained for callers/tests during dead-code cleanup. */
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

/**
 * WizMatch is retired in every environment. Stale environment variables can no
 * longer reactivate legacy cron, sending, prep, or staffing workloads.
 */
export function getWizmatchAutomationStatus(
  env: NodeJS.ProcessEnv = process.env,
  _now = new Date(),
): WizmatchAutomationStatus {
  return {
    execution: 'disabled',
    masterEnabled: false,
    legacyAutomationEnabled: false,
    staffingAutomationRequested: false,
    staffingGateCEnabled: false,
    staffingRemindersEnabled: false,
    sendingEnabled: false,
    autoPrepEnabled: false,
    schedule: WIZMATCH_STAFFING_REMINDER_SCHEDULE,
    nextExpectedRunAt: null,
    sourcing: getWizmatchSourcingConfig(env),
  };
}
