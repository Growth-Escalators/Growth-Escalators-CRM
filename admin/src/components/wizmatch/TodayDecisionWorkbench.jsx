import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Ban, CheckCircle2, Clock, MessageSquareWarning, Radar, RefreshCw, Route as RouteIcon, UserCheck } from 'lucide-react';
import { apiFetch } from '../../lib/api.js';
import { useToast } from './Toast.jsx';
import ErrorRetry from './ErrorRetry.jsx';
import EmptyState from './EmptyState.jsx';
import StatusBadge from './StatusBadge.jsx';
import DataTable from '../ui/DataTable.jsx';
import TodayActionDialog from './TodayActionDialog.jsx';
import TodayBulkActionBar from './TodayBulkActionBar.jsx';
import { capabilityFor, resolveSelectionCapability } from '../../lib/todayActionCapabilities.js';

// PRD-005 PR 6 §13 — the Decision Workbench, fed entirely by
// GET /api/wizmatch/today/queues (which derives every decision from the
// canonical policy resolver, src/modules/outreach/outreachGate.ts — this
// component creates no eligibility logic of its own; it only presents what the
// API already decided and lets an operator act on it).
//
// Six queues, in the order a normal day is worked: qualify the new job
// signals, review the contacts discovery found, then the four company decision
// queues. The first two are NOT served by POST /today/actions: they route to
// the already-shipped POST /signals/bulk-action and
// POST /contact-intelligence/contacts/bulk-review. That split is deliberate
// and load-bearing — `runTodayActions`'s target union is closed at
// `company | duplicate` and dispatches with an `else` branch, so a signal id
// posted to /today/actions would be silently routed into DUPLICATE RESOLUTION
// and would still type-check. The endpoint lives on the queue definition below
// so a row can only ever be sent where its own queue says.

// Envelope difference, normalised at this boundary rather than guessed at each
// call site: /today/actions returns per-target `{ type, id, ok, error?, code? }`,
// while the two bulk endpoints return `{ id, ok, error? }` — no `type`, no
// `code`. `type` is stamped from the queue's own kind so the failed-target list
// can key on it; `code` is deliberately left undefined, because those endpoints
// genuinely do not produce one and inventing a value would make the
// stale-policy filter below (`r.type === 'company' && r.code === '…'`) act on a
// fabrication. That filter's `type === 'company'` test is also why the new
// kinds need no special-casing there: they simply never match.
function normaliseBulkOutcome(outcome, kind, requestedCount) {
  const results = (Array.isArray(outcome?.results) ? outcome.results : [])
    .map((r) => ({ ...r, type: r?.type || kind }));
  return {
    requested: typeof outcome?.requested === 'number' ? outcome.requested : requestedCount,
    succeeded: typeof outcome?.succeeded === 'number' ? outcome.succeeded : results.filter((r) => r.ok).length,
    results,
  };
}

// The bulk endpoints take ONE free-text `reason`, while TodayActionDialog
// collects a structured reason code, an optional note and (for `reject`)
// required evidence. Joined rather than dropped: a rejection recorded with no
// explanation is what the aliasing fix on the contact route already had to
// clean up once.
function reasonTextFrom(extra) {
  return [extra?.reasonCode, extra?.reason, extra?.evidenceText].filter(Boolean).join(' — ') || undefined;
}

