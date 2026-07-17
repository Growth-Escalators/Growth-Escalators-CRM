import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  contracts: new Map<string, any>(),
  recipients: new Map<string, any>(),
  consents: [] as any[],
  events: [] as any[],
  seq: 0,
}));

vi.mock('../modules/esign/esign.repository', () => ({
  getRecipientById: async (id: string) => store.recipients.get(id) ?? null,
  getContract: async (tenantId: string, id: string) => { const c = store.contracts.get(id); return c && c.tenantId === tenantId ? c : null; },
  listRecipients: async (tenantId: string, contractId: string) => [...store.recipients.values()].filter((r) => r.tenantId === tenantId && r.contractId === contractId).sort((a, b) => a.signingOrder - b.signingOrder),
  updateRecipient: async (tenantId: string, id: string, patch: any) => { const r = store.recipients.get(id); if (!r || r.tenantId !== tenantId) return null; Object.assign(r, patch); return r; },
  updateContract: async (tenantId: string, id: string, patch: any) => { const c = store.contracts.get(id); if (!c || c.tenantId !== tenantId) return null; Object.assign(c, patch); return c; },
  insertConsent: async (row: any) => { const e = { id: `cons_${++store.seq}`, ...row }; store.consents.push(e); return e; },
  appendEvent: async (row: any) => { const e = { id: `e_${++store.seq}`, ...row }; store.events.push(e); return e; },
}));

import * as signing from '../modules/esign/esign.signing.service';
import { setESignProvider, resetESignProvider } from '../modules/esign/providers';
import type { ESignatureProvider } from '../modules/esign/providers';
import { mintSigningToken, hashSigningToken } from '../modules/esign/contract-signing-link';

const stubProvider = {
  name: 'stub',
  createSigningSession: vi.fn(async ({ externalDocumentId }: any) => ({ signingUrl: `https://sign.local/${externalDocumentId}` })),
} as unknown as ESignatureProvider;

let saved: string | undefined;
beforeAll(() => { saved = process.env.CONTRACTS_SIGNING_SECRET; process.env.CONTRACTS_SIGNING_SECRET = 'sign-secret'; });
afterAll(() => { if (saved === undefined) delete process.env.CONTRACTS_SIGNING_SECRET; else process.env.CONTRACTS_SIGNING_SECRET = saved; });

let token1: string;
let token2: string;

beforeEach(() => {
  store.contracts.clear();
  store.recipients.clear();
  store.consents.length = 0;
  store.events.length = 0;
  store.seq = 0;
  resetESignProvider();
  setESignProvider(stubProvider);

  store.contracts.set('c1', {
    id: 'c1', tenantId: 'tA', title: 'MSA', referenceNumber: 'GE/CON/2026-27/001',
    status: 'SENT', documensoDocumentId: 'doc1', generatedDocumentHash: 'gh', version: 1, expiresAt: null,
  });
  store.recipients.set('r1', { id: 'r1', tenantId: 'tA', contractId: 'c1', name: 'Client', email: 'client@x.com', signingRole: 'client_signer', signingOrder: 1, status: 'pending', documensoRecipientId: 'dr1' });
  store.recipients.set('r2', { id: 'r2', tenantId: 'tA', contractId: 'c1', name: 'GE GM', email: 'gm@ge.com', signingRole: 'internal_countersigner', signingOrder: 2, status: 'pending', documensoRecipientId: 'dr2' });
  token1 = mintSigningToken('c1', 'r1');
  token2 = mintSigningToken('c1', 'r2');
  store.recipients.get('r1').signingTokenHash = hashSigningToken(token1);
  store.recipients.get('r2').signingTokenHash = hashSigningToken(token2);
});

const allConsents = { electronicTransactionConsent: true, reviewedDocument: true, intentToSign: true, authorityConfirmed: true };

describe('public signing flow', () => {
  it('getSignableContract marks viewed and returns the 4 consent statements', async () => {
    const p = await signing.getSignableContract(token1, { ipAddress: '1.2.3.4', userAgent: 'jest' });
    expect(p.recipient.id).toBe('r1');
    expect(p.consent.statements).toHaveLength(4);
    expect(p.consent.version).toBe(signing.CONSENT_VERSION);
    expect(store.recipients.get('r1').status).toBe('viewed');
    expect(store.contracts.get('c1').status).toBe('VIEWED');
    expect(store.events.some((e) => e.eventType === 'contract.viewed')).toBe(true);
  });

  it('enforces signing order (countersigner blocked until client signs)', async () => {
    await expect(signing.getSignableContract(token2, {})).rejects.toMatchObject({ statusCode: 409 });
  });

  it('records consent and creates a signing session when all consents accepted', async () => {
    const res = await signing.submitConsentAndCreateSession(token1, allConsents, { ipAddress: '9.9.9.9', userAgent: 'jest' });
    expect(res.signingUrl).toBe('https://sign.local/doc1');
    expect(store.consents).toHaveLength(1);
    expect(store.consents[0]).toMatchObject({ contractId: 'c1', recipientId: 'r1', consentVersion: signing.CONSENT_VERSION, documentHashAtConsent: 'gh', ipAddress: '9.9.9.9' });
    expect(store.consents[0].electronicTransactionConsent).toBe(true);
  });

  it('rejects signing when any consent is missing', async () => {
    await expect(
      signing.submitConsentAndCreateSession(token1, { ...allConsents, authorityConfirmed: false }, {}),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(store.consents).toHaveLength(0);
  });

  it('rejects an invalid / tampered token (401)', async () => {
    await expect(signing.getSignableContract('bad.token', {})).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a superseded/revoked link (stored hash mismatch, 401)', async () => {
    store.recipients.get('r1').signingTokenHash = 'stale-hash';
    await expect(signing.getSignableContract(token1, {})).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects an expired contract (410)', async () => {
    store.contracts.get('c1').expiresAt = new Date(Date.now() - 1000);
    await expect(signing.getSignableContract(token1, {})).rejects.toMatchObject({ statusCode: 410 });
  });
});
