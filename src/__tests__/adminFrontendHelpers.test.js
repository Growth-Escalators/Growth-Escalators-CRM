import { afterEach, describe, expect, it, vi } from 'vitest';
import { getTenantSlug } from '../../admin/src/lib/auth.js';
import { apiFetch } from '../../admin/src/lib/api.js';
import { isTerminalOutcome } from '../../admin/src/lib/pipelineStageOutcomes.js';
import { computeFlags, getVisibleEntries } from '../../admin/src/components/navEntries.js';
import { getWizmatchPreviewLinks } from '../../admin/src/lib/wizmatchPreviewLinks.js';
import { normalizeStaffingAccess } from '../../admin/src/lib/staffingAccess.js';
import { capabilityFor, resolveBulkCapability, resolveSelectionCapability } from '../../admin/src/lib/todayActionCapabilities.js';

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

  it('stale runtime staffing phases cannot resurrect retired WizMatch navigation', () => {
    const permissions = { staffingPilotAccess: true };
    const baseline = getVisibleEntries('admin', permissions, 'wizmatch').map(entry => entry.id);
    const phaseA = getVisibleEntries('admin', permissions, 'wizmatch', { A: true }).map(entry => entry.id);
    const allPhases = getVisibleEntries('admin', permissions, 'wizmatch', { A: true, B: true, C: true }).map(entry => entry.id);

    expect(phaseA).toEqual(baseline);
    expect(allPhases).toEqual(baseline);
    for (const retiredId of ['companies', 'submissions', 'candidates', 'requirements', 'talent-matching']) {
      expect(baseline).not.toContain(retiredId);
      expect(phaseA).not.toContain(retiredId);
      expect(allPhases).not.toContain(retiredId);
    }
  });

  it('never surfaces pending-merge Wizmatch pages in nav, regardless of phase state', () => {
    const permissions = { staffingPilotAccess: true };
    const allPhases = getVisibleEntries('admin', permissions, 'wizmatch', { A: true, B: true, C: true }).map(entry => entry.id);
    for (const pendingMergeId of [
      'my-work', 'review-workbench', 'client-discovery', 'requirement-priority',
      'candidate-intelligence', 'source-candidates',
    ]) {
      expect(allPhases).not.toContain(pendingMergeId);
    }
  });

  it('keeps Talent Matching retired even when every stale staffing phase flag is on', () => {
    const permissions = { staffingPilotAccess: true, canStaffing: true, staffingPhaseB: true };
    const allPhases = getVisibleEntries('admin', permissions, 'wizmatch', { A: true, B: true, C: true }).map(entry => entry.id);
    expect(allPhases).not.toContain('talent-matching');
  });

  it('buckets only Growth CRM compatibility entries under labeled More subsections', () => {
    const entries = getVisibleEntries(
      'admin',
      { staffingPilotAccess: true, billingView: true, isOwner: true, contractsView: true },
      'wizmatch',
      { A: true, B: true, C: true },
      { gstBilling: true },
    );

    expect(entries.find(e => e.id === 'today')).toBeUndefined();
    expect(entries.every(e => e.group === 'wizmatch-more')).toBe(true);

    const contacts = entries.find(e => e.id === 'more-contacts');
    expect(contacts.group).toBe('wizmatch-more');
    expect(contacts.moreSection).toBe('CRM Utilities');

    const permissions = entries.find(e => e.id === 'more-permissions');
    expect(permissions.group).toBe('wizmatch-more');
    expect(permissions.moreSection).toBe('Administration');

    const billing = entries.find(e => e.id === 'more-billing');
    expect(billing.group).toBe('wizmatch-more');
    expect(billing.moreSection).toBe('Finance');

    expect(entries.find(e => e.id === 'more-system')).toBeUndefined();
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

// PR 8B (P8B-2) — the workbench renders only actions the server told it the
// user may take. Everything the UI cannot interpret must fail CLOSED: showing
// an enabled control on unreadable data is the same dishonesty P8B-2 removes,
// even though the server would still reject the click.
describe('Today workbench action capabilities — fail closed on missing or malformed data', () => {
  const enabledItem = { capabilities: { approve_queue: { enabled: true, reason: null } } };

  it('renders an action the backend marked enabled', () => {
    expect(capabilityFor(enabledItem, 'approve_queue')).toEqual({ enabled: true, reason: null });
  });

  it.each([
    ['item is undefined', undefined],
    ['item has no capabilities object at all (older backend)', {}],
    ['capabilities is null', { capabilities: null }],
    ['capabilities is not an object', { capabilities: 'nope' }],
    ['this action is absent from capabilities', { capabilities: { pause: { enabled: true } } }],
    ['the entry is not an object', { capabilities: { approve_queue: true } }],
    ['enabled is missing', { capabilities: { approve_queue: { reason: 'why' } } }],
    ['enabled is truthy but not exactly true', { capabilities: { approve_queue: { enabled: 'yes' } } }],
  ])('fails closed when %s', (_label, item) => {
    const capability = capabilityFor(item, 'approve_queue');
    expect(capability.enabled).toBe(false);
    expect(capability.reason).toBeTruthy();
  });

  it("keeps the server's own reason when it supplied one with enabled:false", () => {
    const item = { capabilities: { resume: { enabled: false, reason: 'Overriding a block requires an admin.' } } };
    expect(capabilityFor(item, 'resume')).toEqual({
      enabled: false,
      reason: 'Overriding a block requires an admin.',
    });
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['a non-object', 'admin'],
    ['an object with no enabled flag', {}],
    ['enabled truthy but not exactly true', { enabled: 1 }],
  ])('bulk capability fails closed when it is %s', (_label, capability) => {
    const resolved = resolveBulkCapability(capability);
    expect(resolved.enabled).toBe(false);
    expect(resolved.reason).toBeTruthy();
  });

  it('bulk capability is enabled only on an explicit enabled:true', () => {
    expect(resolveBulkCapability({ enabled: true, reason: null })).toEqual({ enabled: true, reason: null });
    expect(resolveBulkCapability({ enabled: false, reason: 'Bulk actions require admin.' }))
      .toEqual({ enabled: false, reason: 'Bulk actions require admin.' });
  });
});

// H-6 / M-0 / M-1 remediation — `resolveSelectionCapability` intersects the
// SELECTED rows' own per-item capabilities instead of answering from the
// role-only `bulkCapability` alone. Fixtures below mirror the shape
// `computeTodayActionCapabilities` in decisionWorkbenchCapabilities.ts
// actually attaches per item.
describe('resolveSelectionCapability — bulk bar answers the actual selection, not just the role gate', () => {
  const adminBulkAllowed = { enabled: true, reason: null };
  const teamLeadBulkDenied = { enabled: false, reason: 'Bulk actions require admin.' };
  const nonOverridableReason = "This company has a non-overridable block. No override, resume or reclassify action is available at any scope.";

  const ordinaryItem = (companyId) => ({
    companyId,
    capabilities: {
      resume: { enabled: true, reason: null },
      assign_owner: { enabled: true, reason: null },
    },
  });
  const nonOverridableBlockedItem = (companyId) => ({
    companyId,
    capabilities: {
      resume: { enabled: false, reason: nonOverridableReason },
      // Task 9/P8B-1 — assign_owner is NOT an UNBLOCKING_ACTIONS entry, so a
      // non-overridable block never disables it.
      assign_owner: { enabled: true, reason: null },
    },
  });

  it('fails closed on an empty or malformed selection, same idiom as capabilityFor/resolveBulkCapability', () => {
    expect(resolveSelectionCapability([], 'resume', adminBulkAllowed)).toMatchObject({ enabled: false });
    expect(resolveSelectionCapability(undefined, 'resume', adminBulkAllowed)).toMatchObject({ enabled: false });
    expect(resolveSelectionCapability(null, 'resume', adminBulkAllowed)).toMatchObject({ enabled: false });
  });

  it('single-row selection resolves the ROW\'S OWN single-context answer, bypassing the bulk role gate entirely (M-0/M-1 guard)', () => {
    // A team_lead's bulkCapability denies (bulk is admin-only), but a
    // single-target request is never "bulk" server-side — `isBulk =
    // targets.length > 1` in wizmatchToday.ts — so the server accepts it from
    // a team_lead. The bar must answer from the row itself, not the bulk gate.
    const result = resolveSelectionCapability([ordinaryItem('c1')], 'resume', teamLeadBulkDenied);
    expect(result).toEqual({ enabled: true, reason: null });
  });

  it('mixed selection: one row denies, one allows — reports the partial denial with the specific reason', () => {
    const selection = [ordinaryItem('c1'), nonOverridableBlockedItem('c2')];
    const resumeResult = resolveSelectionCapability(selection, 'resume', adminBulkAllowed);
    expect(resumeResult.enabled).toBe(false);
    expect(resumeResult.reason).toContain('1 of 2');
    expect(resumeResult.reason).toContain(nonOverridableReason);

    // assign_owner is permitted by both rows, so the intersection is enabled.
    const assignOwnerResult = resolveSelectionCapability(selection, 'assign_owner', adminBulkAllowed);
    expect(assignOwnerResult).toEqual({ enabled: true, reason: null });
  });

  it('all-non-overridable selection: reports the SPECIFIC block reason, not the generic bulk-admin message (H-6 direct guard)', () => {
    const selection = [nonOverridableBlockedItem('c1'), nonOverridableBlockedItem('c2')];
    const result = resolveSelectionCapability(selection, 'resume', adminBulkAllowed);
    expect(result.enabled).toBe(false);
    expect(result.reason).toBe(nonOverridableReason);
    expect(result.reason).not.toMatch(/Bulk actions require admin/);
  });

  it('role gate short-circuits BEFORE the per-item intersection: a team_lead selecting two individually-permitted rows still stays disabled', () => {
    const selection = [ordinaryItem('c1'), ordinaryItem('c2')];
    const result = resolveSelectionCapability(selection, 'assign_owner', teamLeadBulkDenied);
    expect(result).toEqual({ enabled: false, reason: 'Bulk actions require admin.' });
  });

  it('re-derives fresh from whatever items are passed — proves the workbench cannot render a stale capability for a selected id', () => {
    // Simulates the same companyId across two successive `queues` loads: the
    // component always looks the id up in the CURRENT queues state (see
    // `itemsByIdByQueue` in TodayDecisionWorkbench.jsx), never a captured
    // snapshot, so calling this function with the freshly-looked-up item
    // must reflect the item's CURRENT capabilities every time.
    const beforeReload = nonOverridableBlockedItem('c1');
    const afterReload = ordinaryItem('c1'); // same id, now unblocked
    expect(resolveSelectionCapability([beforeReload], 'resume', adminBulkAllowed)).toEqual({ enabled: false, reason: nonOverridableReason });
    expect(resolveSelectionCapability([afterReload], 'resume', adminBulkAllowed)).toEqual({ enabled: true, reason: null });
  });
});