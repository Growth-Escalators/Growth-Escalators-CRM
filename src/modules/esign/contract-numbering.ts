// Contract reference numbers — reuses the existing invoice_series table + the
// atomic-upsert numbering pattern (src/services/invoiceNumberService.ts) with a
// dedicated series_type='contract' and the GE/CON prefix. Gap-free, per-tenant,
// per-financial-year, concurrency-safe (single INSERT..ON CONFLICT statement).
import { db } from '../../db/index';
import { sql } from 'drizzle-orm';
import { getCurrentFinancialYear } from '../../services/invoiceNumberService';

const SERIES_TYPE = 'contract';
const PREFIX = 'GE/CON';

export interface ContractNumber {
  number: string;
  series: number;
  financialYear: string;
}

/** Non-mutating preview of the next contract number (does not consume a serial). */
export async function peekNextContractNumber(tenantId: string): Promise<ContractNumber> {
  const fy = getCurrentFinancialYear();
  const result = await db.execute(sql`
    SELECT last_number FROM invoice_series
    WHERE tenant_id = ${tenantId} AND series_type = ${SERIES_TYPE} AND financial_year = ${fy}
  `);
  const currentLast = (result.rows[0] as { last_number: number } | undefined)?.last_number ?? 0;
  const next = currentLast + 1;
  return { number: `${PREFIX}/${fy}/${next.toString().padStart(3, '0')}`, series: next, financialYear: fy };
}

/** Claims (permanently consumes) the next contract number. Call only on creation. */
export async function getNextContractNumber(tenantId: string): Promise<ContractNumber> {
  const fy = getCurrentFinancialYear();
  const result = await db.execute(sql`
    INSERT INTO invoice_series (tenant_id, series_type, financial_year, last_number)
    VALUES (${tenantId}, ${SERIES_TYPE}, ${fy}, 1)
    ON CONFLICT (tenant_id, series_type, financial_year)
    DO UPDATE SET last_number = invoice_series.last_number + 1, updated_at = now()
    RETURNING last_number
  `);
  const series = (result.rows[0] as { last_number: number }).last_number;
  return { number: `${PREFIX}/${fy}/${series.toString().padStart(3, '0')}`, series, financialYear: fy };
}
