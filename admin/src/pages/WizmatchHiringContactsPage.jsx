import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Building2, CalendarClock, CheckCircle2, Mail, Phone, RefreshCw, UserRound } from 'lucide-react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';
import { Button, DataTable, Input, Modal } from '../components/ui/index.js';
import {
  ActivityTimeline,
  DataState,
  EntityHeader,
  NextActionPanel,
  StatusBadge,
  WorkspacePage,
  WorkspaceTabs,
  humanize,
} from '../components/wizmatch/WorkspaceUI.jsx';

const CONTACT_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'roles', label: 'Roles supplied' },
  { id: 'coordination', label: 'Coordination' },
  { id: 'work', label: 'Open work' },
];

function fullName(contact) {
  return [contact?.first_name, contact?.last_name].filter(Boolean).join(' ') || 'Unnamed hiring contact';
}

function formatDate(value, fallback = 'Not scheduled') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

export default function WizmatchHiringContactsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('contactId') || '';
  const [search, setSearch] = useState('');
  const [contacts, setContacts] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [tab, setTab] = useState(searchParams.get('tab') || 'overview');
  const [showPlan, setShowPlan] = useState(false);

  const loadContacts = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const data = await apiFetch(`/api/wizmatch/staffing/hiring-contacts?search=${encodeURIComponent(search.trim())}`);
      setContacts(data.items || []);
    } catch (requestError) {
      setContacts([]);
      setError(requestError.message || 'Hiring contacts could not be loaded.');
    } finally { setLoading(false); }
  }, [search]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) { setDetail(null); setDetailError(''); return; }
    setDetailLoading(true); setDetailError('');
    try {
      setDetail(await apiFetch(`/api/wizmatch/staffing/company-contacts/${selectedId}`));
    } catch (requestError) {
      setDetail(null);
      setDetailError(requestError.message || 'This hiring contact could not be loaded.');
    } finally { setDetailLoading(false); }
  }, [selectedId]);

  useEffect(() => {
    const timer = window.setTimeout(loadContacts, 250);
    return () => window.clearTimeout(timer);
  }, [loadContacts]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const openContact = contact => setSearchParams({ contactId: contact.id });
  const closeContact = () => setSearchParams({});
  const changeTab = nextTab => { setTab(nextTab); setSearchParams({ contactId: selectedId, tab: nextTab }); };

  if (selectedId) {
    return (
      <WorkspacePage
        eyebrow="Hiring Contacts"
        title="Hiring Contact 360"
        description="The person-level truth for roles supplied, contact channels, coordination and next action."
        actions={<Button onClick={closeContact} icon={<ArrowLeft />}>All hiring contacts</Button>}
      >
        <DataState loading={detailLoading} error={detailError} onRetry={loadDetail} empty={!detail} emptyTitle="Hiring contact not found">
          {detail && <Contact360 data={detail} tab={tab} onTabChange={changeTab} onUpdatePlan={() => setShowPlan(true)} />}
        </DataState>
        <UpdateContactPlanModal
          open={showPlan}
          data={detail}
          onClose={() => setShowPlan(false)}
          onSaved={() => { setShowPlan(false); loadDetail(); loadContacts(); }}
        />
      </WorkspacePage>
    );
  }

  return (
    <WorkspacePage
      eyebrow="People"
      title="Hiring Contacts"
      description="Named Talent Acquisition, hiring, delivery and vendor POCs—with their real channels, role history and next action."
      actions={<Button onClick={loadContacts} icon={<RefreshCw />}>Refresh</Button>}
    >
      <div className="card p-4"><Input label="Search hiring contacts" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, company, title or email" /></div>
      <DataState
        loading={loading}
        error={error}
        onRetry={loadContacts}
        empty={!contacts.length}
        emptyTitle={search ? 'No hiring contacts match this search' : 'No hiring contacts yet'}
        emptyDescription={search ? 'Try another person, company or channel.' : 'Link a genuine CRM person from Company 360 to start person-level attribution.'}
      >
        <div className="hidden md:block">
          <DataTable
            tableLabel="Hiring contacts"
            rows={contacts}
            onRowClick={openContact}
            columns={[
              { key: 'first_name', label: 'Person', render: contact => <div><p className="font-semibold text-neutral-900">{fullName(contact)}</p><p className="text-xs text-neutral-600">{contact.title || humanize(contact.roles?.[0], 'Role not recorded')}</p></div> },
              { key: 'company_name', label: 'Company', render: contact => contact.company_name || 'Company not recorded' },
              { key: 'roles', label: 'POC category', render: contact => <div className="flex flex-wrap gap-1">{(contact.roles || []).slice(0, 2).map(role => <StatusBadge key={role} status="new" label={humanize(role)} />)}{(contact.roles || []).length > 2 && <span className="text-xs text-neutral-600">+{contact.roles.length - 2}</span>}</div> },
              { key: 'email', label: 'Recorded channel', render: contact => contact.email || contact.phone || <span className="font-medium text-warning-700">Channel needed</span> },
              { key: 'requirement_count', label: 'Attributed roles', render: contact => <div><p className="font-semibold text-neutral-900">{contact.requirement_count || 0}</p><p className="text-xs text-neutral-600">{contact.open_requirement_count || 0} open</p></div> },
              { key: 'next_action', label: 'Next action', render: contact => <div><p>{contact.next_action || 'Not set'}</p><p className="text-xs text-neutral-600">{formatDate(contact.next_action_due_at, '')}</p></div> },
            ]}
          />
        </div>
        <div className="grid gap-3 md:hidden">
          {contacts.map(contact => (
            <button key={contact.id} type="button" onClick={() => openContact(contact)} className="card p-4 text-left focus:outline-none focus:ring-2 focus:ring-primary-400">
              <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-neutral-900">{fullName(contact)}</p><p className="mt-1 text-sm text-neutral-600">{contact.company_name}</p></div><UserRound className="h-5 w-5 text-primary-600" /></div>
              <p className="mt-3 text-sm text-neutral-700">{contact.email || contact.phone || 'Contact channel needed'}</p>
              <div className="mt-3 flex justify-between text-xs text-neutral-600"><span>{contact.requirement_count || 0} roles · {contact.open_requirement_count || 0} open</span><span>{contact.next_action || 'Next action not set'}</span></div>
            </button>
          ))}
        </div>
      </DataState>
    </WorkspacePage>
  );
}

