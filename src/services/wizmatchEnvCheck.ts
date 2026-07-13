export type WizmatchEnvRequirement = 'required' | 'recommended' | 'optional';

export type WizmatchEnvCheckDefinition = {
  key: string;
  aliases?: string[];
  requirement: WizmatchEnvRequirement;
  group: string;
  note: string;
};

export type WizmatchEnvCheckResult = WizmatchEnvCheckDefinition & {
  present: boolean;
  presentKey: string | null;
};

export const WIZMATCH_ENV_CHECKS: WizmatchEnvCheckDefinition[] = [
  {
    key: 'WIZMATCH_TENANT_ID',
    requirement: 'required',
    group: 'Core',
    note: 'Tenant UUID printed by the Wizmatch seed script.',
  },
  {
    key: 'WIZMATCH_ANTHROPIC_API_KEY',
    aliases: ['ANTHROPIC_API_KEY', 'CLAUDE_API_KEY'],
    requirement: 'recommended',
    group: 'AI',
    note: 'Enables manual Claude-powered Wizmatch analysis and generation paths.',
  },
  {
    key: 'WIZMATCH_INTERNAL_TOKEN',
    aliases: ['INTERNAL_API_TOKEN', 'OUTREACH_INTERNAL_SECRET'],
    requirement: 'required',
    group: 'Internal ingest',
    note: 'Backend internal-token value. GitHub Actions may store the same value as INTERNAL_API_TOKEN.',
  },
  {
    key: 'WIZMATCH_UNSUBSCRIBE_HMAC_SECRET',
    requirement: 'required',
    group: 'Compliance',
    note: 'Signs unsubscribe links.',
  },
  {
    key: 'GITHUB_TOKEN',
    requirement: 'recommended',
    group: 'Sourcing',
    note: 'Raises GitHub mining rate limits.',
  },
  {
    key: 'SERPAPI_API_KEY',
    requirement: 'recommended',
    group: 'Sourcing',
    note: 'Used by X-Ray/Google candidate discovery.',
  },
  {
    key: 'APOLLO_API_KEY',
    requirement: 'recommended',
    group: 'Contact discovery',
    note: 'Primary approved paid contact discovery provider.',
  },
  {
    key: 'SNOV_CLIENT_ID',
    aliases: ['SNOVIO_API_KEY', 'SNOV_API_KEY'],
    requirement: 'recommended',
    group: 'Contact discovery',
    note: 'Snov credential id or legacy API key alias.',
  },
  {
    key: 'SNOV_CLIENT_SECRET',
    aliases: ['SNOVIO_CLIENT_SECRET'],
    requirement: 'recommended',
    group: 'Contact discovery',
    note: 'Snov OAuth secret when OAuth credentials are used.',
  },
  {
    key: 'REACHER_BASE_URL',
    requirement: 'recommended',
    group: 'Contact discovery',
    note: 'Email verification endpoint.',
  },
  {
    key: 'SERPER_API_KEY',
    requirement: 'optional',
    group: 'Contact discovery',
    note: 'Google fallback provider. Only needed if WIZMATCH_GOOGLE_FALLBACK_ENABLED=true.',
  },
  {
    key: 'PURELYMAIL_SMTP_HOST',
    aliases: ['PURELYMAIL_HOST'],
    requirement: 'recommended',
    group: 'Email',
    note: 'Purelymail SMTP host.',
  },
  {
    key: 'PURELYMAIL_SMTP_PORT',
    aliases: ['PURELYMAIL_PORT'],
    requirement: 'recommended',
    group: 'Email',
    note: 'Purelymail SMTP port.',
  },
  ...Array.from({ length: 6 }, (_, index) => {
    const slot = index + 1;
    return {
      key: `PURELYMAIL_SMTP_USER_${slot}`,
      aliases: [`PURELYMAIL_USER_${slot}`],
      requirement: 'recommended' as const,
      group: 'Email',
      note: `Purelymail sender inbox ${slot}.`,
    };
  }),
  ...Array.from({ length: 6 }, (_, index) => {
    const slot = index + 1;
    return {
      key: `PURELYMAIL_SMTP_PASS_${slot}`,
      aliases: [`PURELYMAIL_PASS_${slot}`],
      requirement: 'recommended' as const,
      group: 'Email',
      note: `Purelymail sender password ${slot}.`,
    };
  }),
  {
    key: 'WIZMATCH_PHYSICAL_ADDRESS',
    requirement: 'recommended',
    group: 'Compliance',
    note: 'Physical mailing address for compliant email footers.',
  },
  {
    key: 'WIZMATCH_LEADS_CHANNEL',
    requirement: 'optional',
    group: 'Slack',
    note: 'Slack channel for priority signal/reply alerts.',
  },
  {
    key: 'WIZMATCH_DAILY_CHANNEL',
    requirement: 'optional',
    group: 'Slack',
    note: 'Slack channel for daily summaries.',
  },
  {
    key: 'WIZMATCH_SYSTEM_CHANNEL',
    requirement: 'optional',
    group: 'Slack',
    note: 'Slack channel for guardrail/system alerts.',
  },
  {
    key: 'WIZMATCH_JOBSPY_QUERIES',
    requirement: 'optional',
    group: 'Sourcing',
    note: 'JSON array of manual scraper query strings.',
  },
  {
    key: 'WIZMATCH_WARMUP_CONTACTS',
    requirement: 'optional',
    group: 'Email',
    note: 'Comma-separated friendly inboxes for warmup flows.',
  },
  {
    key: 'WIZMATCH_DKIM_SELECTORS',
    requirement: 'optional',
    group: 'Email',
    note: 'JSON map of sending domain to DKIM selectors. When absent, DKIM evidence is reported as unknown.',
  },
];

function hasUsableValue(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (/^<.*>$/.test(trimmed)) return false;
  if (/^(replace|todo|changeme|your-key)/i.test(trimmed)) return false;
  return true;
}

export function buildWizmatchEnvReport(
  env: NodeJS.ProcessEnv = process.env,
): WizmatchEnvCheckResult[] {
  return WIZMATCH_ENV_CHECKS.map((definition) => {
    const keys = [definition.key, ...(definition.aliases || [])];
    const presentKey = keys.find((key) => hasUsableValue(env[key])) || null;

    return {
      ...definition,
      present: Boolean(presentKey),
      presentKey,
    };
  });
}

export function formatWizmatchEnvReport(results: WizmatchEnvCheckResult[]): string {
  const lines = [
    'Wizmatch environment readiness',
    '',
    'Status  Requirement  Key(s)  Source  Note',
    '------  -----------  ------  ------  ----',
  ];

  for (const result of results) {
    const status = result.present ? 'present' : 'missing';
    const keys = [result.key, ...(result.aliases || [])].join(' / ');
    const source = result.presentKey || '-';
    lines.push(`${status}  ${result.requirement}  ${keys}  ${source}  ${result.note}`);
  }

  const requiredMissing = results.filter((result) => result.requirement === 'required' && !result.present);
  const recommendedMissing = results.filter((result) => result.requirement === 'recommended' && !result.present);

  lines.push('');
  lines.push(`Required missing: ${requiredMissing.length}`);
  lines.push(`Recommended missing: ${recommendedMissing.length}`);
  lines.push('');
  lines.push('Secret values are intentionally not printed. This report shows presence only.');

  return lines.join('\n');
}
