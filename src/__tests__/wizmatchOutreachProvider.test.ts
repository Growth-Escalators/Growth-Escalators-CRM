import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertOutreachProviderCapability,
  assertOutreachProviderReady,
  OutreachProviderError,
  type OutreachBatchMeta,
  type OutreachContactRow,
} from '../modules/outreach/providers/outreach-provider.interface';
import { MockOutreachProvider } from '../modules/outreach/providers/mock.provider';
import {
  getOutreachProvider,
  listKnownOutreachProviders,
  resetOutreachProvider,
  setOutreachProvider,
} from '../modules/outreach/providers';
import { deriveOutreachIdempotencyKey } from '../modules/outreach/outreachIdempotencyKey';

const PROVIDER_FILES = [
  'outreach-provider.interface.ts',
  'mock.provider.ts',
  'index.ts',
].map((f) => join(__dirname, '..', 'modules', 'outreach', 'providers', f));

function providerSource(filename: string): string {
  return readFileSync(join(__dirname, '..', 'modules', 'outreach', 'providers', filename), 'utf8');
}

function batch(tenantId = 'tenant-a', batchId = 'batch-1'): OutreachBatchMeta {
  return { batchId, tenantId, campaignType: 'fte_permanent', outreachMode: 'cold_email' };
}

function rows(): OutreachContactRow[] {
  return [
    { email: 'jane@acme.com', firstName: 'Jane', lastName: 'Doe', companyName: 'Acme', title: 'HR Lead' },
    { email: 'bob@acme.com', companyName: 'Acme' },
  ];
}

