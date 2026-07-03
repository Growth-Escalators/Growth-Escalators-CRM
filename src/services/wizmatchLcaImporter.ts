/**
 * Wizmatch LCA (Labor Condition Application) Importer Service
 *
 * Downloads the latest DOL H-1B/H-2B disclosure data from flcdatacenter.com,
 * parses the CSV, aggregates by employer name (case-insensitive), and updates
 * wizmatch_companies.h1b_sponsor_count.
 *
 * The DOL file is a large ZIP containing CSVs. We use streaming to avoid
 * loading the entire file into memory.
 *
 * Called by the LCA Importer cron in worker.ts (weekly Sunday 10 PM IST).
 */

import { pool } from '../db/index';
import logger from '../utils/logger';
import { createWriteStream, createReadStream, existsSync, mkdirSync, unlinkSync } from 'fs';
import { pipeline } from 'stream/promises';
import { createUnzip } from 'zlib';
import { createInterface } from 'readline';
import { join } from 'path';
import { tmpdir } from 'os';

// ── Types ────────────────────────────────────────────────────────────────────

interface LcaResult {
  records_processed: number;
  companies_updated: number;
  errors: number;
}

// ── Constants ────────────────────────────────────────────────────────────────

// The DOL provides a download endpoint. The exact URL changes yearly, but
// flcdatacenter.com is the stable portal. We try multiple known URLs.
const LCA_DOWNLOAD_URLS = [
  'https://www.flcdatacenter.com/DownloadH2BFile.aspx',
  'https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/H-1B_Disclosure_Data_FY2024.xlsx',
  'https://www.dol.gov/sites/dolgov/files/ETA/oflc/pdfs/H-1B_Disclosure_Data_FY2023.xlsx',
];

const EMPLOYER_NAME_COLUMNS = [
  'EMPLOYER_NAME', 'EMPLOYER_NAME_1', 'employer_name', 'employer',
  'LEGAL_NAME', 'legal_name', ' Employer Name ',
];

const WORK_DIR = join(tmpdir(), 'wizmatch-lca');

// ── Helpers ──────────────────────────────────────────────────────────────────

function normalizeCompanyName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[.,]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/\b(inc|llc|corp|corporation|ltd|co|company|llp|pc|plc)\b\.?/g, '')
    .trim();
}

async function downloadLcaFile(): Promise<string | null> {
  mkdirSync(WORK_DIR, { recursive: true });
  const targetPath = join(WORK_DIR, `lca-${Date.now()}.csv`);

  for (const url of LCA_DOWNLOAD_URLS) {
    try {
      logger.info(`[wizmatch-lca] Attempting download from ${url}`);
      const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!res.ok || !res.body) continue;

      const contentType = res.headers.get('content-type') || '';
      const contentDisp = res.headers.get('content-disposition') || '';

      // Check if it's a zip or CSV
      const isZip = contentType.includes('zip') || contentDisp.includes('.zip') || url.endsWith('.zip');
      const isExcel = contentType.includes('spreadsheet') || contentDisp.includes('.xlsx') || url.endsWith('.xlsx');

      const buffer = Buffer.from(await res.arrayBuffer());

      if (isZip) {
        // Unzip and find the CSV inside
        const { writeFile } = await import('fs/promises');
        const zipPath = join(WORK_DIR, `lca-${Date.now()}.zip`);
        await writeFile(zipPath, buffer);

        // Use system unzip command (simpler than a Node zip lib)
        const { execSync } = await import('child_process');
        try {
          execSync(`unzip -o "${zipPath}" -d "${WORK_DIR}"`, { timeout: 30000 });
          unlinkSync(zipPath);
        } catch {
          // Try Python as fallback
          try {
            execSync(`python3 -c "import zipfile; zipfile.ZipFile('${zipPath}').extractall('${WORK_DIR}')`, { timeout: 30000 });
            unlinkSync(zipPath);
          } catch {
            logger.error('[wizmatch-lca] Failed to unzip');
            continue;
          }
        }

        // Find the CSV file in the work dir
        const { readdirSync } = await import('fs');
        const files = readdirSync(WORK_DIR).filter((f) => f.endsWith('.csv'));
        if (files.length > 0) {
          return join(WORK_DIR, files[0]); // Return first CSV
        }
      } else if (isExcel) {
        // For Excel files, we'd need a parser — log and skip for now
        logger.warn('[wizmatch-lca] Excel format detected — skipping (CSV preferred)');
        continue;
      } else {
        // Assume CSV
        const { writeFile } = await import('fs/promises');
        await writeFile(targetPath, buffer);
        return targetPath;
      }
    } catch (e) {
      logger.warn(`[wizmatch-lca] Download failed from ${url}:`, e instanceof Error ? e.message : String(e));
    }
  }

  return null;
}

