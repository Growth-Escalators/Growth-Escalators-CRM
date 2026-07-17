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
import type { ProviderRecipientInput } from './esign.types';
import { generateContractPdf } from './contract-pdf';
import { storeContractArtifact, getContractDownloadUrl } from './document-storage.service';
import { sha256Hex } from './document-hash.service';
import { getNextContractNumber } from './contract-numbering';
import { mintSigningToken, hashSigningToken } from './contract-signing-link';
import { sendTransactionalEmail } from '../../services/emailService';
import crypto from 'crypto';

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

export interface RecipientInput {
  name: string;
  email: string;
  phone?: string;
  companyName?: string;
  designation?: string;
  signingRole?: 'client_signer' | 'internal_countersigner';
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
export async function generateContract(ctx: Ctx, id: string): Promise<ContractDetail> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  const recipients = await repo.listRecipients(ctx.tenantId, id);
  if (recipients.length === 0) throw new HttpError(400, 'add at least one recipient before generating', 'VALIDATION_ERROR');
  if (!recipients.some((r) => (r.signingRole ?? 'client_signer') === 'client_signer')) {
    throw new HttpError(400, 'a client signer is required', 'VALIDATION_ERROR');
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
  const provider = getESignProvider();
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
export async function getDownloadUrl(ctx: Ctx, id: string, artifact: 'generated' | 'completed' | 'audit-certificate'): Promise<string> {
  const contract = requireFound(await repo.getContract(ctx.tenantId, id));
  const ref =
    artifact === 'completed' ? contract.completedFileKey
      : artifact === 'audit-certificate' ? contract.auditCertificateFileKey
        : contract.generatedFileKey;
  if (!ref) throw new HttpError(404, `no ${artifact} document available`, 'NOT_FOUND');
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
