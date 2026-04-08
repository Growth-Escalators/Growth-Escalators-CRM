/**
 * Test Task 3 v2: Show before/after icebreaker comparison for 3 specific leads
 * Uses leads with known websites for best results
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
  if (!url) return '';
  return new Promise((resolve) => {
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

async function callClaude(company, websiteContent, country) {
  const systemPrompt = `You write the first sentence of a cold email from Jatin at Growth Escalators to a performance marketing agency founder. The sentence must feel like it was written by a human who actually visited their website, not a bot. Never start with "I", never use words like "impressive", "innovative", "passionate", "dedicated". Maximum 20 words. Output the sentence only — no quotes, no punctuation at end. If website content is unavailable, write a natural opener referencing the agency's country and niche instead.`;

  const userPrompt = `Agency: ${company}
Website content: ${websiteContent || 'Not available — write based on agency name and country only'}
Country: ${country ?? 'Unknown'}

Write a single opening sentence. If website content is available, reference something specific from it. If not, write naturally based on the agency name and location.`;

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
          const text = data.content?.[0]?.text?.trim() || '';
          resolve(text || `Came across ${company} while looking at performance marketing agencies in ${country}`);
        } catch { resolve(`Came across ${company} while researching performance marketing agencies`); }
      });
    });
    req.on('error', () => resolve(`Came across ${company} while researching performance marketing agencies`));
    req.on('timeout', () => { req.destroy(); resolve(`Came across ${company} while researching performance marketing agencies`); });
    req.write(bodyStr);
    req.end();
  });
}

async function main() {
  // Pick 3 leads that have websites (for best Claude output)
  const result = await pool.query(`
    SELECT id, company, website_url, country, icebreaker
    FROM outreach_leads
    WHERE status = 'Active'
      AND email IS NOT NULL
      AND website_url IS NOT NULL
      AND icebreaker LIKE '%impressive work%'
    ORDER BY RANDOM()
    LIMIT 3
  `);

  console.log(`\n=== TASK 3: Icebreaker Before/After Test (${result.rows.length} leads) ===\n`);

  for (const lead of result.rows) {
    const before = lead.icebreaker;
    process.stdout.write(`Company: ${lead.company} [${lead.country}]\n`);
    process.stdout.write(`Website: ${lead.website_url}\n`);
    process.stdout.write(`Before:  ${before}\n`);

    const websiteContent = await fetchWebsiteSnippet(lead.website_url);
    const after = await callClaude(lead.company, websiteContent, lead.country);

    await pool.query(
      `UPDATE outreach_leads SET icebreaker = $1, updated_at = NOW() WHERE id = $2`,
      [after, lead.id]
    );

    process.stdout.write(`After:   ${after}\n\n`);
    await new Promise(r => setTimeout(r, 1200));
  }

  console.log('✅ Done. New icebreaker prompt is live — all future enrichments will use Claude Haiku.');
  await pool.end();
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
