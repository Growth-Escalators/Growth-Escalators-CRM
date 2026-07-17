export interface CanonicalSkillTerm {
  phrase: string;
  label: string;
}

// Keep these phrases deliberately explicit. Very short tokens such as `go`, `r`,
// and `ai` are not safe evidence on their own because they occur in ordinary
// prose. Their unambiguous phrases are represented as aliases below.
export const WIZMATCH_CANONICAL_SKILL_TERMS: CanonicalSkillTerm[] = [
  // Languages and core platforms.
  'java', 'python', 'javascript', 'typescript', 'c#', '.net', 'dotnet',
  'rust', 'scala', 'ruby', 'php', 'kotlin', 'swift', 'c++', 'perl',
  // Web and application frameworks.
  'react', 'angular', 'vue', 'node', 'next.js', 'spring', 'spring boot', 'django',
  'flask', 'laravel', '.net core', 'graphql', 'rest api',
  // Cloud, infrastructure, and DevOps.
  'aws', 'azure', 'gcp', 'docker', 'kubernetes', 'devops', 'terraform', 'ansible',
  'jenkins', 'ci/cd', 'cloud', 'linux', 'microservices',
  // Data and ML.
  'sql', 'postgres', 'mysql', 'oracle', 'mongodb', 'redis', 'kafka', 'spark', 'hadoop',
  'airflow', 'snowflake', 'databricks', 'tableau', 'power bi', 'etl', 'data engineer',
  'data scientist', 'data analyst', 'machine learning', 'ml', 'nlp', 'tensorflow', 'pytorch',
  // Enterprise and functional specializations.
  'sap', 'sap abap', 'sap fico', 'sap mm', 'salesforce', 'servicenow', 'workday', 'peoplesoft',
  'guidewire', 'pega', 'sharepoint', 'dynamics 365', 'mulesoft', 'informatica', 'mainframe', 'cobol',
  // Roles and disciplines.
  'full stack', 'frontend', 'backend', 'mobile', 'ios', 'android', 'qa', 'automation',
  'selenium', 'manual testing', 'business analyst', 'scrum master', 'project manager',
  'product manager', 'ui/ux', 'security', 'network', 'sre', 'embedded',
].map((phrase) => ({ phrase, label: phrase }));

const UNAMBIGUOUS_ALIASES: CanonicalSkillTerm[] = [
  { phrase: 'go developer', label: 'go' },
  { phrase: 'go engineer', label: 'go' },
  { phrase: 'go programmer', label: 'go' },
  { phrase: 'golang', label: 'go' },
  { phrase: 'artificial intelligence', label: 'ai' },
  { phrase: 'generative ai', label: 'ai' },
  { phrase: 'express.js', label: 'express' },
  { phrase: 'express js', label: 'express' },
];

function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Extract known skills using longest-phrase-first, word-boundary evidence.
 * Overlapping phrases are consumed once, so JavaScript never becomes Java and
 * SAP ABAP never becomes generic SAP. A generic SAP label is also suppressed
 * when any explicit SAP specialization is present elsewhere in the text.
 */
export function extractCanonicalSkillKeywords(text: string): string[] {
  const normalized = String(text || '').toLowerCase().replace(/\s+/g, ' ');
  const terms = [...WIZMATCH_CANONICAL_SKILL_TERMS, ...UNAMBIGUOUS_ALIASES]
    .sort((a, b) => b.phrase.length - a.phrase.length);
  const occupied: Array<[number, number]> = [];
  const matched: string[] = [];

  for (const term of terms) {
    const expression = new RegExp(`(?<![a-z0-9])${escaped(term.phrase)}(?![a-z0-9])`, 'gi');
    for (const result of normalized.matchAll(expression)) {
      const start = result.index ?? -1;
      const end = start + result[0].length;
      if (start < 0 || occupied.some(([from, to]) => start < to && end > from)) continue;
      occupied.push([start, end]);
      matched.push(term.label);
    }
  }

  const unique = Array.from(new Set(matched));
  const hasSpecificSap = unique.some((skill) => skill.startsWith('sap ') && skill !== 'sap');
  return hasSpecificSap ? unique.filter((skill) => skill !== 'sap') : unique;
}
