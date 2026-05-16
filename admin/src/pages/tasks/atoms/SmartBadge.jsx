// Smart-sort badge — gradient pill that shows the task's rank in the smart
// ordering. Rendered only when both smart-sort is on AND the task has a rank.

import React from 'react';
import { Sparkles } from 'lucide-react';

export default function SmartBadge({ rank }) {
  if (!rank) return null;
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-px text-[10px] font-semibold rounded bg-gradient-to-r from-sky-50 to-violet-50 text-sky-700 ring-1 ring-inset ring-sky-100"
      title={`Smart-sort rank #${rank} — prioritized for today`}
    >
      <Sparkles className="w-2.5 h-2.5" aria-hidden />
      #{rank}
    </span>
  );
}
