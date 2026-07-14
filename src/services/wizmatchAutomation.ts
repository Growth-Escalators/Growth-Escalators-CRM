export const WIZMATCH_STAFFING_REMINDER_CRON = '47 3 * * 1-6';
export const WIZMATCH_STAFFING_REMINDER_SCHEDULE = '09:17 IST Monday-Saturday';

function enabled(value: string | undefined) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

export interface WizmatchAutomationStatus {
  execution: 'web-in-process' | 'disabled';
  masterEnabled: boolean;
  legacyAutomationEnabled: boolean;
  staffingAutomationRequested: boolean;
  staffingGateCEnabled: boolean;
  staffingRemindersEnabled: boolean;
  sendingEnabled: boolean;
  schedule: string;
  nextExpectedRunAt: string | null;
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
  const masterEnabled = env.DISABLE_BACKGROUND_JOBS !== 'true' && Boolean(env.WIZMATCH_TENANT_ID);
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
    sendingEnabled: enabled(env.WIZMATCH_SENDING_ENABLED),
    schedule: WIZMATCH_STAFFING_REMINDER_SCHEDULE,
    nextExpectedRunAt: staffingRemindersEnabled ? nextStaffingReminderAt(now) : null,
  };
}
