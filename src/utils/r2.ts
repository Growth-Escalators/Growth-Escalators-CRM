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

export async function uploadToR2(
  file: Buffer,
  originalName: string,
  mimeType: string,
): Promise<string> {
  const client = getClient();
  if (!client) throw new Error('R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY');

  const bucket = process.env.R2_BUCKET_NAME || 'ge-media';
  const ext = originalName.split('.').pop() || 'bin';
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
  const bucket = process.env.R2_BUCKET_NAME || 'ge-media';
  const safeName = originalName.replace(/[^a-zA-Z0-9._/-]+/g, '-').replace(/^\/+/, '');
  const key = safeName.includes('/') ? safeName : `private/${crypto.randomUUID()}-${Date.now()}-${safeName}`;
  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: file,
    ContentType: mimeType,
  }));
  return `r2://${bucket}/${key}`;
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
