import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import logger from '../utils/logger';
import { seedDefaultCategories, generateMonthlyExpenses, calculatePnL } from '../services/financeService';
import { requireRole } from '../middleware/rbac';

const router = Router();

// ---------------------------------------------------------------------------
// Interim role-based gate (2026-08-05 hardening pass) — this file previously
// had zero authorization beyond requireAuth (any logged-in user of any role
// could read/write payroll, salaries, leave, expenses, income, and P&L). The
// full granular-permissions system is a separate, larger effort landing
// later; this is a role-based interim gate using the existing requireRole()
// helper (see src/routes/outbound.ts for the same pattern), erring toward
// restrictive per route:
//   - View-only routes: admin or manager_ops.
//   - Payroll read/write (team-payroll*, generate-monthly): admin only — the
//     most sensitive data in this file (FinancePage.jsx renders base_salary
//     unmasked).
//   - Leave approval (PATCH /leaves/:id): admin or manager_ops, PLUS a
//     same-tenant self-approval check inside the handler.
//   - Leave *request* creation (POST /leaves) stays open to any authenticated
//     user, but the handler resolves memberId server-side from req.user.id
//     rather than trusting the client-supplied id (mirrors
//     src/routes/selfService.ts).
const requireFinanceView = requireRole('admin', 'manager_ops');
const requirePayrollAdmin = requireRole('admin');
const requireAttendanceAdmin = requireRole('admin', 'manager_ops');

