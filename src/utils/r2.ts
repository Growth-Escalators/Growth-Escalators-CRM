import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
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

export async function deleteFromR2(filename: string): Promise<void> {
  const client = getClient();
  if (!client) return;
  const bucket = process.env.R2_BUCKET_NAME || 'ge-media';
  await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: filename }));
}
