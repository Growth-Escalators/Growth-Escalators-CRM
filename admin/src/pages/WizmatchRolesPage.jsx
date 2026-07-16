import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { ArrowLeft, CalendarClock, CheckCircle2, FileText, Filter, RefreshCw, Search, Sparkles, Upload } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { requirementStagePresentation } from './wizmatch-ui/requirementWorkflow.js';
import { Button, DataTable, Input, Modal } from '../components/ui/index.js';
import {
  ActivityTimeline,
  DataState,
  EntityHeader,
  NextActionPanel,
  ReadinessChecklist,
  StageStepper,
  StatusBadge,
  WorkspacePage,
  WorkspaceTabs,
  humanize,
} from '../components/wizmatch/WorkspaceUI.jsx';

const ACTIVE_STAGES = ['draft', 'qualifying', 'accepted', 'sourcing', 'covered', 'submitted', 'interviewing', 'offer', 'filled'];
const STAGE_LABELS = ACTIVE_STAGES.map(id => ({ id, label: humanize(id) }));
const ROLE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'skills', label: 'Skills & Matches' },
  { id: 'candidates', label: 'Candidates' },
  { id: 'submissions', label: 'Submissions' },
  { id: 'commercial', label: 'Commercial' },
  { id: 'activity', label: 'Activity' },
  { id: 'documents', label: 'Documents' },
];

const EMPTY_FILTERS = { search: '', stage: '', attribution: '', priority: '' };

