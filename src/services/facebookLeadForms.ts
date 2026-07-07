import crypto from 'crypto';
import { and, eq } from 'drizzle-orm';
import { db, contacts, socialAccounts, tenants } from '../db/index';
import { findOrCreateContact, normalizeChannelValue } from './contactService';
import { sendSlackMessage } from './slackService';
import { DEFAULT_TENANT_SLUG, META_API_BASE, SLACK_SALES_BD_CHANNEL, WIZMATCH_LEADS_CHANNEL, WIZMATCH_TENANT_ID } from '../config/constants';
import logger from '../utils/logger';

type SocialAccount = typeof socialAccounts.$inferSelect;
type Contact = typeof contacts.$inferSelect;

export interface FacebookLeadgenChange {
  pageId: string;
  leadgenId: string;
  formId?: string;
  adId?: string;
  adgroupId?: string;
  createdTime?: number;
}

export interface FacebookLeadDetails {
  id: string;
  created_time?: string;
  ad_id?: string;
  ad_name?: string;
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  form_id?: string;
  platform?: string;
  is_organic?: boolean;
  field_data?: Array<{ name: string; values?: string[] }>;
}

export interface MappedFacebookLead {
  firstName: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  customFields: Record<string, string>;
}

interface ContactSnapshot {
  tags: string[];
  metadata: Record<string, unknown>;
}

export interface FacebookLeadProcessDeps {
  resolvePreferredTenantId?(change: FacebookLeadgenChange): Promise<string | null>;
  getPageAccountByPageId(pageId: string, preferredTenantId?: string | null): Promise<Pick<SocialAccount, 'id' | 'tenantId' | 'accountId' | 'accountName' | 'accessToken'> | null>;
  fetchLeadDetails(leadgenId: string, accessToken: string): Promise<FacebookLeadDetails>;
  findOrCreate: typeof findOrCreateContact;
  getContactSnapshot(contactId: string): Promise<ContactSnapshot>;
  updateContactAfterLead(contactId: string, updates: { tags: string[]; metadata: Record<string, unknown>; lastActivityAt: Date; updatedAt: Date; status: string }): Promise<void>;
  sendSlack(channel: string, text: string): Promise<boolean>;
}

export interface FacebookLeadProcessResult {
  leadgenId: string;
  contactId: string;
  created: boolean;
  pageId: string;
  pageName: string;
  slackSent: boolean;
}

export function verifyMetaLeadSignature(rawBody: string, signature: string | undefined, appSecret: string | undefined): boolean {
  if (!appSecret) {
    logger.warn('[facebook-leads] META_APP_SECRET not set - skipping signature check');
    return true;
  }
  if (!signature || !signature.startsWith('sha256=')) return false;
  const expected = 'sha256=' + crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  try {
    const actualBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    return actualBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(actualBuffer, expectedBuffer);
  } catch {
    return false;
  }
}

export function extractFacebookLeadgenChanges(payload: unknown): FacebookLeadgenChange[] {
  const body = payload as {
    object?: string;
    entry?: Array<{
      id?: string;
      changes?: Array<{
        field?: string;
        value?: {
          page_id?: string;
          leadgen_id?: string;
          form_id?: string;
          ad_id?: string;
          adgroup_id?: string;
          created_time?: number;
        };
      }>;
    }>;
  };

  if (body?.object !== 'page' || !Array.isArray(body.entry)) return [];

  const changes: FacebookLeadgenChange[] = [];
  for (const entry of body.entry) {
    for (const change of entry.changes ?? []) {
      if (change.field !== 'leadgen') continue;
      const value = change.value;
      const leadgenId = value?.leadgen_id;
      const pageId = value?.page_id ?? entry.id;
      if (!leadgenId || !pageId) continue;
      changes.push({
        pageId,
        leadgenId,
        formId: value?.form_id,
        adId: value?.ad_id,
        adgroupId: value?.adgroup_id,
        createdTime: value?.created_time,
      });
    }
  }
  return changes;
}

function firstValue(values?: string[]): string | undefined {
  const value = values?.find((v) => String(v).trim().length > 0);
  return value ? String(value).trim() : undefined;
}

