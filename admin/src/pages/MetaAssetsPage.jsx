import React from 'react';
import Sidebar from '../components/Sidebar.jsx';
import PagePostsSection from '../../../worker-d-snippets/page-posts-section.jsx';

export default function MetaAssetsPage() {
  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-6xl mx-auto p-6">
          <header className="mb-6">
            <h1 className="text-2xl font-bold text-slate-900">Meta Assets (Page Posts only)</h1>
            <p className="text-sm text-slate-500 mt-1">
              Stub page — full Meta Assets surface is provided by Worker C. This stub renders only the Page Posts section authored by Worker D.
            </p>
          </header>
          {/* WORKER_D_PAGE_POSTS_SECTION */}
          <PagePostsSection />
        </div>
      </main>
    </div>
  );
}
