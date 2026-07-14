import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractKeywords, pollAshby, pollGreenhouse, pollLever } from '../services/wizmatchAtsPoller';
import { buildTheirStackQuery, fetchTheirStackPreview, parseTheirStackHiringTeam, previewTheirStackImport, validateTheirStackAccount } from '../services/wizmatchTheirStackImporter';
import { buildRequirementXraySearch, buildReviewedRequirementXraySearch } from '../services/wizmatchXrayScraper';
import { assertSearchApiAllowance, buildPocSearchQuery, classifyPocResult, searchPublicWeb, validateSearchApiAccount } from '../services/wizmatchSearchApi';
import {
  getWizmatchSourcingConfig,
  ingestWizmatchSignals,
  isAuditOnlyRequirementTitle,
} from '../services/wizmatchSourcing';

describe('results-first sourcing controls', () => {
  const base = { WIZMATCH_TENANT_ID: 'tenant', DISABLE_BACKGROUND_JOBS: 'false' } as NodeJS.ProcessEnv;

  it('keeps every source independently default-off', () => {
    expect(getWizmatchSourcingConfig(base)).toMatchObject({
      masterEnabled: false,
      theirstackEnabled: false,
      atsEnabled: false,
      xrayEnabled: false,
      pocDiscoveryEnabled: false,
    });
  });

  it('activates only requested and configured providers', () => {
    const config = getWizmatchSourcingConfig({
      ...base,
      WIZMATCH_SOURCE_AUTOMATION_ENABLED: 'true',
      WIZMATCH_THEIRSTACK_IMPORT_ENABLED: 'true',
      THEIRSTACK_API_KEY: 'present',
      WIZMATCH_POC_DISCOVERY_ENABLED: 'true',
    });
    expect(config).toMatchObject({ masterEnabled: true, theirstackEnabled: true, atsEnabled: false, xrayEnabled: false, pocDiscoveryEnabled: true });
  });

  it('caps pilot quotas', () => {
    const config = getWizmatchSourcingConfig({
      ...base,
      WIZMATCH_SOURCE_AUTOMATION_ENABLED: 'true',
      WIZMATCH_THEIRSTACK_LIMIT: '999',
      WIZMATCH_SEARCHAPI_DAILY_CAP: '999',
      WIZMATCH_SEARCHAPI_MONTHLY_CAP: '999',
    });
    expect(config.theirstackLimit).toBe(25);
    expect(config.xrayDailyCap).toBe(5);
    expect(config.xrayMonthlyCap).toBe(80);
  });

  it('excludes retained audit-only requirements from operating queues', () => {
    expect(isAuditOnlyRequirementTitle('ZZ AUDIT TEST - Backend (DELETE ME)')).toBe(true);
    expect(isAuditOnlyRequirementTitle('SAP ABAP Consultant')).toBe(false);
  });
});

describe('shared signal ingestion', () => {
  it('rejects incomplete rows and counts provider duplicates without inserting again', async () => {
    const calls: string[] = [];
    const db = {
      async query(sql: string) {
        calls.push(sql);
        if (sql.includes('INSERT INTO wizmatch_companies')) return { rows: [{ id: 'company-1' }] };
        if (sql.includes('UPDATE wizmatch_job_signals')) return { rows: [{ id: 'signal-1' }] };
        return { rows: [] };
      },
    };
    const result = await ingestWizmatchSignals('tenant', [
      { job_title: '', source: 'theirstack' },
      { job_title: 'SAP ABAP Consultant', source: 'theirstack', provider_id: 'job-1', company_name: 'Company A', location: 'Pune' },
    ], db);
    expect(result).toEqual({ inserted: 0, updated: 1, duplicates: 1, rejected: 1, errors: 0 });
    expect(calls.some((sql) => sql.includes('INSERT INTO wizmatch_job_signals'))).toBe(false);
  });
});

