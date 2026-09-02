import React from 'react';
import { safeLower } from '../lib/safe.js';

const QUALITY_OPTIONS = [
  { value: '', label: 'Not reviewed', cls: 'bg-neutral-100 text-neutral-600 border-neutral-200' },
  { value: 'hot', label: 'Hot', cls: 'bg-success-500/10 text-success-700 border-success-200' },
  { value: 'good', label: 'Good', cls: 'bg-primary-50 text-primary-700 border-primary-200' },
  { value: 'weak', label: 'Weak', cls: 'bg-warning-500/10 text-warning-700 border-warning-200' },
  { value: 'junk', label: 'Junk', cls: 'bg-danger-50 text-danger-700 border-danger-200' },
];

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function displayValue(value) {
  if (value == null || value === '') return '—';
  return String(value);
}

function touchLanding(touch, kind) {
  return touch?.landingPage || touch?.[`${kind}LandingPage`] || '—';
}

function touchReferrer(touch, kind) {
  return touch?.referrerUrl || touch?.[`${kind}ReferrerUrl`] || '';
}

function sourceLabel(touch, kind) {
  const source = String(touch?.utmSource || '').trim();
  const medium = String(touch?.utmMedium || '').trim();
  if (source) return medium ? `${source} · ${medium}` : source;

  const referrer = touchReferrer(touch, kind);
  if (referrer) {
    try {
      return `Referral · ${new URL(referrer).hostname.replace(/^www\./, '')}`;
    } catch {
      return 'Referral';
    }
  }
  return 'Direct';
}

function compactCampaign(touch) {
  return [touch?.utmCampaign, touch?.utmContent]
    .filter(Boolean)
    .map(String)
    .join(' · ');
}

function Metric({ label, value }) {
  if (value == null || value === '') return null;
  return (
    <div className="rounded-lg border border-neutral-100 bg-neutral-50 px-3 py-2">
      <span className="block text-[10px] uppercase tracking-wide text-neutral-400 mb-0.5">{label}</span>
      <span className="text-sm font-medium text-neutral-800 break-words">{displayValue(value)}</span>
    </div>
  );
}

