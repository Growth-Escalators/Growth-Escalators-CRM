// Contract lifecycle orchestration. Ties together the state machine, the
// e-sign provider (via the interface), document storage/hashing, numbering, and
// the append-only event log. Every operation is tenant-scoped (ctx.tenantId).
// Authorization (CONTRACTS_*) is enforced at the route layer; this layer
// re-checks tenant ownership and state-machine legality.
import { HttpError } from '../../utils/errors';
import {
  assertTransition,
  canTransition,
  computeStatusFromRecipients,
  isTerminal,
  type ContractStatus,
} from './contract-state-machine';
import * as repo from './esign.repository';
import type { ContractRow, RecipientRow, EventRow } from './esign.repository';
import { getESignProvider } from './providers';
import type { ProviderRecipientInput, TemplateSummary } from './esign.types';
import { generateContractPdf } from './contract-pdf';
import { storeContractArtifact, getContractDownloadUrl, isLocalReference } from './document-storage.service';
import { sha256Hex } from './document-hash.service';
import { getNextContractNumber } from './contract-numbering';
import { mintSigningToken, hashSigningToken } from './contract-signing-link';
import { sendTransactionalEmail } from '../../services/emailService';
import { db, users } from '../../db/index';
import { eq } from 'drizzle-orm';
import crypto from 'crypto';

// Notify the internal owner (contract creator / sender) — NOT a contact-facing
// bulk email, so it goes straight through the transactional sender and is never
// gated by the automated-email kill-switch. Best-effort; never blocks the flow.
async function notifyOwner(userId: string | null | undefined, subject: string, html: string, text: string): Promise<void> {
  if (!userId) return;
  try {
    const [u] = await db.select({ email: users.email, name: users.name }).from(users).where(eq(users.id, userId)).limit(1);
    if (!u?.email) return;
    await sendTransactionalEmail(u.email, u.name || 'there', subject, html, text);
  } catch (err) {
    console.error('[esign] owner notification failed', { userId, error: (err as Error).message });
  }
}

function buildSignUrl(token: string): string {
  const base = (process.env.CRM_BASE_URL || process.env.BASE_URL || process.env.FRONTEND_URL || '').replace(/\/+$/, '');
  return base ? `${base}/sign/${token}` : `/sign/${token}`;
}

async function sendSignInvite(recipient: RecipientRow, contract: ContractRow, url: string): Promise<void> {
  try {
    const subject = `Please sign: ${contract.title} (${contract.referenceNumber})`;
    const html = `<p>Hi ${recipient.name},</p><p>You have a document to review and sign: <strong>${contract.title}</strong> (${contract.referenceNumber}).</p><p><a href="${url}">Open and sign the document</a></p><p>This link is unique to you — please do not forward it.</p>`;
    const text = `Hi ${recipient.name},\n\nPlease review and sign "${contract.title}" (${contract.referenceNumber}):\n${url}\n\nThis link is unique to you — please do not forward it.`;
    await sendTransactionalEmail(recipient.email, recipient.name, subject, html, text);
  } catch (err) {
    // Non-fatal: the contract is sent; a failed invite email can be retried.
    console.error('[esign] sign-invite email failed', { recipientId: recipient.id, error: (err as Error).message });
  }
}

export interface Ctx {
  tenantId: string;
  userId: string;
  role: string;
}

export type SigningRole = 'client_signer' | 'internal_countersigner' | 'approver' | 'cc' | 'viewer';
const SIGNING_ROLES: readonly SigningRole[] = ['client_signer', 'internal_countersigner', 'approver', 'cc', 'viewer'];

export interface RecipientInput {
  name: string;
  email: string;
  phone?: string;
  companyName?: string;
  designation?: string;
  signingRole?: SigningRole;
  signingOrder?: number;
  contactId?: string;
  crmUserId?: string;
}

export interface CreateContractInput {
  title: string;
  clientCompanyId?: string;
  templateId?: string;
  terms?: string;
  expiresAt?: Date | null;
  recipients?: RecipientInput[];
  metadata?: Record<string, unknown>;
}

