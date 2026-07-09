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

/** Pages scraped for published hiring contacts — careers/jobs first, then contact/about. */
const DISCOVERY_SCRAPE_PATHS = [
  '/careers', '/careers/contact', '/jobs', '/join-us', '/work-with-us',
  '/contact', '/contact-us', '/about', '/about-us', '/team', '/',
];

/** The hiring team a contact reaches — drives ranking + the dashboard team badge. */
export type WizmatchTeam =
  | 'Talent Acquisition'
  | 'HR / People Ops'
  | 'Hiring Manager'
  | 'Vendor / Procurement'
  | 'Careers inbox'
  | 'Generic inbox';

interface RoleClassification {
  team: WizmatchTeam | null;
  category: string;
  isTarget: boolean; // is this one of the right people to reach for staffing?
  rank: number;
}

/** Classify a published email's local-part (e.g. `talent@`, `hr@`, `info@`) into a hiring team. */
function classifyEmailPrefix(prefix: string): RoleClassification {
  const p = prefix.toLowerCase();
  if (/^(talent|recruit|recruiting|recruitment|staffing|ta)\b/.test(p)) return { team: 'Talent Acquisition', category: 'role_inbox_talent', isTarget: true, rank: 82 };
  if (/^(hr|people|humanresources|peopleops)\b/.test(p)) return { team: 'HR / People Ops', category: 'role_inbox_hr', isTarget: true, rank: 78 };
  if (/^(careers|jobs|hiring|join|apply)\b/.test(p)) return { team: 'Careers inbox', category: 'role_inbox_careers', isTarget: true, rank: 76 };
  if (/^(vendor|procurement|msp|sourcing)\b/.test(p)) return { team: 'Vendor / Procurement', category: 'role_inbox_vendor', isTarget: true, rank: 74 };
  return { team: 'Generic inbox', category: 'generic', isTarget: false, rank: 38 };
}

/** Classify a LinkedIn person's title into a target hiring team (the right person to contact). */
function classifyTitle(title: string | null): RoleClassification {
  const t = (title || '').toLowerCase();
  if (/talent acquisition|technical recruiter|\brecruiter\b|recruiting|talent partner|talent sourcer|\bsourcer\b|talent lead/.test(t)) return { team: 'Talent Acquisition', category: 'named_talent', isTarget: true, rank: 92 };
  if (/hiring manager|engineering manager|technical lead|tech lead|head of engineering|delivery manager|delivery head|vp engineering|director of engineering|engineering director/.test(t)) return { team: 'Hiring Manager', category: 'named_hiring_manager', isTarget: true, rank: 88 };
  if (/human resources|hr manager|hr business|people ops|people operations|chro|head of people|hr lead|hrbp/.test(t)) return { team: 'HR / People Ops', category: 'named_hr', isTarget: true, rank: 84 };
  if (/vendor|procurement|\bmsp\b|sourcing manager|supplier/.test(t)) return { team: 'Vendor / Procurement', category: 'named_vendor', isTarget: true, rank: 80 };
  return { team: null, category: 'named_other', isTarget: false, rank: 40 };
}

