// 2026-07-31 — owner asked for the SOD/EOD Slack digests and the Meta Ads
// daily "ad account overview" to be turned OFF.
//
// These DM real people on a schedule, so this file guards two things:
//
// 1. THEY ARE ACTUALLY GATED. Not "commented out" — gated on an env flag that
//    defaults OFF. That distinction matters here more than usual: the block in
//    worker.ts carried "PAUSED 2026-05-03 — re-enable by uncommenting" comments
//    while the crons underneath were LIVE and had been re-enabled at some point.
//    A stale comment claiming something is off, sitting directly above running
//    code that DMs staff daily, is exactly the failure this test exists to stop
//    recurring. A flag's runtime value cannot go stale.
//
// 2. THE DEFAULT IS OFF. If the flag parsing is ever loosened so that an unset
//    variable reads as enabled, these start DMing people again silently.
//
// worker.ts cannot be imported here (module load starts real cron schedules and
// a Postgres pool), so this asserts the real source with comment lines removed
// — the same convention used elsewhere in this suite.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { slackDigestEnabled } from '../utils/slackDigestFlag';

const source = readFileSync(join(__dirname, '..', 'worker.ts'), 'utf8');

// Line-wise comment removal. NOT a block-comment regex: worker.ts contains `*/`
// inside cron expressions ('*/10 * * * *'), which a /\*[\s\S]*?\*\// strip
// devours — the file even documents that hazard itself.
const bare = source
  .split('\n')
  .filter((l) => {
    const t = l.trim();
    return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
  })
  .join('\n');

const GATED_SOD_EOD = [
  "safeCron('SOD Digest', sendSODDigest)",
  "safeCron('EOD Summary', sendEODSummary)",
  "safeCron('Evening Summary'",
  "safeCron('Team SOD Prompt', sendTeamSODPrompt)",
  "safeCron('Team EOD Prompt', sendTeamEODPrompt)",
];

// 2026-07-31 second pass — the rest of the recurring Growth Escalators Slack
// traffic. Each entry: the cron job, and the flag that must gate it.
const GATED_GE_DIGESTS: Array<[needle: string, flag: string]> = [
  ["safeCron('Morning Briefing'", 'MORNING_BRIEFING_SLACK_ENABLED'],
  ["safeCron('Social Media Prompt', sendSocialMediaPrompt)", 'SOCIAL_PROMPT_SLACK_ENABLED'],
  ["safeCron('SEO Weekly Digest'", 'SEO_DIGEST_SLACK_ENABLED'],
];

/** The cron.schedule(...) statement that registers a given job. */
function schedulerLineFor(needle: string): string {
  const idx = bare.indexOf(needle);
  expect(idx, `job not found in worker.ts: ${needle}`).toBeGreaterThan(-1);
  const start = bare.lastIndexOf('cron.schedule', idx);
  expect(start, `no cron.schedule registers ${needle}`).toBeGreaterThan(-1);
  const lineStart = bare.lastIndexOf('\n', start) + 1;
  return bare.slice(lineStart, bare.indexOf('\n', start));
}

describe('SOD/EOD Slack digests are gated OFF by default', () => {
  it.each(GATED_SOD_EOD)('%s is registered only when SOD_EOD_SLACK_ENABLED', (needle) => {
    expect(schedulerLineFor(needle)).toContain('if (SOD_EOD_SLACK_ENABLED)');
  });

  it('the Meta Ads daily report is gated on its own flag', () => {
    expect(schedulerLineFor("safeCron('Meta Ads Daily Report'"))
      .toContain('if (META_ADS_REPORT_SLACK_ENABLED)');
  });

  it('both flags are read from the environment, not hardcoded true', () => {
    expect(bare).toMatch(/const SOD_EOD_SLACK_ENABLED = slackDigestEnabled\('SOD_EOD_SLACK_ENABLED'\)/);
    expect(bare).toMatch(/const META_ADS_REPORT_SLACK_ENABLED = slackDigestEnabled\('META_ADS_REPORT_SLACK_ENABLED'\)/);
    expect(bare).not.toMatch(/const SOD_EOD_SLACK_ENABLED = true/);
    expect(bare).not.toMatch(/const META_ADS_REPORT_SLACK_ENABLED = true/);
  });
});

describe('the remaining Growth Escalators Slack digests are gated OFF by default', () => {
  it.each(GATED_GE_DIGESTS)('%s is registered only when %s', (needle, flag) => {
    expect(schedulerLineFor(needle)).toContain(`if (${flag})`);
  });

  it.each(GATED_GE_DIGESTS)('%s reads %s from the environment', (_needle, flag) => {
    expect(bare).toMatch(new RegExp(`const ${flag} = slackDigestEnabled\\('${flag}'\\)`));
    expect(bare).not.toMatch(new RegExp(`const ${flag} = true`));
  });
});

describe('slackDigestEnabled fails closed', () => {
  // The REAL exported helper, not a mirror of it. It moved out of worker.ts
  // into utils/ so the cron gates and the in-service Saleshandy gate share one
  // parser; importing it here means these cases test the shipped code path.
  it.each([undefined, '', ' ', 'false', 'no', 'off', '0', 'TRUEISH', 'disabled'])(
    'treats %j as OFF', (v) => expect(slackDigestEnabled('F', { F: v })).toBe(false));

  it.each(['true', 'TRUE', ' true ', '1', 'yes', 'on'])(
    'treats %j as ON', (v) => expect(slackDigestEnabled('F', { F: v })).toBe(true));

  it('an entirely absent variable is OFF', () => {
    expect(slackDigestEnabled('NEVER_SET_ANYWHERE', {})).toBe(false);
  });

  it('is not a !== "false" test (that would make a typo mean ON)', () => {
    // Comments stripped first: the file's own header *describes* the
    // `!== 'false'` anti-pattern, and matching that prose would fail the
    // assertion against correct code.
    const util = readFileSync(join(__dirname, '..', 'utils', 'slackDigestFlag.ts'), 'utf8')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');
    expect(util).toContain("['1', 'true', 'yes', 'on']");
    expect(util).not.toMatch(/!==\s*'false'/);
  });

  it('worker.ts uses the shared helper rather than redefining it', () => {
    expect(bare).toMatch(/import \{ slackDigestEnabled \} from '\.\/utils\/slackDigestFlag'/);
    expect(bare).not.toMatch(/function slackDigestEnabled/);
  });
});

describe('no stale "PAUSED" comment sits above a live scheduler', () => {
  // The original defect: a comment said PAUSED while the cron below it ran.
  it('the SOD/EOD block no longer claims to be paused-by-commenting', () => {
    expect(source).not.toMatch(/PAUSED 2026-05-03 — SOD Digest/);
    expect(source).not.toMatch(/PAUSED 2026-05-03 — EOD Summary/);
  });
});
