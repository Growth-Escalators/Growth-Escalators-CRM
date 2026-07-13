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

// Pool monitoring
pool.on('error', (err) => {
  console.error('[DB POOL] Unexpected error on idle client:', err.message);
});

pool.on('connect', () => {
  const total = pool.totalCount;
  const idle = pool.idleCount;
  const waiting = pool.waitingCount;
  if (idle < 3 && total >= 15) {
    console.warn(`[DB POOL] Low idle connections: idle=${idle}, total=${total}, waiting=${waiting}`);
  }
});

pool.on('remove', () => {
  // Connection was removed from pool (idle timeout) — no action needed
});

export { pool };
export const db = drizzle(pool, { schema });

export function getPoolStats() {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

// Re-export all tables for convenient imports throughout the app
export {
  tenants,
  users,
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
  taskLists,
  taskChecklistItems,
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
  socialAccounts,
  socialPosts,
  discoverySearches,
  discoveryResults,
  discoveryApiUsage,
  marketingAccounts,
  adsInsightsCache,
  auditEvents,
  passwordResetTokens,
  // Outbound tables (previously missing from re-exports)
  prospects,
  signals,
  replies,
  outboundEvents,
  // Wizmatch staffing module tables
  wizmatchCompanies,
  wizmatchCompanyIntelligence,
  wizmatchContactCandidates,
  wizmatchJobSignals,
  wizmatchCandidates,
  wizmatchPlacements,
  wizmatchDomainHealth,
  wizmatchSuppressionList,
  wizmatchRequirements,
  wizmatchCompanyContacts,
  wizmatchCompanyContactRoles,
  wizmatchRequirementContacts,
  wizmatchRequirementAssignments,
  wizmatchStaffingEvents,
  wizmatchTaskLinks,
} from './schema';