// One definition per queue. Selection state, bulk actions, row identity, the
// render loop and the submit endpoint are all DERIVED from this array — there
// is no second hardcoded list of queue keys anywhere in this file, which is
// what previously let the four literals drift apart (a key present in the
// render loop but missing from `selected` throws on first click).
const QUEUE_DEFS = [
  {
    key: 'signalsToQualify',
    kind: 'signal',
    idField: 'signalId',
    label: 'Job Signals to Qualify',
    icon: Radar,
    endpoint: '/api/wizmatch/signals/bulk-action',
    actions: ['qualify', 'reject'],
    bulkActions: ['qualify', 'reject'],
    emptyText: 'No new job signals are waiting to be qualified.',
    labelOf: (item) => item.jobTitle || 'Untitled signal',
    unavailableKey: 'signalsUnavailable',
    truncatedKey: 'signalsTruncated',
    unavailableMessage: 'Job Signals to Qualify could not be loaded. It is showing empty because of an error, not because there is nothing to qualify — do not treat it as clear. Try Refresh.',
    defaultReasonCodeFor: (action) => (action === 'qualify' ? 'signal_qualified' : 'signal_rejected'),
    buildBody: (action, ids, extra) => ({ ids, action, reason: reasonTextFrom(extra) }),
  },
  {
    key: 'contactsToReview',
    kind: 'contact',
    idField: 'candidateId',
    label: 'Contacts to Review',
    icon: UserCheck,
    endpoint: '/api/wizmatch/contact-intelligence/contacts/bulk-review',
    actions: ['approve', 'reject'],
    bulkActions: ['approve', 'reject'],
    emptyText: 'No discovered contacts are waiting for review.',
    labelOf: (item) => item.name || 'Unnamed contact',
    unavailableKey: 'contactsUnavailable',
    truncatedKey: 'contactsTruncated',
    unavailableMessage: 'Contacts to Review could not be loaded. It is showing empty because of an error, not because there is nothing to review — do not treat it as clear. Try Refresh.',
    defaultReasonCodeFor: (action) => (action === 'approve' ? 'contact_approved' : 'contact_rejected'),
    // `decision`, not `action` — the two bulk endpoints genuinely differ here.
    buildBody: (action, ids, extra) => ({ ids, decision: action, reason: reasonTextFrom(extra) }),
  },
  {
    key: 'readyToContact',
    kind: 'company',
    idField: 'companyId',
    label: 'Ready to Contact',
    icon: CheckCircle2,
    endpoint: '/api/wizmatch/today/actions',
    emptyText: 'Nothing here right now.',
    labelOf: (item) => item.companyName,
    // Which contextual actions are OFFERED for a bulk (multi-select) operation.
    // Only combinations that are safe and make sense together are exposed —
    // e.g. `merge`/`confirm_separate` never appear because they require every
    // selected row to share the SAME pending-duplicate id, which a
    // multi-company selection cannot guarantee; those stay single-row-only.
    bulkActions: ['approve_queue', 'skip', 'pause', 'block', 'assign_owner', 'set_review_date'],
  },
  {
    key: 'needsReview',
    kind: 'company',
    idField: 'companyId',
    label: 'Needs Review',
    icon: Clock,
    endpoint: '/api/wizmatch/today/actions',
    emptyText: 'Nothing here right now.',
    labelOf: (item) => item.companyName,
    bulkActions: ['approve_queue', 'skip', 'pause', 'block', 'assign_owner', 'set_review_date'],
  },
  {
    // PR 8A hardening (task 8) — companies the resolver routes to an account
    // owner or a dedicated workflow (§8.6/§8.7), shown apart from ordinary
    // review/ready so an operator can see ownership at a glance. Routed items
    // are not queued for cold outreach directly — no `approve_queue`.
    key: 'routed',
    kind: 'company',
    idField: 'companyId',
    label: 'Routed',
    icon: RouteIcon,
    endpoint: '/api/wizmatch/today/actions',
    emptyText: 'Nothing here right now.',
    labelOf: (item) => item.companyName,
    bulkActions: ['skip', 'pause', 'block', 'assign_owner', 'set_review_date'],
  },
  {
    key: 'pausedOrBlocked',
    kind: 'company',
    idField: 'companyId',
    label: 'Paused or Blocked',
    icon: Ban,
    endpoint: '/api/wizmatch/today/actions',
    emptyText: 'Nothing here right now.',
    labelOf: (item) => item.companyName,
    bulkActions: ['resume', 'block', 'assign_owner', 'set_review_date'],
  },
];

const QUEUE_KEYS = QUEUE_DEFS.map((d) => d.key);

