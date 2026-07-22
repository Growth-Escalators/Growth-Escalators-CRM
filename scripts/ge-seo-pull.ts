#!/usr/bin/env npx tsx
/**
 * GE SEO Pull — on-demand (no cron, no n8n).
 *
 * Replaces the dead n8n "WF-SEO-01 GSC + GA4 Data Pull". Pulls Search Console +
 * GA4 for growthescalators.com and writes a state file Claude reads each session.
 * Run manually:  npx tsx scripts/ge-seo-pull.ts   (or: npm run ge:seo)
 * Also runs on a weekly Railway cron (see 'GE SEO Pull' in src/worker.ts).
 *
 * Auth, checked in this order (see getAuth() below):
 *   1) Env-var OAuth (Railway cron) — set all three:
 *        GOOGLE_SEO_OAUTH_REFRESH_TOKEN=...
 *        GCP_OAUTH_CLIENT_ID=...       (already set in Railway for other flows)
 *        GCP_OAUTH_CLIENT_SECRET=...   (already set in Railway for other flows)
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

function isoDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function getAuth() {
  const scopes = [
    'https://www.googleapis.com/auth/webmasters.readonly',
    'https://www.googleapis.com/auth/analytics.readonly',
  ];
  // 1) Env-var OAuth refresh token (Railway cron — no local file on the container).
  //    Same client/refresh-token pair as (2), just sourced from env instead of disk.
  if (process.env.GOOGLE_SEO_OAUTH_REFRESH_TOKEN && process.env.GCP_OAUTH_CLIENT_ID && process.env.GCP_OAUTH_CLIENT_SECRET) {
    const oauth = new google.auth.OAuth2(process.env.GCP_OAUTH_CLIENT_ID, process.env.GCP_OAUTH_CLIENT_SECRET);
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
  throw new Error('No auth — set GOOGLE_SEO_OAUTH_REFRESH_TOKEN (+ GCP_OAUTH_CLIENT_ID/SECRET), or run scripts/mint_seo_refresh_token.py first, or set GOOGLE_SA_KEY_PATH');
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

function toMarkdown(gsc: any, ga4: any): string {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ');
  let s = `# growthescalators.com — SEO state\n_Pulled ${now} UTC (on-demand). Window ${gsc.range.startDate} → ${gsc.range.endDate}._\n\n`;
  s += `## Google Search Console\n- Clicks **${Math.round(gsc.totals.clicks)}** · Impressions **${Math.round(gsc.totals.impressions)}** · CTR ${(gsc.totals.ctr * 100).toFixed(1)}% · Avg pos ${gsc.totals.position.toFixed(1)}\n\n`;
  s += `**Top queries**\n${gsc.topQueries.map((r: any) => `- ${r.keys[0]} — ${Math.round(r.clicks)} clk / ${Math.round(r.impressions)} imp / pos ${r.position.toFixed(1)}`).join('\n') || '- (none)'}\n\n`;
  s += `**Top pages**\n${gsc.topPages.map((r: any) => `- ${r.keys[0]} — ${Math.round(r.clicks)} clk / pos ${r.position.toFixed(1)}`).join('\n') || '- (none)'}\n\n`;
  if (ga4) {
    s += `## GA4\n**Channels**\n${ga4.channels.map((r: any) => `- ${r.dimensionValues[0].value}: ${r.metricValues[0].value} sessions`).join('\n') || '- (none)'}\n\n`;
    s += `**AI referrers**\n${ga4.aiReferrers.map((r: any) => `- ${r.dimensionValues[0].value}: ${r.metricValues[0].value} sessions`).join('\n') || '- (none detected)'}\n`;
  } else {
    s += `## GA4\n_(set GA4_PROPERTY_ID to enable)_\n`;
  }
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
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(path.join(OUT_DIR, 'growthescalators.json'), JSON.stringify({ pulledAt: new Date().toISOString(), gsc, ga4 }, null, 2));
  fs.writeFileSync(path.join(OUT_DIR, 'growthescalators.md'), toMarkdown(gsc, ga4));
  console.log('✅ Wrote docs/seo/state/growthescalators.{md,json}');
}

main().catch((e) => {
  console.error('FATAL:', e.message);
  process.exit(1);
});
