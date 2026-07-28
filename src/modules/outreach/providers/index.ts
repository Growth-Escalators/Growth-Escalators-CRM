// Outreach provider factory/registry (ADR-007 D-1, mirrors
// src/modules/esign/providers/index.ts). Lazy singleton: the module import
// itself never touches env, network or a database — construction happens only
// on the first getOutreachProvider() call, and only 'mock' is constructible in
// this PR.
//
// 'smartlead_csv' is the default OUTREACH_PROVIDER value (PRD-005 §16,
// matching wizmatch_outreach_batches.provider's schema default) and is a real,
// named provider — but it has NO implementation until PR 9. Selecting it here
// therefore fails closed with 'unknown_provider' rather than silently
// constructing something partial or falling back to mock. This is deliberate:
// WIZMATCH_OUTREACH_ADAPTER_ENABLED defaults to false, so nothing calls this
// factory for real work yet, and no caller may treat "not yet implemented" as
// "safe to substitute a different provider."
import { MockOutreachProvider } from './mock.provider';
import { OutreachProviderError, type OutreachProvider } from './outreach-provider.interface';

const KNOWN_PROVIDERS = ['mock'] as const;
export type KnownOutreachProviderName = (typeof KNOWN_PROVIDERS)[number];

function isKnownProvider(name: string): name is KnownOutreachProviderName {
  return (KNOWN_PROVIDERS as readonly string[]).includes(name);
}

function buildProvider(name: KnownOutreachProviderName): OutreachProvider {
  switch (name) {
    case 'mock':
      return new MockOutreachProvider();
    default: {
      // Exhaustiveness guard — unreachable while KNOWN_PROVIDERS has one member,
      // but keeps this switch honest if a second name is ever added here.
      const _exhaustive: never = name;
      throw new OutreachProviderError('unknown_provider', String(_exhaustive), 'no builder registered');
    }
  }
}

let singleton: OutreachProvider | null = null;

/**
 * Resolves `OUTREACH_PROVIDER` (trimmed, lower-cased) against the allow-list
 * above. Unknown or missing values fail closed — there is no default
 * fallback to `mock` or to any other provider. Env is read only inside this
 * function, never at module-import time.
 */
export function getOutreachProvider(): OutreachProvider {
  if (singleton) return singleton;
  // Mirrors ESIGN_PROVIDER's `|| 'documenso'` default exactly (PRD-005 §16:
  // OUTREACH_PROVIDER defaults to 'smartlead_csv'). That name is real but has
  // no builder in this PR, so it falls through to the unknown-provider error
  // below rather than an "(unset)" special case.
  const raw = (process.env.OUTREACH_PROVIDER || 'smartlead_csv').trim().toLowerCase();
  if (!isKnownProvider(raw)) {
    throw new OutreachProviderError('unknown_provider', raw, `"${raw}" is not a recognised outreach provider`);
  }
  singleton = buildProvider(raw);
  return singleton;
}

/** Dependency-injection hook for tests. */
export function setOutreachProvider(provider: OutreachProvider): void {
  singleton = provider;
}

export function resetOutreachProvider(): void {
  singleton = null;
}

export function listKnownOutreachProviders(): readonly string[] {
  return KNOWN_PROVIDERS;
}

export { MockOutreachProvider };
export type { OutreachProvider };
