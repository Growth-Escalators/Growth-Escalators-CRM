import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import crypto from 'crypto';
import { createServer } from 'http';
import express, { type Request, type Response, type NextFunction } from 'express';
import helmet from 'helmet';
import { Server as SocketServer } from 'socket.io';
// Migrations run via dist/scripts/migrate.js at startup (see railway.json)
import { pool } from './db/index';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import webhooksRouter from './routes/webhooks';
import contactsRouter from './routes/contacts';
import dealsRouter from './routes/deals';
import sequencesRouter from './routes/sequences';
import bookingsRouter from './routes/bookings';
import jobsRouter from './routes/jobs';
import messagesRouter from './routes/messages';
import emailRouter from './routes/email';
import bookingRouter from './routes/booking';
import cashfreeRouter, { cashfreeAdminRouter } from './routes/cashfree';
import authRouter from './routes/auth';
import healthRouter from './routes/healthRoute';
import pipelinesRouter from './routes/pipelines';
import automationHubRouter from './routes/automationHub';
import systemHealthRouter from './routes/systemHealth';
import emailTemplatesRouter from './routes/emailTemplates';
import capiRouter from './routes/capi';
import clickupRouter from './routes/clickup';
import blockersRouter from './routes/blockers';
import billingRouter from './routes/billing';
import permissionsRouter from './routes/permissions';
import adsRouter from './routes/ads';
import reportsRouter from './routes/reports';
import socialRouter, { oauthRouter as socialOAuthRouter } from './routes/social';
import inboxRouter, { setSocketIO } from './routes/inbox';
import discoverRouter from './routes/discover';
import marketingRouter from './routes/marketing';
import searchRouter from './routes/search';
import auditRouter from './routes/audit';
import seoRouter from './routes/seo';
import seoWorkflowsRouter from './routes/seoWorkflows';
import financeRouter from './routes/finance';
import intelligenceRouter from './routes/intelligence';
import growthOSRouter from './routes/growthOS';
import { ensureGrowthOSTables } from './services/growthOSSetup';
import imapRepliesRouter from './routes/imapReplies';
import { ensureProcessedRepliesTable } from './services/imapService';
import funnelRouter, { ensureFunnelWaitlistTable } from './routes/funnel';
import funnelConfigRouter from './routes/funnelConfig';
import { ensureFunnelConfigTable, ensureDeliveryLogTable, seedDefaultFunnelConfigs } from './services/funnelConfigService';
import { ensurePipelineContactsTable, ensureOutreachPipelines } from './services/pipelineService';
import outreachLeadsRouter from './routes/outreachLeads';
import { ensureOutreachLeadsTable } from './services/outreachLeadsService';
// Workers and cron jobs now run via src/worker.ts (see railway.json)
import analyticsRouter from './routes/analytics';
import whatsappTemplatesRouter from './routes/whatsappTemplates';
import linksRouter from './routes/links';
import intelligenceChatRouter from './routes/intelligenceChat';
import clientDetailRouter from './routes/clientDetail';
import selfServiceRouter from './routes/selfService';
import tasksRouter from './routes/tasks';
import taskListsRouter from './routes/task-lists';
import teamRouter from './routes/team';
import { requireAuth, optionalAuth } from './middleware/auth';
import { validateEnv } from './config/env';

const app = express();

// ---------------------------------------------------------------------------
// Security headers
// ---------------------------------------------------------------------------
app.use(helmet({
  contentSecurityPolicy: false, // CRM frontend loads inline scripts
  crossOriginEmbedderPolicy: false, // Allow embedding (n8n iframes)
}));

// ---------------------------------------------------------------------------
// Request logging
// ---------------------------------------------------------------------------
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ---------------------------------------------------------------------------
// JSON body parser
// ---------------------------------------------------------------------------
app.use(express.json());

// ---------------------------------------------------------------------------
// Request ID middleware
// ---------------------------------------------------------------------------
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests' },
});

const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'too many requests' },
});

app.use('/webhooks', webhookLimiter);
app.use(generalLimiter);

// ---------------------------------------------------------------------------
// Public routes (no auth required)
// ---------------------------------------------------------------------------
app.use('/', healthRouter);
app.use('/api', healthRouter); // alias: /api/health matches the /api/* convention used by external monitors
app.use('/auth', authRouter);
app.use('/webhooks', webhooksRouter);
app.use('/book', bookingRouter);
app.use('/api/cashfree', cashfreeRouter);
app.use('/api/cashfree', requireAuth, cashfreeAdminRouter); // simulate-webhook + debug-orders (admin-only)

