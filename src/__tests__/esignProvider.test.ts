import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MockESignProvider } from '../modules/esign/providers/mock.provider';
import { DocumensoProvider } from '../modules/esign/providers/documenso.provider';
import {
  getESignProvider,
  setESignProvider,
  resetESignProvider,
} from '../modules/esign/providers';
import { ESignProviderError, type ProviderRecipientInput } from '../modules/esign/esign.types';

const PDF = Buffer.from('%PDF-1.7\n% unsigned contract\n');

function recipients(): ProviderRecipientInput[] {
  return [
    { email: 'Client@Example.com', name: 'Client Co', role: 'client_signer', signingOrder: 1 },
    { email: 'gm@ge.com', name: 'GE Signatory', role: 'internal_countersigner', signingOrder: 2 },
  ];
}

describe('MockESignProvider — full lifecycle contract', () => {
  let p: MockESignProvider;
  beforeEach(() => { p = new MockESignProvider(); });

  it('creates a draft document with normalized recipient emails', async () => {
    const r = await p.createDocument({ title: 'MSA', pdf: PDF, recipients: recipients() });
    expect(r.externalDocumentId).toBeTruthy();
    expect(r.recipients.map((x) => x.email)).toEqual(['client@example.com', 'gm@ge.com']);
    const status = await p.getDocumentStatus(r.externalDocumentId);
    expect(status.status).toBe('draft');
  });

  it('createDocument requires a non-empty pdf', async () => {
    await expect(
      p.createDocument({ title: 'x', pdf: Buffer.alloc(0), recipients: recipients() }),
    ).rejects.toBeInstanceOf(ESignProviderError);
  });

  it('rejects addRecipients after send, allows before', async () => {
    const r = await p.createDocument({ title: 'MSA', pdf: PDF, recipients: [recipients()[0]] });
    await p.addRecipients({ externalDocumentId: r.externalDocumentId, recipients: [recipients()[1]] });
    await p.sendDocument(r.externalDocumentId);
    await expect(
      p.addRecipients({ externalDocumentId: r.externalDocumentId, recipients: [recipients()[0]] }),
    ).rejects.toThrow(/after send/i);
  });

  it('signing session requires a sent doc and a known recipient', async () => {
    const r = await p.createDocument({ title: 'MSA', pdf: PDF, recipients: recipients() });
    await expect(
      p.createSigningSession({ externalDocumentId: r.externalDocumentId, recipientEmail: 'client@example.com' }),
    ).rejects.toThrow(/not sent/i);
    await p.sendDocument(r.externalDocumentId);
    const s = await p.createSigningSession({ externalDocumentId: r.externalDocumentId, recipientEmail: 'client@example.com' });
    expect(s.signingUrl).toContain('/sign/');
    await expect(
      p.createSigningSession({ externalDocumentId: r.externalDocumentId, recipientEmail: 'nobody@x.com' }),
    ).rejects.toThrow(/not found/i);
  });

  it('progresses draft → pending → partially_signed → completed (countersignature)', async () => {
    const r = await p.createDocument({ title: 'MSA', pdf: PDF, recipients: recipients() });
    await p.sendDocument(r.externalDocumentId);
    expect((await p.getDocumentStatus(r.externalDocumentId)).status).toBe('pending');
    // A viewed-but-unsigned recipient keeps the PROVIDER doc status at 'pending'
    // (recipient-level 'viewed' is surfaced separately; the CRM maps it to VIEWED).
    p.__view(r.externalDocumentId, 'client@example.com');
    const afterView = await p.getDocumentStatus(r.externalDocumentId);
    expect(afterView.status).toBe('pending');
    expect(afterView.recipients.find((x) => x.email === 'client@example.com')?.status).toBe('viewed');

    p.__sign(r.externalDocumentId, 'client@example.com');
    expect((await p.getDocumentStatus(r.externalDocumentId)).status).toBe('partially_signed');
    await expect(p.downloadCompletedDocument(r.externalDocumentId)).rejects.toThrow(/not completed/i);
    expect(await p.downloadAuditCertificate(r.externalDocumentId)).toBeNull();

    p.__sign(r.externalDocumentId, 'gm@ge.com');
    const done = await p.getDocumentStatus(r.externalDocumentId);
    expect(done.status).toBe('completed');
    expect(done.completedAt).toBeTruthy();

    const pdf = await p.downloadCompletedDocument(r.externalDocumentId);
    expect(pdf.subarray(0, 4).toString('ascii')).toBe('%PDF');
    const cert = await p.downloadAuditCertificate(r.externalDocumentId);
    expect(cert?.subarray(0, 4).toString('ascii')).toBe('%PDF');
  });

  it('a rejection makes the document rejected', async () => {
    const r = await p.createDocument({ title: 'MSA', pdf: PDF, recipients: recipients() });
    await p.sendDocument(r.externalDocumentId);
    p.__reject(r.externalDocumentId, 'client@example.com');
    expect((await p.getDocumentStatus(r.externalDocumentId)).status).toBe('rejected');
  });

  it('cancel makes the document cancelled', async () => {
    const r = await p.createDocument({ title: 'MSA', pdf: PDF, recipients: recipients() });
    await p.cancelDocument(r.externalDocumentId);
    expect((await p.getDocumentStatus(r.externalDocumentId)).status).toBe('cancelled');
  });

  it('unknown document ids throw 404', async () => {
    await expect(p.getDocumentStatus('nope')).rejects.toBeInstanceOf(ESignProviderError);
  });
});

