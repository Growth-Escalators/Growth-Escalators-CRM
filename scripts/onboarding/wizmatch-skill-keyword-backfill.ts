/**
 * Wizmatch skill-keyword backfill — repairs pre-fix keyword residue on
 * wizmatch_job_signals, re-scores the affected signals, and re-syncs the
 * denormalised required_skills cache on any requirement promoted from them.
 *
 * ── WHY ───────────────────────────────────────────────────────────────────────
 * The canonical extractor (extractCanonicalSkillKeywords,
 * src/services/wizmatchSkillExtraction.ts) landed on 2026-07-16 (commit
 * d31a4eea). Signals created BEFORE that date carry keywords produced by the
 * older, looser extractor: bare `go` / `r` / `express` matched out of ordinary
 * prose, and generic `sap` retained alongside a `sap abap` specialization. The
 * current extractor is incapable of producing those tags — it deliberately
 * excludes very short ambiguous tokens (see its comment) and suppresses generic
 * `sap` when a SAP specialization is present. Those rows were never backfilled.
 *
 * wizmatchSourcing.promoteSignalToRequirement copies `signal.keywords` verbatim
 * into wizmatch_requirements.required_skills, so the noise propagated downstream.
 *
 * ── SAFE BY DEFAULT ───────────────────────────────────────────────────────────
 * Read-only dry run unless `--apply` is passed. `--apply` re-reads live state and
 * aborts (assertWithinTolerance) if the affected-row count drifted from the dry
 * run, then does all writes inside a single BEGIN/COMMIT with ROLLBACK on error.
 * Re-running --apply is a no-op: the second pass re-extracts the same keywords,
 * finds them already equal, and classifies every row as `unchanged`.
 *
 * Usage (dry run — read-only, safe):
 *   DATABASE_URL=... WIZMATCH_TENANT_ID=... npx tsx scripts/onboarding/wizmatch-skill-keyword-backfill.ts
 *
 * Usage (apply — requires explicit owner approval per AGENTS.md):
 *   DATABASE_URL=... WIZMATCH_TENANT_ID=... npx tsx scripts/onboarding/wizmatch-skill-keyword-backfill.ts --apply
 *
 * ── DECISION: the title-token fallback is NOT reused ──────────────────────────
 * extractKeywords (src/services/wizmatchAtsPoller.ts) falls back to significant
 * tokens from the job title whenever the canonical extractor returns zero
 * matches. This backfill deliberately does NOT reuse that fallback, and also
 * deliberately does NOT write an empty array. Both alternatives are bad:
 *
 *   - Reusing the fallback re-creates exactly the class of noise this backfill
 *     exists to remove: arbitrary title tokens that are not skills, which then
 *     get copied into required_skills on promotion and matched against
 *     candidates as if they were real evidence.
 *   - Writing `{}` is worse than leaving the bad value: an empty
 *     required_skills trips the `missing_required_skills` blocker
 *     (src/services/wizmatchRequirementPriority.ts) and drops the readiness band
 *     in the command center (src/services/wizmatchCommandCenter.ts bands on
 *     requiredSkills.length >= 4). A silent readiness downgrade across the
 *     pipeline is a larger operational regression than a few stale tags.
 *
 * So: when the canonical extractor returns zero matches, the row is left
 * COMPLETELY UNTOUCHED and reported as `needs_manual_review`. The backfill's job
 * is to delete provably-wrong machine tags, not to invent replacements — a human
 * decides what a niche/unlisted role should be tagged with. Rows in that bucket
 * are listed explicitly in the report so they cannot be silently forgotten.
 *
 * ── DECISION: required_skills is written via the normalised tables ────────────
 * wizmatch_requirements.required_skills is a DENORMALISED CACHE, not source of
 * truth: replaceRequirementSkills (src/services/wizmatchMatchingDomain.ts)
 * rebuilds it wholesale with ARRAY_AGG over wizmatch_requirement_skills JOIN
 * wizmatch_skills. A direct UPDATE of required_skills would therefore be
 * transient — silently reverted on the next skills edit, or reset to '{}' if no
 * join rows exist. This script writes wizmatch_skills + wizmatch_requirement_skills
 * and then runs the SAME re-sync statement replaceRequirementSkills uses, so the
 * cache is derived, not set.
 */
