const PRIMARY_SECTION = 'Wizmatch';

function route(id, label, path, options = {}) {
  return Object.freeze({
    id,
    label,
    path,
    description: '',
    keywords: [],
    aliases: [],
    section: PRIMARY_SECTION,
    group: null,
    permission: 'staffing',
    phase: null,
    primary: false,
    ...options,
    product: 'wizmatch',
  });
}

// One product registry owns the operator-facing name, canonical URL, legacy
// aliases, command-search vocabulary and runtime staffing phase for Wizmatch.
// Components may add presentation details (for example Lucide icons), but must
// not create a second route/label map.
export const WIZMATCH_ROUTE_REGISTRY = Object.freeze([
  route('wm-my-work', 'Today', '/wizmatch/today', {
    primary: true,
    phase: 'A',
    description: 'Overdue, due today, blocked and waiting work in one place',
    keywords: ['dashboard', 'my work', 'review workbench', 'queue', 'next action'],
    aliases: [
      { path: '/wizmatch/dashboard' },
      { path: '/wizmatch/my-work' },
      { path: '/wizmatch/review-workbench' },
      { path: '/wizmatch/command-center' },
      { path: '/wizmatch/command-center-new' },
      { path: '/wizmatch/queue' },
      { path: '/wizmatch/local-demo-flow' },
    ],
  }),
  route('wm-signals', 'Job Leads', '/wizmatch/job-leads', {
    primary: true,
    permission: 'staffing-or-admin',
    description: 'Review TheirStack and ATS demand, then find the hiring POC',
    keywords: ['signals', 'demand', 'their stack', 'theirstack', 'ats', 'client discovery'],
    aliases: [
      { path: '/wizmatch/signals' },
      { path: '/wizmatch/client-discovery' },
      { path: '/wizmatch/client-discovery-new' },
    ],
  }),
  route('wm-relationships', 'Companies', '/wizmatch/companies', {
    primary: true,
    phase: 'A',
    description: 'Company records, approved hiring contacts, roles and activity',
    keywords: ['accounts', 'clients', 'company 360', 'relationships'],
    aliases: [{ path: '/wizmatch/relationships' }],
  }),
  route('wm-hiring-contacts', 'Hiring Contacts', '/wizmatch/hiring-contacts', {
    primary: true,
    phase: 'A',
    description: 'Named POCs, verified channels and requirement history',
    keywords: ['poc', 'people', 'talent acquisition', 'recruiter', 'contact intelligence'],
    aliases: [
      { path: '/wizmatch/contact-intelligence' },
      { path: '/wizmatch/contact-intelligence-new' },
    ],
  }),
  route('wm-requirements', 'Roles / Requirements', '/wizmatch/roles', {
    primary: true,
    phase: 'A',
    description: 'Intake, attribution, ownership, skills and delivery trace',
    keywords: ['requirements', 'roles', 'jobs', 'jd', 'requirement priority'],
    aliases: [
      { path: '/wizmatch/requirements' },
      { path: '/wizmatch/requirements/new', target: '/wizmatch/roles', defaults: { action: 'new' } },
      { path: '/wizmatch/requirement-priority-new', defaults: { view: 'priority' } },
    ],
  }),
  route('wm-talent-matching', 'Candidates', '/wizmatch/candidates', {
    primary: true,
    phase: 'B',
    description: 'Sourcing leads, evidence review, verified talent and matching',
    keywords: ['talent', 'matching', 'profiles', 'source candidates', 'candidate intelligence'],
    aliases: [
      { path: '/wizmatch/candidate-intelligence', defaults: { view: 'review' } },
      { path: '/wizmatch/candidate-intelligence-new', defaults: { view: 'review' } },
      { path: '/wizmatch/source-candidates', defaults: { view: 'sourcing' } },
      { path: '/wizmatch/talent-matching', defaults: { view: 'matching' } },
    ],
  }),
  route('wm-delivery', 'Submissions', '/wizmatch/submissions', {
    primary: true,
    phase: 'C',
    description: 'Consent, approval, delivery, interviews and offers',
    keywords: ['delivery', 'rtr', 'consent', 'interviews', 'offers'],
    aliases: [{ path: '/wizmatch/delivery' }],
  }),
  route('wm-placements', 'Placements', '/wizmatch/placements', {
    primary: true,
    phase: 'C',
    description: 'Starts, economics, invoices, collections and adjustments',
    keywords: ['joining', 'starts', 'invoice', 'collection', 'margin'],
  }),
  route('wm-analytics-new', 'Reports', '/wizmatch/reports', {
    primary: true,
    phase: 'C',
    permission: 'commercial',
    description: 'Staffing funnel, SLA, conversion, revenue and margin',
    keywords: ['analytics', 'funnel', 'conversion', 'revenue', 'collections'],
    aliases: [
      { path: '/wizmatch/analytics' },
      { path: '/wizmatch/analytics-new' },
    ],
  }),

  route('wm-inbox', 'Inbox', '/wizmatch/inbox', {
    group: 'more-communication', section: 'More', permission: 'inbox',
    keywords: ['email', 'messages'],
  }),
  route('wm-outreach', 'Outreach', '/wizmatch/outreach', {
    group: 'more-communication', section: 'More', permission: 'admin-tier',
    keywords: ['campaigns', 'sequences'],
  }),
  route('wm-emails', 'Email Templates', '/wizmatch/emails', {
    group: 'more-communication', section: 'More', permission: 'sequences',
    keywords: ['templates', 'email'],
  }),
  route('wm-wa-templates', 'WhatsApp Templates', '/wizmatch/whatsapp-templates', {
    group: 'more-communication', section: 'More', permission: 'sequences',
    keywords: ['wa', 'templates', 'whatsapp'],
  }),

  route('wm-contacts', 'CRM Contacts', '/wizmatch/contacts', {
    group: 'more-crm', section: 'More', permission: 'crm',
    keywords: ['shared contacts', 'people'],
  }),
  route('wm-pipeline', 'Pipeline', '/wizmatch/pipeline', {
    group: 'more-crm', section: 'More', permission: 'crm',
    keywords: ['deals', 'stages'],
  }),
  route('wm-tasks', 'Tasks', '/wizmatch/tasks', {
    group: 'more-crm', section: 'More', permission: 'tasks',
    keywords: ['to do', 'activity'],
  }),
  route('wm-discover', 'Lead Discovery', '/wizmatch/discover', {
    group: 'more-crm', section: 'More', permission: 'discovery',
    keywords: ['lead search'],
  }),
  route('wm-intelligence', 'AI Intelligence', '/wizmatch/intelligence', {
    group: 'more-crm', section: 'More', permission: 'admin-tier',
    keywords: ['ai', 'analysis'],
  }),
  route('wm-primes', 'Primes', '/wizmatch/primes', {
    group: 'more-crm', section: 'More', permission: 'admin-tier',
    keywords: ['prime contacts'],
  }),

  route('wm-billing', 'Billing', '/wizmatch/billing', {
    group: 'more-admin', section: 'More', permission: 'billing',
    keywords: ['invoices', 'finance'],
  }),
  route('wm-expenses', 'Expenses', '/wizmatch/finance', {
    group: 'more-admin', section: 'More', permission: 'billing',
    keywords: ['finance', 'leave approvals'],
  }),
  route('wm-system', 'System', '/wizmatch/system', {
    group: 'more-admin', section: 'More', permission: 'admin-tier',
    keywords: ['readiness', 'providers', 'source runs', 'guardrails', 'configuration'],
    aliases: [
      { path: '/wizmatch/domains', target: '/wizmatch/system', defaults: { tab: 'domains' } },
      { path: '/wizmatch/compliance', target: '/wizmatch/system', defaults: { tab: 'compliance' } },
      { path: '/wizmatch/guardrails-new', target: '/wizmatch/system', defaults: { tab: 'guardrails' } },
      { path: '/wizmatch/readiness', target: '/wizmatch/system', defaults: { tab: 'readiness' } },
    ],
  }),
  route('wm-permissions', 'Permissions', '/wizmatch/settings/permissions', {
    group: 'more-admin', section: 'More', permission: 'admin', keywords: ['roles', 'access'],
  }),
  route('wm-audit', 'Audit Log', '/wizmatch/settings/audit', {
    group: 'more-admin', section: 'More', permission: 'admin', keywords: ['history', 'events'],
  }),
  route('wm-pipeline-manager', 'Pipeline Settings', '/wizmatch/pipelines/settings', {
    group: 'more-admin', section: 'More', permission: 'admin', keywords: ['stages', 'configuration'],
  }),
]);

