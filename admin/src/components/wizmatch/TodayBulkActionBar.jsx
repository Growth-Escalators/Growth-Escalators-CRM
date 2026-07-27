// PRD-005 PR 6 §5.3 A-9 / §13 — the first WizMatch-side bulk-action bar.
// `admin/src/components/BulkActionBar.jsx` cannot be reused: it is hardcoded
// to Growth CRM endpoints (`/api/contacts/bulk-tag`, `/api/deals/bulk-create`)
// with no per-item result reporting. This component copies its floating-bar
// visual pattern only; every action it offers routes through
// POST /api/wizmatch/today/actions, which is admin-gated server-side for any
// selection with more than one target (PRD-005 §4) and always returns a
// per-target result — never a silent partial success.
import { AlertTriangle } from 'lucide-react';

const ACTION_LABELS = {
  approve_queue: 'Approve & Queue',
  skip: 'Skip for Now',
  pause: 'Pause',
  resume: 'Resume',
  block: 'Block',
  assign_owner: 'Assign Owner',
  set_review_date: 'Set Review Date',
};

// PR 8B (P8B-2) remediation — H-6 / M-0 / M-1. `capabilityForAction(action)`
// is supplied by the caller (`TodayDecisionWorkbench.jsx`) and resolves the
// INTERSECTION of the currently selected rows' own per-item capabilities
// (`resolveSelectionCapability` in ../../lib/todayActionCapabilities.js) — not
// a single role-only answer shared by every button.
//
// Before this fix, every button rendered from one shared `bulkCapability`
// value (a pure role gate): a team_lead selecting exactly one row was told
// "Bulk actions require admin" even though the server accepts a single-target
// action from that role (M-0/M-1), and every button on the "Paused or
// Blocked" queue rendered ENABLED even when every selected row was
// non-overridable-blocked and the server was guaranteed to refuse every one
// of them (H-6). Each action is now independently enabled/disabled, and each
// carries its own visible reason plus `aria-describedby` — the same
// accessible-disabled-reason pattern `ActionButton` uses per row in
// TodayDecisionWorkbench.jsx, not a single reason shared by the whole bar.
export default function TodayBulkActionBar({ count, actions, capabilityForAction, onClear, onAction }) {
  if (count === 0 || actions.length === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={`Bulk actions for ${count} selected ${count === 1 ? 'company' : 'companies'}`}
      className="sticky bottom-3 z-40 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-white shadow-modal"
    >
      <span className="text-[12.5px] font-semibold">{count} selected</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((action) => {
          const { enabled, reason } = capabilityForAction(action);
          const reasonId = `today-bulk-action-bar-reason-${action}`;
          return (
            <span key={action} className="inline-flex flex-wrap items-center gap-1">
              <button
                type="button"
                disabled={!enabled}
                aria-describedby={enabled ? undefined : reasonId}
                onClick={() => onAction(action)}
                className="rounded-md bg-white/10 px-2.5 py-1 text-[12px] font-medium hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-white/10"
              >
                {ACTION_LABELS[action] || action}
              </button>
              {!enabled && (
                <span id={reasonId} className="text-[11px] text-neutral-300">
                  <AlertTriangle className="inline w-3 h-3 mr-0.5 -mt-0.5" aria-hidden="true" />
                  {reason}
                </span>
              )}
            </span>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onClear}
        aria-label="Clear selection"
        className="ml-auto rounded-md px-2.5 py-1 text-[12px] font-medium text-neutral-300 hover:text-white hover:bg-white/10"
      >
        Clear
      </button>
    </div>
  );
}
