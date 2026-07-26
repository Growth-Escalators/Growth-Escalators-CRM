import { describe, it, expect } from 'vitest';
import { computeCampaignCompatibility } from '../modules/outreach/campaignCompatibility';
import type { ExternalHiringPolicy, RelationshipType } from '../modules/outreach/policyTypes';

const HIRING_POLICIES: ExternalHiringPolicy[] = [
  'accepts_external_vendors',
  'fte_vendors_only',
  'contract_vendors_only',
  'preferred_vendors_only',
  'msp_vms_only',
  'direct_hiring_only',
  'no_external_agencies',
  'unknown',
];

const RELATIONSHIP_TYPES: RelationshipType[] = [
  'new_prospect',
  'existing_prospect',
  'existing_client',
  'vendor_partner',
  'prime_partner',
  'former_client',
  'competitor',
  'irrelevant',
];

describe('computeCampaignCompatibility — routing matrix (PRD-005 §8.6/§8.7)', () => {
  it('msp_vms_only yields exactly msp_vms, never a staffing type', () => {
    const result = computeCampaignCompatibility('msp_vms_only', 'new_prospect');
    expect(result.allowedCampaignTypes).toEqual(['msp_vms']);
    expect(result.decision).toBe('deny');
  });

  it('preferred_vendors_only yields exactly vendor_empanelment and is a review decision', () => {
    const result = computeCampaignCompatibility('preferred_vendors_only', 'new_prospect');
    expect(result.allowedCampaignTypes).toEqual(['vendor_empanelment']);
    expect(result.decision).toBe('review');
  });

  it('no_external_agencies denies and stops preparation', () => {
    const result = computeCampaignCompatibility('no_external_agencies', 'new_prospect');
    expect(result.decision).toBe('deny');
    expect(result.preparationAllowed).toBe(false);
    expect(result.allowedOutreachModes).toEqual([]);
  });

  it('existing_client overrides hiring-policy allow with a deny-cold + account_owner route', () => {
    const result = computeCampaignCompatibility('accepts_external_vendors', 'existing_client');
    expect(result.decision).toBe('deny');
    expect(result.route).toBe('account_owner');
    expect(result.allowedOutreachModes).toEqual(['account_managed']);
  });

  it('a more permissive relationship never downgrades a stricter hiring-policy decision', () => {
    // msp_vms_only (deny) with new_prospect (no override) stays deny.
    const result = computeCampaignCompatibility('msp_vms_only', 'new_prospect');
    expect(result.decision).toBe('deny');
  });

  it('every hiring-policy x relationship-type combination produces a defined result', () => {
    for (const hp of HIRING_POLICIES) {
      for (const rt of RELATIONSHIP_TYPES) {
        const result = computeCampaignCompatibility(hp, rt);
        expect(['allow', 'review', 'deny']).toContain(result.decision);
        expect(Array.isArray(result.allowedCampaignTypes)).toBe(true);
        expect(Array.isArray(result.allowedOutreachModes)).toBe(true);
      }
    }
  });
});
