import { normalizeChannelValue } from './contactService';

export const CANDIDATE_INTAKE_LIMITS = {
  maxProfilesPerRequest: 50,
  maxSkillsPerProfile: 20,
};

export type CandidateIntakeStatus = 'accepted' | 'skipped';

export interface CandidateIntakeRawProfile {
  name?: string;
  email?: string;
  phone?: string;
  skills?: string[] | string;
  location?: string;
  visa_status?: string;
  rate_hourly?: number | string;
  rate_currency?: string;
  availability_date?: string;
  availability_status?: string;
  source?: string;
  linkedin_url?: string;
  github_url?: string;
  resume_url?: string;
}

export interface CandidateIntakeProfile {
  name: string;
  email?: string;
  phone?: string;
  skills: string[];
  location?: string;
  visaStatus?: string;
  rateHourly?: number;
  rateCurrency: string;
  availabilityDate?: string;
  availabilityStatus: string;
  source: string;
  linkedinUrl?: string;
  githubUrl?: string;
  resumeUrl?: string;
  warnings: string[];
}

export interface CandidateIntakeItem {
  status: CandidateIntakeStatus;
  row: number;
  profile?: CandidateIntakeProfile;
  reason?: string;
}

export interface CandidateIntakeRequest {
  items: CandidateIntakeItem[];
  accepted: CandidateIntakeProfile[];
  skipped: CandidateIntakeItem[];
  truncated: boolean;
}

const HEADER_ALIASES: Record<string, keyof CandidateIntakeRawProfile> = {
  candidate: 'name',
  candidate_name: 'name',
  full_name: 'name',
  name: 'name',
  email: 'email',
  email_id: 'email',
  phone: 'phone',
  mobile: 'phone',
  whatsapp: 'phone',
  skills: 'skills',
  skill: 'skills',
  tech_stack: 'skills',
  location: 'location',
  city: 'location',
  visa: 'visa_status',
  visa_status: 'visa_status',
  rate: 'rate_hourly',
  rate_hourly: 'rate_hourly',
  hourly_rate: 'rate_hourly',
  currency: 'rate_currency',
  rate_currency: 'rate_currency',
  availability: 'availability_status',
  availability_status: 'availability_status',
  availability_date: 'availability_date',
  source: 'source',
  linkedin: 'linkedin_url',
  linkedin_url: 'linkedin_url',
  github: 'github_url',
  github_url: 'github_url',
  resume: 'resume_url',
  resume_url: 'resume_url',
};

function clean(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const text = String(value).trim();
  return text.length ? text : undefined;
}

function keyForHeader(header: string): keyof CandidateIntakeRawProfile | null {
  const key = header.trim().toLowerCase().replace(/[\s-]+/g, '_');
  return HEADER_ALIASES[key] || null;
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];

    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      i += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === ',' && !inQuotes) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
}

export function parseCandidateIntakeText(rawText: string): CandidateIntakeRawProfile[] {
  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));

  if (lines.length === 0) return [];

  const headers = parseCsvLine(lines[0]).map(keyForHeader);
  const hasUsableHeader = headers.some(Boolean);
  if (!hasUsableHeader) return [];

  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const profile: CandidateIntakeRawProfile = {};
    headers.forEach((header, index) => {
      if (!header) return;
      const value = clean(cells[index]);
      if (value !== undefined) {
        (profile as Record<string, unknown>)[header] = value;
      }
    });
    return profile;
  });
}

export function normalizeCandidateSkills(skills: CandidateIntakeRawProfile['skills']): string[] {
  const raw = Array.isArray(skills) ? skills : String(skills || '').split(/[|;,]/);
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const skill of raw) {
    const text = clean(skill);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(text);
    if (normalized.length >= CANDIDATE_INTAKE_LIMITS.maxSkillsPerProfile) break;
  }

  return normalized;
}

export function normalizeCandidateIntakeProfile(raw: CandidateIntakeRawProfile): CandidateIntakeProfile | null {
  const name = clean(raw.name);
  const email = raw.email ? normalizeChannelValue('email', raw.email) : undefined;
  const phone = raw.phone ? normalizeChannelValue('phone', raw.phone) : undefined;
  const linkedinUrl = clean(raw.linkedin_url);
  const channels = [email, phone, linkedinUrl].filter(Boolean);

  if (!name) return null;
  if (channels.length === 0) return null;

  const skills = normalizeCandidateSkills(raw.skills);
  const warnings: string[] = [];
  if (skills.length === 0) warnings.push('No skills supplied; profile will score lower until updated.');
  if (!email) warnings.push('No email supplied; candidate cannot be email-contacted yet.');
  if (!raw.resume_url) warnings.push('No resume URL supplied.');

  const rateHourly = Number(raw.rate_hourly);

  return {
    name,
    email,
    phone,
    skills,
    location: clean(raw.location),
    visaStatus: clean(raw.visa_status),
    rateHourly: Number.isFinite(rateHourly) && rateHourly > 0 ? Math.round(rateHourly) : undefined,
    rateCurrency: clean(raw.rate_currency) || 'INR',
    availabilityDate: clean(raw.availability_date),
    availabilityStatus: clean(raw.availability_status) || 'available',
    source: clean(raw.source) || 'manual_intake',
    linkedinUrl,
    githubUrl: clean(raw.github_url),
    resumeUrl: clean(raw.resume_url),
    warnings,
  };
}

export function buildCandidateIntakeRequest(input: {
  candidates?: CandidateIntakeRawProfile[];
  rawText?: string;
}): CandidateIntakeRequest {
  const rawProfiles = [
    ...(Array.isArray(input.candidates) ? input.candidates : []),
    ...(typeof input.rawText === 'string' ? parseCandidateIntakeText(input.rawText) : []),
  ];

  const limitedProfiles = rawProfiles.slice(0, CANDIDATE_INTAKE_LIMITS.maxProfilesPerRequest);
  const items: CandidateIntakeItem[] = limitedProfiles.map((raw, index) => {
    const profile = normalizeCandidateIntakeProfile(raw);
    if (!profile) {
      return {
        status: 'skipped',
        row: index + 1,
        reason: 'Candidate needs a name and at least one usable email, phone, or LinkedIn URL.',
      };
    }
    return { status: 'accepted', row: index + 1, profile };
  });

  return {
    items,
    accepted: items
      .filter((item): item is CandidateIntakeItem & { profile: CandidateIntakeProfile } => item.status === 'accepted' && Boolean(item.profile))
      .map((item) => item.profile),
    skipped: items.filter((item) => item.status === 'skipped'),
    truncated: rawProfiles.length > limitedProfiles.length,
  };
}
