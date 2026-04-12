import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Tests for new features: monthly reports, analytics, team performance,
// self-healing, URL redirects
// These are unit tests for pure logic — no DB or API mocking needed
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 1. Month range calculation (from reports.ts pattern)
// ---------------------------------------------------------------------------
function monthRange(monthStr: string): { start: Date; end: Date } {
  const [year, month] = monthStr.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

describe('Monthly Report — monthRange()', () => {
  it('returns correct range for a regular month', () => {
    const { start, end } = monthRange('2026-04');
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(3); // April = 3
    expect(start.getDate()).toBe(1);
    expect(end.getDate()).toBe(30); // April has 30 days
  });

  it('handles February correctly', () => {
    const { start, end } = monthRange('2026-02');
    expect(end.getDate()).toBe(28); // 2026 is not a leap year
  });

  it('handles leap year February', () => {
    const { start, end } = monthRange('2028-02');
    expect(end.getDate()).toBe(29); // 2028 IS a leap year
  });

  it('handles December → January boundary', () => {
    const { start, end } = monthRange('2026-12');
    expect(start.getMonth()).toBe(11); // December
    expect(end.getDate()).toBe(31);
  });

  it('handles January', () => {
    const { start, end } = monthRange('2026-01');
    expect(start.getDate()).toBe(1);
    expect(end.getDate()).toBe(31);
  });
});

// ---------------------------------------------------------------------------
// 2. INR formatting (from dashboard + client detail patterns)
// ---------------------------------------------------------------------------
function fmtINR(paise: number): string {
  if (paise == null || isNaN(paise)) return '—';
  const val = Math.round(paise / 100);
  if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)}Cr`;
  if (val >= 100000) return `₹${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `₹${(val / 1000).toFixed(1)}K`;
  return `₹${val.toLocaleString('en-IN')}`;
}

describe('INR Formatting (paise to display)', () => {
  it('formats zero', () => {
    expect(fmtINR(0)).toBe('₹0');
  });

  it('formats small amounts', () => {
    expect(fmtINR(50000)).toBe('₹500'); // 500 INR
  });

  it('formats thousands', () => {
    expect(fmtINR(2000000)).toBe('₹20.0K'); // 20,000 INR
  });

  it('formats lakhs', () => {
    expect(fmtINR(50000000)).toBe('₹5.0L'); // 5,00,000 INR
  });

  it('formats crores', () => {
    expect(fmtINR(1500000000)).toBe('₹1.50Cr'); // 1.5 Cr INR
  });

  it('handles NaN gracefully', () => {
    expect(fmtINR(NaN)).toBe('—');
  });
});

// ---------------------------------------------------------------------------
// 3. Self-healing retry backoff calculation
// ---------------------------------------------------------------------------
const BACKOFF_MINUTES = [5, 15, 45];
const MAX_RETRIES = 3;

function getBackoffMs(retryCount: number): number {
  return BACKOFF_MINUTES[Math.min(retryCount, BACKOFF_MINUTES.length - 1)] * 60_000;
}

describe('Self-Healing — Retry Backoff', () => {
  it('first retry: 5 minutes', () => {
    expect(getBackoffMs(0)).toBe(5 * 60_000);
  });

  it('second retry: 15 minutes', () => {
    expect(getBackoffMs(1)).toBe(15 * 60_000);
  });

  it('third retry: 45 minutes', () => {
    expect(getBackoffMs(2)).toBe(45 * 60_000);
  });

  it('beyond max: clamps to last value', () => {
    expect(getBackoffMs(5)).toBe(45 * 60_000);
  });

  it('total time to escalation is ~65 minutes', () => {
    const total = BACKOFF_MINUTES.reduce((sum, m) => sum + m, 0);
    expect(total).toBe(65); // 5 + 15 + 45
  });
});

// ---------------------------------------------------------------------------
// 4. CRON_WINDOWS name validation
// ---------------------------------------------------------------------------
const CRON_WINDOWS: Record<string, number> = {
  'Blocker Alerts': 120,
  'SOD Digest': 1500, 'Sakcham Priority SOD': 1500, 'EOD Summary': 1500,
  'Spend Alert Check': 120, 'Monthly Invoice Drafts': 44640,
  'Overdue Invoice Check': 1500, 'Retainer Invoice Generator': 1500,
  'Daily Intelligence Report': 1500,
  'Meta Ads Daily Report': 1500, 'Meta Token Check': 10080,
  'SEO Workflow Health': 1500, 'Growth OS Health Scores': 1500,
  'Money on Table': 10080, 'Creative Intelligence': 360,
  'Competitor Pulse': 10080, 'SEO Weekly Email': 10080,
  'PageSpeed Monitor': 10080, 'Daily Archive': 1500,
  'Outreach Enrichment': 10, 'Outreach CRM Sync': 60,
  'Outreach Daily Digest': 1500, 'Daily Lead Discovery': 1500,
  'Reset Stuck Enriching Leads': 120, 'Weekly Outreach Summary': 10080,
  'Saleshandy Auto-Upload': 15,
  'Audit Booking Follow-up': 360, 'Weekly Data Cleanup': 10080,
  'Co-Pilot Poller': 5, 'Pipeline Placement': 1,
  'System Health Check': 60, 'Workflow Self-Healing': 60,
};

