import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  getTenantSlug,
  getProductHome,
  getTenantConfig,
  hasExplicitTenantSignal,
  isKnownTenantSlug,
  TENANT_OPTIONS,
} from '../auth.js';

function stubLocation({ search = '', hostname = 'crm.growthescalators.com', pathname = '/login' } = {}) {
  vi.stubGlobal('window', { location: { search, hostname, pathname } });
}

function stubLocalStorage(initial = {}) {
  const store = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
  });
}

beforeEach(() => {
  stubLocalStorage();
  stubLocation();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('tenant signal detection', () => {
  it('is false on a bare /login visit', () => {
    stubLocation({ search: '', hostname: 'crm.growthescalators.com', pathname: '/login' });
    expect(hasExplicitTenantSignal()).toBe(false);
    expect(getTenantSlug()).toBe('growth-escalators');
  });

  it('recognizes explicit Growth, legacy wizmatch, and reseller signals', () => {
    stubLocation({ search: '?tenant=growth-escalators', pathname: '/login' });
    expect(hasExplicitTenantSignal()).toBe(true);

    stubLocation({ search: '?tenant=wizmatch', pathname: '/login' });
    expect(hasExplicitTenantSignal()).toBe(true);

    stubLocation({ search: '?tenant=acme-media', pathname: '/login' });
    expect(hasExplicitTenantSignal()).toBe(true);
  });

  it('recognizes a previously-used legacy tenant from localStorage', () => {
    stubLocalStorage({ crm_active_tenant_slug: 'wizmatch' });
    stubLocation({ search: '', hostname: 'crm.growthescalators.com', pathname: '/login' });
    expect(hasExplicitTenantSignal()).toBe(true);
    expect(getTenantSlug()).toBe('wizmatch');
  });
});

describe('Growth Escalators is the only active selectable product', () => {
  it('exposes only Growth Escalators in product options', () => {
    expect(TENANT_OPTIONS).toHaveLength(1);
    expect(TENANT_OPTIONS[0].slug).toBe('growth-escalators');
    expect(TENANT_OPTIONS[0].label).toBe('Growth Escalators');
  });

  it('does not classify the legacy wizmatch slug as a selectable product', () => {
    expect(isKnownTenantSlug('growth-escalators')).toBe(true);
    expect(isKnownTenantSlug('wizmatch')).toBe(false);
    expect(isKnownTenantSlug('acme-media')).toBe(false);
  });

  it('keeps legacy session branding under Growth Escalators', () => {
    const config = getTenantConfig('wizmatch');
    expect(config.slug).toBe('wizmatch');
    expect(config.label).toBe('Growth Escalators');
    expect(config.shortLabel).toBe('GE');
    expect(config.storagePrefix).toBe('wizmatch_crm');
  });
});

describe('product home during tenant consolidation', () => {
  it('uses the canonical Growth dashboard for Growth Escalators', () => {
    expect(getProductHome('growth-escalators')).toBe('/dashboard');
  });

  it('never sends a legacy session to the retired WizMatch Today page', () => {
    expect(getProductHome('wizmatch')).toBe('/wizmatch/contacts');
    expect(getProductHome('wizmatch')).not.toBe('/wizmatch/today');
  });
});
