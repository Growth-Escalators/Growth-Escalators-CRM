// Site provider factory/registry. Mirrors
// src/modules/outreach/providers/index.ts closely — lazy construction (env,
// network and the database are never touched at import time), a fail-closed
// allow-list with no default or silent fallback to mock, and
// setSiteProvider/resetSiteProvider/listKnownSiteProviders test-injection
// hooks — with one deliberate divergence, documented below.
//
// DIVERGENCE — provider choice is per PLATFORM, not global. Outreach has
// exactly one sending vendor for the whole process, so OUTREACH_PROVIDER
// selects ONE global singleton. Site adapters are chosen per site's
// `platform` column (git / wordpress / shopify) — a single global singleton
// would silently hand a WordPress site's calls to whatever adapter a git site
// configured last (or vice versa) the moment two platforms were live at once.
// This module therefore keeps one singleton PER PLATFORM in a Map, keyed by
// SitePlatform, rather than the single `let singleton` outreach uses.
//
// A consequence: SITE_PROVIDER is not "the" provider name the way
// OUTREACH_PROVIDER is. With only 'mock' buildable in this PR there is no
// real per-platform default to select between yet, so SITE_PROVIDER is
// currently a single allow-list override applied uniformly to every
// platform's slot — for staging a rollout onto one substitute (e.g. forcing
// every platform onto 'mock' in a lower environment) before any real
// git/wordpress/shopify adapter exists. When real per-platform builders land,
// this becomes a per-platform default lookup with SITE_PROVIDER only forcing
// an override — an additive change to this file, not a redesign of it.
import { MockSiteProvider } from './mock.provider';
import { SiteProviderError, type SitePlatform, type SiteProvider } from './site-provider.interface';

const KNOWN_PROVIDERS = ['mock'] as const;
export type KnownSiteProviderName = (typeof KNOWN_PROVIDERS)[number];

function isKnownProvider(name: string): name is KnownSiteProviderName {
  return (KNOWN_PROVIDERS as readonly string[]).includes(name);
}

function buildProvider(name: KnownSiteProviderName): SiteProvider {
  switch (name) {
    case 'mock':
      return new MockSiteProvider();
    default: {
      // Exhaustiveness guard — unreachable while KNOWN_PROVIDERS has one
      // member, but keeps this switch honest if a second name is ever added.
      const _exhaustive: never = name;
      throw new SiteProviderError('unknown_provider', String(_exhaustive), 'no builder registered');
    }
  }
}

/** One lazily-constructed singleton per platform — see the DIVERGENCE note above. */
const singletons = new Map<SitePlatform, SiteProvider>();

/**
 * Resolves a provider for one platform. Reads env only inside this function,
 * never at module-import time, and only when that platform's singleton has
 * not already been constructed or injected.
 *
 * Fails closed in two stages, neither of which ever falls back to mock or to
 * any other provider:
 *  1. `SITE_ADAPTER_ENABLED` (default false) gates the feature as a whole.
 *  2. `SITE_PROVIDER` must name a provider on the allow-list (KNOWN_PROVIDERS).
 */
export function getSiteProvider(platform: SitePlatform): SiteProvider {
  const existing = singletons.get(platform);
  if (existing) return existing;

  const enabled = (process.env.SITE_ADAPTER_ENABLED ?? 'false').trim().toLowerCase() === 'true';
  if (!enabled) {
    throw new SiteProviderError('missing_configuration', platform, 'SITE_ADAPTER_ENABLED is not true');
  }

  const raw = (process.env.SITE_PROVIDER ?? '').trim().toLowerCase();
  if (!raw) {
    throw new SiteProviderError('unknown_provider', platform, 'SITE_PROVIDER is not set');
  }
  if (!isKnownProvider(raw)) {
    throw new SiteProviderError('unknown_provider', raw, `"${raw}" is not a recognised site provider`);
  }

  const provider = buildProvider(raw);
  singletons.set(platform, provider);
  return provider;
}

/** Dependency-injection hook for tests — sets one platform's slot, bypassing the enabled/allow-list checks above. */
export function setSiteProvider(platform: SitePlatform, provider: SiteProvider): void {
  singletons.set(platform, provider);
}

/** Omit `platform` to clear every platform's singleton at once. */
export function resetSiteProvider(platform?: SitePlatform): void {
  if (platform) {
    singletons.delete(platform);
  } else {
    singletons.clear();
  }
}

export function listKnownSiteProviders(): readonly string[] {
  return KNOWN_PROVIDERS;
}

export { MockSiteProvider };
export type { SiteProvider };
