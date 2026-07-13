/**
 * Wizmatch Requirement Sheet
 *
 * Two responsibilities:
 *   1. parseRequirement() — turn a client's raw requirement (pasted text OR an
 *      uploaded JD file: PDF/image) into structured fields, via Claude. Used by
 *      POST /requirements/parse to pre-fill the "basics" form.
 *   2. generateRequirementSheet() — render our own branded requirement PDF
 *      (pdfkit) and upload to R2, storing the URL on wizmatch_requirements.
 *      Modeled on wizmatchRtrGenerator.ts.
 */

import PDFDocument from 'pdfkit';
import { pool } from '../db/index';
import { uploadPrivateToR2 } from '../utils/r2';
import { callClaude, callClaudeWithContent, parseClaudeJSON, CLAUDE_MODELS, type ClaudeContentBlock } from './claudeService';
import {
  WIZMATCH_BRAND_NAME,
  WIZMATCH_BRAND_TAGLINE,
  WIZMATCH_BRAND_EMAIL,
  WIZMATCH_BRAND_WEBSITE,
  WIZMATCH_BRAND_PHONE,
  WIZMATCH_BRAND_ACCENT,
} from '../config/constants';
import logger from '../utils/logger';

// ── Parsing ────────────────────────────────────────────────────────────────

export interface ParsedRequirement {
  title: string | null;
  required_skills: string[];
  nice_to_have_skills: string[];
  min_experience: number | null;
  max_experience: number | null;
  location: string | null;
  work_mode: string | null; // onsite | remote | hybrid
  employment_type: string | null;
  region: string | null; // india | us
  budget_min: number | null;
  budget_max: number | null;
  budget_currency: string | null;
  budget_period: string | null; // hourly | monthly | annual
  positions: number | null;
  company_name: string | null;
}

const PARSE_INSTRUCTION = `You extract structured data from an IT staffing job requirement (a JD sent by a client).
Return ONLY JSON matching exactly this shape (use null / [] when unknown — never invent):
{
  "title": string|null,
  "required_skills": string[],
  "nice_to_have_skills": string[],
  "min_experience": number|null,   // years
  "max_experience": number|null,
  "location": string|null,
  "work_mode": "onsite"|"remote"|"hybrid"|null,
  "employment_type": string|null,  // e.g. contract, contract_c2c, contract_w2, permanent
  "region": "india"|"us"|null,     // infer from location/currency; default india if a rupee/INR budget or Indian city
  "budget_min": number|null,
  "budget_max": number|null,
  "budget_currency": "INR"|"USD"|null,
  "budget_period": "hourly"|"monthly"|"annual"|null,
  "positions": number|null,
  "company_name": string|null
}
Rules: split skills into must-have vs nice-to-have when the JD distinguishes them. For India, budgets are usually monthly INR (LPA => annual); for US, usually hourly USD. Plain JSON, no prose, no markdown.`;

/** Parse a requirement from pasted text and/or an uploaded file (base64). */
export async function parseRequirement(input: {
  text?: string;
  fileBase64?: string;
  mediaType?: string; // application/pdf or image/*
}): Promise<ParsedRequirement> {
  let responseText: string;

  if (input.fileBase64 && input.mediaType) {
    const fileBlock: ClaudeContentBlock =
      input.mediaType === 'application/pdf'
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: input.fileBase64 } }
        : { type: 'image', source: { type: 'base64', media_type: input.mediaType, data: input.fileBase64 } };
    const blocks: ClaudeContentBlock[] = [
      fileBlock,
      { type: 'text', text: `${PARSE_INSTRUCTION}\n\nExtract from the attached document.${input.text ? `\nAdditional context: ${input.text}` : ''}` },
    ];
    const res = await callClaudeWithContent(blocks, CLAUDE_MODELS.SONNET, 1500);
    responseText = res.text;
  } else {
    const res = await callClaude(
      `${PARSE_INSTRUCTION}\n\nJD text:\n"""\n${(input.text || '').slice(0, 12000)}\n"""`,
      CLAUDE_MODELS.SONNET,
      1500,
    );
    responseText = res.text;
  }

  const parsed = parseClaudeJSON<Partial<ParsedRequirement>>(responseText);
  return {
    title: parsed.title ?? null,
    required_skills: parsed.required_skills ?? [],
    nice_to_have_skills: parsed.nice_to_have_skills ?? [],
    min_experience: parsed.min_experience ?? null,
    max_experience: parsed.max_experience ?? null,
    location: parsed.location ?? null,
    work_mode: parsed.work_mode ?? null,
    employment_type: parsed.employment_type ?? null,
    region: parsed.region ?? null,
    budget_min: parsed.budget_min ?? null,
    budget_max: parsed.budget_max ?? null,
    budget_currency: parsed.budget_currency ?? null,
    budget_period: parsed.budget_period ?? null,
    positions: parsed.positions ?? null,
    company_name: parsed.company_name ?? null,
  };
}

