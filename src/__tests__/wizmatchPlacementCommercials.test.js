import { describe, expect, it } from 'vitest';
import {
  formatPlacementCommercial,
  summarizePlacementCommercials,
} from '../../admin/src/lib/wizmatchPlacementCommercials.js';

describe('Wizmatch placement commercial labels', () => {
  it('never labels a permanent fee as an hourly margin', () => {
    expect(formatPlacementCommercial({
      placement_type: 'permanent',
      currency: 'INR',
      perm_fee_amount: 250000,
      margin_hourly: 250000,
    })).toBe('₹2,50,000 permanent fee');
  });

  it('labels contract margin with its hourly period', () => {
    expect(formatPlacementCommercial({
      placement_type: 'contract',
      currency: 'INR',
      margin_hourly: 500,
    })).toBe('₹500/hr contract margin');
  });

  it('keeps permanent fees and contract margins separate in totals', () => {
    expect(summarizePlacementCommercials([
      { placement_type: 'permanent', currency: 'INR', perm_fee_amount: 250000, margin_hourly: 250000 },
      { placement_type: 'contract', currency: 'INR', margin_hourly: 500 },
    ])).toBe('₹500/hr contract margin · ₹2,50,000 permanent fees');
  });
});
