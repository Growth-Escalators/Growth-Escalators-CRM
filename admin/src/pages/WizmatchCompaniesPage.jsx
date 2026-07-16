import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, BriefcaseBusiness, Building2, CalendarClock, ExternalLink, Mail, Phone, Plus, RefreshCw, UserRound } from 'lucide-react';
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

const ROLE_OPTIONS = ['talent_acquisition', 'hiring_manager', 'coordinator', 'approver', 'interviewer', 'procurement', 'vendor_manager', 'source'];
const COMPANY_TABS = [
  { id: 'contacts', label: 'Hiring contacts' },
  { id: 'roles', label: 'Roles / Requirements' },
  { id: 'work', label: 'Open work' },
  { id: 'activity', label: 'Activity' },
  { id: 'account', label: 'Account' },
];

function contactName(contact) {
  return [contact.first_name, contact.last_name].filter(Boolean).join(' ') || 'Unnamed contact';
}

function formatDate(value, fallback = 'Not scheduled') {
  if (!value) return fallback;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date.toLocaleString();
}

export default function WizmatchCompaniesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedId = searchParams.get('companyId') || '';
  const [search, setSearch] = useState('');
  const [companies, setCompanies] = useState([]);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [tab, setTab] = useState(searchParams.get('tab') || 'contacts');
  const [showLinkContact, setShowLinkContact] = useState(false);

  const loadCompanies = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await apiFetch(`/api/wizmatch/staffing/companies?search=${encodeURIComponent(search.trim())}`);
      setCompanies(data.items || []);
    } catch (requestError) {
      setCompanies([]);
      setError(requestError.message || 'Companies could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [search]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) {
      setDetail(null);
      setDetailError('');
      return;
    }
    setDetailLoading(true);
    setDetailError('');
    try {
      setDetail(await apiFetch(`/api/wizmatch/staffing/companies/${selectedId}`));
    } catch (requestError) {
      setDetail(null);
      setDetailError(requestError.message || 'This company could not be loaded.');
    } finally {
      setDetailLoading(false);
    }
  }, [selectedId]);

  useEffect(() => {
    const timer = window.setTimeout(loadCompanies, 250);
    return () => window.clearTimeout(timer);
  }, [loadCompanies]);
  useEffect(() => { loadDetail(); }, [loadDetail]);

  const openCompany = company => setSearchParams({ companyId: company.id });
  const closeCompany = () => setSearchParams({});
  const changeTab = nextTab => {
    setTab(nextTab);
    setSearchParams({ companyId: selectedId, tab: nextTab });
  };

  if (selectedId) {
    return (
      <WorkspacePage
        eyebrow="Companies"
        title="Company 360"
        description="One account view for its hiring people, active roles, work and coordination history."
        actions={<Button onClick={closeCompany} icon={<ArrowLeft />}>All companies</Button>}
      >
        <DataState loading={detailLoading} error={detailError} onRetry={loadDetail} empty={!detail} emptyTitle="Company not found">
          {detail && (
            <Company360
              data={detail}
              tab={tab}
              onTabChange={changeTab}
              onLinkContact={() => setShowLinkContact(true)}
            />
          )}
        </DataState>
        <LinkContactModal
          companyId={selectedId}
          open={showLinkContact}
          onClose={() => setShowLinkContact(false)}
          onSaved={() => { setShowLinkContact(false); loadDetail(); loadCompanies(); }}
        />
      </WorkspacePage>
    );
  }

  return (
    <WorkspacePage
      eyebrow="Accounts"
      title="Companies"
      description="Start with the account, then see its real hiring contacts, job leads, roles and open work in one place."
      actions={<Button onClick={loadCompanies} icon={<RefreshCw />}>Refresh</Button>}
    >
      <div className="card p-4">
        <Input
          label="Search companies"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Company name or domain"
          aria-label="Search companies"
        />
      </div>
      <DataState
        loading={loading}
        error={error}
        onRetry={loadCompanies}
        empty={!companies.length}
        emptyTitle={search ? 'No companies match this search' : 'No companies yet'}
        emptyDescription={search ? 'Try another company name or domain.' : 'A company appears here after a genuine job lead is qualified or an account is created through the approved workflow.'}
      >
        <div className="hidden md:block">
          <DataTable
            tableLabel="Companies"
            rows={companies}
            onRowClick={openCompany}
            columns={[
              { key: 'name', label: 'Company', render: company => <div><p className="font-semibold text-neutral-900">{company.name}</p><p className="text-xs text-neutral-600">{company.domain || 'Domain not recorded'}</p></div> },
              { key: 'industry', label: 'Industry', render: company => company.industry || 'Not recorded' },
              { key: 'contact_count', label: 'Hiring contacts', render: company => <span className="font-semibold text-neutral-900">{company.contact_count || 0}</span> },
              { key: 'open_requirement_count', label: 'Open roles', render: company => <span className="font-semibold text-neutral-900">{company.open_requirement_count || 0}</span> },
              { key: 'country', label: 'Market', render: company => company.country || 'Not recorded' },
            ]}
          />
        </div>
        <div className="grid gap-3 md:hidden">
          {companies.map(company => (
            <button key={company.id} type="button" onClick={() => openCompany(company)} className="card p-4 text-left focus:outline-none focus:ring-2 focus:ring-primary-400">
              <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-neutral-900">{company.name}</p><p className="mt-1 text-xs text-neutral-600">{company.domain || 'Domain not recorded'}</p></div><Building2 className="h-5 w-5 text-primary-600" /></div>
              <div className="mt-3 flex gap-4 text-xs text-neutral-700"><span>{company.contact_count || 0} contacts</span><span>{company.open_requirement_count || 0} open roles</span></div>
            </button>
          ))}
        </div>
      </DataState>
    </WorkspacePage>
  );
}

