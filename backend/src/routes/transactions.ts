import { Router, Request, Response } from 'express';
import { db } from '../db';
import { toKg, isUnit, transactionDay, checkPromiseDay } from '../units';
import { accountBalance, accountBalances, lockAccounts, methodForAmount, moneyBalances, recordMovement, resolveAccount } from '../money';
import { currentAvgCost, round2, writeMovement } from '../valuation';
import { lifetimeFinance, periodFinance } from '../finance';
import { settleAll, settleParty, syncPartyInvoices, buildSettlement } from '../settlement';
import { productJson } from './products';

const num = (v: unknown, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : d;
};

// Payment account of an existing transaction, read from the ledger row that was
// written when it was saved. Display only - nothing is created or changed here.
const paymentOf = async (sourceType: string, sourceId: string) => {
  const rows = await db.moneyMovement.findMany({
    where: { sourceType, active: true, OR: [{ sourceId }, { sourceId: { startsWith: `${sourceId}:` } }] },
    include: { moneyAccount: { select: { name: true, type: true } } },
    orderBy: { createdAt: 'asc' },
  });
  if (!rows.length) return null;
  const names = [...new Set(rows.map(m => m.moneyAccount?.name).filter(Boolean))];
  const methods = [...new Set(rows.map(m => m.method))];
  return { accountName: names.join(', ') || null, method: methods.length === 1 ? methods[0] : 'mixed', amount: round2(rows.reduce((sum, m) => sum + m.amount, 0)), date: rows[0].date };
};

// Atomic yearly invoice counter. A single upsert statement so concurrent
// transactions never receive the same number. Never derived from row counts.
export type TxClient = Parameters<Parameters<typeof db.$transaction>[0]>[0];
export async function nextInvoiceNo(
  t: TxClient,
  prefix: 'SAL' | 'PUR' | 'SRN' | 'PRN' | 'TRF',
  date: string,
): Promise<string> {
  const key = `${prefix}:${date.slice(0, 4)}`;
  const rows = await t.$queryRaw<{ last: number }[]>`INSERT INTO "Sequence"("key", "last") VALUES (${key}, 1) ON CONFLICT ("key") DO UPDATE SET "last" = "Sequence"."last" + 1 RETURNING "last"`;
  return `${prefix}-${date.slice(0, 4)}-${String(rows[0].last).padStart(6, '0')}`;
}

export const tx = Router();

// GET /api/sales (with items) — paid/due/status are derived from the
// canonical settlement, never the stored columns.
tx.get('/sales', async (_req: Request, res: Response) => {
  const [list, settled] = await Promise.all([
    db.sale.findMany({
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { items: true, returns: { select: { totalAmount: true } } },
    }),
    settleAll('sale'),
  ]);
  res.json(list.map(s => {
    const st = settled.get(s.id);
    const retTotal = s.returns ? s.returns.reduce((acc, r) => acc + r.totalAmount, 0) : 0;
    const netTotal = Math.max(0, round2(s.total - retTotal));
    return {
      ...s,
      total: retTotal > 0 ? netTotal : s.total,
      paid: st ? st.paid : s.paid,
      due: st ? st.due : s.due,
      status: st?.status,
    };
  }));
});

// GET /api/sales/:id — full saved transaction for invoice display/reprint
tx.get('/sales/:id', async (req: Request, res: Response) => {
  const s = await db.sale.findUnique({
    where: { id: req.params.id },
    include: {
      items: { include: { product: { select: { name: true } } } },
      customer: { select: { name: true, mobile: true } },
      returns: {
        include: {
          items: { include: { product: { select: { name: true } } } },
        },
      },
    },
  });
  if (!s) return res.status(404).json({ error: 'Sale not found' });
  const st = s.customerId ? (await settleParty('sale', s.customerId)).get(s.id) : undefined;
  const returnTotal = s.returns.reduce((sum, r) => sum + r.totalAmount, 0);
  const netTotal = Math.max(0, round2(s.total - returnTotal));

  const regularItems = s.items.map(it => ({
    productName: it.product.name,
    unit: it.unit,
    enteredQty: it.enteredQty,
    qtyKg: it.qtyKg,
    rate: it.rate,
    unitCost: it.unitCost,
    cogs: it.cogs,
  }));

  const retItems = s.returns.flatMap(r =>
    r.items.map(it => ({
      productName: `${it.product.name} (বিক্রয় ফেরত)`,
      unit: it.unit,
      enteredQty: -it.enteredQty,
      qtyKg: -it.qtyKg,
      rate: it.rate,
      unitCost: it.unitCost,
      cogs: -it.cogs,
    }))
  );

  const displayPaid = Math.min(netTotal, Math.max(0, round2((st?.paid ?? s.paid) - returnTotal)));
  const displayDue = Math.max(0, round2(netTotal - displayPaid));

  res.json({
    id: s.id, invoiceNo: s.invoiceNo, date: s.date, createdAt: s.createdAt,
    discount: s.discount,
    total: returnTotal > 0 ? netTotal : s.total,
    paid: returnTotal > 0 ? displayPaid : (st?.paid ?? s.paid),
    due: returnTotal > 0 ? displayDue : (st?.due ?? s.due),
    status: st?.status,
    nextDate: s.nextDate ?? undefined,
    customer: s.customer ? { name: s.customer.name, mobile: s.customer.mobile } : null,
    items: [...regularItems, ...retItems],
    returns: s.returns.map(r => ({ id: r.id, returnNo: r.returnNo, date: r.date, amount: r.totalAmount })),
    payment: await paymentOf('sale', s.id),
  });
});

