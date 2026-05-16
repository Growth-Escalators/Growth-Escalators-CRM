// Avatar — initials in a colour-hashed circle.
// Caller passes an already-resolved display name (use lib/format.displayAssignee
// to turn a userId into a name first).

import React from 'react';
import { avatarTone } from '../lib/tokens.js';
import { initials } from '../lib/format.js';

const SIZE_CLS = {
  sm: 'w-5 h-5 text-[9px]',
  md: 'w-6 h-6 text-[10px]',
  lg: 'w-8 h-8 text-[11px]',
};

export default function Avatar({ name, size = 'sm', ring = false, title }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-full font-semibold text-white ${SIZE_CLS[size] || SIZE_CLS.sm} ${avatarTone(name)} ${ring ? 'ring-2 ring-white' : ''}`}
      title={title || name || 'Unassigned'}
    >
      {initials(name)}
    </span>
  );
}
