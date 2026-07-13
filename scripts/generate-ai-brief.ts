/**
 * generate-ai-brief.ts
 *
 * Regenerates `.ai/AI_BRIEF.md` — a snapshot any AI agent (or fresh chat) can read to
 * rebuild working context without prior conversation history.
 *
 * Safe by design: reads LOCAL repo information only (git + a few tracked files). No network
 * calls, no writes outside `.ai/AI_BRIEF.md`, no secrets. Git commands are best-effort; if
 * git is unavailable the brief still generates with placeholders.
 *
 * Run:  npm run ai:brief   (or:  npx tsx scripts/generate-ai-brief.ts)
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

const REPO_ROOT = join(__dirname, '..');
const OUT_PATH = join(REPO_ROOT, '.ai', 'AI_BRIEF.md');

/** Run a shell command, returning trimmed stdout or a fallback on any failure. */
function safe(cmd: string, fallback = '(unavailable)'): string {
  try {
    return execSync(cmd, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return fallback;
  }
}

/** Read a tracked file relative to repo root, or return a fallback. */
function readRepoFile(relPath: string, fallback = ''): string {
  const full = join(REPO_ROOT, relPath);
  try {
    return existsSync(full) ? readFileSync(full, 'utf8') : fallback;
  } catch {
    return fallback;
  }
}

function npmScripts(): string {
  try {
    const pkg = JSON.parse(readRepoFile('package.json', '{}'));
    const scripts = pkg.scripts ?? {};
    const keys = Object.keys(scripts);
    if (keys.length === 0) return '(none)';
    return keys.map((k) => `- \`npm run ${k}\` — \`${scripts[k]}\``).join('\n');
  } catch {
    return '(could not parse package.json)';
  }
}

/**
 * Extracts the body text under a named `## <heading>` section of a markdown file
 * (e.g. the "Active task" section of .ai/CURRENT_TASK.md), stopping at the next
 * heading. Falls back to the fallback string if the heading isn't found.
 */
function sectionBody(relPath: string, heading: string, fallback = ''): string {
  const body = readRepoFile(relPath);
  if (!body) return fallback;
  const lines = body.split('\n');
  const startIdx = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (startIdx === -1) return fallback;
  const rest = lines.slice(startIdx + 1);
  const endIdx = rest.findIndex((l) => l.trim().startsWith('#'));
  const section = (endIdx === -1 ? rest : rest.slice(0, endIdx)).join('\n').trim();
  return section || fallback;
}

const generatedAt = new Date().toISOString();
const branch = safe('git rev-parse --abbrev-ref HEAD', 'unknown');
const lastCommit = safe('git log -1 --pretty=format:"%h %s (%cr)"');
const recentCommits = safe('git log --oneline -10');
const dirtyCount = safe('git status --porcelain', '').split('\n').filter(Boolean).length;
const trackedAiFiles = safe(
  'git ls-files .ai docs/prd docs/decisions docs/reviews docs/wizmatch/README.md "docs/wizmatch/WIZMATCH_STAFFING_OS_*.md"',
  '(none)',
);

const brief = `# AI_BRIEF.md — auto-generated context snapshot

<!-- GENERATED FILE — do not edit by hand. Regenerate with: npm run ai:brief -->

_Generated: ${generatedAt}_

This is a machine-generated snapshot of local repo state. It exists so any AI agent or fresh
chat can rebuild context from the repo alone. For durable guidance read \`AGENTS.md\`,
\`CLAUDE.md\`, and the \`.ai/\` files — this brief only reflects the moment it was run.

## Repository

- **Repo**: Growth-Escalators/Growth-Escalators-CRM
- **Branch**: \`${branch}\`
- **Last commit**: ${lastCommit}
- **Uncommitted changes**: ${dirtyCount} file(s)

## Current task

${sectionBody('.ai/CURRENT_TASK.md', 'Active task', '(see .ai/CURRENT_TASK.md)')}

> Full detail in [\`.ai/CURRENT_TASK.md\`](CURRENT_TASK.md) · state in [\`.ai/CURRENT_STATE.md\`](CURRENT_STATE.md)

## Recent commits

\`\`\`
${recentCommits}
\`\`\`

## npm scripts

${npmScripts()}

## Context layer files (tracked)

\`\`\`
${trackedAiFiles}
\`\`\`

## Where to read next

- \`AGENTS.md\` — universal agent instructions + guardrails
- \`CLAUDE.md\` — Claude-specific responsibilities
- \`.ai/TOOL_ROLES.md\` — Claude / Codex / ChatGPT role split
- \`.ai/REVIEW_CHECKLIST.md\` — the gate every change passes
- \`docs/\` — architecture, database, deployment, security, conventions
`;

writeFileSync(OUT_PATH, brief, 'utf8');
// eslint-disable-next-line no-console
console.log(`✓ Wrote ${OUT_PATH} (branch: ${branch}, ${dirtyCount} uncommitted file(s))`);
