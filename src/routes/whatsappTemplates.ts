import { Router, type Request, type Response } from 'express';
import { db } from '../db/index';
import { waTemplates } from '../db/schema';
import { eq } from 'drizzle-orm';
import { pool } from '../db/index';
import logger from '../utils/logger';

const router = Router();

// ---------------------------------------------------------------------------
// Default template bodies — used to seed the body column on first run
// ---------------------------------------------------------------------------
const DEFAULT_BODIES: Record<string, { body: string; description: string }> = {
  welcome_d2c: {
    description: 'Day 0 asset delivery — main PDF download link',
    body: 'Hi {{firstName}}! 🎉 Your purchase is confirmed. Here is your D2C Funnel Breakdown Pack — download it now, it is yours forever: https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/5%20Winning%20D2C%20Brands.pdf\n\nThis PDF breaks down exactly what 5 winning D2C brands are doing on Meta right now. Go through Section 2 first — that is where most brands find their biggest insight.\n\nReply anytime if you have questions. — Jatin from Growth Escalators',
  },
  followup_day3: {
    description: 'Day 3 follow-up for leads who haven\'t booked a call',
    body: 'Hi {{firstName}}, following up from Growth Escalators. Have you had a chance to think about scaling your Meta ads? Reply 1 if you would like to book a free strategy call.',
  },
  nudge_day7: {
    description: 'Day 7 urgency nudge for unbooked leads',
    body: 'Hi {{firstName}}, last follow up from Jatin at Growth Escalators. I have a few open slots this week for strategy calls — completely free, no pitch, just a clear plan for your Meta ads. Want one? Reply YES.',
  },
  appointment_confirm: {
    description: 'Appointment booking confirmation',
    body: 'Hi {{firstName}}, your strategy call with Growth Escalators is confirmed for {{appointmentDate}} at {{appointmentTime}}. Join link: {{meetingLink}}. Reply if you need to reschedule.',
  },
  appointment_reminder: {
    description: 'Appointment reminder sent 1 hour before',
    body: 'Hi {{firstName}}, reminder: your Growth Escalators strategy call starts in 1 hour at {{appointmentTime}}. Join here: {{meetingLink}}. Looking forward to it!',
  },
  hot_lead_alert: {
    description: 'Internal alert to sales team for high-intent leads',
    body: 'NEW LEAD — {{firstName}} {{lastName}} just booked a strategy call. Score: {{leadScore}}/100. Scheduled: {{appointmentDate}}. Check CRM: https://web-production-311da.up.railway.app/crm',
  },
};

// ---------------------------------------------------------------------------
// Ensure body + description columns exist and seed templates
// ---------------------------------------------------------------------------
async function ensureColumnsAndSeed(tenantId: string): Promise<void> {
  // Add body and description columns if missing
  try {
    await pool.query(`ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS body TEXT`);
    await pool.query(`ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS description TEXT`);
  } catch { /* columns may already exist */ }

  // Seed default templates
  for (const [name, data] of Object.entries(DEFAULT_BODIES)) {
    const vars = [...data.body.matchAll(/\{\{(\w+)\}\}/g)];
    const variableCount = new Set(vars.map(m => m[1])).size;
    const category = ['followup_day3', 'nudge_day7'].includes(name) ? 'marketing' : 'utility';

    try {
      await pool.query(
        `INSERT INTO wa_templates (tenant_id, template_name, category, variable_count, status, language, approved_at, body, description)
         VALUES ($1, $2, $3, $4, 'approved', 'en', NOW(), $5, $6)
         ON CONFLICT ON CONSTRAINT wa_templates_tenant_name_idx DO UPDATE SET
           body = COALESCE(wa_templates.body, EXCLUDED.body),
           description = COALESCE(wa_templates.description, EXCLUDED.description)`,
        [tenantId, name, category, variableCount, data.body, data.description],
      );
    } catch { /* ignore */ }
  }
}

