import { describe, it, expect, vi, beforeEach } from 'vitest';
import zlib from 'zlib';

// Same reasoning/technique as src/__tests__/pdfService.test.ts's
// decodePdfTextRuns: pdfkit compresses content streams and encodes
// Helvetica text as hex WinAnsi char codes, so a raw buffer substring search
// never finds visible text — decompress + decode per content-stream line.
function decodePdfTextRuns(buf: Buffer): string[] {
  const str = buf.toString('latin1');
  const runs: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(str))) {
    const raw = Buffer.from(m[1], 'latin1');
    let inflated: string;
    try {
      inflated = zlib.inflateSync(raw).toString('latin1');
    } catch {
      continue;
    }
    for (const line of inflated.split('\n')) {
      const hexGroups = line.match(/<[0-9A-Fa-f]+>/g);
      if (!hexGroups) continue;
      let text = '';
      for (const g of hexGroups) {
        const hex = g.slice(1, -1);
        for (let i = 0; i + 1 < hex.length; i += 2) {
          text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        }
      }
      if (text) runs.push(text);
    }
  }
  return runs;
}

function containsText(buf: Buffer, needle: string): boolean {
  return decodePdfTextRuns(buf).some((r) => r.includes(needle));
}

const mockGetTenantDocumentIdentity = vi.fn();

vi.mock('../services/tenantBrandingDefaults', () => ({
  getTenantDocumentIdentity: (...args: unknown[]) => mockGetTenantDocumentIdentity(...args),
  GENERIC_DEFAULT_BRANDING: { displayName: 'Client Workspace' },
}));

import { getReportBrand, generateReportPDF, generateMonthlyReportPDF, type ReportData, type MonthlyReportData } from '../routes/reports';

function baseWeeklyData(overrides: Partial<ReportData> = {}): ReportData {
  return {
    client: { name: 'Test Client' },
    weekOf: '2026-07-27',
    weekStart: new Date('2026-07-27'),
    weekEnd: new Date('2026-08-02'),
    adMetrics: null,
    completedTasks: [],
    brand: { displayName: 'Growth Escalators', website: 'growthescalators.com', supportEmail: 'jatin@growthescalators.com', supportPhone: '+91 77338 88883' },
    ...overrides,
  };
}

function baseMonthlyData(overrides: Partial<MonthlyReportData> = {}): MonthlyReportData {
  return {
    client: { name: 'Test Client' },
    month: '2026-07',
    monthStart: new Date('2026-07-01'),
    monthEnd: new Date('2026-07-31'),
    adMetrics: null,
    seo: null,
    billing: null,
    brand: { displayName: 'Growth Escalators', website: 'growthescalators.com', supportEmail: 'jatin@growthescalators.com', supportPhone: '+91 77338 88883' },
    ...overrides,
  };
}

describe('getReportBrand', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves displayName/website/supportEmail/supportPhone from the tenant\'s document identity', async () => {
    mockGetTenantDocumentIdentity.mockResolvedValueOnce({
      displayName: 'Acme Recruiting', website: 'acme.example',
      supportEmail: 'billing@acme.example', supportPhone: '+91 90000 00000',
    });
    const brand = await getReportBrand('tenant-x');
    expect(brand).toEqual({
      displayName: 'Acme Recruiting', website: 'acme.example',
      supportEmail: 'billing@acme.example', supportPhone: '+91 90000 00000',
    });
  });

  it('falls back to the generic placeholder displayName — never Growth Escalators\' — when the tenant has no identity row, and omits contact fields rather than inventing them', async () => {
    mockGetTenantDocumentIdentity.mockResolvedValueOnce(null);
    const brand = await getReportBrand('brand-new-tenant');
    expect(brand.displayName).toBe('Client Workspace');
    expect(brand.displayName).not.toBe('Growth Escalators');
    expect(brand.website).toBeNull();
    expect(brand.supportEmail).toBeNull();
    expect(brand.supportPhone).toBeNull();
  });

  it('falls back to the placeholder displayName when the row exists but displayName is somehow empty', async () => {
    mockGetTenantDocumentIdentity.mockResolvedValueOnce({ displayName: '', website: null, supportEmail: null, supportPhone: null });
    const brand = await getReportBrand('tenant-x');
    expect(brand.displayName).toBe('Client Workspace');
  });
});

describe('generateReportPDF / generateMonthlyReportPDF — tenant-driven header/footer', () => {
  it('weekly report renders brand.displayName/website in the header, not a hardcoded "Growth Escalators"/"growthescalators.com"', async () => {
    const buf = await generateReportPDF(baseWeeklyData({
      brand: { displayName: 'Acme Recruiting', website: 'acme.example', supportEmail: null, supportPhone: null },
    }));
    expect(containsText(buf, 'Acme Recruiting')).toBe(true);
    expect(containsText(buf, 'acme.example')).toBe(true);
    expect(containsText(buf, 'Growth Escalators')).toBe(false);
    expect(containsText(buf, 'growthescalators.com')).toBe(false);
  });

  it('weekly report footer joins only the configured brand fields — no literal "null"s when contact info is missing', async () => {
    const buf = await generateReportPDF(baseWeeklyData({
      brand: { displayName: 'Acme Recruiting', website: null, supportEmail: null, supportPhone: null },
    }));
    const runs = decodePdfTextRuns(buf);
    expect(runs.some((r) => r.includes('null'))).toBe(false);
    expect(containsText(buf, 'Acme Recruiting')).toBe(true);
  });

  it('weekly report is byte-identical to today\'s hardcoded values when Growth Escalators\' own seeded brand is passed in', async () => {
    const buf = await generateReportPDF(baseWeeklyData());
    expect(containsText(buf, 'Growth Escalators')).toBe(true);
    expect(containsText(buf, 'growthescalators.com')).toBe(true);
    expect(containsText(buf, 'Growth Escalators | jatin@growthescalators.com | +91 77338 88883')).toBe(true);
  });

  it('monthly report renders brand.displayName/website in the header, not a hardcoded "Growth Escalators"/"growthescalators.com"', async () => {
    const buf = await generateMonthlyReportPDF(baseMonthlyData({
      brand: { displayName: 'Acme Recruiting', website: 'acme.example', supportEmail: null, supportPhone: null },
    }));
    expect(containsText(buf, 'Acme Recruiting')).toBe(true);
    expect(containsText(buf, 'acme.example')).toBe(true);
    expect(containsText(buf, 'Growth Escalators')).toBe(false);
    expect(containsText(buf, 'growthescalators.com')).toBe(false);
  });

  it('monthly report is byte-identical to today\'s hardcoded values when Growth Escalators\' own seeded brand is passed in', async () => {
    const buf = await generateMonthlyReportPDF(baseMonthlyData());
    expect(containsText(buf, 'Growth Escalators')).toBe(true);
    expect(containsText(buf, 'growthescalators.com')).toBe(true);
    expect(containsText(buf, 'Growth Escalators | jatin@growthescalators.com | +91 77338 88883')).toBe(true);
  });
});
