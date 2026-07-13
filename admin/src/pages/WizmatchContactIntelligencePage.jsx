import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowRight, CheckCircle2, Clock, RefreshCw, ShieldCheck, Sparkles, Users } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const TIER_BADGE = {
  A: 'badge-success',
  B: 'badge-info',
  C: 'badge-warning',
  Reject: 'badge-danger',
};

const STATUS_BADGE = {
  qualified: 'badge-success',
  discovered: 'badge-success',
  needs_review: 'badge-warning',
  discovery_blocked: 'badge-warning',
  rejected: 'badge-danger',
  suppressed: 'badge-danger',
  cooldown: 'badge-muted',
};

const DEMO_ITEMS = [
  {
    companyId: 'demo-1',
    companyName: 'Bengaluru Cloud Staffing',
    companyDomain: 'bengalurucloud.example',
    targetRegion: 'india',
    qualificationTier: 'A',
    qualificationScore: 92,
    companyStatus: 'qualified',
    discoveryRunStatus: 'succeeded',
    componentScores: {
      itTechFit: 25,
      signalQuality: 19,
      regionPriority: 15,
      candidateSupply: 15,
      relationshipValue: 10,
      safetyAndDeliverability: 8,
    },
    latestSignal: {
      id: 'signal-demo-1',
      jobTitle: 'Senior Java Developer',
      source: 'naukri',
      location: 'Bangalore, India',
      score: 9,
      daysOpen: 12,
      status: 'matched',
      matchedCandidateCount: 4,
    },
    relationshipSummary: { knownContactCount: 3, positiveReplyCount: 1, placementCount: 0, activeSignalCount: 4 },
    safetySummary: { domainStatus: 'healthy', suppressedCount: 0, activeDuplicateCount: 0 },
    hardBlocks: [],
    reasons: [
      'Strong IT/Tech role or skills detected.',
      'India-first priority applies.',
      'Strong candidate supply is available.',
      'Prior positive reply found.',
      'Reusable internal CRM contacts found.',
    ],
    contactCandidates: [
      {
        id: 'contact-demo-1',
        name: 'Asha Rao',
        title: 'Head of Talent Acquisition',
        email: 'asha@bengalurucloud.example',
        phone: '+91 98765 43210',
        linkedinUrl: null,
        source: 'prior_wizmatch_signal',
        status: 'needs_review',
        rankingScore: 94,
        relationshipScore: 10,
        confidenceScore: 10,
        reasons: ['Decision-maker title fit.', 'Existing relationship signal found.', 'Verified internal channel.'],
      },
      {
        id: 'contact-demo-2',
        name: 'Ravi Mehta',
        title: 'Engineering Manager',
        email: 'ravi@bengalurucloud.example',
        phone: null,
        linkedinUrl: null,
        source: 'internal_crm',
        status: 'needs_review',
        rankingScore: 86,
        relationshipScore: 5,
        confidenceScore: 10,
        reasons: ['Decision-maker title fit.', 'Verified internal channel.'],
      },
    ],
  },
  {
    companyId: 'demo-2',
    companyName: 'US Prime Systems',
    companyDomain: 'usprime.example',
    targetRegion: 'us',
    qualificationTier: 'B',
    qualificationScore: 71,
    companyStatus: 'qualified',
    discoveryRunStatus: 'blocked_by_cap',
    componentScores: {
      itTechFit: 22,
      signalQuality: 14,
      regionPriority: 10,
      candidateSupply: 10,
      relationshipValue: 7,
      safetyAndDeliverability: 8,
    },
    latestSignal: {
      id: 'signal-demo-2',
      jobTitle: 'DevOps Engineer - Contract',
      source: 'manual',
      location: 'New Jersey, US',
      score: 7,
      daysOpen: 21,
      status: 'scored',
      matchedCandidateCount: 1,
    },
    relationshipSummary: { knownContactCount: 1, positiveReplyCount: 0, placementCount: 0, activeSignalCount: 2 },
    safetySummary: { domainStatus: 'warn', suppressedCount: 0, activeDuplicateCount: 0 },
    hardBlocks: [],
    reasons: [
      'Strong IT/Tech role or skills detected.',
      'US signal allowed because it has high-value evidence.',
      'Some matching candidate supply is available.',
      'Paid discovery is blocked in Phase 1.',
    ],
    contactCandidates: [],
  },
];

