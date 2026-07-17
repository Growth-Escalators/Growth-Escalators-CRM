import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => ({
  contracts: new Map<string, any>(),
  recipients: new Map<string, any>(),
  events: [] as any[],
  processed: new Set<string>(),
  seq: 0,
}));

vi.mock('../modules/esign/esign.repository', () => ({
  getContract: async (tenantId: string, id: string) => { const c = store.contracts.get(id); return c && c.tenantId === tenantId ? c : null; },
  getContractByDocumensoId: async (docId: string) => [...store.contracts.values()].find((c) => c.documensoDocumentId === docId) ?? null,
  listRecipients: async (tenantId: string, contractId: string) => [...store.recipients.values()].filter((r) => r.tenantId === tenantId && r.contractId === contractId).sort((a, b) => a.signingOrder - b.signingOrder),
  updateRecipient: async (tenantId: string, id: string, patch: any) => { const r = store.recipients.get(id); if (!r || r.tenantId !== tenantId) return null; Object.assign(r, patch); return r; },
  updateContract: async (tenantId: string, id: string, patch: any) => { const c = store.contracts.get(id); if (!c || c.tenantId !== tenantId) return null; Object.assign(c, patch); return c; },
  appendEvent: async (row: any) => { const e = { id: `e_${++store.seq}`, ...row }; store.events.push(e); return e; },
  listEvents: async (tenantId: string, contractId: string) => store.events.filter((e) => e.tenantId === tenantId && e.contractId === contractId),
  isEventProcessed: async (id: string) => store.processed.has(id),
  markEventProcessed: async (id: string) => { store.processed.add(id); },
}));

vi.mock('../modules/esign/document-storage.service', () => ({
  storeContractArtifact: vi.fn(async ({ artifact }: any) => ({ reference: `r2://priv/${artifact}`, hash: `hash-${artifact}`, key: artifact })),
  getContractDownloadUrl: async (r: string) => `https://s/${r}`,
}));

import { handleDocumensoWebhook } from '../modules/esign/esign.webhook';
import { storeContractArtifact } from '../modules/esign/document-storage.service';
import { setESignProvider, resetESignProvider, MockESignProvider } from '../modules/esign/providers';

const SECRET = 'documenso-webhook-secret';
const PDF = Buffer.from('%PDF-1.7 unsigned');

let savedSecret: string | undefined;
beforeAll(() => { savedSecret = process.env.DOCUMENSO_WEBHOOK_SECRET; process.env.DOCUMENSO_WEBHOOK_SECRET = SECRET; });
afterAll(() => { if (savedSecret === undefined) delete process.env.DOCUMENSO_WEBHOOK_SECRET; else process.env.DOCUMENSO_WEBHOOK_SECRET = savedSecret; });

// Documenso sends the configured secret verbatim in X-Documenso-Secret; the
// route forwards it, so the handler is called with (receivedSecret, body).
// Valid deliveries pass SECRET; invalid ones pass a wrong secret.
function evt(bodyObj: unknown): any {
  return bodyObj;
}

let mock: MockESignProvider;

// Seed a SENT contract wired to a mock-provider document with two signers.
async function seedSentContract(tenantId = 'tA', contractId = 'c1') {
  const created = await mock.createDocument({
    title: 'MSA', pdf: PDF,
    recipients: [
      { email: 'client@x.com', name: 'Client', role: 'client_signer', signingOrder: 1 },
      { email: 'gm@ge.com', name: 'GE GM', role: 'internal_countersigner', signingOrder: 2 },
    ],
  });
  await mock.sendDocument(created.externalDocumentId);
  store.contracts.set(contractId, {
    id: contractId, tenantId, title: 'MSA', referenceNumber: 'GE/CON/2026-27/001',
    version: 1, status: 'SENT', documensoDocumentId: created.externalDocumentId, completedFileKey: null,
  });
  created.recipients.forEach((pr, i) => {
    store.recipients.set(`${contractId}-r${i + 1}`, {
      id: `${contractId}-r${i + 1}`, tenantId, contractId, name: i === 0 ? 'Client' : 'GE GM',
      email: pr.email, signingRole: i === 0 ? 'client_signer' : 'internal_countersigner',
      signingOrder: i + 1, status: 'pending', documensoRecipientId: pr.externalRecipientId,
    });
  });
  return created.externalDocumentId;
}

beforeEach(() => {
  store.contracts.clear(); store.recipients.clear(); store.events.length = 0; store.processed.clear(); store.seq = 0;
  vi.mocked(storeContractArtifact).mockClear();
  resetESignProvider();
  mock = new MockESignProvider();
  setESignProvider(mock);
});

