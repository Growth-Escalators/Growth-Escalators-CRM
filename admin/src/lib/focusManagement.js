export const DIALOG_FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

// Returns the element that should receive focus when Tab would otherwise
// leave a modal dialog. A null result means native tab order can continue.
export function trappedDialogFocusTarget(elements, activeElement, backwards = false) {
  const focusable = Array.from(elements || []).filter(Boolean);
  if (!focusable.length) return null;
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!focusable.includes(activeElement)) return backwards ? last : first;
  if (backwards && activeElement === first) return last;
  if (!backwards && activeElement === last) return first;
  return null;
}

// Implements the WAI-ARIA roving-tabindex convention for horizontal tabs.
// Home/End jump to the edges; left/right wrap in both directions.
export function nextRovingTabIndex(key, currentIndex, count) {
  if (!Number.isInteger(count) || count < 1) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  if (key === 'ArrowRight') return (currentIndex + 1) % count;
  if (key === 'ArrowLeft') return (currentIndex - 1 + count) % count;
  return null;
}
