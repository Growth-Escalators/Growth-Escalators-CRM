import React from 'react';
import { Search, Bell } from 'lucide-react';
import Breadcrumbs from './Breadcrumbs.jsx';
import { getUser, logout } from '../lib/api.js';

export default function TopBar({ onSearchOpen }) {
  const user = getUser();

  return (
    <div className="sticky top-0 z-20 bg-white border-b border-slate-200 px-6 py-2.5 flex items-center gap-4">
      {/* Left: breadcrumbs */}
      <div className="flex-1 min-w-0">
        <Breadcrumbs />
      </div>

      {/* Center: search trigger */}
      <button
        onClick={onSearchOpen}
        className="flex items-center gap-2 px-3 py-1.5 bg-slate-100 rounded-lg text-sm text-slate-500 hover:bg-slate-200 transition-colors"
      >
        <Search className="w-4 h-4" />
        <span className="hidden sm:inline">Search…</span>
        <kbd className="hidden sm:inline-flex px-1.5 py-0.5 text-xs bg-white rounded border border-slate-200 font-mono ml-4">
          ⌘K
        </kbd>
      </button>

      {/* Right: user */}
      <div className="flex items-center gap-3">
        <button className="p-1.5 text-slate-400 hover:text-slate-600 rounded-lg hover:bg-slate-100 transition-colors">
          <Bell className="w-4.5 h-4.5" />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-sky-600 flex items-center justify-center text-white text-xs font-bold uppercase">
            {user?.name?.[0] || '?'}
          </div>
        </div>
      </div>
    </div>
  );
}
