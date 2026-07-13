function amount(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currency(value) {
  const code = String(value || 'USD').trim().toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : 'USD';
}

function formatMoney(value, currencyCode) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: currencyCode,
    maximumFractionDigits: 0,
  }).format(value);
}

export function isPermanentPlacement(placement) {
  return placement?.placement_type === 'permanent';
}

export function formatPlacementCommercial(placement) {
  const currencyCode = currency(placement?.currency);
  if (isPermanentPlacement(placement)) {
    const fee = amount(placement?.perm_fee_amount ?? placement?.margin_hourly);
    return fee > 0 ? `${formatMoney(fee, currencyCode)} permanent fee` : 'Permanent fee not recorded';
  }
  const margin = amount(placement?.margin_hourly);
  return margin !== 0 ? `${formatMoney(margin, currencyCode)}/hr contract margin` : 'Contract margin not recorded';
}

export function summarizePlacementCommercials(placements) {
  const totals = new Map();
  for (const placement of placements || []) {
    const currencyCode = currency(placement?.currency);
    const current = totals.get(currencyCode) || { contractMargin: 0, permanentFees: 0 };
    if (isPermanentPlacement(placement)) {
      current.permanentFees += amount(placement?.perm_fee_amount ?? placement?.margin_hourly);
    } else {
      current.contractMargin += amount(placement?.margin_hourly);
    }
    totals.set(currencyCode, current);
  }

  const labels = [];
  for (const [currencyCode, values] of [...totals.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (values.contractMargin !== 0) labels.push(`${formatMoney(values.contractMargin, currencyCode)}/hr contract margin`);
    if (values.permanentFees !== 0) labels.push(`${formatMoney(values.permanentFees, currencyCode)} permanent fees`);
  }
  return labels.length ? labels.join(' · ') : 'No commercial value recorded';
}
