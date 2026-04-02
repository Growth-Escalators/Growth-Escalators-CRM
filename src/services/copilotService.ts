import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendWhatsAppMessage } from './growthOSSetup';

// ---------------------------------------------------------------------------
// Trigger detection
// ---------------------------------------------------------------------------

const COPILOT_TRIGGERS = ['?', 'how', 'should', 'what', 'why', 'is ', 'can ', 'show', 'tell', 'give'];

export function isCopilotMessage(text: string): boolean {
  const lower = text.trim().toLowerCase();
  return COPILOT_TRIGGERS.some(t => lower.startsWith(t));
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function handleCopilotMessage(from: string, messageText: string): Promise<boolean> {
  // Normalise phone — strip non-digits, remove leading +
  const phone = from.replace(/\D/g, '');

  try {
    // Step 1 — find client by founder_whatsapp
    const clientRes = await pool.query(
      `SELECT * FROM growth_os_clients WHERE replace(founder_whatsapp, '+', '') = $1 AND is_active = true LIMIT 1`,
      [phone]
    );

    if (clientRes.rows.length === 0) {
      logger.info(`[copilot] No Growth OS client for phone ${phone}`);
      return false; // not handled — route to inbox normally
    }

    const client = clientRes.rows[0] as Record<string, unknown>;
    const clientName = String(client.client_name);

    // Step 2 — gather context
    const context = await gatherContext(clientName);

    // Step 3 — call Claude
    const response = await callClaude(String(clientName), client, context, messageText);

    // Step 4 — send WhatsApp reply
    await sendWhatsAppMessage(from, response);

    // Step 5 — log conversation
    const tokensUsed = response.length; // approximate
    await pool.query(
      `INSERT INTO copilot_conversations (client_name, wa_phone, message, response, tokens_used) VALUES ($1,$2,$3,$4,$5)`,
      [clientName, phone, messageText, response, tokensUsed]
    ).catch(e => logger.error('[copilot] log failed:', e));

    logger.info(`[copilot] Handled message from ${phone} for ${clientName}`);
    return true; // handled
  } catch (e) {
    logger.error('[copilot] handleCopilotMessage failed:', e instanceof Error ? e.message : String(e));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Context collector
// ---------------------------------------------------------------------------

async function gatherContext(clientName: string): Promise<Record<string, unknown>> {
  const [healthRes, opportunityRes, creativesRes, pipelineRes, contactsRes] = await Promise.all([
    pool.query(`SELECT overall_score, ads_score, seo_score, whatsapp_score, email_score, retention_score, score_change, alerts FROM brand_health_scores WHERE client_name = $1 ORDER BY score_date DESC LIMIT 1`, [clientName]).catch(() => ({ rows: [] })),
    pool.query(`SELECT total_opportunity, cart_abandonment_opportunity, winback_opportunity, detail FROM money_on_table WHERE client_name = $1 ORDER BY created_at DESC LIMIT 1`, [clientName]).catch(() => ({ rows: [] })),
    pool.query(`SELECT ad_name, campaign_name, fatigue_status, latest_roas, latest_ctr, days_running FROM creative_intelligence WHERE ad_account_id IN (SELECT ad_account_id FROM growth_os_clients WHERE client_name = $1) AND fatigue_status != 'healthy' ORDER BY updated_at DESC LIMIT 5`, [clientName]).catch(() => ({ rows: [] })),
    pool.query(`SELECT stage, COUNT(*) AS cnt FROM deals GROUP BY stage`).catch(() => ({ rows: [] })),
    pool.query(`SELECT COUNT(*) AS cnt FROM contacts WHERE created_at >= NOW() - INTERVAL '7 days'`).catch(() => ({ rows: [{ cnt: '0' }] })),
  ]);

  return {
    recentHealth: healthRes.rows[0] ?? null,
    recentOpportunity: opportunityRes.rows[0] ?? null,
    activeCreatives: creativesRes.rows,
    pipelineData: pipelineRes.rows,
    contactsGrowth: (contactsRes.rows[0] as { cnt: string } | undefined)?.cnt ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Claude call
// ---------------------------------------------------------------------------

async function callClaude(
  clientName: string,
  client: Record<string, unknown>,
  context: Record<string, unknown>,
  message: string
): Promise<string> {
  const apiKey = process.env.CLAUDE_API_KEY;
  const fallback = buildFallbackResponse(clientName, context, message);

  if (!apiKey || apiKey.length < 10 || !apiKey.startsWith('sk-ant-')) return fallback;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 500,
        system: `You are the Growth OS Co-Pilot for ${clientName}.
You answer questions about their brand performance using real data.
Always be specific, data-driven, and actionable.
Keep responses under 200 words — this is WhatsApp.
Use simple formatting with line breaks. No markdown headers or bold.

Current brand data:
${JSON.stringify(context, null, 2)}

Brand details:
- Industry: ${client.industry ?? 'general'}
- Monthly ad spend: ₹${client.monthly_ad_spend ?? 'unknown'}
- Target ROAS: ${client.target_roas ?? 2.5}x
- Today's health score: ${(context.recentHealth as Record<string, unknown> | null)?.overall_score ?? 'not yet calculated'}/100`,
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!res.ok) {
      logger.error(`[copilot] Claude API ${res.status}`);
      return fallback;
    }

    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    return data.content?.find(c => c.type === 'text')?.text ?? fallback;
  } catch (e) {
    logger.error('[copilot] Claude call failed:', e instanceof Error ? e.message : String(e));
    return fallback;
  }
}

function buildFallbackResponse(clientName: string, context: Record<string, unknown>, _message: string): string {
  const health = context.recentHealth as Record<string, unknown> | null;
  if (health) {
    return `Growth OS Co-Pilot for ${clientName}\n\nLatest health score: ${health.overall_score}/100\nAds: ${health.ads_score}/100 | WhatsApp: ${health.whatsapp_score}/100\n\nI'm having trouble connecting right now. Check /crm/growth-os for full details.`;
  }
  return `Growth OS Co-Pilot for ${clientName}\n\nI'm starting up — no data collected yet. Check back after the next cron run at 8 AM IST.`;
}
