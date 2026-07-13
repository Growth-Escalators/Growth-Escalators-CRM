function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

export const staffingPhaseUi = Object.freeze({
  A: import.meta.env.DEV || enabled(import.meta.env.VITE_WIZMATCH_STAFFING_GATE_A_ENABLED),
  B: import.meta.env.DEV || enabled(import.meta.env.VITE_WIZMATCH_STAFFING_GATE_B_ENABLED),
  C: import.meta.env.DEV || enabled(import.meta.env.VITE_WIZMATCH_STAFFING_GATE_C_ENABLED),
});