function TouchCard({ title, touch, kind }) {
  const campaign = compactCampaign(touch);
  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-neutral-700">{title}</span>
        <span className="text-xs px-2 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
          {sourceLabel(touch, kind)}
        </span>
      </div>
      <div>
        <span className="block text-[10px] uppercase tracking-wide text-neutral-400">Landing page</span>
        <span className="text-xs text-neutral-700 break-all">{touchLanding(touch, kind)}</span>
      </div>
      {campaign && (
        <div>
          <span className="block text-[10px] uppercase tracking-wide text-neutral-400">Campaign</span>
          <span className="text-xs text-neutral-700 break-words">{campaign}</span>
        </div>
      )}
      {touch?.capturedAt && (
        <span className="block text-[10px] text-neutral-400">
          {new Date(touch.capturedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      )}
    </div>
  );
}

export default function WebsiteLeadIntelligence({ contact, deals = [], onPatch }) {
  const metadata = asObject(contact?.metadata);
  const latestLead = asObject(metadata.latestWebsiteLead);
  const firstTouch = asObject(metadata.firstWebsiteAttribution);
  const lastTouch = asObject(metadata.lastWebsiteAttribution);
  const conversion = asObject(metadata.latestWebsiteConversion);
  const isWebsiteLead = contact?.source === 'website'
    || (contact?.tags ?? []).includes('website_lead')
    || Object.keys(latestLead).length > 0;

  if (!isWebsiteLead) return null;

  const quality = String(metadata.leadQuality || '');
  const qualityOption = QUALITY_OPTIONS.find((option) => option.value === quality) || QUALITY_OPTIONS[0];
  const currentDeal = deals[0] || null;

  async function setQuality(value) {
    await onPatch({
      metadata: {
        ...metadata,
        leadQuality: value || null,
        leadQualityUpdatedAt: new Date().toISOString(),
      },
    });
  }

  return (
    <div className="space-y-4 rounded-2xl border border-primary-100 bg-primary-50/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-semibold text-neutral-700 uppercase tracking-wide">Website Lead Intelligence</h3>
          <p className="text-xs text-neutral-500 mt-0.5">
            Acquisition → qualification → deal outcome
          </p>
        </div>
        <span className="text-[10px] px-2 py-1 rounded-full bg-white border border-primary-100 text-primary-700">
          {Number(metadata.websiteLeadCount || 1)} website lead{Number(metadata.websiteLeadCount || 1) === 1 ? '' : 's'}
        </span>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <label htmlFor={`lead-quality-${contact?.id}`} className="text-xs font-medium text-neutral-600">Lead quality</label>
          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium ${qualityOption.cls}`}>
            {qualityOption.label}
          </span>
        </div>
        <select
          id={`lead-quality-${contact?.id}`}
          value={quality}
          onChange={(e) => setQuality(e.target.value)}
          className="w-full border border-neutral-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
        >
          {QUALITY_OPTIONS.map((option) => (
            <option key={option.value || 'none'} value={option.value}>{option.label}</option>
          ))}
        </select>
        <p className="text-[10px] text-neutral-400">Kept separate from the CRM score so bookings, sales scoring and manual qualification never overwrite each other.</p>
      </div>

      <div className="space-y-2">
        <h4 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide">Latest enquiry</h4>
        <div className="grid grid-cols-2 gap-2">
          <Metric label="Service" value={latestLead.service} />
          <Metric label="Vertical" value={latestLead.businessVertical || contact?.businessType} />
          <Metric label="Monthly revenue" value={latestLead.monthlyRevenue} />
          <Metric label="Marketing spend" value={latestLead.budget} />
          <Metric label="Market" value={latestLead.market || latestLead.city} />
          <Metric label="Assigned bucket" value={latestLead.assignedBucket} />
        </div>
        {latestLead.website && (
          <a href={String(latestLead.website).startsWith('http') ? latestLead.website : `https://${latestLead.website}`}
            target="_blank" rel="noreferrer" className="text-xs text-primary-600 hover:underline break-all">
            {latestLead.website} ↗
          </a>
        )}
        {latestLead.message && (
          <div className="rounded-lg bg-white border border-neutral-200 p-3">
            <span className="block text-[10px] uppercase tracking-wide text-neutral-400 mb-1">What they need</span>
            <p className="text-xs text-neutral-700 whitespace-pre-wrap">{latestLead.message}</p>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <h4 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide">Acquisition journey</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <TouchCard title="First touch" touch={firstTouch} kind="first" />
          <TouchCard title="Last touch" touch={lastTouch} kind="last" />
        </div>
        <div className="flex flex-wrap gap-2 text-[10px]">
          {conversion.conversionPage && (
            <span className="px-2 py-1 rounded-full bg-white border border-neutral-200 text-neutral-600">
              Converted on {conversion.conversionPage}
            </span>
          )}
          {conversion.whatsappClicked && (
            <span className="px-2 py-1 rounded-full bg-success-500/10 border border-success-200 text-success-700">
              WhatsApp used before form{conversion.whatsappClickSource ? ` · ${conversion.whatsappClickSource}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <h4 className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide">Commercial outcome</h4>
        {!currentDeal ? (
          <p className="text-xs text-neutral-500 bg-white border border-neutral-200 rounded-lg p-3">
            No deal linked yet. Create one when this lead becomes a real opportunity; pipeline stage, value and lost reason remain the source of truth.
          </p>
        ) : (
          <div className="rounded-xl bg-white border border-neutral-200 p-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="text-xs font-semibold text-neutral-800">{currentDeal.title || 'Opportunity'}</span>
                <span className={`ml-2 text-[10px] px-2 py-0.5 rounded-full font-medium ${
                  safeLower(currentDeal.stage).includes('won')
                    ? 'bg-success-500/10 text-success-700'
                    : safeLower(currentDeal.stage).includes('lost')
                      ? 'bg-danger-50 text-danger-700'
                      : 'bg-primary-50 text-primary-700'
                }`}>
                  {currentDeal.stage || 'Open'}
                </span>
              </div>
              {Number(currentDeal.dealValue || currentDeal.value || 0) > 0 && (
                <span className="text-sm font-semibold text-success-700">
                  ₹{Number(currentDeal.dealValue || currentDeal.value || 0).toLocaleString('en-IN')}
                </span>
              )}
            </div>
            {currentDeal.lostReason && (
              <p className="text-xs text-danger-600 mt-2">Lost reason: {currentDeal.lostReason}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
