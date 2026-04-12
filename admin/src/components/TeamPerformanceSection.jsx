import React, { useEffect, useState } from 'react';
import { apiFetch } from '../lib/api.js';
import { Trophy, AlertCircle, CheckCircle, Users } from 'lucide-react';

export default function TeamPerformanceSection() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch('/api/analytics/team-performance')
      .then(d => setData(d))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-5 animate-pulse">
              <div className="h-3 bg-slate-200 rounded w-24 mb-3" />
              <div className="h-8 bg-slate-200 rounded w-16" />
            </div>
          ))}
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-6 animate-pulse">
          <div className="h-4 bg-slate-200 rounded w-32 mb-4" />
          <div className="space-y-3">
            {[1, 2, 3, 4].map(i => <div key={i} className="h-10 bg-slate-100 rounded" />)}
          </div>
        </div>
      </div>
    );
  }

  const members = data?.members || [];

  if (members.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
        <Users className="w-10 h-10 text-slate-300 mx-auto mb-3" />
        <p className="text-slate-500 text-sm">No ClickUp team data available yet.</p>
        <p className="text-slate-400 text-xs mt-1">Connect ClickUp to see team performance metrics.</p>
      </div>
    );
  }

  const sorted = [...members].sort((a, b) => (b.weekCompletionRate || 0) - (a.weekCompletionRate || 0));
  const totalCompletedToday = members.reduce((s, m) => s + (m.completedToday || 0), 0);
  const totalOverdue = members.reduce((s, m) => s + (m.overdue || 0), 0);
  const avgRate = members.length > 0
    ? Math.round(members.reduce((s, m) => s + (m.weekCompletionRate || 0), 0) / members.length)
    : 0;

  function rateColor(rate) {
    if (rate >= 80) return 'text-green-600';
    if (rate >= 50) return 'text-amber-600';
    return 'text-red-600';
  }

  const medals = ['text-yellow-500', 'text-slate-400', 'text-amber-700'];

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Completed Today</p>
          <p className="text-2xl font-bold text-green-600 mt-1">{totalCompletedToday}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Total Overdue</p>
          <p className={`text-2xl font-bold mt-1 ${totalOverdue > 0 ? 'text-red-600' : 'text-slate-900'}`}>{totalOverdue}</p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <p className="text-xs text-slate-500 uppercase tracking-wide font-medium">Avg Week Completion</p>
          <p className={`text-2xl font-bold mt-1 ${rateColor(avgRate)}`}>{avgRate}%</p>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 bg-slate-50 flex items-center gap-2">
          <Trophy className="w-4 h-4 text-amber-500" />
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Team Leaderboard</p>
        </div>
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 w-16">Rank</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500">Name</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Completed Today</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Overdue</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Due Today</th>
              <th className="px-4 py-3 text-xs font-semibold text-slate-500 text-right">Week Rate</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m, i) => (
              <tr key={m.name || i} className={`border-b border-slate-50 ${i === 0 ? 'bg-green-50' : 'hover:bg-slate-50'}`}>
                <td className="px-4 py-3 text-sm font-medium">
                  {i < 3 ? (
                    <span className="flex items-center gap-1">
                      <Trophy className={`w-4 h-4 ${medals[i]}`} />
                      {i + 1}
                    </span>
                  ) : (
                    <span className="text-slate-500">{i + 1}</span>
                  )}
                </td>
                <td className="px-4 py-3 text-sm font-medium text-slate-800">{m.name}</td>
                <td className="px-4 py-3 text-sm text-slate-700 text-right">
                  <span className="flex items-center justify-end gap-1">
                    <CheckCircle className="w-3.5 h-3.5 text-green-500" />
                    {m.completedToday || 0}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-right">
                  <span className={(m.overdue || 0) > 0 ? 'text-red-600 font-semibold' : 'text-slate-700'}>
                    {(m.overdue || 0) > 0 && <AlertCircle className="w-3.5 h-3.5 inline mr-1" />}
                    {m.overdue || 0}
                  </span>
                </td>
                <td className="px-4 py-3 text-sm text-slate-700 text-right">{m.dueToday || 0}</td>
                <td className="px-4 py-3 text-sm text-right">
                  <span className={`font-semibold ${rateColor(m.weekCompletionRate || 0)}`}>
                    {m.weekCompletionRate || 0}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
