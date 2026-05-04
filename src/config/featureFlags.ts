// Single source of truth for paused subsystems.
// Read by slackService (Slack kill switch), systemHealthMonitor (subsystem cards
// + score), and worker.ts (early-return cron guards).
//
// Two pause mechanisms exist in this repo:
//   1. Flag-based — cron body has `if (isPaused('x')) return;`. Flip the flag below
//      to toggle. Currently: seo, outreachEnrichment.
//   2. Comment-based — entire `cron.schedule(...)` is wrapped in /* */ in worker.ts
//      (the May 3 mass-pause pattern). Listed here too as documentation; flipping
//      the flag won't re-enable them — you must also uncomment the block.
//
// To toggle the global Slack kill switch without a redeploy:
//   set SLACK_NOTIFICATIONS_PAUSED=true on Railway.

export const PAUSED_FEATURES = {
  // Flag-guarded (toggleable via this file alone)
  seo: true,                  // SEO Weekly Email/Digest, PageSpeed, SEO Alert Triggers, Competitor Content Analysis
  outreachEnrichment: true,   // also pauses the discovery-freshness signal in checkOutreach

  // Comment-guarded (documentation only; also requires uncommenting in worker.ts)
  sodEod: true,               // SOD Digest, Sakcham Priority SOD, EOD Summary
  moneyOnTable: true,
  dailyIntelligence: true,    // Daily Intelligence Report
  retainerInvoice: true,
  monthlyInvoice: true,
  workflowSelfHealing: true,  // n8n workflows deleted upstream
} as const;

export type PausedFeature = keyof typeof PAUSED_FEATURES;

export const isPaused = (f: PausedFeature): boolean => PAUSED_FEATURES[f] === true;

export const SLACK_NOTIFICATIONS_PAUSED =
  process.env.SLACK_NOTIFICATIONS_PAUSED === 'true';