function contactName(contact) {
  return [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || 'Unknown person';
}

function formatDate(value, fallback = 'Not scheduled') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

function formatMoney(amount, currency = 'INR', period) {
  if (amount === null || amount === undefined || amount === '') return 'Not recorded';
  const formatted = new Intl.NumberFormat(currency === 'INR' ? 'en-IN' : 'en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(amount));
  return `${formatted}${period ? ` / ${humanize(period).toLowerCase()}` : ''}`;
}

function readinessItems(readiness) {
  const checks = readiness?.checks || {};
  return [
    ['Company selected', checks.company],
    ['Named primary source contact', checks.primarySource],
    ['Genuine source contact channel', checks.primarySourceChannel],
    ['Account owner assigned', checks.accountOwner],
    ['Recruiter assigned', checks.recruiter],
    ['SLA due date', checks.sla],
    ['Dated next action', checks.datedNextAction],
    ['Mandatory canonical skill reviewed', checks.mandatorySkill],
  ].map(([label, complete]) => ({ label, complete: Boolean(complete) }));
}

export default function WizmatchRolesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('requirementId') || '';
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [tab, setTab] = useState(searchParams.get('tab') || 'overview');
  const [showIntake, setShowIntake] = useState(false);

  useEffect(() => {
    if (searchParams.get('action') === 'new') setShowIntake(true);
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const params = new URLSearchParams({ limit: '200' });
      if (filters.stage) params.set('stage', filters.stage);
      if (filters.attribution) params.set('attribution_status', filters.attribution);
      if (filters.priority) params.set('priority', filters.priority);
      const data = await apiFetch(`/api/wizmatch/requirements?${params}`);
      const query = filters.search.trim().toLowerCase();
      const rows = query
        ? (data.items || []).filter(item => `${item.title} ${item.company_name || ''} ${item.primary_source_name || ''} ${(item.required_skills || []).join(' ')}`.toLowerCase().includes(query))
        : data.items || [];
      setItems(rows); setTotal(data.total || rows.length);
    } catch (requestError) {
      setItems([]); setTotal(0); setError(requestError.message || 'Roles could not be loaded.');
    } finally { setLoading(false); }
  }, [filters]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) { setDetail(null); setDetailError(''); return; }
    setDetailLoading(true); setDetailError('');
    try { setDetail(await apiFetch(`/api/wizmatch/staffing/requirements/${selectedId}`)); }
    catch (requestError) { setDetail(null); setDetailError(requestError.message || 'This role could not be loaded.'); }
    finally { setDetailLoading(false); }
  }, [selectedId]);

  useEffect(() => { const timer = window.setTimeout(load, 250); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const openRole = role => setSearchParams({ requirementId: role.id });
  const closeRole = () => setSearchParams({});
  const changeTab = nextTab => { setTab(nextTab); setSearchParams({ requirementId: selectedId, tab: nextTab }); };

  if (selectedId) {
    return (
      <WorkspacePage
        eyebrow="Roles / Requirements"
        title="Requirement 360"
        description="The complete trace from company and source person through matching, delivery and commercial close."
        actions={<Button onClick={closeRole} icon={<ArrowLeft />}>All roles</Button>}
      >
        <DataState loading={detailLoading} error={detailError} onRetry={loadDetail} empty={!detail} emptyTitle="Role not found">
          {detail && <Requirement360 data={detail} tab={tab} onTabChange={changeTab} onRefresh={() => { loadDetail(); load(); }} />}
        </DataState>
      </WorkspacePage>
    );
  }

  return (
    <WorkspacePage
      eyebrow="Delivery demand"
      title="Roles / Requirements"
      description="Every role is tied to one company, its genuine source person, an accountable team, reviewed skills and a dated next action."
      actions={<><Button onClick={load} icon={<RefreshCw />}>Refresh</Button><Button variant="primary" onClick={() => setSearchParams({ action: 'new' })} icon={<FileText />}>New role</Button></>}
    >
      <div className="card grid gap-3 p-4 xl:grid-cols-[minmax(240px,1fr)_180px_180px_160px_auto]">
        <Input label="Search" value={filters.search} onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} placeholder="Role, company, person or skill" />
        <SelectField label="Stage" value={filters.stage} onChange={value => setFilters(current => ({ ...current, stage: value }))} options={[['', 'Any stage'], ...ACTIVE_STAGES.map(value => [value, humanize(value)]), ['on_hold', 'On Hold'], ['closed_lost', 'Closed Lost'], ['cancelled', 'Cancelled']]} />
        <SelectField label="Attribution" value={filters.attribution} onChange={value => setFilters(current => ({ ...current, attribution: value }))} options={[['', 'Any attribution'], ['attributed', 'Attributed'], ['needs_attribution', 'Needs Attribution']]} />
        <SelectField label="Priority" value={filters.priority} onChange={value => setFilters(current => ({ ...current, priority: value }))} options={[['', 'Any priority'], ['urgent', 'Urgent'], ['high', 'High'], ['normal', 'Normal'], ['low', 'Low']]} />
        <Button className="self-end" disabled={!Object.values(filters).some(Boolean)} onClick={() => setFilters(EMPTY_FILTERS)} icon={<Filter />}>Clear</Button>
      </div>
      <p className="text-sm text-neutral-600">Showing {items.length} of {total} roles</p>
      <DataState loading={loading} error={error} onRetry={load} empty={!items.length} emptyTitle="No roles match these filters" emptyDescription="Clear filters or create a genuine new role through the guided intake.">
        <div className="hidden md:block">
          <DataTable tableLabel="Roles and requirements" rows={items} onRowClick={openRole} columns={[
            { key: 'title', label: 'Role', render: role => <div><p className="font-semibold text-neutral-900">{role.title}</p><p className="text-xs text-neutral-600">{(role.required_skills || []).slice(0, 4).join(' · ') || 'Skills not reviewed'}</p></div> },
            { key: 'company_name', label: 'Company → source person', render: role => <div><p className="font-medium text-neutral-900">{role.company_name || 'Company missing'}</p><p className={`text-xs ${role.primary_source_name ? 'text-neutral-600' : 'font-medium text-warning-700'}`}>{role.primary_source_name || 'Source person needed'}</p></div> },
            { key: 'assignments', label: 'Assigned team', render: role => (role.assignments || []).length ? <div>{role.assignments.map(assignment => <p key={assignment.id} className="text-xs"><span className="font-medium text-neutral-900">{assignment.name}</span> · {humanize(assignment.role)}</p>)}</div> : <span className="font-medium text-warning-700">Team needed</span> },
            { key: 'stage', label: 'Workflow stage', render: role => <StatusBadge status={role.stage || 'draft'} /> },
            { key: 'next_action', label: 'Next action', render: role => <div><p className={role.next_action ? 'text-neutral-900' : 'font-medium text-warning-700'}>{role.next_action || 'Not set'}</p><p className="text-xs text-neutral-600">{formatDate(role.next_action_due_at, '')}</p></div> },
            { key: 'priority', label: 'Priority', render: role => <StatusBadge status={role.priority === 'urgent' ? 'overdue' : role.priority || 'normal'} label={humanize(role.priority || 'normal')} /> },
          ]} />
        </div>
        <div className="grid gap-3 md:hidden">{items.map(role => <button type="button" key={role.id} onClick={() => openRole(role)} className="card p-4 text-left focus:outline-none focus:ring-2 focus:ring-primary-400"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-neutral-900">{role.title}</p><p className="mt-1 text-sm text-neutral-600">{role.company_name} → {role.primary_source_name || 'source person needed'}</p></div><StatusBadge status={role.stage || 'draft'} /></div><p className="mt-3 text-sm text-neutral-700">Next: {role.next_action || 'complete intake'}</p><p className="mt-1 text-xs text-neutral-600">{formatDate(role.next_action_due_at, '')}</p></button>)}</div>
      </DataState>
      <RequirementIntakeModal open={showIntake} onClose={() => { setShowIntake(false); setSearchParams({}); }} onCreated={created => { setShowIntake(false); setSearchParams({ requirementId: created.id }); load(); }} />
    </WorkspacePage>
  );
}

function SelectField({ label, value, onChange, options }) {
  const id = useId();
  return <div><label htmlFor={id} className="mb-1 block text-[13px] font-semibold text-neutral-700">{label}</label><select id={id} value={value} onChange={event => onChange(event.target.value)} className="h-9 w-full rounded-sm border border-neutral-300 bg-white px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-200">{options.map(([optionValue, optionLabel]) => <option key={optionValue || 'all'} value={optionValue}>{optionLabel}</option>)}</select></div>;
}

function Requirement360({ data, tab, onTabChange, onRefresh }) {
  const { requirement, contacts = [], assignments = [], events = [], tasks = [], readiness = {}, relatedCounts = {}, requirementSkills = [] } = data;
  const [showPlan, setShowPlan] = useState(false);
  const [showTransition, setShowTransition] = useState(false);
  const [showXray, setShowXray] = useState(false);
  const source = contacts.find(contact => contact.active && contact.is_primary_source);
  const recruiter = assignments.find(assignment => assignment.active && assignment.role === 'recruiter');
  const owner = assignments.find(assignment => assignment.active && assignment.role === 'account_owner');
  const allowed = data.allowedTransitions || [];
  const stagePresentation = requirementStagePresentation(requirement.stage);
  const tabs = ROLE_TABS.map(item => ({ ...item, count: item.id === 'skills' ? requirementSkills.length : item.id === 'submissions' ? relatedCounts.submission_count : item.id === 'activity' ? events.length : undefined }));
  const nextAllowed = allowed.find(transition => transition.allowed && !['closed_lost', 'cancelled', 'on_hold'].includes(transition.stage));
  const nextAction = !stagePresentation.active
    ? {
        blocked: stagePresentation.stage === 'on_hold',
        title: `Requirement is ${stagePresentation.label.toLowerCase()}`,
        description: stagePresentation.description,
        action: nextAllowed ? <Button size="compact" variant="primary" onClick={() => setShowTransition(true)}>Review allowed transition</Button> : undefined,
      }
    : !readiness.acceptance?.ready
    ? { blocked: true, title: 'Complete requirement intake', description: `Missing: ${(readiness.acceptance?.missing || []).join(', ') || 'required intake evidence'}`, action: <Button size="compact" variant="primary" onClick={() => setShowPlan(true)}>Complete intake</Button> }
    : requirement.stage === 'qualifying'
      ? { title: 'Accept this role for delivery', description: 'All acceptance facts are present. Confirm the transition to start accountable delivery.', action: <Button size="compact" variant="primary" onClick={() => setShowTransition(true)}>Review transition</Button> }
      : !readiness.matching?.ready
        ? { blocked: true, title: 'Review mandatory canonical skills', description: 'Candidate matching stays unavailable until at least one mandatory canonical skill is confirmed.', action: <Button size="compact" variant="primary" onClick={() => onTabChange('skills')}>Review skills</Button> }
        : ['accepted', 'sourcing', 'covered'].includes(requirement.stage)
          ? { title: 'Review or source requirement-specific candidates', description: 'Use reviewed evidence only. Sourcing creates unverified leads and never a shortlist or submission.', action: <Button size="compact" variant="primary" onClick={() => setShowXray(true)}>Source up to 3 leads</Button> }
          : { title: requirement.next_action || (nextAllowed ? `Move to ${humanize(nextAllowed.stage)}` : 'Review current delivery work'), description: 'Use the dated action and timeline to keep ownership clear.', action: nextAllowed ? <Button size="compact" variant="primary" onClick={() => setShowTransition(true)}>Update stage</Button> : undefined };

  return <div className="space-y-4">
    <EntityHeader
      trail={[{ label: 'Roles / Requirements', to: '/wizmatch/roles' }, { label: requirement.company_name, to: `/wizmatch/companies?companyId=${requirement.company_id}` }, source ? { label: contactName(source), to: `/wizmatch/hiring-contacts?contactId=${source.company_contact_id}` } : { label: 'Source person needed' }, { label: requirement.title }]}
      title={requirement.title}
      subtitle={`${requirement.company_name || 'Company missing'} → ${source ? contactName(source) : 'Source person needed'} → ${requirement.title}`}
      status={requirement.stage || 'draft'}
      metadata={[
        { label: 'Account owner', value: owner?.name || 'Not assigned' },
        { label: 'Recruiter', value: recruiter?.name || 'Not assigned' },
        { label: 'SLA', value: formatDate(requirement.sla_due_at) },
        { label: 'Next action', value: requirement.next_action || 'Not set' },
      ]}
      action={<Button onClick={() => setShowPlan(true)}>Update intake</Button>}
    />
    {stagePresentation.active
      ? <StageStepper stages={STAGE_LABELS} current={stagePresentation.stage} />
      : <section className="card border-warning-200 bg-warning-50 p-4" aria-label="Current requirement state"><div className="flex flex-wrap items-center gap-3"><StatusBadge status={stagePresentation.stage} label={stagePresentation.label} /><p className="text-sm font-medium text-warning-900">{stagePresentation.description}</p></div></section>}
    <NextActionPanel {...nextAction} dueAt={requirement.next_action_due_at} />
    <WorkspaceTabs tabs={tabs} active={tab} onChange={onTabChange} label="Requirement 360 sections" />
    {tab === 'overview' && <RequirementOverview data={data} onUpdatePlan={() => setShowPlan(true)} onTransition={() => setShowTransition(true)} />}
    {tab === 'skills' && <RequirementSkillsAndMatches requirement={requirement} requirementSkills={requirementSkills} readiness={readiness} onSaved={onRefresh} />}
    {tab === 'candidates' && <RequirementCandidates requirement={requirement} readiness={readiness} onSource={() => setShowXray(true)} />}
    {tab === 'submissions' && <RequirementSubmissions requirementId={requirement.id} />}
    {tab === 'commercial' && <RequirementCommercial requirement={requirement} relatedCounts={relatedCounts} />}
    {tab === 'activity' && <section className="card p-5"><h3 className="font-semibold text-neutral-900">Requirement activity</h3><p className="mb-4 mt-1 text-sm text-neutral-600">Append-only ownership, attribution, matching and delivery history for this exact role.</p><ActivityTimeline items={events} /></section>}
    {tab === 'documents' && <RequirementDocuments requirement={requirement} />}
    <RequirementPlanModal open={showPlan} data={data} onClose={() => setShowPlan(false)} onSaved={() => { setShowPlan(false); onRefresh(); }} />
    <TransitionModal open={showTransition} requirement={requirement} transitions={allowed} onClose={() => setShowTransition(false)} onSaved={() => { setShowTransition(false); onRefresh(); }} />
    <XrayModal open={showXray} requirement={requirement} onClose={() => setShowXray(false)} onSaved={() => { setShowXray(false); onTabChange('candidates'); }} />
  </div>;
}

function RequirementOverview({ data, onUpdatePlan, onTransition }) {
  const { requirement, contacts = [], assignments = [], tasks = [], readiness } = data;
  return <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
    <div className="space-y-4">
      <section className="card p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-neutral-900">Ownership and attribution</h3><p className="mt-1 text-sm text-neutral-600">Who supplied the role and who is accountable now.</p></div><Button size="compact" onClick={onUpdatePlan}>Update</Button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><div className="rounded-md bg-neutral-50 p-3"><p className="text-xs font-semibold uppercase text-neutral-600">Source contacts</p>{contacts.filter(contact => contact.active).map(contact => <Link key={contact.id} to={`/wizmatch/hiring-contacts?contactId=${contact.company_contact_id}`} className="mt-2 block font-medium text-primary-700">{contactName(contact)} · {humanize(contact.role)}{contact.is_primary_source ? ' · primary' : ''}</Link>)}{!contacts.some(contact => contact.active) && <p className="mt-2 font-medium text-warning-700">Not attributed</p>}</div><div className="rounded-md bg-neutral-50 p-3"><p className="text-xs font-semibold uppercase text-neutral-600">Assigned team</p>{assignments.filter(assignment => assignment.active).map(assignment => <p key={assignment.id} className="mt-2 font-medium text-neutral-900">{assignment.name} · {humanize(assignment.role)}</p>)}{!assignments.some(assignment => assignment.active) && <p className="mt-2 font-medium text-warning-700">Not assigned</p>}</div></div></section>
      <section className="card p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-neutral-900">Role facts</h3><p className="mt-1 text-sm text-neutral-600">Workflow stage is separate from document status.</p></div><Button size="compact" onClick={onTransition}>Change legal stage</Button></div><dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[
        ['Workflow stage', humanize(requirement.stage)], ['Document status', humanize(requirement.status)], ['Location', [requirement.location, humanize(requirement.work_mode, '')].filter(Boolean).join(' · ')], ['Employment', humanize(requirement.employment_type)], ['Experience', requirement.min_experience != null ? `${requirement.min_experience}${requirement.max_experience != null ? `–${requirement.max_experience}` : '+'} years` : null], ['Positions', requirement.positions], ['Budget minimum', formatMoney(requirement.budget_min, requirement.budget_currency, requirement.budget_period)], ['Budget maximum', formatMoney(requirement.budget_max, requirement.budget_currency, requirement.budget_period)], ['Priority', humanize(requirement.priority)],
      ].map(([label, value]) => <div key={label} className="rounded-md bg-neutral-50 p-3"><dt className="text-xs font-semibold uppercase text-neutral-600">{label}</dt><dd className="mt-1 font-medium text-neutral-900">{value || 'Not recorded'}</dd></div>)}</dl></section>
      {requirement.source_signal_provider && <section className="card p-5"><h3 className="font-semibold text-neutral-900">Originating job lead</h3><p className="mt-2 text-sm text-neutral-700">{humanize(requirement.source_signal_provider)} · {requirement.source_signal_title || requirement.title}</p>{requirement.source_signal_url && <a className="mt-2 inline-block text-sm font-semibold text-primary-700" href={requirement.source_signal_url} target="_blank" rel="noreferrer">Open public source</a>}</section>}
    </div>
    <div className="space-y-4"><ReadinessChecklist title="Acceptance and matching readiness" items={readinessItems(readiness)} /><section className="card p-5"><h3 className="font-semibold text-neutral-900">Open work</h3><div className="mt-4 space-y-3">{!tasks.length ? <p className="text-sm text-neutral-600">No linked work yet.</p> : tasks.map(task => <div key={task.id} className="rounded-md bg-neutral-50 p-3"><p className="font-medium text-neutral-900">{task.title}</p><p className="mt-1 text-xs text-neutral-600"><CalendarClock className="mr-1 inline h-3.5 w-3.5" />{formatDate(task.due_at)}</p></div>)}</div></section></div>
  </div>;
}

function RequirementSkillsAndMatches({ requirement, requirementSkills, readiness, onSaved }) {
  const [skills, setSkills] = useState([]);
  const [matches, setMatches] = useState([]);
  const [selected, setSelected] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState('');
  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const [skillData, matchData] = await Promise.all([apiFetch('/api/wizmatch/staffing/skills'), apiFetch(`/api/wizmatch/staffing/requirements/${requirement.id}/matches`)]);
      setSkills(skillData.items || []); setMatches(matchData.items || []);
      setSelected(Object.fromEntries((requirementSkills || []).map(item => [item.skill_id, { importance: item.importance || 'mandatory', minimumYears: item.minimum_years ?? '', evidence: item.evidence || '', allowBroadFamily: item.allow_broad_family === true }])))
    } catch (requestError) { setError(requestError.message || 'Skills and matches could not be loaded.'); }
    finally { setLoading(false); }
  }, [requirement.id, requirementSkills]);
  useEffect(() => { load(); }, [load]);

  const toggleSkill = skill => setSelected(current => {
    if (current[skill.id]) return current; // Existing evidence is preserved; this UI never deletes skill rows.
    return { ...current, [skill.id]: { importance: 'mandatory', minimumYears: '', evidence: '', allowBroadFamily: false } };
  });
  const updateSkill = (id, key, value) => setSelected(current => ({ ...current, [id]: { ...current[id], [key]: value } }));
  const save = async () => {
    setSaving(true); setFeedback('');
    try {
      await apiFetch(`/api/wizmatch/staffing/requirements/${requirement.id}/skills`, { method: 'PUT', body: JSON.stringify({ skills: Object.entries(selected).map(([skillId, value]) => ({ skillId, importance: value.importance, minimumYears: value.minimumYears === '' ? null : Number(value.minimumYears), evidence: value.evidence || null, allowBroadFamily: value.allowBroadFamily })) }) });
      await apiFetch(`/api/wizmatch/staffing/requirements/${requirement.id}/matches/recalculate`, { method: 'POST' });
      setFeedback('Canonical skills saved and matches recalculated.'); onSaved(); await load();
    } catch (requestError) { setFeedback(requestError.message || 'Skills could not be saved.'); }
    finally { setSaving(false); }
  };

  return <DataState loading={loading} error={error} onRetry={load} empty={false}>
    <div className="space-y-4">
      <section className="card p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-semibold text-neutral-900">Canonical requirement skills</h3><p className="mt-1 text-sm text-neutral-600">SAP ABAP, SAP FICO, Java and JavaScript remain separate. Existing evidence cannot be removed from this preservation-first interface.</p></div><Button variant="primary" disabled={saving || !Object.keys(selected).length} onClick={save}>{saving ? 'Saving…' : 'Save & recalculate'}</Button></div>{feedback && <div role="status" className="mt-3 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-sm">{feedback}</div>}<div className="mt-4 grid gap-3 lg:grid-cols-2">{skills.map(skill => { const value = selected[skill.id]; return <div key={skill.id} className={`rounded-lg border p-4 ${value ? 'border-primary-300 bg-primary-50' : 'border-neutral-200'}`}><button type="button" onClick={() => toggleSkill(skill)} className="w-full text-left"><div className="flex items-center justify-between gap-3"><div><p className="font-semibold text-neutral-900">{skill.canonical_label}</p><p className="text-xs text-neutral-600">{skill.family} → {skill.specialization}</p></div>{value ? <CheckCircle2 className="h-5 w-5 text-success-700" /> : <span className="text-xs font-semibold text-primary-700">Add</span>}</div></button>{value && <div className="mt-3 grid gap-3 sm:grid-cols-2"><SelectField label="Importance" value={value.importance} onChange={next => updateSkill(skill.id, 'importance', next)} options={[["mandatory", "Mandatory"], ["preferred", "Preferred"]]} /><Input label="Minimum years" type="number" min="0" value={value.minimumYears} onChange={event => updateSkill(skill.id, 'minimumYears', event.target.value)} /><Input className="sm:col-span-2" label="Evidence from reviewed JD" value={value.evidence} onChange={event => updateSkill(skill.id, 'evidence', event.target.value)} placeholder="Exact phrase or reviewed requirement evidence" /><label className="sm:col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={value.allowBroadFamily} onChange={event => updateSkill(skill.id, 'allowBroadFamily', event.target.checked)} />Allow broad-family match and display it explicitly</label></div>}</div>; })}</div>{!skills.length && <p className="mt-4 rounded-md bg-neutral-50 p-4 text-sm text-neutral-600">No canonical taxonomy is available. Ask an admin to seed the reviewed pilot taxonomy.</p>}</section>
      <section className="card p-5"><div className="flex items-center justify-between gap-3"><div><h3 className="font-semibold text-neutral-900">Requirement-specific matches</h3><p className="mt-1 text-sm text-neutral-600">A score is evidence for review—not a shortlist, consent or submission.</p></div><StatusBadge status={readiness.matching?.ready ? 'verified' : 'blocked'} label={readiness.matching?.ready ? `${matches.length} matches` : 'Matching blocked'} /></div><div className="mt-4 space-y-3">{!matches.length ? <p className="rounded-md bg-neutral-50 p-4 text-sm text-neutral-600">No recalculated matches yet.</p> : matches.map(match => <Link key={match.id} to={`/wizmatch/candidates?candidateId=${match.candidate_id}`} className="block rounded-lg border border-neutral-200 p-4 hover:border-primary-300"><div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-neutral-900">{[match.first_name, match.last_name].filter(Boolean).join(' ') || 'Candidate'}</p><p className="mt-1 text-sm text-neutral-600">{match.location || 'Location missing'} · {humanize(match.availability_status)}</p></div><div className="text-right"><p className="text-2xl font-bold text-neutral-900">{match.score}</p><StatusBadge status={match.blockers?.length ? 'blocked' : match.human_decision || 'watch'} label={match.blockers?.length ? `${match.blockers.length} blockers` : humanize(match.human_decision || 'Unreviewed')} /></div></div>{match.missing_evidence?.length > 0 && <p className="mt-3 text-xs text-warning-700">Missing evidence: {match.missing_evidence.join(', ')}</p>}</Link>)}</div></section>
    </div>
  </DataState>;
}

function RequirementCandidates({ requirement, readiness, onSource }) {
  return <section className="card p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><h3 className="font-semibold text-neutral-900">Candidates for this role</h3><p className="mt-1 text-sm text-neutral-600">Source public leads only after the role and canonical skills are ready. Every result starts unverified.</p></div><Button variant="primary" disabled={!readiness.matching?.ready || !['accepted', 'sourcing', 'covered'].includes(requirement.stage)} onClick={onSource} icon={<Search />}>Source candidate leads</Button></div>{!readiness.matching?.ready && <div className="mt-4 rounded-md border border-warning-500/30 bg-amber-50 p-4 text-sm text-neutral-700">Complete: {(readiness.matching?.missing || []).join(', ')}.</div>}<Link to={`/wizmatch/candidates?requirementId=${requirement.id}`} className="mt-4 inline-flex font-semibold text-primary-700">Open verified pool and decisions</Link></section>;
}

function RequirementSubmissions({ requirementId }) {
  return <section className="card p-5"><h3 className="font-semibold text-neutral-900">Submission and delivery records</h3><p className="mt-1 text-sm text-neutral-600">Consent, approval, sent record, interviews and offers remain tied to this exact role.</p><Link to={`/wizmatch/submissions?requirementId=${requirementId}`} className="mt-4 inline-flex font-semibold text-primary-700">Open requirement delivery board</Link></section>;
}

function RequirementCommercial({ requirement, relatedCounts }) {
  return <section className="card p-5"><h3 className="font-semibold text-neutral-900">Commercial trace</h3><p className="mt-1 text-sm text-neutral-600">Placement, invoice and collection are separate facts.</p><div className="mt-4 grid gap-3 sm:grid-cols-3">{[['Placements', relatedCounts.placement_count || 0], ['Invoices', relatedCounts.invoice_count || 0], ['Collections', relatedCounts.collection_count || 0]].map(([label, value]) => <div key={label} className="rounded-md bg-neutral-50 p-4"><p className="text-xs font-semibold uppercase text-neutral-600">{label}</p><p className="mt-1 text-2xl font-bold text-neutral-900">{value}</p></div>)}</div><p className="mt-4 text-sm text-neutral-700">Original range: {formatMoney(requirement.budget_min, requirement.budget_currency, requirement.budget_period)} – {formatMoney(requirement.budget_max, requirement.budget_currency, requirement.budget_period)}</p><Link to={`/wizmatch/placements?requirementId=${requirement.id}`} className="mt-4 inline-flex font-semibold text-primary-700">Open traceable placements</Link></section>;
}

function RequirementDocuments({ requirement }) {
  const [feedback, setFeedback] = useState('');
  const openDocument = async kind => {
    setFeedback('');
    try { const data = await apiFetch(`/api/wizmatch/requirements/${requirement.id}/documents/${kind}/access`); window.open(data.url, '_blank', 'noopener,noreferrer'); }
    catch (requestError) { setFeedback(requestError.message || 'A private document link could not be created.'); }
  };
  return <section className="card p-5"><h3 className="font-semibold text-neutral-900">Private requirement documents</h3><p className="mt-1 text-sm text-neutral-600">Access uses an expiring signed link; the stored object is never a public URL.</p>{feedback && <div role="alert" className="mt-4 rounded-md border border-danger-500/30 bg-red-50 p-3 text-danger-600">{feedback}</div>}<div className="mt-4 flex flex-wrap gap-2"><Button disabled={!requirement.source_file_url} onClick={() => openDocument('source')}>Open source JD</Button><Button disabled={!requirement.sheet_url} onClick={() => openDocument('sheet')}>Open requirement sheet</Button></div></section>;
}

function RequirementPlanModal({ open, data, onClose, onSaved }) {
  const requirement = data.requirement;
  const [contacts, setContacts] = useState([]); const [users, setUsers] = useState([]);
  const [sourceId, setSourceId] = useState(''); const [ownerId, setOwnerId] = useState(''); const [recruiterId, setRecruiterId] = useState('');
  const [nextAction, setNextAction] = useState(''); const [dueAt, setDueAt] = useState(''); const [slaAt, setSlaAt] = useState('');
  const [loading, setLoading] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setLoading(true); setError(''); setNextAction(requirement.next_action || ''); setDueAt(requirement.next_action_due_at ? new Date(requirement.next_action_due_at).toISOString().slice(0, 16) : ''); setSlaAt(requirement.sla_due_at ? new Date(requirement.sla_due_at).toISOString().slice(0, 16) : '');
    Promise.all([apiFetch(`/api/wizmatch/companies/${requirement.company_id}/contacts`), apiFetch('/api/wizmatch/staffing/users')]).then(([contactData, userData]) => {
      setContacts(contactData.items || []); setUsers(userData.items || []);
      setSourceId(data.contacts.find(contact => contact.active && contact.is_primary_source)?.company_contact_id || contactData.items?.[0]?.id || '');
      setOwnerId(data.assignments.find(assignment => assignment.active && assignment.role === 'account_owner')?.user_id || '');
      setRecruiterId(data.assignments.find(assignment => assignment.active && assignment.role === 'recruiter')?.user_id || '');
    }).catch(requestError => setError(requestError.message || 'Intake choices could not be loaded.')).finally(() => setLoading(false));
  }, [open, requirement, data.contacts, data.assignments]);
  const save = async () => {
    setSaving(true); setError('');
    try {
      if (!data.contacts.some(contact => contact.active && contact.is_primary_source) && sourceId) await apiFetch(`/api/wizmatch/requirements/${requirement.id}/contacts`, { method: 'POST', body: JSON.stringify({ companyContactId: sourceId, role: 'source', isPrimarySource: true, receivedChannel: 'manual' }) });
      if (!data.assignments.some(assignment => assignment.active && assignment.role === 'account_owner') && ownerId) await apiFetch(`/api/wizmatch/requirements/${requirement.id}/assignments`, { method: 'POST', body: JSON.stringify({ userId: ownerId, role: 'account_owner' }) });
      if (!data.assignments.some(assignment => assignment.active && assignment.role === 'recruiter') && recruiterId) await apiFetch(`/api/wizmatch/requirements/${requirement.id}/assignments`, { method: 'POST', body: JSON.stringify({ userId: recruiterId, role: 'recruiter' }) });
      await apiFetch(`/api/wizmatch/requirements/${requirement.id}/next-action`, { method: 'POST', body: JSON.stringify({ nextAction, nextActionDueAt: new Date(dueAt).toISOString(), slaDueAt: new Date(slaAt).toISOString() }) });
      onSaved();
    } catch (requestError) { setError(requestError.message || 'Requirement intake could not be completed.'); }
    finally { setSaving(false); }
  };
  return <Modal open={open} onClose={onClose} title="Complete requirement intake" description="Acceptance is available only after every required fact is recorded." width={720} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={loading || saving || !sourceId || !ownerId || !recruiterId || !nextAction.trim() || !dueAt || !slaAt} onClick={save}>{saving ? 'Saving…' : 'Save intake'}</Button></>}>
    {error && <div role="alert" className="mb-4 rounded-md border border-danger-500/30 bg-red-50 p-3 text-danger-600">{error}</div>}
    <div className="grid gap-4 sm:grid-cols-2"><SelectField label="Primary source person" value={sourceId} onChange={setSourceId} options={[["", "Select genuine source POC"], ...contacts.filter(contact => contact.relationship_stage === 'active').map(contact => [contact.id, `${contactName(contact)} · ${contact.email || contact.phone || 'channel needed'}`])]} /><SelectField label="Account owner" value={ownerId} onChange={setOwnerId} options={[["", "Select owner"], ...users.map(user => [user.id, `${user.name} · ${humanize(user.role)}`])]} /><SelectField label="Recruiter" value={recruiterId} onChange={setRecruiterId} options={[["", "Select recruiter"], ...users.map(user => [user.id, `${user.name} · ${humanize(user.role)}`])]} /><Input label="Requirement SLA" type="datetime-local" value={slaAt} onChange={event => setSlaAt(event.target.value)} /><Input className="sm:col-span-2" label="Next action" value={nextAction} onChange={event => setNextAction(event.target.value)} placeholder="One concrete next action" /><Input className="sm:col-span-2" label="Next action due" type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} /></div>
  </Modal>;
}

function TransitionModal({ open, requirement, transitions, onClose, onSaved }) {
  const available = transitions.filter(transition => transition.allowed);
  const [target, setTarget] = useState(''); const [reason, setReason] = useState(''); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  useEffect(() => { if (open) { setTarget(available[0]?.stage || ''); setReason(''); setError(''); } }, [open, transitions]);
  const needsReason = ['closed_lost', 'cancelled'].includes(target);
  const save = async () => { setSaving(true); setError(''); try { await apiFetch(`/api/wizmatch/requirements/${requirement.id}/transition`, { method: 'POST', body: JSON.stringify({ stage: target, closureReason: needsReason ? reason : undefined }) }); onSaved(); } catch (requestError) { setError(requestError.message || 'The workflow stage could not be changed.'); } finally { setSaving(false); } };
  return <Modal open={open} onClose={onClose} title="Move to the next legal stage" description={`Current stage: ${humanize(requirement.stage)}. Only permitted transitions are shown.`} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving || !target || (needsReason && !reason.trim())} onClick={save}>{saving ? 'Updating…' : `Move to ${humanize(target, 'stage')}`}</Button></>}>
    {error && <div role="alert" className="mb-4 rounded-md border border-danger-500/30 bg-red-50 p-3 text-danger-600">{error}</div>}
    {!available.length ? <p className="rounded-md bg-neutral-50 p-4">No further transition is available from this stage.</p> : <><SelectField label="Next stage" value={target} onChange={setTarget} options={available.map(transition => [transition.stage, humanize(transition.stage)])} />{needsReason && <Input className="mt-4" label="Closure reason" required value={reason} onChange={event => setReason(event.target.value)} placeholder="Record the truthful reason" />}</>}
    {transitions.filter(transition => !transition.allowed).map(transition => <p key={transition.stage} className="mt-3 rounded-md border border-warning-500/30 bg-amber-50 p-3 text-sm">{humanize(transition.stage)} is blocked: {(transition.blockers || []).join(', ')}</p>)}
  </Modal>;
}

