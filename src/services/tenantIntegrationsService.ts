/**
 * Per-tenant integration credential store (Phase 3 of the white-label
 * effort — see `src/db/schema.ts` `tenantIntegrations` table doc comment).
 *
 * This service owns ALL reads/writes of `tenant_integrations`. The one rule
 * that must never be broken: a decrypted credential value must never leave
 * this module in anything that could reach an HTTP response. `PublicIntegration`
 * (returned by `listIntegrations`/`getIntegrationStatus`/`upsertIntegrationCredentials`/
 * `disconnectIntegration`) is an explicit field whitelist that does not
 * include `encryptedCredentials` even as ciphertext. Only
 * `getDecryptedCredentials` returns the real secret, and it is meant to be
 * called exclusively from server-side sending code (e.g.
 * `multiDomainMailer.ts`), never from a route handler's response path.
 *
 * Table import note: this file imports `tenantIntegrations` directly from
 * `../db/schema` (not the `../db/index` re-export) so that a caller further
 * up the import chain (e.g. `multiDomainMailer.ts`, whose own tests mock
 * `../db/index` down to just `{ pool: { query } }`) can mock `db` alone
 * without also needing to fake out the real Drizzle column objects `eq()`/
 * `and()` operate on.
 */

import { and, eq } from 'drizzle-orm';
import { db } from '../db/index';
import { tenantIntegrations } from '../db/schema';
import { decryptCredentialsJSON, encryptCredentialsJSON } from './credentialEncryption';

export type IntegrationRow = typeof tenantIntegrations.$inferSelect;

export interface PublicIntegration {
  id: string;
  tenantId: string;
  provider: string;
  status: string;
  metadata: unknown;
  createdAt: Date | null;
  updatedAt: Date | null;
}

// Explicit whitelist — deliberately excludes `encryptedCredentials`. Adding a
// field here is a security-relevant change, not a routine refactor.
function toPublicIntegration(row: IntegrationRow): PublicIntegration {
  return {
    id: row.id,
    tenantId: row.tenantId,
    provider: row.provider,
    status: row.status,
    metadata: row.metadata,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** All integrations for a tenant — status/metadata only, never secrets. */
export async function listIntegrations(tenantId: string): Promise<PublicIntegration[]> {
  const rows = await db.select().from(tenantIntegrations)
    .where(eq(tenantIntegrations.tenantId, tenantId));
  return rows.map(toPublicIntegration);
}

/** A single provider's connection status for a tenant, or null if never configured. */
export async function getIntegrationStatus(tenantId: string, provider: string): Promise<PublicIntegration | null> {
  const [row] = await db.select().from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, provider)))
    .limit(1);
  return row ? toPublicIntegration(row) : null;
}

/**
 * Encrypts and stores credentials for (tenantId, provider), creating the row
 * if it doesn't exist yet, and marks it 'connected'. Returns status/metadata
 * only — never the credentials just written.
 */
export async function upsertIntegrationCredentials(
  tenantId: string,
  provider: string,
  credentials: unknown,
  metadata?: Record<string, unknown>,
): Promise<PublicIntegration> {
  const encryptedCredentials = encryptCredentialsJSON(credentials);

  const [existing] = await db.select().from(tenantIntegrations)
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, provider)))
    .limit(1);

  let row: IntegrationRow;
  if (existing) {
    [row] = await db.update(tenantIntegrations)
      .set({
        encryptedCredentials,
        metadata: metadata ?? existing.metadata,
        status: 'connected',
        updatedAt: new Date(),
      })
      .where(eq(tenantIntegrations.id, existing.id))
      .returning();
  } else {
    [row] = await db.insert(tenantIntegrations)
      .values({
        tenantId,
        provider,
        encryptedCredentials,
        metadata: metadata ?? {},
        status: 'connected',
      })
      .returning();
  }
  return toPublicIntegration(row);
}

/** Marks a provider disconnected and wipes the stored ciphertext. */
export async function disconnectIntegration(tenantId: string, provider: string): Promise<PublicIntegration | null> {
  const [row] = await db.update(tenantIntegrations)
    .set({ encryptedCredentials: null, status: 'disconnected', updatedAt: new Date() })
    .where(and(eq(tenantIntegrations.tenantId, tenantId), eq(tenantIntegrations.provider, provider)))
    .returning();
  return row ? toPublicIntegration(row) : null;
}

/**
 * Internal-only accessor for the DECRYPTED credential payload. Never call
 * this from a route handler's response path.
 *
 * Returns `null` when there is no `connected` row for (tenantId, provider) —
 * this is the normal, expected case for every tenant that hasn't set up its
 * own integration yet, and the signal callers (e.g. multiDomainMailer.ts) use
 * to fall back to today's global/env-var behavior.
 *
 * Throws (does not silently fall back) when a row IS `connected` but its
 * ciphertext is missing, corrupt, or tampered — a broken integration must
 * fail loudly rather than silently sending through some other credential set
 * under the tenant's identity.
 */
export async function getDecryptedCredentials<T = unknown>(tenantId: string, provider: string): Promise<T | null> {
  const [row] = await db.select().from(tenantIntegrations)
    .where(and(
      eq(tenantIntegrations.tenantId, tenantId),
      eq(tenantIntegrations.provider, provider),
      eq(tenantIntegrations.status, 'connected'),
    ))
    .limit(1);

  if (!row) return null;
  if (!row.encryptedCredentials) {
    throw new Error(
      `tenant_integrations row for tenant=${tenantId} provider=${provider} is status='connected' but has no encrypted_credentials`,
    );
  }
  return decryptCredentialsJSON<T>(row.encryptedCredentials);
}
