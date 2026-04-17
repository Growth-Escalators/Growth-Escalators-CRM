import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import logger from '../utils/logger';

const router = Router();

// Check-in: record start of day
router.post('/check-in', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    // Find team member linked to this user
    const member = await pool.query(
      'SELECT id, name FROM team_payroll WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (member.rows.length === 0) return res.status(404).json({ error: 'No team member record found for your account' });

    const memberId = member.rows[0].id;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' });

    // Upsert attendance for today
    const result = await pool.query(`
      INSERT INTO team_attendance (tenant_id, member_id, attendance_date, check_in, status)
      VALUES ('00000000-0000-0000-0000-000000000001', $1, $2, $3, 'present')
      ON CONFLICT (member_id, attendance_date)
      DO UPDATE SET check_in = COALESCE(team_attendance.check_in, $3), status = 'present', updated_at = NOW()
      RETURNING *
    `, [memberId, today, now]);

    logger.info(`[self-service] ${member.rows[0].name} checked in at ${now}`);
    res.json({ message: 'Checked in successfully', time: now, record: result.rows[0] });
  } catch (e) {
    logger.error('[self-service] check-in error:', e);
    res.status(500).json({ error: 'Check-in failed' });
  }
});

// Check-out: record end of day
router.post('/check-out', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const member = await pool.query(
      'SELECT id, name FROM team_payroll WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (member.rows.length === 0) return res.status(404).json({ error: 'No team member record found' });

    const memberId = member.rows[0].id;
    const today = new Date().toISOString().split('T')[0];
    const now = new Date().toLocaleTimeString('en-IN', { hour12: false, hour: '2-digit', minute: '2-digit' });

    // Update check_out and calculate hours
    const result = await pool.query(`
      UPDATE team_attendance
      SET check_out = $1,
          hours_worked = EXTRACT(EPOCH FROM ($1::time - check_in::time)) / 3600.0,
          updated_at = NOW()
      WHERE member_id = $2 AND attendance_date = $3
      RETURNING *
    `, [now, memberId, today]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'No check-in found for today. Please check in first.' });
    }

    logger.info(`[self-service] ${member.rows[0].name} checked out at ${now}`);
    res.json({ message: 'Checked out successfully', time: now, record: result.rows[0] });
  } catch (e) {
    logger.error('[self-service] check-out error:', e);
    res.status(500).json({ error: 'Check-out failed' });
  }
});

// Get my attendance for a month
router.get('/my-attendance', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const member = await pool.query(
      'SELECT id, name FROM team_payroll WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (member.rows.length === 0) return res.status(404).json({ error: 'No team member record found' });

    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const memberId = member.rows[0].id;

    const records = await pool.query(`
      SELECT attendance_date, check_in, check_out, status, hours_worked, notes
      FROM team_attendance
      WHERE member_id = $1
        AND to_char(attendance_date, 'YYYY-MM') = $2
      ORDER BY attendance_date
    `, [memberId, month]);

    // Summary
    const summary = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'present') AS present,
        COUNT(*) FILTER (WHERE status = 'absent') AS absent,
        COUNT(*) FILTER (WHERE status = 'half_day') AS half_days,
        COUNT(*) FILTER (WHERE status = 'leave') AS leaves,
        COALESCE(SUM(hours_worked), 0) AS total_hours
      FROM team_attendance
      WHERE member_id = $1 AND to_char(attendance_date, 'YYYY-MM') = $2
    `, [memberId, month]);

    res.json({
      member: member.rows[0],
      month,
      records: records.rows,
      summary: summary.rows[0],
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// Get today's status
router.get('/today', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const member = await pool.query(
      'SELECT id, name, role FROM team_payroll WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (member.rows.length === 0) return res.status(404).json({ error: 'No team member record found' });

    const today = new Date().toISOString().split('T')[0];
    const todayRecord = await pool.query(
      'SELECT * FROM team_attendance WHERE member_id = $1 AND attendance_date = $2',
      [member.rows[0].id, today]
    );

    // Leave balances
    const balances = await pool.query(
      'SELECT casual_leave_balance, sick_leave_balance, earned_leave_balance FROM team_payroll WHERE id = $1',
      [member.rows[0].id]
    );

    // This month summary
    const month = new Date().toISOString().slice(0, 7);
    const monthSummary = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'present') AS present,
        COUNT(*) FILTER (WHERE status = 'leave') AS leaves
      FROM team_attendance WHERE member_id = $1 AND to_char(attendance_date, 'YYYY-MM') = $2
    `, [member.rows[0].id, month]);

    res.json({
      member: member.rows[0],
      today: todayRecord.rows[0] || null,
      checkedIn: todayRecord.rows.length > 0 && todayRecord.rows[0].check_in != null,
      checkedOut: todayRecord.rows[0]?.check_out != null,
      leaveBalances: balances.rows[0] || { casual_leave_balance: 12, sick_leave_balance: 6, earned_leave_balance: 15 },
      monthSummary: monthSummary.rows[0],
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch today status' });
  }
});

// Request leave
router.post('/leave-request', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const member = await pool.query(
      'SELECT id, name FROM team_payroll WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (member.rows.length === 0) return res.status(404).json({ error: 'No team member record found' });

    const { leaveType, startDate, endDate, days, reason } = req.body;
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

    const memberId = member.rows[0].id;
    const calcDays = days || (Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1);

    const result = await pool.query(`
      INSERT INTO team_leaves (tenant_id, member_id, leave_type, start_date, end_date, days, reason, status)
      VALUES ('00000000-0000-0000-0000-000000000001', $1, $2, $3, $4, $5, $6, 'pending')
      RETURNING *
    `, [memberId, leaveType || 'casual', startDate, endDate, calcDays, reason]);

    logger.info(`[self-service] ${member.rows[0].name} requested ${calcDays} days ${leaveType || 'casual'} leave`);
    res.json({ message: 'Leave request submitted', leave: result.rows[0] });
  } catch (e) {
    logger.error('[self-service] leave request error:', e);
    res.status(500).json({ error: 'Failed to submit leave request' });
  }
});

// Get my leaves
router.get('/my-leaves', async (req: Request, res: Response) => {
  try {
    const userId = (req as any).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const member = await pool.query(
      'SELECT id FROM team_payroll WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (member.rows.length === 0) return res.status(404).json({ error: 'No team member record found' });

    const leaves = await pool.query(
      'SELECT * FROM team_leaves WHERE member_id = $1 ORDER BY created_at DESC LIMIT 50',
      [member.rows[0].id]
    );
    res.json(leaves.rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch leaves' });
  }
});

export default router;
