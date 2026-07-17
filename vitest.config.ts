import { defineConfig } from 'vitest/config';

// L2 (Fable review) — coverage had no floor at all, so it could silently
// regress. Thresholds are set a few points under the actual repo-wide
// numbers as of 2026-07-17 (~37% statements/branches/lines, ~39%
// functions) — a floor against backsliding, not a target. Raise these as
// real coverage grows; don't lower them to make a red run green.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary'],
      exclude: [
        '**/src/__tests__/**',
        // Side-effect-heavy entrypoints (cron registration, server boot) —
        // this session's own pattern is to pull testable logic out into
        // services/ rather than import these directly in tests, so their
        // per-file coverage sits near 0% by design, not by neglect.
        '**/src/index.ts',
        '**/src/worker.ts',
        '**/src/scripts/**',
        '**/src/db/migrations/**',
        '**/src/db/seed.ts',
        '**/*.d.ts',
        '**/vitest.config.ts',
      ],
      thresholds: {
        statements: 30,
        branches: 30,
        functions: 30,
        lines: 30,
      },
    },
  },
});
