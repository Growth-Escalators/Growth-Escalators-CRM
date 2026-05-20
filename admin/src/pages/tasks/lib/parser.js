// Natural-language quick-capture parser. Pure function — takes a raw input
// string + the current team roster and returns the parsed task shape that
// TasksPage.onCreateFromHeader expects.
//
// Token grammar (consumed in this order, then stripped from the title text):
//   !high | !med | !medium | !low        → priority
//   @name-fragment                       → assignee id (team[].name.toLowerCase().includes(fragment))
//   #tag (multiple allowed)              → tags array
//   today | tomorrow | tmrw | mon |
//   monday | fri | friday                → dueLabel + resolved dueAt ISO
//
// Anything left after consuming tokens (with whitespace collapsed) becomes the
// title. Matches the prototype's parsing logic in tasks/header.jsx + the
// dueAt resolution in tasks/app.jsx (onCreateFromCapture).

const PRIORITY_RE = /!(high|med(?:ium)?|low)\b/i;
const ASSIGNEE_RE = /@([\w.-]+)/;
const TAG_RE = /#(\w+)/g;
const DUE_RE = /\b(today|tomorrow|tmrw|fri|friday|mon|monday)\b/i;

function normalizePriority(raw) {
  const r = raw.toLowerCase();
  if (r.startsWith('h')) return 'high';
  if (r.startsWith('l')) return 'low';
  return 'medium';
}

// Resolve a due-label keyword into an ISO timestamp anchored to a reference
// "now". Time-of-day is normalised to 12:00 local so dueTone() lands on the
// correct day regardless of when the user types.
export function resolveDueAt(label, now = new Date()) {
  if (!label) return null;
  const d = new Date(now);
  d.setHours(12, 0, 0, 0);
  const l = label.toLowerCase();
  if (l === 'today') {
    // already set to noon today
  } else if (l === 'tomorrow' || l === 'tmrw') {
    d.setDate(d.getDate() + 1);
  } else if (l.startsWith('mon')) {
    // next Monday (if today is Monday, skip to next week)
    const delta = ((1 - d.getDay() + 7) % 7) || 7;
    d.setDate(d.getDate() + delta);
  } else if (l.startsWith('fri')) {
    const delta = ((5 - d.getDay() + 7) % 7) || 7;
    d.setDate(d.getDate() + delta);
  } else {
    return null;
  }
  return d.toISOString();
}

// Pure parser. `team` is the array fetched by TasksPage; entries are expected
// to have `id` + `name` (optionally `email`). Pass `now` for tests.
export function parseQuickCapture(text, team = [], now = new Date()) {
  if (!text || !text.trim()) {
    return { title: '', priority: null, assignee: null, assigneeAmbiguous: false, tags: [], dueLabel: null, dueAt: null };
  }
  let t = text;

  let priority = null;
  const prio = t.match(PRIORITY_RE);
  if (prio) {
    priority = normalizePriority(prio[1]);
    t = t.replace(prio[0], '');
  }

  // Assignee: substring match on team[].name. If the fragment matches more
  // than one team member ("@sara" → "Sara" + "Sarah"), refuse to guess —
  // leave assignee null and strip the token so it doesn't pollute the title.
  // The UI can surface "@sara — ambiguous" in the preview chip.
  let assignee = null;
  let assigneeAmbiguous = false;
  const a = t.match(ASSIGNEE_RE);
  if (a) {
    const frag = a[1].toLowerCase();
    const matches = Array.isArray(team)
      ? team.filter((tm) => (tm?.name || '').toLowerCase().includes(frag))
      : [];
    // Prefer an exact (case-insensitive) name match if one exists — that lets
    // typing "@sarah" find Sarah unambiguously even when "Sara" is also on
    // the team.
    const exact = matches.find((tm) => (tm?.name || '').toLowerCase() === frag);
    if (exact) {
      assignee = exact.id;
      t = t.replace(a[0], '');
    } else if (matches.length === 1) {
      assignee = matches[0].id;
      t = t.replace(a[0], '');
    } else if (matches.length > 1) {
      assigneeAmbiguous = true;
      // Strip the token so the title is clean; the chip will show "ambiguous".
      t = t.replace(a[0], '');
    }
    // else: no match — leave the token in the title (user typo)
  }

  const tags = [];
  // Re-create the regex each pass to reset lastIndex (g-flag state).
  const tagMatches = [...t.matchAll(/#(\w+)/g)];
  for (const tm of tagMatches) {
    tags.push(tm[1]);
    t = t.replace(tm[0], '');
  }

  let dueLabel = null;
  let dueAt = null;
  const due = t.match(DUE_RE);
  if (due) {
    dueLabel = due[1].toLowerCase();
    dueAt = resolveDueAt(dueLabel, now);
    t = t.replace(due[0], '');
  }

  // Title = what's left, trimmed, internal whitespace collapsed.
  // Also clean up dangling "due" prefixes (people write "due tomorrow", we want "tomorrow" stripped + no stray "due").
  const title = t.replace(/\bdue\b/gi, '').trim().replace(/\s+/g, ' ');

  return { title, priority, assignee, assigneeAmbiguous, tags, dueLabel, dueAt };
}
