import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import { fetchWithRetry } from '../utils/fetchWithRetry';

const router = Router();

const META_API_BASE = 'https://graph.facebook.com/v19.0';

const FALLBACK_AD_ACCOUNTS = [
  { id: 'act_323237510625803', name: 'GE Agency' },
  { id: 'act_689363376592426', name: 'Paraiso' },
];

async function getAdAccounts(): Promise<Array<{ id: string; name: string }>> {
  try {
    const result = await pool.query(
      `SELECT
         CASE WHEN account_id LIKE 'act_%' THEN account_id ELSE 'act_' || account_id END AS id,
         COALESCE(client_name, account_name) AS name
       FROM marketing_accounts WHERE is_active = true ORDER BY account_name`
    );
    if (result.rows.length > 0) return result.rows as Array<{ id: string; name: string }>;
  } catch { /* fall through to fallback */ }
  return FALLBACK_AD_ACCOUNTS;
}

function getToken(): string | null {
  return process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN || null;
}

function dateRangeToParams(range: string): Record<string, string> {
  const today = new Date();
  const fmt = (d: Date) => d.toISOString().split('T')[0];

  const since = new Date(today);
  const until = new Date(today);

  switch (range) {
    case 'today':
      return { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) };
    case 'last_7d':
      since.setDate(today.getDate() - 7);
      return { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) };
    case 'last_14d':
      since.setDate(today.getDate() - 14);
      return { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) };
    case 'last_30d':
      since.setDate(today.getDate() - 30);
      return { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) };
    case 'this_month': {
      since.setDate(1);
      return { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) };
    }
    case 'last_month': {
      const first = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      const last = new Date(today.getFullYear(), today.getMonth(), 0);
      return { time_range: JSON.stringify({ since: fmt(first), until: fmt(last) }) };
    }
    default:
      since.setDate(today.getDate() - 7);
      return { time_range: JSON.stringify({ since: fmt(since), until: fmt(until) }) };
  }
}

function parseInsightRow(row: Record<string, unknown>) {
  const actions = (row.actions as Array<{ action_type: string; value: string }>) || [];
  const actionValues = (row.action_values as Array<{ action_type: string; value: string }>) || [];

  const purchases = actions
    .filter(a => a.action_type === 'offsite_conversion.fb_pixel_purchase')
    .reduce((sum, a) => sum + Number(a.value || 0), 0);

  const purchaseValue = actionValues
    .filter(a => a.action_type === 'offsite_conversion.fb_pixel_purchase')
    .reduce((sum, a) => sum + Number(a.value || 0), 0);

  const spend = Number(row.spend || 0);
  const impressions = Number(row.impressions || 0);
  const clicks = Number(row.clicks || 0);

  const roas = spend > 0 ? purchaseValue / spend : 0;
  const costPerPurchase = purchases > 0 ? spend / purchases : 0;
  const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
  const cpc = clicks > 0 ? spend / clicks : 0;
  const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;

  return {
    campaignId: row.campaign_id,
    campaignName: row.campaign_name,
    adsetId: row.adset_id,
    adsetName: row.adset_name,
    adId: row.ad_id,
    adName: row.ad_name,
    spend: Math.round(spend * 100) / 100,
    impressions,
    clicks,
    purchases,
    purchaseValue: Math.round(purchaseValue * 100) / 100,
    roas: Math.round(roas * 100) / 100,
    costPerPurchase: Math.round(costPerPurchase * 100) / 100,
    ctr: Math.round(ctr * 100) / 100,
    cpc: Math.round(cpc * 100) / 100,
    cpm: Math.round(cpm * 100) / 100,
    dateStart: row.date_start,
    dateStop: row.date_stop,
  };
}

