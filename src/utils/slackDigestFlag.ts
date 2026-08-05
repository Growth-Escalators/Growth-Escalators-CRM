// Shared parser for the "is this scheduled Slack digest switched on?" flags.
//
// Lives in one file on purpose. These flags decide whether a cron DMs real
// people, so the parsing must be identical everywhere and must FAIL CLOSED:
// an unset, empty or unrecognised value reads as OFF. A `!== 'false'` style
// test would turn a typo'd variable into a daily DM to the team.
//
// Callers: src/worker.ts (cron registration).

const TRUTHY = ['1', 'true', 'yes', 'on'];

export function slackDigestEnabled(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return TRUTHY.includes(String(env[name] || '').trim().toLowerCase());
}
