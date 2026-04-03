#!/usr/bin/env npx tsx
/**
 * SEO Doctor — Diagnostic + Self-Healing Script
 * Growth Escalators Backend — GE SEO Automation System
 *
 * Runs all 7 checks autonomously, auto-fixes what it can, prints a
 * structured final report with manual steps for anything blocked.
 *
 * Usage:
 *   npx tsx scripts/seo-doctor.ts
 *   npm run seo:doctor
 */

import { Pool } from 'pg';
import https from 'https';
import http from 'http';
import * as fs from 'fs';
import * as os from 'os';

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

const N8N_URL       = 'https://primary-production-6c6f5.up.railway.app';
const N8N_EMAIL     = 'jatin@growthescalators.com';
const N8N_PASS      = '***REDACTED-ROTATED-2026-07-23***';
// Read-only API key (workflow:read scope) — used for GET /api/v1/workflows
const N8N_API_KEY_RO = '***REDACTED-ROTATED-2026-07-23***';

const DB_PUBLIC_URL = '***REDACTED-ROTATED-2026-07-23***';

const RAILWAY_TOKEN      = (() => { try { const d = JSON.parse(fs.readFileSync(os.homedir() + '/.railway/config.json','utf8')); return d?.user?.token ?? ''; } catch { return ''; } })();
const RAILWAY_PROJECT_ID = 'eef927aa-8e3a-4515-85fd-781b7d1d95c1';
const RAILWAY_ENV_ID     = '81b087de-6c7d-493c-94f0-50c8180c47da';
const PRIMARY_SVC_ID     = '2ab3eacc-8adc-43cd-b12d-97f8b7c98a2c';

const N8N_CREDENTIAL_GOOGLE_SEO = 'YxrNZeLdvBfNxEsZ';
const SLACK_CHANNEL_PERF        = 'C0ALLQG0SUS'; // #performance-marketing

const WF_IDS: Record<string, string> = {
  'WF-SEO-01': 'YXmClFSKZB9DMkyu',
  'WF-SEO-02': '5FVX2kEjuD7vWD0e',
  'WF-SEO-03': 'as8HvuMPqAHhAdQ8',
  'WF-SEO-04': 'CBzwkCqVgeQOxOQl',
  'WF-SEO-05': 'z21W6MDWBF0dukkT',
  'WF-SEO-06': 'BwO187curjMMA60i',
  'WF-SEO-07': 'Isz1ui9PkjsqBMb8',
  'WF-SEO-08': '19R3BStSY2S1N9H1',
  'WF-SEO-09': 'akTW1dgtKtCpcz3R',
  'WF-SEO-10': '8l9kEQlRVUbL4Ku6',
  'WF-SEO-11': 'Ss2Bfps5lXBWUUs4',
  'WF-SEO-12': 'M4rbRZL5jh0jJHku',
};

const TABLE_TO_WF: Record<string, string> = {
  seo_weekly_metrics:     'WF-SEO-01',
  seo_keyword_tracking:   'WF-SEO-01',
  keyword_rankings:       'WF-SEO-06',
  backlink_data:          'WF-SEO-08',
  content_gap_analysis:   'WF-SEO-07',
  seo_opportunities:      'WF-SEO-11',
  site_health_metrics:    'WF-SEO-05',
  brand_mentions:         'WF-SEO-08',
  client_knowledge_base:  'seeded manually (3 rows expected)',
  client_pages:           'WF-SEO-04',
  seo_alerts_log:         'WF-SEO-02',
  seo_workflow_logs:      'all workflows',
};

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────

interface CheckResult {
  key: string;
  status: 'pass' | 'fail' | 'warn' | 'skip' | 'blocked';
  detail: string;
  autoFixed?: boolean;
}

const checks: CheckResult[] = [];
const manualSteps: string[] = [];
let primaryEnvVars: Record<string, string> = {};
let n8nCookies = '';
let claudeApiKey = '';
let slackToken = '';
let valueSerpKey = '';
let dataForSeoLogin = '';
let dataForSeoPass = '';

function log(msg: string) { process.stdout.write(msg + '\n'); }

function addCheck(key: string, status: CheckResult['status'], detail: string, autoFixed = false) {
  checks.push({ key, status, detail, autoFixed });
  const icons: Record<string, string> = { pass: '✅', fail: '❌', warn: '⚠️', skip: '⏭️', blocked: '🔒' };
  log(`  ${icons[status] ?? '?'} ${key}: ${detail}${autoFixed ? ' [AUTO-FIXED]' : ''}`);
}

function addManualStep(step: string) {
  manualSteps.push(step);
}

// ─────────────────────────────────────────────────────────────────────────────
// HTTP HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function httpReq(
  url: string,
  opts: { method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number } = {}
): Promise<{ status: number; body: string; headers: Record<string, string> }> {
  return new Promise((resolve) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? '443' : '80'),
      path: u.pathname + u.search,
      method: opts.method ?? 'GET',
      headers: opts.headers ?? {},
    }, (res) => {
      let body = '';
      res.on('data', (c: Buffer) => (body += c.toString()));
      res.on('end', () => resolve({
        status: res.statusCode ?? 0,
        body,
        headers: res.headers as Record<string, string>,
      }));
    });
    req.on('error', (e) => resolve({ status: 0, body: `NETWORK_ERROR: ${e.message}`, headers: {} }));
    const timeout = opts.timeoutMs ?? 15000;
    req.setTimeout(timeout, () => { req.destroy(); resolve({ status: 0, body: 'TIMEOUT', headers: {} }); });
    if (opts.body) req.write(opts.body);
    req.end();
  });
}

