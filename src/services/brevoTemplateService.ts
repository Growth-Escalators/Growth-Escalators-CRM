import { eq } from 'drizzle-orm';
import { db, emailTemplates } from '../db/index';

const BREVO_API_BASE = 'https://api.brevo.com/v3';
const SENDER_EMAIL = 'jatin@growthescalators.com';

function brevoHeaders() {
  return {
    'Content-Type': 'application/json',
    'api-key': process.env.BREVO_API_KEY ?? '',
  };
}

// ---------------------------------------------------------------------------
// syncTemplateToBrevo
// Creates or updates a Brevo SMTP template for a given email_templates row.
// Returns { synced: boolean, brevoTemplateId?: number, error?: string }
// ---------------------------------------------------------------------------
export async function syncTemplateToBrevo(
  template: typeof emailTemplates.$inferSelect,
): Promise<{ synced: boolean; brevoTemplateId?: number; error?: string }> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    console.warn('[brevoTemplateService] BREVO_API_KEY not set — skipping sync');
    return { synced: false, error: 'BREVO_API_KEY not configured' };
  }

  const htmlContent =
    template.bodyHtml ||
    (template.bodyText ?? '').replace(/\n/g, '<br>');

  const payload = {
    templateName: template.displayName || template.name,
    subject: template.subject,
    htmlContent,
    sender: { name: template.fromName ?? 'Jatin from Growth Escalators', email: SENDER_EMAIL },
    isActive: true,
  };

  try {
    let brevoTemplateId: number;

    if (template.brevoTemplateId) {
      // Update existing
      const res = await fetch(`${BREVO_API_BASE}/smtp/templates/${template.brevoTemplateId}`, {
        method: 'PUT',
        headers: brevoHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('[brevoTemplateService] PUT failed:', err);
        return { synced: false, error: err };
      }
      brevoTemplateId = template.brevoTemplateId;
    } else {
      // Create new
      const res = await fetch(`${BREVO_API_BASE}/smtp/templates`, {
        method: 'POST',
        headers: brevoHeaders(),
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.text();
        console.error('[brevoTemplateService] POST failed:', err);
        return { synced: false, error: err };
      }
      const data = (await res.json()) as { id: number };
      brevoTemplateId = data.id;
    }

    // Persist back to DB
    await db
      .update(emailTemplates)
      .set({ brevoTemplateId, brevoSynced: true, brevoSyncedAt: new Date(), updatedAt: new Date() })
      .where(eq(emailTemplates.id, template.id));

    return { synced: true, brevoTemplateId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[brevoTemplateService] sync error:', msg);
    return { synced: false, error: msg };
  }
}
