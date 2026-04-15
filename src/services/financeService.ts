import { pool } from '../db/index';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Bootstrap finance tables (idempotent, called at startup)
// ---------------------------------------------------------------------------
export async function ensureFinanceTables(): Promise<void> {
  const stmts = [
    `CREATE TABLE IF NOT EXISTS expense_categories (
      id SERIAL PRIMARY KEY,
      tenant_id UUID,
      name TEXT NOT NULL,
      color TEXT DEFAULT '#64748b',
      icon TEXT DEFAULT 'receipt',
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE UNIQUE INDEX IF NOT EXISTS expense_cat_name_tenant ON expense_categories(tenant_id, name)`,

    `CREATE TABLE IF NOT EXISTS team_payroll (
      id SERIAL PRIMARY KEY,
      tenant_id UUID,
      name TEXT NOT NULL,
      role TEXT,
      base_salary INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `ALTER TABLE team_payroll ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0`,

    `CREATE TABLE IF NOT EXISTS expenses (
      id SERIAL PRIMARY KEY,
      tenant_id UUID,
      category_id INTEGER REFERENCES expense_categories(id),
      description TEXT NOT NULL,
      amount INTEGER NOT NULL,
      expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
      is_recurring BOOLEAN DEFAULT FALSE,
      recurring_day INTEGER,
      vendor_name TEXT,
      payment_method TEXT,
      notes TEXT,
      team_member_id INTEGER REFERENCES team_payroll(id),
      expense_type TEXT DEFAULT 'one-time',
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS expenses_date_idx ON expenses(expense_date DESC)`,
    `CREATE INDEX IF NOT EXISTS expenses_category_idx ON expenses(category_id)`,

    `CREATE TABLE IF NOT EXISTS income_entries (
      id SERIAL PRIMARY KEY,
      tenant_id UUID,
      source TEXT NOT NULL,
      description TEXT,
      amount INTEGER NOT NULL,
      income_date DATE NOT NULL DEFAULT CURRENT_DATE,
      category TEXT DEFAULT 'client_revenue',
      notes TEXT,
      invoice_id UUID,
      created_at TIMESTAMP DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS income_date_idx ON income_entries(income_date DESC)`,
    // Composite indexes for performance
    `CREATE INDEX IF NOT EXISTS expenses_tenant_date_idx ON expenses(tenant_id, expense_date DESC)`,
    `CREATE INDEX IF NOT EXISTS expenses_recurring_idx ON expenses(is_recurring) WHERE is_recurring = TRUE`,
    `CREATE INDEX IF NOT EXISTS income_tenant_date_idx ON income_entries(tenant_id, income_date DESC)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS income_invoice_uniq ON income_entries(invoice_id) WHERE invoice_id IS NOT NULL`,
  ];

  for (const s of stmts) {
    await pool.query(s).catch(e => logger.warn(`[finance] ${e instanceof Error ? e.message : String(e)}`));
  }

  logger.info('[finance] Finance tables bootstrapped');
}

// ---------------------------------------------------------------------------
// Seed default categories (only if empty)
// ---------------------------------------------------------------------------
export async function seedDefaultCategories(tenantId: string): Promise<void> {
  const existing = await pool.query(`SELECT COUNT(*)::int AS c FROM expense_categories WHERE tenant_id = $1`, [tenantId]);
  if ((existing.rows[0] as { c: number }).c > 0) return;

  const defaults = [
    { name: 'Software & Tech', color: '#3b82f6', icon: 'monitor', order: 1 },
    { name: 'Fulfillment Team', color: '#8b5cf6', icon: 'users', order: 2 },
    { name: 'Marketing', color: '#f59e0b', icon: 'megaphone', order: 3 },
    { name: 'Card Payments', color: '#ef4444', icon: 'credit-card', order: 4 },
    { name: 'Personal', color: '#10b981', icon: 'user', order: 5 },
    { name: 'Miscellaneous', color: '#64748b', icon: 'receipt', order: 6 },
  ];

  for (const d of defaults) {
    await pool.query(
      `INSERT INTO expense_categories (tenant_id, name, color, icon, sort_order) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [tenantId, d.name, d.color, d.icon, d.order],
    );
  }
  logger.info('[finance] Default expense categories seeded');
}

// ---------------------------------------------------------------------------
// Generate monthly recurring expenses + team salaries
// ---------------------------------------------------------------------------
export async function generateMonthlyExpenses(tenantId: string, month?: string): Promise<{ generated: number }> {
  const targetMonth = month || new Date().toISOString().slice(0, 7);
  const [year, mon] = targetMonth.split('-').map(Number);
  const firstDay = `${targetMonth}-01`;
  let generated = 0;

  // 1. Team salaries
  const team = await pool.query(
    `SELECT id, name, base_salary FROM team_payroll WHERE tenant_id = $1 AND is_active = TRUE AND base_salary > 0`,
    [tenantId],
  );

  // Get or create "Fulfillment Team" category
  let teamCatId: number | null = null;
  const catR = await pool.query(
    `SELECT id FROM expense_categories WHERE tenant_id = $1 AND name = 'Fulfillment Team' LIMIT 1`,
    [tenantId],
  );
  if (catR.rows.length > 0) teamCatId = (catR.rows[0] as { id: number }).id;

  for (const member of team.rows as Array<{ id: number; name: string; base_salary: number }>) {
    // Check if already generated
    const exists = await pool.query(
      `SELECT id FROM expenses WHERE tenant_id = $1 AND team_member_id = $2 AND expense_date >= $3 AND expense_date < ($3::date + INTERVAL '1 month') AND expense_type = 'fixed' LIMIT 1`,
      [tenantId, member.id, firstDay],
    );
    if ((exists.rows as unknown[]).length > 0) continue;

    await pool.query(
      `INSERT INTO expenses (tenant_id, category_id, description, amount, expense_date, expense_type, team_member_id)
       VALUES ($1, $2, $3, $4, $5, 'fixed', $6)`,
      [tenantId, teamCatId, `Salary — ${member.name}`, member.base_salary, firstDay, member.id],
    );
    generated++;
  }

  // 2. Recurring expenses from previous month
  const prevMonth = mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, '0')}`;
  const recurring = await pool.query(
    `SELECT category_id, description, amount, vendor_name, payment_method, notes
     FROM expenses
     WHERE tenant_id = $1 AND is_recurring = TRUE
       AND expense_date >= $2::date AND expense_date < ($2::date + INTERVAL '1 month')`,
    [tenantId, `${prevMonth}-01`],
  );

  for (const r of recurring.rows as Array<Record<string, unknown>>) {
    const exists = await pool.query(
      `SELECT id FROM expenses WHERE tenant_id = $1 AND description = $2 AND is_recurring = TRUE
       AND expense_date >= $3 AND expense_date < ($3::date + INTERVAL '1 month') LIMIT 1`,
      [tenantId, r.description, firstDay],
    );
    if ((exists.rows as unknown[]).length > 0) continue;

    await pool.query(
      `INSERT INTO expenses (tenant_id, category_id, description, amount, expense_date, is_recurring, vendor_name, payment_method, notes, expense_type)
       VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8, 'recurring')`,
      [tenantId, r.category_id, r.description, r.amount, firstDay, r.vendor_name, r.payment_method, r.notes],
    );
    generated++;
  }

  logger.info(`[finance] Generated ${generated} expenses for ${targetMonth}`);
  return { generated };
}

// ---------------------------------------------------------------------------
// P&L Calculation
// ---------------------------------------------------------------------------
export async function calculatePnL(tenantId: string, month: string): Promise<{
  revenue: number;
  expenses: number;
  profit: number;
  expensesByCategory: Array<{ category: string; color: string; amount: number }>;
  revenueBreakdown: { invoices: number; other: number };
}> {
  const firstDay = `${month}-01`;

  // Revenue from billing
  let invoiceRevenue = 0;
  try {
    const billingR = await pool.query(
      `SELECT COALESCE(SUM(total_amount), 0)::int AS total
       FROM invoices
       WHERE tenant_id = $1 AND status IN ('paid', 'partially_paid')
         AND invoice_date >= $2 AND invoice_date < ($2::date + INTERVAL '1 month')`,
      [tenantId, firstDay],
    );
    // Invoices store amounts in paise (×100), convert to rupees
    invoiceRevenue = Math.round((billingR.rows[0] as { total: number }).total / 100);
  } catch { /* invoices table may not exist */ }

  // Other income
  let otherIncome = 0;
  try {
    const incomeR = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::int AS total
       FROM income_entries
       WHERE tenant_id = $1 AND income_date >= $2 AND income_date < ($2::date + INTERVAL '1 month')`,
      [tenantId, firstDay],
    );
    otherIncome = (incomeR.rows[0] as { total: number }).total;
  } catch { /* table may be empty */ }

  const revenue = invoiceRevenue + otherIncome;

  // Expenses
  const expensesR = await pool.query(
    `SELECT COALESCE(SUM(e.amount), 0)::int AS total
     FROM expenses e
     WHERE e.tenant_id = $1 AND e.expense_date >= $2 AND e.expense_date < ($2::date + INTERVAL '1 month')`,
    [tenantId, firstDay],
  );
  const totalExpenses = (expensesR.rows[0] as { total: number }).total;

  // Expenses by category
  const byCatR = await pool.query(
    `SELECT COALESCE(c.name, 'Uncategorized') AS category, COALESCE(c.color, '#64748b') AS color, SUM(e.amount)::int AS amount
     FROM expenses e
     LEFT JOIN expense_categories c ON c.id = e.category_id
     WHERE e.tenant_id = $1 AND e.expense_date >= $2 AND e.expense_date < ($2::date + INTERVAL '1 month')
     GROUP BY c.name, c.color
     ORDER BY amount DESC`,
    [tenantId, firstDay],
  );

  return {
    revenue,
    expenses: totalExpenses,
    profit: revenue - totalExpenses,
    expensesByCategory: byCatR.rows as Array<{ category: string; color: string; amount: number }>,
    revenueBreakdown: { invoices: invoiceRevenue, other: otherIncome },
  };
}