// ── Main importer ────────────────────────────────────────────────────────────

export async function importLcaData(): Promise<LcaResult> {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  if (!tenantId) {
    logger.warn('[wizmatch-lca] WIZMATCH_TENANT_ID not set — skipping');
    return { records_processed: 0, companies_updated: 0, errors: 0 };
  }

  // Download the file
  const csvPath = await downloadLcaFile();
  if (!csvPath) {
    logger.warn('[wizmatch-lca] Could not download LCA file from any source — skipping');
    return { records_processed: 0, companies_updated: 0, errors: 1 };
  }

  logger.info(`[wizmatch-lca] Processing ${csvPath}`);

  // Stream-parse the CSV
  const fileStream = createReadStream(csvPath, { encoding: 'utf-8' });
  const rl = createInterface({ input: fileStream, crlfDelay: Infinity });

  // Aggregate counts by normalized employer name
  const employerCounts = new Map<string, number>();
  let recordsProcessed = 0;
  let headerLine: string | null = null;
  let employerColIdx = -1;

  try {
    for await (const line of rl) {
      if (!headerLine) {
        headerLine = line;
        const headers = parseCsvLine(line);
        employerColIdx = headers.findIndex((h) =>
          EMPLOYER_NAME_COLUMNS.some((target) => h.toUpperCase().includes(target.toUpperCase())),
        );

        if (employerColIdx === -1) {
          logger.error('[wizmatch-lca] Could not find employer name column in CSV header:', headers.slice(0, 15));
          return { records_processed: 0, companies_updated: 0, errors: 1 };
        }
        logger.info(`[wizmatch-lca] Employer column found at index ${employerColIdx}: "${headers[employerColIdx]}"`);
        continue;
      }

      try {
        const fields = parseCsvLine(line);
        const employerName = fields[employerColIdx];
        if (!employerName) continue;

        const normalized = normalizeCompanyName(employerName);
        if (!normalized) continue;

        employerCounts.set(normalized, (employerCounts.get(normalized) || 0) + 1);
        recordsProcessed++;
      } catch {
        // Per-line error — continue
      }

      // Log progress every 50k records
      if (recordsProcessed % 50000 === 0) {
        logger.info(`[wizmatch-lca] Processed ${recordsProcessed} records, ${employerCounts.size} unique employers`);
      }
    }
  } finally {
    fileStream.destroy();
  }

  logger.info(`[wizmatch-lca] Parsed ${recordsProcessed} records, found ${employerCounts.size} unique employers`);

  // Update companies in the DB
  // Build a case-insensitive lookup: normalize wizmatch_companies.name the same way
  const companies = (await pool.query(
    `SELECT id, name FROM wizmatch_companies WHERE tenant_id = $1`,
    [tenantId],
  )).rows as Array<{ id: string; name: string }>;

  let companiesUpdated = 0;

  for (const company of companies) {
    const normalized = normalizeCompanyName(company.name);
    const count = employerCounts.get(normalized);
    if (count && count > 0) {
      await pool.query(
        `UPDATE wizmatch_companies SET h1b_sponsor_count = $3, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
        [company.id, tenantId, count],
      );
      companiesUpdated++;
    }
  }

  // Clean up
  try { unlinkSync(csvPath); } catch { /* non-critical */ }

  logger.info(
    `[wizmatch-lca] Done: ${recordsProcessed} records processed, ${companiesUpdated} companies updated with H-1B counts`,
  );

  return {
    records_processed: recordsProcessed,
    companies_updated: companiesUpdated,
    errors: 0,
  };
}

// ── CSV parsing (simple — handles quoted fields with commas) ─────────────────

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}