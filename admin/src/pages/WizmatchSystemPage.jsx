import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DatabaseZap, Network, Shield, ShieldCheck, Activity, CheckCircle2, XCircle, RefreshCw,
} from 'lucide-react';
import { apiFetch } from '../lib/api.js';
import { WizmatchReadinessPage, WizmatchGuardrailsPage } from './WizmatchOperatingPages.jsx';
import WizmatchDomainsPage from './WizmatchDomainsPage.jsx';
import WizmatchCompliancePage from './WizmatchCompliancePage.jsx';

const TABS = [
  { id: 'readiness', label: 'Readiness', icon: DatabaseZap },
  { id: 'domains', label: 'Deliverability / Domains', icon: Network },
  { id: 'compliance', label: 'Compliance / Suppression', icon: Shield },
  { id: 'guardrails', label: 'Cost & Guardrails', icon: ShieldCheck },
  { id: 'health', label: 'System Health / Env', icon: Activity },
];
const TAB_IDS = TABS.map(t => t.id);

// System Health / Env tab — presence-only environment diagnostics.
// Never renders a secret value: only which alias (if any) satisfied a check.
function EnvCheckPanel() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch('/api/wizmatch/env-check');
      setReport(data);
    } catch (e) {
      setError(e.message || 'Failed to load environment checks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const checks = report?.checks || [];
  const groups = report?.groups || [];
  const requiredMissing = checks.filter(c => c.requirement === 'required' && !c.present).length;
  const recommendedMissing = checks.filter(c => c.requirement === 'recommended' && !c.present).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900">Environment readiness</h2>
          <p className="mt-0.5 text-[12.5px] text-neutral-500">
            Presence-only checks — secret values are never shown, only which env var name (if any) satisfied each requirement.
          </p>
        </div>
        <button type="button" onClick={load} className="btn-standard btn-compact">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {error && <div className="badge-danger">{error}</div>}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Required missing</p>
          <p className={`mt-1 text-xl font-bold ${requiredMissing ? 'text-danger-600' : 'text-success-600'}`}>{requiredMissing}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Recommended missing</p>
          <p className={`mt-1 text-xl font-bold ${recommendedMissing ? 'text-warning-600' : 'text-success-600'}`}>{recommendedMissing}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">Checked at</p>
          <p className="mt-1 text-[12.5px] text-neutral-700">
            {report?.generatedAt ? new Date(report.generatedAt).toLocaleString() : loading ? 'Loading...' : '—'}
          </p>
        </div>
      </div>

      {loading && !report && <p className="text-sm text-neutral-400">Loading environment checks...</p>}

      {groups.map(group => (
        <div key={group} className="card overflow-hidden">
          <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-2">
            <h3 className="text-[12.5px] font-semibold text-neutral-700">{group}</h3>
          </div>
          <table className="table-fluent">
            <thead>
              <tr>
                <th>Key</th>
                <th>Requirement</th>
                <th>Status</th>
                <th>Satisfied by</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {checks.filter(c => c.group === group).map(c => (
                <tr key={c.key}>
                  <td className="font-medium text-neutral-900">
                    {c.key}
                    {c.aliases?.length ? <span className="text-neutral-400"> / {c.aliases.join(' / ')}</span> : null}
                  </td>
                  <td className="text-neutral-500">{c.requirement}</td>
                  <td>
                    {c.present ? (
                      <span className="badge-success"><CheckCircle2 className="h-3 w-3" /> present</span>
                    ) : (
                      <span className={c.requirement === 'required' ? 'badge-danger' : 'badge-warning'}>
                        <XCircle className="h-3 w-3" /> missing
                      </span>
                    )}
                  </td>
                  <td className="text-neutral-500">{c.presentKey || '—'}</td>
                  <td className="text-neutral-500">{c.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

export default function WizmatchSystemPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const activeTab = TAB_IDS.includes(requestedTab) ? requestedTab : 'readiness';

  function selectTab(id) {
    setSearchParams({ tab: id }, { replace: true });
  }

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-neutral-200 bg-white px-6 py-4">
        <div>
          <h1 className="text-lg font-bold text-neutral-900">System</h1>
          <p className="text-xs text-neutral-500">
            Diagnostics, deliverability, compliance, guardrails, and environment health — off the daily funnel by design.
          </p>
        </div>
        <div className="mt-3 flex flex-wrap gap-1">
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => selectTab(t.id)}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                activeTab === t.id ? 'bg-primary-500 text-white' : 'text-neutral-500 hover:bg-neutral-100'
              }`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Each tab's component lazy-fetches on mount, so switching tabs is the
            fetch trigger — nothing loads until it is first selected. */}
        {activeTab === 'readiness' && <div className="p-6"><WizmatchReadinessPage embedded /></div>}
        {activeTab === 'domains' && <WizmatchDomainsPage />}
        {activeTab === 'compliance' && <WizmatchCompliancePage />}
        {activeTab === 'guardrails' && <div className="p-6"><WizmatchGuardrailsPage embedded /></div>}
        {activeTab === 'health' && <div className="p-6"><EnvCheckPanel /></div>}
      </div>
    </div>
  );
}
