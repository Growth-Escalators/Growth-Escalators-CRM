import { describe, expect, it } from 'vitest';
import {
  renderMergeFields,
  ensureCompliancePlaceholders,
  renderTemplate,
} from '../services/wizmatchOutreachTemplates';

describe('renderMergeFields', () => {
  it('fills known merge fields case-insensitively', () => {
    const out = renderMergeFields('Hi {{firstName}} at {{Company}} ({{team}})', {
      firstName: 'Priya', company: 'Acme', team: 'Talent Acquisition',
    });
    expect(out).toBe('Hi Priya at Acme (Talent Acquisition)');
  });

  it('blanks out unknown or missing placeholders (never leaks {{...}})', () => {
    const out = renderMergeFields('Hi {{firstName}} {{unknownKey}} {{title}}', { firstName: 'Sam' });
    expect(out).toBe('Hi Sam  ');
    expect(out).not.toContain('{{');
  });
});

describe('ensureCompliancePlaceholders', () => {
  it('appends unsubscribe + physical-address placeholders when both are missing', () => {
    const out = ensureCompliancePlaceholders('Hello, quick question about your hiring.');
    expect(out).toContain('[UNSUBSCRIBE_LINK]');
    expect(out).toContain('[PHYSICAL_ADDRESS]');
  });

  it('leaves the body unchanged when both placeholders are already present', () => {
    const body = 'Body\n\nUnsubscribe: [UNSUBSCRIBE_LINK]\n[PHYSICAL_ADDRESS]';
    expect(ensureCompliancePlaceholders(body)).toBe(body);
  });

  it('adds only the missing placeholder', () => {
    const out = ensureCompliancePlaceholders('Body with [PHYSICAL_ADDRESS] only');
    expect(out).toContain('[UNSUBSCRIBE_LINK]');
    // physical address should not be duplicated into the footer
    expect(out.match(/\[PHYSICAL_ADDRESS\]/g)?.length).toBe(1);
  });
});

describe('renderTemplate', () => {
  it('merges fields AND guarantees compliance placeholders for every send', () => {
    const { subject, body } = renderTemplate(
      { subject: 'Staffing help for {{company}}?', body: 'Hi {{firstName}}, I saw {{company}} is hiring on the {{team}} team.' },
      { firstName: 'Ravi', company: 'Logix Guru', team: 'Talent Acquisition' },
    );
    expect(subject).toBe('Staffing help for Logix Guru?');
    expect(body).toContain('Hi Ravi, I saw Logix Guru is hiring on the Talent Acquisition team.');
    expect(body).toContain('[UNSUBSCRIBE_LINK]');
    expect(body).toContain('[PHYSICAL_ADDRESS]');
  });
});
