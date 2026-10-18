import { db } from './db';

// Balance math mirrors the frontend derivation:
// opening + transaction totals − all payments.
export async function customerBalance(id: string) {
  const [c, sales, pays] = await Promise.all([
    db.customer.findUnique({ where: { id } }),
    db.sale.findMany({ where: { customerId: id } }),
    db.customerPayment.findMany({ where: { customerId: id } }),
  ]);
  if (!c) return null;
  const total = sales.reduce((s, x) => s + x.total, 0);
  const paid = pays.reduce((s, x) => s + x.amount, 0);
  return { opening: c.openingDue, total, paid, balance: c.openingDue + total - paid };
}

export async function vendorBalance(id: string) {
  const [v, purs, pays] = await Promise.all([
    db.vendor.findUnique({ where: { id } }),
    db.purchase.findMany({ where: { vendorId: id } }),
    db.vendorPayment.findMany({ where: { vendorId: id } }),
  ]);
  if (!v) return null;
  const total = purs.reduce((s, x) => s + x.total, 0);
  const paid = pays.reduce((s, x) => s + x.amount, 0);
  return { opening: v.openingPayable, total, paid, balance: v.openingPayable + total - paid };
}

export const PURGE_DAYS = 30;
export const purgeCutoff = () => new Date(Date.now() - PURGE_DAYS * 86400000);
