// Documenso Community Edition provider — talks to a SEPARATE self-hosted
// Documenso instance over its v1 REST API, server-to-server only. The API token
// never leaves the backend. Documents/recipients/status map to our vendor-neutral
// types so no caller depends on Documenso's shapes.
//
// NOTE(verify-live): endpoint paths + the embedded-signing token flow follow
// Documenso's documented v1 API and are validated against the pinned Docker
// instance (docs/esign/docker-compose.documenso.yml) during P6/P9. Any endpoint
// drift is corrected here only — nothing else in the CRM changes.
import type { ESignatureProvider } from './esign-provider.interface';
import {
  ESignProviderError,
  type AddRecipientsInput,
  type CreateDocumentInput,
  type CreateDocumentResult,
  type CreateFromTemplateInput,
  type CreateSigningSessionInput,
  type DocumentStatusRecipient,
  type DocumentStatusResult,
  type ProviderDocumentStatus,
  type ProviderRecipientInput,
  type ProviderRecipientStatus,
  type SigningSessionResult,
  type TemplateSummary,
} from '../esign.types';

const NAME = 'documenso';
const TIMEOUT_MS = 15_000;

function mapRecipientRole(role: ProviderRecipientInput['role']): string {
  // Documenso recipient roles: SIGNER | APPROVER | CC | VIEWER. Both our roles sign.
  return role === 'internal_countersigner' ? 'SIGNER' : 'SIGNER';
}

function mapDocumentStatus(raw: unknown): ProviderDocumentStatus {
  const s = String(raw ?? '').toUpperCase();
  switch (s) {
    case 'DRAFT': return 'draft';
    case 'PENDING': return 'pending';
    case 'COMPLETED': return 'completed';
    case 'REJECTED': return 'rejected';
    case 'EXPIRED': return 'expired';
    case 'CANCELLED':
    case 'CANCELED': return 'cancelled';
    default: return 'pending';
  }
}

function mapRecipientStatus(signingStatus: unknown, readStatus?: unknown): ProviderRecipientStatus {
  const s = String(signingStatus ?? '').toUpperCase();
  if (s === 'SIGNED' || s === 'COMPLETED') return 'signed';
  if (s === 'REJECTED') return 'rejected';
  if (String(readStatus ?? '').toUpperCase() === 'OPENED') return 'viewed';
  return 'pending';
}

export class DocumensoProvider implements ESignatureProvider {
  readonly name = NAME;

  private config(): { baseUrl: string; token: string } {
    const baseUrl = process.env.DOCUMENSO_API_URL?.trim().replace(/\/+$/, '');
    const token = process.env.DOCUMENSO_API_TOKEN?.trim();
    if (!baseUrl || !token) {
      throw new ESignProviderError(NAME, 'DOCUMENSO_API_URL / DOCUMENSO_API_TOKEN not configured', 503);
    }
    return { baseUrl, token };
  }

