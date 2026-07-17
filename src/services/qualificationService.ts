type Answers = Record<string, unknown>;

export interface ScoreResult {
  totalScore: number;
  breakdown: {
    adSpend: number;
    decisionMaker: number;
    revenue: number;
    platform: number;
  };
  tier: 'hot' | 'warm' | 'cold';
}

// Find the first answer value whose key matches any of the given substring patterns.
function findValue(answers: Answers, ...keyPatterns: string[]): string {
  for (const [key, val] of Object.entries(answers)) {
    const lk = key.toLowerCase();
    if (keyPatterns.some((p) => lk.includes(p))) {
      return String(val ?? '').toLowerCase();
    }
  }
  return '';
}

// Detect a lakh-notation value like "1.5l", "2 lakh", "1L", "1,00,000"
// Returns the numeric value in lakhs, or null if not detected.
function detectLakhs(val: string): number | null {
  // Explicit numeric formats
  if (val.includes('1,00,000') || val.includes('100000')) return 1;
  // "NL" or "N lakh" or "N.Ml" patterns — e.g. "1.5l", "2 lakh", "10l"
  const m = val.match(/(\d+\.?\d*)\s*(?:l(?:akh)?)\b/);
  if (m) return parseFloat(m[1]);
  return null;
}

// "above N"/"more than N" as a bounded whole-number match — NOT a plain
// substring. .includes('above 1') previously matched "above 10k", "above
// 15k", "above 100000" (anything starting with that prefix), scoring a
// ₹10k/month spender as if they'd said "above 1 lakh". \bN\b(?!\d) requires
// N to end at a word boundary with no digit immediately following, so "1"
// matches "above 1", "above 1 lakh", "above 1,00,000" but not "above 10".
function matchesAboveThreshold(val: string, n: number): boolean {
  return new RegExp(`\\b(above|more than)\\s+${n}\\b(?!\\d)`, 'i').test(val);
}

// ---------------------------------------------------------------------------
// scoreBooking
// Scores qualification answers and returns totalScore, breakdown, and tier.
// ---------------------------------------------------------------------------
export function scoreBooking(answers: Answers): ScoreResult {
  // Ad spend — key contains 'spend' or 'budget'
  const spendVal = findValue(answers, 'spend', 'budget');
  let adSpend = 0;
  const spendLakhs = detectLakhs(spendVal);
  if (
    (spendLakhs !== null && spendLakhs >= 1) ||
    matchesAboveThreshold(spendVal, 1)
  ) {
    adSpend = 40;
  } else if (
    spendVal.includes('50k') ||
    spendVal.includes('50,000') ||
    spendVal.includes('50 thousand')
  ) {
    adSpend = 25;
  } else if (spendVal.includes('25k') || spendVal.includes('25,000')) {
    adSpend = 15;
  } else if (spendVal.includes('10k') || spendVal.includes('10,000')) {
    adSpend = 10;
  }

  // Decision maker — key contains 'decision' or 'authority'
  const decisionVal = findValue(answers, 'decision', 'authority');
  const decisionMaker = decisionVal.trim() === 'yes' ? 30 : 0;

  // Revenue — key contains 'revenue', 'gmv', or 'turnover'
  const revenueVal = findValue(answers, 'revenue', 'gmv', 'turnover');
  let revenue = 0;
  const revLakhs = detectLakhs(revenueVal);
  if (
    (revLakhs !== null && revLakhs >= 10) ||
    revenueVal.includes('1000000') ||
    matchesAboveThreshold(revenueVal, 10)
  ) {
    revenue = 20;
  } else if (
    (revLakhs !== null && revLakhs >= 5) ||
    revenueVal.includes('500000')
  ) {
    revenue = 15;
  } else if (
    (revLakhs !== null && revLakhs >= 1) ||
    revenueVal.includes('100000')
  ) {
    revenue = 10;
  }

  // Platform — key contains 'platform' or 'running ads'
  const platformVal = findValue(answers, 'platform', 'running ads');
  const platform =
    platformVal.includes('meta') ||
    platformVal.includes('facebook') ||
    platformVal.includes('instagram')
      ? 10
      : 0;

  const totalScore = adSpend + decisionMaker + revenue + platform;
  const tier: 'hot' | 'warm' | 'cold' =
    totalScore >= 70 ? 'hot' : totalScore >= 40 ? 'warm' : 'cold';

  return { totalScore, breakdown: { adSpend, decisionMaker, revenue, platform }, tier };
}

// ---------------------------------------------------------------------------
// determineSequence
// Returns the sequence name based on detectable business type in answers.
// ---------------------------------------------------------------------------
export function determineSequence(_tier: string, answers: Answers): string {
  const allValues = Object.values(answers)
    .map((v) => String(v ?? ''))
    .join(' ')
    .toLowerCase();

  if (
    allValues.includes('health') ||
    allValues.includes('clinic') ||
    allValues.includes('doctor') ||
    allValues.includes('hospital') ||
    allValues.includes('medical')
  ) {
    return 'Healthcare Lead Nurture';
  }
  return 'D2C Lead Nurture';
}

// ---------------------------------------------------------------------------
// buildDealTitle
// Builds a descriptive deal title from answers and contact name.
// ---------------------------------------------------------------------------
export function buildDealTitle(answers: Answers, contactName: string): string {
  const allValues = Object.values(answers)
    .map((v) => String(v ?? ''))
    .join(' ')
    .toLowerCase();

  if (
    allValues.includes('meta') ||
    allValues.includes('facebook') ||
    allValues.includes('instagram')
  ) {
    return `Meta Ads Retainer — ${contactName}`;
  }
  return `Full Retainer — ${contactName}`;
}
