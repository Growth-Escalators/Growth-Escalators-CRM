const EXPLICIT_NON_TECH_ROLE_TERMS = [
  'account executive', 'administrative assistant', 'attorney', 'barista', 'construction',
  'content writer', 'data entry', 'driver', 'field sales', 'government affairs', 'hospitality',
  'legal counsel', 'mason', 'marketing manager', 'music editor', 'nurse', 'paralegal',
  'payroll', 'retail', 'sales representative', 'voice actor', 'warehouse',
];

const TECH_ROLE_TERMS = [
  '.net', 'android', 'architect', 'automation engineer', 'backend', 'business analyst',
  'cloud', 'cyber', 'data analyst', 'data engineer', 'data scientist', 'database', 'developer',
  'devops', 'embedded', 'engineer', 'frontend', 'full stack', 'guidewire', 'infrastructure',
  'java', 'javascript', 'machine learning', 'mainframe', 'mobile', 'network engineer', 'oracle',
  'pega', 'platform engineer', 'product engineer', 'qa', 'sap', 'salesforce', 'security engineer',
  'servicenow', 'site reliability', 'software', 'solutions architect', 'sre', 'systems engineer',
  'technical lead', 'technology consultant', 'test engineer', 'workday',
];

export type RoleRelevance = 'relevant' | 'irrelevant' | 'unknown';

/**
 * Classifies role evidence only. Company name, industry and country are deliberately
 * excluded so a non-technical vacancy at a software company cannot inherit tech fit.
 */
export function classifyWizmatchRoleRelevance(input: {
  title?: string | null;
  description?: string | null;
  skills?: string[] | null;
}): RoleRelevance {
  const title = (input.title || '').trim().toLowerCase();
  const evidence = [title, input.description || '', ...(input.skills || [])].join(' ').toLowerCase();
  if (EXPLICIT_NON_TECH_ROLE_TERMS.some((term) => title.includes(term))) return 'irrelevant';
  if (TECH_ROLE_TERMS.some((term) => evidence.includes(term))) return 'relevant';
  return 'unknown';
}

export function isWizmatchRelevantRole(input: Parameters<typeof classifyWizmatchRoleRelevance>[0]) {
  return classifyWizmatchRoleRelevance(input) === 'relevant';
}
