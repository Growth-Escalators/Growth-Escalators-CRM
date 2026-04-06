import { pool } from '../db/index';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Bootstrap retainer tables on startup
// ---------------------------------------------------------------------------
export async function ensureRetainerTables(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS client_retainers (
      id SERIAL PRIMARY KEY,
      tenant_id UUID NOT NULL,
      client_id UUID,
      client_name VARCHAR(200) NOT NULL,
      retainer_number VARCHAR(50) UNIQUE NOT NULL,
      status VARCHAR(20) DEFAULT 'active',
      billing_address_line1 VARCHAR(200),
      billing_address_line2 VARCHAR(200),
      billing_city VARCHAR(100),
      billing_state VARCHAR(100),
      billing_pincode VARCHAR(20),
      billing_country VARCHAR(100) DEFAULT 'India',
      gstin VARCHAR(20),
      invoice_type VARCHAR(10) DEFAULT 'gst',
      tax_type VARCHAR(30) DEFAULT 'cgst_sgst',
      billing_day INTEGER DEFAULT 1,
      start_date DATE,
      end_date DATE,
      currency VARCHAR(10) DEFAULT 'INR',
      notes TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `).catch(() => {});

  await pool.query(`
    CREATE TABLE IF NOT EXISTS retainer_line_items (
      id SERIAL PRIMARY KEY,
      retainer_id INTEGER REFERENCES client_retainers(id) ON DELETE CASCADE,
      description VARCHAR(200) NOT NULL,
      sac_code VARCHAR(20) DEFAULT '9983',
      quantity INTEGER DEFAULT 1,
      unit VARCHAR(50) DEFAULT 'Month',
      rate INTEGER NOT NULL,
      amount INTEGER NOT NULL,
      sort_order INTEGER DEFAULT 0
    )
  `).catch(() => {});

  // Add columns to invoices table
  const cols = [
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS retainer_id INTEGER`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_address_line1 VARCHAR(200)`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_address_line2 VARCHAR(200)`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_city VARCHAR(100)`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_state VARCHAR(100)`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_pincode VARCHAR(20)`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS billing_country VARCHAR(100)`,
  ];
  for (const s of cols) await pool.query(s).catch(() => {});

  logger.info('[retainer] Tables bootstrapped');
}

