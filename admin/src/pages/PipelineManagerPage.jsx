import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Sidebar from '../components/Sidebar.jsx';
import { apiFetch } from '../lib/api.js';
import { createPipelineStageFromName, normalizePipelineStages, serializePipelineStages } from '../lib/pipelineStages.js';
import { safeLower } from '../lib/safe.js';

const COLORS = [
  { hex: '#F97316', label: 'Orange' },
  { hex: '#22C55E', label: 'Green' },
  { hex: '#3B82F6', label: 'Blue' },
  { hex: '#A855F7', label: 'Purple' },
  { hex: '#EC4899', label: 'Pink' },
  { hex: '#14B8A6', label: 'Teal' },
  { hex: '#94A3B8', label: 'Gray' },
];

const DEFAULT_STAGES = serializePipelineStages(['New Lead', 'Contacted', 'Proposal Sent', 'Won', 'Lost']);

function getStageType(stage) {
  if (stage?.outcome === 'won') return 'won';
  if (stage?.outcome === 'lost') return 'lost';
  if (stage?.outcome === 'abandoned') return 'abandoned';
  return 'active';
}

function StageBadge({ type }) {
  if (type === 'won') return <span className="text-xs px-1.5 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">won</span>;
  if (type === 'lost') return <span className="text-xs px-1.5 py-0.5 rounded-full bg-red-100 text-red-600 font-medium">lost</span>;
  if (type === 'abandoned') return <span className="text-xs px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">abandoned</span>;
  return <span className="text-xs px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500 font-medium">active</span>;
}

function ColorPicker({ value, onChange }) {
  return (
    <div className="flex gap-2 flex-wrap">
      {COLORS.map((c) => (
        <button
          key={c.hex}
          onClick={() => onChange(c.hex)}
          className={`w-7 h-7 rounded-full transition-all ${value === c.hex ? 'ring-2 ring-offset-2 ring-slate-700 scale-110' : 'hover:scale-105'}`}
          style={{ background: c.hex }}
          title={c.label}
        />
      ))}
    </div>
  );
}

