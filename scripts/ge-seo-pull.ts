#!/usr/bin/env npx tsx
/**
 * GE SEO Pull — on-demand (no cron, no n8n).
 *
 * Replaces the dead n8n "WF-SEO-01 GSC + GA4 Data Pull". Pulls Search Console +
 * GA4 for growthescalators.com and writes a state file Claude reads each session.
 * Run manually:  npx tsx scripts/ge-seo-pull.ts   (or: npm run ge:seo)
 * Also runs on a weekly Railway cron (see 'GE SEO Pull' in src/worker.ts).
 *
 * Indexing/coverage (on top of the original clicks/impressions pull — see
 * pullIndexStatus() below):
 *   - sitemaps.list — per-sitemap submitted-URL counts, pending/error/warning state.
 *     NOTE: Google's `WmxSitemapContent.indexed` field is documented deprecated and
 *     comes back empty — there is no reliable sitemap-level "indexed count" from this
 *     API. We only surface `submitted` counts; we do not invent an indexed number.
 *   - urlInspection.index.inspect — real per-URL indexing/coverage status (coverageState,
 *     verdict, robots/fetch state). Checked live against Google's current usage-limits
 *     docs: quota is 2,000 QPD / 600 QPM per property — generous enough for a small fixed
 *     sample, NOT for whole-site coverage. We inspect the homepage + the top pages already
 *     returned by the performance pull (capped at INDEX_SAMPLE_SIZE), not every indexed URL.
 *     (The "~10-12/day" figure in the SEO standard's readiness checklist is the separate
 *     "Request Indexing" UI-button quota, not this read-only inspection API.)
 *   - This is a single-pull snapshot. The script overwrites state every run, so there is no
 *     history yet to compute a real "trending worse over 4+ weeks" signal (the standard's
 *     "Crawled - currently not indexed" pause-publishing trigger) — that needs this data
 *     retained across runs (e.g. appended rows), which doesn't exist yet. Flagged as a gap
 *     below rather than faked.
 *
 * Auth, checked in this order (see getAuth() below):
 *   1) Env-var OAuth (Railway cron) — set all three. This MUST be its own
 *      dedicated OAuth client, matching whatever client minted the refresh
 *      token below — do NOT point this at Railway's other GCP_OAUTH_CLIENT_ID/
 *      SECRET vars, they belong to an unrelated OAuth client and a refresh
 *      token from one client will fail against another:
 *        GOOGLE_SEO_OAUTH_REFRESH_TOKEN=...
 *        GOOGLE_SEO_OAUTH_CLIENT_ID=...
 *        GOOGLE_SEO_OAUTH_CLIENT_SECRET=...
 *   2) Local OAuth file (manual runs) — ~/.ge-seo/oauth_credentials.json,
 *      minted by scripts/mint_seo_refresh_token.py. Same client/refresh-token
 *      shape as (1), just sourced from disk instead of env.
 *   3) Service account (fallback) — requires `googleapis` (npm i googleapis)
 *      and a Google SERVICE ACCOUNT granted:
 *        - GSC property : Search Console → Settings → Users & permissions → add SA email
 *        - GA4 property : Admin → Property access management → add SA email (Viewer)
 *      Provide the key via env (NEVER commit it):
 *        GOOGLE_SA_KEY_PATH=/abs/path/sa.json     (or GOOGLE_SA_KEY_JSON='{...}')
 *
 * Other env:
 *   GSC_PROPERTY=sc-domain:growthescalators.com   (default)
 *   GA4_PROPERTY_ID=123456789
 *   INDEX_SAMPLE_SIZE=10                          (URL Inspection sample size, default 10)
 */
import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const GSC_PROPERTY = process.env.GSC_PROPERTY || 'sc-domain:growthescalators.com';
const GA4_PROPERTY_ID = process.env.GA4_PROPERTY_ID || '';
const OUT_DIR = path.resolve(__dirname, '../docs/seo/state');
const DAYS = 28;
const AI_REFERRERS = ['chatgpt.com', 'perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com', 'claude.ai'];
const INDEX_SAMPLE_SIZE = Number(process.env.INDEX_SAMPLE_SIZE || 10);

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

