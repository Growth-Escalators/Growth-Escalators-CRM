import { Router, type Request, type Response } from 'express';
import { eq } from 'drizzle-orm';
import { db, contacts, contactChannels, events } from '../db/index';
import { findOrCreateContact, normalizeChannelValue } from '../services/contactService';
import { sendSlackMessage } from '../services/slackService';
import { getDefaultIngestTenant } from '../services/tenantFeatures';
import { SLACK_SALES_BD_CHANNEL } from '../config/constants';
import logger from '../utils/logger';
import { parsePhone } from '../services/phoneService';
import { assignLead } from '../services/leadAssignmentService';
import { enqueueAck } from '../services/whatsapp/leadAckService';
import { WA_CONSENT_TEXT_VERSION } from '../config/constants';
import {
  ensureContactInMasterSalesPipeline,
  scheduleMasterSalesBackfill,
} from '../services/masterSalesPipelineService';

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

/**
 * Absent must stay absent. `Number('')` and `Number(null)` are both 0, so a
 * missing figure would otherwise be stored as a real zero — and the CRM would
 * render "Revenue: 0" for a visitor who simply never entered one, which reads
 * as a fact rather than a gap.
 */
function cleanNumber(value: unknown, max = 1_000_000): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(cleanString(value, 20));
  if (!Number.isFinite(n) || n < 0 || n > max) return null;
  return n;
}

export interface GrowthToolContext {
  toolId: string;
  intentCluster: string;
  priority: 'P1' | 'P2' | '';
  headline: string;
  metrics: { label: string; value: string }[];
  recommendations: string[];
  sourceBlog: string;
  sourceBlogTitle: string;
  revenueLakh: number | null;
  adSpendLakh: number | null;
  targetRevenueLakh: number | null;
  score: number | null;
  stage: string;
}

/**
 * Growth Tool leads carry context the generic website form does not: which
 * calculator ran, what it concluded, the visitor's own revenue and ad-spend
 * figures, and the P1/P2 the website scored from them.
 *
 * The route read none of it. The most commercially useful thing a visitor
 * tells us — "₹25 lakh revenue, ₹3 lakh ad spend" — arrived on every request
 * and was dropped, while the CRM rendered an empty "Monthly revenue" field.
 *
 * Returns null for non-tool submissions. The same route serves the contact
 * form and the industry landing pages, and those send none of these keys, so
 * every field here is optional by construction.
 */
