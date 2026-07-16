import { describe, it, expect } from 'vitest';
import { generateInvoicePDF, type InvoiceData } from '../services/pdfService';

function baseInvoiceData(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    invoiceNumber: 'GE/GST/2026-27/001',
    invoiceDate: new Date('2026-07-01'),
    dueDate: new Date('2026-07-15'),
    invoiceType: 'gst',
    taxType: 'cgst_sgst',
    companyName: 'Growth Escalators',
    companyAddress: 'Jaipur, Rajasthan',
    companyGstin: '08DRYPA4899F2ZZ',
    companyBank: { accountNo: '123', name: 'GE', ifsc: 'ICIC0001', type: 'Current' },
    clientName: 'Acme Marketing Pvt Ltd',
    clientContactPerson: 'John Smith',
    clientAddress: 'Mumbai, Maharashtra',
    clientGstin: null,
    clientState: 'Maharashtra',
    lineItems: [{ description: 'Marketing services', sacCode: '9983', quantity: 1, unit: 'Month', rate: 10000000, amount: 10000000 }],
    subtotal: 10000000,
    cgstRate: 9, cgstAmount: 900000, sgstRate: 9, sgstAmount: 900000, igstRate: 0, igstAmount: 0,
    totalAmount: 11800000,
    amountInWords: 'One Lakh Eighteen Thousand Rupees Only',
    notes: null, paymentNote: null, sacCode: '9983',
    status: 'sent', paidAt: null, amountPaid: null,
    ...overrides,
  };
}

describe('generateInvoicePDF (M22 — Devanagari client name rendering)', () => {
  it('generates a valid PDF for a plain-English client name', async () => {
    const buf = await generateInvoicePDF(baseInvoiceData());
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(500);
  });

  it('generates a valid PDF for a Devanagari (Hindi/Marathi script) client name without throwing', async () => {
    const buf = await generateInvoicePDF(baseInvoiceData({
      clientName: 'श्री राम एंटरप्राइजेज Pvt Ltd',
      clientContactPerson: 'राम कुमार Sharma',
    }));
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(500);
  });

  it('embeds the Devanagari font in the PDF when the client name requires it', async () => {
    const buf = await generateInvoicePDF(baseInvoiceData({ clientName: 'श्री राम एंटरप्राइजेज' }));
    // pdfkit embeds a font subset under a name derived from what was
    // registered via doc.registerFont('NotoSansDevanagari', ...) — its
    // presence in the object stream is a reasonable proxy for "the
    // Devanagari run was actually rendered with the embedded font, not
    // silently dropped."
    expect(buf.includes('NotoSansDevanagari')).toBe(true);
  });

  it('does not embed the Devanagari font when no Devanagari text is present (no wasted bytes on plain-English invoices)', async () => {
    const buf = await generateInvoicePDF(baseInvoiceData());
    // The font is still REGISTERED on every document (registerFont is cheap
    // and always runs), but pdfkit only embeds glyph subsets it actually
    // used — a plain-English invoice should reference the base Helvetica
    // fonts, not pull in Devanagari glyph data.
    expect(buf.length).toBeLessThan(6000);
  });
});
