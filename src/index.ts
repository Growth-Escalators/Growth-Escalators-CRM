import dotenv from 'dotenv';
dotenv.config();

import express, { type Request, type Response, type NextFunction } from 'express';
import webhooksRouter from './routes/webhooks';
import contactsRouter from './routes/contacts';
import dealsRouter from './routes/deals';
import sequencesRouter from './routes/sequences';
import bookingsRouter from './routes/bookings';
import jobsRouter from './routes/jobs';
import messagesRouter from './routes/messages';
import emailRouter from './routes/email';
import { startStuckJobWorker } from './workers/stuckJobWorker';
import { startSequenceWorker } from './workers/sequenceWorker';

const app = express();

app.use(express.json());

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    env: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
app.use('/webhooks', webhooksRouter);
app.use('/contacts', contactsRouter);
app.use('/deals', dealsRouter);
app.use('/sequences', sequencesRouter);
app.use('/bookings', bookingsRouter);
app.use('/jobs', jobsRouter);
app.use('/messages', messagesRouter);
app.use('/email', emailRouter);

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
