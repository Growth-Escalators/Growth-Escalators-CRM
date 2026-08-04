import { describe, it, expect } from 'vitest';
import zlib from 'zlib';
import { generateInvoicePDF, type InvoiceData } from '../services/pdfService';

// pdfkit compresses (FlateDecode) every content stream by default, and
// encodes Helvetica text as single-byte WinAnsi char codes inside hex
// strings within TJ/Tj show-text operators (each hex pair is one char code)
// — so a raw substring search on the PDF buffer never finds visible text.
// This decompresses every content stream and, per content-stream line
// (roughly one .text() call each), concatenates the decoded bytes from every
// hex-string run on that line — reconstructing what was actually rendered,
// good enough to substring-search for a specific field's value.
function decodePdfTextRuns(buf: Buffer): string[] {
  const str = buf.toString('latin1');
  const runs: string[] = [];
  const streamRe = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  let m: RegExpExecArray | null;
  while ((m = streamRe.exec(str))) {
    const raw = Buffer.from(m[1], 'latin1');
    let inflated: string;
    try {
      inflated = zlib.inflateSync(raw).toString('latin1');
    } catch {
      continue; // not a Flate stream (e.g. embedded font binary) — skip
    }
    for (const line of inflated.split('\n')) {
      const hexGroups = line.match(/<[0-9A-Fa-f]+>/g);
      if (!hexGroups) continue;
      let text = '';
      for (const g of hexGroups) {
        const hex = g.slice(1, -1);
        for (let i = 0; i + 1 < hex.length; i += 2) {
          text += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
        }
      }
      if (text) runs.push(text);
    }
  }
  return runs;
}

function containsText(buf: Buffer, needle: string): boolean {
  return decodePdfTextRuns(buf).some((r) => r.includes(needle));
}

