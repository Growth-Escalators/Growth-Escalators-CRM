import { afterEach, describe, expect, it } from 'vitest';
import { parseBounce, bounceSuppressionEnabled } from '../services/wizmatchBounceParser';

describe('parseBounce', () => {
  it('ignores a normal prospect reply', () => {
    const r = parseBounce({
      from: 'priya@acme.in',
      subject: 'Re: Quick question about your Java openings',
      body: 'Sure, happy to chat. How about Thursday?',
    });
    expect(r.isBounce).toBe(false);
    expect(r.bouncedRecipient).toBeNull();
  });

  it('parses a Microsoft 365 hard bounce and extracts the failed recipient', () => {
    const r = parseBounce({
      from: 'postmaster@outlook.com',
      subject: 'Undeliverable: Partnership on your tech hiring',
      body: [
        'Your message could not be delivered.',
        'Final-Recipient: rfc822; jason.s@logixguru.com',
        'Action: failed',
        'Status: 5.1.1',
        'Diagnostic-Code: smtp; 550 5.1.1 user unknown',
      ].join('\n'),
    });
    expect(r.isBounce).toBe(true);
    expect(r.bouncedRecipient).toBe('jason.s@logixguru.com');
    expect(r.hard).toBe(true);
  });

  it('parses a Gmail mailer-daemon bounce via X-Failed-Recipients', () => {
    const r = parseBounce({
      from: 'mailer-daemon@googlemail.com',
      subject: 'Delivery Status Notification (Failure)',
      body: [
        'X-Failed-Recipients: mohit.chauhan@example.com',
        "The response was: 550 5.1.1 The email account that you tried to reach does not exist.",
      ].join('\n'),
    });
    expect(r.isBounce).toBe(true);
    expect(r.bouncedRecipient).toBe('mohit.chauhan@example.com');
    expect(r.hard).toBe(true);
  });

  it('treats a 4.x.x transient bounce as soft (not hard)', () => {
    const r = parseBounce({
      from: 'mailer-daemon@example.com',
      subject: 'Delivery delayed',
      body: [
        'Final-Recipient: rfc822; someone@target.com',
        'Status: 4.4.7',
        'Your message is delayed and will be retried.',
      ].join('\n'),
    });
    expect(r.isBounce).toBe(true);
    expect(r.bouncedRecipient).toBe('someone@target.com');
    expect(r.hard).toBe(false);
  });

  it('does not pick our own inbox address as the bounced recipient', () => {
    const r = parseBounce({
      from: 'MAILER-DAEMON@purelymail.com',
      subject: 'failure notice',
      body: [
        'Hi. This is the qmail-send program at purelymail.com.',
        'I could not deliver your message to: buyer@prospect.com',
        'Remote host said: 550 no such user',
      ].join('\n'),
    });
    expect(r.isBounce).toBe(true);
    expect(r.bouncedRecipient).toBe('buyer@prospect.com');
    expect(r.hard).toBe(true);
  });
});

describe('bounceSuppressionEnabled', () => {
  const original = process.env.WIZMATCH_BOUNCE_SUPPRESSION_ENABLED;
  afterEach(() => { process.env.WIZMATCH_BOUNCE_SUPPRESSION_ENABLED = original; });

  it('is OFF by default (unset)', () => {
    delete process.env.WIZMATCH_BOUNCE_SUPPRESSION_ENABLED;
    expect(bounceSuppressionEnabled()).toBe(false);
  });

  it('is ON only when explicitly enabled', () => {
    process.env.WIZMATCH_BOUNCE_SUPPRESSION_ENABLED = 'true';
    expect(bounceSuppressionEnabled()).toBe(true);
  });
});
