import { defineConfig, devices } from '@playwright/test';
import { existsSync } from 'node:fs';

// Live owner walkthrough. Deliberately the OPPOSITE of playwright.config.ts,
// which defaults baseURL to production and has no testMatch — so a bare
// `npx playwright test` there runs all 27 specs against live prod.
//
// Here: no default target, a second key required for production, and a testMatch
// narrow enough that none of those 27 specs can ever be in scope.

const BASE = process.env.WALKTHROUGH_BASE_URL;
if (!BASE) {
  throw new Error('WALKTHROUGH_BASE_URL is required — this config has no default target, by design.');
}

const host = new URL(BASE).hostname;
const PROD_HOSTS = ['crm.growthescalators.com', 'api.growthescalators.com'];
if (PROD_HOSTS.includes(host) && process.env.WALKTHROUGH_CONFIRM_PROD !== 'read-only') {
  throw new Error(
    `refusing to target production (${host}) without WALKTHROUGH_CONFIRM_PROD=read-only. `
    + 'Pointing at prod must be a deliberate two-key action, never a default.',
  );
}

const STATE = process.env.WALKTHROUGH_STORAGE_STATE;
if (!STATE || !existsSync(STATE)) {
  throw new Error(`WALKTHROUGH_STORAGE_STATE missing or unreadable (${STATE ?? 'unset'}) — run the session capture first.`);
}

// eslint-disable-next-line no-console
console.log(`\n  walkthrough target: ${BASE}  (read-only harness)\n`);

export default defineConfig({
  testDir: './e2e/walkthrough',
  testMatch: /.*\.walkthrough\.ts$/,
  workers: 1,
  fullyParallel: false,
  retries: 0, // a retry would re-walk production
  timeout: 180_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: '/private/tmp/claude-501/-Users-jatinagrawal-repo-comparison-v2-outbound-os/a77499a3-6530-49b9-b287-2202ac7753e3/scratchpad/walkthrough/run.json' }]],
  outputDir: '/private/tmp/claude-501/-Users-jatinagrawal-repo-comparison-v2-outbound-os/a77499a3-6530-49b9-b287-2202ac7753e3/scratchpad/walkthrough/artifacts',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: BASE,
    storageState: STATE,
    headless: process.env.WALKTHROUGH_HEADLESS === '1',
    launchOptions: { slowMo: Number(process.env.WALKTHROUGH_SLOWMO || 250) },
    viewport: { width: 1440, height: 900 },
    // trace OFF: traces embed the Authorization: Bearer header, which would turn
    // an artifact into a credential. Video carries no headers.
    trace: 'off',
    video: 'on',
    screenshot: 'on',
    navigationTimeout: 45_000,
    actionTimeout: 15_000,
  },
});