// ── PDF generation ──────────────────────────────────────────────────────────

interface SheetRow {
  title: string;
  companyName: string | null;
  maskClient: boolean;
  location: string | null;
  workMode: string | null;
  employmentType: string | null;
  minExperience: number | null;
  maxExperience: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  budgetCurrency: string;
  budgetPeriod: string;
  positions: number;
  priority: string | null;
  requiredSkills: string[];
  niceToHaveSkills: string[];
  rawJd: string | null;
  vendorNotes: string | null;
}

function fmtBudget(row: SheetRow): string {
  if (row.budgetMin == null && row.budgetMax == null) return 'As per market / negotiable';
  const sym = row.budgetCurrency === 'INR' ? '₹' : row.budgetCurrency === 'USD' ? '$' : `${row.budgetCurrency} `;
  const per = row.budgetPeriod === 'hourly' ? '/hr' : row.budgetPeriod === 'annual' ? '/yr' : '/month';
  const range =
    row.budgetMin != null && row.budgetMax != null
      ? `${sym}${row.budgetMin.toLocaleString()} – ${sym}${row.budgetMax.toLocaleString()}`
      : `${sym}${(row.budgetMax ?? row.budgetMin)!.toLocaleString()}`;
  return `${range}${per}`;
}

function fmtExperience(row: SheetRow): string {
  if (row.minExperience == null && row.maxExperience == null) return '—';
  if (row.minExperience != null && row.maxExperience != null) return `${row.minExperience}–${row.maxExperience} yrs`;
  return `${row.minExperience ?? row.maxExperience}+ yrs`;
}

