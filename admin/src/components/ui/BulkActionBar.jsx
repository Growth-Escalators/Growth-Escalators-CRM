import { AlertTriangle, Loader2 } from 'lucide-react';

/**
 * The shared floating bulk-action bar for every list page.
 *
 * Promoted from `components/wizmatch/TodayBulkActionBar.jsx`, which was the
 * only working bulk bar in the app and is kept as-is for the Today workbench
 * (its per-action capability model is specific to that screen's RBAC rules).
 * The older `components/BulkActionBar.jsx` was deleted: it was hardcoded to
 * Growth CRM endpoints and imported by nothing.
 *
 * actions = [{ key, label, danger?, disabled?, reason? }]
 * Any action with `disabled` MUST carry a `reason` — a greyed-out button with
 * no explanation is the single most common way a bulk bar wastes someone's
 * time. The reason is rendered visibly and wired via aria-describedby.
 */
export default function BulkActionBar({
  count,
  actions = [],
  onAction,
  onClear,
  entityLabel = 'row',
  entityLabelPlural,
  busy = false,
  selectAllSlot = null,
}) {
  if (count === 0 || actions.length === 0) return null;
  const plural = entityLabelPlural || `${entityLabel}s`;
  const noun = count === 1 ? entityLabel : plural;

  return (
    <div
      role="toolbar"
      aria-label={`Bulk actions for ${count} selected ${noun}`}
      className="sticky bottom-3 z-40 mt-2 flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-2.5 text-white shadow-modal"
    >
      <span className="text-[12.5px] font-semibold">
        {count} {noun} selected
      </span>
      {selectAllSlot}
      <div className="flex flex-wrap items-center gap-1.5">
        {actions.map((action) => {
          const reasonId = `bulk-action-reason-${action.key}`;
          const disabled = Boolean(action.disabled) || busy;
          return (
            <span key={action.key} className="inline-flex flex-wrap items-center gap-1">
              <button
                type="button"
                disabled={disabled}
                aria-describedby={action.disabled ? reasonId : undefined}
                onClick={() => onAction(action.key)}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-[12px] font-medium
                  focus:outline-none focus:ring-2 focus:ring-white/60
                  disabled:opacity-40 disabled:cursor-not-allowed
                  ${action.danger
                    ? 'bg-danger-600 hover:bg-danger-500 disabled:hover:bg-danger-600'
                    : 'bg-white/10 hover:bg-white/20 disabled:hover:bg-white/10'}`}
              >
                {busy && <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />}
                {action.label}
              </button>
              {action.disabled && action.reason && (
                <span id={reasonId} className="text-[11px] text-neutral-300">
                  <AlertTriangle className="inline w-3 h-3 mr-0.5 -mt-0.5" aria-hidden="true" />
                  {action.reason}
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
