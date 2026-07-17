import { db } from '../db/index';
import { sql } from 'drizzle-orm';

// Computed in IST (Asia/Kolkata), not server-local time. Railway runs
// containers in UTC, which put the Indian financial-year boundary (April 1)
// 5.5 hours late: an invoice created 2026-04-01 00:01 IST (= 2026-03-31
// 18:31 UTC) would read `month=3` under server-local UTC and continue the
// OLD financial year's series instead of rolling over — wrong FY on the
// invoice number and on the persisted financial_year column.
// Exported for direct unit testing of the IST-boundary fix.
export function getCurrentFinancialYear(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(new Date());
  const year = Number(parts.find((p) => p.type === 'year')?.value);
  const month = Number(parts.find((p) => p.type === 'month')?.value);
  if (month >= 4) return `${year}-${(year + 1).toString().slice(2)}`;
  return `${year - 1}-${year.toString().slice(2)}`;
}

/**
 * Read-only preview of the number the NEXT getNextInvoiceNumber() call would
 * claim, without incrementing the series. Does not touch invoice_series.
 * Use for GET/preview endpoints (e.g. the "new invoice" form's live preview)
 * — the previous single function was used for both preview and creation,
 * so opening the form and refreshing it repeatedly silently burned real
 * GST serial numbers (CGST Rule 46(b) requires consecutive serials on
 * issued invoices, so gaps from a preview-only view are a compliance risk).
 */
export async function peekNextInvoiceNumber(
  tenantId: string,
  type: 'gst' | 'non_gst',
): Promise<{ number: string; series: number; financialYear: string }> {
  const fy = getCurrentFinancialYear();
  const prefix = type === 'gst' ? 'GE/GST' : 'GE/INV';

  const result = await db.execute(sql`
    SELECT last_number FROM invoice_series
    WHERE tenant_id = ${tenantId} AND series_type = ${type} AND financial_year = ${fy}
  `);
  const currentLast = (result.rows[0] as { last_number: number } | undefined)?.last_number ?? 0;
  const nextNum = currentLast + 1;
  const paddedNum = nextNum.toString().padStart(3, '0');

  return {
    number: `${prefix}/${fy}/${paddedNum}`,
    series: nextNum,
    financialYear: fy,
  };
}

/**
 * Claims (and permanently consumes) the next invoice number in the series.
 * Only call this from the actual invoice-creation path — see
 * peekNextInvoiceNumber() above for a non-mutating preview.
 */
export async function getNextInvoiceNumber(
  tenantId: string,
  type: 'gst' | 'non_gst',
): Promise<{ number: string; series: number; financialYear: string }> {
  const fy = getCurrentFinancialYear();
  const prefix = type === 'gst' ? 'GE/GST' : 'GE/INV';

  // Atomic upsert — INSERT or increment in a single statement.
  // PostgreSQL guarantees concurrent calls get distinct numbers.
  const result = await db.execute(sql`
    INSERT INTO invoice_series (tenant_id, series_type, financial_year, last_number)
    VALUES (${tenantId}, ${type}, ${fy}, 1)
    ON CONFLICT (tenant_id, series_type, financial_year)
    DO UPDATE SET last_number = invoice_series.last_number + 1, updated_at = now()
    RETURNING last_number
  `);

  const seriesNum = (result.rows[0] as { last_number: number }).last_number;

  const paddedNum = seriesNum.toString().padStart(3, '0');
  return {
    number: `${prefix}/${fy}/${paddedNum}`,
    series: seriesNum,
    financialYear: fy,
  };
}