function Company360({ data, tab, onTabChange, onLinkContact }) {
  const { company, contacts = [], requirements = [], events = [], tasks = [] } = data;
  const overdueTask = tasks.find(task => task.due_at && new Date(task.due_at) < new Date());
  const nextTask = overdueTask || tasks[0];
  const tabs = COMPANY_TABS.map(item => ({
    ...item,
    count: item.id === 'contacts' ? contacts.length : item.id === 'roles' ? requirements.length : item.id === 'work' ? tasks.length : item.id === 'activity' ? events.length : undefined,
  }));
  return (
    <div className="space-y-4">
      <EntityHeader
        trail={[{ label: 'Companies', to: '/wizmatch/companies' }, { label: company.name }]}
        title={company.name}
        subtitle={[company.domain, company.industry, company.country].filter(Boolean).join(' · ') || 'Account details are not complete yet.'}
        status={requirements.some(requirement => !['filled', 'closed_lost', 'cancelled'].includes(requirement.stage)) ? 'active' : 'watch'}
        metadata={[
          { label: 'Hiring contacts', value: String(contacts.length) },
          { label: 'Open roles', value: String(requirements.filter(requirement => !['filled', 'closed_lost', 'cancelled'].includes(requirement.stage)).length) },
          { label: 'Open work', value: String(tasks.length) },
          { label: 'ATS', value: company.ats_type ? humanize(company.ats_type) : 'Not configured' },
        ]}
        action={<Button variant="primary" onClick={onLinkContact} icon={<Plus />}>Link hiring contact</Button>}
      />
      <NextActionPanel
        blocked={!contacts.length}
        title={!contacts.length ? 'Add the person who owns hiring' : nextTask?.title || 'Review the account relationship'}
        description={!contacts.length ? 'A role cannot be accepted until a genuine named source contact and contact channel are recorded.' : nextTask?.description || 'Confirm that active roles have an owner, recruiter, SLA and dated next action.'}
        dueAt={nextTask?.due_at}
        action={!contacts.length ? <Button size="compact" variant="primary" onClick={onLinkContact}>Link contact</Button> : undefined}
      />
      <WorkspaceTabs tabs={tabs} active={tab} onChange={onTabChange} label="Company 360 sections" />
      {tab === 'contacts' && <CompanyContacts contacts={contacts} onLinkContact={onLinkContact} />}
      {tab === 'roles' && <CompanyRequirements requirements={requirements} companyName={company.name} />}
      {tab === 'work' && <OpenWork tasks={tasks} />}
      {tab === 'activity' && <section className="card p-5"><h3 className="mb-4 font-semibold text-neutral-900">Account activity</h3><ActivityTimeline items={events} /></section>}
      {tab === 'account' && <AccountSummary company={company} />}
    </div>
  );
}

