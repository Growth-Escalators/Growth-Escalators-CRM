import logger from '../utils/logger';
import { db, marketingAccounts } from '../db/index';
import { eq, sql } from 'drizzle-orm';
import { sendSlackDM } from './slackService';
import { logAuditEvent } from '../utils/audit';
import {
  META_API_BASE, SPEND_ALERT_COOLDOWN_HOURS,
  SLACK_JATIN, SLACK_VISHAL, DEFAULT_TENANT_SLUG,
} from '../config/constants';

const ALERT_COOLDOWN_HOURS = SPEND_ALERT_COOLDOWN_HOURS;
const JATIN_SLACK = SLACK_JATIN;
const VISHAL_SLACK = SLACK_VISHAL;

async function getTenantId(): Promise<string | null> {
  try {
    const result = await db.execute(sql`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
    return (result.rows[0] as { id: string } | undefined)?.id ?? null;
  } catch { return null; }
}

export async function checkSpendAlerts(dryRun = false): Promise<{ checked: number; alerted: number }> {
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
      // Check cooldown (skip in dryRun)
      if (!dryRun && acct.lastAlertSentAt) {
        const hoursSince = (Date.now() - new Date(acct.lastAlertSentAt).getTime()) / (1000 * 60 * 60);
        if (hoursSince < ALERT_COOLDOWN_HOURS) continue;
      }

      // Step 1 — Account balance and amount_spent (daily_budget removed — deprecated on account endpoint)
      const acctRes = await fetch(`${META_API_BASE}/${acct.accountId}?fields=balance,amount_spent,name,currency&access_token=${token}`);
      const acctData = await acctRes.json() as Record<string, unknown>;
      if (acctData.error) {
        logger.error(`[spend-alert] Meta error for ${acct.accountName}:`, (acctData.error as Record<string,string>).message);
        continue;
      }

      // Step 2 — Active campaigns with daily_budget (campaign-level is still supported)
      let totalDailyBudget = 0;
      try {
        const campRes = await fetch(
          `${META_API_BASE}/${acct.accountId}/campaigns?fields=name,status,daily_budget,lifetime_budget&effective_status=["ACTIVE"]&access_token=${token}`
        );
        const campData = await campRes.json() as { data?: Array<{ daily_budget?: string; lifetime_budget?: string }> };
        const campaigns = campData.data ?? [];

        // Sum daily_budget; fall back to lifetime_budget / 30 per campaign if no daily_budget
        totalDailyBudget = campaigns.reduce((sum, c) => {
          if (c.daily_budget) return sum + parseFloat(c.daily_budget) / 100;
          if (c.lifetime_budget) return sum + parseFloat(c.lifetime_budget) / 100 / 30;
          return sum;
        }, 0);
      } catch { /* campaigns fetch failed, proceed with 0 */ }

      // Step 3 — Today's spend from insights
      let todaySpend = 0;
      try {
        const insRes = await fetch(`${META_API_BASE}/${acct.accountId}/insights?date_preset=today&fields=spend&access_token=${token}`);
        const insData = await insRes.json() as { data?: Array<{ spend?: string }> };
        todaySpend = parseFloat(insData.data?.[0]?.spend || '0');
      } catch { /* insights may fail, use fallback */ }

      const balance = Number(acctData.balance || 0) / 100;
      const effectiveDailyBudget = totalDailyBudget || todaySpend || 1;

      // Step 4 — Smart threshold: will balance run out within 24 hours?
      const runoutHours = todaySpend > 0 ? (balance / todaySpend) * 24 : null;
      const shouldAlert = runoutHours !== null ? runoutHours < 24 : balance < effectiveDailyBudget;

      console.log(`[spend-alert] ${acct.accountName}: balance=₹${balance.toFixed(0)} totalDailyBudget=₹${totalDailyBudget.toFixed(0)} todaySpend=₹${todaySpend.toFixed(0)} runoutHours=${runoutHours?.toFixed(1) ?? 'n/a'} shouldAlert=${shouldAlert}`);

      if (!shouldAlert) continue;

      // Step 5 — Alert message
      let msg = `⚠️ *Low Balance Alert — ${acct.accountName}*\n\n` +
        `Current balance: ₹${balance.toLocaleString('en-IN', { maximumFractionDigits: 0 })}\n` +
        `Active campaigns daily budget: ₹${totalDailyBudget.toLocaleString('en-IN', { maximumFractionDigits: 0 })}\n` +
        `Today's spend: ₹${todaySpend.toLocaleString('en-IN', { maximumFractionDigits: 0 })}\n`;
      if (runoutHours !== null) {
        msg += `Estimated runout: *${runoutHours.toFixed(1)} hours*\n`;
      }
      msg += `\nTop up at: business.facebook.com/ads/manager`;

      if (dryRun) {
        console.log(`[spend-alert] [DRY RUN] would send alert:\n${msg}`);
      } else {
        await sendSlackDM(JATIN_SLACK, msg);
        await sendSlackDM(VISHAL_SLACK, msg);

        await db.update(marketingAccounts)
          .set({ lastAlertSentAt: new Date() })
          .where(eq(marketingAccounts.id, acct.id));

        const tenantId = await getTenantId();
        if (tenantId) {
          await logAuditEvent(null, tenantId, 'SPEND_ALERT', 'ad_account', acct.id, {
            accountName: acct.accountName, balance, totalDailyBudget, todaySpend, runoutHours,
          });
        }
      }

      alerted++;
    } catch (e) {
      logger.error(`[spend-alert] error for ${acct.accountName}:`, e);
    }
  }

  console.log(`[spend-alert] done — checked: ${accounts.length}, alerted: ${alerted}`);
  return { checked: accounts.length, alerted };
}
