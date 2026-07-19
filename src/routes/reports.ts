import { Router, type Request, type Response } from 'express';
import { db, billingClients, userPermissions } from '../db/index';
import { eq, and, isNotNull } from 'drizzle-orm';
import PDFDocument from 'pdfkit';

const router = Router();

const META_API_BASE = 'https://graph.facebook.com/v19.0';

function getAdsToken(): string | null {
  return process.env.META_ADS_TOKEN || process.env.META_ACCESS_TOKEN || null;
}

async function getPerms(userId: string) {
  const [p] = await db.select().from(userPermissions).where(eq(userPermissions.userId, userId)).limit(1);
  return p;
}

// Parse a week date (YYYY-MM-DD) into Mon-Sun range
function weekRange(weekOf: string): { start: Date; end: Date } {
  const d = new Date(weekOf);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diff);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

async function fetchWeeklyAdMetrics(adAccountId: string, weekOf: string) {
  const token = getAdsToken();
  if (!token) return null;

  const { start, end } = weekRange(weekOf);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const timeRange = JSON.stringify({ since: fmt(start), until: fmt(end) });

  const fields = [
    'spend', 'impressions', 'clicks', 'ctr', 'cpm', 'cpc',
    'actions', 'action_values',
  ].join(',');

  const params = new URLSearchParams({
    fields,
    time_range: timeRange,
    level: 'account',
    access_token: token,
  });

  const url = `${META_API_BASE}/${adAccountId}/insights?${params.toString()}`;
  const r = await fetch(url);
  const data = await r.json() as Record<string, unknown>;

  if (data.error) return { error: (data.error as Record<string,string>).message };

  const row = ((data as { data: Array<Record<string,unknown>> }).data || [])[0];
  if (!row) return { spend: 0, impressions: 0, clicks: 0, purchases: 0, roas: 0, ctr: 0, cpc: 0, cpm: 0 };

  const actions = (row.actions as Array<{ action_type: string; value: string }>) || [];
  const actionValues = (row.action_values as Array<{ action_type: string; value: string }>) || [];
  const purchases = actions.filter(a => a.action_type === 'offsite_conversion.fb_pixel_purchase').reduce((s, a) => s + Number(a.value || 0), 0);
  const purchaseValue = actionValues.filter(a => a.action_type === 'offsite_conversion.fb_pixel_purchase').reduce((s, a) => s + Number(a.value || 0), 0);
  const spend = Number(row.spend || 0);

  return {
    spend: Math.round(spend * 100) / 100,
    impressions: Number(row.impressions || 0),
    clicks: Number(row.clicks || 0),
    ctr: Math.round(Number(row.ctr || 0) * 100) / 100,
    cpc: Math.round(Number(row.cpc || 0) * 100) / 100,
    cpm: Math.round(Number(row.cpm || 0) * 100) / 100,
    purchases,
    purchaseValue: Math.round(purchaseValue * 100) / 100,
    roas: spend > 0 ? Math.round((purchaseValue / spend) * 100) / 100 : 0,
  };
}

