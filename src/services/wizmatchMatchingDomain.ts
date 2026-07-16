import type { Pool, PoolClient } from 'pg';
import { pool } from '../db';
import { StaffingDomainError } from './wizmatchStaffingDomain';

export const MATCH_SCORE_VERSION = 'gate-b-v1';
export const MATCH_DECISIONS = ['unreviewed', 'shortlisted', 'watch', 'rejected', 'blocked'] as const;

type Skill = {
  id: string;
  family: string;
  specialization: string;
  canonicalLabel: string;
  importance?: string;
  minimumYears?: number | null;
  allowBroadFamily?: boolean;
  experienceYears?: number | null;
  lastUsedAt?: string | null;
  evidence?: string | null;
  confidence?: number | null;
  verified?: boolean;
};

export type MatchInput = {
  requirement: { location?: string | null; workMode?: string | null; normalizedBudgetMaxAnnual?: number | null; skills: Skill[] };
  candidate: { availabilityStatus?: string | null; location?: string | null; normalizedAnnualRate?: number | null; authorizationMismatch?: boolean; skills: Skill[] };
};

function sameText(a: unknown, b: unknown) {
  return String(a ?? '').trim().toLowerCase() === String(b ?? '').trim().toLowerCase();
}

function candidateSkill(requirementSkill: Skill, skills: Skill[]) {
  return skills.find((skill) => skill.id === requirementSkill.id)
    ?? (requirementSkill.allowBroadFamily ? skills.find((skill) => sameText(skill.family, requirementSkill.family)) : undefined);
}

export function calculateCandidateRequirementMatch(input: MatchInput) {
  const blockers: string[] = [];
  const missingEvidence: string[] = [];
  const mandatory = input.requirement.skills.filter((skill) => skill.importance === 'mandatory');
  const preferred = input.requirement.skills.filter((skill) => skill.importance === 'preferred');
  const mandatoryMatches = mandatory.map((skill) => ({ required: skill, candidate: candidateSkill(skill, input.candidate.skills) }));
  for (const pair of mandatoryMatches) {
    if (!pair.candidate) blockers.push(`missing_mandatory:${pair.required.canonicalLabel}`);
    else if (pair.required.minimumYears != null && (pair.candidate.experienceYears ?? 0) < pair.required.minimumYears) {
      blockers.push(`insufficient_experience:${pair.required.canonicalLabel}`);
    }
  }
  if (input.candidate.authorizationMismatch) blockers.push('work_authorization');
  if (['placed', 'unavailable'].includes(input.candidate.availabilityStatus ?? '')) blockers.push('availability');
  if (input.requirement.workMode !== 'remote' && input.requirement.location && input.candidate.location
      && !sameText(input.requirement.location, input.candidate.location)) blockers.push('location');
  if (input.requirement.normalizedBudgetMaxAnnual != null && input.candidate.normalizedAnnualRate != null
      && input.candidate.normalizedAnnualRate > input.requirement.normalizedBudgetMaxAnnual) blockers.push('commercial');

  for (const pair of mandatoryMatches) {
    if (pair.candidate && !pair.candidate.evidence) missingEvidence.push(`skill_evidence:${pair.required.canonicalLabel}`);
    if (pair.candidate && pair.candidate.lastUsedAt == null) missingEvidence.push(`recency:${pair.required.canonicalLabel}`);
  }

  const mandatoryScore = mandatory.length ? Math.round(50 * mandatoryMatches.filter((pair) => pair.candidate).length / mandatory.length) : 50;
  const preferredScore = preferred.length ? Math.round(15 * preferred.filter((skill) => candidateSkill(skill, input.candidate.skills)).length / preferred.length) : 15;
  const matchedSkills = mandatoryMatches.map((pair) => pair.candidate).filter(Boolean) as Skill[];
  const evidenceScore = matchedSkills.length
    ? Math.round(15 * matchedSkills.reduce((sum, skill) => sum + (skill.verified ? 1 : skill.evidence ? 0.7 : 0) + (skill.lastUsedAt ? 0.3 : 0), 0) / (matchedSkills.length * 1.3))
    : 0;
  const dimensions = {
    mandatorySkills: mandatoryScore,
    preferredSkills: preferredScore,
    experienceRecencyEvidence: Math.min(15, evidenceScore),
    locationAuthorization: blockers.some((b) => ['location', 'work_authorization'].includes(b)) ? 0 : 8,
    availability: blockers.includes('availability') ? 0 : 7,
    commercial: blockers.includes('commercial') ? 0 : 5,
  };
  const rawScore = Object.values(dimensions).reduce((sum, value) => sum + value, 0);
  return { score: blockers.length ? 0 : Math.min(100, rawScore), scoreVersion: MATCH_SCORE_VERSION, dimensions, blockers, missingEvidence };
}