describe('TheirStack pilot query', () => {
  it('uses the reviewed India specializations and incremental cursor', () => {
    expect(buildTheirStackQuery(15, '2026-07-01T00:00:00.000Z')).toMatchObject({
      limit: 15,
      job_country_code_or: ['IN'],
      discovered_at_gte: '2026-07-01T00:00:00.000Z',
    });
    expect(buildTheirStackQuery(15).job_title_or).toContain('sap abap');
    expect(buildTheirStackQuery(15, null, true)).toMatchObject({ blur_company_data: true });
    expect(buildTheirStackQuery(15, null, false, [1, 2])).toMatchObject({ job_id_not: [1, 2] });
  });

  it('reports configuration without exposing the key', () => {
    const preview = previewTheirStackImport({
      WIZMATCH_TENANT_ID: 'tenant', DISABLE_BACKGROUND_JOBS: 'false', WIZMATCH_SOURCE_AUTOMATION_ENABLED: 'true',
      WIZMATCH_THEIRSTACK_IMPORT_ENABLED: 'true', THEIRSTACK_API_KEY: 'secret',
    } as NodeJS.ProcessEnv);
    expect(preview).toMatchObject({ enabled: true, configured: true, limit: 15 });
    expect(JSON.stringify(preview)).not.toContain('secret');
  });

  it('parses optional hiring-team evidence without inventing channels', () => {
    expect(parseTheirStackHiringTeam([{ full_name: 'Person A', job_title: 'Talent Acquisition', linkedin_url: 'https://linkedin.com/in/person-a' }]))
      .toEqual([{ name: 'Person A', title: 'Talent Acquisition', linkedinUrl: 'https://linkedin.com/in/person-a', email: null }]);
    expect(parseTheirStackHiringTeam([{ name: '' }, null])).toEqual([]);
  });

  it('uses free preview mode and sanitizes provider failures', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({ data: [{ id: 'job-1', job_title: 'SAP ABAP', hiring_team: [{ name: 'Person A', title: 'Recruiter' }] }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const preview = await fetchTheirStackPreview({ THEIRSTACK_API_KEY: 'secret' } as NodeJS.ProcessEnv);
    expect(preview).toMatchObject({ preview: true, fetched: 1 });
    expect(JSON.stringify(preview)).not.toContain('secret');
    const request = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(request.blur_company_data).toBe(true);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 402 });
    const account = await validateTheirStackAccount({ THEIRSTACK_API_KEY: 'secret' } as NodeJS.ProcessEnv);
    expect(account).toMatchObject({ configured: true, validated: false, error: 'TheirStack HTTP 402' });
    expect(JSON.stringify(account)).not.toContain('secret');
  });
});

describe('SearchAPI public research', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes Google results and never exposes the credential', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ organic_results: [{ position: 1, title: 'Person A - Talent Acquisition', link: 'https://linkedin.com/in/person-a', snippet: 'Recruiter at Company A' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    const results = await searchPublicWeb('query', { env: { SEARCHAPI_API_KEY: 'secret' } as NodeJS.ProcessEnv });
    expect(results[0]).toMatchObject({ position: 1, link: 'https://linkedin.com/in/person-a' });
    expect(JSON.stringify(results)).not.toContain('secret');
    expect(String(fetchMock.mock.calls[0][0])).not.toContain('secret');
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer secret');
  });

  it.each([401, 402, 429, 500])('returns a safe HTTP %s error', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status }));
    await expect(searchPublicWeb('query', { env: { SEARCHAPI_API_KEY: 'secret' } as NodeJS.ProcessEnv })).rejects.toThrow(`SearchAPI HTTP ${status}`);
  });

  it('retries one transient timeout and then returns normalized results', async () => {
    const timeout = new Error('The operation was aborted due to timeout');
    timeout.name = 'TimeoutError';
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(timeout)
      .mockResolvedValueOnce({ ok: true, json: async () => ({ organic_results: [{ title: 'Person A - Recruiter', link: 'https://linkedin.com/in/a', snippet: 'Recruiter' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    expect(await searchPublicWeb('query', { env: { SEARCHAPI_API_KEY: 'secret' } as NodeJS.ProcessEnv })).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('reports account allowance and enforces the shared POC/X-Ray cap', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account: { current_month_usage: 21, monthly_allowance: 100, remaining_credits: 79 } }) }));
    expect(await validateSearchApiAccount({ SEARCHAPI_API_KEY: 'secret' } as NodeJS.ProcessEnv)).toMatchObject({ validated: true, usage: 21, allowance: 100, remaining: 79 });
    expect(() => assertSearchApiAllowance({ daily: 5, monthly: 10 }, { daily: 5, monthly: 80 })).toThrow('Daily SearchAPI allowance reached');
    expect(() => assertSearchApiAllowance({ daily: 1, monthly: 80 }, { daily: 5, monthly: 80 })).toThrow('Monthly SearchAPI allowance reached');
  });

  it('treats free credits as the effective allowance when the plan allowance is zero', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ account: { current_month_usage: 0, monthly_allowance: 0, remaining_credits: 100 } }) }));
    expect(await validateSearchApiAccount({ SEARCHAPI_API_KEY: 'secret' } as NodeJS.ProcessEnv)).toMatchObject({ usage: 0, allowance: 100, remaining: 100 });
  });

  it('builds one company POC query and classifies public evidence only', () => {
    expect(buildPocSearchQuery('Company A', 'company.example')).toContain('site:company.example');
    expect(classifyPocResult({ position: 1, title: 'Person A - Talent Acquisition', link: 'https://linkedin.com/in/a', snippet: 'Recruiter' }))
      .toMatchObject({ category: 'talent_acquisition', name: 'Person A' });
    expect(classifyPocResult({ position: 1, title: 'Careers', link: 'https://example.com', snippet: 'Jobs' })).toEqual({ category: null, name: null });
  });
});

