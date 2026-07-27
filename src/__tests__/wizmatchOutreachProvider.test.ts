import { readdirSync, readFileSync } from 'node:fs';
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

const OUTREACH_DIR = join(__dirname, '..', 'modules', 'outreach');
const PROVIDER_DIR = join(OUTREACH_DIR, 'providers');
/** Adapter-boundary files outside providers/ that the same rules bind. */
const EXTRA_GUARDED = ['outreachIdempotencyKey.ts'];

/**
 * Globbed, never hardcoded. A hardcoded list is invisible to every guard below
 * the moment someone adds a file — and the single most likely such file is
 * PR 9's smartlead provider, i.e. exactly what these guards exist to catch.
 */
function providerFiles(): string[] {
  const files = readdirSync(PROVIDER_DIR).filter((f) => f.endsWith('.ts'));
  if (files.length === 0) throw new Error('provider directory scan found no files — guard is not running');
  return [...files, ...EXTRA_GUARDED];
}

function providerSource(filename: string): string {
  const dir = EXTRA_GUARDED.includes(filename) ? OUTREACH_DIR : PROVIDER_DIR;
  return readFileSync(join(dir, filename), 'utf8');
}

/**
 * Strips comments before grepping. Without this every guard can be defeated (or
 * spuriously tripped) by a word in a docblock, and — more importantly — the
 * guards below scan the WHOLE source rather than only lines starting with
 * `import`, because prettier's own multi-line `import {` style puts the module
 * specifier on a continuation line that an `/^\s*import\b/` filter discards.
 */
