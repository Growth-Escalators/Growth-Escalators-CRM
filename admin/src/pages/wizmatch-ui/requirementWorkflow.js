const ACTIVE_REQUIREMENT_STAGES = new Set([
  'draft', 'qualifying', 'accepted', 'sourcing', 'covered', 'submitted', 'interviewing', 'offer', 'filled',
]);

const INACTIVE_STAGE_COPY = {
  on_hold: {
    label: 'On hold',
    description: 'This requirement is paused. Resume it through an allowed transition before continuing delivery.',
  },
  closed: {
    label: 'Closed',
    description: 'This requirement is closed. Its history remains available, but it is not in the active delivery path.',
  },
  closed_lost: {
    label: 'Closed lost',
    description: 'This requirement was closed without a placement. Its history remains available for reporting and review.',
  },
  cancelled: {
    label: 'Cancelled',
    description: 'This requirement was cancelled. Its history remains available, but delivery actions are no longer active.',
  },
};

export function requirementStagePresentation(stage) {
  const normalized = String(stage || 'draft').trim().toLowerCase();
  if (ACTIVE_REQUIREMENT_STAGES.has(normalized)) {
    return { active: true, stage: normalized, label: normalized.replaceAll('_', ' '), description: '' };
  }
  return {
    active: false,
    stage: normalized,
    ...(INACTIVE_STAGE_COPY[normalized] || {
      label: normalized.replaceAll('_', ' '),
      description: 'This requirement is outside the active delivery path. Review its current status and history before taking action.',
    }),
  };
}