export interface ContractDetail {
  contract: ContractRow;
  recipients: RecipientRow[];
  events: EventRow[];
}

function requireFound(row: ContractRow | null): ContractRow {
  if (!row) throw new HttpError(404, 'contract not found', 'NOT_FOUND');
  return row;
}

async function appendEvent(
  ctx: Ctx,
  contractId: string,
  eventType: string,
  metadata: Record<string, unknown> = {},
  recipientId?: string,
): Promise<void> {
  const payload = { eventType, contractId, recipientId, by: ctx.userId, metadata };
  await repo.appendEvent({
    contractId,
    recipientId: recipientId ?? null,
    tenantId: ctx.tenantId,
    eventType,
    eventSource: 'crm',
    metadata,
    eventHash: sha256Hex(Buffer.from(JSON.stringify(payload))),
    occurredAt: new Date(),
  });
}

async function transition(ctx: Ctx, contract: ContractRow, to: ContractStatus, patch: Record<string, unknown> = {}): Promise<ContractRow> {
  assertTransition(contract.status as ContractStatus, to);
  const updated = await repo.updateContract(ctx.tenantId, contract.id, { status: to, ...patch });
  return requireFound(updated);
}

function toProviderRecipients(recipients: RecipientRow[]): ProviderRecipientInput[] {
  return recipients.map((r) => ({
    email: r.email,
    name: r.name,
    role: (r.signingRole as ProviderRecipientInput['role']) ?? 'client_signer',
    signingOrder: r.signingOrder ?? 1,
  }));
}

// ---- create / read ----
export async function createContract(ctx: Ctx, input: CreateContractInput): Promise<ContractDetail> {
  if (!input.title?.trim()) throw new HttpError(400, 'title is required', 'VALIDATION_ERROR');
  const { number } = await getNextContractNumber(ctx.tenantId);
  const recipientsIn = input.recipients ?? [];
  const requiresCounter = recipientsIn.some((r) => r.signingRole === 'internal_countersigner');

  const contract = await repo.createContract({
    tenantId: ctx.tenantId,
    clientCompanyId: input.clientCompanyId ?? null,
    templateId: input.templateId ?? null,
    title: input.title.trim(),
    referenceNumber: number,
    version: 1,
    status: 'DRAFT',
    requiresCountersignature: requiresCounter,
    expiresAt: input.expiresAt ?? null,
    metadata: { ...(input.metadata ?? {}), ...(input.terms ? { terms: input.terms } : {}) },
    createdBy: ctx.userId,
  });

  if (recipientsIn.length > 0) {
    await repo.insertRecipients(recipientsIn.map((r, i) => buildRecipientRow(ctx, contract.id, r, i)));
  }
  await appendEvent(ctx, contract.id, 'contract.created', { referenceNumber: number });
  return getContractDetail(ctx, contract.id);
}

function buildRecipientRow(ctx: Ctx, contractId: string, r: RecipientInput, index: number): repo.NewRecipientRow {
  if (!r.email?.trim() || !r.name?.trim()) {
    throw new HttpError(400, 'each recipient needs a name and email', 'VALIDATION_ERROR');
  }
  // Fail-closed on an unknown role — it flows straight to Documenso as a recipient
  // role, so a typo must not silently become a signer.
  if (r.signingRole && !SIGNING_ROLES.includes(r.signingRole)) {
    throw new HttpError(400, `invalid signingRole "${r.signingRole}"`, 'VALIDATION_ERROR');
  }
  return {
    contractId,
    tenantId: ctx.tenantId,
    contactId: r.contactId ?? null,
    crmUserId: r.crmUserId ?? null,
    name: r.name.trim(),
    email: r.email.trim().toLowerCase(),
    phone: r.phone ?? null,
    companyName: r.companyName ?? null,
    designation: r.designation ?? null,
    signingRole: r.signingRole ?? 'client_signer',
    signingOrder: r.signingOrder ?? index + 1,
    status: 'pending',
  };
}

export async function getContractDetail(ctx: Ctx, id: string): Promise<ContractDetail> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  const [recipients, events] = await Promise.all([
    repo.listRecipients(ctx.tenantId, id),
    repo.listEvents(ctx.tenantId, id),
  ]);
  return { contract, recipients, events };
}