async function fetchCompletedTasksForWeek(weekOf: string): Promise<Array<{ id: unknown; name: unknown; status: string; completedAt: unknown; url: string }>> {
  const { start, end } = weekRange(weekOf);
  try {
    const { pool } = await import('../db/index');
    const r = await pool.query(
      `SELECT id, title, status, updated_at
       FROM tasks
       WHERE status = 'done'
         AND updated_at >= $1 AND updated_at <= $2
       ORDER BY updated_at DESC`,
      [start, end],
    );
    return (r.rows as Array<{ id: string; title: string; status: string; updated_at: Date }>).map(t => ({
      id: t.id,
      name: t.title,
      status: t.status || 'done',
      completedAt: t.updated_at?.getTime?.() ?? null,
      url: '',
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// GET /api/reports/clients
// ---------------------------------------------------------------------------
router.get('/clients', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const p = await getPerms(userId);
  if (!p?.reportsView && !p?.isOwner) { res.status(403).json({ error: 'forbidden' }); return; }

  try {
    const rows = await db.select().from(billingClients)
      .where(and(eq(billingClients.tenantId, tenantId), eq(billingClients.isActive, true)));
    res.json({ clients: rows });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/reports/generate?clientId=xxx&weekOf=2026-03-24
// ---------------------------------------------------------------------------
router.get('/generate', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const p = await getPerms(userId);
  if (!p?.reportsView && !p?.isOwner) { res.status(403).json({ error: 'forbidden' }); return; }

  const clientId = req.query.clientId as string;
  const weekOf = (req.query.weekOf as string) || new Date().toISOString().split('T')[0];
  if (!clientId) { res.status(400).json({ error: 'clientId required' }); return; }

  try {
    const [client] = await db.select().from(billingClients)
      .where(and(eq(billingClients.id, clientId), eq(billingClients.tenantId, tenantId)))
      .limit(1);
    if (!client) { res.status(404).json({ error: 'client not found' }); return; }

    const { start, end } = weekRange(weekOf);

    const [adMetrics, completedTasks] = await Promise.all([
      client.metaAdAccountId ? fetchWeeklyAdMetrics(client.metaAdAccountId, weekOf) : Promise.resolve(null),
      fetchCompletedTasksForWeek(weekOf),
    ]);

    // --- Benchmark comparisons ---
    const clientAdAccountId = client.metaAdAccountId;
    let benchmark: Record<string, unknown> | null = null;
    let agencyAvg: Record<string, unknown> | null = null;
    let lastWeekMetrics: Record<string, unknown> | null = null;

    // Client benchmark
    try {
      if (clientAdAccountId) {
        const { pool } = await import('../db/index');
        const benchResult = await pool.query(
          `SELECT avg_roas, avg_ctr, total_spend, total_revenue, top_creative_type
           FROM client_benchmarks WHERE ad_account_id = $1 ORDER BY month DESC LIMIT 1`,
          [clientAdAccountId]
        );
        if (benchResult.rows.length > 0) benchmark = benchResult.rows[0] as Record<string, unknown>;
      }
    } catch { /* benchmarks not yet populated */ }

    // Agency average benchmark
    try {
      const { pool } = await import('../db/index');
      const avgResult = await pool.query(
        `SELECT ROUND(AVG(avg_roas)::numeric, 2) AS avg_roas,
                ROUND(AVG(avg_ctr)::numeric, 2) AS avg_ctr
         FROM client_benchmarks
         WHERE month = (SELECT MAX(month) FROM client_benchmarks)`
      );
      if (avgResult.rows.length > 0) agencyAvg = avgResult.rows[0] as Record<string, unknown>;
    } catch { /* non-critical */ }

    // Last week metrics for trend arrows
    try {
      if (clientAdAccountId) {
        const lastWeekDate = new Date(start);
        lastWeekDate.setDate(lastWeekDate.getDate() - 7);
        const lwWeekOf = lastWeekDate.toISOString().split('T')[0];
        lastWeekMetrics = await fetchWeeklyAdMetrics(clientAdAccountId, lwWeekOf) as Record<string, unknown> | null;
        if (lastWeekMetrics && 'error' in lastWeekMetrics) lastWeekMetrics = null;
      }
    } catch { /* non-critical */ }

    // Trend calculations
    const trends: Record<string, string | null> = {
      roasTrend: null, spendTrend: null, purchasesTrend: null,
    };
    if (adMetrics && !('error' in adMetrics) && lastWeekMetrics) {
      const curRoas = Number(adMetrics.roas ?? 0);
      const prevRoas = Number(lastWeekMetrics.roas ?? 0);
      trends.roasTrend = curRoas > prevRoas ? 'up' : curRoas < prevRoas ? 'down' : 'flat';
      trends.spendTrend = Number(adMetrics.spend ?? 0) > Number(lastWeekMetrics.spend ?? 0) ? 'up' : 'down';
      trends.purchasesTrend = Number(adMetrics.purchases ?? 0) > Number(lastWeekMetrics.purchases ?? 0) ? 'up' : 'down';
    }

    // AI recommendations
    let aiRecommendations: string[] = [];
    try {
      const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
      if (ANTHROPIC_KEY && adMetrics && !('error' in adMetrics)) {
        const clientName = String(client.name || '');
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': ANTHROPIC_KEY,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: 'claude-haiku-4-5-20251001',
            max_tokens: 300,
            messages: [{
              role: 'user',
              content: `You are a performance marketing analyst. Based on these Meta Ads metrics for ${clientName}, give exactly 3 brief actionable recommendations (1 sentence each).

This week: Spend ₹${adMetrics.spend}, ROAS ${adMetrics.roas}x, CTR ${adMetrics.ctr}%, Purchases ${adMetrics.purchases}
${benchmark ? `Monthly benchmark: ROAS ${benchmark.avg_roas}x, CTR ${benchmark.avg_ctr}%` : ''}
${agencyAvg ? `Agency average: ROAS ${agencyAvg.avg_roas}x, CTR ${agencyAvg.avg_ctr}%` : ''}
${benchmark?.top_creative_type ? `Best performing creative type: ${benchmark.top_creative_type}` : ''}

Return ONLY a JSON array of 3 strings. No other text.`
            }],
          }),
        });
        const data = await resp.json() as { content?: Array<{ text: string }> };
        const text = data.content?.[0]?.text || '';
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          aiRecommendations = JSON.parse(jsonMatch[0]) as string[];
        }
      }
    } catch { /* AI recommendations are non-critical */ }

    res.json({
      client: {
        id: client.id,
        name: client.name,
        email: client.email,
        phone: client.phone,
        adAccountId: client.metaAdAccountId,
      },
      weekOf,
      weekStart: start.toISOString(),
      weekEnd: end.toISOString(),
      adMetrics,
      completedTasks,
      benchmark: benchmark || null,
      agencyAvg: agencyAvg || null,
      aiRecommendations,
      trends,
      generatedAt: new Date().toISOString(),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/reports/send-pdf?clientId=xxx&weekOf=xxx
// ---------------------------------------------------------------------------
router.post('/send-pdf', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const p = await getPerms(userId);
  if (!p?.reportsView && !p?.isOwner) { res.status(403).json({ error: 'forbidden' }); return; }

  const clientId = req.query.clientId as string;
  const weekOf = (req.query.weekOf as string) || new Date().toISOString().split('T')[0];
  if (!clientId) { res.status(400).json({ error: 'clientId required' }); return; }

  try {
    const [client] = await db.select().from(billingClients)
      .where(and(eq(billingClients.id, clientId), eq(billingClients.tenantId, tenantId)))
      .limit(1);
    if (!client) { res.status(404).json({ error: 'client not found' }); return; }

    const { start, end } = weekRange(weekOf);
    const [adMetrics, completedTasks] = await Promise.all([
      client.metaAdAccountId ? fetchWeeklyAdMetrics(client.metaAdAccountId, weekOf) : Promise.resolve(null),
      fetchCompletedTasksForWeek(weekOf),
    ]);

    // Fetch benchmark + agency avg + trends for PDF
    const pdfExtra = await fetchReportExtras(client.metaAdAccountId, start, adMetrics, String(client.name || ''));

    // Generate PDF buffer
    const pdfBuffer = await generateReportPDF({
      client, weekOf, weekStart: start, weekEnd: end,
      adMetrics, completedTasks,
      benchmark: pdfExtra.benchmark,
      agencyAvg: pdfExtra.agencyAvg,
      aiRecommendations: pdfExtra.aiRecommendations,
      trends: pdfExtra.trends,
    });

    // Send via WhatsApp if client has phone number
    const phoneNumber = client.phone;
    let whatsappResult = null;
    if (phoneNumber && process.env.META_PHONE_NUMBER_ID) {
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      // Upload media first
      const formData = new FormData();
      const blob = new Blob([pdfBuffer.buffer as ArrayBuffer], { type: 'application/pdf' });
      formData.append('file', blob, `report_${client.name}_${weekOf}.pdf`);
      formData.append('type', 'application/pdf');
      formData.append('messaging_product', 'whatsapp');

      const uploadUrl = `https://graph.facebook.com/v19.0/${process.env.META_PHONE_NUMBER_ID}/media`;
      const uploadRes = await fetch(uploadUrl, {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.META_ACCESS_TOKEN || ''}` },
        body: formData,
      });
      const uploadData = await uploadRes.json() as Record<string, string>;
      const mediaId = uploadData.id;

      if (mediaId) {
        const sendRes = await fetch(`https://graph.facebook.com/v19.0/${process.env.META_PHONE_NUMBER_ID}/messages`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${process.env.META_ACCESS_TOKEN || ''}`,
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            to: cleanPhone,
            type: 'document',
            document: {
              id: mediaId,
              caption: `Weekly Performance Report — ${client.name} — Week of ${weekOf}`,
              filename: `GE_Report_${client.name}_${weekOf}.pdf`,
            },
          }),
        });
        whatsappResult = await sendRes.json();
      }
    }

    res.json({
      success: true,
      weekOf,
      clientName: client.name,
      whatsappSent: !!whatsappResult,
      pdfSize: pdfBuffer.length,
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/reports/pdf?clientId=xxx&weekOf=xxx — download PDF directly
// ---------------------------------------------------------------------------
router.get('/pdf', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const p = await getPerms(userId);
  if (!p?.reportsView && !p?.isOwner) { res.status(403).json({ error: 'forbidden' }); return; }

  const clientId = req.query.clientId as string;
  const weekOf = (req.query.weekOf as string) || new Date().toISOString().split('T')[0];
  if (!clientId) { res.status(400).json({ error: 'clientId required' }); return; }

  try {
    const [client] = await db.select().from(billingClients)
      .where(and(eq(billingClients.id, clientId), eq(billingClients.tenantId, tenantId)))
      .limit(1);
    if (!client) { res.status(404).json({ error: 'client not found' }); return; }

    const { start, end } = weekRange(weekOf);
    const [adMetrics, completedTasks] = await Promise.all([
      client.metaAdAccountId ? fetchWeeklyAdMetrics(client.metaAdAccountId, weekOf) : Promise.resolve(null),
      fetchCompletedTasksForWeek(weekOf),
    ]);

    // Fetch benchmark + agency avg + trends for PDF
    const pdfExtra = await fetchReportExtras(client.metaAdAccountId, start, adMetrics, String(client.name || ''));

    const pdfBuffer = await generateReportPDF({
      client, weekOf, weekStart: start, weekEnd: end,
      adMetrics, completedTasks,
      benchmark: pdfExtra.benchmark,
      agencyAvg: pdfExtra.agencyAvg,
      aiRecommendations: pdfExtra.aiRecommendations,
      trends: pdfExtra.trends,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="GE_Report_${client.name}_${weekOf}.pdf"`);
    res.send(pdfBuffer);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// Shared helper: fetch benchmarks, agency avg, last-week trends, AI recs
// ---------------------------------------------------------------------------
interface ReportExtras {
  benchmark: Record<string, unknown> | null;
  agencyAvg: Record<string, unknown> | null;
  aiRecommendations: string[];
  trends: Record<string, string | null>;
}

async function fetchReportExtras(
  adAccountId: string | null | undefined,
  weekStart: Date,
  adMetrics: Record<string, unknown> | null,
  clientName: string,
): Promise<ReportExtras> {
  let benchmark: Record<string, unknown> | null = null;
  let agencyAvg: Record<string, unknown> | null = null;
  let lastWeekMetrics: Record<string, unknown> | null = null;

  // Client benchmark
  try {
    if (adAccountId) {
      const { pool } = await import('../db/index');
      const benchResult = await pool.query(
        `SELECT avg_roas, avg_ctr, total_spend, total_revenue, top_creative_type
         FROM client_benchmarks WHERE ad_account_id = $1 ORDER BY month DESC LIMIT 1`,
        [adAccountId]
      );
      if (benchResult.rows.length > 0) benchmark = benchResult.rows[0] as Record<string, unknown>;
    }
  } catch { /* benchmarks not yet populated */ }

  // Agency average benchmark
  try {
    const { pool } = await import('../db/index');
    const avgResult = await pool.query(
      `SELECT ROUND(AVG(avg_roas)::numeric, 2) AS avg_roas,
              ROUND(AVG(avg_ctr)::numeric, 2) AS avg_ctr
       FROM client_benchmarks
       WHERE month = (SELECT MAX(month) FROM client_benchmarks)`
    );
    if (avgResult.rows.length > 0) agencyAvg = avgResult.rows[0] as Record<string, unknown>;
  } catch { /* non-critical */ }

  // Last week metrics for trend arrows
  try {
    if (adAccountId) {
      const lastWeekDate = new Date(weekStart);
      lastWeekDate.setDate(lastWeekDate.getDate() - 7);
      const lwWeekOf = lastWeekDate.toISOString().split('T')[0];
      lastWeekMetrics = await fetchWeeklyAdMetrics(adAccountId, lwWeekOf) as Record<string, unknown> | null;
      if (lastWeekMetrics && 'error' in lastWeekMetrics) lastWeekMetrics = null;
    }
  } catch { /* non-critical */ }

  // Trend calculations
  const trends: Record<string, string | null> = {
    roasTrend: null, spendTrend: null, purchasesTrend: null,
  };
  if (adMetrics && !('error' in adMetrics) && lastWeekMetrics) {
    const curRoas = Number(adMetrics.roas ?? 0);
    const prevRoas = Number(lastWeekMetrics.roas ?? 0);
    trends.roasTrend = curRoas > prevRoas ? 'up' : curRoas < prevRoas ? 'down' : 'flat';
    trends.spendTrend = Number(adMetrics.spend ?? 0) > Number(lastWeekMetrics.spend ?? 0) ? 'up' : 'down';
    trends.purchasesTrend = Number(adMetrics.purchases ?? 0) > Number(lastWeekMetrics.purchases ?? 0) ? 'up' : 'down';
  }

  // AI recommendations
  let aiRecommendations: string[] = [];
  try {
    const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_KEY;
    if (ANTHROPIC_KEY && adMetrics && !('error' in adMetrics)) {
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `You are a performance marketing analyst. Based on these Meta Ads metrics for ${clientName}, give exactly 3 brief actionable recommendations (1 sentence each).

This week: Spend ₹${adMetrics.spend}, ROAS ${adMetrics.roas}x, CTR ${adMetrics.ctr}%, Purchases ${adMetrics.purchases}
${benchmark ? `Monthly benchmark: ROAS ${benchmark.avg_roas}x, CTR ${benchmark.avg_ctr}%` : ''}
${agencyAvg ? `Agency average: ROAS ${agencyAvg.avg_roas}x, CTR ${agencyAvg.avg_ctr}%` : ''}
${benchmark?.top_creative_type ? `Best performing creative type: ${benchmark.top_creative_type}` : ''}

Return ONLY a JSON array of 3 strings. No other text.`
          }],
        }),
      });
      const data = await resp.json() as { content?: Array<{ text: string }> };
      const text = data.content?.[0]?.text || '';
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        aiRecommendations = JSON.parse(jsonMatch[0]) as string[];
      }
    }
  } catch { /* AI recommendations are non-critical */ }

  return { benchmark, agencyAvg, aiRecommendations, trends };
}

// ---------------------------------------------------------------------------
// PDF generation helper
// ---------------------------------------------------------------------------
interface ReportData {
  client: Record<string, unknown>;
  weekOf: string;
  weekStart: Date;
  weekEnd: Date;
  adMetrics: Record<string, unknown> | null;
  completedTasks: Array<{ id: unknown; name: unknown; completedAt: unknown }>;
  benchmark?: Record<string, unknown> | null;
  agencyAvg?: Record<string, unknown> | null;
  aiRecommendations?: string[];
  trends?: Record<string, string | null>;
}

function trendArrow(trend: string | null | undefined): string {
  if (trend === 'up') return ' ↑';
  if (trend === 'down') return ' ↓';
  if (trend === 'flat') return ' →';
  return '';
}

function generateReportPDF(data: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const { client, weekOf, weekStart, weekEnd, adMetrics, completedTasks,
            benchmark, agencyAvg, aiRecommendations, trends } = data;
    const clientName = String(client.name || '');
    const dateStr = `${weekStart.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} – ${weekEnd.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`;

    // Header
    doc.rect(0, 0, 595, 80).fill('#0f172a');
    doc.fontSize(22).fillColor('#ffffff').text('Growth Escalators', 50, 20);
    doc.fontSize(10).fillColor('#94a3b8').text('Weekly Performance Report', 50, 48);
    doc.fillColor('#f97316').text('growthescalators.com', 50, 62);

    doc.moveDown(4);

    // Client + Week
    doc.fontSize(16).fillColor('#0f172a').text(clientName, 50, 100);
    doc.fontSize(11).fillColor('#64748b').text(`Week: ${dateStr}`, 50, 122);
    doc.fontSize(11).fillColor('#64748b').text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 138);

    doc.moveTo(50, 160).lineTo(545, 160).strokeColor('#e2e8f0').stroke();

    // Ads Metrics (with trend arrows)
    doc.moveDown();
    doc.y = 175;
    doc.fontSize(13).fillColor('#0f172a').text('Meta Ads Performance', 50, doc.y);
    doc.moveDown(0.5);

    if (adMetrics && !('error' in adMetrics)) {
      const roasArrow = trendArrow(trends?.roasTrend);
      const spendArrow = trendArrow(trends?.spendTrend);
      const purchasesArrow = trendArrow(trends?.purchasesTrend);

      const metrics: Array<[string, string]> = [
        ['Total Spend', `₹${adMetrics.spend}${spendArrow}`],
        ['Impressions', String(adMetrics.impressions)],
        ['Clicks', String(adMetrics.clicks)],
        ['CTR', `${adMetrics.ctr}%`],
        ['CPC', `₹${adMetrics.cpc}`],
        ['Purchases', `${adMetrics.purchases}${purchasesArrow}`],
        ['ROAS', `${adMetrics.roas}x${roasArrow}`],
      ];
      metrics.forEach(([label, value], i) => {
        const x = i % 2 === 0 ? 50 : 310;
        const y = doc.y + (i % 2 === 0 ? 0 : -22);
        doc.rect(x, y, 240, 40).fill('#f8fafc').stroke('#e2e8f0');
        doc.fontSize(9).fillColor('#64748b').text(label, x + 12, y + 8);
        doc.fontSize(14).fillColor('#0f172a').text(value, x + 12, y + 20);
        if (i % 2 === 1) doc.y = y + 50;
      });
    } else if (adMetrics && 'error' in adMetrics) {
      doc.fontSize(11).fillColor('#ef4444').text(`Meta Ads error: ${adMetrics.error}`, 50, doc.y);
    } else {
      doc.fontSize(11).fillColor('#94a3b8').text('No Meta Ads account linked for this client.', 50, doc.y);
    }

    doc.moveDown(2);

    // --- How You Compare (benchmark section) ---
    if (adMetrics && !('error' in adMetrics) && (benchmark || agencyAvg)) {
      doc.fontSize(13).fillColor('#0f172a').text('How You Compare', 50, doc.y);
      doc.moveDown(0.5);
      const compY = doc.y;

      if (benchmark) {
        doc.rect(50, compY, 240, 40).fill('#eff6ff').stroke('#bfdbfe');
        doc.fontSize(9).fillColor('#1e40af').text('Your Avg ROAS (month)', 62, compY + 8);
        doc.fontSize(13).fillColor('#1e40af').text(`${benchmark.avg_roas}x`, 62, compY + 21);
      }
      if (agencyAvg) {
        doc.rect(310, compY, 240, 40).fill('#f0fdf4').stroke('#bbf7d0');
        doc.fontSize(9).fillColor('#166534').text('Agency Avg ROAS', 322, compY + 8);
        doc.fontSize(13).fillColor('#166534').text(`${agencyAvg.avg_roas}x`, 322, compY + 21);
      }
      doc.y = compY + 50;

      const comp2Y = doc.y;
      if (benchmark) {
        doc.rect(50, comp2Y, 240, 40).fill('#eff6ff').stroke('#bfdbfe');
        doc.fontSize(9).fillColor('#1e40af').text('Your Avg CTR (month)', 62, comp2Y + 8);
        doc.fontSize(13).fillColor('#1e40af').text(`${benchmark.avg_ctr}%`, 62, comp2Y + 21);
      }
      if (agencyAvg) {
        doc.rect(310, comp2Y, 240, 40).fill('#f0fdf4').stroke('#bbf7d0');
        doc.fontSize(9).fillColor('#166534').text('Agency Avg CTR', 322, comp2Y + 8);
        doc.fontSize(13).fillColor('#166534').text(`${agencyAvg.avg_ctr}%`, 322, comp2Y + 21);
      }
      doc.y = comp2Y + 50;

      if (benchmark?.top_creative_type) {
        doc.fontSize(10).fillColor('#64748b').text(
          `Best performing creative type: ${benchmark.top_creative_type}`, 50, doc.y
        );
        doc.moveDown(0.5);
      }

      doc.moveDown(1);
    }

    // --- AI Recommendations ---
    if (aiRecommendations && aiRecommendations.length > 0) {
      doc.fontSize(13).fillColor('#0f172a').text('Recommendations', 50, doc.y);
      doc.moveDown(0.5);

      aiRecommendations.slice(0, 3).forEach((rec, i) => {
        const recY = doc.y;
        doc.rect(50, recY, 495, 28).fill('#fefce8').stroke('#fde68a');
        doc.fontSize(10).fillColor('#92400e').text(`${i + 1}. ${rec}`, 62, recY + 9, { width: 470 });
        doc.y = recY + 34;
      });

      doc.moveDown(1);
    }

    // Completed Tasks
    doc.fontSize(13).fillColor('#0f172a').text('Completed Tasks This Week', 50, doc.y);
    doc.moveDown(0.5);

    if (completedTasks.length === 0) {
      doc.fontSize(11).fillColor('#94a3b8').text('No completed tasks found for this week.', 50, doc.y);
    } else {
      completedTasks.slice(0, 15).forEach((task) => {
        if (doc.y > 720) return; // avoid overflowing past footer
        const taskDate = task.completedAt ? new Date(Number(task.completedAt)).toLocaleDateString('en-IN') : '';
        doc.rect(50, doc.y, 495, 28).fill('#f0fdf4').stroke('#bbf7d0');
        doc.fontSize(10).fillColor('#166534').text(`✓  ${String(task.name || '')}`, 62, doc.y + 9, { width: 380 });
        doc.fontSize(9).fillColor('#4ade80').text(taskDate, 490, doc.y + 10, { align: 'right' });
        doc.y += 34;
      });
    }

    // Footer
    doc.moveTo(50, 760).lineTo(545, 760).strokeColor('#e2e8f0').stroke();
    doc.fontSize(9).fillColor('#94a3b8').text('Growth Escalators | jatin@growthescalators.com | +91 77338 88883', 50, 770, { align: 'center', width: 495 });

    doc.end();
  });
}

// ---------------------------------------------------------------------------
// Monthly report helpers
// ---------------------------------------------------------------------------
function monthRange(monthStr: string): { start: Date; end: Date } {
  const [year, month] = monthStr.split('-').map(Number);
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999); // last day of month
  return { start, end };
}

async function fetchMonthlyAdMetrics(adAccountId: string, month: string) {
  const token = getAdsToken();
  if (!token) return null;

  const { start, end } = monthRange(month);
  const fmt = (d: Date) => d.toISOString().split('T')[0];
  const timeRange = JSON.stringify({ since: fmt(start), until: fmt(end) });

  const fields = ['spend', 'impressions', 'clicks', 'ctr', 'cpc', 'cpm', 'actions', 'action_values'].join(',');
  const params = new URLSearchParams({ fields, time_range: timeRange, level: 'account', access_token: token });
  const url = `${META_API_BASE}/${adAccountId}/insights?${params.toString()}`;

  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    const data = await r.json() as Record<string, unknown>;
    if (data.error) return null;
    const row = ((data as { data: Array<Record<string,unknown>> }).data || [])[0];
    if (!row) return { spend: 0, impressions: 0, clicks: 0, purchases: 0, roas: 0, ctr: 0, cpc: 0, cpm: 0, purchaseValue: 0 };

    const actions = (row.actions as Array<{ action_type: string; value: string }>) || [];
    const actionValues = (row.action_values as Array<{ action_type: string; value: string }>) || [];
    const purchases = actions.filter(a => a.action_type === 'offsite_conversion.fb_pixel_purchase').reduce((s, a) => s + Number(a.value || 0), 0);
    const purchaseValue = actionValues.filter(a => a.action_type === 'offsite_conversion.fb_pixel_purchase').reduce((s, a) => s + Number(a.value || 0), 0);
    const spend = Number(row.spend || 0);

    return {
      spend: Math.round(spend * 100) / 100, impressions: Number(row.impressions || 0),
      clicks: Number(row.clicks || 0), ctr: Math.round(Number(row.ctr || 0) * 100) / 100,
      cpc: Math.round(Number(row.cpc || 0) * 100) / 100, cpm: Math.round(Number(row.cpm || 0) * 100) / 100,
      purchases, purchaseValue: Math.round(purchaseValue * 100) / 100,
      roas: spend > 0 ? Math.round((purchaseValue / spend) * 100) / 100 : 0,
    };
  } catch { return null; }
}

// Note: this deliberately still has no client_domain filter (a pre-existing
// bug, invisible today only because there's a single tenant) — that's a
// separate, out-of-scope issue from H18 tenant isolation. Only tenant_id
// scoping is added here, consistent with the rest of this file.
async function fetchMonthlySeoSummary(clientName: string, month: string, tenantId: string) {
  const { pool } = await import('../db/index');
  const { start, end } = monthRange(month);

  try {
    const [keywordRes, healthRes, alertRes] = await Promise.all([
      pool.query(`
        SELECT keyword, current_position AS position, previous_position,
          (previous_position - current_position) AS change
        FROM keyword_rankings
        WHERE checked_at >= $1 AND checked_at <= $2 AND tenant_id = $3
        ORDER BY (previous_position - current_position) DESC NULLS LAST
        LIMIT 20
      `, [start, end, tenantId]),
      pool.query(`
        SELECT pagespeed_mobile, pagespeed_desktop
        FROM site_health_metrics
        WHERE tenant_id = $1
        ORDER BY checked_at DESC LIMIT 1
      `, [tenantId]),
      pool.query(`
        SELECT COUNT(*) AS count FROM seo_alerts_log
        WHERE created_at >= $1 AND created_at <= $2 AND tenant_id = $3
      `, [start, end, tenantId]),
    ]);

    const keywords = keywordRes.rows as Array<Record<string, unknown>>;
    const gains = keywords.filter(k => Number(k.change ?? 0) > 0).slice(0, 10);
    const losses = keywords.filter(k => Number(k.change ?? 0) < 0).slice(0, 5);
    const health = healthRes.rows[0] as Record<string, unknown> | undefined;

    return {
      keywordGains: gains.map(k => ({ keyword: String(k.keyword ?? ''), change: Number(k.change), position: Number(k.position) })),
      keywordLosses: losses.map(k => ({ keyword: String(k.keyword ?? ''), change: Number(k.change), position: Number(k.position) })),
      mobileScore: health?.pagespeed_mobile != null ? Number(health.pagespeed_mobile) : null,
      desktopScore: health?.pagespeed_desktop != null ? Number(health.pagespeed_desktop) : null,
      alertCount: Number((alertRes.rows[0] as Record<string, string>)?.count ?? '0'),
    };
  } catch { return null; }
}

async function fetchMonthlyBilling(clientId: string, tenantId: string, month: string) {
  const { pool } = await import('../db/index');
  const { start, end } = monthRange(month);

  try {
    const [invoiceRes, retainerRes] = await Promise.all([
      pool.query(`
        SELECT
          COALESCE(SUM(total_amount), 0) AS invoiced,
          COALESCE(SUM(amount_paid), 0) AS paid,
          COUNT(*) AS count,
          COALESCE(SUM(amount_due), 0) AS due
        FROM invoices
        WHERE client_id = $1 AND tenant_id = $2
          AND invoice_date >= $3 AND invoice_date <= $4
          AND status != 'cancelled'
      `, [clientId, tenantId, start, end]),
      pool.query(`
        SELECT COALESCE(retainer_amount, 0) AS retainer
        FROM billing_clients WHERE id = $1
      `, [clientId]),
    ]);

    const inv = invoiceRes.rows[0] as Record<string, string>;
    return {
      invoicedPaise: Number(inv.invoiced ?? '0'),
      paidPaise: Number(inv.paid ?? '0'),
      duePaise: Number(inv.due ?? '0'),
      invoiceCount: Number(inv.count ?? '0'),
      retainerPaise: Number((retainerRes.rows[0] as Record<string, string>)?.retainer ?? '0'),
    };
  } catch { return null; }
}

// ---------------------------------------------------------------------------
// GET /api/reports/generate-monthly?clientId=xxx&month=2026-03
// ---------------------------------------------------------------------------
router.get('/generate-monthly', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const p = await getPerms(userId);
  if (!p?.reportsView && !p?.isOwner) { res.status(403).json({ error: 'forbidden' }); return; }

  const clientId = req.query.clientId as string;
  const month = (req.query.month as string) || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  if (!clientId) { res.status(400).json({ error: 'clientId required' }); return; }

  try {
    const [client] = await db.select().from(billingClients)
      .where(and(eq(billingClients.id, clientId), eq(billingClients.tenantId, tenantId)))
      .limit(1);
    if (!client) { res.status(404).json({ error: 'client not found' }); return; }

    const { start, end } = monthRange(month);
    const [adMetrics, seoSummary, billing] = await Promise.all([
      client.metaAdAccountId ? fetchMonthlyAdMetrics(client.metaAdAccountId, month) : Promise.resolve(null),
      fetchMonthlySeoSummary(client.name, month, tenantId),
      fetchMonthlyBilling(clientId, tenantId, month),
    ]);

    res.json({
      client: { id: client.id, name: client.name, email: client.email, phone: client.phone, adAccountId: client.metaAdAccountId },
      month,
      monthStart: start.toISOString(),
      monthEnd: end.toISOString(),
      adMetrics,
      seo: seoSummary,
      billing,
      generatedAt: new Date().toISOString(),
    });
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/reports/monthly-pdf?clientId=xxx&month=2026-03
// ---------------------------------------------------------------------------
router.get('/monthly-pdf', async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const tenantId = req.user!.tenantId;
  const p = await getPerms(userId);
  if (!p?.reportsView && !p?.isOwner) { res.status(403).json({ error: 'forbidden' }); return; }

  const clientId = req.query.clientId as string;
  const month = (req.query.month as string) || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  if (!clientId) { res.status(400).json({ error: 'clientId required' }); return; }

  try {
    const [client] = await db.select().from(billingClients)
      .where(and(eq(billingClients.id, clientId), eq(billingClients.tenantId, tenantId)))
      .limit(1);
    if (!client) { res.status(404).json({ error: 'client not found' }); return; }

    const { start, end } = monthRange(month);
    const [adMetrics, seoSummary, billing] = await Promise.all([
      client.metaAdAccountId ? fetchMonthlyAdMetrics(client.metaAdAccountId, month) : Promise.resolve(null),
      fetchMonthlySeoSummary(client.name, month, tenantId),
      fetchMonthlyBilling(clientId, tenantId, month),
    ]);

    const pdfBuffer = await generateMonthlyReportPDF({
      client, month, monthStart: start, monthEnd: end,
      adMetrics, seo: seoSummary, billing,
    });

    const monthLabel = start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="GE_Monthly_${client.name}_${month}.pdf"`);
    res.send(pdfBuffer);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// Monthly report PDF generation
// ---------------------------------------------------------------------------
interface MonthlyReportData {
  client: Record<string, unknown>;
  month: string;
  monthStart: Date;
  monthEnd: Date;
  adMetrics: Record<string, unknown> | null;
  seo: {
    keywordGains: Array<{ keyword: string; change: number; position: number }>;
    keywordLosses: Array<{ keyword: string; change: number; position: number }>;
    mobileScore: number | null;
    desktopScore: number | null;
    alertCount: number;
  } | null;
  billing: {
    invoicedPaise: number;
    paidPaise: number;
    duePaise: number;
    invoiceCount: number;
    retainerPaise: number;
  } | null;
}

function generateMonthlyReportPDF(data: MonthlyReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 50 });
    const buffers: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => buffers.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(buffers)));
    doc.on('error', reject);

    const { client, month, monthStart, monthEnd, adMetrics, seo, billing } = data;
    const clientName = String(client.name || '');
    const monthLabel = monthStart.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
    const fmtINR = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`;

    // Header
    doc.rect(0, 0, 595, 80).fill('#0f172a');
    doc.fontSize(22).fillColor('#ffffff').text('Growth Escalators', 50, 20);
    doc.fontSize(10).fillColor('#94a3b8').text('Monthly Performance Report', 50, 48);
    doc.fillColor('#f97316').text('growthescalators.com', 50, 62);

    // Client + Month
    doc.fontSize(16).fillColor('#0f172a').text(clientName, 50, 100);
    doc.fontSize(11).fillColor('#64748b').text(`Month: ${monthLabel}`, 50, 122);
    doc.fontSize(11).fillColor('#64748b').text(`Generated: ${new Date().toLocaleDateString('en-IN')}`, 50, 138);
    doc.moveTo(50, 160).lineTo(545, 160).strokeColor('#e2e8f0').stroke();

    // ── Section 1: Meta Ads ──
    doc.y = 175;
    doc.fontSize(13).fillColor('#0f172a').text('Meta Ads Performance', 50, doc.y);
    doc.moveDown(0.5);

    if (adMetrics && !('error' in adMetrics)) {
      const metrics: Array<[string, string]> = [
        ['Total Spend', `₹${adMetrics.spend}`],
        ['Impressions', String(adMetrics.impressions)],
        ['Clicks', String(adMetrics.clicks)],
        ['ROAS', `${adMetrics.roas}x`],
        ['Purchases', String(adMetrics.purchases)],
        ['Revenue', `₹${adMetrics.purchaseValue}`],
      ];
      metrics.forEach(([label, value], i) => {
        const x = (i % 3) * 165 + 50;
        if (i % 3 === 0 && i > 0) doc.y += 50;
        const y = doc.y;
        doc.rect(x, y, 155, 40).fill('#f8fafc').stroke('#e2e8f0');
        doc.fontSize(9).fillColor('#64748b').text(label, x + 10, y + 8);
        doc.fontSize(13).fillColor('#0f172a').text(value, x + 10, y + 21);
      });
      doc.y += 55;
    } else {
      doc.fontSize(11).fillColor('#94a3b8').text('No Meta Ads account linked.', 50, doc.y);
      doc.moveDown();
    }

    // ── Section 2: SEO ──
    doc.moveDown();
    doc.fontSize(13).fillColor('#0f172a').text('SEO Performance', 50, doc.y);
    doc.moveDown(0.5);

    if (seo) {
      // PageSpeed scores
      if (seo.mobileScore != null || seo.desktopScore != null) {
        const scoreY = doc.y;
        doc.rect(50, scoreY, 155, 40).fill('#f0fdf4').stroke('#bbf7d0');
        doc.fontSize(9).fillColor('#166534').text('Mobile Score', 60, scoreY + 8);
        doc.fontSize(14).fillColor('#166534').text(seo.mobileScore != null ? String(seo.mobileScore) : '—', 60, scoreY + 21);
        doc.rect(215, scoreY, 155, 40).fill('#f0fdf4').stroke('#bbf7d0');
        doc.fontSize(9).fillColor('#166534').text('Desktop Score', 225, scoreY + 8);
        doc.fontSize(14).fillColor('#166534').text(seo.desktopScore != null ? String(seo.desktopScore) : '—', 225, scoreY + 21);
        doc.rect(380, scoreY, 155, 40).fill('#fefce8').stroke('#fde68a');
        doc.fontSize(9).fillColor('#92400e').text('Alerts This Month', 390, scoreY + 8);
        doc.fontSize(14).fillColor('#92400e').text(String(seo.alertCount), 390, scoreY + 21);
        doc.y = scoreY + 50;
      }

      // Keyword movers
      if (seo.keywordGains.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#166534').text(`↑ Top Keyword Gains (${seo.keywordGains.length})`, 50, doc.y);
        doc.moveDown(0.3);
        seo.keywordGains.slice(0, 5).forEach(kw => {
          doc.fontSize(9).fillColor('#0f172a').text(`  ${kw.keyword}`, 50, doc.y, { continued: true });
          doc.fillColor('#166534').text(`  +${kw.change} → pos ${kw.position}`, { continued: false });
        });
      }
      if (seo.keywordLosses.length > 0) {
        doc.moveDown(0.5);
        doc.fontSize(10).fillColor('#dc2626').text(`↓ Keyword Losses (${seo.keywordLosses.length})`, 50, doc.y);
        doc.moveDown(0.3);
        seo.keywordLosses.slice(0, 3).forEach(kw => {
          doc.fontSize(9).fillColor('#0f172a').text(`  ${kw.keyword}`, 50, doc.y, { continued: true });
          doc.fillColor('#dc2626').text(`  ${kw.change} → pos ${kw.position}`, { continued: false });
        });
      }
    } else {
      doc.fontSize(11).fillColor('#94a3b8').text('No SEO data available for this period.', 50, doc.y);
    }

    // ── Section 3: Billing ──
    doc.moveDown(1.5);
    doc.fontSize(13).fillColor('#0f172a').text('Billing Summary', 50, doc.y);
    doc.moveDown(0.5);

    if (billing && billing.invoiceCount > 0) {
      const billingY = doc.y;
      const bMetrics: Array<[string, string, string]> = [
        ['Invoiced', fmtINR(billing.invoicedPaise), '#0f172a'],
        ['Received', fmtINR(billing.paidPaise), '#166534'],
        ['Outstanding', fmtINR(billing.duePaise), billing.duePaise > 0 ? '#dc2626' : '#166534'],
        ['Retainer', fmtINR(billing.retainerPaise), '#0f172a'],
      ];
      bMetrics.forEach(([label, value, color], i) => {
        const x = (i % 4) * 125 + 50;
        doc.rect(x, billingY, 115, 40).fill('#f8fafc').stroke('#e2e8f0');
        doc.fontSize(9).fillColor('#64748b').text(label, x + 8, billingY + 8);
        doc.fontSize(12).fillColor(color).text(value, x + 8, billingY + 22);
      });
      doc.y = billingY + 50;
    } else {
      doc.fontSize(11).fillColor('#94a3b8').text('No invoices for this month.', 50, doc.y);
    }

    // Footer
    doc.moveTo(50, 760).lineTo(545, 760).strokeColor('#e2e8f0').stroke();
    doc.fontSize(9).fillColor('#94a3b8').text('Growth Escalators | jatin@growthescalators.com | +91 77338 88883', 50, 770, { align: 'center', width: 495 });

    doc.end();
  });
}

export default router;
