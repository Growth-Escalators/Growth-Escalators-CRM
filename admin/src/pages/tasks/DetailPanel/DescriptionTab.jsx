// DescriptionTab — autoresizing textarea. PATCH /api/tasks/:id { description }
// on blur. Parent owns optimistic update + rollback via onPatch.

import React, { useEffect, useRef, useState } from 'react';

export default function DescriptionTab({ task, onPatch }) {
  const [value, setValue] = useState(task.description || '');
  const taRef = useRef(null);

  // Keep textarea synced with prop changes (e.g. cycling tasks).
  useEffect(() => { setValue(task.description || ''); }, [task.id]);

  // Auto-grow on each render.
  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  const commit = () => {
    const next = value.trim() === '' ? null : value;
    const cur = task.description || null;
    if (next === cur) return;
    onPatch({ description: next });
  };

  return (
    <div className="text-sm text-slate-700 leading-relaxed">
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        placeholder="Add context, links, or acceptance criteria…"
        rows={3}
        className="w-full bg-transparent outline-none resize-none p-2 -ml-2 rounded-md focus:bg-slate-50 placeholder:text-slate-400 placeholder:italic"
      />
    </div>
  );
}
