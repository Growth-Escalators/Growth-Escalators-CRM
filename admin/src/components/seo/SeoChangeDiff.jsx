import React from 'react';

// Renders the server-supplied unified diff for a `diff`-tier site change
// (GET /api/seo-changes/:id/preview -> { tier: 'diff', diff, ... }). This is
// the git-platform preview: the provider produces a real unified diff, so
// there is nothing to compute here — just per-line classification so an
// operator can scan it the way they would in a PR.
//
// No diff-rendering dependency exists anywhere in this repo and this is not
// the change that adds one — ~40 lines of line-prefix matching is enough for
// a unified diff, which has a fixed, well-known line grammar.

// Order matters: '+++'/'---' (file headers) must be checked before the
// single-character '+'/'-' (added/removed line) tests, since a file header
// line also starts with '+' or '-'.
function classify(line) {
  if (line.startsWith('@@')) return 'hunk';
  if (line.startsWith('+++') || line.startsWith('---')) return 'header';
  if (line.startsWith('+')) return 'add';
  if (line.startsWith('-')) return 'remove';
  return 'context';
}

const LINE_CLASS = {
  hunk: 'text-primary-700 bg-primary-500/10',
  header: 'text-neutral-500',
  add: 'text-success-700 bg-success-500/10',
  remove: 'text-danger-700 bg-danger-500/10',
  context: 'text-neutral-600',
};

export default function SeoChangeDiff({ diff }) {
  if (!diff || diff.trim().length === 0) {
    return <p className="text-[12.5px] text-neutral-500">No diff was returned for this change.</p>;
  }

  const lines = diff.split('\n');

  return (
    <div>
      {/* Text legend, not color alone — color-only meaning fails WCAG 1.4.1
          and a red/green diff is exactly the case that bites colorblind
          reviewers hardest. */}
      <div className="flex items-center gap-3 mb-1.5 text-[11px] text-neutral-500">
        <span><span className="text-success-700 font-semibold">+</span> added</span>
        <span><span className="text-danger-700 font-semibold">−</span> removed</span>
      </div>
      <div
        role="region"
        aria-label="Unified diff of this change"
        tabIndex={0}
        className="overflow-x-auto rounded-lg border border-neutral-200 bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        <pre className="text-[12px] leading-5 font-mono py-1.5 m-0">
          {lines.map((line, i) => (
            // Index is stable here — `lines` is a fresh split of an
            // immutable string prop on every render, never reordered.
            <div key={i} className={`px-3 whitespace-pre ${LINE_CLASS[classify(line)]}`}>
              {line.length === 0 ? ' ' : line}
            </div>
          ))}
        </pre>
      </div>
    </div>
  );
}
