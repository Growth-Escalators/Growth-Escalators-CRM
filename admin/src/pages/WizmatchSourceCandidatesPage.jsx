import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Search } from 'lucide-react';
import { apiFetch } from '../lib/api.js';

const PROVIDERS = [
  { value: 'github', label: 'GitHub' },
  { value: 'xray', label: 'LinkedIn X-Ray' },
];

export default function WizmatchSourceCandidatesPage() {
  const [provider, setProvider] = useState('github');
  const [skill, setSkill] = useState('');
  const [location, setLocation] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const [xrayEnabled, setXrayEnabled] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiFetch('/api/wizmatch/readiness')
      .then((readiness) => {
        if (cancelled) return;
        const controls = readiness?.costControls || {};
        setXrayEnabled(controls.paidDiscoveryEnabled === true && controls.googleFallbackEnabled === true);
      })
      .catch(() => {
        if (!cancelled) setXrayEnabled(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!xrayEnabled && provider === 'xray') setProvider('github');
  }, [provider, xrayEnabled]);

  const sourceNow = useCallback(async (event) => {
    event.preventDefault();
    setError('');
    setResult(null);

    const trimmedSkill = skill.trim();
    const trimmedLocation = location.trim();
    if (!trimmedSkill || !trimmedLocation) {
      setError('Skill and location are both required.');
      return;
    }

    setLoading(true);
    try {
      const data = await apiFetch('/api/wizmatch/candidates/source-now', {
        method: 'POST',
        body: JSON.stringify({ provider, skill: trimmedSkill, location: trimmedLocation }),
      });
      setResult(data);
    } catch (e) {
      setError(e.message || 'Sourcing failed');
    } finally {
      setLoading(false);
    }
  }, [provider, skill, location]);

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-[20px] font-bold text-neutral-900">Source Candidates</h1>
        <p className="text-[12.5px] text-neutral-500 mt-1">
          Run the GitHub or LinkedIn X-ray miner live for one skill + location, instead of waiting for the daily cron.
        </p>
      </div>

      <div className="card p-5 max-w-xl">
        <form onSubmit={sourceNow} className="space-y-4">
          <div>
            <label className="input-label" htmlFor="source-provider">Provider</label>
            <select
              id="source-provider"
              className="input"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
            >
              {PROVIDERS.map((p) => (
                <option key={p.value} value={p.value} disabled={p.value === 'xray' && !xrayEnabled}>
                  {p.label}{p.value === 'xray' && !xrayEnabled ? ' — disabled' : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="input-label" htmlFor="source-skill">Skill</label>
            <input
              id="source-skill"
              type="text"
              className="input"
              placeholder="e.g. python, react, java"
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
            />
          </div>

          <div>
            <label className="input-label" htmlFor="source-location">Location</label>
            <input
              id="source-location"
              type="text"
              className="input"
              placeholder="e.g. bangalore, austin, remote"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary" disabled={loading}>
            <Search className="w-3.5 h-3.5" /> {loading ? 'Sourcing…' : 'Source now'}
          </button>

          <p className="input-help">
            GitHub runs one manual search. LinkedIn X-Ray stays disabled unless paid discovery and Google fallback are explicitly enabled.
          </p>
        </form>

        {error && (
          <div className="mt-4 rounded-lg border border-danger-500/20 bg-danger-500/5 px-3 py-2 text-[13px] text-danger-600 flex gap-2 items-start">
            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {result && (
          <div className="mt-4 rounded-lg border border-primary-100 bg-primary-50 px-3 py-2 text-[13px] text-primary-900">
            Found {result.found ?? 0}, added {result.created ?? 0} new candidates (skipped {result.skipped ?? 0} existing).
          </div>
        )}
      </div>
    </div>
  );
}
