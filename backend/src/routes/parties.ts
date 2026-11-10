import { Router, Request, Response } from 'express';
import { db } from '../db';
import { customerBalance, vendorBalance } from '../balance';
import { lockAndCheckCode } from '../code';

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

// POST /api/customers/bulk
customers.post('/bulk', async (req: Request, res: Response) => {
  try {
    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }
    const createdList: any[] = [];
    const errors: { row: number; name?: string; error: string }[] = [];

    await db.$transaction(async tx => {
      const usedCodes = new Set<string>();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const rowNum = Number.isInteger(item.rowNum) && item.rowNum > 0 ? item.rowNum : i + 1;
        const name = String(item.name ?? '').trim();
        if (!name) {
          errors.push({ row: rowNum, error: 'Customer name is required' });
          continue;
        }
        let code = item.code ? String(item.code).trim() : null;
        if (code) {
          const codeCheck = await lockAndCheckCode(tx, code, 'customer');
          const key = codeCheck.normalized.toUpperCase();
          if (codeCheck.invalid) {
            errors.push({ row: rowNum, name, error: 'Code must use English letters or numbers; hyphen, underscore, dot and slash are allowed' });
            continue;
          }
          if (usedCodes.has(key) || codeCheck.conflict) {
            const error = codeCheck.conflict === 'product' ? `Code '${code}' is already used by a product`
              : codeCheck.conflict === 'supplier' ? `Code '${code}' is already used by a supplier`
                : `Customer code '${code}' is already in use`;
            errors.push({ row: rowNum, name, error });
            continue;
          }
          code = key;
          usedCodes.add(key);
        }
        const mobile = String(item.mobile ?? '').trim();
        const address = item.address ? String(item.address).trim() : null;
        const opening = num(item.opening ?? item.openingDue);
        const next = item.next ?? item.nextDate ?? null;

        const c = await tx.customer.create({
          data: {
            code,
            name,
            mobile,
            address,
            openingDue: opening,
            nextDate: next,
          },
        });
        createdList.push(shapeC(c));
      }
    });

    res.status(201).json({
      total: items.length,
      successCount: createdList.length,
      errors,
      created: createdList,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to bulk import customers' });
  }
});

customers.post('/', async (req: Request, res: Response) => {
  const { code, name, mobile, address, opening, next } = req.body ?? {};
  if (!String(name ?? '').trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const c = await db.$transaction(async tx => {
      const rawCode = String(code ?? '').trim();
      const checked = rawCode ? await lockAndCheckCode(tx, rawCode, 'customer') : { normalized: '' };
      if (checked.invalid) throw Object.assign(new Error('Code must use English letters or numbers; hyphen, underscore, dot and slash are allowed'), { code: 'CODE_INVALID' });
      if (checked.conflict) throw Object.assign(new Error('Code is already in use'), { code: 'CODE_EXISTS', conflict: checked.conflict });
      return tx.customer.create({ data: { code: checked.normalized || null, name: String(name).trim(), mobile: String(mobile ?? ''), address: address ?? null, openingDue: num(opening), nextDate: next ?? null } });
    });
    res.status(201).json({ id: c.id });
  } catch (e) {
    if ((e as { code?: string }).code === 'CODE_INVALID') return res.status(400).json({ error: (e as Error).message, code: 'CODE_INVALID' });
    if ((e as { code?: string }).code === 'CODE_EXISTS') return res.status(409).json({ error: `Code is already in use${(e as { conflict?: string }).conflict ? ` by a ${(e as { conflict?: string }).conflict}` : ''}`, code: 'CODE_EXISTS' });
    res.status(500).json({ error: 'Failed to create customer' });
  }
});