// GET /api/sales/:id/returnable — original lines with remaining returnable KG
tx.get('/sales/:id/returnable', async (req: Request, res: Response) => {
  const s = await db.sale.findUnique({
    where: { id: req.params.id },
    include: {
      items: { include: { product: { select: { id: true, name: true, smallBagKg: true, mediumBagKg: true, largeBagKg: true } } } },
      customer: { select: { id: true, name: true, mobile: true } },
    },
  });
  if (!s) return res.status(404).json({ error: 'Sale not found' });
  const rets = await db.productReturnItem.findMany({ where: { ret: { saleId: s.id } }, select: { saleItemId: true, qtyKg: true } });
  const used = new Map<string, number>();
  for (const r of rets) if (r.saleItemId) used.set(r.saleItemId, (used.get(r.saleItemId) ?? 0) + r.qtyKg);
  const st = s.customerId ? (await settleParty('sale', s.customerId)).get(s.id) : undefined;
  res.json({
    id: s.id, invoiceNo: s.invoiceNo, date: s.date, total: s.total,
    paid: st?.paid ?? s.paid, due: st?.due ?? s.due,
    customer: s.customer ? { id: s.customer.id, name: s.customer.name, mobile: s.customer.mobile } : null,
    items: s.items.map(it => ({
      id: it.id, productId: it.product.id, productName: it.product.name,
      unit: it.unit, enteredQty: it.enteredQty, qtyKg: it.qtyKg, rate: it.rate,
      bags: { small: it.product.smallBagKg, medium: it.product.mediumBagKg, large: it.product.largeBagKg },
      returnedQty: Math.round((used.get(it.id) ?? 0) * 100) / 100,
    })),
  });
});

