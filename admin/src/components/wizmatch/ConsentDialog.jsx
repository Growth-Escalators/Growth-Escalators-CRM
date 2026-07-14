import React, { useState } from 'react';
import { ShieldCheck, Upload } from 'lucide-react';
import DialogShell from './DialogShell.jsx';
import { apiFetch } from '../../lib/api.js';

const CONSENT_TYPES = [
  { value: 'rtr', label: 'Right-to-represent (RTR)' },
  { value: 'verbal', label: 'Verbal consent' },
  { value: 'written', label: 'Written consent (email / message)' },
];

/**
 * Captures candidate consent / right-to-represent before a submission can be
 * approved. Optionally uploads a private RTR document first (its own request,
 * since the upload and the create-consent call are genuinely two backend
 * calls), then hands the parent a payload to POST to
 * /api/wizmatch/staffing/consents. The parent owns loading/error, matching
 * the ConfirmDialog usage pattern elsewhere in this app.
 */
export default function ConsentDialog({ open, candidateName, requirementTitle, loading = false, error = null, onCancel, onSubmit }) {
  const [consentType, setConsentType] = useState('rtr');
  const [markGranted, setMarkGranted] = useState(true);
  const [expiresAt, setExpiresAt] = useState('');
  const [file, setFile] = useState(null);
  const [documentReference, setDocumentReference] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');

  const reset = () => {
    setConsentType('rtr');
    setMarkGranted(true);
    setExpiresAt('');
    setFile(null);
    setDocumentReference(null);
    setUploadError('');
  };

  const uploadDocument = async () => {
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const { reference } = await apiFetch('/api/wizmatch/staffing/consent-documents', { method: 'POST', body: fd });
      setDocumentReference(reference);
    } catch (e) {
      setUploadError(e.message || 'Document upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const submit = () => {
    onSubmit({
      consentType,
      status: markGranted ? 'granted' : 'requested',
      expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
      documentReference: documentReference || undefined,
    });
  };

  const canSubmit = !loading && !uploading && (!file || documentReference);

  return (
    <DialogShell
      open={open}
      title="Record candidate consent"
      error={error || uploadError}
      loading={loading}
      onCancel={() => { reset(); onCancel(); }}
      footer={
        <>
          <button type="button" onClick={() => { reset(); onCancel(); }} disabled={loading} className="btn-standard">
            Cancel
          </button>
          <button type="button" onClick={submit} disabled={!canSubmit} className="btn-primary disabled:opacity-50">
            {loading ? 'Saving…' : markGranted ? 'Record & grant consent' : 'Record request'}
          </button>
        </>
      }
    >
      {({ firstFieldRef }) => (
        <>
          <p className="text-[12.5px] text-neutral-600">
            <ShieldCheck className="w-3.5 h-3.5 inline mr-1 text-primary-600" />
            {candidateName ? <b>{candidateName}</b> : 'This candidate'} for <b>{requirementTitle}</b>. Required before this submission can be approved.
          </p>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Consent type</label>
            <select ref={firstFieldRef} value={consentType} onChange={(e) => setConsentType(e.target.value)} className="input w-full mt-1">
              {CONSENT_TYPES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-[12.5px] text-neutral-600">
            <input type="checkbox" checked={markGranted} onChange={(e) => setMarkGranted(e.target.checked)} />
            Consent has already been obtained — mark as granted now
          </label>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">Expires (optional, max 30 days out)</label>
            <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="input w-full mt-1" />
          </div>
          <div>
            <label className="text-[11px] font-semibold text-neutral-500 uppercase tracking-wider">RTR document (optional, PDF/DOC)</label>
            <div className="flex items-center gap-2 mt-1">
              <label className="flex-1 flex items-center gap-2 border border-dashed border-neutral-300 rounded-md px-3 py-2 cursor-pointer hover:bg-neutral-50 text-[12.5px] text-neutral-600">
                <Upload className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span className="truncate">{file ? file.name : 'Choose file'}</span>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  className="hidden"
                  onChange={(e) => { setFile(e.target.files?.[0] || null); setDocumentReference(null); }}
                />
              </label>
              {file && !documentReference && (
                <button type="button" onClick={uploadDocument} disabled={uploading} className="btn-standard btn-compact shrink-0">
                  {uploading ? 'Uploading…' : 'Upload'}
                </button>
              )}
              {documentReference && <span className="text-[11.5px] text-success-700 font-semibold shrink-0">Uploaded</span>}
            </div>
          </div>
        </>
      )}
    </DialogShell>
  );
}
