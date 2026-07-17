import { test, expect, type Page, type APIRequestContext, request as pwRequest } from '@playwright/test';
import path from 'path';

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
  // Documenso sends the configured secret verbatim in X-Documenso-Secret.
  const hook = await api.post('/webhooks/documenso', { headers: { 'content-type': 'application/json', 'x-documenso-secret': WEBHOOK_SECRET }, data: body });
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

test('upload PDF: create → upload → GENERATED → approve → send → sign → COMPLETED → download', async ({ page, browser }) => {
  await login(page);
  await gotoContracts(page);

  const title = `E2E Upload ${Date.now()}`;
  await openNewContractForm(page, title);
  await expect(rowFor(page, title).getByText('DRAFT')).toBeVisible({ timeout: 15_000 });

  // Bring-your-own-PDF: "Upload PDF" opens the OS file chooser; feed it the fixture.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    rowFor(page, title).getByRole('button', { name: 'Upload PDF' }).click(),
  ]);
  await chooser.setFiles(path.join(__dirname, 'fixtures/sample-contract.pdf'));
  // The uploaded PDF becomes the document — no pdfkit generation.
  await expect(rowFor(page, title).getByText('GENERATED')).toBeVisible({ timeout: 15_000 });

  await rowFor(page, title).getByRole('button', { name: 'Approve' }).click();
  await expect(rowFor(page, title).getByText('READY TO SEND')).toBeVisible({ timeout: 15_000 });

  await rowFor(page, title).getByRole('button', { name: 'Send' }).click();
  await expect(rowFor(page, title).getByText('SENT')).toBeVisible({ timeout: 15_000 });

  const api = await apiCtx(page);
  const list = await (await api.get('/api/contracts')).json();
  const contract = list.contracts.find((c: any) => c.title === title);
  expect(contract).toBeTruthy();

  await rowFor(page, title).locator('td', { hasText: title }).first().click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await page.getByRole('button', { name: 'Copy link' }).first().click();
  const signingUrl = await page.locator('[data-testid^="signing-link-"]').first().inputValue();
  expect(signingUrl).toContain('/sign/');

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

  const body = JSON.stringify({ event: 'DOCUMENT_COMPLETED', webhookEventId: `e2e-up-${Date.now()}`, payload: { id: contract.documensoDocumentId } });
  const hook = await api.post('/webhooks/documenso', { headers: { 'content-type': 'application/json', 'x-documenso-secret': WEBHOOK_SECRET }, data: body });
  expect(hook.status()).toBe(200);

  const detail = await (await api.get(`/api/contracts/${contract.id}`)).json();
  expect(detail.contract.status).toBe('COMPLETED');
  const dl = await (await api.get(`/api/contracts/${contract.id}/download?artifact=completed`)).json();
  const fileRes = await api.get(dl.url);
  expect(fileRes.status()).toBe(200);
  expect(fileRes.headers()['content-type']).toContain('pdf');

  await page.reload();
  await expect(rowFor(page, title).getByText('COMPLETED')).toBeVisible({ timeout: 15_000 });
  await api.dispose();
});

test('upload PDF: a non-PDF (spoofed content-type) is rejected server-side; contract stays DRAFT', async ({ page }) => {
  await login(page);
  await gotoContracts(page);

  const title = `E2E Upload Reject ${Date.now()}`;
  await openNewContractForm(page, title);
  await expect(rowFor(page, title).getByText('DRAFT')).toBeVisible({ timeout: 15_000 });

  // Spoof the mime type as application/pdf so it clears the client guard and
  // reaches the server — assertPdf (magic bytes) must reject it with a 400.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    rowFor(page, title).getByRole('button', { name: 'Upload PDF' }).click(),
  ]);
  await chooser.setFiles({ name: 'fake.pdf', mimeType: 'application/pdf', buffer: Buffer.from('this is definitely not a pdf') });

  await expect(page.getByText(/File is not a valid PDF/i)).toBeVisible({ timeout: 10_000 });
  // Never transitioned — still a draft.
  await expect(rowFor(page, title).getByText('DRAFT')).toBeVisible();
  await expect(rowFor(page, title).getByText('GENERATED')).toHaveCount(0);
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

test('templates: register a Documenso template, then create + generate a contract from it', async ({ page }) => {
  await login(page);
  await gotoContracts(page);

  // Register a Documenso template as a CRM template via the manager modal.
  await page.getByRole('button', { name: 'Manage templates' }).click();
  await page.getByRole('button', { name: 'Load Documenso templates' }).click();
  // Only the manager's Documenso-picker <select> is on screen here.
  await page.locator('select').selectOption('tmpl_nda'); // mock provider template id
  await page.getByPlaceholder('Display name').fill('E2E NDA Template');
  await page.getByRole('button', { name: 'Register template' }).click();
  await expect(page.getByText('E2E NDA Template')).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Close' }).click();

  // Create a contract FROM that template — the terms field is replaced by the
  // template note, and generation goes through createFromTemplate (no local PDF).
  const title = `E2E Template ${Date.now()}`;
  await page.getByRole('button', { name: 'New contract' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Template (optional)').selectOption({ label: 'E2E NDA Template' });
  await page.getByLabel('Client name').fill('Client Co');
  await page.getByLabel('Client email').fill('client@example.com');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(rowFor(page, title).getByText('DRAFT')).toBeVisible({ timeout: 15_000 });

  await rowFor(page, title).getByRole('button', { name: 'Generate' }).click();
  await expect(rowFor(page, title).getByText('GENERATED')).toBeVisible({ timeout: 15_000 });
});

test('roles: a CC recipient is added, shown, and the contract still generates → sends', async ({ page }) => {
  await login(page);
  await gotoContracts(page);

  const title = `E2E CC ${Date.now()}`;
  await page.getByRole('button', { name: 'New contract' }).click();
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Client name').fill('Client Co');
  await page.getByLabel('Client email').fill('client@example.com');
  // Add a CC recipient (role select defaults to "CC (copy only)").
  await page.getByRole('button', { name: '+ Add recipient' }).click();
  await page.getByPlaceholder('Name').fill('Ops Copy');
  await page.getByPlaceholder('Email').fill('ops@ge.test');
  await page.getByRole('button', { name: 'Create draft' }).click();
  await expect(rowFor(page, title).getByText('DRAFT')).toBeVisible({ timeout: 15_000 });

  // A CC recipient must not block the lifecycle (it gets no signature field).
  await rowFor(page, title).getByRole('button', { name: 'Generate' }).click();
  await expect(rowFor(page, title).getByText('GENERATED')).toBeVisible({ timeout: 15_000 });
  await rowFor(page, title).getByRole('button', { name: 'Approve' }).click();
  await expect(rowFor(page, title).getByText('READY TO SEND')).toBeVisible({ timeout: 15_000 });
  await rowFor(page, title).getByRole('button', { name: 'Send' }).click();
  await expect(rowFor(page, title).getByText('SENT')).toBeVisible({ timeout: 15_000 });

  // The CC recipient + its role are visible in the detail drawer.
  await rowFor(page, title).locator('td', { hasText: title }).first().click();
  await expect(page.getByRole('heading', { name: title })).toBeVisible();
  await expect(page.getByText('Ops Copy')).toBeVisible();
  await expect(page.getByText('(cc)')).toBeVisible();
});
