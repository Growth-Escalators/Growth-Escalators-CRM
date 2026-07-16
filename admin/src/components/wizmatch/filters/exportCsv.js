// Shared CSV export for the Wizmatch filter/table system. Splits the pure
// CSV-building (testable) from the browser download.

/** Escape one CSV cell (RFC-4180-ish: quote when it contains ", comma or newline). */
export function csvCell(value) {
  if (value == null) return '';
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Build a CSV string from rows × the given columns. A column is exported unless
 * `exportable === false`; its cell comes from `exportValue(row)` when provided,
 * else `row[col.key]`.
 * @param {Array<object>} rows
 * @param {Array<{key:string,label:string,exportable?:boolean,exportValue?:(row:object)=>any}>} columns
 * @returns {string}
 */
export function rowsToCsv(rows, columns) {
  const cols = (columns || []).filter((c) => c.exportable !== false);
  const header = cols.map((c) => csvCell(c.label)).join(',');
  const lines = (rows || []).map((row) =>
    cols.map((c) => csvCell(c.exportValue ? c.exportValue(row) : row[c.key])).join(','),
  );
  return [header, ...lines].join('\r\n');
}

/** Trigger a browser download of `csv` as `filename`. No-op outside a DOM. */
export function downloadCsv(csv, filename = 'wizmatch-export.csv') {
  if (typeof document === 'undefined') return;
  const blob = new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/** Convenience: build + download in one call. */
export function exportRowsToCsv(rows, columns, filename) {
  downloadCsv(rowsToCsv(rows, columns), filename);
}
