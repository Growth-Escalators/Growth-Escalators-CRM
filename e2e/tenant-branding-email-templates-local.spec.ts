import { expect, test, type Page, type Route } from '@playwright/test';

// Regression coverage for admin/src/pages/EmailTemplatesPage.jsx's defaults.
// The "New Template" modal used to default fromName to a hardcoded personal
// name ("Jatin from Growth Escalators"), and the "Send Test Email" modal
// used to default the send-to address to a hardcoded personal inbox — wrong
// for every tenant, GE included once anyone else owns the account. Fixed to
// derive both from the tenant's own cached tenant_branding row.
//
// The modal's default is a lazy useState initializer — it's read ONCE at
// mount, so the branding cache must already be populated (pre-seeded here,
// same as a returning tenant whose browser cached it on a previous session)
// rather than relying on the in-page async refetch to land before the
// button is clicked.
//
// Mocked session + mocked API, same technique as wizmatch-gate-a-local.spec.ts
// — no real backend needed. Run via:
//   npx playwright test --config=playwright.wizmatch-local.config.ts tenant-branding-email-templates-local

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
}

async function setup(page: Page, opts: { slug: string; storagePrefix: string; branding: Record<string, unknown> }) {
  const { slug, storagePrefix, branding } = opts;
  await page.addInitScript(({ slug, storagePrefix, branding }) => {
    localStorage.setItem('crm_active_tenant_slug', slug);
    localStorage.setItem(`${storagePrefix}_token`, 'local-tenant-branding-token');
    localStorage.setItem(`${storagePrefix}_user`, JSON.stringify({ id: 'user-1', name: 'Local Admin', email: 'admin@example.test', role: 'admin', tenantSlug: slug }));
    localStorage.setItem(`${storagePrefix}_permissions`, JSON.stringify({}));
    // Pre-seeded, same shape/key setTenantBranding() writes — simulates a
    // returning tenant whose branding was already cached last session.
    localStorage.setItem(`${storagePrefix}_branding`, JSON.stringify(branding));
  }, { slug, storagePrefix, branding });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/tenant-branding') return json(route, { branding });
    if (path === '/api/email-templates') return json(route, []);
    return json(route, {});
  });
}

test.describe('NewTemplateModal — tenant-branded "From name" default', () => {
  test('a non-GE tenant gets its OWN displayName, never "Jatin from Growth Escalators"', async ({ page }) => {
    await setup(page, {
      slug: 'acme-media', storagePrefix: 'crm_acme_media',
      branding: { displayName: 'Acme Media', logoUrl: null, primaryColor: '#334155', accentColor: '#64748b', faviconUrl: null, supportEmail: null },
    });
    await page.goto('/emails?tenant=acme-media');
    await expect(page.getByRole('heading', { name: 'Email Templates' })).toBeVisible();

    await page.getByRole('button', { name: 'New' }).click();
    const fromName = page.getByLabel('From name');
    await expect(fromName).toHaveValue('Acme Media Team');
    await expect(fromName).not.toHaveValue(/Jatin/);
    await expect(fromName).not.toHaveValue(/Growth Escalators/);
  });

  test("GE's own tenant renders its own real (now-seeded) displayName, not a personal name", async ({ page }) => {
    await setup(page, {
      slug: 'growth-escalators', storagePrefix: 'ge_crm',
      branding: { displayName: 'Growth Escalators', logoUrl: '/ge-mark.png', primaryColor: '#1A3A5C', accentColor: '#F97316', faviconUrl: '/favicon.svg', supportEmail: 'billing@example-ge.test' },
    });
    await page.goto('/emails?tenant=growth-escalators');
    await expect(page.getByRole('heading', { name: 'Email Templates' })).toBeVisible();

    await page.getByRole('button', { name: 'New' }).click();
    const fromName = page.getByLabel('From name');
    await expect(fromName).toHaveValue('Growth Escalators Team');
    await expect(fromName).not.toHaveValue(/Jatin/);
  });
});

test.describe('SendTestModal — tenant-branded "Send to" default', () => {
  const oneTemplate = [{ id: 't1', name: 'welcome', displayName: 'Welcome Email', type: 'sequence', subject: 'Welcome!', fromName: '', bodyText: 'Hi {{firstName}}', bodyHtml: '', brevoSynced: false, sentCount: 0 }];

  test("a non-GE tenant's own configured support email is prefilled, never a hardcoded personal inbox", async ({ page }) => {
    await setup(page, {
      slug: 'acme-media', storagePrefix: 'crm_acme_media',
      branding: { displayName: 'Acme Media', logoUrl: null, primaryColor: '#334155', accentColor: '#64748b', faviconUrl: null, supportEmail: 'support@acme-media.example' },
    });
    await page.route('**/api/email-templates', route => json(route, oneTemplate));
    await page.goto('/emails?tenant=acme-media');

    await page.getByText('Welcome Email').click();
    await page.getByRole('button', { name: 'Send test' }).click();
    const toEmail = page.getByLabel('Send test email to');
    await expect(toEmail).toHaveValue('support@acme-media.example');
    await expect(toEmail).not.toHaveValue(/@growthescalators\.com/);
  });

  test('falls back to a blank field — never a hardcoded personal inbox — when the tenant has no support email configured', async ({ page }) => {
    await setup(page, {
      slug: 'acme-media', storagePrefix: 'crm_acme_media',
      branding: { displayName: 'Acme Media', logoUrl: null, primaryColor: '#334155', accentColor: '#64748b', faviconUrl: null, supportEmail: null },
    });
    await page.route('**/api/email-templates', route => json(route, oneTemplate));
    await page.goto('/emails?tenant=acme-media');

    await page.getByText('Welcome Email').click();
    await page.getByRole('button', { name: 'Send test' }).click();
    await expect(page.getByLabel('Send test email to')).toHaveValue('');
  });

  test("GE's own tenant renders its own real (now-seeded) support email unchanged", async ({ page }) => {
    await setup(page, {
      slug: 'growth-escalators', storagePrefix: 'ge_crm',
      branding: { displayName: 'Growth Escalators', logoUrl: '/ge-mark.png', primaryColor: '#1A3A5C', accentColor: '#F97316', faviconUrl: '/favicon.svg', supportEmail: 'billing@example-ge.test' },
    });
    await page.route('**/api/email-templates', route => json(route, oneTemplate));
    await page.goto('/emails?tenant=growth-escalators');

    await page.getByText('Welcome Email').click();
    await page.getByRole('button', { name: 'Send test' }).click();
    await expect(page.getByLabel('Send test email to')).toHaveValue('billing@example-ge.test');
  });
});