function XrayModal({ open, requirement, onClose, onSaved }) {
  const [maxResults, setMaxResults] = useState(3); const [saving, setSaving] = useState(false); const [error, setError] = useState(''); const [result, setResult] = useState(null);
  useEffect(() => { if (open) { setMaxResults(3); setError(''); setResult(null); } }, [open]);
  const run = async () => { setSaving(true); setError(''); try { const data = await apiFetch(`/api/wizmatch/requirements/${requirement.id}/source-candidates-xray`, { method: 'POST', body: JSON.stringify({ maxResults: Number(maxResults) }) }); setResult(data); } catch (requestError) { setError(requestError.message || 'Candidate sourcing could not run.'); } finally { setSaving(false); } };
  return <Modal open={open} onClose={onClose} title="Source requirement-specific candidate leads" description="This creates unverified public leads only. It never shortlists, contacts, consents or submits anyone." footer={<><Button onClick={onClose}>{result ? 'Close' : 'Cancel'}</Button>{result ? <Button variant="primary" onClick={onSaved}>Review candidates</Button> : <Button variant="primary" disabled={saving || maxResults < 1 || maxResults > 10} onClick={run}>{saving ? 'Sourcing…' : `Source up to ${maxResults}`}</Button>}</>}>
    {error && <div role="alert" className="mb-4 rounded-md border border-danger-500/30 bg-red-50 p-3 text-danger-600">{error}</div>}
    {result ? <div role="status" className="rounded-md border border-success-500/30 bg-green-50 p-4"><p className="font-semibold text-neutral-900">Candidate leads are ready for evidence review.</p><p className="mt-1 text-sm text-neutral-700">Created {result.created ?? result.inserted ?? 0}; duplicates {result.duplicates ?? 0}. No candidate was shortlisted or submitted.</p></div> : <><Input label="Maximum public results" type="number" min="1" max="10" value={maxResults} onChange={event => setMaxResults(Math.max(1, Math.min(10, Number(event.target.value) || 1)))} help="Default 3; authorized range 1–10. Public profile URLs are deduplicated." /><p className="mt-4 text-sm text-neutral-600">Role: {requirement.title} · source once per seven-day requirement window.</p></>}
  </Modal>;
}

