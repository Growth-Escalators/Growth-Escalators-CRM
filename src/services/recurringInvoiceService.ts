import { db } from '../db/index';
import { billingClients, invoices, invoiceLineItems } from '../db/schema';
import { eq, and, sql } from 'drizzle-orm';
import { getNextInvoiceNumber } from './invoiceNumberService';
import { amountInWords } from './amountInWordsService';

function calculateTax(
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

    const existing = await db.execute(sql`
      SELECT id FROM invoices
      WHERE client_id = ${client.id}
        AND invoice_date >= ${monthStart.toISOString()}
        AND invoice_date <= ${monthEnd.toISOString()}
      LIMIT 1
    `);

    if (existing.rows.length > 0) continue;

    try {
      const invoiceType = client.isGst ? 'gst' : 'non_gst';
      const { number, series, financialYear } = await getNextInvoiceNumber(tenantId, invoiceType);

      const subtotal = client.retainerAmount;
      const tax = calculateTax(subtotal, client.taxType as 'igst' | 'cgst_sgst' | null);

      const invoiceDate = new Date(today.getFullYear(), today.getMonth(), client.invoiceDayOfMonth ?? 1);
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
        companyGstin: '08DRYPA4899F2ZZ',
        taxType: client.taxType,
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
