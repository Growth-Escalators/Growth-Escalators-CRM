import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getTenantConfig,
  getTenantSlug,
  setActiveTenantSlug,
  setAuthPermissions,
  setAuthSession,
  TENANT_OPTIONS,
} from '../lib/auth.js';

export default function LoginPage() {
  const navigate = useNavigate();
  const [tenantSlug, setTenantSlug] = useState(getTenantSlug());
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState('login'); // login | forgot | reset
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [message, setMessage] = useState('');
  const tenant = getTenantConfig(tenantSlug);

  function handleTenantChange(nextSlug) {
    setTenantSlug(nextSlug);
    setActiveTenantSlug(nextSlug);
    setError('');
    setMessage('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, tenantSlug }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Login failed'); return; }
      setAuthSession({ token: data.token, user: data.user }, tenantSlug);
      // Fetch module permissions so the sidebar can show/hide sections immediately
      try {
        const permsRes = await fetch('/api/permissions/me', {
          headers: { Authorization: `Bearer ${data.token}` },
        });
        const permsData = await permsRes.json();
        setAuthPermissions(permsData?.permissions || {}, tenantSlug);
      } catch {
        setAuthPermissions({}, tenantSlug);
      }
      navigate('/dashboard');
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  }

  async function handleForgot(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const res = await fetch('/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tenantSlug }),
      });
      const data = await res.json();
      setMessage(data.message || 'Reset code sent.');
      setMode('reset');
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }

  async function handleReset(e) {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);
    try {
      const res = await fetch('/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code: resetCode, newPassword, tenantSlug }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Reset failed'); return; }
      setMessage('Password reset! Please log in.');
      setMode('login');
      setPassword('');
    } catch {
      setError('Network error.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="bg-white rounded-2xl shadow-lg p-10 w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-gradient-to-br from-sky-500 to-emerald-400 text-white text-xl font-bold mb-4">
            {tenant.shortLabel}
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{tenant.label}</h1>
          <p className="text-sm text-slate-500 mt-1">{tenant.subtitle}</p>
        </div>

        {message && (
          <p className="text-sm text-green-600 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-4">{message}</p>
        )}
        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 mb-4">{error}</p>
        )}

        {mode === 'login' && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Product</label>
              <div className="grid grid-cols-2 gap-2">
                {TENANT_OPTIONS.map((option) => (
                  <button
                    key={option.slug}
                    type="button"
                    onClick={() => handleTenantChange(option.slug)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                      tenantSlug === option.slug
                        ? 'border-sky-500 bg-sky-50 text-sky-700'
                        : 'border-slate-200 text-slate-600 hover:border-slate-300'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@growthescalators.com"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} required
                placeholder="••••••••"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
            <button type="button" onClick={() => { setMode('forgot'); setError(''); setMessage(''); }}
              className="w-full text-sm text-sky-600 hover:text-sky-700 transition-colors">
              Forgot password?
            </button>
          </form>
        )}

        {mode === 'forgot' && (
          <form onSubmit={handleForgot} className="space-y-4">
            <p className="text-sm text-slate-600">Enter your {tenant.label} email and we'll send a reset code.</p>
            <div className="grid grid-cols-2 gap-2">
              {TENANT_OPTIONS.map((option) => (
                <button
                  key={option.slug}
                  type="button"
                  onClick={() => handleTenantChange(option.slug)}
                  className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                    tenantSlug === option.slug
                      ? 'border-sky-500 bg-sky-50 text-sky-700'
                      : 'border-slate-200 text-slate-600 hover:border-slate-300'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
                placeholder="you@growthescalators.com"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
              {loading ? 'Sending…' : 'Send Reset Code'}
            </button>
            <button type="button" onClick={() => { setMode('login'); setError(''); setMessage(''); }}
              className="w-full text-sm text-slate-500 hover:text-slate-700">
              Back to login
            </button>
          </form>
        )}

        {mode === 'reset' && (
          <form onSubmit={handleReset} className="space-y-4">
            <p className="text-sm text-slate-600">Enter the 6-digit code sent to your email and a new password.</p>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Reset Code</label>
              <input type="text" value={resetCode} onChange={e => setResetCode(e.target.value)} required
                placeholder="123456" maxLength={6}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">New Password</label>
              <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required
                placeholder="Min 8 characters" minLength={8}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-sky-600 hover:bg-sky-700 disabled:opacity-50 text-white font-semibold rounded-lg px-4 py-2.5 text-sm transition-colors">
              {loading ? 'Resetting…' : 'Reset Password'}
            </button>
            <button type="button" onClick={() => { setMode('login'); setError(''); setMessage(''); }}
              className="w-full text-sm text-slate-500 hover:text-slate-700">
              Back to login
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
