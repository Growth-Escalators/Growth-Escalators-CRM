import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import logger from '../utils/logger';
import { seedDefaultCategories, generateMonthlyExpenses, calculatePnL } from '../services/financeService';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/finance/dashboard?month=2026-04
// ---------------------------------------------------------------------------
router.get('/dashboard', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);

  try {
    await seedDefaultCategories(tenantId);
    const pnl = await calculatePnL(tenantId, month);

    // Month-over-month comparison
    const [year, mon] = month.split('-').map(Number);
    const prevMonth = mon === 1 ? `${year - 1}-12` : `${year}-${String(mon - 1).padStart(2, '0')}`;
    const prevPnl = await calculatePnL(tenantId, prevMonth);

    res.json({
      month,
      ...pnl,
      prevMonth: { month: prevMonth, revenue: prevPnl.revenue, expenses: prevPnl.expenses, profit: prevPnl.profit },
    });
  } catch (e) {
    logger.error('[finance] dashboard error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/expenses?month=2026-04
// ---------------------------------------------------------------------------
router.get('/expenses', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const categoryId = req.query.categoryId as string | undefined;
  const firstDay = `${month}-01`;

  try {
    let query = `
      SELECT e.*, c.name AS category_name, c.color AS category_color, t.name AS team_member_name
      FROM expenses e
      LEFT JOIN expense_categories c ON c.id = e.category_id
      LEFT JOIN team_payroll t ON t.id = e.team_member_id
      WHERE e.tenant_id = $1
        AND e.expense_date >= $2 AND e.expense_date < ($2::date + INTERVAL '1 month')
    `;
    const params: unknown[] = [tenantId, firstDay];

    if (categoryId) {
      query += ` AND e.category_id = $3`;
      params.push(Number(categoryId));
    }

    query += ` ORDER BY e.expense_date DESC, e.created_at DESC`;

    const result = await pool.query(query, params);
    const totalR = await pool.query(
      `SELECT COALESCE(SUM(amount), 0)::int AS total FROM expenses WHERE tenant_id = $1 AND expense_date >= $2 AND expense_date < ($2::date + INTERVAL '1 month')`,
      [tenantId, firstDay],
    );

    res.json({ expenses: result.rows, total: (totalR.rows[0] as { total: number }).total, month });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/finance/expenses
// ---------------------------------------------------------------------------
router.post('/expenses', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { categoryId, description, amount, expenseDate, isRecurring, vendorName, paymentMethod, notes, teamMemberId, expenseType } = req.body;

  if (!description || !amount) {
    res.status(400).json({ error: 'description and amount required' });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO expenses (tenant_id, category_id, description, amount, expense_date, is_recurring, vendor_name, payment_method, notes, team_member_id, expense_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [tenantId, categoryId || null, description, Math.round(amount), expenseDate || new Date().toISOString().split('T')[0], isRecurring || false, vendorName || null, paymentMethod || null, notes || null, teamMemberId || null, expenseType || 'one-time'],
    );
    res.json({ expense: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/finance/expenses/:id
// ---------------------------------------------------------------------------
router.patch('/expenses/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const id = req.params.id;
  const { categoryId, description, amount, expenseDate, isRecurring, vendorName, paymentMethod, notes, expenseType } = req.body;

  try {
    await pool.query(
      `UPDATE expenses SET
        category_id = COALESCE($3, category_id),
        description = COALESCE($4, description),
        amount = COALESCE($5, amount),
        expense_date = COALESCE($6, expense_date),
        is_recurring = COALESCE($7, is_recurring),
        vendor_name = COALESCE($8, vendor_name),
        payment_method = COALESCE($9, payment_method),
        notes = COALESCE($10, notes),
        expense_type = COALESCE($11, expense_type)
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId, categoryId, description, amount ? Math.round(amount) : null, expenseDate, isRecurring, vendorName, paymentMethod, notes, expenseType],
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/finance/expenses/:id
// ---------------------------------------------------------------------------
router.delete('/expenses/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    await pool.query(`DELETE FROM expenses WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/categories
// ---------------------------------------------------------------------------
router.get('/categories', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    await seedDefaultCategories(tenantId);
    const result = await pool.query(
      `SELECT * FROM expense_categories WHERE tenant_id = $1 AND is_active = TRUE ORDER BY sort_order`,
      [tenantId],
    );
    res.json({ categories: result.rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/finance/categories
// ---------------------------------------------------------------------------
router.post('/categories', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { name, color, icon } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }

  try {
    const result = await pool.query(
      `INSERT INTO expense_categories (tenant_id, name, color, icon) VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, name) DO UPDATE SET color = EXCLUDED.color, icon = EXCLUDED.icon, is_active = TRUE
       RETURNING *`,
      [tenantId, name, color || '#64748b', icon || 'receipt'],
    );
    res.json({ category: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/finance/categories/:id
// ---------------------------------------------------------------------------
router.delete('/categories/:id', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    await pool.query(`UPDATE expense_categories SET is_active = FALSE WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/team-payroll
// ---------------------------------------------------------------------------
router.get('/team-payroll', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const result = await pool.query(
      `SELECT * FROM team_payroll WHERE tenant_id = $1 ORDER BY sort_order, name`,
      [tenantId],
    );
    res.json({ team: result.rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/finance/team-payroll
// ---------------------------------------------------------------------------
router.post('/team-payroll', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { id, name, role, baseSalary } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }

  try {
    if (id) {
      await pool.query(
        `UPDATE team_payroll SET name = $3, role = $4, base_salary = $5 WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId, name, role || null, Math.round(baseSalary || 0)],
      );
      res.json({ success: true });
    } else {
      const result = await pool.query(
        `INSERT INTO team_payroll (tenant_id, name, role, base_salary) VALUES ($1, $2, $3, $4) RETURNING *`,
        [tenantId, name, role || null, Math.round(baseSalary || 0)],
      );
      res.json({ member: result.rows[0] });
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/finance/generate-monthly
// ---------------------------------------------------------------------------
router.post('/generate-monthly', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const month = req.body.month as string | undefined;

  try {
    const result = await generateMonthlyExpenses(tenantId, month);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/income?month=2026-04
// ---------------------------------------------------------------------------
router.get('/income', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const firstDay = `${month}-01`;

  try {
    // Manual income entries
    const manual = await pool.query(
      `SELECT * FROM income_entries WHERE tenant_id = $1 AND income_date >= $2 AND income_date < ($2::date + INTERVAL '1 month') ORDER BY income_date DESC`,
      [tenantId, firstDay],
    );

    // Invoice-based income
    let invoices: unknown[] = [];
    try {
      const invR = await pool.query(
        `SELECT i.id, bc.name AS source, i.invoice_number AS description, i.total_amount AS amount, i.invoice_date AS income_date, 'invoice' AS category
         FROM invoices i
         LEFT JOIN billing_clients bc ON bc.id = i.client_id
         WHERE i.tenant_id = $1 AND i.status IN ('paid', 'partially_paid')
           AND i.invoice_date >= $2 AND i.invoice_date < ($2::date + INTERVAL '1 month')
         ORDER BY i.invoice_date DESC`,
        [tenantId, firstDay],
      );
      invoices = invR.rows;
    } catch { /* billing tables may not exist */ }

    res.json({ income: [...invoices, ...manual.rows], month });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/finance/income
// ---------------------------------------------------------------------------
router.post('/income', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { source, description, amount, incomeDate, category, notes } = req.body;
  if (!source || !amount) { res.status(400).json({ error: 'source and amount required' }); return; }

  try {
    const result = await pool.query(
      `INSERT INTO income_entries (tenant_id, source, description, amount, income_date, category, notes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tenantId, source, description || null, Math.round(amount), incomeDate || new Date().toISOString().split('T')[0], category || 'other', notes || null],
    );
    res.json({ income: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/pnl?months=6
// ---------------------------------------------------------------------------
router.get('/pnl', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const monthsBack = Number(req.query.months || 6);

  try {
    const results = [];
    const now = new Date();
    for (let i = 0; i < monthsBack; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const pnl = await calculatePnL(tenantId, month);
      results.push({ month, ...pnl });
    }
    res.json({ pnl: results.reverse() });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

export default router;
