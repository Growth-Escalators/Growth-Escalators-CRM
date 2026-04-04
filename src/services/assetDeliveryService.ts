import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendWhatsAppMessage } from './growthOSSetup';
import { sendSlackDM } from './slackService';
import { SLACK_JATIN } from '../config/constants';

// ---------------------------------------------------------------------------
// Asset URLs
// ---------------------------------------------------------------------------
const ASSETS = {
  mainPdf:    'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/5%20Winning%20D2C%20Brands.pdf',
  growthKit:  'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/Advanced%20D2C%20Growth%20Kit%20Latest.pdf',
  auditCall:  'https://cal.com/growth-escalators/discovery-call',
};

// ---------------------------------------------------------------------------
// Send post-purchase assets via WhatsApp
// Called from worker.ts after pipeline placement
// ---------------------------------------------------------------------------
export async function deliverPurchaseAssets(params: {
  contactId: string;
  firstName: string;
  phone: string | null;
  email: string | null;
  bump1: boolean;
  bump2: boolean;
  segment: string;
}): Promise<void> {
  const { contactId, firstName, phone, email, bump1, bump2, segment } = params;

  // --- WhatsApp messages ---
  if (phone) {
    // Message 1: Main product delivery (always)
    const msg1 =
      `Hi ${firstName}! 🎉 Your purchase is confirmed. Here is your D2C Funnel Breakdown Pack — download it now, it is yours forever: ${ASSETS.mainPdf}\n\n` +
      `This PDF breaks down exactly what 5 winning D2C brands are doing on Meta right now. Go through Section 2 first — that is where most brands find their biggest insight.\n\n` +
      `Reply anytime if you have questions. — Jatin from Growth Escalators`;
    await sendWhatsAppMessage(phone, msg1).catch(e =>
      logger.error('[asset-delivery] WA msg1 failed:', e instanceof Error ? e.message : String(e)));

    await delay(2000);

    // Message 2: Growth Kit (bump1 buyers)
    if (bump1) {
      const msg2 =
        `Your Growth Kit is also ready! 📦 Download it here: ${ASSETS.growthKit}\n\n` +
        `Inside you will find swipe files, ad templates, landing page frameworks, and the Meta ads checklist. ` +
        `Start with the checklist — it takes 10 minutes and shows you exactly where your funnel is leaking. — Jatin`;
      await sendWhatsAppMessage(phone, msg2).catch(e =>
        logger.error('[asset-delivery] WA msg2 failed:', e instanceof Error ? e.message : String(e)));

      await delay(2000);
    }

    // Message 3: Audit call booking (bump2 buyers)
    if (bump2) {
      const msg3 =
        `Your 15-min Meta Ads Audit with Jatin is confirmed! 🎯\n\n` +
        `Book your slot here (slots fill fast): ${ASSETS.auditCall}\n\n` +
        `Come prepared with:\n` +
        `- Your current ROAS or CPL\n` +
        `- Your top 2-3 running creatives\n` +
        `- Your biggest challenge right now\n\n` +
        `Jatin will review your live account and give you 3 specific fixes. See you on the call!`;
      await sendWhatsAppMessage(phone, msg3).catch(e =>
        logger.error('[asset-delivery] WA msg3 failed:', e instanceof Error ? e.message : String(e)));
    }
  }

  // --- Email delivery ---
  if (email) {
    await sendPurchaseEmail({ firstName, email, bump1, bump2 }).catch(e =>
      logger.error('[asset-delivery] email failed:', e instanceof Error ? e.message : String(e)));
  }

  // --- Bump2: audit booking follow-up tracking ---
  if (bump2) {
    // Add note to contact
    await pool.query(
      `INSERT INTO contact_notes (id, tenant_id, contact_id, content, created_by, created_at)
       SELECT gen_random_uuid(), c.tenant_id, c.id,
              'Purchased ₹499 audit — send Cal.com link if not booked within 48 hours',
              'system', NOW()
       FROM contacts c WHERE c.id = $1`,
      [contactId],
    ).catch(() => {});

    // Update tags to include audit_purchased
    await pool.query(
      `UPDATE contacts
       SET tags = ARRAY(SELECT DISTINCT unnest(COALESCE(tags, ARRAY[]::text[]) || ARRAY['audit_purchased'])),
           status = 'qualified',
           updated_at = NOW()
       WHERE id = $1`,
      [contactId],
    ).catch(() => {});

    // Schedule 48h follow-up check via event
    await pool.query(
      `INSERT INTO events (id, tenant_id, contact_id, type, data, created_at)
       SELECT gen_random_uuid(), c.tenant_id, c.id,
              'audit_booking_followup',
              $2::jsonb,
              NOW() + INTERVAL '48 hours'
       FROM contacts c WHERE c.id = $1`,
      [contactId, JSON.stringify({ firstName, phone, followUpAt: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString() })],
    ).catch(() => {});
  }

  logger.info(`[asset-delivery] Delivered to ${firstName} (${segment}) — bump1:${bump1} bump2:${bump2}`);
}

