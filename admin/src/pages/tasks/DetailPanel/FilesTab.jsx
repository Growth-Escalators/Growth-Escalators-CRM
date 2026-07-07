// FilesTab — task attachments (URL entries + uploaded files).
// GET    /api/tasks/:id/attachments
// POST   /api/tasks/:id/attachments   JSON { kind:'url', url, label }  OR
//                                     FormData with 'file'
// DELETE /api/tasks/:id/attachments/:attId
// File download: GET /api/tasks/:id/attachments/:attId/download (binary stream,
// requires the Bearer token — fetched manually then opened via blob URL).

import React, { useEffect, useRef, useState } from 'react';
import { Paperclip, Link as LinkIcon, X, Upload } from 'lucide-react';
import { apiFetch } from '../../../lib/api.js';
import { clearAuthSession, getAuthToken } from '../../../lib/auth.js';

function fmtSize(bytes) {
  if (!bytes && bytes !== 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 1048.576) / 10} MB`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  return d.toLocaleDateString();
}

export default function FilesTab({ task }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showUrl, setShowUrl] = useState(false);
  const [urlVal, setUrlVal] = useState('');
  const [urlLabel, setUrlLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiFetch(`/api/tasks/${task.id}/attachments`)
      .then((d) => { if (alive) setItems(Array.isArray(d?.attachments) ? d.attachments : []); })
      .catch((e) => { if (alive) setError(e.message || 'Failed to load'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [task.id]);

  const addUrl = async () => {
    const url = urlVal.trim();
    if (!url) return;
    setBusy(true);
    setError(null);
    try {
      const d = await apiFetch(`/api/tasks/${task.id}/attachments`, {
        method: 'POST',
        body: JSON.stringify({ kind: 'url', url, label: urlLabel.trim() || undefined }),
      });
      if (d?.attachment) setItems((it) => [...it, d.attachment]);
      setShowUrl(false);
      setUrlVal('');
      setUrlLabel('');
    } catch (e) {
      setError(e.message || 'Add URL failed');
    } finally {
      setBusy(false);
    }
  };

  const uploadFile = async (file) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    const fd = new FormData();
    fd.append('file', file);
    try {
      // FormData → don't set Content-Type; let the browser add the boundary.
      const token = getAuthToken();
      const res = await fetch(`/api/tasks/${task.id}/attachments`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      if (res.status === 401) {
        clearAuthSession();
        window.location.href = '/login';
        return;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || `Upload failed (${res.status})`);
      if (data?.attachment) setItems((it) => [...it, data.attachment]);
    } catch (e) {
      setError(e.message || 'Upload failed');
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const remove = async (att) => {
    const snapshot = items;
    setItems((it) => it.filter((x) => x.id !== att.id));
    try {
      await apiFetch(`/api/tasks/${task.id}/attachments/${att.id}`, { method: 'DELETE' });
    } catch (e) {
      setItems(snapshot);
      setError(e.message || 'Delete failed');
    }
  };

  const open = async (att) => {
    if (att.kind === 'url' && att.url) {
      window.open(att.url, '_blank', 'noopener,noreferrer');
      return;
    }
    // Uploaded file — needs auth header, can't use plain <a href>.
    try {
      const token = getAuthToken();
      const res = await fetch(`/api/tasks/${task.id}/attachments/${att.id}/download`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      // Revoke later so the new tab has time to consume it.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
    } catch (e) {
      setError(e.message || 'Download failed');
    }
  };

  return (
    <div>
      {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}

      {/* Action row */}
      <div className="flex items-center gap-2 mb-3">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-md px-2.5 py-1 disabled:opacity-50"
        >
          <Upload className="w-3.5 h-3.5" /> Upload file
        </button>
        <input
          ref={fileRef}
          type="file"
          className="hidden"
          onChange={(e) => uploadFile(e.target.files?.[0])}
        />
        <button
          type="button"
          onClick={() => setShowUrl((v) => !v)}
          disabled={busy}
          className="inline-flex items-center gap-1.5 text-xs text-slate-700 hover:text-slate-900 border border-slate-200 hover:border-slate-300 rounded-md px-2.5 py-1 disabled:opacity-50"
        >
          <LinkIcon className="w-3.5 h-3.5" /> Add URL
        </button>
      </div>

      {showUrl && (
        <div className="mb-3 border border-slate-200 rounded-lg p-2 bg-slate-50/50">
          <input
            autoFocus
            value={urlVal}
            onChange={(e) => setUrlVal(e.target.value)}
            placeholder="https://…"
            className="w-full text-sm bg-white border border-slate-200 rounded px-2 py-1 outline-none focus:border-sky-300 mb-1.5"
          />
          <input
            value={urlLabel}
            onChange={(e) => setUrlLabel(e.target.value)}
            placeholder="Label (optional)"
            className="w-full text-sm bg-white border border-slate-200 rounded px-2 py-1 outline-none focus:border-sky-300"
          />
          <div className="mt-1.5 flex items-center gap-2">
            <button
              type="button"
              onClick={addUrl}
              disabled={!urlVal.trim() || busy}
              className="text-xs bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white font-medium px-2.5 py-1 rounded-md"
            >
              Add
            </button>
            <button
              type="button"
              onClick={() => { setShowUrl(false); setUrlVal(''); setUrlLabel(''); }}
              className="text-xs text-slate-500 hover:text-slate-800"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-xs text-slate-400">Loading files…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-400 italic">No files yet.</p>
      ) : (
        <div className="space-y-2">
          {items.map((att) => {
            const isUrl = att.kind === 'url';
            const label = att.label || (isUrl ? att.url : `Attachment ${att.id?.slice?.(0, 8) || ''}`);
            return (
              <div
                key={att.id}
                onClick={() => open(att)}
                className="flex items-center gap-2 border border-slate-200 rounded-lg px-3 py-2 hover:bg-slate-50 cursor-pointer group"
              >
                <span className="w-8 h-8 rounded bg-sky-50 text-sky-600 flex items-center justify-center shrink-0">
                  {isUrl ? <LinkIcon className="w-4 h-4" /> : <Paperclip className="w-4 h-4" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-slate-800 truncate">{label}</p>
                  <p className="text-[10px] text-slate-500 truncate">
                    {isUrl ? att.url : [att.mimeType, fmtSize(att.sizeBytes)].filter(Boolean).join(' · ')}
                    {att.createdAt && (isUrl || att.mimeType || att.sizeBytes) ? ' · ' : ''}
                    {timeAgo(att.createdAt)}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); remove(att); }}
                  className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-500 shrink-0"
                  aria-label="Remove attachment"
                  title="Remove attachment"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