// sc-domain: properties have no single canonical URL — derive the homepage for URL
// Inspection (which needs a real URL, not a domain-property identifier).
function siteHomepage(): string {
  return GSC_PROPERTY.startsWith('sc-domain:') ? `https://${GSC_PROPERTY.slice('sc-domain:'.length)}/` : GSC_PROPERTY;
}

function getAuth() {
  const scopes = [
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/analytics.readonly',
  ];
  // 1) Env-var OAuth refresh token (Railway cron — no local file on the container).
  //    Dedicated client — must match whatever client minted the refresh token.
  if (process.env.GOOGLE_SEO_OAUTH_REFRESH_TOKEN && process.env.GOOGLE_SEO_OAUTH_CLIENT_ID && process.env.GOOGLE_SEO_OAUTH_CLIENT_SECRET) {
    const oauth = new google.auth.OAuth2(process.env.GOOGLE_SEO_OAUTH_CLIENT_ID, process.env.GOOGLE_SEO_OAUTH_CLIENT_SECRET);
    oauth.setCredentials({ refresh_token: process.env.GOOGLE_SEO_OAUTH_REFRESH_TOKEN });
    return oauth;
  }
  // 2) OAuth refresh token minted by scripts/mint_seo_refresh_token.py (preferred for
  //    local/manual runs: authenticates as a user who already has GSC + GA4 access →
  //    no property grants).
  const credsFile =
    process.env.GOOGLE_OAUTH_CREDS_FILE || path.join(os.homedir(), '.ge-seo', 'oauth_credentials.json');
  if (fs.existsSync(credsFile)) {
    const c = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
    const oauth = new google.auth.OAuth2(c.client_id, c.client_secret);
    oauth.setCredentials({ refresh_token: c.refresh_token });
    return oauth;
  }
  // 3) Service-account fallback.
  if (process.env.GOOGLE_SA_KEY_PATH)
    return new google.auth.GoogleAuth({ keyFile: process.env.GOOGLE_SA_KEY_PATH, scopes });
  if (process.env.GOOGLE_SA_KEY_JSON)
    return new google.auth.GoogleAuth({ credentials: JSON.parse(process.env.GOOGLE_SA_KEY_JSON), scopes });
  throw new Error('No auth — set GOOGLE_SEO_OAUTH_REFRESH_TOKEN (+ GOOGLE_SEO_OAUTH_CLIENT_ID/SECRET), or run scripts/mint_seo_refresh_token.py first, or set GOOGLE_SA_KEY_PATH');
}

async function pullGSC(auth: any) {
  // NOTE: searchconsole v1 exposes searchanalytics.query; if the surface errors on
  // first run, swap to google.webmasters('v3') which has the identical method.
  const sc = google.searchconsole({ version: 'v1', auth });
  const range = { startDate: isoDaysAgo(DAYS), endDate: isoDaysAgo(1) };
  const query = async (dimensions: string[]) =>
    (await sc.searchanalytics.query({ siteUrl: GSC_PROPERTY, requestBody: { ...range, dimensions, rowLimit: 25 } }))
      .data.rows || [];
  const [totals] =
    (await sc.searchanalytics.query({ siteUrl: GSC_PROPERTY, requestBody: { ...range } })).data.rows || [{} as any];
  return {
    range,
    totals: {
      clicks: totals?.clicks ?? 0,
      impressions: totals?.impressions ?? 0,
      ctr: totals?.ctr ?? 0,
      position: totals?.position ?? 0,
    },
    topQueries: await query(['query']),
    topPages: await query(['page']),
  };
}