// ---------------------------------------------------------------------------
// GET /api/ads/accounts
// ---------------------------------------------------------------------------
router.get('/accounts', async (_req: Request, res: Response) => {
  const token = getToken();
  if (!token) {
    res.json({ accounts: [], error: 'token_missing' });
    return;
  }

  try {
    const adAccounts = await getAdAccounts();
    const results = await Promise.all(
      adAccounts.map(async (acct) => {
        const url = `${META_API_BASE}/${acct.id}?fields=name,currency,account_status,spend_cap&access_token=${token}`;
        const r = await fetchWithRetry(url);
        const data = await r.json() as Record<string, unknown>;
        return {
          id: acct.id,
          name: (data.name as string) || acct.name,
          currency: data.currency || 'INR',
          status: data.account_status === 1 ? 'ACTIVE' : 'PAUSED',
          error: data.error ? (data.error as Record<string,string>).message : null,
        };
      })
    );
    res.json({ accounts: results });
  } catch (e: unknown) {
    res.status(500).json({ accounts: [], error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ads/campaigns?accountId=act_xxx&dateRange=last_7d
// ---------------------------------------------------------------------------
router.get('/campaigns', async (req: Request, res: Response) => {
  const token = getToken();
  if (!token) { res.json({ campaigns: [], error: 'token_missing' }); return; }

  const accountId = req.query.accountId as string;
  const dateRange = (req.query.dateRange as string) || 'last_7d';
  if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }

  try {
    const url = `${META_API_BASE}/${accountId}/campaigns?fields=id,name,status,effective_status,objective&limit=100&access_token=${token}`;
    const r = await fetchWithRetry(url);
    const data = await r.json() as Record<string, unknown>;
    if ((data as Record<string,unknown>).error) {
      res.json({ campaigns: [], error: ((data as Record<string,Record<string,string>>).error).message });
      return;
    }
    res.json({ campaigns: (data as { data: unknown[] }).data || [] });
  } catch (e: unknown) {
    res.status(500).json({ campaigns: [], error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ads/insights?accountId=act_xxx&dateRange=last_7d&level=campaign
// ---------------------------------------------------------------------------
router.get('/insights', async (req: Request, res: Response) => {
  const token = getToken();
  if (!token) { res.json({ insights: [], error: 'token_missing' }); return; }

  const accountId = req.query.accountId as string;
  const dateRange = (req.query.dateRange as string) || 'last_7d';
  const level = (req.query.level as string) || 'campaign';
  if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }

  try {
    const timeParams = dateRangeToParams(dateRange);
    const fields = [
      'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
      'ad_id', 'ad_name', 'spend', 'impressions', 'clicks',
      'ctr', 'cpm', 'cpc', 'actions', 'action_values',
    ].join(',');

    const params = new URLSearchParams({
      fields,
      level,
      time_range: timeParams.time_range,
      limit: '200',
      access_token: token,
    });

    const url = `${META_API_BASE}/${accountId}/insights?${params.toString()}`;
    const r = await fetchWithRetry(url);
    const data = await r.json() as Record<string, unknown>;

    if ((data as Record<string,unknown>).error) {
      res.json({ insights: [], error: ((data as Record<string,Record<string,string>>).error).message });
      return;
    }

    const rows = ((data as { data: Array<Record<string,unknown>> }).data || []).map(parseInsightRow);
    res.json({ insights: rows });
  } catch (e: unknown) {
    res.status(500).json({ insights: [], error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ads/adsets?accountId=act_xxx&campaignId=xxx&dateRange=last_7d
// ---------------------------------------------------------------------------
router.get('/adsets', async (req: Request, res: Response) => {
  const token = getToken();
  if (!token) { res.json({ insights: [], error: 'token_missing' }); return; }

  const accountId = req.query.accountId as string;
  const campaignId = req.query.campaignId as string;
  const dateRange = (req.query.dateRange as string) || 'last_7d';
  if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }

  try {
    const timeParams = dateRangeToParams(dateRange);
    const fields = [
      'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
      'spend', 'impressions', 'clicks', 'ctr', 'cpm', 'cpc',
      'actions', 'action_values',
    ].join(',');

    const params = new URLSearchParams({
      fields,
      level: 'adset',
      time_range: timeParams.time_range,
      limit: '200',
      access_token: token,
    });
    if (campaignId) params.set('filtering', JSON.stringify([{ field: 'campaign.id', operator: 'EQUAL', value: campaignId }]));

    const url = `${META_API_BASE}/${accountId}/insights?${params.toString()}`;
    const r = await fetchWithRetry(url);
    const data = await r.json() as Record<string, unknown>;

    if ((data as Record<string,unknown>).error) {
      res.json({ insights: [], error: ((data as Record<string,Record<string,string>>).error).message });
      return;
    }

    const rows = ((data as { data: Array<Record<string,unknown>> }).data || []).map(parseInsightRow);
    res.json({ insights: rows });
  } catch (e: unknown) {
    res.status(500).json({ insights: [], error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/ads/ads?accountId=act_xxx&adsetId=xxx&dateRange=last_7d
// ---------------------------------------------------------------------------
router.get('/ads', async (req: Request, res: Response) => {
  const token = getToken();
  if (!token) { res.json({ insights: [], error: 'token_missing' }); return; }

  const accountId = req.query.accountId as string;
  const adsetId = req.query.adsetId as string;
  const dateRange = (req.query.dateRange as string) || 'last_7d';
  if (!accountId) { res.status(400).json({ error: 'accountId required' }); return; }

  try {
    const timeParams = dateRangeToParams(dateRange);
    const fields = [
      'campaign_id', 'campaign_name', 'adset_id', 'adset_name',
      'ad_id', 'ad_name', 'spend', 'impressions', 'clicks',
      'ctr', 'cpm', 'cpc', 'actions', 'action_values',
    ].join(',');

    const params = new URLSearchParams({
      fields,
      level: 'ad',
      time_range: timeParams.time_range,
      limit: '200',
      access_token: token,
    });
    if (adsetId) params.set('filtering', JSON.stringify([{ field: 'adset.id', operator: 'EQUAL', value: adsetId }]));

    const url = `${META_API_BASE}/${accountId}/insights?${params.toString()}`;
    const r = await fetchWithRetry(url);
    const data = await r.json() as Record<string, unknown>;

    if ((data as Record<string,unknown>).error) {
      res.json({ insights: [], error: ((data as Record<string,Record<string,string>>).error).message });
      return;
    }

    const rows = ((data as { data: Array<Record<string,unknown>> }).data || []).map(parseInsightRow);
    res.json({ insights: rows });
  } catch (e: unknown) {
    res.status(500).json({ insights: [], error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ads/slack-digest — send performance summary to Slack
// ---------------------------------------------------------------------------
router.post('/slack-digest', async (req: Request, res: Response) => {
  const token = getToken();
  if (!token) { res.json({ sent: false, error: 'Meta Ads token not configured' }); return; }

  const dateRange = (req.body?.dateRange as string) || 'last_7d';

  try {
    const { sendSlackMessage, CHANNELS } = await import('../services/slackService');
    const adAccounts = await getAdAccounts();

    const allInsights: Array<{ accountName: string; spend: number; purchases: number; roas: number; impressions: number }> = [];

    for (const acct of adAccounts) {
      const timeParams = dateRangeToParams(dateRange);
      const fields = 'spend,impressions,clicks,actions,action_values';
      const params = new URLSearchParams({ fields, level: 'account', time_range: timeParams.time_range, limit: '1', access_token: token });
      const url = `${META_API_BASE}/${acct.id}/insights?${params.toString()}`;

      try {
        const r = await fetchWithRetry(url);
        const data = await r.json() as Record<string, unknown>;
        const rows = ((data as { data: Array<Record<string, unknown>> }).data || []);
        if (rows.length > 0) {
          const parsed = parseInsightRow(rows[0]);
          allInsights.push({ accountName: acct.name, spend: parsed.spend, purchases: parsed.purchases, roas: parsed.roas, impressions: parsed.impressions });
        }
      } catch { /* skip failed accounts */ }
    }

    const totalSpend = allInsights.reduce((s, i) => s + i.spend, 0);
    const totalPurchases = allInsights.reduce((s, i) => s + i.purchases, 0);
    const totalImpressions = allInsights.reduce((s, i) => s + i.impressions, 0);

    const dateLabel = dateRange.replace(/_/g, ' ').replace('last ', 'Last ');

    const lines = [
      `*Meta Ads Performance Digest* (${dateLabel})`,
      '',
      `*Total Spend:* ₹${totalSpend.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`,
      `*Total Purchases:* ${totalPurchases}`,
      `*Impressions:* ${totalImpressions.toLocaleString('en-IN')}`,
      '',
      '*Per Account:*',
      ...allInsights.map(i => `• *${i.accountName}*: ₹${i.spend.toLocaleString('en-IN', { maximumFractionDigits: 0 })} spend | ${i.purchases} purchases | ${i.roas}x ROAS`),
    ];

    if (allInsights.length === 0) {
      lines.push('_No data available for this period_');
    }

    const sent = await sendSlackMessage(CHANNELS.sodEod, lines.join('\n'));
    res.json({ sent });
  } catch (e: unknown) {
    res.status(500).json({ sent: false, error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/ads/slack-alert — send specific alert type to Slack
// ---------------------------------------------------------------------------
router.post('/slack-alert', async (req: Request, res: Response) => {
  const token = getToken();
  if (!token) { res.json({ sent: false, error: 'Meta Ads token not configured' }); return; }

  const alertType = (req.body?.type as string) || 'roas_check';
  const dateRange = (req.body?.dateRange as string) || 'today';

  try {
    const { sendSlackDM, SLACK_MEMBERS } = await import('../services/slackService');
    const adAccounts = await getAdAccounts();
    const alerts: string[] = [];

    for (const acct of adAccounts) {
      const timeParams = dateRangeToParams(dateRange);
      const fields = 'spend,impressions,clicks,actions,action_values';
      const params = new URLSearchParams({ fields, level: 'account', time_range: timeParams.time_range, limit: '1', access_token: token });
      const url = `${META_API_BASE}/${acct.id}/insights?${params.toString()}`;

      try {
        const r = await fetchWithRetry(url);
        const data = await r.json() as Record<string, unknown>;
        const rows = ((data as { data: Array<Record<string, unknown>> }).data || []);
        if (rows.length > 0) {
          const parsed = parseInsightRow(rows[0]);

          if (alertType === 'roas_check' && parsed.roas < 2.0 && parsed.spend > 100) {
            alerts.push(`⚠️ *${acct.name}*: ROAS ${parsed.roas}x (₹${parsed.spend} spend, ${parsed.purchases} purchases)`);
          }
          if (alertType === 'spend_check') {
            alerts.push(`💰 *${acct.name}*: ₹${parsed.spend.toLocaleString('en-IN', { maximumFractionDigits: 0 })} spend | ${parsed.purchases} purchases | ${parsed.roas}x ROAS`);
          }
        }
      } catch { /* skip */ }
    }

    let message: string;
    if (alertType === 'roas_check') {
      message = alerts.length > 0
        ? `*🔴 ROAS Alert Check*\n\n${alerts.join('\n')}\n\n_Action needed: review campaigns with ROAS < 2.0x_`
        : `*✅ ROAS Check — All Clear*\n\nAll accounts above 2.0x ROAS threshold.`;
    } else {
      message = `*📊 Spend Summary (${dateRange.replace(/_/g, ' ')})*\n\n${alerts.length > 0 ? alerts.join('\n') : '_No spend data available_'}`;
    }

    const sent = await sendSlackDM(SLACK_MEMBERS.jatin, message);
    res.json({ sent });
  } catch (e: unknown) {
    res.status(500).json({ sent: false, error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
