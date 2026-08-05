import React from 'react';

// The floor tier — always available, on every platform, per
// src/services/siteChangeCapabilities.ts's resolveSiteChangePreviewTier():
// "elements is the floor: it renders even when the other two are absent, so
// an operator is never asked to approve a change they cannot see."
//
// `before`/`after` are SeoElements (src/modules/site/liveSnapshot.ts):
// metaTitle, metaDescription, canonicalUrl, robots, h1, h1Count, jsonLdTypes,
// wordCount, internalLinkCount, externalLinkCount. `before` is the live page
// as last read by the drift sweep; it can legitimately be absent (a brand
// new page has no prior snapshot to compare against) — that is disclosed,
// not hidden.

function textValue(v) {
  if (v === null || v === undefined || v === '') {
    return <span className="italic text-neutral-400">(empty)</span>;
  }
  return v;
}

function numberValue(v) {
  if (v === null || v === undefined) return <span className="text-neutral-400">—</span>;
  return Number(v).toLocaleString('en-IN');
}

function listValue(v) {
  if (!Array.isArray(v) || v.length === 0) {
    return <span className="italic text-neutral-400">(none)</span>;
  }
  return v.join(', ');
}

function listsEqual(a, b) {
  const arrA = Array.isArray(a) ? a : [];
  const arrB = Array.isArray(b) ? b : [];
  return arrA.length === arrB.length && arrA.every((v, i) => v === arrB[i]);
}

const FIELDS = [
  { key: 'metaTitle', label: 'Meta title', format: textValue },
  { key: 'metaDescription', label: 'Meta description', format: textValue },
  { key: 'canonicalUrl', label: 'Canonical URL', format: textValue },
  { key: 'robots', label: 'Robots', format: textValue },
  { key: 'h1', label: 'H1', format: textValue },
  { key: 'h1Count', label: 'H1 count', format: numberValue, equal: (a, b) => a === b },
  { key: 'jsonLdTypes', label: 'JSON-LD types', format: listValue, equal: listsEqual },
  { key: 'wordCount', label: 'Word count', format: numberValue, equal: (a, b) => a === b },
  { key: 'internalLinkCount', label: 'Internal links', format: numberValue, equal: (a, b) => a === b },
  { key: 'externalLinkCount', label: 'External links', format: numberValue, equal: (a, b) => a === b },
];

export default function SeoElementCompare({ before, after }) {
  if (!after) {
    // The floor tier failing to load is not a "nothing to show" state — every
    // other tier degrades to this one, so an empty `after` means the preview
    // call itself came back malformed, not that the change has no content.
    return (
      <p className="text-[12.5px] text-neutral-500">
        No element data was returned for this change. Try reloading the preview.
      </p>
    );
  }

  return (
    <div>
      {!before && (
        <p className="text-[11.5px] text-warning-700 bg-warning-500/10 border border-warning-500/20 rounded-md px-2.5 py-1.5 mb-2">
          No previous snapshot exists for this page yet (new page, or never crawled) — only the proposed
          values are shown below.
        </p>
      )}
      <div
        role="region"
        aria-label="Before and after comparison of this page's SEO elements"
        tabIndex={0}
        className="overflow-x-auto rounded-lg border border-neutral-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary-400"
      >
        <table className="w-full text-left border-collapse text-[12px]">
          <thead>
            <tr className="bg-neutral-50 border-b border-neutral-200">
              <th scope="col" className="px-3 py-2 font-semibold text-neutral-500 text-[11px] uppercase tracking-wider">Field</th>
              <th scope="col" className="px-3 py-2 font-semibold text-neutral-500 text-[11px] uppercase tracking-wider">Before</th>
              <th scope="col" className="px-3 py-2 font-semibold text-neutral-500 text-[11px] uppercase tracking-wider">After</th>
            </tr>
          </thead>
          <tbody>
            {FIELDS.map((field) => {
              const beforeVal = before ? before[field.key] : undefined;
              const afterVal = after[field.key];
              const equal = field.equal ? field.equal : (a, b) => a === b;
              // Without a `before` snapshot every row is trivially "changed"
              // (there is nothing to compare against) — that would just repeat
              // the banner above on every single row, so the per-row marker is
              // suppressed in that case and the banner carries the message once.
              const changed = !!before && !equal(beforeVal, afterVal);
              return (
                <tr key={field.key} className={`border-b border-neutral-100 last:border-0 ${changed ? 'bg-warning-500/5' : ''}`}>
                  <th scope="row" className="px-3 py-2 align-top font-semibold text-neutral-700 whitespace-nowrap">
                    <span className="inline-flex items-center gap-1.5">
                      {field.label}
                      {changed && <span className="badge-warning text-[10px]">changed</span>}
                    </span>
                  </th>
                  <td className="px-3 py-2 align-top text-neutral-600">
                    {before ? field.format(beforeVal) : <span className="text-neutral-400">—</span>}
                  </td>
                  <td className="px-3 py-2 align-top text-neutral-900">{field.format(afterVal)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