export const WIZMATCH_PRIMARY_ROUTES = Object.freeze(WIZMATCH_ROUTE_REGISTRY.filter((item) => item.primary));

export function getWizmatchRoute(id) {
  return WIZMATCH_ROUTE_REGISTRY.find((item) => item.id === id) || null;
}

function pathnameOnly(value) {
  return String(value || '').split(/[?#]/, 1)[0].replace(/\/+$/, '') || '/';
}

export function findWizmatchRoute(pathname) {
  const path = pathnameOnly(pathname);
  return WIZMATCH_ROUTE_REGISTRY.find((item) => (
    path === item.path
    || path.startsWith(`${item.path}/`)
    || item.aliases.some((alias) => path === alias.path || path.startsWith(`${alias.path}/`))
  )) || null;
}

export function wizmatchRouteSearchText(item) {
  return [item.label, item.description, ...(item.keywords || []), ...(item.aliases || []).map((alias) => alias.path)]
    .join(' ')
    .toLowerCase();
}

export function mergeRouteSearch(target, currentSearch = '', defaults = {}) {
  const [targetPath, targetSearch = ''] = String(target).split('?');
  const merged = new URLSearchParams(targetSearch);
  Object.entries(defaults || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && !merged.has(key)) merged.set(key, String(value));
  });
  const current = new URLSearchParams(String(currentSearch || '').replace(/^\?/, ''));
  current.forEach((value, key) => merged.set(key, value));
  const query = merged.toString();
  return `${targetPath}${query ? `?${query}` : ''}`;
}

