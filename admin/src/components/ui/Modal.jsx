import React, { useEffect, useId, useRef } from 'react';

/**
 * Fluent Modal — 12px radius, shadow-modal, blurred backdrop,
 * fade+scale entrance (200ms decelerate).
 *
 * <Modal open={open} onClose={close} title="Add Contact"
 *   footer={<><Button onClick={close}>Cancel</Button><Button variant="primary">Save</Button></>}>
 *   …body…
 * </Modal>
 */
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function Modal({ open, onClose, title, description, footer, width = 480, children }) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    previousFocusRef.current = document.activeElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focusTimer = window.setTimeout(() => {
      const first = panelRef.current?.querySelector(FOCUSABLE);
      first?.focus();
    }, 0);

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab' || !panelRef.current) return;
      const focusable = [...panelRef.current.querySelectorAll(FOCUSABLE)];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = originalOverflow;
      previousFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm
        animate-[fadeIn_150ms_ease-out]"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        style={{ width, maxWidth: '100%' }}
        className="min-w-0 bg-white rounded-xl shadow-modal overflow-hidden
          animate-[modalIn_200ms_cubic-bezier(0.16,1,0.3,1)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-6 py-5 border-b border-neutral-100">
          <div className="min-w-0">
            <h2 id={titleId} className="break-words text-lg font-bold text-neutral-900">{title}</h2>
            {description && <p id={descriptionId} className="mt-1 break-words text-sm text-neutral-600">{description}</p>}
          </div>
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
        <div className="max-h-[72vh] overflow-y-auto px-6 py-5 text-sm text-neutral-600">{children}</div>
        {footer && (
          <div className="flex flex-wrap items-center justify-end gap-3 px-6 py-4 border-t border-neutral-100 bg-neutral-50">
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
