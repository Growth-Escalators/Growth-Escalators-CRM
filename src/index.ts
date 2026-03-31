import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import crypto from 'crypto';
import { createServer } from 'http';
import express, { type Request, type Response, type NextFunction } from 'express';
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
import socialRouter, { oauthRouter as socialOAuthRouter } from './routes/social';
import inboxRouter, { setSocketIO } from './routes/inbox';
import discoverRouter from './routes/discover';
import marketingRouter from './routes/marketing';
import searchRouter from './routes/search';
import auditRouter from './routes/audit';
import seoRouter from './routes/seo';
import seoWorkflowsRouter from './routes/seoWorkflows';
import intelligenceRouter from './routes/intelligence';
// Workers and cron jobs now run via src/worker.ts (see railway.json)
import analyticsRouter from './routes/analytics';
import { requireAuth } from './middleware/auth';

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
app.use('/api/intelligence', requireAuth, intelligenceRouter);

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

async function startServer() {
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

startServer();