export async function listContracts(ctx: Ctx, filter: repo.ListContractsFilter): Promise<ContractRow[]> {
  return repo.listContracts(ctx.tenantId, filter);
}

// ---- recipients (only before generation) ----
export async function addRecipients(ctx: Ctx, id: string, recipients: RecipientInput[]): Promise<ContractDetail> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  if (contract.status !== 'DRAFT') {
    throw new HttpError(409, `recipients can only be changed while the contract is DRAFT (is ${contract.status})`, 'CONFLICT');
  }
  if (recipients.length === 0) throw new HttpError(400, 'no recipients provided', 'VALIDATION_ERROR');
  const existing = await repo.listRecipients(ctx.tenantId, id);
  await repo.insertRecipients(recipients.map((r, i) => buildRecipientRow(ctx, id, r, existing.length + i)));
  if (recipients.some((r) => r.signingRole === 'internal_countersigner') && !contract.requiresCountersignature) {
    await repo.updateContract(ctx.tenantId, id, { requiresCountersignature: true });
  }
  await appendEvent(ctx, id, 'contract.recipients_added', { count: recipients.length });
  return getContractDetail(ctx, id);
}

// ---- generate: build PDF, store, create the (draft) provider document ----
// Auto-fill values the CRM knows about into a template's fields. The template
// author names their fields after these keys (clientName, clientCompany, date…).
function buildTemplatePrefill(contract: ContractRow, recipients: RecipientRow[]): Record<string, string> {
  const client = recipients.find((r) => (r.signingRole ?? 'client_signer') === 'client_signer') ?? recipients[0];
  return {
    title: contract.title,
    referenceNumber: contract.referenceNumber,
    date: new Date().toISOString().slice(0, 10),
    clientName: client?.name ?? '',
    clientCompany: client?.companyName ?? '',
    clientEmail: client?.email ?? '',
  };
}

/** CRM-registered templates (each maps a friendly name → a Documenso template). */
export async function listContractTemplates(ctx: Ctx): Promise<repo.TemplateRow[]> {
  return repo.listTemplates(ctx.tenantId);
}

/** Raw provider templates (Documenso) — used when registering a new CRM template. */
export async function listDocumensoTemplates(_ctx: Ctx): Promise<TemplateSummary[]> {
  return getESignProvider().listTemplates();
}

/** Register a Documenso template as a reusable CRM template. */
export async function registerTemplate(
  ctx: Ctx,
  input: { name: string; documensoTemplateId: string; category?: string; description?: string },
): Promise<repo.TemplateRow> {
  if (!input.name?.trim()) throw new HttpError(400, 'template name is required', 'VALIDATION_ERROR');
  if (!input.documensoTemplateId?.trim()) throw new HttpError(400, 'documensoTemplateId is required', 'VALIDATION_ERROR');
  return repo.createTemplate({
    tenantId: ctx.tenantId,
    name: input.name.trim(),
    description: input.description ?? null,
    category: input.category ?? null,
    sourceType: 'documenso_template',
    documensoTemplateId: input.documensoTemplateId.trim(),
    createdBy: ctx.userId,
  });
}

