import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, CheckCircle2, ClipboardCheck, ExternalLink, Eye, RefreshCw, XCircle,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { useToast } from '../components/wizmatch/Toast.jsx';
import EmptyState from '../components/wizmatch/EmptyState.jsx';
import ErrorRetry from '../components/wizmatch/ErrorRetry.jsx';
import DialogShell from '../components/wizmatch/DialogShell.jsx';
import { SkeletonCard, SkeletonText } from '../components/SkeletonLoader.jsx';
import { capabilityFor } from '../lib/todayActionCapabilities.js';
import SeoElementCompare from '../components/seo/SeoElementCompare.jsx';
import SeoChangeDiff from '../components/seo/SeoChangeDiff.jsx';

// SEO Change Approvals — Phase 4 of the multi-tenant SEO platform.
//
// Every proposed edit to a live client website passes through
// site_changes (src/db/schema.ts) before it can publish, and
// src/services/siteChangeService.ts enforces the one invariant this whole
// page exists to make deliberate: nothing reaches a client's live site
// without a recorded human approval. This page is a pure renderer of that
// state machine — like TodayDecisionWorkbench.jsx for WizMatch, it computes
// NO eligibility of its own. `capabilities` (computed server-side by
// src/services/siteChangeCapabilities.ts, PR 8B's pattern applied to site
// changes) is the only thing consulted to decide whether a button is enabled,
// via the SAME `capabilityFor` fails-closed reader WizMatch's Today queues
// use — the two backends independently adopted the identical
// `{ enabled, reason }` contract for this reason, so reusing the reader
// instead of re-implementing it here is intentional, not a shortcut.
//
// `capabilityFor` reads `item.capabilities[action]`, and a SiteChangeDTO row
// carries `.capabilities` in exactly that shape, so no adapter is needed
// between the two.

// ---------------------------------------------------------------------------
// Status vocabulary — SITE_CHANGE_STATUSES in src/services/siteChangeService.ts.
// StatusBadge.jsx's own status-tone map does not cover these (it is
// WizMatch/CRM-shaped), and extending it is outside this page's three owned
// files, so this is a purpose-built table rendered through the SAME
// `badge-{tone}` classes StatusBadge.jsx uses, for visual consistency without
// touching a shared file six lanes are working around.
// ---------------------------------------------------------------------------
const STATUS_TONE = {
  proposed: 'muted',
  staged: 'info',
  awaiting_approval: 'warning',
  verification_failed: 'danger',
  approved: 'success',
  publishing: 'info',
  published: 'success',
  handoff_required: 'warning',
  rejected: 'danger',
  publish_failed: 'danger',
  superseded: 'muted',
};

function SiteChangeStatusBadge({ status }) {
  const tone = STATUS_TONE[status] || 'muted';
  return <span className={`badge-${tone} text-[11px]`}>{String(status || '').replaceAll('_', ' ')}</span>;
}

const STATUS_FILTERS = [
  { value: 'awaiting_approval', label: 'Awaiting approval' },
  { value: 'all', label: 'All statuses' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'staged', label: 'Staged' },
  { value: 'verification_failed', label: 'Verification failed' },
  { value: 'approved', label: 'Approved' },
  { value: 'publishing', label: 'Publishing' },
  { value: 'published', label: 'Published' },
  { value: 'handoff_required', label: 'Handoff required' },
  { value: 'publish_failed', label: 'Publish failed' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'superseded', label: 'Superseded' },
];

// One entry per SITE_CHANGE_ACTIONS (src/services/siteChangeCapabilities.ts).
// Every row attempts every action, in this fixed order, disabled per
// `capabilities[action]` — the same "render all, disable what's not allowed,
// never hide-and-guess" convention TodayDecisionWorkbench.jsx's CompanyCard
// uses, so an operator always sees the full shape of what a change could do
// next, not just what it can do right now.
const ACTION_ORDER = ['stage', 'verify', 'approve', 'reject', 'publish', 'complete_handoff'];