function providerCode(filename: string): string {
  return providerSource(filename)
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
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

  it('trims provider identifiers so whitespace cannot produce two rows for one event', () => {
    const base = {
      email: 'jane@acme.com',
      eventType: 'sent' as const,
      eventAt: new Date('2026-07-27T00:00:00.000Z'),
      batchRef: 'batch-1',
    };
    // A CSV parser is exactly where stray whitespace originates. Untrimmed,
    // these derive two different keys and the UNIQUE (tenant, provider, key)
    // constraint that makes a re-import a no-op admits a duplicate row.
    expect(deriveOutreachIdempotencyKey({ ...base, externalEventId: ' evt_1 ' }).key).toBe('evt_1');
    expect(deriveOutreachIdempotencyKey({ ...base, externalMessageId: '\tmsg_1\n' }).key).toBe('msg_1');
    expect(deriveOutreachIdempotencyKey({ ...base, externalLeadRef: ' lead_1 ' }).key).toBe(
      'lead_1:sent:2026-07-27T00:00:00.000Z',
    );
  });

  it('treats a whitespace-only or empty identifier as absent and falls through to the next tier', () => {
    const base = {
      email: 'jane@acme.com',
      eventType: 'sent' as const,
      eventAt: new Date('2026-07-27T00:00:00.000Z'),
      batchRef: 'batch-1',
    };
    expect(deriveOutreachIdempotencyKey({ ...base, externalEventId: '   ', externalMessageId: 'msg_1' })).toEqual({
      key: 'msg_1',
      keySource: 'provider_message_id',
    });
    expect(deriveOutreachIdempotencyKey({ ...base, externalEventId: '', externalMessageId: '  ' }).keySource).toBe(
      'fallback_hash',
    );
  });

  it('rejects an unusable eventAt as a structured error, not a bare RangeError', () => {
    const base = {
      email: 'jane@acme.com',
      eventType: 'sent' as const,
      batchRef: 'batch-1',
      externalLeadRef: 'lead_1',
    };
    expect(() => deriveOutreachIdempotencyKey({ ...base, eventAt: new Date('nonsense') })).toThrow(
      OutreachProviderError,
    );
    expect(() => deriveOutreachIdempotencyKey({ ...base, eventAt: '2026-07-27' as unknown as Date })).toThrow(
      OutreachProviderError,
    );
    try {
      deriveOutreachIdempotencyKey({ ...base, eventAt: new Date('nonsense') });
      expect.unreachable('should have thrown');
    } catch (err) {
      expect((err as OutreachProviderError).code).toBe('invalid_input');
    }
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
    // invalid-email branch
    await expect(provider.parseResultFeed('not-an-email|sent|2026-07-27T00:00:00.000Z|', batch())).rejects.toMatchObject({
      code: 'provider_response_invalid',
    });
    // invalid-date branch
    await expect(provider.parseResultFeed('jane@acme.com|sent|not-a-date|', batch())).rejects.toMatchObject({
      code: 'provider_response_invalid',
    });
  });

  it('rejects a timezone-ambiguous timestamp rather than parsing it in local time', async () => {
    // `new Date('Jul 27 2026')` succeeds and is parsed in LOCAL time, so the
    // same feed would produce different eventAt values — and different
    // idempotency keys — on an IST laptop and a UTC CI box.
    for (const stamp of ['Jul 27 2026', '07/27/2026', '2026-07-27', '2026-07-27T00:00:00']) {
      await expect(
        provider.parseResultFeed(`jane@acme.com|sent|${stamp}|`, batch()),
      ).rejects.toMatchObject({ code: 'provider_response_invalid' });
    }
  });

  it('scenario=unsupported fails closed and performs no work', async () => {
    provider.__setScenario('tenant-a', 'unsupported');
    await expect(provider.prepareExportBatch(rows(), batch())).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    expect(provider.__getCalls('tenant-a')).toEqual([]);
    // The call log alone cannot prove "no work": if the scenario check were
    // moved to just before recordCall, the log would still be empty while the
    // CSV had been built and two ids burned. Assert the id counter is untouched.
    provider.__setScenario('tenant-a', 'success');
    const { csv } = await provider.prepareExportBatch(rows(), batch());
    expect(csv).toContain('mock-lead-tenant-a-1');
  });

  it('an operation whose capability is false cannot execute, even though the method exists', async () => {
    class CapabilityStrippedProvider extends MockOutreachProvider {
      readonly capabilities = Object.freeze({
        ...new MockOutreachProvider().capabilities,
        exportsCsv: false,
        importsResults: false,
      });
    }
    const stripped = new CapabilityStrippedProvider();
    await expect(stripped.prepareExportBatch(rows(), batch())).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    await expect(stripped.parseResultFeed('jane@acme.com|sent|2026-07-27T00:00:00.000Z|', batch())).rejects.toMatchObject({
      code: 'unsupported_capability',
    });
    // and nothing ran
    expect(stripped.__getCalls('tenant-a')).toEqual([]);
  });

  it('capabilities and identity are frozen against runtime mutation of the shared singleton', () => {
    expect(Object.isFrozen(provider.capabilities)).toBe(true);
    expect(Object.isFrozen(provider.identity)).toBe(true);
    expect(() => {
      (provider.capabilities as { sends: boolean }).sends = true;
    }).toThrow(TypeError);
    expect(provider.capabilities.sends).toBe(false);
  });

  it('refuses a blank tenantId rather than collapsing every caller into one bucket', async () => {
    await expect(provider.prepareExportBatch(rows(), batch(''))).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(provider.prepareExportBatch(rows(), batch('   '))).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('neutralises CSV formula injection in operator-facing export cells', async () => {
    const { csv } = await provider.prepareExportBatch(
      [{ email: 'jane@acme.com', companyName: '=HYPERLINK("http://evil","click")', title: '@SUM(A1)' }],
      batch(),
    );
    expect(csv).toContain('"\'=HYPERLINK');
    expect(csv).toContain('"\'@SUM(A1)"');
    // the raw formula must never appear at the start of a cell
    expect(csv).not.toMatch(/(^|,)=/m);
    expect(csv).not.toMatch(/(^|,)@/m);
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

  it('__reset clears calls, scenarios, the id counter and the config status for every tenant', async () => {
    provider.__setScenario('tenant-a', 'failure');
    provider.__setConfigStatus({ status: 'not_configured', reason: 'simulated' });
    // both tenants have real captured calls before the reset, so the
    // post-reset emptiness assertions below are not tautological
    await expect(provider.prepareExportBatch(rows(), batch('tenant-a'))).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    await provider.prepareExportBatch(rows(), batch('tenant-b'));
    expect(provider.__getCalls('tenant-b')).toHaveLength(1);

    provider.__reset();

    expect(provider.__getCalls('tenant-a')).toEqual([]);
    expect(provider.__getCalls('tenant-b')).toEqual([]);
    // scenario cleared — tenant-a now succeeds instead of failing
    await expect(provider.prepareExportBatch(rows(), batch('tenant-a'))).resolves.toBeTruthy();
    // id counter cleared — tenant-b restarts at 1 rather than continuing at 3
    const { csv } = await provider.prepareExportBatch(rows(), batch('tenant-b'));
    expect(csv).toContain('mock-lead-tenant-b-1');
    // config status restored to ready
    expect(provider.getConfigStatus()).toEqual({ status: 'ready' });
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
  it('scans every file in the providers directory, not a hardcoded list', () => {
    // Pins the glob itself. If this ever regresses to a fixed array, a new
    // provider file silently escapes every guard below.
    expect(providerFiles().sort()).toEqual([
      'index.ts',
      'mock.provider.ts',
      'outreach-provider.interface.ts',
      'outreachIdempotencyKey.ts',
    ]);
  });

  it('no provider file references a Smartlead-specific field, header, or module', () => {
    for (const file of providerFiles()) {
      const src = providerCode(file);
      // The default provider *name* string 'smartlead_csv' is documented and
      // expected (PRD-005 §16). Any other Smartlead-shaped identifier — an
      // adapter class, a header/column map under any of its usual names — is
      // PR 9 work and must not exist yet.
      expect(src.replace(/'smartlead_csv'|"smartlead_csv"/g, '')).not.toMatch(/smartlead/i);
      expect(src).not.toMatch(/HEADER_ALIASES|HEADERS\b|COLUMN_MAP|FIELD_ALIASES|CSV_COLUMNS/);
    }
  });

  it('no provider file implements or references PR 10 reply-ingestion machinery', () => {
    for (const file of providerFiles()) {
      // Case- and separator-insensitive: `classify-reply` and `classifyReply`
      // must both trip it, since camelCase is this repo's own convention.
      const src = providerCode(file).replace(/[-_]/g, '');
      expect(src).not.toMatch(/replyinbox|listmailboxes|listinboxes|fetchunseen|fetchunread|imap|classifyreply/i);
    }
  });

  it('no provider file imports the policy gate, under any import syntax', () => {
    for (const file of providerFiles()) {
      // Whole source, not just lines starting with `import`: a prettier-style
      // multi-line import puts the module specifier on a continuation line, so
      // an /^\s*import\b/ line filter never sees it. Also covers `require(),
      // dynamic `await import()`, and barrel re-exports.
      const src = providerCode(file);
      expect(src).not.toMatch(/outreachGate|policyService|policyResolver|decisionWorkbench|campaignCompatibility/);
      expect(src).not.toMatch(/evaluateWizmatchOutreachGate|assertWizmatchOutreachAllowed|resolveCompanyStatus/);
    }
  });

  it('no provider file reads or writes the database, under any access syntax', () => {
    for (const file of providerFiles()) {
      const src = providerCode(file);
      // `db.insert(` alone is trivially evaded by db.execute(sql`INSERT ...`),
      // a tx handle inside db.transaction(), a getDb() accessor, or prettier's
      // own `db\n  .insert(` line break. Reads count too — the provider may not
      // consult policy state either.
      expect(src).not.toMatch(
        /\b(db|tx|trx|pool|client|database|getDb\(\))\s*(?:\.|\[\s*['"])\s*(insert|update|delete|execute|transaction|query|select)\b/i,
      );
      expect(src).not.toMatch(/drizzle|from\s+['"][^'"]*\/db['"]|sql`/i);
    }
  });

  it('no provider file imports anything network-capable, under any import syntax', () => {
    for (const file of providerFiles()) {
      const src = providerCode(file);
      // The bare specifier form (`import https from 'https'`) is the one a
      // node:-prefixed pattern misses, and it is also invisible to a global
      // fetch spy. Cover the whole family, not just fetch.
      expect(src).not.toMatch(/\bfetch\b|XMLHttpRequest|undici|axios|node-fetch|superagent|nodemailer|\bgot\b/i);
      expect(src).not.toMatch(
        /(?:from|import|require)\s*\(?\s*['"](?:node:)?(?:https?|net|tls|dgram|dns|child_process|fs)['"]/,
      );
    }
  });

  it('no provider file reads process.env except the factory\'s single OUTREACH_PROVIDER read', () => {
    for (const file of providerFiles()) {
      const src = providerCode(file);
      const envReads = src.match(/process\s*(?:\.|\[\s*['"])\s*env|\bfrom\s+['"](?:node:)?process['"]/g) ?? [];
      if (file === 'index.ts') {
        // Positive assertion too: exactly one read, and it is the documented one.
        expect(envReads).toHaveLength(1);
        expect(src).toMatch(/process\.env\.OUTREACH_PROVIDER/);
      } else {
        expect(envReads).toEqual([]);
      }
    }
  });

  it('no provider file contains a credential-shaped literal', () => {
    for (const file of providerFiles()) {
      const src = providerCode(file);
      expect(src).not.toMatch(/api[_-]?key\s*[:=]\s*['"]|Bearer\s+[A-Za-z0-9]|secret\s*[:=]\s*['"][^'"]+['"]/i);
    }
  });
});
