import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  testMatch: ['wizmatch-qa-a11y-verify.spec.ts'],
  workers: 1, retries: 0, reporter: 'line', timeout: 60_000,
  use: { baseURL: 'http://127.0.0.1:5186', trace: 'off', screenshot: 'off' },
  webServer: {
    command: 'npm --prefix admin run dev -- --host 127.0.0.1 --port 5186 --strictPort',
    url: 'http://127.0.0.1:5186', reuseExistingServer: false, timeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
