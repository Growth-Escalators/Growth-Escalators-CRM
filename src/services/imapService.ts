import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import logger from '../utils/logger';
import { pool } from '../db/index';
import { parseBounce, recordHardBounce, bounceSuppressionEnabled } from './wizmatchBounceParser';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface ProspectReply {
  messageId: string;
  from: string;
  fromName: string;
  subject: string;
  body: string;
  inbox: string;
  leadId: number;
  firstName: string;
  company: string;
}

interface InboxConfig {
  user: string;
  envVar: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const INBOXES: InboxConfig[] = [
  { user: 'jatin@adscalelab.co',  envVar: 'PURELYMAIL_PASS_JATIN_ADSCALELAB' },
  { user: 'hello@adscalelab.co',  envVar: 'PURELYMAIL_PASS_HELLO_ADSCALELAB' },
  { user: 'jatin@partnerpeak.co', envVar: 'PURELYMAIL_PASS_JATIN_PARTNERPEAK' },
  { user: 'hello@partnerpeak.co', envVar: 'PURELYMAIL_PASS_HELLO_PARTNERPEAK' },
  { user: 'jatin@partners-ge.co', envVar: 'PURELYMAIL_PASS_JATIN_PARTNERSGE' },
  { user: 'hello@partners-ge.co', envVar: 'PURELYMAIL_PASS_HELLO_PARTNERSGE' },
];

// Per-mailbox hard timeout — overridden by IMAP_TIMEOUT_MS env var.
// Keeps total wall-clock time well under Railway's 60s proxy limit when
// running all 6 inboxes in parallel.
const IMAP_TIMEOUT_MS = parseInt(process.env.IMAP_TIMEOUT_MS ?? '8000', 10);

const SKIP_SENDER_PATTERNS = [
  '@purelymail.com', '@trulyinbox.com', 'noreply@', 'no-reply@',
  'mailer-daemon@', 'postmaster@', '@amazonses.com', '@sendgrid.net',
];

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------
export async function ensureProcessedRepliesTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outreach_processed_replies (
      id SERIAL PRIMARY KEY,
      email_message_id VARCHAR(500) UNIQUE NOT NULL,
      sender_email VARCHAR(255),
      processed_at TIMESTAMP DEFAULT NOW()
    )
  `);
  logger.info('[imap] outreach_processed_replies table ready');
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------
function isSpamOrWarmup(from: string, subject: string, body: string): boolean {
  const lc = from.toLowerCase();
  if (SKIP_SENDER_PATTERNS.some(p => lc.includes(p))) return true;
  // TrulyInbox warm-up emails always contain "Phone_N0:" in body
  if (body.includes('Phone_N0:')) return true;
  if (body.toLowerCase().includes('trulyinbox') || subject.toLowerCase().includes('trulyinbox')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Per-inbox IMAP fetch
// ---------------------------------------------------------------------------
interface RawEmail {
  messageId: string;
  from: string;
  fromName: string;
  subject: string;
  body: string;
  inbox: string;
  uid: number;
}

async function fetchFromInbox(inbox: InboxConfig): Promise<RawEmail[]> {
  const password = process.env[inbox.envVar];
  if (!password) {
    logger.warn({ inbox: inbox.user }, '[imap] No password configured — skipping');
    return [];
  }

  const client = new ImapFlow({
    host: 'imap.purelymail.com',
    port: 993,
    secure: true,
    auth: { user: inbox.user, pass: password },
    logger: false,
    connectionTimeout: IMAP_TIMEOUT_MS,
    greetingTimeout: Math.floor(IMAP_TIMEOUT_MS * 0.75),
    socketTimeout: IMAP_TIMEOUT_MS,
  });

  const emails: RawEmail[] = [];

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const seqNums = await client.search({ seen: false });
      if (!seqNums || !Array.isArray(seqNums) || seqNums.length === 0) return [];

      // Cap at 50 per inbox per poll to avoid overload
      const toFetch = seqNums.slice(-50);

      for await (const msg of client.fetch(toFetch, { source: true, envelope: true, flags: true })) {
        const fromAddr = msg.envelope?.from?.[0]?.address || '';
        const fromName = msg.envelope?.from?.[0]?.name || '';
        const subject  = msg.envelope?.subject || '';
        const uid      = msg.uid;
        const messageId = msg.envelope?.messageId || `${inbox.user}-uid-${uid}`;

        // Parse body from raw source
        let body = '';
        if (msg.source) {
          try {
            const parsed = await simpleParser(msg.source);
            body = parsed.text || '';
            if (!body && parsed.html) {
              body = parsed.html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
            }
          } catch {
            body = msg.source.toString().substring(0, 800);
          }
        }

        // Detect + (optionally) suppress hard bounces before the generic skip filter,
        // so "verify by sending" can confirm which guessed emails are undeliverable.
        const bounce = parseBounce({ from: fromAddr, subject, body });
        if (bounce.isBounce) {
          if (bounce.hard && bounce.bouncedRecipient && bounceSuppressionEnabled()) {
            await recordHardBounce(bounce.bouncedRecipient, { inbox: inbox.user });
          }
          await client.messageFlagsAdd([uid], ['\\Seen'], { uid: true });
          continue;
        }

        if (isSpamOrWarmup(fromAddr, subject, body)) {
          // Still mark warm-up as seen so it doesn't keep appearing
          await client.messageFlagsAdd([uid], ['\\Seen'], { uid: true });
          continue;
        }

        // Mark as seen immediately — prevents reprocessing even if we crash mid-run
        await client.messageFlagsAdd([uid], ['\\Seen'], { uid: true });

        emails.push({
          messageId,
          from: fromAddr,
          fromName,
          subject,
          body: body.substring(0, 1500),
          inbox: inbox.user,
          uid,
        });
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    logger.error({ inbox: inbox.user, err }, '[imap] Failed to fetch inbox');
  } finally {
    try { await client.logout(); } catch { /* ignore logout errors */ }
  }

  return emails;
}

// ---------------------------------------------------------------------------
// Per-inbox timeout wrapper — resolves to [] if the inbox takes too long
// ---------------------------------------------------------------------------
function fetchFromInboxWithTimeout(inbox: InboxConfig): Promise<RawEmail[]> {
  return new Promise<RawEmail[]>((resolve) => {
    const timer = setTimeout(() => {
      logger.warn({ inbox: inbox.user, timeoutMs: IMAP_TIMEOUT_MS }, '[imap] inbox timed out — skipping');
      resolve([]);
    }, IMAP_TIMEOUT_MS + 1000); // +1s grace over the IMAP socket timeout

    fetchFromInbox(inbox)
      .then((emails) => { clearTimeout(timer); resolve(emails); })
      .catch((err) => {
        clearTimeout(timer);
        logger.error({ inbox: inbox.user, err }, '[imap] inbox fetch error — skipping');
        resolve([]);
      });
  });
}

// ---------------------------------------------------------------------------
// Main export: fetch all prospect replies across 6 inboxes IN PARALLEL
// ---------------------------------------------------------------------------
export async function fetchProspectReplies(): Promise<ProspectReply[]> {
  // 1. Collect raw unseen emails across ALL 6 inboxes concurrently.
  //    Promise.allSettled ensures one failed/slow inbox never blocks the others.
  //    Total wall-clock time ≈ slowest single inbox (≤ IMAP_TIMEOUT_MS + 1s)
  //    instead of sum of all 6 — keeps us safely under Railway's 60s proxy limit.
  const results = await Promise.allSettled(
    INBOXES.map((inbox) => fetchFromInboxWithTimeout(inbox)),
  );

  const allEmails: RawEmail[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const inbox = INBOXES[i];
    if (r.status === 'fulfilled') {
      allEmails.push(...r.value);
      logger.info({ inbox: inbox.user, count: r.value.length }, '[imap] fetched');
    } else {
      logger.error({ inbox: inbox.user, reason: r.reason }, '[imap] inbox rejected');
    }
  }

  if (allEmails.length === 0) return [];

  // 2. Filter out already-processed message IDs
  const messageIds = allEmails.map(e => e.messageId);
  const { rows: alreadyProcessed } = await pool.query(
    `SELECT email_message_id FROM outreach_processed_replies WHERE email_message_id = ANY($1)`,
    [messageIds],
  );
  const processedSet = new Set<string>(alreadyProcessed.map((r: { email_message_id: string }) => r.email_message_id));
  const newEmails = allEmails.filter(e => !processedSet.has(e.messageId));

  if (newEmails.length === 0) return [];

  // 3. Match against outreach_leads WHERE status = 'Active'
  const senderEmails = newEmails.map(e => e.from.toLowerCase());
  const { rows: leads } = await pool.query(
    `SELECT id, first_name, company, email FROM outreach_leads
     WHERE LOWER(email) = ANY($1) AND status = 'Active'`,
    [senderEmails],
  );
  const leadsByEmail = new Map<string, { id: number; first_name: string; company: string }>();
  for (const row of leads) {
    leadsByEmail.set((row.email as string).toLowerCase(), row);
  }

  // 4. Build ProspectReply list and record as processed
  const replies: ProspectReply[] = [];
  for (const email of newEmails) {
    const lead = leadsByEmail.get(email.from.toLowerCase());
    if (!lead) {
      // Not a tracked prospect — still record to avoid re-checking
      await pool.query(
        `INSERT INTO outreach_processed_replies (email_message_id, sender_email)
         VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [email.messageId, email.from],
      ).catch(() => {});
      continue;
    }

    await pool.query(
      `INSERT INTO outreach_processed_replies (email_message_id, sender_email)
       VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [email.messageId, email.from],
    );

    replies.push({
      messageId: email.messageId,
      from:      email.from,
      fromName:  email.fromName || lead.first_name,
      subject:   email.subject,
      body:      email.body,
      inbox:     email.inbox,
      leadId:    lead.id as number,
      firstName: lead.first_name as string,
      company:   lead.company as string,
    });
  }

  logger.info({ total: allEmails.length, prospects: replies.length }, '[imap] prospect replies found');
  return replies;
}
