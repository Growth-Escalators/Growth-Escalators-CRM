import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, CheckCircle2, Clock, Lock, MessageSquareWarning, RefreshCw, Route as RouteIcon } from 'lucide-react';
import { apiFetch } from '../../lib/api.js';
import { useToast } from './Toast.jsx';
import ErrorRetry from './ErrorRetry.jsx';
import EmptyState from './EmptyState.jsx';
import StatusBadge from './StatusBadge.jsx';
import DataTable from '../ui/DataTable.jsx';
import TodayActionDialog from './TodayActionDialog.jsx';
import TodayBulkActionBar from './TodayBulkActionBar.jsx';
import { capabilityFor, resolveSelectionCapability } from '../../lib/todayActionCapabilities.js';

// PRD-005 PR 6 §13 — the Decision Workbench. Re-buckets WizMatch Today into
// four canonical queues fed entirely by GET /api/wizmatch/today/queues
// (which itself derives every decision from the canonical policy resolver,
// src/modules/outreach/outreachGate.ts — this component creates no
// eligibility logic of its own; it only presents what the API already
// decided and lets an operator act on it via POST /api/wizmatch/today/actions).

const QUEUE_META = {
  readyToContact: { label: 'Ready to Contact', icon: CheckCircle2, tone: 'success' },
  needsReview: { label: 'Needs Review', icon: Clock, tone: 'warning' },
  // PR 8A hardening (task 8) — companies the resolver routes to an account
  // owner or a dedicated workflow (§8.6/§8.7), shown apart from ordinary
  // review/ready so an operator can see ownership at a glance.
  routed: { label: 'Routed', icon: RouteIcon, tone: 'info' },
  pausedOrBlocked: { label: 'Paused or Blocked', icon: Ban, tone: 'danger' },
};

// Which contextual actions are OFFERED for a bulk (multi-select) operation on
// each queue. Only combinations that are safe and make sense together are
// exposed — e.g. `merge`/`confirm_separate` never appear here because they
// require every selected row to share the SAME pending-duplicate id, which a
// multi-company selection cannot guarantee; those stay single-row-only.
const BULK_ACTIONS_BY_QUEUE = {
  readyToContact: ['approve_queue', 'skip', 'pause', 'block', 'assign_owner', 'set_review_date'],
  needsReview: ['approve_queue', 'skip', 'pause', 'block', 'assign_owner', 'set_review_date'],
  // Routed items are not queued for cold outreach directly (§8.6/§8.7 routes
  // them to an owner or a dedicated workflow instead) — no `approve_queue`.
  routed: ['skip', 'pause', 'block', 'assign_owner', 'set_review_date'],
  pausedOrBlocked: ['resume', 'block', 'assign_owner', 'set_review_date'],
};

// D-31: `effectiveDecision` is the decision the API actually bucketed and
// gated this row on — it equals `canonicalDecision` under `enforce` and
// follows the stored policy row in shadow, so shadow mode never removes an
// affordance. `canonicalDecision` is shown as metadata but must never drive
// which actions exist, or shadow would silently block through the UI.
function effectiveDecisionOf(item) {
  return item.effectiveDecision || item.canonicalDecision;
}

function primaryActionFor(item) {
  if (effectiveDecisionOf(item) === 'deny') {
    return item.isNonOverridable ? null : { action: 'resume', label: 'Reclassify' };
  }
  if (item.duplicatePending) return { action: 'merge', label: 'Merge' };
  // PR 8A hardening (task 8) — a routed item's primary action is getting it
  // an owner when it has none; once owned, the operator works it through the
  // menu actions rather than a cold-outreach "Approve & Queue" primary.
  if (item.routed) {
    return item.accountOwnerUserId ? null : { action: 'assign_owner', label: 'Assign Owner' };
  }
  return { action: 'approve_queue', label: 'Approve & Queue' };
}

// PR 8B (P8B-2) — the backend attaches `item.capabilities` (computed by
// src/modules/outreach/decisionWorkbenchCapabilities.ts from the item's state
// and the caller's role). This component is a pure renderer of that answer and
// deliberately owns NO rule of its own: before this, every action rendered as
// an enabled button for every role, so a staff/manager_ops/sales pilot reader
// was shown controls the server was always going to 403.
//
// A response with no (or malformed) `capabilities` FAILS CLOSED — see
// admin/src/lib/todayActionCapabilities.js. An action we cannot prove the user
// may take is not shown as available.

