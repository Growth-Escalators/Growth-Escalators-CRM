import { pool } from '../db/index';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Ensure audit_logs table exists
// ---------------------------------------------------------------------------
export async function ensureAuditLogsTable(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id SERIAL PRIMARY KEY,
      tenant_id UUID,
      user_id UUID,
      user_email VARCHAR(200),
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50) NOT NULL,
      entity_id VARCHAR(200),
      entity_name VARCHAR(200),
      old_values JSONB,
      new_values JSONB,
      ip_address VARCHAR(50),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant ON audit_logs(tenant_id, created_at DESC)`).catch(() => {});
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id)`).catch(() => {});
}

// ---------------------------------------------------------------------------
// Log an audit event (never throws — audit failures are non-critical)
// ---------------------------------------------------------------------------
export async function auditLog(params: {
  tenantId?: string;
  userId?: string;
  userEmail?: string;
  action: string;
  entityType: string;
  entityId?: string;
  entityName?: string;
  oldValues?: Record<string, unknown>;
  newValues?: Record<string, unknown>;
  ipAddress?: string;
}): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO audit_logs (tenant_id, user_id, user_email, action, entity_type, entity_id, entity_name, old_values, new_values, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        params.tenantId ?? null, params.userId ?? null, params.userEmail ?? null,
        params.action, params.entityType, params.entityId ?? null, params.entityName ?? null,
        params.oldValues ? JSON.stringify(params.oldValues) : null,
        params.newValues ? JSON.stringify(params.newValues) : null,
        params.ipAddress ?? null,
      ],
    );
  } catch (e) {
    logger.error('[audit] Failed to log:', e instanceof Error ? e.message : String(e));
  }
}