function Contact360({ data, tab, onTabChange, onUpdatePlan }) {
  const { contact, requirements = [], events = [], tasks = [] } = data;
  const primaryRequirements = requirements.filter(requirement => requirement.is_primary_source && requirement.active !== false);
  const nextTask = tasks.find(task => task.due_at && new Date(task.due_at) < new Date()) || tasks[0];
  const hasChannel = Boolean(contact.email || contact.phone);
  const hasCoordination = events.some(event => /contact|coordination|outreach|message|call|email/i.test(event.event_type || ''));
  const tabs = CONTACT_TABS.map(item => ({
    ...item,
    count: item.id === 'roles' ? requirements.length : item.id === 'coordination' ? events.length : item.id === 'work' ? tasks.length : undefined,
  }));

  return (
    <div className="space-y-4">
      <EntityHeader
        trail={[
          { label: 'Hiring Contacts', to: '/wizmatch/hiring-contacts' },
          { label: contact.company_name, to: `/wizmatch/companies?companyId=${contact.company_id}` },
          { label: fullName(contact) },
        ]}
        title={fullName(contact)}
        subtitle={`${contact.company_name} · ${(contact.roles || []).map(role => humanize(role)).join(', ') || 'POC category not recorded'}`}
        status={contact.relationship_stage || 'active'}
        metadata={[
          { label: 'Primary-source roles', value: String(primaryRequirements.length) },
          { label: 'Contact channel', value: hasChannel ? 'Recorded' : 'Missing' },
          { label: 'Coordination', value: hasCoordination ? 'Recorded' : 'Not recorded' },
          { label: 'Next action', value: contact.next_action || 'Not set' },
        ]}
        action={<Button variant="primary" onClick={onUpdatePlan}>Update next action</Button>}
      />
      <NextActionPanel
        blocked={!hasChannel || !contact.next_action}
        title={!hasChannel ? 'Verify a genuine contact channel' : !contact.next_action ? 'Set the next coordination action' : nextTask?.title || contact.next_action}
        description={!hasChannel ? 'A named profile alone is not enough for accepted requirement attribution. Record an email or phone only when it is genuinely available.' : !contact.next_action ? 'Assign a concrete action and date so this relationship does not disappear into a spreadsheet or chat.' : nextTask?.description || 'Keep the relationship moving and record the outcome in the activity history.'}
        dueAt={nextTask?.due_at || contact.next_action_due_at}
        action={<Button size="compact" variant="primary" onClick={onUpdatePlan}>Update plan</Button>}
      />
      <WorkspaceTabs tabs={tabs} active={tab} onChange={onTabChange} label="Hiring Contact 360 sections" />
      {tab === 'overview' && <ContactOverview contact={contact} hasCoordination={hasCoordination} />}
      {tab === 'roles' && <ContactRequirements requirements={requirements} contact={contact} />}
      {tab === 'coordination' && <section className="card p-5"><h3 className="font-semibold text-neutral-900">Coordination history</h3><p className="mb-4 mt-1 text-sm text-neutral-600">What happened with this person—not activity from another contact at the same company.</p><ActivityTimeline items={events} emptyText="No coordination or staffing event has been recorded for this person yet." /></section>}
      {tab === 'work' && <ContactWork tasks={tasks} />}
    </div>
  );
}