const ACTION_LABELS = {
  qualify: 'Qualify',
  approve: 'Approve',
  reject: 'Reject',
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

// Renders the fixed set of actions a non-company queue offers, each resolved
// against the SAME `item.capabilities` contract the company rows use (the
// backend attaches one per item; a missing/malformed answer fails closed via
// `capabilityFor`). Disabled reasons are deduped and shared by
// `aria-describedby`, matching CompanyCard.
function SimpleActionRow({ item, def, onAction }) {
  const reasonIdByText = new Map();
  const rowId = item[def.idField];
  const resolved = def.actions.map((action) => {
    const { enabled, reason } = capabilityFor(item, action);
    if (enabled) return { action, enabled: true, reasonId: null };
    if (!reasonIdByText.has(reason)) {
      reasonIdByText.set(reason, `action-reason-${def.kind}-${rowId}-${reasonIdByText.size}`);
    }
    return { action, enabled: false, reasonId: reasonIdByText.get(reason) };
  });
  return (
    <>
      <div className="flex flex-wrap items-center gap-2 pt-1">
        {resolved.map((a, index) => (
          <ActionButton
            key={a.action}
            label={ACTION_LABELS[a.action] || a.action}
            className={`${index === 0 ? 'btn-primary' : 'btn-standard'} btn-compact`}
            enabled={a.enabled}
            reasonId={a.reasonId}
            onClick={() => onAction(a.action, item)}
          />
        ))}
      </div>
      {reasonIdByText.size > 0 && (
        <div className="flex flex-col gap-0.5">
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

function SignalCard({ item, def, onAction }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-neutral-900">{item.jobTitle || 'Untitled signal'}</span>
        <span className="text-[11px] text-neutral-500">{item.companyName || 'Unknown company'}</span>
        <StatusBadge status={item.status} label={String(item.status || '').replaceAll('_', ' ')} />
      </div>
      <p className="text-[12px] text-neutral-500">
        {item.score === null || item.score === undefined ? 'No score yet' : `Score: ${item.score}/10`}
        {item.location ? ` · ${item.location}` : ''}
        {item.source ? ` · via ${item.source}` : ''}
        {item.daysOpen === null || item.daysOpen === undefined ? '' : ` · ${item.daysOpen} days open`}
      </p>
      <SimpleActionRow item={item} def={def} onAction={onAction} />
    </div>
  );
}

function ContactCard({ item, def, onAction }) {
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-neutral-900">{item.name || 'Unnamed contact'}</span>
        {item.title && <span className="text-[11px] text-neutral-500">{item.title}</span>}
        <StatusBadge status={item.confidenceTier} label={`${item.confidenceTier} confidence`} />
      </div>
      <p className="text-[12px] text-neutral-500">
        {item.companyName || 'Unknown company'}
        {item.email ? ` · ${item.email}` : ' · no email discovered'}
        {` · score ${item.confidenceScore}`}
      </p>
      <SimpleActionRow item={item} def={def} onAction={onAction} />
    </div>
  );
}

const ROW_RENDERERS = {
  company: (item, def, onAction, staleCompanyIds) => (
    <CompanyCard item={item} onAction={onAction} isStale={staleCompanyIds?.has(item.companyId)} />
  ),
  signal: (item, def, onAction) => <SignalCard item={item} def={def} onAction={onAction} />,
  contact: (item, def, onAction) => <ContactCard item={item} def={def} onAction={onAction} />,
};

function QueueSection({ def, items, selectedIds, onToggleRow, onToggleAll, onAction, loading, staleCompanyIds }) {
  const Icon = def.icon;
  const columns = useMemo(() => [
    {
      key: 'item',
      label: def.kind === 'company' ? 'Company' : def.label,
      render: (row) => ROW_RENDERERS[def.kind](row, def, onAction, staleCompanyIds),
    },
  ], [def, onAction, staleCompanyIds]);

  // `id` is derived from the queue's own `idField`, so a row key can never be
  // silently `undefined` for a queue whose items are not keyed on companyId.
  const rows = items.map((item) => ({
    ...item,
    id: item[def.idField],
    rowAriaLabel: `Select ${def.labelOf(item) || item[def.idField]}`,
  }));

  return (
    <section className="card p-4" aria-labelledby={`queue-heading-${def.key}`}>
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-neutral-500" aria-hidden="true" />
        <h2 id={`queue-heading-${def.key}`} className="font-bold text-neutral-900 text-[13.5px]">{def.label}</h2>
        <span className="badge-muted text-[11px]">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <p className="text-[12.5px] text-neutral-500">{def.emptyText}</p>
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          rowKey="id"
          selectedIds={selectedIds}
          onToggleRow={onToggleRow}
          onToggleAll={onToggleAll}
          loading={loading}
          emptyText={def.emptyText}
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

// `routed`, `signalsToQualify` and `contactsToReview` default to `[]` rather
// than being required by `isQueuePayload` — an older backend that predates the
// routed queue (PR 8A, task 8) or these two queues must not have its response
// rejected as malformed; it simply has none of those items. The four original
// arrays stay REQUIRED, because a payload missing those is genuinely
// unreadable and must fail closed rather than render as a clear day.
const EMPTY_QUEUES = {
  readyToContact: [], needsReview: [], routed: [], pausedOrBlocked: [],
  signalsToQualify: [], contactsToReview: [],
  repliesNeedingAction: [], counts: {}, partial: { skippedCompanyIds: [], skippedEnrolmentIds: [] },
};

const emptySelection = () => Object.fromEntries(QUEUE_KEYS.map((key) => [key, new Set()]));

export default function TodayDecisionWorkbench() {
  const [loading, setLoading] = useState(true);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState(null);
  const [disabledOnServer, setDisabledOnServer] = useState(false);
  const [queues, setQueues] = useState(EMPTY_QUEUES);
  const [users, setUsers] = useState([]);
  const [selected, setSelected] = useState(emptySelection);
  const [dialog, setDialog] = useState(null); // { action, kind, endpoint, requested, targetLabel, defaultReasonCode, buildBody }
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
      setQueues({
        ...data,
        routed: Array.isArray(data.routed) ? data.routed : [],
        signalsToQualify: Array.isArray(data.signalsToQualify) ? data.signalsToQualify : [],
        contactsToReview: Array.isArray(data.contactsToReview) ? data.contactsToReview : [],
      });
      setSelected(emptySelection());
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
    for (const def of QUEUE_DEFS) {
      const byId = new Map();
      for (const item of queues[def.key] || []) byId.set(item[def.idField], item);
      map[def.key] = byId;
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

  // Company queues post a `targets` array to /today/actions; the signal and
  // contact queues post a flat `ids` array to their own endpoint. Both shapes
  // are built HERE, from the queue definition the row came from, so no call
  // site can send an id to the wrong endpoint.
  // Every `buildBody` on a dialog — company, signal or contact — has the SAME
  // shape: `(extra) => body`. `submitAction` calls it with the dialog's
  // collected fields at submit time, so it must stay a function here rather
  // than an already-evaluated object.
  const companyBody = (action, targets, expectedPolicyId) => (extra) => ({
    action,
    targets,
    expectedPolicyId,
    ...extra,
  });

  const openDialogForSingle = (def) => (action, item) => {
    const id = item[def.idField];
    if (def.kind !== 'company') {
      setDialog({
        action,
        kind: def.kind,
        endpoint: def.endpoint,
        requested: 1,
        targetLabel: def.labelOf(item),
        defaultReasonCode: def.defaultReasonCodeFor?.(action),
        buildBody: (extra) => def.buildBody(action, [id], extra),
      });
      return;
    }
    const isDuplicateTarget = action === 'merge' || action === 'confirm_separate';
    const targets = [{ type: isDuplicateTarget ? 'duplicate' : 'company', id: isDuplicateTarget ? item.duplicateId : id }];
    // Stale-state precondition (PR 8A hardening, task 5): round-trips the
    // policy id the operator's view was built from. A single-target dialog
    // always knows exactly which company it targets, so this is safe here;
    // a bulk selection spans multiple companies with different policy ids,
    // so it is intentionally omitted for bulk (openDialogForBulk below).
    const expectedPolicyId = isDuplicateTarget ? undefined : item.policyId;
    setDialog({
      action,
      kind: def.kind,
      endpoint: def.endpoint,
      requested: 1,
      targetLabel: item.companyName,
      defaultReasonCode: action === 'merge' || action === 'confirm_separate' ? 'manual_reclassified' : undefined,
      buildBody: companyBody(action, targets, expectedPolicyId),
    });
  };

  const openDialogForBulk = (def, action) => {
    const ids = [...selected[def.key]];
    const noun = def.kind === 'company' ? 'companies' : `${def.kind}s`;
    setDialog({
      action,
      kind: def.kind,
      endpoint: def.endpoint,
      requested: ids.length,
      targetLabel: `${ids.length} ${noun}`,
      defaultReasonCode: def.defaultReasonCodeFor?.(action),
      buildBody: def.kind === 'company'
        ? companyBody(action, ids.map((id) => ({ type: 'company', id })), undefined)
        : (extra) => def.buildBody(action, ids, extra),
    });
  };

  const submitAction = async (extra) => {
    if (!dialog) return;
    setSubmitting(true);
    setLastResults([]);
    try {
      const raw = await apiFetch(dialog.endpoint, {
        method: 'POST',
        body: JSON.stringify(dialog.buildBody(extra)),
      });
      // A 2xx means the writes already ran server-side. Never let a malformed
      // body throw here: the old code did, and the throw was caught below as
      // "Action failed" while `setDialog(null)` and `load()` were skipped —
      // so committed writes were reported as a failure, the dialog stayed open
      // inviting a re-submit, and the queues were never refreshed.
      const outcome = normaliseBulkOutcome(raw, dialog.kind, dialog.requested);
      const results = outcome.results;
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

  const totalDecisions = QUEUE_KEYS.reduce((sum, key) => sum + (queues[key]?.length || 0), 0)
    + (queues.repliesNeedingAction?.length || 0);
  const skipped = (queues.partial?.skippedCompanyIds?.length || 0) + (queues.partial?.skippedEnrolmentIds?.length || 0);
  // Queues that failed to load are NOT empty — the empty state below must not
  // claim a clear day while any of them is unavailable.
  const anyQueueUnavailable = queues.partial?.repliesUnavailable
    || QUEUE_DEFS.some((def) => def.unavailableKey && queues.partial?.[def.unavailableKey]);

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

      {/* Same treatment for the two new queues: an empty queue that is empty
          because it FAILED must never be readable as a finished step. */}
      {QUEUE_DEFS.filter((def) => def.unavailableKey && queues.partial?.[def.unavailableKey]).map((def) => (
        <div key={def.unavailableKey} role="alert" className="card p-3 border-danger-500/30 bg-danger-500/10 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-danger-700 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[12.5px] text-danger-800">{def.unavailableMessage}</p>
        </div>
      ))}

      {QUEUE_DEFS.filter((def) => def.truncatedKey && queues.partial?.[def.truncatedKey]).map((def) => (
        <div key={def.truncatedKey} role="alert" className="card p-3 border-warning-500/30 bg-warning-500/10 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-warning-700 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[12.5px] text-warning-800">
            More items need a decision in {def.label} than fit on this page. Work through these, then refresh.
          </p>
        </div>
      ))}

      {/* A company with no root policy row is not paused, blocked or reviewed
          — it is absent from every queue above. Disclosed rather than
          silently excluded; the queues themselves are deliberately still
          built from the root-policy join (see decisionWorkbench.ts). */}
      {queues.partial?.companiesWithoutPolicy > 0 && (
        <div role="alert" className="card p-3 border-warning-500/30 bg-warning-500/10 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-warning-700 mt-0.5 shrink-0" aria-hidden="true" />
          <p className="text-[12.5px] text-warning-800">
            {queues.partial.companiesWithoutPolicy} compan{queues.partial.companiesWithoutPolicy === 1 ? 'y has' : 'ies have'} no
            outreach policy on file and therefore appear in NO queue above — they are not paused or blocked,
            they are simply undecided. Set a policy on them from the Companies page to bring them into Today.
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

      {totalDecisions === 0 && !anyQueueUnavailable && (
        <EmptyState
          icon={CheckCircle2}
          title="Nothing needs a decision right now"
          description="Signals, contacts and companies appear here once they have been sourced, discovered, or given a policy row — or once a reply needs your attention."
        />
      )}

      {QUEUE_DEFS.map((def) => {
        const items = queues[def.key] || [];
        // Resolved fresh on every render from the CURRENT `queues[def.key]`
        // array via `itemsByIdByQueue` above — never a snapshot captured at
        // selection time. `selected` only ever stores ids.
        const selectedItems = selectedItemsFor(def.key);
        return (
          <div key={def.key} className="relative">
            <QueueSection
              def={def}
              items={items}
              selectedIds={selected[def.key]}
              onToggleRow={toggleRow(def.key)}
              onToggleAll={toggleAll(def.key, items.map((i) => i[def.idField]))}
              onAction={openDialogForSingle(def)}
              loading={false}
              staleCompanyIds={staleCompanyIds}
            />
            {selected[def.key].size > 0 && (
              <TodayBulkActionBar
                count={selected[def.key].size}
                actions={def.bulkActions || []}
                capabilityForAction={(action) => resolveSelectionCapability(selectedItems, action, queues.bulkCapability)}
                onClear={() => setSelected((prev) => ({ ...prev, [def.key]: new Set() }))}
                onAction={(action) => openDialogForBulk(def, action)}
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
          defaultReasonCode={dialog.defaultReasonCode}
          users={users}
          submitting={submitting}
          onCancel={() => setDialog(null)}
          onConfirm={submitAction}
        />
      )}
    </div>
  );
}