describe('MockESignProvider — autoSignOnSession (E2E/local flag)', () => {
  it('auto-signs a recipient when a signing session is created', async () => {
    const p = new MockESignProvider({ autoSignOnSession: true });
    const r = await p.createDocument({ title: 'NDA', pdf: PDF, recipients: [recipients()[0]] });
    await p.sendDocument(r.externalDocumentId);
    expect((await p.getDocumentStatus(r.externalDocumentId)).status).toBe('pending');
    await p.createSigningSession({ externalDocumentId: r.externalDocumentId, recipientEmail: 'client@example.com' });
    // single signer auto-signed → whole document completed
    expect((await p.getDocumentStatus(r.externalDocumentId)).status).toBe('completed');
  });

  it('default (flag off) does NOT auto-sign', async () => {
    const p = new MockESignProvider();
    const r = await p.createDocument({ title: 'NDA', pdf: PDF, recipients: [recipients()[0]] });
    await p.sendDocument(r.externalDocumentId);
    await p.createSigningSession({ externalDocumentId: r.externalDocumentId, recipientEmail: 'client@example.com' });
    expect((await p.getDocumentStatus(r.externalDocumentId)).status).toBe('pending');
  });
});

describe('provider factory', () => {
  afterEach(() => resetESignProvider());

  it('returns the mock provider when ESIGN_PROVIDER=mock', () => {
    const prev = process.env.ESIGN_PROVIDER;
    process.env.ESIGN_PROVIDER = 'mock';
    resetESignProvider();
    expect(getESignProvider().name).toBe('mock');
    if (prev === undefined) delete process.env.ESIGN_PROVIDER; else process.env.ESIGN_PROVIDER = prev;
  });

  it('honours setESignProvider (DI hook)', () => {
    const inj = new MockESignProvider();
    setESignProvider(inj);
    expect(getESignProvider()).toBe(inj);
  });
});

describe('DocumensoProvider config guard', () => {
  let savedUrl: string | undefined;
  let savedToken: string | undefined;
  beforeEach(() => {
    savedUrl = process.env.DOCUMENSO_API_URL;
    savedToken = process.env.DOCUMENSO_API_TOKEN;
    delete process.env.DOCUMENSO_API_URL;
    delete process.env.DOCUMENSO_API_TOKEN;
  });
  afterEach(() => {
    if (savedUrl === undefined) delete process.env.DOCUMENSO_API_URL; else process.env.DOCUMENSO_API_URL = savedUrl;
    if (savedToken === undefined) delete process.env.DOCUMENSO_API_TOKEN; else process.env.DOCUMENSO_API_TOKEN = savedToken;
  });

  it('fails closed (503) when Documenso is not configured', async () => {
    const p = new DocumensoProvider();
    await expect(p.getDocumentStatus('doc_1')).rejects.toMatchObject({
      name: 'ESignProviderError',
      statusCode: 503,
    });
  });
});
