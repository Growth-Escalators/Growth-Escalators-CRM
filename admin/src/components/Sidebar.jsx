import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { logout, getUser, apiFetch } from '../lib/api.js';
import {
  Users, BarChart2, Zap, Mail, Receipt, Activity, Lock, Home,
  TrendingUp, FileText, Share2, MessageSquare, Settings, Layout, MapPin,
  Shield, ClipboardList, CreditCard, Kanban
} from 'lucide-react';

const ROLE_BADGE_COLORS = {
  admin: 'bg-purple-600',
  manager_ops: 'bg-sky-500',
  manager_ads: 'bg-blue-500',
  sales: 'bg-orange-500',
  staff: 'bg-slate-500',
};

const ROLE_LABELS = {
  admin: 'Admin',
  manager_ops: 'Manager',
  manager_ads: 'Ads Mgr',
  sales: 'Sales',
  staff: 'Staff',
};

export default function Sidebar() {
  const user = getUser();
  const [unreadCount, setUnreadCount] = useState(0);
  const role = user?.role || 'staff';

  useEffect(() => {
    function fetchUnread() {
      apiFetch('/api/inbox/unread-count')
        .then(d => setUnreadCount(d?.count ?? 0))
        .catch(() => {});
    }
    fetchUnread();
    const interval = setInterval(fetchUnread, 30_000);
    return () => clearInterval(interval);
  }, []);

  // Permission checks
  const isAdmin = role === 'admin';
  const canCRM = ['admin', 'manager_ops', 'sales'].includes(role);
  const canAds = ['admin', 'manager_ads'].includes(role);
  const canReports = ['admin', 'manager_ops', 'manager_ads'].includes(role);
  const canSocial = ['admin', 'manager_ops', 'staff'].includes(role);
  const canInbox = ['admin', 'manager_ops', 'sales'].includes(role);
  const canBilling = isAdmin;
  const canHealth = ['admin', 'manager_ops', 'sales'].includes(role);
  const canSequences = ['admin', 'manager_ops', 'sales'].includes(role);
  const canAutomations = ['admin', 'manager_ops', 'sales'].includes(role);
  const canDiscovery = ['admin', 'manager_ops', 'sales'].includes(role);
  const canMarketing = ['admin', 'manager_ads'].includes(role);
  const canSEO = ['admin', 'manager_ops', 'manager_ads'].includes(role);

  const navClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
      isActive
        ? 'bg-slate-800 text-white border-l-2 border-l-emerald-400 ml-[-2px]'
        : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
    }`;

  function SectionLabel({ children }) {
    return (
      <p className="px-3 pt-5 pb-1 text-[10px] font-semibold text-slate-500 uppercase tracking-[0.12em]">
        {children}
      </p>
    );
  }

  return (
    <aside className="w-56 min-h-screen bg-slate-900 text-slate-300 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-700/60">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-sky-500 to-emerald-400 flex items-center justify-center text-white font-bold text-sm shadow-lg shadow-sky-500/20">
            GE
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">Growth Escalators</p>
            <p className="text-slate-500 text-xs">CRM</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-2 overflow-y-auto">
        {/* CRM */}
        <SectionLabel>CRM</SectionLabel>
        <NavLink to="/dashboard" className={navClass}>
          <Home className="w-4 h-4" /> Dashboard
        </NavLink>
        {canCRM && (
          <>
            <NavLink to="/contacts" className={navClass}>
              <Users className="w-4 h-4" /> Contacts
            </NavLink>
            <NavLink to="/pipeline" className={navClass}>
              <Kanban className="w-4 h-4" /> Pipeline
            </NavLink>
          </>
        )}
        {canInbox && (
          <NavLink to="/inbox" className={({ isActive }) =>
            `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150 ${
              isActive ? 'bg-slate-800 text-white border-l-2 border-l-emerald-400 ml-[-2px]' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'
            }`
          }>
            <MessageSquare className="w-4 h-4" />
            <span className="flex-1">Inbox</span>
            {unreadCount > 0 && (
              <span className="bg-emerald-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-5 text-center font-semibold leading-none">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </NavLink>
        )}
        {canDiscovery && (
          <NavLink to="/discover" className={navClass}>
            <MapPin className="w-4 h-4" /> Lead Discovery
          </NavLink>
        )}
        {canReports && (
          <NavLink to="/analytics" className={navClass}>
            <TrendingUp className="w-4 h-4" /> Analytics
          </NavLink>
        )}

        {/* Marketing */}
        {(canAds || canSocial || canMarketing || canSEO) && (
          <>
            <SectionLabel>Marketing</SectionLabel>
            {canAds && (
              <NavLink to="/ads" className={navClass}>
                <BarChart2 className="w-4 h-4" /> Meta Ads
              </NavLink>
            )}
            {canSocial && (
              <NavLink to="/social" className={navClass}>
                <Share2 className="w-4 h-4" /> Social
              </NavLink>
            )}
            {canMarketing && (
              <NavLink to="/marketing" className={navClass}>
                <TrendingUp className="w-4 h-4" /> Ad Accounts
              </NavLink>
            )}
            {canSEO && (
              <NavLink to="/seo" className={navClass}>
                <BarChart2 className="w-4 h-4" /> SEO
              </NavLink>
            )}
          </>
        )}

        {/* Operations */}
        {(canSequences || canAutomations || canReports) && (
          <>
            <SectionLabel>Operations</SectionLabel>
            {canSequences && (
              <NavLink to="/emails" className={navClass}>
                <Mail className="w-4 h-4" /> Email Templates
              </NavLink>
            )}
            {canAutomations && (
              <NavLink to="/automations" className={navClass}>
                <Zap className="w-4 h-4" /> Automations
              </NavLink>
            )}
            {canReports && (
              <NavLink to="/reports" className={navClass}>
                <FileText className="w-4 h-4" /> Reports
              </NavLink>
            )}
          </>
        )}

        {/* Finance */}
        {canBilling && (
          <>
            <SectionLabel>Finance</SectionLabel>
            <NavLink to="/billing" className={navClass}>
              <CreditCard className="w-4 h-4" /> Billing
            </NavLink>
          </>
        )}

        {/* Settings */}
        <SectionLabel>Settings</SectionLabel>
        {canHealth && (
          <NavLink to="/health" className={navClass}>
            <Activity className="w-4 h-4" /> System Health
          </NavLink>
        )}
        {isAdmin && (
          <>
            <NavLink to="/settings/permissions" className={navClass}>
              <Shield className="w-4 h-4" /> Permissions
            </NavLink>
            <NavLink to="/pipelines/settings" className={navClass}>
              <Settings className="w-4 h-4" /> Pipeline Settings
            </NavLink>
            <NavLink to="/settings/audit" className={navClass}>
              <ClipboardList className="w-4 h-4" /> Audit Log
            </NavLink>
          </>
        )}
      </nav>

      {/* User + logout */}
      <div className="px-4 py-4 border-t border-slate-700/60">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white uppercase">
            {user?.name?.[0] ?? '?'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white text-sm font-medium truncate">{user?.name ?? 'User'}</p>
            <div className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${ROLE_BADGE_COLORS[role] || ROLE_BADGE_COLORS.staff}`} />
              <span className="text-slate-500 text-xs">{ROLE_LABELS[role] || 'Staff'}</span>
            </div>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full text-left text-xs text-slate-500 hover:text-white transition-colors px-1"
        >
          Sign out
        </button>
      </div>
    </aside>
  );
}