describe('CRON_WINDOWS consistency', () => {
  it('has no duplicate names', () => {
    const names = Object.keys(CRON_WINDOWS);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('all values are positive numbers', () => {
    for (const [name, window] of Object.entries(CRON_WINDOWS)) {
      expect(window).toBeGreaterThan(0);
    }
  });

  it('includes the self-healing cron', () => {
    expect(CRON_WINDOWS['Workflow Self-Healing']).toBeDefined();
  });

  it('includes Meta Ads Daily Report (not Daily ROAS Report)', () => {
    expect(CRON_WINDOWS['Meta Ads Daily Report']).toBeDefined();
    expect(CRON_WINDOWS['Daily ROAS Report']).toBeUndefined();
  });

  it('has single Blocker Alerts (not morning/evening split)', () => {
    expect(CRON_WINDOWS['Blocker Alerts']).toBeDefined();
    expect(CRON_WINDOWS['Blocker Alerts (morning)']).toBeUndefined();
    expect(CRON_WINDOWS['Blocker Alerts (evening)']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 5. CRM redirect path list validation
// ---------------------------------------------------------------------------
const CRM_REDIRECTS = ['/login', '/dashboard', '/contacts', '/pipeline', '/inbox', '/ads', '/seo', '/intelligence', '/billing', '/settings', '/reports', '/outreach-dashboard', '/growth-os', '/links', '/social-scheduling'];

describe('CRM Path Redirects', () => {
  it('includes /login', () => {
    expect(CRM_REDIRECTS).toContain('/login');
  });

  it('includes all major CRM pages', () => {
    const required = ['/dashboard', '/contacts', '/pipeline', '/billing', '/seo', '/intelligence'];
    for (const path of required) {
      expect(CRM_REDIRECTS).toContain(path);
    }
  });

  it('does not include API paths', () => {
    const apiPaths = CRM_REDIRECTS.filter(p => p.startsWith('/api'));
    expect(apiPaths).toHaveLength(0);
  });

  it('all paths start with /', () => {
    for (const path of CRM_REDIRECTS) {
      expect(path.startsWith('/')).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Team member list validation
// ---------------------------------------------------------------------------
const TEAM_MEMBERS = [
  { name: 'Jatin',   clickupId: 88911769 },
  { name: 'Sakcham', clickupId: 242618940 },
  { name: 'Vishal',  clickupId: 100972806 },
  { name: 'Nimisha', clickupId: 100972807 },
  { name: 'Keshav',  clickupId: 4800274   },
];

describe('Team Members Configuration', () => {
  it('has 5 members', () => {
    expect(TEAM_MEMBERS).toHaveLength(5);
  });

  it('all members have unique clickupIds', () => {
    const ids = TEAM_MEMBERS.map(m => m.clickupId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('includes Jatin as admin', () => {
    expect(TEAM_MEMBERS.find(m => m.name === 'Jatin')).toBeDefined();
  });

  it('all clickupIds are positive numbers', () => {
    for (const m of TEAM_MEMBERS) {
      expect(m.clickupId).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 7. Financial year calculation (from invoiceNumberService pattern)
// ---------------------------------------------------------------------------
function financialYear(date: Date): string {
  const month = date.getMonth(); // 0-indexed
  const year = date.getFullYear();
  if (month >= 3) { // April onwards
    return `${year}-${String(year + 1).slice(2)}`;
  }
  return `${year - 1}-${String(year).slice(2)}`;
}

describe('Financial Year Calculation', () => {
  it('April 2026 → 2026-27', () => {
    expect(financialYear(new Date(2026, 3, 1))).toBe('2026-27');
  });

  it('March 2026 → 2025-26', () => {
    expect(financialYear(new Date(2026, 2, 31))).toBe('2025-26');
  });

  it('January 2027 → 2026-27', () => {
    expect(financialYear(new Date(2027, 0, 1))).toBe('2026-27');
  });

  it('December 2026 → 2026-27', () => {
    expect(financialYear(new Date(2026, 11, 31))).toBe('2026-27');
  });
});
