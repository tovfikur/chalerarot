import { Router, Request, Response } from 'express';
import { db } from '../db';
import { customerBalance, vendorBalance, purgeCutoff } from '../balance';
import { setMovementActive } from '../money';

export const trash = Router();

type Kind = 'product' | 'customer' | 'vendor' | 'expense';

// GET /api/trash — all soft-deleted masters, newest first
trash.get('/', async (_req: Request, res: Response) => {
  const [ps, cs, vs, es] = await Promise.all([
    db.product.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } }),
    db.customer.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } }),
    db.vendor.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } }),
    db.expense.findMany({ where: { deletedAt: { not: null } }, orderBy: { deletedAt: 'desc' } }),
  ]);
  res.json([
    ...ps.map(p => ({ kind: 'product' as Kind, id: p.id, name: p.name, deletedAt: p.deletedAt!.toISOString() })),
    ...cs.map(c => ({ kind: 'customer' as Kind, id: c.id, name: c.name, deletedAt: c.deletedAt!.toISOString() })),
    ...vs.map(v => ({ kind: 'vendor' as Kind, id: v.id, name: v.name, deletedAt: v.deletedAt!.toISOString() })),
    ...es.map(e => ({ kind: 'expense' as Kind, id: e.id, name: e.customName || e.category, deletedAt: e.deletedAt!.toISOString() })),
  ]);
});

// POST /api/trash/:kind/:id/restore — deletedAt = null
trash.post('/:kind/:id/restore', async (req: Request, res: Response) => {
  const { kind, id } = req.params;
  try {
    if (kind === 'product') await db.product.update({ where: { id }, data: { deletedAt: null } });
    else if (kind === 'customer') await db.customer.update({ where: { id }, data: { deletedAt: null } });
    else if (kind === 'vendor') await db.vendor.update({ where: { id }, data: { deletedAt: null } });
    else if (kind === 'expense') {
      await db.$transaction(async t => {
        await t.expense.update({ where: { id }, data: { deletedAt: null } });
        // Restoring an expense puts its money-out back on the balance.
        await setMovementActive(t, 'expense', id, true);
      });
    } else return res.status(400).json({ error: 'Invalid kind' });
    res.json({ id });
  } catch (e) {
    res.status(404).json({ error: 'Record not found' });
  }
});

// Permanent purge is only allowed for records trashed >= 30 days ago
// AND with no protected history (sales/purchases/payments/movements).
async function purgeOne(kind: string, id: string): Promise<{ ok: boolean; error?: string }> {
  const cutoff = purgeCutoff();
  if (kind === 'product') {
    const p = await db.product.findUnique({ where: { id } });
    if (!p || !p.deletedAt) return { ok: false, error: 'Record not found' };
    if (p.deletedAt > cutoff) return { ok: false, error: 'Not eligible for purge yet' };
    const [s, pu, mv] = await Promise.all([
      db.saleItem.count({ where: { productId: id } }),
      db.purchaseItem.count({ where: { productId: id } }),
      db.stockMovement.count({ where: { productId: id, NOT: { type: 'OPENING' } } }),
    ]);
    if (s + pu + mv > 0) return { ok: false, error: 'Product has transaction history and cannot be purged' };
    await db.stockMovement.deleteMany({ where: { productId: id } });
    await db.product.delete({ where: { id } });
    return { ok: true };
  }
  if (kind === 'customer') {
    const c = await db.customer.findUnique({ where: { id } });
    if (!c || !c.deletedAt) return { ok: false, error: 'Record not found' };
    if (c.deletedAt > cutoff) return { ok: false, error: 'Not eligible for purge yet' };
    const b = await customerBalance(id);
    const [s, pay] = await Promise.all([
      db.sale.count({ where: { customerId: id } }),
      db.customerPayment.count({ where: { customerId: id } }),
    ]);
    if (s + pay > 0 || (b && (b.opening !== 0 || b.balance !== 0))) {
      return { ok: false, error: 'Customer has transaction history and cannot be purged' };
    }
    await db.customer.delete({ where: { id } });
    return { ok: true };
  }
  if (kind === 'vendor') {
    const v = await db.vendor.findUnique({ where: { id } });
    if (!v || !v.deletedAt) return { ok: false, error: 'Record not found' };
    if (v.deletedAt > cutoff) return { ok: false, error: 'Not eligible for purge yet' };
    const b = await vendorBalance(id);
    const [pu, pay] = await Promise.all([
      db.purchase.count({ where: { vendorId: id } }),
      db.vendorPayment.count({ where: { vendorId: id } }),
    ]);
    if (pu + pay > 0 || (b && (b.opening !== 0 || b.balance !== 0))) {
      return { ok: false, error: 'Vendor has transaction history and cannot be purged' };
    }
    await db.vendor.delete({ where: { id } });
    return { ok: true };
  }
  if (kind === 'expense') {
    const e = await db.expense.findUnique({ where: { id } });
    if (!e || !e.deletedAt) return { ok: false, error: 'Record not found' };
    if (e.deletedAt > cutoff) return { ok: false, error: 'Not eligible for purge yet' };
    await db.$transaction(async t => {
      await t.expense.delete({ where: { id } });
      // Purged expense no longer counts toward profit, so its ledger row goes too.
      await t.moneyMovement.deleteMany({ where: { sourceType: 'expense', sourceId: id } });
    });
    return { ok: true };
  }
  return { ok: false, error: 'Invalid kind' };
}

// DELETE /api/trash/:kind/:id/purge — single permanent delete (30d + history-safe)
trash.delete('/:kind/:id/purge', async (req: Request, res: Response) => {
  const r = await purgeOne(req.params.kind, req.params.id);
  if (!r.ok) return res.status(400).json({ error: r.error, code: 'PURGE_NOT_ELIGIBLE' });
  res.json({ id: req.params.id });
});

// POST /api/trash/purge-expired — purge everything eligible (for scheduled runs)
trash.post('/purge-expired', async (_req: Request, res: Response) => {
  const cutoff = purgeCutoff();
  const [ps, cs, vs, es] = await Promise.all([
    db.product.findMany({ where: { deletedAt: { lte: cutoff } }, select: { id: true } }),
    db.customer.findMany({ where: { deletedAt: { lte: cutoff } }, select: { id: true } }),
    db.vendor.findMany({ where: { deletedAt: { lte: cutoff } }, select: { id: true } }),
    db.expense.findMany({ where: { deletedAt: { lte: cutoff } }, select: { id: true } }),
  ]);
  let purged = 0;
  for (const p of ps) if ((await purgeOne('product', p.id)).ok) purged++;
  for (const c of cs) if ((await purgeOne('customer', c.id)).ok) purged++;
  for (const v of vs) if ((await purgeOne('vendor', v.id)).ok) purged++;
  for (const e of es) if ((await purgeOne('expense', e.id)).ok) purged++;
  res.json({ purged });
});
