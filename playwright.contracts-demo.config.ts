import { defineConfig, devices } from '@playwright/test';

// Visual walkthrough of the Contracts / e-signature feature. Same harness as
// playwright.contracts-local.config.ts (admin Vite on :5184, backend on :3000),
// but runs only the demo spec, which captures step-by-step screenshots and the
// generated contract PDF into docs/esign/demo/. Drive via:
//   E2E_CONFIG=playwright.contracts-demo.config.ts bash scripts/run-contracts-e2e.sh
export default defineConfig({
  testDir: './e2e',
  testMatch: ['contracts-demo.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 90_000,
  use: {
    baseURL: 'http://127.0.0.1:5184',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: 'npm --prefix admin run dev -- --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  projects: [{ name: 'chromium-desktop', use: { ...devices['Desktop Chrome'] } }],
});
