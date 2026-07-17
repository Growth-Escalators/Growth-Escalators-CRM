import { beforeEach, describe, expect, it, vi } from 'vitest';

// In-memory stores shared between the repo mock and assertions.
const stores = vi.hoisted(() => ({
  contracts: new Map<string, any>(),
  recipients: new Map<string, any>(),
  templates: new Map<string, any>(),
  events: [] as any[],
  seq: 0,
}));

vi.mock('../modules/esign/esign.repository', () => {
  const uid = (p: string) => `${p}_${++stores.seq}`;
  return {
    createContract: async (v: any) => { const id = uid('c'); const row = { id, ...v }; stores.contracts.set(id, row); return row; },
    getContract: async (tenantId: string, id: string) => { const r = stores.contracts.get(id); return r && r.tenantId === tenantId ? r : null; },
    getContractByDocumensoId: async (docId: string) => [...stores.contracts.values()].find((c) => c.documensoDocumentId === docId) ?? null,
    listContracts: async (tenantId: string) => [...stores.contracts.values()].filter((c) => c.tenantId === tenantId),
    updateContract: async (tenantId: string, id: string, patch: any) => { const r = stores.contracts.get(id); if (!r || r.tenantId !== tenantId) return null; Object.assign(r, patch, { updatedAt: new Date() }); return r; },
    insertRecipients: async (rows: any[]) => rows.map((r) => { const id = uid('r'); const row = { id, ...r }; stores.recipients.set(id, row); return row; }),
    listRecipients: async (tenantId: string, contractId: string) => [...stores.recipients.values()].filter((r) => r.tenantId === tenantId && r.contractId === contractId).sort((a, b) => a.signingOrder - b.signingOrder),
    getRecipient: async (tenantId: string, id: string) => { const r = stores.recipients.get(id); return r && r.tenantId === tenantId ? r : null; },
    updateRecipient: async (tenantId: string, id: string, patch: any) => { const r = stores.recipients.get(id); if (!r || r.tenantId !== tenantId) return null; Object.assign(r, patch); return r; },
    insertConsent: async (row: any) => ({ id: uid('cons'), ...row }),
    appendEvent: async (row: any) => { const e = { id: uid('e'), ...row }; stores.events.push(e); return e; },
    listEvents: async (tenantId: string, contractId: string) => stores.events.filter((e) => e.tenantId === tenantId && e.contractId === contractId),
    createTemplate: async (v: any) => { const id = uid('tmpl'); const row = { id, ...v }; stores.templates.set(id, row); return row; },
    getTemplate: async (tenantId: string, id: string) => { const r = stores.templates.get(id); return r && r.tenantId === tenantId ? r : null; },
    listTemplates: async (tenantId: string) => [...stores.templates.values()].filter((t) => t.tenantId === tenantId),
  };
});

vi.mock('../modules/esign/contract-numbering', () => ({
  getNextContractNumber: async () => ({ number: 'GE/CON/2026-27/001', series: 1, financialYear: '2026-27' }),
  peekNextContractNumber: async () => ({ number: 'GE/CON/2026-27/002', series: 2, financialYear: '2026-27' }),
}));

vi.mock('../modules/esign/document-storage.service', () => ({
  storeContractArtifact: async ({ artifact }: any) => ({ reference: `r2://priv/${artifact}`, hash: 'abc123', key: artifact }),
  getContractDownloadUrl: async (ref: string) => `https://signed.example/${ref}`,
}));

vi.mock('../modules/esign/contract-pdf', () => ({
  generateContractPdf: async () => Buffer.from('%PDF-1.4 mock contract'),
}));

import * as service from '../modules/esign/esign.service';
import { setESignProvider, resetESignProvider, MockESignProvider } from '../modules/esign/providers';
import { ContractStateError } from '../modules/esign/contract-state-machine';

const ctx = { tenantId: 'tenant-A', userId: 'user-1', role: 'admin' };
const ctxOther = { tenantId: 'tenant-B', userId: 'user-9', role: 'admin' };