// POST /api/sales { customerId?, lines: [{productId, unit, enteredQty}], discount?, paid?, method?, next?, date?, memoNo? }
tx.post('/sales', async (req: Request, res: Response) => {
  try {
    const { customerId, lines, discount, paid, method, accountId, next, date, memoNo } = req.body ?? {};
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'No items in sale' });
    const day = transactionDay(date);
    checkPromiseDay(next);
    const pay = Math.max(0, num(paid));
    const payMethod = methodForAmount(method, pay, Boolean(accountId));
    const disc = Math.max(0, num(discount));
    const result = await db.$transaction(async t => {
      // Money only moves for the amount actually received; the concrete account
      // is resolved once and used by the ledger entry below.
      const payAccount = pay > 0 ? await resolveAccount(t, { accountId, method: accountId ? undefined : payMethod }) : null;
      let sub = 0, cogs = 0;
      let returnTotalAmount = 0, returnCogsReversed = 0;
      const items: { productId: string; unit: string; enteredQty: number; qtyKg: number; rate: number; unitCost: number; cogs: number }[] = [];
      const returnItems: {
        productId: string; unit: string; enteredQty: number; qtyKg: number; goodKg: number; damagedKg: number;
        condition: string; damageReason: string | null; note: string | null; rate: number; amount: number;
        unitCost: number; cogs: number; damagedValue: number;
      }[] = [];

      for (const l of lines) {
        if (!isUnit(l?.unit)) throw Object.assign(new Error('Invalid unit'), { status: 400 });
        const entered = num(l?.enteredQty);
        if (entered === 0 || !Number.isFinite(entered)) {
          throw Object.assign(new Error('Quantity cannot be 0'), { status: 400 });
        }
        const p = await t.product.findUnique({ where: { id: String(l?.productId ?? '') } });
        if (!p || p.deletedAt) throw Object.assign(new Error('Product not found'), { status: 400 });

        const rate = l?.rate === undefined ? p.price : num(l.rate);
        if (!(rate > 0)) throw Object.assign(new Error('Invalid sale rate'), { status: 400, code: 'RATE_INVALID' });
        const hasCustomCost = l.unitCost !== undefined && num(l.unitCost) > 0;
        const currentAvg = await currentAvgCost(t, p.id);
        const unitCost = hasCustomCost ? round2(num(l.unitCost)) : currentAvg;

        if (entered > 0) {
          // Standard sale line
          const qtyKg = Math.round(toKg(p, l.unit, entered) * 100) / 100;
          if (qtyKg > p.qtyKg) throw Object.assign(new Error(`Not enough stock: ${p.name}`), { status: 400 });
          const lineCogs = round2(qtyKg * unitCost);
          cogs += lineCogs;
          sub += round2(qtyKg * rate);
          items.push({ productId: p.id, unit: l.unit, enteredQty: entered, qtyKg, rate, unitCost, cogs: lineCogs });
          // Selling leaves quantity AND inventory value (AVCO out).
          await writeMovement(t, p.id, {
            type: 'SALE', bucket: 'sellable', qtyKg: -qtyKg, unitCost, date: day, forceUnitCost: hasCustomCost,
          });
        } else {
          // Negative quantity => SALES RETURN line
          const absEntered = Math.abs(entered);
          const returnKg = Math.round(toKg(p, l.unit, absEntered) * 100) / 100;
          const lineAmount = round2(returnKg * rate);
          const lineCogs = round2(returnKg * unitCost);
          returnTotalAmount = round2(returnTotalAmount + lineAmount);
          returnCogsReversed = round2(returnCogsReversed + lineCogs);

          returnItems.push({
            productId: p.id, unit: l.unit, enteredQty: absEntered, qtyKg: returnKg, goodKg: returnKg,
            damagedKg: 0, condition: 'good', damageReason: null, note: 'বিক্রয় মেমো হতে ফেরত',
            rate, amount: lineAmount, unitCost, cogs: lineCogs, damagedValue: 0,
          });

          // Stock goes back in as sales return
          await writeMovement(t, p.id, {
            type: 'SRETURN', bucket: 'sellable', qtyKg: returnKg, unitCost, date: day,
          });
        }
      }

      // Calculations: grossTotal is the sale subtotal minus discount.
      // netInvoiceTotal is grossTotal minus return credit.
      const grossTotal = Math.max(0, Math.round((sub - disc) * 100) / 100);
      const netInvoiceTotal = Math.max(0, Math.round((sub - disc - returnTotalAmount) * 100) / 100);
      const cappedPay = Math.min(pay, netInvoiceTotal);
      const due = Math.round((netInvoiceTotal - cappedPay) * 100) / 100;

      let validCustomerId: string | null = null;
      if (customerId) {
        const c = await t.customer.findUnique({ where: { id: String(customerId) } });
        if (c && !c.deletedAt) {
          validCustomerId = c.id;
        } else if (due > 0) {
          throw Object.assign(new Error('Customer not found'), { status: 400 });
        }
      } else if (due > 0) {
        throw Object.assign(new Error('Customer is required when there is a due'), { status: 400 });
      }

      // Use user-provided memoNo as invoiceNo if given and not already taken; otherwise auto-generate.
      let resolvedInvoiceNo: string;
      if (memoNo && String(memoNo).trim()) {
        const candidate = String(memoNo).trim();
        const existing = await t.sale.findUnique({ where: { invoiceNo: candidate } });
        resolvedInvoiceNo = existing ? await nextInvoiceNo(t, 'SAL', day) : candidate;
      } else {
        resolvedInvoiceNo = await nextInvoiceNo(t, 'SAL', day);
      }

      const sale = await t.sale.create({
        data: {
          customerId: validCustomerId, date: day, discount: disc,
          total: grossTotal,
          paid: cappedPay,
          due,
          profit: round2(grossTotal - cogs),
          nextDate: next ?? null, invoiceNo: resolvedInvoiceNo,
          items: { create: items },
        },
      });

      // If there were return lines, create linked ProductReturn & credit customer
      let createdReturn: any = null;
      if (returnItems.length > 0) {
        const returnNo = await nextInvoiceNo(t, 'SRN', day);
        const profitImpact = round2(returnTotalAmount - returnCogsReversed);
        createdReturn = await t.productReturn.create({
          data: {
            returnNo,
            kind: 'sale',
            saleId: sale.id,
            customerId: validCustomerId,
            date: day,
            totalAmount: returnTotalAmount,
            profitImpact,
            settlement: 'credit',
            refundAmount: 0,
            note: `বিক্রয় #${resolvedInvoiceNo} এর সাথে সমন্বয়`,
            items: { create: returnItems },
          },
        });

        if (validCustomerId) {
          await t.customerPayment.create({
            data: {
              customerId: validCustomerId,
              saleId: null,
              returnId: createdReturn.id,
              amount: returnTotalAmount,
              date: day,
              note: returnNo,
            },
          });
        }
      }

      if (payAccount) {
        await t.customerPayment.create({
          data: { customerId: validCustomerId, saleId: sale.id, amount: cappedPay, date: day },
        });
        await recordMovement(t, {
          accountId: payAccount.id, method: payAccount.type, direction: 'in', amount: cappedPay, date: day,
          sourceType: 'sale', sourceId: sale.id, note: sale.invoiceNo,
        });
      }
      if (validCustomerId && next) await t.customer.update({ where: { id: validCustomerId }, data: { nextDate: String(next) } });
      if (validCustomerId) await syncPartyInvoices('sale', validCustomerId, t);
      return { id: sale.id, invoiceNo: sale.invoiceNo, total: netInvoiceTotal, returnNo: createdReturn?.returnNo };
    });
    res.status(201).json(result);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Failed to create sale' });
  }
});

// GET /api/purchases (with items) — paid/due/status derived, never stored.
tx.get('/purchases', async (_req: Request, res: Response) => {
  const [list, settled] = await Promise.all([
    db.purchase.findMany({
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { items: true, returns: { select: { totalAmount: true } } },
    }),
    settleAll('purchase'),
  ]);
  res.json(list.map(p => {
    const st = settled.get(p.id);
    const retTotal = p.returns ? p.returns.reduce((acc, r) => acc + r.totalAmount, 0) : 0;
    const netTotal = Math.max(0, round2(p.total - retTotal));
    return {
      ...p,
      total: retTotal > 0 ? netTotal : p.total,
      paid: st?.paid ?? p.paid,
      due: st?.due ?? p.due,
      status: st?.status,
    };
  }));
});

