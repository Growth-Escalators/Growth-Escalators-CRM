import React, { useEffect, useState, useCallback } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import {
  DollarSign, TrendingUp, TrendingDown, Receipt, Plus, Trash2,
  RefreshCw, ChevronLeft, ChevronRight, Users, Settings, Calendar,
  ArrowUp, ArrowDown, CreditCard, PieChart
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

function AddExpenseForm({ categories, onAdded }) {
  const [form, setForm] = useState({ description: '', amount: '', categoryId: '', expenseDate: new Date().toISOString().split('T')[0], isRecurring: false, vendorName: '', paymentMethod: '', notes: '' });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.description || !form.amount) return;
    setSaving(true);
    await apiFetch('/api/finance/expenses', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount), categoryId: form.categoryId || null }) });
    setSaving(false);
    setForm({ ...form, description: '', amount: '', vendorName: '', notes: '' });
    onAdded();
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Plus className="w-4 h-4 text-sky-500" /> Add Expense</h3>
      <div className="grid grid-cols-2 gap-3">
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
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
      </div>
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
        className="w-full py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50">
        {saving ? 'Adding...' : 'Add Expense'}
      </button>
    </form>
  );
}

function AddIncomeForm({ onAdded }) {
  const [form, setForm] = useState({ source: '', description: '', amount: '', incomeDate: new Date().toISOString().split('T')[0], category: 'other', notes: '' });
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!form.source || !form.amount) return;
    setSaving(true);
    await apiFetch('/api/finance/income', { method: 'POST', body: JSON.stringify({ ...form, amount: Number(form.amount) }) });
    setSaving(false);
    setForm({ ...form, source: '', description: '', amount: '', notes: '' });
    onAdded();
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white rounded-xl border border-slate-200 p-5 space-y-3">
      <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2"><Plus className="w-4 h-4 text-emerald-500" /> Add Income</h3>
      <input type="text" placeholder="Source *" value={form.source} onChange={e => setForm({ ...form, source: e.target.value })}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" required />
      <input type="text" placeholder="Description (optional)" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
      <div className="grid grid-cols-2 gap-3">
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
        className="w-full py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 disabled:opacity-50">
        {saving ? 'Adding...' : 'Add Income'}
      </button>
    </form>
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
  const [toast, setToast] = useState('');

  // New team member form
  const [newMember, setNewMember] = useState({ name: '', role: '', baseSalary: '' });

  // New category form
  const [newCat, setNewCat] = useState({ name: '', color: '#3b82f6' });

  const loadData = useCallback(async () => {
    setLoading(true);
    const [dashR, expR, catR, teamR, incR, pnlR] = await Promise.all([
      apiFetch(`/api/finance/dashboard?month=${month}`).catch(() => null),
      apiFetch(`/api/finance/expenses?month=${month}`).catch(() => ({ expenses: [] })),
      apiFetch('/api/finance/categories').catch(() => ({ categories: [] })),
      apiFetch('/api/finance/team-payroll').catch(() => ({ team: [] })),
      apiFetch(`/api/finance/income?month=${month}`).catch(() => ({ income: [] })),
      apiFetch('/api/finance/pnl?months=6').catch(() => ({ pnl: [] })),
    ]);
    setDashboard(dashR);
    setExpenses(expR?.expenses ?? []);
    setCategories(catR?.categories ?? []);
    setTeam(teamR?.team ?? []);
    setIncome(incR?.income ?? []);
    setPnlHistory(pnlR?.pnl ?? []);
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
    await apiFetch(`/api/finance/expenses/${id}`, { method: 'DELETE' });
    loadData();
  }

  async function generateMonthly() {
    const r = await apiFetch('/api/finance/generate-monthly', { method: 'POST', body: JSON.stringify({ month }) });
    setToast(`Generated ${r?.generated ?? 0} expenses`);
    loadData();
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
                  <span className="text-sm font-semibold text-slate-800">Total: INR {fmtINR(expenses.reduce((s, e) => s + Number(e.amount), 0))}</span>
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
                          <td className="px-4 py-2.5 text-slate-600">{new Date(e.expense_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
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
                            <button onClick={() => deleteExpense(e.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div>
                <AddExpenseForm categories={categories} onAdded={loadData} />
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
                      </tr>
                    </thead>
                    <tbody>
                      {income.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No income for {monthLabel}</td></tr>}
                      {income.map((i, idx) => (
                        <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50">
                          <td className="px-4 py-2.5 text-slate-600">{new Date(i.income_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</td>
                          <td className="px-4 py-2.5 text-slate-800 font-medium">{i.source}</td>
                          <td className="px-4 py-2.5 text-slate-600">{i.description || '—'}</td>
                          <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${i.category === 'invoice' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{i.category === 'invoice' ? 'Invoice' : 'Other'}</span></td>
                          <td className="px-4 py-2.5 text-right font-semibold text-emerald-600">INR {Number(i.amount).toLocaleString('en-IN')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              {/* Add Income Form */}
              <div>
                <AddIncomeForm onAdded={loadData} />
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
                    </tr>
                  </thead>
                  <tbody>
                    {team.length === 0 && <tr><td colSpan={3} className="px-4 py-8 text-center text-slate-400">No team members added</td></tr>}
                    {team.map(m => (
                      <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50">
                        <td className="px-4 py-2.5 text-slate-800 font-medium">{m.name}</td>
                        <td className="px-4 py-2.5 text-slate-600">{m.role || '—'}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">INR {Number(m.base_salary).toLocaleString('en-IN')}</td>
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
                      <button onClick={async () => { await apiFetch(`/api/finance/categories/${c.id}`, { method: 'DELETE' }); loadData(); }}
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
