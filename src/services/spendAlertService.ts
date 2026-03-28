import { db, marketingAccounts } from '../db/index';
import { eq, sql } from 'drizzle-orm';
import { sendSlackDM } from './slackService';
import { logAuditEvent } from '../utils/audit';

const META_API_BASE = 'https://graph.facebook.com/v19.0';
const ALERT_COOLDOWN_HOURS = 6;
const JATIN_SLACK = 'U073Y677JBB';
const VISHAL_SLACK = 'U0ALC9Z09RA';

async function getTenantId(): Promise<string | null> {
  try {
    const result = await db.execute(sql`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
    return (result.rows[0] as { id: string } | undefined)?.id ?? null;
  } catch { return null; }
}

export async function checkSpendAlerts(): Promise<{ checked: number; alerted: number }> {
  console.log('[spend-alert] checking balances…');

  const token = process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN;
  if (!token) {
    console.log('[spend-alert] no Meta token — skipping');
    return { checked: 0, alerted: 0 };
  }

  const accounts = await db.select().from(marketingAccounts)
    .where(eq(marketingAccounts.isActive, true));

  let alerted = 0;

  for (const acct of accounts) {
    try {
      // Check cooldown
      if (acct.lastAlertSentAt) {
        const hoursSince = (Date.now() - new Date(acct.lastAlertSentAt).getTime()) / (1000 * 60 * 60);
        if (hoursSince < ALERT_COOLDOWN_HOURS) continue;
      }

      // Fetch account data
      const acctRes = await fetch(`${META_API_BASE}/${acct.accountId}?fields=balance,daily_budget,name,currency,amount_spent&access_token=${token}`);
      const acctData = await acctRes.json() as Record<string, unknown>;
      if (acctData.error) {
        console.error(`[spend-alert] Meta error for ${acct.accountName}:`, (acctData.error as Record<string,string>).message);
        continue;
      }

      // Fetch today's spend from insights
      let todaySpend = 0;
      try {
        const insRes = await fetch(`${META_API_BASE}/${acct.accountId}/insights?date_preset=today&fields=spend&access_token=${token}`);
        const insData = await insRes.json() as { data?: Array<{ spend?: string }> };
        todaySpend = parseFloat(insData.data?.[0]?.spend || '0');
      } catch { /* insights may fail, use fallback */ }

      const balance = Number(acctData.balance || 0) / 100;
      const dailyBudget = Number(acctData.daily_budget || 0) / 100;

      // Smart threshold: will balance run out within 24 hours?
      const runoutHours = todaySpend > 0 ? (balance / todaySpend) * 24 : null;
      const shouldAlert = runoutHours !== null ? runoutHours < 24 : (dailyBudget > 0 && balance < dailyBudget);

      if (!shouldAlert) continue;

      let msg = `⚠️ *Low Balance Alert — ${acct.accountName}*\n\n` +
        `Current balance: ₹${balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}\n` +
        `Daily budget: ₹${dailyBudget.toLocaleString('en-IN', { maximumFractionDigits: 0 })}\n` +
        `Today's spend so far: ₹${todaySpend.toLocaleString('en-IN', { maximumFractionDigits: 0 })}\n`;
      if (runoutHours !== null) {
        msg += `Estimated runout: *${runoutHours.toFixed(1)} hours*\n`;
      }
      msg += `\nCampaigns may pause soon. Top up at:\nbusiness.facebook.com/ads/manager`;

      // DM both Jatin and Vishal
      await sendSlackDM(JATIN_SLACK, msg);
      await sendSlackDM(VISHAL_SLACK, msg);

      await db.update(marketingAccounts)
        .set({ lastAlertSentAt: new Date() })
        .where(eq(marketingAccounts.id, acct.id));

      const tenantId = await getTenantId();
      if (tenantId) {
        await logAuditEvent(null, tenantId, 'SPEND_ALERT', 'ad_account', acct.id, {
          accountName: acct.accountName, balance, dailyBudget, todaySpend, runoutHours,
        });
      }

      alerted++;
    } catch (e) {
      console.error(`[spend-alert] error for ${acct.accountName}:`, e);
    }
  }

  console.log(`[spend-alert] done — checked: ${accounts.length}, alerted: ${alerted}`);
  return { checked: accounts.length, alerted };
}
