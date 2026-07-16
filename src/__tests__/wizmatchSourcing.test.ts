import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractKeywords, pollAshby, pollGreenhouse, pollLever } from '../services/wizmatchAtsPoller';
import { buildTheirStackQuery, fetchTheirStackPreview, parseTheirStackHiringTeam, previewTheirStackImport, validateTheirStackAccount } from '../services/wizmatchTheirStackImporter';
import { buildRequirementXraySearch, buildReviewedRequirementXraySearch, capLinkedInProfileResults, normalizeLinkedInProfileUrl, normalizeXrayResultLimit } from '../services/wizmatchXrayScraper';
import { assertSearchApiAllowance, buildPocSearchQuery, classifyPocResult, SearchApiRequestError, searchPublicWeb, validateSearchApiAccount } from '../services/wizmatchSearchApi';
import {
  capPocCandidates,
  describePocDiscoveryFailure,
  getWizmatchSourcingConfig,
  ingestWizmatchSignals,
  isAuditOnlyRequirementTitle,
} from '../services/wizmatchSourcing';
import { extractCanonicalSkillKeywords } from '../services/wizmatchSkillExtraction';

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

  it('supports a single bounded POC attempt and exposes only sanitized retry metadata', async () => {
    const timeout = new Error('request contained secret-value and timed out');
    timeout.name = 'TimeoutError';
    const fetchMock = vi.fn().mockRejectedValue(timeout);
    vi.stubGlobal('fetch', fetchMock);
    const error = await searchPublicWeb('query', {
      env: { SEARCHAPI_API_KEY: 'secret-value' } as NodeJS.ProcessEnv,
      count: 3,
      timeoutMs: 15_000,
      maxAttempts: 1,
    }).catch((caught) => caught);
    expect(error).toBeInstanceOf(SearchApiRequestError);
    expect(error).toMatchObject({ code: 'provider_timeout', retryable: true, retryAfterSeconds: 600 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const publicFailure = describePocDiscoveryFailure(error);
    expect(publicFailure).toMatchObject({ status: 504, code: 'provider_timeout', retryable: true, retryAfterSeconds: 600 });
    expect(JSON.stringify(publicFailure)).not.toContain('secret-value');
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

  it('uses longest canonical phrases and word boundaries instead of substring noise', () => {
    expect(extractKeywords('SAP ABAP Consultant', 'Build integrations')).toEqual(['sap abap']);
    expect(extractKeywords('SAP ABAP Consultant', 'Build SAP integrations')).toEqual(['sap abap']);
    expect(extractKeywords('SAP FICO Consultant', '')).toEqual(['sap fico']);
    expect(extractKeywords('JavaScript Frontend Developer', '')).toEqual(expect.arrayContaining(['javascript', 'frontend']));
    expect(extractKeywords('JavaScript Frontend Developer', '')).not.toContain('java');
    expect(extractKeywords('We are ready to go', 'rapid AI adoption and trust')).not.toContain('go');
    expect(extractKeywords('We are ready to go', 'rapid AI adoption and trust')).not.toContain('ai');
    expect(extractKeywords('We are ready to go', 'rapid AI adoption and trust')).not.toContain('rust');
    expect(extractKeywords('Go Developer', '')).toContain('go');
    expect(extractCanonicalSkillKeywords('JavaScript engineer with SAP FICO experience')).toEqual(expect.arrayContaining(['javascript', 'sap fico']));
    expect(extractCanonicalSkillKeywords('JavaScript engineer with SAP FICO experience')).not.toEqual(expect.arrayContaining(['java', 'sap']));
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

  it('defaults to three candidate leads, validates the authorized cap and deduplicates profile URLs', () => {
    expect(normalizeXrayResultLimit()).toBe(3);
    expect(normalizeXrayResultLimit(10)).toBe(10);
    expect(() => normalizeXrayResultLimit(0)).toThrow(/1 to 10/);
    expect(normalizeLinkedInProfileUrl('https://in.linkedin.com/in/person-a/?trk=public')).toBe('https://www.linkedin.com/in/person-a');
    const results = capLinkedInProfileResults([
      { position: 1, title: 'A', link: 'https://linkedin.com/in/a?trk=1', snippet: '' },
      { position: 2, title: 'A duplicate', link: 'https://www.linkedin.com/in/a/', snippet: '' },
      { position: 3, title: 'B', link: 'https://linkedin.com/in/b', snippet: '' },
      { position: 4, title: 'C', link: 'https://linkedin.com/in/c', snippet: '' },
      { position: 5, title: 'Not a profile', link: 'https://example.com/a', snippet: '' },
    ], 3);
    expect(results.map((item) => item.link)).toEqual([
      'https://www.linkedin.com/in/a',
      'https://www.linkedin.com/in/b',
      'https://www.linkedin.com/in/c',
    ]);
  });
});

describe('POC result cap', () => {
  it('keeps at most three unique named candidates ahead of generic contacts', () => {
    const candidates = capPocCandidates([
      { name: 'Generic HR', title: 'Contact', email: 'hr@example.com', raw: { roleCategory: 'generic' } },
      { name: 'Person A', title: 'Talent Acquisition', linkedinUrl: 'https://linkedin.com/in/a', raw: { roleCategory: 'talent_acquisition' } },
      { name: 'Person A', title: 'Talent Acquisition', linkedinUrl: 'https://linkedin.com/in/a', raw: { roleCategory: 'talent_acquisition' } },
      { name: 'Person B', title: 'Hiring Manager', linkedinUrl: 'https://linkedin.com/in/b', raw: { roleCategory: 'hiring_delivery_manager' } },
      { name: 'Person C', title: 'Recruiter', linkedinUrl: 'https://linkedin.com/in/c', raw: { roleCategory: 'talent_acquisition' } },
    ]);
    expect(candidates).toHaveLength(3);
    expect(candidates.map((candidate) => candidate.name)).toEqual(['Person A', 'Person B', 'Person C']);
  });
});
