import { db } from '../db/index';
import { sql } from 'drizzle-orm';

function getCurrentFinancialYear(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  if (month >= 4) return `${year}-${(year + 1).toString().slice(2)}`;
  return `${year - 1}-${year.toString().slice(2)}`;
}

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