// ---------------------------------------------------------------------------
// Protected CRM routes (require JWT)
// ---------------------------------------------------------------------------
app.use('/api/contacts', requireAuth, contactsRouter);
app.use('/api/deals', requireAuth, dealsRouter);
app.use('/api/sequences', requireAuth, sequencesRouter);
app.use('/api/bookings', requireAuth, bookingsRouter);
app.use('/api/jobs', requireAuth, jobsRouter);
app.use('/api/messages', requireAuth, messagesRouter);
app.use('/api/email', requireAuth, emailRouter);
app.use('/api/pipelines', requireAuth, pipelinesRouter);
app.use('/api/automations', requireAuth, automationHubRouter);
app.use('/api/system', systemHealthRouter);
app.use('/api/email-templates', requireAuth, emailTemplatesRouter);
app.use('/api/capi', requireAuth, capiRouter);
app.use('/api/clickup', requireAuth, clickupRouter);
app.use('/api/blockers', requireAuth, blockersRouter);
app.use('/api/billing', requireAuth, billingRouter);
app.use('/api/permissions', requireAuth, permissionsRouter);
app.use('/api/ads', requireAuth, adsRouter);
app.use('/api/reports', requireAuth, reportsRouter);
app.use('/api/social/oauth', socialOAuthRouter); // no auth — browser redirects can't send headers
app.use('/api/social', requireAuth, socialRouter);
app.use('/api/inbox', requireAuth, inboxRouter);
app.use('/api/outreach/discover', requireAuth, discoverRouter);
app.use('/api/marketing', requireAuth, marketingRouter);
app.use('/api/search', requireAuth, searchRouter);
app.use('/api/audit', requireAuth, auditRouter);
app.use('/api/analytics', requireAuth, analyticsRouter);
app.use('/api/seo', requireAuth, seoRouter);
app.use('/api/seo-workflows', requireAuth, seoWorkflowsRouter);
app.use('/api/finance', requireAuth, financeRouter);
app.use('/api/intelligence', requireAuth, intelligenceRouter);
app.use('/api/growth-os', requireAuth, growthOSRouter);
app.use('/api/whatsapp', requireAuth, whatsappTemplatesRouter);
app.use('/api/outreach/imap', imapRepliesRouter);
app.use('/api/outreach/leads', optionalAuth, outreachLeadsRouter);
app.use('/api/links', requireAuth, linksRouter);
app.use('/api/intelligence', requireAuth, intelligenceChatRouter);
app.use('/api/clients', requireAuth, clientDetailRouter);
app.use('/api/self-service', requireAuth, selfServiceRouter);
app.use('/api/tasks', requireAuth, tasksRouter);
app.use('/api/task-lists', requireAuth, taskListsRouter);
app.use('/api/team', requireAuth, teamRouter);
app.use('/api/funnel', funnelRouter);
// Public funnel config endpoint (no auth — used by checkout frontend)
app.get('/api/funnel-configs/public/:slug', (req, res, next) => { funnelConfigRouter(req, res, next); });
app.use('/api/funnel-configs', requireAuth, funnelConfigRouter);