function StageConfigModal({ stageId, stageName, currentConfig, emailTemplates, onSave, onClose }) {
  const [probability, setProbability] = useState(currentConfig?.probability ?? '');
  const [emailTemplateId, setEmailTemplateId] = useState(currentConfig?.automation?.sendEmailTemplateId ?? '');
  const [taskTitle, setTaskTitle] = useState(currentConfig?.automation?.createTask?.title ?? '');
  const [taskDays, setTaskDays] = useState(currentConfig?.automation?.createTask?.dueInDays ?? 3);
  const [saving, setSaving] = useState(false);

  async function handleSave() {
    setSaving(true);
    const cfg = {};
    if (probability !== '') cfg.probability = Number(probability);
    const automation = {};
    if (emailTemplateId) automation.sendEmailTemplateId = emailTemplateId;
    if (taskTitle.trim()) automation.createTask = { title: taskTitle.trim(), dueInDays: Number(taskDays) };
    if (Object.keys(automation).length > 0) cfg.automation = automation;
    await onSave(stageId, cfg);
    setSaving(false);
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="px-6 pt-6 pb-4 border-b border-slate-100">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-slate-900">Stage Settings</h2>
              <p className="text-sm text-slate-400 mt-0.5">{stageName}</p>
            </div>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">
              Default Probability (%) <span className="text-slate-400 font-normal">— auto-set when deal enters this stage</span>
            </label>
            <input type="number" min="0" max="100" value={probability} onChange={e => setProbability(e.target.value)}
              placeholder="Leave blank for no default"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Auto-send Email Template</label>
            <select value={emailTemplateId} onChange={e => setEmailTemplateId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">None</option>
              {emailTemplates.map(t => (
                <option key={t.id} value={t.id}>{t.name || t.subject}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Auto-create ClickUp Task</label>
            <input type="text" value={taskTitle} onChange={e => setTaskTitle(e.target.value)}
              placeholder="Task title (leave blank for none)"
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2" />
            {taskTitle && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">Due in</span>
                <input type="number" min="1" value={taskDays} onChange={e => setTaskDays(e.target.value)}
                  className="w-16 border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="text-sm text-slate-500">days</span>
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-100 bg-slate-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-white">Cancel</button>
          <button onClick={handleSave} disabled={saving}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50">
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}

function StageList({ stages, onChange, stageConfigs, onOpenStageConfig }) {
  const [editingIdx, setEditingIdx] = useState(null);
  const [editVal, setEditVal] = useState('');
  const [newStage, setNewStage] = useState('');
  const dragIdx = useRef(null);
  const dragOverIdx = useRef(null);

  function startEdit(idx) {
    setEditingIdx(idx);
    setEditVal(stages[idx]?.name ?? '');
  }

  function commitEdit(idx) {
    if (editVal.trim()) {
      const next = [...stages];
      next[idx] = { ...next[idx], name: editVal.trim() };
      onChange(next);
    }
    setEditingIdx(null);
    setEditVal('');
  }

  function removeStage(idx) {
    if (stages.length <= 2) return;
    onChange(stages.filter((_, i) => i !== idx));
  }

  function addStage() {
    if (!newStage.trim()) return;
    const usedIds = new Set(stages.map((stage) => safeLower(stage.id)));
    const created = createPipelineStageFromName(newStage, usedIds, stages.length);
    if (created) onChange([...stages, created]);
    setNewStage('');
  }

  function onDragStart(idx) { dragIdx.current = idx; }
  function onDragOver(e, idx) { e.preventDefault(); dragOverIdx.current = idx; }
  function onDrop() {
    const from = dragIdx.current;
    const to = dragOverIdx.current;
    if (from === null || to === null || from === to) return;
    const next = [...stages];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    onChange(next);
    dragIdx.current = null;
    dragOverIdx.current = null;
  }

  return (
    <div>
      <div className="space-y-1.5 mb-3">
        {stages.map((stage, idx) => {
          const type = getStageType(stage);
          return (
            <div
              key={idx}
              draggable
              onDragStart={() => onDragStart(idx)}
              onDragOver={(e) => onDragOver(e, idx)}
              onDrop={onDrop}
              className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2 cursor-grab active:cursor-grabbing hover:border-slate-300 transition-colors"
            >
              <span className="text-slate-300 cursor-grab text-sm select-none">⠿</span>
              {editingIdx === idx ? (
                <input
                  autoFocus
                  value={editVal}
                  onChange={(e) => setEditVal(e.target.value)}
                  onBlur={() => commitEdit(idx)}
                  onKeyDown={(e) => { if (e.key === 'Enter') commitEdit(idx); if (e.key === 'Escape') { setEditingIdx(null); } }}
                  className="flex-1 text-sm border-none outline-none bg-transparent font-medium text-slate-800"
                />
              ) : (
                <span
                  className="flex-1 text-sm font-medium text-slate-800 cursor-text flex items-center gap-1"
                  onDoubleClick={() => startEdit(idx)}
                  onClick={() => startEdit(idx)}
                >
                  {stage.name}
                  {stageConfigs?.[stage.id]?.probability !== undefined && (
                    <span className="text-[10px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded font-medium ml-1.5">
                      {stageConfigs[stage.id].probability}%
                    </span>
                  )}
                </span>
              )}
              <StageBadge type={type} />
              {onOpenStageConfig && (
                <button
                  onClick={() => onOpenStageConfig(stage)}
                  title="Stage settings"
                  className="p-1.5 text-slate-300 hover:text-slate-500 hover:bg-slate-100 rounded-lg transition-colors"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"/>
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/>
                  </svg>
                </button>
              )}
              <button
                onClick={() => removeStage(idx)}
                disabled={stages.length <= 2}
                className="text-slate-300 hover:text-red-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors ml-1 text-xs font-bold"
                title="Remove stage"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      <div className="flex gap-2">
        <input
          type="text"
          value={newStage}
          onChange={(e) => setNewStage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && addStage()}
          placeholder="Stage name..."
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
        />
        <button
          onClick={addStage}
          disabled={!newStage.trim()}
          className="px-4 py-2 text-sm font-medium text-white bg-orange-500 rounded-lg hover:bg-orange-600 disabled:opacity-50 transition-colors"
        >
          + Add
        </button>
      </div>
    </div>
  );
}

function KanbanPreview({ stages, color }) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-2">
      {stages.map((stage, i) => {
        const type = getStageType(stage);
        const bg = type === 'won' ? '#dcfce7' : type === 'lost' ? '#fee2e2' : '#f8fafc';
        const headerBg = type === 'won' ? '#16a34a' : type === 'lost' ? '#dc2626' : (stage.color ?? color ?? '#94A3B8');
        return (
          <div
            key={i}
            className="shrink-0 rounded-lg overflow-hidden border border-slate-200"
            style={{ width: 100, background: bg }}
          >
            <div className="px-2 py-1.5 text-white text-[10px] font-semibold truncate" style={{ background: headerBg }}>
              {stage.name}
            </div>
            <div className="p-1.5 space-y-1">
              {[1, 2].map((n) => (
                <div key={n} className="h-4 bg-white rounded border border-slate-100 opacity-70" />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Pipeline editor panel
function PipelineEditor({ pipeline, onSaved, onCancel, stageConfigs, onOpenStageConfig }) {
  const [name, setName] = useState(pipeline.name);
  const [color, setColor] = useState(pipeline.color ?? '#F97316');
  const initialStages = serializePipelineStages(pipeline.normalizedStages || pipeline.stages);
  const [stages, setStages] = useState(initialStages);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setName(pipeline.name);
    setColor(pipeline.color ?? '#F97316');
    setStages(serializePipelineStages(pipeline.normalizedStages || pipeline.stages));
    setError('');
  }, [pipeline.id]);

  async function handleSave() {
    if (!name.trim()) { setError('Pipeline name is required'); return; }
    const payloadStages = serializePipelineStages(stages);
    if (payloadStages.length < 1) { setError('At least one stage is required'); return; }
    setSaving(true);
    setError('');
    const result = await apiFetch(`/api/pipelines/${pipeline.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: name.trim(), stages: payloadStages, color }),
    });
    setSaving(false);
    if (result?.id) {
      onSaved(result);
    } else {
      setError('Failed to save. Please try again.');
    }
  }

  const hasChanges = name !== pipeline.name || color !== (pipeline.color ?? '#F97316') || JSON.stringify(serializePipelineStages(stages)) !== JSON.stringify(serializePipelineStages(pipeline.normalizedStages || pipeline.stages));

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
        {/* Basic Info */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Basic Info</h3>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Pipeline Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">Color</label>
              <ColorPicker value={color} onChange={setColor} />
            </div>
          </div>
        </div>

        <div className="border-t border-slate-100" />

        {/* Stages */}
        <div>
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-700">Stages</h3>
            <p className="text-xs text-slate-400 mt-0.5">Drag to reorder. Terminal behavior is preserved with each stage.</p>
          </div>
          <StageList stages={stages} onChange={setStages} stageConfigs={stageConfigs} onOpenStageConfig={onOpenStageConfig} />
        </div>

        <div className="border-t border-slate-100" />

        {/* Preview */}
        <div>
          <h3 className="text-sm font-semibold text-slate-700 mb-3">Preview</h3>
          <KanbanPreview stages={stages} color={color} />
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>
        )}
      </div>

      {/* Footer */}
      <div className="shrink-0 border-t border-slate-100 bg-white px-6 py-4 flex items-center justify-end gap-3">
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !hasChanges}
          className="px-5 py-2 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {saving && (
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
          )}
          Save Pipeline
        </button>
      </div>
    </div>
  );
}

// New Pipeline Modal
function NewPipelineModal({ onCreated, onClose }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState('#F97316');
  const [stages, setStages] = useState(DEFAULT_STAGES);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function handleCreate() {
    if (!name.trim()) { setError('Pipeline name is required'); return; }
    setSaving(true);
    setError('');
    const slug = safeLower(name).trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Date.now();
    const result = await apiFetch('/api/pipelines', {
      method: 'POST',
      body: JSON.stringify({ name: name.trim(), slug, stages: serializePipelineStages(stages), color }),
    });
    setSaving(false);
    if (result?.id) {
      onCreated(result);
    } else {
      setError(result?.error ?? 'Failed to create pipeline');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100 shrink-0">
          <h2 className="text-lg font-bold text-slate-900">New Pipeline</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12"/>
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Pipeline Name <span className="text-red-500">*</span></label>
            <input
              autoFocus
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="e.g. Enterprise Sales, Healthcare Leads..."
              className="w-full border border-slate-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Color</label>
            <ColorPicker value={color} onChange={setColor} />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Initial Stages</label>
            <StageList stages={stages} onChange={setStages} />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-3">{error}</p>
          )}
        </div>
        <div className="shrink-0 border-t border-slate-100 px-6 py-4 flex items-center justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={saving || !name.trim()}
            className="px-5 py-2 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-lg disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {saving && <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/></svg>}
            Create Pipeline
          </button>
        </div>
      </div>
    </div>
  );
}

// Delete confirmation modal
function DeleteModal({ pipeline, onConfirm, onCancel }) {
  const [deleting, setDeleting] = useState(false);
  async function handleDelete() {
    setDeleting(true);
    await onConfirm();
    setDeleting(false);
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mb-4">
          <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
        </div>
        <h2 className="text-lg font-bold text-slate-900 mb-1">Delete "{pipeline.name}"?</h2>
        <p className="text-sm text-slate-500 mb-6">This action cannot be undone. All stage configuration will be lost.</p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 border border-slate-200 rounded-xl hover:bg-slate-50">
            Cancel
          </button>
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="flex-1 px-4 py-2.5 text-sm font-semibold text-white bg-red-600 hover:bg-red-700 rounded-xl disabled:opacity-50"
          >
            {deleting ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PipelineManagerPage() {
  const [pipelinesList, setPipelinesList] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showNewModal, setShowNewModal] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [toast, setToast] = useState(null);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [stageConfigModal, setStageConfigModal] = useState(null); // { stageId, stageName, pipelineId }
  const [stageConfigs, setStageConfigs] = useState({}); // { [stageId]: { probability, automation } }
  const [emailTemplates, setEmailTemplates] = useState([]);
  const dragPipeline = useRef(null);
  const dragOverPipeline = useRef(null);

  function showToast(msg, type = 'success') {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  }

  const load = useCallback(async () => {
    setLoading(true);
    const data = await apiFetch('/api/pipelines');
    if (Array.isArray(data)) {
      setPipelinesList(data);
      if (!selectedId && data.length > 0) setSelectedId(data[0].id);
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  // Load stage configs and email templates when selected pipeline changes
  useEffect(() => {
    if (!selectedId) return;
    Promise.all([
      apiFetch(`/api/pipelines/${selectedId}/stage-config`),
      apiFetch('/api/email-templates?limit=50'),
    ]).then(([cfg, templates]) => {
      setStageConfigs(cfg ?? {});
      setEmailTemplates(Array.isArray(templates) ? templates : (templates?.templates ?? []));
    }).catch(() => {});
  }, [selectedId]);

  // Close menus on outside click
  useEffect(() => {
    function handler() { setOpenMenuId(null); }
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, []);

  const selectedPipeline = pipelinesList.find((p) => p.id === selectedId);

  async function handleDuplicate(pipeline) {
    const result = await apiFetch(`/api/pipelines/duplicate/${pipeline.id}`, { method: 'POST' });
    if (result?.id) {
      setPipelinesList((prev) => [...prev, result]);
      setSelectedId(result.id);
      showToast(`"${result.name}" created`);
    }
  }

  async function handleDelete(pipeline) {
    const result = await apiFetch(`/api/pipelines/${pipeline.id}`, { method: 'DELETE' });
    if (result?.error) {
      showToast(result.error, 'error');
      setDeleteTarget(null);
      return;
    }
    setPipelinesList((prev) => prev.filter((p) => p.id !== pipeline.id));
    if (selectedId === pipeline.id) setSelectedId(pipelinesList.find((p) => p.id !== pipeline.id)?.id ?? null);
    setDeleteTarget(null);
    showToast(`"${pipeline.name}" deleted`);
  }

  function handleSaved(updated) {
    setPipelinesList((prev) => prev.map((p) => p.id === updated.id ? { ...p, ...updated } : p));
    showToast('Pipeline saved');
  }

  function handleCreated(newPipeline) {
    setPipelinesList((prev) => [...prev, newPipeline]);
    setSelectedId(newPipeline.id);
    setShowNewModal(false);
    showToast(`"${newPipeline.name}" created`);
  }

  async function handleSaveStageConfig(stageId, cfg) {
    const newConfigs = { ...stageConfigs, [stageId]: cfg };
    if (Object.keys(cfg).length === 0) delete newConfigs[stageId];
    await apiFetch(`/api/pipelines/${selectedId}`, {
      method: 'PATCH',
      body: JSON.stringify({ stageConfig: newConfigs }),
    });
    setStageConfigs(newConfigs);
  }

  // Drag reorder pipelines list
  function onPipelineDragStart(id) { dragPipeline.current = id; }
  function onPipelineDragOver(e, id) { e.preventDefault(); dragOverPipeline.current = id; }
  async function onPipelineDrop() {
    const fromId = dragPipeline.current;
    const toId = dragOverPipeline.current;
    if (!fromId || !toId || fromId === toId) return;
    const next = [...pipelinesList];
    const fromIdx = next.findIndex((p) => p.id === fromId);
    const toIdx = next.findIndex((p) => p.id === toId);
    const [item] = next.splice(fromIdx, 1);
    next.splice(toIdx, 0, item);
    setPipelinesList(next);
    dragPipeline.current = null;
    dragOverPipeline.current = null;
    await apiFetch('/api/pipelines/reorder', {
      method: 'POST',
      body: JSON.stringify({ pipelineIds: next.map((p) => p.id) }),
    });
  }

  return (
    <div className="flex min-h-screen bg-slate-50">
      <Sidebar />
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-white border-b px-8 py-5 shrink-0">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-slate-900">Pipeline Manager</h1>
              <p className="text-sm text-slate-400 mt-0.5">Create and manage your sales pipelines and stages</p>
            </div>
            <button
              onClick={() => setShowNewModal(true)}
              className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-orange-500 hover:bg-orange-600 rounded-xl transition-colors shadow-sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4"/>
              </svg>
              New Pipeline
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left panel — pipeline list */}
          <div className="w-80 shrink-0 border-r border-slate-100 bg-white flex flex-col">
            <div className="px-4 py-3 border-b border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide">
                {pipelinesList.length} Pipeline{pipelinesList.length !== 1 ? 's' : ''}
              </p>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {loading ? (
                <div className="space-y-2 p-2">
                  {[1,2,3].map((n) => (
                    <div key={n} className="h-16 bg-slate-100 rounded-xl animate-pulse"/>
                  ))}
                </div>
              ) : pipelinesList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                  <p className="text-sm text-slate-400">No pipelines yet</p>
                  <button onClick={() => setShowNewModal(true)} className="text-sm text-orange-500 font-medium mt-2">
                    + Create your first pipeline
                  </button>
                </div>
              ) : (
                pipelinesList.map((p) => (
                  <div
                    key={p.id}
                    draggable
                    onDragStart={() => onPipelineDragStart(p.id)}
                    onDragOver={(e) => onPipelineDragOver(e, p.id)}
                    onDrop={onPipelineDrop}
                    onClick={() => setSelectedId(p.id)}
                    className={`relative flex items-center gap-3 rounded-xl px-3 py-3 cursor-pointer transition-all group ${
                      selectedId === p.id
                        ? 'bg-orange-50 border-l-4 border-orange-500'
                        : 'hover:bg-slate-50 border-l-4 border-transparent'
                    }`}
                  >
                    <div
                      className="w-3 h-3 rounded-full shrink-0"
                      style={{ background: p.color ?? '#94A3B8' }}
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{p.name}</p>
                      <p className="text-xs text-slate-400">
                        {normalizePipelineStages(p.normalizedStages || p.stages).length} stages
                        {p.dealCount > 0 && ` · ${p.dealCount} deals`}
                      </p>
                    </div>
                    {/* Three-dot menu */}
                    <div className="relative" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === p.id ? null : p.id); }}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/>
                        </svg>
                      </button>
                      {openMenuId === p.id && (
                        <div className="absolute right-0 top-8 z-20 bg-white border border-slate-200 rounded-xl shadow-lg py-1 min-w-[140px]">
                          <button
                            onClick={() => { setSelectedId(p.id); setOpenMenuId(null); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => { handleDuplicate(p); setOpenMenuId(null); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50"
                          >
                            Duplicate
                          </button>
                          <div className="border-t border-slate-100 my-1"/>
                          <button
                            onClick={() => { setDeleteTarget(p); setOpenMenuId(null); }}
                            className="w-full text-left px-4 py-2.5 text-sm text-red-600 hover:bg-red-50"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right panel — editor */}
          <div className="flex-1 overflow-hidden">
            {selectedPipeline ? (
              <PipelineEditor
                key={selectedPipeline.id}
                pipeline={selectedPipeline}
                onSaved={handleSaved}
                onCancel={() => {}}
                stageConfigs={stageConfigs}
                onOpenStageConfig={(stage) => setStageConfigModal({ stageId: stage.id, stageName: stage.name, pipelineId: selectedId })}
              />
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-8">
                <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7"/>
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-slate-700 mb-1">Select a pipeline to edit</h3>
                <p className="text-sm text-slate-400">or create a new one to get started</p>
                <button
                  onClick={() => setShowNewModal(true)}
                  className="mt-4 px-4 py-2 text-sm font-medium text-orange-600 border border-orange-200 rounded-xl hover:bg-orange-50"
                >
                  + New Pipeline
                </button>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Modals */}
      {showNewModal && <NewPipelineModal onCreated={handleCreated} onClose={() => setShowNewModal(false)} />}
      {deleteTarget && (
        <DeleteModal
          pipeline={deleteTarget}
          onConfirm={() => handleDelete(deleteTarget)}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
      {stageConfigModal && (
        <StageConfigModal
          stageId={stageConfigModal.stageId}
          stageName={stageConfigModal.stageName}
          currentConfig={stageConfigs[stageConfigModal.stageId] ?? {}}
          emailTemplates={emailTemplates}
          onSave={handleSaveStageConfig}
          onClose={() => setStageConfigModal(null)}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-6 right-6 z-50 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all ${
          toast.type === 'error' ? 'bg-red-600' : 'bg-slate-800'
        }`}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