export async function generateContract(ctx: Ctx, id: string): Promise<ContractDetail> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  const recipients = await repo.listRecipients(ctx.tenantId, id);
  if (recipients.length === 0) throw new HttpError(400, 'add at least one recipient before generating', 'VALIDATION_ERROR');
  if (!recipients.some((r) => (r.signingRole ?? 'client_signer') === 'client_signer')) {
    throw new HttpError(400, 'a client signer is required', 'VALIDATION_ERROR');
  }

  const provider = getESignProvider();

  // Template path: the document is generated from a pre-built provider template
  // (fields already placed by the author). CRM data is auto-filled into the
  // template's fields; there is no locally-rendered PDF to store — the signed
  // copy is downloaded from the provider on completion.
  if (contract.templateId) {
    const tmpl = await repo.getTemplate(ctx.tenantId, contract.templateId);
    if (!tmpl?.documensoTemplateId) {
      throw new HttpError(400, 'this contract references a template not linked to a Documenso template', 'VALIDATION_ERROR');
    }
    const created = await provider.createFromTemplate({
      templateId: tmpl.documensoTemplateId,
      title: contract.title,
      recipients: toProviderRecipients(recipients),
      externalReference: id,
      prefill: buildTemplatePrefill(contract, recipients),
    });
    for (const pr of created.recipients) {
      const match = recipients.find((r) => r.email === pr.email.toLowerCase());
      if (match) await repo.updateRecipient(ctx.tenantId, match.id, { documensoRecipientId: pr.externalRecipientId });
    }
    const updatedT = await transition(ctx, contract, 'GENERATED', {
      documensoDocumentId: created.externalDocumentId,
      provider: provider.name,
    });
    await appendEvent(ctx, id, 'contract.generated', { provider: provider.name, fromTemplate: contract.templateId });
    return getContractDetail(ctx, updatedT.id);
  }

  const terms = typeof (contract.metadata as Record<string, unknown>)?.terms === 'string'
    ? ((contract.metadata as Record<string, unknown>).terms as string)
    : undefined;
  const pdf = await generateContractPdf({
    title: contract.title,
    referenceNumber: contract.referenceNumber,
    version: contract.version,
    legalEntity: process.env.CONTRACT_GE_LEGAL_ENTITY,
    parties: recipients.map((r) => ({ role: r.signingRole ?? 'client_signer', name: r.name, company: r.companyName ?? undefined, email: r.email })),
    terms,
  });

  const stored = await storeContractArtifact({
    tenantId: ctx.tenantId, contractId: id, version: contract.version, artifact: 'generated', buffer: pdf,
  });

  // Create the document at the provider (stays draft until send).
  const created = await provider.createDocument({
    title: contract.title,
    pdf,
    recipients: toProviderRecipients(recipients),
    externalReference: id,
    metadata: { tenantId: ctx.tenantId, referenceNumber: contract.referenceNumber },
  });

  // Map provider recipient ids back onto our rows by email.
  for (const pr of created.recipients) {
    const match = recipients.find((r) => r.email === pr.email.toLowerCase());
    if (match) await repo.updateRecipient(ctx.tenantId, match.id, { documensoRecipientId: pr.externalRecipientId });
  }

  const updated = await transition(ctx, contract, 'GENERATED', {
    generatedFileKey: stored.reference,
    generatedDocumentHash: stored.hash,
    documensoDocumentId: created.externalDocumentId,
    provider: provider.name,
  });
  await appendEvent(ctx, id, 'contract.generated', { generatedHash: stored.hash, provider: provider.name });
  return getContractDetail(ctx, updated.id);
}

/**
 * Bring-your-own-PDF variant of generateContract: instead of rendering the PDF
 * from the contract's terms (pdfkit), take an already-made PDF the user uploaded,
 * store it as the 'generated' artifact, and register it with the signing
 * provider. Everything downstream (approve → send → sign → complete → download)
 * is byte-for-byte identical to the generated path. storeContractArtifact runs
 * assertPdf (magic-byte check) before anything is created at the provider, so a
 * spoofed / non-PDF upload is rejected with a 400 and never reaches Documenso.
 */
