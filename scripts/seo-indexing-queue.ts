#!/usr/bin/env npx tsx
/**
 * GSC "Request Indexing" queue — manual ops CLI.
 *
 * This repo does not (and will not) automate Google Search Console's
 * "Request Indexing" click — there's no supported API for it on ordinary
 * pages. This script is the manual side of that human-in-the-loop loop:
 * Jatin does the clicking in the real GSC UI, then runs this to mark it done.
 *
 * Usage:
 *   npx tsx scripts/seo-indexing-queue.ts sync                 # re-run the sitemap/GSC diff now (same as the weekly cron)
 *   npx tsx scripts/seo-indexing-queue.ts remind                # send the Slack reminder DM now (same as the weekly cron)
 *   npx tsx scripts/seo-indexing-queue.ts list [status]         # list queue items (status: pending|requested|done, default: all)
 *   npx tsx scripts/seo-indexing-queue.ts requested <url>       # mark a URL as "clicked Request Indexing"
 *   npx tsx scripts/seo-indexing-queue.ts done <url>             # mark a URL as confirmed indexed
 *   npx tsx scripts/seo-indexing-queue.ts pending <url>          # revert a URL back to pending
 *
 * <url> matches by substring (case-insensitive) against the tracked URL — pass
 * enough of the path to be unambiguous (e.g. "blog/top-5-performance" rather
 * than just "blog").
 */
import dotenv from 'dotenv';
dotenv.config();

import {
  ensureSeoIndexingQueueTable,
  syncIndexingQueueFromSitemap,
  sendIndexingReminderDigest,
  listIndexingQueue,
  markIndexingStatus,
} from '../src/services/seoIndexingQueueService';

function printQueue(rows: Array<{ url: string; status: string; reason: string; date_added: string; last_reminded_at: string | null }>) {
  if (rows.length === 0) {
    console.log('(empty)');
    return;
  }
  for (const r of rows) {
    const added = new Date(r.date_added).toISOString().slice(0, 10);
    const reminded = r.last_reminded_at ? new Date(r.last_reminded_at).toISOString().slice(0, 10) : 'never';
    console.log(`[${r.status.padEnd(9)}] ${r.url}`);
    console.log(`             ${r.reason} (added ${added}, last reminded ${reminded})`);
  }
}

async function main() {
  const [, , command, arg] = process.argv;
  await ensureSeoIndexingQueueTable();

  switch (command) {
    case 'sync': {
      const result = await syncIndexingQueueFromSitemap();
      console.log(`Sitemap URLs: ${result.totalSitemapUrls}`);
      console.log(`Newly queued: ${result.inserted}`);
      console.log(`Auto-completed (now showing in GSC top pages): ${result.autoCompleted}`);
      if (!result.hasTopPagesData) {
        console.log('⚠️  No GSC top-pages data found — run `npm run ge:seo` first for an accurate diff.');
      }
      break;
    }
    case 'remind': {
      const result = await sendIndexingReminderDigest();
      if (result.sent) {
        console.log(`✅ Reminder sent — ${result.count} URL(s), ${result.pendingTotal} pending total.`);
      } else {
        console.log('Nothing due — no reminder sent.');
      }
      if (result.syncError) console.log(`⚠️  Sync warning: ${result.syncError}`);
      break;
    }
    case 'list': {
      const rows = await listIndexingQueue(arg);
      printQueue(rows);
      break;
    }
    case 'requested':
    case 'done':
    case 'pending': {
      if (!arg) {
        console.error(`Usage: npx tsx scripts/seo-indexing-queue.ts ${command} <url-substring>`);
        process.exit(1);
      }
      const result = await markIndexingStatus(arg, command);
      if (result.outcome === 'not_found') {
        console.error(`No queued URL matches "${arg}".`);
        process.exit(1);
      } else if (result.outcome === 'ambiguous') {
        console.error(`"${arg}" matches ${result.matches.length} URLs — be more specific:`);
        for (const m of result.matches) console.error(`  - ${m.url} [${m.status}]`);
        process.exit(1);
      } else {
        console.log(`✅ Marked ${command}: ${result.url}`);
      }
      break;
    }
    default:
      console.log(`Unknown command: ${command ?? '(none)'}\n`);
      console.log('Usage:');
      console.log('  npx tsx scripts/seo-indexing-queue.ts sync');
      console.log('  npx tsx scripts/seo-indexing-queue.ts remind');
      console.log('  npx tsx scripts/seo-indexing-queue.ts list [pending|requested|done]');
      console.log('  npx tsx scripts/seo-indexing-queue.ts requested <url>');
      console.log('  npx tsx scripts/seo-indexing-queue.ts done <url>');
      console.log('  npx tsx scripts/seo-indexing-queue.ts pending <url>');
      process.exit(command ? 1 : 0);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e instanceof Error ? e.message : e);
  process.exit(1);
});
