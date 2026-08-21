import { describe, expect, it } from 'vitest';
import {
  getWizmatchAutomationStatus,
  isWizmatchFlagEnabled,
  nextStaffingReminderAt,
} from '../services/wizmatchAutomation';

describe('WizMatch retirement automation boundary', () => {
  const staleFullyEnabledEnv = {
    WIZMATCH_TENANT_ID: 'tenant-wizmatch',
    DISABLE_BACKGROUND_JOBS: 'false',
    WIZMATCH_LEGACY_AUTOMATION_ENABLED: 'true',
    WIZMATCH_STAFFING_AUTOMATION_ENABLED: 'true',
    WIZMATCH_STAFFING_GATE_C_ENABLED: 'true',
    WIZMATCH_SENDING_ENABLED: 'true',
    WIZMATCH_AUTO_PREP_ENABLED: 'true',
    WIZMATCH_SOURCE_AUTOMATION_ENABLED: 'true',
    WIZMATCH_THEIRSTACK_IMPORT_ENABLED: 'true',
    WIZMATCH_ATS_POLLING_ENABLED: 'true',
    WIZMATCH_XRAY_CANDIDATE_ENABLED: 'true',
    WIZMATCH_POC_DISCOVERY_ENABLED: 'true',
    THEIRSTACK_API_KEY: 'stale-key',
    SEARCHAPI_API_KEY: 'stale-key',
  } as NodeJS.ProcessEnv;

  it('fails every legacy flag closed even when an old environment value is truthy', () => {
    for (const value of ['1', 'true', 'yes', 'on', 'TRUE']) {
      expect(isWizmatchFlagEnabled(value)).toBe(false);
    }
  });

  it('cannot be reactivated by stale production environment variables', () => {
    expect(getWizmatchAutomationStatus(staleFullyEnabledEnv)).toMatchObject({
      execution: 'disabled',
      masterEnabled: false,
      legacyAutomationEnabled: false,
      staffingAutomationRequested: false,
      staffingGateCEnabled: false,
      staffingRemindersEnabled: false,
      sendingEnabled: false,
      autoPrepEnabled: false,
      nextExpectedRunAt: null,
      sourcing: {
        masterEnabled: false,
        theirstackEnabled: false,
        atsEnabled: false,
        xrayEnabled: false,
        pocDiscoveryEnabled: false,
        execution: 'disabled',
      },
    });
  });

  it('remains disabled with an empty environment too', () => {
    expect(getWizmatchAutomationStatus({} as NodeJS.ProcessEnv)).toMatchObject({
      execution: 'disabled',
      masterEnabled: false,
      legacyAutomationEnabled: false,
      staffingRemindersEnabled: false,
      sendingEnabled: false,
      autoPrepEnabled: false,
    });
  });

  it('keeps the old reminder-time helper deterministic only for import compatibility', () => {
    expect(nextStaffingReminderAt(new Date('2026-07-18T04:00:00.000Z'))).toBe('2026-07-20T03:47:00.000Z');
    expect(nextStaffingReminderAt(new Date('2026-07-20T03:00:00.000Z'))).toBe('2026-07-20T03:47:00.000Z');
  });
});
