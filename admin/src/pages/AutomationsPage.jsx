import React, { useEffect, useState, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';

// ─────────────────────────────────────────────────────────
// Tool badge component
// ─────────────────────────────────────────────────────────
const TOOL_COLORS = {
  'n8n':              'bg-blue-100 text-blue-700',
  'Brevo':            'bg-green-100 text-green-700',
  'Meta WA':          'bg-purple-100 text-purple-700',
  'Cal.com':          'bg-amber-100 text-amber-700',
  'Cashfree':         'bg-red-100 text-red-600',
  'Backend':          'bg-slate-100 text-slate-600',
  'Worker':           'bg-slate-100 text-slate-600',
  'PostgreSQL':       'bg-sky-100 text-sky-700',
};

function ToolBadge({ tool }) {
  const cls = TOOL_COLORS[tool] ?? 'bg-slate-100 text-slate-500';
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cls}`}>{tool}</span>
  );
}

// ─────────────────────────────────────────────────────────
// Flow node
// ─────────────────────────────────────────────────────────
const NODE_COLORS = {
  trigger:   'bg-amber-100 text-amber-800 border-amber-200',
  action:    'bg-blue-100 text-blue-800 border-blue-200',
  condition: 'bg-purple-100 text-purple-800 border-purple-200',
  output:    'bg-emerald-100 text-emerald-800 border-emerald-200',
};

function FlowNode({ type, label }) {
  const cls = NODE_COLORS[type] ?? NODE_COLORS.action;
  return (
    <span className={`text-xs px-2.5 py-1 rounded-lg border font-medium whitespace-nowrap ${cls}`}>
      {label}
    </span>
  );
}

function FlowRow({ nodes }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {nodes.map((node, i) => (
        <React.Fragment key={i}>
          <FlowNode type={node.type} label={node.label} />
          {i < nodes.length - 1 && (
            <span className="text-slate-300 text-xs font-bold">→</span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Stat chip
// ─────────────────────────────────────────────────────────
function StatChip({ label, value, color }) {
  const colors = {
    blue:  'bg-blue-50 text-blue-700',
    green: 'bg-emerald-50 text-emerald-700',
    amber: 'bg-amber-50 text-amber-700',
    red:   'bg-red-50 text-red-600',
    gray:  'bg-slate-100 text-slate-600',
  };
  return (
    <span className={`text-xs px-2.5 py-1 rounded-lg font-medium ${colors[color ?? 'gray']}`}>
      {label}: <span className="font-bold">{value ?? '—'}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────
// Automation Card
// ─────────────────────────────────────────────────────────
function AutomationCard({ title, tools, status, statusLabel, flows, stats, footer, defaultOpen }) {
  const [open, setOpen] = useState(defaultOpen ?? false);

  const dotColor = status === 'live'  ? 'bg-green-500'
                 : status === 'amber' ? 'bg-amber-400'
                 : 'bg-red-500';
  const badgeColor = status === 'live'  ? 'bg-emerald-100 text-emerald-700'
                   : status === 'amber' ? 'bg-amber-100 text-amber-700'
                   : 'bg-red-100 text-red-600';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
      {/* Card header */}
      <button
        className="w-full flex items-center gap-3 px-5 py-4 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-bold text-slate-900">{title}</span>
            {tools.map((t) => <ToolBadge key={t} tool={t} />)}
          </div>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold shrink-0 ${badgeColor}`}>
          {statusLabel ?? (status === 'live' ? 'Live' : status === 'amber' ? 'Partial' : 'Error')}
        </span>
        <svg
          className={`w-4 h-4 text-slate-400 transition-transform shrink-0 ${open ? 'rotate-180' : ''}`}
          fill="none" stroke="currentColor" viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {/* Expanded content */}
      {open && (
        <div className="px-5 pb-5 border-t border-slate-100 pt-4 space-y-4">
          {/* Flows */}
          {flows?.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Flow</p>
              {flows.map((row, i) => <FlowRow key={i} nodes={row} />)}
            </div>
          )}

          {/* Live stats */}
          {stats?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">Live stats</p>
              <div className="flex flex-wrap gap-2">
                {stats.map((s, i) => (
                  <StatChip key={i} label={s.label} value={s.value} color={s.color} />
                ))}
              </div>
            </div>
          )}

          {/* Footer text */}
          {footer && (
            <p className="text-xs text-slate-400 font-mono bg-slate-50 rounded-lg px-3 py-2">{footer}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// Skeleton loader
// ─────────────────────────────────────────────────────────
function Skeleton() {
  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 px-8 py-6 space-y-6">
        <div className="h-8 bg-slate-200 rounded-xl w-64 animate-pulse" />
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map((n) => <div key={n} className="h-24 bg-slate-200 rounded-2xl animate-pulse" />)}
        </div>
        <div className="space-y-3">
          {[1,2,3,4].map((n) => <div key={n} className="h-16 bg-slate-200 rounded-2xl animate-pulse" />)}
        </div>
      </main>
    </div>
  );
}

