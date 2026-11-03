import { Router } from 'express';
import { db } from '../db';
import { requireAdmin } from '../auth';

const GROUPS: Record<string, string[]> = {
  sales: ['sale'],
  purchases: ['purchase'],
  payments: ['customerPayment', 'vendorPayment'],
  money: ['transfer', 'moneyEntry', 'moneyAccount'],
  other: [],
};

const KNOWN = ['sale', 'purchase', 'customerPayment', 'vendorPayment', 'transfer', 'moneyEntry', 'moneyAccount'];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const n = typeof value === 'string' ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};

export const activity = Router();
activity.use(requireAdmin);

activity.get('/', async (req, res) => {
  try {
    const take = clamp(req.query.take, 1, 200, 60);
    const skip = clamp(req.query.skip, 0, 100000, 0);
    const where: any = {};

    const group = typeof req.query.group === 'string' ? req.query.group : '';
    if (group === 'other') where.entity = { notIn: KNOWN };
    else if (GROUPS[group]?.length) where.entity = { in: GROUPS[group] };

    if (typeof req.query.entity === 'string' && req.query.entity.trim()) where.entity = req.query.entity.trim();
    if (typeof req.query.userId === 'string' && req.query.userId.trim()) where.userId = req.query.userId.trim();

    const from = typeof req.query.from === 'string' && DATE_RE.test(req.query.from) ? req.query.from : '';
    const to = typeof req.query.to === 'string' && DATE_RE.test(req.query.to) ? req.query.to : '';
    if (from || to) {
      where.createdAt = {};
      if (from) where.createdAt.gte = new Date(from + 'T00:00:00.000Z');
      if (to) where.createdAt.lte = new Date(to + 'T23:59:59.999Z');
    }

    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) {
      where.OR = [
        { userName: { contains: q, mode: 'insensitive' } },
        { reference: { contains: q, mode: 'insensitive' } },
        { summary: { contains: q, mode: 'insensitive' } },
      ];
    }

    const [rows, total] = await Promise.all([
      db.activityLog.findMany({ where, orderBy: { createdAt: 'desc' }, take, skip }),
      db.activityLog.count({ where }),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.json({ rows, total, take, skip });
  } catch {
    res.status(500).json({ error: 'লগ লোড করা যায়নি' });
  }
});

activity.get('/users', async (_req, res) => {
  try {
    const rows = await db.activityLog.findMany({
      where: { userId: { not: null } },
      distinct: ['userId'],
      select: { userId: true, userName: true, userRole: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    res.json(rows);
  } catch {
    res.status(500).json({ error: 'ব্যবহারকারীর তালিকা লোড করা যায়নি' });
  }
});
