/**
 * Wizmatch — email verification provider health tracking + loud-failure alerting.
 *
 * Root cause this exists to fix: the self-hosted Reacher instance at
 * REACHER_BASE_URL was decommissioned (every request now returns Railway's edge
 * 404), and `wizmatchContactDiscoveryProviders.ts`'s old `reacherVerify` did
 * `if (!res.ok) return 'unknown';` with no log and no alert. Verification has
 * therefore silently returned 'unknown' forever, capping every contact's
 * `confidenceScore` at 6 (tier 'medium') and stalling the whole outreach
 * pipeline in Needs Review — nobody noticed because nothing was loud.
 *
 * This module is the "make failures loud" half of the fix: callers in
 * wizmatchContactDiscoveryProviders.ts report every verification attempt here.
 * A failure (verifier unreachable, non-OK status, timeout, malformed response,
 * or no provider configured at all) is:
 *   1. ALWAYS logged at ERROR (never warn), with the running consecutive-failure
 *      count for that provider.
 *   2. Slack-alerted to WIZMATCH_SYSTEM_CHANNEL at most once per cooldown window
 *      (default 60 minutes, WIZMATCH_EMAIL_VERIFY_ALERT_COOLDOWN_MINUTES) — so a
 *      whole discovery run hammering a dead verifier pings Slack once, not once
 *      per email.
 *
 * State is in-memory per-process (reset on deploy/restart) — deliberately not
 * DB-backed: this module has no natural tenant scope (verification runs against
 * a bare email string, not a tenant-scoped record), and adding a DB dependency
 * to what is otherwise a pure HTTP-calling module would make it harder to unit
 * test in isolation. Worst case after a restart is one extra alert, which is
 * far cheaper than the silent-failure incident this replaces.
 */
import logger from '../utils/logger';
import { sendSlackMessage as defaultSendSlackMessage } from './slackService';
import { WIZMATCH_SYSTEM_CHANNEL, WIZMATCH_EMAIL_VERIFY_ALERT_COOLDOWN_MINUTES } from '../config/constants';

/** 'unconfigured' covers the case where neither REACHER_BASE_URL nor MILLIONVERIFIER_API_KEY is set. */
export type WizmatchEmailVerificationProviderKey = 'reacher' | 'millionverifier' | 'unconfigured';

export type WizmatchEmailVerificationSlackSender = (
  channel: string,
  text: string,
  blocks?: unknown[],
  opts?: { allowDuringPause?: boolean },
) => Promise<boolean>;

export interface WizmatchEmailVerificationFailureDeps {
  sendSlackMessage?: WizmatchEmailVerificationSlackSender;
  systemChannel?: string;
  /** Returns "now" in epoch ms — injectable so tests don't need real timers. */
  now?: () => number;
  cooldownMs?: number;
}

export interface WizmatchEmailVerificationHealthSnapshot {
  provider: WizmatchEmailVerificationProviderKey;
  consecutiveFailures: number;
  lastFailureAt: string | null;
  lastSuccessAt: string | null;
  lastAlertAt: string | null;
  lastErrorDetail: string | null;
}

interface ProviderHealthState {
  consecutiveFailures: number;
  lastFailureAt: number | null;
  lastSuccessAt: number | null;
  lastAlertAt: number | null;
  lastErrorDetail: string | null;
}

function freshState(): ProviderHealthState {
  return {
    consecutiveFailures: 0,
    lastFailureAt: null,
    lastSuccessAt: null,
    lastAlertAt: null,
    lastErrorDetail: null,
  };
}

const healthState = new Map<WizmatchEmailVerificationProviderKey, ProviderHealthState>();

function getState(provider: WizmatchEmailVerificationProviderKey): ProviderHealthState {
  let state = healthState.get(provider);
  if (!state) {
    state = freshState();
    healthState.set(provider, state);
  }
  return state;
}

/** Call on every successful verification attempt — clears the consecutive-failure streak. */
export function recordEmailVerificationSuccess(provider: WizmatchEmailVerificationProviderKey): void {
  const state = getState(provider);
  state.consecutiveFailures = 0;
  state.lastSuccessAt = Date.now();
}

