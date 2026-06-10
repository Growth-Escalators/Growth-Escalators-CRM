// Daily team prompt messages — kept separate from sodEodService.ts which
// builds personalised task digests. These are lightweight channel prompts
// that surface in the team's actual Slack channels (not DMs) so everyone is
// in the loop on what the day's rhythm looks like.

import { sendSlackMessage } from './slackService';
import {
  SLACK_SOD_EOD_CHANNEL,
  SLACK_SOCIAL_MEDIA_CHANNEL,
  SLACK_KANISHK,
  SLACK_KRATIKA,
  SLACK_SNEHA,
} from '../config/constants';

const TEAM_SOD_EOD = [
  { id: SLACK_KANISHK, name: 'Kanishk' },
  { id: SLACK_KRATIKA, name: 'Kratika' },
  { id: SLACK_SNEHA,   name: 'Sneha'   },
];

const TEAM_SOCIAL = [
  { id: SLACK_KRATIKA, name: 'Kratika' },
  { id: SLACK_SNEHA,   name: 'Sneha'   },
];

function dateStr(): string {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long',
    timeZone: 'Asia/Kolkata',
  });
}

function mentions(members: typeof TEAM_SOD_EOD): string {
  return members.map(m => `<@${m.id}>`).join(' · ');
}

// 10:15 AM IST Mon–Sat — channel prompt asking the team to share their SOD.
// Lives next to the existing personalised SOD digest; intent is to surface a
// human "drop yours in this thread" cue everyone can react/reply to.
export async function sendTeamSODPrompt(): Promise<boolean> {
  const msg =
    `🌅 *Good morning team — ${dateStr()}*\n\n` +
    `Share your *SOD plan* for today in this thread 👇\n\n` +
    `${mentions(TEAM_SOD_EOD)}\n\n` +
    `_Drop the top 3 things you're shipping today + anything blocked._`;

  const ok = await sendSlackMessage(SLACK_SOD_EOD_CHANNEL, msg, undefined, { allowDuringPause: true }).catch((e) => {
    console.error('[daily-prompts] SOD prompt failed:', e);
    return false;
  });
  if (ok) console.log('[daily-prompts] SOD prompt posted');
  return ok;
}

// 7:00 PM IST Mon–Sat — channel prompt asking the team to share their EOD recap.
export async function sendTeamEODPrompt(): Promise<boolean> {
  const msg =
    `🌙 *Wrapping up — ${dateStr()}*\n\n` +
    `Share your *EOD recap* in this thread 👇\n\n` +
    `${mentions(TEAM_SOD_EOD)}\n\n` +
    `_What shipped today · what's blocked · what's queued for tomorrow._`;

  const ok = await sendSlackMessage(SLACK_SOD_EOD_CHANNEL, msg, undefined, { allowDuringPause: true }).catch((e) => {
    console.error('[daily-prompts] EOD prompt failed:', e);
    return false;
  });
  if (ok) console.log('[daily-prompts] EOD prompt posted');
  return ok;
}

// 9:30 AM IST Mon–Sat — channel prompt in #social-media-posting tagging the
// content owners (Kratika & Sneha) to list which brands need posting today.
export async function sendSocialMediaPrompt(): Promise<boolean> {
  const msg =
    `📱 *Social posting — ${dateStr()}*\n\n` +
    `${mentions(TEAM_SOCIAL)} — which brands need posting today?\n\n` +
    `Share the list + any creative briefs in this thread by *11 AM IST* 👇`;

  const ok = await sendSlackMessage(SLACK_SOCIAL_MEDIA_CHANNEL, msg, undefined, { allowDuringPause: true }).catch((e) => {
    console.error('[daily-prompts] Social prompt failed:', e);
    return false;
  });
  if (ok) console.log('[daily-prompts] Social Media prompt posted');
  return ok;
}
