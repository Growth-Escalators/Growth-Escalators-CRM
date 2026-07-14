import { defineConfig, devices } from '@playwright/test';

// E2E hardening additions (2026-07-14) reuse this same local config rather
// than introducing a parallel one. New specs that need the REAL backend
// (contact-discovery cap proof, delete/archive proof) expect it already
// running on http://localhost:3000 — see docs/testing/WIZMATCH_E2E_HARDENING_REPORT.md
// for the exact env vars. Mocked-session specs (everything else) need no
// backend at all.
export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'wizmatch-phase0-local.spec.ts',
    'wizmatch-gate-a-local.spec.ts',
    'wizmatch-gate-bc-local.spec.ts',
    'wizmatch-sourcing-local.spec.ts',
    'wizmatch-e2e-hardening-*.spec.ts',
  ],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'line',
  timeout: 30_000,
  use: {
    // Keep the QA server isolated from a developer's existing Vite session.
    // Port 5174 is commonly occupied by the working copy being reviewed.
    baseURL: 'http://127.0.0.1:5184',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: {
    command: 'npm --prefix admin run dev -- --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184',
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
      testMatch: ['wizmatch-e2e-hardening-*.spec.ts'],
    },
    {
      name: 'chromium-mobile',
      use: { ...devices['Desktop Chrome'], viewport: { width: 390, height: 844 } },
      testMatch: ['wizmatch-e2e-hardening-*.spec.ts'],
    },
  ],
});
