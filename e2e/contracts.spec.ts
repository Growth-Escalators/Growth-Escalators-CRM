import { test, expect, type Page, type APIRequestContext, request as pwRequest } from '@playwright/test';
import crypto from 'crypto';

// Real-backend E2E for the Contracts / e-signature module. Requires
// scripts/run-contracts-e2e.sh (backend on :3000, mock provider + local storage,
// seeded wizmatch_e2e_test DB). Self-skips when E2E_PASSWORD is unset.
const PASSWORD = process.env.E2E_PASSWORD || '';
const EMAIL = process.env.E2E_EMAIL || 'e2e.contracts@example.invalid';
const BACKEND = process.env.E2E_BACKEND_URL || 'http://localhost:3000';
const WEBHOOK_SECRET = process.env.DOCUMENSO_WEBHOOK_SECRET || 'e2e-webhook-secret';

test.skip(!PASSWORD, 'run via scripts/run-contracts-e2e.sh (sets E2E_PASSWORD from the seed)');
test.describe.configure({ mode: 'serial' });

async function login(page: Page) {
  await page.goto('/login');
  await page.getByRole('button', { name: 'Growth Escalators' }).click();
  await page.locator('input[type="email"]').fill(EMAIL);
  await page.locator('input[type="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForFunction(() => !!localStorage.getItem('ge_crm_token'), { timeout: 20_000 });
}

async function apiCtx(page: Page): Promise<APIRequestContext> {
  const token = await page.evaluate(() => localStorage.getItem('ge_crm_token'));
  return pwRequest.newContext({ baseURL: BACKEND, extraHTTPHeaders: { Authorization: `Bearer ${token}` } });
}

async function gotoContracts(page: Page) {
  await page.goto('/contracts');
  // Vite compiles the ContractsPage chunk on first navigation — allow extra time.
  await expect(page.getByRole('heading', { name: 'Contracts' })).toBeVisible({ timeout: 25_000 });
}

function rowFor(page: Page, title: string) {
  return page.locator('tr', { hasText: title });
}

async function openNewContractForm(page: Page, title: string, opts: { counter?: boolean } = {}) {
  await page.getByRole('button', { name: 'New contract' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Client name').fill('Client Co');
  await page.getByLabel('Client email').fill('client@example.com');
  if (opts.counter) {
    await page.getByLabel('Require internal countersignature').check();
    await page.getByPlaceholder('Countersigner name').fill('GE GM');
    await page.getByPlaceholder('Countersigner email').fill('gm@ge.test');
  }
  await page.getByRole('button', { name: 'Create draft' }).click();
}

test('full lifecycle: create → generate → approve → send → sign → COMPLETED → download', async ({ page, browser }) => {
  await login(page);
  await gotoContracts(page);

  const title = `E2E Lifecycle ${Date.now()}`;
  await openNewContractForm(page, title);
  await expect(rowFor(page, title).getByText('DRAFT')).toBeVisible({ timeout: 15_000 });

  await rowFor(page, title).getByRole('button', { name: 'Generate' }).click();
  await expect(rowFor(page, title).getByText('GENERATED')).toBeVisible({ timeout: 15_000 });

  await rowFor(page, title).getByRole('button', { name: 'Approve' }).click();
  await expect(rowFor(page, title).getByText('READY TO SEND')).toBeVisible({ timeout: 15_000 });

  await rowFor(page, title).getByRole('button', { name: 'Send' }).click();
  await expect(rowFor(page, title).getByText('SENT')).toBeVisible({ timeout: 15_000 });

  // Resolve the contract + provider doc id via the API (with the session token).
  const api = await apiCtx(page);
  const list = await (await api.get('/api/contracts')).json();
  const contract = list.contracts.find((c: any) => c.title === title);
  expect(contract).toBeTruthy();

  // Open detail → copy the signing link.
  await rowFor(page, title).locator('td', { hasText: title }).first().click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).first().click();
  const signingUrl = await page.locator('[data-testid^="signing-link-"]').first().inputValue();
  expect(signingUrl).toContain('/sign/');

  // Signer opens the link in a fresh (no-auth) context, accepts consent, signs.
  const signerCtx = await browser.newContext();
  const signer = await signerCtx.newPage();
  await signer.goto(signingUrl);
  await expect(signer.getByText(/consent to conduct this transaction electronically/i)).toBeVisible({ timeout: 15_000 });
  const boxes = signer.locator('input[type="checkbox"]');
  const n = await boxes.count();
  for (let i = 0; i < n; i++) await boxes.nth(i).check();
  await signer.getByRole('button', { name: /Agree & continue to sign/i }).click();
  await expect(signer.locator('iframe[title="Sign document"]')).toBeVisible({ timeout: 15_000 });
  await signerCtx.close();

  // Documenso would now POST a completion webhook — simulate it (mock has auto-signed).
  const body = JSON.stringify({ event: 'DOCUMENT_COMPLETED', webhookEventId: `e2e-${Date.now()}`, payload: { id: contract.documensoDocumentId } });
  const sig = crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  const hook = await api.post('/webhooks/documenso', { headers: { 'content-type': 'application/json', 'x-documenso-signature': sig }, data: body });
  expect(hook.status()).toBe(200);

  // Verify completion via API + a signed-document download that streams a PDF.
  const detail = await (await api.get(`/api/contracts/${contract.id}`)).json();
  expect(detail.contract.status).toBe('COMPLETED');
  const dl = await (await api.get(`/api/contracts/${contract.id}/download?artifact=completed`)).json();
  const fileRes = await api.get(dl.url);
  expect(fileRes.status()).toBe(200);
  expect(fileRes.headers()['content-type']).toContain('pdf');

  // And the UI reflects COMPLETED.
  await page.reload();
  await expect(rowFor(page, title).getByText('COMPLETED')).toBeVisible({ timeout: 15_000 });
  await api.dispose();
});

test('countersignature contract shows two recipients', async ({ page }) => {
  await login(page);
  await gotoContracts(page);
  const title = `E2E Counter ${Date.now()}`;
  await openNewContractForm(page, title, { counter: true });
  await expect(rowFor(page, title).getByText('DRAFT')).toBeVisible({ timeout: 15_000 });
  await rowFor(page, title).locator('td', { hasText: title }).first().click();
  await expect(page.getByText('client signer')).toBeVisible();
  await expect(page.getByText('internal countersigner')).toBeVisible();
});

test('void moves a contract to VOIDED', async ({ page }) => {
  await login(page);
  await gotoContracts(page);
  const title = `E2E Void ${Date.now()}`;
  await openNewContractForm(page, title);
  await expect(rowFor(page, title).getByText('DRAFT')).toBeVisible({ timeout: 15_000 });
  page.once('dialog', (d) => d.accept('e2e void'));
  await rowFor(page, title).getByRole('button', { name: 'Void' }).click();
  await expect(rowFor(page, title).getByText('VOIDED')).toBeVisible({ timeout: 15_000 });
});

test('public signing page rejects an invalid token', async ({ page }) => {
  await page.goto('/sign/not-a-real-token');
  await expect(page.getByText(/not valid|expired|not found/i)).toBeVisible({ timeout: 15_000 });
});
