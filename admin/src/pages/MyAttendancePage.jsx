import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import { apiFetch, logout } from '../lib/api.js';
import { Clock, LogIn, LogOut, AlertTriangle, CheckCircle2, Calendar, Home, Building2 } from 'lucide-react';

function StatBadge({ label, value, color = 'slate' }) {
  const colors = {
    slate: 'bg-slate-100 text-slate-700',
    green: 'bg-emerald-100 text-emerald-700',
    amber: 'bg-amber-100 text-amber-700',
    red: 'bg-red-100 text-red-700',
    blue: 'bg-blue-100 text-blue-700',
  };
  return (
    <div className={`rounded-lg px-3 py-2 ${colors[color]}`}>
      <p className="text-[10px] uppercase tracking-wide font-semibold opacity-70">{label}</p>
      <p className="text-lg font-bold">{value}</p>
    </div>
  );
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function fmtTime(t) {
  if (!t) return '—';
  // t is "HH:MM" or full ISO; handle both
  if (typeof t === 'string' && t.length <= 5) return t;
  return new Date(t).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function fmtHours(h) {
  if (h == null) return '—';
  const n = Number(h);
  if (isNaN(n)) return '—';
  return `${n.toFixed(2)} hrs`;
}

export default function MyAttendancePage() {
  const [today, setToday] = useState(null);
  const [history, setHistory] = useState([]);
  const [historySummary, setHistorySummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actioning, setActioning] = useState(false);
  const [error, setError] = useState('');
  const [banner, setBanner] = useState(null); // { kind: 'success' | 'late' | 'error', text: string }
  const [workLocation, setWorkLocation] = useState('office'); // 'office' | 'home'

  const month = new Date().toISOString().slice(0, 7);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [t, h] = await Promise.all([
        apiFetch('/api/self-service/today'),
        apiFetch(`/api/self-service/my-attendance?month=${month}`),
      ]);
      setToday(t);
      setHistory(h.records || []);
      setHistorySummary(h.summary || null);
    } catch (e) {
      setError(e.message || 'Failed to load attendance');
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function handleCheckIn() {
    setActioning(true);
    setBanner(null);
    try {
      const res = await apiFetch('/api/self-service/check-in', {
        method: 'POST',
        body: JSON.stringify({ workLocation }),
      });
      const locLabel = res.workLocation === 'home' ? ' (working from home)' : '';
      if (res.isLate) {
        setBanner({
          kind: 'late',
          text: `Checked in at ${res.time}${locLabel} — late by ${res.lateMinutes} min (expected ${res.expectedStart}).`,
        });
      } else {
        setBanner({ kind: 'success', text: `Checked in at ${res.time}${locLabel}. Have a good one ✓` });
      }
      await loadAll();
    } catch (e) {
      setBanner({ kind: 'error', text: e.message || 'Check-in failed' });
    } finally {
      setActioning(false);
    }
  }

  async function handleCheckOut() {
    if (!confirm('Check out and sign out of the CRM?')) return;
    setActioning(true);
    setBanner(null);
    try {
      const res = await apiFetch('/api/self-service/check-out', { method: 'POST' });
      // Show a brief banner before logout, then sign out per the user's
      // explicit "log them out from the CRM" requirement.
      setBanner({ kind: 'success', text: `Checked out at ${res.time}. Signing out…` });
      setTimeout(() => logout(), 1200);
    } catch (e) {
      setBanner({ kind: 'error', text: e.message || 'Check-out failed' });
      setActioning(false);
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar />

        <div className="px-4 sm:px-6 lg:px-8 py-6 max-w-5xl w-full mx-auto space-y-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">My Attendance</h1>
            <p className="text-sm text-slate-500 mt-1">
              Check in when you start your day, check out when you wrap. Late check-ins are
              auto-flagged for the admin view.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">
              {error}
            </div>
          )}

          {banner && (
            <div
              className={`rounded-lg px-4 py-3 text-sm flex items-start gap-2 border ${
                banner.kind === 'late'
                  ? 'bg-amber-50 border-amber-200 text-amber-800'
                  : banner.kind === 'error'
                  ? 'bg-red-50 border-red-200 text-red-700'
                  : 'bg-emerald-50 border-emerald-200 text-emerald-700'
              }`}
            >
              {banner.kind === 'late' ? (
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              ) : banner.kind === 'error' ? (
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              ) : (
                <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
              )}
              <span>{banner.text}</span>
            </div>
          )}

          {/* Today card */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 shadow-sm">
            {loading ? (
              <div className="h-32 bg-slate-100 rounded-lg animate-pulse" />
            ) : today ? (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                <div>
                  <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Hello</p>
                  <p className="text-xl font-bold text-slate-900 mt-1">{today.member?.name}</p>
                  <p className="text-sm text-slate-500">{today.member?.role}</p>
                  <p className="text-xs text-slate-400 mt-2 flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Expected start: {today.member?.expectedStart}
                  </p>
                </div>

                <div className="flex flex-col gap-2">
                  <p className="text-xs uppercase tracking-wide text-slate-500 font-semibold">Today</p>
                  <div className="flex flex-col gap-1.5 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Check in</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {fmtTime(today.today?.check_in)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Check out</span>
                      <span className="font-mono font-semibold text-slate-900">
                        {fmtTime(today.today?.check_out)}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">Status</span>
                      <span className="font-semibold text-slate-900">
                        {today.checkedOut
                          ? 'Done for today'
                          : today.checkedIn
                          ? today.isLate
                            ? `Working (late by ${today.lateMinutes}m)`
                            : 'Working'
                          : 'Not checked in'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col justify-center gap-3">
                  {!today.checkedIn && (
                    <>
                      {/* WFH toggle — purely metadata, doesn't affect late detection */}
                      <div className="flex items-center bg-slate-100 rounded-lg p-1 gap-1">
                        <button
                          type="button"
                          onClick={() => setWorkLocation('office')}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            workLocation === 'office'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          <Building2 className="w-3.5 h-3.5" />
                          Office
                        </button>
                        <button
                          type="button"
                          onClick={() => setWorkLocation('home')}
                          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                            workLocation === 'home'
                              ? 'bg-white text-slate-900 shadow-sm'
                              : 'text-slate-500 hover:text-slate-700'
                          }`}
                        >
                          <Home className="w-3.5 h-3.5" />
                          WFH
                        </button>
                      </div>
                      <button
                        onClick={handleCheckIn}
                        disabled={actioning}
                        className="flex items-center justify-center gap-2 px-5 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-colors"
                      >
                        <LogIn className="w-4 h-4" />
                        {actioning ? 'Checking in…' : `Check In ${workLocation === 'home' ? '(WFH)' : ''}`}
                      </button>
                    </>
                  )}
                  {today.checkedIn && !today.checkedOut && (
                    <button
                      onClick={handleCheckOut}
                      disabled={actioning}
                      className="flex items-center justify-center gap-2 px-5 py-3 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl shadow-sm disabled:opacity-50 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      {actioning ? 'Checking out…' : 'Check Out & Sign Out'}
                    </button>
                  )}
                  {today.checkedOut && (
                    <div className="flex items-center justify-center gap-2 px-5 py-3 bg-slate-100 text-slate-500 text-sm font-medium rounded-xl">
                      <CheckCircle2 className="w-4 h-4" />
                      All done for today
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-slate-500 text-sm">No team-payroll record linked to your account. Ask the admin to add you.</p>
            )}
          </div>

          {/* Month summary */}
          {historySummary && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              <StatBadge label="Present" value={historySummary.present || 0} color="green" />
              <StatBadge label="Late days" value={historySummary.late_days || 0} color="amber" />
              <StatBadge label="Leaves" value={historySummary.leaves || 0} color="blue" />
              <StatBadge label="Half days" value={historySummary.half_days || 0} color="slate" />
              <StatBadge label="Total hours" value={fmtHours(historySummary.total_hours)} color="slate" />
            </div>
          )}

          {/* Leave balances */}
          {today?.leaveBalances && (
            <div className="bg-white border border-slate-200 rounded-2xl p-5">
              <h2 className="text-sm font-bold text-slate-900 mb-3 flex items-center gap-2">
                <Calendar className="w-4 h-4 text-slate-400" />
                Leave balances
              </h2>
              <div className="grid grid-cols-3 gap-3">
                <StatBadge label="Casual" value={today.leaveBalances.casual_leave_balance ?? 0} color="blue" />
                <StatBadge label="Sick" value={today.leaveBalances.sick_leave_balance ?? 0} color="amber" />
                <StatBadge label="Earned" value={today.leaveBalances.earned_leave_balance ?? 0} color="green" />
              </div>
            </div>
          )}

          {/* History table */}
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
            <div className="px-5 py-3 border-b border-slate-100 bg-slate-50">
              <h2 className="text-sm font-bold text-slate-900">
                History — {new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}
              </h2>
            </div>
            {history.length === 0 ? (
              <p className="text-sm text-slate-400 text-center py-8">No attendance records this month yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      <th className="px-4 py-3">Date</th>
                      <th className="px-4 py-3">Check in</th>
                      <th className="px-4 py-3">Check out</th>
                      <th className="px-4 py-3 text-right">Hours</th>
                      <th className="px-4 py-3">Status</th>
                      <th className="px-4 py-3">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((r, i) => (
                      <tr key={i} className="border-t border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium text-slate-800">{fmtDate(r.attendance_date)}</td>
                        <td className="px-4 py-3 font-mono text-slate-700">{fmtTime(r.check_in)}</td>
                        <td className="px-4 py-3 font-mono text-slate-700">{fmtTime(r.check_out)}</td>
                        <td className="px-4 py-3 text-right text-slate-700">{fmtHours(r.hours_worked)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                r.status === 'present'
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : r.status === 'leave'
                                  ? 'bg-blue-100 text-blue-700'
                                  : r.status === 'half_day'
                                  ? 'bg-amber-100 text-amber-700'
                                  : r.status === 'absent'
                                  ? 'bg-red-100 text-red-700'
                                  : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {r.status || '—'}
                            </span>
                            {r.is_late && (
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
                                Late {r.late_minutes ?? '?'}m
                              </span>
                            )}
                            {r.work_location === 'home' && (
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-sky-100 text-sky-700 flex items-center gap-1">
                                <Home className="w-3 h-3" /> WFH
                              </span>
                            )}
                            {r.work_location === 'client' && (
                              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-violet-100 text-violet-700">
                                Client site
                              </span>
                            )}
                            {r.admin_overridden_by && (
                              <span
                                className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-200 text-slate-700"
                                title={r.admin_override_reason || 'Set by admin'}
                              >
                                admin override
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">{r.notes || ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
