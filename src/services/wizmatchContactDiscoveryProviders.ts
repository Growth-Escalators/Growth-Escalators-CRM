import { promises as dns } from 'dns';
import logger from '../utils/logger';
import { collectWebsiteEmails, guessEmailCandidates } from './emailExtractorService';

export type WizmatchDiscoveryProviderSource =
  | 'apollo'
  | 'snov'
  | 'website_manual_pattern'
  | 'reacher'
  | 'google_fallback';

/** Confidence tier drives how safely a contact can be emailed (see dashboard guidance). */
export type WizmatchConfidenceTier = 'high' | 'medium' | 'low';

/** Which mail provider a domain uses — decides whether SMTP verification is trustworthy. */
export type WizmatchMxProvider = 'google' | 'microsoft' | 'other' | 'none';

/** Role-based inbox prefixes we treat as high-value staffing contacts when published. */
const ROLE_INBOX_PREFIXES = ['careers', 'hr', 'talent', 'recruiting', 'recruitment', 'jobs', 'hiring', 'people', 'staffing'];

function roleInboxLabel(prefix: string): string | null {
  const p = prefix.toLowerCase();
  if (p.startsWith('careers') || p.startsWith('jobs') || p.startsWith('hiring')) return 'Careers Team';
  if (p.startsWith('hr') || p.startsWith('people')) return 'HR Team';
  if (p.startsWith('talent') || p.startsWith('recruit') || p.startsWith('staffing')) return 'Talent Acquisition';
  return null;
}

/**
 * Free DNS lookup that classifies a domain's mail provider. Google Workspace /
 * Microsoft 365 both defeat SMTP mailbox probing, so a "verified" guess on those
 * providers cannot be trusted — the caller uses this to cap confidence.
 */
export async function classifyMxProvider(domain: string): Promise<WizmatchMxProvider> {
  try {
    const records = await dns.resolveMx(domain).catch(() => []);
    if (!records.length) return 'none';
    const hosts = records.map((r) => r.exchange.toLowerCase()).join(' ');
    if (/google\.com|googlemail\.com|aspmx\.l\.google/.test(hosts)) return 'google';
    if (/outlook\.com|mail\.protection\.outlook\.com|microsoft/.test(hosts)) return 'microsoft';
    return 'other';
  } catch {
    return 'other';
  }
}

/**
 * Detects a catch-all domain by asking Reacher to verify a random non-existent
 * address. If that "passes", the domain accepts everything, so a "verified" guess
 * is meaningless — the caller downgrades such contacts to low confidence.
 * Returns null when we cannot determine (no Reacher configured / error).
 */
export async function detectCatchAll(
  domain: string,
  reacherVerify: (email: string) => Promise<'verified' | 'invalid' | 'unknown'>,
): Promise<boolean | null> {
  if (!process.env.REACHER_BASE_URL) return null;
  const probe = `wm-no-such-user-${Date.now().toString(36)}@${domain}`;
  const result = await reacherVerify(probe).catch(() => 'unknown' as const);
  if (result === 'verified') return true;
  if (result === 'invalid') return false;
  return null;
}

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
  /**
   * FREE first rung: scrape published company emails (role inboxes like careers@,
   * hr@) and MX-verified pattern guesses. Runs before any paid provider. Fully
   * self-hosted / zero external spend.
   */
  websitePatternSearch(input: WizmatchProviderCompanyInput): Promise<WizmatchProviderCandidate[]>;
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

