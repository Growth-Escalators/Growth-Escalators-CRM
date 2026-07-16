import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTenantSlug } from '../../admin/src/lib/auth.js';
import { apiFetch } from '../../admin/src/lib/api.js';
import { isTerminalOutcome } from '../../admin/src/lib/pipelineStageOutcomes.js';
import { computeFlags, getVisibleEntries } from '../../admin/src/components/navEntries.js';
import { getWizmatchPreviewLinks } from '../../admin/src/lib/wizmatchPreviewLinks.js';
import { normalizeStaffingAccess } from '../../admin/src/lib/staffingAccess.js';

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
  it('does not advertise development-only Wizmatch previews in production', () => {
    expect(getWizmatchPreviewLinks(false)).toEqual([]);
    expect(getWizmatchPreviewLinks(true)).toEqual(expect.arrayContaining([
      ['/wizmatch/review-workbench-demo', 'Workbench'],
    ]));
  });

  it('hides staffing navigation until server-confirmed pilot access is stored', () => {
    expect(computeFlags('staff', {}, 'wizmatch').canStaffing).toBe(false);
    expect(computeFlags('staff', { staffingPilotAccess: true }, 'wizmatch').canStaffing).toBe(true);
    expect(computeFlags('viewer', { staffingPilotAccess: true }, 'wizmatch').canStaffing).toBe(false);
  });

  it('uses runtime staffing phases for navigation and fails closed by default', () => {
    const permissions = { staffingPilotAccess: true };
    const hidden = getVisibleEntries('admin', permissions, 'wizmatch').map(entry => entry.id);
    expect(hidden).not.toContain('companies');
    expect(hidden).not.toContain('submissions');

    const phaseA = getVisibleEntries('admin', permissions, 'wizmatch', { A: true }).map(entry => entry.id);
    expect(phaseA).toContain('companies');
    expect(phaseA).not.toContain('submissions');

    const allPhases = getVisibleEntries('admin', permissions, 'wizmatch', { A: true, B: true, C: true }).map(entry => entry.id);
    expect(allPhases).toContain('companies');
    expect(allPhases).toContain('submissions');
  });

  it('never surfaces pending-merge Wizmatch pages in nav, regardless of phase state', () => {
    // My Work, etc. stay routed + alias-protected but are deliberately absent
    // from Sidebar/CommandPalette until their Phase 2/3 entity merge lands —
    // see wizmatchRouteRegistry.ts. (Talent Matching was promoted into nav so
    // the actionable matcher is reachable — asserted separately below.)
    const permissions = { staffingPilotAccess: true };
    const allPhases = getVisibleEntries('admin', permissions, 'wizmatch', { A: true, B: true, C: true }).map(entry => entry.id);
    for (const pendingMergeId of [
      'my-work', 'review-workbench', 'client-discovery', 'requirement-priority',
      'candidate-intelligence', 'source-candidates',
    ]) {
      expect(allPhases).not.toContain(pendingMergeId);
    }
  });

  it('surfaces Talent Matching in nav once staffing Phase B is on', () => {
    const permissions = { staffingPilotAccess: true, canStaffing: true, staffingPhaseB: true };
    const allPhases = getVisibleEntries('admin', permissions, 'wizmatch', { A: true, B: true, C: true }).map(entry => entry.id);
    expect(allPhases).toContain('talent-matching');
  });

  it('buckets the unified Wizmatch "More" nav into primary vs. labeled subsections', () => {
    const entries = getVisibleEntries('admin', { staffingPilotAccess: true }, 'wizmatch', { A: true, B: true, C: true });
    const today = entries.find(e => e.id === 'today');
    expect(today.group).toBeNull();

    const billing = entries.find(e => e.id === 'more-billing');
    expect(billing.group).toBe('wizmatch-more');
    expect(billing.moreSection).toBe('Finance');

    const system = entries.find(e => e.id === 'more-system');
    expect(system.group).toBe('wizmatch-more');
    expect(system.moreSection).toBe('Administration');
  });

  it('normalizes server staffing access without trusting truthy strings', () => {
    expect(normalizeStaffingAccess({ allowed: true, phases: { A: true, B: 'true', C: 1 } })).toEqual({
      allowed: true,
      phases: { A: true, B: false, C: false },
      capabilities: {},
    });
    expect(normalizeStaffingAccess(null)).toEqual({
      allowed: false,
      phases: { A: false, B: false, C: false },
      capabilities: {},
    });
  });

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
