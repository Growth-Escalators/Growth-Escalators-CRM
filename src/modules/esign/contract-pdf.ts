// Minimal unsigned-contract PDF generator (pdfkit — already a dependency).
// Produces the document that gets sent for signature. Deliberately simple for
// v1 (no drag-and-drop editor): title, parties, terms, signature blocks. For
// Documenso-template-backed contracts this is skipped (the template IS the doc);
// this covers the "generate from CRM data" path.
import PDFDocument from 'pdfkit';

export interface ContractPdfParty {
  role: string;
  name: string;
  company?: string;
  email: string;
}

export interface ContractPdfInput {
  title: string;
  referenceNumber: string;
  version: number;
  legalEntity?: string;
  parties: ContractPdfParty[];
  /** Free-text terms (plain text; rendered as paragraphs). */
  terms?: string;
}

export function generateContractPdf(input: ContractPdfInput): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 54 });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).fillColor('#111').text(input.title, { align: 'left' });
      doc.moveDown(0.3);
      doc
        .fontSize(9)
        .fillColor('#666')
        .text(`Reference: ${input.referenceNumber}    Version: ${input.version}`);
      if (input.legalEntity) doc.text(`Issued by: ${input.legalEntity}`);
      doc.moveDown(1);

      doc.fontSize(12).fillColor('#111').text('Parties', { underline: true });
      doc.moveDown(0.3).fontSize(10).fillColor('#222');
      for (const p of input.parties) {
        const company = p.company ? `, ${p.company}` : '';
        doc.text(`• ${p.role.replace(/_/g, ' ')}: ${p.name}${company} <${p.email}>`);
      }
      doc.moveDown(1);

      if (input.terms && input.terms.trim()) {
        doc.fontSize(12).fillColor('#111').text('Terms', { underline: true });
        doc.moveDown(0.3).fontSize(10).fillColor('#222');
        for (const para of input.terms.split(/\n{2,}/)) {
          doc.text(para.trim(), { align: 'left' });
          doc.moveDown(0.5);
        }
      }

      doc.moveDown(2);
      doc.fontSize(12).fillColor('#111').text('Signatures', { underline: true });
      doc.moveDown(0.5).fontSize(10).fillColor('#222');
      for (const p of input.parties) {
        doc.text(`${p.name} (${p.role.replace(/_/g, ' ')})`);
        doc.text('_______________________________     Date: ____________');
        doc.moveDown(1);
      }

      doc.end();
    } catch (err) {
      reject(err as Error);
    }
  });
}
