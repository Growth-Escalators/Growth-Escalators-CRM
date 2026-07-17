import { describe, expect, it } from 'vitest';
import {
  assertTransition,
  canTransition,
  ContractStateError,
  computeStatusFromRecipients,
  isTerminal,
  allowedNextStatuses,
  CONTRACT_STATUSES,
  type ContractStatus,
} from '../modules/esign/contract-state-machine';

describe('contract state machine — transitions', () => {
  it('allows the happy-path lifecycle', () => {
    const path: ContractStatus[] = [
      'DRAFT',
      'GENERATED',
      'READY_TO_SEND',
      'SENT',
      'VIEWED',
      'PARTIALLY_SIGNED',
      'COMPLETED',
    ];
    for (let i = 0; i < path.length - 1; i++) {
      expect(canTransition(path[i], path[i + 1])).toBe(true);
      expect(assertTransition(path[i], path[i + 1])).toBe(path[i + 1]);
    }
  });

  it('allows a single-signer SENT → COMPLETED shortcut', () => {
    expect(canTransition('SENT', 'COMPLETED')).toBe(true);
  });

  it('treats COMPLETED and VOIDED as terminal', () => {
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('VOIDED')).toBe(true);
    expect(allowedNextStatuses('COMPLETED')).toHaveLength(0);
    expect(allowedNextStatuses('VOIDED')).toHaveLength(0);
  });

  it('rejects illegal transitions', () => {
    const illegal: [ContractStatus, ContractStatus][] = [
      ['COMPLETED', 'DRAFT'],
      ['COMPLETED', 'SENT'],
      ['VOIDED', 'DRAFT'],
      ['DRAFT', 'SENT'], // must be GENERATED + READY_TO_SEND first
      ['DRAFT', 'COMPLETED'],
      ['SENT', 'GENERATED'], // sent docs are immutable
      ['EXPIRED', 'SENT'],
      ['REJECTED', 'COMPLETED'],
    ];
    for (const [from, to] of illegal) {
      expect(canTransition(from, to)).toBe(false);
      expect(() => assertTransition(from, to)).toThrow(ContractStateError);
    }
  });

  it('throws a 409-coded ContractStateError with from/to', () => {
    try {
      assertTransition('COMPLETED', 'DRAFT');
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ContractStateError);
      const e = err as ContractStateError;
      expect(e.statusCode).toBe(409);
      expect(e.code).toBe('INVALID_CONTRACT_TRANSITION');
      expect(e.from).toBe('COMPLETED');
      expect(e.to).toBe('DRAFT');
    }
  });

  it('rejects unknown status strings', () => {
    expect(canTransition('BOGUS' as ContractStatus, 'DRAFT')).toBe(false);
    expect(() => assertTransition('DRAFT', 'NOPE' as ContractStatus)).toThrow(ContractStateError);
  });

  it('every allowed target is itself a known status', () => {
    for (const s of CONTRACT_STATUSES) {
      for (const t of allowedNextStatuses(s)) {
        expect(CONTRACT_STATUSES).toContain(t);
      }
    }
  });
});

describe('contract state machine — recipient aggregation', () => {
  it('SENT when nobody has acted', () => {
    expect(
      computeStatusFromRecipients([{ status: 'pending' }, { status: 'pending' }]),
    ).toBe('SENT');
  });

  it('VIEWED when someone viewed but none signed', () => {
    expect(
      computeStatusFromRecipients([{ status: 'viewed' }, { status: 'pending' }]),
    ).toBe('VIEWED');
  });

  it('PARTIALLY_SIGNED when some but not all signed (countersignature case)', () => {
    expect(
      computeStatusFromRecipients([{ status: 'signed' }, { status: 'pending' }]),
    ).toBe('PARTIALLY_SIGNED');
  });

  it('COMPLETED only when all required recipients signed', () => {
    expect(
      computeStatusFromRecipients([{ status: 'signed' }, { status: 'signed' }]),
    ).toBe('COMPLETED');
  });

  it('REJECTED if any recipient rejected, regardless of others', () => {
    expect(
      computeStatusFromRecipients([{ status: 'signed' }, { status: 'rejected' }]),
    ).toBe('REJECTED');
  });

  it('defensive: empty recipient set stays SENT', () => {
    expect(computeStatusFromRecipients([])).toBe('SENT');
  });
});
