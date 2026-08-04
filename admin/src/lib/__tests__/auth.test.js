import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getTenantSlug, hasExplicitTenantSignal, isKnownTenantSlug } from '../auth.js';

// Bug 1 (reseller readiness Round 3, 2026-08-04): getTenantSlug() falls all
// the way through query param -> hostname -> pathname -> localStorage to a
// SILENT default of 'growth-escalators' when none of those carry a signal.
// LoginPage.jsx used to treat that silent default as "growth-escalators was
// asked for explicitly" and render the GE/Wizmatch product picker — which
// leaked "Wizmatch" as a login option to anyone landing on the bare
// crm.growthescalators.com/login with no `?tenant=` link and a fresh
// browser. hasExplicitTenantSignal() is the fix: it distinguishes "nothing
// was asked for" from "growth-escalators was asked for", and LoginPage now
// only shows the picker when this is true (see LoginPage.jsx's
// showProductPicker).
//
// This file has no jsdom/testing-library set up (see vitest.config.ts) —
// auth.js only reads `window.location` and the bare `localStorage` global
// directly (never any other DOM API), so plain stubbed objects via
// vi.stubGlobal are sufficient; no real DOM is needed.

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
  // Default: bare browser, nothing in localStorage yet. Individual tests
  // override via stubLocation/stubLocalStorage.
  stubLocalStorage();
  stubLocation();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hasExplicitTenantSignal', () => {
  it('is false on a bare /login visit — no query param, GE-neutral hostname, non-product path, empty localStorage', () => {
    stubLocation({ search: '', hostname: 'crm.growthescalators.com', pathname: '/login' });
    expect(hasExplicitTenantSignal()).toBe(false);
    // Proves the bug scenario still exists at the getTenantSlug() level —
    // it silently resolves to growth-escalators even with zero signal.
    // hasExplicitTenantSignal() is what tells the two cases apart.
    expect(getTenantSlug()).toBe('growth-escalators');
  });

  it('is true when ?tenant=growth-escalators is present', () => {
    stubLocation({ search: '?tenant=growth-escalators', pathname: '/login' });
    expect(hasExplicitTenantSignal()).toBe(true);
  });

  it('is true when ?tenant=wizmatch is present', () => {
    stubLocation({ search: '?tenant=wizmatch', pathname: '/login' });
    expect(hasExplicitTenantSignal()).toBe(true);
  });

  it('is true when ?product= (the alternate query param getTenantSlug also reads) is present', () => {
    stubLocation({ search: '?product=wizmatch', pathname: '/login' });
    expect(hasExplicitTenantSignal()).toBe(true);
  });

  it('is true from a wizmatch-flavoured hostname alone, no query param', () => {
    stubLocation({ search: '', hostname: 'wizmatch.growthescalators.com', pathname: '/login' });
    expect(hasExplicitTenantSignal()).toBe(true);
  });

  it('is true from a previously-used localStorage tenant, no query param or product hostname/path', () => {
    stubLocalStorage({ crm_active_tenant_slug: 'wizmatch' });
    stubLocation({ search: '', hostname: 'crm.growthescalators.com', pathname: '/login' });
    expect(hasExplicitTenantSignal()).toBe(true);
  });

  it('is false for an unrelated path with empty localStorage', () => {
    stubLocation({ search: '', hostname: 'crm.growthescalators.com', pathname: '/some-random-path' });
    expect(hasExplicitTenantSignal()).toBe(false);
  });
});

describe('LoginPage product-picker visibility (hasExplicitTenantSignal() && isKnownTenantSlug(tenantSlug))', () => {
  function showProductPicker() {
    return hasExplicitTenantSignal() && isKnownTenantSlug(getTenantSlug());
  }

  it('picker is hidden with zero signal present', () => {
    stubLocation({ search: '', hostname: 'crm.growthescalators.com', pathname: '/login' });
    expect(showProductPicker()).toBe(false);
  });

  it('picker is shown when ?tenant=growth-escalators is present', () => {
    stubLocation({ search: '?tenant=growth-escalators', pathname: '/login' });
    expect(showProductPicker()).toBe(true);
  });

  it('picker is shown when ?tenant=wizmatch is present', () => {
    stubLocation({ search: '?tenant=wizmatch', pathname: '/login' });
    expect(showProductPicker()).toBe(true);
  });

  it('picker stays hidden for an explicit but unknown reseller slug (e.g. ?tenant=acme-media) — isKnownTenantSlug still filters it out', () => {
    stubLocation({ search: '?tenant=acme-media', pathname: '/login' });
    expect(showProductPicker()).toBe(false);
  });

  it('picker is shown on the redirect App.jsx\'s PrivateRoute sends an expired session to, which always passes an explicit ?tenant=', () => {
    // Mirrors App.jsx PrivateRoute: `/login?tenant=${requestedProduct}&returnTo=...`
    stubLocation({ search: '?tenant=wizmatch&returnTo=%2Fwizmatch%2Ftoday', pathname: '/login' });
    expect(showProductPicker()).toBe(true);
  });
});
