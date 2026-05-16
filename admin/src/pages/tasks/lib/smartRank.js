// Smart-rank — pure client-side heuristic for the Tasks board.
//
// The score is intentionally a negative-is-better number so smaller score =
// higher priority = lower rank number (#1 is the most important task).
//
//   score = -(overdueDays * 4)
//           - priorityWeight(high=3, med=2, low=1)
//           - (assigneeIsMe ? 2 : 0)
//
// We assign ranks 1..5 to the top 5 tasks per board. Tasks ranked 6+ get
// `undefined` so the SmartBadge atom stays hidden for them.

const PRIORITY_WEIGHT = { high: 3, medium: 2, low: 1 };

function priorityWeight(p) {
  return PRIORITY_WEIGHT[p] ?? PRIORITY_WEIGHT.medium;
}

function overdueDays(task, now) {
  if (!task?.dueAt) return 0;
  const due = new Date(task.dueAt).getTime();
  if (Number.isNaN(due)) return 0;
  const diffMs = now.getTime() - due;
  if (diffMs <= 0) return 0;
  return diffMs / (24 * 60 * 60 * 1000);
}

function scoreTask(task, currentUserId, now) {
  const od = overdueDays(task, now);
  const pw = priorityWeight(task?.priority);
  const me = currentUserId && task?.assignedTo === currentUserId ? 2 : 0;
  return -(od * 4) - pw - me;
}

/**
 * computeSmartRanks — pure function.
 * @param {Array<object>} tasks
 * @param {string|null|undefined} currentUserId
 * @param {Date} [now=new Date()]
 * @returns {Map<string, number>} taskId → rank (1..5). Only the top 5 are present.
 */
export function computeSmartRanks(tasks, currentUserId, now = new Date()) {
  const out = new Map();
  if (!Array.isArray(tasks) || tasks.length === 0) return out;

  // Only rank non-done tasks — done tasks shouldn't crowd the top 5.
  const candidates = tasks.filter((t) => t && t.status !== 'done' && t.id != null);

  const scored = candidates.map((t) => ({
    id: t.id,
    score: scoreTask(t, currentUserId, now),
  }));

  // Ascending: smallest (most negative) score wins rank #1.
  scored.sort((a, b) => a.score - b.score);

  const topN = Math.min(5, scored.length);
  for (let i = 0; i < topN; i++) {
    out.set(scored[i].id, i + 1);
  }
  return out;
}

/**
 * withSmartRanks — return a new array of tasks with `smartRank` set on the
 * top 5 (per computeSmartRanks). Pure: input array and items are not mutated.
 *
 * @param {Array<object>} tasks
 * @param {string|null|undefined} currentUserId
 * @param {Date} [now]
 */
export function withSmartRanks(tasks, currentUserId, now = new Date()) {
  if (!Array.isArray(tasks)) return [];
  const ranks = computeSmartRanks(tasks, currentUserId, now);
  return tasks.map((t) => {
    if (!t || t.id == null) return t;
    const rank = ranks.get(t.id);
    if (rank) return { ...t, smartRank: rank };
    // Strip any previously-set smartRank so toggling user/data updates cleanly.
    if (t.smartRank != null) {
      const { smartRank: _drop, ...rest } = t;
      return rest;
    }
    return t;
  });
}
