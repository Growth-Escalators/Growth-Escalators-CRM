// Contract state machine — the single source of truth for valid contract status
// transitions. Pure module (no imports) so it is trivially unit-testable and can
// be reused by the service, webhook handler, and crons.
//
// Lifecycle:
//   DRAFT → GENERATED → READY_TO_SEND → SENT → VIEWED → PARTIALLY_SIGNED → COMPLETED
// with side-exits REJECTED | EXPIRED | VOIDED | FAILED.
//
// Invariants enforced here:
//   - A SENT (or later) contract is immutable content-wise; to change it you VOID
//     and clone to a new version (handled in the service, not here).
//   - COMPLETED and VOIDED are terminal.
//   - The approval gate (GENERATED → READY_TO_SEND) is a permission check in the
//     service; this module only says the transition itself is structurally legal.

export const CONTRACT_STATUSES = [
  'DRAFT',
  'GENERATED',
  'READY_TO_SEND',
  'SENT',
  'VIEWED',
  'PARTIALLY_SIGNED',
  'COMPLETED',
  'REJECTED',
  'EXPIRED',
  'VOIDED',
  'FAILED',
] as const;

export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export const TERMINAL_STATUSES: ReadonlySet<ContractStatus> = new Set<ContractStatus>([
  'COMPLETED',
  'VOIDED',
]);

// Allowed transitions. Absence from a source list = forbidden.
const ALLOWED_TRANSITIONS: Record<ContractStatus, readonly ContractStatus[]> = {
  DRAFT: ['GENERATED', 'VOIDED', 'FAILED'],
  GENERATED: ['READY_TO_SEND', 'DRAFT', 'VOIDED', 'FAILED'],
  READY_TO_SEND: ['SENT', 'DRAFT', 'VOIDED', 'FAILED'],
  SENT: ['VIEWED', 'PARTIALLY_SIGNED', 'COMPLETED', 'REJECTED', 'EXPIRED', 'VOIDED', 'FAILED'],
  VIEWED: ['PARTIALLY_SIGNED', 'COMPLETED', 'REJECTED', 'EXPIRED', 'VOIDED', 'FAILED'],
  PARTIALLY_SIGNED: ['COMPLETED', 'REJECTED', 'EXPIRED', 'VOIDED', 'FAILED'],
  COMPLETED: [],
  REJECTED: ['VOIDED'],
  EXPIRED: ['VOIDED'],
  VOIDED: [],
  FAILED: ['DRAFT', 'VOIDED'],
};

export class ContractStateError extends Error {
  readonly statusCode = 409;
  readonly code = 'INVALID_CONTRACT_TRANSITION';
  readonly from: ContractStatus;
  readonly to: string;
  constructor(from: ContractStatus, to: string) {
    super(`Invalid contract transition: ${from} → ${to}`);
    this.name = 'ContractStateError';
    this.from = from;
    this.to = to;
  }
}

export function isContractStatus(value: unknown): value is ContractStatus {
  return typeof value === 'string' && (CONTRACT_STATUSES as readonly string[]).includes(value);
}

export function isTerminal(status: ContractStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

export function canTransition(from: ContractStatus, to: ContractStatus): boolean {
  return ALLOWED_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Throws ContractStateError if the transition is not allowed. Returns `to` on success. */
export function assertTransition(from: ContractStatus, to: ContractStatus): ContractStatus {
  if (!isContractStatus(from)) throw new ContractStateError(from as ContractStatus, to);
  if (!isContractStatus(to) || !canTransition(from, to)) {
    throw new ContractStateError(from, to);
  }
  return to;
}

export function allowedNextStatuses(from: ContractStatus): readonly ContractStatus[] {
  return ALLOWED_TRANSITIONS[from] ?? [];
}

// Recipient-level signing status used to compute the contract-level status.
export type RecipientSignStatus = 'pending' | 'viewed' | 'signed' | 'rejected';

/**
 * Compute the contract status implied by the current set of recipient statuses,
 * given the contract is in-flight (SENT/VIEWED/PARTIALLY_SIGNED). Enforces
 * signing order for countersignature (client signer(s) before internal
 * countersigner) at the service layer; here we only aggregate outcomes:
 *   - any recipient rejected            → REJECTED
 *   - all required recipients signed    → COMPLETED
 *   - at least one signed (not all)     → PARTIALLY_SIGNED
 *   - at least one viewed (none signed) → VIEWED
 *   - otherwise                         → SENT
 */
export function computeStatusFromRecipients(
  recipients: readonly { status: RecipientSignStatus }[],
): ContractStatus {
  if (recipients.length === 0) return 'SENT';
  if (recipients.some((r) => r.status === 'rejected')) return 'REJECTED';
  const signed = recipients.filter((r) => r.status === 'signed').length;
  if (signed === recipients.length) return 'COMPLETED';
  if (signed > 0) return 'PARTIALLY_SIGNED';
  if (recipients.some((r) => r.status === 'viewed')) return 'VIEWED';
  return 'SENT';
}
