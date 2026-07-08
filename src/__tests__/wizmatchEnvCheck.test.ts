import { describe, expect, it } from 'vitest';
import { buildWizmatchEnvReport, formatWizmatchEnvReport } from '../services/wizmatchEnvCheck';

describe('Wizmatch env check', () => {
  it('reports secret presence without printing secret values', () => {
    const report = buildWizmatchEnvReport({
      WIZMATCH_TENANT_ID: 'tenant-secret-value',
      WIZMATCH_INTERNAL_TOKEN: 'internal-secret-value',
      WIZMATCH_UNSUBSCRIBE_HMAC_SECRET: 'unsubscribe-secret-value',
      APOLLO_API_KEY: 'apollo-secret-value',
      PURELYMAIL_SMTP_PASS_1: 'smtp-secret-value',
    } as NodeJS.ProcessEnv);

    const output = formatWizmatchEnvReport(report);

    expect(output).toContain('WIZMATCH_TENANT_ID');
    expect(output).toContain('present');
    expect(output).not.toContain('tenant-secret-value');
    expect(output).not.toContain('internal-secret-value');
    expect(output).not.toContain('unsubscribe-secret-value');
    expect(output).not.toContain('apollo-secret-value');
    expect(output).not.toContain('smtp-secret-value');
  });

  it('accepts INTERNAL_API_TOKEN as the GitHub Actions secret alias for the internal token', () => {
    const report = buildWizmatchEnvReport({
      INTERNAL_API_TOKEN: 'github-actions-secret-value',
    } as NodeJS.ProcessEnv);

    const internalToken = report.find((entry) => entry.key === 'WIZMATCH_INTERNAL_TOKEN');

    expect(internalToken?.present).toBe(true);
    expect(internalToken?.presentKey).toBe('INTERNAL_API_TOKEN');
    expect(formatWizmatchEnvReport(report)).not.toContain('github-actions-secret-value');
  });
});
