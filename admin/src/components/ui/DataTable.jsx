import React from 'react';

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
  emptyText = 'No results found',
  tableLabel = 'Results',
}) {
  const selectable = !!onToggleRow;
  const allSelected = rows.length > 0 && rows.every((r) => selectedIds.has(r[rowKey]));

  return (
    <div className="bg-white border border-neutral-200 rounded-lg shadow-card overflow-x-auto">
      <table className="w-full min-w-[720px] text-sm border-collapse" aria-label={tableLabel} aria-busy={loading}>
        <thead>
          <tr>
            {selectable && (
              <th className="bg-neutral-50 border-b border-neutral-200 w-10 px-3 py-3">
                <input
                  type="checkbox"
                  aria-label={allSelected ? 'Clear all row selections' : 'Select all rows'}
                  checked={allSelected}
                  onChange={onToggleAll}
                  className="rounded border-neutral-300 text-primary-500 focus:ring-primary-400"
                />
              </th>
            )}
            {columns.map((col) => (
              <th
                key={col.key}
                style={col.width ? { width: col.width } : undefined}
                className="bg-neutral-50 border-b border-neutral-200 text-left px-3 py-3
                  text-[11px] font-semibold uppercase tracking-wider text-neutral-500"
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-12 text-center text-neutral-400">
                Loading…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length + (selectable ? 1 : 0)} className="px-4 py-12 text-center text-neutral-400">
                {emptyText}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const id = row[rowKey];
              const isSelected = selectedIds.has(id);
              return (
                <tr
                  key={id}
                  onClick={() => onRowClick?.(row)}
                  onKeyDown={(event) => {
                    if (!onRowClick || (event.key !== 'Enter' && event.key !== ' ')) return;
                    event.preventDefault();
                    onRowClick(row);
                  }}
                  tabIndex={onRowClick ? 0 : undefined}
                  aria-label={onRowClick ? `Open ${row.name || row.title || row.first_name || 'record'}` : undefined}
                  className={`border-b border-neutral-100 transition-colors duration-150
                    ${onRowClick ? 'cursor-pointer' : ''}
                    ${isSelected
                      ? 'bg-primary-50 shadow-[inset_3px_0_0_theme(colors.primary.500)]'
                      : 'bg-white hover:bg-neutral-50'}`}
                >
                  {selectable && (
                    <td className="px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${row.name || row.title || row.first_name || 'row'}`}
                        checked={isSelected}
                        onChange={() => onToggleRow(id)}
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
