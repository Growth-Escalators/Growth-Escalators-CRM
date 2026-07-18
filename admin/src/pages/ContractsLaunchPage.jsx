import Sidebar from '../components/Sidebar.jsx';
import { FileText, ExternalLink } from 'lucide-react';

// Contracts are managed directly in our self-hosted Documenso workspace
// (see docs / .ai context: "use Documenso only"). This page replaces the old
// in-CRM contracts builder with a launch hand-off. The previous ContractsPage
// component is kept on disk (dormant, no longer routed) so this is reversible
// by pointing the /contracts routes back at it.
const DOCUMENSO_URL = 'https://sign.growthescalators.com';

export default function ContractsLaunchPage() {
  return (
    <div className="flex h-screen bg-neutral-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-neutral-900">Contracts</h1>
          <p className="text-sm text-neutral-500">E-signature contracts are now managed in Documenso.</p>
        </div>

        <div className="mx-auto mt-10 max-w-xl rounded-lg border border-neutral-200 bg-white p-8 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-neutral-100">
            <FileText className="h-6 w-6 text-neutral-700" />
          </div>
          <h2 className="text-lg font-semibold text-neutral-900">Contracts are managed in Documenso</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-neutral-500">
            Create, send, and track e-signature documents in our Documenso workspace.
            You may be asked to sign in the first time.
          </p>
          <a
            href={DOCUMENSO_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-6 inline-flex items-center gap-2 rounded bg-neutral-900 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
          >
            Open Documenso
            <ExternalLink className="h-4 w-4" />
          </a>
          <p className="mt-4 text-xs text-neutral-400">{DOCUMENSO_URL.replace('https://', '')}</p>
        </div>
      </main>
    </div>
  );
}