import 'dotenv/config';
import { Pool, PoolClient } from 'pg';
import { extractCanonicalSkillKeywords } from '../../src/services/wizmatchSkillExtraction';
import { scoreSignal } from '../../src/services/wizmatchScoring';
import { assertWithinTolerance, DEFAULT_BACKFILL_TOLERANCE } from '../../src/modules/outreach/policyBackfill';

/** Slack priority-alert gate in wizmatchSignalPipeline.scoreSignalById. */
const SLACK_PRIORITY_SCORE_THRESHOLD = 7;

/**
 * Presentation labels for wizmatch_skills.canonical_label. The extractor emits
 * lowercase evidence tokens; the skills taxonomy stores human labels (the pilot
 * seed in wizmatchMatchingDomain uses 'SAP ABAP', 'Java', 'JavaScript'). Lookups
 * are case-insensitive against existing rows, so an unmapped label only affects
 * how a NEWLY created skill row is spelled, never whether an existing one is
 * reused.
 */
const SKILL_DISPLAY_LABELS: Record<string, string> = {
  'javascript': 'JavaScript', 'typescript': 'TypeScript', 'c#': 'C#', '.net': '.NET',
  'dotnet': '.NET', '.net core': '.NET Core', 'c++': 'C++', 'php': 'PHP',
  'next.js': 'Next.js', 'graphql': 'GraphQL', 'rest api': 'REST API',
  'aws': 'AWS', 'gcp': 'GCP', 'devops': 'DevOps', 'ci/cd': 'CI/CD',
  'sql': 'SQL', 'mysql': 'MySQL', 'mongodb': 'MongoDB', 'etl': 'ETL',
  'power bi': 'Power BI', 'ml': 'ML', 'nlp': 'NLP', 'pytorch': 'PyTorch',
  'tensorflow': 'TensorFlow', 'sap': 'SAP', 'sap abap': 'SAP ABAP',
  'sap fico': 'SAP FICO', 'sap mm': 'SAP MM', 'dynamics 365': 'Dynamics 365',
  'mulesoft': 'MuleSoft', 'cobol': 'COBOL', 'ios': 'iOS', 'qa': 'QA',
  'ui/ux': 'UI/UX', 'sre': 'SRE', 'ai': 'AI', 'go': 'Go',
};