function buildPdfBuffer(row: SheetRow): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const accent = WIZMATCH_BRAND_ACCENT;

    // Header band
    doc.rect(0, 0, doc.page.width, 70).fill(accent);
    doc.fillColor('#ffffff').fontSize(22).font('Helvetica-Bold').text(WIZMATCH_BRAND_NAME, 50, 22);
    doc.fontSize(9).font('Helvetica').text(WIZMATCH_BRAND_TAGLINE, 50, 48);
    doc.y = 90;
    doc.fillColor('#000000');

    // Title
    doc.fontSize(16).font('Helvetica-Bold').text('JOB REQUIREMENT', { align: 'left' });
    doc.moveDown(0.2);
    doc.fontSize(14).fillColor('#111111').text(row.title);
    doc.fontSize(10).fillColor('#666666').font('Helvetica')
      .text(`${row.positions} position${row.positions === 1 ? '' : 's'}${!row.maskClient && row.companyName ? ` · Client: ${row.companyName}` : ''}`);
    doc.moveDown(0.8);

    // Meta table
    const meta: Array<[string, string]> = [
      ['Location', row.location || '—'],
      ['Work Mode', row.workMode || '—'],
      ['Employment Type', row.employmentType || '—'],
      ['Experience', fmtExperience(row)],
      ['Budget', fmtBudget(row)],
      ['Priority', row.priority || 'normal'],
    ];
    doc.fillColor('#000000').fontSize(10);
    for (const [label, value] of meta) {
      doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
      doc.font('Helvetica').text(value);
      doc.moveDown(0.15);
    }
    doc.moveDown(0.6);

    const section = (heading: string, body: () => void) => {
      doc.fillColor(accent).fontSize(11).font('Helvetica-Bold').text(heading);
      doc.moveDown(0.2);
      doc.fillColor('#000000').fontSize(10).font('Helvetica');
      body();
      doc.moveDown(0.6);
    };

    if (row.requiredSkills.length) {
      section('Must-have Skills', () => doc.text(row.requiredSkills.join('  •  ')));
    }
    if (row.niceToHaveSkills.length) {
      section('Nice-to-have Skills', () => doc.text(row.niceToHaveSkills.join('  •  ')));
    }
    if (row.rawJd) {
      section('Job Description', () => doc.fontSize(9).text(row.rawJd!.slice(0, 3000)));
    }
    if (row.vendorNotes) {
      section('Notes for Vendors', () => doc.text(row.vendorNotes!));
    }

    // Footer
    const footY = doc.page.height - 60;
    doc.fontSize(8).fillColor('#999999').font('Helvetica')
      .text(
        `Shared by ${WIZMATCH_BRAND_NAME} · ${WIZMATCH_BRAND_EMAIL}${WIZMATCH_BRAND_PHONE ? ` · ${WIZMATCH_BRAND_PHONE}` : ''} · ${WIZMATCH_BRAND_WEBSITE}`,
        50, footY, { align: 'center', width: doc.page.width - 100 },
      );
    doc.text('This requirement is shared in confidence with our vendor network. Please do not forward externally.', 50, footY + 12, { align: 'center', width: doc.page.width - 100 });

    doc.end();
  });
}

export interface SheetResult {
  success: boolean;
  sheet_url: string | null;
  error: string | null;
}

export async function generateRequirementSheet(requirementId: string, tenantId: string): Promise<SheetResult> {
  const result = await pool.query(
    `SELECT r.*, comp.name AS company_name
     FROM wizmatch_requirements r
     LEFT JOIN wizmatch_companies comp ON comp.id = r.company_id
     WHERE r.id = $1 AND r.tenant_id = $2`,
    [requirementId, tenantId],
  );
  if (result.rows.length === 0) {
    return { success: false, sheet_url: null, error: 'Requirement not found' };
  }
  const r = result.rows[0];

  const row: SheetRow = {
    title: r.title,
    companyName: r.company_name || null,
    maskClient: r.mask_client !== false,
    location: r.location,
    workMode: r.work_mode,
    employmentType: r.employment_type,
    minExperience: r.min_experience,
    maxExperience: r.max_experience,
    budgetMin: r.budget_min,
    budgetMax: r.budget_max,
    budgetCurrency: r.budget_currency || 'INR',
    budgetPeriod: r.budget_period || 'monthly',
    positions: r.positions || 1,
    priority: r.priority,
    requiredSkills: r.required_skills || [],
    niceToHaveSkills: r.nice_to_have_skills || [],
    rawJd: r.raw_jd,
    vendorNotes: r.vendor_notes,
  };

  try {
    const pdfBuffer = await buildPdfBuffer(row);
    const filename = `wizmatch/requirements/${requirementId}/${Date.now()}.pdf`;
    const sheetUrl = await uploadPrivateToR2(pdfBuffer, filename, 'application/pdf');

    await pool.query(
      `UPDATE wizmatch_requirements
       SET sheet_url = $3, status = CASE WHEN status = 'draft' THEN 'sheet_ready' ELSE status END, updated_at = NOW()
       WHERE id = $1 AND tenant_id = $2`,
      [requirementId, tenantId, sheetUrl],
    );

    logger.info(`[wizmatch-req] Generated requirement sheet for ${requirementId}: ${sheetUrl}`);
    return { success: true, sheet_url: sheetUrl, error: null };
  } catch (e) {
    logger.error('[wizmatch-req] Failed to generate requirement sheet:', e instanceof Error ? e.message : String(e));
    return { success: false, sheet_url: null, error: e instanceof Error ? e.message : 'unknown' };
  }
}