describe('ATS provider contracts', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('normalizes Greenhouse, Lever, and Ashby public fixtures', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jobs: [{ id: 1, title: 'SAP ABAP Consultant', absolute_url: 'https://gh/job/1', updated_at: '2026-07-01', location: { name: 'Pune' }, departments: [], metadata: [] }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 'lever-1', text: 'Java Backend Developer', hostedUrl: 'https://lever/job/1', createdAt: 1_700_000_000_000, categories: { location: 'Bengaluru', team: 'Engineering', commitment: 'Full-time' } }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ jobs: [{ id: 'ashby-1', title: 'JavaScript Frontend Developer', location: 'Remote India', jobUrl: 'https://ashby/job/1', postedAt: '2026-07-01', employmentType: 'Full-time' }] }) });
    vi.stubGlobal('fetch', fetchMock);
    expect((await pollGreenhouse('company'))[0]).toMatchObject({ provider_id: '1', source: 'greenhouse', location: 'Pune' });
    expect((await pollLever('company'))[0]).toMatchObject({ provider_id: 'lever-1', source: 'lever', employment_type: 'FTE' });
    expect((await pollAshby('company'))[0]).toMatchObject({ provider_id: 'ashby-1', source: 'ashby' });
  });

  it('surfaces provider status errors and preserves specialization keywords', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }));
    await expect(pollLever('limited')).rejects.toThrow('Lever API 429');
    expect(extractKeywords('SAP FICO Consultant', '')).toContain('sap fico');
    expect(extractKeywords('JavaScript Frontend Developer', '')).toContain('javascript');
  });
});

describe('requirement-first LinkedIn X-Ray', () => {
  it('keeps SAP and Java specializations in the generated public search evidence', () => {
    expect(buildRequirementXraySearch('SAP ABAP', 'Pune').q).toContain('"SAP ABAP developer"');
    expect(buildRequirementXraySearch('Java', 'Bengaluru').q).toContain('"Java developer"');
    expect(buildRequirementXraySearch('JavaScript', 'India').skills).toEqual(['javascript']);
  });

  it('uses all reviewed requirement evidence in one capped query', () => {
    const search = buildReviewedRequirementXraySearch({ mandatorySkills: ['SAP ABAP'], preferredSkills: ['S/4HANA'], location: 'Pune', workMode: 'hybrid', minExperience: 5 });
    expect(search.q).toContain('"SAP ABAP"');
    expect(search.q).toContain('"S/4HANA"');
    expect(search.q).toContain('"5+ years"');
    expect(search.skills).toEqual(['sap abap', 's/4hana']);
  });
});
