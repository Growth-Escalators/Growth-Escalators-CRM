import { describe, expect, it } from 'vitest';
import {
  buildPipelineStageColumns,
  createPipelineStageFromName,
  findPipelineStageOutcome,
  getPipelineStageIdsByOutcome,
  mergePipelineStagesForSave,
  normalizePipelineStages,
  serializePipelineStages,
} from '../services/pipelineStages';

describe('pipeline stage normalization', () => {
  it('keeps string-stage Growth pipelines backward compatible', () => {
    const stages = normalizePipelineStages(['New Lead', 'Proposal', 'Won']);

    expect(stages.map((stage) => stage.name)).toEqual(['New Lead', 'Proposal', 'Won']);
    expect(stages.map((stage) => stage.id)).toEqual(['New Lead', 'Proposal', 'Won']);
    expect(stages.map((stage) => stage.outcome)).toEqual(['open', 'open', 'won']);
    expect(serializePipelineStages(['New Lead', 'Proposal', 'Won'])).toEqual([
      { id: 'New Lead', name: 'New Lead', color: null, outcome: 'open' },
      { id: 'Proposal', name: 'Proposal', color: null, outcome: 'open' },
      { id: 'Won', name: 'Won', color: null, outcome: 'won' },
    ]);
  });

  it('normalizes Wizmatch object stages into safe ids, labels, and colors', () => {
    const stages = normalizePipelineStages([
      { id: 'submitted', name: 'Submitted', color: '#3B82F6' },
      { id: 'interviewing', name: 'Interviewing', color: '#F59E0B' },
    ]);

    expect(stages).toMatchObject([
      { id: 'submitted', name: 'Submitted', color: '#3B82F6', outcome: 'open' },
      { id: 'interviewing', name: 'Interviewing', color: '#F59E0B', outcome: 'open' },
    ]);
  });

  it('infers terminal outcomes from non-exact Growth names and Wizmatch ended', () => {
    const stages = normalizePipelineStages([
      'Deal Won 🎉',
      'Client Lost - Competitor',
      'Abandoned after no response',
      { id: 'ended', name: 'Ended', color: '#6B7280' },
    ]);

    expect(stages.map((stage) => stage.outcome)).toEqual(['won', 'lost', 'abandoned', 'won']);
  });

  it('generates unique slug ids for new object stages', () => {
    const usedIds = new Set(['follow-up']);
    expect(createPipelineStageFromName('Follow Up', usedIds, 0)).toMatchObject({
      id: 'follow-up-2',
      name: 'Follow Up',
      color: null,
      outcome: 'open',
    });
    expect(createPipelineStageFromName('Deal Won 🎉', usedIds, 1)).toMatchObject({
      id: 'deal-won',
      name: 'Deal Won 🎉',
      outcome: 'won',
    });
  });

  it('merges flattened saves over object stages by position', () => {
    const existing = [
      { id: 'submitted', name: 'Submitted', color: '#3B82F6', outcome: 'open' },
      { id: 'ended', name: 'Ended', color: '#6B7280', outcome: 'won' },
      { id: 'lost', name: 'Lost', color: '#EF4444', outcome: 'lost' },
    ];

    expect(mergePipelineStagesForSave(existing, ['Submitted - renamed', 'Ended', 'Lost'])).toEqual([
      { id: 'submitted', name: 'Submitted - renamed', color: '#3B82F6', outcome: 'open' },
      { id: 'ended', name: 'Ended', color: '#6B7280', outcome: 'won' },
      { id: 'lost', name: 'Lost', color: '#EF4444', outcome: 'lost' },
    ]);

    expect(mergePipelineStagesForSave(existing, ['Submitted', 'Ended', 'Lost', 'Offer Won'])).toEqual([
      { id: 'submitted', name: 'Submitted', color: '#3B82F6', outcome: 'open' },
      { id: 'ended', name: 'Ended', color: '#6B7280', outcome: 'won' },
      { id: 'lost', name: 'Lost', color: '#EF4444', outcome: 'lost' },
      { id: 'offer-won', name: 'Offer Won', color: null, outcome: 'won' },
    ]);

    expect(mergePipelineStagesForSave(existing, ['Submitted'])).toEqual([
      { id: 'submitted', name: 'Submitted', color: '#3B82F6', outcome: 'open' },
    ]);
  });

  it('finds outcomes from normalized stages without downstream label guessing', () => {
    const stages = [
      { id: 'stage_4', name: 'Deal Won', color: '#22C55E' },
      { id: 'ended', name: 'Ended', color: '#6B7280' },
      { id: 'lost', name: 'Lost', color: '#EF4444' },
    ];

    expect(findPipelineStageOutcome(stages, 'stage_4')).toBe('won');
    expect(findPipelineStageOutcome(stages, 'ended')).toBe('won');
    expect(findPipelineStageOutcome(stages, 'lost')).toBe('lost');
    expect(findPipelineStageOutcome(stages, 'unknown')).toBe('open');
  });

  it('groups stage ids for analytics by normalized outcome', () => {
    const growth = getPipelineStageIdsByOutcome(['New', 'Deal Won 🎉', 'Client Lost - Competitor', 'Abandoned'], { lowercase: true });
    expect(growth).toMatchObject({
      open: ['new'],
      won: ['deal won 🎉'],
      lost: ['client lost - competitor'],
      abandoned: ['abandoned'],
      closed: ['deal won 🎉', 'client lost - competitor', 'abandoned'],
    });

    const wizmatch = getPipelineStageIdsByOutcome([
      { id: 'submitted', name: 'Submitted' },
      { id: 'ended', name: 'Ended' },
      { id: 'lost', name: 'Lost' },
    ], { lowercase: true });
    expect(wizmatch).toMatchObject({
      open: ['submitted'],
      won: ['ended'],
      lost: ['lost'],
      closed: ['ended', 'lost'],
    });
  });

  it('groups deals by object-stage id or label without crashing', () => {
    const columns = buildPipelineStageColumns(
      [
        { id: 'submitted', name: 'Submitted', color: '#3B82F6' },
        { id: 'interviewing', name: 'Interviewing', color: '#F59E0B' },
      ],
      [
        { id: 'deal-1', stage: 'submitted', dealValue: 1000 },
        { id: 'deal-2', stage: 'Interviewing', dealValue: '2000' },
      ],
    );

    expect(columns).toHaveLength(2);
    expect(columns[0]).toMatchObject({ stageName: 'submitted', stageLabel: 'Submitted', stageColor: '#3B82F6', stageOutcome: 'open', totalValue: 1000 });
    expect(columns[0].deals.map((deal) => deal.id)).toEqual(['deal-1']);
    expect(columns[1]).toMatchObject({ stageName: 'interviewing', stageLabel: 'Interviewing', stageColor: '#F59E0B', stageOutcome: 'open', totalValue: 2000 });
    expect(columns[1].deals.map((deal) => deal.id)).toEqual(['deal-2']);
  });

  it('preserves deals in unknown stages at the end', () => {
    const columns = buildPipelineStageColumns(['New', 'Won'], [
      { id: 'deal-1', stage: 'Archived old stage', dealValue: 'bad-number' },
    ]);

    expect(columns.map((column) => column.stageName)).toEqual(['New', 'Won', 'Archived old stage']);
    expect(columns[2].totalValue).toBe(0);
    expect(columns[2].deals).toHaveLength(1);
  });
});
