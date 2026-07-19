import { beforeEach, describe, expect, it, vi } from 'vitest';
import crypto from 'crypto';

// Signal draft/send orchestration extracted from src/routes/wizmatch.ts (finding M26)
// into src/services/wizmatchOutreachService.ts. Draft generation calls Claude and
// persists messages via drizzle; sending HMAC-signs an unsubscribe link, checks
// suppression, sends via the multi-domain mailer, and enrolls a follow-up sequence.

const poolQuery = vi.fn();
const insertedRows: Array<{ table: unknown; values: unknown }> = [];
const onConflictDoNothing = vi.fn(async () => undefined);

vi.mock('../db/index', () => ({
  pool: { query: (...args: unknown[]) => poolQuery(...args) },
  db: {
    insert: (table: unknown) => ({
      values: (values: unknown) => {
        insertedRows.push({ table, values });
        return {
          returning: vi.fn(async () => [{ id: `msg-${insertedRows.length}`, ...(values as object) }]),
          onConflictDoNothing,
        };
      },
    }),
  },
}));

const callClaude = vi.fn();
const parseClaudeJSON = vi.fn();
vi.mock('../services/claudeService', () => ({
  callClaude: (...args: unknown[]) => callClaude(...args),
  parseClaudeJSON: (...args: unknown[]) => parseClaudeJSON(...args),
  CLAUDE_MODELS: { SONNET: 'claude-sonnet-test' },
}));

const sendColdEmail = vi.fn();
vi.mock('../services/multiDomainMailer', () => ({
  sendColdEmail: (...args: unknown[]) => sendColdEmail(...args),
}));

// Getters (rather than fixed values) so each test can flip
// WIZMATCH_UNSUBSCRIBE_HMAC_SECRET without needing vi.resetModules() + a dynamic
// re-import (which would also detach the statically-imported `sequenceEnrolments`
// table reference used below from the one the service module inserts against).
let unsubscribeHmacSecret = '';
vi.mock('../config/constants', () => ({
  get WIZMATCH_UNSUBSCRIBE_HMAC_SECRET() { return unsubscribeHmacSecret; },
  WIZMATCH_PHYSICAL_ADDRESS: 'Wizmatch LLC, Test Address',
}));

import { generateSignalDraftEmails, sendSignalDraftEmail } from '../services/wizmatchOutreachService';
import { sequenceEnrolments } from '../db/schema';

beforeEach(() => {
  poolQuery.mockReset();
  callClaude.mockReset();
  parseClaudeJSON.mockReset();
  sendColdEmail.mockReset();
  onConflictDoNothing.mockClear();
  insertedRows.length = 0;
  unsubscribeHmacSecret = '';
});

describe('generateSignalDraftEmails', () => {
  it('returns not_found when the signal does not exist', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const result = await generateSignalDraftEmails('tenant-1', 'sig-missing');
    expect(result).toEqual({ kind: 'not_found' });
  });

  it('returns no_contact when the signal has no enriched contact', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [{ id: 'sig-1', contact_id: null }] });
    const result = await generateSignalDraftEmails('tenant-1', 'sig-1');
    expect(result).toEqual({ kind: 'no_contact' });
  });

  it('generates and persists 3 draft variants on the happy path', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM wizmatch_job_signals s')) {
        return {
          rows: [{
            id: 'sig-1',
            contact_id: 'contact-1',
            company_name: 'Acme Tech',
            job_title: 'Senior Java Developer',
            days_open: 12,
            matched_candidate_ids: [],
          }],
        };
      }
      if (sql.includes("SET status = 'drafted'")) {
        return { rows: [] };
      }
      return { rows: [] };
    });
    callClaude.mockResolvedValueOnce({ text: '{"variant_a":{},"variant_b":{},"variant_c":{}}' });
    parseClaudeJSON.mockReturnValueOnce({
      variant_a: { subject: 'Subject A', body: 'Body A [UNSUBSCRIBE_LINK] [PHYSICAL_ADDRESS]' },
      variant_b: { subject: 'Subject B', body: 'Body B' },
      variant_c: { subject: 'Subject C', body: 'Body C' },
    });

    const result = await generateSignalDraftEmails('tenant-1', 'sig-1');

    expect(result.kind).toBe('succeeded');
    if (result.kind === 'succeeded') {
      expect(result.body.signalId).toBe('sig-1');
      expect(result.body.drafts).toHaveLength(3);
    }
    expect(insertedRows).toHaveLength(3);
    const calls = poolQuery.mock.calls.map((c) => String(c[0]));
    expect(calls.some((sql) => sql.includes("SET status = 'drafted'"))).toBe(true);
  });

  it('returns failed with the error detail when Claude generation throws', async () => {
    poolQuery.mockResolvedValueOnce({
      rows: [{ id: 'sig-1', contact_id: 'contact-1', company_name: 'Acme', job_title: 'Dev', matched_candidate_ids: [] }],
    });
    callClaude.mockRejectedValueOnce(new Error('claude timeout'));

    const result = await generateSignalDraftEmails('tenant-1', 'sig-1');
    expect(result).toEqual({ kind: 'failed', detail: 'claude timeout' });
  });
});

