// One-shot — runs the EXACT same per-account pipeline the 9:30 AM cron uses,
// against live Meta API data, posting one Slack message per active account
// to #perf-marketing. Use this to validate after every metaAdsService change.
//
// Run via:  railway run npx tsx src/scripts/sampleMetaAdsPerAccountLive.ts
import { Client } from 'pg';
import { fetchAccountInsights, buildAccountReport, sortAccountsForReport } from '../services/metaAdsService';
import { sendSlackMessage } from '../services/slackService';
import { SLACK_PERF_MARKETING_CHANNEL } from '../config/constants';

async function main(): Promise<void> {
  const url = process.env.DATABASE_PUBLIC_URL || process.env.DATABASE_URL;
  const token = process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!url) { console.error('FAIL: no DATABASE_URL'); process.exit(1); }
  if (!token) { console.error('FAIL: META_ADS_TOKEN / META_ACCESS_TOKEN missing'); process.exit(1); }

  const client = new Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30_000,
  });
  await client.connect();

  const result = await client.query<{
    account_id: string; client_name: string; currency: string; exchange_rate: string | number;
  }>(`SELECT account_id, client_name, currency, exchange_rate FROM ad_accounts WHERE is_active = true ORDER BY client_name`);

  console.log(`[sample] active accounts: ${result.rows.map(r => r.client_name).join(', ')}`);
  if (result.rows.length === 0) { console.error('no active accounts'); await client.end(); process.exit(1); }

  const insights = [];
  for (const acct of result.rows) {
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

  // Lead with one tiny header message so the team sees the date + that the
  // following posts are one preview per account. Lightweight, no per-account
  // overview to compete with the per-account blocks.
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  const HEADER_MSG = `🧪 *SAMPLE PREVIEW — LIVE DATA from Meta Ads API*\n📊 *Meta Ads Daily Report — ${dateStr}*\n\n_One message per active account follows. Same pipeline fires at 9:30 AM IST Mon–Sat._`;
  await sendSlackMessage(SLACK_PERF_MARKETING_CHANNEL, HEADER_MSG, undefined, { allowDuringPause: true });
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
