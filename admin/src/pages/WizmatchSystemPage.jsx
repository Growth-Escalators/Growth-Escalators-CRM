import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  DatabaseZap, Network, Shield, ShieldCheck, Activity, CheckCircle2, XCircle, RefreshCw,
  BarChart3, EyeOff,
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
  // Deliberately a tab here rather than a new nav destination: this exists to
  // justify REMOVING nav rows, so adding one to host it would be self-defeating.
  { id: 'nav-usage', label: 'Nav Usage', icon: BarChart3 },
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
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Required missing</p>
          <p className={`mt-1 text-xl font-bold ${requiredMissing ? 'text-danger-600' : 'text-success-600'}`}>{requiredMissing}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Recommended missing</p>
          <p className={`mt-1 text-xl font-bold ${recommendedMissing ? 'text-warning-600' : 'text-success-600'}`}>{recommendedMissing}</p>
        </div>
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Checked at</p>
          <p className="mt-1 text-[12.5px] text-neutral-700">
            {report?.generatedAt ? new Date(report.generatedAt).toLocaleString() : loading ? 'Loading...' : '—'}
          </p>
        </div>
      </div>

      {report && (
        <div className="card p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Staffing OS release gates</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {Object.entries(report.staffingPhases || {}).map(([gate, enabled]) => (
              <span key={gate} className={enabled ? 'badge-success' : 'badge-muted'}>{gate}: {enabled ? 'enabled' : 'off'}</span>
            ))}
            <span className="badge-success">Documents: private signed access</span>
          </div>
        </div>
      )}

      {report && (
        <div className="card overflow-hidden">
          <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-2">
            <h3 className="text-[12.5px] font-semibold text-neutral-700">Demand-source evidence</h3>
            <p className="text-[11px] text-neutral-500">Database counts are evidence of imported rows. CI secret presence cannot be read by the application.</p>
          </div>
          {report.sourceHealthError ? <p className="p-4 text-xs text-danger-600">{report.sourceHealthError}</p> : (
            <table className="table-fluent">
              <thead><tr><th>Source</th><th>Configuration</th><th>Rows</th><th>Last seen</th></tr></thead>
              <tbody>{(report.sourceHealth || []).map(source => (
                <tr key={source.source}>
                  <td className="font-medium text-neutral-900">{source.source}</td>
                  <td className="text-neutral-500">{source.configuration.replaceAll('_', ' ')}</td>
                  <td>{source.count}</td>
                  <td className="text-neutral-500">{source.lastSeen ? new Date(source.lastSeen).toLocaleString() : 'no rows observed'}</td>
                </tr>
              ))}</tbody>
            </table>
          )}
        </div>
      )}

      {loading && !report && <p className="text-sm text-neutral-500">Loading environment checks...</p>}

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
                    {c.aliases?.length ? <span className="text-neutral-500"> / {c.aliases.join(' / ')}</span> : null}
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

// Nav Usage tab — read-back for the 2-week route-view experiment.
// Records user + role + route + timestamp only; no IP, user-agent or referrer.
function NavUsagePanel() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(await apiFetch('/api/wizmatch/telemetry/route-usage?days=14'));
    } catch (e) {
      setError(e.message || 'Failed to load route usage');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const items = report?.items || [];
  const unused = items.filter(i => i.views === 0);
  const used = items.filter(i => i.views > 0);

  const row = (i) => (
    <tr key={i.routeId}>
      <td className="font-medium text-neutral-900">{i.label}</td>
      <td className="text-neutral-500">{i.routeId}</td>
      <td>{i.views}</td>
      <td>{i.distinctUsers}</td>
      <td className="text-neutral-500">{i.lastViewedAt ? new Date(i.lastViewedAt).toLocaleString() : '—'}</td>
    </tr>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-[15px] font-semibold text-neutral-900">Nav usage — last {report?.days ?? 14} days</h2>
          <p className="mt-0.5 text-[12.5px] text-neutral-500">
            Which screens the team actually opens. Records user, role, route and timestamp only — no IP, user agent or referrer.
          </p>
        </div>
        <button type="button" onClick={load} className="btn-standard btn-compact">
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </button>
      </div>

      {error && <div className="badge-danger">{error}</div>}
      {loading && !report && <p className="text-sm text-neutral-500">Loading route usage...</p>}

      {report && (
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Never opened</p>
            <p className={`mt-1 text-xl font-bold ${unused.length ? 'text-warning-600' : 'text-success-600'}`}>{unused.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Opened at least once</p>
            <p className="mt-1 text-xl font-bold text-neutral-900">{used.length}</p>
          </div>
          <div className="card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-neutral-500">Routes tracked</p>
            <p className="mt-1 text-xl font-bold text-neutral-900">{items.length}</p>
          </div>
        </div>
      )}

      {report && (
        <div className="card overflow-hidden">
          <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-2">
            <h3 className="text-[12.5px] font-semibold text-neutral-700">Never opened — candidates for removal</h3>
            <p className="text-[11px] text-neutral-500">
              Zero views in the window. This list is the finding; everything else is context.
            </p>
          </div>
          {unused.length === 0 ? (
            <p className="p-4 text-xs text-neutral-500">Every route was opened at least once.</p>
          ) : (
            <table className="table-fluent">
              <thead><tr><th>Screen</th><th>Route id</th><th>Views</th><th>People</th><th>Last opened</th></tr></thead>
              <tbody>{unused.map(row)}</tbody>
            </table>
          )}
        </div>
      )}

      {report && used.length > 0 && (
        <div className="card overflow-hidden">
          <div className="border-b border-neutral-100 bg-neutral-50 px-4 py-2">
            <h3 className="text-[12.5px] font-semibold text-neutral-700">In use — least visited first</h3>
          </div>
          <table className="table-fluent">
            <thead><tr><th>Screen</th><th>Route id</th><th>Views</th><th>People</th><th>Last opened</th></tr></thead>
            <tbody>{used.map(row)}</tbody>
          </table>
        </div>
      )}

      {report && (
        <div className="card p-4">
          <h3 className="flex items-center gap-1.5 text-[12.5px] font-semibold text-neutral-700">
            <EyeOff className="h-3.5 w-3.5" /> How to read a zero
          </h3>
          <p className="mt-1 text-[11px] text-neutral-600">
            All {items.length} Wizmatch routes are instrumented, so a zero here means "measured, nobody opened it" — not
            "no data". It still does not always mean "nobody wants it": a screen can sit unopened because the feature
            behind it has not gone live yet (sending, for one, has never been switched on and its tables are empty)
            rather than because the team rejected it. Check whether a zero-view screen is unwanted or merely not yet
            usable before removing it from the nav.
          </p>
        </div>
      )}
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
