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
// ---------------------------------------------------------------------------
// WHY SITE_PROVIDER CANNOT NAME A PLATFORM ADAPTER
//
// When only 'mock' had a builder, SITE_PROVIDER was a harmless uniform
// override. With three real adapters registered it stops being harmless: a
// well-meaning `SITE_PROVIDER=wordpress` would route every git and Shopify
// site's calls through the WordPress adapter too — the exact cross-wiring the
// per-platform Map exists to prevent, reintroduced through the env.
//
// So the two axes are kept separate:
//   - PLATFORM_BUILDERS decides WHICH adapter a platform gets. Not
//     configurable, because "which adapter publishes a WordPress site" is not
//     an operational choice.
//   - SITE_PROVIDER decides whether real adapters are used at all, and accepts
//     only two values: 'platform' (each platform uses its own real adapter) or
//     'mock' (every platform uses the in-memory mock — for a lower environment
//     or a staged rollout). A platform NAME is rejected with an explicit
//     message rather than quietly honoured.
//
// Both gates still fail closed and neither ever falls back to the other.
// ---------------------------------------------------------------------------
import { GitSiteProvider } from './git.provider';
import { MockSiteProvider } from './mock.provider';
import { ShopifySiteProvider } from './shopify.provider';
import { WordPressSiteProvider } from './wordpress.provider';
import { SiteProviderError, type SitePlatform, type SiteProvider } from './site-provider.interface';

/** Every provider that has a builder in this file. */
const KNOWN_PROVIDERS = ['mock', 'git', 'wordpress', 'shopify'] as const;
export type KnownSiteProviderName = (typeof KNOWN_PROVIDERS)[number];

/**
 * The values SITE_PROVIDER accepts. Deliberately NOT the same list as
 * KNOWN_PROVIDERS — see the header.
 */
const SELECTABLE_SITE_PROVIDER_VALUES = ['platform', 'mock'] as const;
type SelectableSiteProviderValue = (typeof SELECTABLE_SITE_PROVIDER_VALUES)[number];

/** Which real adapter each platform uses. Not configurable — see the header. */
const PLATFORM_BUILDERS: Readonly<Record<SitePlatform, KnownSiteProviderName>> = Object.freeze({
  git: 'git',
  wordpress: 'wordpress',
  shopify: 'shopify',
});

function isSelectable(value: string): value is SelectableSiteProviderValue {
  return (SELECTABLE_SITE_PROVIDER_VALUES as readonly string[]).includes(value);
}

function buildProvider(name: KnownSiteProviderName): SiteProvider {
  switch (name) {
    case 'mock':
      return new MockSiteProvider();
    case 'git':
      return new GitSiteProvider();
    case 'wordpress':
      return new WordPressSiteProvider();
    case 'shopify':
      return new ShopifySiteProvider();
    default: {
      // Exhaustiveness guard — keeps this switch honest if a fifth name is
      // ever added to KNOWN_PROVIDERS without a builder.
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
 *  2. `SITE_PROVIDER` must be 'platform' or 'mock'.
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
  if (!isSelectable(raw)) {
    throw new SiteProviderError(
      'unknown_provider',
      raw,
      `"${raw}" is not a valid SITE_PROVIDER — use 'platform' (each platform uses its own adapter) `
        + `or 'mock'. Naming one platform's adapter here would route every platform's sites through it.`,
    );
  }

  const provider = buildProvider(raw === 'mock' ? 'mock' : PLATFORM_BUILDERS[platform]);
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

/** The values SITE_PROVIDER accepts — exported so tests and docs cannot drift from the implementation. */
export function listSelectableSiteProviderValues(): readonly string[] {
  return SELECTABLE_SITE_PROVIDER_VALUES;
}

export { GitSiteProvider, MockSiteProvider, ShopifySiteProvider, WordPressSiteProvider };
export type { SiteProvider };
