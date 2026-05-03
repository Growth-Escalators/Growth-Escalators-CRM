import { Router, type Request, type Response } from 'express';
import { pool } from '../db/index';
import logger from '../utils/logger';

const router = Router();

const DEFAULT_TENANT_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_EXPECTED_START = '09:30:00';

// Server-clock IST helpers (Railway runs UTC; convert at request time)
function istNow(): Date {
  // IST is UTC+5:30
  const now = new Date();
  return new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
}
function istHHMM(): string {
  const ist = istNow();
  const hh = String(ist.getUTCHours()).padStart(2, '0');
  const mm = String(ist.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}
function istDateYYYYMMDD(): string {
  return istNow().toISOString().split('T')[0];
}

function clientIp(req: Request): string {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string') return xff.split(',')[0].trim();
  return req.ip || req.socket.remoteAddress || 'unknown';
}
function userAgent(req: Request): string {
  return (req.headers['user-agent'] as string | undefined)?.slice(0, 500) || 'unknown';
}

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  return (eh * 60 + em) - (sh * 60 + sm);
}

// ---------------------------------------------------------------------------
// POST /api/self-service/check-in
// Anti-misuse: time-window guard (06:00-22:00 IST), IP + user-agent logged,
// is_late computed against team_payroll.expected_start_time (default 09:30).
// First check-in wins (COALESCE) so spam-clicking can't move the time backward.
// ---------------------------------------------------------------------------
router.post('/check-in', async (req: Request, res: Response) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const member = await pool.query(
      'SELECT id, name, expected_start_time FROM team_payroll WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (member.rows.length === 0) {
      return res.status(404).json({ error: 'No team member record found for your account' });
    }

    // Time-window guard — reject obviously off-hours check-ins. The intent is
    // to catch abuse (3 AM check-in to game expected start time), not edge
    // cases like genuine night-shift work. If anyone needs out-of-window
    // attendance, an admin can mark it via /api/finance/attendance.
    const ist = istNow();
    const istHour = ist.getUTCHours();
    if (istHour < 6 || istHour >= 22) {
      return res.status(400).json({
        error: 'Check-in window is 06:00–22:00 IST. Ask an admin to record off-hours attendance.',
      });
    }

    const memberRow = member.rows[0] as { id: string; name: string; expected_start_time: string | null };
    const memberId = memberRow.id;
    const today = istDateYYYYMMDD();
    const now = istHHMM();
    const ip = clientIp(req);
    const ua = userAgent(req);

    // Late detection — compare check-in clock-time to expected start
    const expected = memberRow.expected_start_time
      ? memberRow.expected_start_time.slice(0, 5)
      : DEFAULT_EXPECTED_START.slice(0, 5);
    const lateMinutes = minutesBetween(expected, now);
    const isLate = lateMinutes > 0;

    const result = await pool.query(`
      INSERT INTO team_attendance (
        tenant_id, member_id, attendance_date, check_in, status,
        check_in_ip, check_in_user_agent, is_late, late_minutes
      )
      VALUES ($1, $2, $3, $4, 'present', $5, $6, $7, $8)
      ON CONFLICT (member_id, attendance_date)
      DO UPDATE SET
        check_in = COALESCE(team_attendance.check_in, $4),
        status = 'present',
        check_in_ip = COALESCE(team_attendance.check_in_ip, $5),
        check_in_user_agent = COALESCE(team_attendance.check_in_user_agent, $6),
        is_late = COALESCE(team_attendance.is_late, $7),
        late_minutes = COALESCE(team_attendance.late_minutes, $8),
        updated_at = NOW()
      RETURNING *
    `, [DEFAULT_TENANT_ID, memberId, today, now, ip, ua, isLate, isLate ? lateMinutes : null]);

    const row = result.rows[0] as { check_in: string; is_late: boolean; late_minutes: number | null };
    logger.info(
      `[self-service] ${memberRow.name} checked in at ${row.check_in}` +
      (row.is_late ? ` (late by ${row.late_minutes ?? 0} min)` : ''),
    );

    res.json({
      message: 'Checked in successfully',
      time: row.check_in,
      isLate: row.is_late,
      lateMinutes: row.late_minutes,
      expectedStart: expected,
      record: result.rows[0],
    });
  } catch (e) {
    logger.error('[self-service] check-in error:', e);
    res.status(500).json({ error: 'Check-in failed' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/self-service/check-out
// Records end of day + IP/UA. hours_worked computed from check_in.
// Returns { signOut: true } so the front-end can clear the session and
// redirect to /login (per user's "log them out from the CRM" requirement).
// ---------------------------------------------------------------------------
router.post('/check-out', async (req: Request, res: Response) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const member = await pool.query(
      'SELECT id, name FROM team_payroll WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (member.rows.length === 0) return res.status(404).json({ error: 'No team member record found' });

    const memberRow = member.rows[0] as { id: string; name: string };
    const memberId = memberRow.id;
    const today = istDateYYYYMMDD();
    const now = istHHMM();
    const ip = clientIp(req);
    const ua = userAgent(req);

    const result = await pool.query(`
      UPDATE team_attendance
      SET check_out = $1,
          check_out_ip = $2,
          check_out_user_agent = $3,
          hours_worked = EXTRACT(EPOCH FROM ($1::time - check_in::time)) / 3600.0,
          updated_at = NOW()
      WHERE member_id = $4 AND attendance_date = $5
      RETURNING *
    `, [now, ip, ua, memberId, today]);

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'No check-in found for today. Please check in first.' });
    }

    logger.info(`[self-service] ${memberRow.name} checked out at ${now}`);
    res.json({
      message: 'Checked out successfully',
      time: now,
      record: result.rows[0],
      signOut: true,
    });
  } catch (e) {
    logger.error('[self-service] check-out error:', e);
    res.status(500).json({ error: 'Check-out failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/self-service/my-attendance?month=YYYY-MM
// ---------------------------------------------------------------------------
router.get('/my-attendance', async (req: Request, res: Response) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const member = await pool.query(
      'SELECT id, name FROM team_payroll WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (member.rows.length === 0) return res.status(404).json({ error: 'No team member record found' });

    const month = (req.query.month as string) || new Date().toISOString().slice(0, 7);
    const memberRow = member.rows[0] as { id: string; name: string };
    const memberId = memberRow.id;

    const records = await pool.query(`
      SELECT attendance_date, check_in, check_out, status, hours_worked,
             is_late, late_minutes, admin_overridden_by, admin_override_reason, notes
      FROM team_attendance
      WHERE member_id = $1
        AND to_char(attendance_date, 'YYYY-MM') = $2
      ORDER BY attendance_date DESC
    `, [memberId, month]);

    const summary = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'present') AS present,
        COUNT(*) FILTER (WHERE status = 'absent') AS absent,
        COUNT(*) FILTER (WHERE status = 'half_day') AS half_days,
        COUNT(*) FILTER (WHERE status = 'leave') AS leaves,
        COUNT(*) FILTER (WHERE is_late = true) AS late_days,
        COALESCE(SUM(hours_worked), 0) AS total_hours
      FROM team_attendance
      WHERE member_id = $1 AND to_char(attendance_date, 'YYYY-MM') = $2
    `, [memberId, month]);

    res.json({
      member: memberRow,
      month,
      records: records.rows,
      summary: summary.rows[0],
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch attendance' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/self-service/today
// Front-end calls this on page load to know whether to show Check In or
// Check Out button + show late banner if applicable.
// ---------------------------------------------------------------------------
router.get('/today', async (req: Request, res: Response) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const member = await pool.query(
      'SELECT id, name, role, expected_start_time FROM team_payroll WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (member.rows.length === 0) return res.status(404).json({ error: 'No team member record found' });

    const memberRow = member.rows[0] as {
      id: string; name: string; role: string; expected_start_time: string | null;
    };
    const today = istDateYYYYMMDD();
    const todayRecord = await pool.query(
      'SELECT * FROM team_attendance WHERE member_id = $1 AND attendance_date = $2',
      [memberRow.id, today]
    );

    const balances = await pool.query(
      'SELECT casual_leave_balance, sick_leave_balance, earned_leave_balance FROM team_payroll WHERE id = $1',
      [memberRow.id]
    );

    const month = today.slice(0, 7);
    const monthSummary = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'present') AS present,
        COUNT(*) FILTER (WHERE status = 'leave') AS leaves,
        COUNT(*) FILTER (WHERE is_late = true) AS late_days
      FROM team_attendance WHERE member_id = $1 AND to_char(attendance_date, 'YYYY-MM') = $2
    `, [memberRow.id, month]);

    res.json({
      member: {
        id: memberRow.id,
        name: memberRow.name,
        role: memberRow.role,
        expectedStart: memberRow.expected_start_time
          ? memberRow.expected_start_time.slice(0, 5)
          : DEFAULT_EXPECTED_START.slice(0, 5),
      },
      today: todayRecord.rows[0] || null,
      checkedIn: todayRecord.rows.length > 0 && todayRecord.rows[0].check_in != null,
      checkedOut: todayRecord.rows[0]?.check_out != null,
      isLate: todayRecord.rows[0]?.is_late === true,
      lateMinutes: todayRecord.rows[0]?.late_minutes ?? null,
      leaveBalances: balances.rows[0] || {
        casual_leave_balance: 12, sick_leave_balance: 6, earned_leave_balance: 15,
      },
      monthSummary: monthSummary.rows[0],
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch today status' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/self-service/leave-request
// ---------------------------------------------------------------------------
router.post('/leave-request', async (req: Request, res: Response) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const member = await pool.query(
      'SELECT id, name FROM team_payroll WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (member.rows.length === 0) return res.status(404).json({ error: 'No team member record found' });

    const { leaveType, startDate, endDate, days, reason } = req.body as {
      leaveType?: string; startDate?: string; endDate?: string; days?: number; reason?: string;
    };
    if (!startDate || !endDate) return res.status(400).json({ error: 'startDate and endDate are required' });

    const memberRow = member.rows[0] as { id: string; name: string };
    const memberId = memberRow.id;
    const calcDays = days || (Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24)) + 1);

    const result = await pool.query(`
      INSERT INTO team_leaves (tenant_id, member_id, leave_type, start_date, end_date, days, reason, status)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING *
    `, [DEFAULT_TENANT_ID, memberId, leaveType || 'casual', startDate, endDate, calcDays, reason]);

    logger.info(`[self-service] ${memberRow.name} requested ${calcDays} days ${leaveType || 'casual'} leave`);
    res.json({ message: 'Leave request submitted', leave: result.rows[0] });
  } catch (e) {
    logger.error('[self-service] leave request error:', e);
    res.status(500).json({ error: 'Failed to submit leave request' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/self-service/my-leaves
// ---------------------------------------------------------------------------
router.get('/my-leaves', async (req: Request, res: Response) => {
  try {
    const userId = (req as unknown as { userId: string }).userId;
    if (!userId) return res.status(401).json({ error: 'Not authenticated' });

    const member = await pool.query(
      'SELECT id FROM team_payroll WHERE user_id = $1 AND is_active = true',
      [userId]
    );
    if (member.rows.length === 0) return res.status(404).json({ error: 'No team member record found' });

    const memberId = (member.rows[0] as { id: string }).id;
    const leaves = await pool.query(
      'SELECT * FROM team_leaves WHERE member_id = $1 ORDER BY created_at DESC LIMIT 50',
      [memberId]
    );
    res.json(leaves.rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch leaves' });
  }
});

export default router;
