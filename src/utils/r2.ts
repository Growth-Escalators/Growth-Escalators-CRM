import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import crypto from 'crypto';

let _client: S3Client | null = null;

function getClient(): S3Client | null {
  if (_client) return _client;
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) return null;

  _client = new S3Client({
    region: 'auto',
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return _client;
}

// H17 (Fable review) — an attacker-controlled `originalname` (the multipart
// field is client-supplied, not validated) was previously sanitized with a
// single regex applied to the WHOLE string, which kept `.` and `/` intact —
// a `..` traversal segment survives that unchanged. Some callers build a
// "directory/filename"-style key themselves before calling uploadPrivateToR2
// (e.g. `wizmatch/consents/<tenantId>/${Date.now()}-${originalname}`), so a
// crafted originalname could escape the intended tenant-scoped prefix
// entirely. Sanitizing per path SEGMENT and dropping any segment that is
// exactly `.` or `..` closes this regardless of how a caller assembled the
// string — the escape segments are removed, not just character-filtered.
function sanitizeR2Key(rawKey: string): string {
  return rawKey
    .split('/')
    .map((seg) => seg.replace(/[^a-zA-Z0-9._-]+/g, '-'))
    .filter((seg) => seg.length > 0 && seg !== '.' && seg !== '..')
    .join('/');
}

// Same traversal risk applies to the file extension derived from
// originalname below: an originalname with no `.` at all (e.g.
// "evil/../../etc") makes `.split('.').pop()` return the ENTIRE string,
// embedding `/` and `..` into the generated filename. Cap length and
// restrict to a safe charset.
function sanitizeExtension(raw: string | undefined): string {
  const cleaned = (raw ?? '').replace(/[^a-zA-Z0-9]+/g, '');
  return cleaned.length > 0 ? cleaned.slice(0, 10) : 'bin';
}

// Minimal magic-byte sniffing for the small fixed set of types this app
// accepts — avoids pulling in a new dependency (e.g. `file-type`) for a
// handful of well-known signatures. multer's fileFilter only sees
// file.mimetype, which is the client-supplied Content-Type header on the
// multipart part and trivially spoofable; this checks the actual bytes.
// Returns the sniffed MIME type, or null if it doesn't match anything known.
export function sniffFileType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return 'image/gif';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  // PDF — the contracts/e-sign module stores source/generated/completed/audit
  // PDFs; multer only sees the spoofable Content-Type, so the actual %PDF-1.x
  // header (25 50 44 46) is the real gate. Kept in the shared sniffer so
  // isAllowedUploadContent can validate contract uploads by bytes.
  if (buf.subarray(0, 4).toString('ascii') === '%PDF') return 'application/pdf';
  // ISO base media container (MP4/QuickTime) — a 4-byte box size followed by
  // an "ftyp" box type at offset 4. Covers both; brand bytes after that vary
  // too much across encoders to distinguish reliably, and this app accepts
  // both under the same upload flow anyway.
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') return 'video/mp4';
  return null;
}

export const R2_ALLOWED_UPLOAD_MIME_TYPES = [
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'video/mp4', 'video/quicktime',
  'application/pdf',
] as const;

// True if the buffer's actual bytes match a known-safe signature. video/quicktime
// shares the ftyp box signature with video/mp4 (both ISO base media containers),
// so a claimed video/quicktime is accepted when the bytes sniff as video/mp4.
export function isAllowedUploadContent(buf: Buffer, claimedMimeType: string): boolean {
  const sniffed = sniffFileType(buf);
  if (!sniffed) return false;
  if (sniffed === claimedMimeType) return true;
  if (sniffed === 'video/mp4' && claimedMimeType === 'video/quicktime') return true;
  return false;
}

