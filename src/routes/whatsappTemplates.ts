import { Router, type Request, type Response } from 'express';
import { db } from '../db/index';
import { waTemplates } from '../db/schema';
import { eq } from 'drizzle-orm';
import { pool } from '../db/index';
import logger from '../utils/logger';

const router = Router();

// ---------------------------------------------------------------------------
// Template body content — stored here because wa_templates table has no body column.
// Maps template_name → { body, description }
// ---------------------------------------------------------------------------
const TEMPLATE_BODIES: Record<string, { body: string; description: string }> = {
  welcome_d2c: {
    description: 'Welcome message for new D2C leads',
    body:
      'Hi {{firstName}}, thanks for reaching out to Growth Escalators! ' +
      'I am Jatin, and I help D2C brands scale profitably on Meta. ' +
      'I will be in touch shortly. Meanwhile, reply with your biggest Meta ads challenge right now.',
  },
  followup_day3: {
    description: 'Day 3 follow-up for leads who haven\'t booked a call',
    body:
      'Hi {{firstName}}, following up from Growth Escalators. ' +
      'Have you had a chance to think about scaling your Meta ads? ' +
      'Reply 1 if you would like to book a free strategy call.',
  },
  nudge_day7: {
    description: 'Day 7 urgency nudge for unbooked leads',
    body:
      'Hi {{firstName}}, last follow up from Jatin at Growth Escalators. ' +
      'I have a few open slots this week for strategy calls — completely free, no pitch, just a clear plan for your Meta ads. ' +
      'Want one? Reply YES.',
  },
  appointment_confirm: {
    description: 'Appointment booking confirmation',
    body:
      'Hi {{firstName}}, your strategy call with Growth Escalators is confirmed for {{appointmentDate}} at {{appointmentTime}}. ' +
      'Join link: {{meetingLink}}. Reply if you need to reschedule.',
  },
  appointment_reminder: {
    description: 'Appointment reminder sent 1 hour before',
    body:
      'Hi {{firstName}}, reminder: your Growth Escalators strategy call starts in 1 hour at {{appointmentTime}}. ' +
      'Join here: {{meetingLink}}. Looking forward to it!',
  },
  hot_lead_alert: {
    description: 'Internal alert to sales team for high-intent leads',
    body:
      'NEW LEAD — {{firstName}} {{lastName}} just booked a strategy call. ' +
      'Score: {{leadScore}}/100. Scheduled: {{appointmentDate}}. ' +
      'Check CRM: https://web-production-311da.up.railway.app/crm',
  },
};

// ---------------------------------------------------------------------------
// Ensure seed templates exist for the tenant
// ---------------------------------------------------------------------------
async function seedTemplates(tenantId: string): Promise<void> {
  const templateSeeds = [
    { templateName: 'welcome_d2c',          category: 'utility',   variableCount: 1, status: 'approved' },
    { templateName: 'followup_day3',        category: 'marketing', variableCount: 1, status: 'approved' },
    { templateName: 'nudge_day7',           category: 'marketing', variableCount: 1, status: 'approved' },
    { templateName: 'appointment_confirm',  category: 'utility',   variableCount: 4, status: 'approved' },
    { templateName: 'appointment_reminder', category: 'utility',   variableCount: 3, status: 'approved' },
    { templateName: 'hot_lead_alert',       category: 'utility',   variableCount: 4, status: 'approved' },
  ];

  for (const seed of templateSeeds) {
    try {
      await pool.query(
        `INSERT INTO wa_templates (tenant_id, template_name, category, variable_count, status, language, approved_at)
         VALUES ($1, $2, $3, $4, $5, 'en', NOW())
         ON CONFLICT ON CONSTRAINT wa_templates_tenant_name_idx DO NOTHING`,
        [tenantId, seed.templateName, seed.category, seed.variableCount, seed.status],
      );
    } catch {
      // ignore — constraint may differ
    }
  }
}

// ---------------------------------------------------------------------------
// GET /api/whatsapp/templates — all templates (any status)
// ---------------------------------------------------------------------------
router.get('/templates', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    await seedTemplates(tenantId);

    const rows = await db.select().from(waTemplates)
      .where(eq(waTemplates.tenantId, tenantId));

    const enriched = rows.map(r => ({
      ...r,
      body: TEMPLATE_BODIES[r.templateName]?.body ?? null,
      description: TEMPLATE_BODIES[r.templateName]?.description ?? null,
    }));

    res.json({ templates: enriched });
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

    // Count variables in body
    const vars = body ? [...body.matchAll(/\{\{(\w+)\}\}/g)] : [];
    const variableCount = new Set(vars.map((m: RegExpMatchArray) => m[1])).size;

    const [row] = await db.insert(waTemplates).values({
      tenantId,
      templateName,
      category,
      language: 'en',
      variableCount,
      status: 'pending',
      submittedAt: new Date(),
    }).returning();

    // Store body in memory map so it shows immediately
    if (body) {
      TEMPLATE_BODIES[templateName] = {
        body,
        description: `Custom template — ${category}`,
      };
    }

    res.status(201).json({
      template: {
        ...row,
        body: body ?? null,
        description: TEMPLATE_BODIES[templateName]?.description ?? null,
      },
    });
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
