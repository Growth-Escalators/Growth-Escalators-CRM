/**
 * Wizmatch outreach templates — your reusable email copy with merge fields.
 *
 * Uses the repo's ensure-hook pattern (CREATE TABLE IF NOT EXISTS), so no Drizzle
 * migration / schema.ts change. Rendering fills {{firstName}}/{{company}}/{{team}}/
 * {{title}} and guarantees the CAN-SPAM/GDPR footer placeholders are present so every
 * send carries an unsubscribe link + physical address (mirrors the signal draft rules).
 */
import type { Pool } from 'pg';

export interface OutreachTemplateVars {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  team?: string | null;
  title?: string | null;
}

export async function ensureOutreachTemplatesTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wizmatch_outreach_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      name text NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      active boolean NOT NULL DEFAULT true,
      created_by uuid,
      created_at timestamp DEFAULT NOW(),
      updated_at timestamp DEFAULT NOW()
    )
  `);
  await pool.query(
    `CREATE INDEX IF NOT EXISTS wizmatch_outreach_templates_tenant_idx ON wizmatch_outreach_templates (tenant_id, active)`,
  );
}

/** Replace {{key}} placeholders (case-insensitive) with contact values; unknown keys blank out. */
export function renderMergeFields(text: string, vars: OutreachTemplateVars): string {
  const map: Record<string, string> = {
    firstname: (vars.firstName || '').trim(),
    lastname: (vars.lastName || '').trim(),
    company: (vars.company || '').trim(),
    team: (vars.team || '').trim(),
    title: (vars.title || '').trim(),
  };
  return text.replace(/\{\{\s*([a-zA-Z]+)\s*\}\}/g, (_m, key: string) => map[key.toLowerCase()] ?? '');
}

/** Guarantee the compliance placeholders exist so the send route can inject the real values. */
export function ensureCompliancePlaceholders(body: string): string {
  let out = body;
  const hasUnsub = out.includes('[UNSUBSCRIBE_LINK]');
  const hasAddr = out.includes('[PHYSICAL_ADDRESS]');
  if (!hasUnsub || !hasAddr) {
    const footerParts: string[] = [];
    if (!hasUnsub) footerParts.push('Unsubscribe: [UNSUBSCRIBE_LINK]');
    if (!hasAddr) footerParts.push('[PHYSICAL_ADDRESS]');
    out = `${out.trimEnd()}\n\n---\n${footerParts.join('\n')}`;
  }
  return out;
}

/** Render a template for a specific contact: merge fields + compliance footer. */
export function renderTemplate(
  template: { subject: string; body: string },
  vars: OutreachTemplateVars,
): { subject: string; body: string } {
  return {
    subject: renderMergeFields(template.subject, vars),
    body: ensureCompliancePlaceholders(renderMergeFields(template.body, vars)),
  };
}
