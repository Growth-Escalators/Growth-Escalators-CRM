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
    const { name, contactPerson, email, phone, addressLine1, city, state, stateCode, pincode, isGst, gstin, taxType, retainerAmount, serviceDescription, sacCode, invoiceDayOfMonth, notes: clientNotes } = req.body;
    const [client] = await db.insert(billingClients).values({
      tenantId, name, contactPerson, email, phone, addressLine1, city, state, stateCode, pincode, isGst, gstin, taxType, retainerAmount, serviceDescription, sacCode, invoiceDayOfMonth, notes: clientNotes,
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
    const { name, contactPerson, email, phone, addressLine1, city, state, stateCode, pincode, isGst, gstin, taxType, retainerAmount, serviceDescription, sacCode, invoiceDayOfMonth, notes: clientNotes, isActive } = req.body;
    const [client] = await db.update(billingClients)
      .set({ name, contactPerson, email, phone, addressLine1, city, state, stateCode, pincode, isGst, gstin, taxType, retainerAmount, serviceDescription, sacCode, invoiceDayOfMonth, notes: clientNotes, isActive, updatedAt: new Date() })
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
      companyGstin: process.env.COMPANY_GSTIN ?? '08DRYPA4899F2ZZ',
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
// DELETE /api/billing/invoices/:id — cancel or hard-delete if already cancelled
// ---------------------------------------------------------------------------
router.delete('/invoices/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const invoiceId = req.params.id as string;
  const p = await getPerms(userId);
  if (!p?.billingEdit && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const [existing] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)))
      .limit(1);
    if (!existing) { res.status(404).json({ error: 'invoice not found' }); return; }

    if (existing.status === 'cancelled') {
      // Hard-delete cancelled invoice + its line items
      await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
      await db.delete(invoices).where(eq(invoices.id, invoiceId));
      res.json({ success: true, deleted: true });
    } else {
      // Soft-cancel
      await db.update(invoices)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(eq(invoices.id, invoiceId));
      res.json({ success: true });
    }
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
    // Fetch full invoice + client + line items
    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId))).limit(1);
    if (!inv) { res.status(404).json({ error: 'invoice not found' }); return; }

    const [client] = await db.select().from(billingClients).where(eq(billingClients.id, inv.clientId)).limit(1);
    const lineItems = await db.select().from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, invoiceId));

    // Send via Brevo if configured
    const brevoKey = process.env.BREVO_API_KEY;
    if (brevoKey && client?.email) {
      const itemsHtml = lineItems.map(li =>
        `<tr><td style="padding:8px;border:1px solid #e2e8f0">${li.description}</td><td style="padding:8px;border:1px solid #e2e8f0;text-align:right">₹${((li.amount ?? 0) / 100).toLocaleString('en-IN')}</td></tr>`
      ).join('');

      const html = `
        <div style="font-family:Inter,sans-serif;max-width:600px;margin:0 auto">
          <div style="background:#1B2E5E;color:white;padding:20px;text-align:center;border-radius:8px 8px 0 0">
            <h2 style="margin:0">Growth Escalators</h2>
          </div>
          <div style="padding:24px;border:1px solid #e2e8f0;border-top:none">
            <p>Dear ${client.contactPerson || client.name},</p>
            <p>Please find your invoice details below:</p>
            <table style="width:100%;margin:16px 0">
              <tr><td><strong>Invoice #:</strong></td><td>${inv.invoiceNumber}</td></tr>
              <tr><td><strong>Date:</strong></td><td>${new Date(inv.invoiceDate).toLocaleDateString('en-IN')}</td></tr>
              <tr><td><strong>Due Date:</strong></td><td>${new Date(inv.dueDate).toLocaleDateString('en-IN')}</td></tr>
            </table>
            <table style="width:100%;border-collapse:collapse;margin:16px 0">
              <tr style="background:#f8fafc"><th style="padding:8px;border:1px solid #e2e8f0;text-align:left">Description</th><th style="padding:8px;border:1px solid #e2e8f0;text-align:right">Amount</th></tr>
              ${itemsHtml}
              <tr style="font-weight:bold"><td style="padding:8px;border:1px solid #e2e8f0">Total</td><td style="padding:8px;border:1px solid #e2e8f0;text-align:right">₹${(inv.totalAmount / 100).toLocaleString('en-IN')}</td></tr>
            </table>
            <p style="font-size:14px;color:#64748b">Amount in words: ${inv.amountInWords || ''}</p>
            <div style="margin:16px 0;padding:12px;background:#f0fdf4;border-radius:8px">
              <p style="margin:0;font-size:14px"><strong>Bank Details:</strong></p>
              <p style="margin:4px 0;font-size:13px">Account: ${process.env.GE_BANK_ACCOUNT ?? '3617 0500 1178'} | IFSC: ${process.env.GE_BANK_IFSC ?? 'ICIC0003617'} | Growth Escalators</p>
            </div>
            <p style="font-size:12px;color:#94a3b8;margin-top:24px">GSTIN: ${process.env.COMPANY_GSTIN ?? '08DRYPA4899F2ZZ'}</p>
          </div>
        </div>`;

      const emailRes = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': brevoKey, 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          sender: { name: 'Growth Escalators', email: 'jatin@growthescalators.com' },
          to: [{ email: client.email, name: client.contactPerson || client.name }],
          subject: `Invoice ${inv.invoiceNumber} from Growth Escalators`,
          htmlContent: html,
        }),
      });

      if (!emailRes.ok) {
        const err = await emailRes.text().catch(() => '');
        res.status(500).json({ error: `Email failed: ${emailRes.status} — ${err.slice(0, 100)}` });
        return;
      }
    }

    // Mark as sent
    const [updated] = await db.update(invoices)
      .set({ status: 'sent', sentAt: new Date(), updatedAt: new Date() })
      .where(eq(invoices.id, invoiceId))
      .returning();

    // Audit log
    const { auditLog } = await import('../services/auditLogger');
    await auditLog({ tenantId, userId, action: 'invoice_sent', entityType: 'invoice', entityId: invoiceId, entityName: inv.invoiceNumber });

    res.json({ invoice: updated, emailSent: !!(brevoKey && client?.email) });
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
// PATCH /api/billing/invoices/:id/payment-status — manual status update
// ---------------------------------------------------------------------------
router.patch('/invoices/:id/payment-status', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const invoiceId = String(req.params.id);
  const { status, amountPaid, notes } = req.body as {
    status?: string;
    amountPaid?: number; // in rupees
    notes?: string;
  };

  if (!status || !['paid', 'partially_paid', 'sent', 'overdue', 'draft'].includes(status)) {
    res.status(400).json({ error: 'Valid status required: paid, partially_paid, sent, overdue, draft' });
    return;
  }

  try {
    // Fetch current invoice
    const [inv] = await db.select().from(invoices)
      .where(and(eq(invoices.id, invoiceId), eq(invoices.tenantId, tenantId)))
      .limit(1);
    if (!inv) { res.status(404).json({ error: 'Invoice not found' }); return; }

    const updateFields: Record<string, unknown> = { status, updatedAt: new Date() };

    // If amountPaid is provided, update the amounts
    if (amountPaid != null) {
      const paise = Math.round(amountPaid * 100);
      updateFields.amountPaid = paise;
      updateFields.amountDue = inv.totalAmount - paise;
    }

    // Set paidAt if marking as paid
    if (status === 'paid') {
      updateFields.paidAt = new Date();
    }

    // Add notes if provided
    if (notes) {
      updateFields.notes = notes;
    }

    await db.execute(sql`
      UPDATE invoices SET
        status = ${status},
        amount_paid = COALESCE(${updateFields.amountPaid ?? null}::integer, amount_paid),
        amount_due = COALESCE(${updateFields.amountDue ?? null}::integer, amount_due),
        paid_at = ${status === 'paid' ? sql`NOW()` : sql`paid_at`},
        notes = COALESCE(${notes ?? null}, notes),
        updated_at = NOW()
      WHERE id = ${invoiceId} AND tenant_id = ${tenantId}
    `);

    // Log to audit
    const { pool } = await import('../db/index');
    await pool.query(
      `INSERT INTO audit_events (actor_id, actor_email, action, resource_type, details, created_at)
       VALUES ($1, $2, $3, 'invoice', $4, NOW())`,
      [req.user!.id, req.user!.email, 'billing:update_payment_status',
       JSON.stringify({ invoiceId, oldStatus: inv.status, newStatus: status, amountPaid, notes })],
    ).catch(() => {});

    res.json({ success: true, invoiceId, status });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/billing/monthly-tracker — per-client payment status by month
// ---------------------------------------------------------------------------
router.get('/monthly-tracker', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const months = Math.min(Number(req.query.months) || 3, 12);

  try {
    // Get active billing clients
    const clients = await db.select().from(billingClients)
      .where(and(eq(billingClients.tenantId, tenantId), eq(billingClients.isActive, true)));

    // Build month list (last N months)
    const monthList: Array<{ label: string; start: Date; end: Date }> = [];
    const now = new Date();
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
      monthList.push({
        label: d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' }),
        start: d,
        end,
      });
    }

    // For each client, check invoice status per month
    const { pool } = await import('../db/index');
    const tracker = await Promise.all(clients.map(async (client) => {
      const monthData = await Promise.all(monthList.map(async (m) => {
        const result = await pool.query(
          `SELECT status, total_amount, amount_paid, amount_due, invoice_number
           FROM invoices
           WHERE client_id = $1 AND tenant_id = $2
             AND invoice_date >= $3 AND invoice_date <= $4
             AND status != 'cancelled'
           ORDER BY invoice_date DESC LIMIT 1`,
          [client.id, tenantId, m.start, m.end],
        );
        const inv = result.rows[0] as Record<string, unknown> | undefined;
        return {
          month: m.label,
          hasInvoice: !!inv,
          status: inv?.status ?? null,
          invoiceNumber: inv?.invoice_number ?? null,
          amountInvoiced: Number(inv?.total_amount ?? 0),
          amountPaid: Number(inv?.amount_paid ?? 0),
          amountDue: Number(inv?.amount_due ?? 0),
        };
      }));
      return {
        clientId: client.id,
        clientName: client.name,
        retainerAmount: client.retainerAmount,
        months: monthData,
      };
    }));

    // Totals per month
    const totals = monthList.map((m, i) => ({
      month: m.label,
      expected: tracker.reduce((s, c) => s + (c.months[i].amountInvoiced), 0),
      collected: tracker.reduce((s, c) => s + (c.months[i].amountPaid), 0),
      due: tracker.reduce((s, c) => s + (c.months[i].amountDue), 0),
    }));

    res.json({ tracker, totals, months: monthList.map(m => m.label) });
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
        AND status != 'cancelled'
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
        AND status != 'cancelled'
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

// ---------------------------------------------------------------------------
// GET /api/billing/invoices/export — CSV export
// ---------------------------------------------------------------------------
router.get('/invoices/export', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingView && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const result = await db.execute(sql`
      SELECT i.invoice_number, bc.name AS client_name, i.invoice_date, i.due_date,
             i.subtotal, i.cgst_amount + i.sgst_amount + i.igst_amount AS tax_amount,
             i.total_amount, i.status
      FROM invoices i JOIN billing_clients bc ON bc.id = i.client_id
      WHERE i.tenant_id = ${tenantId}
      ORDER BY i.invoice_date DESC LIMIT 5000
    `);

    const esc = (v: unknown) => { const s = v == null ? '' : String(v).replace(/"/g, '""'); return `"${s}"`; };
    const headers = 'Invoice #,Client,Date,Due Date,Subtotal,Tax,Total,Status';
    const rows = (result.rows as Array<Record<string, unknown>>).map(r =>
      [esc(r.invoice_number), esc(r.client_name),
       esc(r.invoice_date ? new Date(r.invoice_date as string).toISOString().slice(0, 10) : ''),
       esc(r.due_date ? new Date(r.due_date as string).toISOString().slice(0, 10) : ''),
       esc(((Number(r.subtotal) || 0) / 100).toFixed(2)),
       esc(((Number(r.tax_amount) || 0) / 100).toFixed(2)),
       esc(((Number(r.total_amount) || 0) / 100).toFixed(2)),
       esc(r.status),
      ].join(',')
    );

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="invoices.csv"');
    res.send([headers, ...rows].join('\n'));
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/billing/next-invoice-number
// ---------------------------------------------------------------------------
router.get('/next-invoice-number', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingView && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const type = (req.query.type as string) === 'non_gst' ? 'non_gst' : 'gst';
    const result = await getNextInvoiceNumber(tenantId, type as 'gst' | 'non_gst');
    res.json({ nextNumber: result.number, financialYear: result.financialYear, series: result.series });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// Retainer CRUD
// ---------------------------------------------------------------------------
router.get('/retainers', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingView && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const { pool } = await import('../db/index');
    const retainers = await pool.query(
      `SELECT r.*, (SELECT json_agg(li ORDER BY li.sort_order) FROM retainer_line_items li WHERE li.retainer_id = r.id) AS line_items
       FROM client_retainers r WHERE r.tenant_id = $1 ORDER BY r.created_at DESC`,
      [tenantId],
    );
    res.json({ retainers: retainers.rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.get('/retainers/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const { pool } = await import('../db/index');
    const r = await pool.query(`SELECT * FROM client_retainers WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    if (r.rows.length === 0) { res.status(404).json({ error: 'not found' }); return; }
    const li = await pool.query(`SELECT * FROM retainer_line_items WHERE retainer_id = $1 ORDER BY sort_order`, [req.params.id]);
    res.json({ retainer: r.rows[0], lineItems: li.rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post('/retainers', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingCreate && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const { pool } = await import('../db/index');
    const { getNextRetainerNumber } = await import('../services/retainerService');
    const { lineItems, ...fields } = req.body;
    const retainerNumber = fields.retainerNumber || await getNextRetainerNumber();

    const r = await pool.query(`
      INSERT INTO client_retainers (tenant_id, client_id, client_name, retainer_number, status,
        billing_address_line1, billing_address_line2, billing_city, billing_state, billing_pincode,
        billing_country, gstin, invoice_type, tax_type, billing_day, start_date, end_date, currency, notes)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      RETURNING *`,
      [tenantId, fields.clientId ?? null, fields.clientName, retainerNumber, fields.status ?? 'active',
       fields.billingAddressLine1 ?? null, fields.billingAddressLine2 ?? null, fields.billingCity ?? null,
       fields.billingState ?? null, fields.billingPincode ?? null, fields.billingCountry ?? 'India',
       fields.gstin ?? null, fields.invoiceType ?? 'gst', fields.taxType ?? 'cgst_sgst',
       fields.billingDay ?? 1, fields.startDate ?? null, fields.endDate ?? null,
       fields.currency ?? 'INR', fields.notes ?? null],
    );

    const retainerId = (r.rows[0] as { id: number }).id;
    if (Array.isArray(lineItems)) {
      for (let idx = 0; idx < lineItems.length; idx++) {
        const li = lineItems[idx];
        await pool.query(
          `INSERT INTO retainer_line_items (retainer_id, description, sac_code, quantity, unit, rate, amount, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [retainerId, li.description, li.sacCode ?? '9983', li.quantity ?? 1, li.unit ?? 'Month', li.rate, li.amount, idx],
        );
      }
    }

    res.status(201).json({ retainer: r.rows[0] });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.patch('/retainers/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingEdit && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const { pool } = await import('../db/index');
    const { lineItems, ...fields } = req.body;

    const sets: string[] = ['updated_at = NOW()'];
    const vals: unknown[] = [];
    let idx = 1;
    const fieldMap: Record<string, string> = {
      clientName: 'client_name', clientId: 'client_id', status: 'status',
      billingAddressLine1: 'billing_address_line1', billingAddressLine2: 'billing_address_line2',
      billingCity: 'billing_city', billingState: 'billing_state', billingPincode: 'billing_pincode',
      gstin: 'gstin', invoiceType: 'invoice_type', taxType: 'tax_type',
      billingDay: 'billing_day', startDate: 'start_date', notes: 'notes',
    };
    for (const [k, col] of Object.entries(fieldMap)) {
      if (k in fields) { sets.push(`${col} = $${idx}`); vals.push(fields[k]); idx++; }
    }
    vals.push(req.params.id, tenantId);

    const r = await pool.query(
      `UPDATE client_retainers SET ${sets.join(', ')} WHERE id = $${idx} AND tenant_id = $${idx + 1} RETURNING *`,
      vals,
    );
    if (r.rows.length === 0) { res.status(404).json({ error: 'not found' }); return; }

    if (Array.isArray(lineItems)) {
      await pool.query(`DELETE FROM retainer_line_items WHERE retainer_id = $1`, [req.params.id]);
      for (let i = 0; i < lineItems.length; i++) {
        const li = lineItems[i];
        await pool.query(
          `INSERT INTO retainer_line_items (retainer_id, description, sac_code, quantity, unit, rate, amount, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [req.params.id, li.description, li.sacCode ?? '9983', li.quantity ?? 1, li.unit ?? 'Month', li.rate, li.amount, i],
        );
      }
    }

    res.json({ retainer: r.rows[0] });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.delete('/retainers/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingEdit && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const { pool } = await import('../db/index');
    await pool.query(
      `UPDATE client_retainers SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId],
    );
    res.json({ success: true });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post('/retainers/:id/generate-invoice', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const userEmail = req.user!.email;
  const p = await getPerms(userId);
  if (!p?.billingCreate && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const { generateInvoiceFromRetainer } = await import('../services/retainerService');
    const result = await generateInvoiceFromRetainer(parseInt(req.params.id as string, 10), tenantId, userEmail);
    if (result.error) { res.status(400).json({ error: result.error }); return; }
    res.status(201).json({ invoiceId: result.invoiceId });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

router.post('/retainers/generate-pending', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userEmail = req.user!.email;
  const userId = req.user!.id;
  const p = await getPerms(userId);
  if (!p?.billingCreate && !p?.isOwner) { res.status(403).json({ error: 'insufficient permissions' }); return; }

  try {
    const { generatePendingInvoices } = await import('../services/retainerService');
    const result = await generatePendingInvoices(tenantId, userEmail);
    res.json(result);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
