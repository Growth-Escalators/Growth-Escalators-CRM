import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { createHmac } from 'crypto';

/**
 * WhatsApp lead-acknowledgement tests.
 *
 * Every Kapso call is mocked — no test in this file can send a real message.
 * Env-dependent constants are read at module load, so tests that need a
 * different configuration set process.env and re-import through `vi.resetModules()`.
 */

// ---------------------------------------------------------------------------
// A minimal chainable Drizzle mock. Each db.select() consumes the next queued
// result; updates/inserts resolve to nothing. Enough to drive the policy gate
// and the ack job without a database.
// ---------------------------------------------------------------------------
const selectQueue: unknown[][] = [];
const executeQueue: Array<{ rows: unknown[] }> = [];
const inserted: unknown[] = [];

function chainable(resolve: () => Promise<unknown>) {
  const chain: Record<string, unknown> = {};
  for (const m of ['from', 'where', 'limit', 'orderBy', 'set', 'values', 'onConflictDoNothing', 'onConflictDoUpdate', 'returning', 'innerJoin', 'leftJoin']) {
    chain[m] = () => chain;
  }
  chain.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => resolve().then(res, rej);
  return chain;
}

const dbMock = {
  select: vi.fn(() => chainable(async () => selectQueue.shift() ?? [])),
  update: vi.fn(() => chainable(async () => [])),
  insert: vi.fn(() => chainable(async () => {
    inserted.push(true);
    return [{ id: 'row-1' }];
  })),
  execute: vi.fn(async () => executeQueue.shift() ?? { rows: [{ sent_count: 1 }] }),
  transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(dbMock)),
};

vi.mock('../db/index', () => ({
  db: dbMock,
  contacts: { id: 'id', doNotContact: 'do_not_contact', optedInWa: 'opted_in_wa' },
  contactChannels: {},
  messages: { contactId: 'contact_id', channel: 'channel', direction: 'direction', sentAt: 'sent_at' },
  waLeadAcks: { eventId: 'event_id' },
  waMonthlyUsage: { tenantId: 't', yearMonth: 'ym', sentCount: 'sent_count' },
  jobs: { jobType: 'job_type', status: 'status', processAfter: 'process_after' },
  processedEvents: {},
  tenants: {},
}));

const sendTemplateMock = vi.fn();
vi.mock('../services/whatsapp/kapsoClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/whatsapp/kapsoClient')>();
  return { ...actual, sendTemplate: sendTemplateMock, isConfigured: () => true };
});

const completeJobMock = vi.fn();
const failJobMock = vi.fn();
const insertJobMock = vi.fn(async () => ({ job: { id: 'job-1' }, duplicate: false }));
vi.mock('../services/jobQueue', () => ({
  insertJob: insertJobMock,
  completeJob: completeJobMock,
  failJob: failJobMock,
  claimJob: vi.fn(),
  getPendingJobs: vi.fn(async () => []),
}));

vi.mock('../services/whatsappSendGuard', () => ({
  canSendGrowthOSWhatsApp: vi.fn(async () => true),
  sendWhatsAppMessage: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() },
}));

const BASE_ENV = { ...process.env };

function setEnv(overrides: Record<string, string>) {
  process.env = {
    ...BASE_ENV,
    WHATSAPP_AUTOMATION_ENABLED: 'true',
    WHATSAPP_TEST_MODE: 'false',
    KAPSO_API_KEY: 'test-key',
    KAPSO_PHONE_NUMBER_ID: '123456',
    KAPSO_WEBHOOK_SECRET: 'test-secret',
    WHATSAPP_MONTHLY_HARD_LIMIT: '1800',
    ...overrides,
  };
}

/** Queue the three selects policy.evaluate performs, in order. */
function queuePolicyReads(opts: {
  doNotContact?: boolean;
  optedInWa?: boolean;
  recentCount?: number;
  monthlyUsage?: number;
}) {
  selectQueue.push([{ doNotContact: opts.doNotContact ?? false, optedInWa: opts.optedInWa ?? true }]);
  selectQueue.push([{ count: opts.recentCount ?? 0 }]);
  selectQueue.push([{ sentCount: opts.monthlyUsage ?? 0 }]);
}

const JOB = {
  id: 'job-1',
  payload: {
    eventId: 'evt-1',
    tenantId: 'tenant-1',
    contactId: 'contact-1',
    firstName: 'Priya',
    service: 'Shopify Development',
    assignedTo: 'd2c.bd',
    phoneSubmitted: '+91 98765 43210',
    phoneE164: '+919876543210',
    regionHint: 'IN',
    consentGiven: true,
  },
};

