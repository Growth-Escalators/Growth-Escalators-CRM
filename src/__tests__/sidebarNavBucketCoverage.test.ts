import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// @ts-ignore -- navEntries.js is intentionally plain JS; Vitest transpiles it.
import { getVisibleEntries } from '../../admin/src/components/navEntries.js';

const ADMIN = join(__dirname, '..', '..', 'admin', 'src');
const sidebar = readFileSync(join(ADMIN, 'components', 'Sidebar.jsx'), 'utf8');
const registry = readFileSync(join(ADMIN, 'routes', 'wizmatchRouteRegistry.ts'), 'utf8');

function renderedGroupKeys(): string[] {
  const m = sidebar.match(/const map = \{([^}]*)\};\s*\n\s*for \(const e of visible\)/);
  expect(m, 'the grouped bucket map moved — update this test').toBeTruthy();
  return (m![1].match(/'[^']+'|\btools\b|\bfinance\b|\bsettings\b/g) ?? [])
    .map((s) => s.replace(/'/g, '').trim())
    .filter(Boolean);
}

function renderedMoreSections(): string[] {
  const m = sidebar.match(/const MORE_SECTION_ORDER = \[([^\]]+)\]/);
  expect(m, 'MORE_SECTION_ORDER moved — update this test').toBeTruthy();
  return (m![1].match(/'([^']+)'/g) ?? []).map((s) => s.replace(/'/g, ''));
}

function registryBlocks(): string[] {
  return registry.split(/\n\s*\{\s*\n/).slice(1);
}

function registryIds(): string[] {
  return registryBlocks()
    .map((block) => block.match(/\bid: '([^']+)'/)?.[1])
    .filter((id): id is string => Boolean(id));
}

function registryPaths(): string[] {
  return registryBlocks()
    .map((block) => block.match(/\bpath: '([^']+)'/)?.[1])
    .filter((path): path is string => Boolean(path));
}

describe('every grouped nav entry lands in a rendered bucket', () => {
  it("every compatibility entry's More section is rendered", () => {
    const sections = renderedMoreSections();
    const orphans: string[] = [];
    for (const block of registryBlocks()) {
      const id = block.match(/\bid: '([^']+)'/)?.[1];
      const group = block.match(/\bgroup: '([^']+)'/)?.[1];
      const moreSection = block.match(/\bmoreSection: '([^']+)'/)?.[1];
      if (!id || !group || group === 'primary') continue;
      if (!moreSection || !sections.includes(moreSection)) orphans.push(id);
    }
    expect(orphans).toEqual([]);
  });

  it('every Growth nav group is a bucket the Sidebar renders', () => {
    const keys = renderedGroupKeys();
    const nav = readFileSync(join(ADMIN, 'components', 'navEntries.js'), 'utf8')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');
    const declared = [...nav.matchAll(/\bgroup: '([^']+)'/g)].map((m) => m[1]);
    const unrendered = [...new Set(declared)].filter((group) => !keys.includes(group));
    expect(unrendered).toEqual([]);
  });
});

describe('legacy wizmatch tenant exposes only Growth CRM compatibility navigation', () => {
  const allPhases = { A: true, B: true, C: true };
  const adminPerms = {
    staffingPilotAccess: true,
    billingView: true,
    isOwner: true,
    contractsView: true,
  };

  const visibleIds = () => getVisibleEntries(
    'admin',
    adminPerms,
    'wizmatch',
    allPhases,
    { gstBilling: true },
  ).map((entry: { id: string }) => entry.id);

  it('keeps the core CRM surfaces reachable in the transition', () => {
    const ids = visibleIds();
    for (const id of [
      'more-contacts',
      'more-pipeline',
      'more-tasks',
      'more-inbox',
      'more-templates-email',
      'more-templates-wa',
      'more-permissions',
      'more-audit',
      'more-branding',
      'more-configuration',
      'more-billing',
      'more-contracts',
      'more-expenses',
    ]) {
      expect(ids, `missing Growth CRM compatibility nav entry ${id}`).toContain(id);
    }
  });

  it('does not resurrect retired WizMatch product navigation', () => {
    const ids = registryIds();
    for (const id of [
      'today',
      'job-leads',
      'companies',
      'hiring-contacts',
      'requirements',
      'candidates',
      'submissions',
      'placements',
      'reports',
      'find-contact',
      'more-system',
      'more-provider-runs',
      'more-intelligence',
      'more-primes',
      'more-duplicates',
    ]) {
      expect(ids).not.toContain(id);
    }
  });

  it('compatibility entries point only at shared CRM pages', () => {
    const paths = registryPaths();
    for (const retiredPath of [
      '/wizmatch/today',
      '/wizmatch/job-leads',
      '/wizmatch/requirements',
      '/wizmatch/candidates',
      '/wizmatch/submissions',
      '/wizmatch/placements',
      '/wizmatch/reports',
      '/wizmatch/system',
    ]) {
      expect(paths).not.toContain(retiredPath);
    }
  });
});

describe('badge polling follows actual visible CRM navigation', () => {
  const allPhases = { A: true, B: true, C: true };
  const badgesFor = (role: string, perms: object, slug: string) =>
    getVisibleEntries(role, perms, slug, allPhases, { gstBilling: true })
      .map((entry: { badge?: string }) => entry.badge)
      .filter(Boolean);

  it('legacy tenant compatibility nav carries the CRM badges it actually renders', () => {
    const badges = badgesFor('admin', { billingView: true, isOwner: true }, 'wizmatch');
    expect(badges).toContain('inbox-unread');
    expect(badges).toContain('pending-leaves');
  });

  it('Growth CRM nav still carries both badges', () => {
    const badges = badgesFor('admin', { billingView: true }, 'growth-escalators');
    expect(badges).toContain('inbox-unread');
    expect(badges).toContain('pending-leaves');
  });

  it('a Growth user who cannot see Inbox does not poll for its count', () => {
    expect(badgesFor('staff', {}, 'growth-escalators')).not.toContain('inbox-unread');
  });
});