// GET /api/purchases/:id — full saved transaction for invoice display/reprint
tx.get('/purchases/:id', async (req: Request, res: Response) => {
  const p = await db.purchase.findUnique({
    where: { id: req.params.id },
    include: {
      items: { include: { product: { select: { name: true } } } },
      vendor: { select: { name: true, mobile: true } },
      returns: {
        include: {
          items: { include: { product: { select: { name: true } } } },
        },
      },
    },
  });
  if (!p) return res.status(404).json({ error: 'Purchase not found' });
  const st = (await settleParty('purchase', p.vendorId)).get(p.id);
  const returnTotal = p.returns.reduce((sum, r) => sum + r.totalAmount, 0);
  const netTotal = Math.max(0, round2(p.total - returnTotal));

  const regularItems = p.items.map(it => ({
    productName: it.product.name,
    unit: it.unit,
    enteredQty: it.enteredQty,
    qtyKg: it.qtyKg,
    rate: it.rate,
    unitCost: it.unitCost || it.rate,
    otherCost: it.otherCost || 0,
  }));

  const retItems = p.returns.flatMap(r =>
    r.items.map(it => ({
      productName: `${it.product.name} (ক্রয় ফেরত)`,
      unit: it.unit,
      enteredQty: -it.enteredQty,
      qtyKg: -it.qtyKg,
      rate: it.rate,
    }))
  );

  const displayPaid = Math.min(netTotal, Math.max(0, round2((st?.paid ?? p.paid) - returnTotal)));
  const displayDue = Math.max(0, round2(netTotal - displayPaid));

  res.json({
    id: p.id, invoiceNo: p.invoiceNo, date: p.date, createdAt: p.createdAt,
    total: returnTotal > 0 ? netTotal : p.total,
    paid: returnTotal > 0 ? displayPaid : (st?.paid ?? p.paid),
    due: returnTotal > 0 ? displayDue : (st?.due ?? p.due),
    status: st?.status,
    nextDate: p.nextDate ?? undefined,
    vendor: { name: p.vendor.name, mobile: p.vendor.mobile },
    items: [...regularItems, ...retItems],
    payment: await paymentOf('purchase', p.id),
    returns: p.returns.map(r => ({ id: r.id, returnNo: r.returnNo, date: r.date, amount: r.totalAmount })),
  });
});

// GET /api/purchases/:id/returnable — original lines with remaining returnable KG
tx.get('/purchases/:id/returnable', async (req: Request, res: Response) => {
  const p = await db.purchase.findUnique({
    where: { id: req.params.id },
    include: {
      items: { include: { product: { select: { id: true, name: true, smallBagKg: true, mediumBagKg: true, largeBagKg: true } } } },
      vendor: { select: { id: true, name: true, mobile: true } },
    },
  });
  if (!p) return res.status(404).json({ error: 'Purchase not found' });
  const rets = await db.productReturnItem.findMany({ where: { ret: { purchaseId: p.id } }, select: { purchaseItemId: true, qtyKg: true } });
  const used = new Map<string, number>();
  for (const r of rets) if (r.purchaseItemId) used.set(r.purchaseItemId, (used.get(r.purchaseItemId) ?? 0) + r.qtyKg);
  const st = (await settleParty('purchase', p.vendorId)).get(p.id);
  res.json({
    id: p.id, invoiceNo: p.invoiceNo, date: p.date, total: p.total,
    paid: st?.paid ?? p.paid, due: st?.due ?? p.due,
    vendor: { id: p.vendor.id, name: p.vendor.name, mobile: p.vendor.mobile },
    items: p.items.map(it => ({
      id: it.id, productId: it.product.id, productName: it.product.name,
      unit: it.unit, enteredQty: it.enteredQty, qtyKg: it.qtyKg, rate: it.rate,
      bags: { small: it.product.smallBagKg, medium: it.product.mediumBagKg, large: it.product.largeBagKg },
      returnedQty: Math.round((used.get(it.id) ?? 0) * 100) / 100,
    })),
  });
});