// ---------------------------------------------------------------------------
// POST /api/feedback — Receive user feedback from CRM, send to Slack + store
// ---------------------------------------------------------------------------
app.post('/api/feedback', requireAuth, async (req: Request, res: Response) => {
  const { type, message, page, userName, userEmail, userRole } = req.body as {
    type?: string; message?: string; page?: string; userName?: string; userEmail?: string; userRole?: string;
  };
  if (!message) { res.status(400).json({ error: 'message required' }); return; }

  const emoji = type === 'bug' ? '🐛' : type === 'question' ? '❓' : '💡';
  const label = type === 'bug' ? 'Bug Report' : type === 'question' ? 'Question' : 'Suggestion';

  // Store in database
  const tenantId = req.user!.tenantId;
  pool.query(
    `INSERT INTO events (id, tenant_id, contact_id, event_type, payload, created_at)
     VALUES (gen_random_uuid(), $1, NULL, 'crm_feedback', $2::jsonb, NOW())`,
    [tenantId, JSON.stringify({ type, message, page, userName, userEmail, userRole, createdAt: new Date().toISOString() })],
  ).catch(() => {});

  // Send to Slack
  try {
    const { sendSlackMessage } = await import('./services/slackService');
    await sendSlackMessage(process.env.SLACK_SOD_EOD_CHANNEL || 'C08EMRX2HHN',
      `${emoji} *CRM ${label}*\n` +
      `From: ${userName || 'Unknown'} (${userEmail || 'no email'}) — ${userRole || 'staff'}\n` +
      `Page: ${page || '/'}\n\n` +
      `> ${message}`,
    );
  } catch { /* non-critical */ }

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Static frontend — hostname-based routing
// ---------------------------------------------------------------------------
const clientDist = path.join(__dirname, '..', 'public', 'client');
const adminDist  = path.join(__dirname, '..', 'public', 'admin');

console.log('Client dist:', clientDist);
console.log('Admin dist:', adminDist);

const CRM_HOSTS = ['crm.growthescalators.com'];
const CONSULTING_HOSTS = ['consulting.growthescalators.com'];
const API_PREFIXES = [
  '/api', '/auth', '/webhooks', '/book',
  '/health', '/stats', '/consulting',
];

// Admin SPA — served at root on crm.growthescalators.com.
// Legacy `/crm/<path>` URLs are 301-redirected to `/<path>` further below.
if (process.env.CRM_EXTRA_HOST) CRM_HOSTS.push(process.env.CRM_EXTRA_HOST);

// ---------------------------------------------------------------------------
// Consulting landing page — path-based (/consulting) + subdomain-based
// ---------------------------------------------------------------------------
const consultingDist = path.join(__dirname, '..', 'consulting');

// Path-based: /consulting and /consulting/* on any host
app.get('/consulting', (_req: Request, res: Response) => {
  res.sendFile(path.join(consultingDist, 'index.html'));
});
app.use('/consulting', express.static(consultingDist));
app.get('/consulting/{*path}', (_req: Request, res: Response) => {
  res.sendFile(path.join(consultingDist, 'index.html'));
});

// Subdomain-based: consulting.growthescalators.com at root
app.use((req: Request, res: Response, next: NextFunction) => {
  if (CONSULTING_HOSTS.includes(req.hostname)) {
    express.static(consultingDist)(req, res, () => {
      if (API_PREFIXES.some((p) => req.path.startsWith(p))) return next();
      res.sendFile(path.join(consultingDist, 'index.html'));
    });
  } else {
    next();
  }
});

// ---------------------------------------------------------------------------
// Legacy redirect: old `/crm/<path>` URLs (bookmarks, Slack messages, emails)
// → bare `/<path>`. The CRM is now served at root on crm.growthescalators.com,
// so the `/crm/` prefix is no longer canonical. Strip it and 301 forever.
app.get('/crm', (_req: Request, res: Response) => {
  res.redirect(301, '/');
});
app.get('/crm/{*path}', (req: Request, res: Response) => {
  const stripped = req.originalUrl.replace(/^\/crm/, '') || '/';
  res.redirect(301, stripped);
});

// Hostname-based: crm.growthescalators.com at root
app.use((req: Request, res: Response, next: NextFunction) => {
  if (CRM_HOSTS.includes(req.hostname)) {
    express.static(adminDist)(req, res, () => {
      if (API_PREFIXES.some((p) => req.path.startsWith(p))) return next();
      res.sendFile(path.join(adminDist, 'index.html'));
    });
  } else {
    next();
  }
});

// D2C client SPA (ecom.growthescalators.com + Railway domain)
app.use(express.static(clientDist));

app.get('/{*path}', (req: Request, res: Response, next: NextFunction) => {
  if (API_PREFIXES.some((p) => req.path.startsWith(p))) return next();
  res.sendFile(path.join(clientDist, 'index.html'));
});

// ---------------------------------------------------------------------------
// 404 handler
// ---------------------------------------------------------------------------
app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: 'route not found' });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'internal server error' });
});

// ---------------------------------------------------------------------------
// Start server (run pending DB migrations first)
// ---------------------------------------------------------------------------
const PORT = process.env.PORT ?? 3000;

