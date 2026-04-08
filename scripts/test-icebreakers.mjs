/**
 * Test Task 3: Show before/after icebreaker comparison for 3 leads
 */

import pg from 'pg';
import https from 'https';

const { Pool } = pg;
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

async function fetchWebsiteSnippet(url) {
  return new Promise((resolve) => {
    if (!url) { resolve(''); return; }
    try {
      const u = new URL(url.startsWith('http') ? url : `https://${url}`);
      const req = https.request({
        hostname: u.hostname,
        path: u.pathname || '/',
        method: 'GET',
        timeout: 8000,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; GrowthEscalators/1.0)' },
      }, (res) => {
        let body = '';
        res.on('data', c => { body += c; if (body.length > 8000) res.destroy(); });
        res.on('end', () => {
          const text = body.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 600);
          resolve(text);
        });
      });
      req.on('error', () => resolve(''));
      req.on('timeout', () => { req.destroy(); resolve(''); });
      req.end();
    } catch { resolve(''); }
  });
}

async function generateIcebreaker(company, websiteUrl, country) {
  if (!CLAUDE_API_KEY) return `[No API key — fallback] Came across ${company} while looking at performance marketing agencies`;

  const websiteContent = await fetchWebsiteSnippet(websiteUrl);

  const systemPrompt = `You write the first sentence of a cold email from Jatin at Growth Escalators to a performance marketing agency founder. The sentence must feel like it was written by a human who actually visited their website, not a bot. Never start with "I", never use words like "impressive", "innovative", "passionate", "dedicated". Maximum 20 words. Output the sentence only — no quotes, no punctuation at end.`;

  const userPrompt = `Agency: ${company}
Website content: ${websiteContent || 'Not available'}
Country: ${country ?? 'Unknown'}

Write a single opening sentence referencing something specific from their website that a real person would notice.`;

  return new Promise((resolve) => {
    const bodyStr = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      timeout: 25000,
      headers: {
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(bodyStr),
      },
    }, (res) => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          resolve(data.content?.[0]?.text?.trim() || 'fallback icebreaker');
        } catch { resolve('fallback icebreaker'); }
      });
    });
    req.on('error', () => resolve('error generating icebreaker'));
    req.on('timeout', () => { req.destroy(); resolve('timeout generating icebreaker'); });
    req.write(bodyStr);
    req.end();
  });
}

async function main() {
  // Get 3 Active leads with generic icebreakers (contain "impressive work")
  const result = await pool.query(`
    SELECT id, company, website_url, country, icebreaker
    FROM outreach_leads
    WHERE status = 'Active'
      AND email IS NOT NULL
      AND icebreaker LIKE '%impressive work%'
    ORDER BY enriched_at DESC NULLS LAST
    LIMIT 3
  `);

  console.log(`Testing icebreaker regeneration on ${result.rows.length} leads\n`);

  for (const lead of result.rows) {
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Company: ${lead.company} (${lead.country})`);
    console.log(`Before: ${lead.icebreaker}`);

    const newIcebreaker = await generateIcebreaker(lead.company, lead.website_url, lead.country);

    await pool.query(
      `UPDATE outreach_leads SET icebreaker = $1, updated_at = NOW() WHERE id = $2`,
      [newIcebreaker, lead.id]
    );

    console.log(`After:  ${newIcebreaker}`);
    console.log('');

    await new Promise(r => setTimeout(r, 1000));
  }

  console.log('✅ Before/after comparison complete — icebreakers updated in DB');
  await pool.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
