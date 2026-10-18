import { Router, Request, Response } from 'express';
import { db } from '../db';
import { businessToday, addDays } from '../units';
import { settleAll } from '../settlement';

export const reminders = Router();

// GET /api/reminders — generate today's/tomorrow's due reminders (idempotent),
// drop stale ones, and return the unread list with current remaining amounts.
reminders.get('/', async (_req: Request, res: Response) => {
  const today = businessToday();
  const tomorrow = addDays(today, 1);

  const [sales, purchases, saleSet, purSet] = await Promise.all([
    db.sale.findMany({ include: { customer: { select: { id: true, name: true } } } }),
    db.purchase.findMany({ include: { vendor: { select: { id: true, name: true } } } }),
    // Canonical settlement: returns are attributed to their own invoice,
    // floating payments FIFO per party. One source, same as the lists.
    settleAll('sale'),
    settleAll('purchase'),
  ]);
  const saleRem = new Map<string, number>();
  for (const [id, st] of saleSet) saleRem.set(id, st.due);
  const purRem = new Map<string, number>();
  for (const [id, st] of purSet) purRem.set(id, st.due);

  // Create each (ref, occasion, dueDate) reminder at most once.
  for (const s of sales) {
    if (!s.nextDate) continue;
    const dueDate = s.nextDate;
    if (dueDate !== today && dueDate !== tomorrow) continue;
    if (!s.customer) continue;
    const remaining = saleRem.get(s.id) ?? 0;
    if (remaining <= 0) continue;
    const occasion = dueDate === today ? 'today' : 'tomorrow';
    await db.notification.upsert({
      where: { refType_refId_occasion_dueDate: { refType: 'sale', refId: s.id, occasion, dueDate } },
      update: {},
      create: {
        refType: 'sale', refId: s.id, occasion, dueDate,
        partyKind: 'c', partyId: s.customer.id, partyName: s.customer.name, amount: remaining,
      },
    });
  }
  for (const p of purchases) {
    if (!p.nextDate) continue;
    const dueDate = p.nextDate;
    if (dueDate !== today && dueDate !== tomorrow) continue;
    const remaining = purRem.get(p.id) ?? 0;
    if (remaining <= 0) continue;
    const occasion = dueDate === today ? 'today' : 'tomorrow';
    await db.notification.upsert({
      where: { refType_refId_occasion_dueDate: { refType: 'purchase', refId: p.id, occasion, dueDate } },
      update: {},
      create: {
        refType: 'purchase', refId: p.id, occasion, dueDate,
        partyKind: 'v', partyId: p.vendor.id, partyName: p.vendor.name, amount: remaining,
      },
    });
  }

  // Unread list with current remaining; auto-resolve stale (fully paid) ones.
  const unread = await db.notification.findMany({ where: { read: false }, orderBy: { createdAt: 'desc' } });
  const out: { id: string; refType: string; refId: string; occasion: string; dueDate: string; partyKind: string; partyId: string; partyName: string; amount: number }[] = [];
  for (const n of unread) {
    const current = n.refType === 'sale' ? saleRem.get(n.refId) : purRem.get(n.refId);
    if (current === undefined || current <= 0) {
      await db.notification.update({ where: { id: n.id }, data: { read: true } });
      continue;
    }
    if (current !== n.amount) await db.notification.update({ where: { id: n.id }, data: { amount: current } });
    out.push({
      id: n.id, refType: n.refType, refId: n.refId, occasion: n.occasion, dueDate: n.dueDate,
      partyKind: n.partyKind, partyId: n.partyId, partyName: n.partyName, amount: current,
    });
  }
  // Today first, then tomorrow.
  out.sort((a, b) => (a.occasion === b.occasion ? 0 : a.occasion === 'today' ? -1 : 1));
  res.json({ reminders: out, unreadCount: out.length });
});

// POST /api/reminders/:id/read
reminders.post('/:id/read', async (req: Request, res: Response) => {
  try {
    await db.notification.update({ where: { id: req.params.id }, data: { read: true } });
    res.json({ id: req.params.id });
  } catch (e) {
    res.status(404).json({ error: 'Notification not found' });
  }
});
