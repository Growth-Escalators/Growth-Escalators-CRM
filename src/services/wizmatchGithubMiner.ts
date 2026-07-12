/**
 * Wizmatch GitHub Miner Service
 *
 * Uses GitHub Search API to find developers by location + language.
 * For users with public email: verify via MillionVerifier (optional),
 * then create contacts + wizmatch_candidates records.
 *
 * GitHub API: 5000 req/hr with token, 60 req/hr without.
 *
 * Called by the GitHub Miner cron in worker.ts (daily 9 AM IST).
 */

import { pool } from '../db/index';
import { db } from '../db/index';
import { wizmatchCandidates } from '../db/schema';
import { findOrCreateContact } from './contactService';
import logger from '../utils/logger';

// ── Types ────────────────────────────────────────────────────────────────────

interface GithubUser {
  login: string;
  id: number;
  name: string | null;
  email: string | null;
  location: string | null;
  bio: string | null;
  company: string | null;
  blog: string | null;
  html_url: string;
  public_repos: number;
  followers: number;
}

interface SearchQuery {
  q: string;
  label: string;
}

interface MineResult {
  queries_run: number;
  users_found: number;
  candidates_created: number;
  skipped_no_email: number;
  skipped_exists: number;
  errors: number;
}

// ── Search queries ───────────────────────────────────────────────────────────
// Rotating set of queries — GitHub search has a 1000-result hard cap per query,
// so we use targeted location+language combos to stay under it.

