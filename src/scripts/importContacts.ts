import 'dotenv/config';
import { readFileSync } from 'fs';
import { eq } from 'drizzle-orm';
import { db, tenants } from '../db/index';
import { findOrCreateContact } from '../services/contactService';

// ---------------------------------------------------------------------------
// parseCsvLine — splits a CSV line on commas, handles "quoted,fields"
// ---------------------------------------------------------------------------
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (const ch of line) {
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { fields.push(current.trim()); current = ''; continue; }
    current += ch;
  }
  fields.push(current.trim());
  return fields;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
async function main() {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: npm run db:import <path-to-csv>');
    process.exit(1);
  }

  // Read and parse CSV
  const raw = readFileSync(csvPath, 'utf-8');
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);

  if (lines.length < 2) {
    console.error('CSV must have a header row and at least one data row.');
    process.exit(1);
  }

  // Build header → index map (case-insensitive)
  const headers = parseCsvLine(lines[0]).map((h) => h.toLowerCase());
  const col = (name: string): number => headers.indexOf(name.toLowerCase());

  const dataRows = lines.slice(1);
  const total = dataRows.length;

  // Resolve tenant ID
  const tenantRows = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, 'growth-escalators'))
    .limit(1);

  if (tenantRows.length === 0) {
    console.error('Tenant "growth-escalators" not found in DB. Run db:seed first.');
    process.exit(1);
  }
  const tenantId = tenantRows[0].id;
  console.log(`Tenant ID: ${tenantId}`);
  console.log(`Importing ${total} rows from ${csvPath}\n`);

  let created = 0;
  let existed = 0;
  let failed = 0;

  for (let i = 0; i < dataRows.length; i++) {
    const fields = parseCsvLine(dataRows[i]);
    const get = (name: string): string => fields[col(name)] ?? '';

    const firstName = get('first name');
    const lastName  = get('last name');
    const email     = get('email');
    const phone     = get('phone');
    const source    = get('source');
    const tags      = get('tags');
    const status    = get('status');

    const rowNum = `[${i + 1}/${total}]`;

    if (!firstName) {
      console.log(`${rowNum} SKIPPED  (no first name) — row: ${dataRows[i]}`);
      failed++;
      continue;
    }

    const channels: { channelType: string; channelValue: string; isPrimary?: boolean }[] = [];
    if (email) channels.push({ channelType: 'email',    channelValue: email, isPrimary: true });
    if (phone) channels.push({ channelType: 'whatsapp', channelValue: phone });

    if (channels.length === 0) {
      console.log(`${rowNum} SKIPPED  ${firstName} ${lastName} — no email or phone`);
      failed++;
      continue;
    }

    try {
      const result = await findOrCreateContact(tenantId, {
        firstName,
        lastName:  lastName  || undefined,
        source:    source    || 'ghl_import',
        metadata:  { importedFrom: 'ghl', originalTags: tags, originalStatus: status },
        channels,
      });

      if (result.created) {
        created++;
        console.log(`${rowNum} CREATED  ${firstName} ${lastName}`);
      } else {
        existed++;
        console.log(`${rowNum} EXISTS   ${firstName} ${lastName}`);
      }
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`${rowNum} FAILED   ${firstName} ${lastName}: ${msg}`);
    }
  }

  console.log(`\n── Import complete ──────────────────────────────`);
  console.log(`Total processed : ${total}`);
  console.log(`Created         : ${created}`);
  console.log(`Already existed : ${existed}`);
  console.log(`Failed / skipped: ${failed}`);
  console.log(`────────────────────────────────────────────────`);

  process.exit(0);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
