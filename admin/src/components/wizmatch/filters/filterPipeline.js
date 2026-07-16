// Pure client-side filter + sort for the Wizmatch filter/table system. Used by
// pages whose lists are fully loaded within a cap (Companies, Hiring Contacts,
// Talent Matching, Delivery, Placements, Contact Intelligence). Server-paginated
// pages send the same filter values to the backend instead (see useTableControls
// .toQueryParams). Filter defs are the same declarative `spec` FilterBar renders.
//
// Def shape: { key, type, accessor?, fields?, predicate? }
//   type: 'search' | 'select' | 'multiselect' | 'numberRange' | 'dateRange' | 'toggle'
// Value shapes by type: string | string | string[] | {min,max} | {from,to} | boolean

function getVal(row, def) {
  return def.accessor ? def.accessor(row) : row[def.key];
}

function isEmpty(v) {
  return v == null || v === '' || (Array.isArray(v) && v.length === 0)
    || (typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => x == null || x === ''));
}

function matchOne(row, def, v) {
  // A toggle is only a filter when ON; false/undefined means "don't filter".
  if (def.type === 'toggle') return v ? (def.predicate ? def.predicate(row) : Boolean(getVal(row, def))) : true;
  if (isEmpty(v)) return true;
  switch (def.type) {
    case 'search': {
      const q = String(v).toLowerCase().trim();
      if (!q) return true;
      const fields = def.fields || [def.key];
      return fields.some((f) => String(row[f] ?? '').toLowerCase().includes(q));
    }
    case 'select':
      return String(getVal(row, def) ?? '') === String(v);
    case 'multiselect': {
      const rowVal = getVal(row, def);
      const set = new Set(v.map(String));
      if (Array.isArray(rowVal)) return rowVal.some((x) => set.has(String(x)));
      return set.has(String(rowVal ?? ''));
    }
    case 'numberRange': {
      const n = Number(getVal(row, def));
      if (Number.isNaN(n)) return false;
      if (v.min != null && v.min !== '' && n < Number(v.min)) return false;
      if (v.max != null && v.max !== '' && n > Number(v.max)) return false;
      return true;
    }
    case 'dateRange': {
      const raw = getVal(row, def);
      if (!raw) return false;
      const d = new Date(raw).getTime();
      if (Number.isNaN(d)) return false;
      if (v.from && d < new Date(v.from).getTime()) return false;
      if (v.to && d > new Date(v.to).getTime() + 86_399_999) return false; // inclusive end-of-day
      return true;
    }
    case 'toggle':
      return def.predicate ? def.predicate(row) : Boolean(getVal(row, def));
    default:
      return true;
  }
}

/** Keep rows matching every active filter (AND across filters). */
export function applyFilters(rows, spec, values) {
  return (rows || []).filter((row) => spec.every((def) => matchOne(row, def, values[def.key])));
}

/** Sort rows by { key, dir }, using a column's sortAccessor when provided. */
export function applySort(rows, sort, columns) {
  if (!sort || !sort.key) return rows;
  const col = (columns || []).find((c) => c.key === sort.key);
  const accessor = col?.sortAccessor || ((r) => r[sort.key]);
  const dir = sort.dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = accessor(a);
    const bv = accessor(b);
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
    return String(av).localeCompare(String(bv), undefined, { numeric: true }) * dir;
  });
}

/** Filter then sort — the full client pipeline. */
export function applyClientPipeline(rows, spec, values, sort, columns) {
  return applySort(applyFilters(rows, spec, values), sort, columns);
}
