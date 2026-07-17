// Provider factory. Selects the active e-signature provider from ESIGN_PROVIDER
// (default 'documenso'; 'mock' for tests / local dev without a Documenso instance).
// The singleton is lazily built so unconfigured Documenso env doesn't throw at import.
import type { ESignatureProvider } from './esign-provider.interface';
import { MockESignProvider } from './mock.provider';
import { DocumensoProvider } from './documenso.provider';

let singleton: ESignatureProvider | null = null;

export function getESignProvider(): ESignatureProvider {
  if (singleton) return singleton;
  const which = (process.env.ESIGN_PROVIDER || 'documenso').toLowerCase();
  singleton = which === 'mock'
    ? new MockESignProvider({ autoSignOnSession: process.env.ESIGN_MOCK_AUTOSIGN === '1' })
    : new DocumensoProvider();
  return singleton;
}

/** Dependency-injection hook for tests. */
export function setESignProvider(provider: ESignatureProvider): void {
  singleton = provider;
}

export function resetESignProvider(): void {
  singleton = null;
}

export { MockESignProvider, DocumensoProvider };
export type { ESignatureProvider };
