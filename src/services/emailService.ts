import { BrevoClient } from '@getbrevo/brevo';
import { eq } from 'drizzle-orm';
import { db, contacts, contactChannels, messages } from '../db/index';

// ---------------------------------------------------------------------------
// Email templates — inline content used when BREVO_API_KEY is configured
// ---------------------------------------------------------------------------
const EMAIL_TEMPLATES: Record<string, { subject: string; html: string; text: string }> = {
  welcome_d2c: {
    subject: 'Welcome to Growth Escalators',
    html: `<p>Hi there,</p>
<p>Thanks for reaching out to <strong>Growth Escalators</strong> — we're a performance marketing agency specialising in Meta Ads for D2C and healthcare brands.</p>
<p>Over the next few days, I'll be sharing a few quick insights on how we help brands like yours scale profitably with paid ads.</p>
<p>If you have any questions in the meantime, just reply to this email — I read every one.</p>
<p>Talk soon,<br>Jatin<br>Growth Escalators</p>`,
    text: `Hi there,\n\nThanks for reaching out to Growth Escalators — we're a performance marketing agency specialising in Meta Ads for D2C and healthcare brands.\n\nOver the next few days, I'll be sharing a few quick insights on how we help brands like yours scale profitably with paid ads.\n\nIf you have any questions in the meantime, just reply to this email.\n\nTalk soon,\nJatin\nGrowth Escalators`,
  },
  followup_day3: {
    subject: 'Quick follow-up from Growth Escalators',
    html: `<p>Hi,</p>
<p>Just following up on your inquiry from a few days ago.</p>
<p>At Growth Escalators, we help D2C brands and clinics run Meta Ads that generate consistent, qualified leads — not just clicks.</p>
<p>Would a quick 15-minute call this week work? You can book directly here: <a href="https://cal.com/growth-escalators">cal.com/growth-escalators</a></p>
<p>Best,<br>Jatin<br>Growth Escalators</p>`,
    text: `Hi,\n\nJust following up on your inquiry from a few days ago.\n\nAt Growth Escalators, we help D2C brands and clinics run Meta Ads that generate consistent, qualified leads — not just clicks.\n\nWould a quick 15-minute call this week work? Book here: cal.com/growth-escalators\n\nBest,\nJatin\nGrowth Escalators`,
  },
  nudge_day7: {
    subject: 'Last follow-up — Growth Escalators',
    html: `<p>Hi,</p>
<p>I don't want to crowd your inbox, so this will be my last follow-up.</p>
<p>If you're still exploring options for scaling your ads, I'd love to show you what we've done for similar brands. Our average client sees a 2–3x improvement in ROAS within 60 days.</p>
<p>If the timing isn't right, no problem at all. Feel free to reach out whenever you're ready.</p>
<p>Wishing you all the best,<br>Jatin<br>Growth Escalators</p>`,
    text: `Hi,\n\nI don't want to crowd your inbox, so this will be my last follow-up.\n\nIf you're still exploring options for scaling your ads, I'd love to show you what we've done for similar brands. Our average client sees a 2-3x improvement in ROAS within 60 days.\n\nIf the timing isn't right, no problem at all. Reach out whenever you're ready.\n\nWishing you all the best,\nJatin\nGrowth Escalators`,
  },
  appointment_confirm: {
    subject: 'Your call is confirmed — Growth Escalators',
    html: `<p>Hi,</p>
<p>Your discovery call with Growth Escalators is confirmed.</p>
<p>We'll be discussing your current ad spend, goals, and how we can help you scale with Meta Ads.</p>
<p>Please have these ready for our call:</p>
<ul>
  <li>Your current monthly ad budget</li>
  <li>Your best-performing product or service</li>
  <li>Your target ROAS or CAC goal</li>
</ul>
<p>Looking forward to speaking with you!</p>
<p>Jatin<br>Growth Escalators</p>`,
    text: `Hi,\n\nYour discovery call with Growth Escalators is confirmed.\n\nWe'll discuss your current ad spend, goals, and how we can help you scale with Meta Ads.\n\nPlease have ready: your monthly ad budget, best-performing product/service, target ROAS or CAC.\n\nLooking forward to speaking with you!\n\nJatin\nGrowth Escalators`,
  },
  proposal_followup: {
    subject: 'Following up on our proposal — Growth Escalators',
    html: `<p>Hi,</p>
<p>I wanted to follow up on the proposal I sent over.</p>
<p>I know decisions like this take time, so I'm happy to jump on a quick call to answer any questions or walk you through the numbers again.</p>
<p>Just reply here or book a slot: <a href="https://cal.com/growth-escalators">cal.com/growth-escalators</a></p>
<p>Best,<br>Jatin<br>Growth Escalators</p>`,
    text: `Hi,\n\nI wanted to follow up on the proposal I sent over.\n\nI know decisions like this take time, so I'm happy to jump on a quick call to answer any questions.\n\nReply here or book: cal.com/growth-escalators\n\nBest,\nJatin\nGrowth Escalators`,
  },
};