/** Split a "Firstname Lastname" display name into pattern-guessing parts. */
function nameToParts(name: string): { first: string | null; last: string | null } {
  const parts = name.replace(/[^a-zA-Z\s.]/g, ' ').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: null, last: null };
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : null };
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
   * FREE first rung: scrape PUBLISHED company emails from careers/contact pages and
   * classify each into a hiring team (Talent Acquisition, HR, Careers inbox, or
   * generic). No guessing here — only real published addresses. Zero spend.
   */
  websitePatternSearch(input: WizmatchProviderCompanyInput): Promise<WizmatchProviderCandidate[]>;
  apolloPeopleSearch(input: WizmatchProviderCompanyInput): Promise<WizmatchProviderCandidate[]>;
  snovDomainSearch(input: WizmatchProviderCompanyInput): Promise<WizmatchProviderCandidate[]>;
  reacherVerify(email: string): Promise<'verified' | 'invalid' | 'unknown'>;
  /**
   * Named-people search (~₹1): finds actual Talent Acquisition / HR / Hiring Manager /
   * Vendor people on LinkedIn via Serper, then guesses + verifies their personal email.
   * Produces named contacts in the RIGHT team, not generic inboxes.
   */
  googleFallbackSearch(input: WizmatchProviderCompanyInput): Promise<WizmatchProviderCandidate[]>;
  /** Absolute last resort: generic mailbox guesses (info@/hello@) when nothing else is found. */
  genericGuessSearch(input: WizmatchProviderCompanyInput): Promise<WizmatchProviderCandidate[]>;
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
      const candidates: WizmatchProviderCandidate[] = [];
      const seen = new Set<string>();

      // Published emails scraped from careers/contact pages. No SMTP verification
      // needed — the company put these there to be contacted. Each is classified
      // into a hiring team so generic inboxes are visibly separated from real ones.
      let published: Awaited<ReturnType<typeof collectWebsiteEmails>> = [];
      try {
        published = await collectWebsiteEmails(websiteUrl, DISCOVERY_SCRAPE_PATHS);
      } catch (error) {
        logger.warn({ err: error, domain: input.domain }, '[wizmatch-contact-discovery] website scrape failed');
      }
      for (const item of published) {
        if (seen.has(item.email)) continue;
        seen.add(item.email);
        const prefix = item.email.split('@')[0] || '';
        const role = classifyEmailPrefix(prefix);
        candidates.push({
          name: role.isTarget ? `${role.team} (inbox)` : 'Generic inbox',
          title: role.isTarget ? `Published ${role.team} inbox` : 'Generic published email',
          email: item.email,
          linkedinUrl: null,
          source: 'website_manual_pattern',
          sourceUrl: websiteUrl,
          deliverabilityStatus: 'unverified',
          confidenceScore: role.isTarget ? 8 : 4,
          rankingScore: role.rank,
          costCents: 0,
          reasons: [
            role.isTarget
              ? `Published ${role.team} inbox scraped from the company website — safe to contact.`
              : 'Generic email published on the site (reception/marketing) — not a specific hiring contact.',
          ],
          raw: {
            confidenceTier: (role.isTarget ? 'high' : 'low') as WizmatchConfidenceTier,
            team: role.team,
            roleCategory: role.category,
            mxProvider,
            catchAll: false,
            verificationDone: true,
          },
        });
      }
      // Rank the good (role-relevant) inboxes above generic ones.
      candidates.sort((a, b) => b.rankingScore - a.rankingScore);
      return candidates.slice(0, 5);
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
      // Named-people search: find the RIGHT person (Talent/HR/Hiring Manager/Vendor)
      // on LinkedIn via Serper, then guess + verify their personal email.
      const apiKey = process.env.SERPER_API_KEY;
      if (!apiKey) return [];
      try {
        const query = `site:linkedin.com/in (${input.companyName} OR ${input.domain}) ("talent acquisition" OR recruiter OR recruiting OR "hiring manager" OR "engineering manager" OR "human resources" OR "people operations" OR vendor OR procurement)`;
        const res = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, num: 10 }),
          signal: AbortSignal.timeout(10000),
        });
        if (!res.ok) return [];
        const data = await res.json() as { organic?: Array<{ title?: string; link?: string; snippet?: string }> };

        const mxProvider = await classifyMxProvider(input.domain);
        const verifyReliable = mxProvider === 'other';
        const catchAll = verifyReliable ? await detectCatchAll(input.domain, providers.reacherVerify) : null;

        const out: WizmatchProviderCandidate[] = [];
        for (const item of data.organic || []) {
          if (out.length >= 3) break;
          const headline = safeString(item.title);
          // LinkedIn result titles look like "Jane Doe - Technical Recruiter - Acme | LinkedIn".
          const name = headline ? headline.split(/[-|–]/)[0]?.trim() || null : null;
          const roleText = `${headline || ''} ${safeString(item.snippet) || ''}`;
          const role = classifyTitle(roleText);
          if (!role.isTarget || !name) continue;

          const { first, last } = nameToParts(name);
          let email: string | null = null;
          let deliverabilityStatus: WizmatchProviderCandidate['deliverabilityStatus'] = 'unknown';
          let tier: WizmatchConfidenceTier = 'low';
          let confidenceScore = 4;
          const reasons: string[] = [`LinkedIn profile match for ${role.team}.`];

          if (first) {
            const guesses = await guessEmailCandidates(input.domain, first, last);
            // Prefer the `first.last@` pattern (most common corporate format) over `first@`.
            const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, '');
            const firstLast = last ? `${norm(first)}.${norm(last)}@${input.domain}` : null;
            const guess = (firstLast && guesses.includes(firstLast) ? firstLast : guesses[0]) || null;
            if (guess) {
              email = guess;
              reasons.push('Personal email pattern guessed from name + domain.');
              if (verifyReliable && catchAll === false) {
                const verdict = await providers.reacherVerify(guess);
                if (verdict === 'invalid') {
                  email = null; // keep the person + LinkedIn URL even if the guess is bad
                  reasons.push('Guessed email rejected by mail server.');
                } else if (verdict === 'verified') {
                  deliverabilityStatus = 'verified';
                  tier = 'medium';
                  confidenceScore = 7;
                  reasons.push('SMTP-verified as deliverable.');
                }
              } else if (catchAll === true) {
                reasons.push('Catch-all domain — email unconfirmed.');
              } else if (!verifyReliable) {
                reasons.push(`Domain uses ${mxProvider === 'google' ? 'Google Workspace' : 'Microsoft 365'} — email unconfirmed.`);
              }
            }
          }

          out.push({
            name,
            title: headline,
            email,
            linkedinUrl: safeString(item.link),
            source: 'google_fallback',
            sourceUrl: safeString(item.link),
            deliverabilityStatus,
            confidenceScore,
            rankingScore: Math.min(100, role.rank + (deliverabilityStatus === 'verified' ? 6 : 0)),
            costCents: 0,
            reasons,
            raw: {
              confidenceTier: tier,
              team: role.team,
              roleCategory: role.category,
              mxProvider,
              catchAll: catchAll === true,
              verificationDone: true,
            },
          });
        }
        return out;
      } catch (error) {
        logger.warn({ err: error, domain: input.domain }, '[wizmatch-contact-discovery] Named-people (Serper) search failed');
        throw error;
      }
    },

    async genericGuessSearch(input) {
      // Absolute last resort — no published contact and no named person found.
      const websiteUrl = `https://${input.domain}`;
      const mxProvider = await classifyMxProvider(input.domain);
      let guesses: string[] = [];
      try {
        guesses = await guessEmailCandidates(input.domain);
      } catch (error) {
        logger.warn({ err: error, domain: input.domain }, '[wizmatch-contact-discovery] generic guess failed');
      }
      return guesses.slice(0, 3).map((email) => ({
        name: 'Generic inbox',
        title: `Guessed inbox (${email.split('@')[0]})`,
        email,
        linkedinUrl: null,
        source: 'website_manual_pattern' as const,
        sourceUrl: websiteUrl,
        deliverabilityStatus: 'unknown' as const,
        confidenceScore: 3,
        rankingScore: 30,
        costCents: 0,
        reasons: ['Generic mailbox guess (no hiring contact found) — likely reception/marketing, low value for staffing outreach.'],
        raw: {
          confidenceTier: 'low' as WizmatchConfidenceTier,
          team: 'Generic inbox' as WizmatchTeam,
          roleCategory: 'generic',
          mxProvider,
          catchAll: false,
          verificationDone: true,
        },
      }));
    },
  };
  return providers;
}