describe('sendSignalDraftEmail', () => {
  const draftRow = {
    id: 'msg-1',
    contact_id: 'contact-1',
    content: 'Hello [UNSUBSCRIBE_LINK] [PHYSICAL_ADDRESS]',
    metadata: { subject: 'Subject', signal_id: 'sig-1' },
    first_name: 'Jane',
    last_name: 'Doe',
  };

  it('returns not_found when the draft message does not exist', async () => {
    poolQuery.mockResolvedValueOnce({ rows: [] });
    const result = await sendSignalDraftEmail('tenant-1', 'msg-missing');
    expect(result).toEqual({ kind: 'not_found' });
  });

  it('returns no_email_channel when the contact has no email', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM messages m')) return { rows: [draftRow] };
      if (sql.includes('FROM contact_channels')) return { rows: [] };
      return { rows: [] };
    });
    const result = await sendSignalDraftEmail('tenant-1', 'msg-1');
    expect(result).toEqual({ kind: 'no_email_channel' });
  });

  it('returns suppressed when the contact email is on the suppression list', async () => {
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM messages m')) return { rows: [draftRow] };
      if (sql.includes('FROM contact_channels')) return { rows: [{ channel_value: 'jane@acme.com' }] };
      if (sql.includes('FROM wizmatch_suppression_list')) return { rows: [{ id: 'sup-1' }] };
      return { rows: [] };
    });
    const result = await sendSignalDraftEmail('tenant-1', 'msg-1');
    expect(result).toEqual({ kind: 'suppressed' });
  });

  it('fails closed instead of embedding a forgeable unsubscribe link when the HMAC secret is unset', async () => {
    unsubscribeHmacSecret = '';
    poolQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM messages m')) return { rows: [draftRow] };
      if (sql.includes('FROM contact_channels')) return { rows: [{ channel_value: 'jane@acme.com' }] };
      if (sql.includes('FROM wizmatch_suppression_list')) return { rows: [] };
      return { rows: [] };
    });

    const result = await sendSignalDraftEmail('tenant-1', 'msg-1');
    expect(result).toEqual({ kind: 'hmac_secret_unset' });
    expect(sendColdEmail).not.toHaveBeenCalled();
  });

  describe('with WIZMATCH_UNSUBSCRIBE_HMAC_SECRET set', () => {
    const TEST_SECRET = 'test-hmac-secret';

    beforeEach(() => {
      unsubscribeHmacSecret = TEST_SECRET;
    });

    it('signs the unsubscribe link with the correct HMAC and enrolls the follow-up sequence', async () => {
      poolQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM messages m')) return { rows: [draftRow] };
        if (sql.includes('FROM contact_channels')) return { rows: [{ channel_value: 'jane@acme.com' }] };
        if (sql.includes('FROM wizmatch_suppression_list')) return { rows: [] };
        if (sql.includes('UPDATE messages')) return { rows: [] };
        if (sql.includes('UPDATE wizmatch_job_signals')) return { rows: [] };
        if (sql.includes('FROM sequences')) return { rows: [{ id: 'seq-1' }] };
        return { rows: [] };
      });
      sendColdEmail.mockResolvedValueOnce({ from: 'archit@wizmatch.com', domain: 'wizmatch.com' });

      const result = await sendSignalDraftEmail('tenant-1', 'msg-1');

      expect(result.kind).toBe('succeeded');
      if (result.kind === 'succeeded') {
        expect(result.body).toEqual({ messageId: 'msg-1', sent: true, from: 'archit@wizmatch.com', domain: 'wizmatch.com' });
      }

      const expectedSig = crypto.createHmac('sha256', TEST_SECRET).update('jane@acme.com').digest('base64url');
      expect(sendColdEmail).toHaveBeenCalledTimes(1);
      const sentBody = sendColdEmail.mock.calls[0][0].body as string;
      expect(sentBody).toContain(`sig=${expectedSig}`);
      expect(sentBody).toContain('email=jane%40acme.com');

      // Sequence enrollment fires when an active Wizmatch sequence exists.
      expect(insertedRows.some((r) => r.table === sequenceEnrolments)).toBe(true);
    });

    it('skips sequence enrollment when no active Wizmatch sequence exists', async () => {
      poolQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM messages m')) return { rows: [draftRow] };
        if (sql.includes('FROM contact_channels')) return { rows: [{ channel_value: 'jane@acme.com' }] };
        if (sql.includes('FROM wizmatch_suppression_list')) return { rows: [] };
        if (sql.includes('UPDATE messages')) return { rows: [] };
        if (sql.includes('UPDATE wizmatch_job_signals')) return { rows: [] };
        if (sql.includes('FROM sequences')) return { rows: [] }; // no active sequence
        return { rows: [] };
      });
      sendColdEmail.mockResolvedValueOnce({ from: 'archit@wizmatch.com', domain: 'wizmatch.com' });

      const result = await sendSignalDraftEmail('tenant-1', 'msg-1');

      expect(result.kind).toBe('succeeded');
      expect(insertedRows).toHaveLength(0);
    });

    it('returns failed when the mailer throws', async () => {
      poolQuery.mockImplementation(async (sql: string) => {
        if (sql.includes('FROM messages m')) return { rows: [draftRow] };
        if (sql.includes('FROM contact_channels')) return { rows: [{ channel_value: 'jane@acme.com' }] };
        if (sql.includes('FROM wizmatch_suppression_list')) return { rows: [] };
        return { rows: [] };
      });
      sendColdEmail.mockRejectedValueOnce(new Error('smtp down'));

      const result = await sendSignalDraftEmail('tenant-1', 'msg-1');
      expect(result).toEqual({ kind: 'failed', detail: 'smtp down' });
    });
  });
});
