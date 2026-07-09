import { promises as dns } from 'dns';
import { pool as defaultPool } from '../db/index';
import { WIZMATCH_SYSTEM_CHANNEL } from '../config/constants';
import { sendSlackMessage as defaultSendSlackMessage } from './slackService';

export const WIZMATCH_ALL_DOMAINS_UNHEALTHY_EVENT = 'wizmatch_all_domains_unhealthy_alert';

type QueryResult = {
  rows: Record<string, unknown>[];
  rowCount?: number | null;
};

type Queryable = {
  query(text: string, params?: unknown[]): Promise<QueryResult>;
};

type SlackSender = (
  channel: string,
  text: string,
  blocks?: unknown[],
  opts?: { allowDuringPause?: boolean },
) => Promise<boolean>;

export interface WizmatchDomainHealthCheckDeps {
  pool?: Queryable;
  resolveTxt?: (hostname: string) => Promise<string[][]>;
  sendSlackMessage?: SlackSender;
  systemChannel?: string;
}

export interface WizmatchDomainHealthDomainResult {
  id: string;
  domain: string;
  spfOk: boolean;
  dmarcOk: boolean;
  replyRate: number;
  sends: number;
  status: 'healthy' | 'warn';
  reasons: string[];
}

export interface WizmatchDomainHealthCheckResult {
  checked: number;
  healthy: number;
  warn: number;
  alertSent: boolean;
  alertThrottled: boolean;
  domains: WizmatchDomainHealthDomainResult[];
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

async function resolveTxtOk(
  resolveTxt: (hostname: string) => Promise<string[][]>,
  hostname: string,
  marker: string,
): Promise<boolean> {
  try {
    const txt = await resolveTxt(hostname);
    return txt.some((records) => records.join('').includes(marker));
  } catch {
    return false;
  }
}

async function loadTenantLabel(pool: Queryable, tenantId: string): Promise<string> {
  try {
    const result = await pool.query(
      `SELECT name, slug FROM tenants WHERE id = $1 LIMIT 1`,
      [tenantId],
    );
    const tenant = result.rows[0] as { name?: string; slug?: string } | undefined;
    if (!tenant) return tenantId;
    const parts = [tenant.name, tenant.slug ? `(${tenant.slug})` : null].filter(Boolean);
    return parts.length > 0 ? parts.join(' ') : tenantId;
  } catch {
    return tenantId;
  }
}

async function hasRecentAllDomainsAlert(pool: Queryable, tenantId: string): Promise<boolean> {
  const result = await pool.query(
    `SELECT id
     FROM events
     WHERE tenant_id = $1
       AND event_type = $2
       AND occurred_at >= NOW() - INTERVAL '24 hours'
     LIMIT 1`,
    [tenantId, WIZMATCH_ALL_DOMAINS_UNHEALTHY_EVENT],
  );
  return result.rows.length > 0;
}

async function recordAllDomainsAlert(
  pool: Queryable,
  tenantId: string,
  tenantLabel: string,
  domains: WizmatchDomainHealthDomainResult[],
): Promise<void> {
  await pool.query(
    `INSERT INTO events (tenant_id, event_type, channel, direction, payload, source_id, occurred_at)
     VALUES ($1, $2, 'slack', 'outbound', $3::jsonb, 'wizmatch-domain-health', NOW())`,
    [
      tenantId,
      WIZMATCH_ALL_DOMAINS_UNHEALTHY_EVENT,
      JSON.stringify({
        tenant: tenantLabel,
        domains: domains.map((domain) => ({
          domain: domain.domain,
          status: domain.status,
          reasons: domain.reasons,
          replyRate: domain.replyRate,
          sends: domain.sends,
        })),
      }),
    ],
  );
}

function buildAllDomainsAlertText(tenantLabel: string, domains: WizmatchDomainHealthDomainResult[]): string {
  const domainLines = domains.map((domain) => {
    const reasonText = domain.reasons.join(', ') || 'unknown degradation';
    const replyText = `${percent(domain.replyRate)} replies on ${domain.sends} sends`;
    return `- ${domain.domain}: ${reasonText} (${replyText})`;
  });

  return [
    '*Wizmatch domain health alert*',
    `Tenant: ${tenantLabel}`,
    '',
    'All configured sending domains are degraded. Outreach sending will continue via the fallback-to-all inbox behavior, so review DNS and reply-rate health before increasing volume.',
    '',
    ...domainLines,
  ].join('\n');
}

export async function runWizmatchDomainHealthCheck(
  tenantId: string,
  deps: WizmatchDomainHealthCheckDeps = {},
): Promise<WizmatchDomainHealthCheckResult> {
  const pool = deps.pool || (defaultPool as Queryable);
  const resolveTxt = deps.resolveTxt || dns.resolveTxt;
  const sendSlackMessage = deps.sendSlackMessage || defaultSendSlackMessage;
  const systemChannel = deps.systemChannel ?? WIZMATCH_SYSTEM_CHANNEL;

  const domainsResult = await pool.query(
    `SELECT id, domain FROM wizmatch_domain_health WHERE tenant_id = $1 AND status != 'paused' ORDER BY domain`,
    [tenantId],
  );
  const domains = domainsResult.rows as Array<{ id: string; domain: string }>;

  const stats = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE channel = 'email' AND direction = 'outbound') AS sends,
       COUNT(*) FILTER (WHERE channel = 'email' AND direction = 'inbound') AS replies
     FROM messages WHERE tenant_id = $1 AND sent_at >= NOW() - INTERVAL '7 days'`,
    [tenantId],
  );
  const sends = toNumber(stats.rows[0]?.sends);
  const replies = toNumber(stats.rows[0]?.replies);
  const replyRate = sends > 0 ? replies / sends : 0;
  const lowReplyRate = replyRate < 0.03 && sends > 20;

  const checkedDomains: WizmatchDomainHealthDomainResult[] = [];

  for (const row of domains) {
    try {
      const spfOk = await resolveTxtOk(resolveTxt, row.domain, 'v=spf1');
      const dmarcOk = await resolveTxtOk(resolveTxt, `_dmarc.${row.domain}`, 'v=DMARC1');
      const reasons = [
        !spfOk ? 'SPF fail' : null,
        !dmarcOk ? 'DMARC fail' : null,
        lowReplyRate ? 'low reply rate' : null,
      ].filter((reason): reason is string => Boolean(reason));
      const status: 'healthy' | 'warn' = reasons.length > 0 ? 'warn' : 'healthy';

      await pool.query(
        `UPDATE wizmatch_domain_health
         SET last_check_at = NOW(), spf_ok = $3, dmarc_ok = $4, reply_rate_7d = $5, sends_7d = $6, status = $7
         WHERE id = $1 AND tenant_id = $2`,
        [row.id, tenantId, spfOk, dmarcOk, replyRate, sends, status],
      );

      checkedDomains.push({
        id: row.id,
        domain: row.domain,
        spfOk,
        dmarcOk,
        replyRate,
        sends,
        status,
        reasons,
      });
    } catch (error) {
      console.error(`[CRON] domain health check failed for ${row.domain}:`, error);
    }
  }

  const healthy = checkedDomains.filter((domain) => domain.status === 'healthy').length;
  const warn = checkedDomains.filter((domain) => domain.status === 'warn').length;
  let alertSent = false;
  let alertThrottled = false;

  if (checkedDomains.length > 0 && healthy === 0 && systemChannel) {
    alertThrottled = await hasRecentAllDomainsAlert(pool, tenantId);
    if (!alertThrottled) {
      const tenantLabel = await loadTenantLabel(pool, tenantId);
      const sent = await sendSlackMessage(systemChannel, buildAllDomainsAlertText(tenantLabel, checkedDomains));
      if (sent) {
        await recordAllDomainsAlert(pool, tenantId, tenantLabel, checkedDomains);
        alertSent = true;
      }
    }
  }

  return {
    checked: checkedDomains.length,
    healthy,
    warn,
    alertSent,
    alertThrottled,
    domains: checkedDomains,
  };
}
