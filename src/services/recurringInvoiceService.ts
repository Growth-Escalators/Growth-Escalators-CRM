import { db } from '../db/index';
import { billingClients, invoices, invoiceLineItems } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getNextInvoiceNumber } from './invoiceNumberService';
import { amountInWords } from './amountInWordsService';
import { COMPANY_GSTIN } from '../config/constants';

// Exported so tests exercise the real tax calculation instead of a copy
// (see the review's M2 finding — billing.test.ts previously re-implemented
// this function inline, so a real change here could break production GST
// math while every test stayed green).
export function calculateTax(
  subtotalPaise: number,
  taxType: 'igst' | 'cgst_sgst' | null,
): {
  cgstRate: number; cgstAmount: number;
  sgstRate: number; sgstAmount: number;
  igstRate: number; igstAmount: number;
  total: number;
} {
  if (!taxType) {
    return { cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0, igstRate: 0, igstAmount: 0, total: subtotalPaise };
  }
  if (taxType === 'cgst_sgst') {
    const cgstAmount = Math.round(subtotalPaise * 0.09);
    const sgstAmount = Math.round(subtotalPaise * 0.09);
    return { cgstRate: 9, cgstAmount, sgstRate: 9, sgstAmount, igstRate: 0, igstAmount: 0, total: subtotalPaise + cgstAmount + sgstAmount };
  }
  const igstAmount = Math.round(subtotalPaise * 0.18);
  return { cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0, igstRate: 18, igstAmount, total: subtotalPaise + igstAmount };
}

export async function generateMonthlyDraftInvoices(
  tenantId: string,
): Promise<{ generated: number; errors: string[] }> {
  const today = new Date();
  const errors: string[] = [];
  let generated = 0;

  const activeClients = await db
    .select()
    .from(billingClients)
    .where(and(eq(billingClients.tenantId, tenantId), eq(billingClients.isActive, true)));

  for (const client of activeClients) {
    if (!client.retainerAmount) continue;

    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
    const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

    // Scoped to invoices THIS cron created (is_recurring=true) and still
    // live (not cancelled) — previously matched ANY invoice in the month,
    // so a manual one-off (e.g. a setup-fee invoice) raised for the client
    // silently blocked that month's retainer draft from ever being
    // generated, and a cancelled draft permanently blocked regeneration.
    const existing = await db.execute(sql`
      SELECT id FROM invoices
      WHERE client_id = ${client.id}
        AND is_recurring = true
        AND status != 'cancelled'
        AND invoice_date >= ${monthStart.toISOString()}
        AND invoice_date <= ${monthEnd.toISOString()}
      LIMIT 1
    `);

    if (existing.rows.length > 0) continue;

    try {
      const invoiceType = client.isGst ? 'gst' : 'non_gst';
      // Only apply a tax type to actually-GST clients — a stale taxType left
      // over from before a client switched to non-GST previously still
      // produced tax lines on a "non_gst" invoice, charging GST on a
      // document that shouldn't carry any.
      const effectiveTaxType = client.isGst ? (client.taxType as 'igst' | 'cgst_sgst' | null) : null;
      const { number, series, financialYear } = await getNextInvoiceNumber(tenantId, invoiceType);

      const subtotal = client.retainerAmount;
      const tax = calculateTax(subtotal, effectiveTaxType);

      // Clamp the configured billing day to the actual length of this
      // month — new Date(y, m, 31) silently rolls into next month on a
      // 30-day month (e.g. April), which both mis-dates the invoice and
      // makes the dedup check above look at the wrong month on the next run.
      const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      const invoiceDay = Math.min(client.invoiceDayOfMonth ?? 1, daysInMonth);
      const invoiceDate = new Date(today.getFullYear(), today.getMonth(), invoiceDay);
      const dueDate = new Date(invoiceDate);
      dueDate.setDate(dueDate.getDate() + 15);

      const wordsText = amountInWords(tax.total);

      const [inv] = await db.insert(invoices).values({
        tenantId,
        clientId: client.id,
        invoiceNumber: number,
        invoiceType,
        status: 'draft',
        invoiceDate,
        dueDate,
        subtotal,
        cgstRate: tax.cgstRate,
        cgstAmount: tax.cgstAmount,
        sgstRate: tax.sgstRate,
        sgstAmount: tax.sgstAmount,
        igstRate: tax.igstRate,
        igstAmount: tax.igstAmount,
        totalAmount: tax.total,
        amountPaid: 0,
        amountDue: tax.total,
        amountInWords: wordsText,
        clientGstin: client.gstin,
        clientState: client.state,
        clientStateCode: client.stateCode,
        companyGstin: COMPANY_GSTIN,
        taxType: effectiveTaxType,
        serviceDescription: client.serviceDescription,
        sacCode: client.sacCode ?? '9983',
        isRecurring: true,
        financialYear,
        seriesNumber: series,
        createdBy: 'system',
      }).returning();

      await db.insert(invoiceLineItems).values({
        invoiceId: inv.id,
        description: client.serviceDescription ?? 'Professional Services',
        sacCode: client.sacCode ?? '9983',
        quantity: 1,
        unit: 'Month',
        rate: subtotal,
        amount: subtotal,
        sortOrder: 0,
      });

      generated++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      errors.push(`${client.name}: ${msg}`);
    }
  }

  return { generated, errors };
}
