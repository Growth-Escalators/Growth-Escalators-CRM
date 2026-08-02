import React, { useState } from 'react';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import GlobalSearch from './GlobalSearch.jsx';

/**
 * AppLayout — shared shell for all admin pages.
 * Renders the Fluent acrylic sidebar, sticky top bar, and global search.
 * Wizmatch pages (and any other standalone pages) should be wrapped in this
 * so they appear inside the app chrome instead of bare.
 *
 * ToastProvider is NOT here — it moved up to App.jsx around <Routes>. It used
 * to be mounted here, which meant the 27 pages that render their own bare
 * <Sidebar/> instead of AppLayout had no toast host at all, and every
 * showSuccess/showError on those pages silently did nothing.
 *
 * ── skip link ───────────────────────────────────────────────────────────────
 * The first 10 Tab stops on every page are sidebar nav links, so reaching the
 * content by keyboard took 11+ presses. The skip link below is the first
 * focusable element in the DOM and jumps straight to <main>. It is visually
 * hidden until focused (Tailwind `sr-only` / `focus:not-sr-only` — core
 * utilities, no plugin needed), so nothing changes for mouse users.
 * NOTE: only the Wizmatch routes render AppLayout; the 25 CRM pages that
 * render their own bare <Sidebar/> + <main> (see above) still have no skip
 * link — unifying those shells is a separate change.
 */
export default function AppLayout({ children }) {
  const [searchOpen, setSearchOpen] = useState(false);

  // preventDefault + explicit focus rather than letting the browser follow the
  // fragment: this keeps `#main-content` out of the router's location.
  const skipToContent = (e) => {
    e.preventDefault();
    const main = document.getElementById('main-content');
    if (!main) return;
    main.focus();
    main.scrollIntoView();
  };

  return (
    <div className="flex h-screen bg-neutral-50">
      <a
        href="#main-content"
        onClick={skipToContent}
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50
          focus:rounded-md focus:bg-primary-600 focus:px-4 focus:py-2
          focus:text-sm focus:font-semibold focus:text-white focus:shadow-modal
          focus:outline-none focus:ring-2 focus:ring-primary-200"
      >
        Skip to main content
      </a>
      <Sidebar />
      <main
        id="main-content"
        tabIndex={-1}
        className="flex-1 overflow-y-auto flex flex-col focus:outline-none"
      >
        <TopBar onSearchOpen={() => setSearchOpen(true)} />
        <div className="flex-1">
          {children}
        </div>
      </main>
      {searchOpen && <GlobalSearch open={searchOpen} onClose={() => setSearchOpen(false)} />}
    </div>
  );
}