export function wizmatchAliasTarget(pathname, currentSearch = '') {
  const path = pathnameOnly(pathname);
  for (const item of WIZMATCH_ROUTE_REGISTRY) {
    const alias = item.aliases.find((candidate) => candidate.path === path);
    if (alias) return mergeRouteSearch(alias.target || item.path, currentSearch, alias.defaults);
  }
  return null;
}

export function buildWizmatchEntityHref(entityType, id, extra = {}) {
  const encodedId = id == null ? '' : String(id);
  const definitions = {
    company: ['/wizmatch/companies', 'companyId'],
    signal: ['/wizmatch/job-leads', 'signalId'],
    contact: ['/wizmatch/hiring-contacts', 'contactId'],
    contact_candidate: ['/wizmatch/hiring-contacts', 'candidateId'],
    requirement: ['/wizmatch/roles', 'requirementId'],
    candidate: ['/wizmatch/candidates', 'candidateId'],
    submission: ['/wizmatch/submissions', 'submissionId'],
    placement: ['/wizmatch/placements', 'placementId'],
    task: ['/wizmatch/tasks', 'taskId'],
    safety: ['/wizmatch/system', null],
  };
  const [path, key] = definitions[entityType] || ['/wizmatch/today', null];
  return mergeRouteSearch(path, '', { ...(key && encodedId ? { [key]: encodedId } : {}), ...extra });
}

// Parameterized legacy pages used path segments for record identity. Canonical
// entity workspaces use a query key so the list and 360 view share one URL.
// Preserve every unrelated filter/tab query while ensuring the path identity
// cannot be replaced by a stale query-string value.
export function buildWizmatchLegacyEntityTarget(entityType, id, currentSearch = '') {
  const canonical = buildWizmatchEntityHref(entityType, id);
  const [path, identitySearch = ''] = canonical.split('?');
  const merged = new URLSearchParams(String(currentSearch || '').replace(/^\?/, ''));
  new URLSearchParams(identitySearch).forEach((value, key) => merged.set(key, value));
  const query = merged.toString();
  return `${path}${query ? `?${query}` : ''}`;
}

export const WIZMATCH_TODAY_BUCKETS = Object.freeze([
  { id: 'overdue', label: 'Overdue', description: 'Past the agreed next-action date' },
  { id: 'due_today', label: 'Due today', description: 'Actions to finish before the day closes' },
  { id: 'blocked', label: 'Blocked', description: 'Missing ownership, attribution or required evidence' },
  { id: 'waiting', label: 'Waiting', description: 'Assigned work with a future date or external dependency' },
  { id: 'recently_changed', label: 'Recently changed', description: 'Work updated recently that may need a follow-up' },
  { id: 'team_review', label: 'Team review', description: 'Safe review decisions for leads and administrators' },
]);

function startOfLocalDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function bucketForDueDate(dueAt, now) {
  if (!dueAt) return 'waiting';
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return 'waiting';
  const today = startOfLocalDay(now);
  const dueDay = startOfLocalDay(due);
  if (dueDay < today) return 'overdue';
  if (dueDay === today) return 'due_today';
  return 'waiting';
}

function normalizeServerWorkItem(item, now) {
  const allowedBuckets = new Set(WIZMATCH_TODAY_BUCKETS.map((bucket) => bucket.id));
  const entityType = item.entityType || item.entity_type || 'requirement';
  const entityId = item.entityId || item.entity_id || item.requirementId || item.requirement_id || item.id;
  return {
    id: item.id || `${entityType}:${entityId}`,
    bucket: allowedBuckets.has(item.bucket) ? item.bucket : bucketForDueDate(item.dueAt || item.due_at, now),
    entityType,
    entityId,
    title: item.title || item.recommendedAction || item.recommended_action || 'Review work item',
    subtitle: item.subtitle || item.companyName || item.company_name || '',
    blocker: item.blocker || '',
    recommendedAction: item.recommendedAction || item.recommended_action || item.nextAction || item.next_action || 'Open record',
    dueAt: item.dueAt || item.due_at || null,
    sla: item.sla || item.slaStatus || item.sla_status || item.slaDueAt || item.sla_due_at || null,
    capability: item.capability || null,
    href: item.href || item.entityHref || item.entity_href || buildWizmatchEntityHref(entityType, entityId),
  };
}