const ACTIONS = {
  stage: { label: 'Stage', confirmLabel: 'Stage', dialogTitle: 'Stage this change?' },
  verify: { label: 'Verify', confirmLabel: 'Verify', dialogTitle: 'Verify this change?' },
  approve: { label: 'Approve', confirmLabel: 'Approve', dialogTitle: 'Approve this change?' },
  reject: { label: 'Reject', confirmLabel: 'Reject', dialogTitle: 'Reject this change?' },
  publish: { label: 'Publish', confirmLabel: 'Publish', dialogTitle: 'Publish this change to the live site?' },
  complete_handoff: { label: 'Mark Handoff Complete', confirmLabel: 'Mark complete', dialogTitle: 'Mark this handoff as complete?' },
};

// Cosmetic emphasis only — which of a row's ENABLED actions is the one an
// operator is most likely reaching for next, given its current status. This
// never changes whether an action is enabled (capabilityFor alone decides
// that); it only picks which enabled button gets the primary style.
const PRIMARY_ACTION_BY_STATUS = {
  proposed: 'stage',
  staged: 'verify',
  verification_failed: 'stage',
  awaiting_approval: 'approve',
  approved: 'publish',
  handoff_required: 'complete_handoff',
};

function formatDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

function personLabel(person) {
  if (!person) return 'an admin';
  return person.name || person.email || 'an admin';
}

// ---------------------------------------------------------------------------
// Action button — same enabled/disabled + shared aria-describedby dedup
// idiom as TodayDecisionWorkbench.jsx's ActionButton (not exported there, so
// reimplemented here rather than reaching into another lane's file).
// ---------------------------------------------------------------------------
function ActionButton({ label, enabled, reasonId, onClick, className }) {
  if (enabled) {
    return (
      <button type="button" onClick={onClick} className={className}>
        {label}
      </button>
    );
  }
  return (
    <button
      type="button"
      disabled
      aria-describedby={reasonId}
      className={`${className} disabled:opacity-40 disabled:cursor-not-allowed`}
    >
      {label}
    </button>
  );
}

