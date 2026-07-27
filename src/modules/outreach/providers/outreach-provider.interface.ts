// The outreach-provider contract (PRD-005 §15, ADR-007). Mirrors the shape of
// src/modules/esign/providers/esign-provider.interface.ts exactly (ADR-007 D-1):
// a plain vendor-neutral interface/types module the rest of WizMatch depends on
// ONLY through these shapes — never a vendor's own response model.
//
// Scope of this module (PR 8): contract + capability model + structured errors.
// No Smartlead code, no credentials, no network call, no sending. The mock
// provider (mock.provider.ts) and factory (index.ts) are the only two concrete
// pieces built in this PR; a real 'smartlead_csv' implementation is PR 9.
//
// The provider is a pure formatter/parser over already-authorised inputs. It
// never decides eligibility, never reads or writes policy/suppression/enrolment
// state, and never re-derives what the canonical gate
// (evaluateWizmatchOutreachGate / assertWizmatchOutreachAllowed, outreachGate.ts)
// has already decided. Callers pass it only canonical, already-approved rows.

/** A single approved, export-ready contact row. Vendor-neutral — no Smartlead field names here. */
export interface OutreachContactRow {
  email: string;
  firstName?: string;
  lastName?: string;
  companyName: string;
  companyDomain?: string;
  title?: string;
  customFields?: Record<string, string>;
}

/** Batch identity and routing context the provider needs to format/tag an export. */
export interface OutreachBatchMeta {
  batchId: string;
  tenantId: string;
  campaignType: string;
  outreachMode: string;
  externalCampaignRef?: string;
}

export interface OutreachExportResult {
  csv: string;
  filename: string;
  rowCount: number;
}

/**
 * PROVIDER event vocabulary ONLY — five values a provider can report. This is
 * NOT the enrolment state machine (15 values, src/config/wizmatchOutreachStates.ts).
 * The mapping from one to the other is deliberately one-directional and lives in
 * the caller (PR 9/10), never in this module. ADR-007 D-1: a `replied` event
 * never releases the company cold-email lock (ADR-006 D-16) — that is enforced
 * by the enrolment-state mapping, not by anything in this file.
 */
export type OutreachEventType = 'sent' | 'bounced' | 'replied' | 'unsubscribed' | 'completed';

/** A single normalised delivery/result event, before idempotency-key derivation. */
export interface OutreachResultEvent {
  email: string;
  eventType: OutreachEventType;
  eventAt: Date;
  externalEventId?: string;
  externalMessageId?: string;
  externalLeadRef?: string;
  /** Opaque provider payload, kept for audit — never parsed outside the adapter. */
  raw: unknown;
}

/**
 * Explicit, typed capabilities — never inferred from method existence. A caller
 * must check the relevant flag before invoking a capability-gated operation;
 * `assertOutreachProviderCapability` below is the single enforcement point.
 * An absent/undefined/malformed flag is treated as `false` (fail closed) by
 * that helper — there is no "capability implies method exists" shortcut.
 */
export interface OutreachProviderCapabilities {
  /** Can produce a CSV/file export for manual upload to the provider. */
  readonly exportsCsv: boolean;
  /** Can submit contacts to the provider over a live API (never true in V1). */
  readonly submitsViaApi: boolean;
  /** Can itself dispatch an email. Always false for every V1 provider (ADR-007 D-9). */
  readonly sends: boolean;
  /** Can parse/import a result feed (CSV or API) into OutreachResultEvent rows. */
  readonly importsResults: boolean;
  /** Can poll a live API for results, rather than requiring a manual file import. */
  readonly pollsForResults: boolean;
  readonly reportsBounces: boolean;
  readonly reportsUnsubscribes: boolean;
  readonly reportsReplies: boolean;
  /** Structural declaration only — no reply body/classification logic lives here (PR 10 scope). */
  readonly supportsReplyIngestion: boolean;
  /** Can push a suppression/stop-list entry to the provider itself. */
  readonly supportsProviderSuppression: boolean;
  /** Safe to retry an export/import operation with the same idempotency key. */
  readonly supportsIdempotentSubmission: boolean;
}

export interface OutreachProviderIdentity {
  /** Stable provider name (e.g. 'mock', 'smartlead_csv') — never a vendor request/response model. */
  readonly name: string;
  /** Adapter version (this module's contract version), not the vendor's API version. */
  readonly version: string;
}

export type OutreachProviderConfigStatus =
  | { readonly status: 'ready' }
  | { readonly status: 'not_configured'; readonly reason: string }
  | { readonly status: 'misconfigured'; readonly reason: string };

export interface OutreachProvider {
  readonly identity: OutreachProviderIdentity;
  readonly capabilities: OutreachProviderCapabilities;

  /**
   * Health/configuration status. Must never read a secret merely to report
   * unavailability — presence/absence of a config pointer is enough.
   */
  getConfigStatus(): OutreachProviderConfigStatus;

  /**
   * Format already-approved, canonical rows into a provider-shaped export.
   * The provider does not re-evaluate policy — the caller (PR 9) re-evaluates
   * the gate per row and omits DENYs before rows ever reach this method.
   */
  prepareExportBatch(rows: OutreachContactRow[], batch: OutreachBatchMeta): Promise<OutreachExportResult>;

  /**
   * Parse a raw result feed (a CSV body, in V1) into normalised result events.
   * Never writes anything itself — the caller (PR 9) is responsible for
   * idempotent persistence through the canonical suppression/enrolment paths.
   */
  parseResultFeed(raw: string, batch: OutreachBatchMeta): Promise<OutreachResultEvent[]>;
}

// ---- structured, log-safe errors --------------------------------------------
//
// Every code below is required by the PR 8 spec. Messages must never embed a
// full email address, credential, or free-text PII — callers should refer to a
// row index, batch id, or tenant id instead.

export type OutreachProviderErrorCode =
  | 'unknown_provider'
  | 'unsupported_capability'
  | 'missing_configuration'
  | 'invalid_input'
  | 'duplicate_operation'
  | 'provider_unavailable'
  | 'provider_response_invalid';

export class OutreachProviderError extends Error {
  readonly code: OutreachProviderErrorCode;
  readonly provider: string;

  constructor(code: OutreachProviderErrorCode, provider: string, message: string) {
    super(`[${provider}] ${code}: ${message}`);
    this.name = 'OutreachProviderError';
    this.code = code;
    this.provider = provider;
  }
}

/**
 * The single enforcement point for capability checks. Fails closed on an
 * undefined/malformed capability value — there is no generic execute/request
 * escape hatch anywhere in this module, so every operation must be reached
 * through a named capability checked here.
 */
export function assertOutreachProviderCapability(
  provider: OutreachProvider,
  capability: keyof OutreachProviderCapabilities,
): void {
  if (provider.capabilities[capability] !== true) {
    throw new OutreachProviderError(
      'unsupported_capability',
      provider.identity.name,
      `capability "${capability}" is not supported`,
    );
  }
}

/** Throws unless the provider reports it is ready to use. Never logs the config values themselves. */
export function assertOutreachProviderReady(provider: OutreachProvider): void {
  const status = provider.getConfigStatus();
  if (status.status !== 'ready') {
    throw new OutreachProviderError('missing_configuration', provider.identity.name, status.reason);
  }
}
