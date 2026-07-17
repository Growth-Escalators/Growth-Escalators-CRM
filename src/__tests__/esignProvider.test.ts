import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

describe('DocumensoProvider — recipient roles + field placement', () => {
  // Stub global fetch: echo the create call's recipients back with ids, and
  // record every field-placement POST so we can assert which recipients got one.
  const calls: Array<{ url: string; method: string; body: any }> = [];
  let savedUrl: string | undefined;
  let savedToken: string | undefined;

  function rolesInput(): ProviderRecipientInput[] {
    return [
      { email: 'Signer@x.com', name: 'Signer', role: 'client_signer', signingOrder: 1 },
      { email: 'counter@ge.com', name: 'Counter', role: 'internal_countersigner', signingOrder: 2 },
      { email: 'boss@ge.com', name: 'Approver', role: 'approver', signingOrder: 3 },
      { email: 'cc@x.com', name: 'Cc', role: 'cc', signingOrder: 4 },
      { email: 'viewer@x.com', name: 'Viewer', role: 'viewer', signingOrder: 5 },
    ];
  }

  beforeEach(() => {
    calls.length = 0;
    savedUrl = process.env.DOCUMENSO_API_URL;
    savedToken = process.env.DOCUMENSO_API_TOKEN;
    process.env.DOCUMENSO_API_URL = 'https://documenso.example';
    process.env.DOCUMENSO_API_TOKEN = 'test-token';
    vi.stubGlobal('fetch', vi.fn(async (url: any, opts: any = {}) => {
      const method = opts.method ?? 'GET';
      const body = opts.body ? JSON.parse(opts.body) : undefined;
      calls.push({ url: String(url), method, body });
      if (String(url).endsWith('/api/v1/documents') && method === 'POST') {
        // Echo recipients with sequential provider ids, preserving order.
        const recipients = body.recipients.map((r: any, i: number) => ({ email: r.email, recipientId: 100 + i }));
        return new Response(JSON.stringify({ documentId: 'doc_9', recipients }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (/\/api\/v1\/documents\/doc_9\/fields$/.test(String(url)) && method === 'POST') {
        return new Response(JSON.stringify({ id: 1 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('not found', { status: 404 });
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    if (savedUrl === undefined) delete process.env.DOCUMENSO_API_URL; else process.env.DOCUMENSO_API_URL = savedUrl;
    if (savedToken === undefined) delete process.env.DOCUMENSO_API_TOKEN; else process.env.DOCUMENSO_API_TOKEN = savedToken;
  });

  it('maps each CRM role to the correct Documenso recipient role', async () => {
    await new DocumensoProvider().createDocument({ title: 'Roles', pdf: PDF, recipients: rolesInput() });
    const createCall = calls.find((c) => c.url.endsWith('/api/v1/documents') && c.method === 'POST');
    expect(createCall?.body.recipients.map((r: any) => r.role)).toEqual(['SIGNER', 'SIGNER', 'APPROVER', 'CC', 'VIEWER']);
  });

  it('places a SIGNATURE field only for SIGNER recipients (approver/cc/viewer get none)', async () => {
    await new DocumensoProvider().createDocument({ title: 'Roles', pdf: PDF, recipients: rolesInput() });
    const fieldCalls = calls.filter((c) => /\/fields$/.test(c.url) && c.method === 'POST');
    // Two signers (client_signer + internal_countersigner) → 100 & 101; the rest skipped.
    expect(fieldCalls).toHaveLength(2);
    expect(fieldCalls.map((c) => c.body.recipientId).sort()).toEqual([100, 101]);
    expect(fieldCalls.every((c) => c.body.type === 'SIGNATURE')).toBe(true);
  });

  it('a document with only non-signer recipients places no fields', async () => {
    await new DocumensoProvider().createDocument({
      title: 'Viewers only', pdf: PDF,
      recipients: [{ email: 'v@x.com', name: 'V', role: 'viewer', signingOrder: 1 }],
    });
    expect(calls.filter((c) => /\/fields$/.test(c.url))).toHaveLength(0);
  });
});
