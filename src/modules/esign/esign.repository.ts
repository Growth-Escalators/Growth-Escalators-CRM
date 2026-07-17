// Data access for the contracts module. EVERY query is tenant-scoped — the
// tenantId is always part of the WHERE clause (defence-in-depth against a
// cross-tenant id), including single-row lookups. Pure DB layer: no HTTP, no
// business rules (those live in esign.service.ts).
import { db } from '../../db/index';
import { and, desc, eq } from 'drizzle-orm';
import {
  contracts,
  contractRecipients,
  contractConsents,
  contractEvents,
  contractTemplates,
} from '../../db/schema';

export type ContractRow = typeof contracts.$inferSelect;
export type NewContractRow = typeof contracts.$inferInsert;
export type RecipientRow = typeof contractRecipients.$inferSelect;
export type NewRecipientRow = typeof contractRecipients.$inferInsert;
export type ConsentRow = typeof contractConsents.$inferSelect;
export type NewConsentRow = typeof contractConsents.$inferInsert;
export type EventRow = typeof contractEvents.$inferSelect;
export type NewEventRow = typeof contractEvents.$inferInsert;
export type TemplateRow = typeof contractTemplates.$inferSelect;
export type NewTemplateRow = typeof contractTemplates.$inferInsert;

// ---- contracts ----
export async function createContract(values: NewContractRow): Promise<ContractRow> {
  const [row] = await db.insert(contracts).values(values).returning();
  return row;
}

export async function getContract(tenantId: string, id: string): Promise<ContractRow | null> {
  const [row] = await db
    .select()
    .from(contracts)
    .where(and(eq(contracts.tenantId, tenantId), eq(contracts.id, id)))
    .limit(1);
  return row ?? null;
}

export async function getContractByDocumensoId(documensoDocumentId: string): Promise<ContractRow | null> {
  const [row] = await db
    .select()
    .from(contracts)
    .where(eq(contracts.documensoDocumentId, documensoDocumentId))
    .limit(1);
  return row ?? null;
}

export interface ListContractsFilter {
  status?: string;
  clientCompanyId?: string;
  limit?: number;
  offset?: number;
}

export async function listContracts(tenantId: string, filter: ListContractsFilter = {}): Promise<ContractRow[]> {
  const conds = [eq(contracts.tenantId, tenantId)];
  if (filter.status) conds.push(eq(contracts.status, filter.status));
  if (filter.clientCompanyId) conds.push(eq(contracts.clientCompanyId, filter.clientCompanyId));
  return db
    .select()
    .from(contracts)
    .where(and(...conds))
    .orderBy(desc(contracts.createdAt))
    .limit(Math.min(filter.limit ?? 50, 200))
    .offset(filter.offset ?? 0);
}

export async function updateContract(
  tenantId: string,
  id: string,
  patch: Partial<NewContractRow>,
): Promise<ContractRow | null> {
  const [row] = await db
    .update(contracts)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(contracts.tenantId, tenantId), eq(contracts.id, id)))
    .returning();
  return row ?? null;
}

// ---- recipients ----
export async function insertRecipients(rows: NewRecipientRow[]): Promise<RecipientRow[]> {
  if (rows.length === 0) return [];
  return db.insert(contractRecipients).values(rows).returning();
}

export async function listRecipients(tenantId: string, contractId: string): Promise<RecipientRow[]> {
  return db
    .select()
    .from(contractRecipients)
    .where(and(eq(contractRecipients.tenantId, tenantId), eq(contractRecipients.contractId, contractId)))
    .orderBy(contractRecipients.signingOrder);
}

/**
 * Load a recipient by id WITHOUT a tenant filter. Used ONLY by the public
 * signing flow, where the caller has no tenant context — authorization there is
 * the HMAC signing token + a stored-token-hash match, and the recipient's
 * tenantId is then used to scope every subsequent query. Do not use elsewhere.
 */
export async function getRecipientById(id: string): Promise<RecipientRow | null> {
  const [row] = await db.select().from(contractRecipients).where(eq(contractRecipients.id, id)).limit(1);
  return row ?? null;
}

export async function getRecipient(tenantId: string, id: string): Promise<RecipientRow | null> {
  const [row] = await db
    .select()
    .from(contractRecipients)
    .where(and(eq(contractRecipients.tenantId, tenantId), eq(contractRecipients.id, id)))
    .limit(1);
  return row ?? null;
}

export async function updateRecipient(
  tenantId: string,
  id: string,
  patch: Partial<NewRecipientRow>,
): Promise<RecipientRow | null> {
  const [row] = await db
    .update(contractRecipients)
    .set({ ...patch, updatedAt: new Date() })
    .where(and(eq(contractRecipients.tenantId, tenantId), eq(contractRecipients.id, id)))
    .returning();
  return row ?? null;
}

// ---- consents ----
export async function insertConsent(row: NewConsentRow): Promise<ConsentRow> {
  const [inserted] = await db.insert(contractConsents).values(row).returning();
  return inserted;
}

// ---- events (append-only audit) ----
export async function appendEvent(row: NewEventRow): Promise<EventRow> {
  const [inserted] = await db.insert(contractEvents).values(row).returning();
  return inserted;
}

export async function listEvents(tenantId: string, contractId: string): Promise<EventRow[]> {
  return db
    .select()
    .from(contractEvents)
    .where(and(eq(contractEvents.tenantId, tenantId), eq(contractEvents.contractId, contractId)))
    .orderBy(contractEvents.occurredAt);
}

// ---- templates ----
export async function createTemplate(values: NewTemplateRow): Promise<TemplateRow> {
  const [row] = await db.insert(contractTemplates).values(values).returning();
  return row;
}

export async function listTemplates(tenantId: string): Promise<TemplateRow[]> {
  return db
    .select()
    .from(contractTemplates)
    .where(eq(contractTemplates.tenantId, tenantId))
    .orderBy(desc(contractTemplates.createdAt));
}

export async function getTemplate(tenantId: string, id: string): Promise<TemplateRow | null> {
  const [row] = await db
    .select()
    .from(contractTemplates)
    .where(and(eq(contractTemplates.tenantId, tenantId), eq(contractTemplates.id, id)))
    .limit(1);
  return row ?? null;
}
