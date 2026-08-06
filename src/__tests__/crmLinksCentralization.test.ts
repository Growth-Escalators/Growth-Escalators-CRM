// The CRM deep-link used in task/mention DMs, white-label lead alerts,
// coaching reports, and the SEO weekly email used to be a literal hardcoded
// separately in each file. This pins two things:
//   1. There is exactly one place that knows the default host + reads the
//      env override (src/config/crmLinks.ts).
//   2. None of the call sites re-hardcode the literal domain — they all read
//      the shared constant, so a future host change is a one-line edit.
//
// This is deliberately NOT a per-tenant fix — see the comment in
// crmLinks.ts for why a shared host is still correct today.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..');

describe('CRM_BASE_URL is centralised in src/config/crmLinks.ts', () => {
  const crmLinksSrc = readFileSync(join(ROOT, 'config', 'crmLinks.ts'), 'utf8');

  it('reads from the environment with the current production host as fallback', () => {
    expect(crmLinksSrc).toMatch(
      /CRM_BASE_URL\s*=\s*process\.env\.CRM_BASE_URL\s*\|\|\s*'https:\/\/crm\.growthescalators\.com'/,
    );
  });

  it.each([
    ['routes/tasks.ts', 'tasks.ts'],
    ['services/intelligenceDelivery.ts', 'intelligenceDelivery.ts'],
    ['services/seoWeeklyEmailService.ts', 'seoWeeklyEmailService.ts'],
  ])('%s imports CRM_BASE_URL from the shared helper', (relPath) => {
    const src = readFileSync(join(ROOT, relPath), 'utf8');
    expect(src).toMatch(/import \{ CRM_BASE_URL \} from ['"].*config\/crmLinks['"]/);
  });

  it.each([
    ['routes/tasks.ts'],
    ['services/intelligenceDelivery.ts'],
    ['services/seoWeeklyEmailService.ts'],
  ])('%s no longer hardcodes the literal CRM host', (relPath) => {
    const src = readFileSync(join(ROOT, relPath), 'utf8');
    expect(src).not.toMatch(/crm\.growthescalators\.com/);
  });
});
