import { defineConfig, devices } from '@playwright/test';

// QA lane 3 (2026-07-30) — dedicated config for this lane's NEW spec files
// only. Does not modify playwright.wizmatch-local.config.ts. Uses port 5185
// (not 5184) so it can run without colliding with a concurrently-running
// wizmatch-local suite from another lane/session.
//
// Mocked-session specs need no backend. The wizmatch-qa-real-backend-*.spec.ts
// files (added for Phase 2) require the real API on http://localhost:3000 —
// see docs/testing/WIZMATCH_E2E_HARDENING_REPORT.md for the local env vars,
// and lane3-playwright.md for this lane's exact fixture/env expectations.
export default defineConfig({
  testDir: './e2e',
  testMatch: ['wizmatch-qa-*.spec.ts'],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 30_000,
  use: {
    baseURL: 'http://127.0.0.1:5185',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm --prefix admin run dev -- --host 127.0.0.1 --port 5185 --strictPort',
    url: 'http://127.0.0.1:5185',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium-desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'chromium-tablet',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 } },
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
    },
    {
      name: 'firefox-desktop',
      use: { ...devices['Desktop Firefox'], viewport: { width: 1440, height: 900 } },
    },
    {
      name: 'webkit-desktop',
      use: { ...devices['Desktop Safari'], viewport: { width: 1440, height: 900 } },
    },
  ],
});