async function startServer() {
  // Create HTTP server + Socket.io
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: {
      origin: [
        'https://crm.growthescalators.com',
        'https://ecom.growthescalators.com',
        ...(process.env.NODE_ENV !== 'production' ? ['http://localhost:5173', 'http://localhost:3000'] : []),
      ],
      methods: ['GET', 'POST'],
    },
    path: '/socket.io',
  });

  // Inject socket.io into inbox router
  setSocketIO(io);

  // Socket.io: clients join room by contactId for real-time inbox
  io.on('connection', (socket) => {
    console.log('[socket.io] client connected:', socket.id);

    socket.on('join_contact', (contactId: string) => {
      socket.join(`contact:${contactId}`);
    });

    socket.on('leave_contact', (contactId: string) => {
      socket.leave(`contact:${contactId}`);
    });

    socket.on('disconnect', () => {
      console.log('[socket.io] client disconnected:', socket.id);
    });
  });

  // Bootstrap Growth OS tables
  ensureGrowthOSTables().catch(e => console.error('[startup] Growth OS table bootstrap failed:', e));
  // Bootstrap IMAP reply dedup table
  ensureProcessedRepliesTable().catch(e => console.error('[startup] IMAP processed_replies table bootstrap failed:', e));
  // Bootstrap funnel waitlist table
  ensureFunnelWaitlistTable().catch(e => console.error('[startup] Funnel waitlist table bootstrap failed:', e));
  // Bootstrap pipeline_contacts tracking table
  ensurePipelineContactsTable().catch(e => console.error('[startup] Pipeline contacts table bootstrap failed:', e));
  // Bootstrap Agency Owners and Freelancer pipelines
  ensureOutreachPipelines().catch(e => console.error('[startup] Outreach pipelines bootstrap failed:', e));
  // Bootstrap outreach_leads table for WF-01 enrichment pipeline
  ensureOutreachLeadsTable().catch(e => console.error('[startup] outreach_leads table bootstrap failed:', e));
  // Bootstrap finance tables
  import('./services/financeService').then(m => m.ensureFinanceTables()).catch(e => console.error('[startup] Finance tables bootstrap failed:', e));
  // Bootstrap funnel_configs + purchase_delivery_log tables, then seed defaults
  ensureFunnelConfigTable()
    .then(() => ensureDeliveryLogTable())
    .then(async () => {
      // Seed default funnel configs for the first tenant found
      const tenantRes = await pool.query(`SELECT id FROM tenants LIMIT 1`);
      if (tenantRes.rows.length > 0) {
        await seedDefaultFunnelConfigs((tenantRes.rows[0] as { id: string }).id);
      }
    })
    .catch(e => console.error('[startup] Funnel config / delivery log bootstrap failed:', e));
  // Bootstrap SEO tables (site_health_metrics, seo_opportunities, seo_alerts_log) THEN seed knowledge base
  import('./services/seoWorkflowHealthService').then(m => m.ensureSeoTables())
    .then(() => import('./services/seoKnowledgeBase').then(m => m.seedClientKnowledgeBase()))
    .catch(e => console.error('[startup] SEO tables/seed failed:', e));
  // Bootstrap deal activity columns + table
  pool.query(`
    ALTER TABLE pipelines ADD COLUMN IF NOT EXISTS stage_config JSONB DEFAULT '{}'::jsonb;
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS source VARCHAR(100);
    ALTER TABLE deals ADD COLUMN IF NOT EXISTS probability INTEGER;
    CREATE TABLE IF NOT EXISTS deal_activities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      deal_id UUID NOT NULL,
      contact_id UUID,
      activity_type VARCHAR(50) NOT NULL DEFAULT 'note',
      from_stage VARCHAR(200),
      to_stage VARCHAR(200),
      note TEXT,
      created_by VARCHAR(200),
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_deal_activities_deal_id ON deal_activities(deal_id);
    CREATE INDEX IF NOT EXISTS idx_deal_activities_tenant ON deal_activities(tenant_id);
  `).catch(e => console.error('[startup] Deal activities bootstrap failed:', e));
  // Bootstrap retainer tables
  import('./services/retainerService').then(m => m.ensureRetainerTables()).catch(e => console.error('[startup] Retainer tables bootstrap failed:', e));
  // Bootstrap audit logs table
  import('./services/auditLogger').then(m => m.ensureAuditLogsTable()).catch(e => console.error('[startup] Audit logs bootstrap failed:', e));
  // Bootstrap SEO content calendar table
  import('./services/seoContentGapService').then(m => m.ensureContentCalendarTable()).catch(e => console.error('[startup] Content calendar bootstrap failed:', e));
  // Bootstrap creative intelligence columns + client benchmarks table
  import('./services/creativeIntelligenceService').then(m => m.ensureCreativeIntelligenceColumns()).catch(e => console.error('[startup] Creative intel columns failed:', e));
  import('./services/metaAdsService').then(m => m.ensureClientBenchmarksTable()).catch(e => console.error('[startup] Client benchmarks bootstrap failed:', e));

  // One-time startup: comprehensive backfill — finds ALL purchases and places them
  // Runs 20s after boot. Looks at deals + contacts (not just slo_purchase events)
  // because the webhook was broken and no events were created for past purchases.
  setTimeout(async () => {
    try {
      const { pool: dbPool } = await import('./db/index');
      const { placePipelineContact, ensurePipelineContactsTable } = await import('./services/pipelineService');

      await ensurePipelineContactsTable();

      const pipesCheck = await dbPool.query("SELECT name FROM pipelines WHERE is_active = true");
      console.log(`[startup-backfill] Active pipelines: ${pipesCheck.rows.map((r: {name: string}) => r.name).join(', ') || 'NONE'}`);
      if (pipesCheck.rows.length === 0) {
        console.warn('[startup-backfill] No active pipelines found — skipping');
        return;
      }

      // Phase 1: Find ALL contacts with purchase evidence NOT in a pipeline
      // Sources: deals, slo_buyer tag, paymentStatus=paid metadata
      const { rows: purchaseContacts } = await dbPool.query(`
        SELECT DISTINCT ON (c.id)
          c.id AS contact_id, c.first_name, c.last_name, c.tenant_id,
          c.metadata, c.tags,
          d.value AS deal_value
        FROM contacts c
        LEFT JOIN deals d ON d.contact_id = c.id
        WHERE (
          d.id IS NOT NULL
          OR 'slo_buyer' = ANY(c.tags)
          OR c.metadata->>'paymentStatus' = 'paid'
        )
        AND NOT EXISTS (
          SELECT 1 FROM pipeline_contacts pc WHERE pc.contact_id = c.id
        )
        ORDER BY c.id, d.created_at DESC
      `);

      console.log(`[startup-backfill] Found ${purchaseContacts.length} unplaced purchase contact(s)`);

      if (purchaseContacts.length === 0) {
        // Still fix orphan deals (pipeline_id = NULL)
        const orphanDeals = await dbPool.query("SELECT COUNT(*)::int AS count FROM deals WHERE pipeline_id IS NULL");
        const orphanCount = (orphanDeals.rows[0] as { count: number }).count;
        if (orphanCount > 0) {
          console.log(`[startup-backfill] Fixing ${orphanCount} orphan deal(s)...`);
          await dbPool.query(`
            UPDATE deals d SET pipeline_id = pc.pipeline_id, stage = pc.stage_name, updated_at = NOW()
            FROM pipeline_contacts pc WHERE d.contact_id = pc.contact_id AND d.pipeline_id IS NULL
          `);
          const fixed = await dbPool.query("SELECT COUNT(*)::int AS count FROM deals WHERE pipeline_id IS NULL");
          console.log(`[startup-backfill] Orphan deals: ${orphanCount - (fixed.rows[0] as { count: number }).count} fixed, ${(fixed.rows[0] as { count: number }).count} remain`);
        }
        return;
      }

      let placed = 0;
      let failed = 0;
      let eventsCreated = 0;

      for (const row of purchaseContacts as Array<Record<string, unknown>>) {
        const contactId = row.contact_id as string;
        const tenantId = row.tenant_id as string;
        const meta = (row.metadata || {}) as Record<string, unknown>;
        const tags = (row.tags || []) as string[];
        const dealValue = row.deal_value ? Number(row.deal_value) : null;

        // Determine segment
        let segment = (meta.segment as string) || 'd2c';
        if (segment === 'unknown') {
          if (tags.some(t => t.includes('agency'))) segment = 'agency';
          else if (tags.some(t => t.includes('freelancer'))) segment = 'freelancer';
          else segment = 'd2c';
        }

        const amount = typeof meta.paidAmount === 'number' ? Math.round(meta.paidAmount) : (dealValue ? Math.round(dealValue) : 9);
        const funnelSlug = (meta.funnelSlug as string) || 'ecom';

        // Create missing slo_purchase event
        const existing = await dbPool.query(
          "SELECT id FROM events WHERE event_type = 'slo_purchase' AND contact_id = $1 LIMIT 1", [contactId],
        );
        if (existing.rows.length === 0) {
          await dbPool.query(
            `INSERT INTO events (id, tenant_id, contact_id, event_type, payload, created_at)
             VALUES (gen_random_uuid(), $1, $2, 'slo_purchase', $3::jsonb, NOW())`,
            [tenantId, contactId, JSON.stringify({ amount, segment, products: ['core_product'], funnelSlug, backfilled: true })],
          );
          eventsCreated++;
        }

        // Place in pipeline
        try {
          const r = await placePipelineContact({
            contactId, segment, amount,
            bump1: Boolean(meta.bump1), bump2: Boolean(meta.bump2),
            tenantId, funnelSlug,
          });
          if (r.success) {
            placed++;
            console.log(`[startup-backfill] Placed ${row.first_name} ${row.last_name || ''} → ${r.pipeline} / ${r.stage}`);
          } else {
            failed++;
            console.warn(`[startup-backfill] FAILED for ${row.first_name}: pipeline=${r.pipeline}, stage=${r.stage}`);
          }
        } catch (e) {
          failed++;
          console.error(`[startup-backfill] ERROR for ${contactId}:`, (e as Error).message);
        }
      }
      console.log(`[startup-backfill] Complete: ${placed} placed, ${failed} failed, ${eventsCreated} events created`);
    } catch (e) { console.error('[startup-backfill] FATAL:', e); }
  }, 20000);

  // One-time startup: run PageSpeed if site_health_metrics is empty
  setTimeout(async () => {
    try {
      const { pool: dbPool } = await import('./db/index');
      const r = await dbPool.query(`SELECT COUNT(*)::int AS c FROM site_health_metrics`);
      if ((r.rows[0] as { c: number }).c === 0) {
        console.log('[startup] site_health_metrics empty — running PageSpeed checks');
        const { runPageSpeedChecks } = await import('./services/pagespeedService');
        const result = await runPageSpeedChecks();
        console.log(`[startup] PageSpeed: ${result.checked} checked, ${result.errors} errors`);
      }
    } catch (e) { console.error('[startup] PageSpeed check failed:', e); }
  }, 10000); // 10 seconds after startup

  // One-time startup: generate programmatic pages if client_pages is empty
  setTimeout(async () => {
    try {
      const { pool: dbPool } = await import('./db/index');
      // Ensure programmatic SEO columns exist on the Drizzle-managed client_pages table
      const { ensureClientPagesTable } = await import('./services/programmaticSeoService');
      await ensureClientPagesTable();
      const r = await dbPool.query(`SELECT COUNT(*)::int AS c FROM client_pages WHERE client_domain = 'ageddentistry.org'`);
      if ((r.rows[0] as { c: number }).c === 0) {
        console.log('[startup] No programmatic pages — generating for Aged Dentistry');
        const { generateLocationPages } = await import('./services/programmaticSeoService');
        const result = await generateLocationPages();
        console.log(`[startup] Programmatic SEO: ${result.generated} generated, ${result.wpPublished} to WordPress, ${result.errors} errors`);
      }
    } catch (e) { console.error('[startup] Programmatic page generation failed:', e); }
  }, 15000); // 15 seconds after startup

  validateEnv();

  httpServer.listen(PORT, () => {
    console.log(`Growth Escalators backend running on port ${PORT}`);
    // Workers and cron jobs now run in a separate process (src/worker.ts)

    // -----------------------------------------------------------------------
    // Graceful shutdown
    // -----------------------------------------------------------------------
    const shutdown = async (signal: string) => {
      console.log(`[shutdown] ${signal} received — starting graceful shutdown…`);

      // 1. Stop accepting new connections
      console.log('[shutdown] closing HTTP server…');
      httpServer.close(() => {
        console.log('[shutdown] HTTP server closed');
      });

      // 2. Close Socket.io
      io.close();
      console.log('[shutdown] Socket.io closed');

      // 3. Wait up to 10s for in-flight requests
      await new Promise(resolve => setTimeout(resolve, 10_000));

      // 4. Close database pool
      try {
        await pool.end();
        console.log('[shutdown] database pool closed');
      } catch (e) {
        console.error('[shutdown] error closing database pool:', e);
      }

      console.log('[shutdown] graceful shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  });
}

// ---------------------------------------------------------------------------
// Global unhandled error safety net
// ---------------------------------------------------------------------------
process.on('unhandledRejection', (reason: unknown) => {
  console.error('[FATAL] Unhandled promise rejection:', reason);
  // Don't exit — log and continue. Railway will capture the log.
});

process.on('uncaughtException', (error: Error) => {
  console.error('[FATAL] Uncaught exception:', error);
  // Exit after logging — let Railway restart the process
  process.exit(1);
});

startServer();
