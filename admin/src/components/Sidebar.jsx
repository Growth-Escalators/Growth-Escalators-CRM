import React, { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { logout, getUser, apiFetch } from '../lib/api.js';
import {
  Users, BarChart2, Zap, Mail, Receipt, Activity, Lock,
  TrendingUp, FileText, Share2, MessageSquare, Settings, Layout, MapPin
} from 'lucide-react';

export default function Sidebar() {
  const user = getUser();
  const [perms, setPerms] = useState(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    apiFetch('/api/permissions/me')
      .then(d => setPerms(d?.permissions ?? null))
      .catch(() => setPerms(null));
  }, []);

  // Poll unread count every 30 seconds
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

  const canBilling = perms?.isOwner || perms?.billingView;
  const canPermissions = perms?.isOwner;
  const canAds = perms?.isOwner || perms?.reportsMetaAds;
  const canReports = perms?.isOwner || perms?.reportsView;

  const navClass = ({ isActive }) =>
    `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
    }`;

  const subNavClass = ({ isActive }) =>
    `flex items-center gap-2 pl-9 pr-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
      isActive ? 'bg-slate-700 text-orange-400' : 'text-slate-500 hover:bg-slate-800 hover:text-slate-300'
    }`;

  return (
    <aside className="w-56 min-h-screen bg-slate-900 text-slate-300 flex flex-col">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-slate-700">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-sky-600 flex items-center justify-center text-white font-bold text-sm">
            GE
          </div>
          <div>
            <p className="text-white font-semibold text-sm leading-tight">Growth Escalators</p>
            <p className="text-slate-400 text-xs">CRM</p>
          </div>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        <NavLink to="/contacts" className={navClass}>
          <Users className="w-4 h-4" />
          Contacts
        </NavLink>

        <NavLink to="/pipeline" className={navClass}>
          <Layout className="w-4 h-4" />
          Pipeline
        </NavLink>
        <NavLink to="/pipelines/settings" className={subNavClass}>
          <Settings className="w-3.5 h-3.5" />
          Pipeline Settings
        </NavLink>

        <NavLink to="/discover" className={navClass}>
          <MapPin className="w-4 h-4" />
          Lead Discovery
        </NavLink>

        <NavLink to="/automations" className={navClass}>
          <Zap className="w-4 h-4" />
          Automations
        </NavLink>

        <NavLink to="/emails" className={navClass}>
          <Mail className="w-4 h-4" />
          Email Templates
        </NavLink>

        {canBilling && (
          <NavLink to="/billing" className={navClass}>
            <Receipt className="w-4 h-4" />
            Billing
          </NavLink>
        )}

        {/* Meta Ads */}
        {canAds && (
          <NavLink to="/ads" className={navClass}>
            <BarChart2 className="w-4 h-4" />
            Meta Ads
          </NavLink>
        )}

        {/* Reports */}
        {canReports && (
          <NavLink to="/reports" className={navClass}>
            <FileText className="w-4 h-4" />
            Reports
          </NavLink>
        )}

        {/* Social */}
        <NavLink to="/social" className={navClass}>
          <Share2 className="w-4 h-4" />
          Social
        </NavLink>

        {/* Inbox with unread badge */}
        <NavLink to="/inbox" className={({ isActive }) =>
          `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
            isActive ? 'bg-sky-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
          }`
        }>
          <MessageSquare className="w-4 h-4" />
          <span className="flex-1">Inbox</span>
          {unreadCount > 0 && (
            <span className="bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-5 text-center font-semibold">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </NavLink>

        <NavLink to="/health" className={navClass}>
          <Activity className="w-4 h-4" />
          System Health
        </NavLink>

        {canPermissions && (
          <NavLink to="/settings/permissions" className={subNavClass}>
            <Lock className="w-3.5 h-3.5" />
            Permissions
          </NavLink>
        )}
      </nav>

      {/* User + logout */}
      <div className="px-4 py-4 border-t border-slate-700">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-xs font-bold text-white uppercase">
            {user?.name?.[0] ?? '?'}
          </div>
          <div className="min-w-0">
            <p className="text-white text-sm font-medium truncate">{user?.name ?? 'User'}</p>
            <p className="text-slate-400 text-xs truncate">{user?.email ?? ''}</p>
          </div>
        </div>
        <button
          onClick={logout}
          className="w-full text-left text-xs text-slate-400 hover:text-white transition-colors px-1"
        >
          Sign out →
        </button>
      </div>
    </aside>
  );
}