// ---------------------------------------------------------------------------
// sendTransactionalEmail
// Sends an email via Brevo. If BREVO_API_KEY is empty, returns mock success.
// ---------------------------------------------------------------------------
export async function sendTransactionalEmail(
  to: string,
  toName: string,
  subject: string,
  htmlContent: string,
  textContent: string,
): Promise<{ success: boolean; messageId?: string; mock?: boolean }> {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    console.warn('[emailService] BREVO_API_KEY not set — returning mock success');
    return { success: true, mock: true, messageId: `mock-${Date.now()}` };
  }

  const brevo = new BrevoClient({ apiKey });

  const result = await brevo.transactionalEmails.sendTransacEmail({
    subject,
    htmlContent,
    textContent,
    sender: { name: 'Growth Escalators', email: 'hello@growthescalators.com' },
    to: [{ email: to, name: toName }],
  });

  return { success: true, messageId: result.messageId };
}

// ---------------------------------------------------------------------------
// addContactToBrevo
// Adds or updates a contact in Brevo. Returns mock success if no API key.
// ---------------------------------------------------------------------------
export async function addContactToBrevo(
  email: string,
  firstName: string,
  lastName: string,
  listName: string,
  attributes: Record<string, unknown> = {},
): Promise<{ success: boolean; mock?: boolean }> {
  const apiKey = process.env.BREVO_API_KEY;

  if (!apiKey) {
    console.warn('[emailService] BREVO_API_KEY not set — returning mock success');
    return { success: true, mock: true };
  }

  const brevo = new BrevoClient({ apiKey });

  try {
    await brevo.contacts.createContact({
      email,
      attributes: { FIRSTNAME: firstName, LASTNAME: lastName, ...attributes },
      updateEnabled: true,
    });
    return { success: true };
  } catch (err) {
    console.error('[emailService] addContactToBrevo error:', err);
    return { success: false };
  }
}

// ---------------------------------------------------------------------------
// sendSequenceEmail
// Looks up contact + email channel, picks template, sends email, logs message.
// ---------------------------------------------------------------------------
export async function sendSequenceEmail(
  contactId: string,
  templateName: string,
  tenantId: string,
): Promise<{ success: boolean; mock?: boolean; reason?: string }> {
  // Get contact
  const contactRows = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, contactId))
    .limit(1);

  if (contactRows.length === 0) {
    console.warn(`[emailService] Contact not found: ${contactId}`);
    return { success: false, reason: 'contact not found' };
  }

  const contact = contactRows[0];

  // Get email channel
  const channelRows = await db
    .select()
    .from(contactChannels)
    .where(eq(contactChannels.contactId, contactId))
    .limit(20);

  const emailChannel = channelRows.find((c) => c.channelType === 'email');

  if (!emailChannel) {
    console.warn(`[emailService] No email channel for contact: ${contactId}`);
    return { success: false, reason: 'no email channel' };
  }

  const template = EMAIL_TEMPLATES[templateName];
  if (!template) {
    console.warn(`[emailService] Unknown template: ${templateName}`);
    return { success: false, reason: `unknown template: ${templateName}` };
  }

  const toName = [contact.firstName, contact.lastName].filter(Boolean).join(' ');
  const result = await sendTransactionalEmail(
    emailChannel.channelValue,
    toName,
    template.subject,
    template.html,
    template.text,
  );

  // Log message record
  await db.insert(messages).values({
    tenantId,
    contactId,
    channel: 'email',
    direction: 'outbound',
    templateName,
    content: template.subject,
    status: result.success ? 'sent' : 'failed',
    externalId: result.messageId,
  });

  return result;
}

// ---------------------------------------------------------------------------
// sendManualEmail
// Sends a one-off email (no template lookup) via Brevo transactional API.
// Used by POST /email/manual from the CRM admin panel.
// ---------------------------------------------------------------------------
export async function sendManualEmail(
  toEmail: string,
  toName: string,
  subject: string,
  body: string,
): Promise<{ success: boolean; mock?: boolean; messageId?: string }> {
  const html = body.replace(/\n/g, '<br>');
  return sendTransactionalEmail(toEmail, toName, subject, html, body);
}
