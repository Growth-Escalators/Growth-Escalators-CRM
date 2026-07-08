import { safeText } from './safe.js';

export function slugifyPipelineStageId(value, fallback) {
  const slug = safeText(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || fallback;
}

function cleanOutcome(value) {
  return value === 'open' || value === 'won' || value === 'lost' || value === 'abandoned' ? value : null;
}

export function inferPipelineStageOutcome(name, id) {
  const stageName = safeText(name).trim();
  const stageId = safeText(id).trim();
  const nameKey = stageName.toLowerCase();
  const idKey = stageId.toLowerCase();

  if (nameKey === 'ended' || idKey === 'ended') return 'won';
  if (nameKey.includes('won')) return 'won';
  if (nameKey.includes('abandoned')) return 'abandoned';
  if (nameKey.includes('lost')) return 'lost';
  return 'open';
}

export function normalizePipelineStage(stage, index = 0) {
  if (typeof stage === 'string') {
    const name = stage.trim();
    return name ? { id: name, name, color: null, outcome: inferPipelineStageOutcome(name, name), raw: stage } : null;
  }
  if (!stage || typeof stage !== 'object') return null;

  const name = safeText(stage.name) || safeText(stage.label) || safeText(stage.id) || safeText(stage.key) || safeText(stage.slug);
  if (!name.trim()) return null;

  const id = safeText(stage.id) || safeText(stage.key) || safeText(stage.slug) || slugifyPipelineStageId(name, `stage-${index + 1}`);
  return {
    id: id.trim(),
    name: name.trim(),
    color: safeText(stage.color) || null,
    outcome: cleanOutcome(stage.outcome) || inferPipelineStageOutcome(name, id),
    raw: stage,
  };
}

export function normalizePipelineStages(stages) {
  if (!Array.isArray(stages)) return [];
  return stages
    .map((stage, index) => normalizePipelineStage(stage, index))
    .filter(Boolean);
}

export function editableStageNames(stages) {
  return normalizePipelineStages(stages).map((stage) => stage.name);
}

export function serializePipelineStage(stage) {
  return {
    id: stage.id,
    name: stage.name,
    color: stage.color ?? null,
    outcome: stage.outcome ?? inferPipelineStageOutcome(stage.name, stage.id),
  };
}

export function serializePipelineStages(stages) {
  return normalizePipelineStages(stages).map(serializePipelineStage);
}

function stageKey(value) {
  return safeText(value).trim().toLowerCase();
}

function uniqueStageId(name, usedIds, fallback) {
  const base = slugifyPipelineStageId(name, fallback);
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(stageKey(candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(stageKey(candidate));
  return candidate;
}

export function createPipelineStageFromName(name, usedIds = new Set(), index = 0) {
  const cleanName = safeText(name).trim();
  if (!cleanName) return null;
  const id = uniqueStageId(cleanName, usedIds, `stage-${index + 1}`);
  return {
    id,
    name: cleanName,
    color: null,
    outcome: inferPipelineStageOutcome(cleanName, id),
  };
}

export function mergePipelineStagesForSave(existingStages, incomingStages) {
  if (!Array.isArray(incomingStages)) return [];

  const existing = normalizePipelineStages(existingStages);
  const usedIds = new Set(existing.map((stage) => stageKey(stage.id)));
  return incomingStages.map((incoming, index) => {
    const previous = existing[index];
    if (typeof incoming === 'string' && previous) {
      const name = incoming.trim();
      if (!name) return null;
      return {
        id: previous.id,
        name,
        color: previous.color,
        outcome: previous.outcome,
      };
    }

    if (typeof incoming === 'string') {
      return createPipelineStageFromName(incoming, usedIds, index);
    }

    const normalized = normalizePipelineStage(incoming, index);
    return normalized ? serializePipelineStage(normalized) : null;
  }).filter(Boolean);
}

export function findPipelineStageOutcome(stages, stageValue) {
  const key = stageKey(stageValue);
  if (!key) return 'open';
  const stage = normalizePipelineStages(stages).find((candidate) =>
    stageKey(candidate.id) === key || stageKey(candidate.name) === key
  );
  return stage?.outcome ?? 'open';
}
