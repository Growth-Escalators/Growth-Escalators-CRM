/**
 * saleshandyStatsService.ts
 * Polls Saleshandy's sequence stats endpoint and persists today's totals into
 * outreach_funnel_daily. Catches deliverability issues (bounce spike, zero
 * sends) early instead of waiting for replies to dry up.
 *
 * Reuses the raw Node.js https.request pattern from uploadToSaleshandy() —
 * Saleshandy's WAF rejects axios/fetch because they add "; charset=utf-8" to
 * Content-Type.
 */

import https from 'https';
import logger from '../utils/logger';
import { upsertSaleshandyStats } from './outreachFunnelMetrics';
import { sendSlackDM } from './slackService';
import { SLACK_JATIN } from '../config/constants';

const BOUNCE_ALERT_THRESHOLD = 0.05; // 5% — alert if bounces / sent exceeds this

interface SaleshandySequenceStats {
  sent: number;
  opens: number;
  bounces: number;
  clicks: number;
}

async function fetchSequenceStats(sequenceId: string, apiKey: string): Promise<SaleshandySequenceStats | null> {
  return new Promise((resolve) => {
    const urlObj = new URL(`https://api.saleshandy.com/api/v1/sequence/${sequenceId}/stats`);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'GET',
      timeout: 15000,
      headers: {
        'X-Auth-Token': apiKey,
        'Accept': 'application/json',
      },
    }, (resp) => {
      let body = '';
      resp.on('data', (c: string) => { body += c; });
      resp.on('end', () => {
        try {
          if (!resp.statusCode || resp.statusCode < 200 || resp.statusCode >= 300) {
            logger.warn(`[saleshandy-stats] non-2xx ${resp.statusCode} — ${body.slice(0, 200)}`);
            resolve(null);
            return;
          }
          const parsed = JSON.parse(body) as {
            data?: {
              sent?: number; emailSent?: number;
              opens?: number; opened?: number; opensCount?: number;
              bounces?: number; bounced?: number; bouncesCount?: number;
              clicks?: number; clicked?: number; clicksCount?: number;
            };
          };
          const d = parsed.data ?? {};
          resolve({
            sent:    Number(d.sent ?? d.emailSent ?? 0) || 0,
            opens:   Number(d.opens ?? d.opened ?? d.opensCount ?? 0) || 0,
            bounces: Number(d.bounces ?? d.bounced ?? d.bouncesCount ?? 0) || 0,
            clicks:  Number(d.clicks ?? d.clicked ?? d.clicksCount ?? 0) || 0,
          });
        } catch (err) {
          logger.debug({ err }, '[saleshandy-stats] parse failed');
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

export async function pollSaleshandyStats(): Promise<{ ok: boolean; stats?: SaleshandySequenceStats }> {
  const apiKey = process.env.SALESHANDY_API_KEY;
  const sequenceId = process.env.SALESHANDY_SEQUENCE_ID;
  if (!apiKey || !sequenceId) {
    logger.debug('[saleshandy-stats] skipped — credentials missing');
    return { ok: false };
  }

  const stats = await fetchSequenceStats(sequenceId, apiKey);
  if (!stats) return { ok: false };

  await upsertSaleshandyStats(stats);

  // Deliverability alert — fires once per daily cron run if bounce rate breaches
  // 5% OR nothing was sent today (either signal is worth waking Jatin for).
  if (stats.sent > 0) {
    const bounceRate = stats.bounces / stats.sent;
    if (bounceRate >= BOUNCE_ALERT_THRESHOLD) {
      await sendSlackDM(SLACK_JATIN,
        `⚠️ *Outreach deliverability alert*\n` +
        `Saleshandy sequence ${sequenceId} bounce rate: ${(bounceRate * 100).toFixed(2)}% ` +
        `(${stats.bounces} / ${stats.sent}).\n` +
        `Threshold: ${(BOUNCE_ALERT_THRESHOLD * 100).toFixed(0)}%. Check inbox health.`,
      ).catch(() => {});
    }
  } else {
    await sendSlackDM(SLACK_JATIN,
      `⚠️ *Outreach: zero sends today*\n` +
      `Saleshandy sequence ${sequenceId} shows 0 sends. ` +
      `Either inboxes are paused, upload queue drained, or API is stale.`,
    ).catch(() => {});
  }

  logger.info({ stats }, '[saleshandy-stats] poll complete');
  return { ok: true, stats };
}