// POST /api/purchases { vendorId, lines: [{productId, unit, enteredQty, rate?}], paid?, method?, next?, date?, memoNo? }
tx.post('/purchases', async (req: Request, res: Response) => {
  try {
    const { vendorId, lines, paid, method, accountId, next, date, memoNo } = req.body ?? {};
    if (!vendorId) return res.status(400).json({ error: 'Vendor is required' });
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'No items in purchase' });
    const day = transactionDay(date);
    checkPromiseDay(next);
    const pay = Math.max(0, num(paid));
    const splitPayments = Array.isArray(req.body.payments) ? req.body.payments.filter((x: any) => x && num(x.amount) > 0) : null;
    const payMethod = methodForAmount(method, pay, Boolean(accountId));
    const result = await db.$transaction(async t => {
      const payAccount = !splitPayments && pay > 0 ? await resolveAccount(t, { accountId, method: accountId ? undefined : payMethod }) : null;
      const splitAccounts = splitPayments ? await Promise.all(splitPayments.map((x: any) => resolveAccount(t, { accountId: x.accountId }))) : [];
      const v = await t.vendor.findUnique({ where: { id: String(vendorId) } });
      if (!v || (v as { deletedAt?: Date | null }).deletedAt) throw Object.assign(new Error('Vendor not found'), { status: 400 });

      let totalPos = 0;
      let returnTotalAmount = 0;
      const items: { productId: string; unit: string; enteredQty: number; qtyKg: number; rate: number; unitCost: number; otherCost: number }[] = [];
      const returnItems: {
        productId: string; unit: string; enteredQty: number; qtyKg: number; goodKg: number; damagedKg: number;
        condition: string; damageReason: string | null; note: string | null; rate: number; amount: number;
        unitCost: number; cogs: number; damagedValue: number;
      }[] = [];

      for (const l of lines) {
        if (!isUnit(l?.unit)) throw Object.assign(new Error('Invalid unit'), { status: 400 });
        const entered = num(l?.enteredQty);
        if (entered === 0 || !Number.isFinite(entered)) {
          throw Object.assign(new Error('Quantity cannot be 0'), { status: 400 });
        }
        const p = await t.product.findUnique({ where: { id: String(l?.productId ?? '') } });
        if (!p || p.deletedAt) throw Object.assign(new Error('Product not found'), { status: 400 });

        const rate = l?.rate === undefined ? p.cost : num(l.rate);
        if (!(rate >= 0)) throw Object.assign(new Error('Invalid rate'), { status: 400 });

        if (entered > 0) {
          // Standard purchase line
          const qtyKg = Math.round(toKg(p, l.unit, entered) * 100) / 100;
          totalPos += round2(qtyKg * rate);

          const bagKg = p.mediumBagKg || 50;
          const otherCostPerBag = Math.max(0, num(l?.otherCost ?? l?.otherCostPerBag));
          const otherCostPerKg = otherCostPerBag / bagKg;
          const buyerCostPerKg = round2(rate + otherCostPerKg);

          items.push({
            productId: p.id,
            unit: l.unit,
            enteredQty: entered,
            qtyKg,
            rate,
            unitCost: buyerCostPerKg,
            otherCost: otherCostPerBag,
          });

          // Stock in at the buyer's cost (vendor rate + other cost per kg); weighted average re-blends.
          await writeMovement(t, p.id, {
            type: 'PURCHASE', bucket: 'sellable', qtyKg, unitCost: buyerCostPerKg, date: day,
          });
        } else {
          // Negative quantity => PURCHASE RETURN line
          const absEntered = Math.abs(entered);
          const returnKg = Math.round(toKg(p, l.unit, absEntered) * 100) / 100;
          if (returnKg > p.qtyKg) {
            throw Object.assign(new Error(`মজুদ অপর্যাপ্ত (${p.name}): ফেরত দেওয়া যাচ্ছে না`), { status: 400 });
          }
          const lineAmount = round2(returnKg * rate);
          returnTotalAmount = round2(returnTotalAmount + lineAmount);

          returnItems.push({
            productId: p.id, unit: l.unit, enteredQty: absEntered, qtyKg: returnKg, goodKg: returnKg,
            damagedKg: 0, condition: 'good', damageReason: null, note: 'ক্রয় মেমো হতে ফেরত',
            rate, amount: lineAmount, unitCost: rate, cogs: 0, damagedValue: 0,
          });

          // Stock leaves at purchase rate
          await writeMovement(t, p.id, {
            type: 'PRETURN', bucket: 'sellable', qtyKg: -returnKg, unitCost: rate, date: day, forceUnitCost: true,
          });
        }
      }

      totalPos = round2(totalPos);
      const grossTotal = totalPos;
      const netInvoiceTotal = Math.max(0, round2(grossTotal - returnTotalAmount));
      const cappedPayP = Math.min(pay, netInvoiceTotal);
      const due = Math.round((netInvoiceTotal - cappedPayP) * 100) / 100;

      // Use user-provided memoNo as invoiceNo if given and not already taken; otherwise auto-generate.
      let resolvedPurInvoiceNo: string;
      if (memoNo && String(memoNo).trim()) {
        const candidate = String(memoNo).trim();
        const existing = await t.purchase.findUnique({ where: { invoiceNo: candidate } });
        resolvedPurInvoiceNo = existing ? await nextInvoiceNo(t, 'PUR', day) : candidate;
      } else {
        resolvedPurInvoiceNo = await nextInvoiceNo(t, 'PUR', day);
      }

      const pur = await t.purchase.create({
        data: {
          vendorId: String(vendorId), date: day,
          total: grossTotal,
          paid: cappedPayP,
          due,
          nextDate: next ?? null, invoiceNo: resolvedPurInvoiceNo,
          items: { create: items },
        },
      });

      // If there were return lines, create linked ProductReturn & credit vendor
      let createdPurReturn: any = null;
      if (returnItems.length > 0) {
        const returnNo = await nextInvoiceNo(t, 'PRN', day);
        createdPurReturn = await t.productReturn.create({
          data: {
            returnNo,
            kind: 'purchase',
            purchaseId: pur.id,
            vendorId: String(vendorId),
            date: day,
            totalAmount: returnTotalAmount,
            profitImpact: 0,
            settlement: 'credit',
            refundAmount: 0,
            note: `ক্রয় #${resolvedPurInvoiceNo} এর সাথে সমন্বয়`,
            items: { create: returnItems },
          },
        });

        await t.vendorPayment.create({
          data: {
            vendorId: String(vendorId),
            purchaseId: null,
            returnId: createdPurReturn.id,
            amount: returnTotalAmount,
            date: day,
            note: returnNo,
          },
        });
      }

      // Paid money leaves through the concrete account resolved above; the
      // payable row and the ledger entry describe the same single event.
      if (splitPayments) {
        let remaining = cappedPayP;
        for (let i = 0; i < splitPayments.length && remaining > 0; i++) {
          const amount = round2(Math.min(remaining, num(splitPayments[i].amount)));
          if (!(amount > 0)) continue;
          const acc = splitAccounts[i];
          await t.vendorPayment.create({ data: { vendorId: String(vendorId), purchaseId: pur.id, amount, date: day } });
          await recordMovement(t, { accountId: acc.id, method: acc.type, direction: 'out', amount, date: day, sourceType: 'purchase', sourceId: pur.id + ':' + i, note: pur.invoiceNo });
          remaining = round2(remaining - amount);
        }
      } else if (payAccount) {
        await t.vendorPayment.create({
          data: { vendorId: String(vendorId), purchaseId: pur.id, amount: cappedPayP, date: day },
        });
        await recordMovement(t, {
          accountId: payAccount.id, method: payAccount.type, direction: 'out', amount: cappedPayP, date: day,
          sourceType: 'purchase', sourceId: pur.id, note: pur.invoiceNo,
        });
      }
      if (next) await t.vendor.update({ where: { id: String(vendorId) }, data: { nextDate: String(next) } });
      // Same-transaction re-materialization of this vendor's stored paid/due.
      await syncPartyInvoices('purchase', String(vendorId), t);
      return { id: pur.id, invoiceNo: pur.invoiceNo, total: netInvoiceTotal, returnNo: createdPurReturn?.returnNo };
    });
    res.status(201).json(result);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Failed to create purchase' });
  }
});

