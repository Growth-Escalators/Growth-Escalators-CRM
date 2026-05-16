// Small tag pill, colour-hashed by tag string. Optional X removal control.

import React from 'react';
import { X } from 'lucide-react';
import { tagColor } from '../lib/tokens.js';

export default function TagChip({ tag, onRemove }) {
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-px text-[10px] font-medium rounded ${tagColor(tag)}`}>
      {tag}
      {onRemove && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemove(tag); }}
          aria-label={`Remove tag ${tag}`}
          className="opacity-60 hover:opacity-100"
        >
          <X className="w-2.5 h-2.5" aria-hidden />
        </button>
      )}
    </span>
  );
}
