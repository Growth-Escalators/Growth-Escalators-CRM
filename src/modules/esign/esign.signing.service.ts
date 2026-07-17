// Public (no-login) signing flow for external signers. Every entry point is
// authorized by a per-recipient HMAC signing token (contract-signing-link.ts)
// PLUS a match against the recipient's stored token hash (so re-issued links
// invalidate old ones). Enforces signable state, expiry, and signing order, and
// records unchecked-by-default electronic-signing consent server-side.
import { HttpError } from '../../utils/errors';
import * as repo from './esign.repository';
import type { ContractRow, RecipientRow } from './esign.repository';
import { verifySigningToken, hashSigningToken } from './contract-signing-link';
import { getESignProvider } from './providers';
import { sha256Hex } from './document-hash.service';
import type { ContractStatus } from './contract-state-machine';

export const CONSENT_VERSION = 'v1-2026-07';
export const CONSENT_STATEMENTS = [
  { key: 'electronicTransactionConsent', text: 'I consent to conduct this transaction electronically.' },
  { key: 'reviewedDocument', text: 'I have reviewed the document.' },
  { key: 'intentToSign', text: 'I intend my completed signing action to constitute my electronic signature.' },
  { key: 'authorityConfirmed', text: 'I confirm that I am authorised to sign on behalf of the named company.' },
] as const;
export const CONSENT_TEXT = CONSENT_STATEMENTS.map((s) => s.text).join('\n');

const SIGNABLE: ReadonlySet<ContractStatus> = new Set<ContractStatus>(['SENT', 'VIEWED', 'PARTIALLY_SIGNED']);

export interface SignerRequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

interface Loaded {
  contract: ContractRow;
  recipient: RecipientRow;
  token: string;
}

/** Verify the token + stored-hash + signable state + expiry + signing order. */
async function load(token: string): Promise<Loaded> {
  const payload = verifySigningToken(token);
  if (!payload) throw new HttpError(401, 'invalid or expired signing link', 'UNAUTHORIZED');

  const recipient = await repo.getRecipientById(payload.recipientId);
  if (!recipient || recipient.contractId !== payload.contractId) {
    throw new HttpError(404, 'signing link not found', 'NOT_FOUND');
  }
  // Superseded/revoked link (a newer link was issued, or none was stored).
  if (!recipient.signingTokenHash || recipient.signingTokenHash !== hashSigningToken(token)) {
    throw new HttpError(401, 'this signing link is no longer valid', 'UNAUTHORIZED');
  }
  if (recipient.status === 'rejected') throw new HttpError(409, 'this contract was declined', 'CONFLICT');

  const contract = await repo.getContract(recipient.tenantId, recipient.contractId);
  if (!contract) throw new HttpError(404, 'contract not found', 'NOT_FOUND');
  if (!SIGNABLE.has(contract.status as ContractStatus)) {
    throw new HttpError(409, `contract is not open for signing (status ${contract.status})`, 'CONFLICT');
  }
  if (contract.expiresAt && contract.expiresAt.getTime() < Date.now()) {
    throw new HttpError(410, 'this contract has expired', 'CONFLICT');
  }
  return { contract, recipient, token };
}

/** Enforce signing order: every lower-order recipient must have signed. */
async function assertMyTurn(contract: ContractRow, recipient: RecipientRow): Promise<void> {
  const all = await repo.listRecipients(recipient.tenantId, contract.id);
  const priorUnsigned = all.filter(
    (r) => (r.signingOrder ?? 1) < (recipient.signingOrder ?? 1) && r.status !== 'signed',
  );
  if (priorUnsigned.length > 0) {
    throw new HttpError(409, 'waiting for a prior signer to complete', 'CONFLICT');
  }
}