// POST /api/customer-payments { customerId, amount, method, date?, note?, next? }
tx.post('/customer-payments', async (req: Request, res: Response) => {
  try {
    const { customerId, amount, method, accountId, date, note, next } = req.body ?? {};
    if (!customerId) return res.status(400).json({ error: 'Customer is required' });
    const amt = num(amount);
    if (!(amt > 0)) return res.status(400).json({ error: 'Amount must be greater than 0' });
    const payMethod = methodForAmount(method, amt, Boolean(accountId));
    const day = transactionDay(date);
    checkPromiseDay(next);
    const p = await db.$transaction(async t => {
      const acc = await resolveAccount(t, { accountId, method: accountId ? undefined : payMethod });
      const c = await t.customer.findUnique({ where: { id: String(customerId) } });
      if (!c || (c as { deletedAt?: Date | null }).deletedAt) throw Object.assign(new Error('Customer not found'), { status: 400 });
      // No advance/credit architecture exists, so a collection can never push a
      // customer into a negative (advance) balance. Checked INSIDE the same
      // transaction so the rejection is atomic with the future write.
      const [csales, cpays] = await Promise.all([
        t.sale.findMany({ where: { customerId: c.id } }),
        t.customerPayment.findMany({ where: { customerId: c.id } }),
      ]);
      const due = round2(c.openingDue + csales.reduce((s, x) => s + x.total, 0) - cpays.reduce((s, x) => s + x.amount, 0));
      if (round2(amt) > due) throw Object.assign(new Error('Amount exceeds current customer balance'), { status: 400, code: 'PAYMENT_OVERPAY' });
      const created = await t.customerPayment.create({
        data: { customerId: c.id, amount: amt, date: day, note: note ?? null, nextDate: next ?? null },
      });
      // The oldest-invoice-first FIFO pool just grew: re-attribute this
      // customer's invoices inside the same transaction.
      await syncPartyInvoices('sale', c.id, t);
      await recordMovement(t, { accountId: acc.id, method: acc.type, direction: 'in', amount: amt, date: day, sourceType: 'customerPayment', sourceId: created.id });
      if (next) await t.customer.update({ where: { id: c.id }, data: { nextDate: String(next) } });
      return created;
    });
    res.status(201).json({ id: p.id });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Failed to save payment' });
  }
});