export async function uploadContractPdf(ctx: Ctx, id: string, pdf: Buffer): Promise<ContractDetail> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  const recipients = await repo.listRecipients(ctx.tenantId, id);
  if (recipients.length === 0) throw new HttpError(400, 'add at least one recipient before uploading', 'VALIDATION_ERROR');
  if (!recipients.some((r) => (r.signingRole ?? 'client_signer') === 'client_signer')) {
    throw new HttpError(400, 'a client signer is required', 'VALIDATION_ERROR');
  }

  const stored = await storeContractArtifact({
    tenantId: ctx.tenantId, contractId: id, version: contract.version, artifact: 'generated', buffer: pdf,
  });

  // Register the uploaded PDF at the provider (stays draft until send).
  const provider = getESignProvider();
  const created = await provider.createDocument({
    title: contract.title,
    pdf,
    recipients: toProviderRecipients(recipients),
    externalReference: id,
    metadata: { tenantId: ctx.tenantId, referenceNumber: contract.referenceNumber },
  });

  for (const pr of created.recipients) {
    const match = recipients.find((r) => r.email === pr.email.toLowerCase());
    if (match) await repo.updateRecipient(ctx.tenantId, match.id, { documensoRecipientId: pr.externalRecipientId });
  }

  const updated = await transition(ctx, contract, 'GENERATED', {
    generatedFileKey: stored.reference,
    generatedDocumentHash: stored.hash,
    documensoDocumentId: created.externalDocumentId,
    provider: provider.name,
  });
  await appendEvent(ctx, id, 'contract.generated', { generatedHash: stored.hash, provider: provider.name, uploaded: true });
  return getContractDetail(ctx, updated.id);
}

// ---- approval gate ----
export async function approveContract(ctx: Ctx, id: string): Promise<ContractDetail> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  await transition(ctx, contract, 'READY_TO_SEND', { approvedBy: ctx.userId, approvedAt: new Date() });
  await appendEvent(ctx, id, 'contract.approved', {});
  return getContractDetail(ctx, id);
}

// ---- send ----
export async function sendContract(ctx: Ctx, id: string): Promise<ContractDetail> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  if (!contract.documensoDocumentId) throw new HttpError(409, 'contract has not been generated', 'CONFLICT');
  const provider = getESignProvider();
  await provider.sendDocument(contract.documensoDocumentId);
  const sent = await transition(ctx, contract, 'SENT', { sentBy: ctx.userId, sentAt: new Date() });

  // Mint a per-recipient signing link and store its hash (so re-issuing
  // invalidates old links). Email only the current-turn signer(s); later
  // signers are invited when their turn comes (on prior completion).
  const recipients = await repo.listRecipients(ctx.tenantId, id);
  const minOrder = Math.min(...recipients.map((r) => r.signingOrder ?? 1));
  for (const r of recipients) {
    const token = mintSigningToken(id, r.id);
    await repo.updateRecipient(ctx.tenantId, r.id, { signingTokenHash: hashSigningToken(token) });
    if ((r.signingOrder ?? 1) === minOrder) await sendSignInvite(r, sent, buildSignUrl(token));
  }
  // Confirmation to the sender (internal owner) — so they know it went out.
  await notifyOwner(
    ctx.userId,
    `Sent for signature: ${sent.title} (${sent.referenceNumber})`,
    `<p>Your contract <strong>${sent.title}</strong> (${sent.referenceNumber}) was sent for signature to ${recipients.map((r) => r.name).join(', ')}.</p><p>You'll be emailed when it's completed. Track it on the CRM Contracts page.</p>`,
    `Your contract "${sent.title}" (${sent.referenceNumber}) was sent for signature to ${recipients.map((r) => r.name).join(', ')}. You'll be emailed when it's completed.`,
  );
  await appendEvent(ctx, id, 'contract.sent', { recipients: recipients.length });
  return getContractDetail(ctx, id);
}

/** Re-mint + email a signing link to the next unsigned recipient in order (used by reminders / on prior-signer completion). */
export async function inviteNextSigner(ctx: Ctx, id: string): Promise<void> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  const recipients = await repo.listRecipients(ctx.tenantId, id);
  const pending = recipients.filter((r) => r.status !== 'signed' && r.status !== 'rejected').sort((a, b) => (a.signingOrder ?? 1) - (b.signingOrder ?? 1));
  const next = pending[0];
  if (!next) return;
  const token = mintSigningToken(id, next.id);
  await repo.updateRecipient(ctx.tenantId, next.id, { signingTokenHash: hashSigningToken(token) });
  await sendSignInvite(next, contract, buildSignUrl(token));
}

/**
 * Re-issue (and return) a per-recipient signing link — for a "copy/resend link"
 * action. Re-minting rotates the stored hash, so any previously issued link for
 * that recipient is invalidated. Only valid while the contract is open for signing.
 */
