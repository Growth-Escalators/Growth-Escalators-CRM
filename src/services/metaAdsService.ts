import logger from '../utils/logger';
import { pool } from '../db/index';
import { metaApiBreaker } from './circuitBreaker';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PeriodData {
  spend: number;
  purchases: number;
  roas: number;
  revenue: number;
  impressions: number;
  clicks: number;
  ctr: number;
}

export interface AccountInsights {
  clientName: string;
  accountId: string;
  yesterday: PeriodData | null;
  last7days: PeriodData | null;
  thisMonth: PeriodData | null;
  bestCampaign: { name: string; roas: number } | null;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export function formatINR(amount: number): string {
  if (!amount || isNaN(amount)) return '₹0';
  return '₹' + Math.round(amount).toLocaleString('en-IN');
}

function formatROAS(roas: number): string {
  return (roas || 0).toFixed(2) + 'x';
}

function parsePeriod(data: Record<string, unknown>, exchangeRate: number): PeriodData {
  const spend = parseFloat(String(data.spend ?? 0)) * exchangeRate;
  const actions = (data.actions as Array<{ action_type: string; value: string }>) ?? [];
  const actionValues = (data.action_values as Array<{ action_type: string; value: string }>) ?? [];

  const purchases = actions.filter(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase')
    .reduce((s, a) => s + parseFloat(a.value ?? '0'), 0);
  const revenue = actionValues.filter(a => a.action_type === 'purchase' || a.action_type === 'omni_purchase')
    .reduce((s, a) => s + parseFloat(a.value ?? '0'), 0) * exchangeRate;

  const roas = spend > 0 ? revenue / spend : 0;
  const impressions = parseInt(String(data.impressions ?? 0));
  const clicks = parseInt(String(data.clicks ?? 0));
  const ctr = parseFloat(String(data.ctr ?? 0));

  return { spend, purchases, roas, revenue, impressions, clicks, ctr };
}

// ---------------------------------------------------------------------------
// Fetch insights for a single account
// ---------------------------------------------------------------------------
export async function fetchAccountInsights(
  accountId: string,
  accessToken: string,
  clientName: string,
  currency = 'INR',
  exchangeRate = 1,
): Promise<AccountInsights> {
  const base = `https://graph.facebook.com/v18.0/${accountId}/insights`;
  const fields = 'spend,purchase_roas,actions,action_values,impressions,clicks,ctr';
  const rate = currency === 'USD' ? exchangeRate : 1; // Convert USD to INR

  async function fetchPeriod(datePreset: string): Promise<PeriodData | null> {
    try {
      return await metaApiBreaker.call(async () => {
        const url = `${base}?fields=${fields}&date_preset=${datePreset}&level=account&access_token=${accessToken}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) { logger.warn(`[meta-ads] ${accountId} ${datePreset}: HTTP ${res.status}`); return null; }
        const json = await res.json() as { data?: Array<Record<string, unknown>> };
        if (!json.data || json.data.length === 0) return null;
        return parsePeriod(json.data[0], rate);
      });
    } catch (e) {
      logger.warn(`[meta-ads] ${accountId} ${datePreset} failed: ${e instanceof Error ? e.message : String(e)}`);
      return null;
    }
  }

  const [yesterday, last7days, thisMonth] = await Promise.all([
    fetchPeriod('yesterday'),
    fetchPeriod('last_7d'),
    fetchPeriod('this_month'),
  ]);

  // Best campaign
  let bestCampaign: { name: string; roas: number } | null = null;
  try {
    const campUrl = `${base}?fields=campaign_name,spend,purchase_roas&date_preset=yesterday&level=campaign&sort=purchase_roas_descending&limit=1&access_token=${accessToken}`;
    const campRes = await fetch(campUrl, { signal: AbortSignal.timeout(10000) });
    if (campRes.ok) {
      const campData = await campRes.json() as { data?: Array<Record<string, unknown>> };
      if (campData.data && campData.data.length > 0) {
        const c = campData.data[0];
        const roasArr = c.purchase_roas as Array<{ value: string }> | undefined;
        bestCampaign = {
          name: String(c.campaign_name ?? 'Unknown'),
          roas: roasArr?.[0] ? parseFloat(roasArr[0].value) : 0,
        };
      }
    }
  } catch { /* non-critical */ }

  return { clientName, accountId, yesterday, last7days, thisMonth, bestCampaign };
}

// ---------------------------------------------------------------------------
// Build formatted Slack report
// ---------------------------------------------------------------------------
export function buildDailyReport(accounts: AccountInsights[]): string {
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  let msg = `📊 *Meta Ads Daily Report — ${dateStr}*\n\n`;

  const activeAccounts = accounts.filter(a => a.last7days && a.last7days.spend > 0);

  if (activeAccounts.length === 0) {
    msg += `_No active campaigns with spend in the last 7 days._`;
    return msg;
  }

  for (const a of activeAccounts) {
    msg += `👜 *${a.clientName}*\n`;
    msg += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;

    const y = a.yesterday;
    const w = a.last7days;
    const m = a.thisMonth;

    msg += `💰 Spend: ${y ? formatINR(y.spend) : '—'} (yday) | ${w ? formatINR(w.spend) : '—'} (7d) | ${m ? formatINR(m.spend) : '—'} (month)\n`;
    msg += `🛒 Purchases: ${y?.purchases ?? '—'} | ${w?.purchases ?? '—'} | ${m?.purchases ?? '—'}\n`;
    msg += `📈 ROAS: ${y ? formatROAS(y.roas) : '—'} | ${w ? formatROAS(w.roas) : '—'} | ${m ? formatROAS(m.roas) : '—'}\n`;
    msg += `💵 Revenue: ${y ? formatINR(y.revenue) : '—'} | ${w ? formatINR(w.revenue) : '—'} | ${m ? formatINR(m.revenue) : '—'}\n`;

    if (a.bestCampaign && a.bestCampaign.roas > 0) {
      msg += `🔥 Best yesterday: ${a.bestCampaign.name} — ${formatROAS(a.bestCampaign.roas)} ROAS\n`;
    }
    msg += '\n';
  }

  msg += `_Powered by Growth Escalators · ${new Date().toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata' })}_`;
  return msg;
}

// ---------------------------------------------------------------------------
// Ensure table + seed
// ---------------------------------------------------------------------------
export async function ensureAdAccountsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_accounts (
      id SERIAL PRIMARY KEY,
      tenant_id UUID,
      account_id VARCHAR(50) UNIQUE NOT NULL,
      client_name VARCHAR(200) NOT NULL,
      account_name VARCHAR(200),
      currency VARCHAR(10) DEFAULT 'INR',
      exchange_rate DECIMAL(10,4) DEFAULT 1.0,
      is_active BOOLEAN DEFAULT true,
      access_token TEXT,
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(() => {});

  // Seed known accounts — safe to run multiple times (ON CONFLICT is idempotent)
  const seedAccounts = [
    { id: 'act_689363376592426', client: 'Paraiso',   name: 'Paraiso - Meta Ads',  currency: 'INR' },
    { id: 'act_323237510625803', client: 'GE Agency', name: 'GE Agency - Meta Ads', currency: 'INR' },
  ];
  for (const a of seedAccounts) {
    await pool.query(
      `INSERT INTO ad_accounts (account_id, client_name, account_name, currency, is_active)
       VALUES ($1, $2, $3, $4, true)
       ON CONFLICT (account_id) DO UPDATE SET client_name=$2, account_name=$3, is_active=true`,
      [a.id, a.client, a.name, a.currency],
    ).catch(() => {});
  }
}
