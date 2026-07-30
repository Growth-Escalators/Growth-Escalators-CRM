import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Verifies the Requirements form's accessible-name fixes actually hold under axe,
// rather than trusting that the attributes were added.
const SESSION = {
  token: 'local-qa-a11y-token',
  user: { id: 'u1', name: 'QA Admin', email: 'test-admin-one@example.invalid', role: 'admin', tenantId: 't1', tenantSlug: 'wizmatch' },
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript((s) => {
    localStorage.setItem('wizmatch_crm_token', s.token);
    localStorage.setItem('wizmatch_crm_user', JSON.stringify(s.user));
    localStorage.setItem('ge_crm_token', s.token);
    localStorage.setItem('ge_crm_user', JSON.stringify(s.user));
  }, SESSION);
  // Never let a test reach a non-localhost host.
  await page.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return route.abort();
    if (u.pathname.startsWith('/api/')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, data: [], requirements: [] }) });
    }
    return route.continue();
  });
});

test('Requirements page has no serious/critical accessible-name violations', async ({ page }) => {
  await page.goto('/wizmatch/requirements');
  await page.waitForLoadState('networkidle');
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze();
  const blocking = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact ?? ''));
  const nameViolations = blocking.filter((v) =>
    ['select-name', 'input-button-name', 'button-name', 'label', 'aria-input-field-name', 'form-field-multiple-labels'].includes(v.id));
  console.log('ALL blocking:', blocking.map((v) => `${v.id}(${v.nodes.length})`).join(', ') || 'none');
  console.log('NAME-related:', nameViolations.map((v) => `${v.id}(${v.nodes.length})`).join(', ') || 'none');
  for (const v of blocking.filter((x) => x.id === 'color-contrast')) {
    for (const n of v.nodes) console.log('CONTRAST:', n.html?.slice(0, 160), '||', n.failureSummary?.split('\n').slice(0, 3).join(' '));
  }
  expect(nameViolations, JSON.stringify(nameViolations.map((v) => ({ id: v.id, n: v.nodes.length })), null, 2)).toEqual([]);
});
