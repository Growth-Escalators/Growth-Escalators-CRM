import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';

const PERMISSION_GROUPS = [
  {
    label: 'Contacts',
    perms: [
      { key: 'contactsView', label: 'View contacts' },
      { key: 'contactsCreate', label: 'Create contacts' },
      { key: 'contactsEdit', label: 'Edit contacts' },
      { key: 'contactsDelete', label: 'Delete contacts' },
      { key: 'contactsExport', label: 'Export to CSV' },
      { key: 'contactsBulk', label: 'Bulk actions' },
    ],
  },
  {
    label: 'Pipeline',
    perms: [
      { key: 'pipelineView', label: 'View pipeline' },
      { key: 'pipelineCreate', label: 'Create deals' },
      { key: 'pipelineEdit', label: 'Edit and move deals' },
      { key: 'pipelineDelete', label: 'Delete deals' },
      { key: 'pipelineManage', label: 'Manage pipeline settings' },
    ],
  },
  {
    label: 'Billing',
    perms: [
      { key: 'billingView', label: 'View invoices' },
      { key: 'billingCreate', label: 'Create invoices' },
      { key: 'billingEdit', label: 'Edit invoices' },
      { key: 'billingMarkPaid', label: 'Mark payments received' },
      { key: 'billingViewMrr', label: 'View MRR and revenue' },
      { key: 'billingDownload', label: 'Download PDFs' },
      { key: 'billingManageClients', label: 'Manage billing clients' },
    ],
  },
  {
    label: 'Automations',
    perms: [
      { key: 'automationsView', label: 'View automations' },
      { key: 'automationsTrigger', label: 'Trigger manually' },
    ],
  },
  {
    label: 'Reports',
    perms: [
      { key: 'reportsView', label: 'View client reports' },
      { key: 'reportsMetaAds', label: 'View Meta Ads data' },
    ],
  },
  {
    label: 'Settings',
    perms: [
      { key: 'settingsUsers', label: 'Manage users and permissions' },
      { key: 'settingsPipelines', label: 'Manage pipeline settings' },
      { key: 'settingsTemplates', label: 'Manage email templates' },
      { key: 'settingsBilling', label: 'Manage billing settings' },
    ],
  },
];

const ROLE_OPTIONS = [
  { value: 'admin', label: 'Admin', description: 'Full access to everything' },
  { value: 'manager_ops', label: 'Manager — Ops', description: 'Contacts, deals, automations, reports' },
  { value: 'manager_ads', label: 'Manager — Ads', description: 'Ads and marketing only' },
  { value: 'sales', label: 'Sales', description: 'Contacts, deals, pipeline' },
  { value: 'staff', label: 'Staff', description: 'Social and basic features only' },
];

const MODULE_ACCESS = [
  {
    key: 'reportsMetaAds',
    label: 'Meta Ads',
    description: 'Can view and use the Meta Ads section',
    icon: '📊',
  },
  {
    key: 'billingView',
    label: 'Billing & Finance',
    description: 'Can access Billing, Expenses, and Funnels',
    icon: '💳',
  },
  {
    key: 'accessSocial',
    label: 'Social Posting',
    description: 'Can use the Social posting and scheduling sections',
    icon: '📱',
  },
];

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
        checked ? 'bg-sky-600' : 'bg-slate-200'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
        checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
      }`} />
    </button>
  );
}

function AddUserModal({ onClose, onCreated }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('staff');
  const [password, setPassword] = useState('');
  const [autoPassword, setAutoPassword] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setSubmitting(true);
    try {
      const body = { name: name.trim(), email: email.trim().toLowerCase(), role };
      if (!autoPassword && password) body.password = password;
      const res = await apiFetch('/api/permissions/users', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      onCreated(res);
    } catch (e) {
      setErr(e.message || 'Failed to create user');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100">
          <h2 className="font-bold text-slate-900">Add User</h2>
          <p className="text-xs text-slate-500 mt-0.5">They'll be able to change their password later via Forgot Password.</p>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Full name *</label>
            <input value={name} onChange={e => setName(e.target.value)} required
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Email *</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required
              placeholder="sneha.joshi@growthescalators.com"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Role</label>
            <select value={role} onChange={e => setRole(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-sky-500">
              <option value="staff">Staff</option>
              <option value="sales">Sales</option>
              <option value="manager_ops">Manager (Ops)</option>
              <option value="manager_ads">Manager (Ads)</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div>
            <label className="flex items-center gap-2 text-xs text-slate-700 mb-1.5">
              <input type="checkbox" checked={autoPassword} onChange={e => setAutoPassword(e.target.checked)} />
              Auto-generate temporary password
            </label>
            {!autoPassword && (
              <input type="text" value={password} onChange={e => setPassword(e.target.value)} minLength={8}
                placeholder="At least 8 characters"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500" />
            )}
          </div>
          {err && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting}
              className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create User'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CredsModal({ creds, onClose }) {
  const [copied, setCopied] = useState(false);
  function copyAll() {
    const text = `Email: ${creds.user.email}\nTemporary password: ${creds.temporaryPassword}\n\nLog in at https://crm.growthescalators.com and use "Forgot password" any time to change it.`;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }).catch(() => {});
  }
  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-emerald-100 bg-emerald-50 rounded-t-2xl">
          <h2 className="font-bold text-emerald-900">User created ✓</h2>
          <p className="text-xs text-emerald-700 mt-0.5">Copy and share these credentials securely. This password will not be shown again.</p>
        </div>
        <div className="p-6 space-y-3">
          <div className="text-sm"><span className="font-semibold text-slate-700">Name:</span> <span className="text-slate-900">{creds.user.name}</span></div>
          <div className="text-sm"><span className="font-semibold text-slate-700">Email:</span> <span className="text-slate-900 font-mono">{creds.user.email}</span></div>
          <div className="text-sm"><span className="font-semibold text-slate-700">Role:</span> <span className="text-slate-900">{creds.user.role}</span></div>
          <div className="text-sm">
            <p className="font-semibold text-slate-700 mb-1">Temporary password:</p>
            <code className="block bg-slate-100 border border-slate-200 px-3 py-2 rounded text-slate-900 font-mono text-sm break-all">
              {creds.temporaryPassword}
            </code>
          </div>
          {creds.note && <p className="text-xs text-slate-500">{creds.note}</p>}
        </div>
        <div className="px-6 pb-4 flex justify-end gap-2">
          <button onClick={copyAll}
            className="px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700">
            {copied ? 'Copied!' : 'Copy credentials'}
          </button>
          <button onClick={onClose}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm hover:bg-slate-200">Done</button>
        </div>
      </div>
    </div>
  );
}

