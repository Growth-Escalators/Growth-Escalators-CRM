import { pool } from '../db/index';

const SEARCH_URL = 'https://www.searchapi.io/api/v1/search';
const ACCOUNT_URL = 'https://www.searchapi.io/api/v1/me';

export interface SearchApiResult {
  position: number;
  title: string;
  link: string;
  snippet: string;
}

export interface SearchApiAccountStatus {
  configured: boolean;
  validated: boolean;
  usage: number | null;
  allowance: number | null;
  remaining: number | null;
  error?: string;
}

function key(env: NodeJS.ProcessEnv = process.env) {
  return String(env.SEARCHAPI_API_KEY || '').trim();
}

async function request(url: URL, apiKey: string, timeoutMs = 20_000) {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`SearchAPI HTTP ${response.status}`);
  return response.json() as Promise<Record<string, any>>;
}

export async function searchPublicWeb(query: string, options: { count?: number; env?: NodeJS.ProcessEnv } = {}): Promise<SearchApiResult[]> {
  const apiKey = key(options.env);
  if (!apiKey) throw new Error('SearchAPI is not configured');
  const url = new URL(SEARCH_URL);
  url.searchParams.set('engine', 'google');
  url.searchParams.set('q', query);
  url.searchParams.set('gl', 'in');
  url.searchParams.set('hl', 'en');
  url.searchParams.set('num', String(Math.min(Math.max(options.count || 10, 1), 10)));
  let body: Record<string, any> | null = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      body = await request(url, apiKey, 30_000);
      break;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transient = /timeout|aborted|SearchAPI HTTP (429|5\d\d)/i.test(message)
        || (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name));
      if (!transient || attempt === 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (!body) throw new Error('SearchAPI returned no response');
  const organic = Array.isArray(body.organic_results) ? body.organic_results : [];
  return organic.map((item: any, index: number) => ({
    position: Number(item?.position) || index + 1,
    title: String(item?.title || '').trim(),
    link: String(item?.link || '').trim(),
    snippet: String(item?.snippet || '').trim(),
  })).filter((item: SearchApiResult) => item.title && /^https?:\/\//i.test(item.link));
}

export async function validateSearchApiAccount(env: NodeJS.ProcessEnv = process.env): Promise<SearchApiAccountStatus> {
  const apiKey = key(env);
  if (!apiKey) return { configured: false, validated: false, usage: null, allowance: null, remaining: null };
  try {
    const body = await request(new URL(ACCOUNT_URL), apiKey, 10_000);
    const usage = Number(body.account?.current_month_usage ?? body.usage ?? body.searches_used ?? body.requests_used);
    const allowance = Number(body.account?.monthly_allowance ?? body.allowance ?? body.searches_limit ?? body.requests_limit);
    const remainingValue = Number(body.account?.remaining_credits ?? body.remaining ?? body.searches_remaining ?? body.requests_remaining);
    const safeUsage = Number.isFinite(usage) ? usage : null;
    const safeAllowance = Number.isFinite(allowance) ? allowance : null;
    const remaining = Number.isFinite(remainingValue)
      ? remainingValue
      : safeAllowance !== null && safeUsage !== null ? Math.max(0, safeAllowance - safeUsage) : null;
    const effectiveAllowance = safeAllowance && safeAllowance > 0
      ? safeAllowance
      : safeUsage !== null && remaining !== null ? safeUsage + remaining : safeAllowance;
    return { configured: true, validated: true, usage: safeUsage, allowance: effectiveAllowance, remaining };
  } catch (error) {
    return {
      configured: true,
      validated: false,
      usage: null,
      allowance: null,
      remaining: null,
      error: error instanceof Error ? error.message : 'SearchAPI validation failed',
    };
  }
}

export async function getSearchApiRunUsage(tenantId: string) {
  const result = await pool.query(
    `SELECT COALESCE(SUM(quota_consumed) FILTER (WHERE created_at>=CURRENT_DATE),0)::int AS daily,
            COALESCE(SUM(quota_consumed) FILTER (WHERE created_at>=date_trunc('month',CURRENT_DATE)),0)::int AS monthly
     FROM wizmatch_source_runs
     WHERE tenant_id=$1 AND provider IN ('xray','poc_discovery') AND status IN ('succeeded','partial','running')`,
    [tenantId],
  );
  return { daily: result.rows[0]?.daily || 0, monthly: result.rows[0]?.monthly || 0 };
}

export function assertSearchApiAllowance(usage: { daily: number; monthly: number }, limits: { daily: number; monthly: number }) {
  if (usage.daily >= limits.daily) throw new Error('Daily SearchAPI allowance reached');
  if (usage.monthly >= limits.monthly) throw new Error('Monthly SearchAPI allowance reached');
}

export function buildPocSearchQuery(companyName: string, domain?: string | null) {
  const company = companyName.replace(/["\n\r]/g, ' ').trim();
  const site = domain ? ` OR site:${domain.replace(/^https?:\/\//, '').split('/')[0]}` : '';
  return `("${company}") ("talent acquisition" OR recruiter OR "people operations" OR "hiring manager" OR "delivery manager" OR procurement OR "vendor management") (site:linkedin.com/in${site})`;
}

export function classifyPocResult(result: SearchApiResult) {
  const text = `${result.title} ${result.snippet}`.toLowerCase();
  const category = /procurement|vendor/.test(text) ? 'vendor_procurement'
    : /delivery manager|hiring manager/.test(text) ? 'hiring_delivery_manager'
      : /talent acquisition|recruiter/.test(text) ? 'talent_acquisition'
        : /human resources|\bhr\b|people operations/.test(text) ? 'hr_people'
          : null;
  const rawName = result.title.split(/[|\-–—]/)[0]?.trim() || '';
  const name = rawName && rawName.split(/\s+/).length >= 2 ? rawName.slice(0, 160) : null;
  return { category, name };
}
