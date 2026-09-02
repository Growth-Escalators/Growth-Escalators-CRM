import crypto from 'crypto';
import logger from '../utils/logger';

const GOOGLE_ADS_API_VERSION = 'v25';

type GoogleAdsOutcome = 'qualified' | 'closed_won';

export interface GoogleAdsLeadConversionInput {
  outcome: GoogleAdsOutcome;
  eventId: string;
  occurredAt?: Date;
  value?: number;
  email?: string;
  phone?: string;
}

interface GoogleAdsConfig {
  customerId: string;
  loginCustomerId?: string;
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  qualifiedActionId: string;
  wonActionId: string;
}

function cleanId(value: string | undefined): string {
  return String(value || '').replace(/\D/g, '');
}

function config(): GoogleAdsConfig | null {
  const customerId = cleanId(process.env.GOOGLE_ADS_CUSTOMER_ID);
  const developerToken = String(process.env.GOOGLE_ADS_DEVELOPER_TOKEN || '').trim();
  const clientId = String(process.env.GOOGLE_ADS_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.GOOGLE_ADS_CLIENT_SECRET || '').trim();
  const refreshToken = String(process.env.GOOGLE_ADS_REFRESH_TOKEN || '').trim();
  const qualifiedActionId = cleanId(process.env.GOOGLE_ADS_QUALIFIED_CONVERSION_ACTION_ID);
  const wonActionId = cleanId(process.env.GOOGLE_ADS_WON_CONVERSION_ACTION_ID);

  if (!customerId || !developerToken || !clientId || !clientSecret || !refreshToken || !qualifiedActionId || !wonActionId) {
    return null;
  }

  return {
    customerId,
    loginCustomerId: cleanId(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) || undefined,
    developerToken,
    clientId,
    clientSecret,
    refreshToken,
    qualifiedActionId,
    wonActionId,
  };
}

function sha256(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hashedEmail(email: string): string {
  return sha256(email.trim().toLowerCase());
}

function hashedPhone(phone: string): string {
  // CRM contact-channel normalization keeps phone values close to E.164. Keep
  // the leading plus where present and strip only display punctuation/spaces.
  const normalized = phone.trim().replace(/[\s\-().]/g, '');
  return sha256(normalized);
}

function conversionDateTime(date: Date): string {
  // Google Ads accepts an explicit UTC offset; use UTC so server timezone never
  // changes the recorded conversion moment.
  return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '+00:00');
}

async function accessToken(cfg: GoogleAdsConfig): Promise<string> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
  });
  const response = await fetch('https://www.googleapis.com/oauth2/v3/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const payload = await response.json() as { access_token?: string; error?: string; error_description?: string };
  if (!response.ok || !payload.access_token) {
    throw new Error(payload.error_description || payload.error || `OAuth ${response.status}`);
  }
  return payload.access_token;
}

/**
 * Upload a Google Ads Enhanced Conversion for Leads using hashed first-party
 * contact identifiers. GCLID is intentionally not required: Google Ads supports
 * user identifiers for lead imports, while a click id can be added later to
 * improve matching once the website starts retaining it.
 *
 * Fail-closed configuration: if the Ads-specific OAuth/developer-token/action
 * settings are absent, nothing is sent and the CRM outcome remains untouched.
 */
export async function sendGoogleAdsLeadConversion(input: GoogleAdsLeadConversionInput): Promise<{ success: boolean; skipped?: boolean; error?: string }> {
  const cfg = config();
  if (!cfg) {
    logger.info('[google-ads-conversions] not configured — CRM outcome kept locally only');
    return { success: false, skipped: true, error: 'not_configured' };
  }

  const userIdentifiers: Array<Record<string, string>> = [];
  if (input.email?.trim()) {
    userIdentifiers.push({ hashedEmail: hashedEmail(input.email), userIdentifierSource: 'FIRST_PARTY' });
  }
  if (input.phone?.trim()) {
    userIdentifiers.push({ hashedPhoneNumber: hashedPhone(input.phone), userIdentifierSource: 'FIRST_PARTY' });
  }
  if (userIdentifiers.length === 0) {
    return { success: false, skipped: true, error: 'no_user_identifiers' };
  }

  const actionId = input.outcome === 'qualified' ? cfg.qualifiedActionId : cfg.wonActionId;
  const conversionValue = input.outcome === 'closed_won' && Number(input.value) > 0
    ? Number(input.value)
    : 0;

  try {
    const token = await accessToken(cfg);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'developer-token': cfg.developerToken,
    };
    if (cfg.loginCustomerId) headers['login-customer-id'] = cfg.loginCustomerId;

    const response = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cfg.customerId}:uploadClickConversions`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          conversions: [{
            conversionAction: `customers/${cfg.customerId}/conversionActions/${actionId}`,
            conversionDateTime: conversionDateTime(input.occurredAt || new Date()),
            conversionValue,
            currencyCode: 'INR',
            orderId: input.eventId,
            userIdentifiers,
          }],
          partialFailure: true,
        }),
      },
    );

    const raw = await response.text();
    let payload: { partialFailureError?: { message?: string }; results?: unknown[] } = {};
    try { payload = raw ? JSON.parse(raw) : {}; } catch { /* preserve raw below */ }

    if (!response.ok) {
      logger.warn({ status: response.status, body: raw.slice(0, 1000) }, '[google-ads-conversions] upload failed');
      return { success: false, error: `http_${response.status}` };
    }
    if (payload.partialFailureError?.message) {
      logger.warn({ error: payload.partialFailureError.message }, '[google-ads-conversions] partial failure');
      return { success: false, error: payload.partialFailureError.message };
    }

    logger.info({ outcome: input.outcome, eventId: input.eventId }, '[google-ads-conversions] uploaded');
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn({ error: message, outcome: input.outcome }, '[google-ads-conversions] ignored upload failure');
    return { success: false, error: message };
  }
}