async function pullGA4(auth: any) {
  if (!GA4_PROPERTY_ID) return null;
  const data = google.analyticsdata({ version: 'v1beta', auth });
  const run = (body: any) =>
    data.properties.runReport({ property: `properties/${GA4_PROPERTY_ID}`, requestBody: body }).then((r) => r.data);
  const dateRanges = [{ startDate: `${DAYS}daysAgo`, endDate: 'yesterday' }];
  const channels = await run({
    dateRanges,
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
  });
  const bySource = await run({
    dateRanges,
    dimensions: [{ name: 'sessionSource' }],
    metrics: [{ name: 'sessions' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 200,
  });
  const aiReferrers = (bySource.rows || []).filter((r: any) =>
    AI_REFERRERS.some((h) => (r.dimensionValues?.[0]?.value || '').includes(h))
  );
  return { channels: channels.rows || [], aiReferrers };
}

/**
 * Indexing/coverage snapshot: sitemap-level submitted counts + a per-URL indexing-status
 * sample (homepage + top pages from the performance pull). See the file header for the
 * quota research and the "sitemap indexed count is deprecated" caveat — both are real
 * constraints of the Search Console API today, not something this script works around.
 */
async function pullIndexStatus(auth: any, gsc: any) {
  const sc = google.searchconsole({ version: 'v1', auth });

  let sitemaps: any[] = [];
  let sitemapsError: string | null = null;
  try {
    const res = await sc.sitemaps.list({ siteUrl: GSC_PROPERTY });
    sitemaps = (res.data.sitemap || []).map((s: any) => ({
      path: s.path || null,
      isPending: !!s.isPending,
      isSitemapsIndex: !!s.isSitemapsIndex,
      lastDownloaded: s.lastDownloaded || null,
      lastSubmitted: s.lastSubmitted || null,
      errors: Number(s.errors || 0),
      warnings: Number(s.warnings || 0),
      // `contents[].indexed` is documented deprecated by Google and comes back empty —
      // deliberately not surfaced. `submitted` is the only trustworthy count here.
      contents: (s.contents || []).map((c: any) => ({ type: c.type || null, submitted: Number(c.submitted || 0) })),
    }));
  } catch (e: any) {
    sitemapsError = e.message;
    console.error('sitemaps.list error:', e.message);
  }

  const homepage = siteHomepage();
  const sampleUrls = Array.from(new Set([homepage, ...gsc.topPages.map((p: any) => p.keys[0])])).slice(
    0,
    INDEX_SAMPLE_SIZE
  );

  const urlStatus: any[] = [];
  for (const url of sampleUrls) {
    try {
      const res = await sc.urlInspection.index.inspect({ requestBody: { inspectionUrl: url, siteUrl: GSC_PROPERTY } });
      const r = res.data.inspectionResult?.indexStatusResult;
      urlStatus.push({
        url,
        verdict: r?.verdict || null,
        coverageState: r?.coverageState || null,
        indexingState: r?.indexingState || null,
        robotsTxtState: r?.robotsTxtState || null,
        pageFetchState: r?.pageFetchState || null,
        lastCrawlTime: r?.lastCrawlTime || null,
        googleCanonical: r?.googleCanonical || null,
        userCanonical: r?.userCanonical || null,
      });
    } catch (e: any) {
      urlStatus.push({ url, error: e.message });
    }
  }

  return { sampleSize: sampleUrls.length, sitemaps, sitemapsError, urlStatus };
}

function toMarkdown(gsc: any, ga4: any, indexStatus: any): string {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  let s = `# growthescalators.com — SEO state\n_Pulled ${now} UTC (on-demand). Window ${gsc.range.startDate} → ${gsc.range.endDate}._\n\n`;
  s += `## Google Search Console\n- Clicks **${Math.round(gsc.totals.clicks)}** · Impressions **${Math.round(gsc.totals.impressions)}** · CTR ${(gsc.totals.ctr * 100).toFixed(1)}% · Avg pos ${gsc.totals.position.toFixed(1)}\n\n`;
  s += `**Top queries**\n${gsc.topQueries.map((r: any) => `- ${r.keys[0]} — ${Math.round(r.clicks)} clk / ${Math.round(r.impressions)} imp / pos ${r.position.toFixed(1)}`).join('\n') || '- (none)'}\n\n`;
  s += `**Top pages**\n${gsc.topPages.map((r: any) => `- ${r.keys[0]} — ${Math.round(r.clicks)} clk / pos ${r.position.toFixed(1)}`).join('\n') || '- (none)'}\n\n`;
  if (ga4) {
    s += `## GA4\n**Channels**\n${ga4.channels.map((r: any) => `- ${r.dimensionValues[0].value}: ${r.metricValues[0].value} sessions`).join('\n') || '- (none)'}\n\n`;
    s += `**AI referrers**\n${ga4.aiReferrers.map((r: any) => `- ${r.dimensionValues[0].value}: ${r.metricValues[0].value} sessions`).join('\n') || '- (none detected)'}\n\n`;
  } else {
    s += `## GA4\n_(set GA4_PROPERTY_ID to enable)_\n\n`;
  }

  s += `## Indexing & coverage (snapshot, not a trend)\n`;
  s += `_Single-pull snapshot — this script overwrites state each run, so there is no history yet to`
    + ` compute a real "4+ weeks trending worse" signal per the SEO standard. Do not treat a single`
    + ` "Crawled - currently not indexed" reading below as that trend; it isn't one yet._\n\n`;

  if (indexStatus.sitemapsError) {
    s += `**Sitemaps**\n_Error: ${indexStatus.sitemapsError}_\n\n`;
  } else {
    s += `**Sitemaps** _(submitted counts only — Google's per-sitemap "indexed" field is deprecated/empty, not surfaced)_\n`;
    s += `${
      indexStatus.sitemaps
        .map((sm: any) => {
          const contents = sm.contents.map((c: any) => `${c.submitted} ${c.type || 'urls'}`).join(', ') || 'no content rows';
          return `- ${sm.path} — submitted: ${contents} · errors ${sm.errors} · warnings ${sm.warnings}${sm.isPending ? ' · PENDING' : ''} · last downloaded ${sm.lastDownloaded || 'never'}`;
        })
        .join('\n') || '- (no sitemaps registered)'
    }\n\n`;
  }

  s += `**Sampled page indexing status** (homepage + top ${indexStatus.sampleSize} pages from the performance pull above; URL Inspection API quota is 2,000/day · 600/min per property, so this is a fixed sample, not full-site coverage)\n`;
  s += `${
    indexStatus.urlStatus
      .map((u: any) =>
        u.error
          ? `- ${u.url} — error: ${u.error}`
          : `- ${u.url} — ${u.coverageState || 'unknown'} (verdict: ${u.verdict || 'n/a'}${u.robotsTxtState && u.robotsTxtState !== 'ALLOWED' ? `, robots: ${u.robotsTxtState}` : ''}${u.lastCrawlTime ? `, last crawled ${u.lastCrawlTime.slice(0, 10)}` : ''})`
      )
      .join('\n') || '- (no URLs sampled)'
  }\n`;

  return s;
}

async function main() {
  const auth = getAuth();
  console.log(`GSC pull → ${GSC_PROPERTY}`);
  const gsc = await pullGSC(auth);
  console.log(`GA4 pull → ${GA4_PROPERTY_ID || '(skipped: no GA4_PROPERTY_ID)'}`);
  const ga4 = await pullGA4(auth).catch((e) => {
    console.error('GA4 error:', e.message);
    return null;
  });
  console.log(`Indexing/coverage pull → sitemaps.list + urlInspection sample (${INDEX_SAMPLE_SIZE} URLs)`);
  const indexStatus = await pullIndexStatus(auth, gsc).catch((e) => {
    console.error('Indexing/coverage pull error:', e.message);
    return { sampleSize: 0, sitemaps: [], sitemapsError: e.message, urlStatus: [] };
  });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(OUT_DIR, 'growthescalators.json'),
    JSON.stringify({ pulledAt: new Date().toISOString(), gsc, ga4, indexStatus }, null, 2)
  );
  fs.writeFileSync(path.join(OUT_DIR, 'growthescalators.md'), toMarkdown(gsc, ga4, indexStatus));
  console.log('✅ Wrote docs/seo/state/growthescalators.{md,json}');
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
