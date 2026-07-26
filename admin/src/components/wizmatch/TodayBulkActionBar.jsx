// PRD-005 PR 6 §5.3 A-9 / §13 — the first WizMatch-side bulk-action bar.
// `admin/src/components/BulkActionBar.jsx` cannot be reused: it is hardcoded
// to Growth CRM endpoints (`/api/contacts/bulk-tag`, `/api/deals/bulk-create`)
// with no per-item result reporting. This component copies its floating-bar
// visual pattern only; every action it offers routes through
// POST /api/wizmatch/today/actions, which is admin-gated server-side for any
// selection with more than one target (PRD-005 §4) and always returns a
// per-target result — never a silent partial success.
const ACTION_LABELS = {
  approve_queue: 'Approve & Queue',
  skip: 'Skip for Now',
  pause: 'Pause',
  resume: 'Resume',
  block: 'Block',
  assign_owner: 'Assign Owner',
  set_review_date: 'Set Review Date',
};

export default function TodayBulkActionBar({ count, actions, onClear, onAction }) {
  if (count === 0 || actions.length === 0) return null;
  return (
    <div
      role="toolbar"
      aria-label={`Bulk actions for ${count} selected ${count === 1 ? 'company' : 'companies'}`}
      className="sticky bottom-3 z-40 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-white shadow-modal"
    >
      <span className="text-[12.5px] font-semibold">{count} selected</span>
      <div className="flex flex-wrap gap-1.5">
        {actions.map((action) => (
          <button
            key={action}
            type="button"
            onClick={() => onAction(action)}
            className="rounded-md bg-white/10 px-2.5 py-1 text-[12px] font-medium hover:bg-white/20 focus:outline-none focus:ring-2 focus:ring-white/60"
          >
            {ACTION_LABELS[action] || action}
          </button>
        ))}
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
