import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';

function StatCard({ label, value }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 px-5 py-4">
      <p className="text-xs font-medium text-slate-400 uppercase tracking-wider">{label}</p>
      <p className="text-2xl font-bold text-slate-900 mt-1">{value ?? '—'}</p>
    </div>
  );
}

export default function AutomationsPage() {
  const [sequences, setSequences] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  useEffect(() => {
    apiFetch('/sequences/stats').then((data) => {
      if (Array.isArray(data)) setSequences(data);
      setLoading(false);
    });
  }, []);

  const totalActive = sequences.reduce((sum, s) => sum + (s.active ?? 0), 0);
  const totalCompleted = sequences.reduce((sum, s) => sum + (s.completed ?? 0), 0);

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-white border-b px-8 py-5">
          <h1 className="text-xl font-bold text-slate-900">Automations</h1>
          <p className="text-sm text-slate-400 mt-0.5">Sequence status and enrolment counts</p>
        </div>

        {/* Stats */}
        <div className="px-8 py-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Sequences" value={sequences.length} />
          <StatCard label="Active Enrolments" value={totalActive.toLocaleString()} />
          <StatCard label="Completed" value={totalCompleted.toLocaleString()} />
          <StatCard label="Running" value={sequences.filter((s) => s.isActive).length} />
        </div>

        {/* Table */}
        <div className="flex-1 px-8 pb-8">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left border-b border-slate-200">
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Name</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Channel</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Steps</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Active</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Completed</th>
                  <th className="px-4 py-3 font-semibold text-slate-500 text-xs uppercase tracking-wide">Status</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">Loading…</td>
                  </tr>
                ) : sequences.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-slate-400 text-sm">No sequences found</td>
                  </tr>
                ) : (
                  sequences.map((seq) => (
                    <React.Fragment key={seq.id}>
                      <tr
                        className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer transition-colors"
                        onClick={() => setExpanded(expanded === seq.id ? null : seq.id)}
                      >
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <svg
                              className={`w-3 h-3 text-slate-400 transition-transform ${expanded === seq.id ? 'rotate-90' : ''}`}
                              fill="none" stroke="currentColor" viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                            <span className="font-medium text-slate-900">{seq.name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            seq.channel === 'whatsapp' ? 'bg-green-100 text-green-700' :
                            seq.channel === 'email' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-slate-100 text-slate-600'
                          }`}>
                            {seq.channel}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-600">{seq.stepCount}</td>
                        <td className="px-4 py-3">
                          {seq.active > 0 ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full">
                              <span className="w-1.5 h-1.5 rounded-full bg-sky-500 animate-pulse" />
                              {seq.active}
                            </span>
                          ) : (
                            <span className="text-slate-400 text-xs">0</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-600 text-xs">{seq.completed ?? 0}</td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${seq.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                            {seq.isActive ? 'Active' : 'Paused'}
                          </span>
                        </td>
                      </tr>

                      {/* Expanded steps */}
                      {expanded === seq.id && Array.isArray(seq.steps) && seq.steps.length > 0 && (
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <td colSpan={6} className="px-8 py-3">
                            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Steps</p>
                            <div className="space-y-1">
                              {seq.steps.map((step, i) => (
                                <div key={i} className="flex items-center gap-3 text-sm">
                                  <span className="w-5 h-5 rounded-full bg-slate-200 text-slate-600 text-xs font-bold flex items-center justify-center shrink-0">
                                    {step.stepIndex ?? i + 1}
                                  </span>
                                  <span className="text-slate-700 font-medium">{step.templateName ?? '—'}</span>
                                  {step.channel && (
                                    <span className="text-xs text-slate-400">{step.channel}</span>
                                  )}
                                  {step.delayDays != null && (
                                    <span className="text-xs text-slate-400">delay: {step.delayDays}d</span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}
