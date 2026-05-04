import logger from '../utils/logger';
import https from 'https';
import { SLACK_NOTIFICATIONS_PAUSED } from '../config/featureFlags';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

export interface SlackSendOpts {
  // Set true on calls that must fire even while SLACK_NOTIFICATIONS_PAUSED is on
  // (e.g. Cashfree funnel purchase notifications — the only "real sale" signal).
  allowDuringPause?: boolean;
}

// Member ID mapping — ClickUp ID to Slack ID
export const MEMBER_MAP: Record<string, { slackId: string; name: string; role: string }> = {
  '88911769':  { slackId: 'U073Y677JBB', name: 'Jatin',   role: 'founder' },
  '242618940': { slackId: 'U09TY8RGN30', name: 'Sakcham', role: 'sales' },
  '4800274':   { slackId: 'U073Y6S4K4H', name: 'Keshav',  role: 'ops' },
  '100972807': { slackId: 'U0ALMKD2XFB', name: 'Nimisha', role: 'ops' },
};

export const SLACK_MEMBERS = {
  jatin:   'U073Y677JBB',
  sakcham: 'U09TY8RGN30',
  keshav:  'U073Y6S4K4H',
  nimisha: 'U0ALMKD2XFB',
  vishal:  'U0ALC9Z09RA',
};

// Channel mapping
export const CHANNELS = {
  sodEod:  'sod-eod',
  general: 'general',
  outreach: 'outreach',
  performanceMarketing: 'C0ALLQG0SUS',
};

// Send a message to a Slack channel
export async function sendSlackMessage(
  channel: string,
  text: string,
  blocks?: unknown[],
  opts: SlackSendOpts = {},
): Promise<boolean> {
  if (SLACK_NOTIFICATIONS_PAUSED && !opts.allowDuringPause) {
    logger.info(`[Slack] suppressed (paused): #${channel} — ${text.slice(0, 80)}`);
    return false;
  }
  if (!SLACK_BOT_TOKEN) {
    logger.error('[Slack] SLACK_BOT_TOKEN not set — cannot send message');
    return false;
  }

  const payload: Record<string, unknown> = { channel, text };
  if (blocks && blocks.length > 0) payload.blocks = blocks;

  const body = JSON.stringify(payload);

  return new Promise((resolve) => {
    const options = {
      hostname: 'slack.com',
      path: '/api/chat.postMessage',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { ok: boolean; error?: string };
          if (parsed.ok) {
            console.log(`[Slack] message sent to #${channel}`);
            resolve(true);
          } else {
            logger.error(`[Slack] error for #${channel}:`, parsed.error);
            resolve(false);
          }
        } catch {
          resolve(false);
        }
      });
    });

    req.setTimeout(10000, () => {
      req.destroy(new Error('Slack request timed out after 10s'));
    });

    req.on('error', (e) => {
      logger.error('[Slack] request error:', e.message);
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

// Send a direct message to a specific Slack user by their ID
export async function sendSlackDM(
  userId: string,
  text: string,
  blocks?: unknown[],
  opts: SlackSendOpts = {},
): Promise<boolean> {
  if (SLACK_NOTIFICATIONS_PAUSED && !opts.allowDuringPause) {
    logger.info(`[Slack] suppressed (paused) DM to ${userId} — ${text.slice(0, 80)}`);
    return false;
  }
  if (!SLACK_BOT_TOKEN) {
    logger.error('[Slack] SLACK_BOT_TOKEN not set — cannot send DM');
    return false;
  }

  const dmChannel = await openDMChannel(userId);
  if (!dmChannel) return false;

  return sendSlackMessage(dmChannel, text, blocks, opts);
}

// Open a DM channel with a user, returns channel ID
async function openDMChannel(userId: string): Promise<string | null> {
  const body = JSON.stringify({ users: userId });

  return new Promise((resolve) => {
    const options = {
      hostname: 'slack.com',
      path: '/api/conversations.open',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data) as { ok: boolean; channel?: { id: string }; error?: string };
          if (parsed.ok) resolve(parsed.channel!.id);
          else { logger.error('[Slack] DM open error:', parsed.error); resolve(null); }
        } catch { resolve(null); }
      });
    });

    req.setTimeout(10000, () => {
      req.destroy(new Error('Slack DM request timed out after 10s'));
    });

    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}
