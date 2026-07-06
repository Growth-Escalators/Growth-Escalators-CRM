import logger from '../utils/logger';

export type WizmatchDiscoveryProviderSource =
  | 'apollo'
  | 'snov'
  | 'website_manual_pattern'
  | 'reacher'
  | 'google_fallback';

export interface WizmatchProviderCandidate {
  name: string;
  title: string | null;
  email: string | null;
  linkedinUrl: string | null;
  source: WizmatchDiscoveryProviderSource;
  sourceUrl: string | null;
  deliverabilityStatus: 'verified' | 'unverified' | 'invalid' | 'unknown';
  confidenceScore: number;
  rankingScore: number;
  costCents: number;
  reasons: string[];
  raw?: Record<string, unknown>;
}

export interface WizmatchProviderCompanyInput {
  companyName: string;
  domain: string;
  targetRegion: 'india' | 'us';
}

export interface WizmatchContactDiscoveryProviders {
  apolloPeopleSearch(input: WizmatchProviderCompanyInput): Promise<WizmatchProviderCandidate[]>;
  snovDomainSearch(input: WizmatchProviderCompanyInput): Promise<WizmatchProviderCandidate[]>;
  reacherVerify(email: string): Promise<'verified' | 'invalid' | 'unknown'>;
  googleFallbackSearch(input: WizmatchProviderCompanyInput): Promise<WizmatchProviderCandidate[]>;
}

function cleanEmail(value: unknown) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? email : null;
}

function safeString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function titleScore(title: string | null) {
  const text = (title || '').toLowerCase();
  if (/cto|cio|chief|head|director|vp|vice president/.test(text)) return 88;
  if (/hiring|talent|recruit|vendor|procurement|delivery|engineering|technology|manager|lead/.test(text)) return 82;
  if (title) return 68;
  return 55;
}

function candidateFromRaw(
  source: WizmatchProviderCandidate['source'],
  raw: Record<string, unknown>,
  defaults: { costCents: number; reason: string; sourceUrl?: string | null },
): WizmatchProviderCandidate | null {
  const email = cleanEmail(raw.email);
  const name = safeString(raw.name) || [safeString(raw.first_name), safeString(raw.last_name)].filter(Boolean).join(' ');
  const title = safeString(raw.title) || safeString(raw.organization_title);
  if (!name && !email) return null;

  const deliverabilityStatus = raw.email_status === 'verified' || raw.emailStatus === 'Valid' ? 'verified' : 'unverified';
  const confidenceScore = deliverabilityStatus === 'verified' ? 8 : email ? 6 : 4;
  return {
    name: name || 'Unknown contact',
    title,
    email,
    linkedinUrl: safeString(raw.linkedin_url) || safeString(raw.linkedinUrl),
    source,
    sourceUrl: defaults.sourceUrl ?? null,
    deliverabilityStatus,
    confidenceScore,
    rankingScore: Math.min(100, titleScore(title) + confidenceScore),
    costCents: defaults.costCents,
    reasons: [defaults.reason],
    raw,
  };
}

export function createDefaultWizmatchContactDiscoveryProviders(): WizmatchContactDiscoveryProviders {
  return {
    async apolloPeopleSearch(input) {
      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) return [];
      try {
        const res = await fetch('https://api.apollo.io/v1/mixed_people/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' },
          body: JSON.stringify({
            api_key: apiKey,
            q_organization_domains: input.domain,
            page: 1,
            per_page: 5,
            reveal_personal_emails: false,
            person_titles: ['talent', 'recruiting', 'vendor', 'procurement', 'engineering', 'technology', 'delivery'],
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [];
        const data = await res.json() as { people?: Array<Record<string, unknown>> };
        return (data.people || [])
          .map((person) => candidateFromRaw('apollo', person, {
            costCents: 10,
            reason: 'Apollo returned a role-targeted person match.',
            sourceUrl: 'https://apollo.io',
          }))
          .filter((candidate): candidate is WizmatchProviderCandidate => Boolean(candidate));
      } catch (error) {
        logger.warn({ err: error, domain: input.domain }, '[wizmatch-contact-discovery] Apollo failed');
        throw error;
      }
    },

    async snovDomainSearch(input) {
      const clientId = process.env.SNOV_CLIENT_ID || process.env.SNOVIO_API_KEY || process.env.SNOV_API_KEY;
      const clientSecret = process.env.SNOV_CLIENT_SECRET || process.env.SNOVIO_CLIENT_SECRET;
      if (!clientId || !clientSecret) return [];
      try {
        const tokenRes = await fetch('https://api.snov.io/v1/oauth/access_token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }),
          signal: AbortSignal.timeout(10000),
        });
        if (!tokenRes.ok) return [];
        const tokenData = await tokenRes.json() as { access_token?: string };
        if (!tokenData.access_token) return [];

        const res = await fetch('https://api.snov.io/v1/get-emails-from-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: tokenData.access_token, url: `https://${input.domain}` }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [];
        const data = await res.json() as { emails?: Array<Record<string, unknown>> };
        return (data.emails || [])
          .map((email) => candidateFromRaw('snov', email, {
            costCents: 5,
            reason: 'Snov returned a domain email match.',
            sourceUrl: 'https://snov.io',
          }))
          .filter((candidate): candidate is WizmatchProviderCandidate => Boolean(candidate));
      } catch (error) {
        logger.warn({ err: error, domain: input.domain }, '[wizmatch-contact-discovery] Snov failed');
        throw error;
      }
    },

    async reacherVerify(email) {
      const baseUrl = process.env.REACHER_BASE_URL;
      if (!baseUrl) return 'unknown';
      try {
        const res = await fetch(`${baseUrl.replace(/\/$/, '')}/v0/check_email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to_email: email }),
          signal: AbortSignal.timeout(15000),
        });
        if (!res.ok) return 'unknown';
        const data = await res.json() as { is_reachable?: string };
        if (data.is_reachable === 'safe' || data.is_reachable === 'risky') return 'verified';
        if (data.is_reachable === 'invalid') return 'invalid';
        return 'unknown';
      } catch (error) {
        logger.warn({ err: error, email }, '[wizmatch-contact-discovery] Reacher failed');
        return 'unknown';
      }
    },

    async googleFallbackSearch(input) {
      const apiKey = process.env.SERPER_API_KEY;
      if (!apiKey) return [];
      try {
        const query = `site:linkedin.com/in (${input.companyName} OR ${input.domain}) (talent OR recruiting OR vendor OR procurement OR engineering)`;
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, num: 5 }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [];
        const data = await res.json() as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };
        return (data.organic || []).slice(0, 5).map((item) => {
          const title = safeString(item.title);
          const name = title?.split('-')[0]?.split('|')[0]?.trim() || 'LinkedIn profile';
          return {
            name,
            title: safeString(item.snippet),
            email: null,
            linkedinUrl: safeString(item.link),
            source: 'google_fallback' as const,
            sourceUrl: safeString(item.link),
            deliverabilityStatus: 'unknown' as const,
            confidenceScore: 3,
            rankingScore: 58,
            costCents: 2,
            reasons: ['Google fallback found a public profile candidate after provider discovery returned no usable contacts.'],
            raw: { title: item.title, link: item.link, snippet: item.snippet },
          };
        });
      } catch (error) {
        logger.warn({ err: error, domain: input.domain }, '[wizmatch-contact-discovery] Google fallback failed');
        throw error;
      }
    },
  };
}
