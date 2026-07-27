// In-memory outreach provider. Used by unit/integration tests and by local dev
// (OUTREACH_PROVIDER=mock). Deterministic and dependency-free: no fetch/http
// import anywhere in this file, no env read, no credential of any kind. The
// `__*` helpers are test aids (control scenarios, inspect captured calls,
// reset state) and are NOT part of the OutreachProvider interface — mirrors
// the convention in src/modules/esign/providers/mock.provider.ts exactly.
//
// Per-tenant state — captured calls, the scenario, and the sequence counter
// used for deterministic ids — is keyed by tenantId, so two tenants driving the
// same mock instance in the same test process can never observe or influence
// each other's calls or ids. `configStatus` is deliberately NOT tenant-keyed:
// it models a provider-level (process-wide) configuration fact, matching
// getConfigStatus()'s tenant-free signature on the interface. Setting it for
// one tenant therefore changes it for all of them — see the PR 8 review's
// M-9/PR-9 blocker on giving getConfigStatus() a tenant argument.
import {
  assertOutreachProviderCapability,
  OutreachProviderError,
  type OutreachBatchMeta,
  type OutreachContactRow,
  type OutreachEventType,
  type OutreachExportResult,
  type OutreachProvider,
  type OutreachProviderCapabilities,
  type OutreachProviderConfigStatus,
  type OutreachProviderIdentity,
  type OutreachResultEvent,
} from './outreach-provider.interface';

export type MockOutreachScenario = 'success' | 'unsupported' | 'failure' | 'duplicate';

export interface MockOutreachCallRecord {
  readonly method: 'prepareExportBatch' | 'parseResultFeed';
  readonly batchId: string;
  readonly at: Date;
  /** A safe, non-PII summary — never the raw rows/events themselves. */
  readonly summary: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/**
 * Strict ISO-8601 UTC only. `new Date(x)` alone would accept locale-dependent
 * forms like 'Jul 27 2026' or '07/27/2026', which ECMA-262 parses in LOCAL
 * time — the same feed would then yield different `eventAt` values (and so
 * different tier-3/tier-4 idempotency keys) on an IST laptop and a UTC CI box.
 */
const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const VALID_EVENT_TYPES: ReadonlySet<string> = new Set([
  'sent',
  'bounced',
  'replied',
  'unsubscribed',
  'completed',
]);

export class MockOutreachProvider implements OutreachProvider {
  // Frozen, not just `readonly`: the factory hands out a process-wide singleton,
  // so a stray `(provider.capabilities as any).sends = true` in one caller would
  // otherwise flip the sending capability for every tenant in the process.
  // `readonly` is erased at runtime; Object.freeze is not.
  readonly identity: OutreachProviderIdentity = Object.freeze({ name: 'mock', version: '1.0.0' });

  readonly capabilities: OutreachProviderCapabilities = Object.freeze({
    exportsCsv: true,
    submitsViaApi: false,
    sends: false,
    importsResults: true,
    pollsForResults: false,
    reportsBounces: true,
    reportsUnsubscribes: true,
    reportsReplies: true,
    supportsReplyIngestion: true,
    supportsProviderSuppression: false,
    supportsIdempotentSubmission: true,
  });

  private readonly callsByTenant = new Map<string, MockOutreachCallRecord[]>();
  private readonly scenarioByTenant = new Map<string, MockOutreachScenario>();
  private readonly seqByTenant = new Map<string, number>();
  private configStatus: OutreachProviderConfigStatus = { status: 'ready' };

  getConfigStatus(): OutreachProviderConfigStatus {
    return this.configStatus;
  }

  async prepareExportBatch(rows: OutreachContactRow[], batch: OutreachBatchMeta): Promise<OutreachExportResult> {
    assertOutreachProviderCapability(this, 'exportsCsv');
    this.assertTenantId(batch.tenantId);
    this.applyScenario(batch.tenantId, 'prepareExportBatch', batch.batchId);

    rows.forEach((row, index) => {
      if (!row.email || !EMAIL_RE.test(row.email)) {
        throw new OutreachProviderError('invalid_input', this.identity.name, `row ${index} has an invalid email`);
      }
      if (!row.companyName) {
        throw new OutreachProviderError('invalid_input', this.identity.name, `row ${index} is missing companyName`);
      }
    });

    const header = ['mock_lead_id', 'email', 'first_name', 'last_name', 'company_name', 'title'];
    const lines = [header.join(',')];
    for (const row of rows) {
      const leadId = this.nextId(batch.tenantId);
      lines.push(
        [
          leadId,
          row.email,
          row.firstName ?? '',
          row.lastName ?? '',
          row.companyName,
          row.title ?? '',
        ]
          .map(csvEscape)
          .join(','),
      );
    }

    this.recordCall(batch.tenantId, 'prepareExportBatch', batch.batchId, `rows=${rows.length}`);
    return {
      csv: `${lines.join('\n')}\n`,
      filename: `mock-export-${batch.batchId}.csv`,
      rowCount: rows.length,
    };
  }