function RequirementIntakeModal({ open, onClose, onCreated }) {
  const [step, setStep] = useState(1); const [companies, setCompanies] = useState([]); const [contacts, setContacts] = useState([]); const [users, setUsers] = useState([]); const [skills, setSkills] = useState([]);
  const [mode, setMode] = useState('paste'); const [file, setFile] = useState(null); const [parsing, setParsing] = useState(false); const [saving, setSaving] = useState(false); const [error, setError] = useState('');
  const [form, setForm] = useState({ companyId: '', sourceId: '', title: '', rawJd: '', sourceFileUrl: null, region: 'india', location: '', workMode: 'onsite', employmentType: 'permanent', minExperience: '', maxExperience: '', budgetMin: '', budgetMax: '', budgetCurrency: 'INR', budgetPeriod: 'annual', positions: 1, priority: 'normal', ownerId: '', recruiterId: '', slaAt: '', nextAction: '', nextActionDueAt: '', selectedSkills: {} });
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));
  useEffect(() => {
    if (!open) return;
    setStep(1); setError(''); setFile(null);
    Promise.all([apiFetch('/api/wizmatch/staffing/companies'), apiFetch('/api/wizmatch/staffing/users'), apiFetch('/api/wizmatch/staffing/skills')]).then(([companyData, userData, skillData]) => {
      setCompanies(companyData.items || []); setUsers(userData.items || []); setSkills(skillData.items || []);
    }).catch(requestError => setError(requestError.message || 'Requirement intake choices could not be loaded.'));
  }, [open]);
  useEffect(() => {
    if (!open || !form.companyId) { setContacts([]); return; }
    apiFetch(`/api/wizmatch/companies/${form.companyId}/contacts`).then(data => setContacts(data.items || [])).catch(requestError => setError(requestError.message || 'Company contacts could not be loaded.'));
  }, [open, form.companyId]);
  const selectedSkillRows = useMemo(() => skills.filter(skill => form.selectedSkills[skill.id]), [skills, form.selectedSkills]);
  const stepValid = step === 1 ? Boolean(form.companyId && form.sourceId) : step === 2 ? Boolean(form.title.trim() && (form.rawJd.trim() || form.sourceFileUrl)) : step === 3 ? Boolean(form.ownerId && form.recruiterId && form.slaAt && form.nextAction.trim() && form.nextActionDueAt) : step === 4 ? selectedSkillRows.some(skill => form.selectedSkills[skill.id].importance === 'mandatory') : true;
  const parse = async () => {
    if (mode === 'paste' && !form.rawJd.trim()) { setError('Paste the JD before parsing.'); return; }
    if (mode === 'upload' && !file) { setError('Choose a JD file before parsing.'); return; }
    setParsing(true); setError('');
    try { const body = new FormData(); if (mode === 'paste') body.append('text', form.rawJd); else body.append('file', file); const data = await apiFetch('/api/wizmatch/requirements/parse', { method: 'POST', body }); const parsed = data.parsed || {}; setForm(current => ({ ...current, title: parsed.title || current.title, rawJd: mode === 'paste' ? current.rawJd : parsed.raw_jd || current.rawJd, sourceFileUrl: data.source_file_url || current.sourceFileUrl, region: parsed.region || current.region, location: parsed.location || current.location, workMode: parsed.work_mode || current.workMode, employmentType: parsed.employment_type || current.employmentType, minExperience: parsed.min_experience ?? current.minExperience, maxExperience: parsed.max_experience ?? current.maxExperience, budgetMin: parsed.budget_min ?? current.budgetMin, budgetMax: parsed.budget_max ?? current.budgetMax, budgetCurrency: parsed.budget_currency || current.budgetCurrency, budgetPeriod: parsed.budget_period || current.budgetPeriod })); }
    catch (requestError) { setError(requestError.message || 'The JD could not be parsed. Review fields manually or retry.'); }
    finally { setParsing(false); }
  };
  const create = async () => {
    setSaving(true); setError(''); let created;
    try {
      const requiredSkills = selectedSkillRows.filter(skill => form.selectedSkills[skill.id].importance === 'mandatory').map(skill => skill.canonical_label);
      const preferredSkills = selectedSkillRows.filter(skill => form.selectedSkills[skill.id].importance === 'preferred').map(skill => skill.canonical_label);
      created = await apiFetch('/api/wizmatch/requirements', { method: 'POST', body: JSON.stringify({ company_id: form.companyId, title: form.title, raw_jd: form.rawJd, source_file_url: form.sourceFileUrl, required_skills: requiredSkills, nice_to_have_skills: preferredSkills, region: form.region, location: form.location || null, work_mode: form.workMode, employment_type: form.employmentType, min_experience: form.minExperience === '' ? null : Number(form.minExperience), max_experience: form.maxExperience === '' ? null : Number(form.maxExperience), budget_min: form.budgetMin === '' ? null : Number(form.budgetMin), budget_max: form.budgetMax === '' ? null : Number(form.budgetMax), budget_currency: form.budgetCurrency, budget_period: form.budgetPeriod, positions: Number(form.positions) || 1, priority: form.priority }) });
      await apiFetch(`/api/wizmatch/requirements/${created.id}/contacts`, { method: 'POST', body: JSON.stringify({ companyContactId: form.sourceId, role: 'source', isPrimarySource: true, receivedChannel: 'manual' }) });
      await apiFetch(`/api/wizmatch/requirements/${created.id}/assignments`, { method: 'POST', body: JSON.stringify({ userId: form.ownerId, role: 'account_owner' }) });
      await apiFetch(`/api/wizmatch/requirements/${created.id}/assignments`, { method: 'POST', body: JSON.stringify({ userId: form.recruiterId, role: 'recruiter' }) });
      await apiFetch(`/api/wizmatch/requirements/${created.id}/next-action`, { method: 'POST', body: JSON.stringify({ nextAction: form.nextAction, nextActionDueAt: new Date(form.nextActionDueAt).toISOString(), slaDueAt: new Date(form.slaAt).toISOString() }) });
      await apiFetch(`/api/wizmatch/staffing/requirements/${created.id}/skills`, { method: 'PUT', body: JSON.stringify({ skills: selectedSkillRows.map(skill => ({ skillId: skill.id, importance: form.selectedSkills[skill.id].importance, minimumYears: form.selectedSkills[skill.id].minimumYears === '' ? null : Number(form.selectedSkills[skill.id].minimumYears), evidence: form.selectedSkills[skill.id].evidence || null, allowBroadFamily: form.selectedSkills[skill.id].allowBroadFamily === true })) }) });
      onCreated(created);
    } catch (requestError) { setError(created ? `Draft ${created.title} was created, but setup is incomplete: ${requestError.message}. Open the draft to finish intake without creating another.` : requestError.message || 'The draft role could not be created.'); }
    finally { setSaving(false); }
  };
  const source = contacts.find(contact => contact.id === form.sourceId);
  return <Modal open={open} onClose={onClose} title="New role — guided intake" description={`Step ${step} of 5 · ${['Company and source POC', 'JD and reviewed fields', 'Ownership, SLA and next action', 'Canonical skills and blockers', 'Review and save draft'][step - 1]}`} width={900} footer={<><Button onClick={step === 1 ? onClose : () => setStep(current => current - 1)}>{step === 1 ? 'Cancel' : 'Back'}</Button>{step < 5 ? <Button variant="primary" disabled={!stepValid} onClick={() => setStep(current => current + 1)}>Continue</Button> : <Button variant="primary" disabled={saving} onClick={create}>{saving ? 'Creating draft…' : 'Create attributed draft'}</Button>}</>}>
    <StageStepper stages={[1, 2, 3, 4, 5].map(id => ({ id, label: ['Company & POC', 'JD', 'Ownership', 'Skills', 'Review'][id - 1] }))} current={step} />
    {error && <div role="alert" className="mt-4 rounded-md border border-danger-500/30 bg-red-50 p-3 text-danger-600">{error}</div>}
    <div className="mt-5">
      {step === 1 && <div className="grid gap-4 sm:grid-cols-2"><SelectField label="Company" value={form.companyId} onChange={value => { set('companyId', value); set('sourceId', ''); }} options={[["", "Select the company"], ...companies.map(company => [company.id, company.name])]} /><SelectField label="Genuine source POC" value={form.sourceId} onChange={value => set('sourceId', value)} options={[["", "Select named hiring contact"], ...contacts.filter(contact => contact.relationship_stage === 'active').map(contact => [contact.id, `${contactName(contact)} · ${contact.email || contact.phone || 'channel needed'}`])]} /><p className="sm:col-span-2 rounded-md bg-neutral-50 p-4 text-sm">The selected person—not merely the company—will be stored as the primary source for this role. Add missing people from Company 360 first.</p></div>}
      {step === 2 && <div className="space-y-4"><div className="flex gap-2"><Button variant={mode === 'paste' ? 'primary' : 'standard'} size="compact" onClick={() => setMode('paste')}>Paste JD</Button><Button variant={mode === 'upload' ? 'primary' : 'standard'} size="compact" onClick={() => setMode('upload')}>Upload JD</Button></div>{mode === 'paste' ? <div><label className="mb-1 block text-sm font-semibold text-neutral-700" htmlFor="intake-jd">Job description</label><textarea id="intake-jd" rows="7" className="w-full rounded-md border border-neutral-300 p-3" value={form.rawJd} onChange={event => set('rawJd', event.target.value)} /></div> : <label className="flex cursor-pointer items-center gap-3 rounded-md border border-dashed border-neutral-300 p-5"><Upload className="h-5 w-5" />{file?.name || 'Choose PDF or image'}<input className="sr-only" type="file" accept=".pdf,image/png,image/jpeg,image/webp" onChange={event => setFile(event.target.files?.[0] || null)} /></label>}<Button onClick={parse} disabled={parsing} icon={<Sparkles />}>{parsing ? 'Parsing…' : 'Parse to draft fields'}</Button><div className="grid gap-4 sm:grid-cols-2"><Input className="sm:col-span-2" label="Role title" required value={form.title} onChange={event => set('title', event.target.value)} /><Input label="Location" value={form.location} onChange={event => set('location', event.target.value)} /><SelectField label="Work mode" value={form.workMode} onChange={value => set('workMode', value)} options={[["onsite", "Onsite"], ["hybrid", "Hybrid"], ["remote", "Remote"]]} /><SelectField label="Employment" value={form.employmentType} onChange={value => set('employmentType', value)} options={[["permanent", "Permanent"], ["contract", "Contract"], ["contract_c2c", "Contract — C2C"], ["contract_w2", "Contract — W2"]]} /><SelectField label="Region" value={form.region} onChange={value => set('region', value)} options={[["india", "India"], ["us", "US"]]} /></div></div>}
      {step === 3 && <div className="grid gap-4 sm:grid-cols-2"><SelectField label="Account owner" value={form.ownerId} onChange={value => set('ownerId', value)} options={[["", "Select owner"], ...users.map(user => [user.id, `${user.name} · ${humanize(user.role)}`])]} /><SelectField label="Recruiter" value={form.recruiterId} onChange={value => set('recruiterId', value)} options={[["", "Select recruiter"], ...users.map(user => [user.id, `${user.name} · ${humanize(user.role)}`])]} /><Input label="SLA due" type="datetime-local" value={form.slaAt} onChange={event => set('slaAt', event.target.value)} /><Input label="Next action due" type="datetime-local" value={form.nextActionDueAt} onChange={event => set('nextActionDueAt', event.target.value)} /><Input className="sm:col-span-2" label="Next action" value={form.nextAction} onChange={event => set('nextAction', event.target.value)} placeholder="For example: Confirm interview slots with the hiring POC" /></div>}
      {step === 4 && <div><p className="mb-4 text-sm text-neutral-700">Select reviewed canonical skills. At least one mandatory skill is required. Broad-family matching is off by default and always visible when enabled.</p><div className="grid gap-3 lg:grid-cols-2">{skills.map(skill => { const value = form.selectedSkills[skill.id]; return <div key={skill.id} className={`rounded-lg border p-4 ${value ? 'border-primary-300 bg-primary-50' : 'border-neutral-200'}`}><label className="flex items-start gap-3"><input className="mt-1" type="checkbox" checked={Boolean(value)} onChange={event => set('selectedSkills', event.target.checked ? { ...form.selectedSkills, [skill.id]: { importance: 'mandatory', minimumYears: '', evidence: '', allowBroadFamily: false } } : Object.fromEntries(Object.entries(form.selectedSkills).filter(([id]) => id !== skill.id)))} /><span><span className="block font-semibold text-neutral-900">{skill.canonical_label}</span><span className="text-xs text-neutral-600">{skill.family} → {skill.specialization}</span></span></label>{value && <div className="mt-3 grid gap-3 sm:grid-cols-2"><SelectField label="Importance" value={value.importance} onChange={next => set('selectedSkills', { ...form.selectedSkills, [skill.id]: { ...value, importance: next } })} options={[["mandatory", "Mandatory"], ["preferred", "Preferred"]]} /><Input label="Minimum years" type="number" min="0" value={value.minimumYears} onChange={event => set('selectedSkills', { ...form.selectedSkills, [skill.id]: { ...value, minimumYears: event.target.value } })} /><Input className="sm:col-span-2" label="JD evidence" value={value.evidence} onChange={event => set('selectedSkills', { ...form.selectedSkills, [skill.id]: { ...value, evidence: event.target.value } })} /></div>}</div>; })}</div></div>}
      {step === 5 && <div className="space-y-4"><EntityHeader title={form.title} subtitle={`${companies.find(company => company.id === form.companyId)?.name || 'Company'} → ${contactName(source)} → ${form.title}`} status="draft" metadata={[["Account owner", users.find(user => user.id === form.ownerId)?.name], ["Recruiter", users.find(user => user.id === form.recruiterId)?.name], ["SLA", formatDate(form.slaAt)], ["Next action", form.nextAction]].map(([label, value]) => ({ label, value }))} /><ReadinessChecklist title="Draft will be created with" items={[{ label: 'Company and named source POC', complete: Boolean(form.companyId && form.sourceId) }, { label: 'Reviewed JD and role fields', complete: Boolean(form.title && (form.rawJd || form.sourceFileUrl)) }, { label: 'Owner, recruiter, SLA and dated next action', complete: Boolean(form.ownerId && form.recruiterId && form.slaAt && form.nextAction && form.nextActionDueAt) }, { label: `${selectedSkillRows.length} canonical skills`, complete: selectedSkillRows.some(skill => form.selectedSkills[skill.id].importance === 'mandatory') }]} /><p className="rounded-md bg-neutral-50 p-4 text-sm">Saving creates a draft only. Acceptance is a separate legal transition after readiness is confirmed.</p></div>}
    </div>
  </Modal>;
}
