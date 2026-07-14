import React, { useState } from 'react';
import DialogShell from './DialogShell.jsx';

const ROUND_TYPES = ['client', 'internal', 'technical', 'hr', 'final'];
const INTERVIEW_STATUSES = ['scheduled', 'completed', 'cancelled', 'no_show'];

/**
 * Dual-mode: `schedule` creates a new interview round
 * (POST .../submissions/:id/interviews), `update` records status/feedback on
 * an existing round (PUT .../interviews/:interviewId). Same component covers
 * both since the fields overlap and the lifecycle step is "interview" either way.
 */
export default function InterviewDialog({ open, mode = 'schedule', initial, loading = false, error = null, onCancel, onSubmit }) {
  const [roundType, setRoundType] = useState(initial?.round_type || 'client');
  const [scheduledAt, setScheduledAt] = useState(initial?.scheduled_at ? String(initial.scheduled_at).slice(0, 16) : '');
  const [status, setStatus] = useState(initial?.status || 'scheduled');
  const [feedback, setFeedback] = useState(initial?.feedback || '');
  const [outcome, setOutcome] = useState(initial?.outcome || '');
  const [nextAction, setNextAction] = useState(initial?.next_action || '');
  const [nextActionDueAt, setNextActionDueAt] = useState('');

  const canSubmit = !loading && (mode === 'update' || scheduledAt);

  const submit = () => {
    if (mode === 'schedule') {
      onSubmit({
        roundType,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : undefined,
        nextAction: nextAction.trim() || undefined,
        nextActionDueAt: nextActionDueAt ? new Date(nextActionDueAt).toISOString() : undefined,
      });
    } else {
      onSubmit({
        status,
        feedback: feedback.trim() || undefined,
        outcome: outcome.trim() || undefined,
        nextAction: nextAction.trim() || undefined,
        nextActionDueAt: nextActionDueAt ? new Date(nextActionDueAt).toISOString() : undefined,
      });
    }
  };

  return (
    <DialogShell
      open={open}
      title={mode === 'schedule' ? 'Schedule interview round' : 'Update interview round'}
      error={error}
      loading={loading}
      onCancel={onCancel}
      footer={
        <>
          <button type="button" onClick={onCancel} disabled={loading} className="btn-standard">Cancel</button>
          <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary disabled:opacity-50">
            {loading ? 'Saving…' : mode === 'schedule' ? 'Schedule round' : 'Save update'}
          </button>
        </>
      }
    >
      {({ firstFieldRef }) => (mode === 'schedule' ? (
        <>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Round type</label>
            <select ref={firstFieldRef} value={roundType} onChange={(e) => setRoundType(e.target.value)} className="input w-full mt-1">
              {ROUND_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Scheduled at *</label>
            <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="input w-full mt-1" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Next action</label>
            <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} placeholder="Collect interview feedback" className="input w-full mt-1" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Next action due</label>
            <input type="datetime-local" value={nextActionDueAt} onChange={(e) => setNextActionDueAt(e.target.value)} className="input w-full mt-1" />
          </div>
        </>
      ) : (
        <>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Status</label>
            <select ref={firstFieldRef} value={status} onChange={(e) => setStatus(e.target.value)} className="input w-full mt-1">
              {INTERVIEW_STATUSES.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Feedback</label>
            <textarea value={feedback} onChange={(e) => setFeedback(e.target.value)} rows={3} className="input w-full mt-1 resize-y" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Outcome</label>
            <input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="pass / fail / on hold" className="input w-full mt-1" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Next action</label>
            <input value={nextAction} onChange={(e) => setNextAction(e.target.value)} className="input w-full mt-1" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Next action due</label>
            <input type="datetime-local" value={nextActionDueAt} onChange={(e) => setNextActionDueAt(e.target.value)} className="input w-full mt-1" />
          </div>
        </>
      ))}
    </DialogShell>
  );
}