function normalizeRequirement(requirement, now) {
  const sourceName = [requirement.source_first_name, requirement.source_last_name].filter(Boolean).join(' ');
  const blockers = [];
  if (!requirement.company_id && !requirement.company_name) blockers.push('Company is missing');
  if (!sourceName || requirement.attribution_status === 'needs_attribution') blockers.push('Source hiring contact is missing');
  if (!requirement.next_action) blockers.push('Next action is missing');
  const bucket = blockers.length ? 'blocked' : bucketForDueDate(requirement.next_action_due_at, now);
  return {
    id: `requirement:${requirement.id}`,
    bucket,
    entityType: 'requirement',
    entityId: requirement.id,
    title: requirement.title || 'Untitled role',
    subtitle: [requirement.company_name || 'Company not set', sourceName || 'POC not set'].join(' · '),
    blocker: blockers.join(' · '),
    recommendedAction: requirement.next_action || (sourceName ? 'Complete role intake' : 'Add source hiring contact'),
    dueAt: requirement.next_action_due_at || null,
    sla: requirement.sla_due_at || requirement.sla_hours || null,
    capability: 'work_requirement',
    href: buildWizmatchEntityHref('requirement', requirement.id),
  };
}

function normalizeTask(task, now) {
  const entityType = task.requirement_id ? 'requirement' : task.company_id ? 'company' : 'task';
  const entityId = task.requirement_id || task.company_id || task.id;
  return {
    id: `task:${task.id}`,
    bucket: bucketForDueDate(task.due_at, now),
    entityType,
    entityId,
    title: task.title || 'Open staffing task',
    subtitle: task.description || '',
    blocker: '',
    recommendedAction: 'Complete task',
    dueAt: task.due_at || null,
    sla: null,
    capability: 'work_task',
    href: buildWizmatchEntityHref(entityType, entityId, { focus: 'tasks' }),
  };
}

function normalizeReviewAction(action) {
  const extra = action.targetType === 'contact_candidate'
    ? { view: 'research' }
    : action.targetType === 'candidate'
      ? { view: 'review' }
      : { action: action.actionType || 'review' };
  return {
    id: `review:${action.id}`,
    bucket: 'team_review',
    entityType: action.targetType || 'safety',
    entityId: action.targetId,
    title: action.title || 'Review team action',
    subtitle: action.subtitle || '',
    blocker: '',
    recommendedAction: String(action.actionType || 'Review').replaceAll('_', ' '),
    dueAt: null,
    sla: null,
    capability: 'team_review',
    href: buildWizmatchEntityHref(action.targetType || 'safety', action.targetId, extra),
  };
}

export function buildWizmatchTodayView(myWork = {}, workbench = {}, options = {}) {
  const now = options.now || new Date();
  const canReviewTeam = options.canReviewTeam === true;
  const supplied = Array.isArray(myWork.workItems) ? myWork.workItems.map((item) => normalizeServerWorkItem(item, now)) : [];
  const assigned = supplied.length
    ? supplied
    : [
        ...(Array.isArray(myWork.requirements) ? myWork.requirements.map((item) => normalizeRequirement(item, now)) : []),
        ...(Array.isArray(myWork.tasks) ? myWork.tasks.map((item) => normalizeTask(item, now)) : []),
      ];
  const teamReview = canReviewTeam && Array.isArray(workbench.actions)
    ? workbench.actions.map(normalizeReviewAction)
    : [];
  const seen = new Set();
  const items = [...assigned, ...teamReview]
    .filter((item) => {
      if (seen.has(item.id)) return false;
      seen.add(item.id);
      return true;
    })
    .sort((a, b) => {
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
      return aDue - bDue || a.title.localeCompare(b.title);
    });
  const buckets = Object.fromEntries(WIZMATCH_TODAY_BUCKETS.map((bucket) => [bucket.id, items.filter((item) => item.bucket === bucket.id)]));
  return {
    items,
    buckets,
    metrics: {
      needsAttention: buckets.overdue.length + buckets.due_today.length + buckets.blocked.length,
      assignedRoles: new Set(items.filter((item) => item.entityType === 'requirement').map((item) => item.entityId)).size,
      teamReview: buckets.team_review.length,
    },
  };
}