export default function PermissionsPage() {
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState(null);
  const [perms, setPerms] = useState({});
  const [selectedRole, setSelectedRole] = useState('staff');
  const [originalRole, setOriginalRole] = useState('staff');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [showAddUser, setShowAddUser] = useState(false);
  const [createdCreds, setCreatedCreds] = useState(null); // { user, temporaryPassword }

  function loadUsers() {
    return apiFetch('/api/permissions/users')
      .then(data => { setUsers(data?.users || []); })
      .catch(e => setError(e.message));
  }

  useEffect(() => {
    loadUsers().finally(() => setLoading(false));
  }, []);

  async function selectUser(user) {
    setSelectedUser(user);
    setSaved(false);
    setError('');
    const role = user.role || 'staff';
    setSelectedRole(role);
    setOriginalRole(role);
    try {
      const data = await apiFetch(`/api/permissions/users/${user.id}`);
      setPerms(data?.permissions || {});
    } catch (e) {
      setPerms({});
    }
  }

  async function handleSave() {
    if (!selectedUser) return;
    setSaving(true); setSaved(false); setError('');
    try {
      const calls = [
        apiFetch(`/api/permissions/users/${selectedUser.id}`, {
          method: 'PUT',
          body: JSON.stringify(perms),
        }),
      ];
      if (selectedRole !== originalRole) {
        calls.push(
          apiFetch(`/api/permissions/users/${selectedUser.id}/role`, {
            method: 'PATCH',
            body: JSON.stringify({ role: selectedRole }),
          })
        );
      }
      await Promise.all(calls);
      setOriginalRole(selectedRole);
      // Update role in the sidebar list
      setUsers(prev => prev.map(u => u.id === selectedUser.id ? { ...u, role: selectedRole } : u));
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  function toggleAll(group, value) {
    const update = {};
    group.perms.forEach(p => { update[p.key] = value; });
    setPerms(p => ({ ...p, ...update }));
  }

  const isOwnerUser = perms?.isOwner === true;

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">User Permissions</h1>
            <p className="text-slate-500 mt-1 text-sm">Control what each team member can access in the CRM</p>
          </div>
          <button
            onClick={() => setShowAddUser(true)}
            className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors"
          >
            + Add User
          </button>
        </div>

        {showAddUser && (
          <AddUserModal
            onClose={() => setShowAddUser(false)}
            onCreated={(payload) => {
              setShowAddUser(false);
              setCreatedCreds(payload);
              loadUsers();
            }}
          />
        )}

        {createdCreds && (
          <CredsModal creds={createdCreds} onClose={() => setCreatedCreds(null)} />
        )}

        {loading ? (
          <div className="text-center py-16 text-slate-400">Loading…</div>
        ) : error && !users.length ? (
          <div className="text-center py-16 text-red-500">{error}</div>
        ) : (
          <div className="flex gap-6">
            {/* User list */}
            <div className="w-64 flex-shrink-0">
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Team Members</p>
                </div>
                {users.length === 0 && (
                  <div className="p-4 text-sm text-slate-400 text-center">No users found</div>
                )}
                {users.map(user => (
                  <button
                    key={user.id}
                    onClick={() => selectUser(user)}
                    className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-slate-50 last:border-0 ${
                      selectedUser?.id === user.id ? 'bg-sky-50 border-l-2 border-l-sky-600' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${
                      user.is_owner ? 'bg-amber-500' : 'bg-slate-500'
                    }`}>
                      {(user.name || 'U')[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">{user.name}</div>
                      <div className="text-xs text-slate-400 truncate">{user.email}</div>
                      {user.is_owner && (
                        <span className="text-xs font-medium text-amber-600">Owner</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Permissions editor */}
            <div className="flex-1">
              {!selectedUser ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                    <svg className="w-6 h-6 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <p className="text-slate-500 text-sm">Select a team member to manage their permissions</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-slate-200">
                  <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
                    <div className="flex items-center gap-3">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white ${
                        isOwnerUser ? 'bg-amber-500' : 'bg-slate-500'
                      }`}>
                        {(selectedUser.name || 'U')[0].toUpperCase()}
                      </div>
                      <div>
                        <p className="font-semibold text-slate-900">{selectedUser.name}</p>
                        <p className="text-xs text-slate-400">{selectedUser.email}</p>
                      </div>
                      {isOwnerUser && (
                        <span className="ml-2 px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
                          Owner — Full Access
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {saved && <span className="text-sm text-green-600 font-medium">&#x2713; Saved</span>}
                      {error && <span className="text-sm text-red-500">{error}</span>}
                      {!isOwnerUser && (
                        <>
                          <button
                            onClick={async () => {
                              if (!confirm(`Remove ${selectedUser.name} from the team? This will revoke all their access.`)) return;
                              try {
                                await apiFetch(`/api/permissions/users/${selectedUser.id}`, { method: 'DELETE' });
                                setUsers(prev => prev.filter(u => u.id !== selectedUser.id));
                                setSelectedUser(null);
                              } catch { setError('Failed to remove user'); }
                            }}
                            className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                          >
                            Remove
                          </button>
                          <button onClick={handleSave} disabled={saving}
                            className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50">
                            {saving ? 'Saving…' : 'Save Permissions'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {isOwnerUser ? (
                    <div className="p-8 text-center">
                      <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-3">
                        <svg className="w-8 h-8 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
                        </svg>
                      </div>
                      <p className="text-slate-700 font-medium">Owner Account</p>
                      <p className="text-slate-500 text-sm mt-1">This user has full access to all features. Owner permissions cannot be edited.</p>
                    </div>
                  ) : (
                    <div className="p-6 space-y-6">
                      {/* Role selector */}
                      <div className="p-4 rounded-lg bg-slate-50 border border-slate-200">
                        <div className="flex items-center gap-4">
                          <div className="flex-1">
                            <label className="block text-sm font-semibold text-slate-700 mb-1">Role</label>
                            <select
                              value={selectedRole}
                              onChange={e => setSelectedRole(e.target.value)}
                              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                            >
                              {ROLE_OPTIONS.map(r => (
                                <option key={r.value} value={r.value}>{r.label} — {r.description}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <p className="text-xs text-slate-400 mt-2">
                          Role controls which pages and API data this user can access. Changes take effect on their next login.
                        </p>
                      </div>

                      {/* Module Access — controls which sidebar sections appear */}
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Module Access</h3>
                          <span className="text-xs text-slate-400 font-normal normal-case tracking-normal">— unlocks sidebar sections regardless of role</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {MODULE_ACCESS.map(mod => (
                            <label key={mod.key} className={`flex flex-col gap-2 p-4 rounded-xl border-2 cursor-pointer transition-all ${
                              perms[mod.key] ? 'border-sky-500 bg-sky-50' : 'border-slate-200 bg-white hover:border-slate-300'
                            }`}>
                              <div className="flex items-center justify-between">
                                <span className="text-xl">{mod.icon}</span>
                                <Toggle
                                  checked={!!perms[mod.key]}
                                  onChange={val => setPerms(prev => ({ ...prev, [mod.key]: val }))}
                                />
                              </div>
                              <div>
                                <p className="text-sm font-semibold text-slate-800">{mod.label}</p>
                                <p className="text-xs text-slate-500 mt-0.5">{mod.description}</p>
                              </div>
                            </label>
                          ))}
                        </div>
                      </div>

                      <hr className="border-slate-100" />

                      {/* Granular permission toggles */}
                      {PERMISSION_GROUPS.map(group => {
                        const allOn = group.perms.every(p => perms[p.key]);
                        return (
                          <div key={group.label}>
                            <div className="flex items-center justify-between mb-3">
                              <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">{group.label}</h3>
                              <div className="flex items-center gap-2 text-xs">
                                <button onClick={() => toggleAll(group, true)}
                                  className="text-sky-600 hover:underline">All on</button>
                                <span className="text-slate-300">|</span>
                                <button onClick={() => toggleAll(group, false)}
                                  className="text-slate-400 hover:underline">All off</button>
                              </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                              {group.perms.map(p => (
                                <label key={p.key} className="flex items-center justify-between p-3 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50 cursor-pointer">
                                  <span className="text-sm text-slate-700">{p.label}</span>
                                  <Toggle
                                    checked={!!perms[p.key]}
                                    onChange={val => setPerms(prev => ({ ...prev, [p.key]: val }))}
                                  />
                                </label>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