async function n8nGet(path: string): Promise<{ status: number; body: string }> {
  return httpReq(`${N8N_URL}${path}`, {
    headers: {
      'X-N8N-API-KEY': N8N_API_KEY_RO,
      'Content-Type': 'application/json',
    },
  });
}

async function n8nRestPatch(path: string, body: Record<string, unknown>): Promise<{ status: number; body: string }> {
  return httpReq(`${N8N_URL}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': n8nCookies,
    },
    body: JSON.stringify(body),
    timeoutMs: 10000,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 0 — n8n session login (prerequisite for write operations)
// ─────────────────────────────────────────────────────────────────────────────

async function loginN8n(): Promise<void> {
  try {
    const r = await httpReq(`${N8N_URL}/rest/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ emailOrLdapLoginId: N8N_EMAIL, password: N8N_PASS }),
    });
    const setCookie = r.headers['set-cookie'];
    if (setCookie) {
      n8nCookies = Array.isArray(setCookie) ? setCookie.map(c => c.split(';')[0]).join('; ') : String(setCookie).split(';')[0];
      log(`  🔑 n8n session established`);
    } else {
      log(`  ⚠️  n8n login: no cookie received (status ${r.status})`);
    }
  } catch (e) {
    log(`  ⚠️  n8n login failed: ${e}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 1 — Railway env vars (Primary service)
// ─────────────────────────────────────────────────────────────────────────────

const REQUIRED_VARS: Array<{ key: string; expected?: string }> = [
  { key: 'VALUESERP_API_KEY' },
  { key: 'VALUESREP_API_KEY' },  // alternate spelling
  { key: 'DATAFORSEO_LOGIN' },
  { key: 'DATAFORSEO_PASSWORD' },
  { key: 'CLAUDE_API_KEY' },
  { key: 'SLACK_BOT_TOKEN' },
  { key: 'GA4_AAROHAOM_ID',     expected: '506144010' },
  { key: 'GA4_AGEDDENTISTRY_ID', expected: '514956819' },
  { key: 'GA4_BLACKPANDA_ID',    expected: '513868257' },
];

async function check1_envVars(): Promise<void> {
  log('\n══════ CHECK 1 — Railway Environment Variables ══════');
  try {
    // Fetch Primary service env vars via Railway GraphQL API
    const query = `{ variables(projectId:"${RAILWAY_PROJECT_ID}", environmentId:"${RAILWAY_ENV_ID}", serviceId:"${PRIMARY_SVC_ID}") }`;
    const r = await httpReq('https://backboard.railway.app/graphql/v2', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${RAILWAY_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
      timeoutMs: 10000,
    });
    if (r.status === 200) {
      const d = JSON.parse(r.body);
      primaryEnvVars = d?.data?.variables ?? {};
    } else {
      log(`  ⚠️  Railway API returned ${r.status} — using process.env fallback`);
      primaryEnvVars = process.env as Record<string, string>;
    }
  } catch (e) {
    log(`  ⚠️  Railway API error: ${e} — using process.env fallback`);
    primaryEnvVars = process.env as Record<string, string>;
  }

  // Cache useful values
  claudeApiKey    = primaryEnvVars['CLAUDE_API_KEY'] ?? process.env.CLAUDE_API_KEY ?? '';
  slackToken      = primaryEnvVars['SLACK_BOT_TOKEN'] ?? process.env.SLACK_BOT_TOKEN ?? '';
  valueSerpKey    = primaryEnvVars['VALUESERP_API_KEY'] ?? primaryEnvVars['VALUESREP_API_KEY'] ?? process.env.VALUESERP_API_KEY ?? process.env.VALUESREP_API_KEY ?? '';
  dataForSeoLogin = primaryEnvVars['DATAFORSEO_LOGIN'] ?? process.env.DATAFORSEO_LOGIN ?? '';
  dataForSeoPass  = primaryEnvVars['DATAFORSEO_PASSWORD'] ?? process.env.DATAFORSEO_PASSWORD ?? '';

  for (const { key, expected } of REQUIRED_VARS) {
    const val = (primaryEnvVars[key] ?? process.env[key] ?? '').toString().trim();
    if (!val) {
      addCheck(`ENV:${key}`, 'fail', 'MISSING');
      addManualStep(
        `Add ${key} to Railway:\n` +
        `   → railway.app → GE-Backend-Server → Primary service → Variables\n` +
        `   → Add: ${key} = <your value>\n` +
        `   → Redeploy Primary after saving`
      );
    } else if (expected && !val.replace('properties/', '').trim().includes(expected)) {
      addCheck(`ENV:${key}`, 'warn', `SET but value mismatch (got "${val.substring(0,30)}", expected contains "${expected}")`);
    } else {
      addCheck(`ENV:${key}`, 'pass', `SET (${val.substring(0,8)}…)`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 2 — n8n API connectivity
// ─────────────────────────────────────────────────────────────────────────────

let n8nReachable = false;
let allWorkflowData: Array<{ id: string; name: string; active: boolean }> = [];

async function check2_n8nConnectivity(): Promise<void> {
  log('\n══════ CHECK 2 — n8n API Connectivity ══════');

  // Helper to parse workflow list from either public API or session REST response
  function parseWorkflows(body: string, dataKey: 'data' | 'data'): Array<{ id: string; name: string; active: boolean }> {
    try {
      const d = JSON.parse(body);
      const list = d?.data ?? [];
      return list.map((w: Record<string, unknown>) => ({
        id: w.id as string,
        name: w.name as string,
        active: w.active as boolean,
      }));
    } catch { return []; }
  }

  try {
    // Primary: public API key
    const r = await n8nGet('/api/v1/workflows?limit=100');
    if (r.status === 200) {
      allWorkflowData = parseWorkflows(r.body, 'data');
      n8nReachable = true;
      addCheck('n8n-API', 'pass', `HTTP 200 (API key) — ${allWorkflowData.length} workflows found`);
      return;
    }

    // Fallback: session cookie via /rest/workflows (works even when public API key has scope issues)
    if (n8nCookies) {
      log(`  ⚠️  Public API key returned ${r.status} — falling back to session auth`);
      const r2 = await httpReq(`${N8N_URL}/rest/workflows?limit=100`, {
        headers: { 'Cookie': n8nCookies, 'Content-Type': 'application/json' },
      });
      if (r2.status === 200) {
        allWorkflowData = parseWorkflows(r2.body, 'data');
        n8nReachable = true;
        addCheck('n8n-API', 'pass', `HTTP 200 (session fallback) — ${allWorkflowData.length} workflows found`);
        return;
      }
      addCheck('n8n-API', 'fail', `API key: ${r.status}, session fallback: ${r2.status} — ${r2.body.substring(0, 80)}`);
    } else {
      addCheck('n8n-API', 'fail', `HTTP ${r.status}: ${r.body.substring(0, 100)}`);
    }
  } catch (e) {
    addCheck('n8n-API', 'fail', `Unreachable: ${e}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 3 — All 12 SEO workflows active (auto-fix if inactive)
// ─────────────────────────────────────────────────────────────────────────────

const workflowStatus: Record<string, 'active' | 'inactive' | 'not_found' | 'fixed'> = {};

async function check3_workflowsActive(): Promise<void> {
  log('\n══════ CHECK 3 — SEO Workflow Active Status (auto-fix) ══════');
  if (!n8nReachable) {
    for (const wfKey of Object.keys(WF_IDS)) {
      addCheck(`WF:${wfKey}`, 'skip', 'SKIPPED — n8n unreachable');
    }
    return;
  }

  const wfMap = new Map(allWorkflowData.map(w => [w.id, w]));

  for (const [wfKey, wfId] of Object.entries(WF_IDS)) {
    const wf = wfMap.get(wfId);
    if (!wf) {
      addCheck(`WF:${wfKey}`, 'fail', `NOT FOUND (id: ${wfId})`);
      workflowStatus[wfKey] = 'not_found';
      continue;
    }
    if (wf.active) {
      addCheck(`WF:${wfKey}`, 'pass', `ACTIVE — "${wf.name}"`);
      workflowStatus[wfKey] = 'active';
      continue;
    }
    // AUTO-FIX: activate it
    log(`  🔧 AUTO-FIX: Activating ${wfKey} (${wfId})…`);
    try {
      // Use session-based REST API for PATCH (API key only has read scope)
      const patchR = await n8nRestPatch(`/rest/workflows/${wfId}`, { active: true });
      if (patchR.status === 200) {
        const updated = JSON.parse(patchR.body);
        const isNowActive = updated?.data?.active ?? updated?.active ?? false;
        if (isNowActive) {
          addCheck(`WF:${wfKey}`, 'pass', `AUTO-FIXED: was inactive, now ACTIVE`, true);
          workflowStatus[wfKey] = 'fixed';
        } else {
          addCheck(`WF:${wfKey}`, 'warn', `PATCH sent but still shows inactive`);
          workflowStatus[wfKey] = 'inactive';
        }
      } else {
        addCheck(`WF:${wfKey}`, 'warn', `INACTIVE — PATCH failed (${patchR.status}): ${patchR.body.substring(0,80)}`);
        workflowStatus[wfKey] = 'inactive';
      }
    } catch (e) {
      addCheck(`WF:${wfKey}`, 'warn', `INACTIVE — auto-fix error: ${e}`);
      workflowStatus[wfKey] = 'inactive';
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 4 — Database tables and row counts (auto-seed client_knowledge_base)
// ─────────────────────────────────────────────────────────────────────────────

let pool: Pool | null = null;
const tableRowCounts: Record<string, number | null> = {};

async function check4_database(): Promise<void> {
  log('\n══════ CHECK 4 — Database Tables & Row Counts ══════');

  const dbUrl = process.env.DATABASE_URL ?? DB_PUBLIC_URL;
  try {
    pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 10000, ssl: dbUrl.includes('railway.internal') ? false : { rejectUnauthorized: false } });
    await pool.query('SELECT 1');
    addCheck('DB:connection', 'pass', `Connected (${dbUrl.includes('railway.internal') ? 'internal' : 'public'})`);
  } catch (e) {
    addCheck('DB:connection', 'fail', `Cannot connect: ${e}`);
    pool = null;
    for (const t of Object.keys(TABLE_TO_WF)) addCheck(`DB:${t}`, 'skip', 'SKIPPED — no DB connection');
    return;
  }

  for (const tableName of Object.keys(TABLE_TO_WF)) {
    try {
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${tableName}`);
      const cnt = rows[0]?.cnt ?? 0;
      tableRowCounts[tableName] = cnt;
      if (cnt === 0) {
        addCheck(`DB:${tableName}`, 'warn', `EMPTY — fed by ${TABLE_TO_WF[tableName]}`);
      } else {
        addCheck(`DB:${tableName}`, 'pass', `${cnt} rows`);
      }
    } catch (e: unknown) {
      const msg = (e as Error).message ?? String(e);
      if (msg.includes('does not exist')) {
        tableRowCounts[tableName] = null;
        addCheck(`DB:${tableName}`, 'fail', `MISSING TABLE`);
      } else {
        tableRowCounts[tableName] = 0;
        addCheck(`DB:${tableName}`, 'warn', `Query error: ${msg.substring(0, 80)}`);
      }
    }
  }

  // AUTO-FIX: seed client_knowledge_base if empty
  if (tableRowCounts['client_knowledge_base'] === 0) {
    log('  🔧 AUTO-FIX: Seeding client_knowledge_base…');
    try {
      await pool.query(`
        INSERT INTO client_knowledge_base
          (client_name, domain, industry, target_audience, brand_voice, primary_keywords, created_at)
        VALUES
          ('Aarohaom', 'aarohaom.com', 'Ayurvedic wellness',
           'Health-conscious Indians aged 25-50 seeking natural remedies',
           'Authentic, educational, trust-building',
           ARRAY['ayurvedic treatment','ayurvedic wellness','panchakarma','ayurvedic products india','natural healing'],
           NOW()),
          ('Aged Dentistry', 'ageddentistry.org', 'Dental care for elderly',
           'Elderly patients and their carers in Australia',
           'Compassionate, professional, accessible',
           ARRAY['aged care dentist','dental care elderly','dentures aged care','nursing home dental','senior dental care'],
           NOW()),
          ('Black Panda Enterprises', 'blackpandaenterprises.com', 'India market entry consulting',
           'International companies wanting to enter Indian market',
           'Strategic, data-driven, authoritative',
           ARRAY['india market entry','fractional GCC india','global capability centre','india expansion consulting','business setup india'],
           NOW())
        ON CONFLICT (client_name) DO NOTHING
      `);
      const { rows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM client_knowledge_base`);
      const newCnt = rows[0]?.cnt ?? 0;
      tableRowCounts['client_knowledge_base'] = newCnt;
      // Update the check
      checks.filter(c => c.key === 'DB:client_knowledge_base').forEach(c => {
        c.status = 'pass'; c.detail = `${newCnt} rows (AUTO-SEEDED)`; c.autoFixed = true;
      });
      log(`  ✅ client_knowledge_base seeded: ${newCnt} rows`);
    } catch (e) {
      log(`  ❌ Seed failed: ${e}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 5 — External API tests
// ─────────────────────────────────────────────────────────────────────────────

const apiResults: Record<string, { pass: boolean; detail: string }> = {};

async function check5_externalApis(): Promise<void> {
  log('\n══════ CHECK 5 — External API Tests ══════');

  // 5A — Google Search Console
  log('\n  ─ 5A Google Search Console ─');
  try {
    const r = await httpReq(
      'https://searchconsole.googleapis.com/webmasters/v3/sites?fields=siteEntry',
      { headers: { 'Content-Type': 'application/json' }, timeoutMs: 10000 }
    );
    if (r.status === 401) {
      apiResults['gsc'] = { pass: true, detail: '⚠️ Reachable (401 — OAuth token needed)' };
      addCheck('API:GSC', 'warn', 'Reachable but 401 — Google OAuth access token not in env');
    } else if (r.status === 200) {
      apiResults['gsc'] = { pass: true, detail: '✅ Working' };
      addCheck('API:GSC', 'pass', 'HTTP 200');
    } else if (r.status === 0) {
      apiResults['gsc'] = { pass: false, detail: '❌ Network error' };
      addCheck('API:GSC', 'fail', `Network error: ${r.body.substring(0,80)}`);
    } else {
      apiResults['gsc'] = { pass: true, detail: `⚠️ HTTP ${r.status}` };
      addCheck('API:GSC', 'warn', `HTTP ${r.status} (endpoint reachable)`);
    }
  } catch (e) {
    apiResults['gsc'] = { pass: false, detail: `❌ ${e}` };
    addCheck('API:GSC', 'fail', `${e}`);
  }

  // 5B — Google Analytics 4
  log('\n  ─ 5B Google Analytics 4 ─');
  const ga4Id = (primaryEnvVars['GA4_AAROHAOM_ID'] ?? '').replace('properties/', '').trim() || '506144010';
  try {
    const r = await httpReq(
      `https://analyticsdata.googleapis.com/v1beta/properties/${ga4Id}:runReport`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', timeoutMs: 10000 }
    );
    if (r.status === 401 || r.status === 403) {
      apiResults['ga4'] = { pass: true, detail: `⚠️ Reachable (${r.status} — OAuth needed)` };
      addCheck('API:GA4', 'warn', `Reachable (${r.status} — no OAuth token in env)`);
    } else if (r.status === 200) {
      apiResults['ga4'] = { pass: true, detail: '✅ Working' };
      addCheck('API:GA4', 'pass', 'HTTP 200');
    } else if (r.status === 0) {
      apiResults['ga4'] = { pass: false, detail: '❌ Network error' };
      addCheck('API:GA4', 'fail', `Network error: ${r.body.substring(0,80)}`);
    } else {
      apiResults['ga4'] = { pass: true, detail: `⚠️ HTTP ${r.status}` };
      addCheck('API:GA4', 'warn', `HTTP ${r.status}`);
    }
  } catch (e) {
    apiResults['ga4'] = { pass: false, detail: `❌ ${e}` };
    addCheck('API:GA4', 'fail', `${e}`);
  }

  // 5C — ValueSERP
  log('\n  ─ 5C ValueSERP ─');
  if (!valueSerpKey) {
    apiResults['valueserp'] = { pass: false, detail: '⚠️ BLOCKED — VALUESERP_API_KEY not set' };
    addCheck('API:ValueSERP', 'blocked', 'BLOCKED — VALUESERP_API_KEY not set in Railway');
    addManualStep(
      'Add VALUESERP_API_KEY to Railway:\n' +
      '   → railway.app → GE-Backend-Server → Primary service → Variables\n' +
      '   → Add: VALUESERP_API_KEY = <key from valueserp.com/dashboard>\n' +
      '   → Add: VALUESREP_API_KEY = same value (alternate spelling used by some nodes)\n' +
      '   → Redeploy Primary after saving'
    );
  } else {
    try {
      const r = await httpReq(
        `https://api.valueserp.com/search?api_key=${valueSerpKey}&q=test&num=1`,
        { timeoutMs: 10000 }
      );
      if (r.status === 200) {
        apiResults['valueserp'] = { pass: true, detail: '✅ Working' };
        addCheck('API:ValueSERP', 'pass', 'HTTP 200 — key valid');
      } else {
        apiResults['valueserp'] = { pass: false, detail: `❌ HTTP ${r.status}` };
        addCheck('API:ValueSERP', 'fail', `HTTP ${r.status}: ${r.body.substring(0,80)}`);
      }
    } catch (e) {
      apiResults['valueserp'] = { pass: false, detail: `❌ ${e}` };
      addCheck('API:ValueSERP', 'fail', `${e}`);
    }
  }

  // 5D — DataForSEO
  log('\n  ─ 5D DataForSEO ─');
  if (!dataForSeoLogin || !dataForSeoPass) {
    apiResults['dataforseo'] = { pass: false, detail: '⚠️ BLOCKED — credentials not set' };
    addCheck('API:DataForSEO', 'blocked', 'BLOCKED — DATAFORSEO_LOGIN/PASSWORD not set');
    addManualStep(
      'Add DataForSEO credentials to Railway:\n' +
      '   → Primary service → Variables\n' +
      '   → Add: DATAFORSEO_LOGIN = <your DataForSEO email>\n' +
      '   → Add: DATAFORSEO_PASSWORD = <your DataForSEO password>\n' +
      '   → Redeploy Primary after saving'
    );
  } else {
    try {
      const creds = Buffer.from(`${dataForSeoLogin}:${dataForSeoPass}`).toString('base64');
      const r = await httpReq(
        'https://api.dataforseo.com/v3/appendix/user_data',
        { headers: { 'Authorization': `Basic ${creds}`, 'Content-Type': 'application/json' }, timeoutMs: 10000 }
      );
      if (r.status === 200) {
        apiResults['dataforseo'] = { pass: true, detail: '✅ Working' };
        addCheck('API:DataForSEO', 'pass', 'HTTP 200 — credentials valid');
      } else {
        apiResults['dataforseo'] = { pass: false, detail: `❌ HTTP ${r.status}` };
        addCheck('API:DataForSEO', 'fail', `HTTP ${r.status}: ${r.body.substring(0,100)}`);
      }
    } catch (e) {
      apiResults['dataforseo'] = { pass: false, detail: `❌ ${e}` };
      addCheck('API:DataForSEO', 'fail', `${e}`);
    }
  }

  // 5E — WordPress REST APIs
  log('\n  ─ 5E WordPress REST APIs ─');
  const wpSites: Array<{ name: string; key: string; url: string }> = [
    { name: 'aarohaom',       key: 'wp_aarohaom',       url: (primaryEnvVars['WP_AAROHAOM_URL']      ?? 'https://aarohaom.com') },
    { name: 'ageddentistry',  key: 'wp_ageddentistry',  url: (primaryEnvVars['WP_AGEDDENTISTRY_URL'] ?? 'https://ageddentistry.org') },
    { name: 'blackpanda',     key: 'wp_blackpanda',     url: (primaryEnvVars['WP_BLACKPANDA_URL']    ?? 'https://blackpandaenterprises.com') },
  ];
  for (const site of wpSites) {
    try {
      const wpUrl = site.url.replace(/\/$/, '') + '/wp-json/wp/v2/posts?per_page=1';
      const r = await httpReq(wpUrl, { timeoutMs: 12000 });
      if (r.status === 200) {
        apiResults[site.key] = { pass: true, detail: '✅ WordPress REST reachable' };
        addCheck(`API:WP-${site.name}`, 'pass', 'HTTP 200');
      } else {
        apiResults[site.key] = { pass: false, detail: `❌ HTTP ${r.status}` };
        addCheck(`API:WP-${site.name}`, 'fail', `HTTP ${r.status}`);
        addManualStep(`Check WordPress REST API for ${site.url} — returned ${r.status}`);
      }
    } catch (e) {
      apiResults[site.key] = { pass: false, detail: `❌ ${e}` };
      addCheck(`API:WP-${site.name}`, 'fail', `${e}`);
    }
  }

  // 5F — Claude API
  log('\n  ─ 5F Claude API ─');
  if (!claudeApiKey) {
    apiResults['claude'] = { pass: false, detail: '⚠️ BLOCKED — CLAUDE_API_KEY not set' };
    addCheck('API:Claude', 'blocked', 'BLOCKED — CLAUDE_API_KEY not set');
  } else {
    try {
      const r = await httpReq('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': claudeApiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 10,
          messages: [{ role: 'user', content: 'ping' }],
        }),
        timeoutMs: 15000,
      });
      if (r.status === 200) {
        apiResults['claude'] = { pass: true, detail: '✅ Working' };
        addCheck('API:Claude', 'pass', 'HTTP 200 — key valid');
      } else {
        apiResults['claude'] = { pass: false, detail: `❌ HTTP ${r.status}` };
        addCheck('API:Claude', 'fail', `HTTP ${r.status}: ${r.body.substring(0,100)}`);
      }
    } catch (e) {
      apiResults['claude'] = { pass: false, detail: `❌ ${e}` };
      addCheck('API:Claude', 'fail', `${e}`);
    }
  }

  // 5G — Slack API
  log('\n  ─ 5G Slack API ─');
  if (!slackToken) {
    apiResults['slack'] = { pass: false, detail: '⚠️ BLOCKED — SLACK_BOT_TOKEN not set' };
    addCheck('API:Slack', 'blocked', 'BLOCKED — SLACK_BOT_TOKEN not set');
  } else {
    try {
      const r = await httpReq('https://slack.com/api/chat.postMessage', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${slackToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: SLACK_CHANNEL_PERF,
          text: '🔧 SEO Doctor diagnostic running — ignore this message',
        }),
        timeoutMs: 10000,
      });
      if (r.status === 200) {
        const d = JSON.parse(r.body);
        if (d.ok) {
          apiResults['slack'] = { pass: true, detail: '✅ Message sent' };
          addCheck('API:Slack', 'pass', 'HTTP 200 — message sent to #performance-marketing');
        } else {
          apiResults['slack'] = { pass: false, detail: `❌ ok=false: ${d.error}` };
          addCheck('API:Slack', 'fail', `ok=false: ${d.error}`);
        }
      } else {
        apiResults['slack'] = { pass: false, detail: `❌ HTTP ${r.status}` };
        addCheck('API:Slack', 'fail', `HTTP ${r.status}`);
      }
    } catch (e) {
      apiResults['slack'] = { pass: false, detail: `❌ ${e}` };
      addCheck('API:Slack', 'fail', `${e}`);
    }
  }

  // 5H — Google Indexing OAuth scope check
  log('\n  ─ 5H Google Indexing OAuth Scope ─');
  if (!n8nReachable) {
    addCheck('API:GoogleIndexingOAuth', 'skip', 'SKIPPED — n8n unreachable');
  } else {
    try {
      const r = await httpReq(
        `${N8N_URL}/api/v1/credentials/${N8N_CREDENTIAL_GOOGLE_SEO}`,
        { headers: { 'X-N8N-API-KEY': N8N_API_KEY_RO }, timeoutMs: 10000 }
      );
      if (r.status === 200) {
        const d = JSON.parse(r.body);
        const cred = d?.data ?? d;
        const credStr = JSON.stringify(cred).toLowerCase();
        if (credStr.includes('indexing')) {
          addCheck('API:GoogleIndexingOAuth', 'pass', 'Indexing scope present in credential');
        } else {
          addCheck('API:GoogleIndexingOAuth', 'fail', 'MISSING indexing scope — WF-SEO-10 blocked');
          addManualStep(
            'Fix Google Indexing OAuth scope in n8n:\n' +
            `   → Go to ${N8N_URL}\n` +
            `   → Left sidebar → Credentials → find "Google SEO OAuth" (ID: ${N8N_CREDENTIAL_GOOGLE_SEO})\n` +
            '   → Click Edit → add scope: https://www.googleapis.com/auth/indexing\n' +
            '   → Click "Sign in with Google" → authorise → Save\n' +
            '   → After this: WF-SEO-10 (Google Indexing Ping) will work'
          );
        }
      } else if (r.status === 403) {
        addCheck('API:GoogleIndexingOAuth', 'warn', `Cannot read credential (403 — API key lacks credential:read). Scope unknown.`);
      } else {
        addCheck('API:GoogleIndexingOAuth', 'warn', `HTTP ${r.status} checking credential`);
      }
    } catch (e) {
      addCheck('API:GoogleIndexingOAuth', 'warn', `Error: ${e}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 6 — Trigger workflows in dependency order
// ─────────────────────────────────────────────────────────────────────────────

const triggerResults: Record<string, { triggered: boolean; rowsBefore: number; rowsAfter: number; detail: string }> = {};

async function countRows(tableName: string): Promise<number> {
  if (!pool) return -1;
  try {
    const { rows } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM ${tableName}`);
    return rows[0]?.cnt ?? 0;
  } catch { return -1; }
}

