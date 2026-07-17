import { test, expect, type Page, type APIRequestContext, request as pwRequest } from '@playwright/test';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

// Visual walkthrough of the Contracts / e-signature feature using a realistic
// Mutual NDA as the sample document. Captures step screenshots + the generated
// PDF into docs/esign/demo/. Run via:
//   E2E_CONFIG=playwright.contracts-demo.config.ts bash scripts/run-contracts-e2e.sh
const PASSWORD = process.env.E2E_PASSWORD || '';
const EMAIL = process.env.E2E_EMAIL || 'e2e.contracts@example.invalid';
const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.DOCUMENSO_WEBHOOK_SECRET || 'e2e-webhook-secret';

const DEMO_DIR = path.resolve(process.cwd(), 'docs/esign/demo');

const NDA_TITLE = 'Mutual Non-Disclosure Agreement';
const NDA_TERMS = `1. Purpose. Growth Escalators and the Client wish to explore a potential business relationship and, in connection with this, each party may disclose to the other certain confidential and proprietary information.

2. Confidential Information. "Confidential Information" means any non-public business, technical, financial, or customer information disclosed by one party (the "Discloser") to the other (the "Recipient"), whether in writing, orally, or by inspection of tangible objects.

3. Obligations. The Recipient shall (a) hold the Confidential Information in strict confidence; (b) not disclose it to any third party without the Discloser's prior written consent; and (c) use it solely to evaluate the potential business relationship.

4. Term. This Agreement is effective as of the date of the last signature below and the confidentiality obligations survive for a period of two (2) years thereafter.

5. Governing Law. This Agreement is governed by the laws of India, and the courts at the Discloser's registered office shall have exclusive jurisdiction.`;

test.skip(!PASSWORD, 'run via scripts/run-contracts-e2e.sh with E2E_CONFIG=playwright.contracts-demo.config.ts');

