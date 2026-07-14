const CLOSED_PHASES = Object.freeze({ A: false, B: false, C: false });

export function normalizeStaffingAccess(response) {
  const phases = response?.phases || {};
  return {
    allowed: response?.allowed === true,
    phases: {
      A: phases.A === true,
      B: phases.B === true,
      C: phases.C === true,
    },
    capabilities: response?.capabilities && typeof response.capabilities === 'object'
      ? response.capabilities
      : {},
  };
}

export function closedStaffingPhases() {
  return { ...CLOSED_PHASES };
}