// Renders one fully-resolved contextual action. `enabled`/`reasonId` are
// computed by the caller (CompanyCard) rather than here — see the note below
// on why disabled-reason TEXT is deduplicated and rendered once per row
// instead of once per button, while every disabled button still keeps its
// own `aria-describedby` link (pointing at a SHARED id when the reason is
// identical, so the a11y association survives the dedup).
function ActionButton({ label, className, enabled, reasonId, onClick }) {
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

function CompanyCard({ item, onAction, isStale }) {
  const primary = primaryActionFor(item);
  // PR 8A review fix — the "No action available" affordance must ALWAYS have
  // an explanation. `item.disabledReason` can legitimately be null for a state
  // that still has no primary action (a routed company that already has an
  // account owner), and the previous code dropped the old `title` fallback in
  // favour of an `aria-describedby` that then pointed at nothing — leaving the
  // affordance unexplained for every user, not only screen-reader users.
  const disabledReason = item.disabledReason
    || 'No action is available for this company in its current state. Open the company drawer for the full policy history.';
  const disabledReasonId = `disabled-reason-${item.companyId}`;

  // UX audit 2026-07-31 (top-10 finding #1) — this is the single most-viewed
  // screen in the product (Today is the landing page) and every disabled
  // action used to print its OWN copy of the same sentence next to its own
  // button. A row can attempt up to 6 actions (primary + confirm_separate +
  // assign_owner + set_review_date + pause/block/skip); when the backend
  // omits/malforms `item.capabilities` (fails closed, by design — see
  // todayActionCapabilities.js), ALL of them fall back to the identical
  // "Unable to determine permissions…" text, so one row could print that
  // exact sentence 6 times. `attemptedActions` mirrors the SAME conditions as
  // the JSX below (must stay in sync) so every button gets its capability
  // resolved exactly once, and identical reason text is deduped to a single
  // visible line shared via `aria-describedby` by every button that has it.
  const attemptedActions = [];
  if (primary) attemptedActions.push({ key: 'primary', action: primary.action, label: primary.label, className: 'btn-primary btn-compact' });
  if (item.duplicatePending) attemptedActions.push({ key: 'confirm_separate', action: 'confirm_separate', label: 'Confirm Separate', className: 'btn-standard btn-compact' });
  attemptedActions.push({ key: 'assign_owner', action: 'assign_owner', label: 'Assign Owner', className: 'btn-standard btn-compact' });
  attemptedActions.push({ key: 'set_review_date', action: 'set_review_date', label: 'Set Review Date', className: 'btn-standard btn-compact' });
  if (effectiveDecisionOf(item) !== 'deny') {
    attemptedActions.push({ key: 'pause', action: 'pause', label: 'Pause', className: 'btn-standard btn-compact' });
    attemptedActions.push({ key: 'block', action: 'block', label: 'Block', className: 'btn-standard btn-compact' });
    attemptedActions.push({ key: 'skip', action: 'skip', label: 'Skip for Now', className: 'btn-standard btn-compact' });
  }
  const reasonIdByText = new Map();
  const resolvedActions = attemptedActions.map((a) => {
    const { enabled, reason } = capabilityFor(item, a.action);
    if (enabled) return { ...a, enabled: true, reasonId: null };
    if (!reasonIdByText.has(reason)) {
      reasonIdByText.set(reason, `action-reason-${item.companyId}-${reasonIdByText.size}`);
    }
    return { ...a, enabled: false, reasonId: reasonIdByText.get(reason) };
  });
  const distinctReasons = [...reasonIdByText.entries()]; // [[reasonText, sharedId], ...] in first-seen order

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-neutral-900">{item.companyName}</span>
        {item.companyDomain && <span className="text-[11px] text-neutral-500">{item.companyDomain}</span>}
        {/* Task 9 — non-overridable is folded into the SAME badge as the
            decision (relabelled), not a second `badge-danger` element: two
            red badges on one row would repeat, not add, information the
            disabled-action text below already carries. (`badge-danger`'s own
            contrast defect was fixed in this same pass, in
            `admin/src/index.css`.) */}
        <StatusBadge
          status={effectiveDecisionOf(item)}
          label={
            item.isNonOverridable
              ? `${effectiveDecisionOf(item)} (non-overridable${item.nonOverridableScopeKey && item.nonOverridableScopeKey !== 'entire_company' ? ` — ${item.nonOverridableScopeKey}` : ''})`
              : effectiveDecisionOf(item)
          }
        />
        {item.routed && (
          <StatusBadge status="routed" label={item.accountOwnerUserId ? 'routed' : 'routed — unassigned'} />
        )}
        {item.duplicatePending && <StatusBadge status="pending" label="possible duplicate" />}
        {/* D-31 disclosure: in shadow the canonical resolver may disagree with the
            stored policy row. Show that difference explicitly rather than either
            hiding it or letting it silently change the row's actions. */}
        {item.canonicalDecision && item.canonicalDecision !== effectiveDecisionOf(item) && (
          <StatusBadge status="shadow_would_block" label={`shadow: would ${item.canonicalDecision}`} />
        )}
        {/* Task 9 — a stale item (the last action against it failed with
            stale_policy_state) must not be silently retried against
            outdated data; it stays flagged until the next successful reload
            replaces this row with current state. */}
        {isStale && <StatusBadge status="stale_policy_state" label="stale — refresh to see the current state" />}
      </div>
      <p className="text-[12px] text-neutral-500">
        {item.outreachEligibility ? `Eligibility: ${item.outreachEligibility.replaceAll('_', ' ')}` : ''}
        {item.canonicalReasonCode ? ` · Reason: ${item.canonicalReasonCode.replaceAll('_', ' ')}` : ' · No reason code on file.'}
        {item.policyScopeKey ? ` · scope: ${item.policyScopeKey}` : ''}
        {item.contactConfidenceTier ? ` · contact confidence: ${item.contactConfidenceTier}` : ' · no contact identified'}
        {item.reviewDate ? ` · review date: ${item.reviewDate}${item.reviewDateArrived ? ' (arrived)' : ''}` : ''}
      </p>
      {item.requiresExplicitApproval && (
        <p className="text-[11.5px] text-warning-700">Requires explicit approval before queueing or export.</p>
      )}
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {resolvedActions.map((a) => (
          <ActionButton
            key={a.key}
            label={a.label}
            className={a.className}
            enabled={a.enabled}
            reasonId={a.reasonId}
            onClick={() => onAction(a.action, item)}
          />
        ))}
        {!primary && (
          <span
            className="text-[11.5px] text-neutral-500"
            aria-describedby={disabledReasonId}
          >
            No action available
          </span>
        )}
        {(item.disabledReason || !primary) && (
          <span id={disabledReasonId} className="text-[11px] text-neutral-500" aria-label={`Disabled: ${disabledReason}`}>
            <AlertTriangle className="inline w-3 h-3 mr-0.5 -mt-0.5" aria-hidden="true" />
            {disabledReason}
          </span>
        )}
      </div>
      {/* Deduped disabled-reason text — every disabled button above still
          links here via aria-describedby (sharing an id when the reason is
          identical), but the SENTENCE itself is printed once per distinct
          reason instead of once per button. */}
      {distinctReasons.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {distinctReasons.map(([text, id]) => (
            <span key={id} id={id} className="text-[11px] text-neutral-500">
              <AlertTriangle className="inline w-3 h-3 mr-0.5 -mt-0.5" aria-hidden="true" />
              {text}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function QueueSection({ queueKey, items, selectedIds, onToggleRow, onToggleAll, onAction, loading, staleCompanyIds }) {
  const meta = QUEUE_META[queueKey];
  const Icon = meta.icon;
  const columns = useMemo(() => [
    {
      key: 'company',
      label: 'Company',
      render: (row) => <CompanyCard item={row} onAction={onAction} isStale={staleCompanyIds?.has(row.companyId)} />,
    },
  ], [onAction, staleCompanyIds]);

  const rows = items.map((item) => ({ ...item, id: item.companyId, rowAriaLabel: `Select ${item.companyName}` }));

  return (
    <section className="card p-4" aria-labelledby={`queue-heading-${queueKey}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-neutral-500" aria-hidden="true" />
        <h2 id={`queue-heading-${queueKey}`} className="font-bold text-neutral-900 text-[13.5px]">{meta.label}</h2>
        <span className="badge-muted text-[11px]">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-neutral-500">Nothing here right now.</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          selectedIds={selectedIds}
          onToggleRow={onToggleRow}
          onToggleAll={onToggleAll}
          loading={loading}
          emptyText="Nothing here right now."
        />
      )}
    </section>
  );
}

// The link used to point at `/wizmatch/companies?id=<companyId>`. That page
// reads NO search params at all, so every reply row landed on an unfiltered
// company list — an affordance that looked like a deep link and wasn't.
//
// Hiring Contacts is the right destination (it is where you act on a reply) AND
// it is genuinely deep-linkable: its `q` filter is URL-backed via
// useTableControls, and since that filter went server-side the search reaches
// the whole tenant rather than a loaded page. Keyed on company NAME because the
// server search matches concat_ws(first, last, company).
//
// With no company name there is nowhere honest to send the user, so the row
// renders as plain text. A link to nowhere is worse than no link.
function ReplyRow({ item }) {
  const body = (
    <>
      <div className="min-w-0">
        <span className="font-medium text-neutral-900 truncate">{item.companyName || 'Unknown company'}</span>
        <p className="text-[12px] text-neutral-500 truncate">State: {item.state.replaceAll('_', ' ')}</p>
      </div>
      <div className="text-right shrink-0 text-[11px] text-neutral-500">
        {item.stateAt ? new Date(item.stateAt).toLocaleString() : ''}
      </div>
    </>
  );
  const className = 'flex items-center justify-between gap-3 rounded-md border border-neutral-100 bg-white px-3 py-2.5';

  if (!item.companyName) {
    return <div className={className}>{body}</div>;
  }
  return (
    // Link, not <a>: an anchor forces a full document reload out of the SPA.
    <Link
      to={`/wizmatch/hiring-contacts?q=${encodeURIComponent(item.companyName)}`}
      className={`${className} hover:border-primary-300 transition`}
    >
      {body}
    </Link>
  );
}

// `routed` defaults to `[]` rather than being required by `isQueuePayload` —
// an older/mocked backend response that predates the routed queue (PR 8A,
// task 8) must not be rejected as malformed; it simply has no routed items.
const EMPTY_QUEUES = { readyToContact: [], needsReview: [], routed: [], pausedOrBlocked: [], repliesNeedingAction: [], counts: {}, partial: { skippedCompanyIds: [], skippedEnrolmentIds: [] } };

export default function TodayDecisionWorkbench() {
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState(null);
  const [disabledOnServer, setDisabledOnServer] = useState(false);
  const [queues, setQueues] = useState(EMPTY_QUEUES);
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState({ readyToContact: new Set(), needsReview: new Set(), routed: new Set(), pausedOrBlocked: new Set() });
  const [dialog, setDialog] = useState(null); // { action, targets: [{type,id}], targetLabel, defaultReasonCode, expectedPolicyId }
  const [submitting, setSubmitting] = useState(false);
  // Failed per-target results from the last action, kept on screen. A toast
  // auto-dismisses in 5s and was truncated to two messages, so after a bulk
  // action there was no way to learn WHICH targets failed — the opposite of
  // the "per-target result, never a silent partial success" contract.
  const [lastResults, setLastResults] = useState([]);
  // PR 8A hardening (task 9) — companyIds whose last action failed with
  // `stale_policy_state`. Flagged visually until the next successful reload
  // replaces the row with current data; never cleared by a mere re-render,
  // only by `load()` actually returning fresh queues.
  const [staleCompanyIds, setStaleCompanyIds] = useState(new Set());
  const { showSuccess, showError } = useToast();

  // `apiFetch` returns `await res.json().catch(() => null)`, so a 200 with an
  // empty or non-JSON body (proxy, CDN, gateway) yields `null`. Rendering that
  // would throw on the first property read and drop the whole page into the App
  // error boundary; accepting a wrong-shaped 200 would be worse still, because
  // it renders as a confident "nothing needs a decision".
  const isQueuePayload = (d) => !!d
    && Array.isArray(d.readyToContact)
    && Array.isArray(d.needsReview)
    && Array.isArray(d.pausedOrBlocked)
    && Array.isArray(d.repliesNeedingAction);

  const load = useCallback(async (isRetry = false) => {
    if (isRetry) setRetrying(true); else setLoading(true);
    setError(null);
    setDisabledOnServer(false);
    try {
      const data = await apiFetch('/api/wizmatch/today/queues?limit=200');
      if (!isQueuePayload(data)) {
        throw new Error('The decision-queue response was not in the expected format.');
      }
      setQueues({ ...data, routed: Array.isArray(data.routed) ? data.routed : [] });
      setSelected({ readyToContact: new Set(), needsReview: new Set(), routed: new Set(), pausedOrBlocked: new Set() });
      setStaleCompanyIds(new Set());
    } catch (e) {
      // A 404 here means WIZMATCH_DECISION_WORKBENCH_ENABLED is off on this
      // backend while the UI build has it on — which is the DEFAULT locally,
      // since import.meta.env.DEV forces the UI flag true. That is a switched-off
      // feature, not a failure: retrying re-issues the same 404 forever, so show
      // an explicit state instead of a permanent error screen.
      if (e.status === 404) setDisabledOnServer(true);
      else setError(e.message || 'Failed to load the decision workbench.');
    } finally {
      setLoading(false);
      setRetrying(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    apiFetch('/api/wizmatch/staffing/users').then((d) => setUsers(d.items || [])).catch(() => setUsers([]));
  }, []);

  // H-6 / M-0 / M-1 remediation — a companyId -> item lookup per queue, built
  // ONCE per `queues` change rather than a `.find()` per selected id. `load()`
  // fully replaces `queues` (and resets `selected` to empty) on every
  // successful reload and there is no polling/auto-refetch interval, so this
  // map is always built from the CURRENT queues state at render time — there
  // is no code path where a selected id resolves to a stale item, because the
  // ids in `selected` and the items in `queues` are always from the same load.
  // MUST be called unconditionally, before any early return below — hooks
  // cannot be called after a conditional `return` without violating the
  // Rules of Hooks (this crashed every render past the first with "Rendered
  // more hooks than during the previous render").
  const itemsByIdByQueue = useMemo(() => {
    const map = {};
    for (const queueKey of ['readyToContact', 'needsReview', 'routed', 'pausedOrBlocked']) {
      const byId = new Map();
      for (const item of queues[queueKey] || []) byId.set(item.companyId, item);
      map[queueKey] = byId;
    }
    return map;
  }, [queues]);

  const toggleRow = (queueKey) => (id) => {
    setSelected((prev) => {
      const next = new Set(prev[queueKey]);
      if (next.has(id)) next.delete(id); else next.add(id);
      return { ...prev, [queueKey]: next };
    });
  };
  const toggleAll = (queueKey, ids) => () => {
    setSelected((prev) => {
      const allSelected = ids.length > 0 && ids.every((id) => prev[queueKey].has(id));
      return { ...prev, [queueKey]: allSelected ? new Set() : new Set(ids) };
    });
  };

  const openDialogForSingle = (action, item) => {
    const isDuplicateTarget = action === 'merge' || action === 'confirm_separate';
    setDialog({
      action,
      targets: [{ type: isDuplicateTarget ? 'duplicate' : 'company', id: isDuplicateTarget ? item.duplicateId : item.companyId }],
      targetLabel: item.companyName,
      // Stale-state precondition (PR 8A hardening, task 5): round-trips the
      // policy id the operator's view was built from. A single-target dialog
      // always knows exactly which company it targets, so this is safe here;
      // a bulk selection spans multiple companies with different policy ids,
      // so it is intentionally omitted for bulk (openDialogForBulk below).
      expectedPolicyId: isDuplicateTarget ? undefined : item.policyId,
    });
  };

  const openDialogForBulk = (queueKey, action) => {
    const ids = [...selected[queueKey]];
    setDialog({
      action,
      targets: ids.map((id) => ({ type: 'company', id })),
      targetLabel: `${ids.length} companies`,
    });
  };

  const submitAction = async (extra) => {
    if (!dialog) return;
    setSubmitting(true);
    setLastResults([]);
    try {
      const outcome = await apiFetch('/api/wizmatch/today/actions', {
        method: 'POST',
        body: JSON.stringify({
          action: dialog.action,
          targets: dialog.targets,
          expectedPolicyId: dialog.expectedPolicyId,
          ...extra,
        }),
      });
      // A 2xx means the writes already ran server-side. Never let a malformed
      // body throw here: the old code did, and the throw was caught below as
      // "Action failed" while `setDialog(null)` and `load()` were skipped —
      // so committed writes were reported as a failure, the dialog stayed open
      // inviting a re-submit, and the queues were never refreshed.
      const results = Array.isArray(outcome?.results) ? outcome.results : [];
      const failed = results.filter((r) => !r.ok);
      if (results.length === 0) {
        showError('The action was submitted but the server returned an unreadable result. Refreshing — check the queues before retrying.');
      } else if (failed.length === 0) {
        showSuccess(`${outcome.succeeded} of ${outcome.requested} succeeded.`);
      } else if (outcome.succeeded > 0) {
        showError(`${outcome.succeeded} succeeded, ${failed.length} failed: ${failed.map((f) => f.error).slice(0, 2).join('; ')}`);
      } else {
        showError(`All ${failed.length} failed: ${failed.map((f) => f.error).slice(0, 2).join('; ')}`);
      }
      setLastResults(failed);
      // Task 9 — flag exactly the targets the server told us were stale, so
      // the badge is not a guess about which row changed underneath the
      // operator. Cleared once `load()` below replaces the row with current
      // data (or, if the fetch itself fails, cleared nowhere — the ErrorRetry
      // screen takes over instead).
      const staleIds = failed.filter((r) => r.type === 'company' && r.code === 'stale_policy_state').map((r) => r.id);
      if (staleIds.length > 0) setStaleCompanyIds(new Set(staleIds));
    } catch (e) {
      showError(e.message || 'Action failed.');
    } finally {
      // Always close and refetch. The server may have committed some or all of
      // the writes whatever the response looked like, so the operator must see
      // current state rather than a stale list behind an open dialog.
      setDialog(null);
      setSubmitting(false);
      await load();
    }
  };

  if (loading) {
    return <div className="card p-8 text-center text-neutral-500" role="status" aria-busy="true">Loading the decision workbench…</div>;
  }
  if (disabledOnServer) {
    return (
      <EmptyState
        icon={AlertTriangle}
        title="The decision workbench is not enabled on this environment"
        description="This build has the workbench UI switched on, but the API for it is switched off (WIZMATCH_DECISION_WORKBENCH_ENABLED). Nothing is broken — the feature simply is not turned on here. Ask an admin to enable it, or use the other WizMatch pages in the meantime."
      />
    );
  }
  if (error) {
    return <ErrorRetry message={error} onRetry={() => load(true)} retrying={retrying} />;
  }

  const totalDecisions = (queues.readyToContact?.length || 0) + (queues.needsReview?.length || 0)
    + (queues.routed?.length || 0) + (queues.repliesNeedingAction?.length || 0) + (queues.pausedOrBlocked?.length || 0);
  const skipped = (queues.partial?.skippedCompanyIds?.length || 0) + (queues.partial?.skippedEnrolmentIds?.length || 0);

  const selectedItemsFor = (queueKey) => {
    const byId = itemsByIdByQueue[queueKey];
    const ids = [...selected[queueKey]];
    const items = [];
    for (const id of ids) {
      const item = byId?.get(id);
      if (item) items.push(item);
    }
    return items;
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-[12.5px] text-neutral-500">Every decision below is derived from the canonical WizMatch outreach policy.</p>
        <button onClick={() => load()} className="btn-standard btn-compact" aria-label="Refresh decision queues">
          <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" /> Refresh
        </button>
      </div>

      {queues.partial?.truncated && (
        <div role="alert" className="card p-3 border-warning-500/30 bg-warning-500/10 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-warning-700 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[12.5px] text-warning-800">
            More companies need a decision than fit on this page. The counts below are for the companies
            shown, not for the whole tenant — work through these, then refresh.
          </p>
        </div>
      )}

      {queues.partial?.repliesUnavailable && (
        <div role="alert" className="card p-3 border-danger-500/30 bg-danger-500/10 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-danger-700 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[12.5px] text-danger-800">
            Replies Needing Action could not be loaded. It is showing empty because of an error, not
            because there is nothing waiting — do not treat it as clear. Try Refresh.
          </p>
        </div>
      )}

      {skipped > 0 && (
        <div role="alert" className="card p-3 border-warning-500/30 bg-warning-500/10 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-warning-700 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[12.5px] text-warning-800">
            {skipped} item(s) could not be evaluated and were left out of the queues below (malformed data). Try Refresh, and contact an admin if this persists.
          </p>
        </div>
      )}

      {lastResults.length > 0 && (
        <div role="alert" className="card p-3 border-danger-500/30 bg-danger-500/10">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12.5px] font-semibold text-danger-800">
              {lastResults.length} target(s) in the last action failed and were not changed:
            </p>
            <button type="button" onClick={() => setLastResults([])} className="btn-standard btn-compact" aria-label="Dismiss the failed-target list">
              Dismiss
            </button>
          </div>
          <ul className="mt-1.5 space-y-0.5">
            {lastResults.map((r) => (
              <li key={`${r.type}-${r.id}`} className="text-[12px] text-danger-800">
                <span className="font-mono">{r.id}</span> — {r.error || r.code || 'failed'}
              </li>
            ))}
          </ul>
        </div>
      )}

      {totalDecisions === 0 && (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing needs a decision right now"
          description="Companies appear here once they have a policy row, a signal, or a reply that needs your attention."
        />
      )}

      {(['readyToContact', 'needsReview', 'routed', 'pausedOrBlocked']).map((queueKey) => {
        // Resolved fresh on every render from the CURRENT `queues[queueKey]`
        // array via `itemsByIdByQueue` above — never a snapshot captured at
        // selection time. `selected` only ever stores ids.
        const selectedItems = selectedItemsFor(queueKey);
        return (
          <div key={queueKey} className="relative">
            <QueueSection
              queueKey={queueKey}
              items={queues[queueKey] || []}
              selectedIds={selected[queueKey]}
              onToggleRow={toggleRow(queueKey)}
              onToggleAll={toggleAll(queueKey, (queues[queueKey] || []).map((i) => i.companyId))}
              onAction={openDialogForSingle}
              loading={false}
              staleCompanyIds={staleCompanyIds}
            />
            {selected[queueKey].size > 0 && (
              <TodayBulkActionBar
                count={selected[queueKey].size}
                actions={BULK_ACTIONS_BY_QUEUE[queueKey] || []}
                capabilityForAction={(action) => resolveSelectionCapability(selectedItems, action, queues.bulkCapability)}
                onClear={() => setSelected((prev) => ({ ...prev, [queueKey]: new Set() }))}
                onAction={(action) => openDialogForBulk(queueKey, action)}
              />
            )}
          </div>
        );
      })}

      <section className="card p-4" aria-labelledby="queue-heading-replies">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquareWarning className="w-4 h-4 text-neutral-500" aria-hidden="true" />
          <h2 id="queue-heading-replies" className="font-bold text-neutral-900 text-[13.5px]">Replies Needing Action</h2>
          <span className="badge-muted text-[11px]">{queues.repliesNeedingAction?.length || 0}</span>
        </div>
        {(queues.repliesNeedingAction || []).length === 0 ? (
          <p className="text-[12.5px] text-neutral-500">No live conversations waiting on a response.</p>
        ) : (
          <div className="space-y-2">
            {queues.repliesNeedingAction.map((item) => <ReplyRow key={item.enrolmentId} item={item} />)}
          </div>
        )}
      </section>

      {dialog && (
        <TodayActionDialog
          open
          action={dialog.action}
          targetLabel={dialog.targetLabel}
          defaultReasonCode={dialog.action === 'merge' || dialog.action === 'confirm_separate' ? 'manual_reclassified' : undefined}
          users={users}
          submitting={submitting}
          onCancel={() => setDialog(null)}
          onConfirm={submitAction}
        />
      )}
    </div>
  );
}