const SEARCH_QUERIES: SearchQuery[] = [
  { q: 'location:dallas language:java', label: 'Dallas Java' },
  { q: 'location:austin language:python', label: 'Austin Python' },
  { q: 'location:seattle language:typescript', label: 'Seattle TypeScript' },
  { q: 'location:"san francisco" language:react', label: 'SF React' },
  { q: 'location:"new york" language:javascript', label: 'NYC JavaScript' },
  { q: 'location:denver language:go', label: 'Denver Go' },
  { q: 'location:bangalore language:java', label: 'Bangalore Java' },
  { q: 'location:bangalore language:python', label: 'Bangalore Python' },
  { q: 'location:hyderabad language:react', label: 'Hyderabad React' },
  { q: 'location:pune language:.net', label: 'Pune .NET' },
  { q: 'location:chennai language:java', label: 'Chennai Java' },
  { q: 'location:"remote" language:node', label: 'Remote Node' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

const SKILL_MAP: Record<string, string[]> = {
  java: ['java', 'spring'],
  python: ['python', 'django', 'flask'],
  typescript: ['typescript', 'node'],
  javascript: ['javascript', 'react', 'node'],
  react: ['react', 'javascript', 'frontend'],
  go: ['go', 'golang', 'backend'],
  node: ['node', 'nodejs', 'backend'],
  '.net': ['.net', 'c#', 'dotnet'],
};

function extractSkillsFromQuery(query: string): string[] {
  const langMatch = query.match(/language:(\S+)/);
  if (!langMatch) return [];
  const lang = langMatch[1].toLowerCase();
  return SKILL_MAP[lang] || [lang];
}

function inferVisaStatus(location: string | null): string {
  if (!location) return 'unknown';
  const lower = location.toLowerCase();
  if (lower.includes('india') || lower.includes('bangalore') || lower.includes('hyderabad') ||
      lower.includes('pune') || lower.includes('chennai') || lower.includes('delhi') ||
      lower.includes('mumbai')) {
    return 'unknown'; // India-based — no US visa assumption
  }
  return 'unknown'; // Can't infer from GitHub alone
}

// ── Main miner ───────────────────────────────────────────────────────────────

export async function mineGithubCandidates(
  maxQueries = 3,
  adhocQuery?: { skill: string; location: string },
): Promise<MineResult> {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  const githubToken = process.env.GITHUB_TOKEN;

  if (!tenantId) {
    logger.warn('[wizmatch-github] WIZMATCH_TENANT_ID not set — skipping');
    return { queries_run: 0, users_found: 0, candidates_created: 0, skipped_no_email: 0, skipped_exists: 0, errors: 0 };
  }

  let todayQueries: SearchQuery[];
  if (adhocQuery) {
    // On-demand path (recruiter-triggered "Source now"): run exactly ONE query for
    // the requested skill+location. Does not touch the daily rotating cron set below.
    todayQueries = [{
      q: `location:"${adhocQuery.location}" language:${adhocQuery.skill}`,
      label: `Adhoc: ${adhocQuery.skill} in ${adhocQuery.location}`,
    }];
  } else {
    // Rotate queries day-by-day
    const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400000);
    const startIdx = (dayOfYear * maxQueries) % SEARCH_QUERIES.length;
    todayQueries = Array.from({ length: Math.min(maxQueries, SEARCH_QUERIES.length) }, (_, i) =>
      SEARCH_QUERIES[(startIdx + i) % SEARCH_QUERIES.length],
    );
  }

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'Wizmatch-Bot',
  };
  if (githubToken) headers.Authorization = `token ${githubToken}`;

  let totalFound = 0;
  let totalCreated = 0;
  let skippedNoEmail = 0;
  let skippedExists = 0;
  let totalErrors = 0;

  for (const search of todayQueries) {
    try {
      const searchUrl = `https://api.github.com/search/users?q=${encodeURIComponent(search.q)}&per_page=30&sort=joined&order=desc`;
      const searchRes = await fetch(searchUrl, { headers, signal: AbortSignal.timeout(15000) });

      if (!searchRes.ok) {
        const body = await searchRes.text().catch(() => '');
        logger.warn(`[wizmatch-github] Search failed for "${search.label}": ${searchRes.status} ${body.slice(0, 200)}`);
        // Rate limit — back off
        if (searchRes.status === 403) {
          const remaining = searchRes.headers.get('x-ratelimit-remaining');
          if (remaining === '0') {
            logger.warn('[wizmatch-github] Rate limited — stopping');
            break;
          }
        }
        totalErrors++;
        continue;
      }

      const searchData = await searchRes.json() as { items: Array<{ login: string; html_url: string }> };
      totalFound += searchData.items?.length || 0;

      // Fetch full profile for each user
      for (const item of searchData.items || []) {
        try {
          const userRes = await fetch(`https://api.github.com/users/${item.login}`, {
            headers, signal: AbortSignal.timeout(10000),
          });
          if (!userRes.ok) { totalErrors++; continue; }

          const user = await userRes.json() as GithubUser;

          // Skip if no public email
          if (!user.email || !user.email.includes('@')) {
            skippedNoEmail++;
            continue;
          }

          // Check if candidate already exists (by GitHub URL or email)
          const existing = await pool.query(
            `SELECT id FROM wizmatch_candidates
             WHERE tenant_id = $1 AND github_url = $2`,
            [tenantId, user.html_url],
          ).catch(() => ({ rows: [] }));

          if (existing.rows.length > 0) {
            skippedExists++;
            continue;
          }

          // Also check by email in contacts
          const existingContact = await pool.query(
            `SELECT c.id FROM contacts c
             JOIN contact_channels cc ON cc.contact_id = c.id
             WHERE c.tenant_id = $1 AND cc.channel_type = 'email' AND cc.channel_value = $2
             LIMIT 1`,
            [tenantId, user.email.toLowerCase()],
          ).catch(() => ({ rows: [] }));

          if (existingContact.rows.length > 0) {
            skippedExists++;
            continue;
          }

          // Parse name
          const fullName = user.name || user.login;
          const [firstName, ...lastNameParts] = fullName.split(' ');

          const skills = extractSkillsFromQuery(search.q);

          // Create contact + candidate
          const { contact } = await findOrCreateContact(tenantId, {
            firstName,
            lastName: lastNameParts.join(' ') || undefined,
            source: 'wizmatch_github',
            sourceDetail: `GitHub: ${user.login} (${user.public_repos} repos, ${user.followers} followers)`,
            channels: [{ channelType: 'email', channelValue: user.email.toLowerCase(), isPrimary: true }],
            tags: ['Candidate'],
          });

          await db.insert(wizmatchCandidates).values({
            tenantId,
            contactId: contact.id,
            skills,
            location: user.location || null,
            visaStatus: inferVisaStatus(user.location),
            source: 'github',
            githubUrl: user.html_url,
            linkedinUrl: user.blog || null,
          }).onConflictDoNothing();

          totalCreated++;
        } catch (e) {
          totalErrors++;
          logger.error(`[wizmatch-github] Error processing user ${item.login}:`, e instanceof Error ? e.message : String(e));
        }

        // Small delay to be nice to the API
        await new Promise((r) => setTimeout(r, 200));
      }
    } catch (e) {
      totalErrors++;
      logger.error(`[wizmatch-github] Query "${search.label}" failed:`, e instanceof Error ? e.message : String(e));
    }

    // Delay between searches
    await new Promise((r) => setTimeout(r, 2000));
  }

  logger.info(
    `[wizmatch-github] Mined ${todayQueries.length} queries: ${totalFound} users found, ${totalCreated} candidates created, ${skippedNoEmail} no email, ${skippedExists} already existed, ${totalErrors} errors`,
  );

  return {
    queries_run: todayQueries.length,
    users_found: totalFound,
    candidates_created: totalCreated,
    skipped_no_email: skippedNoEmail,
    skipped_exists: skippedExists,
    errors: totalErrors,
  };
}