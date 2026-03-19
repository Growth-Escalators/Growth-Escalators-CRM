import dotenv from 'dotenv';
dotenv.config();

import path from 'path';
import express, { type Request, type Response, type NextFunction } from 'express';
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
import healthRouter from './routes/healthRoute';
import { startStuckJobWorker } from './workers/stuckJobWorker';
import { startSequenceWorker } from './workers/sequenceWorker';

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
// Routes
// ---------------------------------------------------------------------------
app.use('/', healthRouter);
app.use('/webhooks', webhooksRouter);
app.use('/contacts', contactsRouter);
app.use('/deals', dealsRouter);
app.use('/sequences', sequencesRouter);
app.use('/bookings', bookingsRouter);
app.use('/jobs', jobsRouter);
app.use('/messages', messagesRouter);
app.use('/email', emailRouter);
app.use('/book', bookingRouter);
app.use('/api/cashfree', cashfreeRouter);

// ---------------------------------------------------------------------------
// Static frontend (SPA) — production only
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../public/client');
  app.use(express.static(clientDist));

  const API_PREFIXES = [
    '/api', '/webhooks', '/book', '/contacts', '/deals',
    '/sequences', '/jobs', '/email', '/bookings', '/messages',
    '/health', '/stats',
  ];

  app.get('*', (req: Request, res: Response, next: NextFunction) => {
    if (API_PREFIXES.some((p) => req.path.startsWith(p))) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

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
// Start server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT ?? 3000;

app.listen(PORT, () => {
  console.log(`Growth Escalators backend running on port ${PORT}`);
  startStuckJobWorker();
  startSequenceWorker();
});