// ─────────────────────────────────────────────────────────
// FILTER CATEGORIES
// ─────────────────────────────────────────────────────────
const FILTER_PILLS = ['All', 'n8n', 'Brevo', 'Meta WA', 'Cal.com', 'Backend', 'Cashfree'];

function cardMatchesFilter(tools, filter) {
  if (filter === 'All') return true;
  return tools.some((t) => t === filter);
}

// ─────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────
export default function AutomationsPage() {
  const [hubStats, setHubStats] = useState(null);
  const [pipelineAutomations, setPipelineAutomations] = useState([]);
  const [blockerCount, setBlockerCount] = useState(null);
  const [loading, setLoading] = useState(true);
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [activeFilter, setActiveFilter] = useState('All');
  const timerRef = useRef(null);
  const intervalRef = useRef(null);

  const fetchData = useCallback(async () => {
    const [stats, automations, blockers] = await Promise.all([
      apiFetch('/api/automations/hub-stats'),
      apiFetch('/api/automations').catch(() => ({ automations: [] })),
      apiFetch('/api/blockers').catch(() => null),
    ]);
    if (stats) setHubStats(stats);
    if (automations?.automations) setPipelineAutomations(automations.automations);
    if (blockers !== null) setBlockerCount(blockers?.totalCount ?? 0);
    setSecondsAgo(0);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    // auto-refresh every 30s
    intervalRef.current = setInterval(fetchData, 30000);
    return () => clearInterval(intervalRef.current);
  }, [fetchData]);

  // seconds-ago counter
  useEffect(() => {
    timerRef.current = setInterval(() => {
      setSecondsAgo((s) => s + 1);
    }, 1000);
    return () => clearInterval(timerRef.current);
  }, []);

  if (loading) return <Skeleton />;

  const { summary, sequences, jobs, funnels, contacts } = hubStats ?? {};

  // Helper: find sequence by name
  function seq(name) {
    return sequences?.find((s) => s.name?.toLowerCase().includes(name.toLowerCase()));
  }

  // Helper: find job type stats
  function jobType(type) {
    return jobs?.byType?.find((j) => j.jobType === type) ?? { count: 0, firedToday: 0, lastRun: null };
  }

  // Helper: find funnel by slug
  function funnel(slug) {
    return funnels?.find((f) => f.slug?.toLowerCase().includes(slug.toLowerCase()));
  }

  function relTime(dateStr) {
    if (!dateStr) return 'Never';
    const diff = Date.now() - new Date(dateStr).getTime();
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'Just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  // ── Automation definitions ──────────────────────────────
  const d2cSeq = seq('d2c');
  const healthSeq = seq('health');
  const emailSeq = seq('email');
  const bookingJob = jobType('booking_processed');
  const purchaseJob = jobType('purchase_completed');
  const inboundWaJob = jobType('inbound_wa');
  const hotLeadJob = jobType('hot_lead_alert');
  const d2cFunnel = funnel('d2c');

  const allCards = [
    // GROUP 1
    {
      group: 'Lead capture & qualification',
      title: 'Cal.com booking → qualify → CRM',
      tools: ['Cal.com', 'n8n', 'Backend'],
      status: 'live',
      flows: [
        [
          { type: 'trigger', label: 'Cal.com booking created' },
          { type: 'action', label: 'POST /webhooks/calcom' },
          { type: 'condition', label: 'Score answers 0–100' },
          { type: 'action', label: 'Create contact + deal' },
          { type: 'output', label: 'Enrol in sequence' },
        ],
        [
          { type: 'condition', label: 'score ≥ 70 (hot)' },
          { type: 'output', label: 'Hot lead alert → Jatin WA' },
        ],
      ],
      stats: [
        { label: 'Fired', value: bookingJob.count, color: 'blue' },
        { label: 'Today', value: bookingJob.firedToday, color: 'green' },
        { label: 'Last trigger', value: relTime(bookingJob.lastRun), color: 'gray' },
      ],
    },
    {
      group: 'Lead capture & qualification',
      title: 'Ecom purchase → contact + sequence',
      tools: ['Cashfree', 'n8n', 'Brevo'],
      status: 'live',
      flows: [
        [
          { type: 'trigger', label: 'Cashfree payment success' },
          { type: 'action', label: 'POST /webhooks/cashfree' },
          { type: 'action', label: 'Create contact (ecom_purchase)' },
          { type: 'output', label: 'Enrol D2C Lead Nurture' },
        ],
      ],
      stats: [
        { label: 'Fired', value: purchaseJob.count, color: 'blue' },
        { label: 'Today', value: purchaseJob.firedToday, color: 'green' },
        { label: 'Last trigger', value: relTime(purchaseJob.lastRun), color: 'gray' },
      ],
    },
    // GROUP 2
    {
      group: 'Sequence engine (backend workers)',
      title: 'D2C Lead Nurture — WhatsApp sequence',
      tools: ['Worker', 'Meta WA'],
      status: 'live',
      flows: [
        [
          { type: 'trigger', label: 'Contact enrolled' },
          { type: 'action', label: 'Day 0: welcome_d2c' },
          { type: 'action', label: 'Day 3: followup_day3' },
          { type: 'output', label: 'Day 7: nudge_day7' },
        ],
      ],
      stats: [
        { label: 'Active', value: d2cSeq?.activeEnrolments ?? 0, color: 'green' },
        { label: 'Completed', value: d2cSeq?.completedEnrolments ?? 0, color: 'blue' },
        { label: 'Steps', value: d2cSeq?.stepCount ?? '—', color: 'gray' },
        { label: 'Last enrolled', value: relTime(d2cSeq?.lastEnrolledAt), color: 'amber' },
      ],
      footer: 'Worker polls: every 30s',
    },
    {
      group: 'Sequence engine (backend workers)',
      title: 'Healthcare Lead Nurture — WhatsApp sequence',
      tools: ['Worker', 'Meta WA'],
      status: healthSeq ? 'live' : 'amber',
      statusLabel: healthSeq ? 'Live' : 'Not configured',
      flows: [
        [
          { type: 'trigger', label: 'Contact enrolled' },
          { type: 'action', label: 'Day 0: welcome_health' },
          { type: 'action', label: 'Day 3: followup_day3' },
          { type: 'output', label: 'Day 7: nudge_day7' },
        ],
      ],
      stats: [
        { label: 'Active', value: healthSeq?.activeEnrolments ?? 0, color: 'green' },
        { label: 'Completed', value: healthSeq?.completedEnrolments ?? 0, color: 'blue' },
        { label: 'Steps', value: healthSeq?.stepCount ?? '—', color: 'gray' },
        { label: 'Last enrolled', value: relTime(healthSeq?.lastEnrolledAt), color: 'amber' },
      ],
      footer: 'Worker polls: every 30s',
    },
    {
      group: 'Sequence engine (backend workers)',
      title: 'Email nurture — Brevo SMTP',
      tools: ['Worker', 'Brevo'],
      status: 'live',
      flows: [
        [
          { type: 'trigger', label: 'Contact enrolled (email channel)' },
          { type: 'action', label: 'Brevo API sends template' },
          { type: 'output', label: 'Logged to messages table' },
        ],
      ],
      stats: [
        { label: 'Active', value: emailSeq?.activeEnrolments ?? 0, color: 'green' },
        { label: 'Completed', value: emailSeq?.completedEnrolments ?? 0, color: 'blue' },
        { label: 'Steps', value: emailSeq?.stepCount ?? '—', color: 'gray' },
      ],
    },
    // GROUP 3
    {
      group: 'n8n job queue processors',
      title: 'n8n Workflow 01 — Job queue processor',
      tools: ['n8n', 'PostgreSQL'],
      status: 'live',
      flows: [
        [
          { type: 'trigger', label: 'Every 60 seconds' },
          { type: 'action', label: 'Poll jobs table (pending)' },
          { type: 'condition', label: 'Route by job_type' },
          { type: 'output', label: 'Execute sub-workflow' },
        ],
        [
          { type: 'output', label: 'inbound_wa → WF02' },
          { type: 'output', label: 'sequence_step → WF03' },
          { type: 'output', label: 'hot_lead_alert → WF04' },
        ],
      ],
      stats: [
        { label: 'Pending', value: jobs?.pending ?? 0, color: jobs?.pending > 0 ? 'amber' : 'green' },
        { label: 'Completed today', value: jobs?.firedToday ?? 0, color: 'blue' },
        { label: 'Failed', value: jobs?.failed ?? 0, color: jobs?.failed > 0 ? 'red' : 'gray' },
        { label: 'Dead letter', value: jobs?.deadLetter ?? 0, color: jobs?.deadLetter > 0 ? 'red' : 'gray' },
      ],
      footer: 'n8n URL: primary-production-6c6f5.up.railway.app',
    },
    {
      group: 'n8n job queue processors',
      title: 'n8n Workflow 02 — Inbound WhatsApp processor',
      tools: ['n8n', 'Meta WA', 'Backend'],
      status: 'live',
      flows: [
        [
          { type: 'trigger', label: 'inbound_wa job picked up' },
          { type: 'action', label: 'Extract contact from payload' },
          { type: 'action', label: 'POST /contacts (find or create)' },
          { type: 'output', label: 'Enrol in D2C Lead Nurture' },
        ],
      ],
      stats: [
        { label: 'Total inbound', value: inboundWaJob.count, color: 'blue' },
        { label: 'Today', value: inboundWaJob.firedToday, color: 'green' },
        { label: 'Last run', value: relTime(inboundWaJob.lastRun), color: 'gray' },
      ],
    },
    {
      group: 'n8n job queue processors',
      title: 'n8n Workflow 04 — Hot lead alert',
      tools: ['n8n', 'Meta WA'],
      status: 'live',
      flows: [
        [
          { type: 'trigger', label: 'hot_lead_alert job picked up' },
          { type: 'action', label: 'Extract contact name + score' },
          { type: 'output', label: "WhatsApp to Jatin's number" },
        ],
      ],
      stats: [
        { label: 'Total alerts', value: hotLeadJob.count, color: 'blue' },
        { label: 'Today', value: hotLeadJob.firedToday, color: 'green' },
        { label: 'Last alert', value: relTime(hotLeadJob.lastRun), color: 'amber' },
      ],
    },
    // GROUP 4
    {
      group: 'Booking rotation',
      title: 'Round robin — D2C strategy funnel',
      tools: ['Backend', 'Cal.com'],
      status: 'live',
      flows: [
        [
          { type: 'trigger', label: 'Visitor clicks booking link' },
          { type: 'condition', label: 'Deficit algorithm selects member' },
          { type: 'output', label: '302 redirect to Cal.com' },
        ],
      ],
      stats: d2cFunnel
        ? [
            ...d2cFunnel.members.map((m) => ({
              label: m.memberName,
              value: `${m.totalAssigned} assigned`,
              color: 'blue',
            })),
            { label: 'Total bookings', value: d2cFunnel.totalAssignments, color: 'green' },
          ]
        : [{ label: 'Funnel', value: 'Not found', color: 'amber' }],
      footer: 'URL: /book/d2c-strategy',
    },
    // GROUP 5
    {
      group: 'Pipeline automations',
      title: 'Pipeline automation triggers',
      tools: ['Backend', 'Meta WA'],
      status: 'amber',
      statusLabel: 'Pending WA migration',
      flows: [
        [
          { type: 'trigger', label: 'Deal moved to stage' },
          { type: 'condition', label: 'Check pipeline_automations rules' },
          { type: 'output', label: 'Fire action (sequence / WA / email)' },
        ],
      ],
      stats: [
        { label: 'Rules defined', value: pipelineAutomations.length, color: 'blue' },
        { label: 'Active', value: pipelineAutomations.filter((a) => a.isActive).length, color: 'green' },
      ],
      footer: pipelineAutomations.length > 0
        ? pipelineAutomations.slice(0, 3).map((a) => `${a.triggerStage ?? '?'} → ${a.actionType ?? '?'}`).join('  ·  ')
        : 'No automations configured yet',
    },
    {
      group: 'Pipeline automations',
      title: 'Stuck job recovery worker',
      tools: ['Backend'],
      status: 'live',
      flows: [
        [
          { type: 'trigger', label: 'Every 10 minutes' },
          { type: 'condition', label: "Jobs stuck in 'processing' > 10min" },
          { type: 'output', label: "Reset to 'pending' for retry" },
        ],
      ],
      stats: [
        { label: 'Dead letter queue', value: jobs?.deadLetter ?? 0, color: jobs?.deadLetter > 0 ? 'red' : 'green' },
        { label: 'Failed total', value: jobs?.failed ?? 0, color: jobs?.failed > 0 ? 'amber' : 'gray' },
      ],
      footer: 'Polls every 10 minutes · auto-recovers stuck jobs',
    },
  ];

  // Dedupe groups
  const groups = [...new Set(allCards.map((c) => c.group))];

  // Apply filter
  const filteredCards = allCards.filter((c) => cardMatchesFilter(c.tools, activeFilter));

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-5xl mx-auto px-6 py-6 space-y-6">

          {/* SECTION 1 — Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Automation Hub</h1>
              <p className="text-sm text-slate-400 mt-0.5">
                Every automation running across your stack — live status and documentation
              </p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-xs text-slate-400">
                Updated {secondsAgo}s ago
              </span>
              <button
                onClick={fetchData}
                className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white border border-slate-200 rounded-lg transition-colors"
                title="Refresh"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                </svg>
              </button>
            </div>
          </div>

          {/* SECTION 2 — Summary stat cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
            {[
              { label: 'Total automations', value: summary?.totalAutomations ?? 11, color: 'text-slate-900', bg: 'bg-white', href: null },
              { label: 'Live', value: summary?.liveCount ?? 0, color: 'text-emerald-600', bg: 'bg-emerald-50', href: null },
              { label: 'Paused / pending', value: summary?.pausedCount ?? 0, color: 'text-amber-600', bg: 'bg-amber-50', href: null },
              { label: 'Fired today', value: summary?.firedToday ?? 0, color: 'text-blue-600', bg: 'bg-blue-50', href: null },
              {
                label: 'Active blockers',
                value: blockerCount ?? '—',
                color: blockerCount > 0 ? 'text-red-600' : 'text-emerald-600',
                bg: blockerCount > 0 ? 'bg-red-50' : 'bg-emerald-50',
                href: '/crm/health',
              },
            ].map((card) => {
              const inner = (
                <>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">{card.label}</p>
                  <p className={`text-3xl font-bold ${card.color}`}>{card.value}</p>
                  {card.href && <p className="text-xs text-slate-400 mt-1">View →</p>}
                </>
              );
              return card.href ? (
                <Link key={card.label} to={card.href} className={`${card.bg} border border-slate-200 rounded-2xl p-5 shadow-sm hover:shadow-md transition-shadow block`}>
                  {inner}
                </Link>
              ) : (
                <div key={card.label} className={`${card.bg} border border-slate-200 rounded-2xl p-5 shadow-sm`}>
                  {inner}
                </div>
              );
            })}
          </div>

          {/* SECTION 3 — Filter pills */}
          <div className="flex gap-2 flex-wrap">
            {FILTER_PILLS.map((pill) => {
              const count = pill === 'All'
                ? allCards.length
                : allCards.filter((c) => cardMatchesFilter(c.tools, pill)).length;
              return (
                <button
                  key={pill}
                  onClick={() => setActiveFilter(pill)}
                  className={`text-sm px-3.5 py-1.5 rounded-full font-medium transition-colors ${
                    activeFilter === pill
                      ? 'bg-orange-500 text-white'
                      : 'bg-white border border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {pill} {count > 0 && <span className="opacity-70 text-xs">({count})</span>}
                </button>
              );
            })}
          </div>

          {/* SECTION 4 — Automation cards by group */}
          {groups.map((group) => {
            const groupCards = filteredCards.filter((c) => c.group === group);
            if (groupCards.length === 0) return null;
            return (
              <div key={group}>
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 ml-1">{group}</h2>
                <div className="space-y-2">
                  {groupCards.map((card) => (
                    <AutomationCard key={card.title} {...card} />
                  ))}
                </div>
              </div>
            );
          })}

          {filteredCards.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12 text-slate-300">
              <p className="text-sm">No automations match this filter</p>
            </div>
          )}

          {/* SECTION 5 — Contact sources */}
          {contacts?.bySource?.length > 0 && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
              <h2 className="text-sm font-bold text-slate-700 mb-4">Contact Sources</h2>
              <div className="space-y-2">
                {contacts.bySource.map((row) => {
                  const pct = contacts.total > 0 ? Math.round((row.count / contacts.total) * 100) : 0;
                  return (
                    <div key={row.source} className="flex items-center gap-3">
                      <span className="text-sm text-slate-600 w-36 capitalize shrink-0">
                        {row.source === 'direct' ? 'Direct / Unknown' : row.source.replace(/_/g, ' ')}
                      </span>
                      <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-orange-400 rounded-full"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-slate-500 w-16 text-right shrink-0">{row.count} ({pct}%)</span>
                    </div>
                  );
                })}
                <p className="text-xs text-slate-400 pt-1">{contacts.total} total contacts · {contacts.createdToday} added today</p>
              </div>
            </div>
          )}

          {/* SECTION 6 — Quick links */}
          <div className="flex flex-wrap gap-3 pt-2 pb-6">
            {[
              { label: 'Pipeline automations →', to: '/crm/automations' },
              { label: 'Pipeline settings →', to: '/crm/pipelines/settings' },
              { label: 'Contact list →', to: '/crm/contacts' },
            ].map((link) => (
              <Link
                key={link.label}
                to={link.to}
                className="text-sm text-orange-500 hover:text-orange-700 font-medium px-4 py-2 bg-orange-50 hover:bg-orange-100 rounded-xl transition-colors"
              >
                {link.label}
              </Link>
            ))}
            <a
              href="https://primary-production-6c6f5.up.railway.app"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-500 hover:text-blue-700 font-medium px-4 py-2 bg-blue-50 hover:bg-blue-100 rounded-xl transition-colors"
            >
              n8n dashboard ↗
            </a>
          </div>

        </div>
      </main>
    </div>
  );
}
