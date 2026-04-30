import logger from '../utils/logger';
import crypto from 'crypto';
import https from 'https';

const PIXEL_ID = process.env.META_PIXEL_ID;
const CAPI_TOKEN = process.env.META_CAPI_TOKEN || process.env.META_ACCESS_TOKEN;
const API_VERSION = 'v19.0';

function hashData(value: string): string {
  if (!value) return '';
  return crypto.createHash('sha256').update(value.trim().toLowerCase()).digest('hex');
}

function hashPhone(phone: string): string {
  if (!phone) return '';
  const cleaned = phone.replace(/[\s\-\+\(\)]/g, '');
  return crypto.createHash('sha256').update(cleaned).digest('hex');
}

function generateEventId(eventType: string, contactId: string): string {
  const timestamp = Date.now();
  return `${eventType}_${contactId}_${timestamp}`;
}

interface CustomerData {
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  city?: string;
  country?: string;
  contactId?: string;
  fbc?: string;
  fbp?: string;
  ipAddress?: string;
  userAgent?: string;
}

interface CapiEventParams {
  eventName: string;
  eventTime?: number;
  eventId?: string;
  eventSourceUrl?: string;
  value?: number;
  currency?: string;
  contentName?: string;
  contentCategory?: string;
  contentType?: string;
  numItems?: number;
  orderId?: string;
  customData?: Record<string, unknown>;
  customer: CustomerData;
}

