import dotenv from 'dotenv';
dotenv.config();

import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

export const db = drizzle(pool, { schema });

// Re-export all tables for convenient imports throughout the app
export {
  tenants,
  contacts,
  contactChannels,
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
} from './schema';
