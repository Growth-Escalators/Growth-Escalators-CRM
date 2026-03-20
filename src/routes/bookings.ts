import { Router } from 'express';
import { eq, and, desc, gte, sql } from 'drizzle-orm';
import { db, bookings, contacts, deals } from '../db/index';

const router = Router();

// ---------------------------------------------------------------------------
// GET /bookings?tier=&dateFrom=&limit=20
// tenantId from JWT
// ---------------------------------------------------------------------------
router.get('/', async (req, res) => {
  const tenantId = req.user!.tenantId;
  const { tier, dateFrom } = req.query as Record<string, string>;
  const limit = Math.min(parseInt((req.query.limit as string) || '20', 10), 200);

  const conditions: ReturnType<typeof eq>[] = [eq(bookings.tenantId, tenantId)];
  if (tier) conditions.push(eq(bookings.qualificationTier, tier));
  if (dateFrom) conditions.push(gte(bookings.scheduledAt, new Date(dateFrom)));

  const [rows, countResult] = await Promise.all([
    db
      .select({
        booking: bookings,
        contactFirstName: contacts.firstName,
        contactLastName: contacts.lastName,
        dealStage: deals.stage,
        dealTitle: deals.title,
      })
      .from(bookings)
      .leftJoin(contacts, eq(bookings.contactId, contacts.id))
      .leftJoin(deals, eq(bookings.dealId, deals.id))
      .where(and(...conditions))
      .orderBy(desc(bookings.scheduledAt))
      .limit(limit),
    db.select({ count: sql<number>`count(*)::int` }).from(bookings).where(and(...conditions)),
  ]);

  res.json({ bookings: rows, total: countResult[0]?.count ?? 0 });
});

// ---------------------------------------------------------------------------
// GET /bookings/:id — single booking with full contact + deal
// ---------------------------------------------------------------------------
router.get('/:id', async (req, res) => {
  const rows = await db
    .select({
      booking: bookings,
      contact: contacts,
      deal: deals,
    })
    .from(bookings)
    .leftJoin(contacts, eq(bookings.contactId, contacts.id))
    .leftJoin(deals, eq(bookings.dealId, deals.id))
    .where(eq(bookings.id, req.params.id))
    .limit(1);

  if (rows.length === 0) {
    res.status(404).json({ error: 'booking not found' });
    return;
  }

  res.json(rows[0]);
});

export default router;
