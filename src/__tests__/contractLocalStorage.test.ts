import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  storeContractArtifact,
  isLocalReference,
  resolveLocalPath,
} from '../modules/esign/document-storage.service';
import { sha256Hex } from '../modules/esign/document-hash.service';

const PDF = Buffer.from('%PDF-1.7 local store test');
let dir: string;
let savedFlag: string | undefined;
let savedDir: string | undefined;

beforeEach(() => {
  savedFlag = process.env.CONTRACTS_STORAGE;
  savedDir = process.env.CONTRACTS_STORAGE_DIR;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'esign-local-'));
  process.env.CONTRACTS_STORAGE = 'local';
  process.env.CONTRACTS_STORAGE_DIR = dir;
});
afterEach(() => {
  if (savedFlag === undefined) delete process.env.CONTRACTS_STORAGE; else process.env.CONTRACTS_STORAGE = savedFlag;
  if (savedDir === undefined) delete process.env.CONTRACTS_STORAGE_DIR; else process.env.CONTRACTS_STORAGE_DIR = savedDir;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('local filesystem storage backend (CONTRACTS_STORAGE=local)', () => {
  it('writes the artifact to disk and returns a local:// ref + hash', async () => {
    const res = await storeContractArtifact({ tenantId: 't1', contractId: 'c1', version: 2, artifact: 'generated', buffer: PDF });
    expect(res.key).toBe('contracts/t1/c1/v2/generated.pdf');
    expect(res.reference).toBe('local://contracts/t1/c1/v2/generated.pdf');
    expect(res.hash).toBe(sha256Hex(PDF));
    expect(isLocalReference(res.reference)).toBe(true);

    const p = resolveLocalPath(res.reference);
    expect(p.startsWith(dir)).toBe(true);
    expect(fs.existsSync(p)).toBe(true);
    expect(fs.readFileSync(p).equals(PDF)).toBe(true);
  });

  it('still enforces PDF magic-byte validation in local mode', async () => {
    await expect(
      storeContractArtifact({ tenantId: 't', contractId: 'c', version: 1, artifact: 'source', buffer: Buffer.from('not a pdf at all') }),
    ).rejects.toThrow(/not a valid PDF/i);
  });

  it('isLocalReference distinguishes local:// from r2://', () => {
    expect(isLocalReference('local://contracts/x')).toBe(true);
    expect(isLocalReference('r2://bucket/x')).toBe(false);
    expect(isLocalReference('https://pub/x')).toBe(false);
  });
});
