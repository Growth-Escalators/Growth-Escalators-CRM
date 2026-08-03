import { defineConfig, devices } from '@playwright/test';

// Session capture ONLY. Kept separate from playwright.walkthrough.config.ts so
// that the walkthrough contains no code path capable of POSTing /auth/login.
//
// trace/video/screenshot are all OFF on purpose: the owner types a real password
// into this window, and a Playwright trace serialises input values and request
// headers. There is nothing to debug here that is worth recording a credential.
export default defineConfig({
  testDir: './e2e/walkthrough',
  testMatch: /capture-session\.setup\.ts$/,
  workers: 1,
  retries: 0,
  timeout: 5 * 60_000,
  reporter: [['list']],
  outputDir: '/private/tmp/claude-501/-Users-jatinagrawal-repo-comparison-v2-outbound-os/a77499a3-6530-49b9-b287-2202ac7753e3/scratchpad/walkthrough/session-artifacts',
  use: {
    ...devices['Desktop Chrome'],
    headless: false,
    viewport: { width: 1440, height: 900 },
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
});
