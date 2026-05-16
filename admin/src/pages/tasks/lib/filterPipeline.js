// Filter pipeline — mirrors the order in prototype tasks/app.jsx (lines 40-58):
//   scope → assignee → priority → due → list
//
// Pure function. Hands back a new array; never mutates the input.

import { dueTone } from './format.js';

export function applyFilters(tasks, { scope, filters, listFilter, currentUserId }) {
  if (!Array.isArray(tasks)) return [];
  let out = tasks;

  if (scope === 'mine' && currentUserId) {
    out = out.filter((t) => t.assignedTo === currentUserId);
  } else if (scope === 'today') {
    out = out.filter((t) => t.dueAt && dueTone(t) === 'soon');
  }

  if (filters?.assignee) {
    out = out.filter((t) => t.assignedTo === filters.assignee);
  }

  if (filters?.priority) {
    out = out.filter((t) => (t.priority || 'medium') === filters.priority);
  }

  if (filters?.due) {
    const f = filters.due;
    out = out.filter((t) => {
      if (!t.dueAt) return false;
      const tone = dueTone(t);
      if (f === 'overdue') return tone === 'overdue';
      if (f === 'today')   return tone === 'soon';
      if (f === 'week')    return tone === 'soon' || tone === 'week';
      return true;
    });
  }

  if (listFilter) {
    out = out.filter((t) => t.listId === listFilter);
  }

  return out;
}
