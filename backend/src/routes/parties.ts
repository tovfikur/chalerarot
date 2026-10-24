import { Router, Request, Response } from 'express';
import { db } from '../db';
import { customerBalance, vendorBalance } from '../balance';

const num = (v: unknown, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : d;
};

const shapeC = (c: { id: string; code?: string | null; name: string; mobile: string; address: string | null; openingDue: number; nextDate: string | null }) => ({
  id: c.id, code: c.code ?? undefined, name: c.name, mobile: c.mobile, address: c.address ?? undefined, opening: c.openingDue, next: c.nextDate ?? undefined,
});
const shapeV = (v: { id: string; code?: string | null; name: string; mobile: string; address: string | null; openingPayable: number; nextDate: string | null }) => ({
  id: v.id, code: v.code ?? undefined, name: v.name, mobile: v.mobile, address: v.address ?? undefined, opening: v.openingPayable, next: v.nextDate ?? undefined,
});

export const customers = Router();
export const vendors = Router();

// ---- Customers ----
customers.get('/', async (_req: Request, res: Response) => {
  const list = await db.customer.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  res.json(list.map(shapeC));
});

customers.post('/', async (req: Request, res: Response) => {
  const { code, name, mobile, address, opening, next } = req.body ?? {};
  if (!String(name ?? '').trim()) return res.status(400).json({ error: 'Name is required' });
  const c = await db.customer.create({
    data: {
      code: code ? String(code).trim() : null,
      name: String(name).trim(),
      mobile: String(mobile ?? ''),
      address: address ?? null,
      openingDue: num(opening),
      nextDate: next ?? null,
    },
  });
  res.status(201).json({ id: c.id });
});

customers.put('/:id', async (req: Request, res: Response) => {
  const cur = await db.customer.findUnique({ where: { id: req.params.id } });
  if (!cur || cur.deletedAt) return res.status(404).json({ error: 'Customer not found' });
  const { code, name, mobile, address, opening, next } = req.body ?? {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  const u = await db.customer.update({
    where: { id: cur.id },
    data: {
      code: code === undefined ? cur.code : (code ? String(code).trim() : null),
      name: name === undefined ? cur.name : String(name).trim(),
      mobile: mobile === undefined ? cur.mobile : String(mobile),
      address: address === undefined ? cur.address : (address ?? null),
      openingDue: opening === undefined ? cur.openingDue : num(opening),
      nextDate: next === undefined ? cur.nextDate : (next ?? null),
    },
  });
  res.json({ id: u.id });
});

customers.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  const cur = await db.customer.findUnique({ where: { id } });
  if (!cur || cur.deletedAt) return res.status(404).json({ error: 'Customer not found' });
  const b = await customerBalance(id);
  const [s, pay] = await Promise.all([
    db.sale.count({ where: { customerId: id } }),
    db.customerPayment.count({ where: { customerId: id } }),
  ]);
  if (b && b.balance > 0) {
    return res.status(400).json({ error: 'Customer has pending balance and cannot be deleted', code: 'CUSTOMER_HAS_BALANCE', amount: Math.round(b.balance * 100) / 100 });
  }
  if (s + pay > 0 || (b && b.opening !== 0)) {
    return res.status(400).json({ error: 'Customer has transaction history and cannot be deleted', code: 'CUSTOMER_HAS_TRANSACTIONS' });
  }
  await db.customer.update({ where: { id }, data: { deletedAt: new Date() } });
  res.json({ id });
});

customers.get('/:id/ledger', async (req: Request, res: Response) => {
  const id = req.params.id;
  const cur = await db.customer.findUnique({ where: { id } });
  if (!cur || cur.deletedAt) return res.status(404).json({ error: 'Customer not found' });
  const [sales, pays] = await Promise.all([
    db.sale.findMany({ where: { customerId: id }, orderBy: { date: 'desc' } }),
    db.customerPayment.findMany({ where: { customerId: id }, orderBy: { date: 'desc' } }),
  ]);
  res.json([
    ...sales.map(s => ({ id: s.id, kind: 'sale', amount: s.total, date: s.date })),
    ...pays.map(p => ({ id: p.id, kind: 'payment', amount: p.amount, date: p.date, note: p.note ?? undefined })),
  ]);
});

// ---- Vendors ----
vendors.get('/', async (_req: Request, res: Response) => {
  const list = await db.vendor.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  res.json(list.map(shapeV));
});

vendors.post('/', async (req: Request, res: Response) => {
  const { code, name, mobile, address, opening, next } = req.body ?? {};
  if (!String(name ?? '').trim()) return res.status(400).json({ error: 'Name is required' });
  const v = await db.vendor.create({
    data: {
      code: code ? String(code).trim() : null,
      name: String(name).trim(),
      mobile: String(mobile ?? ''),
      address: address ?? null,
      openingPayable: num(opening),
      nextDate: next ?? null,
    },
  });
  res.status(201).json({ id: v.id });
});

vendors.put('/:id', async (req: Request, res: Response) => {
  const cur = await db.vendor.findUnique({ where: { id: req.params.id } });
  if (!cur || cur.deletedAt) return res.status(404).json({ error: 'Vendor not found' });
  const { code, name, mobile, address, opening, next } = req.body ?? {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  const u = await db.vendor.update({
    where: { id: cur.id },
    data: {
      code: code === undefined ? cur.code : (code ? String(code).trim() : null),
      name: name === undefined ? cur.name : String(name).trim(),
      mobile: mobile === undefined ? cur.mobile : String(mobile),
      address: address === undefined ? cur.address : (address ?? null),
      openingPayable: opening === undefined ? cur.openingPayable : num(opening),
      nextDate: next === undefined ? cur.nextDate : (next ?? null),
    },
  });
  res.json({ id: u.id });
});

vendors.delete('/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  const cur = await db.vendor.findUnique({ where: { id } });
  if (!cur || cur.deletedAt) return res.status(404).json({ error: 'Vendor not found' });
  const b = await vendorBalance(id);
  const [p, pay] = await Promise.all([
    db.purchase.count({ where: { vendorId: id } }),
    db.vendorPayment.count({ where: { vendorId: id } }),
  ]);
  if (b && b.balance > 0) {
    return res.status(400).json({ error: 'Vendor has pending payable and cannot be deleted', code: 'VENDOR_HAS_BALANCE', amount: Math.round(b.balance * 100) / 100 });
  }
  if (p + pay > 0 || (b && b.opening !== 0)) {
    return res.status(400).json({ error: 'Vendor has transaction history and cannot be deleted', code: 'VENDOR_HAS_TRANSACTIONS' });
  }
  await db.vendor.update({ where: { id }, data: { deletedAt: new Date() } });
  res.json({ id });
});

vendors.get('/:id/ledger', async (req: Request, res: Response) => {
  const id = req.params.id;
  const cur = await db.vendor.findUnique({ where: { id } });
  if (!cur || cur.deletedAt) return res.status(404).json({ error: 'Vendor not found' });
  const [purs, pays] = await Promise.all([
    db.purchase.findMany({ where: { vendorId: id }, orderBy: { date: 'desc' } }),
    db.vendorPayment.findMany({ where: { vendorId: id }, orderBy: { date: 'desc' } }),
  ]);
  res.json([
    ...purs.map(p => ({ id: p.id, kind: 'purchase', amount: p.total, date: p.date })),
    ...pays.map(p => ({ id: p.id, kind: 'payment', amount: p.amount, date: p.date, note: p.note ?? undefined })),
  ]);
});