describe('MockOutreachProvider — capability + determinism contract', () => {
  let provider: MockOutreachProvider;
  beforeEach(() => {
    provider = new MockOutreachProvider();
  });

  it('never claims the sending capability', () => {
    expect(provider.capabilities.sends).toBe(false);
    expect(provider.capabilities.submitsViaApi).toBe(false);
  });

  it('declares reply-ingestion and suppression capabilities without implementing them', () => {
    expect(provider.capabilities.supportsReplyIngestion).toBe(true);
    expect(provider.capabilities.supportsProviderSuppression).toBe(false);
  });

  it('is ready by default with no configuration required', () => {
    expect(provider.getConfigStatus()).toEqual({ status: 'ready' });
    expect(() => assertOutreachProviderReady(provider)).not.toThrow();
  });

  it('produces deterministic provider ids and CSV across repeated calls after reset', async () => {
    const first = await provider.prepareExportBatch(rows(), batch());
    provider.__reset();
    const second = await provider.prepareExportBatch(rows(), batch());
    expect(second.csv).toBe(first.csv);
    expect(second.filename).toBe(first.filename);
    expect(first.csv).toContain('mock-lead-tenant-a-1');
    expect(first.csv).toContain('mock-lead-tenant-a-2');
  });

  it('idempotency-key derivation is stable for identical input', () => {
    const input = {
      email: 'jane@acme.com',
      eventType: 'sent' as const,
      eventAt: new Date('2026-07-27T00:00:00.000Z'),
      batchRef: 'batch-1',
    };
    const a = deriveOutreachIdempotencyKey(input);
    const b = deriveOutreachIdempotencyKey(input);
    expect(a).toEqual(b);
  });

  it('idempotency-key derivation prefers provider ids over the fallback hash, in ADR-007 D-3 order', () => {
    const base = {
      email: 'jane@acme.com',
      eventType: 'sent' as const,
      eventAt: new Date('2026-07-27T00:00:00.000Z'),
      batchRef: 'batch-1',
    };
    expect(deriveOutreachIdempotencyKey({ ...base, externalEventId: 'evt_1' })).toEqual({
      key: 'evt_1',
      keySource: 'provider_event_id',
    });
    expect(deriveOutreachIdempotencyKey({ ...base, externalMessageId: 'msg_1' })).toEqual({
      key: 'msg_1',
      keySource: 'provider_message_id',
    });
    expect(deriveOutreachIdempotencyKey({ ...base, externalLeadRef: 'lead_1' })).toEqual({
      key: 'lead_1:sent:2026-07-27T00:00:00.000Z',
      keySource: 'lead_ref_composite',
    });
    const fallback = deriveOutreachIdempotencyKey(base);
    expect(fallback.keySource).toBe('fallback_hash');
    expect(fallback.key).toMatch(/^[0-9a-f]{64}$/);
  });

  it('validates rows and reports invalid input by row index, never by embedding the bad email', async () => {
    await expect(
      provider.prepareExportBatch([{ email: 'not-an-email', companyName: 'Acme' }], batch()),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    try {
      await provider.prepareExportBatch([{ email: 'not-an-email', companyName: 'Acme' }], batch());
    } catch (err) {
      expect((err as Error).message).not.toContain('not-an-email');
      expect((err as Error).message).toContain('row 0');
    }
  });

  it('parses its own deterministic result-feed format into result events', async () => {
    const raw = 'jane@acme.com|sent|2026-07-27T00:00:00.000Z|evt_1\nbob@acme.com|bounced|2026-07-27T01:00:00.000Z|';
    const events = await provider.parseResultFeed(raw, batch());
    expect(events).toEqual([
      {
        email: 'jane@acme.com',
        eventType: 'sent',
        eventAt: new Date('2026-07-27T00:00:00.000Z'),
        externalEventId: 'evt_1',
        raw: 'jane@acme.com|sent|2026-07-27T00:00:00.000Z|evt_1',
      },
      {
        email: 'bob@acme.com',
        eventType: 'bounced',
        eventAt: new Date('2026-07-27T01:00:00.000Z'),
        externalEventId: undefined,
        raw: 'bob@acme.com|bounced|2026-07-27T01:00:00.000Z|',
      },
    ]);
  });

  it('rejects a malformed result-feed line as provider_response_invalid, never guessing a shape', async () => {
    await expect(provider.parseResultFeed('garbage-line-no-pipes', batch())).rejects.toMatchObject({
      code: 'provider_response_invalid',
    });
    await expect(provider.parseResultFeed('jane@acme.com|not_a_real_event|2026-07-27T00:00:00.000Z|', batch())).rejects.toMatchObject({
      code: 'provider_response_invalid',
    });
  });

  it('scenario=unsupported fails closed and performs no work', async () => {
    provider.__setScenario('tenant-a', 'unsupported');
    await expect(provider.prepareExportBatch(rows(), batch())).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    expect(provider.__getCalls('tenant-a')).toEqual([]);
  });

  it('scenario=failure reports provider_unavailable', async () => {
    provider.__setScenario('tenant-a', 'failure');
    await expect(provider.prepareExportBatch(rows(), batch())).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
  });

  it('scenario=duplicate reports duplicate_operation', async () => {
    provider.__setScenario('tenant-a', 'duplicate');
    await expect(provider.prepareExportBatch(rows(), batch())).rejects.toMatchObject({
      code: 'duplicate_operation',
    });
  });

  it('a scenario set for one tenant does not affect another (no cross-tenant leakage)', async () => {
    provider.__setScenario('tenant-a', 'failure');
    await expect(provider.prepareExportBatch(rows(), batch('tenant-a'))).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    await expect(provider.prepareExportBatch(rows(), batch('tenant-b'))).resolves.toBeTruthy();
  });

  it('captured calls never leak across tenants', async () => {
    await provider.prepareExportBatch(rows(), batch('tenant-a', 'batch-a'));
    await provider.prepareExportBatch(rows(), batch('tenant-b', 'batch-b'));
    const aCalls = provider.__getCalls('tenant-a');
    const bCalls = provider.__getCalls('tenant-b');
    expect(aCalls).toHaveLength(1);
    expect(bCalls).toHaveLength(1);
    expect(aCalls[0].batchId).toBe('batch-a');
    expect(bCalls[0].batchId).toBe('batch-b');
  });

  it('deterministic ids never collide across tenants and never share a counter', async () => {
    await provider.prepareExportBatch(rows(), batch('tenant-a'));
    const { csv } = await provider.prepareExportBatch(rows(), batch('tenant-b'));
    // tenant-b's counter starts fresh at 1, exactly like tenant-a's did.
    expect(csv).toContain('mock-lead-tenant-b-1');
    expect(csv).toContain('mock-lead-tenant-b-2');
  });

  it('__getCalls returns a defensive copy that cannot mutate captured history', async () => {
    await provider.prepareExportBatch(rows(), batch());
    const calls = provider.__getCalls('tenant-a');
    calls.push({ method: 'prepareExportBatch', batchId: 'forged', at: new Date(), summary: 'forged' });
    expect(provider.__getCalls('tenant-a')).toHaveLength(1);
  });

  it('__reset clears calls, scenarios, and the id counter for every tenant', async () => {
    provider.__setScenario('tenant-a', 'failure');
    await provider.prepareExportBatch(rows(), batch('tenant-b')).catch(() => undefined);
    provider.__reset();
    expect(provider.__getCalls('tenant-a')).toEqual([]);
    expect(provider.__getCalls('tenant-b')).toEqual([]);
    // scenario cleared too — tenant-a now succeeds instead of failing.
    await expect(provider.prepareExportBatch(rows(), batch('tenant-a'))).resolves.toBeTruthy();
  });

  it('missing configuration is never treated as ready', () => {
    provider.__setConfigStatus({ status: 'not_configured', reason: 'no api key set' });
    expect(() => assertOutreachProviderReady(provider)).toThrow(OutreachProviderError);
    try {
      assertOutreachProviderReady(provider);
    } catch (err) {
      expect((err as OutreachProviderError).code).toBe('missing_configuration');
    }
  });

  it('makes no network call of any kind while exporting or importing', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    try {
      await provider.prepareExportBatch(rows(), batch());
      await provider.parseResultFeed('jane@acme.com|sent|2026-07-27T00:00:00.000Z|', batch());
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('assertOutreachProviderCapability — fails closed on any non-true value', () => {
  it('throws when the capability is explicitly false', () => {
    const provider = new MockOutreachProvider();
    expect(() => assertOutreachProviderCapability(provider, 'sends')).toThrow(OutreachProviderError);
  });

  it('throws for a malformed/unknown capability key rather than treating it as granted', () => {
    const provider = new MockOutreachProvider();
    // Cast bypasses the type system the way a bug (typo, dynamic string) would at runtime.
    expect(() =>
      assertOutreachProviderCapability(provider, 'notARealCapability' as never),
    ).toThrow(OutreachProviderError);
  });

  it('does not throw when the capability is explicitly true', () => {
    const provider = new MockOutreachProvider();
    expect(() => assertOutreachProviderCapability(provider, 'exportsCsv')).not.toThrow();
  });
});

describe('outreach provider factory/registry', () => {
  const ORIGINAL_ENV = process.env.OUTREACH_PROVIDER;

  beforeEach(() => {
    resetOutreachProvider();
  });

  afterEach(() => {
    resetOutreachProvider();
    if (ORIGINAL_ENV === undefined) delete process.env.OUTREACH_PROVIDER;
    else process.env.OUTREACH_PROVIDER = ORIGINAL_ENV;
  });

  it('lists only providers that actually have a builder', () => {
    expect(listKnownOutreachProviders()).toEqual(['mock']);
  });

  it('builds the mock provider when OUTREACH_PROVIDER=mock', () => {
    process.env.OUTREACH_PROVIDER = 'mock';
    const provider = getOutreachProvider();
    expect(provider.identity.name).toBe('mock');
  });

  it('is case-insensitive on the provider name', () => {
    process.env.OUTREACH_PROVIDER = 'MOCK';
    expect(getOutreachProvider().identity.name).toBe('mock');
  });

  it('returns the same singleton instance on repeated calls', () => {
    process.env.OUTREACH_PROVIDER = 'mock';
    expect(getOutreachProvider()).toBe(getOutreachProvider());
  });

  it('fails closed — never falls back to mock or any other provider — for an unknown name', () => {
    process.env.OUTREACH_PROVIDER = 'totally-unknown-vendor';
    expect(() => getOutreachProvider()).toThrow(OutreachProviderError);
    try {
      getOutreachProvider();
    } catch (err) {
      expect((err as OutreachProviderError).code).toBe('unknown_provider');
      expect((err as OutreachProviderError).provider).toBe('totally-unknown-vendor');
    }
  });

  it('fails closed on the documented default (smartlead_csv) since it has no builder in this PR', () => {
    delete process.env.OUTREACH_PROVIDER;
    expect(() => getOutreachProvider()).toThrow(OutreachProviderError);
    try {
      getOutreachProvider();
    } catch (err) {
      expect((err as OutreachProviderError).code).toBe('unknown_provider');
      expect((err as OutreachProviderError).provider).toBe('smartlead_csv');
    }
  });

  it('never selects a live/real provider merely because the adapter module was imported', () => {
    // Import-time only — no env set, no call made. If construction happened at
    // import time this would already have thrown before the test even started.
    expect(listKnownOutreachProviders()).not.toContain('smartlead_csv');
  });

  it('setOutreachProvider/resetOutreachProvider are effective DI hooks', () => {
    const injected = new MockOutreachProvider();
    setOutreachProvider(injected);
    expect(getOutreachProvider()).toBe(injected);
    resetOutreachProvider();
    process.env.OUTREACH_PROVIDER = 'mock';
    expect(getOutreachProvider()).not.toBe(injected);
  });
});

describe('provider-boundary source guards — no PR 9/PR 10 work leaked into PR 8', () => {
  it('no provider file references a Smartlead-specific field, header, or module', () => {
    for (const file of PROVIDER_FILES) {
      const src = readFileSync(file, 'utf8');
      // The default provider *name* string is documented and expected (PRD-005 §16);
      // anything else Smartlead-shaped (a header map, a column list) must not exist yet.
      expect(src).not.toMatch(/smartlead[_-]?csv\.provider/i);
      expect(src).not.toMatch(/HEADER_ALIASES/);
    }
  });

  it('no provider file implements or references PR 10 reply-ingestion machinery', () => {
    for (const file of PROVIDER_FILES) {
      const src = readFileSync(file, 'utf8');
      expect(src).not.toMatch(/ReplyInboxProvider|listMailboxes|fetchUnseen|imapService|classify-reply/i);
    }
  });

  it('no provider file imports the policy gate or reads/writes policy state at runtime', () => {
    for (const file of PROVIDER_FILES) {
      const src = readFileSync(file, 'utf8');
      const importLines = src.split('\n').filter((line) => /^\s*import\b/.test(line));
      for (const line of importLines) {
        expect(line).not.toMatch(/outreachGate|policyService|policyResolver|decisionWorkbench/);
      }
      expect(src).not.toMatch(/db\.(insert|update|delete)\(/);
    }
  });

  it('the mock provider file makes no network-capable import', () => {
    const src = providerSource('mock.provider.ts');
    expect(src).not.toMatch(/\bfetch\(|undici|node:https?|require\(['"]https?['"]\)/);
  });

  it('no provider file reads process.env directly except the factory\'s single OUTREACH_PROVIDER read', () => {
    const interfaceSrc = providerSource('outreach-provider.interface.ts');
    const mockSrc = providerSource('mock.provider.ts');
    expect(interfaceSrc).not.toMatch(/process\.env/);
    expect(mockSrc).not.toMatch(/process\.env/);
  });
});