function baseInvoiceData(overrides: Partial<InvoiceData> = {}): InvoiceData {
  return {
    invoiceNumber: 'GE/GST/2026-27/001',
    invoiceDate: new Date('2026-07-01'),
    dueDate: new Date('2026-07-15'),
    invoiceType: 'gst',
    taxType: 'cgst_sgst',
    companyName: 'Growth Escalators',
    companyAddress: 'Jaipur, Rajasthan',
    companyGstin: '22AAAAA0000A1Z5',
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

describe('generateInvoicePDF (reseller-readiness — tenant-driven company identity)', () => {
  // Regression coverage for a real bug found while wiring this up:
  // InvoiceData.companyName/companyAddress were already defined fields, and
  // src/routes/billing.ts already passed a tenant-specific value into them,
  // but generateInvoicePDF's header rendering ignored both and hardcoded
  // 'GROWTH ESCALATORS' / the Jaipur address directly — so passing a
  // different tenant's identity in had NO effect on the rendered PDF. Same
  // bug for the "Bank: <name>" line, which used to be hardcoded independent of
  // companyBank. These tests render real PDF bytes and decode the content
  // stream (see decodePdfTextRuns above) rather than asserting on the
  // JS object passed in, specifically so they can't pass while that bug is
  // still present.
  it('renders companyName (uppercased) and companyAddress from the passed-in data, not a hardcoded literal', async () => {
    const bufAcme = await generateInvoicePDF(baseInvoiceData({
      companyName: 'Acme Reseller Pvt Ltd',
      companyAddress: '42 MG Road, Bengaluru, Karnataka 560001',
    }));
    expect(containsText(bufAcme, 'ACME RESELLER PVT LTD')).toBe(true);
    expect(containsText(bufAcme, '42 MG Road, Bengaluru, Karnataka 560001')).toBe(true);

    // A second, differently-configured tenant must render ITS OWN name/
    // address, not Acme's — proving the header text tracks
    // data.companyName/companyAddress rather than being hardcoded to any
    // single literal (which is exactly the bug this test guards against).
    const bufOther = await generateInvoicePDF(baseInvoiceData({
      companyName: 'Example Operator Pvt Ltd',
      companyAddress: '1 Example Business Park, Sample City, Karnataka 560001',
    }));
    expect(containsText(bufOther, 'EXAMPLE OPERATOR PVT LTD')).toBe(true);
    expect(containsText(bufOther, '1 Example Business Park, Sample City, Karnataka 560001')).toBe(true);
    expect(containsText(bufOther, 'ACME RESELLER PVT LTD')).toBe(false);
    expect(containsText(bufOther, '42 MG Road')).toBe(false);
  });

  it('renders companyBank.bankName ("Bank: <name>") from the passed-in data, not a hardcoded literal', async () => {
    const bufAcme = await generateInvoicePDF(baseInvoiceData({
      companyBank: { accountNo: '000111222333', name: 'Acme Reseller Pvt Ltd', ifsc: 'HDFC0000001', type: 'Current Account', bankName: 'HDFC Bank' },
    }));
    expect(containsText(bufAcme, 'Bank: HDFC Bank')).toBe(true);

    const bufOther = await generateInvoicePDF(baseInvoiceData({
      companyBank: { accountNo: '000123456789', name: 'Example Operator Pvt Ltd', ifsc: 'EXBK0001234', type: 'Current Account', bankName: 'Example Bank' },
    }));
    expect(containsText(bufOther, 'Bank: Example Bank')).toBe(true);
    expect(containsText(bufOther, 'HDFC Bank')).toBe(false);
  });

  it('omits the "Bank:" line (rather than printing a blank/undefined name) when companyBank.bankName is not supplied', async () => {
    const buf = await generateInvoicePDF(baseInvoiceData({
      companyBank: { accountNo: '000111222333', name: 'Acme Reseller Pvt Ltd', ifsc: 'HDFC0000001', type: 'Current Account' },
    }));
    const runs = decodePdfTextRuns(buf);
    expect(runs.some((r) => r.startsWith('Bank:'))).toBe(false);
    // The rest of the block still renders.
    expect(containsText(buf, 'Account Name: Acme Reseller Pvt Ltd')).toBe(true);
  });

  it('renders a fully-configured identity end to end — header, GSTIN line, and full bank block all reflect exactly what was configured', async () => {
    // Fictitious tenant identity, shaped like what a fully-configured
    // default-tenant row would resolve to (see the FAKE_DEFAULT_TENANT_ENV
    // fixture in tenantBrandingDefaults.test.ts) — proves the complete
    // render path (header + GSTIN line + full 5-line bank block at its
    // standard y-offsets) works end to end for whatever identity a tenant
    // has configured, not a hardcoded literal.
    const buf = await generateInvoicePDF(baseInvoiceData({
      companyName: 'Example Operator Pvt Ltd',
      companyAddress: '1 Example Business Park, Sample City, Karnataka 560001',
      companyGstin: '22AAAAA0000A1Z5',
      companyBank: { accountNo: '000123456789', name: 'Example Operator Pvt Ltd', ifsc: 'EXBK0001234', type: 'Current Account', bankName: 'Example Bank' },
    }));
    expect(containsText(buf, 'EXAMPLE OPERATOR PVT LTD')).toBe(true);
    expect(containsText(buf, '1 Example Business Park, Sample City, Karnataka 560001')).toBe(true);
    expect(containsText(buf, 'GSTIN: 22AAAAA0000A1Z5')).toBe(true);
    expect(containsText(buf, 'Bank: Example Bank')).toBe(true);
    expect(containsText(buf, 'Account No: 000123456789')).toBe(true);
    expect(containsText(buf, 'IFSC: EXBK0001234')).toBe(true);
  });

  it('uses the tenant\'s primaryColor/accentColor when supplied, and Growth Escalators\' own palette when not', async () => {
    const withDefaults = await generateInvoicePDF(baseInvoiceData());
    const withTenantColors = await generateInvoicePDF(baseInvoiceData({ primaryColor: '#112233', accentColor: '#445566' }));
    // Different header fill colours produce different bytes even though the
    // text content is identical — a coarse but reliable enough signal that
    // the colour actually flowed through into the render.
    expect(withDefaults.equals(withTenantColors)).toBe(false);
    // Passing nothing must still render (falls back to GE's palette
    // internally) — this is the "zero behavior change for any existing
    // caller that predates this field" guarantee.
    expect(withDefaults.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
