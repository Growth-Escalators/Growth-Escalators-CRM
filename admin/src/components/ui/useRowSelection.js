import { useCallback, useMemo, useState } from 'react';

/**
 * Row selection for a DataTable list page.
 *
 * Every list page needs the same four things — a Set of ids, a per-row toggle,
 * a select-all-visible toggle, and a reset — and getting the reset wrong is the
 * bug that matters: if selection survives a reload, a bulk action fires against
 * rows the user can no longer see. Pages must call `clear()` inside their load
 * function (the Today workbench already does this by hand; this hook makes it
 * the obvious default).
 *
 *   const sel = useRowSelection(filteredRows, 'id');
 *   <DataTable selectedIds={sel.selectedIds} onToggleRow={sel.toggleRow}
 *              onToggleAll={sel.toggleAll} ... />
 *   <BulkActionBar count={sel.count} ... onClear={sel.clear} />
 */
export function useRowSelection(rows, rowKey = 'id') {
  const [selectedIds, setSelectedIds] = useState(() => new Set());

  const toggleRow = useCallback((id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const visibleIds = useMemo(() => (rows || []).map((r) => r[rowKey]), [rows, rowKey]);

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      const next = new Set(prev);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }, [visibleIds]);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  // Only ids still present in `rows` may be acted on. A filter change can leave
  // an id selected that is no longer on screen; acting on it would be a silent
  // edit to something the user cannot see.
  const selectedVisible = useMemo(
    () => visibleIds.filter((id) => selectedIds.has(id)),
    [visibleIds, selectedIds],
  );

  return {
    selectedIds,
    selectedVisible,
    count: selectedVisible.length,
    toggleRow,
    toggleAll,
    clear,
  };
}
