import https from 'https';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// AI Reply Classification using Claude Haiku
// ---------------------------------------------------------------------------

export async function classifyReplyWithAI(
  replyBody: string,
  originalIcebreaker: string,
  companyName: string,
): Promise<{
  category: string;
  confidence: number;
  summary: string;
  draftReply: string | null;
}> {
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
  if (!ANTHROPIC_KEY) {
    return { category: 'UNCATEGORIZED', confidence: 0, summary: 'No API key', draftReply: null };
  }

  try {
    const prompt = `Classify this email reply and generate a response if appropriate.

Original outreach icebreaker: "${originalIcebreaker}"
Company: ${companyName}

Reply received:
"${replyBody}"

Respond in JSON format:
{
  "category": one of "INTERESTED", "NOT_NOW", "NOT_INTERESTED", "UNSUBSCRIBE", "UNCATEGORIZED",
  "confidence": number 0-100,
  "summary": "one sentence summary of what the reply says",
  "draftReply": "if INTERESTED, write a short professional follow-up (2-3 sentences max) suggesting a quick call. Otherwise null"
}

Classification rules (pick exactly one of the 5):
- INTERESTED: they want to learn more, asked questions, agreed to a call, requested pricing/details
- NOT_NOW: polite defer — "not right now", "try next quarter", out-of-office auto-reply, on holiday, ask us to circle back
- NOT_INTERESTED: polite rejection, already sorted, wrong person, referral to someone else, objection with no open door
- UNSUBSCRIBE: asks to be removed, stop emailing, GDPR removal request
- UNCATEGORIZED: cannot determine intent from the reply

Draft-reply rules:
- Only produce a draftReply when category = "INTERESTED"; otherwise set it to null.
- Never use the word "cheaper". When cost advantages come up, phrase it as "60–70% lower fulfilment costs".
- Keep the draft reply under 3 sentences, written in Jatin's voice — direct, human, no corporate filler.
- Do NOT include a booking link in your draft — the backend appends it automatically.

Return ONLY the JSON, no other text.`;

    const bodyStr = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    const result = await new Promise<{
      category: string;
      confidence: number;
      summary: string;
      draftReply: string | null;
    }>((resolve) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path: '/v1/messages',
        method: 'POST',
        timeout: 20000,
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(bodyStr),
        },
      }, (res) => {
        let body = '';
        res.on('data', (c: string) => { body += c; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body) as { content?: Array<{ text?: string }> };
            const text = data.content?.[0]?.text?.trim() ?? '';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
              resolve({ category: 'UNCATEGORIZED', confidence: 0, summary: 'Failed to parse', draftReply: null });
              return;
            }
            const parsed = JSON.parse(jsonMatch[0]) as {
              category?: string; confidence?: number; summary?: string; draftReply?: string | null;
            };
            resolve({
              category: parsed.category || 'UNCATEGORIZED',
              confidence: parsed.confidence || 0,
              summary: parsed.summary || '',
              draftReply: parsed.draftReply || null,
            });
          } catch {
            resolve({ category: 'UNCATEGORIZED', confidence: 0, summary: 'Parse error', draftReply: null });
          }
        });
      });
      req.on('error', () => resolve({ category: 'UNCATEGORIZED', confidence: 0, summary: 'Request error', draftReply: null }));
      req.on('timeout', () => { req.destroy(); resolve({ category: 'UNCATEGORIZED', confidence: 0, summary: 'Timeout', draftReply: null }); });
      req.write(bodyStr);
      req.end();
    });

    // Append self-book link on INTERESTED replies so the prospect can book
    // a slot directly — eliminates the calendar-back-and-forth that ghosts
    // 40-60% of interested leads.
    if (result.category === 'INTERESTED' && result.draftReply) {
      const bookingUrl = process.env.MEETING_BOOKING_URL;
      if (bookingUrl) {
        result.draftReply =
          `${result.draftReply.trim()}\n\nFeel free to grab a 20-min slot directly here: ${bookingUrl} — or reply with a time that works.`;
      }
    }

    return result;
  } catch (e) {
    logger.error('[outreach] AI classification failed:', e instanceof Error ? e.message : String(e));
    return { category: 'UNCATEGORIZED', confidence: 0, summary: 'Classification error', draftReply: null };
  }
}
