/**
 * Wizmatch — optional-schema helpers
 *
 * File-wide utilities used across the Wizmatch route handlers (command-center,
 * client-discovery, candidate-intelligence, contact-intelligence, and more) to:
 *   - coerce loosely-typed Postgres numeric/string columns (`numeric`, `firstString`)
 *   - detect and gracefully degrade when an optional Wizmatch table/column is
 *     missing from the current schema, rather than 500ing (the rest of this
 *     cluster: OPTIONAL_WIZMATCH_SCHEMA_TABLES, isOptionalWizmatchSchemaError,
 *     optionalWizmatchStatsQuery, optionalWizmatchValue).
 *
 * Extracted from src/routes/wizmatch.ts (finding M26) so both the route file and
 * src/services/wizmatchContactIntelligenceRepo.ts can share one home for these
 * helpers without a circular import between the two.
 */

import { pool } from '../db/index';
import logger from '../utils/logger';

export function numeric(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value) || 0;
  return 0;
}

export const OPTIONAL_WIZMATCH_SCHEMA_TABLES = [
  'wizmatch_requirements',
  'wizmatch_company_intelligence',
  'wizmatch_contact_candidates',
  'wizmatch_discovery_runs',
] as const;

export type OptionalWizmatchSchemaTable = typeof OPTIONAL_WIZMATCH_SCHEMA_TABLES[number];

export function isOptionalWizmatchSchemaTable(table: string): table is OptionalWizmatchSchemaTable {
  return (OPTIONAL_WIZMATCH_SCHEMA_TABLES as readonly string[]).includes(table);
}

export function optionalTablesFromQuery(query: string): OptionalWizmatchSchemaTable[] {
  const lowerQuery = query.toLowerCase();
  return OPTIONAL_WIZMATCH_SCHEMA_TABLES.filter((table) => lowerQuery.includes(table));
}

export function isOptionalWizmatchSchemaError(
  error: unknown,
  referencedTables: readonly string[] = [],
): boolean {
  const pgError = error as { code?: string; message?: string } | null;
  if (!pgError) return false;
  if (pgError.code !== '42P01' && pgError.code !== '42703') return false;
  return referencedTables.some(isOptionalWizmatchSchemaTable);
}

export async function optionalWizmatchStatsQuery<T extends Record<string, unknown>>(
  label: string,
  query: string,
  params: unknown[],
  fallback: T,
): Promise<{ rows: T[] }> {
  const optionalTables = optionalTablesFromQuery(query);
  try {
    return await pool.query(query, params) as { rows: T[] };
  } catch (e) {
    if (!isOptionalWizmatchSchemaError(e, optionalTables)) {
      logger.error({ err: e, label, optionalTables }, `[wizmatch] unexpected stats schema error: ${label}`);
      throw e;
    }
    logger.warn({ err: e }, `[wizmatch] optional stats unavailable: ${label}`);
    return { rows: [fallback] };
  }
}

export async function optionalWizmatchValue<T>(
  label: string,
  load: () => Promise<T>,
  fallback: T,
  optionalTables: readonly OptionalWizmatchSchemaTable[] = [],
): Promise<T> {
  try {
    return await load();
  } catch (e) {
    if (!isOptionalWizmatchSchemaError(e, optionalTables)) {
      logger.error({ err: e, label, optionalTables }, `[wizmatch] unexpected optional data schema error: ${label}`);
      throw e;
    }
    logger.warn({ err: e }, `[wizmatch] optional data unavailable: ${label}`);
    return fallback;
  }
}

export function firstString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}
