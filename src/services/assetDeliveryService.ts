import { pool } from '../db/index';
import logger from '../utils/logger';
import { sendWhatsAppMessage } from './growthOSSetup';
import { sendSlackDM } from './slackService';
import { SLACK_JATIN } from '../config/constants';
import { getFunnelConfig, renderTemplate, type FunnelConfig } from './funnelConfigService';

// ---------------------------------------------------------------------------
// Legacy asset URLs (fallback when no funnel config exists)
// ---------------------------------------------------------------------------
const LEGACY_ASSETS = {
  mainPdf:    'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/5%20Winning%20D2C%20Brands.pdf',
  growthKit:  'https://pub-42526281354a42f3879bd56bed4ad62b.r2.dev/Advanced%20D2C%20Growth%20Kit%20Latest.pdf',
  auditCall:  'https://cal.com/growth-escalators/discovery-call',
};

// ---------------------------------------------------------------------------
// Send post-purchase assets via WhatsApp + Email
// Called from worker.ts after pipeline placement
// Now config-driven — reads templates and URLs from funnel_configs table
// ---------------------------------------------------------------------------
export async function deliverPurchaseAssets(params: {
  contactId: string;
  firstName: string;
  phone: string | null;
  email: string | null;
  bump1: boolean;
  bump2: boolean;
  segment: string;
  funnelSlug?: string;
}): Promise<void> {
  const { contactId, firstName, phone, email, bump1, bump2, segment, funnelSlug } = params;

  // Load funnel config for this purchase
  const config = funnelSlug ? await getFunnelConfig(funnelSlug) : null;

  // Resolve asset URLs from config or legacy
  const mainPdfUrl = config?.main_pdf_url || LEGACY_ASSETS.mainPdf;
  const bump1PdfUrl = config?.bump1_pdf_url || LEGACY_ASSETS.growthKit;
  const bump2BookingUrl = config?.bump2_booking_url || LEGACY_ASSETS.auditCall;

  // Template variables for message rendering
  const templateVars: Record<string, string> = {
    firstName,
    productName: config?.product_name || 'D2C Funnel Breakdown Pack',
    mainPdfUrl,
    bump1PdfUrl,
    bump2BookingUrl,
    bump1Label: config?.bump1_label || 'Growth Kit',
    bump2Label: config?.bump2_label || 'Audit Call',
  };

  // Track delivery status
  let waStatus: 'sent' | 'failed' = 'sent';
  let waError: string | null = null;
  let emailStatus: 'sent' | 'failed' = 'sent';
  let emailError: string | null = null;

  // --- WhatsApp messages ---
  if (phone) {
    try {
      // Message 1: Main product delivery (always)
      const msg1 = config?.wa_msg1_template
        ? renderTemplate(config.wa_msg1_template, templateVars)
        : `Hi ${firstName}! 🎉 Your purchase is confirmed. Here is your ${templateVars.productName} — download it now: ${mainPdfUrl}\n\nReply anytime if you have questions. — Jatin from Growth Escalators`;
      await sendWhatsAppMessage(phone, msg1);

      await delay(2000);

      // Message 2: Bump 1 (only if bump1 purchased AND bump1 exists in config)
      if (bump1 && (config?.bump1_price || !config)) {
        const msg2 = config?.wa_msg2_template
          ? renderTemplate(config.wa_msg2_template, templateVars)
          : `Your ${templateVars.bump1Label} is also ready! 📦 Download it here: ${bump1PdfUrl}`;
        await sendWhatsAppMessage(phone, msg2);
        await delay(2000);
      }

      // Message 3: Bump 2 (only if bump2 purchased AND bump2 exists in config)
      if (bump2 && (config?.bump2_price || !config)) {
        const msg3 = config?.wa_msg3_template
          ? renderTemplate(config.wa_msg3_template, templateVars)
          : `Your ${templateVars.bump2Label} is confirmed! 🎯 Book your slot: ${bump2BookingUrl}`;
        await sendWhatsAppMessage(phone, msg3);
      }
    } catch (e) {
      waStatus = 'failed';
      waError = e instanceof Error ? e.message : String(e);
      logger.error(`[asset-delivery] WA failed for ${contactId}:`, waError);
    }
  } else {
    waStatus = 'failed';
    waError = 'no_phone_number';
  }

  // --- Email delivery (always attempt as fallback) ---
  if (email) {
    try {
      await sendPurchaseEmail({ firstName, email, bump1, bump2, config });
    } catch (e) {
      emailStatus = 'failed';
      emailError = e instanceof Error ? e.message : String(e);
      logger.error(`[asset-delivery] email failed for ${contactId}:`, emailError);
    }
  } else {
    emailStatus = 'failed';
    emailError = 'no_email';
  }

  // --- Log delivery status ---
  const manualNeeded = waStatus === 'failed' && emailStatus === 'failed';
  pool.query(
    `INSERT INTO purchase_delivery_log (tenant_id, contact_id, funnel_slug, wa_status, wa_error, wa_sent_at, email_status, email_error, email_sent_at, manual_followup_needed)
     SELECT c.tenant_id, c.id, $3, $4, $5, $6, $7, $8, $9, $10
     FROM contacts c WHERE c.id = $1
     ON CONFLICT DO NOTHING`,
    [contactId, null, funnelSlug || 'ecom',
     waStatus, waError, waStatus === 'sent' ? new Date() : null,
     emailStatus, emailError, emailStatus === 'sent' ? new Date() : null,
     manualNeeded],
  ).catch(() => {});

  // --- Alert team if BOTH channels failed ---
  if (manualNeeded) {
    sendSlackDM(SLACK_JATIN,
      `⚠️ *DELIVERY FAILED — Manual follow-up needed*\n` +
      `• Contact: ${firstName} (${contactId})\n` +
      `• Funnel: ${config?.name || funnelSlug || 'ecom'}\n` +
      `• WA Error: ${waError}\n` +
      `• Email Error: ${emailError}\n` +
      `• Phone: ${phone || 'N/A'} | Email: ${email || 'N/A'}\n` +
      `*ACTION:* Send assets manually via WhatsApp or email`,
    ).catch(() => {});
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
      `INSERT INTO events (id, tenant_id, contact_id, event_type, payload, created_at)
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
          WHERE e.contact_id = c.id AND e.event_type = 'audit_followup_sent'
        )
      LIMIT 10
    `);

    for (const row of result.rows as Array<{ id: string; first_name: string; last_name: string | null; phone: string | null }>) {
      const name = `${row.first_name}${row.last_name ? ' ' + row.last_name : ''}`;
      await sendSlackDM(SLACK_JATIN,
        `⚠️ *FOLLOW UP:* ${name} purchased audit call 48hrs ago but has not booked.\n` +
        `WhatsApp: ${row.phone ?? 'unknown'}\n` +
        `Book link: ${LEGACY_ASSETS.auditCall}`
      ).catch(() => {});

      // Mark as sent so we don't re-alert
      await pool.query(
        `INSERT INTO events (id, tenant_id, contact_id, event_type, payload, created_at)
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
  config?: FunnelConfig | null;
}): Promise<void> {
  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    logger.warn('[asset-delivery] BREVO_API_KEY not set — skipping email');
    return;
  }

  const { firstName, email, bump1, bump2, config } = params;

  let subject: string;
  let body: string;

  if (config?.email_body) {
    // Config-driven email
    const templateVars: Record<string, string> = {
      firstName,
      productName: config.product_name,
      mainPdfUrl: config.main_pdf_url || '[PDF will be delivered shortly]',
      bump1Section: bump1 && config.bump1_pdf_url ? `📦 ${config.bump1_label || 'Add-on'}:\n${config.bump1_pdf_url}\n\n` : '',
      bump2Section: bump2 && config.bump2_booking_url ? `🎯 ${config.bump2_label || 'Call'}:\n${config.bump2_booking_url}\n\n` : '',
    };
    subject = renderTemplate(config.email_subject || 'Your purchase is confirmed, {firstName}!', templateVars);
    body = renderTemplate(config.email_body, templateVars);
  } else {
    // Legacy fallback
    subject = `Your D2C Funnel Breakdown Pack is ready, ${firstName} 🎯`;
    body = `Hi ${firstName},\n\nYour purchase is confirmed. Here is everything you have access to:\n\n`;
    body += `📄 D2C Funnel Breakdown Pack:\n${LEGACY_ASSETS.mainPdf}\n\n`;
    if (bump1) body += `📦 Advanced Growth Kit:\n${LEGACY_ASSETS.growthKit}\n\n`;
    if (bump2) body += `🎯 Book your Audit Call:\n${LEGACY_ASSETS.auditCall}\n\n`;
    body += `Reply to this email if you have any questions.\n\n— Jatin Agrawal\nFounder, Growth Escalators`;
  }

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        sender: { name: 'Jatin from Growth Escalators', email: 'jatin@growthescalators.com' },
        to: [{ email, name: firstName }],
        subject,
        htmlContent: body.replace(/\n/g, '<br>'),
        textContent: body,
      }),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => '');
      throw new Error(`Brevo ${res.status}: ${err.slice(0, 200)}`);
    }
    logger.info(`[asset-delivery] Purchase email sent to ${email}`);
  } catch (e) {
    logger.error('[asset-delivery] Brevo request failed:', e instanceof Error ? e.message : String(e));
    throw e; // Re-throw so caller can track failure
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