function intEnv(value: string | undefined, defaultValue: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.floor(parsed) : defaultValue;
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
  const providers: WizmatchContactDiscoveryProviders = {
    async websitePatternSearch(input) {
      const websiteUrl = `https://${input.domain}`;
      const mxProvider = await classifyMxProvider(input.domain);
      // Google Workspace / Microsoft 365 defeat SMTP probing, so verification is unreliable there.
      const verifyReliable = mxProvider === 'other';
      const candidates: WizmatchProviderCandidate[] = [];
      const seen = new Set<string>();

      // Rung 1 — published emails scraped from the company's own site. No SMTP
      // verification needed: the company put these there to be contacted.
      let published: Awaited<ReturnType<typeof collectWebsiteEmails>> = [];
      try {
        published = await collectWebsiteEmails(websiteUrl);
      } catch (error) {
        logger.warn({ err: error, domain: input.domain }, '[wizmatch-contact-discovery] website scrape failed');
      }
      for (const item of published) {
        if (seen.has(item.email)) continue;
        seen.add(item.email);
        const prefix = item.email.split('@')[0] || '';
        const roleLabel = ROLE_INBOX_PREFIXES.some((r) => prefix.startsWith(r)) ? roleInboxLabel(prefix) : null;
        const isRoleInbox = Boolean(roleLabel);
        candidates.push({
          name: roleLabel || (item.preferred ? 'Company Contact' : 'Published Inbox'),
          title: isRoleInbox ? `Company inbox (${prefix})` : 'Published company email',
          email: item.email,
          linkedinUrl: null,
          source: 'website_manual_pattern',
          sourceUrl: websiteUrl,
          deliverabilityStatus: 'unverified',
          confidenceScore: isRoleInbox ? 8 : 7,
          rankingScore: isRoleInbox ? 78 : 70,
          costCents: 0,
          reasons: [
            isRoleInbox
              ? 'Published role inbox scraped from the company website — safe to contact.'
              : 'Email published on the company website.',
          ],
          raw: {
            confidenceTier: 'high' as WizmatchConfidenceTier,
            roleCategory: isRoleInbox ? 'role_inbox' : 'published',
            mxProvider,
            catchAll: false,
            verificationDone: true,
          },
        });
      }

      if (candidates.length > 0) return candidates.slice(0, 5);

      // Rung 2 — MX-verified pattern guesses (no person name for prospect
      // companies, so this yields role-alias guesses like hello@/info@).
      let guesses: string[] = [];
      try {
        guesses = await guessEmailCandidates(input.domain);
      } catch (error) {
        logger.warn({ err: error, domain: input.domain }, '[wizmatch-contact-discovery] pattern guess failed');
      }
      if (guesses.length === 0) return [];

      const catchAll = verifyReliable ? await detectCatchAll(input.domain, providers.reacherVerify) : null;

      for (const email of guesses.slice(0, 3)) {
        if (seen.has(email)) continue;
        seen.add(email);
        let deliverabilityStatus: WizmatchProviderCandidate['deliverabilityStatus'] = 'unknown';
        let tier: WizmatchConfidenceTier = 'low';
        let confidenceScore = 4;
        const reasons: string[] = ['MX-validated email pattern guess.'];

        if (verifyReliable && catchAll === false) {
          const verdict = await providers.reacherVerify(email);
          if (verdict === 'invalid') continue; // drop guesses the mail server rejects
          if (verdict === 'verified') {
            deliverabilityStatus = 'verified';
            tier = 'medium';
            confidenceScore = 6;
            reasons.push('SMTP-verified as deliverable.');
          }
        } else if (catchAll === true) {
          reasons.push('Domain is catch-all — verification cannot confirm this address.');
        } else if (!verifyReliable) {
          reasons.push(`Domain uses ${mxProvider === 'google' ? 'Google Workspace' : 'Microsoft 365'} — SMTP verification is unreliable, treat as unconfirmed.`);
        }

        candidates.push({
          name: 'Company Contact',
          title: `Guessed inbox (${email.split('@')[0]})`,
          email,
          linkedinUrl: null,
          source: 'website_manual_pattern',
          sourceUrl: websiteUrl,
          deliverabilityStatus,
          confidenceScore,
          rankingScore: tier === 'medium' ? 60 : 45,
          costCents: 0,
          reasons,
          raw: {
            confidenceTier: tier,
            roleCategory: 'guessed',
            mxProvider,
            catchAll: catchAll === true,
            verificationDone: true,
          },
        });
      }
      return candidates;
    },

    async apolloPeopleSearch(input) {
      const apiKey = process.env.APOLLO_API_KEY;
      if (!apiKey) return [];
      try {
        // NOTE: search only confirms a person exists (has_email flag); returning a real
        // email requires a second, separately-billed people/match reveal call. Apollo is
        // flag-gated off by default (WIZMATCH_ENABLE_APOLLO) until a paid plan is confirmed.
        const res = await fetch('https://api.apollo.io/v1/mixed_people/api_search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache', 'X-Api-Key': apiKey },
          body: JSON.stringify({
            q_organization_domains: input.domain,
            page: 1,
            per_page: 5,
            reveal_personal_emails: false,
            person_titles: ['talent', 'recruiting', 'vendor', 'procurement', 'engineering', 'technology', 'delivery'],
          }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          logger.warn({ status: res.status, body: body.slice(0, 500), domain: input.domain }, '[wizmatch-contact-discovery] Apollo returned non-OK status');
          return [];
        }
        const data = await res.json() as { people?: Array<Record<string, unknown>> };
        return (data.people || [])
          .map((person) => candidateFromRaw('apollo', person, {
            costCents: intEnv(process.env.WIZMATCH_APOLLO_COST_CENTS, 1500),
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
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          logger.warn({ status: res.status, body: body.slice(0, 500), domain: input.domain }, '[wizmatch-contact-discovery] Snov returned non-OK status');
          return [];
        }
        const data = await res.json() as { emails?: Array<Record<string, unknown>> };
        return (data.emails || [])
          .map((email) => candidateFromRaw('snov', email, {
            costCents: intEnv(process.env.WIZMATCH_SNOV_COST_CENTS, 1000),
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
            costCents: intEnv(process.env.WIZMATCH_GOOGLE_FALLBACK_COST_CENTS, 100),
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
  return providers;
}
