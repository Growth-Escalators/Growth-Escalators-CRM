export const DELIVERY_STAGES = [
  { value: 'shortlisted', label: 'Shortlisted' },
  { value: 'consent', label: 'Consent' },
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'submitted', label: 'Sent' },
  { value: 'interviewing', label: 'Interview' },
  { value: 'offered', label: 'Offer' },
  { value: 'placed', label: 'Placement' },
];

export function deliveryLifecycleStage(item) {
  if (item?.status === 'draft' && item?.consent_status === 'granted') return 'draft';
  if (item?.status === 'draft') return 'consent';
  return item?.status || 'shortlisted';
}

export function primaryDeliveryAction(item, capabilities = {}) {
  if (item?.status === 'draft' && item?.consent_status === 'granted' && capabilities.approveSubmissions) return { id: 'approve', label: 'Approve submission' };
  if (item?.status === 'approved' && capabilities.approveSubmissions) return { id: 'sent', label: 'Record sent' };
  if (item?.status === 'submitted' && capabilities.operateDelivery) return { id: 'interview', label: 'Add interview' };
  if (item?.status === 'interviewing' && (item?.latest_interview_id || item?.latestInterview?.id) && !['completed', 'cancelled', 'no_show'].includes(item?.latest_interview_status || item?.latestInterview?.status) && capabilities.operateDelivery) return { id: 'feedback', label: 'Record interview outcome' };
  if (item?.status === 'interviewing' && ['cancelled', 'no_show'].includes(item?.latest_interview_status || item?.latestInterview?.status) && capabilities.operateDelivery) return { id: 'interview', label: 'Schedule next interview' };
  if (item?.status === 'interviewing' && (!item?.latest_interview_id && !item?.latestInterview?.id) && capabilities.operateDelivery) return { id: 'interview', label: 'Add interview' };
  if (item?.status === 'interviewing' && (item?.latest_interview_status === 'completed' || item?.latestInterview?.status === 'completed') && capabilities.manageOffers) return { id: 'offer', label: 'Add offer' };
  if (item?.status === 'offered' && item?.offer_status !== 'accepted' && capabilities.manageOffers) return { id: 'accept', label: 'Record offer accepted' };
  if (item?.status === 'offered' && item?.offer_status === 'accepted' && capabilities.manageFinance) return { id: 'place', label: 'Create placement' };
  return null;
}

export function classifyCandidate(candidate, verifiedIds) {
  const status = String(candidate?.availability_status || '').toLowerCase();
  if (['archived', 'unavailable', 'placed', 'benched'].includes(status)) return 'archived';
  if (verifiedIds?.has(String(candidate?.id))) return 'verified';
  if (String(candidate?.source || '').toLowerCase() === 'xray') return 'leads';
  return 'evidence';
}

export function validEmailOrBlank(value) {
  const email = String(value || '').trim();
  return !email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function placementMarginPercent(billAmount, loadedCost) {
  const bill = Number(billAmount || 0);
  const cost = Number(loadedCost || 0);
  if (bill <= 0) return 0;
  return ((bill - cost) / bill) * 100;
}
