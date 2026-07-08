export type PipelineStageInput =
  | string
  | {
      id?: unknown;
      key?: unknown;
      slug?: unknown;
      name?: unknown;
      label?: unknown;
      color?: unknown;
      outcome?: unknown;
    };

export type PipelineStageOutcome = 'open' | 'won' | 'lost' | 'abandoned';

export interface NormalizedPipelineStage {
  id: string;
  name: string;
  color: string | null;
  outcome: PipelineStageOutcome;
  raw: PipelineStageInput;
}

export interface PipelineStageColumn<TDeal extends { stage?: unknown; dealValue?: unknown }> {
  stageId: string;
  stageName: string;
  stageLabel: string;
  stageColor: string | null;
  stageOutcome: PipelineStageOutcome;
  deals: TDeal[];
  totalValue: number;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function slugifyPipelineStageId(value: string, fallback: string): string {
  const slug = value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return slug || fallback;
}

function cleanOutcome(value: unknown): PipelineStageOutcome | null {
  if (value === 'open' || value === 'won' || value === 'lost' || value === 'abandoned') return value;
  return null;
}

export function inferPipelineStageOutcome(name: unknown, id?: unknown): PipelineStageOutcome {
  const stageName = cleanString(name) ?? '';
  const stageId = cleanString(id) ?? '';
  const nameKey = pipelineStageKey(stageName);
  const idKey = pipelineStageKey(stageId);

  if (nameKey === 'ended' || idKey === 'ended') return 'won';
  if (nameKey.includes('won')) return 'won';
  if (nameKey.includes('abandoned')) return 'abandoned';
  if (nameKey.includes('lost')) return 'lost';
  return 'open';
}

function numeric(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

export function normalizePipelineStage(stage: PipelineStageInput, index = 0): NormalizedPipelineStage | null {
  if (typeof stage === 'string') {
    const name = cleanString(stage);
    if (!name) return null;
    return { id: name, name, color: null, outcome: inferPipelineStageOutcome(name, name), raw: stage };
  }

  if (!stage || typeof stage !== 'object') return null;

  const name = cleanString(stage.name) || cleanString(stage.label) || cleanString(stage.id) || cleanString(stage.key) || cleanString(stage.slug);
  if (!name) return null;

  const id = cleanString(stage.id) || cleanString(stage.key) || cleanString(stage.slug) || slugifyPipelineStageId(name, `stage-${index + 1}`);
  const outcome = cleanOutcome(stage.outcome) ?? inferPipelineStageOutcome(name, id);
  return {
    id,
    name,
    color: cleanString(stage.color),
    outcome,
    raw: stage,
  };
}

export function normalizePipelineStages(stages: unknown): NormalizedPipelineStage[] {
  if (!Array.isArray(stages)) return [];
  return stages
    .map((stage, index) => normalizePipelineStage(stage as PipelineStageInput, index))
    .filter((stage): stage is NormalizedPipelineStage => Boolean(stage));
}

export function pipelineStageKey(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function serializePipelineStage(stage: NormalizedPipelineStage): Omit<NormalizedPipelineStage, 'raw'> {
  return {
    id: stage.id,
    name: stage.name,
    color: stage.color,
    outcome: stage.outcome,
  };
}

export function serializePipelineStages(stages: unknown): Array<Omit<NormalizedPipelineStage, 'raw'>> {
  return normalizePipelineStages(stages).map(serializePipelineStage);
}

function uniqueStageId(name: string, usedIds: Set<string>, fallback: string): string {
  const base = slugifyPipelineStageId(name, fallback);
  let candidate = base;
  let suffix = 2;
  while (usedIds.has(pipelineStageKey(candidate))) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }
  usedIds.add(pipelineStageKey(candidate));
  return candidate;
}

export function createPipelineStageFromName(
  name: unknown,
  usedIds = new Set<string>(),
  index = 0,
): Omit<NormalizedPipelineStage, 'raw'> | null {
  const cleanName = cleanString(name);
  if (!cleanName) return null;
  const id = uniqueStageId(cleanName, usedIds, `stage-${index + 1}`);
  return {
    id,
    name: cleanName,
    color: null,
    outcome: inferPipelineStageOutcome(cleanName, id),
  };
}

export function mergePipelineStagesForSave(
  existingStages: unknown,
  incomingStages: unknown,
): Array<Omit<NormalizedPipelineStage, 'raw'>> {
  if (!Array.isArray(incomingStages)) return [];

  const existing = normalizePipelineStages(existingStages);
  const usedIds = new Set(existing.map((stage) => pipelineStageKey(stage.id)));
  const next: Array<Omit<NormalizedPipelineStage, 'raw'>> = [];

  incomingStages.forEach((incoming, index) => {
    const previous = existing[index];
    if (typeof incoming === 'string' && previous) {
      const name = cleanString(incoming);
      if (!name) return;
      next.push({
        id: previous.id,
        name,
        color: previous.color,
        outcome: previous.outcome,
      });
      return;
    }

    if (typeof incoming === 'string') {
      const created = createPipelineStageFromName(incoming, usedIds, index);
      if (created) next.push(created);
      return;
    }

    const normalized = normalizePipelineStage(incoming as PipelineStageInput, index);
    if (!normalized) return;
    next.push(serializePipelineStage(normalized));
    usedIds.add(pipelineStageKey(normalized.id));
  });

  return next;
}

export function findPipelineStageOutcome(stages: unknown, stageValue: unknown): PipelineStageOutcome {
  const key = pipelineStageKey(stageValue);
  if (!key) return 'open';
  const stage = normalizePipelineStages(stages).find((candidate) =>
    pipelineStageKey(candidate.id) === key || pipelineStageKey(candidate.name) === key
  );
  return stage?.outcome ?? 'open';
}

export function getPipelineStageIdsByOutcome(stages: unknown, options: { lowercase?: boolean } = {}) {
  const grouped: Record<PipelineStageOutcome, string[]> = {
    open: [],
    won: [],
    lost: [],
    abandoned: [],
  };

  for (const stage of normalizePipelineStages(stages)) {
    const id = options.lowercase ? stage.id.toLowerCase() : stage.id;
    grouped[stage.outcome].push(id);
  }

  return {
    ...grouped,
    closed: [...grouped.won, ...grouped.lost, ...grouped.abandoned],
  };
}

export function buildPipelineStageColumns<TDeal extends { stage?: unknown; dealValue?: unknown }>(
  stages: unknown,
  deals: TDeal[],
): PipelineStageColumn<TDeal>[] {
  const normalizedStages = normalizePipelineStages(stages);
  const stageMap: Record<string, TDeal[]> = {};
  for (const deal of deals) {
    const stageName = String(deal.stage ?? 'Unknown');
    if (!stageMap[stageName]) stageMap[stageName] = [];
    stageMap[stageName].push(deal);
  }

  const usedStageKeys = new Set<string>();
  const columns = normalizedStages.map((stage) => {
    const stageDeals = Object.entries(stageMap).flatMap(([rawStageName, stageDeals]) => {
      const rawKey = pipelineStageKey(rawStageName);
      const matches = rawKey === pipelineStageKey(stage.id) || rawKey === pipelineStageKey(stage.name);
      if (matches) usedStageKeys.add(rawKey);
      return matches ? stageDeals : [];
    });

    return {
      stageId: stage.id,
      stageName: stage.id,
      stageLabel: stage.name,
      stageColor: stage.color,
      stageOutcome: stage.outcome,
      deals: stageDeals,
      totalValue: stageDeals.reduce((sum, deal) => sum + numeric(deal.dealValue), 0),
    };
  });

  for (const [stageName, stageDeals] of Object.entries(stageMap)) {
    if (!usedStageKeys.has(pipelineStageKey(stageName))) {
      columns.push({
        stageId: stageName,
        stageName,
        stageLabel: stageName,
        stageColor: null,
        stageOutcome: 'open',
        deals: stageDeals,
        totalValue: stageDeals.reduce((sum, deal) => sum + numeric(deal.dealValue), 0),
      });
    }
  }

  return columns;
}