// ---------------------------------------------------------------------------
// Generate next retainer number
// ---------------------------------------------------------------------------
export async function getNextRetainerNumber(): Promise<string> {
  const now = new Date();
  const year = now.getFullYear();
  const result = await pool.query(
    `SELECT retainer_number FROM client_retainers WHERE retainer_number LIKE $1 ORDER BY id DESC LIMIT 1`,
    [`RET/${year}/%`],
  );
  if (result.rows.length === 0) return `RET/${year}/001`;
  const last = (result.rows[0] as { retainer_number: string }).retainer_number;
  const seq = parseInt(last.split('/')[2] ?? '0', 10) + 1;
  return `RET/${year}/${String(seq).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Generate invoice from retainer
// ---------------------------------------------------------------------------
export async function generateInvoiceFromRetainer(
  retainerId: number,
  tenantId: string,
  createdBy: string,
): Promise<{ invoiceId: string | null; error?: string }> {
  const retainer = await pool.query(
    `SELECT * FROM client_retainers WHERE id = $1 AND tenant_id = $2`,
    [retainerId, tenantId],
  );
  if (retainer.rows.length === 0) return { invoiceId: null, error: 'Retainer not found' };
  const r = retainer.rows[0] as Record<string, unknown>;

  const lineItems = await pool.query(
    `SELECT * FROM retainer_line_items WHERE retainer_id = $1 ORDER BY sort_order`,
    [retainerId],
  );

  const items = lineItems.rows as Array<{ description: string; sac_code: string; quantity: number; unit: string; rate: number; amount: number; sort_order: number }>;
  const subtotal = items.reduce((s, i) => s + i.amount, 0);

  // Tax calculation
  const taxType = r.tax_type as string;
  let cgstRate = 0, cgstAmount = 0, sgstRate = 0, sgstAmount = 0, igstRate = 0, igstAmount = 0;
  if (taxType === 'cgst_sgst') {
    cgstRate = 9; cgstAmount = Math.round(subtotal * 0.09);
    sgstRate = 9; sgstAmount = Math.round(subtotal * 0.09);
  } else if (taxType === 'igst') {
    igstRate = 18; igstAmount = Math.round(subtotal * 0.18);
  }
  const totalAmount = subtotal + cgstAmount + sgstAmount + igstAmount;

  // Get next invoice number
  const { getNextInvoiceNumber } = await import('./invoiceNumberService');
  const invoiceType = (r.invoice_type as string) === 'non_gst' ? 'non_gst' : 'gst';
  const { number: invoiceNumber, series: seriesNumber, financialYear } = await getNextInvoiceNumber(tenantId, invoiceType as 'gst' | 'non_gst');

  // Amount in words
  const { amountInWords } = await import('./amountInWordsService');
  const words = amountInWords(totalAmount);

  const today = new Date();
  const dueDate = new Date(today);
  dueDate.setDate(dueDate.getDate() + 5);

  const invResult = await pool.query(`
    INSERT INTO invoices (
      tenant_id, client_id, invoice_number, invoice_type, status,
      invoice_date, due_date, subtotal,
      cgst_rate, cgst_amount, sgst_rate, sgst_amount, igst_rate, igst_amount,
      total_amount, amount_paid, amount_due, amount_in_words,
      client_gstin, client_state, company_gstin,
      tax_type, sac_code, financial_year, series_number,
      retainer_id, billing_address_line1, billing_address_line2,
      billing_city, billing_state, billing_pincode, billing_country,
      notes, created_by
    ) VALUES (
      $1, $2, $3, $4, 'draft',
      $5, $6, $7,
      $8, $9, $10, $11, $12, $13,
      $14, 0, $14, $15,
      $16, $17, '08DRYPA4899F2ZZ',
      $18, '9983', $19, $20,
      $21, $22, $23, $24, $25, $26, $27,
      $28, $29
    ) RETURNING id
  `, [
    tenantId, r.client_id, invoiceNumber, invoiceType,
    today.toISOString(), dueDate.toISOString(), subtotal,
    cgstRate, cgstAmount, sgstRate, sgstAmount, igstRate, igstAmount,
    totalAmount, words,
    r.gstin, r.billing_state,
    taxType, financialYear, seriesNumber,
    retainerId, r.billing_address_line1, r.billing_address_line2,
    r.billing_city, r.billing_state, r.billing_pincode, r.billing_country,
    r.notes, createdBy,
  ]);

  const invoiceId = (invResult.rows[0] as { id: string }).id;

  // Insert line items
  for (const item of items) {
    await pool.query(
      `INSERT INTO invoice_line_items (invoice_id, description, sac_code, quantity, unit, rate, amount, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [invoiceId, item.description, item.sac_code, item.quantity, item.unit, item.rate, item.amount, item.sort_order],
    );
  }

  return { invoiceId };
}

// ---------------------------------------------------------------------------
// Generate pending invoices for all retainers due today
// ---------------------------------------------------------------------------
export async function generatePendingInvoices(tenantId: string, createdBy: string): Promise<{ generated: number; errors: string[] }> {
  const today = new Date().getDate();
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  const retainers = await pool.query(
    `SELECT id, client_name FROM client_retainers
     WHERE tenant_id = $1 AND status = 'active' AND billing_day = $2
       AND NOT EXISTS (
         SELECT 1 FROM invoices i
         WHERE i.retainer_id = client_retainers.id
           AND to_char(i.invoice_date, 'YYYY-MM') = $3
       )`,
    [tenantId, today, currentMonth],
  );

  let generated = 0;
  const errors: string[] = [];

  for (const row of retainers.rows as Array<{ id: number; client_name: string }>) {
    try {
      const result = await generateInvoiceFromRetainer(row.id, tenantId, createdBy);
      if (result.invoiceId) generated++;
      else if (result.error) errors.push(`${row.client_name}: ${result.error}`);
    } catch (e) {
      errors.push(`${row.client_name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { generated, errors };
}
