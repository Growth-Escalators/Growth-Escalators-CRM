import { useState } from 'react';
import { Search, ExternalLink } from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import EmptyState from '../components/wizmatch/EmptyState.jsx';
import StatusBadge from '../components/wizmatch/StatusBadge.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';

function formatMinorCurrency(value, currency = 'INR') {
  const amount = Number(value || 0) / 100;
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: currency || 'INR', maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency || 'INR'} ${amount.toFixed(2)}`;
  }
}

// This tool always seeds a fixed, generic tech-flavored placeholder title/keywords
// (never what staff typed) so a plain "find a contact" lookup doesn't get scored
// and blocked by the eligibility filter built for the IT-staffing job-signal
// pipeline. What staff actually want (e.g. "HR Manager") is used client-side only,
// to highlight matching candidates in the results.
const SEED_JOB_TITLE = 'Software Engineer — GE quick contact lookup (not a live job posting)';
const SEED_KEYWORDS = ['software', 'engineer', 'full stack', 'developer'];

const STEP = {
  idle: 'idle',
  seeding: 'seeding',
  previewing: 'previewing',
  approving: 'approving',
  ready: 'ready',
  needsApproval: 'needsApproval',
  blocked: 'blocked',
  discovering: 'discovering',
  done: 'done',
};

const BUSY_LABEL = {
  [STEP.seeding]: 'Looking up company…',
  [STEP.previewing]: 'Checking eligibility…',
  [STEP.approving]: 'Approving company…',
  [STEP.discovering]: 'Searching for a contact…',
};

function ContactResultCard({ candidate, targetTitle }) {
  const highlighted = Boolean(
    targetTitle && candidate.title && candidate.title.toLowerCase().includes(targetTitle.trim().toLowerCase()),
  );
  return (
    <div className={`card p-4 space-y-2 ${highlighted ? 'ring-1 ring-primary-500/40' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold text-neutral-900">{candidate.name || 'Unnamed contact'}</h3>
          <p className="text-[12.5px] text-neutral-500">{candidate.title || 'No title on file'}</p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {candidate.status && <StatusBadge status={candidate.status} />}
          {candidate.deliverabilityStatus && (
            <span className="badge-muted text-[11px]">{candidate.deliverabilityStatus.replaceAll('_', ' ')}</span>
          )}
        </div>
      </div>
      <div className="text-[12.5px] text-neutral-600 space-y-1">
        <div><b className="text-neutral-900">Email:</b> {candidate.email || '—'}</div>
        <div><b className="text-neutral-900">Phone:</b> {candidate.phone || '—'}</div>
        <div>
          <b className="text-neutral-900">LinkedIn:</b>{' '}
          {candidate.linkedinUrl ? (
            <a href={candidate.linkedinUrl} target="_blank" rel="noreferrer" className="text-primary-700 underline inline-flex items-center gap-1">
              View profile <ExternalLink className="w-3 h-3" />
            </a>
          ) : '—'}
        </div>
        <div><b className="text-neutral-900">Source:</b> {candidate.source || '—'}</div>
        {candidate.confidenceTier && <div><b className="text-neutral-900">Confidence:</b> {candidate.confidenceTier}</div>}
      </div>
      {(candidate.reasons || []).length > 0 && (
        <ul className="text-[11.5px] text-neutral-500 list-disc list-inside">
          {candidate.reasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
  );
}

function PreviewSummary({ preview }) {
  if (!preview) return null;
  return (
    <div className="card p-3 space-y-2 bg-neutral-50/50">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={preview.eligible ? 'badge-success' : 'badge-warning'}>
          {preview.status?.replaceAll('_', ' ') || (preview.eligible ? 'eligible' : 'blocked')}
        </span>
        <span className="badge-muted text-[11px]">Est. cost {formatMinorCurrency(preview.estimatedCostCents, preview.costGuard?.currency)}</span>
        <span className="badge-muted text-[11px]">Cooldown {preview.capStatus?.rediscoveryCooldownDays ?? 30}d</span>
      </div>
      <p className="text-[11.5px] text-neutral-500">
        Providers: {(preview.providerOrder || []).map((p) => p.replaceAll('_', ' ')).join(' → ') || 'No provider path available'}
      </p>
      {(preview.blockedReasons || []).length > 0 && (
        <ul className="text-[11.5px] text-warning-700 list-disc list-inside">
          {preview.blockedReasons.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function WizmatchFindContactPage() {
  const toast = useToast();
  const [companyName, setCompanyName] = useState('');
  const [domain, setDomain] = useState('');
  const [targetTitle, setTargetTitle] = useState('');

  const [step, setStep] = useState(STEP.idle);
  const [error, setError] = useState(null);
  const [companyId, setCompanyId] = useState(null);
  const [companyExisted, setCompanyExisted] = useState(false);
  const [preview, setPreview] = useState(null);
  const [candidates, setCandidates] = useState(null);

  const runPreview = async (id) => {
    setStep(STEP.previewing);
    const result = await apiFetch(`/api/wizmatch/contact-intelligence/companies/${id}/discovery-preview`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
    setPreview(result.preview || null);
    const needsApproval = result.item?.qualificationTier === 'B'
      && result.item?.persisted?.reviewStatus !== 'approved';
    if (needsApproval) setStep(STEP.needsApproval);
    else if (result.preview?.eligible) setStep(STEP.ready);
    else setStep(STEP.blocked);
    return result;
  };

  const handleSearch = async () => {
    const name = companyName.trim();
    if (!name) return;
    setError(null);
    setCandidates(null);
    setPreview(null);
    try {
      setStep(STEP.seeding);
      const seeded = await apiFetch('/api/wizmatch/client-discovery/seed-company', {
        method: 'POST',
        body: JSON.stringify({
          companyName: name,
          domain: domain.trim() || undefined,
          jobTitle: SEED_JOB_TITLE,
          keywords: SEED_KEYWORDS,
          targetRegion: 'india',
          location: 'India',
          notes: 'Auto-created by the Find Contact quick-lookup tool. Not a real hiring signal — for admin contact lookup only.',
        }),
      });
      setCompanyId(seeded.companyId);
      setCompanyExisted(!!seeded.companyExisted);
      await runPreview(seeded.companyId);
    } catch (e) {
      setError(e.message || 'Could not look up this company.');
      setStep(STEP.idle);
    }
  };

  const handleApprove = async () => {
    if (!companyId) return;
    setError(null);
    try {
      setStep(STEP.approving);
      await apiFetch(`/api/wizmatch/contact-intelligence/companies/${companyId}/review`, {
        method: 'POST',
        body: JSON.stringify({ action: 'approve_company' }),
      });
      await runPreview(companyId);
    } catch (e) {
      setError(e.message || 'Approval failed.');
      setStep(STEP.needsApproval);
    }
  };

  const handleDiscover = async () => {
    if (!companyId) return;
    setError(null);
    try {
      setStep(STEP.discovering);
      const result = await apiFetch(`/api/wizmatch/contact-intelligence/companies/${companyId}/discover`, {
        method: 'POST',
        body: JSON.stringify({ confirmPreview: true }),
      });
      const found = result.contactCandidates || [];
      setCandidates(found);
      setPreview(result.preview || preview);
      setStep(STEP.done);
      toast.showSuccess(found.length > 0 ? `Found ${found.length} contact${found.length === 1 ? '' : 's'}.` : 'Search finished — no contact found yet.');
    } catch (e) {
      setError(e.message || 'Search failed — re-check eligibility and try again.');
      setStep(STEP.ready);
    }
  };

  const busy = [STEP.seeding, STEP.previewing, STEP.approving, STEP.discovering].includes(step);

  return (
    <div className="p-6 max-w-3xl">
      <h1 className="text-[20px] font-bold text-neutral-900 tracking-[-0.01em] mb-1">Find Contact</h1>
      <p className="text-[12.5px] text-neutral-500 mb-5">
        Look up a hiring/HR contact at a company by name. This is a standalone lookup tool —
        it does not touch the Job Leads / Signals workflow your team already uses for staffing.
      </p>

      <div className="card p-4 space-y-3 mb-5">
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="block">
            <span className="text-[12px] font-semibold text-neutral-700">Company name *</span>
            <input
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Corp"
              className="input w-full mt-1"
            />
          </label>
          <label className="block">
            <span className="text-[12px] font-semibold text-neutral-700">Domain (recommended)</span>
            <input
              type="text"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              placeholder="e.g. acme.com"
              className="input w-full mt-1"
            />
            <span className="text-[11px] text-neutral-500">Without a domain, lookup is usually blocked.</span>
          </label>
        </div>
        <label className="block">
          <span className="text-[12px] font-semibold text-neutral-700">Target contact title (optional)</span>
          <input
            type="text"
            value={targetTitle}
            onChange={(e) => setTargetTitle(e.target.value)}
            placeholder="e.g. HR Manager"
            className="input w-full mt-1"
          />
          <span className="text-[11px] text-neutral-500">Used only to highlight matching results below — not sent to the search.</span>
        </label>
        {error && (
          <div role="alert" className="text-[12px] text-danger-600 bg-danger-500/10 border border-danger-500/30 rounded-md px-2.5 py-1.5">{error}</div>
        )}
        <div className="flex justify-end">
          <button onClick={handleSearch} disabled={busy || !companyName.trim()} className="btn-primary btn-compact disabled:opacity-50">
            {busy ? BUSY_LABEL[step] : 'Search'}
          </button>
        </div>
      </div>

      {companyId && step !== STEP.idle && (
        <div className="space-y-4">
          {companyExisted && (
            <p className="text-[11.5px] text-neutral-500">Reusing existing company record.</p>
          )}

          <PreviewSummary preview={preview} />

          {step === STEP.needsApproval && (
            <div className="card p-3 bg-warning-500/5 border-warning-500/30 space-y-2">
              <p className="text-[12.5px] text-neutral-700">
                This company needs manual approval before a paid lookup can run — nothing runs automatically.
              </p>
              <button onClick={handleApprove} disabled={busy} className="btn-standard btn-compact disabled:opacity-50">
                {step === STEP.approving ? 'Approving…' : 'Approve for lookup'}
              </button>
            </div>
          )}

          {step === STEP.ready && (
            <div className="flex justify-end">
              <button onClick={handleDiscover} disabled={busy} className="btn-primary btn-compact disabled:opacity-50">
                {step === STEP.discovering ? 'Searching…' : 'Search for contact'}
              </button>
            </div>
          )}

          {step === STEP.done && (
            candidates && candidates.length > 0 ? (
              <div className="space-y-3">
                {candidates.map((c) => (
                  <ContactResultCard key={c.id || c.email || c.name} candidate={c} targetTitle={targetTitle} />
                ))}
              </div>
            ) : (
              <EmptyState
                icon={Search}
                title="No contact found for this company yet"
                description="Try again later, or add a domain if you didn't provide one — that's the most common reason a lookup comes back empty."
              />
            )
          )}
        </div>
      )}
    </div>
  );
}