function titleCase(value: string): string {
  return value.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

/** Extractor label → the (family, specialization, canonical_label) triple. */
export function toSkillTaxonomy(label: string): { family: string; specialization: string; canonicalLabel: string } {
  const canonicalLabel = SKILL_DISPLAY_LABELS[label] ?? titleCase(label);
  if (label.startsWith('sap ') && label !== 'sap') {
    return { family: 'SAP', specialization: canonicalLabel.replace(/^SAP\s+/i, ''), canonicalLabel };
  }
  return { family: canonicalLabel, specialization: canonicalLabel, canonicalLabel };
}

export type SignalOutcome = 'rewrite' | 'unchanged' | 'needs_manual_review';

export interface SignalPlan {
  signalId: string;
  jobTitle: string;
  outcome: SignalOutcome;
  keywordsBefore: string[];
  keywordsAfter: string[];
  removed: string[];
  added: string[];
  scoreBefore: number;
  scoreAfter: number;
  /** Whether the rewrite moves this signal across the score>=7 Slack alert gate. */
  slackThresholdCrossing: 'none' | 'drops_below_threshold' | 'rises_to_threshold';
  breakdownAfter: Record<string, unknown>;
  /** Requirements promoted from this signal whose skill rows would be rewritten. */
  requirements: Array<{ requirementId: string; title: string; requiredSkillsBefore: string[] }>;
}

interface SignalRow {
  id: string;
  job_title: string;
  keywords: string[] | null;
  score: number | null;
  days_open: number | null;
  first_seen_at: Date | string | null;
  repost_count: number | null;
  employment_type: string | null;
  location: string | null;
  raw_text: string | null;
  h1b_sponsor_count: number | null;
  company_volume: number | null;
}

interface RequirementRow {
  id: string;
  source_job_signal_id: string;
  title: string;
  required_skills: string[] | null;
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().join(' ') === [...b].sort().join(' ');

/**
 * Pure — turns already-fetched rows into the per-signal plan, including the
 * before/after score. Kept separate from all IO so it stays testable.
 */
export function buildSignalPlans(signals: SignalRow[], requirements: RequirementRow[]): SignalPlan[] {
  const bySignal = new Map<string, RequirementRow[]>();
  for (const requirement of requirements) {
    const list = bySignal.get(requirement.source_job_signal_id) ?? [];
    list.push(requirement);
    bySignal.set(requirement.source_job_signal_id, list);
  }

  return signals.map((row) => {
    const keywordsBefore = row.keywords ?? [];
    // Same evidence surface the ATS poller feeds the extractor: title + raw text.
    const keywordsAfter = extractCanonicalSkillKeywords(`${row.job_title ?? ''} ${row.raw_text ?? ''}`);

    // Mirror wizmatchSignalPipeline.scoreSignalById exactly, so the recomputed
    // score is the one the live pipeline would produce for these keywords.
    const daysOpen = row.days_open
      || Math.floor((Date.now() - new Date(row.first_seen_at ?? Date.now()).getTime()) / 86_400_000);
    const scoreInput = {
      daysOpen,
      repostCount: row.repost_count || 0,
      companyVolumeCount: row.company_volume || 0,
      employmentType: row.employment_type,
      h1bSponsorCount: row.h1b_sponsor_count || 0,
      location: row.location,
      jobTitle: row.job_title,
      rawText: row.raw_text,
    };
    const after = scoreSignal({ ...scoreInput, keywords: keywordsAfter });
    // Recompute the "before" score from the OLD keywords rather than trusting the
    // stored value: the stored score may itself predate scoring-rubric changes, and
    // the meaningful delta is the one attributable to the keyword rewrite alone.
    const before = scoreSignal({ ...scoreInput, keywords: keywordsBefore });

    const outcome: SignalOutcome = keywordsAfter.length === 0
      ? 'needs_manual_review'
      : sameSet(keywordsBefore, keywordsAfter) ? 'unchanged' : 'rewrite';

    const crossedDown = before.score >= SLACK_PRIORITY_SCORE_THRESHOLD && after.score < SLACK_PRIORITY_SCORE_THRESHOLD;
    const crossedUp = before.score < SLACK_PRIORITY_SCORE_THRESHOLD && after.score >= SLACK_PRIORITY_SCORE_THRESHOLD;

    return {
      signalId: row.id,
      jobTitle: row.job_title,
      outcome,
      keywordsBefore,
      keywordsAfter,
      removed: keywordsBefore.filter((k) => !keywordsAfter.includes(k)),
      added: keywordsAfter.filter((k) => !keywordsBefore.includes(k)),
      scoreBefore: before.score,
      scoreAfter: after.score,
      slackThresholdCrossing: outcome !== 'rewrite' ? 'none'
        : crossedDown ? 'drops_below_threshold'
        : crossedUp ? 'rises_to_threshold' : 'none',
      breakdownAfter: {
        ...after.breakdown,
        region: after.region,
        reasoning: after.reasoning,
        urgencyLevel: after.urgencyLevel,
        strugglingScore: after.strugglingScore,
        c2cFriendly: after.c2cFriendly,
      },
      requirements: (bySignal.get(row.id) ?? []).map((r) => ({
        requirementId: r.id,
        title: r.title,
        requiredSkillsBefore: r.required_skills ?? [],
      })),
    };
  });
}

// ── IO ───────────────────────────────────────────────────────────────────────

async function fetchSignals(pool: Pool, tenantId: string): Promise<SignalRow[]> {
  const result = await pool.query<SignalRow>(
    `SELECT s.id, s.job_title, s.keywords, s.score, s.days_open, s.first_seen_at,
            s.repost_count, s.employment_type, s.location, s.raw_text,
            c.h1b_sponsor_count,
            (SELECT COUNT(*)::int FROM wizmatch_job_signals s2
              WHERE s2.company_id = s.company_id AND s2.status NOT IN ('dead','placed')) AS company_volume
       FROM wizmatch_job_signals s
       LEFT JOIN wizmatch_companies c ON c.id = s.company_id
      WHERE s.tenant_id = $1
      ORDER BY s.created_at ASC`,
    [tenantId],
  );
  return result.rows;
}

async function fetchRequirements(pool: Pool, tenantId: string): Promise<RequirementRow[]> {
  const result = await pool.query<RequirementRow>(
    `SELECT id, source_job_signal_id, title, required_skills
       FROM wizmatch_requirements
      WHERE tenant_id = $1 AND source_job_signal_id IS NOT NULL`,
    [tenantId],
  );
  return result.rows;
}

/**
 * Resolve (or create) a wizmatch_skills row per extractor label. Matching is
 * case-insensitive so we reuse the pilot-seeded 'SAP ABAP' / 'Java' rows instead
 * of creating near-duplicates; the unique index is on the exact label, which
 * would not stop 'Sap Abap' from landing next to 'SAP ABAP'.
 */
async function resolveSkillIds(client: PoolClient, tenantId: string, labels: string[]): Promise<Map<string, string>> {
  const existing = await client.query<{ id: string; canonical_label: string }>(
    `SELECT id, canonical_label FROM wizmatch_skills WHERE tenant_id = $1`,
    [tenantId],
  );
  const byLower = new Map(existing.rows.map((r) => [r.canonical_label.toLowerCase(), r.id]));
  const resolved = new Map<string, string>();

  for (const label of labels) {
    const taxonomy = toSkillTaxonomy(label);
    const hit = byLower.get(taxonomy.canonicalLabel.toLowerCase());
    if (hit) { resolved.set(label, hit); continue; }
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO wizmatch_skills (tenant_id, family, specialization, canonical_label)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, canonical_label)
       DO UPDATE SET active = true, updated_at = NOW()
       RETURNING id`,
      [tenantId, taxonomy.family, taxonomy.specialization, taxonomy.canonicalLabel],
    );
    byLower.set(taxonomy.canonicalLabel.toLowerCase(), inserted.rows[0].id);
    resolved.set(label, inserted.rows[0].id);
  }
  return resolved;
}

async function applyPlans(pool: Pool, tenantId: string, plans: SignalPlan[]): Promise<Record<string, number>> {
  const rewrites = plans.filter((p) => p.outcome === 'rewrite');
  const counts = { signalsUpdated: 0, requirementSkillRowsWritten: 0, requirementsResynced: 0 };
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const allLabels = Array.from(new Set(rewrites.flatMap((p) => p.keywordsAfter)));
    const skillIds = await resolveSkillIds(client, tenantId, allLabels);

    for (const plan of rewrites) {
      // Idempotent by construction: re-running writes the same array and the same
      // derived score, so a second --apply changes nothing. `status` and
      // `days_open` are deliberately left alone — this is a keyword repair, not a
      // pipeline-stage transition.
      await client.query(
        `UPDATE wizmatch_job_signals
            SET keywords = $3::text[], score = $4, score_breakdown = $5::jsonb
          WHERE tenant_id = $1 AND id = $2`,
        [tenantId, plan.signalId, plan.keywordsAfter, plan.scoreAfter, JSON.stringify(plan.breakdownAfter)],
      );
      counts.signalsUpdated += 1;

      for (const requirement of plan.requirements) {
        // Write the NORMALISED rows, then let the same ARRAY_AGG re-sync that
        // replaceRequirementSkills uses derive required_skills. A direct UPDATE of
        // required_skills would be reverted by the next skills edit.
        await client.query(
          `DELETE FROM wizmatch_requirement_skills WHERE tenant_id = $1 AND requirement_id = $2`,
          [tenantId, requirement.requirementId],
        );
        for (const label of plan.keywordsAfter) {
          await client.query(
            `INSERT INTO wizmatch_requirement_skills
               (tenant_id, requirement_id, skill_id, importance, evidence)
             VALUES ($1, $2, $3, 'mandatory', $4)
             ON CONFLICT (tenant_id, requirement_id, skill_id) DO NOTHING`,
            [tenantId, requirement.requirementId, skillIds.get(label), 'wizmatch-skill-keyword-backfill'],
          );
          counts.requirementSkillRowsWritten += 1;
        }
        await client.query(
          `UPDATE wizmatch_requirements requirement SET
             required_skills=COALESCE((SELECT ARRAY_AGG(skill.canonical_label ORDER BY skill.canonical_label) FROM wizmatch_requirement_skills rs JOIN wizmatch_skills skill ON skill.id=rs.skill_id AND skill.tenant_id=rs.tenant_id WHERE rs.tenant_id=$1 AND rs.requirement_id=$2 AND rs.importance='mandatory'),'{}'::text[]),
             nice_to_have_skills=COALESCE((SELECT ARRAY_AGG(skill.canonical_label ORDER BY skill.canonical_label) FROM wizmatch_requirement_skills rs JOIN wizmatch_skills skill ON skill.id=rs.skill_id AND skill.tenant_id=rs.tenant_id WHERE rs.tenant_id=$1 AND rs.requirement_id=$2 AND rs.importance='preferred'),'{}'::text[]),
             last_activity_at=NOW(),updated_at=NOW()
           WHERE requirement.tenant_id=$1 AND requirement.id=$2`,
          [tenantId, requirement.requirementId],
        );
        counts.requirementsResynced += 1;
      }
    }

    await client.query('COMMIT');
    return counts;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Expected downstream drift — reported, never silently ignored. */
const COLLATERAL = [
  'wizmatch_job_signals.matched_candidate_ids goes stale: wizmatchMatching uses keywords as a SQL prefilter, so re-running match is required to refresh it.',
  'Candidate fit percentages shift (wizmatchCandidateIntelligence) because they are derived from the requirement skill set.',
  'Signals crossing score>=7 in either direction change whether wizmatchSignalPipeline would fire a Slack priority alert on the NEXT scoring run (this script never sends Slack).',
  'wizmatch_job_signals_keywords_idx is rewritten for every touched row — negligible at this row count, but relevant if this is ever re-run at scale.',
  'Requirement readiness/priority can change: an empty or shorter required_skills affects the missing_required_skills blocker and the requiredSkills.length >= 4 readiness band.',
  'wizmatch_requirement_skills rows created here have created_by = NULL and evidence = wizmatch-skill-keyword-backfill, distinguishing them from human-curated rows.',
];

async function main(): Promise<void> {
  const tenantId = process.env.WIZMATCH_TENANT_ID;
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) { console.error('DATABASE_URL not set'); process.exit(1); }
  if (!tenantId) { console.error('WIZMATCH_TENANT_ID not set'); process.exit(1); }

  const apply = process.argv.includes('--apply');
  const tolerance = Number(process.env.WIZMATCH_BACKFILL_TOLERANCE ?? DEFAULT_BACKFILL_TOLERANCE);

  // Public Railway Postgres uses a self-signed cert; the app pool sets the same.
  const ssl = /railway\.internal/.test(connectionString) ? undefined : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString, ssl, connectionTimeoutMillis: 20_000 });

  try {
    const plans = buildSignalPlans(await fetchSignals(pool, tenantId), await fetchRequirements(pool, tenantId));
    const rewrites = plans.filter((p) => p.outcome === 'rewrite');

    console.log(JSON.stringify({
      mode: apply ? 'apply' : 'dry_run',
      tenantId,
      totalSignals: plans.length,
      rewriteCount: rewrites.length,
      unchangedCount: plans.filter((p) => p.outcome === 'unchanged').length,
      needsManualReviewCount: plans.filter((p) => p.outcome === 'needs_manual_review').length,
      slackThresholdCrossings: rewrites.filter((p) => p.slackThresholdCrossing !== 'none')
        .map((p) => ({ signalId: p.signalId, jobTitle: p.jobTitle, from: p.scoreBefore, to: p.scoreAfter, crossing: p.slackThresholdCrossing })),
      requirementsAffected: rewrites.flatMap((p) => p.requirements.map((r) => r.requirementId)),
      plans,
      expectedCollateral: COLLATERAL,
    }, null, 2));

    if (!apply) {
      console.log('\nDry run only — nothing written. Pass --apply (with explicit owner approval) to write.');
      return;
    }

    // Guard: re-read live state immediately before writing and abort on drift.
    const live = buildSignalPlans(await fetchSignals(pool, tenantId), await fetchRequirements(pool, tenantId));
    assertWithinTolerance(rewrites.length, live.filter((p) => p.outcome === 'rewrite').length, tolerance);

    const counts = await applyPlans(pool, tenantId, live);
    console.log(JSON.stringify({ mode: 'apply', tenantId, ...counts }, null, 2));
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[wizmatch skill-keyword backfill] failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