customers.put('/:id', async (req: Request, res: Response) => {
  const cur = await db.customer.findUnique({ where: { id: req.params.id } });
  if (!cur || cur.deletedAt) return res.status(404).json({ error: 'Customer not found' });
  const { code, name, mobile, address, opening, next } = req.body ?? {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const u = await db.$transaction(async tx => {
      const rawCode = code === undefined ? cur.code : String(code ?? '').trim();
      const checked = rawCode ? await lockAndCheckCode(tx, rawCode, 'customer', { entity: 'customer', id: cur.id }) : { normalized: '' };
      if (checked.invalid) throw Object.assign(new Error('Code must use English letters or numbers; hyphen, underscore, dot and slash are allowed'), { code: 'CODE_INVALID' });
      if (checked.conflict) throw Object.assign(new Error('Code is already in use'), { code: 'CODE_EXISTS', conflict: checked.conflict });
      return tx.customer.update({ where: { id: cur.id }, data: {
        code: code === undefined ? cur.code : (checked.normalized || null),
        name: name === undefined ? cur.name : String(name).trim(),
        mobile: mobile === undefined ? cur.mobile : String(mobile),
        address: address === undefined ? cur.address : (address ?? null),
        openingDue: opening === undefined ? cur.openingDue : num(opening),
        nextDate: next === undefined ? cur.nextDate : (next ?? null),
      } });
    });
    res.json({ id: u.id });
  } catch (e) {
    if ((e as { code?: string }).code === 'CODE_INVALID') return res.status(400).json({ error: (e as Error).message, code: 'CODE_INVALID' });
    if ((e as { code?: string }).code === 'CODE_EXISTS') return res.status(409).json({ error: `Code is already in use${(e as { conflict?: string }).conflict ? ` by a ${(e as { conflict?: string }).conflict}` : ''}`, code: 'CODE_EXISTS' });
    res.status(500).json({ error: 'Failed to update customer' });
  }
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
    db.customerPayment.findMany({ where: { customerId: id, active: true }, orderBy: { date: 'desc' } }),
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

// POST /api/vendors/bulk
vendors.post('/bulk', async (req: Request, res: Response) => {
  try {
    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }
    const createdList: any[] = [];
    const errors: { row: number; name?: string; error: string }[] = [];

    await db.$transaction(async tx => {
      const usedCodes = new Set<string>();
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const rowNum = Number.isInteger(item.rowNum) && item.rowNum > 0 ? item.rowNum : i + 1;
        const name = String(item.name ?? '').trim();
        if (!name) {
          errors.push({ row: rowNum, error: 'Vendor name is required' });
          continue;
        }
        let code = item.code ? String(item.code).trim() : null;
        if (code) {
          const codeCheck = await lockAndCheckCode(tx, code, 'supplier');
          const key = codeCheck.normalized.toUpperCase();
          if (codeCheck.invalid) {
            errors.push({ row: rowNum, name, error: 'Code must use English letters or numbers; hyphen, underscore, dot and slash are allowed' });
            continue;
          }
          if (usedCodes.has(key) || codeCheck.conflict) {
            const error = codeCheck.conflict === 'product' ? `Code '${code}' is already used by a product`
              : codeCheck.conflict === 'customer' ? `Code '${code}' is already used by a customer`
                : `Supplier code '${code}' is already in use`;
            errors.push({ row: rowNum, name, error });
            continue;
          }
          code = key;
          usedCodes.add(key);
        }
        const mobile = String(item.mobile ?? '').trim();
        const address = item.address ? String(item.address).trim() : null;
        const opening = num(item.opening ?? item.openingPayable);
        const next = item.next ?? item.nextDate ?? null;

        const v = await tx.vendor.create({
          data: {
            code,
            name,
            mobile,
            address,
            openingPayable: opening,
            nextDate: next,
          },
        });
        createdList.push(shapeV(v));
      }
    });

    res.status(201).json({
      total: items.length,
      successCount: createdList.length,
      errors,
      created: createdList,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to bulk import vendors' });
  }
});

vendors.post('/', async (req: Request, res: Response) => {
  const { code, name, mobile, address, opening, next } = req.body ?? {};
  if (!String(name ?? '').trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const v = await db.$transaction(async tx => {
      const rawCode = String(code ?? '').trim();
      const checked = rawCode ? await lockAndCheckCode(tx, rawCode, 'supplier') : { normalized: '' };
      if (checked.invalid) throw Object.assign(new Error('Code must use English letters or numbers; hyphen, underscore, dot and slash are allowed'), { code: 'CODE_INVALID' });
      if (checked.conflict) throw Object.assign(new Error('Code is already in use'), { code: 'CODE_EXISTS', conflict: checked.conflict });
      return tx.vendor.create({ data: { code: checked.normalized || null, name: String(name).trim(), mobile: String(mobile ?? ''), address: address ?? null, openingPayable: num(opening), nextDate: next ?? null } });
    });
    res.status(201).json({ id: v.id });
  } catch (e) {
    if ((e as { code?: string }).code === 'CODE_INVALID') return res.status(400).json({ error: (e as Error).message, code: 'CODE_INVALID' });
    if ((e as { code?: string }).code === 'CODE_EXISTS') return res.status(409).json({ error: `Code is already in use${(e as { conflict?: string }).conflict ? ` by a ${(e as { conflict?: string }).conflict}` : ''}`, code: 'CODE_EXISTS' });
    res.status(500).json({ error: 'Failed to create supplier' });
  }
});

vendors.put('/:id', async (req: Request, res: Response) => {
  const cur = await db.vendor.findUnique({ where: { id: req.params.id } });
  if (!cur || cur.deletedAt) return res.status(404).json({ error: 'Vendor not found' });
  const { code, name, mobile, address, opening, next } = req.body ?? {};
  if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const u = await db.$transaction(async tx => {
      const rawCode = code === undefined ? cur.code : String(code ?? '').trim();
      const checked = rawCode ? await lockAndCheckCode(tx, rawCode, 'supplier', { entity: 'supplier', id: cur.id }) : { normalized: '' };
      if (checked.invalid) throw Object.assign(new Error('Code must use English letters or numbers; hyphen, underscore, dot and slash are allowed'), { code: 'CODE_INVALID' });
      if (checked.conflict) throw Object.assign(new Error('Code is already in use'), { code: 'CODE_EXISTS', conflict: checked.conflict });
      return tx.vendor.update({ where: { id: cur.id }, data: {
        code: code === undefined ? cur.code : (checked.normalized || null),
        name: name === undefined ? cur.name : String(name).trim(),
        mobile: mobile === undefined ? cur.mobile : String(mobile),
        address: address === undefined ? cur.address : (address ?? null),
        openingPayable: opening === undefined ? cur.openingPayable : num(opening),
        nextDate: next === undefined ? cur.nextDate : (next ?? null),
      } });
    });
    res.json({ id: u.id });
  } catch (e) {
    if ((e as { code?: string }).code === 'CODE_INVALID') return res.status(400).json({ error: (e as Error).message, code: 'CODE_INVALID' });
    if ((e as { code?: string }).code === 'CODE_EXISTS') return res.status(409).json({ error: `Code is already in use${(e as { conflict?: string }).conflict ? ` by a ${(e as { conflict?: string }).conflict}` : ''}`, code: 'CODE_EXISTS' });
    res.status(500).json({ error: 'Failed to update supplier' });
  }
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
    db.vendorPayment.findMany({ where: { vendorId: id, active: true }, orderBy: { date: 'desc' } }),
  ]);
  res.json([
    ...purs.map(p => ({ id: p.id, kind: 'purchase', amount: p.total, date: p.date })),
    ...pays.map(p => ({ id: p.id, kind: 'payment', amount: p.amount, date: p.date, note: p.note ?? undefined })),
  ]);
});
