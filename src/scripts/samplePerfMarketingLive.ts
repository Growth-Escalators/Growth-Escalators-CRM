// One-shot — runs the EXACT pipeline the 9:30 AM IST cron uses with LIVE
// Meta API data. Posts one Slack message per active account from the
// ad_accounts table to #perf-marketing. Use this to validate after every
// metaAdsService change before the real cron fires.
//
// Run via:  railway run npx tsx src/scripts/samplePerfMarketingLive.ts
import { Client } from 'pg';
import { fetchAccountInsights, buildAccountReport, sortAccountsForReport } from '../services/metaAdsService';
import { sendSlackMessage } from '../services/slackService';
import { SLACK_PERF_MARKETING_CHANNEL } from '../config/constants';

async function main(): Promise<void> {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const token = process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!url) { console.error('FAIL: no DATABASE_URL'); process.exit(1); }
  if (!token) { console.error('FAIL: META_ADS_TOKEN missing'); process.exit(1); }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
  });
  await client.connect();

  const r = await client.query<{
    account_id: string; client_name: string; currency: string; exchange_rate: string | number;
  }>(`SELECT account_id, client_name, currency, exchange_rate
      FROM ad_accounts WHERE is_active = true ORDER BY client_name`);

  console.log(`[sample] active accounts: ${r.rows.map(a => a.client_name).join(', ')}`);
  if (r.rows.length === 0) { console.error('no active accounts'); await client.end(); process.exit(1); }

  const insights = [];
  for (const acct of r.rows) {
    process.stdout.write(`[sample] fetching ${acct.client_name}… `);
    try {
      const data = await fetchAccountInsights(
        acct.account_id, token, acct.client_name,
        acct.currency, Number(acct.exchange_rate ?? 1),
      );
      insights.push(data);
      console.log('OK');
    } catch (e) {
      console.log(`FAIL: ${(e as Error).message}`);
    }
  }

  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  await sendSlackMessage(
    SLACK_PERF_MARKETING_CHANNEL,
    `🧪 *SAMPLE PREVIEW — LIVE DATA*\n📊 *Meta Ads Daily Report — ${dateStr}*\n\n_One message per active account follows. Same pipeline fires automatically at 9:30 AM IST Mon–Sat._`,
    undefined,
    { allowDuringPause: true },
  );
  await new Promise(r => setTimeout(r, 800));

  let sent = 0;
  for (const a of sortAccountsForReport(insights)) {
    const ok = await sendSlackMessage(SLACK_PERF_MARKETING_CHANNEL, buildAccountReport(a), undefined, { allowDuringPause: true });
    if (ok) sent++;
    console.log(`[sample] ${a.clientName}: ${ok ? 'POSTED ✓' : 'FAIL'}`);
    await new Promise(r => setTimeout(r, 800));
  }
  console.log(`[sample] done — ${sent}/${insights.length} per-account posts`);

  await client.end();
  process.exit(0);
}

main().catch((e) => { console.error('Sample failed:', e); process.exit(1); });
