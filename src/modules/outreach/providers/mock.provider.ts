// In-memory outreach provider. Used by unit/integration tests and by local dev
// (OUTREACH_PROVIDER=mock). Deterministic and dependency-free: no fetch/http
// import anywhere in this file, no env read, no credential of any kind. The
// `__*` helpers are test aids (control scenarios, inspect captured calls,
// reset state) and are NOT part of the OutreachProvider interface — mirrors
// the convention in src/modules/esign/providers/mock.provider.ts exactly.
//
// State is keyed per tenantId throughout, including the sequence counter used
// for deterministic ids, so two tenants driving the same mock instance in the
// same test process can never observe or influence each other's calls or ids.
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
const VALID_EVENT_TYPES: ReadonlySet<string> = new Set([
  'sent',
  'bounced',
  'replied',
  'unsubscribed',
  'completed',
]);

export class MockOutreachProvider implements OutreachProvider {
  readonly identity: OutreachProviderIdentity = { name: 'mock', version: '1.0.0' };

  readonly capabilities: OutreachProviderCapabilities = {
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
  };

  private readonly callsByTenant = new Map<string, MockOutreachCallRecord[]>();
  private readonly scenarioByTenant = new Map<string, MockOutreachScenario>();
  private readonly seqByTenant = new Map<string, number>();
  private configStatus: OutreachProviderConfigStatus = { status: 'ready' };

  getConfigStatus(): OutreachProviderConfigStatus {
    return this.configStatus;
  }

  async prepareExportBatch(rows: OutreachContactRow[], batch: OutreachBatchMeta): Promise<OutreachExportResult> {
    assertOutreachProviderCapability(this, 'exportsCsv');
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

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
