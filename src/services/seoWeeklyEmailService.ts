import { pool } from '../db/index';
import logger from '../utils/logger';
import { resolveDefaultSeoTenantId } from './seoTenantContext';
import { CRM_BASE_URL } from '../config/crmLinks';

/**
 * Send SEO weekly summary email to Jatin via Brevo.
 *
 * `tenantId` defaults to resolveDefaultSeoTenantId() when omitted, so existing
 * zero-arg callers keep working. Every query below is scoped by it.
 *
 * KNOWN GAP (report this, don't silently fix): the recipient is the hardcoded
 * literal 'jatin@growthescalators.com' below, the same address regardless of
 * which tenantId is passed in. There is no per-tenant recipient. Today that's
 * harmless — GE is the only tenant with the seo feature on, and Jatin is meant
 * to see GE's own report. But the moment a second tenant's cron starts passing
 * its own tenantId here, THAT TENANT'S SEO DATA WILL STILL BE EMAILED TO JATIN,
 * not to the reseller client's own team — there's no leak of tenant A's data to
 * tenant B (it's not per-tenant at all), but it also means a reseller tenant
 * gets no email of its own unless a real per-tenant recipient (env var or a
 * tenants.settings field) is added. That's a product/schema decision outside
 * this lane's scope — flagging rather than inventing one.
 */
export async function sendSEOWeeklyEmail(tenantId?: string): Promise<void> {
  const brevoKey = process.env.BREVO_API_KEY;
  if (!brevoKey) { logger.warn('[seo-email] BREVO_API_KEY not set'); return; }

  // Automated weekly email — gate on the master kill-switch (default off).
  if (process.env.AUTOMATED_EMAILS_ENABLED !== 'true') {
    logger.warn('[seo-email] weekly email suppressed — AUTOMATED_EMAILS_ENABLED is off');
    return;
  }

  // Fetch data
  const tid = tenantId ?? await resolveDefaultSeoTenantId();
  const [weeklyR, keywordsR, alertsR] = await Promise.all([
    pool.query(`
      SELECT client_domain, client_name, total_clicks, total_impressions,
             avg_position, week_start
      FROM seo_weekly_metrics
      WHERE week_start >= CURRENT_DATE - 14 AND tenant_id = $1
      ORDER BY client_domain, week_start DESC
    `, [tid]).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT keyword, COALESCE(client_domain, project_name) AS client_domain,
             current_position AS position, previous_position,
             (current_position - previous_position) AS change
      FROM keyword_rankings
      WHERE tenant_id = $1
      ORDER BY current_position ASC NULLS LAST LIMIT 20
    `, [tid]).catch(() => ({ rows: [] })),
    pool.query(`
      SELECT alert_type, project_name, message, created_at
      FROM seo_alerts_log
      WHERE created_at >= NOW() - INTERVAL '7 days' AND tenant_id = $1
      ORDER BY created_at DESC LIMIT 10
    `, [tid]).catch(() => ({ rows: [] })),
  ]);

  // Same shared-recipient caveat as above — label the report with the tenant
  // it covers so the fixed recipient can tell reports apart once a second
  // tenant exists, even though the recipient itself isn't tenant-aware yet.
  let tenantLabel = tid;
  try {
    const tenantRow = await pool.query(`SELECT slug FROM tenants WHERE id = $1`, [tid]);
    if (tenantRow.rows.length > 0) tenantLabel = (tenantRow.rows[0] as { slug: string }).slug;
  } catch { /* fall back to raw tenantId */ }

  const today = new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
  const weekAgo = new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

  // Build HTML
  let html = `<div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">`;
  html += `<div style="background:#1B2E5E;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0">`;
  html += `<h2 style="margin:0">SEO Weekly Report — ${tenantLabel}</h2><p style="margin:4px 0 0;opacity:0.7">${weekAgo} — ${today}</p></div>`;
  html += `<div style="padding:20px;border:1px solid #e2e8f0;border-top:none">`;

  // Client summaries
  const clients = new Map<string, Array<Record<string, unknown>>>();
  for (const r of weeklyR.rows as Array<Record<string, unknown>>) {
    const d = r.client_domain as string;
    if (!clients.has(d)) clients.set(d, []);
    clients.get(d)!.push(r);
  }

  for (const [domain, weeks] of clients) {
    const current = weeks[0] ?? {};
    const prev = weeks[1] ?? {};
    html += `<h3 style="color:#1B2E5E;margin:16px 0 8px">${current.client_name || domain}</h3>`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:14px">`;
    html += `<tr><td>Clicks</td><td style="font-weight:bold">${current.total_clicks ?? '—'}</td><td style="color:#94a3b8">was ${prev.total_clicks ?? '—'}</td></tr>`;
    html += `<tr><td>Impressions</td><td style="font-weight:bold">${current.total_impressions ?? '—'}</td><td style="color:#94a3b8">was ${prev.total_impressions ?? '—'}</td></tr>`;
    html += `<tr><td>Avg Position</td><td style="font-weight:bold">${current.avg_position ?? '—'}</td><td style="color:#94a3b8">was ${prev.avg_position ?? '—'}</td></tr>`;
    html += `</table>`;
  }

  // Top keywords
  if ((keywordsR.rows as unknown[]).length > 0) {
    html += `<h3 style="color:#1B2E5E;margin:16px 0 8px">Top Keywords</h3>`;
    html += `<table style="width:100%;border-collapse:collapse;font-size:13px">`;
    html += `<tr style="background:#f8fafc"><th style="text-align:left;padding:4px">Keyword</th><th>Position</th><th>Change</th></tr>`;
    for (const kw of (keywordsR.rows as Array<Record<string, unknown>>).slice(0, 10)) {
      const change = Number(kw.change ?? 0);
      const arrow = change < 0 ? '↑' : change > 0 ? '↓' : '—';
      const color = change < 0 ? '#22c55e' : change > 0 ? '#ef4444' : '#94a3b8';
      html += `<tr><td style="padding:4px">${kw.keyword}</td><td style="text-align:center">${kw.position}</td><td style="text-align:center;color:${color}">${arrow} ${Math.abs(change)}</td></tr>`;
    }
    html += `</table>`;
  }

  // Alerts
  if ((alertsR.rows as unknown[]).length > 0) {
    html += `<h3 style="color:#1B2E5E;margin:16px 0 8px">Alerts This Week</h3>`;
    for (const a of (alertsR.rows as Array<Record<string, unknown>>).slice(0, 5)) {
      html += `<p style="font-size:13px;margin:4px 0">⚠️ ${a.alert_type}: ${a.message} (${a.project_name})</p>`;
    }
  }

  html += `<p style="margin-top:20px;font-size:12px;color:#94a3b8">Full dashboard: ${CRM_BASE_URL}/seo</p>`;
  html += `</div></div>`;

  // Send via Brevo
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        sender: { name: 'Growth Escalators SEO', email: 'jatin@growthescalators.com' },
        to: [{ email: 'jatin@growthescalators.com', name: 'Jatin Agrawal' }],
        subject: `SEO Weekly Report [${tenantLabel}] — ${weekAgo} to ${today}`,
        htmlContent: html,
      }),
    });
    if (res.ok) logger.info(`[seo-email] Weekly report sent for tenant ${tenantLabel}`);
    else logger.error(`[seo-email] Brevo ${res.status}`);
  } catch (e) {
    logger.error('[seo-email] Send failed:', e instanceof Error ? e.message : String(e));
  }
}