export async function reissueSigningLink(ctx: Ctx, id: string, rid: string): Promise<string> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  if (!['SENT', 'VIEWED', 'PARTIALLY_SIGNED'].includes(contract.status)) {
    throw new HttpError(409, `contract is not open for signing (status ${contract.status})`, 'CONFLICT');
  }
  const recipient = await repo.getRecipient(ctx.tenantId, rid);
  if (!recipient || recipient.contractId !== id) throw new HttpError(404, 'recipient not found', 'NOT_FOUND');
  const token = mintSigningToken(id, rid);
  await repo.updateRecipient(ctx.tenantId, rid, { signingTokenHash: hashSigningToken(token) });
  await appendEvent(ctx, id, 'contract.link_reissued', { recipientId: rid }, rid);
  return buildSignUrl(token);
}

// ---- void + clone-to-new-version ----
export async function voidContract(ctx: Ctx, id: string, reason: string): Promise<ContractDetail> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  if (isTerminal(contract.status as ContractStatus)) {
    throw new HttpError(409, `contract is already ${contract.status}`, 'CONFLICT');
  }
  if (contract.documensoDocumentId) {
    try { await getESignProvider().cancelDocument(contract.documensoDocumentId); } catch { /* provider may already be cancelled/completed */ }
  }
  await transition(ctx, contract, 'VOIDED', { voidedAt: new Date(), voidReason: reason || 'voided' });
  await appendEvent(ctx, id, 'contract.voided', { reason });
  return getContractDetail(ctx, id);
}

/** Clone a (typically voided) contract into a fresh DRAFT at version+1, preserving lineage. */
export async function cloneContract(ctx: Ctx, id: string): Promise<ContractDetail> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  const recipients = await repo.listRecipients(ctx.tenantId, id);
  const newVersion = (contract.version ?? 1) + 1;
  const baseRef = contract.referenceNumber.replace(/\/v\d+$/, '');
  const clone = await repo.createContract({
    tenantId: ctx.tenantId,
    clientCompanyId: contract.clientCompanyId,
    templateId: contract.templateId,
    parentContractId: contract.id,
    title: contract.title,
    referenceNumber: `${baseRef}/v${newVersion}`,
    version: newVersion,
    status: 'DRAFT',
    requiresCountersignature: contract.requiresCountersignature,
    expiresAt: contract.expiresAt,
    metadata: contract.metadata,
    createdBy: ctx.userId,
  });
  if (recipients.length > 0) {
    await repo.insertRecipients(recipients.map((r) => ({
      contractId: clone.id,
      tenantId: ctx.tenantId,
      contactId: r.contactId,
      crmUserId: r.crmUserId,
      name: r.name,
      email: r.email,
      phone: r.phone,
      companyName: r.companyName,
      designation: r.designation,
      signingRole: r.signingRole,
      signingOrder: r.signingOrder,
      status: 'pending',
    })));
  }
  await appendEvent(ctx, clone.id, 'contract.cloned_from', { fromContractId: contract.id, version: newVersion });
  return getContractDetail(ctx, clone.id);
}

// ---- downloads ----
export type DownloadArtifact = 'generated' | 'completed' | 'audit-certificate';

function selectArtifactRef(contract: ContractRow, artifact: DownloadArtifact): string | null {
  return artifact === 'completed' ? contract.completedFileKey
    : artifact === 'audit-certificate' ? contract.auditCertificateFileKey
      : contract.generatedFileKey;
}

/** The raw stored reference (r2:// or local://) for an artifact — used by the stream route. */
export async function getArtifactRef(ctx: Ctx, id: string, artifact: DownloadArtifact): Promise<string> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  const ref = selectArtifactRef(contract, artifact);
  if (!ref) throw new HttpError(404, `no ${artifact} document available`, 'NOT_FOUND');
  return ref;
}

export async function getDownloadUrl(ctx: Ctx, id: string, artifact: DownloadArtifact): Promise<string> {
  const ref = await getArtifactRef(ctx, id, artifact);
  // Local-backed artifacts are served by the authed stream route; R2 uses a presigned URL.
  if (isLocalReference(ref)) return `/api/contracts/${id}/file/${artifact}`;
  return getContractDownloadUrl(ref);
}