function splitName(fullName: string | undefined, fallback: string): { firstName: string; lastName?: string } {
  const clean = (fullName ?? '').trim();
  if (!clean) return { firstName: fallback };
  const parts = clean.split(/\s+/);
  return {
    firstName: parts[0] || fallback,
    lastName: parts.slice(1).join(' ') || undefined,
  };
}

function normalizeFieldName(name: string): string {
  return name.trim().toLowerCase().replace(/[\s-]+/g, '_');
}

export function mapFacebookLeadFields(lead: FacebookLeadDetails): MappedFacebookLead {
  const customFields: Record<string, string> = {};
  const known: Record<string, string | undefined> = {};

  for (const field of lead.field_data ?? []) {
    const key = normalizeFieldName(field.name);
    const value = firstValue(field.values);
    if (!value) continue;

    if (['full_name', 'name'].includes(key)) known.fullName = value;
    else if (key === 'first_name') known.firstName = value;
    else if (key === 'last_name') known.lastName = value;
    else if (key === 'email') known.email = normalizeChannelValue('email', value);
    else if (['phone', 'phone_number', 'mobile', 'mobile_number'].includes(key)) known.phone = normalizeChannelValue('phone', value);
    else if (['company', 'company_name', 'business_name', 'agency_name'].includes(key)) known.companyName = value;
    else customFields[key] = value;
  }

  const fallback = known.email?.split('@')[0] || known.phone || 'Facebook Lead';
  const split = splitName(known.fullName, fallback);
  return {
    firstName: known.firstName || split.firstName,
    lastName: known.lastName || split.lastName,
    fullName: known.fullName,
    email: known.email,
    phone: known.phone,
    companyName: known.companyName,
    customFields,
  };
}

function getEncKey(): string {
  const key = process.env.SOCIAL_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!key) throw new Error('SOCIAL_ENCRYPTION_KEY or JWT_SECRET must be set');
  return key;
}

function csvSet(value: string | undefined): Set<string> {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );
}

function parseTenantMap(raw: string | undefined): Record<string, string> {
  const text = String(raw || '').trim();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text) as Record<string, string>;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch {
    // Fall through to compact CSV syntax: "formId:wizmatch,pageId:growth-escalators".
  }
  return text.split(',').reduce<Record<string, string>>((acc, pair) => {
    const [key, value] = pair.split(':').map((part) => part?.trim()).filter(Boolean);
    if (key && value) acc[key] = value;
    return acc;
  }, {});
}

function tenantRefFromLeadFormConfig(change: FacebookLeadgenChange): string | null {
  const formMap = parseTenantMap(process.env.FACEBOOK_LEAD_FORM_TENANT_MAP);
  const pageMap = parseTenantMap(process.env.FACEBOOK_PAGE_TENANT_MAP);
  if (change.formId && formMap[change.formId]) return formMap[change.formId];
  if (pageMap[change.pageId]) return pageMap[change.pageId];

  const wizmatchForms = csvSet(process.env.WIZMATCH_FACEBOOK_LEAD_FORM_IDS);
  const growthForms = csvSet(process.env.GROWTH_FACEBOOK_LEAD_FORM_IDS || process.env.GE_FACEBOOK_LEAD_FORM_IDS);
  const wizmatchPages = csvSet(process.env.WIZMATCH_FACEBOOK_PAGE_IDS);
  const growthPages = csvSet(process.env.GROWTH_FACEBOOK_PAGE_IDS || process.env.GE_FACEBOOK_PAGE_IDS);

  if (change.formId && wizmatchForms.has(change.formId)) return 'wizmatch';
  if (change.formId && growthForms.has(change.formId)) return DEFAULT_TENANT_SLUG;
  if (wizmatchPages.has(change.pageId)) return 'wizmatch';
  if (growthPages.has(change.pageId)) return DEFAULT_TENANT_SLUG;
  return null;
}

