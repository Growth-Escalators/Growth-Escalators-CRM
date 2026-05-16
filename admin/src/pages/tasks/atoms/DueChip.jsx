// Due-date pill — colour follows ageing (overdue/soon/week/later/neutral).

import React from 'react';
import { Calendar } from 'lucide-react';
import { DUE_PILL } from '../lib/tokens.js';
import { dueTone, fmtDue } from '../lib/format.js';

export default function DueChip({ task, big = false }) {
  if (!task?.dueAt) return null;
  const tone = dueTone(task);
  const cls = DUE_PILL[tone] || DUE_PILL.neutral;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded font-medium ${cls} ${
        big ? 'px-2 py-0.5 text-xs' : 'px-1.5 py-px text-[10px]'
      }`}
    >
      <Calendar className={big ? 'w-3 h-3' : 'w-2.5 h-2.5'} aria-hidden />
      {fmtDue(task.dueAt)}
    </span>
  );
}
