// The e-signature provider contract. Implementations: mock.provider (tests /
// local dev without Documenso) and documenso.provider (self-hosted Documenso CE).
// All server-to-server; provider credentials never reach the frontend.
import type {
  CreateDocumentInput,
  CreateFromTemplateInput,
  CreateDocumentResult,
  AddRecipientsInput,
  CreateSigningSessionInput,
  SigningSessionResult,
  DocumentStatusResult,
  TemplateSummary,
} from '../esign.types';

export interface ESignatureProvider {
  /** Stable provider name (e.g. 'documenso', 'mock') — stored on the contract row. */
  readonly name: string;

  /** Create a signable document from an uploaded PDF. */
  createDocument(input: CreateDocumentInput): Promise<CreateDocumentResult>;

  /** Create a signable document from a pre-built provider template. */
  createFromTemplate(input: CreateFromTemplateInput): Promise<CreateDocumentResult>;

  /** List reusable templates the CRM can generate contracts from. */
  listTemplates(): Promise<TemplateSummary[]>;

  /** Attach (additional) recipients to a draft document. */
  addRecipients(input: AddRecipientsInput): Promise<void>;

  /** Move a document from draft to sent/pending (recipients become able to sign). */
  sendDocument(externalDocumentId: string): Promise<void>;

  /** Create a per-recipient embedded signing session (iframe URL). */
  createSigningSession(input: CreateSigningSessionInput): Promise<SigningSessionResult>;

  /** Authoritative server-side status — the source of truth for completion. */
  getDocumentStatus(externalDocumentId: string): Promise<DocumentStatusResult>;

  /** Download the completed (signed) PDF. Throws if not yet completed. */
  downloadCompletedDocument(externalDocumentId: string): Promise<Buffer>;

  /** Download the completion/audit certificate, or null if the provider has none. */
  downloadAuditCertificate(externalDocumentId: string): Promise<Buffer | null>;

  /** Cancel/void a document at the provider. */
  cancelDocument(externalDocumentId: string): Promise<void>;
}
