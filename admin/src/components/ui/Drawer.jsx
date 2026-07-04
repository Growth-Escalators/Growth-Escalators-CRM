import React, { useEffect } from 'react';

/**
 * Fluent Drawer (slide-in panel) — replaces ContactSlideIn / DealDetailSlideIn
 * ad-hoc markup. 480px standard, 640px wide; 300ms fluent slide.
 *
 * <Drawer open={!!contact} onClose={close} title={contact?.name} wide
 *   footer={<Button variant="primary">Save changes</Button>}>
 *   …detail body…
 * </Drawer>
 */
export default function Drawer({ open, onClose, title, subtitle, footer, wide = false, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm animate-[fadeIn_150ms_ease-out]"
      onClick={onClose}
    >
      <aside
        role="dialog"
        aria-modal="true"
        style={{ width: wide ? 640 : 480, maxWidth: '100%' }}
        className="h-full bg-white shadow-modal flex flex-col
          animate-[drawerIn_300ms_cubic-bezier(0.4,0,0.2,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Sticky header */}
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-neutral-100 shrink-0">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-neutral-900 truncate">{title}</h2>
            {subtitle && <p className="text-sm text-neutral-500 mt-0.5 truncate">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-md text-neutral-400
              hover:text-neutral-600 hover:bg-neutral-100 transition-colors shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 text-sm text-neutral-600">{children}</div>

        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-100 bg-neutral-50 shrink-0">
            {footer}
          </div>
        )}
      </aside>
    </div>
  );
}
