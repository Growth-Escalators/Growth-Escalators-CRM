import PDFDocument from 'pdfkit';

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
}

export async function generateInvoicePDF(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    const buffers: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const W = 515;
    const primaryColor = '#1A3A5C';
    const accentColor = '#F97316';
    const lightGray = '#F3F4F6';
    const darkGray = '#374151';
    const midGray = '#6B7280';

    // ── HEADER ──
    doc.rect(40, 40, W, 70).fill(primaryColor);
    doc.fillColor('#FFFFFF').fontSize(22).font('Helvetica-Bold')
       .text('GROWTH ESCALATORS', 55, 52);
    doc.fontSize(9).font('Helvetica')
       .text('264/103-104 Pratap Nagar, Sanganer, Jaipur, Rajasthan 302033', 55, 78);
    if (data.companyGstin) {
      doc.text(`GSTIN: ${data.companyGstin}`, 55, 91);
    }

    const badgeText = data.invoiceType === 'gst' ? 'TAX INVOICE' : 'INVOICE';
    doc.rect(380, 48, 130, 24).fill(accentColor);
    doc.fillColor('#FFFFFF').fontSize(11).font('Helvetica-Bold')
       .text(badgeText, 380, 53, { width: 130, align: 'center' });

    // ── INVOICE META ──
    doc.rect(40, 120, W, 1).fill('#E5E7EB');
    doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold')
       .text('INVOICE DETAILS', 40, 130);

    const metaY = 148;
    doc.fillColor(midGray).fontSize(9).font('Helvetica')
       .text('Invoice Number:', 40, metaY)
       .text('Invoice Date:', 40, metaY + 16)
       .text('Due Date:', 40, metaY + 32);

    doc.fillColor(darkGray).font('Helvetica-Bold')
       .text(data.invoiceNumber, 150, metaY)
       .text(data.invoiceDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }), 150, metaY + 16)
       .text(data.dueDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }), 150, metaY + 32);

    // ── BILL TO ──
    doc.rect(300, 120, 1, 80).fill('#E5E7EB');
    doc.fillColor(primaryColor).fontSize(11).font('Helvetica-Bold')
       .text('BILL TO', 310, 130);

    doc.fillColor(darkGray).fontSize(10).font('Helvetica-Bold')
       .text(data.clientName, 310, 148);
    doc.font('Helvetica').fontSize(9).fillColor(midGray);

    if (data.clientContactPerson) {
      doc.text(`Attn: ${data.clientContactPerson}`, 310, 162);
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

    // ── BANK DETAILS or PAYMENT NOTE ──
    const bankY = wordsY + 36;
    if (data.invoiceType === 'gst' && data.companyBank) {
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
       .text('This is a computer generated invoice.', 40, 786, { width: W, align: 'center' });
    doc.fillColor(accentColor).font('Helvetica-Bold')
       .text('Thank you for your business!', 40, 798, { width: W, align: 'center' });

    doc.end();
  });
}