async function appendEvent(
  recipient: RecipientRow,
  contractId: string,
  eventType: string,
  metadata: Record<string, unknown>,
  meta: SignerRequestMeta,
): Promise<void> {
  const payload = { eventType, contractId, recipientId: recipient.id, metadata };
  await repo.appendEvent({
    contractId,
    recipientId: recipient.id,
    tenantId: recipient.tenantId,
    eventType,
    eventSource: 'crm',
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    metadata,
    eventHash: sha256Hex(Buffer.from(JSON.stringify(payload))),
    occurredAt: new Date(),
  });
}

export interface SignablePresentation {
  contract: { id: string; title: string; referenceNumber: string; status: string };
  recipient: { id: string; name: string; email: string; signingRole: string; status: string };
  consent: { version: string; statements: readonly { key: string; text: string }[] };
  alreadySigned: boolean;
}

/** GET flow: mark viewed, return what the signer needs to render the consent + document. */
export async function getSignableContract(token: string, meta: SignerRequestMeta): Promise<SignablePresentation> {
  const { contract, recipient } = await load(token);
  await assertMyTurn(contract, recipient);

  if (recipient.status === 'pending') {
    await repo.updateRecipient(recipient.tenantId, recipient.id, { status: 'viewed', viewedAt: new Date() });
    if (contract.status === 'SENT') {
      await repo.updateContract(recipient.tenantId, contract.id, { status: 'VIEWED' });
    }
    await appendEvent(recipient, contract.id, 'contract.viewed', {}, meta);
  }

  return {
    contract: { id: contract.id, title: contract.title, referenceNumber: contract.referenceNumber, status: contract.status },
    recipient: { id: recipient.id, name: recipient.name, email: recipient.email, signingRole: recipient.signingRole ?? 'client_signer', status: recipient.status ?? 'pending' },
    consent: { version: CONSENT_VERSION, statements: CONSENT_STATEMENTS },
    alreadySigned: recipient.status === 'signed',
  };
}

export interface ConsentSubmission {
  electronicTransactionConsent?: boolean;
  reviewedDocument?: boolean;
  intentToSign?: boolean;
  authorityConfirmed?: boolean;
}

export interface SigningSessionPresentation {
  signingUrl: string;
  expiresAt?: string;
}

/**
 * POST flow: record consent (all four required, unchecked-by-default) then create
 * the embedded signing session at the provider. Does NOT mark the recipient
 * signed — that is authoritative only via the webhook + status re-fetch (P6).
 */
export async function submitConsentAndCreateSession(
  token: string,
  consents: ConsentSubmission,
  meta: SignerRequestMeta,
): Promise<SigningSessionPresentation> {
  const { contract, recipient } = await load(token);
  await assertMyTurn(contract, recipient);

  const allAccepted = CONSENT_STATEMENTS.every((s) => consents[s.key as keyof ConsentSubmission] === true);
  if (!allAccepted) {
    throw new HttpError(400, 'all consent statements must be accepted to sign', 'VALIDATION_ERROR');
  }

  await repo.insertConsent({
    contractId: contract.id,
    recipientId: recipient.id,
    tenantId: recipient.tenantId,
    consentText: CONSENT_TEXT,
    consentVersion: CONSENT_VERSION,
    electronicTransactionConsent: true,
    reviewedDocument: true,
    intentToSign: true,
    authorityConfirmed: true,
    documentHashAtConsent: contract.generatedDocumentHash ?? null,
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
    acceptedAt: new Date(),
  });
  await appendEvent(recipient, contract.id, 'contract.consent_recorded', { consentVersion: CONSENT_VERSION }, meta);

  if (!contract.documensoDocumentId) throw new HttpError(409, 'contract is not ready for signing', 'CONFLICT');
  const session = await getESignProvider().createSigningSession({
    externalDocumentId: contract.documensoDocumentId,
    externalRecipientId: recipient.documensoRecipientId ?? undefined,
    recipientEmail: recipient.email,
  });
  await appendEvent(recipient, contract.id, 'contract.signing_session_created', {}, meta);
  return { signingUrl: session.signingUrl, expiresAt: session.expiresAt };
}
