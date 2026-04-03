import { Router, type Request, type Response } from 'express';
import { db } from '../db/index';
import { waTemplates } from '../db/schema';
import { eq, sql } from 'drizzle-orm';
import { pool } from '../db/index';
import logger from '../utils/logger';

const router = Router();

// ---------------------------------------------------------------------------
// Template body content — stored here because wa_templates table has no body column.
// Maps template_name → { body, description }
// ---------------------------------------------------------------------------
const TEMPLATE_BODIES: Record<string, { body: string; description: string }> = {
  welcome_d2c: {
    description: 'Welcome message for new D2C leads after ₹9 purchase',
    body:
      'Hi {{firstName}} 👋\n\n' +
      'Welcome to Growth Escalators! Your ₹9 strategy session access is confirmed.\n\n' +
      'Here\'s what happens next:\n' +
      '1. Our team will review your brand — {{brandName}}\n' +
      '2. You\'ll get a personalized growth roadmap within 24h\n' +
      '3. Book your 1:1 call: {{bookingUrl}}\n\n' +
      'Questions? Just reply here.\n\n' +
      '— Team GE',
  },
  followup_day3: {
    description: 'Day 3 follow-up for leads who haven\'t booked a call',
    body:
      'Hey {{firstName}},\n\n' +
      'It\'s been 3 days since you joined — just checking in!\n\n' +
      'Most brands like {{brandName}} see the biggest wins when they act fast. ' +
      'Your personalized audit is ready.\n\n' +
      '📅 Book your call now: {{bookingUrl}}\n\n' +
      'Slots are filling up for this week. Don\'t miss out!',
  },
  nudge_day7: {
    description: 'Day 7 urgency nudge for unbooked leads',
    body:
      'Hi {{firstName}},\n\n' +
      'Your Growth Escalators strategy session expires in 48 hours ⏰\n\n' +
      'We\'ve already identified {{opportunityCount}} growth opportunities for {{brandName}}. ' +
      'Let\'s walk through them together.\n\n' +
      '👉 Last chance to book: {{bookingUrl}}\n\n' +
      'After this, the slot opens to the waitlist.',
  },
  appointment_confirm: {
    description: 'Appointment booking confirmation',
    body:
      'Confirmed ✅\n\n' +
      'Hi {{firstName}}, your call is booked!\n\n' +
      '📅 {{appointmentDate}} at {{appointmentTime}}\n' +
      '🔗 Join here: {{meetingLink}}\n\n' +
      'Please keep 30 minutes free. We\'ll cover:\n' +
      '• Your current ad performance\n' +
      '• 3 quick wins for {{brandName}}\n' +
      '• Custom scaling roadmap\n\n' +
      'See you there! 🚀',
  },
  appointment_reminder: {
    description: 'Appointment reminder sent 1 hour before',
    body:
      'Reminder 🔔\n\n' +
      'Hi {{firstName}}, your Growth Escalators call is in 1 hour!\n\n' +
      '⏰ {{appointmentTime}}\n' +
      '🔗 {{meetingLink}}\n\n' +
      'Have your ad dashboard open if possible — it helps us give better recommendations.\n\n' +
      'See you soon!',
  },
  hot_lead_alert: {
    description: 'Internal alert to sales team for high-intent leads',
    body:
      '🔥 Hot Lead Alert!\n\n' +
      'Name: {{firstName}} {{lastName}}\n' +
      'Brand: {{brandName}}\n' +
      'Phone: {{phone}}\n' +
      'Segment: {{segment}}\n' +
      'Score: {{leadScore}}/100\n\n' +
      'Action: Call within 15 minutes. This lead {{triggerReason}}.\n\n' +
      'Assigned to: {{assignedTo}}',
  },
};

// ---------------------------------------------------------------------------
// Ensure seed templates exist for the tenant
// ---------------------------------------------------------------------------
async function seedTemplates(tenantId: string): Promise<void> {
  const templateSeeds = [
    { templateName: 'welcome_d2c',          category: 'utility',   variableCount: 3, status: 'approved' },
    { templateName: 'followup_day3',        category: 'marketing', variableCount: 2, status: 'approved' },
    { templateName: 'nudge_day7',           category: 'marketing', variableCount: 3, status: 'approved' },
    { templateName: 'appointment_confirm',  category: 'utility',   variableCount: 4, status: 'approved' },
    { templateName: 'appointment_reminder', category: 'utility',   variableCount: 2, status: 'approved' },
    { templateName: 'hot_lead_alert',       category: 'utility',   variableCount: 7, status: 'approved' },
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

export default router;
