import React, { useCallback } from 'react';

/**
 * Fluent DataTable — the shared table pattern for Contacts, Signals,
 * Audit, Permissions, etc. Compact but readable; selection uses the
 * primary-50 wash + 3px inset primary bar (no layout shift).
 *
 * const columns = [
 *   { key: 'name', label: 'Contact', width: 220, render: (row) => <b>{row.name}</b> },
 *   { key: 'email', label: 'Email' },
 * ];
 * <DataTable columns={columns} rows={rows} rowKey="id"
 *   selectedIds={selected} onToggleRow={toggle} onRowClick={openDetail} />
 *
 * ── loading vs refreshing ───────────────────────────────────────────────────
 * `loading` is the FIRST load — there is nothing to show, so it renders
 * skeleton rows. `refreshing` is a re-fetch (a filter changed, a row was
 * mutated) — the previous rows stay on screen, dimmed. Before this split every
 * refetch replaced the whole tbody with the word "Loading…", so typing in a
 * filter box made the table flash on every keystroke and threw away the user's
 * visual anchor. Pages that only pass `loading` keep working unchanged.
 *
 * ── sticky header ───────────────────────────────────────────────────────────
 * The wrapper scrolls (`maxHeight`) so `position: sticky` on <thead> has a
 * scroll container to stick to. Pass `maxHeight={null}` to opt out and let the
 * page scroll instead (the header will not stick in that mode).
 *
 * ── accessible name ─────────────────────────────────────────────────────────
 * The scroll wrapper is a focusable region, so it needs a name. `ariaLabel`
 * defaults to a generic one so no existing caller breaks; pages with more than
 * one table on screen should pass something specific ("Candidates", "Signals").
 */
export default function DataTable({
  columns,
  rows,
  rowKey = 'id',
  selectedIds = new Set(),
  onToggleRow,
  onToggleAll,
  onRowClick,
  loading = false,
  refreshing = false,
  emptyText = 'No results found',
  sort = null,
  onSort = null,
  maxHeight = 'calc(100vh - 300px)',
  ariaLabel = 'Data table',
}) {
  const selectable = !!onToggleRow;
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r[rowKey]));
  const someSelected = rows.some((r) => selectedIds.has(r[rowKey]));
  const sortArrow = (key) => (sort && sort.key === key ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : '');
  const colSpan = columns.length + (selectable ? 1 : 0);

  // Keyboard parity with the mouse: rows are reachable by Tab, Enter/Space
  // opens the row, and `x` toggles selection (the convention Gmail/Linear use).
  // Without this the entire table was mouse-only.
  const onRowKeyDown = useCallback((e, row) => {
    const id = row[rowKey];
    if ((e.key === 'Enter' || e.key === ' ') && onRowClick) {
      e.preventDefault();
      onRowClick(row);
    } else if ((e.key === 'x' || e.key === 'X') && onToggleRow) {
      e.preventDefault();
      onToggleRow(id);
    }
  }, [rowKey, onRowClick, onToggleRow]);

  // Indeterminate is a DOM property, not an attribute — it cannot be set via
  // JSX. Without it "some selected" renders identically to "none selected".
  const selectAllRef = useCallback((node) => {
    if (node) node.indeterminate = someSelected && !allSelected;
  }, [someSelected, allSelected]);

  return (
    // The wrapper scrolls, so it needs to be focusable or a keyboard-only user
    // cannot scroll it at all (axe `scrollable-region-focusable`). A focusable
    // scroll container also needs a role + name, hence role="region".
    <div
      tabIndex={0}
      role="region"
      aria-label={ariaLabel}
      className="bg-white border border-neutral-200 rounded-lg shadow-card overflow-auto"
      style={maxHeight ? { maxHeight } : undefined}
    >
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            {selectable && (
              <th className="sticky top-0 z-10 bg-neutral-50 border-b border-neutral-200 w-10 px-3 py-3">
                <input
                  ref={selectAllRef}
                  type="checkbox"
                  checked={allSelected}
                  onChange={onToggleAll}
                  aria-label={allSelected ? 'Deselect all rows' : 'Select all rows'}
                  className="rounded border-neutral-300 text-primary-500 focus:ring-primary-400"
                />
              </th>
            )}
            {columns.map((col) => {
              const sortable = col.sortable && onSort;
              return (
                <th
                  key={col.key}
                  style={col.width ? { width: col.width } : undefined}
                  aria-sort={sort && sort.key === col.key ? (sort.dir === 'desc' ? 'descending' : 'ascending') : undefined}
                  className="sticky top-0 z-10 bg-neutral-50 border-b border-neutral-200 text-left px-3 py-3
                    text-[11px] font-semibold uppercase tracking-wider text-neutral-500"
                >
                  {sortable ? (
                    <button type="button" onClick={() => onSort(col.key)} className="inline-flex items-center gap-0.5 uppercase tracking-wider hover:text-neutral-800">
                      {col.label}<span className="text-primary-600">{sortArrow(col.key)}</span>
                    </button>
                  ) : col.label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody aria-busy={loading || refreshing}>
          {loading ? (
            // Skeleton rows, not a "Loading…" line: the table keeps its shape,
            // so the page does not collapse and reflow on every load.
            Array.from({ length: 8 }).map((_, i) => (
              <tr key={`skeleton-${i}`} className="border-b border-neutral-100">
                {Array.from({ length: colSpan }).map((__, j) => (
                  <td key={j} className="px-3 py-2.5">
                    <div className="h-3 rounded bg-neutral-200/70 animate-pulse" style={{ width: `${j === 0 ? 40 : 55 + ((i + j) % 4) * 10}%` }} />
                  </td>
                ))}
              </tr>
            ))
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={colSpan} className="px-4 py-12 text-center text-neutral-500">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const id = row[rowKey];
              const isSelected = selectedIds.has(id);
              const interactive = Boolean(onRowClick || onToggleRow);
              return (
                <tr
                  key={id}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={interactive ? (e) => onRowKeyDown(e, row) : undefined}
                  tabIndex={interactive ? 0 : undefined}
                  aria-selected={selectable ? isSelected : undefined}
                  className={`border-b border-neutral-100 transition-colors duration-150
                    focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-400
                    ${onRowClick ? 'cursor-pointer' : ''}
                    ${refreshing ? 'opacity-60' : ''}
                    ${isSelected
                      ? 'bg-primary-50 shadow-[inset_3px_0_0_theme(colors.primary.500)]'
                      : 'bg-white hover:bg-neutral-50'}`}
                >
                  {selectable && (
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => onToggleRow(id)}
                        aria-label={row.rowAriaLabel || `Select row ${id}`}
                        className="rounded border-neutral-300 text-primary-500 focus:ring-primary-400"
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td key={col.key} className="px-3 py-2.5 text-neutral-600">
                      {col.render ? col.render(row) : row[col.key] ?? <span className="text-neutral-300">—</span>}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
