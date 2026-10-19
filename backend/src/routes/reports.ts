import { Router, Request, Response } from 'express';
import { db } from '../db';
import { todayStr } from '../units';
import { lifetimeFinance, periodFinance } from '../finance';
import { buildSettlement } from '../settlement';

const sum = (a: { amount: number }[]) => a.reduce((s, x) => s + x.amount, 0);

export const reports = Router();

// GET /api/dashboard
reports.get('/dashboard', async (_req: Request, res: Response) => {
  const td = todayStr();
  const [cPays, customers, vendors] = await Promise.all([
    db.customerPayment.findMany({ where: { returnId: null } }),
    db.customer.findMany({ where: { deletedAt: null } }),
    db.vendor.findMany({ where: { deletedAt: null } }),
  ]);
  // Profit is NEVER computed here: /dashboard only reads the canonical
  // finance service so Home, Accounts and the API cannot drift apart.
  const [today, life] = await Promise.all([periodFinance('day', td), lifetimeFinance()]);
  const todayCollect = sum(cPays.filter(p => p.date === td));
  const due = await dueTotal('c');
  const payable = await dueTotal('v');
  res.json({
    todaySale: today.netSales,
    todayCollect,
    todayPurchase: today.netPurchase,
    todayProfit: today.netProfit,
    todayExpense: today.expense,
    todayDue: Math.max(0, today.netSales - todayCollect),
    totalSale: life.netSales,
    totalPurchase: life.netPurchase,
    totalProfit: life.netProfit,
    totalExpense: life.expense,
    today,
    lifetime: life,
    due, payable,
    customerCount: customers.length, vendorCount: vendors.length,
  });
});

// GET /api/finance?mode=day|month|year|range&date=YYYY-MM-DD&from=&to=
// The one canonical financial breakdown used by Home and Accounts.
reports.get('/finance', async (req: Request, res: Response) => {
  const mode = (['day', 'month', 'year', 'all', 'range'].includes(String(req.query.mode)) ? req.query.mode : 'day') as 'day' | 'month' | 'year' | 'all' | 'range';
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  res.json(await periodFinance(mode, from ?? date, to));
});

async function dueTotal(kind: 'c' | 'v') {
  if (kind === 'c') {
    const [cs, sales, pays] = await Promise.all([
      db.customer.findMany({ where: { deletedAt: null } }), db.sale.findMany(), db.customerPayment.findMany(),
    ]);
    const byCust = (id: string) =>
      Math.max(0, (cs.find(c => c.id === id)?.openingDue ?? 0) +
      sales.filter(s => s.customerId === id).reduce((s, x) => s + x.total, 0) -
      pays.filter(p => p.customerId === id).reduce((s, x) => s + x.amount, 0));
    return cs.reduce((s, c) => s + byCust(c.id), 0);
  }
  const [vs, purs, pays] = await Promise.all([
    db.vendor.findMany({ where: { deletedAt: null } }), db.purchase.findMany(), db.vendorPayment.findMany(),
  ]);
  const byVend = (id: string) =>
    Math.max(0, (vs.find(v => v.id === id)?.openingPayable ?? 0) +
    purs.filter(p => p.vendorId === id).reduce((s, x) => s + x.total, 0) -
    pays.filter(p => p.vendorId === id).reduce((s, x) => s + x.amount, 0));
  return vs.reduce((s, v) => s + byVend(v.id), 0);
}

