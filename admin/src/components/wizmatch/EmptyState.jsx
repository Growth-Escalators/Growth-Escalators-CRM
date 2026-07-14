import React from 'react';

/**
 * Shared empty-state block. Distinguishes true-empty ("nothing exists yet")
 * from filtered-empty ("nothing matches your filters") so the message and
 * recovery action are honest, per the no-demo-fallback / no-false-success
 * house rule.
 *
 * Props:
 *   icon         — lucide-react component
 *   title        — headline
 *   description  — one line of explanation
 *   actionLabel  — optional CTA text
 *   onAction     — optional CTA handler
 *   variant      — 'true-empty' | 'filtered-empty' (cosmetic only)
 */
export default function EmptyState({ icon: Icon, title, description, actionLabel, onAction, variant = 'true-empty' }) {
  return (
    <div className="card p-8 text-center" data-variant={variant}>
      {Icon && <Icon className="mx-auto w-6 h-6 text-neutral-400" />}
      <h3 className="mt-3 font-semibold text-neutral-900">{title}</h3>
      {description && <p className="mx-auto mt-1 max-w-md text-[12.5px] text-neutral-500">{description}</p>}
      {actionLabel && onAction && (
        <button type="button" onClick={onAction} className="btn-primary btn-compact mt-4 inline-flex">
          {actionLabel}
        </button>
      )}
    </div>
  );
}