function ChangeActions({ change, onAction }) {
  const primary = PRIMARY_ACTION_BY_STATUS[change.status] || null;
  const reasonIdByText = new Map();
  const resolved = ACTION_ORDER.map((action) => {
    const cap = capabilityFor(change, action);
    if (cap.enabled) return { action, enabled: true, reasonId: null };
    if (!reasonIdByText.has(cap.reason)) {
      reasonIdByText.set(cap.reason, `seo-change-reason-${change.id}-${reasonIdByText.size}`);
    }
    return { action, enabled: false, reasonId: reasonIdByText.get(cap.reason) };
  });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pt-2">
        {resolved.map((r) => (
          <ActionButton
            key={r.action}
            label={ACTIONS[r.action].label}
            enabled={r.enabled}
            reasonId={r.reasonId}
            onClick={() => onAction(r.action)}
            className={
              r.action === 'reject'
                ? 'btn-primary btn-compact bg-danger-600 hover:bg-danger-700 border-danger-600'
                : r.action === primary
                  ? 'btn-primary btn-compact'
                  : 'btn-standard btn-compact'
            }
          />
        ))}
      </div>
      {reasonIdByText.size > 0 && (
        <div className="flex flex-col gap-0.5 mt-1.5">
          {[...reasonIdByText.entries()].map(([text, id]) => (
            <span key={id} id={id} className="text-[11px] text-neutral-500">
              <AlertTriangle className="inline w-3 h-3 mr-0.5 -mt-0.5" aria-hidden="true" />
              {text}
            </span>
          ))}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Preview panel — chosen by `previewTier`, never by platform name (per
// siteChangeCapabilities.ts's resolveSiteChangePreviewTier doc comment).
// `preview`-tier NEVER renders third-party HTML: it is a plain external link
// to the provider's own hosted draft. `elements` is the floor and is what
// every other tier falls back to when its own data did not come back.
// ---------------------------------------------------------------------------
function PreviewPanel({ change, cacheEntry, onRetry }) {
  if (!cacheEntry || cacheEntry.loading) {
    return <SkeletonText lines={4} />;
  }
  if (cacheEntry.error) {
    return <ErrorRetry message={cacheEntry.error} onRetry={onRetry} />;
  }

  const data = cacheEntry.data;
  const tier = data?.tier || change.previewTier;

  if (tier === 'diff') {
    return <SeoChangeDiff diff={data?.diff} />;
  }
  if (tier === 'preview') {
    if (!change.previewUrl) {
      return (
        <p className="text-[12.5px] text-neutral-500">
          This change is marked as a hosted preview, but no preview URL is on file yet. Stage it first.
        </p>
      );
    }
    return (
      <a
        href={change.previewUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-primary-700 hover:underline"
      >
        Open the provider's preview <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
      </a>
    );
  }
  return <SeoElementCompare before={data?.elements?.before} after={data?.elements?.after} />;
}

// ---------------------------------------------------------------------------
// Action dialog — one shell for all six actions. `reject` requires a reason;
// `approve` and `complete_handoff` capture an optional field; `stage`,
// `verify` and `publish` are a plain confirm. Built on the shared
// DialogShell/useDialogA11y (focus trap, Escape-to-close, focus restore) so
// this matches every other Wizmatch-staffing dialog's keyboard behaviour
// rather than inventing a new one.
// ---------------------------------------------------------------------------
function ActionDialog({ open, action, change, submitting, onCancel, onConfirm }) {
  const [reason, setReason] = useState('');
  const [liveUrl, setLiveUrl] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setLiveUrl('');
    }
  }, [open, action, change?.id]);

  if (!open || !action || !change) return null;

  const reasonRequired = action === 'reject';
  const canConfirm = !submitting && (!reasonRequired || reason.trim().length > 0);
  const danger = action === 'reject';

  return (
    <DialogShell
      open={open}
      title={ACTIONS[action].dialogTitle}
      danger={danger}
      loading={submitting}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={submitting} className="btn-standard">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm({ reason: reason.trim(), liveUrl: liveUrl.trim() })}
            disabled={!canConfirm}
            className={`btn-primary disabled:opacity-50 ${danger ? 'bg-danger-600 hover:bg-danger-700 border-danger-600' : ''}`}
          >
            {submitting ? 'Working…' : ACTIONS[action].confirmLabel}
          </button>
        </>
      }
    >
      {({ firstFieldRef }) => (
        <>
          <p className="text-[12.5px] text-neutral-600 flex flex-wrap items-center gap-1.5">
            {change.pageUrl || '(no page URL — this change has no single page)'}
            <SiteChangeStatusBadge status={change.status} />
          </p>
          {action === 'reject' && (
            <div>
              <label htmlFor="seo-change-dialog-reason" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                Reason (required)
              </label>
              <textarea
                id="seo-change-dialog-reason"
                ref={firstFieldRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                className="input w-full mt-1 resize-y"
                placeholder="Why is this change being rejected?"
              />
            </div>
          )}
          {action === 'approve' && (
            <div>
              <label htmlFor="seo-change-dialog-reason" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                Note (optional)
              </label>
              <textarea
                id="seo-change-dialog-reason"
                ref={firstFieldRef}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                className="input w-full mt-1 resize-y"
                placeholder="Optional note for the record"
              />
            </div>
          )}
          {action === 'complete_handoff' && (
            <div>
              <label htmlFor="seo-change-dialog-live-url" className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">
                Live URL (optional)
              </label>
              <input
                id="seo-change-dialog-live-url"
                ref={firstFieldRef}
                value={liveUrl}
                onChange={(e) => setLiveUrl(e.target.value)}
                className="input w-full mt-1"
                placeholder="https://…"
              />
            </div>
          )}
          {action === 'publish' && (
            <p className="text-[12.5px] text-warning-700 bg-warning-500/10 border border-warning-500/20 rounded-md px-2.5 py-1.5">
              This pushes the staged draft to the client's live site. It was already approved by a human — this is
              the last step.
            </p>
          )}
        </>
      )}
    </DialogShell>
  );
}

// ---------------------------------------------------------------------------
// One change's card: status/site/page header, the approval record once it
// exists (prominent, and keyed off `approvedAt`/`rejectedAt` presence rather
// than the CURRENT status, since a published change is still "approved by
// X" — that fact does not stop being true once the row moves past
// `approved`), verification issues, the preview toggle, and the action row.
// ---------------------------------------------------------------------------
function ChangeCard({
  change, siteLabel, approver, rejecter, expanded, onTogglePreview, previewCacheEntry, onRetryPreview, onAction,
}) {
  const approvedAt = formatDate(change.approvedAt);
  const rejectedAt = formatDate(change.rejectedAt);
  const createdAt = formatDate(change.createdAt);
  const previewId = `seo-change-preview-${change.id}`;

  return (
    <div className="card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <SiteChangeStatusBadge status={change.status} />
        <span className="font-semibold text-neutral-900 text-[13px]">{siteLabel}</span>
        {change.pageUrl && (
          <span className="text-[11.5px] text-neutral-500 truncate max-w-[420px]" title={change.pageUrl}>
            {change.pageUrl}
          </span>
        )}
        {createdAt && <span className="text-[11px] text-neutral-400 ml-auto whitespace-nowrap">proposed {createdAt}</span>}
      </div>
      <p className="text-[11.5px] text-neutral-500 mt-0.5">
        {String(change.changeKind || '').replaceAll('_', ' ')} · v{change.version} · source: {change.source}
      </p>

      {approvedAt && (
        <p className="text-[12px] text-success-700 bg-success-500/10 border border-success-500/20 rounded-md px-2.5 py-1.5 mt-2">
          <CheckCircle2 className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden="true" />
          Approved by {personLabel(approver)} on {approvedAt}
          {change.decisionReason && !rejectedAt ? ` — "${change.decisionReason}"` : ''}
        </p>
      )}
      {rejectedAt && (
        <p className="text-[12px] text-danger-700 bg-danger-500/10 border border-danger-500/20 rounded-md px-2.5 py-1.5 mt-2">
          <XCircle className="inline w-3.5 h-3.5 mr-1 -mt-0.5" aria-hidden="true" />
          Rejected by {personLabel(rejecter)} on {rejectedAt}
          {change.decisionReason ? ` — "${change.decisionReason}"` : ''}
        </p>
      )}
      {change.liveUrl && (
        <p className="text-[12px] text-neutral-600 mt-1.5">
          Live at{' '}
          <a href={change.liveUrl} target="_blank" rel="noopener noreferrer" className="text-primary-700 hover:underline">
            {change.liveUrl}
          </a>
        </p>
      )}

      {Array.isArray(change.verifyIssues) && change.verifyIssues.length > 0 && (
        <ul className="mt-2 space-y-1">
          {change.verifyIssues.map((issue, i) => (
            <li
              key={`${issue.code}-${i}`}
              className={`text-[11.5px] rounded px-2 py-1 ${issue.severity === 'blocking' ? 'bg-danger-500/10 text-danger-700' : 'bg-warning-500/10 text-warning-700'}`}
            >
              <AlertTriangle className="inline w-3 h-3 mr-1 -mt-0.5" aria-hidden="true" />
              {issue.message}
            </li>
          ))}
        </ul>
      )}
      {change.lastError && (
        <p className="text-[11.5px] text-danger-700 mt-1.5">Last error: {change.lastError}</p>
      )}

      <div className="mt-2">
        <button
          type="button"
          onClick={onTogglePreview}
          aria-expanded={expanded}
          aria-controls={previewId}
          className="btn-standard btn-compact"
        >
          <Eye className="w-3.5 h-3.5" aria-hidden="true" /> {expanded ? 'Hide preview' : 'Preview'}
        </button>
      </div>
      {expanded && (
        <div id={previewId} className="mt-3 border-t border-neutral-100 pt-3">
          <PreviewPanel change={change} cacheEntry={previewCacheEntry} onRetry={onRetryPreview} />
        </div>
      )}

      <ChangeActions change={change} onAction={onAction} />
    </div>
  );
}

export default function SeoApprovalsPage() {
  const { showSuccess, showError } = useToast();

  const [sites, setSites] = useState([]);
  const [team, setTeam] = useState([]);
  const [siteId, setSiteId] = useState('all');
  const [status, setStatus] = useState('awaiting_approval');

  const [changes, setChanges] = useState([]);
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState(null);

  const [expandedId, setExpandedId] = useState(null);
  const [previewCache, setPreviewCache] = useState({});

  const [dialog, setDialog] = useState(null); // { action, change }
  const [submitting, setSubmitting] = useState(false);

  // Sites + team load once. Defensive against either envelope shape for
  // sites, matching SiteRegistryPanel.jsx's own note that this route's exact
  // response shape is being built concurrently elsewhere in this change.
  useEffect(() => {
    apiFetch('/api/seo-sites')
      .then((d) => setSites(Array.isArray(d?.sites) ? d.sites : Array.isArray(d) ? d : []))
      .catch(() => setSites([]));
    apiFetch('/api/team')
      .then((d) => setTeam(Array.isArray(d?.team) ? d.team : []))
      .catch(() => setTeam([]));
  }, []);

  const isChangesPayload = (d) => !!d && Array.isArray(d.changes);

  const load = useCallback(async (isRetry = false) => {
    if (isRetry) setRetrying(true); else setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (siteId !== 'all') params.set('siteId', siteId);
      if (status !== 'all') params.set('status', status);
      params.set('limit', '200');
      const data = await apiFetch(`/api/seo-changes?${params.toString()}`);
      // A 200 with a missing/malformed `changes` array must fail closed
      // rather than render as an honestly-empty approval queue — the same
      // reasoning TodayDecisionWorkbench.jsx applies to its own queue payload.
      if (!isChangesPayload(data)) {
        throw new Error('The approvals list response was not in the expected format.');
      }
      setChanges(data.changes);
    } catch (e) {
      setError(e.message || 'Failed to load site changes.');
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, [siteId, status]);

  useEffect(() => { load(); }, [load]);

  // A filter change is a new view — the previously expanded row and its
  // cached preview may not even be in the new list.
  useEffect(() => {
    setExpandedId(null);
    setPreviewCache({});
  }, [siteId, status]);

  const siteById = useMemo(() => new Map(sites.map((s) => [s.id, s])), [sites]);
  const teamById = useMemo(() => new Map(team.map((t) => [t.id, t])), [team]);
  const siteLabelFor = (id) => siteById.get(id)?.label || siteById.get(id)?.domain || id;

  const loadPreview = useCallback(async (change, { force = false } = {}) => {
    if (!force) {
      const existing = previewCache[change.id];
      if (existing && (existing.loading || existing.data)) return;
    }
    setPreviewCache((prev) => ({ ...prev, [change.id]: { loading: true, error: null, data: null } }));
    try {
      const data = await apiFetch(`/api/seo-changes/${change.id}/preview`);
      setPreviewCache((prev) => ({ ...prev, [change.id]: { loading: false, error: null, data } }));
    } catch (e) {
      setPreviewCache((prev) => ({ ...prev, [change.id]: { loading: false, error: e.message || 'Failed to load the preview.', data: null } }));
    }
    // `previewCache` IS a real dependency, deliberately: the cache-skip check
    // above reads it, and with an empty deps array this closure would freeze
    // on the initial `{}` forever — every collapse/re-expand of a row would
    // silently re-fetch instead of using what was already loaded, since the
    // callback would never see its own writes. `force` (retry) bypasses the
    // check regardless of what the closure sees.
  }, [previewCache]);

  const togglePreview = (change) => {
    if (expandedId === change.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(change.id);
    loadPreview(change);
  };

  const openDialog = (action, change) => setDialog({ action, change });
  const closeDialog = () => setDialog(null);

  const submitAction = async ({ reason, liveUrl }) => {
    if (!dialog) return;
    const { action, change } = dialog;
    setSubmitting(true);
    try {
      const endpoint = `/api/seo-changes/${change.id}/${action === 'complete_handoff' ? 'handoff-complete' : action}`;
      let body;
      if (action === 'approve') body = { reason: reason || undefined, version: change.version };
      else if (action === 'reject') body = { reason, version: change.version };
      else if (action === 'complete_handoff') body = { liveUrl: liveUrl || undefined, version: change.version };
      // stage / verify / publish take no body — the endpoints described in
      // the frozen contract accept none, matching how this repo's other
      // no-body POSTs are already called (e.g. the workflow "Run Now" POSTs
      // in SEOPage.jsx).

      const raw = await apiFetch(endpoint, {
        method: 'POST',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      if (!raw?.change) {
        showError('The action was submitted but the server returned an unreadable result. Refreshing — check the list before retrying.');
      } else {
        showSuccess(`${ACTIONS[action].label} succeeded.`);
      }
    } catch (e) {
      if (e.status === 409 && e.message === 'version_conflict') {
        showError('This change moved on since you loaded it — refreshing to show the current state.');
      } else if (e.status === 409 && e.message === 'publish_in_progress') {
        showError('Someone else is already publishing this change — refreshing.');
      } else {
        showError(e.message || 'Action failed.');
      }
    } finally {
      // Always close and refetch — the server may have committed the write
      // whatever the response looked like, so the operator must see current
      // state rather than a stale card behind a closed dialog. The acted-on
      // change's cached preview is also dropped: staging/verifying can change
      // its diff/elements, so a cached preview from before the action is no
      // longer trustworthy.
      setDialog(null);
      setSubmitting(false);
      setPreviewCache((prev) => {
        if (!(change.id in prev)) return prev;
        const next = { ...prev };
        delete next[change.id];
        return next;
      });
      await load();
    }
  };

  return (
    <div className="p-6">
      <div className="flex items-center gap-2.5 mb-1">
        <ClipboardCheck className="w-5 h-5 text-neutral-700" aria-hidden="true" />
        <h1 className="text-[20px] font-bold text-neutral-900 tracking-[-0.01em]">SEO Change Approvals</h1>
      </div>
      <p className="text-[12.5px] text-neutral-500 mt-1 mb-5 max-w-3xl">
        Every proposed edit to a live client site passes through here before it can publish. Approve, reject,
        publish and completing a handoff all require an admin — nothing reaches a client's website without a
        recorded human decision.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <select aria-label="Filter by site" value={siteId} onChange={(e) => setSiteId(e.target.value)} className="input w-auto">
          <option value="all">All sites</option>
          {sites.map((s) => (
            <option key={s.id} value={s.id}>{s.label || s.domain}</option>
          ))}
        </select>
        <select aria-label="Filter by status" value={status} onChange={(e) => setStatus(e.target.value)} className="input w-auto">
          {STATUS_FILTERS.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        <button type="button" onClick={() => load()} className="btn-standard btn-compact ml-auto" aria-label="Refresh the approvals list">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh
        </button>
      </div>

      {loading ? (
        <div className="space-y-3" role="status" aria-busy="true" aria-label="Loading site changes">
          <SkeletonCard /><SkeletonCard /><SkeletonCard />
        </div>
      ) : error ? (
        <ErrorRetry message={error} onRetry={() => load(true)} retrying={retrying} />
      ) : changes.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={status === 'awaiting_approval' ? 'Nothing is waiting on your approval' : 'No changes match this filter'}
          description={
            status === 'awaiting_approval'
              ? 'Proposed edits appear here once staging and verification finish.'
              : 'Try a different site or status filter.'
          }
          variant={status === 'awaiting_approval' && siteId === 'all' ? 'true-empty' : 'filtered-empty'}
        />
      ) : (
        <div className="space-y-3">
          {changes.map((change) => (
            <ChangeCard
              key={change.id}
              change={change}
              siteLabel={siteLabelFor(change.siteId)}
              approver={change.approvedBy ? teamById.get(change.approvedBy) : null}
              rejecter={change.rejectedBy ? teamById.get(change.rejectedBy) : null}
              expanded={expandedId === change.id}
              onTogglePreview={() => togglePreview(change)}
              previewCacheEntry={previewCache[change.id]}
              onRetryPreview={() => loadPreview(change, { force: true })}
              onAction={(action) => openDialog(action, change)}
            />
          ))}
        </div>
      )}

      <ActionDialog
        open={!!dialog}
        action={dialog?.action}
        change={dialog?.change}
        submitting={submitting}
        onCancel={closeDialog}
        onConfirm={submitAction}
      />
    </div>
  );
}
