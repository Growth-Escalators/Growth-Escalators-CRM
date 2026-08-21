import { getWizmatchSourcingConfig } from './wizmatchSourcing';

export const WIZMATCH_STAFFING_REMINDER_CRON = '47 3 * * 1-6';
export const WIZMATCH_STAFFING_REMINDER_SCHEDULE = '09:17 IST Monday-Saturday';

/**
 * WizMatch is retired. This compatibility export intentionally ignores stale
 * environment values so no caller can use a legacy flag to reactivate work.
 */
export function isWizmatchFlagEnabled(_value: string | undefined): boolean {
  return false;
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
 * longer reactivate legacy cron, sending, preparation, staffing, or sourcing
 * workloads. Provider configuration metadata is retained temporarily for
 * cleanup diagnostics, but every execution switch is forced off.
 */
export function getWizmatchAutomationStatus(
  env: NodeJS.ProcessEnv = process.env,
  _now = new Date(),
): WizmatchAutomationStatus {
  const configuredSourcing = getWizmatchSourcingConfig(env);
  const sourcing: ReturnType<typeof getWizmatchSourcingConfig> = {
    ...configuredSourcing,
    masterEnabled: false,
    theirstackEnabled: false,
    atsEnabled: false,
    xrayEnabled: false,
    pocDiscoveryEnabled: false,
    execution: 'disabled',
  };

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
    sourcing,
  };
}
