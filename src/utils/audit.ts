import { db, auditEvents } from '../db/index';
import type { Request } from 'express';

export async function logAuditEvent(
  userId: string | null,
  tenantId: string,
  action: string,
  resourceType?: string,
  resourceId?: string,
  metadata?: Record<string, unknown>,
  req?: Request,
): Promise<void> {
  try {
    await db.insert(auditEvents).values({
      tenantId,
      userId,
      action,
      resourceType: resourceType || null,
      resourceId: resourceId || null,
      metadata: metadata || {},
      ipAddress: req ? (req.headers['x-forwarded-for'] as string || req.ip || null) : null,
      userAgent: req ? (req.headers['user-agent'] || null) : null,
    });
  } catch (e) {
    console.error('[audit] failed to log event:', e);
  }
}
