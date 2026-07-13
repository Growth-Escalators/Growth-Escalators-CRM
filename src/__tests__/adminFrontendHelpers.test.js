import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTenantSlug } from '../../admin/src/lib/auth.js';
import { apiFetch } from '../../admin/src/lib/api.js';
import { isTerminalOutcome } from '../../admin/src/lib/pipelineStageOutcomes.js';

function installBrowserPath(pathname, storedTenant = 'growth-escalators') {
  const store = new Map([['crm_active_tenant_slug', storedTenant]]);
  vi.stubGlobal('window', {
    location: {
      search: '',
      hostname: 'crm.growthescalators.com',
      pathname,
    },
  });
  vi.stubGlobal('localStorage', {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  });
  return store;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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

  it('uses the Wizmatch token for FormData requests without forcing a JSON content type', async () => {
    const store = installBrowserPath('/wizmatch/requirements');
    store.set('ge_crm_token', 'growth-token');
    store.set('wizmatch_crm_token', 'wizmatch-token');
    const fetchMock = vi.fn().mockResolvedValue({
      status: 200,
      ok: true,
      json: async () => ({ parsed: { title: 'SAP Developer' } }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const body = new FormData();
    body.append('text', 'SAP developer requirement');
    await apiFetch('/api/wizmatch/requirements/parse', { method: 'POST', body });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, options] = fetchMock.mock.calls[0];
    expect(options.body).toBe(body);
    expect(options.headers.Authorization).toBe('Bearer wizmatch-token');
    expect(options.headers).not.toHaveProperty('Content-Type');
  });

  it('clears the Wizmatch session and redirects when a FormData request returns 401', async () => {
    const store = installBrowserPath('/wizmatch/requirements');
    store.set('ge_crm_token', 'growth-token');
    store.set('wizmatch_crm_token', 'expired-token');
    store.set('wizmatch_crm_user', '{"id":"user-1"}');
    store.set('wizmatch_crm_permissions', '{}');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      status: 401,
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    }));

    const body = new FormData();
    body.append('text', 'Java developer requirement');
    await expect(apiFetch('/api/wizmatch/requirements/parse', { method: 'POST', body }))
      .rejects.toThrow('Session expired');

    expect(store.get('ge_crm_token')).toBe('growth-token');
    expect(store.has('wizmatch_crm_token')).toBe(false);
    expect(store.has('wizmatch_crm_user')).toBe(false);
    expect(store.has('wizmatch_crm_permissions')).toBe(false);
    expect(globalThis.window.location.href).toBe('/login');
  });
});
