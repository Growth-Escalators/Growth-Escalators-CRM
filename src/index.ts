import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import { createServer } from 'http';
import express, { type Request, type Response, type NextFunction } from 'express';
import { Server as SocketServer } from 'socket.io';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { db } from './db/index';
import { sql } from 'drizzle-orm';
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
import cashfreeRouter from './routes/cashfree';
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
import socialRouter from './routes/social';
import inboxRouter, { setSocketIO } from './routes/inbox';
import discoverRouter from './routes/discover';
import marketingRouter from './routes/marketing';
import searchRouter from './routes/search';
import auditRouter from './routes/audit';
import cron from 'node-cron';
import { checkAndAlertBlockers } from './services/blockerAlertService';
import { generateMonthlyDraftInvoices } from './services/recurringInvoiceService';
import { requireAuth } from './middleware/auth';
import { startStuckJobWorker } from './workers/stuckJobWorker';
import { startSequenceWorker } from './workers/sequenceWorker';
import { startSocialPostWorker } from './workers/socialPostWorker';

const app = express();

// ---------------------------------------------------------------------------
// Request logging
// ---------------------------------------------------------------------------
app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));

// ---------------------------------------------------------------------------
// JSON body parser
// ---------------------------------------------------------------------------
app.use(express.json());

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
app.use('/auth', authRouter);
app.use('/webhooks', webhooksRouter);
app.use('/book', bookingRouter);
app.use('/api/cashfree', cashfreeRouter);

// ---------------------------------------------------------------------------
// Protected CRM routes (require JWT)
// ---------------------------------------------------------------------------
app.use('/contacts', requireAuth, contactsRouter);
app.use('/deals', requireAuth, dealsRouter);
app.use('/sequences', requireAuth, sequencesRouter);
app.use('/bookings', requireAuth, bookingsRouter);
app.use('/jobs', requireAuth, jobsRouter);
app.use('/messages', requireAuth, messagesRouter);
app.use('/email', requireAuth, emailRouter);
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
app.use('/api/social', requireAuth, socialRouter);
app.use('/api/inbox', requireAuth, inboxRouter);
app.use('/api/outreach/discover', requireAuth, discoverRouter);
app.use('/api/marketing', requireAuth, marketingRouter);
app.use('/api/search', requireAuth, searchRouter);
app.use('/api/audit', requireAuth, auditRouter);

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
  '/api', '/auth', '/webhooks', '/book', '/contacts', '/deals',
  '/sequences', '/jobs', '/email', '/bookings', '/messages',
  '/health', '/stats', '/consulting',
  '/api/automations', '/api/system',
];

// Admin SPA — two ways to access:
//   1. crm.growthescalators.com  (custom domain, root path)
//   2. any-host.railway.app/crm  (path-based, no custom domain needed)
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
// Path-based: /crm and /crm/* on any host
app.use('/crm', express.static(adminDist));
app.get('/crm/{*path}', (_req: Request, res: Response) => {
  res.sendFile(path.join(adminDist, 'index.html'));
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
const migrationsFolder = path.join(__dirname, '..', 'src', 'db', 'migrations');

async function startServer() {
  try {
    console.log('[migrate] running pending migrations…');
    await migrate(db, { migrationsFolder });
    console.log('[migrate] all migrations applied');
  } catch (err) {
    console.error('[migrate] migration failed — starting anyway:', err);
  }

  // Create HTTP server + Socket.io
  const httpServer = createServer(app);
  const io = new SocketServer(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
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

  httpServer.listen(PORT, () => {
    console.log(`Growth Escalators backend running on port ${PORT}`);
    startStuckJobWorker();
    startSequenceWorker();
    startSocialPostWorker();

    // Blocker alert cron — every 6 hours
    cron.schedule('0 23,5,11,17 * * *', async () => {
      console.log('[cron] running blocker alert check…');
      try {
        const result = await checkAndAlertBlockers();
        console.log('[cron] blocker check result:', result);
      } catch (e) {
        console.error('[cron] blocker check failed:', e);
      }
    }, { timezone: 'UTC' });

    console.log('[cron] blocker alert scheduled — every 6 hours (04:30/10:30/16:30/22:30 IST)');

    // Generate monthly draft invoices on the 1st of every month at 9 AM IST (3:30 AM UTC)
    cron.schedule('30 3 1 * *', async () => {
      console.log('[cron] generating monthly draft invoices…');
      try {
        const tenantResult = await db.execute(sql`SELECT id FROM tenants WHERE slug = 'growth-escalators' LIMIT 1`);
        const tenantId = (tenantResult.rows[0] as { id: string } | undefined)?.id;
        if (!tenantId) return;

        const result = await generateMonthlyDraftInvoices(tenantId);
        console.log(`[cron] monthly invoices: generated=${result.generated}, errors=${result.errors.length}`);

        if (result.generated > 0) {
          const { sendSlackDM, SLACK_MEMBERS } = await import('./services/slackService');
          await sendSlackDM(SLACK_MEMBERS.jatin,
            `🧾 *Monthly invoices ready* — ${result.generated} draft invoice(s) generated for this month.\nGo to /crm/billing to review and send.`);
        }
      } catch (e) {
        console.error('[cron] monthly invoice generation failed:', e);
      }
    }, { timezone: 'UTC' });
    console.log('[cron] monthly invoice drafts scheduled — 1st of month at 9 AM IST');

    // Overdue invoice detection — daily at 10 AM IST (4:30 AM UTC)
    cron.schedule('30 4 * * *', async () => {
      console.log('[cron] checking overdue invoices…');
      try {
        const overdueResult = await db.execute(sql`
          SELECT i.id, i.invoice_number, i.total_amount, i.due_date,
                 bc.name as client_name
          FROM invoices i
          JOIN billing_clients bc ON bc.id = i.client_id
          WHERE i.status = 'sent'
            AND i.due_date < now()
            AND i.tenant_id = (SELECT id FROM tenants WHERE slug = 'growth-escalators')
        `);

        for (const inv of overdueResult.rows as Array<Record<string, unknown>>) {
          await db.execute(sql`UPDATE invoices SET status = 'overdue', updated_at = now() WHERE id = ${inv.id}`);
          try {
            const { sendSlackDM, SLACK_MEMBERS } = await import('./services/slackService');
            const amount = ((inv.total_amount as number) / 100).toLocaleString('en-IN');
            const dueDate = new Date(inv.due_date as string).toLocaleDateString('en-IN');
            await sendSlackDM(SLACK_MEMBERS.jatin,
              `⚠️ *Payment overdue*\n\n*Client:* ${inv.client_name}\n*Invoice:* ${inv.invoice_number}\n*Amount:* ₹${amount}\n*Was due:* ${dueDate}\n\nGo to /crm/billing to send a reminder.`);
          } catch { /* slack error non-critical */ }
        }
        if ((overdueResult.rows as unknown[]).length > 0) {
          console.log(`[cron] marked ${(overdueResult.rows as unknown[]).length} invoice(s) as overdue`);
        }
      } catch (e) {
        console.error('[cron] overdue check failed:', e);
      }
    }, { timezone: 'UTC' });
    console.log('[cron] overdue invoice check scheduled — daily at 10 AM IST');
  });
}

startServer();
