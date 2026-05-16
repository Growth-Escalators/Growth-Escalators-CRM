// Stack of up to N avatars with a "+extra" pill on the right.

import React from 'react';
import Avatar from './Avatar.jsx';

export default function AvatarGroup({ names = [], max = 3, size = 'sm' }) {
  const shown = names.slice(0, max);
  const extra = names.length - shown.length;
  const extraSize = size === 'md' ? 'w-6 h-6' : 'w-5 h-5';
  return (
    <span className="flex -space-x-1.5">
      {shown.map((n, i) => (
        <Avatar key={`${n}-${i}`} name={n} size={size} ring />
      ))}
      {extra > 0 && (
        <span
          className={`inline-flex items-center justify-center rounded-full bg-slate-100 text-slate-600 text-[9px] font-semibold ring-2 ring-white ${extraSize}`}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