  /**
   * Mock-only wire format, deliberately NOT Smartlead's — one event per line:
   * `email|eventType|eventAtIso|externalEventId`. A real CSV format is never
   * guessed here (ADR-007 D-5); PR 9 owns the real Smartlead parser.
   */
  async parseResultFeed(raw: string, batch: OutreachBatchMeta): Promise<OutreachResultEvent[]> {
    assertOutreachProviderCapability(this, 'importsResults');
    this.assertTenantId(batch.tenantId);
    this.applyScenario(batch.tenantId, 'parseResultFeed', batch.batchId);

    const events: OutreachResultEvent[] = [];
    const lines = raw.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    for (const line of lines) {
      const parts = line.split('|');
      if (parts.length < 3) {
        throw new OutreachProviderError('provider_response_invalid', this.identity.name, 'malformed result line');
      }
      const [email, eventType, eventAtRaw, externalEventId] = parts;
      if (!email || !EMAIL_RE.test(email)) {
        throw new OutreachProviderError('provider_response_invalid', this.identity.name, 'malformed result line');
      }
      if (!VALID_EVENT_TYPES.has(eventType)) {
        throw new OutreachProviderError('provider_response_invalid', this.identity.name, 'malformed result line');
      }
      if (!ISO_UTC_RE.test(eventAtRaw)) {
        throw new OutreachProviderError('provider_response_invalid', this.identity.name, 'malformed result line');
      }
      const eventAt = new Date(eventAtRaw);
      if (Number.isNaN(eventAt.getTime())) {
        throw new OutreachProviderError('provider_response_invalid', this.identity.name, 'malformed result line');
      }
      events.push({
        email,
        eventType: eventType as OutreachEventType,
        eventAt,
        externalEventId: externalEventId || undefined,
        raw: line,
      });
    }

    this.recordCall(batch.tenantId, 'parseResultFeed', batch.batchId, `events=${events.length}`);
    return events;
  }

  // ---- test helpers (not part of the OutreachProvider interface) ----------

  /** Controls the outcome of the next call(s) for one tenant. Defaults to 'success'. */
  __setScenario(tenantId: string, scenario: MockOutreachScenario): void {
    this.scenarioByTenant.set(tenantId, scenario);
  }

  __setConfigStatus(status: OutreachProviderConfigStatus): void {
    this.configStatus = status;
  }

  /** A defensive copy — callers cannot mutate captured history through the return value. */
  __getCalls(tenantId: string): MockOutreachCallRecord[] {
    return [...(this.callsByTenant.get(tenantId) ?? [])];
  }

  __reset(): void {
    this.callsByTenant.clear();
    this.scenarioByTenant.clear();
    this.seqByTenant.clear();
    this.configStatus = { status: 'ready' };
  }

  // ---- internals ------------------------------------------------------------

  /**
   * An empty/blank tenantId would silently collapse every such caller into one
   * shared Map bucket, sharing scenarios, captured calls and the id counter —
   * i.e. the exact cross-tenant leak the per-tenant keying exists to prevent.
   */
  private assertTenantId(tenantId: string): void {
    if (typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      throw new OutreachProviderError('invalid_input', this.identity.name, 'batch.tenantId is required');
    }
  }

  private applyScenario(tenantId: string, method: MockOutreachCallRecord['method'], batchId: string): void {
    const scenario = this.scenarioByTenant.get(tenantId) ?? 'success';
    if (scenario === 'success') return;
    if (scenario === 'unsupported') {
      throw new OutreachProviderError('unsupported_capability', this.identity.name, `${method} scenario=unsupported`);
    }
    if (scenario === 'failure') {
      throw new OutreachProviderError('provider_unavailable', this.identity.name, `${method} scenario=failure`);
    }
    if (scenario === 'duplicate') {
      throw new OutreachProviderError(
        'duplicate_operation',
        this.identity.name,
        `${method} batch=${batchId} scenario=duplicate`,
      );
    }
  }

  private recordCall(tenantId: string, method: MockOutreachCallRecord['method'], batchId: string, summary: string): void {
    const list = this.callsByTenant.get(tenantId) ?? [];
    list.push({ method, batchId, at: new Date(), summary });
    this.callsByTenant.set(tenantId, list);
  }

  /** Sequential per-tenant counter — deterministic within a tenant, isolated across tenants. */
  private nextId(tenantId: string): string {
    const next = (this.seqByTenant.get(tenantId) ?? 0) + 1;
    this.seqByTenant.set(tenantId, next);
    return `mock-lead-${tenantId}-${next}`;
  }
}

/**
 * An export file exists to be opened by a human in Excel or Google Sheets
 * (ADR-007: "Export files contain contact PII: generated on demand, streamed").
 * A cell beginning `= + - @` — or a tab/CR, which those apps strip before
 * evaluating — is executed as a formula by both, and `companyName`/`title`
 * originate from scraped job-signal data, so they are attacker-influenceable.
 * Prefixing with an apostrophe is the standard neutralisation; the value is
 * always quoted too, so the guard cannot itself break the CSV record.
 * PR 9's real Smartlead exporter must reuse this, not re-roll its own escaper.
 */
const CSV_FORMULA_PREFIX_RE = /^[=+\-@\t\r]/;

function csvEscape(value: string): string {
  const neutralised = CSV_FORMULA_PREFIX_RE.test(value) ? `'${value}` : value;
  if (
    neutralised !== value ||
    neutralised.includes(',') ||
    neutralised.includes('"') ||
    neutralised.includes('\n') ||
    neutralised.includes('\r')
  ) {
    return `"${neutralised.replace(/"/g, '""')}"`;
  }
  return neutralised;
}
