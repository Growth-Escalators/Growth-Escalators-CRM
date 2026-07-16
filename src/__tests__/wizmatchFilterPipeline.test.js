import { describe, expect, it } from 'vitest';
import { applyFilters, applySort, applyClientPipeline } from '../../admin/src/components/wizmatch/filters/filterPipeline.js';
import { csvCell, rowsToCsv } from '../../admin/src/components/wizmatch/filters/exportCsv.js';

const rows = [
  { id: 1, name: 'Priya Sharma', status: 'available', score: 82, skills: ['java', 'spring'], rate: 40, created: '2026-07-01' },
  { id: 2, name: 'Rahul Verma', status: 'benched', score: 40, skills: ['react'], rate: 25, created: '2026-06-15' },
  { id: 3, name: 'Asha Rao', status: 'available', score: 60, skills: ['java', 'aws'], rate: 55, created: '2026-07-10' },
];

describe('filterPipeline.applyFilters', () => {
  it('search matches across fields, case-insensitive', () => {
    const spec = [{ key: 'q', type: 'search', fields: ['name'] }];
    expect(applyFilters(rows, spec, { q: 'rao' }).map((r) => r.id)).toEqual([3]);
    expect(applyFilters(rows, spec, { q: '' }).length).toBe(3);
  });

  it('select is exact-match on a scalar field', () => {
    const spec = [{ key: 'status', type: 'select' }];
    expect(applyFilters(rows, spec, { status: 'available' }).map((r) => r.id)).toEqual([1, 3]);
  });

  it('multiselect matches scalar membership AND array-field intersection', () => {
    const statusSpec = [{ key: 'status', type: 'multiselect' }];
    expect(applyFilters(rows, statusSpec, { status: ['benched', 'available'] }).length).toBe(3);
    const skillSpec = [{ key: 'skills', type: 'multiselect' }];
    expect(applyFilters(rows, skillSpec, { skills: ['java'] }).map((r) => r.id)).toEqual([1, 3]);
    expect(applyFilters(rows, skillSpec, { skills: [] }).length).toBe(3);
  });

  it('numberRange respects min and max inclusively', () => {
    const spec = [{ key: 'score', type: 'numberRange' }];
    expect(applyFilters(rows, spec, { score: { min: 60, max: '' } }).map((r) => r.id)).toEqual([1, 3]);
    expect(applyFilters(rows, spec, { score: { min: 41, max: 81 } }).map((r) => r.id)).toEqual([3]);
  });

  it('dateRange filters by from/to (inclusive end-of-day)', () => {
    const spec = [{ key: 'created', type: 'dateRange' }];
    expect(applyFilters(rows, spec, { created: { from: '2026-07-01', to: '' } }).map((r) => r.id)).toEqual([1, 3]);
    expect(applyFilters(rows, spec, { created: { from: '', to: '2026-06-30' } }).map((r) => r.id)).toEqual([2]);
  });

  it('toggle uses a predicate when given (off = no-op)', () => {
    const spec = [{ key: 'highRate', type: 'toggle', predicate: (r) => r.rate >= 50 }];
    expect(applyFilters(rows, spec, { highRate: true }).map((r) => r.id)).toEqual([3]);
    expect(applyFilters(rows, spec, { highRate: false }).length).toBe(3);
  });

  it('combines multiple filters with AND', () => {
    const spec = [{ key: 'status', type: 'select' }, { key: 'score', type: 'numberRange' }];
    expect(applyFilters(rows, spec, { status: 'available', score: { min: 70, max: '' } }).map((r) => r.id)).toEqual([1]);
  });
});

describe('filterPipeline.applySort', () => {
  it('sorts numeric asc/desc and puts nulls last', () => {
    const cols = [{ key: 'score' }];
    expect(applySort(rows, { key: 'score', dir: 'asc' }, cols).map((r) => r.score)).toEqual([40, 60, 82]);
    expect(applySort(rows, { key: 'score', dir: 'desc' }, cols).map((r) => r.score)).toEqual([82, 60, 40]);
    const withNull = [...rows, { id: 4, score: null }];
    expect(applySort(withNull, { key: 'score', dir: 'asc' }, cols).at(-1)?.id).toBe(4);
  });

  it('uses a column sortAccessor', () => {
    const cols = [{ key: 'skillCount', sortAccessor: (r) => r.skills.length }];
    const byRate = [{ key: 'rateKey', sortAccessor: (r) => r.rate }];
    expect(applySort(rows, { key: 'rateKey', dir: 'asc' }, byRate).map((r) => r.id)).toEqual([2, 1, 3]);
    expect(applySort(rows, { key: 'skillCount', dir: 'desc' }, cols)[0].skills.length).toBe(2);
  });

  it('applyClientPipeline filters then sorts', () => {
    const spec = [{ key: 'status', type: 'select' }];
    const cols = [{ key: 'score' }];
    const out = applyClientPipeline(rows, spec, { status: 'available' }, { key: 'score', dir: 'desc' }, cols);
    expect(out.map((r) => r.id)).toEqual([1, 3]);
  });
});

describe('exportCsv', () => {
  it('escapes cells containing comma, quote or newline', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
    expect(csvCell(null)).toBe('');
  });

  it('builds a CSV from visible columns with exportValue + exportable', () => {
    const columns = [
      { key: 'name', label: 'Name' },
      { key: 'skills', label: 'Skills', exportValue: (r) => r.skills.join('; ') },
      { key: 'secret', label: 'Secret', exportable: false },
    ];
    const csv = rowsToCsv([rows[0]], columns);
    const [header, line] = csv.split('\r\n');
    expect(header).toBe('Name,Skills');
    expect(line).toBe('Priya Sharma,java; spring');
    expect(csv).not.toContain('Secret');
  });
});
