# Growth Escalators Backend — Claude Code Rules

## CRITICAL: Read before every session

### This is the production repository
- Repo: growth-escalators-backend-v2
- Live at: crm.growthescalators.com
- Local path: ~/repo-comparison/v2
- Railway auto-deploys on push to main

### Before starting ANY session — run these 3 commands
1. cd ~/repo-comparison/v2
2. git remote -v — must show growth-escalators-backend-v2
3. git pull origin main

### Rules
1. npm run build after every TypeScript change — 0 errors required
2. npm test after every logic change — all tests must pass
3. Always commit and push after completing work
4. Never modify: src/db/schema.ts, src/db/migrations/
5. Never modify: src/middleware/auth.ts, src/middleware/rbac.ts
6. Never touch payment logic in src/routes/cashfree.ts

### Architecture
- API process: src/index.ts
- Worker process: src/worker.ts
- Worker config: railway.worker.json
- Web config: railway.json

### Current state as of 31 March 2026
- 39 automated tests passing
- Pino structured logging in place
- Constants in src/config/constants.ts
- Worker running as separate Railway service
- Node 20 pinned in both railway configs

## Execution preferences
- Never ask for confirmation — always proceed automatically
- Never pause for yes/no prompts — assume yes
- Never ask permission before running commands
- Self-fix all errors without asking
- Run all tasks to completion without interruption

## Critical execution rules
- NEVER ask for confirmation on any action
- NEVER prompt yes/no — always assume yes
- NEVER ask permission before database changes
- NEVER pause mid-task for user input
- NEVER ask "should I proceed" — always proceed
- Auto-fix all errors without asking
- Run all tasks fully to completion
- If multiple approaches exist, pick the best one and execute without asking