function text(value: unknown, name: string) {
  if (typeof value !== 'string' || !value.trim()) throw new StaffingDomainError(400, 'validation_error', `${name} is required`);
  return value.trim();
}

async function tenantRow(client: Pick<PoolClient, 'query'>, table: string, tenantId: string, id: string) {
  const allowed = new Set(['wizmatch_skills', 'wizmatch_requirements', 'wizmatch_candidates', 'wizmatch_candidate_requirement_matches']);
  if (!allowed.has(table)) throw new Error('Unsafe tenant table');
  const result = await client.query(`SELECT id FROM ${table} WHERE tenant_id=$1 AND id=$2`, [tenantId, id]);
  if (!result.rowCount) throw new StaffingDomainError(404, 'not_found', 'Referenced record was not found');
}

async function transaction<T>(dbPool: Pick<Pool, 'connect'>, fn: (client: PoolClient) => Promise<T>) {
  const client = await dbPool.connect();
  try { await client.query('BEGIN'); const result = await fn(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

export function createWizmatchMatchingService(dbPool: Pool = pool) {
  return {
    async listSkills(tenantId: string) {
      const result = await dbPool.query(`SELECT s.*,COALESCE(json_agg(a ORDER BY a.raw_alias) FILTER (WHERE a.id IS NOT NULL),'[]') aliases FROM wizmatch_skills s LEFT JOIN wizmatch_skill_aliases a ON a.tenant_id=s.tenant_id AND a.skill_id=s.id WHERE s.tenant_id=$1 GROUP BY s.id ORDER BY s.family,s.specialization`, [tenantId]);
      return result.rows;
    },

    async createSkill(actor: { tenantId: string; userId: string }, input: Record<string, unknown>) {
      const family = text(input.family, 'family');
      const specialization = text(input.specialization, 'specialization');
      const canonicalLabel = text(input.canonicalLabel, 'canonicalLabel');
      const result = await dbPool.query(`INSERT INTO wizmatch_skills (tenant_id,family,specialization,platform_version,canonical_label,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [actor.tenantId, family, specialization, input.platformVersion || null, canonicalLabel, actor.userId]);
      return result.rows[0];
    },

    async seedPilotTaxonomy(actor: { tenantId: string; userId: string }) {
      const seeds = [
        { family: 'SAP', specialization: 'ABAP', label: 'SAP ABAP', aliases: ['sap abap', 'abap developer'] },
        { family: 'SAP', specialization: 'FICO', label: 'SAP FICO', aliases: ['sap fico', 'sap fi co'] },
        { family: 'Java', specialization: 'Java', label: 'Java', aliases: ['java', 'java developer'] },
        { family: 'JavaScript', specialization: 'JavaScript', label: 'JavaScript', aliases: ['javascript', 'js developer'] },
      ];
      return transaction(dbPool, async (client) => {
        for (const seed of seeds) {
          const skill = await client.query(`INSERT INTO wizmatch_skills (tenant_id,family,specialization,canonical_label,created_by) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id,canonical_label) DO UPDATE SET family=EXCLUDED.family,specialization=EXCLUDED.specialization,active=true,updated_at=NOW() RETURNING id`, [actor.tenantId, seed.family, seed.specialization, seed.label, actor.userId]);
          for (const alias of seed.aliases) {
            await client.query(`INSERT INTO wizmatch_skill_aliases (tenant_id,skill_id,raw_alias,normalized_alias,provenance,reviewed_by) VALUES ($1,$2,$3,$3,'pilot_seed',$4) ON CONFLICT (tenant_id,normalized_alias) DO NOTHING`, [actor.tenantId, skill.rows[0].id, alias, actor.userId]);
          }
        }
        return { seeded: seeds.length, labels: seeds.map((seed) => seed.label) };
      });
    },

    async addAlias(actor: { tenantId: string; userId: string }, skillId: string, input: Record<string, unknown>) {
      await tenantRow(dbPool as unknown as PoolClient, 'wizmatch_skills', actor.tenantId, skillId);
      const raw = text(input.alias, 'alias');
      const normalized = raw.normalize('NFKC').toLowerCase().replace(/[^a-z0-9+#.]+/g, ' ').trim();
      const result = await dbPool.query(`INSERT INTO wizmatch_skill_aliases (tenant_id,skill_id,raw_alias,normalized_alias,provenance,reviewed_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [actor.tenantId, skillId, raw, normalized, input.provenance || 'manual', actor.userId]);
      return result.rows[0];
    },

    async replaceRequirementSkills(actor: { tenantId: string; userId: string }, requirementId: string, skills: unknown[]) {
      return transaction(dbPool, async (client) => {
        await tenantRow(client, 'wizmatch_requirements', actor.tenantId, requirementId);
        for (const raw of skills) {
          const item = raw as Record<string, unknown>;
          const skillId = text(item.skillId, 'skillId');
          await tenantRow(client, 'wizmatch_skills', actor.tenantId, skillId);
          const importance = item.importance === 'preferred' ? 'preferred' : 'mandatory';
          await client.query(`INSERT INTO wizmatch_requirement_skills (tenant_id,requirement_id,skill_id,importance,minimum_years,evidence,allow_broad_family,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id,requirement_id,skill_id) DO UPDATE SET importance=EXCLUDED.importance,minimum_years=EXCLUDED.minimum_years,evidence=EXCLUDED.evidence,allow_broad_family=EXCLUDED.allow_broad_family,updated_at=NOW()`, [actor.tenantId, requirementId, skillId, importance, item.minimumYears ?? null, item.evidence || null, item.allowBroadFamily === true, actor.userId]);
        }
        await client.query(
          `UPDATE wizmatch_requirements requirement SET
             required_skills=COALESCE((SELECT ARRAY_AGG(skill.canonical_label ORDER BY skill.canonical_label) FROM wizmatch_requirement_skills rs JOIN wizmatch_skills skill ON skill.id=rs.skill_id AND skill.tenant_id=rs.tenant_id WHERE rs.tenant_id=$1 AND rs.requirement_id=$2 AND rs.importance='mandatory'),'{}'::text[]),
             nice_to_have_skills=COALESCE((SELECT ARRAY_AGG(skill.canonical_label ORDER BY skill.canonical_label) FROM wizmatch_requirement_skills rs JOIN wizmatch_skills skill ON skill.id=rs.skill_id AND skill.tenant_id=rs.tenant_id WHERE rs.tenant_id=$1 AND rs.requirement_id=$2 AND rs.importance='preferred'),'{}'::text[]),
             last_activity_at=NOW(),updated_at=NOW()
           WHERE requirement.tenant_id=$1 AND requirement.id=$2`,
          [actor.tenantId, requirementId],
        );
        await client.query(`INSERT INTO wizmatch_staffing_events (tenant_id,actor_user_id,event_type,requirement_id,payload) VALUES ($1,$2,'requirement_skills_upserted',$3,$4::jsonb)`, [actor.tenantId, actor.userId, requirementId, JSON.stringify({ upserted: skills.length, omittedPreserved: true })]);
        return { requirementId, count: skills.length, upserted: skills.length, omittedPreserved: true };
      });
    },

    async replaceCandidateSkills(actor: { tenantId: string; userId: string }, candidateId: string, skills: unknown[]) {
      return transaction(dbPool, async (client) => {
        await tenantRow(client, 'wizmatch_candidates', actor.tenantId, candidateId);
        for (const raw of skills) {
          const item = raw as Record<string, unknown>;
          const skillId = text(item.skillId, 'skillId');
          await tenantRow(client, 'wizmatch_skills', actor.tenantId, skillId);
          await client.query(`INSERT INTO wizmatch_candidate_skills (tenant_id,candidate_id,skill_id,experience_years,last_used_at,evidence,confidence,verified,verified_by,verified_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,CASE WHEN $8 THEN NOW() ELSE NULL END) ON CONFLICT (tenant_id,candidate_id,skill_id) DO UPDATE SET experience_years=EXCLUDED.experience_years,last_used_at=EXCLUDED.last_used_at,evidence=EXCLUDED.evidence,confidence=EXCLUDED.confidence,verified=EXCLUDED.verified,verified_by=EXCLUDED.verified_by,verified_at=EXCLUDED.verified_at,updated_at=NOW()`, [actor.tenantId, candidateId, skillId, item.experienceYears ?? null, item.lastUsedAt || null, item.evidence || null, item.confidence ?? null, item.verified === true, item.verified === true ? actor.userId : null]);
        }
        await client.query(
          `UPDATE wizmatch_candidates candidate SET
             skills=COALESCE((SELECT ARRAY_AGG(skill.canonical_label ORDER BY skill.canonical_label) FROM wizmatch_candidate_skills cs JOIN wizmatch_skills skill ON skill.id=cs.skill_id AND skill.tenant_id=cs.tenant_id WHERE cs.tenant_id=$1 AND cs.candidate_id=$2),candidate.skills,'{}'::text[]),
             updated_at=NOW()
           WHERE candidate.tenant_id=$1 AND candidate.id=$2`,
          [actor.tenantId, candidateId],
        );
        await client.query(`INSERT INTO wizmatch_staffing_events (tenant_id,actor_user_id,event_type,payload) VALUES ($1,$2,'candidate_skills_upserted',$3::jsonb)`, [actor.tenantId, actor.userId, JSON.stringify({ candidateId, upserted: skills.length, omittedPreserved: true })]);
        return { candidateId, count: skills.length, upserted: skills.length, omittedPreserved: true };
      });
    },

    async recalculateRequirement(actor: { tenantId: string; userId: string }, requirementId: string) {
      return transaction(dbPool, async (client) => {
        const requirementResult = await client.query(`SELECT * FROM wizmatch_requirements WHERE tenant_id=$1 AND id=$2`, [actor.tenantId, requirementId]);
        if (!requirementResult.rowCount) throw new StaffingDomainError(404, 'not_found', 'Requirement was not found');
        const requirementSkills = await client.query(`SELECT rs.*,s.family,s.specialization,s.canonical_label FROM wizmatch_requirement_skills rs JOIN wizmatch_skills s ON s.id=rs.skill_id AND s.tenant_id=rs.tenant_id WHERE rs.tenant_id=$1 AND rs.requirement_id=$2`, [actor.tenantId, requirementId]);
        const candidates = await client.query(`SELECT * FROM wizmatch_candidates WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 500`, [actor.tenantId]);
        let recalculated = 0;
        for (const candidate of candidates.rows) {
          const candidateSkills = await client.query(`SELECT cs.*,s.family,s.specialization,s.canonical_label FROM wizmatch_candidate_skills cs JOIN wizmatch_skills s ON s.id=cs.skill_id AND s.tenant_id=cs.tenant_id WHERE cs.tenant_id=$1 AND cs.candidate_id=$2`, [actor.tenantId, candidate.id]);
          const output = calculateCandidateRequirementMatch({
            requirement: { location: requirementResult.rows[0].location, workMode: requirementResult.rows[0].work_mode, normalizedBudgetMaxAnnual: requirementResult.rows[0].normalized_budget_max_annual, skills: requirementSkills.rows.map((row) => ({ id: row.skill_id, family: row.family, specialization: row.specialization, canonicalLabel: row.canonical_label, importance: row.importance, minimumYears: row.minimum_years, allowBroadFamily: row.allow_broad_family })) },
            candidate: { availabilityStatus: candidate.availability_status, location: candidate.location, normalizedAnnualRate: candidate.normalized_annual_rate, skills: candidateSkills.rows.map((row) => ({ id: row.skill_id, family: row.family, specialization: row.specialization, canonicalLabel: row.canonical_label, experienceYears: row.experience_years, lastUsedAt: row.last_used_at, evidence: row.evidence, confidence: row.confidence, verified: row.verified })) },
          });
          const existing = await client.query(`SELECT id,snapshot_version FROM wizmatch_candidate_requirement_matches WHERE tenant_id=$1 AND requirement_id=$2 AND candidate_id=$3 FOR UPDATE`, [actor.tenantId, requirementId, candidate.id]);
          const version = (existing.rows[0]?.snapshot_version ?? 0) + 1;
          const current = await client.query(`INSERT INTO wizmatch_candidate_requirement_matches (tenant_id,requirement_id,candidate_id,score_version,score,dimensions,blockers,missing_evidence,snapshot_version,recalculated_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb,$9,NOW(),NOW()) ON CONFLICT (tenant_id,requirement_id,candidate_id) DO UPDATE SET score_version=EXCLUDED.score_version,score=EXCLUDED.score,dimensions=EXCLUDED.dimensions,blockers=EXCLUDED.blockers,missing_evidence=EXCLUDED.missing_evidence,snapshot_version=EXCLUDED.snapshot_version,recalculated_at=NOW(),updated_at=NOW() RETURNING id`, [actor.tenantId, requirementId, candidate.id, output.scoreVersion, output.score, JSON.stringify(output.dimensions), JSON.stringify(output.blockers), JSON.stringify(output.missingEvidence), version]);
          await client.query(`INSERT INTO wizmatch_match_snapshots (tenant_id,match_id,requirement_id,candidate_id,version,score_version,input_evidence,output_evidence,score,blockers,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10::jsonb,$11)`, [actor.tenantId, current.rows[0].id, requirementId, candidate.id, version, output.scoreVersion, JSON.stringify({ requirementSkills: requirementSkills.rows, candidateSkills: candidateSkills.rows }), JSON.stringify(output), output.score, JSON.stringify(output.blockers), actor.userId]);
          recalculated++;
        }
        await client.query(`INSERT INTO wizmatch_staffing_events (tenant_id,actor_user_id,event_type,requirement_id,payload) VALUES ($1,$2,'matches_recalculated',$3,$4::jsonb)`, [actor.tenantId, actor.userId, requirementId, JSON.stringify({ recalculated, scoreVersion: MATCH_SCORE_VERSION })]);
        return { requirementId, recalculated, scoreVersion: MATCH_SCORE_VERSION };
      });
    },

    async listRequirementMatches(tenantId: string, requirementId: string) {
      const result = await dbPool.query(`SELECT m.*,c.location,c.availability_status,c.experience_years,p.first_name,p.last_name FROM wizmatch_candidate_requirement_matches m JOIN wizmatch_candidates c ON c.id=m.candidate_id AND c.tenant_id=m.tenant_id JOIN contacts p ON p.id=c.contact_id AND p.tenant_id=c.tenant_id WHERE m.tenant_id=$1 AND m.requirement_id=$2 ORDER BY m.score DESC,m.recalculated_at DESC`, [tenantId, requirementId]);
      return result.rows;
    },

    async decide(actor: { tenantId: string; userId: string }, matchId: string, input: Record<string, unknown>) {
      const decision = text(input.decision, 'decision');
      if (!MATCH_DECISIONS.includes(decision as typeof MATCH_DECISIONS[number]) || decision === 'unreviewed') throw new StaffingDomainError(400, 'validation_error', 'Decision is invalid');
      return transaction(dbPool, async (client) => {
        await tenantRow(client, 'wizmatch_candidate_requirement_matches', actor.tenantId, matchId);
        const result = await client.query(`UPDATE wizmatch_candidate_requirement_matches SET human_decision=$3,decision_reason=$4,reviewed_by=$5,reviewed_at=NOW(),updated_at=NOW() WHERE tenant_id=$1 AND id=$2 RETURNING *`, [actor.tenantId, matchId, decision, input.reason || null, actor.userId]);
        await client.query(`INSERT INTO wizmatch_staffing_events (tenant_id,actor_user_id,event_type,payload) VALUES ($1,$2,'match_decision_recorded',$3::jsonb)`, [actor.tenantId, actor.userId, JSON.stringify({ matchId, decision, reason: input.reason || null })]);
        return result.rows[0];
      });
    },

    async candidate360(tenantId: string, candidateId: string) {
      const candidate = await dbPool.query(`SELECT c.*,p.first_name,p.last_name,p.company_name FROM wizmatch_candidates c JOIN contacts p ON p.id=c.contact_id AND p.tenant_id=c.tenant_id WHERE c.tenant_id=$1 AND c.id=$2`, [tenantId, candidateId]);
      if (!candidate.rowCount) throw new StaffingDomainError(404, 'not_found', 'Candidate was not found');
      const [skills, matches] = await Promise.all([
        dbPool.query(`SELECT cs.*,s.family,s.specialization,s.canonical_label FROM wizmatch_candidate_skills cs JOIN wizmatch_skills s ON s.id=cs.skill_id AND s.tenant_id=cs.tenant_id WHERE cs.tenant_id=$1 AND cs.candidate_id=$2 ORDER BY s.family,s.specialization`, [tenantId, candidateId]),
        dbPool.query(`SELECT m.*,r.title AS requirement_title,r.stage FROM wizmatch_candidate_requirement_matches m JOIN wizmatch_requirements r ON r.id=m.requirement_id AND r.tenant_id=m.tenant_id WHERE m.tenant_id=$1 AND m.candidate_id=$2 ORDER BY m.score DESC`, [tenantId, candidateId]),
      ]);
      return { candidate: candidate.rows[0], skills: skills.rows, matches: matches.rows };
    },

    async recruiterWork(tenantId: string, userId: string) {
      const result = await dbPool.query(`SELECT m.*,r.title AS requirement_title,c.id AS candidate_id,p.first_name,p.last_name FROM wizmatch_candidate_requirement_matches m JOIN wizmatch_requirements r ON r.id=m.requirement_id AND r.tenant_id=m.tenant_id JOIN wizmatch_requirement_assignments a ON a.requirement_id=r.id AND a.tenant_id=r.tenant_id AND a.active AND a.user_id=$2 JOIN wizmatch_candidates c ON c.id=m.candidate_id AND c.tenant_id=m.tenant_id JOIN contacts p ON p.id=c.contact_id AND p.tenant_id=c.tenant_id WHERE m.tenant_id=$1 AND m.human_decision IN ('unreviewed','shortlisted','watch') ORDER BY CASE m.human_decision WHEN 'unreviewed' THEN 0 ELSE 1 END,m.score DESC LIMIT 200`, [tenantId, userId]);
      return { items: result.rows };
    },
  };
}

export const wizmatchMatchingService = createWizmatchMatchingService();