function twoParty() {
  return [
    { name: 'Client Co', email: 'client@example.com', signingRole: 'client_signer' as const, signingOrder: 1 },
    { name: 'GE Signatory', email: 'gm@ge.com', signingRole: 'internal_countersigner' as const, signingOrder: 2 },
  ];
}

let mock: MockESignProvider;
beforeEach(() => {
  process.env.CONTRACTS_SIGNING_SECRET = 'test-secret';
  stores.contracts.clear();
  stores.recipients.clear();
  stores.templates.clear();
  stores.events.length = 0;
  stores.seq = 0;
  mock = new MockESignProvider();
  setESignProvider(mock);
});

describe('contract lifecycle', () => {
  it('creates a DRAFT with a claimed reference number and recipients', async () => {
    const { contract, recipients } = await service.createContract(ctx, { title: 'MSA', recipients: twoParty() });
    expect(contract.status).toBe('DRAFT');
    expect(contract.referenceNumber).toBe('GE/CON/2026-27/001');
    expect(contract.requiresCountersignature).toBe(true);
    expect(recipients).toHaveLength(2);
    expect(recipients[0].email).toBe('client@example.com');
  });

  it('runs generate → approve → send, threading state + provider ids', async () => {
    const { contract } = await service.createContract(ctx, { title: 'MSA', terms: 'Do the thing.', recipients: twoParty() });

    const gen = await service.generateContract(ctx, contract.id);
    expect(gen.contract.status).toBe('GENERATED');
    expect(gen.contract.generatedFileKey).toBe('r2://priv/generated');
    expect(gen.contract.documensoDocumentId).toBeTruthy();
    expect(gen.recipients.every((r) => r.documensoRecipientId)).toBe(true);

    const appr = await service.approveContract(ctx, contract.id);
    expect(appr.contract.status).toBe('READY_TO_SEND');
    expect(appr.contract.approvedBy).toBe('user-1');

    const sent = await service.sendContract(ctx, contract.id);
    expect(sent.contract.status).toBe('SENT');
    // provider document is now pending (sent)
    const provStatus = await mock.getDocumentStatus(gen.contract.documensoDocumentId!);
    expect(provStatus.status).toBe('pending');

    // audit trail recorded each step
    const types = sent.events.map((e) => e.eventType);
    expect(types).toEqual(expect.arrayContaining(['contract.created', 'contract.generated', 'contract.approved', 'contract.sent']));
  });

  it('accepts an uploaded PDF (bring-your-own) → GENERATED, then approve → send', async () => {
    const { contract } = await service.createContract(ctx, { title: 'Uploaded NDA', recipients: twoParty() });

    const up = await service.uploadContractPdf(ctx, contract.id, Buffer.from('%PDF-1.4 my own contract'));
    expect(up.contract.status).toBe('GENERATED');
    expect(up.contract.generatedFileKey).toBe('r2://priv/generated');
    expect(up.contract.documensoDocumentId).toBeTruthy();
    expect(up.recipients.every((r) => r.documensoRecipientId)).toBe(true);
    expect(up.events.some((e) => e.eventType === 'contract.generated')).toBe(true);

    // the rest of the lifecycle is identical to a generated contract
    const apprUp = await service.approveContract(ctx, contract.id);
    expect(apprUp.contract.status).toBe('READY_TO_SEND');
    const sentUp = await service.sendContract(ctx, contract.id);
    expect(sentUp.contract.status).toBe('SENT');
  });

  it('registers a Documenso template + generates a contract from it (auto-fill, no local PDF)', async () => {
    const tmpl = await service.registerTemplate(ctx, { name: 'Mutual NDA', documensoTemplateId: '42', category: 'nda' });
    expect(tmpl.documensoTemplateId).toBe('42');
    expect((await service.listContractTemplates(ctx)).map((t) => t.id)).toContain(tmpl.id);

    const { contract } = await service.createContract(ctx, { title: 'NDA — Acme', templateId: tmpl.id, recipients: twoParty() });
    const gen = await service.generateContract(ctx, contract.id);
    expect(gen.contract.status).toBe('GENERATED');
    expect(gen.contract.documensoDocumentId).toBeTruthy();
    expect(gen.contract.generatedFileKey ?? null).toBeNull(); // template path stores no local PDF
    expect(gen.recipients.every((r) => r.documensoRecipientId)).toBe(true);

    // rest of the lifecycle is unchanged
    const appr = await service.approveContract(ctx, contract.id);
    expect(appr.contract.status).toBe('READY_TO_SEND');
    const sent = await service.sendContract(ctx, contract.id);
    expect(sent.contract.status).toBe('SENT');
  });

  it('refuses to generate when the referenced template has no Documenso link', async () => {
    const tmpl = await service.registerTemplate(ctx, { name: 'Broken', documensoTemplateId: 'x' });
    stores.templates.get(tmpl.id).documensoTemplateId = null; // simulate an unlinked template
    const { contract } = await service.createContract(ctx, { title: 'X', templateId: tmpl.id, recipients: twoParty() });
    await expect(service.generateContract(ctx, contract.id)).rejects.toThrow(/not linked to a Documenso template/);
  });

  it('reissues a signing link for a recipient on a SENT contract (rotates the stored hash)', async () => {
    const { contract, recipients } = await service.createContract(ctx, { title: 'MSA', recipients: twoParty() });
    await service.generateContract(ctx, contract.id);
    await service.approveContract(ctx, contract.id);
    await service.sendContract(ctx, contract.id);
    const rid = recipients[0].id;
    const before = stores.recipients.get(rid).signingTokenHash;
    const url = await service.reissueSigningLink(ctx, contract.id, rid);
    expect(url).toContain('/sign/');
    expect(stores.recipients.get(rid).signingTokenHash).not.toBe(before); // rotated → old link invalidated
  });

  it('refuses to reissue a link for a DRAFT contract', async () => {
    const { contract, recipients } = await service.createContract(ctx, { title: 'x', recipients: twoParty() });
    await expect(service.reissueSigningLink(ctx, contract.id, recipients[0].id)).rejects.toMatchObject({ statusCode: 409 });
  });

  it('enforces the state machine: cannot approve a DRAFT (skip generate)', async () => {
    const { contract } = await service.createContract(ctx, { title: 'x', recipients: twoParty() });
    await expect(service.approveContract(ctx, contract.id)).rejects.toBeInstanceOf(ContractStateError);
  });

  it('locks recipients after DRAFT (immutability)', async () => {
    const { contract } = await service.createContract(ctx, { title: 'x', recipients: twoParty() });
    await service.generateContract(ctx, contract.id);
    await expect(
      service.addRecipients(ctx, contract.id, [{ name: 'Late', email: 'late@x.com' }]),
    ).rejects.toThrow(/DRAFT/);
  });

  it('void cancels at the provider and blocks re-void', async () => {
    const { contract } = await service.createContract(ctx, { title: 'x', recipients: twoParty() });
    await service.generateContract(ctx, contract.id);
    const cancelSpy = vi.spyOn(mock, 'cancelDocument');
    const voided = await service.voidContract(ctx, contract.id, 'client changed terms');
    expect(voided.contract.status).toBe('VOIDED');
    expect(cancelSpy).toHaveBeenCalledOnce();
    await expect(service.voidContract(ctx, contract.id, 'again')).rejects.toThrow(/already VOIDED/);
  });

  it('clones a voided contract to v2 with lineage', async () => {
    const { contract } = await service.createContract(ctx, { title: 'x', recipients: twoParty() });
    await service.voidContract(ctx, contract.id, 'redo');
    const clone = await service.cloneContract(ctx, contract.id);
    expect(clone.contract.version).toBe(2);
    expect(clone.contract.parentContractId).toBe(contract.id);
    expect(clone.contract.referenceNumber).toBe('GE/CON/2026-27/001/v2');
    expect(clone.recipients).toHaveLength(2);
  });

  it('isolates tenants: tenant B cannot read tenant A’s contract', async () => {
    const { contract } = await service.createContract(ctx, { title: 'secret', recipients: twoParty() });
    await expect(service.getContractDetail(ctxOther, contract.id)).rejects.toMatchObject({ statusCode: 404 });
    // and listing for B returns nothing
    expect(await service.listContracts(ctxOther, {})).toHaveLength(0);
  });
});
