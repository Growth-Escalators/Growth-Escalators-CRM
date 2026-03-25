import https from 'https';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;

// Member ID mapping — ClickUp ID to Slack ID
export const MEMBER_MAP: Record<string, { slackId: string; name: string; role: string }> = {
  '88911769':  { slackId: 'U073Y677JBB', name: 'Jatin',     role: 'founder' },
  '242618940': { slackId: 'U09TY8RGN30', name: 'Saksham',   role: 'sales' },
  '4800274':   { slackId: 'U073Y6S4K4H', name: 'Keshav',    role: 'ops' },
  '100972807': { slackId: 'U0ALMKD2XFB', name: 'Nimisha',   role: 'ops' },
  '100860514': { slackId: 'U09TXBW2XPX', name: 'Sanskriti', role: 'ops' },
  '100972806': { slackId: 'U0ALC9Z09RA', name: 'Vishal',    role: 'ops' },
};

// Slack user ID to name mapping
export const SLACK_MEMBERS = {
  jatin:     'U073Y677JBB',
  keshav:    'U073Y6S4K4H',
  nimisha:   'U0ALMKD2XFB',
  saksham:   'U09TY8RGN30',
  sanskriti: 'U09TXBW2XPX',
  vishal:    'U0ALC9Z09RA',
};

// Channel mapping
export const CHANNELS = {
  sodEod:  'sod-eod',
  general: 'general',
  outreach: 'outreach',
  salesBd: 'sales-bd',
};

// Send a message to a Slack channel
export async function sendSlackMessage(channel: string, text: string, blocks?: unknown[]): Promise<boolean> {
  if (!SLACK_BOT_TOKEN) {
    console.error('[Slack] SLACK_BOT_TOKEN not set — cannot send message');
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
            console.error(`[Slack] error for #${channel}:`, parsed.error);
            resolve(false);
          }
        } catch {
          resolve(false);
        }
      });
    });

    req.on('error', (e) => {
      console.error('[Slack] request error:', e.message);
      resolve(false);
    });

    req.write(body);
    req.end();
  });
}

// Send a direct message to a specific Slack user by their ID
export async function sendSlackDM(userId: string, text: string, blocks?: unknown[]): Promise<boolean> {
  if (!SLACK_BOT_TOKEN) {
    console.error('[Slack] SLACK_BOT_TOKEN not set — cannot send DM');
    return false;
  }

  const dmChannel = await openDMChannel(userId);
  if (!dmChannel) return false;

  return sendSlackMessage(dmChannel, text, blocks);
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
          else { console.error('[Slack] DM open error:', parsed.error); resolve(null); }
        } catch { resolve(null); }
      });
    });

    req.on('error', () => resolve(null));
    req.write(body);
    req.end();
  });
}
