/**
 * Wizmatch Right-to-Represent (RTR) PDF Generator
 *
 * Generates a professional RTR document using pdfkit, uploads to R2,
 * and stores the URL on wizmatch_placements.rtr_document_url.
 *
 * Called by POST /api/wizmatch/placements/:id/rtr
 */

import PDFDocument from 'pdfkit';
import { pool } from '../db/index';
import { uploadToR2 } from '../utils/r2';
import logger from '../utils/logger';

// ── Types ────────────────────────────────────────────────────────────────────

interface RtrData {
  candidateName: string;
  candidateEmail: string;
  candidatePhone: string;
  company: string;
  jobTitle: string;
  jobLocation: string;
  employmentType: string;
  billRate: number | null;
  currency: string;
  startDate: string | null;
  endDate: string | null;
  wizmatchRep: string;
}

interface GenerateResult {
  success: boolean;
  rtr_url: string | null;
  error: string | null;
}

// ── PDF generation ───────────────────────────────────────────────────────────

function buildPdfBuffer(data: RtrData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    // ── Header ──
    doc
      .fontSize(20)
      .font('Helvetica-Bold')
      .text('RIGHT TO REPRESENT', { align: 'center' });
    doc.moveDown(0.5);
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#666666')
      .text('Wizmatch LLC — IT Staffing & Consulting', { align: 'center' });
    doc.moveDown(1.5);

    // ── Date ──
    doc
      .fontSize(10)
      .fillColor('#000000')
      .text(`Date: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}`);
    doc.moveDown(1);

    // ── To ──
    doc.font('Helvetica-Bold').text('To:');
    doc.font('Helvetica').text(`${data.company}`);
    doc.moveDown(0.5);

    // ── Subject ──
    doc.font('Helvetica-Bold').text('Subject: ');
    doc.font('Helvetica').text(
      `Right to Represent ${data.candidateName} for ${data.jobTitle} position`,
      { continued: false },
    );
    doc.moveDown(1);

    // ── Body ──
    doc.font('Helvetica').text('Dear Hiring Team,');
    doc.moveDown(0.5);
    doc.text(
      `This letter confirms that Wizmatch LLC has the exclusive right to represent ${data.candidateName} ` +
      `for the position of ${data.jobTitle} at ${data.company}. The candidate's details are as follows:`,
    );
    doc.moveDown(1);

    // ── Candidate Details Table ──
    const details: Array<[string, string]> = [
      ['Candidate Name', data.candidateName],
      ['Email', data.candidateEmail],
      ['Phone', data.candidatePhone],
      ['Position', data.jobTitle],
      ['Work Location', data.jobLocation],
      ['Employment Type', data.employmentType],
    ];

    if (data.billRate) {
      details.push(['Bill Rate', `${data.currency} ${data.billRate}/hr`]);
    }
    if (data.startDate) {
      details.push(['Start Date', data.startDate]);
    }
    if (data.endDate) {
      details.push(['End Date', data.endDate]);
    }

    for (const [label, value] of details) {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(value);
    }
    doc.moveDown(1);

    // ── Terms ──
    doc.font('Helvetica-Bold').text('Terms & Conditions:');
    doc.moveDown(0.3);
    doc.font('Helvetica').fontSize(9);
    const terms = [
      '1. This Right to Represent is valid for 30 days from the date of this letter.',
      '2. Wizmatch LLC is the authorized representative of the candidate for this specific position.',
      '3. The client agrees not to bypass Wizmatch LLC and contact the candidate directly.',
      '4. The bill rate mentioned above is inclusive of all applicable taxes and fees.',
      '5. This RTR is specific to the position mentioned above and does not cover other roles.',
    ];
    for (const term of terms) {
      doc.text(term);
      doc.moveDown(0.2);
    }
    doc.moveDown(1);

    // ── Signatures ──
    doc.fontSize(10);
    doc.text('Sincerely,');
    doc.moveDown(2);
    doc.font('Helvetica-Bold').text(`${data.wizmatchRep}`);
    doc.font('Helvetica').text('Wizmatch LLC');
    doc.text('Email: team@getwizmatch.com');
    doc.moveDown(2);

    // Signature lines
    const sigY = doc.y;
    doc.text('________________________', 50, sigY);
    doc.text('________________________', 300, sigY);
    doc.font('Helvetica').fontSize(9);
    doc.text(`${data.candidateName} (Candidate)`, 50, sigY + 15);
    doc.text(`${data.wizmatchRep} (Wizmatch)`, 300, sigY + 15);

    doc.end();
  });
}