// ---------------------------------------------------------------------------
// Check for unbooked audit calls (called from a cron job)
// ---------------------------------------------------------------------------
export async function checkUnbookedAuditCalls(): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT c.id, c.first_name, c.last_name,
             (SELECT channel_value FROM contact_channels WHERE contact_id = c.id AND channel_type = 'whatsapp' LIMIT 1) AS phone
      FROM contacts c
      WHERE 'audit_purchased' = ANY(c.tags)
        AND NOT ('appt_booked' = ANY(c.tags))
        AND c.created_at < NOW() - INTERVAL '48 hours'
        AND c.created_at > NOW() - INTERVAL '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM events e
          WHERE e.contact_id = c.id AND e.type = 'audit_followup_sent'
        )
      LIMIT 10
    `);

    for (const row of result.rows as Array<{ id: string; first_name: string; last_name: string | null; phone: string | null }>) {
      const name = `${row.first_name}${row.last_name ? ' ' + row.last_name : ''}`;
      await sendSlackDM(SLACK_JATIN,
        `⚠️ *FOLLOW UP:* ${name} purchased audit call 48hrs ago but has not booked.\n` +
        `WhatsApp: ${row.phone ?? 'unknown'}\n` +
        `Book link: ${ASSETS.auditCall}`
      ).catch(() => {});

      // Mark as sent so we don't re-alert
      await pool.query(
        `INSERT INTO events (id, tenant_id, contact_id, type, data, created_at)
         SELECT gen_random_uuid(), c.tenant_id, c.id, 'audit_followup_sent', '{}'::jsonb, NOW()
         FROM contacts c WHERE c.id = $1`,
        [row.id],
      ).catch(() => {});
    }

    if (result.rows.length > 0) {
      logger.info(`[asset-delivery] Sent ${result.rows.length} audit follow-up alert(s)`);
    }
  } catch (e) {
    logger.error('[asset-delivery] checkUnbookedAuditCalls failed:', e);
  }
}

// ---------------------------------------------------------------------------
// Brevo transactional email for purchase confirmation
// ---------------------------------------------------------------------------
async function sendPurchaseEmail(params: {
  firstName: string;
  email: string;
  bump1: boolean;
  bump2: boolean;
}): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    logger.warn('[asset-delivery] BREVO_API_KEY not set — skipping email');
    return;
  }

  const { firstName, email, bump1, bump2 } = params;

  let body = `Hi ${firstName},\n\nYour purchase is confirmed. Here is everything you have access to:\n\n`;
  body += `📄 D2C Funnel Breakdown Pack (₹9 product):\n${ASSETS.mainPdf}\n\n`;
  if (bump1) {
    body += `📦 Advanced Growth Kit (your ₹199 add-on):\n${ASSETS.growthKit}\n\n`;
  }
  if (bump2) {
    body += `🎯 Book your 15-min Meta Ads Audit with Jatin:\n${ASSETS.auditCall}\n(Book now — slots are limited)\n\n`;
  }
  body += `Start with the PDF — go through Section 2 first. Most people find their biggest insight there.\n\n`;
  body += `Reply to this email if you have any questions.\n\n`;
  body += `— Jatin Agrawal\nFounder, Growth Escalators`;

  const htmlBody = body.replace(/\n/g, '<br>');

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        sender: { name: 'Jatin from Growth Escalators', email: 'jatin@growthescalators.com' },
        to: [{ email, name: firstName }],
        subject: `Your D2C Funnel Breakdown Pack is ready, ${firstName} 🎯`,
        htmlContent: htmlBody,
        textContent: body,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      logger.error(`[asset-delivery] Brevo ${res.status}:`, err.slice(0, 200));
    } else {
      logger.info(`[asset-delivery] Purchase email sent to ${email}`);
    }
  } catch (e) {
    logger.error('[asset-delivery] Brevo request failed:', e instanceof Error ? e.message : String(e));
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
