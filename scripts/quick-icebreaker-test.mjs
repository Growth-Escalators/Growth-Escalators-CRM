/**
 * Quick icebreaker test — focused, fast, no website scraping
 */
import https from 'https';

const CLAUDE_API_KEY = process.env.CLAUDE_API_KEY;

const systemPrompt = `You write the first sentence of a cold email from Jatin at Growth Escalators to a performance marketing agency founder. The sentence must feel like it was written by a human who actually visited their website, not a bot. Never start with "I", never use words like "impressive", "innovative", "passionate", "dedicated". Maximum 20 words. Output the sentence only — no quotes, no punctuation at end. If website content is unavailable, write a natural opener referencing the agency's country and niche instead.`;

const TEST_LEADS = [
  { company: 'Alpha Digital', country: 'AU', websiteContent: 'Brisbane-based performance marketing agency specialising in Meta Ads, Google Ads, and conversion rate optimisation for ecommerce brands.' },
  { company: 'First Rank SEO', country: 'CA', websiteContent: 'Winnipeg SEO and digital marketing agency. We help local and national businesses rank higher on Google and drive more leads.' },
  { company: 'Bonfire', country: 'AU', websiteContent: 'Perth digital agency building meaningful brands through strategy, design and performance marketing. We work with ambitious ecommerce and B2B brands.' },
];

function callClaude(company, websiteContent, country) {
  return new Promise((resolve) => {
    const bodyStr = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 60,
      system: systemPrompt,
      messages: [{
        role: 'user',
        content: `Agency: ${company}\nWebsite content: ${websiteContent}\nCountry: ${country}\n\nWrite a single opening sentence referencing something specific from their website that a real person would notice.`
      }],
    });

    const req = https.request({
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      timeout: 20000,
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
          resolve(data.content?.[0]?.text?.trim() || 'fallback');
        } catch { resolve('parse error'); }
      });
    });
    req.on('error', e => resolve(`error: ${e.message}`));
    req.on('timeout', () => { req.destroy(); resolve('timeout'); });
    req.write(bodyStr);
    req.end();
  });
}

async function main() {
  const GENERIC = 'Hi {{name}}, came across {{company}} — impressive work in performance marketing. We help agencies like yours deliver Meta Ads for D2C clients at 60-70% lower cost. Worth a quick chat?';

  console.log('=== TASK 3: Icebreaker Before/After Comparison ===\n');

  for (const lead of TEST_LEADS) {
    const after = await callClaude(lead.company, lead.websiteContent, lead.country);
    console.log(`Company: ${lead.company} [${lead.country}]`);
    console.log(`Before:  ${GENERIC.replace('{{company}}', lead.company).replace('{{name}}', 'there')}`);
    console.log(`After:   ${after}`);
    console.log('');
    await new Promise(r => setTimeout(r, 500));
  }
}

main().catch(console.error);