// POST /api/vendor-payments { vendorId, amount, method, date?, note?, next? }
tx.post('/vendor-payments', async (req: Request, res: Response) => {
  try {
    const { vendorId, amount, method, accountId, date, note, next } = req.body ?? {};
    if (!vendorId) return res.status(400).json({ error: 'Vendor is required' });
    const amt = num(amount);
    if (!(amt > 0)) return res.status(400).json({ error: 'Amount must be greater than 0' });
    const payMethod = methodForAmount(method, amt, Boolean(accountId));
    const day = transactionDay(date);
    checkPromiseDay(next);
    const p = await db.$transaction(async t => {
      const acc = await resolveAccount(t, { accountId, method: accountId ? undefined : payMethod });
      const v = await t.vendor.findUnique({ where: { id: String(vendorId) } });
      if (!v || (v as { deletedAt?: Date | null }).deletedAt) throw Object.assign(new Error('Vendor not found'), { status: 400 });
      // Serialize same-account money-out work so two payments can never both
      // pass the balance check (same rule the transfer route uses).
      await lockAccounts(t, [acc.id]);
      const [vpurs, vpays] = await Promise.all([
        t.purchase.findMany({ where: { vendorId: v.id } }),
        t.vendorPayment.findMany({ where: { vendorId: v.id } }),
      ]);
      const payable = round2(v.openingPayable + vpurs.reduce((s, x) => s + x.total, 0) - vpays.reduce((s, x) => s + x.amount, 0));
      if (round2(amt) > payable) throw Object.assign(new Error('Amount exceeds current vendor payable'), { status: 400, code: 'PAYMENT_OVERPAY' });
      const available = await accountBalance(t, acc.id);
      if (round2(available) < amt) throw Object.assign(new Error('Not enough money in this account'), { status: 400, code: 'PAYMENT_FUNDS' });
      const created = await t.vendorPayment.create({
        data: { vendorId: v.id, amount: amt, date: day, note: note ?? null, nextDate: next ?? null },
      });
      // FIFO pool grew: re-attribute this vendor's purchases in the same tx.
      await syncPartyInvoices('purchase', v.id, t);
      await recordMovement(t, { accountId: acc.id, method: acc.type, direction: 'out', amount: amt, date: day, sourceType: 'vendorPayment', sourceId: created.id });
      if (next) await t.vendor.update({ where: { id: v.id }, data: { nextDate: String(next) } });
      return created;
    });
    res.status(201).json({ id: p.id });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Failed to save payment' });
  }
});

// GET /api/stock-movements?limit=100
tx.get('/stock-movements', async (req: Request, res: Response) => {
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? '100'), 10) || 100));
  const list = await db.stockMovement.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: limit });
  res.json(list);
});

