import React from 'react';
import { AlertTriangle, CheckCircle2, Eye, XCircle } from 'lucide-react';

// Dimension keys + max points come from calculateCandidateRequirementMatch()
// in src/services/wizmatchMatchingDomain.ts (scoreVersion 'gate-b-v1'). If that
// rubric changes, update this map to match — it is display-only, not computed here.
const DIMENSION_META = {
  mandatorySkills: { label: 'Mandatory skills', max: 50 },
  preferredSkills: { label: 'Preferred skills', max: 15 },
  experienceRecencyEvidence: { label: 'Experience, recency & evidence', max: 15 },
  locationAuthorization: { label: 'Location & authorization', max: 8 },
  availability: { label: 'Availability', max: 7 },
  commercial: { label: 'Commercial fit', max: 5 },
};

const DECISION_TONE = {
  shortlisted: 'badge-success',
  watch: 'badge-warning',
  rejected: 'badge-danger',
  blocked: 'badge-danger',
  unreviewed: 'badge-muted',
};

// Blockers/missing-evidence arrive as "type:detail" codes (e.g.
// "missing_mandatory:JavaScript") — render them as sentences rather than
// showing the raw code.
function describeBlocker(code) {
  const [type, detail] = String(code).split(':');
  switch (type) {
    case 'missing_mandatory': return `Missing mandatory skill: ${detail}`;
    case 'insufficient_experience': return `Below minimum experience for ${detail}`;
    case 'work_authorization': return 'Work authorization mismatch';
    case 'availability': return 'Candidate is not currently available';
    case 'location': return 'Location / work-mode mismatch';
    case 'commercial': return 'Rate exceeds requirement budget';
    default: return code;
  }
}

function describeMissingEvidence(code) {
  const [type, detail] = String(code).split(':');
  switch (type) {
    case 'skill_evidence': return `No evidence on file for ${detail}`;
    case 'recency': return `No recent-use date on file for ${detail}`;
    default: return code;
  }
}

/**
 * Renders an explainable match score for one candidate<->requirement match row.
 * Pure presentational component — the parent owns the API calls; onShortlist/
 * onWatch/onReject fire with no arguments (parent already has the match in
 * closure) and the parent is responsible for calling
 * POST /staffing/matches/:matchId/decision and refreshing state.
 *
 * Props:
 *   match      — a wizmatch_candidate_requirement_matches row as returned by
 *                the API (score, dimensions, blockers, missing_evidence,
 *                human_decision, decision_reason, reviewed_at, optionally
 *                requirement_title/stage or candidate first_name/last_name
 *                depending on which list endpoint produced it)
 *   onShortlist, onWatch, onReject — callbacks, omit/undefined to hide a button
 *   busy       — disables the decision buttons while a request is in flight
 *   readOnly   — hides the decision buttons entirely
 */
export default function MatchExplanation({ match, onShortlist, onWatch, onReject, busy = false, readOnly = false }) {
  if (!match) return null;
  const dimensions = match.dimensions || {};
  const blockers = match.blockers || [];
  const missingEvidence = match.missing_evidence || match.missingEvidence || [];
  const decision = match.human_decision || match.humanDecision || 'unreviewed';
  const blocked = blockers.length > 0;
  const candidateName = [match.first_name, match.last_name].filter(Boolean).join(' ');

  return (
    <div className="rounded-lg border border-neutral-200 p-3 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center justify-center min-w-9 h-8 rounded-md text-[13px] font-bold ${blocked ? 'bg-danger-600 text-white' : 'bg-neutral-900 text-white'}`}
            title={blocked ? 'Score is zeroed while a hard blocker is present' : 'Match score'}
          >
            {match.score ?? 0}
          </span>
          <span className={DECISION_TONE[decision] || 'badge-muted'}>{decision.replace(/_/g, ' ')}</span>
        </div>
        {(match.requirement_title || candidateName) && (
          <div className="text-right min-w-0">
            {match.requirement_title && <p className="text-[12.5px] font-semibold text-neutral-900 truncate">{match.requirement_title}</p>}
            {candidateName && <p className="text-[12.5px] font-semibold text-neutral-900 truncate">{candidateName}</p>}
            {match.stage && <p className="text-[11px] text-neutral-500">{match.stage.replace(/_/g, ' ')}</p>}
          </div>
        )}
      </div>

      {blocked && (
        <div role="alert" className="rounded-md border border-danger-500/30 bg-danger-500/10 px-2.5 py-1.5 space-y-0.5">
          {blockers.map((b, i) => (
            <p key={i} className="text-[12px] text-danger-600 flex items-center gap-1.5">
              <AlertTriangle className="w-3 h-3 shrink-0" /> {describeBlocker(b)}
            </p>
          ))}
        </div>
      )}

      <div className="grid grid-cols-2 gap-x-3 gap-y-1">
        {Object.entries(DIMENSION_META).map(([key, meta]) => (
          <div key={key} className="text-[11.5px] text-neutral-600 flex items-center justify-between">
            <span>{meta.label}</span>
            <span className="font-mono text-neutral-800">{dimensions[key] ?? 0}/{meta.max}</span>
          </div>
        ))}
      </div>

      {missingEvidence.length > 0 && (
        <div className="space-y-0.5">
          {missingEvidence.map((m, i) => (
            <p key={i} className="text-[11.5px] text-warning-700">{describeMissingEvidence(m)}</p>
          ))}
        </div>
      )}

      {decision !== 'unreviewed' && (match.decision_reason || match.reviewed_at) && (
        <p className="text-[11px] text-neutral-500 border-t border-neutral-100 pt-1.5">
          {match.decision_reason ? `"${match.decision_reason}" — ` : ''}
          {match.reviewed_at ? `reviewed ${new Date(match.reviewed_at).toLocaleString()}` : ''}
        </p>
      )}

      {!readOnly && (onShortlist || onWatch || onReject) && (
        <div className="flex items-center gap-2 pt-1">
          {onShortlist && (
            <button
              type="button"
              disabled={busy}
              onClick={onShortlist}
              className={`btn-standard btn-compact disabled:opacity-50 ${decision === 'shortlisted' ? 'border-success-500 text-success-700 bg-success-500/10' : ''}`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Shortlist
            </button>
          )}
          {onWatch && (
            <button
              type="button"
              disabled={busy}
              onClick={onWatch}
              className={`btn-standard btn-compact disabled:opacity-50 ${decision === 'watch' ? 'border-warning-500 text-warning-700 bg-warning-500/10' : ''}`}
            >
              <Eye className="w-3.5 h-3.5" /> Watch
            </button>
          )}
          {onReject && (
            <button
              type="button"
              disabled={busy}
              onClick={onReject}
              className={`btn-standard btn-compact disabled:opacity-50 ${decision === 'rejected' ? 'border-danger-500 text-danger-600 bg-danger-500/10' : ''}`}
            >
              <XCircle className="w-3.5 h-3.5" /> Reject
            </button>
          )}
        </div>
      )}
    </div>
  );
}
