import { Router, type Request, type Response } from 'express';
import { db } from '../db/index';
import {
  billingClients,
  invoices,
  invoiceLineItems,
  payments,
  userPermissions,
} from '../db/schema';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getNextInvoiceNumber } from '../services/invoiceNumberService';
import { amountInWords } from '../services/amountInWordsService';
import { generateInvoicePDF, type InvoiceData } from '../services/pdfService';
import { generateMonthlyDraftInvoices } from '../services/recurringInvoiceService';

const router = Router();

// ---------------------------------------------------------------------------
// Permission helper
// ---------------------------------------------------------------------------
async function getPerms(userId: string) {
  const [p] = await db.select().from(userPermissions).where(eq(userPermissions.userId, userId)).limit(1);
  return p ?? null;
}

// ---------------------------------------------------------------------------
// Tax calculation
// ---------------------------------------------------------------------------
function calcTax(subtotal: number, taxType: string | null) {
  if (!taxType) return { cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0, igstRate: 0, igstAmount: 0, total: subtotal };
  if (taxType === 'cgst_sgst') {
    const cgst = Math.round(subtotal * 0.09);
    const sgst = Math.round(subtotal * 0.09);
    return { cgstRate: 9, cgstAmount: cgst, sgstRate: 9, sgstAmount: sgst, igstRate: 0, igstAmount: 0, total: subtotal + cgst + sgst };
  }
  const igst = Math.round(subtotal * 0.18);
  return { cgstRate: 0, cgstAmount: 0, sgstRate: 0, sgstAmount: 0, igstRate: 18, igstAmount: igst, total: subtotal + igst };
}