// ── Main generator ───────────────────────────────────────────────────────────

export async function generateRtrPdf(placementId: string): Promise<GenerateResult> {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  if (!tenantId) {
    return { success: false, rtr_url: null, error: 'WIZMATCH_TENANT_ID not set' };
  }

  // Fetch placement + candidate + company details
  const result = await pool.query(
    `SELECT wp.*, wc.skills, wc.location AS candidate_location,
            c.first_name, c.last_name,
            cc_email.channel_value AS candidate_email,
            cc_phone.channel_value AS candidate_phone,
            comp.name AS company_name, comp.domain AS company_domain,
            js.job_title, js.location AS job_location, js.employment_type
     FROM wizmatch_placements wp
     JOIN wizmatch_candidates wc ON wc.id = wp.candidate_id
     JOIN contacts c ON c.id = wc.contact_id
     LEFT JOIN contact_channels cc_email ON cc_email.contact_id = c.id AND cc_email.channel_type = 'email'
     LEFT JOIN contact_channels cc_phone ON cc_phone.contact_id = c.id AND cc_phone.channel_type = 'phone'
     LEFT JOIN wizmatch_companies comp ON comp.id = wp.company_id
     LEFT JOIN wizmatch_job_signals js ON js.id = wp.job_signal_id
     WHERE wp.id = $1 AND wp.tenant_id = $2`,
    [placementId, tenantId],
  );

  if (result.rows.length === 0) {
    return { success: false, rtr_url: null, error: 'Placement not found' };
  }

  const row = result.rows[0];
  const rtrData: RtrData = {
    candidateName: `${row.first_name} ${row.last_name}`.trim(),
    candidateEmail: row.candidate_email || 'N/A',
    candidatePhone: row.candidate_phone || 'N/A',
    company: row.company_name || 'The Company',
    jobTitle: row.job_title || 'N/A',
    jobLocation: row.job_location || row.candidate_location || 'N/A',
    employmentType: row.employment_type || row.placement_type || 'N/A',
    billRate: row.bill_rate_hourly || null,
    currency: row.currency || 'USD',
    startDate: row.contract_start_date ? new Date(row.contract_start_date).toLocaleDateString('en-US') : null,
    endDate: row.contract_end_date ? new Date(row.contract_end_date).toLocaleDateString('en-US') : null,
    wizmatchRep: 'Archit',
  };

  try {
    // Generate PDF
    const pdfBuffer = await buildPdfBuffer(rtrData);

    // Upload to R2
    const filename = `wizmatch/rtrs/${placementId}/${Date.now()}.pdf`;
    const rtrUrl = await uploadToR2(pdfBuffer, filename, 'application/pdf');

    // Update placement
    await pool.query(
      `UPDATE wizmatch_placements SET rtr_document_url = $3, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [placementId, tenantId, rtrUrl],
    );

    logger.info(`[wizmatch-rtr] Generated RTR for placement ${placementId}: ${rtrUrl}`);

    return { success: true, rtr_url: rtrUrl, error: null };
  } catch (e) {
    logger.error('[wizmatch-rtr] Failed to generate RTR:', e instanceof Error ? e.message : String(e));
    return { success: false, rtr_url: null, error: e instanceof Error ? e.message : 'unknown' };
  }
}