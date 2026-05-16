// ActivityTab — task comments thread.
// GET    /api/tasks/:id/comments
// POST   /api/tasks/:id/comments        { body }
// PATCH  /api/tasks/:id/comments/:commentId { body }
// DELETE /api/tasks/:id/comments/:commentId
// Edit/delete restricted to current user (authorUserId === current.id).

import React, { useEffect, useMemo, useState } from 'react';
import { apiFetch, getUser } from '../../../lib/api.js';
import Avatar from '../atoms/Avatar.jsx';
import { displayAssignee } from '../lib/format.js';

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
  if (day < 7) return `${day}d ago`;
  return d.toLocaleDateString();
}

export default function ActivityTab({ task, team = [] }) {
  const me = useMemo(() => getUser(), []);
  const myName = me?.name || me?.email || 'You';
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editBody, setEditBody] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    apiFetch(`/api/tasks/${task.id}/comments`)
      .then((d) => { if (alive) setComments(Array.isArray(d?.comments) ? d.comments : []); })
      .catch((e) => { if (alive) setError(e.message || 'Failed to load'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [task.id]);

  const post = async () => {
    const body = draft.trim();
    if (!body) return;
    const tempId = `temp-${Date.now()}`;
    const optimistic = {
      id: tempId,
      body,
      authorUserId: me?.id || null,
      authorName: myName,
      mentions: [],
      createdAt: new Date().toISOString(),
    };
    setComments((c) => [...c, optimistic]);
    setDraft('');
    try {
      const d = await apiFetch(`/api/tasks/${task.id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      });
      if (d?.comment) setComments((c) => c.map((x) => (x.id === tempId ? d.comment : x)));
    } catch (e) {
      setComments((c) => c.filter((x) => x.id !== tempId));
      setError(e.message || 'Post failed');
    }
  };

  const startEdit = (c) => {
    setEditingId(c.id);
    setEditBody(c.body);
  };
  const cancelEdit = () => { setEditingId(null); setEditBody(''); };
  const saveEdit = async () => {
    const body = editBody.trim();
    const target = comments.find((c) => c.id === editingId);
    if (!target || !body || body === target.body) { cancelEdit(); return; }
    const snapshot = comments;
    setComments((c) => c.map((x) => (x.id === target.id ? { ...x, body } : x)));
    setEditingId(null);
    try {
      const d = await apiFetch(`/api/tasks/${task.id}/comments/${target.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ body }),
      });
      if (d?.comment) setComments((c) => c.map((x) => (x.id === target.id ? d.comment : x)));
    } catch (e) {
      setComments(snapshot);
      setError(e.message || 'Edit failed');
    }
  };

  const remove = async (c) => {
    const snapshot = comments;
    setComments((cs) => cs.filter((x) => x.id !== c.id));
    try {
      await apiFetch(`/api/tasks/${task.id}/comments/${c.id}`, { method: 'DELETE' });
    } catch (e) {
      setComments(snapshot);
      setError(e.message || 'Delete failed');
    }
  };

  return (
    <div>
      {error && <p className="text-xs text-rose-600 mb-2">{error}</p>}
      {loading ? (
        <p className="text-xs text-slate-400">Loading activity…</p>
      ) : comments.length === 0 ? (
        <p className="text-xs text-slate-400 italic">No comments yet. Start the conversation.</p>
      ) : (
        <div className="space-y-3">
          {comments.map((c) => {
            const name = c.authorName || displayAssignee(c.authorUserId, team) || 'Someone';
            const isMine = me?.id && c.authorUserId === me.id;
            return (
              <div key={c.id} className="flex gap-2.5 group">
                <Avatar name={name} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-semibold text-slate-800">{name}</span>
                    <span className="text-[10px] text-slate-400">{timeAgo(c.createdAt)}</span>
                    {isMine && editingId !== c.id && (
                      <span className="ml-auto flex items-center gap-2 opacity-0 group-hover:opacity-100">
                        <button
                          type="button"
                          onClick={() => startEdit(c)}
                          className="text-[10px] text-slate-500 hover:text-slate-800"
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => remove(c)}
                          className="text-[10px] text-slate-500 hover:text-rose-600"
                        >
                          Delete
                        </button>
                      </span>
                    )}
                  </div>
                  {editingId === c.id ? (
                    <div className="mt-1">
                      <textarea
                        value={editBody}
                        onChange={(e) => setEditBody(e.target.value)}
                        rows={2}
                        className="w-full text-sm bg-slate-50 border border-slate-200 rounded-lg px-2 py-1 outline-none focus:border-sky-300 focus:ring-2 focus:ring-sky-100 resize-none"
                      />
                      <div className="mt-1 flex items-center gap-2">
                        <button
                          type="button"
                          onClick={saveEdit}
                          className="text-xs bg-sky-600 hover:bg-sky-700 text-white font-medium px-2 py-0.5 rounded"
                        >
                          Save
                        </button>
                        <button
                          type="button"
                          onClick={cancelEdit}
                          className="text-xs text-slate-500 hover:text-slate-800"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-700 mt-0.5 leading-snug whitespace-pre-wrap">{c.body}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Composer */}
      <div className="mt-4 flex items-start gap-2">
        <Avatar name={myName} size="md" />
        <div className="flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 focus-within:border-sky-300 focus-within:ring-2 focus-within:ring-sky-100">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Leave a comment… use @ to mention"
            rows={2}
            className="w-full bg-transparent text-sm outline-none resize-none placeholder:text-slate-400"
          />
          <div className="flex items-center justify-end">
            <button
              type="button"
              onClick={post}
              disabled={!draft.trim()}
              className="text-xs bg-sky-600 hover:bg-sky-700 disabled:bg-slate-300 text-white font-medium px-2.5 py-1 rounded-md"
            >
              Comment
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