function providerGuidance(provider: WizmatchEmailVerificationProviderKey): string {
  if (provider === 'reacher') return 'Check REACHER_BASE_URL and the self-hosted Reacher service (Railway) — is it still deployed?';
  if (provider === 'millionverifier') return 'Check MILLIONVERIFIER_API_KEY and the MillionVerifier account (credits, key validity, api.millionverifier.com status).';
  return 'No email verification provider is configured at all — set REACHER_BASE_URL or MILLIONVERIFIER_API_KEY.';
}

function buildFailureAlertText(provider: WizmatchEmailVerificationProviderKey, state: ProviderHealthState): string {
  return [
    ':rotating_light: *Wizmatch email verification is failing*',
    `Provider: ${provider}`,
    `Consecutive failures: ${state.consecutiveFailures}`,
    `Last error: ${state.lastErrorDetail || 'unknown'}`,
    '',
    'Every discovered contact\'s email is stuck at "unknown" deliverability while this is down. ' +
      'That caps confidenceScore at 6 ("medium" tier) — contacts stay in Needs Review and can never ' +
      'reach Ready to Contact, silently stalling the outreach pipeline.',
    '',
    providerGuidance(provider),
  ].join('\n');
}

/**
 * Call on every failed verification attempt (unreachable, non-OK, timeout,
 * malformed response, or no provider configured). Always logs ERROR; Slack-alerts
 * at most once per cooldown window.
 */
export async function recordEmailVerificationFailure(
  provider: WizmatchEmailVerificationProviderKey,
  detail: string,
  deps: WizmatchEmailVerificationFailureDeps = {},
): Promise<void> {
  const sendSlack = deps.sendSlackMessage ?? defaultSendSlackMessage;
  const channel = deps.systemChannel ?? WIZMATCH_SYSTEM_CHANNEL;
  const now = deps.now ?? (() => Date.now());
  const cooldownMs = deps.cooldownMs ?? WIZMATCH_EMAIL_VERIFY_ALERT_COOLDOWN_MINUTES * 60 * 1000;

  const state = getState(provider);
  state.consecutiveFailures += 1;
  state.lastFailureAt = now();
  state.lastErrorDetail = detail;

  logger.error(
    { provider, consecutiveFailures: state.consecutiveFailures, detail },
    `[wizmatch-email-verify] ${provider} email verification failed — degrading to "unknown"`,
  );

  const nowMs = now();
  const withinCooldown = state.lastAlertAt !== null && nowMs - state.lastAlertAt < cooldownMs;
  if (withinCooldown) return;

  if (!channel) {
    logger.error('[wizmatch-email-verify] WIZMATCH_SYSTEM_CHANNEL not set — cannot Slack-alert on verifier failure');
    return;
  }

  // Mark the alert as sent BEFORE the network call so a slow/failing Slack
  // send can't reopen the cooldown window and cause a burst of retries.
  state.lastAlertAt = nowMs;
  try {
    await sendSlack(channel, buildFailureAlertText(provider, state));
  } catch (err) {
    logger.error({ err }, '[wizmatch-email-verify] failed to send Slack alert for verifier failure');
  }
}

export function getWizmatchEmailVerificationHealthSnapshot(): WizmatchEmailVerificationHealthSnapshot[] {
  return Array.from(healthState.entries()).map(([provider, state]) => ({
    provider,
    consecutiveFailures: state.consecutiveFailures,
    lastFailureAt: state.lastFailureAt ? new Date(state.lastFailureAt).toISOString() : null,
    lastSuccessAt: state.lastSuccessAt ? new Date(state.lastSuccessAt).toISOString() : null,
    lastAlertAt: state.lastAlertAt ? new Date(state.lastAlertAt).toISOString() : null,
    lastErrorDetail: state.lastErrorDetail,
  }));
}

/** Test-only — clears all in-memory health state between test cases. */
export function __resetWizmatchEmailVerificationHealthForTests(): void {
  healthState.clear();
}
