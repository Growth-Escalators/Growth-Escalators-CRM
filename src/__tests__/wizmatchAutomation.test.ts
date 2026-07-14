import { describe, expect, it } from 'vitest';
import { getWizmatchAutomationStatus, nextStaffingReminderAt } from '../services/wizmatchAutomation';

describe('Wizmatch automation isolation', () => {
  const base = {
    WIZMATCH_TENANT_ID: 'tenant-wizmatch',
    DISABLE_BACKGROUND_JOBS: 'false',
  } as NodeJS.ProcessEnv;

  it('defaults both legacy and staffing automation off', () => {
    expect(getWizmatchAutomationStatus(base)).toMatchObject({
      execution: 'web-in-process',
      masterEnabled: true,
      legacyAutomationEnabled: false,
      staffingRemindersEnabled: false,
      sendingEnabled: false,
    });
  });

  it('requires both the staffing flag and Gate C', () => {
    expect(getWizmatchAutomationStatus({ ...base, WIZMATCH_STAFFING_AUTOMATION_ENABLED: 'true' }).staffingRemindersEnabled).toBe(false);
    expect(getWizmatchAutomationStatus({ ...base, WIZMATCH_STAFFING_GATE_C_ENABLED: 'true' }).staffingRemindersEnabled).toBe(false);
    expect(getWizmatchAutomationStatus({
      ...base,
      WIZMATCH_STAFFING_AUTOMATION_ENABLED: 'true',
      WIZMATCH_STAFFING_GATE_C_ENABLED: 'true',
    }).staffingRemindersEnabled).toBe(true);
  });

  it('keeps legacy automation independent and default-off', () => {
    const status = getWizmatchAutomationStatus({
      ...base,
      WIZMATCH_LEGACY_AUTOMATION_ENABLED: 'true',
      WIZMATCH_STAFFING_AUTOMATION_ENABLED: 'true',
      WIZMATCH_STAFFING_GATE_C_ENABLED: 'true',
    });
    expect(status.legacyAutomationEnabled).toBe(true);
    expect(status.staffingRemindersEnabled).toBe(true);
  });

  it('honors the master background-job gate', () => {
    expect(getWizmatchAutomationStatus({
      ...base,
      DISABLE_BACKGROUND_JOBS: 'true',
      WIZMATCH_LEGACY_AUTOMATION_ENABLED: 'true',
      WIZMATCH_STAFFING_AUTOMATION_ENABLED: 'true',
      WIZMATCH_STAFFING_GATE_C_ENABLED: 'true',
    })).toMatchObject({ execution: 'disabled', masterEnabled: false, legacyAutomationEnabled: false, staffingRemindersEnabled: false });
  });

  it('reports the next non-Sunday 09:17 IST run', () => {
    expect(nextStaffingReminderAt(new Date('2026-07-18T04:00:00.000Z'))).toBe('2026-07-20T03:47:00.000Z');
    expect(nextStaffingReminderAt(new Date('2026-07-20T03:00:00.000Z'))).toBe('2026-07-20T03:47:00.000Z');
  });
});