// ---- recompute contract status from recipients (used by webhook/sign in P5/P6) ----
export async function recomputeStatus(ctx: Ctx, id: string): Promise<ContractStatus> {
  const recipients = await repo.listRecipients(ctx.tenantId, id);
  return computeStatusFromRecipients(
    recipients.map((r) => ({ status: (r.status ?? 'pending') as 'pending' | 'viewed' | 'signed' | 'rejected' })),
  );
}

// ---- provider-driven status sync + completion (webhook / cron) ----
function sysCtx(tenantId: string): Ctx {
  return { tenantId, userId: 'system', role: 'system' };
}

async function appendSystemEvent(
  tenantId: string,
  contractId: string,
  eventType: string,
  metadata: Record<string, unknown> = {},
  opts: { recipientId?: string; externalEventId?: string; eventSource?: string } = {},
): Promise<void> {
  const payload = { eventType, contractId, ...opts, metadata };
  try {
    await repo.appendEvent({
      contractId,
      recipientId: opts.recipientId ?? null,
      tenantId,
      eventType,
      eventSource: opts.eventSource ?? 'documenso',
      externalEventId: opts.externalEventId ?? null,
      metadata,
      eventHash: sha256Hex(Buffer.from(JSON.stringify(payload))),
      occurredAt: new Date(),
    });
  } catch (err) {
    // A duplicate externalEventId (idempotent webhook replay) hits the partial
    // unique index — that's expected; swallow it. Anything else re-throws.
    if (opts.externalEventId) return;
    throw err;
  }
}

/**
 * Re-fetch authoritative status from the provider, sync recipient rows, and move
 * the contract to the implied state. On completion, downloads + hashes + stores
 * the signed PDF and audit certificate. Idempotent: a contract already COMPLETED
 * (with a stored file) is not re-downloaded/re-uploaded.
 */
export async function syncFromProvider(tenantId: string, contractId: string, externalEventId?: string): Promise<ContractDetail> {
  const contract = requireFound(await repo.getContract(tenantId, contractId));
  if (!contract.documensoDocumentId) return getContractDetail(sysCtx(tenantId), contractId);

  const providerStatus = await getESignProvider().getDocumentStatus(contract.documensoDocumentId);

  // Sync recipient statuses from the provider (match by provider id, else email).
  const recipients = await repo.listRecipients(tenantId, contractId);
  for (const pr of providerStatus.recipients) {
    const match = recipients.find(
      (r) => (r.documensoRecipientId && r.documensoRecipientId === pr.externalRecipientId) || r.email === pr.email.toLowerCase(),
    );
    if (!match || match.status === pr.status) continue;
    const patch: Record<string, unknown> = { status: pr.status };
    if (pr.status === 'signed') patch.signedAt = pr.signedAt ? new Date(pr.signedAt) : new Date();
    else if (pr.status === 'rejected') patch.rejectedAt = new Date();
    else if (pr.status === 'viewed' && !match.viewedAt) patch.viewedAt = new Date();
    await repo.updateRecipient(tenantId, match.id, patch);
    await appendSystemEvent(tenantId, contractId, `recipient.${pr.status}`, { email: match.email }, { recipientId: match.id });
  }

  if (providerStatus.status === 'completed') {
    return completeFromProvider(tenantId, contract, providerStatus.completedAt, externalEventId);
  }

  // Otherwise derive contract status from recipient rows + provider signal.
  const fresh = await repo.listRecipients(tenantId, contractId);
  const derived = computeStatusFromRecipients(fresh.map((r) => ({ status: (r.status ?? 'pending') as 'pending' | 'viewed' | 'signed' | 'rejected' })));
  const current = contract.status as ContractStatus;
  let to: ContractStatus | null = null;
  if (providerStatus.status === 'rejected' || derived === 'REJECTED') to = 'REJECTED';
  else if (derived === 'PARTIALLY_SIGNED') to = 'PARTIALLY_SIGNED';
  else if (derived === 'VIEWED') to = 'VIEWED';
  if (to && to !== current && canTransition(current, to)) {
    await repo.updateContract(tenantId, contractId, { status: to });
    await appendSystemEvent(tenantId, contractId, `contract.${to.toLowerCase()}`, {}, { externalEventId });
    if (to === 'PARTIALLY_SIGNED') {
      try { await inviteNextSigner(sysCtx(tenantId), contractId); } catch { /* invite is best-effort */ }
    }
  }
  return getContractDetail(sysCtx(tenantId), contractId);
}

