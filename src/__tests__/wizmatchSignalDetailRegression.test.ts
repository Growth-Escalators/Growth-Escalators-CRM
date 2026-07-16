import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Regression guard for the tenant-wide 500 on GET /api/wizmatch/signals/:id.
// The drafts sub-query selected messages.created_at, but the messages table only
// has sent_at (see src/db/schema.ts). The endpoint runs this query on every
// signal-detail open regardless of which signal it is, so the wrong column
// broke the detail view for the whole tenant. Keep the query on sent_at.
describe('Wizmatch signal-detail drafts query', () => {
  const source = readFileSync(join(__dirname, '..', 'routes', 'wizmatch.ts'), 'utf8');
  const anchor = source.indexOf('// Get draft messages');
  const draftsBlock = source.slice(anchor, anchor + 400);

  it('has the drafts block present in the signal-detail route', () => {
    expect(anchor).toBeGreaterThan(-1);
    expect(draftsBlock).toContain('FROM messages');
  });

  it('orders/selects messages by sent_at, never a nonexistent created_at', () => {
    expect(draftsBlock).toContain('sent_at');
    expect(draftsBlock).not.toContain('created_at');
  });
});
