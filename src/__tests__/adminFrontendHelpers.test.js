import { afterEach, describe, expect, it } from 'vitest';
import { getTenantSlug } from '../../admin/src/lib/auth.js';
import { isTerminalOutcome } from '../../admin/src/lib/pipelineStageOutcomes.js';

function installBrowserPath(pathname, storedTenant = 'growth-escalators') {
  const store = new Map([['crm_active_tenant_slug', storedTenant]]);
  globalThis.window = {
    location: {
      search: '',
      hostname: 'crm.growthescalators.com',
      pathname,
    },
  };
  globalThis.localStorage = {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  };
}

afterEach(() => {
  delete globalThis.window;
  delete globalThis.localStorage;
});

describe('admin tenant and pipeline outcome helpers', () => {
  it('resolves explicit product paths before stale localStorage', () => {
    installBrowserPath('/dashboard', 'wizmatch');
    expect(getTenantSlug()).toBe('growth-escalators');

    installBrowserPath('/wizmatch/dashboard', 'growth-escalators');
    expect(getTenantSlug()).toBe('wizmatch');
  });

  it('uses stageOutcome values directly for terminal detection', () => {
    expect(isTerminalOutcome('won')).toBe(true);
    expect(isTerminalOutcome('lost')).toBe(true);
    expect(isTerminalOutcome('abandoned')).toBe(true);
    expect(isTerminalOutcome('open')).toBe(false);
    expect(isTerminalOutcome('Deal Won')).toBe(false);
    expect(isTerminalOutcome(undefined)).toBe(false);
  });
});
