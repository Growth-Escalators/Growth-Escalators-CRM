// In-memory e-signature provider. Used by unit/integration tests and by local
// dev when no Documenso instance is running (ESIGN_PROVIDER=mock). Deterministic
// and dependency-free. The `__*` helpers are test aids (simulate signer actions)
// and are NOT part of the ESignatureProvider interface.
import type { ESignatureProvider } from './esign-provider.interface';
import {
  ESignProviderError,
  type AddRecipientsInput,
  type CreateDocumentInput,
  type CreateDocumentResult,
  type CreateFromTemplateInput,
  type CreateSigningSessionInput,
  type DocumentStatusResult,
  type ProviderRecipientInput,
  type ProviderRecipientStatus,
  type SigningSessionResult,
} from '../esign.types';

interface MockRecipient {
  id: string;
  email: string;
  name: string;
  role: ProviderRecipientInput['role'];
  signingOrder: number;
  status: ProviderRecipientStatus;
  signedAt?: string;
}

interface MockDoc {
  id: string;
  title: string;
  sent: boolean;
  cancelled: boolean;
  recipients: MockRecipient[];
}

function mockPdf(label: string): Buffer {
  return Buffer.from(`%PDF-1.4\n% mock ${label}\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n`);
}

export class MockESignProvider implements ESignatureProvider {
  readonly name = 'mock';
  private docs = new Map<string, MockDoc>();
  private seq = 0;

  // autoSignOnSession simulates instant signing when a signing session is created
  // — used for local/E2E completion (gated by ESIGN_MOCK_AUTOSIGN in the factory).
  // Off by default so unit tests that drive signing explicitly via __sign are unaffected.
  constructor(private readonly opts: { autoSignOnSession?: boolean } = {}) {}

  private nextId(prefix: string): string {
    this.seq += 1;
    // Include randomness so ids are globally unique (like a real provider's UUIDs)
    // — sequential ids collide across process restarts against a persistent DB.
    return `${prefix}_${this.seq}_${Math.random().toString(36).slice(2, 8)}`;
  }

  private require(externalDocumentId: string): MockDoc {
    const doc = this.docs.get(externalDocumentId);
    if (!doc) throw new ESignProviderError('mock', `unknown document ${externalDocumentId}`, 404);
    return doc;
  }

  private makeRecipients(inputs: ProviderRecipientInput[]): MockRecipient[] {
    return inputs.map((r) => ({
      id: this.nextId('rcp'),
      email: r.email.trim().toLowerCase(),
      name: r.name,
      role: r.role,
      signingOrder: r.signingOrder,
      status: 'pending' as ProviderRecipientStatus,
    }));
  }

  async createDocument(input: CreateDocumentInput): Promise<CreateDocumentResult> {
    if (!input.pdf || input.pdf.length === 0) {
      throw new ESignProviderError('mock', 'createDocument requires a non-empty pdf', 400);
    }
    return this.persist(input.title, input.recipients);
  }

  async createFromTemplate(input: CreateFromTemplateInput): Promise<CreateDocumentResult> {
    if (!input.templateId) throw new ESignProviderError('mock', 'templateId required', 400);
    return this.persist(input.title, input.recipients);
  }

  private persist(title: string, recipients: ProviderRecipientInput[]): CreateDocumentResult {
    const id = this.nextId('doc');
    const rcpts = this.makeRecipients(recipients);
    this.docs.set(id, { id, title, sent: false, cancelled: false, recipients: rcpts });
    return {
      externalDocumentId: id,
      recipients: rcpts.map((r) => ({ email: r.email, externalRecipientId: r.id })),
    };
  }

  async addRecipients(input: AddRecipientsInput): Promise<void> {
    const doc = this.require(input.externalDocumentId);
    if (doc.sent) throw new ESignProviderError('mock', 'cannot add recipients after send', 409);
    doc.recipients.push(...this.makeRecipients(input.recipients));
  }

  async sendDocument(externalDocumentId: string): Promise<void> {
    const doc = this.require(externalDocumentId);
    if (doc.recipients.length === 0) throw new ESignProviderError('mock', 'no recipients', 400);
    doc.sent = true;
  }

  async createSigningSession(input: CreateSigningSessionInput): Promise<SigningSessionResult> {
    const doc = this.require(input.externalDocumentId);
    if (!doc.sent) throw new ESignProviderError('mock', 'document not sent', 409);
    const rcpt = doc.recipients.find(
      (r) =>
        (input.externalRecipientId && r.id === input.externalRecipientId) ||
        (input.recipientEmail && r.email === input.recipientEmail.trim().toLowerCase()),
    );
    if (!rcpt) throw new ESignProviderError('mock', 'recipient not found', 404);
    if (this.opts.autoSignOnSession) {
      rcpt.status = 'signed';
      rcpt.signedAt = new Date().toISOString();
    }
    return {
      signingUrl: `https://mock.esign.local/sign/${doc.id}/${rcpt.id}`,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    };
  }

  async getDocumentStatus(externalDocumentId: string): Promise<DocumentStatusResult> {
    const doc = this.require(externalDocumentId);
    const recipients = doc.recipients.map((r) => ({
      email: r.email,
      externalRecipientId: r.id,
      status: r.status,
      signedAt: r.signedAt,
    }));
    let status: DocumentStatusResult['status'];
    let completedAt: string | undefined;
    if (doc.cancelled) status = 'cancelled';
    else if (doc.recipients.some((r) => r.status === 'rejected')) status = 'rejected';
    else if (doc.recipients.every((r) => r.status === 'signed') && doc.recipients.length > 0) {
      status = 'completed';
      completedAt = doc.recipients.reduce<string | undefined>(
        (latest, r) => (r.signedAt && (!latest || r.signedAt > latest) ? r.signedAt : latest),
        undefined,
      );
    } else if (doc.recipients.some((r) => r.status === 'signed')) status = 'partially_signed';
    else if (doc.sent) status = 'pending';
    else status = 'draft';
    return { status, recipients, completedAt };
  }

  async downloadCompletedDocument(externalDocumentId: string): Promise<Buffer> {
    const { status } = await this.getDocumentStatus(externalDocumentId);
    if (status !== 'completed') {
      throw new ESignProviderError('mock', `document not completed (status=${status})`, 409);
    }
    return mockPdf(`completed ${externalDocumentId}`);
  }

  async downloadAuditCertificate(externalDocumentId: string): Promise<Buffer | null> {
    const { status } = await this.getDocumentStatus(externalDocumentId);
    return status === 'completed' ? mockPdf(`audit ${externalDocumentId}`) : null;
  }

  async cancelDocument(externalDocumentId: string): Promise<void> {
    this.require(externalDocumentId).cancelled = true;
  }

  // ---- test helpers (not part of the interface) ----
  __view(externalDocumentId: string, email: string): void {
    const r = this.findRcpt(externalDocumentId, email);
    if (r.status === 'pending') r.status = 'viewed';
  }

  __sign(externalDocumentId: string, email: string): void {
    const r = this.findRcpt(externalDocumentId, email);
    r.status = 'signed';
    r.signedAt = new Date().toISOString();
  }

  __reject(externalDocumentId: string, email: string): void {
    this.findRcpt(externalDocumentId, email).status = 'rejected';
  }

  __reset(): void {
    this.docs.clear();
    this.seq = 0;
  }

  private findRcpt(externalDocumentId: string, email: string): MockRecipient {
    const doc = this.require(externalDocumentId);
    const r = doc.recipients.find((x) => x.email === email.trim().toLowerCase());
    if (!r) throw new ESignProviderError('mock', `recipient ${email} not found`, 404);
    return r;
  }
}
