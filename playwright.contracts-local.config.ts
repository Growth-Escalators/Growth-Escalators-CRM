import { defineConfig, devices } from '@playwright/test';

// Contracts / e-signature E2E. Mirrors playwright.wizmatch-local.config.ts:
// Playwright boots ONLY the admin Vite dev server on :5184 (which proxies
// /api + /auth to the backend on :3000). The backend must already be running
// on :3000 against the seeded wizmatch_e2e_test DB with ESIGN_PROVIDER=mock,
// CONTRACTS_STORAGE=local, ESIGN_MOCK_AUTOSIGN=1 — scripts/run-contracts-e2e.sh
// sets all of this up. The spec self-skips when E2E_PASSWORD is unset.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['contracts.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 45_000,
  use: {
    baseURL: 'http://127.0.0.1:5184',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm --prefix admin run dev -- --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
