import { db } from '../db/index';
import { invoiceSeries } from '../db/schema';
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

  // Atomic increment using UPDATE RETURNING
  const result = await db.execute(sql`
    UPDATE invoice_series
    SET last_number = last_number + 1, updated_at = now()
    WHERE tenant_id = ${tenantId}
      AND series_type = ${type}
      AND financial_year = ${fy}
    RETURNING last_number
  `);

  let seriesNum = 1;
  if (result.rows.length > 0) {
    seriesNum = (result.rows[0] as { last_number: number }).last_number;
  } else {
    // Create series if not exists
    await db.insert(invoiceSeries).values({
      tenantId,
      seriesType: type,
      financialYear: fy,
      lastNumber: 1,
    });
    seriesNum = 1;
  }

  const paddedNum = seriesNum.toString().padStart(3, '0');
  return {
    number: `${prefix}/${fy}/${paddedNum}`,
    series: seriesNum,
    financialYear: fy,
  };
}
