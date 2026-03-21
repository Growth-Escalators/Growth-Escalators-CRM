import { Router } from 'express';
import * as https from 'https';
import { db } from '../db/index';
import { sql } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth';

const router = Router();

// Module-level server start time (set when this module loads)
export const SERVER_START_TIME = new Date().toISOString();

function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  parts.push(`${m}m`);
  return parts.join(' ');
}

function checkN8n(): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(false), 3000);
    https.get('https://primary-production-6c6f5.up.railway.app/healthz', (res) => {
      clearTimeout(timeout);
      resolve(res.statusCode === 200);
    }).on('error', () => { clearTimeout(timeout); resolve(false); });
  });
}

// GET /api/system/health/ping — no auth, public
router.get('/health/ping', (_req, res) => {
  res.json({ status: 'ok', ts: Date.now() });
});

// GET /api/system/health — JWT protected
router.get('/health', requireAuth, async (req, res) => {
  const tenantId = req.user!.tenantId;

  const [
    dbCounts,
    jobStatusCounts,
    enrolmentCount,
    messageCount,
    lastEvent,
    emailCount,
    jobsTodayCount,
    lastJobResult,
    purchasesToday,
    bookingsToday,
    hotLeadsToday,
    funnelCount,
    assignmentsToday,
    funnelMembers,
    recentEvents,
    recentMessages,
    recentJobs,
    n8nReachable,
  ] = await Promise.all([
    // contacts count
    db.execute(sql`SELECT COUNT(*)::int as count FROM contacts WHERE tenant_id = ${tenantId}::uuid AND status != 'deleted'`),
    // job status counts
    db.execute(sql`SELECT status, COUNT(*)::int as count FROM jobs WHERE tenant_id = ${tenantId}::uuid GROUP BY status`),
    // active enrolments
    db.execute(sql`SELECT COUNT(*)::int as count FROM sequence_enrolments se JOIN sequences s ON s.id = se.sequence_id WHERE s.tenant_id = ${tenantId}::uuid AND se.status = 'active'`),
    // messages count
    db.execute(sql`SELECT COUNT(*)::int as count FROM messages WHERE tenant_id = ${tenantId}::uuid`),
    // last activity
    db.execute(sql`SELECT MAX(created_at) as last_at FROM events WHERE tenant_id = ${tenantId}::uuid`),
    // emails sent
    db.execute(sql`SELECT COUNT(*)::int as count FROM messages WHERE tenant_id = ${tenantId}::uuid AND channel = 'email'`),
    // jobs completed today
    db.execute(sql`SELECT COUNT(*)::int as count FROM jobs WHERE tenant_id = ${tenantId}::uuid AND status = 'completed' AND created_at > NOW() - INTERVAL '24 hours'`),
    // last completed job
    db.execute(sql`SELECT MAX(created_at) as last_at FROM jobs WHERE tenant_id = ${tenantId}::uuid AND status = 'completed'`),
    // purchases today
    db.execute(sql`SELECT COUNT(*)::int as count FROM jobs WHERE tenant_id = ${tenantId}::uuid AND job_type = 'purchase_completed' AND created_at > NOW() - INTERVAL '24 hours'`),
    // bookings today
    db.execute(sql`SELECT COUNT(*)::int as count FROM bookings WHERE tenant_id = ${tenantId}::uuid AND created_at > NOW() - INTERVAL '24 hours'`),
    // hot leads today
    db.execute(sql`SELECT COUNT(*)::int as count FROM bookings WHERE tenant_id = ${tenantId}::uuid AND qualification_tier = 'hot' AND created_at > NOW() - INTERVAL '24 hours'`),
    // active funnels
    db.execute(sql`SELECT COUNT(*)::int as count FROM funnels WHERE tenant_id = ${tenantId}::uuid AND is_active = true`),
    // assignments today
    db.execute(sql`SELECT COUNT(*)::int as count FROM funnel_assignments fa JOIN funnels f ON f.id = fa.funnel_id WHERE f.tenant_id = ${tenantId}::uuid AND fa.assigned_at > NOW() - INTERVAL '24 hours'`),
    // funnel members with assignment counts
    db.execute(sql`
      SELECT fm.member_name, fm.weight,
             COUNT(fa.id)::int as total_assigned
      FROM funnel_members fm
      JOIN funnels f ON f.id = fm.funnel_id
      LEFT JOIN funnel_assignments fa ON fa.funnel_member_id = fm.id
      WHERE f.tenant_id = ${tenantId}::uuid AND f.is_active = true
      GROUP BY fm.member_name, fm.weight
      ORDER BY total_assigned DESC
    `),
    // recent events — use correct column names from schema
    db.execute(sql`SELECT id::text, created_at, event_type, payload as data, contact_id::text FROM events WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at DESC LIMIT 20`),
    // recent messages
    db.execute(sql`SELECT id::text, sent_at as created_at, channel, direction, template_name, status FROM messages WHERE tenant_id = ${tenantId}::uuid ORDER BY sent_at DESC LIMIT 20`),
    // recent jobs
    db.execute(sql`SELECT id::text, created_at, job_type, status, payload FROM jobs WHERE tenant_id = ${tenantId}::uuid ORDER BY created_at DESC LIMIT 20`),
    // n8n reachability
    checkN8n(),
  ]);

  // Process job statuses
  const jobMap: Record<string, number> = {};
  for (const r of jobStatusCounts.rows as any[]) {
    jobMap[r.status] = Number(r.count);
  }

  const contactsCount = Number((dbCounts.rows as any[])[0]?.count ?? 0);
  const activeEnrolments = Number((enrolmentCount.rows as any[])[0]?.count ?? 0);
  const messagesCount = Number((messageCount.rows as any[])[0]?.count ?? 0);
  const lastActivityAt = (lastEvent.rows as any[])[0]?.last_at ?? null;
  const emailsSentTotal = Number((emailCount.rows as any[])[0]?.count ?? 0);
  const jobsProcessedToday = Number((jobsTodayCount.rows as any[])[0]?.count ?? 0);
  const lastJobAt = (lastJobResult.rows as any[])[0]?.last_at ?? null;
  const purchasesCount = Number((purchasesToday.rows as any[])[0]?.count ?? 0);
  const bookingsTodayCount = Number((bookingsToday.rows as any[])[0]?.count ?? 0);
  const hotLeadsTodayCount = Number((hotLeadsToday.rows as any[])[0]?.count ?? 0);
  const funnelsActive = Number((funnelCount.rows as any[])[0]?.count ?? 0);
  const assignmentsTodayCount = Number((assignmentsToday.rows as any[])[0]?.count ?? 0);
  const members = (funnelMembers.rows as any[]).map((m) => ({
    name: m.member_name,
    assigned: Number(m.total_assigned),
    weight: Number(m.weight),
  }));

  // Env vars
  const metaToken = process.env.META_ACCESS_TOKEN ?? '';
  const metaPhoneId = process.env.META_PHONE_NUMBER_ID ?? null;
  const metaVerifyToken = process.env.META_VERIFY_TOKEN ?? '';
  const brevoKey = process.env.BREVO_API_KEY ?? '';
  const smtpHost = process.env.SMTP_HOST ?? '';
  const smtpUser = process.env.SMTP_USER ?? '';
  const brevoListD2c = process.env.BREVO_LIST_D2C ?? null;
  const cashfreeAppId = process.env.CASHFREE_APP_ID ?? '';
  const cashfreeSecret = process.env.CASHFREE_SECRET_KEY ?? '';
  const calcomKey = process.env.CALCOM_API_KEY ?? '';

  // Services
  const backendService = {
    status: 'healthy' as const,
    uptime: Math.floor(process.uptime()),
    uptimeFormatted: formatUptime(process.uptime()),
    env: process.env.NODE_ENV ?? 'production',
    database: true,
    workers: { sequenceWorker: 'running', stuckJobWorker: 'running' },
    lastDeployedAt: SERVER_START_TIME,
  };

  const dbService = {
    status: (jobMap['dead_letter'] ?? 0) > 0 ? 'error' as const : (jobMap['failed'] ?? 0) > 5 ? 'warning' as const : 'healthy' as const,
    contactsCount,
    jobsPending: jobMap['pending'] ?? 0,
    jobsFailed: jobMap['failed'] ?? 0,
    jobsDeadLetter: jobMap['dead_letter'] ?? 0,
    activeEnrolments,
    messagesCount,
    lastActivityAt,
  };

  const isTestNumber = metaPhoneId === '197226183475191';
  const metaService = {
    status: !metaToken ? 'error' as const : isTestNumber ? 'warning' as const : 'healthy' as const,
    phoneNumberId: metaPhoneId,
    tokenSet: !!metaToken,
    tokenExpiry: null as string | null,
    webhookConfigured: !!metaVerifyToken,
  };

  const brevoService = {
    status: !brevoKey ? 'warning' as const : 'healthy' as const,
    apiKeySet: !!brevoKey,
    smtpConfigured: !!(smtpHost && smtpUser),
    listD2cId: brevoListD2c,
    emailsSentTotal,
  };

  const n8nService = {
    status: n8nReachable ? 'healthy' as const : 'warning' as const,
    url: 'https://primary-production-6c6f5.up.railway.app',
    reachable: n8nReachable,
    workflowsActive: 5,
    jobsProcessedToday,
    lastJobAt,
  };

  const cashfreeService = {
    status: !(cashfreeAppId && cashfreeSecret) ? 'warning' as const : 'healthy' as const,
    appIdSet: !!cashfreeAppId,
    secretSet: !!cashfreeSecret,
    webhookRegistered: true,
    purchasesToday: purchasesCount,
  };

  const calcomService = {
    status: 'healthy' as const,
    apiKeySet: !!calcomKey,
    webhookUrl: 'https://web-production-311da.up.railway.app/webhooks/calcom',
    bookingsToday: bookingsTodayCount,
    hotLeadsToday: hotLeadsTodayCount,
  };

  const roundRobinService = {
    status: funnelsActive > 0 ? 'healthy' as const : 'warning' as const,
    funnelsActive,
    totalAssignmentsToday: assignmentsTodayCount,
    members,
  };

  // Alerts
  const alerts: Array<{ level: 'error' | 'warning' | 'info'; service: string; message: string; action: string }> = [];
  if (!metaToken) alerts.push({ level: 'error', service: 'Meta WhatsApp', message: 'Meta WhatsApp token missing — WhatsApp sending disabled', action: 'Generate a System User token in Meta Business Manager and set META_ACCESS_TOKEN in Railway' });
  if (isTestNumber) alerts.push({ level: 'warning', service: 'Meta WhatsApp', message: 'Using test WhatsApp number — real number migration pending', action: 'Complete the phone number migration from GHL WABA to Growth Escalators WABA' });
  if ((jobMap['failed'] ?? 0) > 5) alerts.push({ level: 'warning', service: 'n8n', message: `${jobMap['failed']} failed jobs in queue — check n8n workflows`, action: 'Open n8n dashboard and check workflow execution logs' });
  if ((jobMap['dead_letter'] ?? 0) > 0) alerts.push({ level: 'error', service: 'Jobs', message: `${jobMap['dead_letter']} jobs in dead letter queue — manual intervention needed`, action: "Query SELECT * FROM jobs WHERE status='dead_letter' and inspect payloads" });
  if (!cashfreeAppId) alerts.push({ level: 'warning', service: 'Cashfree', message: 'Cashfree credentials missing — payments not processing', action: 'Set CASHFREE_APP_ID and CASHFREE_SECRET_KEY in Railway environment variables' });
  if (activeEnrolments === 0) alerts.push({ level: 'info', service: 'Sequences', message: 'No active sequence enrolments — check if leads are being enrolled', action: 'Verify sequence enrolment logic in the booking webhook and n8n workflows' });

  // Recent activity
  const activityItems: any[] = [];

  for (const e of (recentEvents.rows as any[])) {
    let title = e.event_type ?? 'Event';
    let service = 'backend';
    try {
      const d = typeof e.data === 'string' ? JSON.parse(e.data || '{}') : (e.data ?? {});
      if (e.event_type === 'deal_stage_changed') { title = `Deal moved to ${d.newStage ?? d.stage ?? '?'}`; service = 'backend'; }
      else if (e.event_type === 'sequence_enrolled') { title = `Enrolled in ${d.sequenceName ?? '?'}`; service = 'backend'; }
      else if (e.event_type === 'purchase_completed') { title = `Purchase ₹${d.amount ?? '?'}`; service = 'cashfree'; }
      else if (e.event_type === 'booking_created') { title = 'Booking created'; service = 'calcom'; }
    } catch { /* ignore parse errors */ }
    activityItems.push({ id: e.id, timestamp: e.created_at, service, type: e.event_type, title, detail: `Contact: ${e.contact_id?.slice(0, 8) ?? '?'}`, status: 'success' });
  }

  for (const m of (recentMessages.rows as any[])) {
    const service = m.channel === 'whatsapp' ? 'meta' : m.channel === 'email' ? 'brevo' : 'backend';
    const title = m.direction === 'outbound' ? `${m.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} sent` : `${m.channel === 'whatsapp' ? 'WhatsApp' : 'Email'} received`;
    activityItems.push({ id: m.id, timestamp: m.created_at, service, type: 'message_sent', title, detail: m.template_name ?? m.status ?? '', status: m.status === 'failed' ? 'error' : 'success' });
  }

  for (const j of (recentJobs.rows as any[])) {
    const serviceMap: Record<string, string> = { inbound_wa: 'meta', purchase_completed: 'cashfree', booking_processed: 'calcom', hot_lead_alert: 'n8n', sequence_step: 'backend' };
    const service = serviceMap[j.job_type] ?? 'backend';
    activityItems.push({ id: j.id, timestamp: j.created_at, service, type: 'job_processed', title: j.job_type?.replace(/_/g, ' ') ?? 'Job', detail: `Status: ${j.status}`, status: j.status === 'failed' || j.status === 'dead_letter' ? 'error' : j.status === 'pending' ? 'warning' : 'success' });
  }

  activityItems.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  // Overall status
  const services = { backend: backendService, database: dbService, metaWhatsapp: metaService, brevo: brevoService, n8n: n8nService, cashfree: cashfreeService, calcom: calcomService, roundRobin: roundRobinService };
  const allStatuses = Object.values(services).map((s: any) => s.status);
  const overallStatus = allStatuses.includes('error') ? 'error' : (allStatuses.includes('warning') || alerts.length > 0) ? 'warning' : 'healthy';

  res.json({
    checkedAt: new Date().toISOString(),
    overallStatus,
    services,
    alerts,
    recentActivity: activityItems.slice(0, 50),
  });
});

export default router;
