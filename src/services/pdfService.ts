import PDFDocument from 'pdfkit';
import path from 'path';

// pdfkit's built-in fonts (Helvetica etc.) are WinAnsi-encoded and render any
// Devanagari code point (U+0900-U+097F — Hindi/Marathi/Sanskrit script) as a
// blank glyph. A client billed under a Devanagari-script legal name would get
// an unreadable BILL TO block on their tax invoice. These embedded fonts fix
// that for the two fields most likely to carry a client's own name.
// Path mirrors src/scripts/migrate.ts's pattern for reaching sibling `src/`
// files from compiled `dist/` at runtime (this repo ships `src/` alongside
// `dist/` to Railway — see .railwayignore).
const DEVANAGARI_FONT_REGULAR = path.join(__dirname, '..', '..', 'src', 'assets', 'fonts', 'NotoSansDevanagari-Regular.ttf');
const DEVANAGARI_FONT_BOLD = path.join(__dirname, '..', '..', 'src', 'assets', 'fonts', 'NotoSansDevanagari-Bold.ttf');

function isDevanagari(codePoint: number): boolean {
  return codePoint >= 0x0900 && codePoint <= 0x097f;
}

// Splits a string into runs of consecutive Devanagari vs non-Devanagari
// characters, so a name mixing scripts (e.g. "श्री राम Pvt Ltd") can be
// rendered with the right font per run instead of one font for the whole
// line. Devanagari font files ship no Latin glyphs and vice versa — pdfkit
// does not do per-glyph font fallback, so this has to be done manually.
function splitScriptRuns(text: string): Array<{ text: string; devanagari: boolean }> {
  const runs: Array<{ text: string; devanagari: boolean }> = [];
  let current = '';
  let currentIsDevanagari: boolean | null = null;
  for (const ch of text) {
    const isDeva = isDevanagari(ch.codePointAt(0) ?? 0);
    if (currentIsDevanagari === null || isDeva === currentIsDevanagari) {
      current += ch;
    } else {
      runs.push({ text: current, devanagari: currentIsDevanagari });
      current = ch;
    }
    currentIsDevanagari = isDeva;
  }
  if (current) runs.push({ text: current, devanagari: currentIsDevanagari ?? false });
  return runs;
}

interface LineItem {
  description: string;
  sacCode: string;
  quantity: number;
  unit: string;
  rate: number;   // paise
  amount: number; // paise
}

interface BankDetails {
  accountNo: string;
  name: string;
  ifsc: string;
  type: string;
}

export interface InvoiceData {
  invoiceNumber: string;
  invoiceDate: Date;
  dueDate: Date;
  invoiceType: 'gst' | 'non_gst';
  taxType: 'igst' | 'cgst_sgst' | null;
  companyName: string;
  companyAddress: string;
  companyGstin: string | null;
  companyBank: BankDetails | null;
  clientName: string;
  clientContactPerson: string | null;
  clientAddress: string;
  clientGstin: string | null;
  clientState: string | null;
  lineItems: LineItem[];
  subtotal: number;   // paise
  discountType?: 'fixed' | 'percent' | null;
  discountPercent?: number;  // only when type='percent'
  discountAmount?: number;   // paise — the resolved amount deducted
  discountLabel?: string | null;
  cgstRate: number;
  cgstAmount: number; // paise
  sgstRate: number;
  sgstAmount: number; // paise
  igstRate: number;
  igstAmount: number; // paise
  totalAmount: number; // paise
  amountInWords: string;
  notes: string | null;
  paymentNote: string | null;
  sacCode: string;
  // Status — when 'paid', render the document as a payment receipt:
  // header badge flips to PAID, diagonal "PAID" watermark across the page,
  // bank details replaced with payment confirmation block, paid-on date shown.
  status?: 'draft' | 'sent' | 'paid' | 'partially_paid' | 'overdue' | 'cancelled' | null;
  paidAt?: Date | null;
  amountPaid?: number | null; // paise — relevant for partially_paid
}