// ---------------------------------------------------------------------------
// GET /api/finance/dashboard?month=2026-04
// ---------------------------------------------------------------------------
router.get('/dashboard', requireFinanceView, async (req: Request, res: Response) => {
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
router.get('/expenses', requireFinanceView, async (req: Request, res: Response) => {
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
router.post('/expenses', requireFinanceView, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { categoryId, description, amount, expenseDate, isRecurring, vendorName, paymentMethod, notes, teamMemberId, expenseType } = req.body;

  if (!description || !amount || Number(amount) <= 0) {
    res.status(400).json({ error: 'description and a positive amount required' });
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
router.patch('/expenses/:id', requireFinanceView, async (req: Request, res: Response) => {
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
router.delete('/expenses/:id', requireFinanceView, async (req: Request, res: Response) => {
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
router.get('/categories', requireFinanceView, async (req: Request, res: Response) => {
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
router.post('/categories', requireFinanceView, async (req: Request, res: Response) => {
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
router.delete('/categories/:id', requireFinanceView, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    await pool.query(`UPDATE expense_categories SET is_active = FALSE WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/team-payroll — payroll data (base_salary etc.), admin only
// ---------------------------------------------------------------------------
router.get('/team-payroll', requirePayrollAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const result = await pool.query(
      `SELECT * FROM team_payroll WHERE tenant_id = $1 AND is_active = TRUE ORDER BY COALESCE(sort_order, 0), name`,
      [tenantId],
    );
    res.json({ team: result.rows });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/finance/team-payroll — admin only (creates/updates salary rows)
// ---------------------------------------------------------------------------
router.post('/team-payroll', requirePayrollAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const {
    id, name, role, baseSalary,
    expectedStartTime, casualLeaveBalance, sickLeaveBalance, earnedLeaveBalance,
  } = req.body;
  if (!name) { res.status(400).json({ error: 'name required' }); return; }

  // Normalise expectedStartTime to HH:MM:SS. Accept '09:30', '09:30:00', or null.
  const start = expectedStartTime
    ? (String(expectedStartTime).length === 5 ? `${expectedStartTime}:00` : String(expectedStartTime))
    : null;

  // Leave balances: clamp to >= 0 and coerce to int; null means "don't change".
  const clamp = (v: unknown) => v == null || v === '' ? null : Math.max(0, Math.round(Number(v)));
  const casual = clamp(casualLeaveBalance);
  const sick   = clamp(sickLeaveBalance);
  const earned = clamp(earnedLeaveBalance);

  try {
    if (id) {
      await pool.query(
        `UPDATE team_payroll SET
           name = $3,
           role = $4,
           base_salary = $5,
           expected_start_time = COALESCE($6::time, expected_start_time),
           casual_leave_balance = COALESCE($7, casual_leave_balance),
           sick_leave_balance   = COALESCE($8, sick_leave_balance),
           earned_leave_balance = COALESCE($9, earned_leave_balance)
         WHERE id = $1 AND tenant_id = $2`,
        [id, tenantId, name, role || null, Math.round(baseSalary || 0), start, casual, sick, earned],
      );
      res.json({ success: true });
    } else {
      const result = await pool.query(
        `INSERT INTO team_payroll (
           tenant_id, name, role, base_salary,
           expected_start_time, casual_leave_balance, sick_leave_balance, earned_leave_balance
         ) VALUES (
           $1, $2, $3, $4,
           COALESCE($5::time, '09:30:00'::time),
           COALESCE($6, 12),
           COALESCE($7, 6),
           COALESCE($8, 15)
         ) RETURNING *`,
        [tenantId, name, role || null, Math.round(baseSalary || 0), start, casual, sick, earned],
      );
      res.json({ member: result.rows[0] });
    }
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/finance/generate-monthly — admin only
// ---------------------------------------------------------------------------
router.post('/generate-monthly', requirePayrollAdmin, async (req: Request, res: Response) => {
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
router.get('/income', requireFinanceView, async (req: Request, res: Response) => {
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
        `SELECT i.id, bc.name AS source, i.invoice_number AS description, ROUND(i.total_amount / 100.0)::int AS amount, i.invoice_date AS income_date, 'invoice' AS category
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
router.post('/income', requireFinanceView, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { source, description, amount, incomeDate, category, notes } = req.body;
  if (!source || !amount || Number(amount) <= 0) { res.status(400).json({ error: 'source and a positive amount required' }); return; }

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
// PATCH /api/finance/income/:id
// ---------------------------------------------------------------------------
router.patch('/income/:id', requireFinanceView, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const { source, description, amount, incomeDate, category, notes } = req.body;
  try {
    await pool.query(
      `UPDATE income_entries SET
        source = COALESCE($3, source), description = COALESCE($4, description),
        amount = COALESCE($5, amount), income_date = COALESCE($6, income_date),
        category = COALESCE($7, category), notes = COALESCE($8, notes)
       WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId, source, description, amount ? Math.round(amount) : null, incomeDate, category, notes],
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/finance/income/:id
// ---------------------------------------------------------------------------
router.delete('/income/:id', requireFinanceView, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    await pool.query(`DELETE FROM income_entries WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/finance/team-payroll/:id — soft-delete team member (admin only)
// ---------------------------------------------------------------------------
router.delete('/team-payroll/:id', requirePayrollAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    await pool.query(`UPDATE team_payroll SET is_active = FALSE WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/attendance?month=2026-04
// ---------------------------------------------------------------------------
router.get('/attendance', requireFinanceView, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const firstDay = `${month}-01`;

  try {
    // Get team members
    const teamR = await pool.query(
      `SELECT id, name, role FROM team_payroll WHERE tenant_id = $1 AND is_active = TRUE ORDER BY COALESCE(sort_order, 0), name`,
      [tenantId],
    );

    // Get attendance records for the month
    const attendanceR = await pool.query(
      `SELECT a.*, t.name AS member_name
       FROM team_attendance a
       JOIN team_payroll t ON t.id = a.member_id
       WHERE a.tenant_id = $1
         AND a.attendance_date >= $2 AND a.attendance_date < ($2::date + INTERVAL '1 month')
       ORDER BY a.attendance_date DESC, t.name`,
      [tenantId, firstDay],
    );

    // Summary per member
    const summaryR = await pool.query(
      `SELECT a.member_id, t.name AS member_name,
         COUNT(*) FILTER (WHERE a.status = 'present') AS present,
         COUNT(*) FILTER (WHERE a.status = 'absent') AS absent,
         COUNT(*) FILTER (WHERE a.status = 'half_day') AS half_days,
         COUNT(*) FILTER (WHERE a.status = 'leave') AS leaves,
         COALESCE(SUM(a.hours_worked), 0) AS total_hours
       FROM team_attendance a
       JOIN team_payroll t ON t.id = a.member_id
       WHERE a.tenant_id = $1
         AND a.attendance_date >= $2 AND a.attendance_date < ($2::date + INTERVAL '1 month')
       GROUP BY a.member_id, t.name
       ORDER BY t.name`,
      [tenantId, firstDay],
    );

    res.json({
      team: teamR.rows,
      attendance: attendanceR.rows,
      summary: summaryR.rows,
      month,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/finance/attendance — mark attendance (single or bulk); marking
// attendance on someone else's behalf is an admin-tier action.
// ---------------------------------------------------------------------------
router.post('/attendance', requireAttendanceAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const adminUserId = req.user!.id;
  const { memberId, memberIds, date, status, checkIn, checkOut, notes, overrideReason } = req.body as {
    memberId?: string; memberIds?: string[]; date?: string; status?: string;
    checkIn?: string; checkOut?: string; notes?: string; overrideReason?: string;
  };

  const targetDate = date || new Date().toISOString().split('T')[0];
  const ids = memberIds || (memberId ? [memberId] : []);

  if (ids.length === 0) { res.status(400).json({ error: 'memberId or memberIds required' }); return; }

  try {
    let marked = 0;
    for (const id of ids) {
      // Calculate hours if check-in and check-out provided
      let hours: number | null = null;
      if (checkIn && checkOut) {
        const [h1, m1] = checkIn.split(':').map(Number);
        const [h2, m2] = checkOut.split(':').map(Number);
        hours = Math.round(((h2 * 60 + m2) - (h1 * 60 + m1)) / 60 * 100) / 100;
      }

      // Admin overrides record who did it + (optionally) why, so the audit
      // trail makes manual edits visible in the user's My Attendance view.
      await pool.query(
        `INSERT INTO team_attendance (
           tenant_id, member_id, attendance_date, status, check_in, check_out,
           hours_worked, notes, admin_overridden_by, admin_override_reason, admin_overridden_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
         ON CONFLICT (member_id, attendance_date) DO UPDATE SET
           status = EXCLUDED.status,
           check_in = EXCLUDED.check_in,
           check_out = EXCLUDED.check_out,
           hours_worked = EXCLUDED.hours_worked,
           notes = EXCLUDED.notes,
           admin_overridden_by = EXCLUDED.admin_overridden_by,
           admin_override_reason = EXCLUDED.admin_override_reason,
           admin_overridden_at = NOW()`,
        [tenantId, id, targetDate, status || 'present', checkIn || null, checkOut || null,
         hours, notes || null, adminUserId, overrideReason || null],
      );
      marked++;
    }

    res.json({ marked, date: targetDate });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/attendance/calendar — calendar grid view
// ---------------------------------------------------------------------------
router.get('/attendance/calendar', requireFinanceView, async (req: Request, res: Response) => {
  try {
    const tenantId = req.user!.tenantId;
    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);

    // All active members — was previously unscoped (no tenant_id filter at
    // all on any of these three queries), leaking every tenant's payroll
    // roster, attendance, and leave balances to any logged-in user of any
    // tenant. All three now filter by the caller's own tenant_id.
    const members = await pool.query(
      "SELECT id, name, role FROM team_payroll WHERE is_active = true AND tenant_id = $1 ORDER BY sort_order, name",
      [tenantId],
    );

    // All attendance records for the month
    const attendance = await pool.query(`
      SELECT member_id, attendance_date, status, check_in, check_out, hours_worked
      FROM team_attendance
      WHERE to_char(attendance_date, 'YYYY-MM') = $1 AND tenant_id = $2
      ORDER BY attendance_date
    `, [month, tenantId]);

    // Build grid: { memberId: { 'YYYY-MM-DD': status } }
    const grid: Record<string, Record<string, any>> = {};
    for (const m of members.rows) {
      grid[m.id] = {};
    }
    for (const a of attendance.rows) {
      if (grid[a.member_id]) {
        grid[a.member_id][a.attendance_date.toISOString().split('T')[0]] = {
          status: a.status,
          checkIn: a.check_in,
          checkOut: a.check_out,
          hours: a.hours_worked,
        };
      }
    }

    // Leave balances
    const balances = await pool.query(
      'SELECT id, casual_leave_balance, sick_leave_balance, earned_leave_balance FROM team_payroll WHERE is_active = true AND tenant_id = $1',
      [tenantId],
    );
    const balanceMap: Record<string, any> = {};
    for (const b of balances.rows) {
      balanceMap[b.id] = b;
    }

    res.json({
      month,
      members: members.rows,
      grid,
      balances: balanceMap,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch attendance calendar' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/leaves/pending-count
// Lightweight count of pending leave requests for the tenant. Drives the
// Sidebar badge and Dashboard banner so admins notice approvals without
// having to drill into Finance → Attendance → scroll-to-bottom.
// ---------------------------------------------------------------------------
router.get('/leaves/pending-count', requireFinanceView, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const r = await pool.query(
      `SELECT COUNT(*)::int AS count FROM team_leaves WHERE tenant_id = $1 AND status = 'pending'`,
      [tenantId],
    );
    res.json({ count: (r.rows[0] as { count: number } | undefined)?.count ?? 0 });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/leaves?month=2026-04
// ---------------------------------------------------------------------------
router.get('/leaves', requireFinanceView, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const firstDay = `${month}-01`;

  try {
    const result = await pool.query(
      `SELECT l.*, t.name AS member_name
       FROM team_leaves l
       JOIN team_payroll t ON t.id = l.member_id
       WHERE l.tenant_id = $1
         AND l.start_date >= $2 AND l.start_date < ($2::date + INTERVAL '1 month')
       ORDER BY l.start_date DESC`,
      [tenantId, firstDay],
    );
    res.json({ leaves: result.rows, month });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// POST /api/finance/leaves — request leave
// Open to any authenticated user, but memberId is never trusted from the
// request body — it's resolved server-side from req.user.id via the
// caller's own team_payroll row, mirroring the self-service pattern in
// src/routes/selfService.ts (POST /leave-request). Previously any
// authenticated user could pass an arbitrary memberId and file a leave
// request (and consume leave balance) against someone else's record.
// ---------------------------------------------------------------------------
router.post('/leaves', async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const userId = req.user!.id;
  const { leaveType, startDate, endDate, days, reason } = req.body;

  if (!startDate || !endDate) {
    res.status(400).json({ error: 'startDate, endDate required' });
    return;
  }

  try {
    const member = await pool.query(
      'SELECT id FROM team_payroll WHERE user_id = $1 AND tenant_id = $2 AND is_active = true',
      [userId, tenantId],
    );
    if (member.rows.length === 0) {
      res.status(404).json({ error: 'No team member record found for your account' });
      return;
    }
    const memberId = (member.rows[0] as { id: string }).id;

    const calcDays = days || Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1;

    const result = await pool.query(
      `INSERT INTO team_leaves (tenant_id, member_id, leave_type, start_date, end_date, days, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [tenantId, memberId, leaveType || 'casual', startDate, endDate, calcDays, reason || null],
    );

    // Auto-mark attendance as 'leave' for those dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = d.toISOString().split('T')[0];
      await pool.query(
        `INSERT INTO team_attendance (tenant_id, member_id, attendance_date, status, notes)
         VALUES ($1, $2, $3, 'leave', $4)
         ON CONFLICT (member_id, attendance_date) DO UPDATE SET status = 'leave', notes = EXCLUDED.notes`,
        [tenantId, memberId, dateStr, `Leave: ${leaveType || 'casual'}`],
      );
    }

    res.json({ leave: result.rows[0] });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// PATCH /api/finance/leaves/:id — approve/reject leave
// Gated to admin/manager_ops, PLUS an explicit same-tenant self-approval
// check: the approver can never be the same user who filed the leave
// request. Previously this route had no role gate at all AND no
// self-approval check, so any authenticated user could approve their own
// leave request.
// ---------------------------------------------------------------------------
router.patch('/leaves/:id', requireAttendanceAdmin, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const approverUserId = req.user!.id;
  const { status } = req.body;

  if (!['approved', 'rejected'].includes(status)) {
    res.status(400).json({ error: 'status must be approved or rejected' });
    return;
  }

  try {
    const id = req.params.id;

    // Fetch the leave request + the requesting member's own user_id so we
    // can reject a self-approval attempt before writing anything.
    const existing = await pool.query(
      `SELECT l.id, t.user_id AS requester_user_id
       FROM team_leaves l
       JOIN team_payroll t ON t.id = l.member_id
       WHERE l.id = $1 AND l.tenant_id = $2`,
      [id, tenantId],
    );
    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'leave request not found' });
      return;
    }
    const requesterUserId = (existing.rows[0] as { requester_user_id: string | null }).requester_user_id;
    if (requesterUserId && requesterUserId === approverUserId) {
      res.status(400).json({ error: 'cannot approve your own leave request' });
      return;
    }

    await pool.query(
      `UPDATE team_leaves SET status = $3, approved_by = $4
       WHERE id = $1 AND tenant_id = $2`,
      [id, tenantId, status, approverUserId],
    );

    // Deduct leave balance when approved
    if (status === 'approved') {
      try {
        const leaveRecord = await pool.query('SELECT member_id, leave_type, days FROM team_leaves WHERE id = $1', [id]);
        if (leaveRecord.rows.length > 0) {
          const { deductLeaveBalance } = await import('../services/financeService');
          await deductLeaveBalance(
            leaveRecord.rows[0].member_id,
            leaveRecord.rows[0].leave_type,
            leaveRecord.rows[0].days,
          );
        }
      } catch { /* non-critical */ }
    }

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/vendors — autocomplete vendor names
// ---------------------------------------------------------------------------
router.get('/vendors', requireFinanceView, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  try {
    const result = await pool.query(
      `SELECT DISTINCT vendor_name FROM expenses WHERE tenant_id = $1 AND vendor_name IS NOT NULL AND vendor_name != '' ORDER BY vendor_name`,
      [tenantId],
    );
    res.json({ vendors: result.rows.map((r: { vendor_name: string }) => r.vendor_name) });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/expenses/export-csv?month=2026-04
// ---------------------------------------------------------------------------
router.get('/expenses/export-csv', requireFinanceView, async (req: Request, res: Response) => {
  const tenantId = req.user!.tenantId;
  const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
  const firstDay = `${month}-01`;

  try {
    const result = await pool.query(
      `SELECT e.expense_date, e.description, c.name AS category, e.amount, e.vendor_name, e.payment_method, e.notes, e.expense_type, e.is_recurring, t.name AS team_member
       FROM expenses e
       LEFT JOIN expense_categories c ON c.id = e.category_id
       LEFT JOIN team_payroll t ON t.id = e.team_member_id
       WHERE e.tenant_id = $1 AND e.expense_date >= $2 AND e.expense_date < ($2::date + INTERVAL '1 month')
       ORDER BY e.expense_date DESC`,
      [tenantId, firstDay],
    );

    const headers = ['Date', 'Description', 'Category', 'Amount (INR)', 'Vendor', 'Payment Method', 'Notes', 'Type', 'Recurring', 'Team Member'];
    const rows = (result.rows as Array<Record<string, unknown>>).map(r => [
      r.expense_date instanceof Date ? r.expense_date.toISOString().split('T')[0] : String(r.expense_date).split('T')[0],
      `"${String(r.description || '').replace(/"/g, '""')}"`,
      r.category || 'Uncategorized',
      r.amount,
      `"${String(r.vendor_name || '').replace(/"/g, '""')}"`,
      r.payment_method || '',
      `"${String(r.notes || '').replace(/"/g, '""')}"`,
      r.expense_type || 'one-time',
      r.is_recurring ? 'Yes' : 'No',
      r.team_member || '',
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="expenses-${month}.csv"`);
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : String(e) });
  }
});

// ---------------------------------------------------------------------------
// GET /api/finance/pnl?months=6
// ---------------------------------------------------------------------------
router.get('/pnl', requireFinanceView, async (req: Request, res: Response) => {
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