async function completeFromProvider(
  tenantId: string,
  contract: ContractRow,
  completedAt: string | undefined,
  externalEventId: string | undefined,
): Promise<ContractDetail> {
  // Idempotent: already completed + stored → no re-download/re-upload.
  if (contract.status === 'COMPLETED' && contract.completedFileKey) {
    return getContractDetail(sysCtx(tenantId), contract.id);
  }
  if (contract.status === 'VOIDED') return getContractDetail(sysCtx(tenantId), contract.id);

  const provider = getESignProvider();
  const docId = contract.documensoDocumentId!;
  // Download + store BEFORE flipping status, so a storage failure leaves the
  // contract un-completed and the webhook safely retryable (no false completion).
  const pdf = await provider.downloadCompletedDocument(docId);
  const completed = await storeContractArtifact({ tenantId, contractId: contract.id, version: contract.version, artifact: 'completed', buffer: pdf });
  let auditRef: string | null = null;
  let auditHash: string | null = null;
  const cert = await provider.downloadAuditCertificate(docId);
  if (cert) {
    const a = await storeContractArtifact({ tenantId, contractId: contract.id, version: contract.version, artifact: 'audit-certificate', buffer: cert });
    auditRef = a.reference;
    auditHash = a.hash;
  }
  await repo.updateContract(tenantId, contract.id, {
    status: 'COMPLETED',
    completedAt: completedAt ? new Date(completedAt) : new Date(),
    completedFileKey: completed.reference,
    completedDocumentHash: completed.hash,
    auditCertificateFileKey: auditRef,
    auditCertificateHash: auditHash,
  });
  await appendSystemEvent(tenantId, contract.id, 'contract.completed', { completedHash: completed.hash, auditHash }, { externalEventId });
  // Notify the contract's creator that it's fully signed + downloadable.
  await notifyOwner(
    contract.createdBy,
    `Completed: ${contract.title} (${contract.referenceNumber})`,
    `<p>Your contract <strong>${contract.title}</strong> (${contract.referenceNumber}) has been fully signed and completed.</p><p>Download the signed PDF and audit certificate on the CRM Contracts page.</p>`,
    `Your contract "${contract.title}" (${contract.referenceNumber}) has been fully signed and completed. Download it on the CRM Contracts page.`,
  );
  return getContractDetail(sysCtx(tenantId), contract.id);
}

// ---- cron-driven operations ----
/** Expire an overdue open contract (cancels at the provider best-effort). No-op if not transitionable. */
export async function expireContract(tenantId: string, id: string): Promise<boolean> {
  const contract = requireFound(await repo.getContract(tenantId, id));
  if (!canTransition(contract.status as ContractStatus, 'EXPIRED')) return false;
  if (contract.documensoDocumentId) {
    try { await getESignProvider().cancelDocument(contract.documensoDocumentId); } catch { /* best-effort */ }
  }
  await repo.updateContract(tenantId, id, { status: 'EXPIRED' });
  await appendSystemEvent(tenantId, id, 'contract.expired', {}, { eventSource: 'cron' });
  return true;
}

/** Re-invite the current-turn unsigned signer and record a reminder event. */
export async function remindCurrentSigner(tenantId: string, id: string): Promise<void> {
  await inviteNextSigner(sysCtx(tenantId), id);
  await appendSystemEvent(tenantId, id, 'contract.reminder_sent', {}, { eventSource: 'cron' });
}

// exported for tests/other modules
export const _internal = { appendEvent, transition, buildRecipientRow, appendSystemEvent, randomId: () => crypto.randomUUID() };
