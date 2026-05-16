// Priority pill — colored square dot + uppercase label.
// Only used on cards when the priority is "high" (visual emphasis); the
// priority bar on the left of the TaskCard handles all-priority indication.

import React from 'react';
import { PRIORITY_STYLES } from '../lib/tokens.js';

export default function PriorityFlag({ priority }) {
  const p = PRIORITY_STYLES[priority] || PRIORITY_STYLES.medium;
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider ${p.text}`}>
      <span className={`w-1.5 h-1.5 rounded-sm ${p.dot}`} aria-hidden />
      {p.label}
    </span>
  );
}
