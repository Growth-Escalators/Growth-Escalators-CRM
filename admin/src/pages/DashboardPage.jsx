import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import TopBar from '../components/TopBar.jsx';
import GlobalSearch from '../components/GlobalSearch.jsx';
import MetricCard from '../components/MetricCard.jsx';
import { SkeletonCard } from '../components/SkeletonLoader.jsx';
import { apiFetch, getUser } from '../lib/api.js';
import { Users, TrendingUp, MessageSquare, Receipt, DollarSign, BarChart2, Calendar } from 'lucide-react';

export default function DashboardPage() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [searchOpen, setSearchOpen] = useState(false);
  const user = getUser();

  useEffect(() => {
    async function loadStats() {
      try {
        const [contactData, dealData, billingData] = await Promise.all([
          apiFetch('/contacts?limit=1').catch(() => null),
          apiFetch('/deals?limit=1').catch(() => null),
          apiFetch('/api/billing/stats').catch(() => null),
        ]);
        setStats({
          contacts: contactData?.total ?? 0,
          deals: dealData?.total ?? 0,
          billing: billingData,
        });
      } catch {}
      setLoading(false);
    }
    loadStats();
  }, []);

  useEffect(() => {
    const handler = (e) => { if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); setSearchOpen(true); } };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const ROLE_BADGE = {
    admin: 'bg-purple-100 text-purple-700',
    manager_ops: 'bg-sky-100 text-sky-700',
    manager_ads: 'bg-blue-100 text-blue-700',
    sales: 'bg-orange-100 text-orange-700',
    staff: 'bg-slate-100 text-slate-500',
  };

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />

        <div className="p-6">
          {/* Welcome */}
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900">
              Welcome back, {user?.name?.split(' ')[0] || 'there'}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <p className="text-sm text-slate-500">Growth Escalators CRM</p>
              {user?.role && (
                <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${ROLE_BADGE[user.role] || ROLE_BADGE.staff}`}>
                  {user.role.replace(/_/g, ' ')}
                </span>
              )}
            </div>
          </div>

          {/* Metric cards */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            {loading ? (
              <>
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
                <SkeletonCard />
              </>
            ) : (
              <>
                <MetricCard
                  title="Total Contacts"
                  value={stats?.contacts?.toLocaleString('en-IN') || '0'}
                  icon={Users}
                  color="text-slate-900"
                />
                <MetricCard
                  title="Active Deals"
                  value={stats?.deals?.toLocaleString('en-IN') || '0'}
                  icon={TrendingUp}
                  color="text-green-600"
                />
                <MetricCard
                  title="Monthly MRR"
                  value={stats?.billing?.mrr != null ? `₹${(stats.billing.mrr / 100).toLocaleString('en-IN')}` : '—'}
                  icon={DollarSign}
                  color="text-sky-600"
                />
                <MetricCard
                  title="Outstanding"
                  value={stats?.billing?.outstanding != null ? `₹${(stats.billing.outstanding / 100).toLocaleString('en-IN')}` : '—'}
                  icon={Receipt}
                  color="text-amber-600"
                />
              </>
            )}
          </div>

          {/* Quick links */}
          <div className="grid grid-cols-3 gap-4">
            {[
              { icon: Users, label: 'View Contacts', path: '/contacts', color: 'bg-sky-50 text-sky-600' },
              { icon: BarChart2, label: 'Meta Ads', path: '/ads', color: 'bg-green-50 text-green-600' },
              { icon: MessageSquare, label: 'Inbox', path: '/inbox', color: 'bg-purple-50 text-purple-600' },
            ].map(link => (
              <a key={link.path} href={`/crm${link.path}`}
                className="bg-white rounded-xl border border-slate-200 p-5 flex items-center gap-4 hover:border-sky-200 hover:shadow-sm transition-all">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${link.color}`}>
                  <link.icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-slate-800">{link.label}</p>
                  <p className="text-xs text-slate-400">Quick access</p>
                </div>
              </a>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