export function parseGrowthTool(body: Record<string, unknown> | undefined): GrowthToolContext | null {
  const toolId = cleanString(body?.toolId, 100);
  const rawPriority = cleanString(body?.leadPriority, 10).toUpperCase();
  const priority = rawPriority === 'P1' || rawPriority === 'P2' ? rawPriority : '';

  // Absent both, this is an ordinary website lead and must be left untouched.
  if (!toolId && !priority) return null;

  const q = (body?.qualification && typeof body.qualification === 'object'
    ? body.qualification
    : {}) as Record<string, unknown>;

  const metrics = Array.isArray(body?.toolMetrics)
    ? (body!.toolMetrics as unknown[]).slice(0, 8).map((item) => {
        const m = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return { label: cleanString(m.label, 120), value: cleanString(m.value, 160) };
      }).filter((m) => m.label && m.value)
    : [];

  const recommendations = Array.isArray(body?.toolRecommendations)
    ? (body!.toolRecommendations as unknown[]).slice(0, 6).map((r) => cleanString(r, 500)).filter(Boolean)
    : [];

  return {
    toolId,
    intentCluster: cleanString(body?.intentCluster, 120),
    priority,
    headline: cleanString(body?.toolHeadline, 500),
    metrics,
    recommendations,
    sourceBlog: cleanString(body?.sourceBlog, 180),
    sourceBlogTitle: cleanString(body?.sourceBlogTitle, 300),
    revenueLakh: cleanNumber(q.revenueLakh, 100_000),
    adSpendLakh: cleanNumber(q.adSpendLakh, 100_000),
    targetRevenueLakh: cleanNumber(q.targetRevenueLakh, 100_000),
    score: cleanNumber(q.score, 100),
    stage: cleanString(q.stage, 80),
  };
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

    // Every inbound sales lead should exist on the operating board. Pipeline
    // placement is best-effort and must never turn a valid enquiry into a 500.
    try {
      await ensureContactInMasterSalesPipeline({
        tenantId: tenant.id,
        contactId: contact.id,
        title: `${agencyName || name} — Agency partnership`,
        source: 'agency_landing',
        service: 'White-label / agency partnership',
        businessVertical: 'agency_owner',
      });
    } catch (error) {
      logger.error({ error }, '[leads/agency] master sales placement failed');
    }
    scheduleMasterSalesBackfill(tenant.id);

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
// Production fails closed unless WEBSITE_LEAD_INGEST_SECRET is configured.
// Callers must send the same value in x-ge-lead-secret.
// ---------------------------------------------------------------------------
router.post('/website', async (req: Request, res: Response): Promise<void> => {
  const configuredSecret = cleanString(process.env.WEBSITE_LEAD_INGEST_SECRET, 1000);
  if (process.env.NODE_ENV === 'production' && !configuredSecret) {
    res.status(503).json({ error: 'website lead intake is not configured' });
    return;
  }
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

    // --- WhatsApp acknowledgement inputs ---------------------------------
    // Region defaulting per the agreed rule: assume India ONLY when the form
    // is India-targeted. International forms carry a `market`, so for those we
    // pass no hint and a bare national number is rejected rather than guessed
    // into the wrong country.
    const market = cleanString(req.body?.market, 40);
    const regionHint = market ? undefined : 'IN';
    const parsedPhone = phone ? parsePhone(phone, regionHint) : null;
    const phoneE164 = parsedPhone && parsedPhone.ok ? parsedPhone.e164 : null;

    const whatsappConsent = cleanBoolean(req.body?.whatsappConsent);
    const consentTextVersion =
      cleanString(req.body?.whatsappConsentVersion, 60) || WA_CONSENT_TEXT_VERSION;
    const preferredCallTime = cleanString(req.body?.preferredCallTime, 120);

    const { bucket, assignedTo } = assignLead({
      service,
      source: cleanString(req.body?.source, 200),
      landingPage: cleanString(req.body?.landingPageRoute, 300),
      market: market || null,
      formType,
    });

    const firstLandingPage = cleanString(req.body?.firstLandingPage, 300);
    const firstReferrerUrl = cleanString(req.body?.firstReferrerUrl, 700);
    const firstTouchAt = cleanString(req.body?.firstTouchAt, 100) || capturedAt;
    const firstAttribution = {
      firstLandingPage,
      firstReferrerUrl,
      // Common aliases make UI/reporting simpler while preserving old keys.
      landingPage: firstLandingPage,
      referrerUrl: firstReferrerUrl,
      utmSource: cleanString(req.body?.utmSource, 200),
      utmMedium: cleanString(req.body?.utmMedium, 200),
      utmCampaign: cleanString(req.body?.utmCampaign, 250),
      utmTerm: cleanString(req.body?.utmTerm, 250),
      utmContent: cleanString(req.body?.utmContent, 250),
      capturedAt: firstTouchAt,
    };

    // New website builds send explicit last-touch values. The fallback keeps
    // older deployed clients compatible until every edge cache/browser updates.
    const lastLandingPage = cleanString(req.body?.lastLandingPage, 300)
      || cleanString(req.body?.landingPageRoute, 300)
      || firstLandingPage;
    const lastReferrerUrl = cleanString(req.body?.lastReferrerUrl, 700)
      || cleanString(req.body?.referrerUrl, 700)
      || firstReferrerUrl;
    const lastAttribution = {
      lastLandingPage,
      lastReferrerUrl,
      landingPage: lastLandingPage,
      referrerUrl: lastReferrerUrl,
      utmSource: cleanString(req.body?.lastUtmSource, 200) || firstAttribution.utmSource,
      utmMedium: cleanString(req.body?.lastUtmMedium, 200) || firstAttribution.utmMedium,
      utmCampaign: cleanString(req.body?.lastUtmCampaign, 250) || firstAttribution.utmCampaign,
      utmTerm: cleanString(req.body?.lastUtmTerm, 250) || firstAttribution.utmTerm,
      utmContent: cleanString(req.body?.lastUtmContent, 250) || firstAttribution.utmContent,
      capturedAt: cleanString(req.body?.lastTouchAt, 100) || capturedAt,
    };

    const conversionContext = {
      conversionPage: cleanString(req.body?.landingPageRoute, 300),
      referrerUrl: cleanString(req.body?.referrerUrl, 700),
      whatsappClicked: cleanBoolean(req.body?.whatsappClicked),
      whatsappClickSource: cleanString(req.body?.whatsappClickSource, 200),
      capturedAt,
    };

    const growthTool = parseGrowthTool(req.body);

    /**
     * Growth Tool forms ask only for an email, so `monthlyRevenue` always
     * arrives empty from them — but the visitor typed their revenue straight
     * into the calculator, and it reaches us as `qualification.revenueLakh`.
     * Deriving the display string here fills the CRM's existing revenue field
     * with no UI change, and only ever when the form itself sent nothing.
     */
    const monthlyRevenue = cleanString(req.body?.monthlyRevenue, 100)
      || (growthTool?.revenueLakh ? `₹${growthTool.revenueLakh}L` : '');

    const leadSummary = {
      formType,
      businessVertical,
      service,
      company,
      website: cleanString(req.body?.website, 500),
      industry: cleanString(req.body?.industry, 200),
      monthlyRevenue,
      budget: cleanString(req.body?.budget, 100),
      city: cleanString(req.body?.city, 150),
      specialization: cleanString(req.body?.specialization, 200),
      role: cleanString(req.body?.role, 250),
      seats: cleanString(req.body?.seats, 100),
      timeline: cleanString(req.body?.timeline, 150),
      message: cleanString(req.body?.message, 4000),
      sourceLabel: cleanString(req.body?.source, 200),
      preferredCallTime,
      market,
      assignedBucket: bucket,
      conversionPage: conversionContext.conversionPage,
      capturedAt,
      ...(growthTool ? { growthTool } : {}),
    };

    const channels: { channelType: 'email' | 'whatsapp'; channelValue: string; isPrimary?: boolean }[] = [
      { channelType: 'email', channelValue: email, isPrimary: true },
    ];
    if (phone) channels.push({ channelType: 'whatsapp', channelValue: phone });

    /**
     * Growth Tool forms ask for an email and nothing else, so every one of
     * them posts the same literal placeholder name. Left alone, the contacts
     * list fills with identical "Growth tool user" rows that cannot be told
     * apart at a glance.
     *
     * The email is used as the display name instead. Deriving a first name
     * from the local part was the alternative and was rejected: "priya@" is
     * not evidence that anyone is called Priya, and a CRM should not invent a
     * person's name. An address is honest, unique and searchable.
     */
    const displayName = /^growth tool user$/i.test(name) && email ? email : name;
    const parts = displayName.split(/\s+/);
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
        firstWebsiteAttribution: firstAttribution,
        lastWebsiteAttribution: lastAttribution,
        latestWebsiteConversion: conversionContext,
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

    /**
     * Priority rides in as a tag rather than a column. The contacts list
     * already filters on tags, so "show me every P1" works the moment this
     * deploys, with no migration against production Postgres.
     *
     * A lead can only ever hold one priority tag: a visitor who returns and
     * scores P1 on a second tool must not keep a stale p2 alongside it.
     */
    const priorityTag = growthTool?.priority ? growthTool.priority.toLowerCase() : '';
    const tagsWithoutPriority = priorityTag
      ? existingTags.filter((t) => t !== 'p1' && t !== 'p2')
      : existingTags;
    const newTags = [...new Set([
      ...tagsWithoutPriority,
      'website_lead',
      ...(verticalTag ? [verticalTag] : []),
      ...(priorityTag ? [priorityTag, 'growth_tool_lead'] : []),
    ])];
    const priorCount = Number(existingMetadata.websiteLeadCount || 0);
    const now = new Date();

    await db.update(contacts).set({
      companyName: company || current?.companyName || undefined,
      businessType: businessVertical !== 'general'
        ? businessVertical
        : current?.businessType || undefined,
      tags: newTags,
      metadata: {
        ...existingMetadata,
        firstWebsiteAttribution: existingMetadata.firstWebsiteAttribution || firstAttribution,
        lastWebsiteAttribution: lastAttribution,
        latestWebsiteConversion: conversionContext,
        latestWebsiteLead: leadSummary,
        websiteLeadCount: created ? Math.max(priorCount, 1) : priorCount + 1,
      },
      assignedTo: assignedTo ?? current?.assignedTo ?? undefined,
      ...(whatsappConsent && !current?.doNotContact
        ? {
            optedInWa: true,
            waConsentAt: now,
            waConsentTextVersion: consentTextVersion,
            waConsentSource: cleanString(req.body?.source, 200) || 'website',
          }
        : {}),
      lastActivityAt: now,
      updatedAt: now,
    }).where(eq(contacts.id, contact.id));

    // Keep the sales operating board complete. This internal DB placement is
    // intentionally non-fatal: the CRM contact remains the canonical lead even
    // if the pipeline table is temporarily unavailable.
    try {
      await ensureContactInMasterSalesPipeline({
        tenantId: tenant.id,
        contactId: contact.id,
        title: `${company || name} — ${service || businessVertical || 'Website enquiry'}`,
        assignedTo,
        service: service || null,
        businessVertical,
        source: 'website',
      });
    } catch (error) {
      logger.error({ error }, '[leads/website] master sales placement failed');
    }
    scheduleMasterSalesBackfill(tenant.id);

    // One event per successful website form submit: enough to preserve repeat
    // conversions without recording every page view or click in the CRM.
    const [submissionEvent] = await db.insert(events).values({
      tenantId: tenant.id,
      contactId: contact.id,
      eventType: 'website_lead_submitted',
      channel: 'website',
      direction: 'inbound',
      payload: {
        formType,
        businessVertical,
        service,
        firstAttribution,
        lastAttribution,
        conversionContext,
        whatsappConsent,
        consentTextVersion: whatsappConsent ? consentTextVersion : null,
        preferredCallTime,
        assignedBucket: bucket,
        /**
         * Also recorded on the event, not only on the contact. The contact
         * carries `latestWebsiteLead`, which each new submission overwrites —
         * a visitor who runs three tools would leave only the last one behind.
         * Per-tool and per-article reporting has to count submissions, so it
         * reads these rows rather than the contact.
         */
        ...(growthTool ? { growthTool } : {}),
      },
      occurredAt: now,
    }).returning();

    // Respond BEFORE any outbound integration. Nothing below can delay or
    // fail the visitor submission.
    res.json({ ok: true, contactId: contact.id, created });

    // Queue the WhatsApp acknowledgement. Fire-and-forget and internally
    // guarded: enqueueAck never throws, and the policy gate in the worker
    // decides whether anything is actually sent.
    if (submissionEvent) {
      void enqueueAck({
        eventId: submissionEvent.id,
        tenantId: tenant.id,
        contactId: contact.id,
        firstName: parts[0] ?? name,
        service: service || businessVertical || 'your enquiry',
        assignedTo,
        phoneSubmitted: phone,
        phoneE164,
        regionHint,
        consentGiven: whatsappConsent,
      }).catch(() => {});
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err: msg }, '[leads/website] failed');
    if (!res.headersSent) {
      res.status(500).json({ error: 'website lead intake failed' });
    }
  }
});

export default router;
