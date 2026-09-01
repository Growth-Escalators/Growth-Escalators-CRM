import { defineConfig } from 'vitest/config';

// L2 (Fable review) — coverage had no floor at all, so it could silently
// regress. Thresholds are set a few points under the actual repo-wide
// numbers as of 2026-07-17 (~37% statements/branches/lines, ~39%
// functions) — a floor against backsliding, not a target. Raise these as
// real coverage grows; don't lower them to make a red run green.
/**
 * Renamed from vitest.config.ts to .mts.
 *
 * package.json is "type": "commonjs", so a .ts config is loaded through
 * require(). vitest 4 pulls in std-env 4, which is ESM-only, and the require()
 * throws ERR_REQUIRE_ESM before any test runs — the whole suite is unrunnable.
 * The .mts extension forces the config to load as ESM.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // admin/src/lib/**/__tests__ — pure-logic frontend tests (no JSX, no
    // DOM rendering) for admin SPA modules like lib/auth.js. These only
    // touch `window.location`/`localStorage` as plain globals the test
    // stubs itself, so the existing 'node' environment is sufficient; no
    // jsdom/testing-library dependency needed for this.
    include: [
      'src/__tests__/**/*.test.ts',
      'src/__tests__/**/*.test.js',
      'admin/src/**/__tests__/**/*.test.js',
    ],
    // WizMatch is retired. These suites asserted the old live HTTP/mount
    // contract and are intentionally superseded by wizmatchRetirementRoutes,
    // wizmatchRouteRegistry and wizmatchTelemetryRegistry retirement tests.
    // Pure service/domain tests remain enabled until those dead modules are
    // physically removed in the follow-up cleanup.
    exclude: [
      'src/__tests__/wizmatchBulkActionRoutes.test.ts',
      'src/__tests__/wizmatchClientDiscoverySignalsPolicy.test.ts',
      'src/__tests__/wizmatchContactIntelligenceRoutes.test.ts',
      'src/__tests__/wizmatchIndexMountOrder.test.ts',
      'src/__tests__/wizmatchMachineSyncLaneMountIntegration.test.ts',
      'src/__tests__/wizmatchOutreachRoutes.test.ts',
      'src/__tests__/wizmatchPilotGateOnOutreachRouter.test.ts',
      'src/__tests__/wizmatchPolicyRoutes.test.ts',
      'src/__tests__/wizmatchPrepareRoutes.test.ts',
      'src/__tests__/wizmatchQueuePaging.test.ts',
      'src/__tests__/wizmatchRequirementDelete.test.ts',
      'src/__tests__/wizmatchRequirementScopeBlock.test.ts',
      'src/__tests__/wizmatchRequirementsFilters.test.ts',
      'src/__tests__/wizmatchStaffingAccessRoute.test.ts',
      'src/__tests__/wizmatchStaffingRoutes.test.ts',
      'src/__tests__/wizmatchTelemetryRoutes.test.ts',
      'src/__tests__/wizmatchTodayQueueCapabilityDispatch.test.ts',
      'src/__tests__/wizmatchTodayRoutes.test.ts',
    ],
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
