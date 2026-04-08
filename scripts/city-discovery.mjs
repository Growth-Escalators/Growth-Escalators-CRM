/**
 * City discovery script — Task 3
 * Searches Google Places for 10 new city queries and inserts into outreach_leads
 */

import pg from 'pg';
import dns from 'dns/promises';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const PLACES_API_BASE = 'https://maps.googleapis.com/maps/api/place';
const API_KEY = process.env.GOOGLE_PLACES_API_KEY;

const QUERIES = [
  // UK
  { query: 'performance marketing agency Birmingham', country: 'UK' },
  { query: 'digital marketing agency Bristol', country: 'UK' },
  { query: 'Meta Ads agency Leeds', country: 'UK' },
  { query: 'ecommerce agency Glasgow', country: 'UK' },
  // AU
  { query: 'performance marketing agency Brisbane', country: 'AU' },
  { query: 'digital marketing agency Perth', country: 'AU' },
  { query: 'Meta Ads agency Adelaide', country: 'AU' },
  // CA
  { query: 'performance marketing agency Vancouver', country: 'CA' },
  { query: 'digital marketing agency Calgary', country: 'CA' },
  { query: 'ecommerce agency Ottawa', country: 'CA' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function extractDomain(url) {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, '');
  } catch { return null; }
}

async function fetchJson(url) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function searchPlaces(query) {
  const url = `${PLACES_API_BASE}/textsearch/json?query=${encodeURIComponent(query)}&key=${API_KEY}`;
  const data = await fetchJson(url);
  return (data.results ?? []).slice(0, 20);
}

async function getDetails(placeId) {
  try {
    const url = `${PLACES_API_BASE}/details/json?place_id=${placeId}&fields=website,formatted_phone_number&key=${API_KEY}`;
    const data = await fetchJson(url);
    return { website: data.result?.website, phone: data.result?.formatted_phone_number };
  } catch { return {}; }
}

function fitScore(place, details) {
  let score = 0;
  if (details.website) score += 25;
  if (details.phone) score += 15;
  const r = place.rating ?? 0;
  if (r >= 4.5) score += 25; else if (r >= 4.0) score += 20; else if (r >= 3.5) score += 12;
  const rv = place.user_ratings_total ?? 0;
  if (rv >= 50) score += 20; else if (rv >= 20) score += 15; else if (rv >= 10) score += 10;
  return Math.min(100, score);
}

async function main() {
  // Load existing leads for dedup
  const existing = await pool.query(
    `SELECT LOWER(company) AS company, LOWER(website_url) AS website FROM outreach_leads`
  );
  const existingNames = new Set(existing.rows.map(r => r.company));
  const existingWebsites = new Set(existing.rows.filter(r => r.website).map(r => r.website));

  let totalAdded = 0;
  let totalSkipped = 0;
  const results = [];

  for (const { query, country } of QUERIES) {
    process.stdout.write(`\nSearching: "${query}"... `);
    let added = 0, skipped = 0;

    try {
      const places = await searchPlaces(query);
      process.stdout.write(`${places.length} found\n`);

      for (const place of places) {
        if (existingNames.has(place.name.toLowerCase())) { skipped++; continue; }

        const details = await getDetails(place.place_id);
        await sleep(120);

        if (details.website) {
          const domain = extractDomain(details.website);
          if (domain && existingWebsites.has(domain)) { skipped++; continue; }
        }

        const score = fitScore(place, details);

        try {
          await pool.query(`
            INSERT INTO outreach_leads
              (company, phone, website_url, address, country, fit_score, source, source_detail, status, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, 'google_places', $7, 'New', NOW(), NOW())
          `, [
            place.name,
            details.phone ?? null,
            details.website ?? null,
            place.formatted_address ?? null,
            country,
            score,
            `city-discovery — ${query}`,
          ]);

          existingNames.add(place.name.toLowerCase());
          if (details.website) {
            const d = extractDomain(details.website);
            if (d) existingWebsites.add(d);
          }
          console.log(`  + ${place.name} (score=${score})`);
          added++;
        } catch { skipped++; }
      }
    } catch (e) {
      console.error(`  Error: ${e.message}`);
    }

    console.log(`  → Added: ${added}, Skipped: ${skipped}`);
    results.push({ query, country, added, skipped });
    totalAdded += added;
    totalSkipped += skipped;
    await sleep(800);
  }

  console.log('\n═══════════════════════════════════════');
  console.log('CITY DISCOVERY RESULTS:');
  for (const r of results) {
    console.log(`  [${r.country}] ${r.query.padEnd(55)} +${r.added} (${r.skipped} skipped)`);
  }
  console.log(`\nTotal added: ${totalAdded}  |  Total skipped: ${totalSkipped}`);

  const finalStats = await pool.query(
    `SELECT status, COUNT(*) FROM outreach_leads GROUP BY status ORDER BY count DESC`
  );
  console.log('\nFinal pipeline:');
  for (const row of finalStats.rows) {
    console.log(`  ${String(row.status).padEnd(15)} ${row.count}`);
  }

  await pool.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