// ---------------------------------------------------------------------------
// GET /api/billing/clients
// ---------------------------------------------------------------------------
router.get('/clients', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingView && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const clients = await db.select().from(billingClients)
      .where(eq(billingClients.tenantId, tenantId))
      .orderBy(billingClients.name);
    res.json({ clients });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/clients
// ---------------------------------------------------------------------------
router.post('/clients', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingManageClients && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const [client] = await db.insert(billingClients).values({
      ...req.body,
      tenantId,
    }).returning();
    res.status(201).json({ client });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/billing/clients/:id
// ---------------------------------------------------------------------------
router.patch('/clients/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const clientId = req.params.id as string;
  const p = await getPerms(userId);
  if (!p?.billingManageClients && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const [client] = await db.update(billingClients)
      .set({ ...req.body, updatedAt: new Date() })
      .where(and(eq(billingClients.id, clientId), eq(billingClients.tenantId, tenantId)))
      .returning();
    if (!client) { res.status(404).json({ error: 'client not found' }); return; }
    res.json({ client });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/billing/clients/:id — soft delete
// ---------------------------------------------------------------------------
router.delete('/clients/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const clientId = req.params.id as string;
  const p = await getPerms(userId);
  if (!p?.billingManageClients && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    await db.update(billingClients)
      .set({ isActive: false, updatedAt: new Date() })
      .where(and(eq(billingClients.id, clientId), eq(billingClients.tenantId, tenantId)));
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/billing/invoices
// ---------------------------------------------------------------------------
router.get('/invoices', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingView && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const { clientId, status, month, year } = req.query as Record<string, string>;

    const allInvoices = await db.execute(sql`
      SELECT i.*,
             bc.name as client_name,
             bc.contact_person as client_contact_person
      FROM invoices i
      JOIN billing_clients bc ON bc.id = i.client_id
      WHERE i.tenant_id = ${tenantId}
        ${clientId ? sql`AND i.client_id = ${clientId}` : sql``}
        ${status ? sql`AND i.status = ${status}` : sql``}
        ${month ? sql`AND EXTRACT(MONTH FROM i.invoice_date) = ${parseInt(month)}` : sql``}
        ${year ? sql`AND EXTRACT(YEAR FROM i.invoice_date) = ${parseInt(year)}` : sql``}
      ORDER BY i.invoice_date DESC, i.created_at DESC
    `);

    res.json({ invoices: allInvoices.rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/billing/invoices/:id
// ---------------------------------------------------------------------------
router.get('/invoices/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const invoiceId = req.params.id as string;
  const p = await getPerms(userId);
  if (!p?.billingView && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const [invoice] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)))
      .limit(1);
    if (!invoice) { res.status(404).json({ error: 'invoice not found' }); return; }

    const clientIdForQuery = invoice.clientId;
    const [client] = await db.select().from(billingClients).where(eq(billingClients.id, clientIdForQuery)).limit(1);
    const lineItems = await db.select().from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoiceId))
      .orderBy(invoiceLineItems.sortOrder);
    const paymentHistory = await db.select().from(payments)
      .where(eq(payments.invoiceId, invoiceId))
      .orderBy(desc(payments.paymentDate));

    res.json({ invoice, client, lineItems, payments: paymentHistory });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/invoices
// ---------------------------------------------------------------------------
router.post('/invoices', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userEmail = req.user!.email;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingCreate && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const { clientId, invoiceDate, dueDate, invoiceType, taxType, lineItemsData, notes, paymentNote } = req.body;

    const [client] = await db.select().from(billingClients).where(eq(billingClients.id, clientId)).limit(1);
    if (!client) { res.status(404).json({ error: 'client not found' }); return; }

    const items: Array<{ description: string; sacCode: string; quantity: number; unit: string; rate: number; amount: number; sortOrder: number }> = lineItemsData ?? [];
    const subtotal = items.reduce((s: number, i) => s + i.amount, 0);
    const effectiveTaxType = taxType ?? client.taxType;
    const tax = calcTax(subtotal, effectiveTaxType);
    const effectiveInvoiceType: 'gst' | 'non_gst' = invoiceType ?? (client.isGst ? 'gst' : 'non_gst');
    const { number, series, financialYear } = await getNextInvoiceNumber(tenantId, effectiveInvoiceType);
    const words = amountInWords(tax.total);

    const [inv] = await db.insert(invoices).values({
      tenantId,
      clientId,
      invoiceNumber: number,
      invoiceType: effectiveInvoiceType,
      status: 'draft',
      invoiceDate: new Date(invoiceDate),
      dueDate: new Date(dueDate),
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
      amountInWords: words,
      clientGstin: client.gstin,
      clientState: client.state,
      clientStateCode: client.stateCode,
      companyGstin: '08DRYPA4899F2ZZ',
      taxType: effectiveTaxType,
      serviceDescription: client.serviceDescription,
      sacCode: client.sacCode ?? '9983',
      notes: notes ?? null,
      paymentNote: paymentNote ?? null,
      financialYear,
      seriesNumber: series,
      createdBy: userEmail,
    }).returning();

    if (items.length > 0) {
      await db.insert(invoiceLineItems).values(
        items.map((item, idx) => ({ ...item, invoiceId: inv.id, sortOrder: idx })),
      );
    }

    res.status(201).json({ invoice: inv });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/billing/invoices/:id
// ---------------------------------------------------------------------------
router.patch('/invoices/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const invoiceId = req.params.id as string;
  const p = await getPerms(userId);
  if (!p?.billingEdit && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const { lineItemsData, ...fields } = req.body;

    let updates: Record<string, unknown> = { ...fields, updatedAt: new Date() };
    if (lineItemsData) {
      const items = lineItemsData as Array<{ description: string; sacCode: string; quantity: number; unit: string; rate: number; amount: number }>;
      const subtotal = items.reduce((s: number, i) => s + i.amount, 0);
      const [existing] = await db.select().from(invoices).where(eq(invoices.id, invoiceId)).limit(1);
      const taxType = (fields.taxType ?? existing?.taxType ?? null) as string | null;
      const tax = calcTax(subtotal, taxType);
      updates = {
        ...updates,
        subtotal,
        cgstRate: tax.cgstRate, cgstAmount: tax.cgstAmount,
        sgstRate: tax.sgstRate, sgstAmount: tax.sgstAmount,
        igstRate: tax.igstRate, igstAmount: tax.igstAmount,
        totalAmount: tax.total,
        amountDue: tax.total - (existing?.amountPaid ?? 0),
        amountInWords: amountInWords(tax.total),
      };

      await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
      await db.insert(invoiceLineItems).values(
        items.map((item, idx) => ({ ...item, invoiceId, sortOrder: idx })),
      );
    }

    const [inv] = await db.update(invoices)
      .set(updates)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)))
      .returning();
    if (!inv) { res.status(404).json({ error: 'invoice not found' }); return; }

    res.json({ invoice: inv });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/billing/invoices/:id — cancel
// ---------------------------------------------------------------------------
router.delete('/invoices/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const invoiceId = req.params.id as string;
  const p = await getPerms(userId);
  if (!p?.billingEdit && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    await db.update(invoices)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)));
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/invoices/:id/send
// ---------------------------------------------------------------------------
router.post('/invoices/:id/send', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const invoiceId = req.params.id as string;
  const p = await getPerms(userId);
  if (!p?.billingEdit && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const [inv] = await db.update(invoices)
      .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)))
      .returning();
    if (!inv) { res.status(404).json({ error: 'invoice not found' }); return; }
    res.json({ invoice: inv });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/invoices/:id/payment
// ---------------------------------------------------------------------------
router.post('/invoices/:id/payment', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const invoiceId = req.params.id as string;
  const p = await getPerms(userId);
  if (!p?.billingMarkPaid && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const { amount, paymentDate, paymentMode, reference, notes } = req.body;
    const amountPaise = Math.round(parseFloat(String(amount)) * 100);

    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)))
      .limit(1);
    if (!inv) { res.status(404).json({ error: 'invoice not found' }); return; }

    await db.insert(payments).values({
      tenantId,
      invoiceId: inv.id,
      clientId: inv.clientId,
      amount: amountPaise,
      paymentDate: new Date(paymentDate),
      paymentMode: paymentMode ?? null,
      reference: reference ?? null,
      notes: notes ?? null,
    });

    const newAmountPaid = (inv.amountPaid ?? 0) + amountPaise;
    const newAmountDue = inv.totalAmount - newAmountPaid;
    const newStatus = newAmountDue <= 0 ? 'paid' : 'partially_paid';

    const [updated] = await db.update(invoices)
      .set({
        amountPaid: newAmountPaid,
        amountDue: Math.max(0, newAmountDue),
        status: newStatus,
        paidAt: newStatus === 'paid' ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, inv.id))
      .returning();

    res.json({ invoice: updated });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/billing/invoices/:id/pdf
// ---------------------------------------------------------------------------
router.get('/invoices/:id/pdf', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const invoiceId = req.params.id as string;
  const p = await getPerms(userId);
  if (!p?.billingDownload && !p?.billingView && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)))
      .limit(1);
    if (!inv) { res.status(404).json({ error: 'invoice not found' }); return; }

    const clientIdForPdf = inv.clientId;
    const [client] = await db.select().from(billingClients).where(eq(billingClients.id, clientIdForPdf)).limit(1);
    const lineItems = await db.select().from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoiceId))
      .orderBy(invoiceLineItems.sortOrder);

    const clientAddr = [
      client.addressLine1, client.addressLine2, client.city,
      client.state, client.pincode, client.country,
    ].filter(Boolean).join(', ');

    const pdfData: InvoiceData = {
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: new Date(inv.invoiceDate),
      dueDate: new Date(inv.dueDate),
      invoiceType: inv.invoiceType as 'gst' | 'non_gst',
      taxType: inv.taxType as 'igst' | 'cgst_sgst' | null,
      companyName: 'Growth Escalators',
      companyAddress: '264/103-104 Pratap Nagar, Sanganer, Jaipur, Rajasthan 302033',
      companyGstin: inv.companyGstin,
      companyBank: inv.invoiceType === 'gst'
        ? { accountNo: '3617 0500 1178', name: 'Growth Escalators', ifsc: 'ICIC0003617', type: 'Current Account' }
        : null,
      clientName: client.name,
      clientContactPerson: client.contactPerson,
      clientAddress: clientAddr,
      clientGstin: inv.clientGstin,
      clientState: inv.clientState,
      lineItems: lineItems.map((li) => ({
        description: li.description,
        sacCode: li.sacCode ?? '9983',
        quantity: li.quantity ?? 1,
        unit: li.unit ?? 'Month',
        rate: li.rate,
        amount: li.amount,
      })),
      subtotal: inv.subtotal,
      cgstRate: inv.cgstRate ?? 0,
      cgstAmount: inv.cgstAmount ?? 0,
      sgstRate: inv.sgstRate ?? 0,
      sgstAmount: inv.sgstAmount ?? 0,
      igstRate: inv.igstRate ?? 0,
      igstAmount: inv.igstAmount ?? 0,
      totalAmount: inv.totalAmount,
      amountInWords: inv.amountInWords ?? '',
      notes: inv.notes,
      paymentNote: inv.paymentNote,
      sacCode: inv.sacCode ?? '9983',
    };

    const pdfBuffer = await generateInvoicePDF(pdfData);
    const filename = `${inv.invoiceNumber.replace(/\//g, '-')}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/billing/generate-monthly
// ---------------------------------------------------------------------------
router.post('/generate-monthly', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingCreate && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const result = await generateMonthlyDraftInvoices(tenantId);
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/billing/mrr
// ---------------------------------------------------------------------------
router.get('/mrr', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingViewMrr && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const allClients = await db.select().from(billingClients)
      .where(and(eq(billingClients.tenantId, tenantId), eq(billingClients.isActive, true)));

    const totalMrrPaise = allClients.reduce((s, c) => s + (c.retainerAmount ?? 0), 0);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);

    const monthPayments = await db.execute(sql`
      SELECT SUM(amount) as total FROM payments
      WHERE tenant_id = ${tenantId}
        AND payment_date >= ${monthStart.toISOString()}
        AND payment_date <= ${monthEnd.toISOString()}
    `);

    const outstandingResult = await db.execute(sql`
      SELECT SUM(amount_due) as total, COUNT(*) as count FROM invoices
      WHERE tenant_id = ${tenantId} AND status IN ('sent', 'partially_paid')
    `);

    const overdueResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM invoices
      WHERE tenant_id = ${tenantId} AND status = 'overdue'
    `);

    const clientDetails = await db.execute(sql`
      SELECT bc.id, bc.name, bc.retainer_amount,
             (SELECT i.status FROM invoices i WHERE i.client_id = bc.id ORDER BY i.invoice_date DESC LIMIT 1) as last_invoice_status,
             (SELECT i.invoice_number FROM invoices i WHERE i.client_id = bc.id ORDER BY i.invoice_date DESC LIMIT 1) as last_invoice_number,
             (SELECT i.total_amount FROM invoices i WHERE i.client_id = bc.id ORDER BY i.invoice_date DESC LIMIT 1) as last_invoice_amount
      FROM billing_clients bc
      WHERE bc.tenant_id = ${tenantId} AND bc.is_active = true
      ORDER BY bc.name
    `);

    const collectedPaise = parseInt(String((monthPayments.rows[0] as Record<string, unknown>)?.total ?? '0')) || 0;
    const outstandingPaise = parseInt(String((outstandingResult.rows[0] as Record<string, unknown>)?.total ?? '0')) || 0;
    const overdueCount = parseInt(String((overdueResult.rows[0] as Record<string, unknown>)?.count ?? '0')) || 0;

    res.json({
      totalMrr: totalMrrPaise,
      collectedThisMonth: collectedPaise,
      outstandingThisMonth: outstandingPaise,
      overdueCount,
      annualRunRate: totalMrrPaise * 12,
      clients: clientDetails.rows,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/billing/stats
// ---------------------------------------------------------------------------
router.get('/stats', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingView && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

    const mrrResult = await db.execute(sql`
      SELECT SUM(retainer_amount) as total_mrr FROM billing_clients
      WHERE tenant_id = ${tenantId} AND is_active = true
    `);

    const collectedResult = await db.execute(sql`
      SELECT SUM(amount) as total FROM payments
      WHERE tenant_id = ${tenantId} AND payment_date >= ${monthStart.toISOString()}
    `);

    const outstandingResult = await db.execute(sql`
      SELECT SUM(amount_due) as total FROM invoices
      WHERE tenant_id = ${tenantId} AND status IN ('sent', 'partially_paid', 'overdue')
    `);

    const overdueResult = await db.execute(sql`
      SELECT COUNT(*) as count FROM invoices
      WHERE tenant_id = ${tenantId} AND status = 'overdue'
    `);

    const mrr = parseInt(String((mrrResult.rows[0] as Record<string, unknown>)?.total_mrr ?? '0')) || 0;
    const collected = parseInt(String((collectedResult.rows[0] as Record<string, unknown>)?.total ?? '0')) || 0;
    const outstanding = parseInt(String((outstandingResult.rows[0] as Record<string, unknown>)?.total ?? '0')) || 0;
    const overdueCount = parseInt(String((overdueResult.rows[0] as Record<string, unknown>)?.count ?? '0')) || 0;

    res.json({
      totalMrr: mrr,
      collectedThisMonth: collected,
      outstanding,
      overdueCount,
      annualRunRate: mrr * 12,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/billing/payments
// ---------------------------------------------------------------------------
router.get('/payments', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingView && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const result = await db.execute(sql`
      SELECT p.*, bc.name as client_name, i.invoice_number
      FROM payments p
      JOIN billing_clients bc ON bc.id = p.client_id
      JOIN invoices i ON i.id = p.invoice_id
      WHERE p.tenant_id = ${tenantId}
      ORDER BY p.payment_date DESC
      LIMIT 100
    `);
    res.json({ payments: result.rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
