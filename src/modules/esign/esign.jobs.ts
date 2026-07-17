// Scheduled contract jobs (registered in src/worker.ts):
//   - expireOverdueContracts: move open contracts past their expiresAt to EXPIRED.
//   - sendSigningReminders: nudge the current-turn unsigned signer on open,
//     non-expired contracts, throttled to CONTRACTS_REMINDER_INTERVAL_DAYS.
// Job logic lives here (testable); worker.ts only schedules it.
import * as repo from './esign.repository';
import * as service from './esign.service';

export interface ExpiryResult {
  checked: number;
  expired: number;
}

export async function expireOverdueContracts(now: Date = new Date()): Promise<ExpiryResult> {
  const open = await repo.findOpenContracts();
  let expired = 0;
  for (const c of open) {
    if (c.expiresAt && c.expiresAt.getTime() < now.getTime()) {
      const did = await service.expireContract(c.tenantId, c.id);
      if (did) expired += 1;
    }
  }
  return { checked: open.length, expired };
}

export interface ReminderResult {
  checked: number;
  reminded: number;
}

export async function sendSigningReminders(
  now: Date = new Date(),
  intervalDays: number = Number(process.env.CONTRACTS_REMINDER_INTERVAL_DAYS) || 3,
): Promise<ReminderResult> {
  const open = await repo.findOpenContracts();
  const intervalMs = Math.max(1, intervalDays) * 86_400_000;
  let reminded = 0;
  for (const c of open) {
    // Skip contracts that are (about to be) expired — the expiry job handles those.
    if (c.expiresAt && c.expiresAt.getTime() < now.getTime()) continue;
    const sentAt = c.sentAt ? c.sentAt.getTime() : 0;
    if (sentAt === 0) continue; // never actually sent
    const lastReminder = await repo.latestEventAt(c.tenantId, c.id, ['contract.reminder_sent']);
    const lastTouch = Math.max(sentAt, lastReminder ? lastReminder.getTime() : 0);
    if (now.getTime() - lastTouch < intervalMs) continue; // reminded/sent too recently
    try {
      await service.remindCurrentSigner(c.tenantId, c.id);
      reminded += 1;
    } catch {
      // one contract's reminder failure must not stop the sweep
    }
  }
  return { checked: open.length, reminded };
}