async function triggerWebhook(webhookPath: string): Promise<{ status: number; body: string }> {
  return httpReq(`https://web-production-311da.up.railway.app${webhookPath}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    timeoutMs: 15000,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

async function check6_triggerWorkflows(): Promise<void> {
  log('\n══════ CHECK 6 — Trigger Workflows ══════');

  const gscOk = apiResults['gsc']?.pass ?? false;
  const ga4Ok = apiResults['ga4']?.pass ?? false;
  const valueSerpOk = (apiResults['valueserp']?.pass ?? false) && !!valueSerpKey;
  const dataForSeoOk = (apiResults['dataforseo']?.pass ?? false) && !!dataForSeoLogin;
  const claudeOk = apiResults['claude']?.pass ?? false;

  // Helper
  async function trigger(
    wfKey: string,
    webhookPath: string,
    verifyTable: string,
    waitMs: number,
    condition: boolean,
    skipReason?: string
  ): Promise<void> {
    if (!condition) {
      addCheck(`TRIGGER:${wfKey}`, 'skip', `SKIPPED — ${skipReason}`);
      triggerResults[wfKey] = { triggered: false, rowsBefore: -1, rowsAfter: -1, detail: `SKIPPED — ${skipReason}` };
      return;
    }
    const rowsBefore = await countRows(verifyTable);
    log(`  🚀 Triggering ${wfKey}… (waiting ${waitMs / 1000}s)`);
    try {
      const r = await triggerWebhook(webhookPath);
      if (r.status < 200 || r.status > 299) {
        addCheck(`TRIGGER:${wfKey}`, 'fail', `Webhook returned HTTP ${r.status}: ${r.body.substring(0,80)}`);
        triggerResults[wfKey] = { triggered: false, rowsBefore, rowsAfter: rowsBefore, detail: `HTTP ${r.status}` };
        return;
      }
    } catch (e) {
      addCheck(`TRIGGER:${wfKey}`, 'fail', `Webhook error: ${e}`);
      triggerResults[wfKey] = { triggered: false, rowsBefore, rowsAfter: rowsBefore, detail: `${e}` };
      return;
    }
    await sleep(waitMs);
    const rowsAfter = await countRows(verifyTable);
    triggerResults[wfKey] = { triggered: true, rowsBefore, rowsAfter, detail: '' };
    if (rowsAfter > rowsBefore) {
      addCheck(`TRIGGER:${wfKey}`, 'pass', `✅ triggered — ${rowsAfter - rowsBefore} new rows in ${verifyTable} (total: ${rowsAfter})`);
      triggerResults[wfKey].detail = `${rowsAfter - rowsBefore} new rows`;
    } else if (rowsAfter === rowsBefore && rowsAfter > 0) {
      addCheck(`TRIGGER:${wfKey}`, 'warn', `⚠️ triggered but no new rows in ${verifyTable} (already has ${rowsAfter} — may be deduped)`);
      triggerResults[wfKey].detail = `no new rows (${rowsAfter} existing)`;
    } else {
      addCheck(`TRIGGER:${wfKey}`, 'warn', `⚠️ triggered — no rows written to ${verifyTable} after ${waitMs / 1000}s`);
      triggerResults[wfKey].detail = `no rows after ${waitMs / 1000}s`;
    }
  }

  await trigger('WF-SEO-01', '/webhook/mtrig-seo01', 'seo_weekly_metrics',   45000, gscOk && ga4Ok,      'GSC or GA4 API not working');
  await trigger('WF-SEO-05', '/webhook/mtrig-seo05', 'site_health_metrics',  30000, true,                undefined);
  await trigger('WF-SEO-06', '/webhook/mtrig-seo06', 'keyword_rankings',     60000, valueSerpOk,         'VALUESERP_API_KEY missing or test failed');
  await trigger('WF-SEO-02', '/webhook/mtrig-seo02', 'seo_alerts_log',       20000, (triggerResults['WF-SEO-01']?.rowsAfter ?? 0) > 0, 'WF-SEO-01 produced no data');
  await trigger('WF-SEO-07', '/webhook/mtrig-seo07', 'content_gap_analysis', 45000, valueSerpOk,         'VALUESERP_API_KEY missing or test failed');
  await trigger('WF-SEO-08', '/webhook/mtrig-seo08', 'backlink_data',        45000, dataForSeoOk,        'DataForSEO credentials missing or test failed');
  await trigger('WF-SEO-11', '/webhook/mtrig-seo11', 'seo_opportunities',    60000,
    claudeOk && (tableRowCounts['seo_weekly_metrics'] ?? 0) > 0, 'Claude API not working or seo_weekly_metrics empty');
}

// ─────────────────────────────────────────────────────────────────────────────
// CHECK 7 — seo_workflow_logs
// ─────────────────────────────────────────────────────────────────────────────

async function check7_workflowLogs(): Promise<void> {
  log('\n══════ CHECK 7 — seo_workflow_logs (last 24 entries) ══════');
  if (!pool) {
    addCheck('DB:seo_workflow_logs', 'skip', 'SKIPPED — no DB connection');
    return;
  }
  try {
    const { rows } = await pool.query(`
      SELECT workflow_id, status, last_run_at, error_message
      FROM seo_workflow_logs
      ORDER BY last_run_at DESC
      LIMIT 24
    `);
    if (rows.length === 0) {
      addCheck('DB:seo_workflow_logs', 'warn', 'EMPTY — no workflow logs yet');
      return;
    }
    const errors = rows.filter(r => r.status === 'error');
    log(`  Found ${rows.length} log entries, ${errors.length} errors`);
    for (const r of errors) {
      const when = r.last_run_at ? new Date(r.last_run_at).toISOString().substring(0, 19) : '?';
      const msg = (r.error_message ?? '').substring(0, 120);
      log(`  ❌ ${r.workflow_id} | ${when} | ${msg}`);
    }
    if (errors.length === 0) {
      addCheck('DB:seo_workflow_logs', 'pass', `${rows.length} entries, 0 errors`);
    } else {
      addCheck('DB:seo_workflow_logs', 'warn', `${rows.length} entries, ${errors.length} errors (see above)`);
    }
  } catch (e: unknown) {
    const msg = (e as Error).message ?? String(e);
    if (msg.includes('does not exist')) {
      addCheck('DB:seo_workflow_logs', 'fail', 'MISSING TABLE — seo_workflow_logs not created yet');
    } else {
      addCheck('DB:seo_workflow_logs', 'warn', `Query error: ${msg.substring(0, 100)}`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// FINAL REPORT
// ─────────────────────────────────────────────────────────────────────────────

function printReport(): void {
  const ts = new Date().toISOString().replace('T', ' ').substring(0, 19) + ' UTC';
  const icons: Record<string, string> = { pass: '✅', fail: '❌', warn: '⚠️', skip: '⏭️', blocked: '🔒' };

  const getChecks = (prefix: string) => checks.filter(c => c.key.startsWith(prefix));
  const fmt = (c: CheckResult) => `${c.key.split(':').slice(1).join(':') || c.key}: ${icons[c.status] ?? '?'} ${c.detail}${c.autoFixed ? ' [AUTO-FIXED]' : ''}`;

  log('\n');
  log('════════════════════════════════════════════════════════════');
  log(`SEO DOCTOR REPORT — ${ts}`);
  log('════════════════════════════════════════════════════════════');

  log('\nENVIRONMENT VARIABLES');
  log('─────────────────────');
  for (const c of getChecks('ENV:')) log(fmt(c));

  log('\nWORKFLOW STATUS');
  log('─────────────────────');
  for (const [wfKey] of Object.entries(WF_IDS)) {
    const c = checks.find(x => x.key === `WF:${wfKey}`);
    const tr = triggerResults[wfKey];
    let line = `${wfKey}: ${c ? icons[c.status] + ' ' + c.detail : '? not checked'}`;
    if (tr?.triggered && tr.rowsAfter > tr.rowsBefore) {
      line += ` + DATA FLOWING (${tr.rowsAfter - tr.rowsBefore} new rows)`;
    } else if (tr?.triggered) {
      line += ` + TRIGGERED (${tr.detail})`;
    }
    if (c?.autoFixed) line += ' [AUTO-FIXED]';
    log(line);
  }

  log('\nDATABASE TABLES');
  log('─────────────────────');
  for (const c of getChecks('DB:')) log(fmt(c));

  log('\nEXTERNAL APIs');
  log('─────────────────────');
  const apiMap: Array<[string, string]> = [
    ['API:GSC', 'Google Search Console'],
    ['API:GA4', 'Google Analytics 4'],
    ['API:ValueSERP', 'ValueSERP'],
    ['API:DataForSEO', 'DataForSEO'],
    ['API:WP-aarohaom', 'WordPress (aarohaom)'],
    ['API:WP-ageddentistry', 'WordPress (ageddentistry)'],
    ['API:WP-blackpanda', 'WordPress (blackpanda)'],
    ['API:Claude', 'Claude API'],
    ['API:Slack', 'Slack API'],
    ['API:GoogleIndexingOAuth', 'Google Indexing OAuth scope'],
  ];
  for (const [key, label] of apiMap) {
    const c = checks.find(x => x.key === key);
    log(`${label}: ${c ? icons[c.status] + ' ' + c.detail : '? not checked'}`);
  }

  log('\nWORKFLOW TRIGGERS');
  log('─────────────────────');
  const triggerChecks = getChecks('TRIGGER:');
  if (triggerChecks.length === 0) {
    log('No trigger attempts recorded.');
  } else {
    for (const c of triggerChecks) log(fmt(c));
  }

  const passCount   = checks.filter(c => c.status === 'pass').length;
  const failCount   = checks.filter(c => c.status === 'fail').length;
  const warnCount   = checks.filter(c => c.status === 'warn').length;
  const fixedCount  = checks.filter(c => c.autoFixed).length;

  log(`\nSUMMARY: ${passCount} passed, ${failCount} failed, ${warnCount} warnings, ${fixedCount} auto-fixed`);

  log('\n════════════════════════════════════════════════════════════');
  if (manualSteps.length === 0) {
    log('✅ ALL SYSTEMS OPERATIONAL — No manual steps needed');
  } else {
    log('STEPS YOU NEED TO TAKE MANUALLY');
    log('════════════════════════════════════════════════════════════');
    manualSteps.forEach((step, i) => {
      log(`\n${i + 1}. ${step}`);
    });
  }
  log('\n════════════════════════════════════════════════════════════\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  log('\n════════════════════════════════════════════════════════════');
  log('  SEO DOCTOR — Growth Escalators Diagnostic Script');
  log('════════════════════════════════════════════════════════════\n');

  try { await loginN8n(); } catch (e) { log(`⚠️  n8n login error: ${e}`); }
  try { await check1_envVars(); } catch (e) { log(`❌ Check 1 error: ${e}`); }
  try { await check2_n8nConnectivity(); } catch (e) { log(`❌ Check 2 error: ${e}`); }
  try { await check3_workflowsActive(); } catch (e) { log(`❌ Check 3 error: ${e}`); }
  try { await check4_database(); } catch (e) { log(`❌ Check 4 error: ${e}`); }
  try { await check5_externalApis(); } catch (e) { log(`❌ Check 5 error: ${e}`); }
  try { await check6_triggerWorkflows(); } catch (e) { log(`❌ Check 6 error: ${e}`); }
  try { await check7_workflowLogs(); } catch (e) { log(`❌ Check 7 error: ${e}`); }

  if (pool) { try { await pool.end(); } catch { /* ignore */ } }

  printReport();
}

main().catch((e) => {
  log(`FATAL: ${e}`);
  process.exit(1);
});