  private async request<T = unknown>(
    path: string,
    opts: { method?: string; body?: unknown; raw?: boolean } = {},
  ): Promise<T> {
    const { baseUrl, token } = this.config();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        method: opts.method ?? 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: opts.raw ? 'application/pdf' : 'application/json',
          ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new ESignProviderError(NAME, `${opts.method ?? 'GET'} ${path} → ${res.status} ${detail.slice(0, 200)}`, res.status >= 500 ? 502 : res.status);
      }
      if (opts.raw) return Buffer.from(await res.arrayBuffer()) as unknown as T;
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof ESignProviderError) throw err;
      throw new ESignProviderError(NAME, `request ${path} failed: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private async uploadPdf(uploadUrl: string, pdf: Buffer): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/pdf' },
        body: pdf,
        signal: controller.signal,
      });
      if (!res.ok) throw new ESignProviderError(NAME, `PDF upload → ${res.status}`, 502);
    } finally {
      clearTimeout(timer);
    }
  }

  private recipientPayload(recipients: ProviderRecipientInput[]) {
    return recipients.map((r) => ({
      email: r.email.trim().toLowerCase(),
      name: r.name,
      role: mapRecipientRole(r.role),
      signingOrder: r.signingOrder,
    }));
  }

  private mapCreateResult(resp: any): CreateDocumentResult {
    const externalDocumentId = String(resp?.documentId ?? resp?.id ?? resp?.document?.id ?? '');
    if (!externalDocumentId) throw new ESignProviderError(NAME, 'create returned no document id');
    const recipients = (resp?.recipients ?? resp?.document?.recipients ?? []).map((r: any) => ({
      email: String(r?.email ?? '').toLowerCase(),
      externalRecipientId: String(r?.recipientId ?? r?.id ?? ''),
    }));
    return { externalDocumentId, recipients };
  }

  async createDocument(input: CreateDocumentInput): Promise<CreateDocumentResult> {
    const resp: any = await this.request('/api/v1/documents', {
      method: 'POST',
      body: {
        title: input.title,
        recipients: this.recipientPayload(input.recipients),
        meta: { externalReference: input.externalReference, ...(input.metadata ?? {}) },
      },
    });
    // Documenso returns an upload URL to PUT the PDF bytes into.
    const uploadUrl = resp?.uploadUrl ?? resp?.upload?.url;
    if (uploadUrl) await this.uploadPdf(String(uploadUrl), input.pdf);
    const result = this.mapCreateResult(resp);
    // Documenso's /send returns 400 ("Signers must have at least one signature
    // field") unless every signer has a field. Place a default SIGNATURE field
    // per recipient so the document is sendable.
    await this.placeDefaultSignatureFields(result.externalDocumentId, result.recipients);
    return result;
  }

  // Default field placement: one SIGNATURE field per recipient on page 1,
  // staggered vertically so multiple signers don't overlap. (A drag-to-place
  // field UI can refine positions later; this is the minimum Documenso needs.)
  private async placeDefaultSignatureFields(
    documentId: string,
    recipients: Array<{ externalRecipientId: string }>,
  ): Promise<void> {
    let i = 0;
    for (const r of recipients) {
      const recipientId = Number(r.externalRecipientId);
      if (recipientId) {
        await this.request(`/api/v1/documents/${encodeURIComponent(documentId)}/fields`, {
          method: 'POST',
          body: { recipientId, type: 'SIGNATURE', pageNumber: 1, pageX: 12, pageY: Math.min(85, 68 + i * 10), pageWidth: 38, pageHeight: 8 },
        });
      }
      i++;
    }
  }

  async createFromTemplate(input: CreateFromTemplateInput): Promise<CreateDocumentResult> {
    const resp: any = await this.request(
      `/api/v1/templates/${encodeURIComponent(input.templateId)}/generate-document`,
      {
        method: 'POST',
        body: {
          title: input.title,
          recipients: this.recipientPayload(input.recipients),
          meta: { externalReference: input.externalReference },
          prefillFields: input.prefill ?? {},
        },
      },
    );
    return this.mapCreateResult(resp);
  }

  async listTemplates(): Promise<TemplateSummary[]> {
    const resp: any = await this.request('/api/v1/templates?page=1&perPage=100');
    const list: any[] = resp?.templates ?? resp?.data ?? (Array.isArray(resp) ? resp : []);
    return list
      .map((t) => ({
        id: String(t?.id ?? t?.templateId ?? ''),
        title: String(t?.title ?? t?.name ?? 'Untitled template'),
        recipientCount: Array.isArray(t?.recipients) ? t.recipients.length : undefined,
      }))
      .filter((t) => t.id);
  }

  async addRecipients(input: AddRecipientsInput): Promise<void> {
    for (const r of this.recipientPayload(input.recipients)) {
      await this.request(`/api/v1/documents/${encodeURIComponent(input.externalDocumentId)}/recipients`, {
        method: 'POST',
        body: r,
      });
    }
  }

  async sendDocument(externalDocumentId: string): Promise<void> {
    // The CRM owns recipient notifications: it emails each signer their unique
    // signing link via its own transactional provider (see esign.service
    // sendSignInvite). We therefore tell Documenso NOT to send its own signing
    // emails — both to avoid duplicate messages and because some hosts (e.g.
    // Railway) block outbound SMTP, so Documenso's mailer can't deliver anyway.
    await this.request(`/api/v1/documents/${encodeURIComponent(externalDocumentId)}/send`, {
      method: 'POST',
      body: { sendEmail: false },
    });
  }

  async createSigningSession(input: CreateSigningSessionInput): Promise<SigningSessionResult> {
    // Resolve the recipient's signing token from the document, then build the
    // embeddable signing URL. (verify-live: some Documenso builds expose a
    // dedicated signing-token endpoint; this reads the token off the document.)
    const doc: any = await this.request(
      `/api/v1/documents/${encodeURIComponent(input.externalDocumentId)}`,
    );
    const recipients: any[] = doc?.recipients ?? doc?.document?.recipients ?? [];
    const rcpt = recipients.find(
      (r) =>
        (input.externalRecipientId && String(r?.id ?? r?.recipientId) === input.externalRecipientId) ||
        (input.recipientEmail && String(r?.email ?? '').toLowerCase() === input.recipientEmail.trim().toLowerCase()),
    );
    const token = rcpt?.token ?? rcpt?.signingToken;
    if (!token) throw new ESignProviderError(NAME, 'no signing token for recipient', 404);
    const { baseUrl } = this.config();
    const returnQuery = input.returnUrl ? `?returnUrl=${encodeURIComponent(input.returnUrl)}` : '';
    return { signingUrl: `${baseUrl}/sign/${encodeURIComponent(String(token))}${returnQuery}` };
  }

  async getDocumentStatus(externalDocumentId: string): Promise<DocumentStatusResult> {
    const doc: any = await this.request(`/api/v1/documents/${encodeURIComponent(externalDocumentId)}`);
    const rawRecipients: any[] = doc?.recipients ?? doc?.document?.recipients ?? [];
    const recipients: DocumentStatusRecipient[] = rawRecipients.map((r) => ({
      email: String(r?.email ?? '').toLowerCase(),
      externalRecipientId: String(r?.recipientId ?? r?.id ?? ''),
      status: mapRecipientStatus(r?.signingStatus ?? r?.status, r?.readStatus),
      signedAt: r?.signedAt ?? undefined,
    }));
    return {
      status: mapDocumentStatus(doc?.status ?? doc?.document?.status),
      recipients,
      completedAt: doc?.completedAt ?? doc?.document?.completedAt ?? undefined,
    };
  }

  async downloadCompletedDocument(externalDocumentId: string): Promise<Buffer> {
    return this.request<Buffer>(
      `/api/v1/documents/${encodeURIComponent(externalDocumentId)}/download`,
      { raw: true },
    );
  }

  async downloadAuditCertificate(externalDocumentId: string): Promise<Buffer | null> {
    try {
      return await this.request<Buffer>(
        `/api/v1/documents/${encodeURIComponent(externalDocumentId)}/download?certificate=true`,
        { raw: true },
      );
    } catch (err) {
      if (err instanceof ESignProviderError && err.statusCode === 404) return null;
      throw err;
    }
  }

  async cancelDocument(externalDocumentId: string): Promise<void> {
    await this.request(`/api/v1/documents/${encodeURIComponent(externalDocumentId)}`, {
      method: 'DELETE',
    });
  }
}