function ScoreBar({ label, value, max }) {
  const pct = Math.min(100, Math.round((Number(value || 0) / max) * 100));
  return (
    <div>
      <div className="flex items-center justify-between text-[12px] mb-1">
        <span className="text-neutral-600">{label}</span>
        <span className="font-semibold text-neutral-800">{value}/{max}</span>
      </div>
      <div className="h-1.5 bg-neutral-100 rounded-full overflow-hidden">
        <div className="h-full bg-primary-500 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatMinorCurrency(value, currency = 'INR') {
  const amount = Number(value || 0) / 100;
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency || 'INR',
      maximumFractionDigits: 2,
    }).format(amount);
  } catch {
    return `₹${amount.toFixed(2)}`;
  }
}

function CandidateCard({ candidate, disabled, onReview, onLinkCrm }) {
  return (
    <div className="border border-neutral-200 rounded-lg p-3 bg-white">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold text-neutral-900">{candidate.name}</p>
          <p className="text-[12.5px] text-neutral-500">{candidate.title || 'Title needs review'}</p>
        </div>
        <span className="inline-flex items-center justify-center w-9 h-9 rounded-md bg-primary-50 text-primary-700 font-bold border border-primary-100">
          {candidate.rankingScore}
        </span>
      </div>
      <div className="mt-2 text-[12px] text-neutral-500 space-y-1">
        <p>{candidate.email || 'No email'}{candidate.phone ? ` · ${candidate.phone}` : ''}</p>
        <p className="capitalize">{candidate.source?.replace(/_/g, ' ') || 'internal crm'}</p>
        <p className="capitalize">Status: {candidate.status?.replace(/_/g, ' ') || 'needs review'}</p>
      </div>
      {candidate.reasons?.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {candidate.reasons.slice(0, 3).map((reason) => (
            <span key={reason} className="badge-muted">{reason}</span>
          ))}
        </div>
      )}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          className="btn-primary btn-compact"
          disabled={disabled || candidate.status === 'approved' || candidate.status === 'linked_to_crm'}
          onClick={() => onReview(candidate, 'approve_contact')}
        >
          Approve
        </button>
        <button
          type="button"
          className="btn-standard btn-compact"
          disabled={disabled || candidate.status === 'rejected' || candidate.status === 'linked_to_crm'}
          onClick={() => onReview(candidate, 'reject_contact')}
        >
          Reject
        </button>
        <button
          type="button"
          className="btn-standard btn-compact"
          disabled={disabled || !['approved', 'linked_to_crm'].includes(candidate.status)}
          onClick={() => onLinkCrm(candidate)}
        >
          Link CRM
        </button>
      </div>
    </div>
  );
}