function CompanyContacts({ contacts, onLinkContact }) {
  return (
    <section className="card p-5">
      <div className="mb-4 flex items-center justify-between gap-3"><div><h3 className="font-semibold text-neutral-900">Hiring contacts</h3><p className="mt-1 text-sm text-neutral-600">Each person keeps their own role attribution and coordination history.</p></div><Button size="compact" onClick={onLinkContact} icon={<Plus />}>Link person</Button></div>
      {!contacts.length ? <p className="rounded-md bg-neutral-50 p-5 text-sm text-neutral-600">No hiring contacts linked yet.</p> : (
        <div className="grid gap-3 lg:grid-cols-2">
          {contacts.map(contact => (
            <Link key={contact.id} to={`/wizmatch/hiring-contacts?contactId=${contact.id}`} className="rounded-lg border border-neutral-200 p-4 hover:border-primary-300 hover:bg-primary-50 focus:outline-none focus:ring-2 focus:ring-primary-400">
              <div className="flex items-start justify-between gap-3"><div><p className="font-semibold text-neutral-900">{contactName(contact)}</p><div className="mt-2 flex flex-wrap gap-1">{(contact.roles || []).map(role => <StatusBadge key={role} status="new" label={humanize(role)} />)}</div></div><UserRound className="h-5 w-5 text-primary-600" /></div>
              <div className="mt-3 space-y-1 text-sm text-neutral-700"><p><Mail className="mr-2 inline h-4 w-4" />{contact.email || 'No verified email'}</p><p><Phone className="mr-2 inline h-4 w-4" />{contact.phone || 'No verified phone'}</p></div>
              <div className="mt-3 flex justify-between text-xs text-neutral-600"><span>{contact.active_requirement_count || 0} attributed roles</span><span>Next: {contact.next_action || 'not set'}</span></div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}

function CompanyRequirements({ requirements, companyName }) {
  return (
    <section className="card p-5">
      <h3 className="font-semibold text-neutral-900">Roles supplied by this account</h3>
      <p className="mt-1 text-sm text-neutral-600">Source attribution remains person-specific, even when roles share the same company.</p>
      <div className="mt-4 space-y-3">
        {!requirements.length ? <p className="rounded-md bg-neutral-50 p-5 text-sm text-neutral-600">No roles recorded for {companyName}.</p> : requirements.map(requirement => (
          <Link key={requirement.id} to={`/wizmatch/roles?requirementId=${requirement.id}`} className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 hover:border-primary-300 sm:flex-row sm:items-center sm:justify-between">
            <div><p className="font-semibold text-neutral-900">{requirement.title}</p><p className="mt-1 text-sm text-neutral-600">Source: {[requirement.source_first_name, requirement.source_last_name].filter(Boolean).join(' ') || 'Needs attribution'}</p></div>
            <div className="flex items-center gap-3"><StatusBadge status={requirement.stage || 'draft'} /><span className="text-xs text-neutral-600">{requirement.next_action || 'Next action not set'}</span></div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function OpenWork({ tasks }) {
  return <section className="card p-5"><h3 className="font-semibold text-neutral-900">Open account work</h3><div className="mt-4 space-y-3">{!tasks.length ? <p className="rounded-md bg-neutral-50 p-5 text-sm text-neutral-600">No open work for this company.</p> : tasks.map(task => <div key={task.id} className="rounded-lg border border-neutral-200 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-semibold text-neutral-900">{task.title}</p><StatusBadge status={task.due_at && new Date(task.due_at) < new Date() ? 'overdue' : 'new'} label={task.due_at && new Date(task.due_at) < new Date() ? 'Overdue' : 'Open'} /></div><p className="mt-1 text-sm text-neutral-600">{task.description || 'No supporting note'}</p><p className="mt-2 text-xs text-neutral-600"><CalendarClock className="mr-1 inline h-3.5 w-3.5" />{formatDate(task.due_at)}</p>{task.requirement_id && <Link className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-primary-700" to={`/wizmatch/roles?requirementId=${task.requirement_id}`}>Open role <ExternalLink className="h-3.5 w-3.5" /></Link>}</div>)}</div></section>;
}

function AccountSummary({ company }) {
  const fields = [
    ['Company name', company.name], ['Domain', company.domain], ['Industry', company.industry], ['Country', company.country],
    ['ATS provider', company.ats_type ? humanize(company.ats_type) : null], ['ATS board', company.ats_board_url],
  ];
  return <section className="card p-5"><h3 className="font-semibold text-neutral-900">Account and sourcing configuration</h3><dl className="mt-4 grid gap-4 sm:grid-cols-2">{fields.map(([label, value]) => <div key={label} className="rounded-md bg-neutral-50 p-3"><dt className="text-xs font-semibold uppercase tracking-wide text-neutral-600">{label}</dt><dd className="mt-1 break-words font-medium text-neutral-900">{value || 'Not recorded'}</dd></div>)}</dl><p className="mt-4 text-sm text-neutral-600"><BriefcaseBusiness className="mr-2 inline h-4 w-4" />ATS discovery and provider-run controls are managed from Job Leads and More → System.</p></section>;
}

function LinkContactModal({ companyId, open, onClose, onSaved }) {
  const [contacts, setContacts] = useState([]);
  const [contactId, setContactId] = useState('');
  const [roles, setRoles] = useState(['talent_acquisition']);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return;
    setLoading(true); setError('');
    apiFetch('/api/wizmatch/staffing/contacts')
      .then(data => { setContacts(data.items || []); setContactId(data.items?.[0]?.id || ''); })
      .catch(requestError => setError(requestError.message || 'CRM contacts could not be loaded.'))
      .finally(() => setLoading(false));
  }, [open]);

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return contacts;
    return contacts.filter(contact => `${contactName(contact)} ${contact.email || ''} ${contact.company_name || ''}`.toLowerCase().includes(query));
  }, [contacts, search]);

  const save = async () => {
    setSaving(true); setError('');
    try {
      await apiFetch(`/api/wizmatch/companies/${companyId}/contacts`, { method: 'POST', body: JSON.stringify({ contactId, roles, sourceType: 'manual' }) });
      onSaved();
    } catch (requestError) {
      setError(requestError.message || 'The hiring contact could not be linked.');
    } finally { setSaving(false); }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Link a hiring contact"
      description="Choose an existing canonical CRM person so email and phone remain deduplicated."
      width={620}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={saving || !contactId || !roles.length} onClick={save}>{saving ? 'Linking…' : 'Link person'}</Button></>}
    >
      {error && <div role="alert" className="mb-4 rounded-md border border-danger-500/30 bg-red-50 p-3 text-danger-600">{error}</div>}
      <Input label="Find CRM person" value={search} onChange={event => setSearch(event.target.value)} placeholder="Name, email or company" />
      <label className="mt-4 block text-sm font-semibold text-neutral-700" htmlFor="company-contact-person">Person</label>
      <select id="company-contact-person" className="mt-1 h-10 w-full rounded-md border border-neutral-300 bg-white px-3" value={contactId} onChange={event => setContactId(event.target.value)} disabled={loading}>
        {!filteredContacts.length && <option value="">No matching CRM person</option>}
        {filteredContacts.map(contact => <option key={contact.id} value={contact.id}>{contactName(contact)} · {contact.email || contact.company_name || 'no verified channel'}</option>)}
      </select>
      <fieldset className="mt-5"><legend className="text-sm font-semibold text-neutral-700">Relationship roles</legend><div className="mt-2 grid gap-2 sm:grid-cols-2">{ROLE_OPTIONS.map(role => <label key={role} className="flex items-center gap-2 rounded-md border border-neutral-200 p-2 text-sm"><input type="checkbox" checked={roles.includes(role)} onChange={event => setRoles(current => event.target.checked ? [...new Set([...current, role])] : current.filter(value => value !== role))} />{humanize(role)}</label>)}</div></fieldset>
    </Modal>
  );
}