beforeEach(() => {
  selectQueue.length = 0;
  executeQueue.length = 0;
  inserted.length = 0;
  vi.clearAllMocks();
  insertJobMock.mockResolvedValue({ job: { id: 'job-1' }, duplicate: false });
  setEnv({});
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...BASE_ENV };
});

// ---------------------------------------------------------------------------
// Phone parsing
// ---------------------------------------------------------------------------
describe('phoneService', () => {
  it('normalises an Indian national number when the form targets India', async () => {
    const { parsePhone } = await import('../services/phoneService');
    const r = parsePhone('98765 43210', 'IN');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.e164).toBe('+919876543210');
  });

  it('keeps an international number intact instead of forcing +91', async () => {
    const { parsePhone } = await import('../services/phoneService');
    const r = parsePhone('+1 202 555 0123');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.e164).toBe('+12025550123');
  });

  it('does not guess a country for a bare national number with no region hint', async () => {
    const { parsePhone } = await import('../services/phoneService');
    const r = parsePhone('2025550123');
    expect(r.ok).toBe(false);
  });

  // CASE 3 — invalid phone number
  it('rejects obviously invalid numbers', async () => {
    const { parsePhone } = await import('../services/phoneService');
    expect(parsePhone('12345', 'IN').ok).toBe(false);
    expect(parsePhone('', 'IN').ok).toBe(false);
    expect(parsePhone('abcdefghij', 'IN').ok).toBe(false);
  });

  it('never exposes a full number in redacted output', async () => {
    const { redactPhone } = await import('../services/phoneService');
    const out = redactPhone('+919876543210');
    expect(out).not.toContain('9876543');
    expect(out.endsWith('3210')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Template variables
// ---------------------------------------------------------------------------
describe('template variables', () => {
  it('strips newlines and control characters that Meta would reject', async () => {
    const { sanitizeVariable } = await import('../services/whatsapp/leadAckService');
    expect(sanitizeVariable('Hello\n\nWorld\t!', 'x')).toBe('Hello World !');
  });

  it('falls back rather than sending an empty variable', async () => {
    const { buildVariables } = await import('../services/whatsapp/leadAckService');
    const vars = buildVariables({ firstName: '', service: '', assignedTo: null });
    expect(vars.map((v) => v.text)).toEqual(['there', 'your enquiry', 'our team']);
  });

  it('resists template-variable injection by flattening and truncating', async () => {
    const { sanitizeVariable } = await import('../services/whatsapp/leadAckService');
    const nasty = 'A'.repeat(500) + '\n{{1}}';
    const out = sanitizeVariable(nasty, 'x', 60);
    expect(out.length).toBeLessThanOrEqual(60);
    expect(out).not.toContain('\n');
  });
});

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------
describe('lead assignment', () => {
  it('routes each service family to its BD bucket', async () => {
    const { resolveBucket } = await import('../services/leadAssignmentService');
    expect(resolveBucket({ service: 'SEO and Google Ads' })).toBe('marketing');
    expect(resolveBucket({ service: 'Shopify store build' })).toBe('d2c');
    expect(resolveBucket({ service: 'Custom software development' })).toBe('technology');
    expect(resolveBucket({ market: 'US' })).toBe('staffing');
    expect(resolveBucket({ service: 'offshore developers' })).toBe('staffing');
    expect(resolveBucket({})).toBe('general');
  });

  it('never renders an email address as the salesperson name', async () => {
    const { assigneeDisplayName } = await import('../services/leadAssignmentService');
    expect(assigneeDisplayName('d2c.bd@growthescalators.com')).toBe('D2c Bd');
    expect(assigneeDisplayName(null)).toBe('our team');
  });
});

// ---------------------------------------------------------------------------
// Policy gate + job outcomes
// ---------------------------------------------------------------------------
describe('acknowledgement job', () => {
  // CASE 1 — valid opted-in lead
  it('sends exactly one template for a valid opted-in lead', async () => {
    queuePolicyReads({});
    sendTemplateMock.mockResolvedValue({ ok: true, messageId: 'wamid.ABC' });
    const { processAckJob } = await import('../services/whatsapp/leadAckService');

    expect(await processAckJob(JOB)).toBe('sent');
    expect(sendTemplateMock).toHaveBeenCalledTimes(1);
    expect(completeJobMock).toHaveBeenCalledWith('job-1');

    const [to, template, , vars] = sendTemplateMock.mock.calls[0];
    expect(to).toBe('+919876543210');
    expect(template).toBe('website_enquiry_received');
    expect(vars.map((v: { text: string }) => v.text)).toEqual(['Priya', 'Shopify Development', 'D2c Bd']);
  });

  // CASE 2 — valid lead without WhatsApp consent
  it('does not send when consent is absent', async () => {
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    const result = await processAckJob({ ...JOB, payload: { ...JOB.payload, consentGiven: false } });
    expect(result).toBe('skipped_no_consent');
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  // CASE 13 — lead already opted out
  it('does not send to a contact marked do_not_contact', async () => {
    queuePolicyReads({ doNotContact: true });
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    expect(await processAckJob(JOB)).toBe('opted_out');
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it('does not send to a contact who opted out of WhatsApp specifically', async () => {
    queuePolicyReads({ optedInWa: false });
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    expect(await processAckJob(JOB)).toBe('opted_out');
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  // CASE 4 — duplicate form submission
  it('skips a second acknowledgement inside the cooldown window', async () => {
    queuePolicyReads({ recentCount: 1 });
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    expect(await processAckJob(JOB)).toBe('skipped_duplicate');
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  // CASE 3 — invalid phone reaching the job
  it('permanently fails an unparseable phone number without calling Kapso', async () => {
    queuePolicyReads({});
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    const result = await processAckJob({
      ...JOB,
      payload: { ...JOB.payload, phoneE164: null, phoneSubmitted: '12345' },
    });
    expect(result).toBe('failed_permanent');
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  // CASE 14 — monthly threshold reached
  it('stops automation at the monthly hard limit', async () => {
    queuePolicyReads({ monthlyUsage: 1800 });
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    expect(await processAckJob(JOB)).toBe('skipped_budget');
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  // CASE 5 — Kapso timeout
  it('marks a timeout retryable and schedules a retry', async () => {
    queuePolicyReads({});
    sendTemplateMock.mockResolvedValue({ ok: false, retryable: true, error: 'kapso_timeout' });
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    expect(await processAckJob(JOB)).toBe('failed_retryable');
    expect(failJobMock).toHaveBeenCalled();
    expect(completeJobMock).not.toHaveBeenCalled();
  });

  // CASE 6 — temporary Kapso failure
  it('retries a 5xx from Kapso', async () => {
    queuePolicyReads({});
    sendTemplateMock.mockResolvedValue({ ok: false, retryable: true, error: '503: upstream', status: 503 });
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    expect(await processAckJob(JOB)).toBe('failed_retryable');
    expect(failJobMock).toHaveBeenCalled();
  });

  // CASE 7 — permanent Meta rejection
  it('never retries a permanent Meta rejection', async () => {
    queuePolicyReads({});
    sendTemplateMock.mockResolvedValue({
      ok: false,
      retryable: false,
      error: '400/131047: re-engagement required',
      status: 400,
    });
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    expect(await processAckJob(JOB)).toBe('failed_permanent');
    expect(failJobMock).not.toHaveBeenCalled();
    expect(completeJobMock).toHaveBeenCalledWith('job-1');
  });

  // Kill switch
  it('sends nothing when the emergency flag is off', async () => {
    setEnv({ WHATSAPP_AUTOMATION_ENABLED: 'false' });
    vi.resetModules();
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    expect(await processAckJob(JOB)).toBe('skipped_disabled');
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  // Test mode
  it('in test mode, only allowlisted numbers are messaged', async () => {
    setEnv({ WHATSAPP_TEST_MODE: 'true', WHATSAPP_TEST_ALLOWLIST: '+911111111111' });
    vi.resetModules();
    queuePolicyReads({});
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    expect(await processAckJob(JOB)).toBe('skipped_test_mode');
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  // CASE 8 — duplicate job execution
  it('does not enqueue a second job for the same submission', async () => {
    insertJobMock.mockResolvedValue({ job: { id: 'job-1' }, duplicate: true });
    const { enqueueAck } = await import('../services/whatsapp/leadAckService');
    const result = await enqueueAck(JOB.payload as never);
    expect(result.duplicate).toBe(true);
    expect(insertJobMock).toHaveBeenCalledTimes(1);
    expect((insertJobMock.mock.calls[0] as unknown[])[3]).toBe('wa_ack:evt-1');
  });

  // CASE 15 — CRM lead survives WhatsApp being unavailable
  it('never throws when queueing fails, so lead creation is unaffected', async () => {
    insertJobMock.mockRejectedValue(new Error('database unreachable'));
    const { enqueueAck } = await import('../services/whatsapp/leadAckService');
    await expect(enqueueAck(JOB.payload as never)).resolves.toEqual({ queued: false, duplicate: false });
  });
});

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------
describe('kapso webhook', () => {
  // CASE 10 — invalid webhook signature
  it('rejects a bad signature and accepts a good one', async () => {
    const { verifyWebhookSignature } = await import('../services/whatsapp/kapsoClient');
    const body = JSON.stringify({ event: 'whatsapp.message.received' });
    const good = createHmac('sha256', 'test-secret').update(body, 'utf8').digest('hex');

    expect(verifyWebhookSignature(body, good)).toBe(true);
    expect(verifyWebhookSignature(body, `sha256=${good}`)).toBe(true);
    expect(verifyWebhookSignature(body, 'deadbeef')).toBe(false);
    expect(verifyWebhookSignature(body, undefined)).toBe(false);
    expect(verifyWebhookSignature('{"tampered":true}', good)).toBe(false);
  });

  it('fails closed when no webhook secret is configured', async () => {
    setEnv({ KAPSO_WEBHOOK_SECRET: '' });
    vi.resetModules();
    const { verifyWebhookSignature } = await import('../services/whatsapp/kapsoClient');
    expect(verifyWebhookSignature('{}', 'anything')).toBe(false);
  });

  // CASE 12 — STOP opt-out
  it('treats clear opt-out words as opt-outs', async () => {
    const { isOptOutMessage } = await import('../services/whatsapp/outboundPolicy');
    for (const word of ['STOP', 'stop', 'Stop.', 'UNSUBSCRIBE', 'cancel', 'opt out', 'Quit']) {
      expect(isOptOutMessage(word), word).toBe(true);
    }
  });

  // CASE 11 — a genuine customer reply is not an opt-out
  it('does not treat a sentence containing "stop" as an opt-out', async () => {
    const { isOptOutMessage } = await import('../services/whatsapp/outboundPolicy');
    expect(isOptOutMessage('Please don\'t stop sending me updates')).toBe(false);
    expect(isOptOutMessage('Tomorrow 4pm works for me')).toBe(false);
    expect(isOptOutMessage('')).toBe(false);
  });

  // CASE 9 — duplicate webhook event / out-of-order status
  it('only moves delivery status forward, except for failures', async () => {
    const { shouldApplyStatus } = await import('../routes/kapsoWebhook');
    expect(shouldApplyStatus('sent', 'delivered')).toBe(true);
    expect(shouldApplyStatus('delivered', 'read')).toBe(true);
    // A replayed or late webhook must not regress a read message.
    expect(shouldApplyStatus('read', 'delivered')).toBe(false);
    expect(shouldApplyStatus('read', 'read')).toBe(false);
    // Failure is terminal and always applies.
    expect(shouldApplyStatus('read', 'failed')).toBe(true);
    expect(shouldApplyStatus('sent', '')).toBe(false);
  });

  /**
   * Regression: Kapso payload_version v2 puts the event at the root of the
   * body, while the handler only read a v1 `data` envelope. Every field came
   * back empty, handleInbound returned on its unlogged `if (!msg.from)` guard,
   * and inbound replies plus delivery receipts were dropped for two months
   * while the endpoint answered 200 to every POST. Nothing errored, so only a
   * decode-level test catches it.
   */
  it('reads the v2 payload, which puts the event at the root', async () => {
    const { parseKapsoEvent } = await import('../routes/kapsoWebhook');
    const ev = parseKapsoEvent({
      message: {
        id: 'wamid.123',
        from: '919166000064',
        text: { body: 'Yes, interested' },
        kapso: { direction: 'inbound', status: 'received' },
      },
      conversation: { id: 'conv_123', phone_number: '919166000064' },
      phone_number_id: '101013382955175',
    });

    expect(ev.from).toBe('919166000064');
    expect(ev.externalId).toBe('wamid.123');
    expect(ev.text).toBe('Yes, interested');
    expect(ev.conversationId).toBe('conv_123');
    expect(ev.direction).toBe('inbound');
  });

  it('still reads the v1 payload, which wraps the event in `data`', async () => {
    const { parseKapsoEvent } = await import('../routes/kapsoWebhook');
    const ev = parseKapsoEvent({
      event: 'whatsapp.message.received',
      data: { id: 'wamid.v1', from: '919166000064', text: { body: 'Hello' }, conversation_id: 'c1' },
    });

    expect(ev.from).toBe('919166000064');
    expect(ev.externalId).toBe('wamid.v1');
    expect(ev.text).toBe('Hello');
    expect(ev.conversationId).toBe('c1');
  });

  it('never returns a sender for an unrecognised shape, so the guard can log it', async () => {
    const { parseKapsoEvent } = await import('../routes/kapsoWebhook');
    expect(parseKapsoEvent({}).from).toBe('');
    expect(parseKapsoEvent({ data: {} }).from).toBe('');
  });
});

// ---------------------------------------------------------------------------
// WhatsApp Business App coexistence
// ---------------------------------------------------------------------------
describe('coexistence (WhatsApp Business App on the same number)', () => {
  it('never treats a history backfill as a live customer reply', async () => {
    const { isCustomerReply } = await import('../routes/kapsoWebhook');
    expect(isCustomerReply('whatsapp.message.received', 'history_sync', 'inbound')).toBe(false);
  });

  it('never treats the team-s own app message as a customer reply', async () => {
    const { isCustomerReply } = await import('../routes/kapsoWebhook');
    expect(isCustomerReply('whatsapp.message.received', 'business_app', 'outbound')).toBe(false);
    expect(isCustomerReply('whatsapp.message.received', 'business_app', 'inbound')).toBe(false);
    expect(isCustomerReply('whatsapp.message.received', 'cloud_api', 'outbound')).toBe(false);
  });

  it('still accepts a genuine customer reply', async () => {
    const { isCustomerReply } = await import('../routes/kapsoWebhook');
    expect(isCustomerReply('whatsapp.message.received', 'cloud_api', 'inbound')).toBe(true);
  });

  it('reads origin and direction from either payload shape', async () => {
    const { classifyEvent } = await import('../routes/kapsoWebhook');
    expect(classifyEvent({ kapso: { origin: 'business_app', direction: 'outbound' } }))
      .toEqual({ origin: 'business_app', direction: 'outbound' });
    expect(classifyEvent({ message: { kapso: { origin: 'history_sync', direction: 'inbound' } } }))
      .toEqual({ origin: 'history_sync', direction: 'inbound' });
    // Absent markers default to a normal inbound cloud_api message.
    expect(classifyEvent({})).toEqual({ origin: 'cloud_api', direction: 'inbound' });
  });

  it('a STOP inside a backfilled history message cannot opt anyone out', async () => {
    const { isCustomerReply } = await import('../routes/kapsoWebhook');
    const { isOptOutMessage } = await import('../services/whatsapp/outboundPolicy');
    // The text alone would opt out...
    expect(isOptOutMessage('stop')).toBe(true);
    // ...but the event never reaches the opt-out path.
    expect(isCustomerReply('whatsapp.message.received', 'history_sync', 'inbound')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Template parameter style (named vs positional)
// ---------------------------------------------------------------------------
describe('template parameter style', () => {
  it('sends positional parameters when no names are configured', async () => {
    setEnv({ KAPSO_TEMPLATE_PARAM_NAMES: '' });
    vi.resetModules();
    const { buildVariables } = await import('../services/whatsapp/leadAckService');
    const vars = buildVariables({ firstName: 'Priya', service: 'Shopify', assignedTo: null });
    expect(vars).toEqual([
      { type: 'text', text: 'Priya' },
      { type: 'text', text: 'Shopify' },
      { type: 'text', text: 'our team' },
    ]);
    expect(vars.every((v) => !('parameter_name' in v))).toBe(true);
  });

  it('sends named parameters when the template uses them', async () => {
    setEnv({ KAPSO_TEMPLATE_PARAM_NAMES: 'customer_name,service_name,assignee_name' });
    vi.resetModules();
    const { buildVariables } = await import('../services/whatsapp/leadAckService');
    const vars = buildVariables({ firstName: 'Priya', service: 'Shopify', assignedTo: 'd2c.bd' });
    expect(vars).toEqual([
      { type: 'text', parameter_name: 'customer_name', text: 'Priya' },
      { type: 'text', parameter_name: 'service_name', text: 'Shopify' },
      { type: 'text', parameter_name: 'assignee_name', text: 'D2c Bd' },
    ]);
  });

  it('keeps names aligned to position, so order in the template is preserved', async () => {
    setEnv({ KAPSO_TEMPLATE_PARAM_NAMES: 'a,b,c' });
    vi.resetModules();
    const { buildVariables } = await import('../services/whatsapp/leadAckService');
    const vars = buildVariables({ firstName: 'X', service: 'Y', assignedTo: null });
    expect(vars.map((v) => v.parameter_name)).toEqual(['a', 'b', 'c']);
  });

  it('falls back to positional for any parameter without a configured name', async () => {
    setEnv({ KAPSO_TEMPLATE_PARAM_NAMES: 'customer_name' });
    vi.resetModules();
    const { buildVariables } = await import('../services/whatsapp/leadAckService');
    const vars = buildVariables({ firstName: 'X', service: 'Y', assignedTo: null });
    expect(vars[0].parameter_name).toBe('customer_name');
    expect('parameter_name' in vars[1]).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Environment flag parsing
// ---------------------------------------------------------------------------
describe('env flag parsing', () => {
  it('treats a value with surrounding whitespace as set', async () => {
    setEnv({ WHATSAPP_AUTOMATION_ENABLED: ' true' });
    vi.resetModules();
    queuePolicyReads({});
    sendTemplateMock.mockResolvedValue({ ok: true, messageId: 'wamid.WS' });
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    expect(await processAckJob(JOB)).toBe('sent');
  });

  it('accepts 1 / yes / on as well as true', async () => {
    for (const v of ['1', 'yes', 'ON', ' True ']) {
      setEnv({ WHATSAPP_AUTOMATION_ENABLED: v });
      vi.resetModules();
      queuePolicyReads({});
      sendTemplateMock.mockResolvedValue({ ok: true, messageId: 'wamid.X' });
      const { processAckJob } = await import('../services/whatsapp/leadAckService');
      expect(await processAckJob(JOB), v).toBe('sent');
    }
  });

  it('still treats anything else as off', async () => {
    for (const v of ['', 'false', 'no', 'off', '0', 'nope']) {
      setEnv({ WHATSAPP_AUTOMATION_ENABLED: v });
      vi.resetModules();
      const { processAckJob } = await import('../services/whatsapp/leadAckService');
      expect(await processAckJob(JOB), v).toBe('skipped_disabled');
    }
  });

  it('test mode stays on unless explicitly disabled, whitespace tolerant', async () => {
    setEnv({ WHATSAPP_TEST_MODE: ' false ' });
    vi.resetModules();
    queuePolicyReads({});
    sendTemplateMock.mockResolvedValue({ ok: true, messageId: 'wamid.TM' });
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    expect(await processAckJob(JOB)).toBe('sent');
  });
});

// ---------------------------------------------------------------------------
// Self-send guard
// ---------------------------------------------------------------------------
describe('self-send guard', () => {
  it('refuses to message the sending number, with a named reason', async () => {
    setEnv({ KAPSO_SENDER_E164: '+917733888883', WHATSAPP_TEST_MODE: 'false' });
    vi.resetModules();
    queuePolicyReads({});
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    const result = await processAckJob({
      ...JOB,
      payload: { ...JOB.payload, phoneE164: '+917733888883' },
    });
    expect(result).toBe('skipped_self_send');
    expect(sendTemplateMock).not.toHaveBeenCalled();
  });

  it('ignores formatting differences when comparing to the sender', async () => {
    setEnv({ KAPSO_SENDER_E164: '91 77338 88883', WHATSAPP_TEST_MODE: 'false' });
    vi.resetModules();
    queuePolicyReads({});
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    const result = await processAckJob({
      ...JOB,
      payload: { ...JOB.payload, phoneE164: '+917733888883' },
    });
    expect(result).toBe('skipped_self_send');
  });

  it('still sends to a different number', async () => {
    setEnv({ KAPSO_SENDER_E164: '+917733888883', WHATSAPP_TEST_MODE: 'false' });
    vi.resetModules();
    queuePolicyReads({});
    sendTemplateMock.mockResolvedValue({ ok: true, messageId: 'wamid.OK' });
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    expect(await processAckJob(JOB)).toBe('sent');
  });

  it('does not run when the sender number is not configured', async () => {
    setEnv({ KAPSO_SENDER_E164: '', WHATSAPP_TEST_MODE: 'false' });
    vi.resetModules();
    queuePolicyReads({});
    sendTemplateMock.mockResolvedValue({ ok: true, messageId: 'wamid.NOGUARD' });
    const { processAckJob } = await import('../services/whatsapp/leadAckService');
    const result = await processAckJob({
      ...JOB,
      payload: { ...JOB.payload, phoneE164: '+917733888883' },
    });
    expect(result).toBe('sent');
  });
});
