import React, { useEffect } from 'react';

/**
 * Fluent Modal — 12px radius, shadow-modal, blurred backdrop,
 * fade+scale entrance (200ms decelerate).
 *
 * <Modal open={open} onClose={close} title="Add Contact"
 *   footer={<><Button onClick={close}>Cancel</Button><Button variant="primary">Save</Button></>}>
 *   …body…
 * </Modal>
 */
export default function Modal({ open, onClose, title, footer, width = 480, children }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm
        animate-[fadeIn_150ms_ease-out]"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        style={{ width, maxWidth: '100%' }}
        className="bg-white rounded-xl shadow-modal overflow-hidden
          animate-[modalIn_200ms_cubic-bezier(0.16,1,0.3,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-5 border-b border-neutral-100">
          <h2 className="text-lg font-bold text-neutral-900">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-8 h-8 flex items-center justify-center rounded-md text-neutral-400
              hover:text-neutral-600 hover:bg-neutral-100 transition-colors"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="px-6 py-5 text-sm text-neutral-600">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-neutral-100 bg-neutral-50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/* Add to index.css (or a global layer):
@keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
@keyframes modalIn { from { opacity: 0; transform: scale(0.95) } to { opacity: 1; transform: scale(1) } }
@keyframes drawerIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
*/
