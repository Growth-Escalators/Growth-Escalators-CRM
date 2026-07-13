import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { buildContactSearchCondition } from '../services/contactSearch';

const dialect = new PgDialect();

function compile(search: string) {
  return dialect.sqlToQuery(buildContactSearchCondition('11111111-1111-1111-1111-111111111111', search));
}

describe('buildContactSearchCondition', () => {
  it('searches the combined full name instead of only independent name columns', () => {
    const query = compile('Asha Rao');
    expect(query.sql).toContain("CONCAT_WS(' ',");
    expect(query.params).toContain('%Asha Rao%');
  });

  it('searches tenant-scoped email and phone channels through a correlated EXISTS', () => {
    const query = compile('asha@example.test');
    expect(query.sql).toContain('FROM contact_channels search_channel');
    expect(query.sql).toContain('search_channel.tenant_id =');
    expect(query.sql).toContain("search_channel.channel_type IN ('email', 'phone', 'whatsapp')");
    expect(query.sql).toContain('search_channel.contact_id =');
    expect(query.params).toContain('%asha@example.test%');
  });

  it('trims accidental surrounding whitespace before building the pattern', () => {
    const query = compile('  Asha Rao  ');
    expect(query.params).toContain('%Asha Rao%');
    expect(query.params).not.toContain('%  Asha Rao  %');
  });
});