function ContactOverview({ contact, hasCoordination }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="card p-5"><h3 className="font-semibold text-neutral-900">Contact channels</h3><div className="mt-4 space-y-3"><div className="rounded-md bg-neutral-50 p-3"><p className="text-xs font-semibold uppercase text-neutral-600">Email</p><p className="mt-1 font-medium text-neutral-900"><Mail className="mr-2 inline h-4 w-4" />{contact.email || 'Not recorded'}</p></div><div className="rounded-md bg-neutral-50 p-3"><p className="text-xs font-semibold uppercase text-neutral-600">Phone</p><p className="mt-1 font-medium text-neutral-900"><Phone className="mr-2 inline h-4 w-4" />{contact.phone || 'Not recorded'}</p></div></div><p className="mt-3 text-xs text-neutral-600">Only genuinely published or manually verified channels should be stored.</p></section>
      <section className="card p-5"><h3 className="font-semibold text-neutral-900">Relationship ownership</h3><dl className="mt-4 space-y-3"><div><dt className="text-xs font-semibold uppercase text-neutral-600">Source</dt><dd className="mt-1 text-neutral-900">{humanize(contact.source_type, 'Not recorded')}{contact.source_confidence !== null && contact.source_confidence !== undefined ? ` · ${contact.source_confidence}% confidence` : ''}</dd></div><div><dt className="text-xs font-semibold uppercase text-neutral-600">Owner</dt><dd className="mt-1 text-neutral-900">{contact.owner_name || 'Not assigned'}</dd></div><div><dt className="text-xs font-semibold uppercase text-neutral-600">Contacted?</dt><dd className="mt-1 flex items-center gap-2 text-neutral-900"><CheckCircle2 className={`h-4 w-4 ${hasCoordination ? 'text-success-700' : 'text-neutral-400'}`} />{hasCoordination ? 'Coordination recorded' : 'No coordination recorded'}</dd></div><div><dt className="text-xs font-semibold uppercase text-neutral-600">Last relationship activity</dt><dd className="mt-1 text-neutral-900">{formatDate(contact.last_activity_at, 'Not recorded')}</dd></div></dl></section>
    </div>
  );
}

