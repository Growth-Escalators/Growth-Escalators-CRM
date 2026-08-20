import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, contacts, contactChannels, events } from '../db/index';
import { findOrCreateContact, normalizeChannelValue } from '../services/contactService';
import { sendSlackMessage } from '../services/slackService';
import { getDefaultIngestTenant } from '../services/tenantFeatures';
import { SLACK_SALES_BD_CHANNEL } from '../config/constants';
import logger from '../utils/logger';

const router = Router();

function cleanString(value: unknown, max = 500): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function cleanBoolean(value: unknown): boolean {
  return value === true || value === 'true' || value === '1' || value === 1;
}

function slugTag(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
}

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
    // Pinned to GE's own tenant (PR: fix lead-theft-by-slug-order) — this
    // route receives leads arriving from GE's OWN white-label landing page,
    // so the destination tenant is GE, full stop. It must NOT be resolved by
    // scanning every active tenant for "crmAutomation" — a reseller_pilot
    // tenant also has that flag on, and if its slug sorted before
    // growth-escalators, GE's own inbound leads would silently route to the
    // reseller instead (see tenantFeatures.ts getSingleActiveTenantWithFeature's
    // docstring for the bug this replaced).
    const tenant = await getDefaultIngestTenant('crmAutomation');
    if (!tenant) {
      res.status(503).json({ error: 'agency lead intake is not enabled for any tenant' });
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

    // Slack ping (fire-and-forget — never block the response). Routed to
    // #sales-bd so the BD team owns follow-up.
    const slackChannel = process.env.SLACK_SALES_BD_CHANNEL || SLACK_SALES_BD_CHANNEL;
    sendSlackMessage(slackChannel,
      `🤝 *New Agency Lead*\n` +
      `• Name: ${name}\n` +
      `• Agency: ${agencyName || 'N/A'}\n` +
      `• Email: ${email}\n` +
      `• Phone: ${phone}\n` +
      `• Monthly ad-spend managed: ${adSpend || 'N/A'}\n` +
      `• Status: ${created ? 'NEW contact' : 'EXISTING contact'}`,
      undefined,
      { allowDuringPause: true }, // new client lead — fires even while routine Slack is paused
    ).catch(() => {});

    res.json({ ok: true, contactId: contact.id, created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[leads/agency] failed');
    res.status(500).json({ error: msg });
  }
});

