// PRD-005 §16 — WIZMATCH_COMPANY_POLICY_ENABLED gates the policy read/write
// API + UI. Same build-time Vite-flag idiom as staffingPhases.js: read once
// at module scope, `import.meta.env.DEV` always on locally.

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

export const companyPolicyUiEnabled =
  import.meta.env.DEV || enabled(import.meta.env.VITE_WIZMATCH_COMPANY_POLICY_ENABLED);