function ContactRequirements({ requirements, contact }) {
  return <section className="card p-5"><h3 className="font-semibold text-neutral-900">Roles supplied by {fullName(contact)}</h3><p className="mt-1 text-sm text-neutral-600">This history belongs only to this hiring contact.</p><div className="mt-4 space-y-3">{!requirements.length ? <p className="rounded-md bg-neutral-50 p-5 text-sm text-neutral-600">No requirements attributed to this person.</p> : requirements.map(requirement => <Link key={`${requirement.id}-${requirement.contact_role}`} to={`/wizmatch/roles?requirementId=${requirement.id}`} className="block rounded-lg border border-neutral-200 p-4 hover:border-primary-300"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold text-neutral-900">{requirement.title}</p><p className="mt-1 text-sm text-neutral-600">{humanize(requirement.contact_role)} · {requirement.is_primary_source ? 'Primary source' : 'Supporting contact'}</p></div><StatusBadge status={requirement.stage || 'draft'} /></div><p className="mt-3 text-xs text-neutral-600">Next: {requirement.next_action || 'not set'}</p></Link>)}</div></section>;
}

function ContactWork({ tasks }) {
  return <section className="card p-5"><h3 className="font-semibold text-neutral-900">Open work for this person</h3><div className="mt-4 space-y-3">{!tasks.length ? <p className="rounded-md bg-neutral-50 p-5 text-sm text-neutral-600">No open tasks linked to this hiring contact.</p> : tasks.map(task => <div key={task.id} className="rounded-lg border border-neutral-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-neutral-900">{task.title}</p><StatusBadge status={task.due_at && new Date(task.due_at) < new Date() ? 'overdue' : 'new'} label={task.due_at && new Date(task.due_at) < new Date() ? 'Overdue' : 'Open'} /></div><p className="mt-1 text-sm text-neutral-600">{task.description || 'No supporting note'}</p><p className="mt-2 text-xs text-neutral-600"><CalendarClock className="mr-1 inline h-3.5 w-3.5" />{formatDate(task.due_at)}</p>{task.requirement_id && <Link className="mt-3 inline-block text-sm font-semibold text-primary-700" to={`/wizmatch/roles?requirementId=${task.requirement_id}`}>Open related role</Link>}</div>)}</div></section>;
}

function UpdateContactPlanModal({ open, data, onClose, onSaved }) {
  const contact = data?.contact;
  const [nextAction, setNextAction] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || !contact) return;
    setNextAction(contact.next_action || '');
    setDueAt(contact.next_action_due_at ? new Date(contact.next_action_due_at).toISOString().slice(0, 16) : '');
    setError('');
  }, [open, contact]);

  const save = async () => {
    setSaving(true); setError('');
    try {
      await apiFetch(`/api/wizmatch/companies/${contact.company_id}/contacts/${contact.id}`, {
        method: 'PUT',
        body: JSON.stringify({
          relationshipStage: contact.relationship_stage,
          businessUnit: contact.business_unit || null,
          seniority: contact.seniority || null,
          ownerUserId: contact.owner_user_id || null,
          nextAction,
          nextActionDueAt: dueAt || null,
          roles: contact.roles || [],
        }),
      });
      onSaved();
    } catch (requestError) {
      setError(requestError.message || 'The next action could not be updated.');
    } finally { setSaving(false); }
  };

  return (
    <Modal open={open} onClose={onClose} title="Update relationship plan" description="Set one clear action and a real date for this hiring contact." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving || !nextAction.trim() || !dueAt} onClick={save}>{saving ? 'Saving…' : 'Save next action'}</Button></>}>
      {error && <div role="alert" className="mb-4 rounded-md border border-danger-500/30 bg-red-50 p-3 text-danger-600">{error}</div>}
      <Input label="Next action" required value={nextAction} onChange={event => setNextAction(event.target.value)} placeholder="For example: Confirm Java interview panel" />
      <Input className="mt-4" label="Due date and time" required type="datetime-local" value={dueAt} onChange={event => setDueAt(event.target.value)} />
    </Modal>
  );
}