export async function sendCapiEvent(params: CapiEventParams): Promise<{ success: boolean; eventId: string; error?: string }> {
  if (!PIXEL_ID || !CAPI_TOKEN) {
    const missing = [];
    if (!PIXEL_ID) missing.push('META_PIXEL_ID');
    if (!CAPI_TOKEN) missing.push('META_CAPI_TOKEN or META_ACCESS_TOKEN');
    logger.error(`[CAPI] Missing: ${missing.join(', ')} — conversion not sent`);
    return { success: false, eventId: '', error: `Missing: ${missing.join(', ')}` };
  }

  const eventId = params.eventId || generateEventId(params.eventName, params.customer.contactId || 'unknown');
  const eventTime = params.eventTime || Math.floor(Date.now() / 1000);

  const userData: Record<string, unknown> = {};
  if (params.customer.email) userData.em = [hashData(params.customer.email)];
  if (params.customer.phone) userData.ph = [hashPhone(params.customer.phone)];
  if (params.customer.firstName) userData.fn = [hashData(params.customer.firstName)];
  if (params.customer.lastName) userData.ln = [hashData(params.customer.lastName)];
  if (params.customer.city) userData.ct = [hashData(params.customer.city)];
  if (params.customer.country) userData.country = [hashData(params.customer.country || 'in')];
  if (params.customer.fbc) userData.fbc = params.customer.fbc;
  if (params.customer.fbp) userData.fbp = params.customer.fbp;
  if (params.customer.ipAddress) userData.client_ip_address = params.customer.ipAddress;
  if (params.customer.userAgent) userData.client_user_agent = params.customer.userAgent;
  userData.external_id = [hashData(params.customer.contactId || params.customer.email || '')];

  const customData: Record<string, unknown> = {};
  if (params.value !== undefined) customData.value = params.value;
  if (params.currency) customData.currency = params.currency;
  if (params.contentName) customData.content_name = params.contentName;
  if (params.contentCategory) customData.content_category = params.contentCategory;
  if (params.contentType) customData.content_type = params.contentType || 'product';
  if (params.numItems) customData.num_items = params.numItems;
  if (params.orderId) customData.order_id = params.orderId;
  if (params.customData) Object.assign(customData, params.customData);

  const payload = {
    data: [{
      event_name: params.eventName,
      event_time: eventTime,
      event_id: eventId,
      event_source_url: params.eventSourceUrl || 'https://web-production-311da.up.railway.app',
      action_source: 'website',
      user_data: userData,
      custom_data: Object.keys(customData).length > 0 ? customData : undefined,
    }],
  };

  const body = JSON.stringify(payload);

  return new Promise((resolve) => {
    const options = {
      hostname: 'graph.facebook.com',
      path: `/${API_VERSION}/${PIXEL_ID}/events?access_token=${CAPI_TOKEN}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { events_received?: number };
          if ((parsed.events_received ?? 0) > 0 || res.statusCode === 200) {
            console.log(`[CAPI] ${params.eventName} sent. Event ID: ${eventId}. Received: ${parsed.events_received}`);
            resolve({ success: true, eventId });
          } else {
            logger.error(`[CAPI] error for ${params.eventName}:`, data);
            resolve({ success: false, eventId, error: data });
          }
        } catch {
          resolve({ success: false, eventId, error: data });
        }
      });
    });

    req.on('error', (e) => {
      logger.error('[CAPI] request error:', e.message);
      resolve({ success: false, eventId, error: e.message });
    });

    req.write(body);
    req.end();
  });
}

export async function sendPurchaseEvent(params: {
  contact: { id: string; email?: string; phone?: string; firstName?: string; lastName?: string };
  value: number;
  orderId: string;
  productName: string;
  ipAddress?: string;
  userAgent?: string;
  fbc?: string;
  fbp?: string;
  utmSource?: string;
  utmCampaign?: string;
}): Promise<{ success: boolean; eventId: string }> {
  const utmCustomData: Record<string, unknown> = {};
  if (params.utmSource) utmCustomData.utm_source = params.utmSource;
  if (params.utmCampaign) utmCustomData.utm_campaign = params.utmCampaign;

  return sendCapiEvent({
    eventName: 'Purchase',
    customer: {
      contactId: params.contact.id,
      email: params.contact.email,
      phone: params.contact.phone,
      firstName: params.contact.firstName,
      lastName: params.contact.lastName,
      country: 'in',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      fbc: params.fbc,
      fbp: params.fbp,
    },
    value: params.value,
    currency: 'INR',
    contentName: params.productName,
    contentType: 'product',
    numItems: 1,
    orderId: params.orderId,
    eventSourceUrl: 'https://web-production-311da.up.railway.app',
    customData: Object.keys(utmCustomData).length > 0 ? utmCustomData : undefined,
  });
}

export async function sendLeadEvent(params: {
  contact: { id: string; email?: string; phone?: string; firstName?: string; lastName?: string };
  estimatedValue?: number;
  source?: string;
  ipAddress?: string;
  userAgent?: string;
  fbc?: string;
  fbp?: string;
}): Promise<{ success: boolean; eventId: string }> {
  return sendCapiEvent({
    eventName: 'Lead',
    customer: {
      contactId: params.contact.id,
      email: params.contact.email,
      phone: params.contact.phone,
      firstName: params.contact.firstName,
      lastName: params.contact.lastName,
      country: 'in',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      fbc: params.fbc,
      fbp: params.fbp,
    },
    value: params.estimatedValue || 5000,
    currency: 'INR',
    contentName: 'D2C Strategy Call',
    contentCategory: 'consultation',
    eventSourceUrl: 'https://api.growthescalators.com/consulting',
  });
}

export async function sendScheduleEvent(params: {
  contact: { id: string; email?: string; phone?: string; firstName?: string; lastName?: string };
  ipAddress?: string;
  userAgent?: string;
}): Promise<{ success: boolean; eventId: string }> {
  return sendCapiEvent({
    eventName: 'Schedule',
    customer: {
      contactId: params.contact.id,
      email: params.contact.email,
      phone: params.contact.phone,
      firstName: params.contact.firstName,
      lastName: params.contact.lastName,
      country: 'in',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
    },
    contentName: 'Strategy Call Booking',
    eventSourceUrl: 'https://web-production-311da.up.railway.app/book/d2c-strategy',
  });
}

export async function sendInitiateCheckoutEvent(params: {
  contact: { id: string; email?: string; phone?: string; firstName?: string; lastName?: string };
  value: number;
  ipAddress?: string;
  userAgent?: string;
  fbc?: string;
  fbp?: string;
}): Promise<{ success: boolean; eventId: string }> {
  return sendCapiEvent({
    eventName: 'InitiateCheckout',
    customer: {
      contactId: params.contact.id,
      email: params.contact.email,
      phone: params.contact.phone,
      firstName: params.contact.firstName,
      lastName: params.contact.lastName,
      country: 'in',
      ipAddress: params.ipAddress,
      userAgent: params.userAgent,
      fbc: params.fbc,
      fbp: params.fbp,
    },
    value: params.value,
    currency: 'INR',
    contentName: 'D2C Funnel Breakdown Pack',
    eventSourceUrl: 'https://web-production-311da.up.railway.app',
  });
}
