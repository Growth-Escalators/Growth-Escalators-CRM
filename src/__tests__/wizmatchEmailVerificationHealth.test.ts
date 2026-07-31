import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetWizmatchEmailVerificationHealthForTests,
  getWizmatchEmailVerificationHealthSnapshot,
  recordEmailVerificationFailure,
  recordEmailVerificationSuccess,
} from '../services/wizmatchEmailVerificationHealth';

describe('wizmatchEmailVerificationHealth', () => {
  beforeEach(() => {
    __resetWizmatchEmailVerificationHealthForTests();
  });
  afterEach(() => {
    __resetWizmatchEmailVerificationHealthForTests();
  });

  it('starts with no health entries', () => {
    expect(getWizmatchEmailVerificationHealthSnapshot()).toEqual([]);
  });

  it('recordEmailVerificationSuccess resets the consecutive-failure streak', async () => {
    const sendSlackMessage = vi.fn(async (_channel: string, _text: string) => true);
    await recordEmailVerificationFailure('millionverifier', 'boom', { sendSlackMessage, systemChannel: 'C123' });
    await recordEmailVerificationFailure('millionverifier', 'boom again', { sendSlackMessage, systemChannel: 'C123' });
    recordEmailVerificationSuccess('millionverifier');

    const [entry] = getWizmatchEmailVerificationHealthSnapshot();
    expect(entry.consecutiveFailures).toBe(0);
    expect(entry.lastSuccessAt).not.toBeNull();
  });

  it('fires exactly one Slack alert for the first failure', async () => {
    const sendSlackMessage = vi.fn(async (_channel: string, _text: string) => true);
    await recordEmailVerificationFailure('millionverifier', 'HTTP 500', { sendSlackMessage, systemChannel: 'C123' });

    expect(sendSlackMessage).toHaveBeenCalledTimes(1);
    const [channel, text] = sendSlackMessage.mock.calls[0];
    expect(channel).toBe('C123');
    expect(text).toContain('Consecutive failures: 1');
    expect(text).toContain('HTTP 500');
  });

  it('does NOT re-alert on every failure inside the cooldown window (not per-failure spam)', async () => {
    const sendSlackMessage = vi.fn(async (_channel: string, _text: string) => true);
    let now = 1_000_000;
    const clock = () => now;
    const cooldownMs = 60_000;

    await recordEmailVerificationFailure('millionverifier', 'fail 1', { sendSlackMessage, systemChannel: 'C123', now: clock, cooldownMs });
    now += 1000;
    await recordEmailVerificationFailure('millionverifier', 'fail 2', { sendSlackMessage, systemChannel: 'C123', now: clock, cooldownMs });
    now += 1000;
    await recordEmailVerificationFailure('millionverifier', 'fail 3', { sendSlackMessage, systemChannel: 'C123', now: clock, cooldownMs });

    // 3 failures logged/tracked, but only the first one alerted.
    expect(sendSlackMessage).toHaveBeenCalledTimes(1);
    const snapshot = getWizmatchEmailVerificationHealthSnapshot();
    expect(snapshot[0].consecutiveFailures).toBe(3);
  });

  it('alerts again once the cooldown window has elapsed, reporting the updated consecutive count', async () => {
    const sendSlackMessage = vi.fn(async (_channel: string, _text: string) => true);
    let now = 1_000_000;
    const clock = () => now;
    const cooldownMs = 60_000;

    await recordEmailVerificationFailure('millionverifier', 'fail 1', { sendSlackMessage, systemChannel: 'C123', now: clock, cooldownMs });
    now += 1000; // still within cooldown
    await recordEmailVerificationFailure('millionverifier', 'fail 2', { sendSlackMessage, systemChannel: 'C123', now: clock, cooldownMs });
    now += cooldownMs + 1; // cooldown has elapsed
    await recordEmailVerificationFailure('millionverifier', 'fail 3', { sendSlackMessage, systemChannel: 'C123', now: clock, cooldownMs });

    expect(sendSlackMessage).toHaveBeenCalledTimes(2);
    const secondAlertText = sendSlackMessage.mock.calls[1][1] as string;
    expect(secondAlertText).toContain('Consecutive failures: 3');
  });

  it('tracks separate providers independently (reacher failing does not suppress a millionverifier alert)', async () => {
    const sendSlackMessage = vi.fn(async (_channel: string, _text: string) => true);
    await recordEmailVerificationFailure('reacher', 'reacher down', { sendSlackMessage, systemChannel: 'C123' });
    await recordEmailVerificationFailure('millionverifier', 'mv down', { sendSlackMessage, systemChannel: 'C123' });

    expect(sendSlackMessage).toHaveBeenCalledTimes(2);
    const providers = getWizmatchEmailVerificationHealthSnapshot().map((entry) => entry.provider).sort();
    expect(providers).toEqual(['millionverifier', 'reacher']);
  });

  it('does not send or throw when no Slack channel is configured', async () => {
    const sendSlackMessage = vi.fn(async (_channel: string, _text: string) => true);
    await expect(
      recordEmailVerificationFailure('millionverifier', 'boom', { sendSlackMessage, systemChannel: '' }),
    ).resolves.toBeUndefined();
    expect(sendSlackMessage).not.toHaveBeenCalled();
  });

  it('swallows a Slack send failure without throwing', async () => {
    const sendSlackMessage = vi.fn(async (_channel: string, _text: string) => { throw new Error('Slack API down'); });
    await expect(
      recordEmailVerificationFailure('millionverifier', 'boom', { sendSlackMessage, systemChannel: 'C123' }),
    ).resolves.toBeUndefined();
    expect(sendSlackMessage).toHaveBeenCalledTimes(1);
  });

  it('the "unconfigured" pseudo-provider is tracked and alerted like any other', async () => {
    const sendSlackMessage = vi.fn(async (_channel: string, _text: string) => true);
    await recordEmailVerificationFailure('unconfigured', 'no provider set', { sendSlackMessage, systemChannel: 'C123' });
    expect(sendSlackMessage).toHaveBeenCalledTimes(1);
    expect(sendSlackMessage.mock.calls[0][1]).toContain('REACHER_BASE_URL or MILLIONVERIFIER_API_KEY');
  });
});