describe('Documenso webhook — completion & integrity', () => {
  it('[1] valid completion webhook downloads, hashes, stores, and marks COMPLETED', async () => {
    const docId = await seedSentContract();
    mock.__sign(docId, 'client@x.com');
    mock.__sign(docId, 'gm@ge.com');
    const body = evt({ event: 'DOCUMENT_COMPLETED', webhookEventId: 'evt-1', payload: { id: docId } });

    const res = await handleDocumensoWebhook(SECRET, body);
    expect(res.status).toBe('ok');
    const c = store.contracts.get('c1');
    expect(c.status).toBe('COMPLETED');
    expect(c.completedFileKey).toBe('r2://priv/completed');
    expect(c.completedDocumentHash).toBe('hash-completed');
    expect(c.auditCertificateFileKey).toBe('r2://priv/audit-certificate');
    expect(store.recipients.get('c1-r1').status).toBe('signed');
    expect(store.recipients.get('c1-r2').status).toBe('signed');
    expect(store.events.some((e) => e.eventType === 'contract.completed')).toBe(true);
  });

  it('[2] rejects an invalid signature (401), no state change', async () => {
    const docId = await seedSentContract();
    mock.__sign(docId, 'client@x.com'); mock.__sign(docId, 'gm@ge.com');
    const body = evt({ event: 'DOCUMENT_COMPLETED', webhookEventId: 'e', payload: { id: docId } });
    await expect(handleDocumensoWebhook('wrong-secret', body)).rejects.toMatchObject({ statusCode: 401 });
    expect(store.contracts.get('c1').status).toBe('SENT');
  });

  it('[3+5] a duplicate delivery is applied once (no double upload)', async () => {
    const docId = await seedSentContract();
    mock.__sign(docId, 'client@x.com'); mock.__sign(docId, 'gm@ge.com');
    const body = evt({ event: 'DOCUMENT_COMPLETED', webhookEventId: 'evt-dup', payload: { id: docId } });
    await handleDocumensoWebhook(SECRET, body);
    const callsAfterFirst = vi.mocked(storeContractArtifact).mock.calls.length;
    const res2 = await handleDocumensoWebhook(SECRET, body);
    expect(res2.status).toBe('already_processed');
    expect(vi.mocked(storeContractArtifact).mock.calls.length).toBe(callsAfterFirst);
  });

  it('[4] unknown document → 404', async () => {
    const body = evt({ event: 'DOCUMENT_COMPLETED', webhookEventId: 'e', payload: { id: 'no-such-doc' } });
    await expect(handleDocumensoWebhook(SECRET, body)).rejects.toMatchObject({ statusCode: 404 });
  });

  it('[6] cross-tenant: a webhook only mutates the contract that owns the document', async () => {
    await seedSentContract('tA', 'cA');
    const docB = await seedSentContract('tB', 'cB');
    mock.__sign(docB, 'client@x.com'); mock.__sign(docB, 'gm@ge.com');
    const body = evt({ event: 'DOCUMENT_COMPLETED', webhookEventId: 'evt-b', payload: { id: docB } });
    await handleDocumensoWebhook(SECRET, body);
    expect(store.contracts.get('cB').status).toBe('COMPLETED');
    expect(store.contracts.get('cA').status).toBe('SENT'); // untouched
  });

  it('[6b] out-of-order/stale event after completion does not regress state', async () => {
    const docId = await seedSentContract();
    mock.__sign(docId, 'client@x.com'); mock.__sign(docId, 'gm@ge.com');
    await handleDocumensoWebhook(SECRET, evt({ event: 'DOCUMENT_COMPLETED', webhookEventId: 'e1', payload: { id: docId } }));
    // a later, stale delivery (different id) re-syncs to authoritative status
    const res = await handleDocumensoWebhook(SECRET, evt({ event: 'DOCUMENT_OPENED', webhookEventId: 'e2', payload: { id: docId } }));
    expect(res.status).toBe('ok');
    expect(store.contracts.get('c1').status).toBe('COMPLETED');
  });

  it('[7] a failed completed-document download does NOT falsely complete (retryable)', async () => {
    const docId = await seedSentContract();
    mock.__sign(docId, 'client@x.com'); mock.__sign(docId, 'gm@ge.com');
    vi.spyOn(mock, 'downloadCompletedDocument').mockRejectedValueOnce(new Error('provider 503'));
    const body = evt({ event: 'DOCUMENT_COMPLETED', webhookEventId: 'evt-fail', payload: { id: docId } });
    await expect(handleDocumensoWebhook(SECRET, body)).rejects.toThrow(/503/);
    expect(store.contracts.get('c1').status).not.toBe('COMPLETED');
    expect(store.processed.has('documenso:evt-fail')).toBe(false); // not marked → retryable
  });

  it('[8] a storage failure does NOT falsely complete and does not double-emit', async () => {
    const docId = await seedSentContract();
    mock.__sign(docId, 'client@x.com'); mock.__sign(docId, 'gm@ge.com');
    vi.mocked(storeContractArtifact).mockRejectedValueOnce(new Error('R2 down'));
    const body = evt({ event: 'DOCUMENT_COMPLETED', webhookEventId: 'evt-store', payload: { id: docId } });
    await expect(handleDocumensoWebhook(SECRET, body)).rejects.toThrow(/R2 down/);
    const c = store.contracts.get('c1');
    expect(c.status).not.toBe('COMPLETED');
    expect(c.completedFileKey).toBeNull();
    expect(store.events.some((e) => e.eventType === 'contract.completed')).toBe(false);
    expect(store.processed.has('documenso:evt-store')).toBe(false);
  });

  it('fails closed with a 503 when the webhook secret is unset', async () => {
    const prev = process.env.DOCUMENSO_WEBHOOK_SECRET;
    delete process.env.DOCUMENSO_WEBHOOK_SECRET;
    await expect(handleDocumensoWebhook('x', {})).rejects.toMatchObject({ statusCode: 503 });
    process.env.DOCUMENSO_WEBHOOK_SECRET = prev;
  });
});