async function tenantIdFromRef(ref: string): Promise<string | null> {
  const clean = ref.trim();
  if (!clean) return null;
  if (clean === 'wizmatch' && WIZMATCH_TENANT_ID) return WIZMATCH_TENANT_ID;

  const [tenant] = await db
    .select({ id: tenants.id })
    .from(tenants)
    .where(eq(tenants.slug, clean))
    .limit(1);
  if (tenant?.id) return tenant.id;

  // Allow advanced config to pass a tenant UUID directly.
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(clean)) {
    return clean;
  }
  return null;
}

async function defaultResolvePreferredTenantId(change: FacebookLeadgenChange): Promise<string | null> {
  const ref = tenantRefFromLeadFormConfig(change);
  return ref ? tenantIdFromRef(ref) : null;
}

export function decryptSocialAccessToken(encoded: string): string {
  try {
    const [ivHex, encHex] = encoded.split(':');
    const key = crypto.scryptSync(getEncKey(), 'salt', 32);
    const iv = Buffer.from(ivHex, 'hex');
    const encrypted = Buffer.from(encHex, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return '';
  }
}

async function defaultFetchLeadDetails(leadgenId: string, accessToken: string): Promise<FacebookLeadDetails> {
  const fields = [
    'id',
    'created_time',
    'ad_id',
    'ad_name',
    'adset_id',
    'adset_name',
    'campaign_id',
    'campaign_name',
    'form_id',
    'field_data',
    'platform',
    'is_organic',
  ].join(',');
  const url = `${META_API_BASE}/${encodeURIComponent(leadgenId)}?fields=${fields}&access_token=${encodeURIComponent(accessToken)}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10000) });
  const data = await response.json() as FacebookLeadDetails & { error?: { message?: string } };
  if (!response.ok || data.error) {
    throw new Error(data.error?.message || `Meta lead fetch failed with ${response.status}`);
  }
  return data;
}

const defaultDeps: FacebookLeadProcessDeps = {
  resolvePreferredTenantId: defaultResolvePreferredTenantId,
  async getPageAccountByPageId(pageId, preferredTenantId) {
    const filters = [
      eq(socialAccounts.platform, 'facebook'),
      eq(socialAccounts.accountId, pageId),
      eq(socialAccounts.isActive, true),
    ];
    if (preferredTenantId) filters.push(eq(socialAccounts.tenantId, preferredTenantId));

    const rows = await db
      .select()
      .from(socialAccounts)
      .where(and(...filters))
      .limit(1);
    return rows[0] ?? null;
  },
  fetchLeadDetails: defaultFetchLeadDetails,
  findOrCreate: findOrCreateContact,
  async getContactSnapshot(contactId) {
    const rows = await db.select().from(contacts).where(eq(contacts.id, contactId)).limit(1);
    const contact = rows[0] as Contact | undefined;
    return {
      tags: (contact?.tags ?? []) as string[],
      metadata: (contact?.metadata && typeof contact.metadata === 'object' ? contact.metadata : {}) as Record<string, unknown>,
    };
  },
  async updateContactAfterLead(contactId, updates) {
    await db.update(contacts).set(updates).where(eq(contacts.id, contactId));
  },
  sendSlack: sendSlackMessage,
};

export function buildFacebookLeadSlackMessage(input: {
  mapped: MappedFacebookLead;
  lead: FacebookLeadDetails;
  change: FacebookLeadgenChange;
  pageName: string;
  created: boolean;
}): string {
  const { mapped, lead, change, pageName, created } = input;
  const lines = [
    '*New Facebook Lead Form Lead*',
    `- Name: ${mapped.fullName || [mapped.firstName, mapped.lastName].filter(Boolean).join(' ') || 'N/A'}`,
    `- Email: ${mapped.email || 'N/A'}`,
    `- Phone: ${mapped.phone || 'N/A'}`,
    `- Company: ${mapped.companyName || 'N/A'}`,
    `- Page: ${pageName} (${change.pageId})`,
    `- Form: ${lead.form_id || change.formId || 'N/A'}`,
    `- Campaign: ${lead.campaign_name || lead.campaign_id || 'N/A'}`,
    `- Ad: ${lead.ad_name || lead.ad_id || change.adId || 'N/A'}`,
    `- CRM: ${created ? 'NEW contact' : 'EXISTING contact'}`,
  ];
  return lines.join('\n');
}

export async function processFacebookLeadgenChange(
  change: FacebookLeadgenChange,
  deps: FacebookLeadProcessDeps = defaultDeps,
): Promise<FacebookLeadProcessResult> {
  const preferredTenantId = await deps.resolvePreferredTenantId?.(change);
  const account = await deps.getPageAccountByPageId(change.pageId, preferredTenantId);
  if (!account) {
    const tenantHint = preferredTenantId ? ` in configured tenant ${preferredTenantId}` : '';
    throw new Error(`No active connected Facebook page found for page_id ${change.pageId}${tenantHint}`);
  }

  const pageToken = decryptSocialAccessToken(account.accessToken);
  if (!pageToken) throw new Error(`Facebook page token could not be decrypted for ${account.accountName}`);

  const lead = await deps.fetchLeadDetails(change.leadgenId, pageToken);
  const mapped = mapFacebookLeadFields(lead);
  const channels = [
    mapped.email ? { channelType: 'email', channelValue: mapped.email, isPrimary: true } : null,
    mapped.phone ? { channelType: 'phone', channelValue: mapped.phone, isPrimary: !mapped.email } : null,
  ].filter(Boolean) as Array<{ channelType: string; channelValue: string; isPrimary?: boolean }>;

  const { contact, created } = await deps.findOrCreate(account.tenantId, {
    firstName: mapped.firstName,
    lastName: mapped.lastName,
    source: 'facebook_lead_form',
    sourceDetail: `page:${account.accountName}; form:${lead.form_id || change.formId || 'unknown'}`,
    channels,
    metadata: {
      companyName: mapped.companyName,
      facebookLead: {
        leadgenId: change.leadgenId,
        pageId: change.pageId,
        pageName: account.accountName,
        formId: lead.form_id || change.formId || null,
        adId: lead.ad_id || change.adId || null,
        adName: lead.ad_name || null,
        adsetId: lead.adset_id || change.adgroupId || null,
        adsetName: lead.adset_name || null,
        campaignId: lead.campaign_id || null,
        campaignName: lead.campaign_name || null,
        platform: lead.platform || null,
        createdTime: lead.created_time || change.createdTime || null,
        customFields: mapped.customFields,
        routedTenantId: account.tenantId,
      },
    },
  });

  const snapshot = await deps.getContactSnapshot(contact.id);
  const now = new Date();
  const tags = [
    ...new Set([
      ...snapshot.tags,
      'facebook_lead',
      'meta_lead_form',
      `page:${account.accountName}`,
    ]),
  ];
  const metadata = {
    ...snapshot.metadata,
    companyName: mapped.companyName ?? (snapshot.metadata.companyName as string | undefined),
    facebookLead: {
      leadgenId: change.leadgenId,
      pageId: change.pageId,
      pageName: account.accountName,
      formId: lead.form_id || change.formId || null,
      adId: lead.ad_id || change.adId || null,
      adName: lead.ad_name || null,
      adsetId: lead.adset_id || change.adgroupId || null,
      adsetName: lead.adset_name || null,
      campaignId: lead.campaign_id || null,
      campaignName: lead.campaign_name || null,
      platform: lead.platform || null,
      createdTime: lead.created_time || change.createdTime || null,
      customFields: mapped.customFields,
      rawFieldData: lead.field_data ?? [],
      capturedAt: now.toISOString(),
      routedTenantId: account.tenantId,
    },
  };

  await deps.updateContactAfterLead(contact.id, {
    tags,
    metadata,
    lastActivityAt: now,
    updatedAt: now,
    status: 'lead',
  });

  let slackSent = false;
  try {
    slackSent = await deps.sendSlack(
      account.tenantId === WIZMATCH_TENANT_ID && WIZMATCH_LEADS_CHANNEL
        ? WIZMATCH_LEADS_CHANNEL
        : process.env.SLACK_SALES_BD_CHANNEL || SLACK_SALES_BD_CHANNEL,
      buildFacebookLeadSlackMessage({ mapped, lead, change, pageName: account.accountName, created }),
    );
  } catch (error) {
    logger.warn({ error }, '[facebook-leads] Slack notification failed');
  }

  return {
    leadgenId: change.leadgenId,
    contactId: contact.id,
    created,
    pageId: change.pageId,
    pageName: account.accountName,
    slackSent,
  };
}

export async function getFacebookLeadFormsStatus(tenantId: string, checkMeta = false) {
  const rows = await db
    .select()
    .from(socialAccounts)
    .where(and(
      eq(socialAccounts.tenantId, tenantId),
      eq(socialAccounts.platform, 'facebook'),
      eq(socialAccounts.isActive, true),
    ));

  const webhookBase = process.env.PUBLIC_API_BASE || process.env.BACKEND_URL || 'https://api.growthescalators.com';
  const webhookUrl = `${webhookBase.replace(/\/$/, '')}/webhooks/meta-leads`;
  const config = {
    appIdConfigured: Boolean(process.env.META_APP_ID),
    appSecretConfigured: Boolean(process.env.META_APP_SECRET),
    verifyTokenConfigured: Boolean(process.env.META_VERIFY_TOKEN),
    slackConfigured: Boolean(process.env.SLACK_BOT_TOKEN),
    webhookUrl,
  };

  const pages = await Promise.all(rows.map(async (account) => {
    let subscriptionStatus: 'not_checked' | 'subscribed' | 'not_subscribed' | 'error' = 'not_checked';
    let error: string | undefined;
    if (checkMeta) {
      const token = decryptSocialAccessToken(account.accessToken);
      if (!token) {
        subscriptionStatus = 'error';
        error = 'page token could not be decrypted';
      } else {
        try {
          const response = await fetch(`${META_API_BASE}/${account.accountId}/subscribed_apps?access_token=${encodeURIComponent(token)}`, {
            signal: AbortSignal.timeout(10000),
          });
          const data = await response.json() as { data?: Array<{ subscribed_fields?: string[] }>; error?: { message?: string } };
          if (!response.ok || data.error) throw new Error(data.error?.message || `Meta returned ${response.status}`);
          const subscribed = (data.data ?? []).some((app) => (app.subscribed_fields ?? []).includes('leadgen'));
          subscriptionStatus = subscribed ? 'subscribed' : 'not_subscribed';
        } catch (e) {
          subscriptionStatus = 'error';
          error = e instanceof Error ? e.message : String(e);
        }
      }
    }
    return {
      id: account.id,
      pageId: account.accountId,
      pageName: account.accountName,
      connectedAt: account.createdAt,
      tokenConfigured: Boolean(account.accessToken),
      subscriptionStatus,
      error,
    };
  }));

  return {
    config,
    pages,
    ready: config.appIdConfigured && config.appSecretConfigured && config.verifyTokenConfigured && pages.length > 0,
    lastLeadSource: 'contacts.metadata.facebookLead',
  };
}

export async function subscribeFacebookPageToLeadgen(tenantId: string, socialAccountId: string) {
  const rows = await db
    .select()
    .from(socialAccounts)
    .where(and(
      eq(socialAccounts.id, socialAccountId),
      eq(socialAccounts.tenantId, tenantId),
      eq(socialAccounts.platform, 'facebook'),
      eq(socialAccounts.isActive, true),
    ))
    .limit(1);

  const account = rows[0];
  if (!account) throw new Error('active connected Facebook page not found');
  const token = decryptSocialAccessToken(account.accessToken);
  if (!token) throw new Error('Facebook page token could not be decrypted');

  const body = new URLSearchParams({
    subscribed_fields: 'leadgen',
    access_token: token,
  });
  const response = await fetch(`${META_API_BASE}/${account.accountId}/subscribed_apps`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(10000),
  });
  const data = await response.json() as { success?: boolean; error?: { message?: string } };
  if (!response.ok || data.error || data.success === false) {
    throw new Error(data.error?.message || `Meta subscription failed with ${response.status}`);
  }

  return {
    pageId: account.accountId,
    pageName: account.accountName,
    subscribed: true,
  };
}
