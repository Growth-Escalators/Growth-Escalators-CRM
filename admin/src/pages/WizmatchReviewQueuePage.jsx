import { useState, useEffect, useCallback } from 'react';
import { Send } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

export default function WizmatchReviewQueuePage() {
  const [draftedSignals, setDraftedSignals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch('/api/wizmatch/signals?status=drafted&limit=50');
      setDraftedSignals(data.items || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { const i = setInterval(load, 60000); return () => clearInterval(i); }, [load]);

  const sendEmail = async (signalId, messageId) => {
    setSending(signalId);
    try {
      await apiFetch(`/api/wizmatch/signals/${signalId}/send`, {
        method: 'POST',
        body: JSON.stringify({ variant_message_id: messageId }),
      });
      alert('Email sent successfully!');
      load();
    } catch (e) { alert('Send failed: ' + e.message); } finally { setSending(null); }
  };

  return (
    <div className="p-6">
      <h1 className="text-[20px] font-bold text-neutral-900 mb-2">Outreach Review Queue</h1>
      <p className="text-[12.5px] text-neutral-500 mb-6">{draftedSignals.length} signals awaiting review</p>
      {loading ? <p className="text-neutral-400">Loading...</p>
      : draftedSignals.length === 0 ? <p className="text-neutral-400">No signals awaiting review</p>
      : (
        <div className="space-y-4">
          {draftedSignals.map(s => (
            <div key={s.id} className="card p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="inline-flex items-center justify-center w-7 h-7 rounded-md text-sm font-bold border bg-primary-500/10 text-primary-700 border-primary-500/20">
                  {s.score || 0}
                </span>
                <h3 className="text-[15px] font-semibold text-neutral-900 flex-1">{s.job_title}</h3>
                <span className="badge-warning">Drafted</span>
              </div>
              <p className="text-[12.5px] text-neutral-500 mb-3">{s.company_name || 'Unknown'} · {s.days_open || 0}d open · Score {s.score || 0}</p>
              <ReviewCard signal={s} onSend={(msgId) => sendEmail(s.id, msgId)} sending={sending === s.id} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ReviewCard({ signal, onSend, sending }) {
  const [drafts, setDrafts] = useState([]);
  const [selected, setSelected] = useState(null);
  const [loadingDrafts, setLoadingDrafts] = useState(false);

  const loadDrafts = async () => {
    setLoadingDrafts(true);
    try {
      const detail = await apiFetch(`/api/wizmatch/signals/${signal.id}`);
      setDrafts(detail.drafts || []);
      if (detail.drafts?.length > 0) setSelected(detail.drafts[0].id);
    } catch (e) { console.error(e); } finally { setLoadingDrafts(false); }
  };

  useEffect(() => { loadDrafts(); }, [signal.id]);

  return (
    <div className="border-t border-neutral-100 pt-3 mt-2">
      {drafts.length === 0 ? (
        <button onClick={async () => { setLoadingDrafts(true); try { await apiFetch(`/api/wizmatch/signals/${signal.id}/draft`, { method: 'POST' }); await loadDrafts(); } catch(e) { alert(e.message); } finally { setLoadingDrafts(false); } }} disabled={loadingDrafts} className="btn-standard btn-compact">
          {loadingDrafts ? 'Generating...' : 'Generate Drafts'}
        </button>
      ) : (
        <>
          <div className="space-y-2 mb-3">
            {drafts.map((d) => (
              <div key={d.id} onClick={() => setSelected(d.id)} className={`border rounded-lg p-2 cursor-pointer transition-all ${selected === d.id ? 'border-primary-500 bg-primary-50 shadow-card' : 'border-neutral-200 hover:bg-neutral-50'}`}>
                <div className="flex justify-between text-xs mb-1">
                  <span className="font-medium text-neutral-900">{d.metadata?.subject}</span>
                  <span className="text-neutral-400 uppercase">{d.metadata?.variant}</span>
                </div>
                <pre className="text-xs text-neutral-600 whitespace-pre-wrap max-h-24 overflow-y-auto font-mono">{d.content?.slice(0, 300)}</pre>
              </div>
            ))}
          </div>
          <button onClick={() => selected && onSend(selected)} disabled={!selected || sending} className="btn-primary disabled:opacity-50">
            <Send className="w-3.5 h-3.5" /> {sending ? 'Sending...' : 'Approve & Send'}
          </button>
        </>
      )}
    </div>
  );
}