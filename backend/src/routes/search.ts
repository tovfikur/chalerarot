import { Router, Request, Response } from 'express';
import { db } from '../db';
import { customerBalance, vendorBalance } from '../balance';

export const search = Router();

const clampLim = (v: unknown) => {
  const n = parseInt(String(v ?? ''), 10);
  if (!Number.isFinite(n)) return 6;
  return Math.min(50, Math.max(1, n));
};

// GET /api/search?q=&limit= — one grouped lookup over persisted data:
// sale/purchase/return numbers (or their party's name/mobile) plus
// active customers/vendors by name/mobile. Trash excluded everywhere.
search.get('/', async (req: Request, res: Response) => {
  const q = String(req.query.q ?? '').trim();
  const lim = clampLim(req.query.limit);
  if (!q) return res.json({ invoices: [], returns: [], customers: [], vendors: [], more: { invoices: false, returns: false, customers: false, vendors: false } });

  const ci = { contains: q, mode: 'insensitive' } as const;
  const [sales, purs, retList, custs, vends] = await Promise.all([
    db.sale.findMany({
      where: { OR: [{ invoiceNo: ci }, { customer: { OR: [{ name: ci }, { mobile: ci }] } }] },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: lim + 1,
      include: { customer: { select: { name: true } } },
    }),
    db.purchase.findMany({
      where: { OR: [{ invoiceNo: ci }, { vendor: { OR: [{ name: ci }, { mobile: ci }] } }] },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: lim + 1,
      include: { vendor: { select: { name: true } } },
    }),
    db.productReturn.findMany({
      where: {
        OR: [
          { returnNo: ci },
          { sale: { customer: { OR: [{ name: ci }, { mobile: ci }] } } },
          { purchase: { vendor: { OR: [{ name: ci }, { mobile: ci }] } } },
        ],
      },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: lim + 1,
      include: {
        sale: { select: { customer: { select: { name: true } } } },
        purchase: { select: { vendor: { select: { name: true } } } },
      },
    }),
    db.customer.findMany({
      where: { deletedAt: null, OR: [{ name: ci }, { mobile: ci }] },
      orderBy: { name: 'asc' },
      take: lim + 1,
    }),
    db.vendor.findMany({
      where: { deletedAt: null, OR: [{ name: ci }, { mobile: ci }] },
      orderBy: { name: 'asc' },
      take: lim + 1,
    }),
  ]);

  const inv = [
    ...sales.map(s => ({ kind: 'sale' as const, id: s.id, no: s.invoiceNo ?? '', partyName: s.customer?.name ?? null, total: s.total, date: s.date })),
    ...purs.map(p => ({ kind: 'purchase' as const, id: p.id, no: p.invoiceNo ?? '', partyName: p.vendor.name, total: p.total, date: p.date })),
  ].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const returns = retList.map(r => ({
    kind: (r.kind === 'sale' ? 'sreturn' : 'preturn') as 'sreturn' | 'preturn',
    id: r.id, no: r.returnNo ?? '',
    partyName: r.kind === 'sale' ? r.sale?.customer?.name ?? null : r.purchase?.vendor?.name ?? null,
    total: r.totalAmount, date: r.date,
  }));

  const customers = [];
  for (const c of custs.slice(0, lim)) {
    const b = await customerBalance(c.id);
    customers.push({ id: c.id, name: c.name, mobile: c.mobile, balance: b ? Math.round(b.balance * 100) / 100 : 0 });
  }
  const vendors = [];
  for (const v of vends.slice(0, lim)) {
    const b = await vendorBalance(v.id);
    vendors.push({ id: v.id, name: v.name, mobile: v.mobile, balance: b ? Math.round(b.balance * 100) / 100 : 0 });
  }

  res.json({
    invoices: inv.slice(0, lim),
    returns: returns.slice(0, lim),
    customers,
    vendors,
    more: { invoices: inv.length > lim || sales.length > lim || purs.length > lim, returns: retList.length > lim, customers: custs.length > lim, vendors: vends.length > lim },
  });
});
