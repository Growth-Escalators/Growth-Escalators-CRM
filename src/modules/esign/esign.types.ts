// Vendor-neutral types for the e-signature layer. The rest of the CRM depends
// ONLY on these shapes — never on Documenso's response models — so the signing
// engine can be swapped (mock ↔ documenso ↔ future) without touching callers.

export type ProviderRecipientRole = 'client_signer' | 'internal_countersigner';

export type ProviderRecipientStatus = 'pending' | 'viewed' | 'signed' | 'rejected';

export type ProviderDocumentStatus =
  | 'draft'
  | 'pending'
  | 'partially_signed'
  | 'completed'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface ProviderRecipientInput {
  email: string;
  name: string;
  role: ProviderRecipientRole;
  /** 1-based signing order; client signer(s) before the internal countersigner. */
  signingOrder: number;
}

export interface ProviderRecipientResult {
  email: string;
  externalRecipientId: string;
}

export interface CreateDocumentInput {
  title: string;
  /** The unsigned PDF to be signed. */
  pdf: Buffer;
  recipients: ProviderRecipientInput[];
  /** Opaque metadata echoed back by the provider where supported (e.g. our contractId). */
  externalReference?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateFromTemplateInput {
  templateId: string;
  title: string;
  recipients: ProviderRecipientInput[];
  externalReference?: string;
  /** Field prefills keyed by template field name. */
  prefill?: Record<string, string>;
}

/** A reusable provider template the CRM can generate contracts from. */
export interface TemplateSummary {
  id: string;
  title: string;
  /** Recipient placeholders defined on the template, if the provider exposes them. */
  recipientCount?: number;
}

export interface CreateDocumentResult {
  externalDocumentId: string;
  recipients: ProviderRecipientResult[];
}

export interface AddRecipientsInput {
  externalDocumentId: string;
  recipients: ProviderRecipientInput[];
}

export interface CreateSigningSessionInput {
  externalDocumentId: string;
  /** Identify the signer either by their provider recipient id or their email. */
  externalRecipientId?: string;
  recipientEmail?: string;
  /** Where the embedded signer is returned after completing. */
  returnUrl?: string;
}

export interface SigningSessionResult {
  /** The URL to embed in an iframe for this recipient. */
  signingUrl: string;
  expiresAt?: string;
}

export interface DocumentStatusRecipient {
  email: string;
  externalRecipientId: string;
  status: ProviderRecipientStatus;
  signedAt?: string;
}

export interface DocumentStatusResult {
  status: ProviderDocumentStatus;
  recipients: DocumentStatusRecipient[];
  completedAt?: string;
}

/** Error thrown by providers for upstream/API failures. */
export class ESignProviderError extends Error {
  readonly statusCode: number;
  readonly provider: string;
  constructor(provider: string, message: string, statusCode = 502) {
    super(`[${provider}] ${message}`);
    this.name = 'ESignProviderError';
    this.provider = provider;
    this.statusCode = statusCode;
  }
}
