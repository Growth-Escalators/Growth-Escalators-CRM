import React, { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';

// Public page — mirrors LoginPage.jsx's "reset" mode (same visual shell, same
// fetch-then-navigate shape) but for the invite-by-email flow: a teammate
// lands here from the link POST /api/permissions/users emailed them (see
// src/services/userInvites.ts), sets their own password, and is redirected
// to log in. No auth required — the token in the URL IS the authorization,
// same posture as /sign/:token (SignContractPage).
export default function AcceptInvitePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setMessage('');

    if (!token) { setError('This invite link is missing its token — please use the link from your invite email.'); return; }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return; }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return; }

    setLoading(true);
    try {
      const res = await fetch('/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setError(data.error || 'Could not activate your account'); return; }
      setMessage(data.message || 'Account activated! Please log in with your new password.');
      setDone(true);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-400 text-white text-xl font-bold mb-4">
            GE
          </div>
          <h1 className="text-2xl font-bold text-slate-900">Accept Invite</h1>
          <p className="text-sm text-slate-500 mt-1">Set a password to activate your account</p>
        </div>

        {message && (
          <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-4">{message}</p>
        )}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}

        {!token && !done && (
          <p className="text-sm text-slate-600">
            This link is missing an invite token. Please use the exact link from your invite email, or ask
            whoever invited you to send a new one.
          </p>
        )}

        {done ? (
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="w-full bg-sky-700 hover:bg-sky-800 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
          >
            Go to login
          </button>
        ) : token ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Min 8 characters"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                placeholder="Re-enter password"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-sky-700 hover:bg-sky-800 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors"
            >
              {loading ? 'Activating…' : 'Activate account'}
            </button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
