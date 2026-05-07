import React, { Fragment, useEffect, useMemo, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import {
  DollarSign, TrendingUp, TrendingDown, Receipt, Plus, Trash2,
  RefreshCw, ChevronLeft, ChevronRight, Users, Settings, Calendar,
  ArrowUp, ArrowDown, CreditCard, PieChart, Clock, CheckCircle, XCircle,
  Edit2, Download, X
} from 'lucide-react';

function fmtINR(v) {
  if (v == null) return '—';
  const val = Math.round(v);
  if (val >= 10000000) return `${(val / 10000000).toFixed(2)}Cr`;
  if (val >= 100000) return `${(val / 100000).toFixed(1)}L`;
  if (val >= 1000) return `${(val / 1000).toFixed(1)}K`;
  return val.toLocaleString('en-IN');
}

function StatCard({ icon: Icon, title, value, sub, color = 'text-slate-900', trend }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="flex items-center gap-3 mb-2">
        <div className="w-9 h-9 rounded-lg bg-slate-50 flex items-center justify-center">
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        <p className="text-xs text-slate-500 font-medium">{title}</p>
      </div>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <div className="flex items-center gap-2 mt-1">
        {sub && <p className="text-xs text-slate-400">{sub}</p>}
        {trend != null && trend !== 0 && (
          <span className={`text-xs font-medium flex items-center gap-0.5 ${trend > 0 ? 'text-green-600' : 'text-red-600'}`}>
            {trend > 0 ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
            {Math.abs(trend)}%
          </span>
        )}
      </div>
    </div>
  );
}

const BLANK_EXPENSE = { description: '', amount: '', categoryId: '', expenseDate: new Date().toISOString().split('T')[0], isRecurring: false, vendorName: '', paymentMethod: '', notes: '' };

function AddExpenseForm({ categories, onAdded, editing, onCancelEdit, vendors = [] }) {
  const [form, setForm] = useState(BLANK_EXPENSE);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (editing) {
      setForm({
        description: editing.description || '',
        amount: String(editing.amount || ''),
        categoryId: editing.category_id ? String(editing.category_id) : '',
        expenseDate: editing.expense_date?.split('T')[0] || new Date().toISOString().split('T')[0],
        isRecurring: editing.is_recurring || false,
        vendorName: editing.vendor_name || '',
        paymentMethod: editing.payment_method || '',
        notes: editing.notes || '',
      });
      setError('');
    } else {
      setForm(BLANK_EXPENSE);
    }
  }, [editing]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.description || !form.amount) return;
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, amount: Number(form.amount), categoryId: form.categoryId || null };
      let res;
      if (editing) {
        res = await apiFetch(`/api/finance/expenses/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        res = await apiFetch('/api/finance/expenses', { method: 'POST', body: JSON.stringify(payload) });
      }
      if (res?.error) throw new Error(res.error);
      setForm(BLANK_EXPENSE);
      if (onCancelEdit) onCancelEdit();
      onAdded(editing ? 'Expense updated' : 'Expense added');
    } catch (err) {
      setError(err.message || 'Failed to save expense');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          {editing ? <Edit2 className="w-4 h-4 text-amber-500" /> : <Plus className="w-4 h-4 text-sky-500" />}
          {editing ? 'Edit Expense' : 'Add Expense'}
        </h3>
        {editing && onCancelEdit && (
          <button type="button" onClick={onCancelEdit} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"><X className="w-3 h-3" /> Cancel</button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-lg">{error}</p>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <input type="text" placeholder="Description *" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
          className="col-span-2 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" required />
        <div className="relative">
          <span className="absolute left-3 top-2.5 text-slate-400 text-sm">INR</span>
          <input type="number" placeholder="Amount *" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
            className="w-full border border-slate-200 rounded-lg pl-12 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" required />
        </div>
        <select value={form.categoryId} onChange={e => setForm({ ...form, categoryId: e.target.value })}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">
          <option value="">Category</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <input type="date" value={form.expenseDate} onChange={e => setForm({ ...form, expenseDate: e.target.value })}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        <input type="text" placeholder="Vendor (optional)" value={form.vendorName} onChange={e => setForm({ ...form, vendorName: e.target.value })}
          list="vendor-suggestions"
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
        <datalist id="vendor-suggestions">
          {vendors.map((v, i) => <option key={i} value={v} />)}
        </datalist>
      </div>
      <textarea placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500 resize-none" />
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input type="checkbox" checked={form.isRecurring} onChange={e => setForm({ ...form, isRecurring: e.target.checked })} className="rounded border-slate-300 text-sky-600" />
          Recurring monthly
        </label>
        <select value={form.paymentMethod} onChange={e => setForm({ ...form, paymentMethod: e.target.value })}
          className="border border-slate-200 rounded-lg px-2 py-1 text-xs bg-white">
          <option value="">Payment method</option>
          <option value="card">Card</option>
          <option value="upi">UPI</option>
          <option value="bank_transfer">Bank Transfer</option>
          <option value="cash">Cash</option>
        </select>
      </div>
      <button type="submit" disabled={saving}
        className={`w-full py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50 ${editing ? 'bg-amber-600 hover:bg-amber-700' : 'bg-sky-600 hover:bg-sky-700'}`}>
        {saving ? 'Saving...' : editing ? 'Update Expense' : 'Add Expense'}
      </button>
    </form>
  );
}

const BLANK_INCOME = { source: '', description: '', amount: '', incomeDate: new Date().toISOString().split('T')[0], category: 'other', notes: '' };

function AddIncomeForm({ onAdded, editing, onCancelEdit }) {
  const [form, setForm] = useState(BLANK_INCOME);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (editing) {
      setForm({
        source: editing.source || '',
        description: editing.description || '',
        amount: String(editing.amount || ''),
        incomeDate: editing.income_date?.split('T')[0] || new Date().toISOString().split('T')[0],
        category: editing.category || 'other',
        notes: editing.notes || '',
      });
      setError('');
    } else {
      setForm(BLANK_INCOME);
    }
  }, [editing]);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.source || !form.amount) return;
    setSaving(true);
    setError('');
    try {
      const payload = { ...form, amount: Number(form.amount) };
      let res;
      if (editing) {
        res = await apiFetch(`/api/finance/income/${editing.id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      } else {
        res = await apiFetch('/api/finance/income', { method: 'POST', body: JSON.stringify(payload) });
      }
      if (res?.error) throw new Error(res.error);
      setForm(BLANK_INCOME);
      if (onCancelEdit) onCancelEdit();
      onAdded(editing ? 'Income updated' : 'Income added');
    } catch (err) {
      setError(err.message || 'Failed to save income');
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
          {editing ? <Edit2 className="w-4 h-4 text-amber-500" /> : <Plus className="w-4 h-4 text-emerald-500" />}
          {editing ? 'Edit Income' : 'Add Income'}
        </h3>
        {editing && onCancelEdit && (
          <button type="button" onClick={onCancelEdit} className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1"><X className="w-3 h-3" /> Cancel</button>
        )}
      </div>
      {error && <p className="text-xs text-red-600 bg-red-50 px-3 py-1.5 rounded-lg">{error}</p>}
      <input type="text" placeholder="Source *" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" required />
      <input type="text" placeholder="Description (optional)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="relative">
          <span className="absolute left-3 top-2.5 text-slate-400 text-sm">INR</span>
          <input type="number" placeholder="Amount *" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })}
            className="w-full border border-slate-200 rounded-lg pl-12 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" required />
        </div>
        <input type="date" value={form.incomeDate} onChange={e => setForm({ ...form, incomeDate: e.target.value })}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
      </div>
      <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500">
        <option value="client_revenue">Client Revenue</option>
        <option value="consulting">Consulting</option>
        <option value="product_sales">Product Sales</option>
        <option value="refund">Refund</option>
        <option value="other">Other</option>
      </select>
      <textarea placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} rows={2}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none" />
      <button type="submit" disabled={saving}
        className={`w-full py-2 text-white rounded-lg text-sm font-medium disabled:opacity-50 ${editing ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
        {saving ? 'Saving...' : editing ? 'Update Income' : 'Add Income'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Daily attendance grid — member × day matrix for the selected month.
// Reads attendance.attendance (already returned by /api/finance/attendance)
// and renders one cell per (member, day) pair, color-coded by status.
// ---------------------------------------------------------------------------
const STATUS_STYLE = {
  present:  { bg: 'bg-green-100',  text: 'text-green-700',  letter: 'P' },
  absent:   { bg: 'bg-red-100',    text: 'text-red-700',    letter: 'A' },
  half_day: { bg: 'bg-amber-100',  text: 'text-amber-700',  letter: 'H' },
  leave:    { bg: 'bg-blue-100',   text: 'text-blue-700',   letter: 'L' },
  wfh:      { bg: 'bg-purple-100', text: 'text-purple-700', letter: 'W' },
};

function fmtTime(t) {
  if (!t) return '—';
  // Postgres TIME returns "HH:MM:SS"; fall back to raw string otherwise.
  const m = String(t).match(/^(\d{2}):(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : String(t);
}

function DailyAttendanceGrid({ team, attendance, month, onCellClick }) {
  const [yyyy, mm] = month.split('-').map(Number);
  const daysInMonth = new Date(yyyy, mm, 0).getDate();
  const todayStr = new Date().toISOString().slice(0, 10);

  // Build lookup: `${memberId}|YYYY-MM-DD` -> record
  const byKey = useMemo(() => {
    const map = new Map();
    for (const a of attendance || []) {
      const date = (a.attendance_date || '').slice(0, 10);
      if (!date) continue;
      map.set(`${a.member_id}|${date}`, a);
    }
    return map;
  }, [attendance]);

  if (!team || team.length === 0) {
    return <p className="text-xs text-slate-400 italic">No team members configured.</p>;
  }

  const days = Array.from({ length: daysInMonth }, (_, i) => i + 1);
  const dowLetter = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  return (
    <div className="overflow-x-auto">
      <table className="text-[11px] border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="sticky left-0 bg-white z-10 text-left px-2 py-1 text-xs font-semibold text-slate-500 min-w-[140px]">
              Team Member
            </th>
            {days.map(d => {
              const date = new Date(yyyy, mm - 1, d);
              const dow = date.getDay(); // 0=Sun
              const isWeekend = dow === 0 || dow === 6;
              const dStr = `${month}-${String(d).padStart(2, '0')}`;
              const isToday = dStr === todayStr;
              return (
                <th key={d} className={`px-1 py-0.5 text-center font-medium ${isWeekend ? 'text-slate-300' : 'text-slate-500'} ${isToday ? 'underline decoration-sky-500' : ''}`}>
                  <div>{d}</div>
                  <div className="text-[9px] font-normal opacity-70">{dowLetter[dow]}</div>
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {team.map(m => (
            <tr key={m.id}>
              <td className="sticky left-0 bg-white z-10 px-2 py-1 font-medium text-slate-700 truncate">{m.name}</td>
              {days.map(d => {
                const dStr = `${month}-${String(d).padStart(2, '0')}`;
                const rec = byKey.get(`${m.id}|${dStr}`);
                const date = new Date(yyyy, mm - 1, d);
                const dow = date.getDay();
                const isWeekend = dow === 0 || dow === 6;
                const isFuture = dStr > todayStr;
                const style = rec ? STATUS_STYLE[rec.status] : null;

                let title = `${m.name} — ${dStr}`;
                if (rec) {
                  title += `\nStatus: ${rec.status?.replace('_', ' ')}`;
                  if (rec.check_in)  title += `\nCheck-in:  ${fmtTime(rec.check_in)}`;
                  if (rec.check_out) title += `\nCheck-out: ${fmtTime(rec.check_out)}`;
                  if (rec.hours_worked != null) title += `\nHours: ${Number(rec.hours_worked).toFixed(1)}h`;
                  if (rec.is_late) title += `\nLate by ${rec.late_minutes ?? '?'}m`;
                  if (rec.work_location && rec.work_location !== 'office') title += `\nLocation: ${rec.work_location}`;
                  if (rec.notes) title += `\nNote: ${rec.notes}`;
                  if (rec.admin_overridden_by) title += `\nOverridden by ${rec.admin_overridden_by}`;
                } else if (isWeekend) {
                  title += '\n(weekend)';
                } else if (isFuture) {
                  title += '\n(future)';
                } else {
                  title += '\n(no record)';
                }

                return (
                  <td key={d} className="p-0">
                    <button
                      type="button"
                      onClick={() => onCellClick?.(m, dStr, rec)}
                      title={title}
                      className={`w-6 h-6 flex items-center justify-center rounded text-[10px] font-bold relative
                        ${style ? `${style.bg} ${style.text}` : isWeekend ? 'bg-slate-50 text-slate-300' : isFuture ? 'bg-slate-50 text-slate-200' : 'bg-slate-100 text-slate-300 hover:bg-slate-200'}
                      `}
                    >
                      {style?.letter ?? (isWeekend ? '·' : isFuture ? '' : '–')}
                      {rec?.is_late && <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-amber-500" />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex flex-wrap gap-3 text-[11px] text-slate-500">
        {Object.entries(STATUS_STYLE).map(([k, v]) => (
          <span key={k} className="flex items-center gap-1">
            <span className={`w-3 h-3 rounded ${v.bg} ${v.text} flex items-center justify-center text-[9px] font-bold`}>{v.letter}</span>
            {k.replace('_', ' ')}
          </span>
        ))}
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-500" /> late check-in
        </span>
      </div>
    </div>
  );
}

export default function FinancePage() {
  const [activeTab, setActiveTab] = useState('overview');
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [loading, setLoading] = useState(true);
  const [dashboard, setDashboard] = useState(null);
  const [expenses, setExpenses] = useState([]);
  const [categories, setCategories] = useState([]);
  const [team, setTeam] = useState([]);
  const [income, setIncome] = useState([]);
  const [pnlHistory, setPnlHistory] = useState([]);
  const [attendance, setAttendance] = useState({ team: [], attendance: [], summary: [] });
  const [leaves, setLeaves] = useState([]);
  const [toast, setToast] = useState('');
  const [vendors, setVendors] = useState([]);
  const [editingExpense, setEditingExpense] = useState(null);
  const [editingIncome, setEditingIncome] = useState(null);

  // New team member form
  const [newMember, setNewMember] = useState({ name: '', role: '', baseSalary: '' });

  // New category form
  const [newCat, setNewCat] = useState({ name: '', color: '#3b82f6' });

  // Attendance form
  const [attDate, setAttDate] = useState(new Date().toISOString().split('T')[0]);
  const [attStatus, setAttStatus] = useState('present');
  const [expandedMember, setExpandedMember] = useState(null); // member_id whose daily detail is open

  const loadData = useCallback(async (toastMsg) => {
    setLoading(true);
    if (toastMsg) setToast(toastMsg);
    const [dashR, expR, catR, teamR, incR, pnlR, attR, leaveR, vendorR] = await Promise.all([
      apiFetch(`/api/finance/dashboard?month=${month}`).catch(() => null),
      apiFetch(`/api/finance/expenses?month=${month}`).catch(() => ({ expenses: [] })),
      apiFetch('/api/finance/categories').catch(() => ({ categories: [] })),
      apiFetch('/api/finance/team-payroll').catch(() => ({ team: [] })),
      apiFetch(`/api/finance/income?month=${month}`).catch(() => ({ income: [] })),
      apiFetch('/api/finance/pnl?months=6').catch(() => ({ pnl: [] })),
      apiFetch(`/api/finance/attendance?month=${month}`).catch(() => ({ team: [], attendance: [], summary: [] })),
      apiFetch(`/api/finance/leaves?month=${month}`).catch(() => ({ leaves: [] })),
      apiFetch('/api/finance/vendors').catch(() => ({ vendors: [] })),
    ]);
    setDashboard(dashR);
    setExpenses(expR?.expenses ?? []);
    setCategories(catR?.categories ?? []);
    setTeam(teamR?.team ?? []);
    setIncome(incR?.income ?? []);
    setPnlHistory(pnlR?.pnl ?? []);
    setAttendance(attR || { team: [], attendance: [], summary: [] });
    setLeaves(leaveR?.leaves ?? []);
    setVendors(vendorR?.vendors ?? []);
    setLoading(false);
  }, [month]);

  useEffect(() => { loadData(); }, [loadData]);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(''), 3000); return () => clearTimeout(t); } }, [toast]);

  function prevMonth() {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 2, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  function nextMonth() {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m, 1);
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthLabel = new Date(month + '-01').toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  async function deleteExpense(id) {
    if (!window.confirm('Delete this expense? This cannot be undone.')) return;
    await apiFetch(`/api/finance/expenses/${id}`, { method: 'DELETE' });
    loadData();
  }

  async function deleteIncome(id) {
    if (!window.confirm('Delete this income entry?')) return;
    await apiFetch(`/api/finance/income/${id}`, { method: 'DELETE' });
    loadData();
  }

  async function deleteTeamMember(id, name) {
    if (!window.confirm(`Remove ${name} from payroll? Their existing salary expenses will remain.`)) return;
    await apiFetch(`/api/finance/team-payroll/${id}`, { method: 'DELETE' });
    loadData();
  }

  async function generateMonthly() {
    const r = await apiFetch('/api/finance/generate-monthly', { method: 'POST', body: JSON.stringify({ month }) });
    setToast(`Generated ${r?.generated ?? 0} expenses`);
    loadData();
  }

  function exportCSV() {
    const token = localStorage.getItem('ge_crm_token');
    const url = `/api/finance/expenses/export-csv?month=${month}`;
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.blob())
      .then(blob => {
        const blobUrl = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = `expenses-${month}.csv`;
        link.click();
        URL.revokeObjectURL(blobUrl);
        setToast('CSV exported');
      })
      .catch(() => setToast('Export failed'));
  }

  async function addTeamMember(e) {
    e.preventDefault();
    if (!newMember.name) return;
    await apiFetch('/api/finance/team-payroll', { method: 'POST', body: JSON.stringify({ name: newMember.name, role: newMember.role, baseSalary: Number(newMember.baseSalary || 0) }) });
    setNewMember({ name: '', role: '', baseSalary: '' });
    loadData();
  }

  async function addCategory(e) {
    e.preventDefault();
    if (!newCat.name) return;
    await apiFetch('/api/finance/categories', { method: 'POST', body: JSON.stringify(newCat) });
    setNewCat({ name: '', color: '#3b82f6' });
    loadData();
  }

  const revChange = dashboard?.prevMonth?.revenue ? Math.round(((dashboard.revenue - dashboard.prevMonth.revenue) / dashboard.prevMonth.revenue) * 100) : 0;
  const expChange = dashboard?.prevMonth?.expenses ? Math.round(((dashboard.expenses - dashboard.prevMonth.expenses) / dashboard.prevMonth.expenses) * 100) : 0;

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        {/* Header */}
        <div className="bg-white border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-sky-500 flex items-center justify-center shadow-md">
                <DollarSign className="w-4 h-4 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold text-slate-900">Finance</h1>
                <p className="text-xs text-slate-500">Expenses, income & P&L</p>
              </div>
            </div>

            {/* Month selector */}
            <div className="ml-auto flex items-center gap-2">
              <button onClick={prevMonth} className="p-1 hover:bg-slate-100 rounded"><ChevronLeft className="w-4 h-4 text-slate-500" /></button>
              <span className="text-sm font-semibold text-slate-800 min-w-[120px] text-center">{monthLabel}</span>
              <button onClick={nextMonth} className="p-1 hover:bg-slate-100 rounded"><ChevronRight className="w-4 h-4 text-slate-500" /></button>
            </div>

            <button onClick={loadData} disabled={loading} className="p-2 border border-slate-200 rounded-lg hover:bg-slate-50">
              <RefreshCw className={`w-4 h-4 text-slate-500 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 mt-3">
            {[
              { id: 'overview', label: 'Overview', icon: PieChart },
              { id: 'expenses', label: 'Expenses', icon: Receipt },
              { id: 'income', label: 'Income', icon: TrendingUp },
              { id: 'team', label: 'Team', icon: Users },
              { id: 'attendance', label: 'Attendance', icon: Clock },
              { id: 'categories', label: 'Categories', icon: Settings },
            ].map(t => (
              <button key={t.id} onClick={() => setActiveTab(t.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === t.id ? 'bg-sky-600 text-white' : 'text-slate-500 hover:bg-slate-100'
                }`}>
                <t.icon className="w-3.5 h-3.5" /> {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* ── OVERVIEW TAB ── */}
          {activeTab === 'overview' && dashboard && (
            <div className="space-y-6">
              {/* P&L Cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <StatCard icon={TrendingUp} title="Revenue" value={`INR ${fmtINR(dashboard.revenue)}`} sub={`Invoices: INR ${fmtINR(dashboard.revenueBreakdown?.invoices)}`} color="text-emerald-600" trend={revChange} />
                <StatCard icon={Receipt} title="Expenses" value={`INR ${fmtINR(dashboard.expenses)}`} sub={`Incl. team payroll: INR ${fmtINR(team.reduce((s, m) => s + Number(m.base_salary || 0), 0))}`} color="text-red-600" trend={expChange} />
                <StatCard icon={DollarSign} title="Profit" value={`INR ${fmtINR(dashboard.profit)}`} sub={dashboard.profit >= 0 ? 'Positive' : 'Negative'} color={dashboard.profit >= 0 ? 'text-emerald-600' : 'text-red-600'} />
              </div>

              {/* Category Breakdown */}
              {dashboard.expensesByCategory?.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-sm font-bold text-slate-800 mb-4">Expenses by Category</h3>
                  <div className="space-y-3">
                    {dashboard.expensesByCategory.map((c, i) => {
                      const pct = dashboard.expenses > 0 ? Math.round((c.amount / dashboard.expenses) * 100) : 0;
                      return (
                        <div key={i} className="flex items-center gap-3">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.color }} />
                          <p className="text-sm text-slate-700 flex-1">{c.category}</p>
                          <p className="text-sm font-semibold text-slate-800">INR {fmtINR(c.amount)}</p>
                          <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: c.color }} />
                          </div>
                          <span className="text-xs text-slate-400 w-8 text-right">{pct}%</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* P&L Trend */}
              {pnlHistory.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <h3 className="text-sm font-bold text-slate-800 mb-4">6-Month P&L Trend</h3>
                  <div className="grid grid-cols-6 gap-2">
                    {pnlHistory.map((p, i) => {
                      const maxVal = Math.max(...pnlHistory.map(x => Math.max(x.revenue, x.expenses)), 1);
                      return (
                        <div key={i} className="text-center">
                          <div className="h-32 flex items-end gap-1 justify-center mb-2">
                            <div className="w-4 bg-emerald-200 rounded-t" style={{ height: `${(p.revenue / maxVal) * 100}%` }} title={`Revenue: INR ${fmtINR(p.revenue)}`} />
                            <div className="w-4 bg-red-200 rounded-t" style={{ height: `${(p.expenses / maxVal) * 100}%` }} title={`Expenses: INR ${fmtINR(p.expenses)}`} />
                          </div>
                          <p className="text-[10px] text-slate-500">{new Date(p.month + '-01').toLocaleDateString('en-IN', { month: 'short' })}</p>
                          <p className={`text-xs font-semibold ${p.profit >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmtINR(p.profit)}</p>
                        </div>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-4 mt-3 justify-center">
                    <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="w-3 h-3 bg-emerald-200 rounded" /> Revenue</span>
                    <span className="flex items-center gap-1.5 text-xs text-slate-500"><span className="w-3 h-3 bg-red-200 rounded" /> Expenses</span>
                  </div>
                </div>
              )}

              {/* Generate monthly button */}
              <button onClick={generateMonthly}
                className="flex items-center gap-2 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                <Calendar className="w-4 h-4" /> Generate recurring expenses for {monthLabel}
              </button>
            </div>
          )}

          {/* ── EXPENSES TAB ── */}
          {activeTab === 'expenses' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-bold text-slate-700">{monthLabel} Expenses</h2>
                  <div className="flex items-center gap-3">
                    <button onClick={exportCSV} className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-50">
                      <Download className="w-3.5 h-3.5" /> Export CSV
                    </button>
                    <span className="text-sm font-semibold text-slate-800">Total: INR {fmtINR(expenses.reduce((s, e) => s + Number(e.amount), 0))}</span>
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-slate-50 border-b">
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Date</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Description</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Category</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Amount</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenses.length === 0 && (
                        <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400 text-sm">No expenses for {monthLabel}</td></tr>
                      )}
                      {expenses.map(e => (
                        <tr key={e.id} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="px-4 py-2.5 text-slate-600">{new Date(String(e.expense_date).split('T')[0] + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                          <td className="px-4 py-2.5">
                            <p className="text-slate-800 font-medium">{e.description}</p>
                            {e.vendor_name && <p className="text-xs text-slate-400">{e.vendor_name}</p>}
                            {e.is_recurring && <span className="text-[10px] bg-sky-50 text-sky-600 px-1.5 py-0.5 rounded font-medium">Recurring</span>}
                          </td>
                          <td className="px-4 py-2.5">
                            {e.category_name ? (
                              <span className="inline-flex items-center gap-1.5 text-xs">
                                <span className="w-2 h-2 rounded-full" style={{ background: e.category_color }} />
                                {e.category_name}
                              </span>
                            ) : <span className="text-xs text-slate-400">—</span>}
                          </td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-800">INR {Number(e.amount).toLocaleString('en-IN')}</td>
                          <td className="px-4 py-2.5 text-right">
                            <div className="flex items-center gap-1 justify-end">
                              <button onClick={() => setEditingExpense(e)} className="text-slate-400 hover:text-amber-600 p-1" title="Edit"><Edit2 className="w-3.5 h-3.5" /></button>
                              <button onClick={() => deleteExpense(e.id)} className="text-slate-400 hover:text-red-600 p-1" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <AddExpenseForm categories={categories} onAdded={loadData} editing={editingExpense} onCancelEdit={() => setEditingExpense(null)} vendors={vendors} />
              </div>
            </div>
          )}

          {/* ── INCOME TAB ── */}
          {activeTab === 'income' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-6 py-3 border-b bg-slate-50 flex items-center justify-between">
                    <p className="text-xs font-semibold text-slate-500 uppercase">Income — {monthLabel}</p>
                    <p className="text-sm font-semibold text-emerald-600">Total: INR {fmtINR(income.reduce((s, i) => s + Number(i.amount), 0))}</p>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Date</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Source</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Description</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Type</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Amount</th>
                        <th className="px-4 py-2 w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {income.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-slate-400">No income for {monthLabel}</td></tr>}
                      {income.map((i, idx) => (
                        <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="px-4 py-2.5 text-slate-600">{new Date(String(i.income_date).split('T')[0] + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                          <td className="px-4 py-2.5 text-slate-800 font-medium">{i.source}</td>
                          <td className="px-4 py-2.5 text-slate-600">{i.description || '—'}</td>
                          <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${i.category === 'invoice' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{i.category === 'invoice' ? 'Invoice' : 'Other'}</span></td>
                          <td className="px-4 py-2.5 text-right font-semibold text-emerald-600">INR {fmtINR(i.amount)}</td>
                          <td className="px-4 py-2.5 text-right">
                            {i.category !== 'invoice' && (
                              <div className="flex items-center gap-1 justify-end">
                                <button onClick={() => setEditingIncome(i)} className="text-slate-400 hover:text-amber-600 p-1" title="Edit"><Edit2 className="w-3.5 h-3.5" /></button>
                                <button onClick={() => deleteIncome(i.id)} className="text-slate-400 hover:text-red-600 p-1" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Add Income Form */}
              <div>
                <AddIncomeForm onAdded={loadData} editing={editingIncome} onCancelEdit={() => setEditingIncome(null)} />
              </div>
            </div>
          )}

          {/* ── TEAM TAB ── */}
          {activeTab === 'team' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-6 py-3 border-b bg-slate-50">
                  <p className="text-xs font-semibold text-slate-500 uppercase">Team Payroll</p>
                </div>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Name</th>
                      <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Role</th>
                      <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Base Salary</th>
                      <th className="px-4 py-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {team.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-slate-400">No team members added</td></tr>}
                    {team.map(m => (
                      <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-800 font-medium">{m.name}</td>
                        <td className="px-4 py-2.5 text-slate-600">{m.role || '—'}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">INR {Number(m.base_salary).toLocaleString('en-IN')}</td>
                        <td className="px-4 py-2.5 text-right">
                          <button onClick={() => deleteTeamMember(m.id, m.name)} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50 border-t">
                      <td colSpan={2} className="px-4 py-2.5 text-sm font-semibold text-slate-700">
                        Total Monthly Payroll
                        <span className="text-xs font-normal text-slate-400 ml-2">(already included in Expenses total)</span>
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold text-slate-900">INR {fmtINR(team.reduce((s, m) => s + Number(m.base_salary || 0), 0))}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              {/* Add team member */}
              <form onSubmit={addTeamMember} className="bg-white rounded-xl border border-slate-200 p-5 flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 font-medium">Name</label>
                  <input type="text" value={newMember.name} onChange={e => setNewMember({ ...newMember, name: e.target.value })} placeholder="Team member name"
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" required />
                </div>
                <div className="flex-1">
                  <label className="text-xs text-slate-500 font-medium">Role</label>
                  <input type="text" value={newMember.role} onChange={e => setNewMember({ ...newMember, role: e.target.value })} placeholder="e.g. Sales, Ops"
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <div className="w-32">
                  <label className="text-xs text-slate-500 font-medium">Base Salary</label>
                  <input type="number" value={newMember.baseSalary} onChange={e => setNewMember({ ...newMember, baseSalary: e.target.value })} placeholder="25000"
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                </div>
                <button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700">Add</button>
              </form>
            </div>
          )}

          {/* ── ATTENDANCE TAB ── */}
          {activeTab === 'attendance' && (
            <div className="space-y-6">
              {/* Quick mark attendance */}
              <div className="bg-white rounded-xl border border-slate-200 p-5">
                <h3 className="text-sm font-bold text-slate-800 mb-4 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-sky-500" /> Mark Attendance — {new Date(attDate).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short' })}
                </h3>
                <div className="flex items-center gap-3 mb-4">
                  <input type="date" value={attDate} onChange={e => setAttDate(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm" />
                  <select value={attStatus} onChange={e => setAttStatus(e.target.value)}
                    className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white">
                    <option value="present">Present</option>
                    <option value="absent">Absent</option>
                    <option value="half_day">Half Day</option>
                    <option value="leave">Leave</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {(attendance.team || []).map(m => {
                    // Check if already marked for this date
                    const existing = (attendance.attendance || []).find(a => a.member_id === m.id && a.attendance_date?.split('T')[0] === attDate);
                    const currentStatus = existing?.status;
                    const statusIcon = currentStatus === 'present' ? <CheckCircle className="w-4 h-4 text-green-500" /> :
                      currentStatus === 'absent' ? <XCircle className="w-4 h-4 text-red-500" /> :
                      currentStatus === 'half_day' ? <Clock className="w-4 h-4 text-amber-500" /> :
                      currentStatus === 'leave' ? <Calendar className="w-4 h-4 text-blue-500" /> :
                      <span className="w-4 h-4 rounded-full border-2 border-slate-300" />;

                    return (
                      <button key={m.id}
                        onClick={async () => {
                          await apiFetch('/api/finance/attendance', {
                            method: 'POST',
                            body: JSON.stringify({ memberId: m.id, date: attDate, status: attStatus }),
                          });
                          setToast(`${m.name} marked ${attStatus}`);
                          loadData();
                        }}
                        className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm text-left transition-colors ${
                          currentStatus ? 'border-slate-200 bg-slate-50' : 'border-dashed border-slate-300 hover:border-sky-300 hover:bg-sky-50'
                        }`}
                      >
                        {statusIcon}
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-slate-800 truncate">{m.name}</p>
                          {currentStatus && <p className="text-[10px] text-slate-400 capitalize">{currentStatus.replace('_', ' ')}</p>}
                        </div>
                      </button>
                    );
                  })}
                </div>
                {(attendance.team || []).length > 0 && (
                  <button
                    onClick={async () => {
                      const ids = (attendance.team || []).map(m => m.id);
                      await apiFetch('/api/finance/attendance', {
                        method: 'POST',
                        body: JSON.stringify({ memberIds: ids, date: attDate, status: attStatus }),
                      });
                      setToast(`All team marked ${attStatus}`);
                      loadData();
                    }}
                    className="mt-3 flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700"
                  >
                    <CheckCircle className="w-4 h-4" /> Mark All {attStatus === 'present' ? 'Present' : attStatus.replace('_', ' ')}
                  </button>
                )}
              </div>

              {/* Daily grid — bird's-eye view of the whole month */}
              {(attendance.team || []).length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-sky-500" /> Daily Attendance — {monthLabel}
                    </h3>
                    <p className="text-[11px] text-slate-400">click a cell to mark / edit</p>
                  </div>
                  <DailyAttendanceGrid
                    team={attendance.team || []}
                    attendance={attendance.attendance || []}
                    month={month}
                    onCellClick={async (member, dStr, rec) => {
                      // Cycle status: nothing → present → absent → half_day → leave → wfh → unset
                      const cycle = ['present', 'absent', 'half_day', 'leave', 'wfh'];
                      const next = !rec ? 'present' : cycle[(cycle.indexOf(rec.status) + 1) % cycle.length];
                      await apiFetch('/api/finance/attendance', {
                        method: 'POST',
                        body: JSON.stringify({ memberId: member.id, date: dStr, status: next }),
                      });
                      setToast(`${member.name} • ${dStr} → ${next.replace('_', ' ')}`);
                      loadData();
                    }}
                  />
                </div>
              )}

              {/* Monthly summary — click a row to expand the per-member daily timeline */}
              {(attendance.summary || []).length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                  <div className="px-6 py-3 border-b bg-slate-50">
                    <p className="text-xs font-semibold text-slate-500 uppercase">Monthly Summary — {monthLabel}</p>
                  </div>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Team Member</th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-green-600">Present</th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-red-600">Absent</th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-amber-600">Half Days</th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-blue-600">Leaves</th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">Total Hours</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(attendance.summary || []).map((s, i) => {
                        const isOpen = expandedMember === s.member_id;
                        const memberDays = (attendance.attendance || [])
                          .filter(a => a.member_id === s.member_id)
                          .slice()
                          .sort((a, b) => (b.attendance_date || '').localeCompare(a.attendance_date || ''));
                        return (
                          <Fragment key={i}>
                            <tr
                              className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer"
                              onClick={() => setExpandedMember(isOpen ? null : s.member_id)}
                            >
                              <td className="px-4 py-2.5 font-medium text-slate-800 flex items-center gap-1">
                                <ChevronRight className={`w-3.5 h-3.5 text-slate-400 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                                {s.member_name}
                              </td>
                              <td className="px-4 py-2.5 text-center"><span className="bg-green-50 text-green-700 px-2 py-0.5 rounded-full text-xs font-semibold">{s.present}</span></td>
                              <td className="px-4 py-2.5 text-center"><span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${Number(s.absent) > 0 ? 'bg-red-50 text-red-700' : 'bg-slate-50 text-slate-400'}`}>{s.absent}</span></td>
                              <td className="px-4 py-2.5 text-center"><span className="bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full text-xs font-semibold">{s.half_days}</span></td>
                              <td className="px-4 py-2.5 text-center"><span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs font-semibold">{s.leaves}</span></td>
                              <td className="px-4 py-2.5 text-center text-slate-600">{Number(s.total_hours).toFixed(1)}h</td>
                            </tr>
                            {isOpen && (
                              <tr className="bg-slate-50/50">
                                <td colSpan={6} className="px-6 py-3">
                                  {memberDays.length === 0 ? (
                                    <p className="text-xs text-slate-400 italic">No daily records for {monthLabel}.</p>
                                  ) : (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="text-slate-400 border-b">
                                          <th className="text-left py-1 px-2">Date</th>
                                          <th className="text-left py-1 px-2">Status</th>
                                          <th className="text-left py-1 px-2">Check-in</th>
                                          <th className="text-left py-1 px-2">Check-out</th>
                                          <th className="text-left py-1 px-2">Hours</th>
                                          <th className="text-left py-1 px-2">Late</th>
                                          <th className="text-left py-1 px-2">Location</th>
                                          <th className="text-left py-1 px-2">Notes</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {memberDays.map(a => {
                                          const d = (a.attendance_date || '').slice(0, 10);
                                          const day = new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' });
                                          const style = STATUS_STYLE[a.status];
                                          return (
                                            <tr key={a.id} className="border-b border-slate-100">
                                              <td className="py-1 px-2 text-slate-700 font-medium">{day}</td>
                                              <td className="py-1 px-2">
                                                <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${style?.bg ?? 'bg-slate-100'} ${style?.text ?? 'text-slate-500'}`}>
                                                  {(a.status || '—').replace('_', ' ')}
                                                </span>
                                              </td>
                                              <td className="py-1 px-2 text-slate-600">{fmtTime(a.check_in)}</td>
                                              <td className="py-1 px-2 text-slate-600">{fmtTime(a.check_out)}</td>
                                              <td className="py-1 px-2 text-slate-600">{a.hours_worked != null ? `${Number(a.hours_worked).toFixed(1)}h` : '—'}</td>
                                              <td className="py-1 px-2">
                                                {a.is_late ? <span className="text-amber-600 font-medium">+{a.late_minutes ?? '?'}m</span> : <span className="text-slate-300">—</span>}
                                              </td>
                                              <td className="py-1 px-2 text-slate-600 capitalize">{a.work_location || 'office'}</td>
                                              <td className="py-1 px-2 text-slate-500 truncate max-w-[200px]" title={a.notes || ''}>{a.notes || '—'}</td>
                                            </tr>
                                          );
                                        })}
                                      </tbody>
                                    </table>
                                  )}
                                </td>
                              </tr>
                            )}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Leaves section */}
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-6 py-3 border-b bg-slate-50 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 uppercase">Leave Requests</p>
                </div>
                {leaves.length === 0 ? (
                  <div className="p-8 text-center text-sm text-slate-400">No leave requests for {monthLabel}</div>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b">
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Member</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Type</th>
                        <th className="px-4 py-2 text-left text-xs font-semibold text-slate-500">Dates</th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">Days</th>
                        <th className="px-4 py-2 text-center text-xs font-semibold text-slate-500">Status</th>
                        <th className="px-4 py-2 text-right text-xs font-semibold text-slate-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaves.map(l => (
                        <tr key={l.id} className="border-b border-slate-50">
                          <td className="px-4 py-2.5 font-medium text-slate-800">{l.member_name}</td>
                          <td className="px-4 py-2.5 capitalize text-slate-600">{l.leave_type}</td>
                          <td className="px-4 py-2.5 text-slate-600">{new Date(String(l.start_date).split('T')[0] + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} — {new Date(String(l.end_date).split('T')[0] + 'T12:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                          <td className="px-4 py-2.5 text-center">{l.days}</td>
                          <td className="px-4 py-2.5 text-center">
                            <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${l.status === 'approved' ? 'bg-green-50 text-green-700' : l.status === 'rejected' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                              {l.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            {l.status === 'pending' && (
                              <div className="flex gap-1 justify-end">
                                <button onClick={async () => { await apiFetch(`/api/finance/leaves/${l.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'approved' }) }); loadData(); }}
                                  className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs font-medium hover:bg-green-100">Approve</button>
                                <button onClick={async () => { await apiFetch(`/api/finance/leaves/${l.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'rejected' }) }); loadData(); }}
                                  className="px-2 py-1 bg-red-50 text-red-700 rounded text-xs font-medium hover:bg-red-100">Reject</button>
                              </div>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* ── CATEGORIES TAB ── */}
          {activeTab === 'categories' && (
            <div className="space-y-6">
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-6 py-3 border-b bg-slate-50">
                  <p className="text-xs font-semibold text-slate-500 uppercase">Expense Categories</p>
                </div>
                <div className="divide-y divide-slate-50">
                  {categories.map(c => (
                    <div key={c.id} className="px-6 py-3 flex items-center gap-3">
                      <span className="w-4 h-4 rounded-full flex-shrink-0" style={{ background: c.color }} />
                      <p className="text-sm font-medium text-slate-800 flex-1">{c.name}</p>
                      <button onClick={async () => { if (!window.confirm(`Delete "${c.name}" category? Existing expenses will show as uncategorized.`)) return; await apiFetch(`/api/finance/categories/${c.id}`, { method: 'DELETE' }); loadData(); }}
                        className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  ))}
                </div>
              </div>
              <form onSubmit={addCategory} className="bg-white rounded-xl border border-slate-200 p-5 flex items-end gap-3">
                <div className="flex-1">
                  <label className="text-xs text-slate-500 font-medium">Category Name</label>
                  <input type="text" value={newCat.name} onChange={e => setNewCat({ ...newCat, name: e.target.value })} placeholder="e.g. Travel, Office Supplies"
                    className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm" required />
                </div>
                <div className="w-20">
                  <label className="text-xs text-slate-500 font-medium">Color</label>
                  <input type="color" value={newCat.color} onChange={e => setNewCat({ ...newCat, color: e.target.value })}
                    className="mt-1 w-full h-[38px] border border-slate-200 rounded-lg cursor-pointer" />
                </div>
                <button type="submit" className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700">Add Category</button>
              </form>
            </div>
          )}
        </div>

        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900 text-white text-sm font-medium px-5 py-3 rounded-2xl shadow-2xl">{toast}</div>
        )}
      </main>
    </div>
  );
}
