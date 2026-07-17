import { describe, it, expect, vi, beforeEach } from 'vitest';

// H17 — R2 uploads trusted the client-supplied MIME type and sanitized
// originalname with a single whole-string regex that left `.` and `/`
// intact, so a `..` traversal segment survived. These tests exercise the
// two fixes directly: magic-byte sniffing (isAllowedUploadContent) and
// per-segment key sanitization (via uploadPrivateToR2's resulting key,
// asserted through the mocked S3 client call).

const mockSend = vi.fn().mockResolvedValue({});
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: class { send = mockSend; },
  PutObjectCommand: class { input: unknown; constructor(input: unknown) { this.input = input; } },
  DeleteObjectCommand: class {},
  ListObjectsV2Command: class {},
}));

import { sniffFileType, isAllowedUploadContent, uploadPrivateToR2 } from '../utils/r2';

const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const GIF_HEADER = Buffer.from('GIF89a' + '\0'.repeat(6));
const WEBP_HEADER = Buffer.concat([Buffer.from('RIFF'), Buffer.from([0, 0, 0, 0]), Buffer.from('WEBP')]);
const MP4_HEADER = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from('ftyp'), Buffer.from('isom')]);
const HTML_PAYLOAD = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(20, ' '));

describe('sniffFileType (H17 — magic-byte detection)', () => {
  it.each([
    ['PNG', PNG_HEADER, 'image/png'],
    ['JPEG', JPEG_HEADER, 'image/jpeg'],
    ['GIF', GIF_HEADER, 'image/gif'],
    ['WEBP', WEBP_HEADER, 'image/webp'],
    ['MP4/QuickTime container', MP4_HEADER, 'video/mp4'],
  ])('detects %s from its magic bytes', (_label, buf, expected) => {
    expect(sniffFileType(buf)).toBe(expected);
  });

  it('returns null for content with no recognized signature (e.g. HTML)', () => {
    expect(sniffFileType(HTML_PAYLOAD)).toBeNull();
  });

  it('returns null for a too-short buffer', () => {
    expect(sniffFileType(Buffer.from([0x89, 0x50]))).toBeNull();
  });
});

describe('isAllowedUploadContent (H17 — closes the spoofed-mimetype gap)', () => {
  it('accepts a real PNG claiming image/png', () => {
    expect(isAllowedUploadContent(PNG_HEADER, 'image/png')).toBe(true);
  });

  it('rejects an HTML payload claiming image/png (the actual attack this closes)', () => {
    expect(isAllowedUploadContent(HTML_PAYLOAD, 'image/png')).toBe(false);
  });

  it('rejects content whose real type does not match the claimed type', () => {
    expect(isAllowedUploadContent(PNG_HEADER, 'image/gif')).toBe(false);
  });

  it('accepts video/quicktime claims when bytes sniff as the shared ftyp container', () => {
    expect(isAllowedUploadContent(MP4_HEADER, 'video/quicktime')).toBe(true);
  });
});

describe('uploadPrivateToR2 key sanitization (H17 — path traversal)', () => {
  beforeEach(() => {
    mockSend.mockClear();
    process.env.R2_ACCOUNT_ID = 'acct';
    process.env.R2_ACCESS_KEY_ID = 'key';
    process.env.R2_SECRET_ACCESS_KEY = 'secret';
    process.env.R2_PRIVATE_BUCKET_NAME = 'ge-private';
  });

  it('strips a traversal segment embedded in a caller-built directory-style key', async () => {
    const ref = await uploadPrivateToR2(
      Buffer.from('x'),
      'wizmatch/consents/tenant-123/../../../etc/cron.d/evil',
      'application/pdf',
    );
    const key = ref.replace('r2://ge-private/', '');
    expect(key).not.toMatch(/\.\./);
    expect(key.startsWith('wizmatch/consents/tenant-123/')).toBe(true);
    expect(key).toContain('etc/cron.d/evil');
  });

  it('drops a bare ".." originalname entirely rather than embedding it', async () => {
    const ref = await uploadPrivateToR2(Buffer.from('x'), '..', 'application/pdf');
    expect(ref).not.toMatch(/\.\./);
  });

  it('prefixes a bare filename (no slash) under private/<uuid>-<timestamp>-', async () => {
    const ref = await uploadPrivateToR2(Buffer.from('x'), 'resume.pdf', 'application/pdf');
    const key = ref.replace('r2://ge-private/', '');
    expect(key).toMatch(/^private\/[0-9a-f-]+-\d+-resume\.pdf$/);
  });
});
