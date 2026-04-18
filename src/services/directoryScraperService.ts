import { pool } from '../db/index';
import logger from '../utils/logger';

/**
 * Directory Scraper Service
 *
 * Uses Serper.dev Google Search API (already configured) to find agencies
 * from Clutch.co, GoodFirms, AgencySpotter, and Upwork job posts.
 * No Playwright/browser needed — just search API calls.
 *
 * Runs as worker cron jobs and auto-imports via insertOutreachLead().
 */

const SERPER_API_URL = 'https://google.serper.dev/search';
const SERPER_API_KEY = process.env.SERPER_API_KEY;

interface SerperResult {
  title: string;
  link: string;
  snippet: string;
  domain?: string;
}

async function serperSearch(query: string, num = 20): Promise<SerperResult[]> {
  if (!SERPER_API_KEY) return [];
  try {
    const res = await fetch(SERPER_API_URL, {
      method: 'POST',
      headers: { 'X-API-KEY': SERPER_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'us', hl: 'en', num }),
      signal: AbortSignal.timeout(15000),
    });
    // Fire-and-forget: track Serper API call count for ROI dashboard
    import('./outreachFunnelMetrics').then(m => m.incrementSerperCalls(1)).catch(() => {});
    if (!res.ok) return [];
    const data = await res.json() as { organic?: SerperResult[] };
    return data.organic ?? [];
  } catch {
    return [];
  }
}

function extractCompanyFromTitle(title: string, platform: string): string | null {
  // Clean up title patterns from directory listings
  let name = title
    .replace(/\s*[-|·–—]\s*(Clutch\.co|Clutch|GoodFirms|Agency Spotter|Sortlist|DesignRush).*$/i, '')
    .replace(/\s*[-|·–—]\s*Reviews?\s*\d*$/i, '')
    .replace(/\s*[-|·–—]\s*Company Profile$/i, '')
    .replace(/\s*[-|·–—]\s*Top .*$/i, '')
    .replace(/\s*\|\s*.*$/i, '')
    .replace(/^\d+\.\s*/, '')
    .trim();

  if (name.length < 3 || name.length > 80) return null;
  if (name.toLowerCase().includes('top ') && name.toLowerCase().includes(' companies')) return null;
  if (name.toLowerCase().includes('best ') && name.toLowerCase().includes(' agencies')) return null;
  return name;
}

function extractWebsiteFromSnippet(snippet: string): string | null {
  const urlMatch = snippet.match(/(?:https?:\/\/)?(?:www\.)?([a-z0-9-]+\.[a-z]{2,})/i);
  return urlMatch ? `https://${urlMatch[1]}` : null;
}

function detectCountry(text: string): string {
  const lower = text.toLowerCase();
  if (lower.includes('uk') || lower.includes('london') || lower.includes('manchester') || lower.includes('united kingdom') || lower.includes('birmingham')) return 'UK';
  if (lower.includes('australia') || lower.includes('sydney') || lower.includes('melbourne') || lower.includes('brisbane')) return 'AU';
  if (lower.includes('canada') || lower.includes('toronto') || lower.includes('vancouver')) return 'CA';
  if (lower.includes('india') || lower.includes('mumbai') || lower.includes('delhi') || lower.includes('bangalore')) return 'IN';
  if (lower.includes('ireland') || lower.includes('dublin')) return 'IE';
  if (lower.includes('new zealand') || lower.includes('auckland')) return 'NZ';
  return 'US';
}