export async function uploadToR2(
  file: Buffer,
  originalName: string,
  mimeType: string,
): Promise<string> {
  const client = getClient();
  if (!client) throw new Error('R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');

  const bucket = process.env.R2_BUCKET_NAME || 'ge-media';
  const ext = sanitizeExtension(originalName.split('.').pop());
  const filename = `${crypto.randomUUID()}-${Date.now()}.${ext}`;

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: filename,
    Body: file,
    ContentType: mimeType,
  }));

  const publicUrl = process.env.R2_PUBLIC_URL;
  if (publicUrl) return `${publicUrl}/${filename}`;
  return `https://${bucket}.r2.dev/${filename}`;
}

export async function uploadPrivateToR2(
  file: Buffer,
  originalName: string,
  mimeType: string,
): Promise<string> {
  const client = getClient();
  if (!client) throw new Error('R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');
  const bucket = resolvePrivateR2Bucket();
  const safeName = sanitizeR2Key(originalName);
  const key = safeName.includes('/') ? safeName : `private/${crypto.randomUUID()}-${Date.now()}-${safeName}`;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: file,
    ContentType: mimeType,
  }));
  return `r2://${bucket}/${key}`;
}

export function resolvePrivateR2Bucket(env: NodeJS.ProcessEnv = process.env): string {
  const bucket = env.R2_PRIVATE_BUCKET_NAME?.trim();
  if (!bucket) {
    throw new Error('Private R2 storage is not configured — set R2_PRIVATE_BUCKET_NAME');
  }
  return bucket;
}

export function parsePrivateR2Reference(reference: string): { bucket: string; key: string } | null {
  const match = /^r2:\/\/([^/]+)\/(.+)$/.exec(reference);
  return match ? { bucket: match[1], key: match[2] } : null;
}

export async function createSignedR2Url(reference: string, expiresInSeconds = 300): Promise<string> {
  const parsed = parsePrivateR2Reference(reference);
  if (!parsed) throw new Error('Document is not stored as a private R2 object');
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) throw new Error('R2 not configured');
  const expiresIn = Math.max(60, Math.min(expiresInSeconds, 900));
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/auto/s3/aws4_request`;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const canonicalUri = `/${encodeURIComponent(parsed.bucket)}/${parsed.key.split('/').map(encodeURIComponent).join('/')}`;
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresIn),
    'X-Amz-SignedHeaders': 'host',
  });
  query.sort();
  const canonicalRequest = ['GET', canonicalUri, query.toString(), `host:${host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n');
  const hmac = (key: crypto.BinaryLike, value: string) => crypto.createHmac('sha256', key).update(value).digest();
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), 'auto'), 's3'), 'aws4_request');
  const signature = crypto.createHmac('sha256', signingKey).update(stringToSign).digest('hex');
  return `https://${host}${canonicalUri}?${query.toString()}&X-Amz-Signature=${signature}`;
}

export async function deleteFromR2(filename: string): Promise<void> {
  const client = getClient();
  if (!client) return;
  const bucket = process.env.R2_BUCKET_NAME || 'ge-media';
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: filename }));
}

export interface R2Object {
  key: string;
  url: string;
  size: number;
  lastModified: string;
  mimeType: string;
}

function inferMimeType(key: string): string {
  const ext = (key.split('.').pop() || '').toLowerCase();
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', mov: 'video/quicktime',
    pdf: 'application/pdf',
  };
  return map[ext] || 'application/octet-stream';
}

export async function listR2Objects(): Promise<R2Object[]> {
  const client = getClient();
  if (!client) return [];
  const bucket = process.env.R2_BUCKET_NAME || 'ge-media';
  const publicUrl = process.env.R2_PUBLIC_URL || `https://${bucket}.r2.dev`;

  const result = await client.send(new ListObjectsV2Command({ Bucket: bucket, MaxKeys: 500 }));
  return (result.Contents || []).map(obj => ({
    key: obj.Key || '',
    url: `${publicUrl}/${obj.Key}`,
    size: obj.Size || 0,
    lastModified: obj.LastModified?.toISOString() || '',
    mimeType: inferMimeType(obj.Key || ''),
  }));
}