// GET /api/accounts/receivables/:id — one customer: opening + sales w/ items + standalone collections + balance
reports.get('/accounts/receivables/:id', async (req: Request, res: Response) => {
  const c = await db.customer.findUnique({ where: { id: req.params.id } });
  if (!c || c.deletedAt) return res.status(404).json({ error: 'Customer not found' });
  const [sales, allPays] = await Promise.all([
    db.sale.findMany({
      where: { customerId: c.id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { items: { include: { product: { select: { name: true } } } } },
    }),
    db.customerPayment.findMany({ where: { customerId: c.id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
  ]);
  const ids = sales.map(s => s.id);
  const saleRets = ids.length
    ? await db.productReturn.findMany({ where: { saleId: { in: ids } }, select: { saleId: true, totalAmount: true } })
    : [];
  // Per-invoice paid/due/status derived from the canonical settlement. The sum
  // of derived paid already covers every collection (dedicated + FIFO +
  // return credits), so it is used directly — never added to collections.
  const st = buildSettlement(
    sales.map(s => ({ id: s.id, partyId: c.id, date: s.date, total: s.total, createdAt: s.createdAt })),
    saleRets.map(r => ({ invoiceId: r.saleId, amount: r.totalAmount })),
    allPays.map(p => ({ partyId: c.id, invoiceId: p.saleId, returnId: p.returnId, date: p.date, amount: p.amount, createdAt: p.createdAt })),
  );
  const pays = allPays.filter(p => !p.saleId);
  const saleTotal = sales.reduce((s, x) => s + x.total, 0);
  const salePaid = [...st.values()].reduce((s, x) => s + x.paid, 0);
  res.json({
    party: { id: c.id, name: c.name, mobile: c.mobile, opening: c.openingDue, next: c.nextDate ?? undefined },
    opening: c.openingDue,
    sales: sales.map(s => {
      const sst = st.get(s.id);
      return {
        id: s.id, invoiceNo: s.invoiceNo ?? undefined, date: s.date, total: s.total,
        paid: sst?.paid ?? s.paid, due: sst?.due ?? s.due, status: sst?.status,
        items: s.items.map(it => ({
          productName: it.product.name, unit: it.unit,
          enteredQty: it.enteredQty, qtyKg: it.qtyKg, rate: it.rate,
        })),
      };
    }),
    payments: pays.map(p => ({ id: p.id, amount: p.amount, date: p.date, note: p.note ?? undefined })),
    totalSales: saleTotal,
    totalPaid: Math.round(salePaid * 100) / 100,
    balance: Math.round((c.openingDue + saleTotal - salePaid) * 100) / 100,
  });
});

// GET /api/accounts/payables/:id — one vendor: opening + purchases w/ items + standalone payments + balance
reports.get('/accounts/payables/:id', async (req: Request, res: Response) => {
  const v = await db.vendor.findUnique({ where: { id: req.params.id } });
  if (!v || v.deletedAt) return res.status(404).json({ error: 'Vendor not found' });
  const [purs, allPays] = await Promise.all([
    db.purchase.findMany({
      where: { vendorId: v.id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { items: { include: { product: { select: { name: true } } } } },
    }),
    db.vendorPayment.findMany({ where: { vendorId: v.id }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
  ]);
  const pids = purs.map(p => p.id);
  const purRets = pids.length
    ? await db.productReturn.findMany({ where: { purchaseId: { in: pids } }, select: { purchaseId: true, totalAmount: true } })
    : [];
  // Canonical per-invoice settlement; its paid sum already covers every
  // payment (dedicated + FIFO + return credits).
  const st = buildSettlement(
    purs.map(p => ({ id: p.id, partyId: v.id, date: p.date, total: p.total, createdAt: p.createdAt })),
    purRets.map(r => ({ invoiceId: r.purchaseId, amount: r.totalAmount })),
    allPays.map(p => ({ partyId: v.id, invoiceId: p.purchaseId, returnId: p.returnId, date: p.date, amount: p.amount, createdAt: p.createdAt })),
  );
  const pays = allPays.filter(p => !p.purchaseId);
  const purTotal = purs.reduce((s, x) => s + x.total, 0);
  const purPaid = [...st.values()].reduce((s, x) => s + x.paid, 0);
  res.json({
    party: { id: v.id, name: v.name, mobile: v.mobile, opening: v.openingPayable, next: v.nextDate ?? undefined },
    opening: v.openingPayable,
    purchases: purs.map(p => {
      const pst = st.get(p.id);
      return {
        id: p.id, invoiceNo: p.invoiceNo ?? undefined, date: p.date, total: p.total,
        paid: pst?.paid ?? p.paid, due: pst?.due ?? p.due, status: pst?.status,
        items: p.items.map(it => ({
          productName: it.product.name, unit: it.unit,
          enteredQty: it.enteredQty, qtyKg: it.qtyKg, rate: it.rate,
        })),
      };
    }),
    payments: pays.map(p => ({ id: p.id, amount: p.amount, date: p.date, note: p.note ?? undefined })),
    totalPurchase: purTotal,
    totalPaid: Math.round(purPaid * 100) / 100,
    balance: Math.round((v.openingPayable + purTotal - purPaid) * 100) / 100,
  });
});
// GET /api/accounts/receivables — customers with balance > 0
reports.get('/accounts/receivables', async (_req: Request, res: Response) => {
  const [cs, sales, pays] = await Promise.all([
    db.customer.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.sale.findMany(), db.customerPayment.findMany(),
  ]);
  res.json(cs
    .map(c => ({
      id: c.id, name: c.name, mobile: c.mobile,
      balance: c.openingDue + sales.filter(s => s.customerId === c.id).reduce((s, x) => s + x.total, 0)
        - pays.filter(p => p.customerId === c.id).reduce((s, x) => s + x.amount, 0),
      next: c.nextDate ?? undefined,
    }))
    .filter(x => x.balance > 0));
});

// GET /api/accounts/payables — vendors with balance > 0
reports.get('/accounts/payables', async (_req: Request, res: Response) => {
  const [vs, purs, pays] = await Promise.all([
    db.vendor.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.purchase.findMany(), db.vendorPayment.findMany(),
  ]);
  res.json(vs
    .map(v => ({
      id: v.id, name: v.name, mobile: v.mobile,
      balance: v.openingPayable + purs.filter(p => p.vendorId === v.id).reduce((s, x) => s + x.total, 0)
        - pays.filter(p => p.vendorId === v.id).reduce((s, x) => s + x.amount, 0),
      next: v.nextDate ?? undefined,
    }))
    .filter(x => x.balance > 0));
});