// ---------------------------------------------------------------------------
// Clutch.co Agency Scraper
// Uses Google: site:clutch.co "performance marketing" "agency"
// ---------------------------------------------------------------------------
export async function scrapeClutchAgencies(): Promise<{ found: number; imported: number }> {
  if (!SERPER_API_KEY) {
    logger.warn('[scraper] SERPER_API_KEY not set');
    return { found: 0, imported: 0 };
  }

  const { insertOutreachLead } = await import('./outreachLeadsService');
  let found = 0, imported = 0;

  const queries = [
    'site:clutch.co "performance marketing" agency profile',
    'site:clutch.co "ppc management" agency company profile',
    'site:clutch.co "meta ads" OR "facebook ads" agency profile',
    'site:clutch.co "google ads" agency company profile',
    'site:clutch.co "ecommerce marketing" agency profile',
    'site:clutch.co "paid social" OR "paid media" agency profile',
  ];

  // Rotate: use 2 queries per run
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const startIdx = (dayOfYear * 2) % queries.length;
  const todayQueries = [queries[startIdx % queries.length], queries[(startIdx + 1) % queries.length]];

  for (const query of todayQueries) {
    const results = await serperSearch(query, 30);
    found += results.length;

    for (const r of results) {
      if (!r.link.includes('clutch.co/profile/') && !r.link.includes('clutch.co/company/')) continue;
      const company = extractCompanyFromTitle(r.title, 'clutch');
      if (!company) continue;
      const country = detectCountry(r.snippet + ' ' + r.title);

      const result = await insertOutreachLead({
        company,
        websiteUrl: extractWebsiteFromSnippet(r.snippet),
        country,
        fitScore: 75,
        sourceDetail: `clutch_scraper: ${r.link}`,
      });
      if (result.inserted) imported++;
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  logger.info(`[scraper] Clutch: found ${found}, imported ${imported}`);
  return { found, imported };
}

// ---------------------------------------------------------------------------
// GoodFirms + DesignRush Agency Scraper
// ---------------------------------------------------------------------------
export async function scrapeDirectoryAgencies(): Promise<{ found: number; imported: number }> {
  if (!SERPER_API_KEY) return { found: 0, imported: 0 };

  const { insertOutreachLead } = await import('./outreachLeadsService');
  let found = 0, imported = 0;

  const queries = [
    'site:goodfirms.co "digital marketing" agency company',
    'site:goodfirms.co "ppc" OR "google ads" agency company',
    'site:designrush.com "performance marketing" agency profile',
    'site:designrush.com "paid media" OR "ppc" agency',
    'site:agencyspotter.com "digital advertising" agency',
    'site:sortlist.com "performance marketing" agency',
  ];

  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const todayQueries = [queries[dayOfYear % queries.length], queries[(dayOfYear + 1) % queries.length]];

  for (const query of todayQueries) {
    const results = await serperSearch(query, 20);
    found += results.length;

    for (const r of results) {
      const company = extractCompanyFromTitle(r.title, 'directory');
      if (!company) continue;
      const country = detectCountry(r.snippet + ' ' + r.title);

      const result = await insertOutreachLead({
        company,
        websiteUrl: extractWebsiteFromSnippet(r.snippet),
        country,
        fitScore: 70,
        sourceDetail: `directory_scraper: ${r.link}`,
      });
      if (result.inserted) imported++;
    }

    await new Promise(r => setTimeout(r, 2000));
  }

  logger.info(`[scraper] Directories: found ${found}, imported ${imported}`);
  return { found, imported };
}

// ---------------------------------------------------------------------------
// Upwork Job Mining
// Search for agencies hiring "PPC manager" or "ads specialist" = they need help
// ---------------------------------------------------------------------------
export async function mineUpworkJobs(): Promise<{ found: number; imported: number }> {
  if (!SERPER_API_KEY) return { found: 0, imported: 0 };

  const { insertOutreachLead } = await import('./outreachLeadsService');
  let found = 0, imported = 0;

  const queries = [
    'site:upwork.com "looking for" "meta ads" OR "facebook ads" manager agency',
    'site:upwork.com "looking for" "google ads" OR "ppc" specialist agency',
    'site:upwork.com "white label" "ads management" OR "ppc"',
    'site:upwork.com "need" "performance marketing" agency partner',
  ];

  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const query = queries[dayOfYear % queries.length];

  const results = await serperSearch(query, 20);
  found = results.length;

  for (const r of results) {
    if (!r.link.includes('upwork.com')) continue;
    // Extract company/client name from title
    const company = r.title
      .replace(/\s*[-|]\s*Upwork.*$/i, '')
      .replace(/^Hire\s+/i, '')
      .replace(/\s*\|.*$/, '')
      .trim();

    if (company.length < 3 || company.length > 60) continue;
    if (company.toLowerCase().includes('freelancer') || company.toLowerCase().includes('how to')) continue;

    const result = await insertOutreachLead({
      company,
      websiteUrl: null,
      country: detectCountry(r.snippet),
      fitScore: 65,
      sourceDetail: `upwork_mining: ${r.link}`,
    });
    if (result.inserted) imported++;
  }

  logger.info(`[scraper] Upwork: found ${found}, imported ${imported}`);
  return { found, imported };
}

// ---------------------------------------------------------------------------
// LinkedIn Job Post Mining (public job listings via Google)
// Companies hiring "ads manager" = can't find talent = white-label opportunity
// ---------------------------------------------------------------------------
export async function mineLinkedInJobs(): Promise<{ found: number; imported: number }> {
  if (!SERPER_API_KEY) return { found: 0, imported: 0 };

  const { insertOutreachLead } = await import('./outreachLeadsService');
  let found = 0, imported = 0;

  const queries = [
    'site:linkedin.com/jobs "hiring" "ppc manager" OR "ads manager" agency',
    'site:linkedin.com/jobs "performance marketing" manager agency',
    'site:linkedin.com/jobs "paid social" manager agency OR company',
  ];

  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
  const query = queries[dayOfYear % queries.length];

  const results = await serperSearch(query, 15);
  found = results.length;

  for (const r of results) {
    // Extract company from "Company is hiring..." pattern
    let company = r.title
      .replace(/\s*is\s+hiring.*$/i, '')
      .replace(/\s*[-|]\s*LinkedIn.*$/i, '')
      .replace(/\s*\|.*$/, '')
      .trim();

    if (company.length < 3 || company.length > 60) continue;
    if (company.toLowerCase().includes('linkedin') || company.toLowerCase().includes('job')) continue;

    const result = await insertOutreachLead({
      company,
      websiteUrl: null,
      country: detectCountry(r.snippet + ' ' + r.title),
      fitScore: 60,
      sourceDetail: `linkedin_jobs: ${r.link}`,
    });
    if (result.inserted) imported++;
  }

  logger.info(`[scraper] LinkedIn jobs: found ${found}, imported ${imported}`);
  return { found, imported };
}

// ---------------------------------------------------------------------------
// Run all scrapers (called by worker cron)
// ---------------------------------------------------------------------------
export async function runAllScrapers(): Promise<{ total: number; imported: number }> {
  let total = 0, imported = 0;

  const clutch = await scrapeClutchAgencies();
  total += clutch.found; imported += clutch.imported;

  await new Promise(r => setTimeout(r, 3000));

  const dirs = await scrapeDirectoryAgencies();
  total += dirs.found; imported += dirs.imported;

  await new Promise(r => setTimeout(r, 3000));

  const upwork = await mineUpworkJobs();
  total += upwork.found; imported += upwork.imported;

  await new Promise(r => setTimeout(r, 3000));

  const linkedin = await mineLinkedInJobs();
  total += linkedin.found; imported += linkedin.imported;

  logger.info(`[scraper] All scrapers complete: ${total} found, ${imported} imported`);

  // Slack notification
  if (imported > 0) {
    try {
      const { sendSlackMessage } = await import('./slackService');
      const { SLACK_OUTREACH_CHANNEL } = await import('../config/constants');
      await sendSlackMessage(SLACK_OUTREACH_CHANNEL,
        `🔍 *Directory Scraper*: ${imported} new leads imported\n` +
        `• Clutch: ${clutch.imported}\n• Directories: ${dirs.imported}\n• Upwork: ${upwork.imported}\n• LinkedIn Jobs: ${linkedin.imported}`,
      );
    } catch { /* non-critical */ }
  }

  return { total, imported };
}
