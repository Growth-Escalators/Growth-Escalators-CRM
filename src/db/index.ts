import dotenv from 'dotenv';
dotenv.config();

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  min: 2,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
});

export const db = drizzle(pool, { schema });

// Re-export all tables for convenient imports throughout the app
export {
  tenants,
  contacts,
  contactChannels,
  pipelines,
  deals,
  clients,
  events,
  messages,
  sequences,
  sequenceEnrolments,
  bookings,
  jobs,
  processedEvents,
  waTemplates,
  tasks,
  funnels,
  funnelMembers,
  funnelAssignments,
  contactNotes,
  emailTemplates,
  userPermissions,
  billingClients,
  invoices,
  invoiceLineItems,
  payments,
  invoiceSeries,
} from './schema';
