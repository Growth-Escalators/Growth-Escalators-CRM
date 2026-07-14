import React, { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import GlobalSearch from './GlobalSearch.jsx';

/**
 * AppLayout — shared shell for all admin pages.
 * Renders the Fluent acrylic sidebar, sticky top bar, and global search.
 * Wizmatch pages (and any other standalone pages) should be wrapped in this
 * so they appear inside the app chrome instead of bare.
 */
export default function AppLayout({ children }) {
  const [searchOpen, setSearchOpen] = useState(false);

  return (
    <div className="flex h-screen bg-neutral-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto flex flex-col">
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <div className="flex-1">
          {children}
        </div>
      </main>
      {searchOpen && <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />}
    </div>
  );
}