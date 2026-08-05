import React, { useEffect, useState } from 'react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { SkeletonCard } from '../components/SkeletonLoader.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';

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
  { value: 'team_lead', label: 'Team Lead', description: 'Operational tools (Outreach, Intelligence, Growth OS, Ads) but no Billing/Permissions' },
  { value: 'sales', label: 'Sales', description: 'Contacts, deals, pipeline' },
  { value: 'staff', label: 'Staff', description: 'Social and basic features only' },
  { value: 'creative_assistant', label: 'Creative Assistant', description: 'Tasks, Inbox, Meta Ads, Social, Content — everything else blocked' },
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
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setSubmitting(true);
    try {
      const body = { name: name.trim(), email: email.trim().toLowerCase(), role };
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
          <h2 className="font-bold text-slate-900">Invite User</h2>
          <p className="text-xs text-slate-500 mt-0.5">They'll get an email with a link to set their own password and activate their account.</p>
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
              <option value="creative_assistant">Creative Assistant</option>
              <option value="sales">Sales</option>
              <option value="team_lead">Team Lead</option>
              <option value="manager_ops">Manager (Ops)</option>
              <option value="manager_ads">Manager (Ads)</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          {err && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting}
              className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50">
              {submitting ? 'Sending invite…' : 'Send Invite'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PermissionsPage() {
  const { showSuccess, showError } = useToast();
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
  // Removing a user revokes every permission they have, so it gets a typed-name
  // gate rather than a one-click confirm.
  const [confirmRemove, setConfirmRemove] = useState(null); // user object | null
  const [removing, setRemoving] = useState(false);
  const [removeErr, setRemoveErr] = useState(null);
  // Optional "reassign this user's records to:" picker shown inside the
  // deactivate dialog — opt-in, cleared whenever a new user is targeted.
  const [reassignTo, setReassignTo] = useState('');
  const [resendingInviteId, setResendingInviteId] = useState(null);

  function loadUsers() {
    return apiFetch('/api/permissions/users')
      .then(data => { setUsers(data?.users || []); })
      .catch(e => setError(e.message));
  }

  useEffect(() => {
    loadUsers().finally(() => setLoading(false));
  }, []);

  async function runRemoveUser() {
    setRemoving(true); setRemoveErr(null);
    try {
      const body = reassignTo ? { reassignToUserId: reassignTo } : undefined;
      const res = await apiFetch(`/api/permissions/users/${confirmRemove.id}`, {
        method: 'DELETE',
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      setUsers(prev => prev.filter(u => u.id !== confirmRemove.id));
      const r = res?.reassigned;
      const reassignSummary = r
        ? ` — reassigned ${r.contacts} contact(s), ${r.deals} deal(s), ${r.tasks} task(s)`
        : '';
      showSuccess(`${confirmRemove.name} removed from the team${reassignSummary}`);
      setConfirmRemove(null);
      setSelectedUser(null);
      setReassignTo('');
    } catch (e) {
      // Keep the dialog open — the old code dropped the user back to the
      // detail panel with only a small inline "Failed to remove user".
      setRemoveErr(e.message || 'Failed to remove user');
      showError(e.message || 'Failed to remove user');
    } finally {
      setRemoving(false);
    }
  }

  async function runResendInvite(user) {
    setResendingInviteId(user.id);
    try {
      await apiFetch(`/api/permissions/users/${user.id}/resend-invite`, { method: 'POST' });
      showSuccess(`Invite resent to ${user.email}`);
    } catch (e) {
      showError(e.message || 'Failed to resend invite');
    } finally {
      setResendingInviteId(null);
    }
  }

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
              if (payload?.emailSent === false) {
                showError(`User created, but the invite email failed to send to ${payload?.user?.email ?? 'the new user'} — use "Resend invite" on their row to retry.`);
              } else {
                showSuccess(`Invite sent to ${payload?.user?.email ?? 'the new user'}`);
              }
              loadUsers();
            }}
          />
        )}

        {loading ? (
          // Mirrors the real layout below (64-wide user list beside the detail
          // panel) so the page does not jump when the users land.
          <div className="flex gap-6">
            <div className="w-64 flex-shrink-0 space-y-2">
              {[0, 1, 2, 3, 4].map(i => <SkeletonCard key={i} />)}
            </div>
            <div className="flex-1 space-y-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        ) : error && !users.length ? (
          <div className="text-center py-16 text-red-600">{error}</div>
        ) : (
          <div className="flex gap-6">
            {/* User list */}
            <div className="w-64 flex-shrink-0">
              <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Team Members</p>
                </div>
                {users.length === 0 && (
                  <div className="p-4 text-sm text-slate-500 text-center">No users found</div>
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
                      <div className="text-xs text-slate-600 truncate">{user.email}</div>
                      {user.is_owner && (
                        <span className="text-xs font-medium text-amber-700">Owner</span>
                      )}
                      {!user.is_owner && user.pending && (
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700">
                          Invite pending
                        </span>
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
                        <p className="text-xs text-slate-500">{selectedUser.email}</p>
                      </div>
                      {isOwnerUser && (
                        <span className="ml-2 px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
                          Owner — Full Access
                        </span>
                      )}
                      {!isOwnerUser && selectedUser.pending && (
                        <span className="ml-2 px-2.5 py-1 bg-amber-100 text-amber-700 text-xs font-semibold rounded-full">
                          Invite pending
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {saved && <span className="text-sm text-green-700 font-medium">&#x2713; Saved</span>}
                      {error && <span className="text-sm text-red-600">{error}</span>}
                      {!isOwnerUser && (
                        <>
                          {selectedUser.pending && (
                            <button
                              onClick={() => runResendInvite(selectedUser)}
                              disabled={resendingInviteId === selectedUser.id}
                              className="px-3 py-2 text-sm text-sky-700 border border-sky-200 rounded-lg hover:bg-sky-50 disabled:opacity-50"
                            >
                              {resendingInviteId === selectedUser.id ? 'Resending…' : 'Resend invite'}
                            </button>
                          )}
                          <button
                            onClick={() => { setRemoveErr(null); setReassignTo(''); setConfirmRemove(selectedUser); }}
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
                        <p className="text-xs text-slate-500 mt-2">
                          Role controls which pages and API data this user can access. Changes take effect on their next login.
                        </p>
                      </div>

                      {/* Module Access — controls which sidebar sections appear */}
                      <div>
                        <div className="flex items-center gap-2 mb-3">
                          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Module Access</h3>
                          <span className="text-xs text-slate-500 font-normal normal-case tracking-normal">— unlocks sidebar sections regardless of role</span>
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
                                  className="text-sky-700 hover:underline">All on</button>
                                <span className="text-slate-500">|</span>
                                <button onClick={() => toggleAll(group, false)}
                                  className="text-slate-600 hover:underline">All off</button>
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

        <ConfirmDialog
          open={confirmRemove !== null}
          title={`Remove ${confirmRemove?.name ?? ''} from the team?`}
          impactSummary={
            <div className="space-y-2">
              <p>This will revoke all their access. They will be signed out and will no longer be able to log in to the CRM.</p>
              <div>
                <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider" htmlFor="reassign-to-picker">
                  Reassign their contacts/deals/tasks to (optional)
                </label>
                <select
                  id="reassign-to-picker"
                  value={reassignTo}
                  onChange={(e) => setReassignTo(e.target.value)}
                  className="input w-full mt-1 bg-white"
                >
                  <option value="">Leave unassigned (don't reassign)</option>
                  {users
                    .filter((u) => u.id !== confirmRemove?.id)
                    .map((u) => (
                      <option key={u.id} value={u.id}>{u.name} ({u.email})</option>
                    ))}
                </select>
              </div>
            </div>
          }
          confirmLabel="Remove from team"
          danger
          requireTypedName={confirmRemove?.name}
          loading={removing}
          error={removeErr}
          onConfirm={runRemoveUser}
          onCancel={() => { setConfirmRemove(null); setRemoveErr(null); setReassignTo(''); }}
        />
      </main>
    </div>
  );
}
