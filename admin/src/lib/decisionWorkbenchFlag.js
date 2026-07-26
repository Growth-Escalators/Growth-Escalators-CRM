// PRD-005 §16 — WIZMATCH_DECISION_WORKBENCH_ENABLED gates the PR 6 Today
// re-bucketed decision workbench. Same build-time Vite-flag idiom as
// companyPolicyFlag.js: read once at module scope, `import.meta.env.DEV`
// always on locally.

function enabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').toLowerCase());
}

export const decisionWorkbenchUiEnabled =
  import.meta.env.DEV || enabled(import.meta.env.VITE_WIZMATCH_DECISION_WORKBENCH_ENABLED);