// ---------------------------------------------------------------------------
// GET /api/whatsapp/templates — all templates (any status)
// ---------------------------------------------------------------------------
router.get('/templates', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    await ensureColumnsAndSeed(tenantId);

    const result = await pool.query(
      `SELECT id, tenant_id, template_name, category, language, variable_count, status,
              submitted_at, approved_at, created_at, body, description
       FROM wa_templates WHERE tenant_id = $1 ORDER BY created_at`,
      [tenantId],
    );

    res.json({ templates: result.rows });
  } catch (e: unknown) {
    logger.error('[wa-templates] fetch failed:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// Ensure columns needed for Meta Graph round-trip exist
// ---------------------------------------------------------------------------
let metaColumnsEnsured = false;
async function ensureMetaColumns(): Promise<void> {
  if (metaColumnsEnsured) return;
  try {
    await pool.query(`ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS meta_template_id TEXT`);
    await pool.query(`ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS error_message TEXT`);
    await pool.query(`ALTER TABLE wa_templates ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
    metaColumnsEnsured = true;
  } catch (e) {
    logger.warn('[wa-templates] ensureMetaColumns failed (may already exist):', e);
  }
}

// ---------------------------------------------------------------------------
// POST /api/whatsapp/templates — create a new template
// Flow: INSERT local row (status=pending) → POST to Meta Graph → UPDATE row
// with meta_template_id + status from Graph; on Graph error, mark row status
// 'error' with error_message and return 4xx/502.
// ---------------------------------------------------------------------------
router.post('/templates', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    await ensureMetaColumns();

    const { templateName, category, body, language, components } = req.body;

    if (!templateName || !category) {
      res.status(400).json({ error: 'templateName and category are required' });
      return;
    }

    const lang = language || 'en';
    const vars = body ? [...body.matchAll(/\{\{(\w+)\}\}/g)] : [];
    const variableCount = new Set(vars.map((m: RegExpMatchArray) => m[1])).size;

    // 1) Local INSERT (status=pending). Keeps a row even if Graph fails so the
    // admin UI can show the failure state.
    const result = await pool.query(
      `INSERT INTO wa_templates (tenant_id, template_name, category, language, variable_count, status, submitted_at, body, description)
       VALUES ($1, $2, $3, $4, $5, 'pending', NOW(), $6, $7)
       RETURNING *`,
      [tenantId, templateName, category, lang, variableCount, body ?? null, `Custom template — ${category}`],
    );
    const localRow = result.rows[0];

    // 2) Build Meta Graph body. Prefer explicit `components` from the request,
    // else synthesize a single BODY component from `body`.
    const wabaId = process.env.META_WABA_ID;
    const accessToken = process.env.META_ACCESS_TOKEN;

    if (!wabaId || !accessToken) {
      // Mark the local row so the UI knows what happened, then surface 502.
      const errMsg = 'META_WABA_ID and META_ACCESS_TOKEN must be set';
      await pool.query(
        `UPDATE wa_templates SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [errMsg, localRow.id],
      );
      res.status(502).json({ error: { message: errMsg, meta: null } });
      return;
    }

    const graphComponents = Array.isArray(components) && components.length > 0
      ? components
      : (body ? [{ type: 'BODY', text: body }] : []);

    const graphBody = {
      name: templateName,
      language: lang,
      category: String(category).toUpperCase(),
      components: graphComponents,
    };

    // 3) Call Meta Graph
    let graphJson: any = null;
    try {
      const url = `https://graph.facebook.com/v21.0/${wabaId}/message_templates`;
      const fetchRes = await globalThis.fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(graphBody),
      });
      try {
        graphJson = await fetchRes.json();
      } catch {
        graphJson = null;
      }

      if (!fetchRes.ok || (graphJson && graphJson.error)) {
        const metaErr = graphJson?.error ?? { message: `Meta returned HTTP ${fetchRes.status}` };
        const errMsg = metaErr?.message || `Meta returned HTTP ${fetchRes.status}`;
        await pool.query(
          `UPDATE wa_templates SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
          [errMsg, localRow.id],
        );
        const statusCode = fetchRes.status >= 400 && fetchRes.status < 500 ? fetchRes.status : 502;
        res.status(statusCode).json({ error: { message: errMsg, meta: graphJson?.error ?? graphJson } });
        return;
      }
    } catch (fetchErr: unknown) {
      const errMsg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
      logger.error('[wa-templates] Meta Graph fetch threw:', fetchErr);
      await pool.query(
        `UPDATE wa_templates SET status = 'error', error_message = $1, updated_at = NOW() WHERE id = $2`,
        [errMsg, localRow.id],
      );
      res.status(502).json({ error: { message: errMsg, meta: null } });
      return;
    }

    // 4) Graph success — propagate id + status to the local row
    const metaTemplateId = graphJson?.id ? String(graphJson.id) : null;
    const metaStatus = graphJson?.status ? String(graphJson.status).toLowerCase() : 'pending';

    const updated = await pool.query(
      `UPDATE wa_templates
         SET meta_template_id = $1,
             status = $2,
             updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [metaTemplateId, metaStatus, localRow.id],
    );

    res.status(201).json({ template: updated.rows[0] });
  } catch (e: unknown) {
    logger.error('[wa-templates] create failed:', e);
    const msg = e instanceof Error ? e.message : String(e);
    if (msg.includes('wa_templates_tenant_name_idx')) {
      res.status(409).json({ error: 'A template with this name already exists' });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

export default router;
