import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: [
    'wizmatch-phase0-local.spec.ts',
    'wizmatch-gate-a-local.spec.ts',
    'wizmatch-gate-bc-local.spec.ts',
    'wizmatch-sourcing-local.spec.ts',
    'wizmatch-entity-first-local.spec.ts',
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
  },
  webServer: {
    command: 'npm --prefix admin run dev -- --host 127.0.0.1 --port 5184 --strictPort',
    url: 'http://127.0.0.1:5184',
    reuseExistingServer: false,
    timeout: 30_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
