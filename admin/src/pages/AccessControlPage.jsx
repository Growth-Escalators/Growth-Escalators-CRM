import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Lock, Plus, X } from 'lucide-react';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch, getPermissions } from '../lib/api.js';
import ConfirmDialog from '../components/ConfirmDialog.jsx';
import { SkeletonCard, SkeletonTable, SkeletonText } from '../components/SkeletonLoader.jsx';
import { useToast } from '../components/wizmatch/Toast.jsx';

const TABS = [
  { id: 'roles', label: 'Roles' },
  { id: 'members', label: 'Members' },
  { id: 'map', label: 'Access map' },
];

function PermissionMatrix({ modules, selected, onToggle }) {
  return (
    <div className="space-y-5">
      {modules.map(mod => (
        <div key={mod.module}>
          <h4 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-2">{mod.module}</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {mod.permissions.map(p => {
              const checked = selected.has(p.key);
              return (
                <label
                  key={p.key}
                  className={`flex items-center gap-2 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    p.dangerous
                      ? `border-l-4 border-l-red-400 ${checked ? 'bg-red-50 border-red-200' : 'border-slate-100 hover:bg-red-50/60 hover:border-red-200'}`
                      : `${checked ? 'bg-sky-50 border-sky-200' : 'border-slate-100 hover:border-slate-200 hover:bg-slate-50'}`
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => onToggle(p.key)}
                    className="rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                  />
                  <span className="text-sm text-slate-700 flex-1">{p.label}</span>
                  {p.dangerous && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-red-700 bg-red-100 px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0">
                      <AlertTriangle className="w-3 h-3" /> Sensitive
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function RoleFormModal({ registry, prefill, onClose, onCreated }) {
  const [key, setKey] = useState(prefill?.key || '');
  const [name, setName] = useState(prefill?.name || '');
  const [description, setDescription] = useState(prefill?.description || '');
  const [perms, setPerms] = useState(new Set(prefill?.permissions || []));
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState('');

  function togglePerm(k) {
    setPerms(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErr('');
    setSubmitting(true);
    try {
      const body = {
        key: key.trim(),
        name: name.trim(),
        description: description.trim(),
        permissions: [...perms],
      };
      const res = await apiFetch('/api/roles', { method: 'POST', body: JSON.stringify(body) });
      onCreated(res);
    } catch (e) {
      setErr(e.message || 'Failed to create role');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-slate-100 flex-shrink-0">
          <h2 className="font-bold text-slate-900">{prefill ? 'Duplicate Role' : 'Create Role'}</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {prefill
              ? "Adjust the key, name, and permissions — it's created as a new custom role regardless of the source."
              : 'Custom roles are tenant-specific and can be edited or deleted at any time.'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto flex flex-col min-h-0">
          <div className="p-6 space-y-4 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Key *</label>
                <input
                  value={key}
                  onChange={e => setKey(e.target.value)}
                  required
                  placeholder="sales_lead_custom"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500 font-mono"
                />
                <p className="text-xs text-slate-400 mt-1">Lowercase letters, numbers, underscores only. Can't be changed later.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">Name *</label>
                <input
                  value={name}
                  onChange={e => setName(e.target.value)}
                  required
                  placeholder="Sales Lead (Custom)"
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">Description</label>
              <input
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="What this role is for"
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-2">Permissions</label>
              <PermissionMatrix modules={registry.modules || []} selected={perms} onToggle={togglePerm} />
            </div>
            {err && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{err}</p>}
          </div>
          <div className="flex gap-3 px-6 py-4 border-t border-slate-100 flex-shrink-0">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={submitting}
              className="flex-1 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create Role'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function OverridesEditor({ loading, error, draft, permissions, saving, onChange, onSave }) {
  function updateRow(idx, field, value) {
    onChange(draft.map((row, i) => (i === idx ? { ...row, [field]: value } : row)));
  }
  function removeRow(idx) {
    onChange(draft.filter((_, i) => i !== idx));
  }
  function addRow() {
    onChange([...draft, { permission: permissions[0]?.key || '', effect: 'grant' }]);
  }

  if (loading) return <SkeletonText lines={3} />;

  return (
    <div className="max-w-2xl space-y-3">
      <p className="text-xs text-slate-500">
        Standing overrides apply on top of this user's role — a grant adds a permission the role doesn't have; a revoke removes one it does.
      </p>
      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}
      {draft.length === 0 && <p className="text-sm text-slate-400 italic">No overrides.</p>}
      <div className="space-y-2">
        {draft.map((row, idx) => (
          <div key={idx} className="flex items-center gap-2">
            <select
              value={row.permission}
              onChange={e => updateRow(idx, 'permission', e.target.value)}
              className="flex-1 text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              {permissions.map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
            </select>
            <select
              value={row.effect}
              onChange={e => updateRow(idx, 'effect', e.target.value)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
            >
              <option value="grant">Grant</option>
              <option value="revoke">Revoke</option>
            </select>
            <button onClick={() => removeRow(idx)} className="p-1.5 text-slate-400 hover:text-red-600" aria-label="Remove override">
              <X className="w-4 h-4" />
            </button>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3 pt-1">
        <button onClick={addRow} className="text-xs text-sky-700 hover:underline flex items-center gap-1">
          <Plus className="w-3 h-3" /> Add override
        </button>
        <span className="flex-1" />
        <button onClick={onSave} disabled={saving}
          className="px-3 py-1.5 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50">
          {saving ? 'Saving…' : 'Save overrides'}
        </button>
      </div>
    </div>
  );
}

function moduleStatus(modulePermissions, rolePermSet) {
  const total = modulePermissions.length;
  if (total === 0) return 'none';
  const granted = modulePermissions.filter(p => rolePermSet.has(p.key)).length;
  if (granted === 0) return 'none';
  if (granted === total) return 'all';
  return 'partial';
}

export default function AccessControlPage() {
  const { showSuccess, showError } = useToast();
  // Defense-in-depth: the nav already hides this entry from non-owners
  // (navEntries.js `visible: f => f.isOwner`) and every write route 403s any
  // non-owner server-side, but a non-owner can still land here via direct
  // URL. Show a clean message instead of a wall of 403s.
  const isOwner = getPermissions()?.isOwner === true;

  const [activeTab, setActiveTab] = useState('roles');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [roles, setRoles] = useState([]);
  const [registry, setRegistry] = useState({ modules: [] });

  // Roles tab
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [roleDetail, setRoleDetail] = useState(null);
  const [roleDetailLoading, setRoleDetailLoading] = useState(false);
  const [editName, setEditName] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editPerms, setEditPerms] = useState(new Set());
  const [savingRole, setSavingRole] = useState(false);
  const [roleSaveError, setRoleSaveError] = useState('');
  const [showRoleModal, setShowRoleModal] = useState(false);
  const [rolePrefill, setRolePrefill] = useState(null);
  const [confirmDeleteRole, setConfirmDeleteRole] = useState(null);
  const [deletingRole, setDeletingRole] = useState(false);
  const [deleteRoleErr, setDeleteRoleErr] = useState(null);

  // Members tab
  const [membersLoaded, setMembersLoaded] = useState(false);
  const [membersLoading, setMembersLoading] = useState(false);
  const [members, setMembers] = useState([]);
  const [membersError, setMembersError] = useState('');
  const [expandedUserId, setExpandedUserId] = useState(null);
  const [overridesByUser, setOverridesByUser] = useState({});
  const [overridesLoading, setOverridesLoading] = useState(false);
  const [overridesDraft, setOverridesDraft] = useState([]);
  const [savingOverrides, setSavingOverrides] = useState(false);
  const [overridesError, setOverridesError] = useState('');
  const [roleChangingUserId, setRoleChangingUserId] = useState(null);

  // Access map tab
  const [mapLoaded, setMapLoaded] = useState(false);
  const [mapLoading, setMapLoading] = useState(false);
  const [mapError, setMapError] = useState('');
  const [rolePermsById, setRolePermsById] = useState({});

  const allPermissions = useMemo(() => {
    const flat = [];
    (registry.modules || []).forEach(mod => mod.permissions.forEach(p => flat.push(p)));
    return flat;
  }, [registry]);

  function loadRoles() {
    return apiFetch('/api/roles')
      .then(data => setRoles(data?.roles || []))
      .catch(e => showError(e.message || 'Failed to reload roles'));
  }

  useEffect(() => {
    if (!isOwner) { setLoading(false); return; }
    Promise.all([apiFetch('/api/roles'), apiFetch('/api/roles/registry')])
      .then(([rolesData, registryData]) => {
        setRoles(rolesData?.roles || []);
        setRegistry(registryData || { modules: [] });
      })
      .catch(e => setError(e.message || 'Failed to load access control data'))
      .finally(() => setLoading(false));
  }, [isOwner]);

  useEffect(() => {
    if (activeTab !== 'members' || membersLoaded || !isOwner) return;
    setMembersLoading(true);
    apiFetch('/api/roles/users')
      .then(data => { setMembers(data?.users || []); setMembersLoaded(true); })
      .catch(e => setMembersError(e.message || 'Failed to load members'))
      .finally(() => setMembersLoading(false));
  }, [activeTab, membersLoaded, isOwner]);

  useEffect(() => {
    if (activeTab !== 'map' || mapLoaded || !isOwner || roles.length === 0) return;
    setMapLoading(true);
    setMapError('');
    Promise.all(roles.map(r => apiFetch(`/api/roles/${r.id}`).then(d => [r.id, d?.role?.permissions || []])))
      .then(entries => {
        const map = {};
        entries.forEach(([id, perms]) => { map[id] = perms; });
        setRolePermsById(map);
        setMapLoaded(true);
      })
      .catch(e => setMapError(e.message || 'Failed to load access map'))
      .finally(() => setMapLoading(false));
  }, [activeTab, mapLoaded, isOwner, roles]);

  async function selectRole(role) {
    setSelectedRoleId(role.id);
    setRoleSaveError('');
    setRoleDetailLoading(true);
    setRoleDetail(null);
    try {
      const data = await apiFetch(`/api/roles/${role.id}`);
      const r = data?.role;
      setRoleDetail(r);
      setEditName(r?.name || '');
      setEditDescription(r?.description || '');
      setEditPerms(new Set(r?.permissions || []));
    } catch (e) {
      setRoleSaveError(e.message || 'Failed to load role');
    } finally {
      setRoleDetailLoading(false);
    }
  }

  function togglePerm(key) {
    setEditPerms(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  async function saveRole() {
    if (!roleDetail) return;
    setSavingRole(true);
    setRoleSaveError('');
    try {
      const body = {};
      if (editName.trim() !== roleDetail.name) body.name = editName.trim();
      if (editDescription.trim() !== (roleDetail.description || '')) body.description = editDescription.trim();
      const currentPerms = new Set(roleDetail.permissions || []);
      const permsChanged = currentPerms.size !== editPerms.size || [...currentPerms].some(p => !editPerms.has(p));
      if (permsChanged) body.permissions = [...editPerms];

      if (Object.keys(body).length === 0) { setSavingRole(false); return; }

      const data = await apiFetch(`/api/roles/${roleDetail.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      const updated = data?.role;
      setRoleDetail(updated);
      setEditName(updated?.name || '');
      setEditDescription(updated?.description || '');
      setEditPerms(new Set(updated?.permissions || []));
      setRoles(prev => prev.map(r => (r.id === updated.id ? { ...r, name: updated.name, description: updated.description } : r)));
      if (permsChanged) setMapLoaded(false);
      showSuccess('Role updated');
    } catch (e) {
      setRoleSaveError(e.message || 'Failed to save role');
      showError(e.message || 'Failed to save role');
    } finally {
      setSavingRole(false);
    }
  }

  function openCreateRole() {
    setRolePrefill(null);
    setShowRoleModal(true);
  }

  function openDuplicateRole() {
    if (!roleDetail) return;
    setRolePrefill({
      key: `${roleDetail.key}_copy`,
      name: `${roleDetail.name} (Copy)`,
      description: roleDetail.description || '',
      permissions: [...editPerms],
    });
    setShowRoleModal(true);
  }

  function handleRoleCreated(payload) {
    setShowRoleModal(false);
    setRolePrefill(null);
    setMapLoaded(false);
    showSuccess(`Role "${payload?.role?.name ?? ''}" created`);
    loadRoles();
  }

  async function runDeleteRole() {
    if (!confirmDeleteRole) return;
    setDeletingRole(true);
    setDeleteRoleErr(null);
    try {
      await apiFetch(`/api/roles/${confirmDeleteRole.id}`, { method: 'DELETE' });
      setRoles(prev => prev.filter(r => r.id !== confirmDeleteRole.id));
      if (selectedRoleId === confirmDeleteRole.id) {
        setSelectedRoleId(null);
        setRoleDetail(null);
      }
      setMapLoaded(false);
      showSuccess(`${confirmDeleteRole.name} deleted`);
      setConfirmDeleteRole(null);
    } catch (e) {
      setDeleteRoleErr(e.message || 'Failed to delete role');
    } finally {
      setDeletingRole(false);
    }
  }

  async function changeUserRole(userId, roleId) {
    if (!roleId) return;
    setRoleChangingUserId(userId);
    try {
      await apiFetch(`/api/roles/users/${userId}/role`, { method: 'PATCH', body: JSON.stringify({ roleId }) });
      const role = roles.find(r => r.id === roleId);
      setMembers(prev => prev.map(u => (u.id === userId ? { ...u, roleId, roleName: role?.name || null } : u)));
      showSuccess('Role updated');
    } catch (e) {
      showError(e.message || 'Failed to update role');
    } finally {
      setRoleChangingUserId(null);
    }
  }

  async function toggleOverrides(user) {
    if (expandedUserId === user.id) { setExpandedUserId(null); return; }
    setExpandedUserId(user.id);
    setOverridesError('');
    if (overridesByUser[user.id]) {
      setOverridesDraft(overridesByUser[user.id].map(o => ({ permission: o.permission, effect: o.effect })));
      return;
    }
    setOverridesLoading(true);
    try {
      const data = await apiFetch(`/api/roles/users/${user.id}/permission-overrides`);
      const list = data?.overrides || [];
      setOverridesByUser(prev => ({ ...prev, [user.id]: list }));
      setOverridesDraft(list.map(o => ({ permission: o.permission, effect: o.effect })));
    } catch (e) {
      setOverridesError(e.message || 'Failed to load overrides');
    } finally {
      setOverridesLoading(false);
    }
  }

  async function saveOverrides(userId) {
    setSavingOverrides(true);
    setOverridesError('');
    try {
      const body = { overrides: overridesDraft.filter(o => o.permission) };
      const data = await apiFetch(`/api/roles/users/${userId}/permission-overrides`, { method: 'PUT', body: JSON.stringify(body) });
      const list = data?.overrides || [];
      setOverridesByUser(prev => ({ ...prev, [userId]: list }));
      setOverridesDraft(list.map(o => ({ permission: o.permission, effect: o.effect })));
      setMembers(prev => prev.map(u => (u.id === userId ? { ...u, overrideCount: list.length } : u)));
      showSuccess('Overrides updated');
    } catch (e) {
      setOverridesError(e.message || 'Failed to save overrides');
      showError(e.message || 'Failed to save overrides');
    } finally {
      setSavingOverrides(false);
    }
  }

  if (!isOwner) {
    return (
      <div className="flex h-screen bg-slate-50">
        <Sidebar />
        <main className="flex-1 overflow-y-auto p-8">
          <div className="bg-white rounded-xl border border-slate-200 p-12 text-center max-w-lg mx-auto mt-16">
            <p className="text-slate-700 font-medium">Owner access required</p>
            <p className="text-slate-500 text-sm mt-1">Only the tenant owner can view or edit Access Control settings.</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto p-8">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Access Control</h1>
            <p className="text-slate-500 mt-1 text-sm">
              Manage the new roles &amp; permissions system — separate from the live{' '}
              <a href="/settings/permissions" className="text-sky-700 hover:underline">Permissions</a> page and not yet enforced.
            </p>
          </div>
          {activeTab === 'roles' && (
            <button
              onClick={openCreateRole}
              className="flex items-center gap-2 px-4 py-2 bg-sky-600 text-white rounded-lg text-sm font-medium hover:bg-sky-700 transition-colors flex-shrink-0"
            >
              <Plus className="w-4 h-4" /> Create role
            </button>
          )}
        </div>

        {showRoleModal && (
          <RoleFormModal
            registry={registry}
            prefill={rolePrefill}
            onClose={() => { setShowRoleModal(false); setRolePrefill(null); }}
            onCreated={handleRoleCreated}
          />
        )}

        {loading ? (
          <div className="flex gap-6">
            <div className="w-72 flex-shrink-0 space-y-2">
              {[0, 1, 2, 3].map(i => <SkeletonCard key={i} />)}
            </div>
            <div className="flex-1 space-y-3">
              <SkeletonCard />
              <SkeletonCard />
              <SkeletonCard />
            </div>
          </div>
        ) : error ? (
          <div className="text-center py-16 text-red-600">{error}</div>
        ) : (
          <>
            <div className="flex items-center gap-1 border-b border-slate-200 mb-6">
              {TABS.map(tab => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px ${
                    activeTab === tab.id ? 'border-sky-600 text-sky-700' : 'border-transparent text-slate-500 hover:text-slate-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {activeTab === 'roles' && (
              <div className="flex gap-6">
                <div className="w-72 flex-shrink-0">
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 bg-slate-50">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Roles</p>
                    </div>
                    {roles.length === 0 && (
                      <div className="p-4 text-sm text-slate-500 text-center">No roles found</div>
                    )}
                    {roles.map(role => (
                      <button
                        key={role.id}
                        onClick={() => selectRole(role)}
                        className={`w-full flex items-start gap-2 px-4 py-3 text-left transition-colors border-b border-slate-50 last:border-0 ${
                          selectedRoleId === role.id ? 'bg-sky-50 border-l-2 border-l-sky-600' : 'hover:bg-slate-50'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            {role.isSystem && <Lock className="w-3 h-3 text-slate-400 flex-shrink-0" />}
                            <span className="text-sm font-medium text-slate-800 truncate">{role.name}</span>
                          </div>
                          {role.description && <p className="text-xs text-slate-500 truncate mt-0.5">{role.description}</p>}
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                              role.isSystem ? 'bg-slate-100 text-slate-600' : 'bg-sky-100 text-sky-700'
                            }`}>
                              {role.isSystem ? 'System' : 'Custom'}
                            </span>
                            <span className="text-xs text-slate-400">
                              {role.memberCount} member{role.memberCount === 1 ? '' : 's'}
                            </span>
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex-1">
                  {!selectedRoleId ? (
                    <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
                      <p className="text-slate-500 text-sm">Select a role to view or edit its permissions</p>
                    </div>
                  ) : roleDetailLoading || !roleDetail ? (
                    <div className="space-y-3">
                      <SkeletonCard />
                      <SkeletonCard />
                    </div>
                  ) : (
                    <div className="bg-white rounded-xl border border-slate-200">
                      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          {roleDetail.isSystem && <Lock className="w-4 h-4 text-slate-400" />}
                          <div>
                            <p className="font-semibold text-slate-900">{roleDetail.name}</p>
                            <p className="text-xs text-slate-500 font-mono">{roleDetail.key}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {roleSaveError && <span className="text-sm text-red-600">{roleSaveError}</span>}
                          <button
                            onClick={openDuplicateRole}
                            className="px-3 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 flex items-center gap-1.5"
                          >
                            <Copy className="w-3.5 h-3.5" /> Duplicate
                          </button>
                          {!roleDetail.isSystem && (
                            <button
                              onClick={() => { setDeleteRoleErr(null); setConfirmDeleteRole(roleDetail); }}
                              className="px-3 py-2 text-sm text-red-600 border border-red-200 rounded-lg hover:bg-red-50"
                            >
                              Delete
                            </button>
                          )}
                          <button
                            onClick={saveRole}
                            disabled={savingRole}
                            className="px-4 py-2 text-sm bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50"
                          >
                            {savingRole ? 'Saving…' : 'Save Changes'}
                          </button>
                        </div>
                      </div>

                      <div className="p-6 space-y-5">
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Name</label>
                            <input
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-semibold text-slate-700 mb-1.5">Description</label>
                            <input
                              value={editDescription}
                              onChange={e => setEditDescription(e.target.value)}
                              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-sky-500"
                            />
                          </div>
                        </div>

                        {roleDetail.isSystem && (
                          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 flex items-center gap-1.5">
                            <Lock className="w-3.5 h-3.5 flex-shrink-0" />
                            This is a system role — its key can't change, but its permissions can be edited freely below.
                          </p>
                        )}

                        <div>
                          <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-3">Permissions</h3>
                          <PermissionMatrix modules={registry.modules || []} selected={editPerms} onToggle={togglePerm} />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {activeTab === 'members' && (
              <div>
                {membersLoading ? (
                  <SkeletonTable rows={6} cols={4} />
                ) : membersError ? (
                  <div className="text-center py-16 text-red-600">{membersError}</div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50 text-left">
                          <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Name</th>
                          <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Email</th>
                          <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Current role</th>
                          <th className="px-4 py-3 font-semibold text-slate-600 text-xs uppercase tracking-wide">Overrides</th>
                        </tr>
                      </thead>
                      <tbody>
                        {members.length === 0 && (
                          <tr><td colSpan={4} className="px-4 py-6 text-center text-slate-500">No users found</td></tr>
                        )}
                        {members.map(u => (
                          <React.Fragment key={u.id}>
                            <tr className="border-b border-slate-50 last:border-0">
                              <td className="px-4 py-3 text-slate-800">
                                {u.name}
                                {!u.isActive && <span className="ml-2 text-[10px] font-semibold text-slate-400 uppercase">Inactive</span>}
                              </td>
                              <td className="px-4 py-3 text-slate-600">{u.email}</td>
                              <td className="px-4 py-3">
                                <select
                                  value={u.roleId || ''}
                                  disabled={roleChangingUserId === u.id}
                                  onChange={e => changeUserRole(u.id, e.target.value)}
                                  className="text-sm border border-slate-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
                                >
                                  <option value="" disabled>Unassigned</option>
                                  {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                                </select>
                              </td>
                              <td className="px-4 py-3">
                                <button
                                  onClick={() => toggleOverrides(u)}
                                  className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-semibold ${
                                    u.overrideCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'
                                  }`}
                                >
                                  {u.overrideCount} override{u.overrideCount === 1 ? '' : 's'}
                                  {expandedUserId === u.id ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                </button>
                              </td>
                            </tr>
                            {expandedUserId === u.id && (
                              <tr className="border-b border-slate-50 last:border-0 bg-slate-50/60">
                                <td colSpan={4} className="px-4 py-4">
                                  <OverridesEditor
                                    loading={overridesLoading}
                                    error={overridesError}
                                    draft={overridesDraft}
                                    permissions={allPermissions}
                                    saving={savingOverrides}
                                    onChange={setOverridesDraft}
                                    onSave={() => saveOverrides(u.id)}
                                  />
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {activeTab === 'map' && (
              <div>
                {mapLoading ? (
                  <SkeletonTable rows={8} cols={Math.max(roles.length, 1) + 1} />
                ) : mapError ? (
                  <div className="text-center py-16 text-red-600">{mapError}</div>
                ) : (
                  <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
                    <table className="text-sm min-w-full">
                      <thead>
                        <tr className="border-b border-slate-100 bg-slate-50">
                          <th className="px-4 py-3 text-left font-semibold text-slate-600 text-xs uppercase tracking-wide sticky left-0 bg-slate-50">
                            Module
                          </th>
                          {roles.map(r => (
                            <th key={r.id} className="px-4 py-3 text-center font-semibold text-slate-600 text-xs uppercase tracking-wide whitespace-nowrap">
                              {r.name}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {(registry.modules || []).map(mod => (
                          <tr key={mod.module} className="border-b border-slate-50 last:border-0">
                            <td className="px-4 py-3 font-medium text-slate-800 sticky left-0 bg-white">{mod.module}</td>
                            {roles.map(r => {
                              const status = moduleStatus(mod.permissions, new Set(rolePermsById[r.id] || []));
                              return (
                                <td key={r.id} className="px-4 py-3 text-center">
                                  {status === 'all' && <Check className="w-4 h-4 text-emerald-600 inline" />}
                                  {status === 'none' && <span className="text-slate-300">—</span>}
                                  {status === 'partial' && <span className="text-amber-600 font-bold" title="Partial access">±</span>}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        <ConfirmDialog
          open={confirmDeleteRole !== null}
          title={`Delete role "${confirmDeleteRole?.name ?? ''}"?`}
          impactSummary="This permanently removes the custom role. Any members assigned to it must be reassigned first."
          confirmLabel="Delete role"
          danger
          loading={deletingRole}
          error={deleteRoleErr}
          onConfirm={runDeleteRole}
          onCancel={() => { setConfirmDeleteRole(null); setDeleteRoleErr(null); }}
        />
      </main>
    </div>
  );
}
