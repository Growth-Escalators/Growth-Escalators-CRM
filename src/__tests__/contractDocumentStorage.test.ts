import { describe, expect, it, vi } from 'vitest';
import { sha256Hex, verifyHash } from '../modules/esign/document-hash.service';
import {
  buildContractKey,
  assertPdf,
  getContractDownloadUrl,
  storeContractArtifact,
} from '../modules/esign/document-storage.service';
import { sniffFileType, isAllowedUploadContent } from '../utils/r2';

// Keep the real r2 module except for the network write.
vi.mock('../utils/r2', async (importActual) => {
  const actual = await importActual<typeof import('../utils/r2')>();
  return {
    ...actual,
    uploadPrivateToR2: vi.fn(async (_buf: Buffer, key: string) => `r2://test-private-bucket/${key}`),
  };
});

const PDF = Buffer.from('%PDF-1.7\n% test pdf bytes padding\n');
const NOT_PDF = Buffer.from('this is definitely not a pdf document at all');

describe('document-hash.service', () => {
  it('sha256Hex matches the known vector for "abc"', () => {
    expect(sha256Hex(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('verifyHash accepts the matching digest and rejects a wrong / malformed one', () => {
    const h = sha256Hex(PDF);
    expect(verifyHash(PDF, h)).toBe(true);
    expect(verifyHash(PDF, h.toUpperCase())).toBe(true); // case-insensitive
    expect(verifyHash(NOT_PDF, h)).toBe(false);
    expect(verifyHash(PDF, 'nothex')).toBe(false);
    expect(verifyHash(PDF, '')).toBe(false);
  });
});

describe('r2 PDF validation additions', () => {
  it('sniffFileType recognises the %PDF magic bytes', () => {
    expect(sniffFileType(PDF)).toBe('application/pdf');
    expect(sniffFileType(NOT_PDF)).toBeNull();
  });

  it('isAllowedUploadContent now admits a real PDF claimed as application/pdf', () => {
    expect(isAllowedUploadContent(PDF, 'application/pdf')).toBe(true);
    // a spoofed Content-Type over non-pdf bytes is still rejected
    expect(isAllowedUploadContent(NOT_PDF, 'application/pdf')).toBe(false);
  });
});

describe('buildContractKey', () => {
  it('produces an immutable, tenant-scoped, versioned key', () => {
    expect(buildContractKey('tenant-1', 'contract-9', 2, 'completed')).toBe(
      'contracts/tenant-1/contract-9/v2/completed.pdf',
    );
    expect(buildContractKey('t', 'c', 1, 'metadata')).toBe('contracts/t/c/v1/metadata.json');
  });

  it('rejects missing ids or non-positive versions', () => {
    expect(() => buildContractKey('', 'c', 1, 'source')).toThrow();
    expect(() => buildContractKey('t', 'c', 0, 'source')).toThrow();
    expect(() => buildContractKey('t', 'c', 1.5, 'source')).toThrow();
  });
});

describe('assertPdf', () => {
  it('passes for a real PDF and throws for anything else', () => {
    expect(() => assertPdf(PDF)).not.toThrow();
    expect(() => assertPdf(NOT_PDF)).toThrow(/not a valid PDF/i);
  });
});

describe('storeContractArtifact', () => {
  it('validates PDF, writes the versioned key, returns reference + hash', async () => {
    const res = await storeContractArtifact({
      tenantId: 'tn', contractId: 'ct', version: 3, artifact: 'generated', buffer: PDF,
    });
    expect(res.key).toBe('contracts/tn/ct/v3/generated.pdf');
    expect(res.reference).toBe('r2://test-private-bucket/contracts/tn/ct/v3/generated.pdf');
    expect(res.hash).toBe(sha256Hex(PDF));
  });

  it('rejects a non-PDF artifact before any upload', async () => {
    await expect(
      storeContractArtifact({ tenantId: 'tn', contractId: 'ct', version: 1, artifact: 'source', buffer: NOT_PDF }),
    ).rejects.toThrow(/not a valid PDF/i);
  });

  it('does not PDF-validate the metadata artifact', async () => {
    const res = await storeContractArtifact({
      tenantId: 'tn', contractId: 'ct', version: 1, artifact: 'metadata',
      buffer: Buffer.from(JSON.stringify({ ok: true })), contentType: 'application/json',
    });
    expect(res.key).toBe('contracts/tn/ct/v1/metadata.json');
  });
});

describe('getContractDownloadUrl', () => {
  it('rejects a non-private-R2 reference (no public URL leakage)', async () => {
    await expect(getContractDownloadUrl('https://pub.example/x.pdf')).rejects.toThrow(/private R2/i);
    await expect(getContractDownloadUrl('')).rejects.toThrow();
  });
});