export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const buffers: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    // Register the Devanagari fonts on this document instance. Failure here
    // (e.g. a deploy that somehow lost the font files) must not break
    // invoice generation — fall back to Helvetica-only rendering, which is
    // exactly today's behavior (Devanagari renders blank) rather than a 500.
    let devanagariAvailable = true;
    try {
      doc.registerFont('NotoSansDevanagari', DEVANAGARI_FONT_REGULAR);
      doc.registerFont('NotoSansDevanagari-Bold', DEVANAGARI_FONT_BOLD);
    } catch {
      devanagariAvailable = false;
    }

    // Renders text that may mix Latin (Helvetica) and Devanagari (embedded
    // Noto Sans Devanagari) runs on a single line at (x, y). Restores the
    // base font afterward so it doesn't leak into subsequent .text() calls
    // elsewhere in this function.
    function renderMixedScriptText(text: string, x: number, y: number, bold: boolean) {
      const baseFont = bold ? 'Helvetica-Bold' : 'Helvetica';
      if (!devanagariAvailable) {
        doc.font(baseFont).text(text, x, y);
        return;
      }
      const devFont = bold ? 'NotoSansDevanagari-Bold' : 'NotoSansDevanagari';
      let cursorX = x;
      for (const run of splitScriptRuns(text)) {
        doc.font(run.devanagari ? devFont : baseFont);
        doc.text(run.text, cursorX, y, { lineBreak: false });
        cursorX += doc.widthOfString(run.text);
      }
      doc.font(baseFont);
    }

    const W = 515;
    const primaryColor = '#1A3A5C';
    const accentColor = '#F97316';
    const paidColor = '#16A34A'; // emerald-600 — used everywhere status is paid
    const lightGray = '#F3F4F6';
    const darkGray = '#374151';
    const midGray = '#6B7280';

    const isPaid = data.status === 'paid';
    const isPartial = data.status === 'partially_paid';
    const isCancelled = data.status === 'cancelled';
    const badgeColor = isPaid ? paidColor : accentColor;

    // ── HEADER ──
    doc.rect(40, 40, W, 70).fill(primaryColor);
    doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold')
       .text('GROWTH ESCALATORS', 55, 52);
    doc.fontSize(9).font('Helvetica')
       .text('264/103-104 Pratap Nagar, Sanganer, Jaipur, Rajasthan 302033', 55, 78);
    if (data.companyGstin) {
      doc.text(`GSTIN: ${data.companyGstin}`, 55, 91);
    }

    // Header badge — flips between INVOICE / TAX INVOICE / RECEIPT depending on
    // status. Paid invoices read as a receipt the client can keep.
    let badgeText: string;
    if (isPaid) badgeText = data.invoiceType === 'gst' ? 'PAID · TAX RECEIPT' : 'PAID · RECEIPT';
    else if (isCancelled) badgeText = 'CANCELLED';
    else if (isPartial) badgeText = 'PARTIALLY PAID';
    else badgeText = data.invoiceType === 'gst' ? 'TAX INVOICE' : 'INVOICE';

    doc.rect(380, 48, 130, 24).fill(badgeColor);
    doc.fillColor('#FFFFFF').fontSize(badgeText.length > 18 ? 9 : 11).font('Helvetica-Bold')
       .text(badgeText, 380, badgeText.length > 18 ? 55 : 53, { width: 130, align: 'center' });

    // ── INVOICE META ──
    doc.rect(40, 120, W, 1).fill('#E5E7EB');
    doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold')
       .text('INVOICE DETAILS', 40, 130);

    const metaY = 148;
    const fmtDate = (d: Date) =>
      d.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

    doc.fillColor(midGray).fontSize(9).font('Helvetica')
       .text('Invoice Number:', 40, metaY)
       .text('Invoice Date:', 40, metaY + 16)
       .text(isPaid ? 'Paid On:' : 'Due Date:', 40, metaY + 32);

    doc.fillColor(isPaid ? paidColor : darkGray).font('Helvetica-Bold')
       .text(data.invoiceNumber, 150, metaY)
       .text(fmtDate(data.invoiceDate), 150, metaY + 16);

    // Date line — for paid invoices, show paid date (fall back to due date).
    if (isPaid) {
      const paidOn = data.paidAt ?? data.dueDate;
      doc.fillColor(paidColor).font('Helvetica-Bold')
         .text(fmtDate(paidOn), 150, metaY + 32);
    } else {
      doc.fillColor(darkGray).font('Helvetica-Bold')
         .text(fmtDate(data.dueDate), 150, metaY + 32);
    }

    // ── BILL TO ──
    doc.rect(300, 120, 1, 80).fill('#E5E7EB');
    doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold')
       .text('BILL TO', 310, 130);

    doc.fillColor(darkGray).fontSize(10);
    renderMixedScriptText(data.clientName, 310, 148, true);
    doc.font('Helvetica').fontSize(9).fillColor(midGray);

    if (data.clientContactPerson) {
      renderMixedScriptText(`Attn: ${data.clientContactPerson}`, 310, 162, false);
    }
    doc.text(data.clientAddress, 310, data.clientContactPerson ? 176 : 162, { width: 230 });
    if (data.clientGstin) {
      doc.fillColor(darkGray).font('Helvetica-Bold')
         .text(`GSTIN: ${data.clientGstin}`, 310, 210);
    }

    // ── LINE ITEMS TABLE ──
    const tableY = 228;
    doc.rect(40, tableY, W, 22).fill(primaryColor);
    doc.fillColor('#FFFFFF').fontSize(9).font('Helvetica-Bold')
       .text('#', 48, tableY + 7)
       .text('Description', 65, tableY + 7)
       .text('SAC', 320, tableY + 7)
       .text('Qty', 365, tableY + 7)
       .text('Rate (₹)', 405, tableY + 7)
       .text('Amount (₹)', 458, tableY + 7);

    let rowY = tableY + 22;
    data.lineItems.forEach((item, idx) => {
      const isEven = idx % 2 === 0;
      if (isEven) doc.rect(40, rowY, W, 22).fill(lightGray);

      doc.fillColor(darkGray).fontSize(9).font('Helvetica')
         .text((idx + 1).toString(), 48, rowY + 7)
         .text(item.description, 65, rowY + 7, { width: 248 })
         .text(item.sacCode, 320, rowY + 7)
         .text(item.quantity.toString(), 365, rowY + 7)
         .text((item.rate / 100).toLocaleString('en-IN'), 405, rowY + 7)
         .text((item.amount / 100).toLocaleString('en-IN'), 458, rowY + 7);

      rowY += 22;
    });

    // ── TOTALS ──
    const totY = rowY + 8;
    doc.rect(40, totY - 4, W, 1).fill('#E5E7EB');

    const labelX = 370;
    const valX = 458;

    doc.fillColor(midGray).fontSize(9).font('Helvetica')
       .text('Subtotal:', labelX, totY);
    doc.fillColor(darkGray).font('Helvetica-Bold')
       .text(`₹${(data.subtotal / 100).toLocaleString('en-IN')}`, valX, totY);

    let taxY = totY + 16;

    // Discount row (only if a discount was applied)
    if (data.discountAmount && data.discountAmount > 0) {
      const discountLabel = data.discountLabel
        || (data.discountType === 'percent' ? `Discount (${data.discountPercent}%)` : 'Discount');
      doc.fillColor(midGray).font('Helvetica')
         .text(`${discountLabel}:`, labelX, taxY);
      doc.fillColor(darkGray).font('Helvetica-Bold')
         .text(`− ₹${(data.discountAmount / 100).toLocaleString('en-IN')}`, valX, taxY);
      taxY += 16;
    }

    if (data.taxType === 'cgst_sgst') {
      doc.fillColor(midGray).font('Helvetica')
         .text(`CGST @ ${data.cgstRate}%:`, labelX, taxY);
      doc.fillColor(darkGray).font('Helvetica-Bold')
         .text(`₹${(data.cgstAmount / 100).toLocaleString('en-IN')}`, valX, taxY);
      taxY += 16;
      doc.fillColor(midGray).font('Helvetica')
         .text(`SGST @ ${data.sgstRate}%:`, labelX, taxY);
      doc.fillColor(darkGray).font('Helvetica-Bold')
         .text(`₹${(data.sgstAmount / 100).toLocaleString('en-IN')}`, valX, taxY);
      taxY += 16;
    } else if (data.taxType === 'igst') {
      doc.fillColor(midGray).font('Helvetica')
         .text(`IGST @ ${data.igstRate}%:`, labelX, taxY);
      doc.fillColor(darkGray).font('Helvetica-Bold')
         .text(`₹${(data.igstAmount / 100).toLocaleString('en-IN')}`, valX, taxY);
      taxY += 16;
    }

    // Total box
    doc.rect(350, taxY + 4, W - 310, 26).fill(primaryColor);
    doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
       .text('TOTAL:', labelX, taxY + 10)
       .text(`₹${(data.totalAmount / 100).toLocaleString('en-IN')}`, valX, taxY + 10);

    // Amount in words
    const wordsY = taxY + 40;
    doc.rect(40, wordsY, W, 26).fill(lightGray);
    doc.fillColor(midGray).fontSize(8).font('Helvetica')
       .text('Amount in words:', 48, wordsY + 4);
    doc.fillColor(darkGray).font('Helvetica-Bold').fontSize(9)
       .text(data.amountInWords, 48, wordsY + 14, { width: W - 16 });

    // ── PAYMENT BLOCK ──
    // For paid invoices: show a green "Payment received" confirmation block
    // and HIDE the bank-details (client doesn't need them anymore — they already paid).
    // For unpaid: show bank details (GST) or the freeform payment note (non-GST).
    const bankY = wordsY + 36;
    if (isPaid) {
      doc.rect(40, bankY, W, 60).fill('#ECFDF5'); // emerald-50
      doc.rect(40, bankY, 4, 60).fill(paidColor);
      doc.fillColor(paidColor).fontSize(12).font('Helvetica-Bold')
         .text('PAYMENT RECEIVED', 56, bankY + 10);
      doc.fillColor(darkGray).fontSize(9).font('Helvetica')
         .text(
           `Received ₹${(data.totalAmount / 100).toLocaleString('en-IN')} on ${fmtDate(data.paidAt ?? data.dueDate)}.`,
           56, bankY + 28, { width: W - 20 },
         )
         .text(
           'This document serves as a receipt for the above payment. No further action is required.',
           56, bankY + 42, { width: W - 20 },
         );
    } else if (isPartial && data.amountPaid != null && data.amountPaid > 0) {
      const remaining = Math.max(0, data.totalAmount - data.amountPaid);
      doc.rect(40, bankY, W, 60).fill('#FEF3C7'); // amber-100
      doc.rect(40, bankY, 4, 60).fill('#D97706'); // amber-600
      doc.fillColor('#92400E').fontSize(12).font('Helvetica-Bold')
         .text('PARTIAL PAYMENT RECEIVED', 56, bankY + 10);
      doc.fillColor(darkGray).fontSize(9).font('Helvetica')
         .text(
           `Received ₹${(data.amountPaid / 100).toLocaleString('en-IN')}. Balance due: ₹${(remaining / 100).toLocaleString('en-IN')}.`,
           56, bankY + 28, { width: W - 20 },
         );
      // Still show bank details below since balance is due
      if (data.invoiceType === 'gst' && data.companyBank) {
        const bY2 = bankY + 72;
        doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold')
           .text('Bank Details (for balance)', 40, bY2);
        doc.fillColor(midGray).fontSize(9).font('Helvetica')
           .text(`Bank: ICICI Bank   Account: ${data.companyBank.accountNo}   IFSC: ${data.companyBank.ifsc}`, 40, bY2 + 14, { width: W });
      }
    } else if (data.invoiceType === 'gst' && data.companyBank) {
      doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold')
         .text('Bank Details', 40, bankY);
      doc.fillColor(midGray).fontSize(9).font('Helvetica')
         .text('Bank: ICICI Bank', 40, bankY + 14)
         .text(`Account Name: ${data.companyBank.name}`, 40, bankY + 26)
         .text(`Account No: ${data.companyBank.accountNo}`, 40, bankY + 38)
         .text(`IFSC: ${data.companyBank.ifsc}`, 40, bankY + 50)
         .text(`Account Type: ${data.companyBank.type}`, 40, bankY + 62);
    } else if (data.paymentNote) {
      doc.fillColor(primaryColor).fontSize(10).font('Helvetica-Bold')
         .text('Payment Details', 40, bankY);
      doc.fillColor(darkGray).fontSize(9).font('Helvetica')
         .text(data.paymentNote, 40, bankY + 14, { width: W });
    }

    // Notes
    if (data.notes) {
      const notesY = bankY + 90;
      doc.rect(40, notesY, W, 1).fill('#E5E7EB');
      doc.fillColor(midGray).fontSize(9).font('Helvetica-Oblique')
         .text(data.notes, 40, notesY + 8, { width: W });
    }

    // ── FOOTER ──
    doc.rect(40, 780, W, 1).fill('#E5E7EB');
    doc.fillColor(midGray).fontSize(8).font('Helvetica')
       .text(
         isPaid
           ? 'This is a computer generated receipt. Retain for your records.'
           : isCancelled
             ? 'This invoice has been cancelled.'
             : 'This is a computer generated invoice.',
         40, 786, { width: W, align: 'center' },
       );
    doc.fillColor(isPaid ? paidColor : accentColor).font('Helvetica-Bold')
       .text(isPaid ? 'Payment received — thank you!' : 'Thank you for your business!',
             40, 798, { width: W, align: 'center' });

    // ── DIAGONAL "PAID" WATERMARK ──
    // Drawn last so it sits above the content. Light-fill + low opacity so the
    // document below stays readable. Diagonal at ~30° across the page.
    if (isPaid || isCancelled) {
      doc.save();
      doc.translate(297, 421); // page centre on A4
      doc.rotate(-30);
      doc.fillColor(isPaid ? paidColor : '#9CA3AF').opacity(0.12)
         .fontSize(140).font('Helvetica-Bold')
         .text(isPaid ? 'PAID' : 'CANCELLED', -260, -70, { width: 520, align: 'center' });
      doc.opacity(1);
      doc.restore();
    }

    doc.end();
  });
}
