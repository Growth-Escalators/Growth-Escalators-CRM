import { afterEach, describe, expect, it } from 'vitest';
import express, { type Router } from 'express';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import wizmatchRouter from '../routes/wizmatch';
import wizmatchStaffingRouter, { isStaffingPhaseEnabled } from '../routes/wizmatchStaffing';
import wizmatchPolicyRouter from '../routes/wizmatchPolicy';
import wizmatchTodayRouter from '../routes/wizmatchToday';
import wizmatchPrepareRouter from '../routes/wizmatchPrepare';
import wizmatchTelemetryRouter, {
  WIZMATCH_TELEMETRY_ROUTES,
  ensureWizmatchRouteViewsTable,
} from '../routes/wizmatchTelemetry';

let server: Server | undefined;

async function requestRetiredRouter(router: Router, path = '/api/wizmatch/legacy-path') {
  const app = express();
  app.use(express.json());
  app.use('/api/wizmatch', router);
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  const response = await fetch(`http://127.0.0.1:${port}${path}`);
  const body = await response.json() as { error?: string; message?: string };
  await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
  return { response, body };
}

afterEach(async () => {
  if (!server) return;
  await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

describe('WizMatch backend retirement boundary', () => {
  const retiredRouters: Array<[string, Router]> = [
    ['main API', wizmatchRouter],
    ['staffing', wizmatchStaffingRouter],
    ['policy', wizmatchPolicyRouter],
    ['today workbench', wizmatchTodayRouter],
    ['preparation', wizmatchPrepareRouter],
    ['telemetry', wizmatchTelemetryRouter],
  ];

  it.each(retiredRouters)('%s router returns 410 Gone and never falls through', async (_name, router) => {
    const { response, body } = await requestRetiredRouter(router);
    expect(response.status).toBe(410);
    expect(body).toMatchObject({ error: 'retired' });
  });

  it('keeps every staffing phase disabled regardless of phase', () => {
    expect(isStaffingPhaseEnabled('A')).toBe(false);
    expect(isStaffingPhaseEnabled('B')).toBe(false);
    expect(isStaffingPhaseEnabled('C')).toBe(false);
  });

  it('keeps telemetry registry empty and table bootstrap inert', async () => {
    expect(WIZMATCH_TELEMETRY_ROUTES).toEqual([]);
    await expect(ensureWizmatchRouteViewsTable()).resolves.toBeUndefined();
  });
});
