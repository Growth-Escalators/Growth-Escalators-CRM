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
    description: 'Welcome message for new D2C leads',
    body: 'Hi {{firstName}}, thanks for reaching out to Growth Escalators! I am Jatin, and I help D2C brands scale profitably on Meta. I will be in touch shortly. Meanwhile, reply with your biggest Meta ads challenge right now.',
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
// POST /api/whatsapp/templates — create a new template
// ---------------------------------------------------------------------------
router.post('/templates', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const { templateName, category, body } = req.body;

    if (!templateName || !category) {
      res.status(400).json({ error: 'templateName and category are required' });
      return;
    }

    const vars = body ? [...body.matchAll(/\{\{(\w+)\}\}/g)] : [];
    const variableCount = new Set(vars.map((m: RegExpMatchArray) => m[1])).size;

    const result = await pool.query(
      `INSERT INTO wa_templates (tenant_id, template_name, category, language, variable_count, status, submitted_at, body, description)
       VALUES ($1, $2, $3, 'en', $4, 'pending', NOW(), $5, $6)
       RETURNING *`,
      [tenantId, templateName, category, variableCount, body ?? null, `Custom template — ${category}`],
    );

    res.status(201).json({ template: result.rows[0] });
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