function CompanyPanel({ item, selected, onSelect }) {
  const badge = TIER_BADGE[item.qualificationTier] || 'badge-muted';
  const statusBadge = STATUS_BADGE[item.companyStatus] || 'badge-muted';

  return (
    <button
      type="button"
      onClick={() => onSelect(item)}
      className={`w-full text-left card card-hover p-4 ${selected ? 'ring-2 ring-primary-300 border-primary-300' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold text-neutral-900 truncate">{item.companyName}</p>
          <p className="text-[12.5px] text-neutral-500 truncate">{item.companyDomain || 'No domain'} · {item.targetRegion?.toUpperCase()}</p>
        </div>
        <div className="text-right">
          <span className={badge}>Tier {item.qualificationTier}</span>
          <p className="mt-1 text-[12px] font-semibold text-neutral-700">{item.qualificationScore}/100</p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <span className={statusBadge}>{item.companyStatus?.replace(/_/g, ' ')}</span>
        <span className="badge-muted">{item.contactCandidates?.length || 0} contacts</span>
        <span className="badge-muted">preview first</span>
      </div>

      {item.latestSignal && (
        <p className="mt-3 text-[12.5px] text-neutral-600 line-clamp-2">
          {item.latestSignal.jobTitle} · score {item.latestSignal.score}/10
        </p>
      )}
    </button>
  );
}

export default function WizmatchContactIntelligencePage({ demoMode = false }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(demoMode ? DEMO_ITEMS.length : 0);
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [costControls, setCostControls] = useState(null);
  const [actionLoading, setActionLoading] = useState('');
  const [actionMessage, setActionMessage] = useState('');
  const [reviewNotes, setReviewNotes] = useState('');
  const [manualContact, setManualContact] = useState({ name: '', title: '', email: '', phone: '', linkedinUrl: '', notes: '' });
  const [pipelineLinkContactId, setPipelineLinkContactId] = useState(null);
  const [discoveryPreview, setDiscoveryPreview] = useState(null);
  const [discoveryConfirmed, setDiscoveryConfirmed] = useState(false);
  const [discoveryMessage, setDiscoveryMessage] = useState('');

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setError('');
    if (demoMode) {
      setItems(DEMO_ITEMS);
      setTotal(DEMO_ITEMS.length);
      setCostControls({
        paidDiscoveryEnabled: false,
        maxPaidDiscoveryPerCompany: 0,
        maxContactCandidatesShown: 3,
        rediscoveryCooldownDays: 30,
      });
      setSelected((prev) => prev || DEMO_ITEMS[0]);
      setLoading(false);
      return;
    }
    try {
      const data = await apiFetch('/api/wizmatch/contact-intelligence/queue?limit=50');
      const nextItems = data.items || [];
      setItems(nextItems);
      setTotal(Number(data.total ?? nextItems.length));
      setCostControls(data.costControls || null);
      setSelected((prev) => {
        if (!nextItems.length) return null;
        if (!prev) return nextItems[0];
        return nextItems.find((item) => item.companyId === prev.companyId) || nextItems[0];
      });
    } catch (e) {
      console.error('Failed to load contact intelligence:', e);
      setItems([]);
      setTotal(0);
      setCostControls(null);
      setSelected(null);
      setError(e.message || 'Failed to load Contact Intelligence');
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

  useEffect(() => { loadQueue(); }, [loadQueue]);

  useEffect(() => {
    setDiscoveryPreview(null);
    setDiscoveryConfirmed(false);
    setDiscoveryMessage('');
  }, [selected?.companyId]);

  const updateSelectedInMemory = useCallback((updater) => {
    setSelected((prev) => {
      if (!prev) return prev;
      const next = updater(prev);
      setItems((list) => list.map((item) => item.companyId === next.companyId ? next : item));
      return next;
    });
  }, []);

  const snapshotCompany = useCallback(async () => {
    if (!selected) return;
    setActionLoading('snapshot');
    setActionMessage('');
    setPipelineLinkContactId(null);
    try {
      if (demoMode) {
        updateSelectedInMemory((prev) => ({
          ...prev,
          persisted: {
            ...(prev.persisted || {}),
            reviewStatus: 'needs_review',
            lastQualifiedAt: new Date().toISOString(),
            costCentsTotal: 0,
          },
        }));
        setActionMessage('Demo snapshot saved locally.');
      } else {
        await apiFetch(`/api/wizmatch/contact-intelligence/companies/${selected.companyId}/snapshot`, { method: 'POST' });
        await loadQueue();
        setActionMessage('Snapshot saved for manual review.');
      }
    } catch (e) {
      setActionMessage(e.message || 'Snapshot failed');
    } finally {
      setActionLoading('');
    }
  }, [demoMode, loadQueue, selected, updateSelectedInMemory]);

  const reviewCompany = useCallback(async (action) => {
    if (!selected) return;
    setActionLoading(action);
    setActionMessage('');
    setPipelineLinkContactId(null);
    try {
      if (demoMode) {
        const status =
          action === 'approve_company' ? 'discovery_blocked'
            : action === 'reject_company' ? 'rejected'
            : 'needs_review';
        updateSelectedInMemory((prev) => ({
          ...prev,
          companyStatus: status,
          persisted: {
            ...(prev.persisted || {}),
            reviewStatus: action === 'approve_company' ? 'approved' : action === 'reject_company' ? 'rejected' : 'watchlist',
            reviewAction: action,
            reviewNotes,
            reviewedAt: new Date().toISOString(),
          },
        }));
        setActionMessage(`Demo action saved: ${action.replace(/_/g, ' ')}`);
      } else {
        await apiFetch(`/api/wizmatch/contact-intelligence/companies/${selected.companyId}/review`, {
          method: 'POST',
          body: JSON.stringify({ action, notes: reviewNotes }),
        });
        await loadQueue();
        setActionMessage(`Saved: ${action.replace(/_/g, ' ')}`);
      }
    } catch (e) {
      setActionMessage(e.message || 'Review action failed');
    } finally {
      setActionLoading('');
    }
  }, [demoMode, loadQueue, reviewNotes, selected, updateSelectedInMemory]);

  const reviewContact = useCallback(async (candidate, action) => {
    if (!selected) return;
    setActionLoading(`${action}:${candidate.id}`);
    setActionMessage('');
    setPipelineLinkContactId(null);
    const nextStatus =
      action === 'approve_contact' ? 'approved'
        : action === 'mark_do_not_contact' ? 'do_not_contact'
        : 'rejected';
    try {
      if (demoMode) {
        updateSelectedInMemory((prev) => ({
          ...prev,
          contactCandidates: (prev.contactCandidates || []).map((item) =>
            item.id === candidate.id ? { ...item, status: nextStatus } : item,
          ),
        }));
        setActionMessage(`Demo contact ${nextStatus.replace(/_/g, ' ')}.`);
      } else {
        await apiFetch(`/api/wizmatch/contact-intelligence/contacts/${candidate.id}/review`, {
          method: 'POST',
          body: JSON.stringify({ action }),
        });
        await loadQueue();
        setActionMessage(`Contact ${nextStatus.replace(/_/g, ' ')}.`);
      }
    } catch (e) {
      setActionMessage(e.message || 'Contact review failed');
    } finally {
      setActionLoading('');
    }
  }, [demoMode, loadQueue, selected, updateSelectedInMemory]);

  const linkCrmContact = useCallback(async (candidate) => {
    setActionLoading(`link:${candidate.id}`);
    setActionMessage('');
    setPipelineLinkContactId(null);
    try {
      if (demoMode) {
        updateSelectedInMemory((prev) => ({
          ...prev,
          contactCandidates: (prev.contactCandidates || []).map((item) =>
            item.id === candidate.id ? { ...item, status: 'linked_to_crm', crmContactId: `demo-crm-${candidate.id}` } : item,
          ),
        }));
        setActionMessage('Demo CRM link created.');
        setPipelineLinkContactId(candidate.id);
      } else {
        const result = await apiFetch(`/api/wizmatch/contact-intelligence/contacts/${candidate.id}/link-crm-contact`, {
          method: 'POST',
        });
        await loadQueue();
        setActionMessage(result.created ? 'CRM contact created and linked.' : 'Existing CRM contact linked.');
        setPipelineLinkContactId(candidate.id);
      }
    } catch (e) {
      setActionMessage(e.message || 'CRM linking failed');
    } finally {
      setActionLoading('');
    }
  }, [demoMode, loadQueue, updateSelectedInMemory]);

  const addManualContact = useCallback(async () => {
    if (!selected || !manualContact.name.trim()) return;
    setActionLoading('manual-contact');
    setActionMessage('');
    setPipelineLinkContactId(null);
    try {
      if (demoMode) {
        const candidate = {
          id: `manual-${Date.now()}`,
          name: manualContact.name.trim(),
          title: manualContact.title || 'Manual contact',
          email: manualContact.email || null,
          phone: manualContact.phone || null,
          linkedinUrl: manualContact.linkedinUrl || null,
          source: 'manual_seed',
          status: 'needs_review',
          rankingScore: 50,
          relationshipScore: 0,
          confidenceScore: manualContact.email ? 4 : 2,
          reasons: ['Manual reviewer seed.'],
        };
        updateSelectedInMemory((prev) => ({ ...prev, contactCandidates: [candidate, ...(prev.contactCandidates || [])] }));
        setActionMessage('Demo manual contact added.');
      } else {
        await apiFetch(`/api/wizmatch/contact-intelligence/companies/${selected.companyId}/contacts/manual`, {
          method: 'POST',
          body: JSON.stringify(manualContact),
        });
        await loadQueue();
        setActionMessage('Manual contact added for review.');
      }
      setManualContact({ name: '', title: '', email: '', phone: '', linkedinUrl: '', notes: '' });
    } catch (e) {
      setActionMessage(e.message || 'Manual contact add failed');
    } finally {
      setActionLoading('');
    }
  }, [demoMode, loadQueue, manualContact, selected, updateSelectedInMemory]);

  const previewDiscovery = useCallback(async () => {
    if (!selected) return;
    setActionLoading('discovery-preview');
    setDiscoveryMessage('');
    setDiscoveryConfirmed(false);
    try {
      if (demoMode) {
        const enabled = Boolean(costControls?.paidDiscoveryEnabled);
        const blockedReasons = enabled ? [] : ['Provider discovery is disabled in this demo.'];
        setDiscoveryPreview({
          eligible: enabled,
          status: enabled ? 'ready_for_manual_paid_discovery' : 'paid_discovery_disabled',
          estimatedCostCents: 0,
          providerOrder: ['internal_crm_reuse', 'company_metadata', 'website_manual_pattern', 'reacher_verification'],
          capStatus: costControls || {},
          costGuard: { allowed: enabled, currency: 'INR', estimatedCostCents: 0, budget: null, providerEnv: { missing: [] } },
          blockedReasons,
          notes: ['Demo preview only. No provider calls are made.', 'Discovery never sends outreach.'],
        });
        setDiscoveryMessage(enabled ? 'Demo preview ready.' : 'Demo preview is blocked; no provider call was made.');
      } else {
        const result = await apiFetch(`/api/wizmatch/contact-intelligence/companies/${selected.companyId}/discovery-preview`, {
          method: 'POST',
          body: JSON.stringify({}),
        });
        setDiscoveryPreview(result.preview || null);
        setDiscoveryMessage(result.preview?.eligible
          ? 'Preview ready. Review the provider order, caps, and estimated cost before confirming.'
          : 'Preview blocked. Review the reasons below; no provider call was made.');
      }
    } catch (e) {
      setDiscoveryPreview(null);
      setDiscoveryMessage(e.message || 'Discovery preview failed.');
    } finally {
      setActionLoading('');
    }
  }, [costControls, demoMode, selected]);

  const runDiscovery = useCallback(async () => {
    if (!selected || !discoveryPreview?.eligible || !discoveryConfirmed) return;
    setActionLoading('discovery-run');
    setDiscoveryMessage('');
    try {
      if (demoMode) {
        setDiscoveryMessage('Demo discovery completed locally. No provider was called and no outreach was sent.');
      } else {
        const result = await apiFetch(`/api/wizmatch/contact-intelligence/companies/${selected.companyId}/discover`, {
          method: 'POST',
          body: JSON.stringify({ confirmPreview: true }),
        });
        setDiscoveryPreview(result.preview || discoveryPreview);
        setDiscoveryConfirmed(false);
        await loadQueue();
        setDiscoveryMessage(
          `Discovery ${result.status || 'completed'}: ${result.contactCandidates?.length || 0} reviewable contacts; ` +
          `${formatMinorCurrency(result.costCents, result.preview?.costGuard?.currency)} recorded cost. No outreach was sent.`,
        );
      }
    } catch (e) {
      setDiscoveryConfirmed(false);
      setDiscoveryMessage(e.message || 'Discovery run failed.');
    } finally {
      setActionLoading('');
    }
  }, [demoMode, discoveryConfirmed, discoveryPreview, loadQueue, selected]);

  const summary = useMemo(() => {
    const tierA = items.filter((item) => item.qualificationTier === 'A').length;
    const blocked = items.filter((item) => item.discoveryRunStatus === 'blocked_by_cap').length;
    const contacts = items.reduce((sum, item) => sum + (item.contactCandidates?.length || 0), 0);
    return { tierA, blocked, contacts };
  }, [items]);

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-[20px] font-bold text-neutral-900">Contact Intelligence</h1>
          <p className="text-[12.5px] text-neutral-500 mt-1">
            Deterministic qualification · CRM reuse first · preview-first manual discovery · no automatic outreach{demoMode ? ' · demo data' : ''}
          </p>
        </div>
        <button onClick={loadQueue} className="btn-standard btn-compact self-start" disabled={loading}>
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-5">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-neutral-500 text-[12px] font-semibold uppercase tracking-wider">
            <Sparkles className="w-4 h-4" /> Loaded companies
          </div>
          <p className="text-2xl font-bold text-neutral-900 mt-2">{total}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-neutral-500 text-[12px] font-semibold uppercase tracking-wider">
            <CheckCircle2 className="w-4 h-4" /> Tier A
          </div>
          <p className="text-2xl font-bold text-success-600 mt-2">{summary.tierA}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-neutral-500 text-[12px] font-semibold uppercase tracking-wider">
            <Users className="w-4 h-4" /> Internal Contacts
          </div>
          <p className="text-2xl font-bold text-primary-700 mt-2">{summary.contacts}</p>
        </div>
      </div>

      {error && (
        <div className="mb-5 card p-4 border-danger-500/20 bg-danger-500/5 text-danger-600 flex gap-2 items-start">
          <AlertTriangle className="w-5 h-5 mt-0.5" />
          <div>
            <p className="font-semibold">Could not load queue</p>
            <p className="text-sm">{error}</p>
            <button type="button" className="btn-standard btn-compact mt-2" onClick={loadQueue} disabled={loading}>
              Retry
            </button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-5">
        <div className="space-y-3">
          {loading ? (
            <div className="card p-8 text-center text-neutral-400">Loading Contact Intelligence...</div>
          ) : items.length === 0 ? (
            <div className="card p-8 text-center text-neutral-400">No companies with job signals found yet.</div>
          ) : items.map((item) => (
            <CompanyPanel
              key={item.companyId}
              item={item}
              selected={selected?.companyId === item.companyId}
              onSelect={setSelected}
            />
          ))}
        </div>

        <div className="card p-5 min-h-[520px]">
          {!selected ? (
            <div className="h-full flex items-center justify-center text-neutral-400">Select a company to review.</div>
          ) : (
            <div>
              <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between mb-5">
                <div>
                  <h2 className="text-[18px] font-bold text-neutral-900">{selected.companyName}</h2>
                  <p className="text-[12.5px] text-neutral-500">{selected.companyDomain || 'No domain'} · {selected.targetRegion?.toUpperCase()}</p>
                  {selected.persisted?.reviewStatus && (
                    <p className="text-[12px] text-neutral-500 mt-1">
                      Review: <span className="font-semibold capitalize">{selected.persisted.reviewStatus.replace(/_/g, ' ')}</span>
                      {selected.persisted.reviewedAt ? ` · ${new Date(selected.persisted.reviewedAt).toLocaleString()}` : ''}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <span className={TIER_BADGE[selected.qualificationTier] || 'badge-muted'}>Tier {selected.qualificationTier}</span>
                  <span className={STATUS_BADGE[selected.companyStatus] || 'badge-muted'}>{selected.companyStatus?.replace(/_/g, ' ')}</span>
                </div>
              </div>

              {actionMessage && (
                <div className="mb-5 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-[13px] text-primary-900">
                  <p>{actionMessage}</p>
                  {pipelineLinkContactId && (
                    <a href="/wizmatch/pipeline" className="mt-1 inline-flex items-center gap-1 font-semibold text-primary-700 hover:underline">
                      Open in Pipeline <ArrowRight className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5">
                <div className="bg-neutral-50 rounded-lg p-4">
                  <p className="text-[11px] text-neutral-500 uppercase font-semibold tracking-wider">Qualification</p>
                  <p className="text-3xl font-bold text-neutral-900 mt-1">{selected.qualificationScore}</p>
                  <p className="text-[12px] text-neutral-500">out of 100</p>
                </div>
                <div className="bg-neutral-50 rounded-lg p-4">
                  <p className="text-[11px] text-neutral-500 uppercase font-semibold tracking-wider">Discovery</p>
                  <p className="text-lg font-bold text-neutral-900 mt-2">{selected.discoveryRunStatus?.replace(/_/g, ' ')}</p>
                  <p className="text-[12px] text-neutral-500">Manual and cost-guarded</p>
                </div>
                <div className="bg-neutral-50 rounded-lg p-4">
                  <p className="text-[11px] text-neutral-500 uppercase font-semibold tracking-wider">Latest Signal</p>
                  <p className="text-sm font-semibold text-neutral-900 mt-2 line-clamp-2">{selected.latestSignal?.jobTitle || 'No signal'}</p>
                  <p className="text-[12px] text-neutral-500">score {selected.latestSignal?.score ?? 0}/10</p>
                </div>
              </div>

              <div className="mb-5 rounded-lg border border-neutral-200 bg-white p-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h3 className="text-[15px] font-semibold text-neutral-800">Discovery preview</h3>
                    <p className="mt-1 text-[12.5px] text-neutral-500">
                      Preview is read-only. It shows eligibility, provider order, caps, and estimated cost without calling a provider.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn-standard btn-compact self-start"
                    disabled={Boolean(actionLoading)}
                    onClick={previewDiscovery}
                  >
                    {actionLoading === 'discovery-preview' ? 'Preparing…' : 'Discovery Preview'}
                  </button>
                </div>

                {discoveryPreview ? (
                  <div className="mt-4 space-y-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={discoveryPreview.eligible ? 'badge-success' : 'badge-warning'}>
                        {discoveryPreview.status?.replace(/_/g, ' ') || (discoveryPreview.eligible ? 'eligible' : 'blocked')}
                      </span>
                      <span className="badge-muted">
                        Estimated cost {formatMinorCurrency(discoveryPreview.estimatedCostCents, discoveryPreview.costGuard?.currency)}
                      </span>
                      <span className="badge-muted">
                        Cooldown {discoveryPreview.capStatus?.rediscoveryCooldownDays || costControls?.rediscoveryCooldownDays || 30}d
                      </span>
                      {discoveryPreview.costGuard?.providerEnv?.missing?.length > 0 && (
                        <span className="badge-danger">Provider configuration missing</span>
                      )}
                    </div>

                    <div className="grid gap-3 md:grid-cols-2">
                      <div className="rounded-md bg-neutral-50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Provider order</p>
                        <p className="mt-1 text-[12.5px] text-neutral-800">
                          {(discoveryPreview.providerOrder || []).map((provider) => provider.replace(/_/g, ' ')).join(' → ') || 'No provider path available'}
                        </p>
                      </div>
                      <div className="rounded-md bg-neutral-50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Run controls</p>
                        <p className="mt-1 text-[12.5px] text-neutral-800">
                          Paid cooldown {discoveryPreview.capStatus?.paidRunsInCooldown || 0}/
                          {discoveryPreview.capStatus?.maxPaidDiscoveryPerCompany ?? costControls?.maxPaidDiscoveryPerCompany ?? 1}
                          {' · '}Google fallback {discoveryPreview.capStatus?.googleFallbackEnabled ? 'on' : 'off'}
                        </p>
                      </div>
                    </div>

                    {discoveryPreview.costGuard?.budget && (
                      <div className="rounded-md border border-neutral-100 bg-neutral-50 p-3">
                        <p className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Cost guard</p>
                        <div className="mt-2 grid gap-2 md:grid-cols-2">
                          <p className="text-[12.5px] text-neutral-700">
                            Month: {formatMinorCurrency(discoveryPreview.costGuard.budget.month?.usedCents, discoveryPreview.costGuard.currency)} / {formatMinorCurrency(discoveryPreview.costGuard.budget.month?.limitCents, discoveryPreview.costGuard.currency)}
                          </p>
                          <p className="text-[12.5px] text-neutral-700">
                            Today: {formatMinorCurrency(discoveryPreview.costGuard.budget.day?.usedCents, discoveryPreview.costGuard.currency)} / {formatMinorCurrency(discoveryPreview.costGuard.budget.day?.limitCents, discoveryPreview.costGuard.currency)}
                          </p>
                          <p className="text-[12.5px] text-neutral-700">
                            Your runs: {discoveryPreview.costGuard.budget.userDayRuns?.used || 0}/{discoveryPreview.costGuard.budget.userDayRuns?.limit || 0}
                          </p>
                          <p className="text-[12.5px] text-neutral-700">
                            Tenant runs: {discoveryPreview.costGuard.budget.tenantDayRuns?.used || 0}/{discoveryPreview.costGuard.budget.tenantDayRuns?.limit || 0}
                          </p>
                        </div>
                        <p className="mt-2 text-[12px] text-neutral-500">
                          Provider calls today: Apollo {discoveryPreview.costGuard.budget.providerDayCalls?.apollo?.used || 0}/{discoveryPreview.costGuard.budget.providerDayCalls?.apollo?.limit || 0}
                          {' · '}Snov {discoveryPreview.costGuard.budget.providerDayCalls?.snov?.used || 0}/{discoveryPreview.costGuard.budget.providerDayCalls?.snov?.limit || 0}
                          {' · '}Reacher {discoveryPreview.costGuard.budget.providerDayCalls?.reacher?.used || 0}/{discoveryPreview.costGuard.budget.providerDayCalls?.reacher?.limit || 0}
                          {' · '}Google {discoveryPreview.costGuard.budget.providerDayCalls?.googleFallback?.used || 0}/{discoveryPreview.costGuard.budget.providerDayCalls?.googleFallback?.limit || 0}
                        </p>
                      </div>
                    )}

                    {discoveryPreview.costGuard?.providerEnv?.missing?.length > 0 && (
                      <p className="rounded-md border border-warning-500/30 bg-warning-500/10 px-3 py-2 text-[12.5px] text-warning-700">
                        Missing provider configuration: {discoveryPreview.costGuard.providerEnv.missing.join(', ')}
                      </p>
                    )}
                    {(discoveryPreview.blockedReasons || []).map((reason) => (
                      <p key={reason} className="rounded-md border border-danger-500/30 bg-danger-500/10 px-3 py-2 text-[12.5px] text-danger-600">
                        {reason}
                      </p>
                    ))}
                    {(discoveryPreview.notes || []).map((note) => (
                      <p key={note} className="text-[12px] text-neutral-500">{note}</p>
                    ))}

                    <label className="flex items-start gap-2 rounded-md border border-neutral-200 px-3 py-2">
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={discoveryConfirmed}
                        disabled={!discoveryPreview.eligible || Boolean(actionLoading)}
                        onChange={(event) => setDiscoveryConfirmed(event.target.checked)}
                      />
                      <span className="text-[12.5px] text-neutral-700">
                        I reviewed the eligibility, provider order, caps, and estimated cost. I understand that a confirmed run may call configured providers, but never sends outreach.
                      </span>
                    </label>
                    <button
                      type="button"
                      className="btn-primary btn-compact"
                      disabled={Boolean(actionLoading) || !discoveryPreview.eligible || !discoveryConfirmed}
                      onClick={runDiscovery}
                    >
                      {actionLoading === 'discovery-run' ? 'Running discovery…' : 'Confirm & run discovery'}
                    </button>
                  </div>
                ) : (
                  <p className="mt-4 rounded-md bg-neutral-50 px-3 py-3 text-[12.5px] text-neutral-500">
                    Run the preview before any manual discovery. No provider call or outreach happens during preview.
                  </p>
                )}
                {discoveryMessage && (
                  <p className="mt-3 rounded-md bg-primary-50 px-3 py-2 text-[12.5px] text-primary-700">{discoveryMessage}</p>
                )}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                <div>
                  <h3 className="text-[15px] font-semibold text-neutral-800 mb-3">Score Components</h3>
                  <div className="space-y-3">
                    <ScoreBar label="IT/Tech fit" value={selected.componentScores?.itTechFit || 0} max={25} />
                    <ScoreBar label="Signal quality" value={selected.componentScores?.signalQuality || 0} max={20} />
                    <ScoreBar label="Region priority" value={selected.componentScores?.regionPriority || 0} max={15} />
                    <ScoreBar label="Candidate supply" value={selected.componentScores?.candidateSupply || 0} max={15} />
                    <ScoreBar label="Relationship value" value={selected.componentScores?.relationshipValue || 0} max={15} />
                    <ScoreBar label="Safety" value={selected.componentScores?.safetyAndDeliverability || 0} max={10} />
                  </div>

                  <h3 className="text-[15px] font-semibold text-neutral-800 mt-6 mb-3">Why this company</h3>
                  <div className="space-y-2">
                    {(selected.reasons || []).slice(0, 7).map((reason) => (
                      <div key={reason} className="flex gap-2 text-[13px] text-neutral-600">
                        <CheckCircle2 className="w-4 h-4 text-success-600 flex-shrink-0 mt-0.5" />
                        <span>{reason}</span>
                      </div>
                    ))}
                    {selected.hardBlocks?.length > 0 && selected.hardBlocks.map((block) => (
                      <div key={block} className="flex gap-2 text-[13px] text-danger-600">
                        <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                        <span>{block.replace(/_/g, ' ')}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-[15px] font-semibold text-neutral-800 mb-3">Reviewable Contacts</h3>
                  <div className="space-y-3">
                    {selected.contactCandidates?.length ? (
                      selected.contactCandidates.map((candidate) => (
                        <CandidateCard
                          key={candidate.id}
                          candidate={candidate}
                          disabled={Boolean(actionLoading)}
                          onReview={reviewContact}
                          onLinkCrm={linkCrmContact}
                        />
                      ))
                    ) : (
                      <div className="border border-dashed border-neutral-300 rounded-lg p-5 text-center text-neutral-400">
                        <Clock className="w-5 h-5 mx-auto mb-2" />
                        No reusable contacts found yet. Run the read-only discovery preview to see whether manual discovery is eligible.
                      </div>
                    )}
                  </div>

                  <h3 className="text-[15px] font-semibold text-neutral-800 mt-6 mb-3">Manual Review Actions</h3>
                  <textarea
                    className="w-full min-h-[72px] rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200"
                    placeholder="Reviewer notes"
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                  />
                  <div className="grid grid-cols-2 gap-2 mt-2">
                    <button className="btn-primary btn-compact" disabled={Boolean(actionLoading)} onClick={() => reviewCompany('approve_company')}>
                      Approve company
                    </button>
                    <button className="btn-standard btn-compact" disabled={Boolean(actionLoading)} onClick={() => reviewCompany('reject_company')}>
                      Reject company
                    </button>
                    <button className="btn-standard btn-compact" disabled={Boolean(actionLoading)} onClick={() => reviewCompany('watchlist_company')}>
                      Watchlist
                    </button>
                  </div>
                  <p className="text-[12px] text-neutral-400 mt-2">
                    Company/contact actions persist review state only — no outreach is sent.
                  </p>

                  <h3 className="text-[15px] font-semibold text-neutral-800 mt-6 mb-3">Add Manual Contact</h3>
                  <div className="grid grid-cols-1 gap-2">
                    <input
                      className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                      placeholder="Name"
                      value={manualContact.name}
                      onChange={(e) => setManualContact((prev) => ({ ...prev, name: e.target.value }))}
                    />
                    <input
                      className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                      placeholder="Title"
                      value={manualContact.title}
                      onChange={(e) => setManualContact((prev) => ({ ...prev, title: e.target.value }))}
                    />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      <input
                        className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                        placeholder="Email"
                        value={manualContact.email}
                        onChange={(e) => setManualContact((prev) => ({ ...prev, email: e.target.value }))}
                      />
                      <input
                        className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                        placeholder="Phone"
                        value={manualContact.phone}
                        onChange={(e) => setManualContact((prev) => ({ ...prev, phone: e.target.value }))}
                      />
                    </div>
                    <input
                      className="rounded-lg border border-neutral-200 px-3 py-2 text-sm"
                      placeholder="LinkedIn URL"
                      value={manualContact.linkedinUrl}
                      onChange={(e) => setManualContact((prev) => ({ ...prev, linkedinUrl: e.target.value }))}
                    />
                    <button
                      className="btn-standard btn-compact justify-center"
                      disabled={Boolean(actionLoading) || !manualContact.name.trim()}
                      onClick={addManualContact}
                    >
                      Add manual contact
                    </button>
                  </div>

                  <button className="btn-standard btn-compact mt-4 w-full justify-center" disabled={Boolean(actionLoading)} onClick={snapshotCompany}>
                    Save / refresh persisted snapshot
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
