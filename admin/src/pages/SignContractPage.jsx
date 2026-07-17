import React, { useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';

// Public signing page for external signers (NO CRM login). Uses plain fetch —
// NOT apiFetch — because there is no auth token and we must not trigger the
// admin auto-logout-on-401 behaviour. The token in the URL is the authorization.
export default function SignContractPage() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, error: '', data: null });
  const [checked, setChecked] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [signingUrl, setSigningUrl] = useState('');

  const load = useCallback(async () => {
    setState({ loading: true, error: '', data: null });
    try {
      const res = await fetch(`/api/contracts/sign/${encodeURIComponent(token)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message || 'This signing link is not valid.');
      setState({ loading: false, error: '', data: body });
    } catch (e) {
      setState({ loading: false, error: e.message || 'Unable to load the document.', data: null });
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const statements = state.data?.consent?.statements || [];
  const allChecked = statements.length > 0 && statements.every((s) => checked[s.key]);

  async function submit(e) {
    e.preventDefault();
    if (!allChecked) return;
    setSubmitting(true);
    try {
      const payload = statements.reduce((acc, s) => ({ ...acc, [s.key]: true }), {});
      const res = await fetch(`/api/contracts/sign/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.error?.message || 'Could not start signing.');
      setSigningUrl(body.signingUrl);
    } catch (e2) {
      setState((s) => ({ ...s, error: e2.message }));
    } finally {
      setSubmitting(false);
    }
  }

  if (state.loading) {
    return <Centered><p className="text-neutral-500">Loading document…</p></Centered>;
  }
  if (state.error && !state.data) {
    return <Centered><div className="rounded border border-red-200 bg-red-50 px-4 py-3 text-red-700">{state.error}</div></Centered>;
  }

  // Once a signing session is created, embed the provider's signing UI.
  if (signingUrl) {
    return (
      <div className="flex h-screen flex-col bg-neutral-100">
        <header className="border-b bg-white px-6 py-3 text-sm font-medium text-neutral-700">
          Signing: {state.data.contract.title} ({state.data.contract.referenceNumber})
        </header>
        <iframe title="Sign document" src={signingUrl} className="flex-1 w-full border-0" allow="fullscreen" />
      </div>
    );
  }

  const { contract, recipient } = state.data;
  return (
    <Centered>
      <div className="w-full max-w-lg rounded-lg border border-neutral-200 bg-white p-6 shadow-sm">
        <h1 className="text-xl font-semibold text-neutral-900">{contract.title}</h1>
        <p className="mt-1 font-mono text-xs text-neutral-500">{contract.referenceNumber}</p>
        <p className="mt-3 text-sm text-neutral-600">
          Hello {recipient.name}, you have been asked to review and sign this document as
          {' '}<strong>{recipient.signingRole?.replace(/_/g, ' ')}</strong>.
        </p>

        {state.data.alreadySigned ? (
          <div className="mt-4 rounded border border-green-200 bg-green-50 px-4 py-3 text-green-700">You have already signed this document.</div>
        ) : (
          <form onSubmit={submit} className="mt-5">
            <p className="mb-2 text-sm font-medium text-neutral-700">Before signing, please confirm:</p>
            <div className="space-y-2">
              {statements.map((s) => (
                <label key={s.key} className="flex items-start gap-2 text-sm text-neutral-700">
                  <input type="checkbox" className="mt-1" checked={!!checked[s.key]} onChange={(e) => setChecked({ ...checked, [s.key]: e.target.checked })} />
                  <span>{s.text}</span>
                </label>
              ))}
            </div>
            {state.error && <div className="mt-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{state.error}</div>}
            <button type="submit" disabled={!allChecked || submitting} className="mt-5 w-full rounded bg-neutral-900 py-2.5 text-sm font-medium text-white disabled:opacity-40">
              {submitting ? 'Preparing…' : 'Agree & continue to sign'}
            </button>
            <p className="mt-3 text-xs text-neutral-400">
              This is a generic electronic-signature workflow for ordinary commercial documents. It is not a
              government-prescribed digital signature (DSC / Aadhaar eSign) and must not be used for documents
              requiring notarisation, registration, or a witnessed signature.
            </p>
          </form>
        )}
      </div>
    </Centered>
  );
}

function Centered({ children }) {
  return <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-4">{children}</div>;
}
