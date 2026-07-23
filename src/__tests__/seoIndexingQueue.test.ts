import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

// ---------------------------------------------------------------------------
// Mocks — same pattern used in seoLearningLoop.test.ts
// ---------------------------------------------------------------------------
vi.mock('../db/index', () => ({
  db: {},
  pool: { query: vi.fn() },
}));

vi.mock('../services/seoTenantContext', () => ({
  resolveDefaultSeoTenantId: vi.fn().mockResolvedValue('tenant-seo-default'),
}));

vi.mock('../services/slackService', () => ({
  sendSlackDM: vi.fn().mockResolvedValue(true),
}));

vi.mock('../config/constants', () => ({
  SLACK_JATIN: 'U_TEST_JATIN',
  SEO_INDEXING_SITEMAP_URL: 'https://growthescalators.com/sitemap.xml',
  SEO_INDEXING_WEEKLY_LIMIT: 10,
}));

vi.mock('../utils/logger', () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('axios', () => ({
  default: { get: vi.fn() },
}));

import { pool } from '../db/index';
import { sendSlackDM } from '../services/slackService';
import axios from 'axios';
import {
  normalizeUrlForCompare,
  fetchSitemapUrls,
  loadTopPagesFromState,
  syncIndexingQueueFromSitemap,
  getDueIndexingItems,
  markIndexingStatus,
  sendIndexingReminderDigest,
} from '../services/seoIndexingQueueService';

describe('seoIndexingQueueService', () => {
  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
    vi.mocked(sendSlackDM).mockReset().mockResolvedValue(true as any);
    vi.mocked(axios.get).mockReset();
  });

  // -------------------------------------------------------------------------
  describe('normalizeUrlForCompare', () => {
    it('strips protocol, www, and trailing slash', () => {
      expect(normalizeUrlForCompare('https://www.growthescalators.com/services/'))
        .toBe('growthescalators.com/services');
    });

    it('treats bare-domain and www variants as equal', () => {
      expect(normalizeUrlForCompare('https://growthescalators.com/'))
        .toBe(normalizeUrlForCompare('https://www.growthescalators.com/'));
    });

    it('lowercases the result', () => {
      expect(normalizeUrlForCompare('HTTPS://WWW.Growthescalators.com/Blog'))
        .toBe('growthescalators.com/blog');
    });

    it('falls back to trimmed-lowercased input for unparsable strings', () => {
      expect(normalizeUrlForCompare('  Not A Url  ')).toBe('not a url');
    });
  });

  // -------------------------------------------------------------------------
  describe('fetchSitemapUrls', () => {
    it('extracts <loc> URLs and decodes XML entities', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: `<?xml version="1.0"?><urlset>
          <url><loc>https://www.growthescalators.com/</loc></url>
          <url><loc>https://www.growthescalators.com/services</loc></url>
          <url><loc>https://www.growthescalators.com/search?a=1&amp;b=2</loc></url>
        </urlset>`,
      } as any);

      const urls = await fetchSitemapUrls('https://growthescalators.com/sitemap.xml');

      expect(urls).toEqual([
        'https://www.growthescalators.com/',
        'https://www.growthescalators.com/services',
        'https://www.growthescalators.com/search?a=1&b=2',
      ]);
    });

    it('returns an empty array for a sitemap with no <loc> tags', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: '<urlset></urlset>' } as any);
      const urls = await fetchSitemapUrls('https://growthescalators.com/sitemap.xml');
      expect(urls).toEqual([]);
    });
  });

  // -------------------------------------------------------------------------
  describe('loadTopPagesFromState', () => {
    it('returns empty set + null pulledAt when the state file is missing', () => {
      const result = loadTopPagesFromState('/tmp/seo-idx-test/does-not-exist.json');
      expect(result.urls.size).toBe(0);
      expect(result.pulledAt).toBeNull();
    });

    it('parses topPages URLs (normalized) and pulledAt from a real state file', () => {
      const tmpFile = path.join(os.tmpdir(), `seo-state-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        pulledAt: '2026-07-22T19:38:45.104Z',
        gsc: {
          topPages: [
            { keys: ['https://www.growthescalators.com/'], clicks: 31 },
            { keys: ['https://www.growthescalators.com/services'], clicks: 1 },
          ],
        },
      }));

      const result = loadTopPagesFromState(tmpFile);
      fs.unlinkSync(tmpFile);

      expect(result.pulledAt).toBe('2026-07-22T19:38:45.104Z');
      expect(result.urls.has('growthescalators.com')).toBe(true);
      expect(result.urls.has('growthescalators.com/services')).toBe(true);
      expect(result.urls.size).toBe(2);
    });

    it('never throws on malformed JSON — returns empty set instead', () => {
      const tmpFile = path.join(os.tmpdir(), `seo-state-bad-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, '{ not valid json');
      const result = loadTopPagesFromState(tmpFile);
      fs.unlinkSync(tmpFile);
      expect(result.urls.size).toBe(0);
      expect(result.pulledAt).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  describe('syncIndexingQueueFromSitemap', () => {
    function mockPoolForSync(existingRows: Array<{ id: string; url: string; status: string }>) {
      vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
        const sql = String(text);
        if (sql.includes('SELECT id, url, status FROM seo_indexing_queue')) {
          return { rows: existingRows, rowCount: existingRows.length } as any;
        }
        if (sql.includes('INSERT INTO seo_indexing_queue')) {
          return { rows: [{ id: 'new-id' }], rowCount: 1 } as any;
        }
        if (sql.includes('UPDATE seo_indexing_queue')) {
          return { rows: [], rowCount: 1 } as any;
        }
        return { rows: [], rowCount: 0 } as any;
      });
    }

    it('queues sitemap URLs that are NOT in GSC top pages, skips ones that are', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: `<urlset>
          <url><loc>https://www.growthescalators.com/</loc></url>
          <url><loc>https://www.growthescalators.com/new-page-not-indexed</loc></url>
        </urlset>`,
      } as any);
      mockPoolForSync([]); // nothing tracked yet

      const tmpFile = path.join(os.tmpdir(), `seo-state-sync-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        pulledAt: '2026-07-22T19:38:45.104Z',
        gsc: { topPages: [{ keys: ['https://www.growthescalators.com/'], clicks: 31 }] },
      }));

      const result = await syncIndexingQueueFromSitemap('https://growthescalators.com/sitemap.xml', tmpFile);
      fs.unlinkSync(tmpFile);

      expect(result.totalSitemapUrls).toBe(2);
      expect(result.inserted).toBe(1); // only the non-indexed one
      expect(result.autoCompleted).toBe(0);
      expect(result.hasTopPagesData).toBe(true);

      const insertCall = vi.mocked(pool.query).mock.calls.find(([text]) => String(text).includes('INSERT INTO seo_indexing_queue'));
      expect(insertCall?.[1]).toEqual(['tenant-seo-default', 'https://www.growthescalators.com/new-page-not-indexed', expect.stringContaining('Not showing in GSC top pages')]);
    });

    it('auto-completes a previously-queued URL once it shows up in GSC top pages', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: `<urlset><url><loc>https://www.growthescalators.com/now-indexed</loc></url></urlset>`,
      } as any);
      mockPoolForSync([{ id: 'row-1', url: 'https://www.growthescalators.com/now-indexed', status: 'pending' }]);

      const tmpFile = path.join(os.tmpdir(), `seo-state-autocomplete-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify({
        pulledAt: '2026-07-22T19:38:45.104Z',
        gsc: { topPages: [{ keys: ['https://www.growthescalators.com/now-indexed'], clicks: 5 }] },
      }));

      const result = await syncIndexingQueueFromSitemap('https://growthescalators.com/sitemap.xml', tmpFile);
      fs.unlinkSync(tmpFile);

      expect(result.autoCompleted).toBe(1);
      expect(result.inserted).toBe(0);
      const updateCall = vi.mocked(pool.query).mock.calls.find(([text]) => String(text).includes('UPDATE seo_indexing_queue'));
      expect(updateCall).toBeTruthy();
    });

    it('does not re-insert a URL that is already tracked (idempotent)', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({
        data: `<urlset><url><loc>https://www.growthescalators.com/already-tracked</loc></url></urlset>`,
      } as any);
      mockPoolForSync([{ id: 'row-2', url: 'https://www.growthescalators.com/already-tracked', status: 'pending' }]);

      const result = await syncIndexingQueueFromSitemap('https://growthescalators.com/sitemap.xml', '/tmp/seo-idx-test/does-not-exist.json');

      expect(result.inserted).toBe(0);
      expect(result.autoCompleted).toBe(0); // not in top-pages (no state file) so stays pending
      const insertCalls = vi.mocked(pool.query).mock.calls.filter(([text]) => String(text).includes('INSERT INTO seo_indexing_queue'));
      expect(insertCalls.length).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  describe('getDueIndexingItems', () => {
    it('queries pending + requested items ordered oldest-first, respecting the limit', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [{ id: '1', url: 'https://a.com', reason: 'x', status: 'pending', date_added: '2026-01-01', last_reminded_at: null, requested_at: null, done_at: null }],
      } as any);

      const due = await getDueIndexingItems(5);

      expect(due).toHaveLength(1);
      const [sql, params] = vi.mocked(pool.query).mock.calls[0];
      expect(String(sql)).toContain(`status IN ('pending', 'requested')`);
      expect(params).toEqual(['tenant-seo-default', 5]);
    });
  });

  // -------------------------------------------------------------------------
  describe('markIndexingStatus', () => {
    it('returns not_found when nothing matches', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);
      const result = await markIndexingStatus('no-such-url', 'done');
      expect(result.outcome).toBe('not_found');
    });

    it('returns ambiguous with all candidates when multiple URLs match a substring', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({
        rows: [
          { id: '1', url: 'https://a.com/blog/one', status: 'pending' },
          { id: '2', url: 'https://a.com/blog/two', status: 'pending' },
        ],
      } as any);
      const result = await markIndexingStatus('blog', 'done');
      expect(result.outcome).toBe('ambiguous');
      if (result.outcome === 'ambiguous') expect(result.matches).toHaveLength(2);
    });

    it('updates status and sets done_at when marking done', async () => {
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: '1', url: 'https://a.com/page', status: 'requested' }] } as any) // SELECT
        .mockResolvedValueOnce({ rows: [], rowCount: 1 } as any); // UPDATE

      const result = await markIndexingStatus('page', 'done');

      expect(result.outcome).toBe('updated');
      const updateCall = vi.mocked(pool.query).mock.calls[1];
      expect(String(updateCall[0])).toContain('done_at = NOW()');
    });
  });

  // -------------------------------------------------------------------------
  describe('sendIndexingReminderDigest', () => {
    it('sends nothing and reports sent:false when the queue is empty', async () => {
      vi.mocked(axios.get).mockResolvedValueOnce({ data: '<urlset></urlset>' } as any); // sync: no sitemap urls
      vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
        const sql = String(text);
        if (sql.includes('SELECT id, url, status FROM seo_indexing_queue')) return { rows: [] } as any;
        if (sql.includes("status IN ('pending', 'requested')") && sql.includes('LIMIT')) return { rows: [] } as any;
        return { rows: [], rowCount: 0 } as any;
      });

      const result = await sendIndexingReminderDigest();

      expect(result.sent).toBe(false);
      expect(sendSlackDM).not.toHaveBeenCalled();
    });

    it('DMs Jatin with due URLs and marks them reminded when the queue has items due', async () => {
      vi.mocked(axios.get).mockRejectedValueOnce(new Error('network down')); // sync fails — reminder should still work off existing queue
      let callCount = 0;
      vi.mocked(pool.query).mockImplementation(async (text: unknown) => {
        const sql = String(text);
        callCount++;
        if (sql.includes("status IN ('pending', 'requested')") && sql.includes('LIMIT')) {
          return { rows: [{ id: '1', url: 'https://growthescalators.com/x', reason: 'new page', status: 'pending', date_added: '2026-07-01', last_reminded_at: null, requested_at: null, done_at: null }] } as any;
        }
        if (sql.includes('SELECT COUNT(*)::int AS count')) {
          return { rows: [{ count: 3 }] } as any;
        }
        if (sql.includes('UPDATE seo_indexing_queue SET last_reminded_at')) {
          return { rows: [], rowCount: 1 } as any;
        }
        return { rows: [], rowCount: 0 } as any;
      });

      const result = await sendIndexingReminderDigest();

      expect(result.sent).toBe(true);
      expect(result.count).toBe(1);
      expect(result.pendingTotal).toBe(3);
      expect(result.syncError).toContain('network down');
      expect(sendSlackDM).toHaveBeenCalledTimes(1);
      const [userId, message] = vi.mocked(sendSlackDM).mock.calls[0];
      expect(userId).toBe('U_TEST_JATIN');
      expect(message).toContain('https://growthescalators.com/x');
      expect(message).toContain('Request Indexing');
    });
  });
});
