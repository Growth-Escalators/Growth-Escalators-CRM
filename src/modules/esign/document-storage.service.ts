// Contract document storage — thin, contract-specific layer over the shared
// private-R2 helpers (src/utils/r2.ts). Enforces:
//   - immutable, versioned, tenant-scoped keys:
//       contracts/{tenantId}/{contractId}/v{version}/{artifact}.{pdf|json}
//   - private storage only (never the public bucket / a public URL)
//   - %PDF magic-byte validation for PDF artifacts (Content-Type is spoofable)
//   - SHA-256 of every stored artifact (persisted by the caller for integrity checks)
//
// It never deletes or overwrites: callers must not re-store the same
// (contractId, version, artifact) — a content change means a NEW version.
import {
  uploadPrivateToR2,
  createSignedR2Url,
  parsePrivateR2Reference,
  sniffFileType,
} from '../../utils/r2';
import { HttpError } from '../../utils/errors';
import { sha256Hex } from './document-hash.service';

export type ContractArtifact =
  | 'source'
  | 'generated'
  | 'completed'
  | 'audit-certificate'
  | 'metadata';

const PDF_ARTIFACTS: ReadonlySet<ContractArtifact> = new Set<ContractArtifact>([
  'source',
  'generated',
  'completed',
  'audit-certificate',
]);

export interface StoredArtifact {
  /** r2://<bucket>/<key> reference to persist on the contract row. */
  reference: string;
  /** SHA-256 hex of the stored bytes. */
  hash: string;
  /** The object key (without the r2:// prefix). */
  key: string;
}

/** Build the immutable, tenant-scoped, versioned object key for a contract artifact. */
export function buildContractKey(
  tenantId: string,
  contractId: string,
  version: number,
  artifact: ContractArtifact,
): string {
  if (!tenantId || !contractId) {
    throw new HttpError(400, 'tenantId and contractId are required for a contract key', 'VALIDATION_ERROR');
  }
  if (!Number.isInteger(version) || version < 1) {
    throw new HttpError(400, 'contract version must be a positive integer', 'VALIDATION_ERROR');
  }
  const ext = artifact === 'metadata' ? 'json' : 'pdf';
  return `contracts/${tenantId}/${contractId}/v${version}/${artifact}.${ext}`;
}

/** Throw a 400 if the buffer is not a real PDF (by magic bytes, not Content-Type). */
export function assertPdf(buf: Buffer): void {
  if (sniffFileType(buf) !== 'application/pdf') {
    throw new HttpError(400, 'File is not a valid PDF', 'VALIDATION_ERROR');
  }
}

export interface StoreArtifactInput {
  tenantId: string;
  contractId: string;
  version: number;
  artifact: ContractArtifact;
  buffer: Buffer;
  /** Defaults to application/pdf (or application/json for metadata). */
  contentType?: string;
}

/** Store a contract artifact privately in R2 and return its reference + hash. */
export async function storeContractArtifact(input: StoreArtifactInput): Promise<StoredArtifact> {
  const { tenantId, contractId, version, artifact, buffer } = input;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new HttpError(400, 'empty document buffer', 'VALIDATION_ERROR');
  }
  if (PDF_ARTIFACTS.has(artifact)) assertPdf(buffer);
  const key = buildContractKey(tenantId, contractId, version, artifact);
  const contentType =
    input.contentType ?? (artifact === 'metadata' ? 'application/json' : 'application/pdf');
  // uploadPrivateToR2 writes a '/'-containing key verbatim (after per-segment
  // sanitisation), so the full key above is used as-is.
  const reference = await uploadPrivateToR2(buffer, key, contentType);
  return { reference, hash: sha256Hex(buffer), key };
}

/**
 * Mint a short-lived signed download URL for a stored contract artifact.
 * Rejects anything that is not a private r2:// reference (defence against a
 * public URL leaking into a contract row).
 */
export async function getContractDownloadUrl(
  reference: string,
  ttlSeconds?: number,
): Promise<string> {
  if (!reference || !parsePrivateR2Reference(reference)) {
    throw new HttpError(400, 'contract document is not a private R2 object', 'VALIDATION_ERROR');
  }
  const envTtl = Number(process.env.CONTRACTS_SIGNED_URL_TTL_SECONDS);
  const ttl = ttlSeconds ?? (Number.isFinite(envTtl) && envTtl > 0 ? envTtl : 300);
  // createSignedR2Url clamps to [60, 900].
  return createSignedR2Url(reference, ttl);
}
