import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, contacts, tenants } from '../db/index';
import { findOrCreateContact } from '../services/contactService';
import { sendSlackMessage } from '../services/slackService';
import { DEFAULT_TENANT_SLUG } from '../config/constants';
import logger from '../utils/logger';

const router = Router();

// ---------------------------------------------------------------------------
// POST /api/leads/agency — public agency-partnership lead capture.
// Used by the white-label landing page form (client/src/pages/AgencyPage.jsx).
// ---------------------------------------------------------------------------
router.post('/agency', async (req: Request, res: Response): Promise<void> => {
  const { name, agencyName, email, phone, adSpend } = req.body as {
    name?: string;
    agencyName?: string;
    email?: string;
    phone?: string;
    adSpend?: string;
  };

  if (!name || !email || !phone) {
    res.status(400).json({ error: 'name, email and phone are required' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email).trim())) {
    res.status(400).json({ error: 'valid email required' });
    return;
  }

  try {
    const [tenant] = await db
      .select({ id: tenants.id })
      .from(tenants)
      .where(eq(tenants.slug, DEFAULT_TENANT_SLUG))
      .limit(1);
    if (!tenant) {
      res.status(500).json({ error: 'tenant not configured' });
      return;
    }

    const cleanPhone = String(phone).replace(/\D/g, '');
    const channels: { channelType: 'email' | 'whatsapp'; channelValue: string; isPrimary?: boolean }[] = [];
    channels.push({ channelType: 'email', channelValue: String(email).trim().toLowerCase(), isPrimary: true });
    if (cleanPhone) channels.push({ channelType: 'whatsapp', channelValue: cleanPhone.startsWith('91') ? cleanPhone : `91${cleanPhone}` });

    const parts = String(name).trim().split(/\s+/);
    const { contact, created } = await findOrCreateContact(tenant.id, {
      firstName: parts[0] ?? String(name),
      lastName: parts.slice(1).join(' ') || undefined,
      source: 'agency_landing',
      sourceDetail: agencyName ? `agency:${agencyName}` : undefined,
      channels,
      metadata: { agencyName, adSpend, capturedAt: new Date().toISOString() },
    });

    // Tag the contact so it's visible in CRM filters
    const existing = await db.select().from(contacts).where(eq(contacts.id, contact.id)).limit(1);
    const existingTags = (existing[0]?.tags ?? []) as string[];
    const newTags = [...new Set([...existingTags, 'agency_lead', 'whitelabel_inquiry'])];
    const now = new Date();
    await db.update(contacts).set({
      status: 'lead',
      tags: newTags,
      updatedAt: now,
      lastActivityAt: now,
    }).where(eq(contacts.id, contact.id));

    // Slack ping (fire-and-forget — never block the response)
    const slackChannel = process.env.SLACK_SOD_EOD_CHANNEL || 'C08EMRX2HHN';
    sendSlackMessage(slackChannel,
      `🤝 *New Agency Lead*\n` +
      `• Name: ${name}\n` +
      `• Agency: ${agencyName || 'N/A'}\n` +
      `• Email: ${email}\n` +
      `• Phone: ${phone}\n` +
      `• Monthly ad-spend managed: ${adSpend || 'N/A'}\n` +
      `• Status: ${created ? 'NEW contact' : 'EXISTING contact'}`,
    ).catch(() => {});

    res.json({ ok: true, contactId: contact.id, created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[leads/agency] failed');
    res.status(500).json({ error: msg });
  }
});

export default router;
