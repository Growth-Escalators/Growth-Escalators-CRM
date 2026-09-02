import { pool } from '../db';
import logger from '../utils/logger';
import { sendCapiEvent } from './metaCapi';

type SupportedOutcomeStage = 'interested' | 'closed-won';

interface OutcomeFeedbackInput {
  tenantId: string;
  dealId: string;
  contactId: string;
  stage: string;
  dealValue?: number | null;
}

interface AttributionContext {
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  referrerUrl?: string;
  firstReferrerUrl?: string;
  landingPage?: string;
  firstLandingPage?: string;
  capturedAt?: string;
  fbclid?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function attribution(value: unknown): AttributionContext {
  return record(value) as AttributionContext;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isMetaAttribution(first: AttributionContext, last: AttributionContext): boolean {
  const haystack = [
    first.utmSource,
    last.utmSource,
    first.referrerUrl,
    first.firstReferrerUrl,
    last.referrerUrl,
    last.firstReferrerUrl,
    first.fbclid,
    last.fbclid,
  ].filter(Boolean).join(' ').toLowerCase();

  return Boolean(first.fbclid || last.fbclid || /(^|[^a-z])(facebook|instagram|meta|fb)([^a-z]|$)/i.test(haystack));
}

function fbcFromAttribution(first: AttributionContext, last: AttributionContext): string | undefined {
  const chosen = last.fbclid ? last : first.fbclid ? first : null;
  if (!chosen?.fbclid) return undefined;
  const capturedMs = chosen.capturedAt ? Date.parse(chosen.capturedAt) : NaN;
  const timestamp = Number.isFinite(capturedMs) ? Math.floor(capturedMs / 1000) : Math.floor(Date.now() / 1000);
  return `fb.1.${timestamp}.${chosen.fbclid}`;
}

function sourceUrl(metadata: Record<string, unknown>, first: AttributionContext, last: AttributionContext): string {
  const conversion = record(metadata.latestWebsiteConversion);
  const path = text(conversion.conversionPage)
    || text(last.landingPage)
    || text(last.firstLandingPage)
    || text(first.landingPage)
    || text(first.firstLandingPage)
    || '/';
  if (/^https?:\/\//i.test(path)) return path;
  return `https://www.growthescalators.com${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Sends quality/revenue outcomes back to Meta only for Meta-attributed website
 * leads on the canonical Master Sales Pipeline. This is intentionally
 * best-effort: a CRM stage change is the source of truth and must never fail
 * because Meta is unavailable or unconfigured.
 *
 * Stable event IDs mean moving a deal away from and back into an outcome stage
 * cannot double-count the same QualifiedLead / ClosedWon conversion in Meta.
 */
export async function sendSalesOutcomeFeedback(input: OutcomeFeedbackInput): Promise<void> {
  const stage = input.stage.toLowerCase() as SupportedOutcomeStage;
  if (stage !== 'interested' && stage !== 'closed-won') return;

  try {
    const result = await pool.query<{
      first_name: string | null;
      last_name: string | null;
      city: string | null;
      source: string | null;
      metadata: Record<string, unknown> | null;
      email: string | null;
      phone: string | null;
      deal_value: number | string | null;
    }>(`
      SELECT
        c.first_name,
        c.last_name,
        c.city,
        c.source,
        c.metadata,
        d.deal_value,
        MAX(cc.channel_value) FILTER (WHERE cc.channel_type = 'email') AS email,
        MAX(cc.channel_value) FILTER (WHERE cc.channel_type IN ('phone', 'whatsapp')) AS phone
      FROM deals d
      JOIN pipelines p
        ON p.id = d.pipeline_id
       AND p.tenant_id = d.tenant_id
       AND p.slug = 'master-sales'
      JOIN contacts c
        ON c.id = d.contact_id
       AND c.tenant_id = d.tenant_id
      LEFT JOIN contact_channels cc
        ON cc.contact_id = c.id
       AND cc.tenant_id = c.tenant_id
      WHERE d.id = $1
        AND d.tenant_id = $2
        AND c.id = $3
      GROUP BY c.id, c.first_name, c.last_name, c.city, c.source, c.metadata, d.deal_value
      LIMIT 1
    `, [input.dealId, input.tenantId, input.contactId]);

    const contact = result.rows[0];
    if (!contact) return;

    const metadata = record(contact.metadata);
    const first = attribution(metadata.firstWebsiteAttribution);
    const last = attribution(metadata.lastWebsiteAttribution);
    const isWebsiteLead = contact.source === 'website' || Boolean(metadata.firstWebsiteAttribution);
    if (!isWebsiteLead || !isMetaAttribution(first, last)) return;

    const eventName = stage === 'interested' ? 'QualifiedLead' : 'ClosedWon';
    const eventId = `crm_${eventName.toLowerCase()}_${input.tenantId}_${input.dealId}`;
    const canonicalDealValue = Number(contact.deal_value ?? input.dealValue ?? 0);
    const eventValue = stage === 'closed-won' && canonicalDealValue > 0
      ? canonicalDealValue
      : undefined;

    const sent = await sendCapiEvent({
      eventName,
      eventId,
      actionSource: 'system_generated',
      eventSourceUrl: sourceUrl(metadata, first, last),
      customer: {
        contactId: input.contactId,
        email: contact.email || undefined,
        phone: contact.phone || undefined,
        firstName: contact.first_name || undefined,
        lastName: contact.last_name || undefined,
        city: contact.city || undefined,
        country: 'in',
        fbc: fbcFromAttribution(first, last),
      },
      value: eventValue,
      currency: eventValue !== undefined ? 'INR' : undefined,
      contentName: stage === 'interested' ? 'Qualified Growth Escalators Lead' : 'Growth Escalators Closed Won',
      contentCategory: 'crm_outcome',
      customData: {
        crm_stage: stage,
        first_utm_source: text(first.utmSource) || undefined,
        last_utm_source: text(last.utmSource) || undefined,
        first_utm_campaign: text(first.utmCampaign) || undefined,
        last_utm_campaign: text(last.utmCampaign) || undefined,
      },
    });

    if (!sent.success) {
      logger.warn({ dealId: input.dealId, eventName, error: sent.error }, '[sales-outcome-feedback] Meta CAPI not sent');
    }
  } catch (error) {
    logger.warn({ error, dealId: input.dealId, stage }, '[sales-outcome-feedback] ignored Meta feedback failure');
  }
}