async function shot(page: Page, name: string) {
  await page.screenshot({ path: path.join(DEMO_DIR, name), fullPage: true });
}
async function apiCtx(page: Page): Promise<APIRequestContext> {
  const token = await page.evaluate(() => localStorage.getItem('ge_crm_token'));
  return pwRequest.newContext({ baseURL: BACKEND, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}
function rowFor(page: Page, title: string) {
  return page.locator('tr', { hasText: title });
}
async function savePdf(api: APIRequestContext, contractId: string, artifact: string, outfile: string) {
  const dl = await (await api.get(`/api/contracts/${contractId}/download?artifact=${artifact}`)).json();
  const res = await api.get(dl.url);
  fs.writeFileSync(path.join(DEMO_DIR, outfile), await res.body());
}
// Each webhook needs a UNIQUE event id, otherwise processed_events dedupes it
// and the second delivery is skipped (contract would never advance).
async function postWebhook(api: APIRequestContext, docId: string) {
  const body = JSON.stringify({ event: 'DOCUMENT_COMPLETED', webhookEventId: `demo-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, payload: { id: docId } });
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  const res = await api.post('/webhooks/documenso', { headers: { 'content-type': 'application/json', 'x-documenso-signature': sig }, data: body });
  expect(res.status()).toBe(200);
}
async function signViaLink(browser: import('@playwright/test').Browser, url: string, screenshot: string) {
  const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
  const p = await ctx.newPage();
  await p.goto(url);
  await expect(p.getByText(/consent to conduct this transaction electronically/i)).toBeVisible({ timeout: 15_000 });
  for (const cb of await p.locator('input[type="checkbox"]').all()) await cb.check();
  await p.getByRole('button', { name: /Agree & continue to sign/i }).click();
  await expect(p.locator('iframe[title="Sign document"]')).toBeVisible({ timeout: 15_000 });
  await p.screenshot({ path: path.join(DEMO_DIR, screenshot), fullPage: true });
  await ctx.close();
}

test('walkthrough: create → generate → approve → send → sign → complete a Mutual NDA', async ({ page, browser }) => {
  fs.mkdirSync(DEMO_DIR, { recursive: true });

  // 1) Sign in (as Growth Escalators)
  await page.goto('/login');
  await page.getByRole('button', { name: 'Growth Escalators' }).click();
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await shot(page, '01-login.png');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForFunction(() => !!localStorage.getItem('ge_crm_token'), { timeout: 20_000 });

  // 2) Open the Contracts module
  await page.goto('/contracts');
  await expect(page.getByRole('heading', { name: 'Contracts' })).toBeVisible({ timeout: 25_000 });
  await shot(page, '02-contracts-list.png');

  // 3) Create a new contract from the Mutual NDA
  await page.getByRole('button', { name: 'New contract' }).click();
  await page.getByLabel('Title').fill(NDA_TITLE);
  await page.getByLabel('Client name').fill('Acme Retail Pvt Ltd');
  await page.getByLabel('Client email').fill('legal@acme-retail.example');
  await page.getByLabel('Require internal countersignature').check();
  await page.getByPlaceholder('Countersigner name').fill('Growth Escalators (Authorised Signatory)');
  await page.getByPlaceholder('Countersigner email').fill('contracts@growthescalators.example');
  await page.getByLabel('Terms').fill(NDA_TERMS);
  await shot(page, '03-new-contract-form.png');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(rowFor(page, NDA_TITLE).getByText('DRAFT')).toBeVisible({ timeout: 15_000 });
  await shot(page, '04-draft.png');

  const api = await apiCtx(page);
  const contract = (await (await api.get('/api/contracts')).json()).contracts.find((c: any) => c.title === NDA_TITLE);
  expect(contract).toBeTruthy();

  // 4) Generate the document (renders the NDA to a PDF), then save that real PDF
  await rowFor(page, NDA_TITLE).getByRole('button', { name: 'Generate' }).click();
  await expect(rowFor(page, NDA_TITLE).getByText('GENERATED')).toBeVisible({ timeout: 15_000 });
  await shot(page, '05-generated.png');
  await savePdf(api, contract.id, 'generated', 'mutual-nda.pdf'); // <- the generated contract PDF

  // 5) Approve + send
  await rowFor(page, NDA_TITLE).getByRole('button', { name: 'Approve' }).click();
  await expect(rowFor(page, NDA_TITLE).getByText('READY TO SEND')).toBeVisible({ timeout: 15_000 });
  await shot(page, '06-ready-to-send.png');
  await rowFor(page, NDA_TITLE).getByRole('button', { name: 'Send' }).click();
  await expect(rowFor(page, NDA_TITLE).getByText('SENT')).toBeVisible({ timeout: 15_000 });
  await shot(page, '07-sent.png');
  // documensoDocumentId is assigned during generate — fetch it fresh for the webhooks.
  const docId = (await (await api.get(`/api/contracts/${contract.id}`)).json()).contract.documensoDocumentId;
  expect(docId).toBeTruthy();

  // 6) Copy the recipient's signing link
  await rowFor(page, NDA_TITLE).locator('td', { hasText: NDA_TITLE }).first().click();
  await expect(page.getByRole('heading', { name: NDA_TITLE })).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).first().click();
  const signingUrl = await page.locator('[data-testid^="signing-link-"]').first().inputValue();
  await shot(page, '08-detail-signing-link.png');

  // 7) The client (first signer) opens the link (no login), reviews + consents
  {
    const ctx = await browser.newContext({ viewport: { width: 900, height: 1000 } });
    const p = await ctx.newPage();
    await p.goto(signingUrl);
    await expect(p.getByText(/consent to conduct this transaction electronically/i)).toBeVisible({ timeout: 15_000 });
    await shot(p, '09-signing-consent.png');
    for (const cb of await p.locator('input[type="checkbox"]').all()) await cb.check();
    await p.getByRole('button', { name: /Agree & continue to sign/i }).click();
    await expect(p.locator('iframe[title="Sign document"]')).toBeVisible({ timeout: 15_000 });
    await shot(p, '10-signing-embedded.png');
    await ctx.close();
  }

  // 8) Documenso posts a completion webhook after the client signs → PARTIALLY_SIGNED
  await postWebhook(api, docId);
  const afterClient = await (await api.get(`/api/contracts/${contract.id}`)).json();
  expect(afterClient.contract.status).toBe('PARTIALLY_SIGNED');
  await page.reload();
  await rowFor(page, NDA_TITLE).locator('td', { hasText: NDA_TITLE }).first().click();
  await expect(page.getByText('Audit timeline')).toBeVisible();
  await shot(page, '11-partially-signed.png');

  // 9) Growth Escalators countersigns (second signer, enforced signing order)
  const counterRid = afterClient.recipients.find((r: any) => r.signingRole === 'internal_countersigner').id;
  const counterUrl = (await (await api.post(`/api/contracts/${contract.id}/recipients/${counterRid}/signing-link`)).json()).url;
  await signViaLink(browser, counterUrl, '12-countersign.png');

  // 10) Final completion webhook → COMPLETED, and the signed copy is retained
  await postWebhook(api, docId);
  expect((await (await api.get(`/api/contracts/${contract.id}`)).json()).contract.status).toBe('COMPLETED');
  await savePdf(api, contract.id, 'completed', 'signed-contract.pdf');

  // 11) Back in the CRM: COMPLETED + full audit timeline
  await page.reload();
  await expect(rowFor(page, NDA_TITLE).getByText('COMPLETED')).toBeVisible({ timeout: 15_000 });
  await shot(page, '13-completed-list.png');
  await rowFor(page, NDA_TITLE).locator('td', { hasText: NDA_TITLE }).first().click();
  await expect(page.getByText('Audit timeline')).toBeVisible();
  await shot(page, '14-completed-detail.png');
  await api.dispose();
});
