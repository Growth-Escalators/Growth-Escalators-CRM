import { describe, expect, it } from 'vitest';
import { normalizeProviderId, signalIdentityFingerprint } from '../services/wizmatchSignalIdentity';
import { createSignedR2Url, parsePrivateR2Reference, resolvePrivateR2Bucket } from '../utils/r2';

describe('Wizmatch signal identity', () => {
  it('normalizes equivalent company/title/location signals to one fingerprint', () => {
    expect(signalIdentityFingerprint({ companyName: 'Company A, Inc.', jobTitle: 'SAP  ABAP Developer', location: 'Pune, India' }))
      .toBe(signalIdentityFingerprint({ companyName: 'company a inc', jobTitle: 'SAP-ABAP Developer', location: 'Pune India' }));
  });

  it('keeps materially different roles separate', () => {
    expect(signalIdentityFingerprint({ companyName: 'A', jobTitle: 'Java Developer', location: 'Pune' }))
      .not.toBe(signalIdentityFingerprint({ companyName: 'A', jobTitle: 'JavaScript Developer', location: 'Pune' }));
  });

  it('requires company and title and normalizes provider ids', () => {
    expect(signalIdentityFingerprint({ jobTitle: 'Java' })).toBeNull();
    expect(normalizeProviderId('  JOB-123 ')).toBe('job 123');
  });
});

describe('private R2 references', () => {
  it('fails closed instead of placing confidential documents in the public media bucket', () => {
    expect(() => resolvePrivateR2Bucket({ R2_BUCKET_NAME: 'public-media' })).toThrow('R2_PRIVATE_BUCKET_NAME');
    expect(resolvePrivateR2Bucket({ R2_BUCKET_NAME: 'public-media', R2_PRIVATE_BUCKET_NAME: 'wizmatch-private' }))
      .toBe('wizmatch-private');
  });

  it('parses private references and emits bounded signed access', async () => {
    process.env.R2_ACCOUNT_ID = 'account';
    process.env.R2_ACCESS_KEY_ID = 'access';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    expect(parsePrivateR2Reference('r2://bucket/private/file.pdf')).toEqual({ bucket: 'bucket', key: 'private/file.pdf' });
    const url = await createSignedR2Url('r2://bucket/private/file.pdf', 5);
    expect(url).toContain('X-Amz-Expires=60');
    expect(url).toContain('X-Amz-Signature=');
  });
});