// GET /api/bootstrap — everything the app needs in one round trip
tx.get('/bootstrap', async (_req: Request, res: Response) => {
  const [products, customers, vendors, sales, purchases, customerPayments, vendorPayments, movements, expenses, rets, balances, accountList, ledger, transfers, todayFinance, lifetime] = await Promise.all([
    db.product.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.customer.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.vendor.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.sale.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.purchase.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.customerPayment.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.vendorPayment.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.stockMovement.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500, include: { product: { select: { name: true, mediumBagKg: true } } } }),
    db.expense.findMany({ where: { deletedAt: null }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.productReturn.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    moneyBalances(),
    accountBalances(),
    db.moneyMovement.findMany({ where: { sourceType: { in: ['expense', 'sale', 'customerPayment', 'vendorPayment'] } }, select: { sourceId: true, sourceType: true, method: true, moneyAccountId: true } }),
    db.moneyTransfer.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 50 }),
    periodFinance('day'),
    lifetimeFinance(),
  ]);
  const retNo = new Map(rets.map(r => [r.id, r.returnNo ?? '']));
  const expMethod = new Map(ledger.filter(m => m.sourceType === 'expense').map(m => [m.sourceId, m]));
  // Payment method for money-in rows: standalone collections and sale-time
  // payments both live in MoneyMovement.
  const inMethod = new Map<string, string>();
  for (const m of ledger) {
    if (m.sourceType === 'customerPayment') inMethod.set(`p:${m.sourceId}`, m.method);
    if (m.sourceType === 'sale') inMethod.set(`s:${m.sourceId}`, m.method);
  }
  // Concrete account of each money-in / money-out row, so payment history in
  // the Customer / Vendor detail can show which Bank & Cash account was used.
  const accById = new Map(accountList.map(a => [a.id, a.name]));
  const inAccount = new Map<string, { accountId: string; accountName: string }>();
  const outAccount = new Map<string, { accountId: string; accountName: string }>();
  for (const m of ledger) {
    if (!m.moneyAccountId) continue;
    const info = { accountId: m.moneyAccountId, accountName: accById.get(m.moneyAccountId) ?? '' };
    if (m.sourceType === 'customerPayment') inAccount.set(m.sourceId, info);
    if (m.sourceType === 'vendorPayment') outAccount.set(m.sourceId, info);
  }
  // Invoice-level COGS from the stored per-line cost snapshots.
  const saleItems = await db.saleItem.findMany({ select: { saleId: true, cogs: true } });
  const cogsBySale = new Map<string, number>();
  for (const it of saleItems) cogsBySale.set(it.saleId, Math.round(((cogsBySale.get(it.saleId) ?? 0) + it.cogs) * 100) / 100);
  // Canonical per-invoice settlement from the SAME rows already loaded above —
  // no extra queries. paid/due/status below are derived, never stored columns.
  const saleSet = buildSettlement(
    sales.map(s => ({ id: s.id, partyId: s.customerId ?? '', date: s.date, total: s.total, createdAt: s.createdAt })),
    rets.filter(r => r.saleId).map(r => ({ invoiceId: r.saleId, amount: r.totalAmount })),
    customerPayments.map(p => ({ partyId: p.customerId ?? '', invoiceId: p.saleId, returnId: p.returnId, date: p.date, amount: p.amount, createdAt: p.createdAt })),
  );
  const purSet = buildSettlement(
    purchases.map(p => ({ id: p.id, partyId: p.vendorId, date: p.date, total: p.total, createdAt: p.createdAt })),
    rets.filter(r => r.purchaseId).map(r => ({ invoiceId: r.purchaseId, amount: r.totalAmount })),
    vendorPayments.map(p => ({ partyId: p.vendorId, invoiceId: p.purchaseId, returnId: p.returnId, date: p.date, amount: p.amount, createdAt: p.createdAt })),
  );
  res.json({
    products: products.map(productJson),
    customers: customers.map(c => ({ id: c.id, code: c.code ?? undefined, name: c.name, mobile: c.mobile, address: c.address ?? undefined, opening: c.openingDue, next: c.nextDate ?? undefined })),
    vendors: vendors.map(v => ({ id: v.id, code: v.code ?? undefined, name: v.name, mobile: v.mobile, address: v.address ?? undefined, opening: v.openingPayable, next: v.nextDate ?? undefined })),
    sales: sales.map(s => {
      const st = saleSet.get(s.id);
      return { id: s.id, customerId: s.customerId ?? undefined, date: s.date, total: s.total, paid: st?.paid ?? s.paid, due: st?.due ?? s.due, status: st?.status ?? 'due', profit: s.profit, cogs: cogsBySale.get(s.id) ?? 0, invoiceNo: s.invoiceNo ?? undefined, createdAt: s.createdAt };
    }),
    purchases: purchases.map(p => {
      const st = purSet.get(p.id);
      return { id: p.id, vendorId: p.vendorId, date: p.date, total: p.total, paid: st?.paid ?? p.paid, due: st?.due ?? p.due, status: st?.status ?? 'due', invoiceNo: p.invoiceNo ?? undefined };
    }),
    customerPayments: customerPayments.map(p => ({ id: p.id, customerId: p.customerId ?? 'cash', amount: p.amount, date: p.date, note: p.note ?? undefined, returnId: p.returnId ?? undefined, returnNo: p.returnId ? retNo.get(p.returnId) : undefined, createdAt: p.createdAt, saleId: p.saleId ?? undefined, method: p.returnId ? undefined : (inMethod.get(`p:${p.id}`) ?? (p.saleId ? inMethod.get(`s:${p.saleId}`) : undefined)), accountId: p.returnId ? undefined : inAccount.get(p.id)?.accountId, accountName: p.returnId ? undefined : inAccount.get(p.id)?.accountName })),
    vendorPayments: vendorPayments.map(p => ({ id: p.id, vendorId: p.vendorId, amount: p.amount, date: p.date, note: p.note ?? undefined, returnId: p.returnId ?? undefined, returnNo: p.returnId ? retNo.get(p.returnId) : undefined, createdAt: p.createdAt, purchaseId: p.purchaseId ?? undefined, accountId: p.returnId ? undefined : outAccount.get(p.id)?.accountId, accountName: p.returnId ? undefined : outAccount.get(p.id)?.accountName })),
    movements: movements.map(mv => ({ id: mv.id, productId: mv.productId, productName: mv.product.name, type: mv.type, qty: mv.qtyKg, bags: mv.product.mediumBagKg > 0 ? round2(mv.qtyKg / mv.product.mediumBagKg) : 0, unitCost: mv.unitCost, bagUnitPrice: round2(mv.unitCost * (mv.product.mediumBagKg || 0)), amount: mv.value, date: mv.date })),
    expenses: expenses.map(e => ({ id: e.id, voucherNo: e.voucherNo ?? undefined, category: e.category, customName: e.customName ?? undefined, amount: e.amount, date: e.date, note: e.note ?? undefined, method: expMethod.get(e.id)?.method, accountId: expMethod.get(e.id)?.moneyAccountId ?? undefined })),
    returns: rets.map(r => ({ id: r.id, kind: r.kind, date: r.date, amount: r.totalAmount, profit: r.profitImpact, returnNo: r.returnNo ?? undefined })),
    money: balances,
    moneyAccounts: accountList,
    // Canonical financial figures: Home/Accounts must not compute profit again.
    finance: { today: todayFinance, lifetime: lifetime },
    transfers: transfers.map(t => ({
      id: t.id, transferNo: t.transferNo,
      fromId: t.fromAccountId ?? t.fromMethod, toId: t.toAccountId ?? t.toMethod,
      from: accountList.find(a => a.id === (t.fromAccountId ?? t.fromMethod))?.name ?? t.fromMethod,
      to: accountList.find(a => a.id === (t.toAccountId ?? t.toMethod))?.name ?? t.toMethod,
      amount: t.amount, date: t.date, note: t.note ?? undefined, createdAt: t.createdAt,
    })),
  });
});
