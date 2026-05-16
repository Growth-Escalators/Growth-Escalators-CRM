// Format + display helpers for the Tasks redesign.
// Ported from prototype tasks/data.jsx and adapted for real API field names
// (assignedTo instead of mock 'assignee', commentCount/attachmentCount, etc.).

export function initials(name) {
  if (!name) return '?';
  const parts = String(name).trim().split(/\s+/);
  return (parts.length === 1
    ? parts[0].slice(0, 2)
    : parts[0][0] + parts[parts.length - 1][0]
  ).toUpperCase();
}

// Resolve a task.assignedTo value (uuid or legacy email) → human name string,
// falling back to the raw value if no team match.
export function displayAssignee(value, team) {
  if (!value) return null;
  if (!Array.isArray(team)) return value;
  const m = team.find((t) => t.id === value || t.email === value);
  return m?.name || m?.email || value;
}

// Relative-distance formatter — "Today", "Tomorrow", "Yesterday",
// weekday short for in-week, "Nd overdue" for past, day+month for far future.
export function fmtDue(iso, now = new Date()) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const dueDay = new Date(d); dueDay.setHours(0, 0, 0, 0);
  const diff = Math.round((dueDay - today) / 86400000);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toLocaleDateString('en-US', { weekday: 'short' });
  if (diff < 0) return `${Math.abs(diff)}d overdue`;
  return d.toLocaleDateString('en-US', { day: 'numeric', month: 'short' });
}

// Ageing tone for a task — used to colour the DueChip.
export function dueTone(task, now = new Date()) {
  if (!task?.dueAt || task.status === 'done') return 'neutral';
  const d = new Date(task.dueAt);
  if (isNaN(d.getTime())) return 'neutral';
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const dueDay = new Date(d); dueDay.setHours(0, 0, 0, 0);
  const diff = Math.round((dueDay - today) / 86400000);
  if (diff < 0) return 'overdue';
  if (diff <= 1) return 'soon';
  if (diff <= 7) return 'week';
  return 'later';
}