// ---------------------------------------------------------------------------
// POST /api/leads/website — Growth Escalators website lead capture.
//
// This is intentionally a single, small server-to-server intake for every
// website form. The browser never needs a CRM JWT. The website API retains its
// own email/log fallback; this route only makes the CRM the canonical lead
// record and stores the minimal attribution envelope agreed for reporting.
//
// If WEBSITE_LEAD_INGEST_SECRET is configured, callers must send the same
// value in x-ge-lead-secret. Keeping the check optional allows a zero-downtime
// rollout before both services have the secret configured.
// ---------------------------------------------------------------------------
router.post('/website', async (req: Request, res: Response): Promise<void> => {
  const configuredSecret = cleanString(process.env.WEBSITE_LEAD_INGEST_SECRET, 1000);
  if (configuredSecret && req.get('x-ge-lead-secret') !== configuredSecret) {
    res.status(401).json({ error: 'invalid website lead secret' });
    return;
  }

  const name = cleanString(req.body?.name, 200);
  const email = cleanString(req.body?.email, 200).toLowerCase();
  const phone = cleanString(req.body?.phone, 50);

  if (!name || !email) {
    res.status(400).json({ error: 'name and email are required' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.status(400).json({ error: 'valid email required' });
    return;
  }

  try {
    const tenant = await getDefaultIngestTenant('crmAutomation');
    if (!tenant) {
      res.status(503).json({ error: 'website lead intake is not enabled for any tenant' });
      return;
    }

    const company = cleanString(req.body?.company || req.body?.business || req.body?.clinic, 250);
    const businessVertical = cleanString(req.body?.businessVertical || req.body?.businessType, 100) || 'general';
    const formType = cleanString(req.body?.formType, 100) || 'website';
    const service = cleanString(req.body?.service, 200);
    const capturedAt = cleanString(req.body?.receivedAt, 100) || new Date().toISOString();

    const attribution = {
      firstLandingPage: cleanString(req.body?.firstLandingPage, 300),
      conversionPage: cleanString(req.body?.landingPageRoute, 300),
      firstReferrerUrl: cleanString(req.body?.firstReferrerUrl, 700),
      referrerUrl: cleanString(req.body?.referrerUrl, 700),
      utmSource: cleanString(req.body?.utmSource, 200),
      utmMedium: cleanString(req.body?.utmMedium, 200),
      utmCampaign: cleanString(req.body?.utmCampaign, 250),
      utmTerm: cleanString(req.body?.utmTerm, 250),
      utmContent: cleanString(req.body?.utmContent, 250),
      whatsappClicked: cleanBoolean(req.body?.whatsappClicked),
      whatsappClickSource: cleanString(req.body?.whatsappClickSource, 200),
      capturedAt,
    };

    const leadSummary = {
      formType,
      businessVertical,
      service,
      company,
      website: cleanString(req.body?.website, 500),
      industry: cleanString(req.body?.industry, 200),
      monthlyRevenue: cleanString(req.body?.monthlyRevenue, 100),
      budget: cleanString(req.body?.budget, 100),
      city: cleanString(req.body?.city, 150),
      specialization: cleanString(req.body?.specialization, 200),
      role: cleanString(req.body?.role, 250),
      seats: cleanString(req.body?.seats, 100),
      timeline: cleanString(req.body?.timeline, 150),
      message: cleanString(req.body?.message, 4000),
      sourceLabel: cleanString(req.body?.source, 200),
      capturedAt,
    };

    const channels: { channelType: 'email' | 'whatsapp'; channelValue: string; isPrimary?: boolean }[] = [
      { channelType: 'email', channelValue: email, isPrimary: true },
    ];
    if (phone) channels.push({ channelType: 'whatsapp', channelValue: phone });

    const parts = name.split(/\s+/);
    const sourceDetailParts = [businessVertical, service].filter(Boolean).map(slugTag).filter(Boolean);
    const { contact, channels: existingChannels, created } = await findOrCreateContact(tenant.id, {
      firstName: parts[0] ?? name,
      lastName: parts.slice(1).join(' ') || undefined,
      source: 'website',
      sourceDetail: sourceDetailParts.join(':') || 'website_form',
      companyName: company || undefined,
      businessType: businessVertical,
      tags: ['website_lead', ...(businessVertical !== 'general' ? [slugTag(businessVertical)] : [])],
      channels,
      metadata: {
        firstWebsiteAttribution: attribution,
        lastWebsiteAttribution: attribution,
        latestWebsiteLead: leadSummary,
        websiteLeadCount: 1,
      },
    });

    // If we matched an existing contact by email, make sure a newly supplied
    // phone/WhatsApp number is not discarded merely because the contact was
    // already known to the CRM.
    for (const incoming of channels) {
      const normalized = normalizeChannelValue(incoming.channelType, incoming.channelValue);
      if (!normalized) continue;
      const alreadyPresent = existingChannels.some((channel) =>
        channel.channelType === incoming.channelType && channel.channelValue === normalized,
      );
      if (!alreadyPresent) {
        await db.insert(contactChannels).values({
          tenantId: tenant.id,
          contactId: contact.id,
          channelType: incoming.channelType,
          channelValue: normalized,
          isPrimary: incoming.isPrimary ?? false,
        }).onConflictDoNothing();
      }
    }

    const [current] = await db.select().from(contacts).where(eq(contacts.id, contact.id)).limit(1);
    const existingMetadata = (current?.metadata && typeof current.metadata === 'object' ? current.metadata : {}) as Record<string, unknown>;
    const existingTags = (current?.tags ?? []) as string[];
    const verticalTag = businessVertical !== 'general' ? slugTag(businessVertical) : '';
    const newTags = [...new Set([...existingTags, 'website_lead', ...(verticalTag ? [verticalTag] : [])])];
    const priorCount = Number(existingMetadata.websiteLeadCount || 0);
    const now = new Date();

    await db.update(contacts).set({
      companyName: company || current?.companyName || undefined,
      businessType: businessVertical || current?.businessType || undefined,
      tags: newTags,
      metadata: {
        ...existingMetadata,
        firstWebsiteAttribution: existingMetadata.firstWebsiteAttribution || attribution,
        lastWebsiteAttribution: attribution,
        latestWebsiteLead: leadSummary,
        websiteLeadCount: created ? Math.max(priorCount, 1) : priorCount + 1,
      },
      lastActivityAt: now,
      updatedAt: now,
    }).where(eq(contacts.id, contact.id));

    // One event per successful website form submit: enough to preserve repeat
    // conversions without recording every page view or click in the CRM.
    await db.insert(events).values({
      tenantId: tenant.id,
      contactId: contact.id,
      eventType: 'website_lead_submitted',
      channel: 'website',
      direction: 'inbound',
      payload: {
        formType,
        businessVertical,
        service,
        attribution,
      },
      occurredAt: now,
    });

    res.json({ ok: true, contactId: contact.id, created });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[leads/website] failed');
    res.status(500).json({ error: 'website lead intake failed' });
  }
});

export default router;
