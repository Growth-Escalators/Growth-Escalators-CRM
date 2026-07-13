import crypto from 'crypto';

function normalize(value: unknown): string {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function signalIdentityFingerprint(input: {
  companyName?: unknown;
  jobTitle?: unknown;
  location?: unknown;
}): string | null {
  const parts = [normalize(input.companyName), normalize(input.jobTitle), normalize(input.location)];
  if (!parts[0] || !parts[1]) return null;
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

export function normalizeProviderId(value: unknown): string | null {
  const normalized = normalize(value);
  return normalized || null;
}
