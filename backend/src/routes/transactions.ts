import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db';
import { toKg, isUnit, transactionDay, checkPromiseDay } from '../units';
import { accountBalance, accountBalances, lockAccounts, methodForAmount, moneyBalances, recordMovement, resolveAccount } from '../money';
import { currentAvgCost, round2, writeMovement } from '../valuation';
import { lifetimeFinance, periodFinance } from '../finance';
import { settleAll, settleParty, syncPartyInvoices, buildSettlement, buildPaymentAllocations } from '../settlement';
import { productJson } from './products';

const num = (v: unknown, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : d;
};

// Preserve the old FIFO application on invoices that already existed when an
// advance was received. Lock those allocations before a new invoice is added,
// so a new invoice is only settled from advance when the user selects it.
async function freezeLegacyAdvanceAllocations(t: TxClient, kind: 'sale' | 'purchase', partyId: string) {
  const isSale = kind === 'sale';
  const [invoices, returns, payments] = await Promise.all([
    isSale ? t.sale.findMany({ where: { customerId: partyId }, select: { id: true, date: true, total: true, createdAt: true } })
      : t.purchase.findMany({ where: { vendorId: partyId }, select: { id: true, date: true, total: true, createdAt: true } }),
    t.productReturn.findMany({ where: isSale ? { kind: 'sale', customerId: partyId } : { kind: 'purchase', vendorId: partyId }, select: { saleId: true, purchaseId: true, totalAmount: true, settlement: true, refundAmount: true } }),
    isSale ? t.customerPayment.findMany({ where: { customerId: partyId, active: true }, select: { id: true, saleId: true, returnId: true, date: true, amount: true, createdAt: true, allocationLocked: true, allocations: { select: { saleId: true, amount: true } } } })
      : t.vendorPayment.findMany({ where: { vendorId: partyId, active: true }, select: { id: true, purchaseId: true, returnId: true, date: true, amount: true, createdAt: true, allocationLocked: true, allocations: { select: { purchaseId: true, amount: true } } } }),
  ]);
  const normalized = payments.map((p: any) => ({ id: p.id, partyId, invoiceId: p.saleId ?? p.purchaseId ?? null, returnId: p.returnId, date: p.date, amount: p.amount, createdAt: p.createdAt, allocationLocked: p.allocationLocked, allocations: (p.allocations ?? []).map((a: any) => ({ invoiceId: a.saleId ?? a.purchaseId, amount: a.amount })) }));
  const computed = buildPaymentAllocations(invoices.map((i: any) => ({ ...i, partyId })), returns.map((r: any) => ({ invoiceId: r.saleId ?? r.purchaseId ?? null, amount: r.totalAmount, settlement: r.settlement, refundAmount: r.refundAmount })), normalized);
  const allocationByPayment = new Map<string, { invoiceId: string; amount: number }[]>();
  for (const [invoiceId, rows] of computed) for (const row of rows) {
    const list = allocationByPayment.get(row.paymentId) ?? [];
    list.push({ invoiceId, amount: row.amount }); allocationByPayment.set(row.paymentId, list);
  }
  for (const payment of payments as any[]) {
    if (payment.saleId || payment.purchaseId || payment.returnId || payment.allocationLocked) continue;
    const rows = allocationByPayment.get(payment.id) ?? [];
    if (isSale) {
      await t.customerPayment.update({ where: { id: payment.id }, data: { allocationLocked: true, allocations: { create: rows.map(row => ({ saleId: row.invoiceId, amount: row.amount })) } } });
    } else {
      await t.vendorPayment.update({ where: { id: payment.id }, data: { allocationLocked: true, allocations: { create: rows.map(row => ({ purchaseId: row.invoiceId, amount: row.amount })) } } });
    }
  }
}

async function applyAdvanceToInvoice(t: TxClient, kind: 'sale' | 'purchase', partyId: string, invoiceId: string, requested: number) {
  const amount = round2(Math.max(0, requested));
  if (!amount) return 0;
  const isSale = kind === 'sale';
  const payments = isSale
    ? await t.customerPayment.findMany({ where: { customerId: partyId, active: true, saleId: null, returnId: null }, include: { allocations: true }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] })
    : await t.vendorPayment.findMany({ where: { vendorId: partyId, active: true, purchaseId: null, returnId: null }, include: { allocations: true }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
  let left = amount;
  let available = 0;
  const candidates = payments.map((p: any) => ({ p, free: round2(Math.max(0, p.amount - p.allocations.reduce((sum: number, a: any) => sum + a.amount, 0))) }));
  for (const c of candidates) available = round2(available + c.free);
  if (available + 0.001 < amount) throw Object.assign(new Error('Selected advance is no longer available'), { status: 400, code: 'ADVANCE_UNAVAILABLE' });
  for (const { p, free } of candidates) {
    const take = round2(Math.min(left, free));
    if (take <= 0) continue;
    if (isSale) await t.customerPayment.update({ where: { id: p.id }, data: { allocationLocked: true, allocations: { create: { saleId: invoiceId, amount: take } } } });
    else await t.vendorPayment.update({ where: { id: p.id }, data: { allocationLocked: true, allocations: { create: { purchaseId: invoiceId, amount: take } } } });
    left = round2(left - take);
    if (left <= 0) break;
  }
  return amount;
}

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

const invoicePaymentDetails = async (
  kind: 'sale' | 'purchase',
  invoiceId: string,
  partyId: string | null | undefined,
) => {
  if (!partyId) return [];
  const [invoices, returns, payments] = kind === 'sale'
    ? await Promise.all([
        db.sale.findMany({ where: { customerId: partyId }, select: { id: true, customerId: true, date: true, total: true, createdAt: true } }),
        db.productReturn.findMany({ where: { kind: 'sale', customerId: partyId }, select: { saleId: true, totalAmount: true, settlement: true, refundAmount: true } }),
        db.customerPayment.findMany({ where: { customerId: partyId, active: true }, select: { id: true, customerId: true, saleId: true, returnId: true, date: true, amount: true, note: true, createdAt: true, allocationLocked: true, allocations: { select: { saleId: true, amount: true } } } }),
      ])
    : await Promise.all([
        db.purchase.findMany({ where: { vendorId: partyId }, select: { id: true, vendorId: true, date: true, total: true, createdAt: true } }),
        db.productReturn.findMany({ where: { kind: 'purchase', vendorId: partyId }, select: { purchaseId: true, totalAmount: true, settlement: true, refundAmount: true } }),
        db.vendorPayment.findMany({ where: { vendorId: partyId, active: true }, select: { id: true, vendorId: true, purchaseId: true, returnId: true, date: true, amount: true, note: true, createdAt: true, allocationLocked: true, allocations: { select: { purchaseId: true, amount: true } } } }),
      ]);
  const allocations = buildPaymentAllocations(
    invoices.map(invoice => ({ id: invoice.id, partyId, date: invoice.date, total: invoice.total, createdAt: invoice.createdAt })),
    returns.map(r => ({ invoiceId: kind === 'sale' ? (r as any).saleId : (r as any).purchaseId, amount: r.totalAmount, settlement: r.settlement as 'credit' | 'refund', refundAmount: r.refundAmount })),
    payments.map(payment => ({ id: payment.id, partyId, invoiceId: kind === 'sale' ? (payment as any).saleId : (payment as any).purchaseId, returnId: payment.returnId, date: payment.date, amount: payment.amount, createdAt: payment.createdAt, allocationLocked: payment.allocationLocked, allocations: payment.allocations.map((a: any) => ({ invoiceId: a.saleId ?? a.purchaseId, amount: a.amount })) })),
  ).get(invoiceId) ?? [];
  if (!allocations.length) return [];
  const ids = [...new Set(allocations.map(row => row.paymentId))];
  const [paymentRows, movementRows] = await Promise.all([
    kind === 'sale'
      ? db.customerPayment.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' }, select: { id: true, paymentNo: true, amount: true, date: true, note: true, saleId: true } })
      : db.vendorPayment.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: 'asc' }, select: { id: true, paymentNo: true, amount: true, date: true, note: true, purchaseId: true } }),
    db.moneyMovement.findMany({
      where: {
        active: true,
        OR: [
          { sourceType: kind === 'sale' ? 'customerPayment' : 'vendorPayment', sourceId: { in: ids } },
          { sourceType: kind === 'sale' ? 'sale' : 'purchase', OR: [{ sourceId: invoiceId }, { sourceId: { startsWith: `${invoiceId}:` } }] },
        ],
      },
      include: { moneyAccount: { select: { id: true, name: true } } },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  const paymentById = new Map(paymentRows.map(row => [row.id, row]));
  const movementById = new Map(movementRows.map(row => [row.sourceId, row]));
  const directPayments = paymentRows.filter(row => Boolean((row as any).saleId ?? (row as any).purchaseId));
  const directMovements = movementRows.filter(row => row.sourceType === (kind === 'sale' ? 'sale' : 'purchase'));
  const directMovementByPaymentId = new Map(directPayments.map((payment, index) => [payment.id, directMovements[index]]));
  return allocations.map(allocation => {
    const payment = paymentById.get(allocation.paymentId);
    const movement = movementById.get(allocation.paymentId) ?? directMovementByPaymentId.get(allocation.paymentId);
    return {
      id: allocation.paymentId,
      paymentNo: payment?.paymentNo,
      amount: allocation.amount,
      date: payment?.date,
      note: payment?.note?.startsWith('[[TRANSPORT_PAYMENT]]')
        ? payment.note.slice('[[TRANSPORT_PAYMENT]]'.length).trimStart()
        : payment?.note ?? undefined,
      accountId: movement?.moneyAccountId ?? undefined,
      accountName: movement?.moneyAccount?.name ?? undefined,
      advance: !((payment as any)?.saleId ?? (payment as any)?.purchaseId),
      transportPayment: payment?.note?.startsWith('[[TRANSPORT_PAYMENT]]') ?? false,
    };
  });
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

// Independent atomic sequences keep customer receipts easy to distinguish
// from supplier payments in ledgers and account statements.
export async function nextPaymentNo(t: TxClient, kind: 'received' | 'payment' = 'payment'): Promise<string> {
  const prefix = kind === 'received' ? 'REC' : 'PAY';
  const rows = await t.$queryRaw<{ last: number }[]>`INSERT INTO "Sequence"("key", "last") VALUES (${prefix}, 1) ON CONFLICT ("key") DO UPDATE SET "last" = "Sequence"."last" + 1 RETURNING "last"`;
  return `${prefix}-${String(rows[0].last).padStart(3, '0')}`;
}

export const tx = Router();

// An invoice edit replaces one posted transaction in-place. To keep AVCO
// history reproducible, only edit when no later stock event touches any of
// the invoice's old or replacement products. Returns are separate posted
// documents and must be resolved before their source invoice can be edited.
async function assertLastStockEvent(t: TxClient, productIds: string[], createdAt: Date, transactionId: string) {
  const ids = [...new Set(productIds)];
  if (!ids.length) return;
  const later = await t.stockMovement.findFirst({
    where: { productId: { in: ids }, createdAt: { gt: createdAt }, OR: [{ refId: null }, { refId: { not: transactionId } }] },
    select: { id: true },
  });
  if (later) throw Object.assign(new Error('This invoice cannot be edited because later stock transactions use its inventory. Create a correcting entry instead.'), { status: 409, code: 'LATER_STOCK_ACTIVITY' });
}

async function editSale(req: Request, res: Response) {
  try {
    const { customerId, lines, discount, paid, transportPaid, transportPaymentNote, accountId, next, date, payments, paymentNote } = req.body ?? {};
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'No items in sale' });
    const day = transactionDay(date);
    checkPromiseDay(next);
    const pay = Math.max(0, num(paid));
    const transportPay = Math.min(pay, Math.max(0, num(transportPaid)));
    const cashPay = Math.max(0, pay - transportPay);
    const split = Array.isArray(payments) ? payments.filter((x: any) => x && num(x.amount) > 0) : null;
    const result = await db.$transaction(async t => {
      const old = await t.sale.findUnique({ where: { id: req.params.id }, include: { items: true, returns: true } });
      if (!old) throw Object.assign(new Error('Sale not found'), { status: 404 });
      if (old.returns.length) throw Object.assign(new Error('Invoices with posted returns cannot be edited.'), { status: 409 });
      if (day !== old.date) throw Object.assign(new Error('The invoice date cannot be changed during edit; use the original date to preserve AVCO history.'), { status: 409 });
      const ids = [...old.items.map(i => i.productId), ...lines.map((l: any) => String(l.productId ?? ''))];
      await assertLastStockEvent(t, ids, old.createdAt, old.id);
      const payAccounts = split ? await Promise.all(split.map((x: any) => resolveAccount(t, { accountId: x.accountId }))) : [];
      const payAccount = !split && cashPay > 0 ? await resolveAccount(t, { accountId, method: accountId ? undefined : 'cash' }) : null;
      const allowNegativeStock = (await t.businessSettings.findUnique({ where: { id: 'main' }, select: { allowNegativeStock: true } }))?.allowNegativeStock ?? false;

      // Undo the old sale into stock at its saved AVCO cost, then repost the
      // edited lines at the AVCO that now applies at this point in history.
      for (const item of old.items) await writeMovement(t, item.productId, { type: 'SALE_EDIT_REVERSAL', bucket: 'sellable', qtyKg: item.qtyKg, unitCost: item.unitCost, date: old.date, refId: old.id });
      const customerPayments = await t.customerPayment.findMany({ where: { saleId: old.id, returnId: null, active: true }, select: { id: true } });
      await t.moneyMovement.updateMany({ where: { sourceType: 'customerPayment', sourceId: { in: customerPayments.map(p => p.id) } }, data: { active: false } });
      await t.customerPayment.updateMany({ where: { id: { in: customerPayments.map(p => p.id) } }, data: { active: false } });
      await t.saleItem.deleteMany({ where: { saleId: old.id } });

      const disc = Math.max(0, num(discount)); let subtotal = 0, cogs = 0;
      const savedItems: any[] = [];
      for (const line of lines) {
        if (!isUnit(line?.unit)) throw Object.assign(new Error('Invalid unit'), { status: 400 });
        const enteredQty = num(line.enteredQty);
        if (!(enteredQty > 0)) throw Object.assign(new Error('Invoice edits cannot add return lines.'), { status: 400 });
        const product = await t.product.findUnique({ where: { id: String(line.productId ?? '') } });
        if (!product || product.deletedAt) throw Object.assign(new Error('Product not found'), { status: 400 });
        const qtyKg = Math.round(toKg(product, line.unit, enteredQty) * 100) / 100;
        const rate = num(line.rate, product.price);
        if (!(rate > 0)) throw Object.assign(new Error('Invalid sale rate'), { status: 400 });
        const currentAvg = await currentAvgCost(t, product.id);
        const becomesNegative = qtyKg > product.qtyKg;
        if (becomesNegative && !allowNegativeStock) throw Object.assign(new Error(`Not enough stock: ${product.name}`), { status: 400 });
        const requestedUnitCost = line.unitCost === undefined ? currentAvg : num(line.unitCost, currentAvg);
        if (requestedUnitCost < 0) throw Object.assign(new Error('Purchase cost cannot be negative.'), { status: 400 });
        const unitCost = becomesNegative ? currentAvg : requestedUnitCost;
        if (!becomesNegative && round2(product.stockValue - qtyKg * unitCost) < -0.01) throw Object.assign(new Error(`Purchase cost exceeds the available inventory value for ${product.name}.`), { status: 400 });
        if (!becomesNegative && qtyKg >= product.qtyKg && Math.abs(product.stockValue - qtyKg * unitCost) > 0.01) throw Object.assign(new Error(`When selling all remaining ${product.name} stock, use its current average cost.`), { status: 400 });
        const lineCogs = round2(qtyKg * unitCost);
        const negativeStockQtyKg = round2(Math.max(0, qtyKg - Math.max(0, product.qtyKg)));
        subtotal = round2(subtotal + qtyKg * rate); cogs = round2(cogs + lineCogs);
        savedItems.push({ productId: product.id, unit: line.unit, enteredQty, qtyKg, rate, unitCost, cogs: lineCogs, negativeStockQtyKg });
        const customCostNote = Math.abs(unitCost - currentAvg) >= 0.01;
        const nextAverage = product.qtyKg - qtyKg > 0 ? round2((product.stockValue - qtyKg * unitCost) / (product.qtyKg - qtyKg)) : unitCost;
        await writeMovement(t, product.id, {
          type: 'SALE', bucket: 'sellable', qtyKg: -qtyKg, unitCost, date: day, refId: old.id,
          forceUnitCost: true,
          note: customCostNote ? `Invoice purchase cost override: average ${currentAvg.toFixed(2)} -> ${nextAverage.toFixed(2)} per kg.` : null,
        });
      }
      const total = Math.max(0, round2(subtotal - disc));
      const cappedPay = Math.min(pay, total); const due = round2(total - cappedPay);
      const cappedTransportPay = Math.min(transportPay, cappedPay);
      const cappedCashPay = Math.max(0, round2(cappedPay - cappedTransportPay));
      let validCustomerId: string | null = null;
      if (customerId) {
        const c = await t.customer.findUnique({ where: { id: String(customerId) } });
        if (c && !c.deletedAt) validCustomerId = c.id;
      }
      if (due > 0 && !validCustomerId) throw Object.assign(new Error('Customer is required when there is a due'), { status: 400 });
      await t.sale.update({ where: { id: old.id }, data: { customerId: validCustomerId, date: day, discount: disc, total, paid: cappedPay, due, profit: round2(total - cogs), nextDate: next || null, items: { create: savedItems } } });

      const postPayment = async (amount: number, acc: any) => {
        const payment = await t.customerPayment.create({ data: { paymentNo: await nextPaymentNo(t, 'received'), customerId: validCustomerId, saleId: old.id, amount, date: day, note: paymentNote ?? null } });
        await recordMovement(t, { accountId: acc.id, method: acc.type, direction: 'in', amount, date: day, sourceType: 'customerPayment', sourceId: payment.id, note: paymentNote ?? old.invoiceNo });
      };
      if (split) {
        let remaining = cappedCashPay;
        for (let i = 0; i < split.length && remaining > 0; i++) { const amount = round2(Math.min(remaining, num(split[i].amount))); if (amount > 0) { await postPayment(amount, payAccounts[i]); remaining = round2(remaining - amount); } }
      } else if (payAccount && cappedCashPay > 0) await postPayment(cappedCashPay, payAccount);
      if (cappedTransportPay > 0) await t.customerPayment.create({ data: {
        paymentNo: await nextPaymentNo(t, 'received'), customerId: validCustomerId, saleId: old.id,
        amount: cappedTransportPay, date: day, note: `[[TRANSPORT_PAYMENT]] ${transportPaymentNote ?? 'Transport payment (paid directly by customer)'}`,
      } });
      if (old.customerId && old.customerId !== validCustomerId) await syncPartyInvoices('sale', old.customerId, t);
      if (validCustomerId) await syncPartyInvoices('sale', validCustomerId, t);
      return { id: old.id, invoiceNo: old.invoiceNo, total };
    });
    res.json(result);
  } catch (e: unknown) { const err = e as { status?: number; message?: string; code?: string }; res.status(err.status ?? 500).json({ error: err.message ?? 'Failed to edit sale', code: err.code }); }
}

async function editPurchase(req: Request, res: Response) {
  try {
    const { vendorId, lines, paid, accountId, date, next, payments, paymentNote } = req.body ?? {};
    if (!vendorId) return res.status(400).json({ error: 'Vendor is required' });
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'No items in purchase' });
    const day = transactionDay(date); checkPromiseDay(next);
    const pay = Math.max(0, num(paid));
    const split = Array.isArray(payments) ? payments.filter((x: any) => x && num(x.amount) > 0) : null;
    const result = await db.$transaction(async t => {
      const old = await t.purchase.findUnique({ where: { id: req.params.id }, include: { items: true, returns: true } });
      if (!old) throw Object.assign(new Error('Purchase not found'), { status: 404 });
      if (old.returns.length) throw Object.assign(new Error('Invoices with posted returns cannot be edited.'), { status: 409 });
      const negativeCostResolution = await t.stockMovement.findFirst({ where: { refId: old.id, type: 'NEGATIVE_STOCK_COGS_ADJUSTMENT' }, select: { id: true } });
      if (negativeCostResolution) throw Object.assign(new Error('This purchase resolved negative-stock sale costs and cannot be edited. Create a correcting purchase instead.'), { status: 409 });
      if (day !== old.date) throw Object.assign(new Error('The invoice date cannot be changed during edit; use the original date to preserve AVCO history.'), { status: 409 });
      const ids = [...old.items.map(i => i.productId), ...lines.map((l: any) => String(l.productId ?? ''))];
      await assertLastStockEvent(t, ids, old.createdAt, old.id);
      const vendor = await t.vendor.findUnique({ where: { id: String(vendorId) } });
      if (!vendor || vendor.deletedAt) throw Object.assign(new Error('Vendor not found'), { status: 400 });
      const payAccounts = split ? await Promise.all(split.map((x: any) => resolveAccount(t, { accountId: x.accountId }))) : [];
      const payAccount = !split && pay > 0 ? await resolveAccount(t, { accountId, method: accountId ? undefined : 'cash' }) : null;

      // Remove the prior receipt from inventory at its saved landed unit cost.
      for (const item of old.items) await writeMovement(t, item.productId, { type: 'PURCHASE_EDIT_REVERSAL', bucket: 'sellable', qtyKg: -item.qtyKg, unitCost: item.unitCost, date: old.date, forceUnitCost: true, refId: old.id });
      const oldPayments = await t.vendorPayment.findMany({ where: { purchaseId: old.id, returnId: null, active: true }, select: { id: true } });
      await t.moneyMovement.updateMany({ where: { sourceType: 'purchase', sourceId: { startsWith: old.id }, active: true }, data: { active: false } });
      await t.vendorPayment.updateMany({ where: { id: { in: oldPayments.map(p => p.id) } }, data: { active: false } });
      await t.purchaseItem.deleteMany({ where: { purchaseId: old.id } });

      let total = 0; const savedItems: any[] = [];
      for (const line of lines) {
        if (!isUnit(line?.unit)) throw Object.assign(new Error('Invalid unit'), { status: 400 });
        const enteredQty = num(line.enteredQty);
        if (!(enteredQty > 0)) throw Object.assign(new Error('Invoice edits cannot add return lines.'), { status: 400 });
        const product = await t.product.findUnique({ where: { id: String(line.productId ?? '') } });
        if (!product || product.deletedAt) throw Object.assign(new Error('Product not found'), { status: 400 });
        const qtyKg = Math.round(toKg(product, line.unit, enteredQty) * 100) / 100;
        const rate = num(line.rate, product.cost);
        if (!(rate >= 0)) throw Object.assign(new Error('Invalid purchase rate'), { status: 400 });
        const otherCost = Math.max(0, num(line.otherCost ?? line.otherCostPerBag));
        const unitCost = round2(rate + otherCost / (product.mediumBagKg || 50));
        total = round2(total + qtyKg * rate);
        savedItems.push({ productId: product.id, unit: line.unit, enteredQty, qtyKg, rate, unitCost, otherCost });
        await writeMovement(t, product.id, { type: 'PURCHASE', bucket: 'sellable', qtyKg, unitCost, date: day, refId: old.id });
      }
      const cappedPay = Math.min(pay, total); const due = round2(total - cappedPay);
      await t.purchase.update({ where: { id: old.id }, data: { vendorId: vendor.id, date: day, total, paid: cappedPay, due, nextDate: next || null, items: { create: savedItems } } });
      const postPayment = async (amount: number, acc: any) => {
        const payment = await t.vendorPayment.create({ data: { paymentNo: await nextPaymentNo(t), vendorId: vendor.id, purchaseId: old.id, amount, date: day, note: paymentNote ?? null } });
        await recordMovement(t, { accountId: acc.id, method: acc.type, direction: 'out', amount, date: day, sourceType: 'purchase', sourceId: `${old.id}:${payment.id}`, note: paymentNote ?? old.invoiceNo });
      };
      if (split) {
        let remaining = cappedPay;
        for (let i = 0; i < split.length && remaining > 0; i++) { const amount = round2(Math.min(remaining, num(split[i].amount))); if (amount > 0) { await postPayment(amount, payAccounts[i]); remaining = round2(remaining - amount); } }
      } else if (payAccount && cappedPay > 0) await postPayment(cappedPay, payAccount);
      if (old.vendorId !== vendor.id) await syncPartyInvoices('purchase', old.vendorId, t);
      await syncPartyInvoices('purchase', vendor.id, t);
      return { id: old.id, invoiceNo: old.invoiceNo, total };
    });
    res.json(result);
  } catch (e: unknown) { const err = e as { status?: number; message?: string; code?: string }; res.status(err.status ?? 500).json({ error: err.message ?? 'Failed to edit purchase', code: err.code }); }
}

async function deleteLinkedInvoiceExpenses(t: TxClient, invoiceNo?: string | null) {
  if (!invoiceNo) return 0;
  const linked = await t.expense.findMany({ where: { deletedAt: null, note: { contains: `#${invoiceNo}` } }, select: { id: true } });
  if (!linked.length) return 0;
  const ids = linked.map(row => row.id);
  await t.expense.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
  await t.moneyMovement.updateMany({ where: { sourceType: 'expense', sourceId: { in: ids } }, data: { active: false } });
  return linked.length;
}

// Remove the invoice's stock history and rebuild the product cache from the
// remaining ledger rows. Deletion is allowed only when no later stock event
// depends on these products, so this restores the state as if the invoice had
// never been posted.
async function removeInvoiceStockHistory(t: TxClient, productIds: string[], invoiceId: string) {
  const linked = await t.stockMovement.findMany({ where: { refId: invoiceId }, select: { productId: true } });
  const ids = [...new Set([...productIds, ...linked.map(row => row.productId)])];
  if (!ids.length) return;
  await t.stockMovement.deleteMany({ where: { refId: invoiceId } });
  for (const productId of ids) {
    const [product, rows] = await Promise.all([
      t.product.findUnique({ where: { id: productId }, select: { cost: true } }),
      t.stockMovement.findMany({ where: { productId }, select: { bucket: true, qtyKg: true, value: true, unitCost: true }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] }),
    ]);
    if (!product) continue;
    let qtyKg = 0, stockValue = 0, damagedQtyKg = 0, damagedValue = 0, lastSellableCost = product.cost;
    for (const movement of rows) {
      if (movement.bucket === 'damaged') {
        damagedQtyKg += movement.qtyKg;
        damagedValue += movement.value;
      } else {
        qtyKg += movement.qtyKg;
        stockValue += movement.value;
        if (movement.qtyKg !== 0) lastSellableCost = movement.unitCost;
      }
    }
    qtyKg = round2(qtyKg); stockValue = round2(stockValue);
    damagedQtyKg = round2(damagedQtyKg); damagedValue = round2(damagedValue);
    await t.product.update({ where: { id: productId }, data: {
      qtyKg, stockValue, damagedQtyKg, damagedValue,
      cost: qtyKg > 0 ? round2(stockValue / qtyKg) : lastSellableCost,
    } });
  }
}

async function keepDeletedInvoiceAdvances(t: TxClient, kind: 'sale' | 'purchase', invoiceId: string) {
  if (kind === 'sale') {
    const allocations = await t.customerPaymentAllocation.findMany({ where: { saleId: invoiceId }, select: { paymentId: true } });
    for (const { paymentId } of allocations) {
      const other = await t.customerPaymentAllocation.count({ where: { paymentId, saleId: { not: invoiceId } } });
      if (!other) await t.customerPayment.update({ where: { id: paymentId }, data: { allocationLocked: false } });
    }
  } else {
    const allocations = await t.vendorPaymentAllocation.findMany({ where: { purchaseId: invoiceId }, select: { paymentId: true } });
    for (const { paymentId } of allocations) {
      const other = await t.vendorPaymentAllocation.count({ where: { paymentId, purchaseId: { not: invoiceId } } });
      if (!other) await t.vendorPayment.update({ where: { id: paymentId }, data: { allocationLocked: false } });
    }
  }
}

async function deleteSale(req: Request, res: Response) {
  try {
    const result = await db.$transaction(async t => {
      const old = await t.sale.findUnique({ where: { id: req.params.id }, include: { items: true, returns: true, customer: { select: { name: true } } } });
      if (!old) throw Object.assign(new Error('Sale not found'), { status: 404 });
      if (old.returns.length) throw Object.assign(new Error('This invoice has posted returns and cannot be deleted. Create a correcting entry instead.'), { status: 409 });
      const stockRows = await t.stockMovement.findMany({ where: { refId: old.id }, select: { productId: true } });
      await assertLastStockEvent(t, [...old.items.map(item => item.productId), ...stockRows.map(row => row.productId)], old.createdAt, old.id);
      await keepDeletedInvoiceAdvances(t, 'sale', old.id);
      await removeInvoiceStockHistory(t, old.items.map(item => item.productId), old.id);
      const payments = await t.customerPayment.findMany({ where: { saleId: old.id, returnId: null }, select: { id: true } });
      await t.moneyMovement.deleteMany({ where: { OR: [
        { sourceType: 'customerPayment', sourceId: { in: payments.map(payment => payment.id) } },
        { sourceType: 'sale', OR: [{ sourceId: old.id }, { sourceId: { startsWith: `${old.id}:` } }] },
      ] } });
      await t.customerPayment.deleteMany({ where: { saleId: old.id, returnId: null } });
      const deletedExpenses = await deleteLinkedInvoiceExpenses(t, old.invoiceNo);
      await t.sale.delete({ where: { id: old.id } });
      if (old.customerId) await syncPartyInvoices('sale', old.customerId, t);
      return { id: old.id, invoiceNo: old.invoiceNo, total: old.total, partyName: old.customer?.name ?? '', removedItems: old.items.length, removedPayments: payments.length, deletedExpenses };
    });
    res.json({ ...result, deleted: true, note: 'Invoice and its direct payments and stock history were removed; allocated party advances were retained.' });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string; code?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Failed to delete sale', code: err.code });
  }
}

async function deletePurchase(req: Request, res: Response) {
  try {
    const result = await db.$transaction(async t => {
      const old = await t.purchase.findUnique({ where: { id: req.params.id }, include: { items: true, returns: true, vendor: { select: { name: true } } } });
      if (!old) throw Object.assign(new Error('Purchase not found'), { status: 404 });
      if (old.returns.length) throw Object.assign(new Error('This invoice has posted returns and cannot be deleted. Create a correcting entry instead.'), { status: 409 });
      const negativeCostResolution = await t.stockMovement.findFirst({ where: { refId: old.id, type: 'NEGATIVE_STOCK_COGS_ADJUSTMENT' }, select: { id: true } });
      if (negativeCostResolution) throw Object.assign(new Error('This purchase resolved negative stock costs and cannot be deleted. Create a correcting entry instead.'), { status: 409 });
      const stockRows = await t.stockMovement.findMany({ where: { refId: old.id }, select: { productId: true } });
      await assertLastStockEvent(t, [...old.items.map(item => item.productId), ...stockRows.map(row => row.productId)], old.createdAt, old.id);
      await keepDeletedInvoiceAdvances(t, 'purchase', old.id);
      await removeInvoiceStockHistory(t, old.items.map(item => item.productId), old.id);
      const payments = await t.vendorPayment.findMany({ where: { purchaseId: old.id, returnId: null }, select: { id: true } });
      await t.moneyMovement.deleteMany({ where: { OR: [
        { sourceType: 'purchase', OR: [{ sourceId: old.id }, { sourceId: { startsWith: `${old.id}:` } }] },
        { sourceType: 'vendorPayment', sourceId: { in: payments.map(payment => payment.id) } },
      ] } });
      await t.vendorPayment.deleteMany({ where: { purchaseId: old.id, returnId: null } });
      const deletedExpenses = await deleteLinkedInvoiceExpenses(t, old.invoiceNo);
      await t.purchase.delete({ where: { id: old.id } });
      await syncPartyInvoices('purchase', old.vendorId, t);
      return { id: old.id, invoiceNo: old.invoiceNo, total: old.total, partyName: old.vendor.name, removedItems: old.items.length, removedPayments: payments.length, deletedExpenses };
    });
    res.json({ ...result, deleted: true, note: 'Invoice and its direct payments and stock history were removed; allocated party advances were retained.' });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string; code?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Failed to delete purchase', code: err.code });
  }
}

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
      customer: { select: { id: true, name: true, mobile: true } },
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
    productId: it.productId,
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

  const displayPaid = Math.min(netTotal, Math.max(0, round2(st?.paid ?? s.paid)));
  const displayDue = Math.max(0, round2(st?.due ?? (netTotal - displayPaid)));
  res.json({
    id: s.id, invoiceNo: s.invoiceNo, date: s.date, createdAt: s.createdAt,
    discount: s.discount,
    total: returnTotal > 0 ? netTotal : s.total,
    paid: returnTotal > 0 ? displayPaid : (st?.paid ?? s.paid),
    due: returnTotal > 0 ? displayDue : (st?.due ?? s.due),
    status: st?.status,
    nextDate: s.nextDate ?? undefined,
    customer: s.customer ? { id: s.customer.id, name: s.customer.name, mobile: s.customer.mobile } : null,
    items: [...regularItems, ...retItems],
    returns: s.returns.map(r => ({ id: r.id, returnNo: r.returnNo, date: r.date, amount: r.totalAmount })),
    payment: await paymentOf('sale', s.id),
    payments: await invoicePaymentDetails('sale', s.id, s.customerId),
  });
});

tx.put('/sales/:id', editSale);
tx.delete('/sales/:id', deleteSale);

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
    const { customerId, lines, discount, paid, transportPaid, transportPaymentNote, method, accountId, next, date, memoNo, paymentNote, advanceToApply } = req.body ?? {};
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'No items in sale' });
    const day = transactionDay(date);
    checkPromiseDay(next);
    const pay = Math.max(0, num(paid));
    const transportPay = Math.min(pay, Math.max(0, num(transportPaid)));
    const cashPay = Math.max(0, pay - transportPay);
    const payMethod = methodForAmount(method, cashPay, Boolean(accountId));
    const splitPayments = Array.isArray(req.body.payments) ? req.body.payments.filter((x: any) => x && num(x.amount) > 0) : null;
    const disc = Math.max(0, num(discount));
    const result = await db.$transaction(async t => {
      // Money only moves for the amount actually received; the concrete account
      // is resolved once and used by the ledger entry below.
      const payAccount = !splitPayments && cashPay > 0 ? await resolveAccount(t, { accountId, method: accountId ? undefined : payMethod }) : null;
      const splitAccounts = splitPayments ? await Promise.all(splitPayments.map((x: any) => resolveAccount(t, { accountId: x.accountId }))) : [];
      const allowNegativeStock = (await t.businessSettings.findUnique({ where: { id: 'main' }, select: { allowNegativeStock: true } }))?.allowNegativeStock ?? false;
      let sub = 0, cogs = 0;
      let returnTotalAmount = 0, returnCogsReversed = 0;
      const items: { productId: string; unit: string; enteredQty: number; qtyKg: number; rate: number; unitCost: number; cogs: number; negativeStockQtyKg: number }[] = [];
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
        const currentAvg = await currentAvgCost(t, p.id);
        // The invoice purchase-price field is the chosen COGS/inventory issue
        // cost. When omitted, use the current moving average.
        const requestedUnitCost = entered > 0 && l.unitCost !== undefined ? num(l.unitCost, currentAvg) : currentAvg;
        if (requestedUnitCost < 0) throw Object.assign(new Error('Purchase cost cannot be negative.'), { status: 400 });

        if (entered > 0) {
          // Standard sale line
          const qtyKg = Math.round(toKg(p, l.unit, entered) * 100) / 100;
          const becomesNegative = qtyKg > p.qtyKg;
          if (becomesNegative && !allowNegativeStock) throw Object.assign(new Error(`Not enough stock: ${p.name}`), { status: 400 });
          const unitCost = becomesNegative ? currentAvg : requestedUnitCost;
          if (!becomesNegative && round2(p.stockValue - qtyKg * unitCost) < -0.01) throw Object.assign(new Error(`Purchase cost exceeds the available inventory value for ${p.name}.`), { status: 400 });
          if (!becomesNegative && qtyKg >= p.qtyKg && Math.abs(p.stockValue - qtyKg * unitCost) > 0.01) throw Object.assign(new Error(`When selling all remaining ${p.name} stock, use its current average cost.`), { status: 400 });
          const lineCogs = round2(qtyKg * unitCost);
          const negativeStockQtyKg = round2(Math.max(0, qtyKg - Math.max(0, p.qtyKg)));
          cogs += lineCogs;
          sub += round2(qtyKg * rate);
          items.push({ productId: p.id, unit: l.unit, enteredQty: entered, qtyKg, rate, unitCost, cogs: lineCogs, negativeStockQtyKg });
          // Selling leaves quantity AND inventory value (AVCO out).
          const customCostNote = Math.abs(unitCost - currentAvg) >= 0.01;
          const nextAverage = p.qtyKg - qtyKg > 0 ? round2((p.stockValue - qtyKg * unitCost) / (p.qtyKg - qtyKg)) : unitCost;
          await writeMovement(t, p.id, {
            type: 'SALE', bucket: 'sellable', qtyKg: -qtyKg, unitCost, date: day,
            forceUnitCost: true,
            note: customCostNote ? `Invoice purchase cost override: ${currentAvg.toFixed(2)} -> ${nextAverage.toFixed(2)} per kg.` : null,
          });
        } else {
          // Negative quantity => SALES RETURN line
          const absEntered = Math.abs(entered);
          const returnKg = Math.round(toKg(p, l.unit, absEntered) * 100) / 100;
          const lineAmount = round2(returnKg * rate);
          const unitCost = requestedUnitCost;
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
      const cappedTransportPay = Math.min(transportPay, cappedPay);
      const cappedCashPay = Math.max(0, round2(cappedPay - cappedTransportPay));
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

      if (validCustomerId) await freezeLegacyAdvanceAllocations(t, 'sale', validCustomerId);

      const sale = await t.sale.create({
        data: {
          customerId: validCustomerId, date: day, discount: disc,
          total: grossTotal,
          paid: cappedPay,
          due,
          profit: round2(grossTotal - cogs),
          nextDate: next ?? null, invoiceNo: resolvedInvoiceNo, advanceAllocationControlled: true,
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
              paymentNo: await nextPaymentNo(t, 'received'),
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

      if (splitPayments) {
        let remaining = cappedCashPay;
        for (let i = 0; i < splitPayments.length && remaining > 0; i++) {
          const amount = round2(Math.min(remaining, num(splitPayments[i].amount)));
          if (!(amount > 0)) continue;
          const acc = splitAccounts[i];
          const payment = await t.customerPayment.create({
            data: { paymentNo: await nextPaymentNo(t, 'received'), customerId: validCustomerId, saleId: sale.id, amount, date: day, note: paymentNote ?? null },
          });
          await recordMovement(t, {
            accountId: acc.id, method: acc.type, direction: 'in', amount, date: day,
            sourceType: 'customerPayment', sourceId: payment.id, note: paymentNote ?? sale.invoiceNo,
          });
          remaining = round2(remaining - amount);
        }
      } else if (payAccount && cappedCashPay > 0) {
        const payment = await t.customerPayment.create({
          data: { paymentNo: await nextPaymentNo(t, 'received'), customerId: validCustomerId, saleId: sale.id, amount: cappedCashPay, date: day, note: paymentNote ?? null },
        });
        await recordMovement(t, {
          accountId: payAccount.id, method: payAccount.type, direction: 'in', amount: cappedCashPay, date: day,
          sourceType: 'customerPayment', sourceId: payment.id, note: paymentNote ?? sale.invoiceNo,
        });
      }
      if (cappedTransportPay > 0) await t.customerPayment.create({ data: {
        paymentNo: await nextPaymentNo(t, 'received'), customerId: validCustomerId, saleId: sale.id,
        amount: cappedTransportPay, date: day, note: `[[TRANSPORT_PAYMENT]] ${transportPaymentNote ?? 'Transport payment (paid directly by customer)'}`,
      } });
      let advanceApplied = 0;
      if (validCustomerId && num(advanceToApply) > 0) {
        const applyAmount = Math.min(round2(num(advanceToApply)), due);
        advanceApplied = await applyAdvanceToInvoice(t, 'sale', validCustomerId, sale.id, applyAmount);
      }
      if (validCustomerId && next) await t.customer.update({ where: { id: validCustomerId }, data: { nextDate: String(next) } });
      if (validCustomerId) await syncPartyInvoices('sale', validCustomerId, t);
      return { id: sale.id, invoiceNo: sale.invoiceNo, total: netInvoiceTotal, returnNo: createdReturn?.returnNo, advanceApplied };
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
      vendor: { select: { id: true, name: true, mobile: true } },
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
    productId: it.productId,
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

  const displayPaid = Math.min(netTotal, Math.max(0, round2(st?.paid ?? p.paid)));
  const displayDue = Math.max(0, round2(st?.due ?? (netTotal - displayPaid)));
  res.json({
    id: p.id, invoiceNo: p.invoiceNo, date: p.date, createdAt: p.createdAt,
    total: returnTotal > 0 ? netTotal : p.total,
    paid: returnTotal > 0 ? displayPaid : (st?.paid ?? p.paid),
    due: returnTotal > 0 ? displayDue : (st?.due ?? p.due),
    status: st?.status,
    nextDate: p.nextDate ?? undefined,
    vendor: { id: p.vendor.id, name: p.vendor.name, mobile: p.vendor.mobile },
    items: [...regularItems, ...retItems],
    payment: await paymentOf('purchase', p.id),
    payments: await invoicePaymentDetails('purchase', p.id, p.vendorId),
    returns: p.returns.map(r => ({ id: r.id, returnNo: r.returnNo, date: r.date, amount: r.totalAmount })),
  });
});

tx.put('/purchases/:id', editPurchase);
tx.delete('/purchases/:id', deletePurchase);

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
    const { vendorId, lines, paid, method, accountId, next, date, memoNo, paymentNote, advanceToApply } = req.body ?? {};
    if (!vendorId) return res.status(400).json({ error: 'Vendor is required' });
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'No items in purchase' });
    const day = transactionDay(date);
    checkPromiseDay(next);
    const pay = Math.max(0, num(paid));
    const splitPayments = Array.isArray(req.body.payments) ? req.body.payments.filter((x: any) => x && num(x.amount) > 0) : null;
    const payMethod = methodForAmount(method, pay, Boolean(accountId));
    const result = await db.$transaction(async t => {
      const purchaseId = randomUUID();
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
            type: 'PURCHASE', bucket: 'sellable', qtyKg, unitCost: buyerCostPerKg, date: day, refId: purchaseId,
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

      await freezeLegacyAdvanceAllocations(t, 'purchase', String(vendorId));

      const pur = await t.purchase.create({
        data: {
          id: purchaseId,
          vendorId: String(vendorId), date: day,
          total: grossTotal,
          paid: cappedPayP,
          due,
          nextDate: next ?? null, invoiceNo: resolvedPurInvoiceNo, advanceAllocationControlled: true,
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
            paymentNo: await nextPaymentNo(t),
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
          await t.vendorPayment.create({ data: { paymentNo: await nextPaymentNo(t), vendorId: String(vendorId), purchaseId: pur.id, amount, date: day, note: paymentNote ?? null } });
          await recordMovement(t, { accountId: acc.id, method: acc.type, direction: 'out', amount, date: day, sourceType: 'purchase', sourceId: pur.id + ':' + i, note: paymentNote ?? pur.invoiceNo });
          remaining = round2(remaining - amount);
        }
      } else if (payAccount) {
        await t.vendorPayment.create({
          data: { paymentNo: await nextPaymentNo(t), vendorId: String(vendorId), purchaseId: pur.id, amount: cappedPayP, date: day, note: paymentNote ?? null },
        });
        await recordMovement(t, {
          accountId: payAccount.id, method: payAccount.type, direction: 'out', amount: cappedPayP, date: day,
          sourceType: 'purchase', sourceId: pur.id, note: paymentNote ?? pur.invoiceNo,
        });
      }
      let advanceApplied = 0;
      if (num(advanceToApply) > 0) {
        const applyAmount = Math.min(round2(num(advanceToApply)), due);
        advanceApplied = await applyAdvanceToInvoice(t, 'purchase', String(vendorId), pur.id, applyAmount);
      }
      if (next) await t.vendor.update({ where: { id: String(vendorId) }, data: { nextDate: String(next) } });
      // Same-transaction re-materialization of this vendor's stored paid/due.
      await syncPartyInvoices('purchase', String(vendorId), t);
      return { id: pur.id, invoiceNo: pur.invoiceNo, total: netInvoiceTotal, returnNo: createdPurReturn?.returnNo, advanceApplied };
    });
    res.status(201).json(result);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Failed to create purchase' });
  }
});

// One confirmed customer/vendor entry may be split between its cash and bank ledgers.
tx.post('/party-payments/split', async (req: Request, res: Response) => {
  try {
    const { kind, partyId, payments, date, note } = req.body ?? {};
    if (!['c', 'v'].includes(kind) || typeof partyId !== 'string' || !partyId || !Array.isArray(payments) || !payments.length || payments.length > 2) {
      return res.status(400).json({ error: 'Select a customer or supplier and enter a cash or bank amount.' });
    }
    const rows = payments.map((p: any) => ({ accountId: String(p?.accountId ?? ''), amount: round2(num(p?.amount)) })).filter((p: any) => p.amount > 0);
    if (!rows.length || rows.some((p: any) => !p.accountId) || (note !== undefined && (typeof note !== 'string' || note.length > 500))) {
      return res.status(400).json({ error: 'Enter at least one valid cash or bank amount.' });
    }
    const day = transactionDay(date);
    const result = await db.$transaction(async t => {
      await lockAccounts(t, rows.map((p: any) => p.accountId));
      const accounts = await Promise.all(rows.map((p: any) => t.moneyAccount.findUnique({ where: { id: p.accountId } })));
      for (let i = 0; i < rows.length; i++) {
        const account = accounts[i];
        if (!account?.active || !['cash', 'bank'].includes(account.type)) throw Object.assign(new Error('Choose an active cash or bank account.'), { status: 400 });
      }
      const isCustomer = kind === 'c';
      const party = isCustomer
        ? await t.customer.findUnique({ where: { id: partyId } })
        : await t.vendor.findUnique({ where: { id: partyId } });
      if (!party || party.deletedAt) throw Object.assign(new Error(isCustomer ? 'Customer not found' : 'Supplier not found'), { status: 400 });
      if (!isCustomer) {
        const totals = new Map<string, number>();
        rows.forEach((p: any) => totals.set(p.accountId, round2((totals.get(p.accountId) ?? 0) + p.amount)));
        for (const [accountId, amount] of totals) {
          if (round2(await accountBalance(t, accountId)) < amount) throw Object.assign(new Error('Not enough money in this account'), { status: 400, code: 'PAYMENT_FUNDS' });
        }
      }
      const created: { id: string; paymentNo: string; amount: number; accountId: string }[] = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i], account = accounts[i]!;
        const paymentNo = await nextPaymentNo(t, kind === 'c' ? 'received' : 'payment');
        const payment = isCustomer
          ? await t.customerPayment.create({ data: { paymentNo, customerId: partyId, amount: row.amount, date: day, note: note?.trim() || null } })
          : await t.vendorPayment.create({ data: { paymentNo, vendorId: partyId, amount: row.amount, date: day, note: note?.trim() || null } });
        await recordMovement(t, { accountId: account.id, method: account.type, direction: isCustomer ? 'in' : 'out', amount: row.amount, date: day, sourceType: isCustomer ? 'customerPayment' : 'vendorPayment', sourceId: payment.id, note: note?.trim() || null });
        created.push({ id: payment.id, paymentNo, amount: row.amount, accountId: account.id });
      }
      await syncPartyInvoices(isCustomer ? 'sale' : 'purchase', partyId, t);
      return created;
    });
    res.status(201).json({ payments: result });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string; code?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Could not save collection or payment', code: err.code });
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
      const created = await t.customerPayment.create({
        data: { paymentNo: await nextPaymentNo(t, 'received'), customerId: c.id, amount: amt, date: day, note: note ?? null, nextDate: next ?? null },
      });
      // The oldest-invoice-first FIFO pool just grew: re-attribute this
      // customer's invoices inside the same transaction.
      await syncPartyInvoices('sale', c.id, t);
      await recordMovement(t, { accountId: acc.id, method: acc.type, direction: 'in', amount: amt, date: day, sourceType: 'customerPayment', sourceId: created.id, note: note ?? null });
      if (next) await t.customer.update({ where: { id: c.id }, data: { nextDate: String(next) } });
      return created;
    });
    res.status(201).json({ id: p.id, paymentNo: p.paymentNo });
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
      const available = await accountBalance(t, acc.id);
      if (round2(available) < amt) throw Object.assign(new Error('Not enough money in this account'), { status: 400, code: 'PAYMENT_FUNDS' });
      const created = await t.vendorPayment.create({
        data: { paymentNo: await nextPaymentNo(t), vendorId: v.id, amount: amt, date: day, note: note ?? null, nextDate: next ?? null },
      });
      // FIFO pool grew: re-attribute this vendor's purchases in the same tx.
      await syncPartyInvoices('purchase', v.id, t);
      await recordMovement(t, { accountId: acc.id, method: acc.type, direction: 'out', amount: amt, date: day, sourceType: 'vendorPayment', sourceId: created.id, note: note ?? null });
      if (next) await t.vendor.update({ where: { id: v.id }, data: { nextDate: String(next) } });
      return created;
    });
    res.status(201).json({ id: p.id, paymentNo: p.paymentNo });
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
  const [products, customers, vendors, sales, purchases, customerPayments, vendorPayments, movements, expenses, rets, balances, accountList, ledger, transfers, todayFinance, lifetime, stockAdjustments, saleLines, purchaseLines] = await Promise.all([
    db.product.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.customer.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.vendor.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.sale.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.purchase.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.customerPayment.findMany({ where: { active: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.vendorPayment.findMany({ where: { active: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.stockMovement.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500, include: { product: { select: { name: true, mediumBagKg: true } } } }),
    db.expense.findMany({ where: { deletedAt: null }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.productReturn.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    moneyBalances(),
    accountBalances(),
    db.moneyMovement.findMany({ where: { active: true, sourceType: { in: ['expense', 'sale', 'customerPayment', 'vendorPayment', 'purchase'] } }, select: { sourceId: true, sourceType: true, method: true, moneyAccountId: true, transactionNo: true } }),
    db.moneyTransfer.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 50 }),
    periodFinance('day'),
    lifetimeFinance(),
    db.stockMovement.findMany({ where: { type: { in: ['ADJUSTMENT', 'REVALUE'] }, bucket: 'sellable' }, include: { product: { select: { name: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.saleItem.findMany({ select: { saleId: true, productId: true, product: { select: { name: true, code: true } } } }),
    db.purchaseItem.findMany({ select: { purchaseId: true, productId: true, product: { select: { name: true, code: true } } } }),
  ]);
  const saleLinesById = new Map<string, { productId: string; productName: string; productCode?: string }[]>();
  for (const line of saleLines) {
    const list = saleLinesById.get(line.saleId) ?? [];
    list.push({ productId: line.productId, productName: line.product.name, productCode: line.product.code ?? undefined });
    saleLinesById.set(line.saleId, list);
  }
  const purchaseLinesById = new Map<string, { productId: string; productName: string; productCode?: string }[]>();
  for (const line of purchaseLines) {
    const list = purchaseLinesById.get(line.purchaseId) ?? [];
    list.push({ productId: line.productId, productName: line.product.name, productCode: line.product.code ?? undefined });
    purchaseLinesById.set(line.purchaseId, list);
  }
  const retNo = new Map(rets.map(r => [r.id, r.returnNo ?? '']));
  const expMethod = new Map(ledger.filter(m => m.sourceType === 'expense').map(m => [m.sourceId, m]));
  // Payment method for money-in rows: standalone collections and sale-time
  // payments both live in MoneyMovement.
  const inMethod = new Map<string, string>();
  const paymentTransactionNo = new Map<string, string>();
  for (const m of ledger) {
    if (m.sourceType === 'customerPayment') inMethod.set(`p:${m.sourceId}`, m.method);
    if (m.sourceType === 'sale') inMethod.set(`s:${m.sourceId}`, m.method);
    if (m.sourceType === 'customerPayment' || m.sourceType === 'vendorPayment') paymentTransactionNo.set(m.sourceId, m.transactionNo);
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
    rets.filter(r => r.saleId).map(r => ({ invoiceId: r.saleId, amount: r.totalAmount, settlement: r.settlement as 'credit' | 'refund', refundAmount: r.refundAmount })),
    customerPayments.map(p => ({ partyId: p.customerId ?? '', invoiceId: p.saleId, returnId: p.returnId, date: p.date, amount: p.amount, createdAt: p.createdAt })),
  );
  const purSet = buildSettlement(
    purchases.map(p => ({ id: p.id, partyId: p.vendorId, date: p.date, total: p.total, createdAt: p.createdAt })),
    rets.filter(r => r.purchaseId).map(r => ({ invoiceId: r.purchaseId, amount: r.totalAmount, settlement: r.settlement as 'credit' | 'refund', refundAmount: r.refundAmount })),
    vendorPayments.map(p => ({ partyId: p.vendorId, invoiceId: p.purchaseId, returnId: p.returnId, date: p.date, amount: p.amount, createdAt: p.createdAt })),
  );
  res.json({
    products: products.map(productJson),
    customers: customers.map(c => ({ id: c.id, code: c.code ?? undefined, name: c.name, mobile: c.mobile, address: c.address ?? undefined, opening: c.openingDue, next: c.nextDate ?? undefined })),
    vendors: vendors.map(v => ({ id: v.id, code: v.code ?? undefined, name: v.name, mobile: v.mobile, address: v.address ?? undefined, opening: v.openingPayable, next: v.nextDate ?? undefined })),
    sales: sales.map(s => {
      const st = saleSet.get(s.id);
      return { id: s.id, customerId: s.customerId ?? undefined, date: s.date, total: s.total, paid: st?.paid ?? s.paid, due: st?.due ?? s.due, status: st?.status ?? 'due', profit: s.profit, cogs: cogsBySale.get(s.id) ?? 0, invoiceNo: s.invoiceNo ?? undefined, createdAt: s.createdAt, items: saleLinesById.get(s.id) ?? [] };
    }),
    purchases: purchases.map(p => {
      const st = purSet.get(p.id);
      return { id: p.id, vendorId: p.vendorId, date: p.date, createdAt: p.createdAt, total: p.total, paid: st?.paid ?? p.paid, due: st?.due ?? p.due, status: st?.status ?? 'due', invoiceNo: p.invoiceNo ?? undefined, items: purchaseLinesById.get(p.id) ?? [] };
    }),
    customerPayments: customerPayments.map(p => ({ id: p.id, paymentNo: p.paymentNo, transactionNo: paymentTransactionNo.get(p.id), customerId: p.customerId ?? 'cash', amount: p.amount, date: p.date, note: p.note?.startsWith('[[TRANSPORT_PAYMENT]]') ? p.note.slice('[[TRANSPORT_PAYMENT]]'.length).trimStart() : (p.note ?? undefined), returnId: p.returnId ?? undefined, returnNo: p.returnId ? retNo.get(p.returnId) : undefined, createdAt: p.createdAt, saleId: p.saleId ?? undefined, method: p.returnId ? undefined : (inMethod.get(`p:${p.id}`) ?? (p.saleId ? inMethod.get(`s:${p.saleId}`) : undefined)), accountId: p.returnId ? undefined : inAccount.get(p.id)?.accountId, accountName: p.returnId ? undefined : inAccount.get(p.id)?.accountName })),
    vendorPayments: vendorPayments.map(p => ({ id: p.id, paymentNo: p.paymentNo, transactionNo: paymentTransactionNo.get(p.id), vendorId: p.vendorId, amount: p.amount, date: p.date, note: p.note ?? undefined, returnId: p.returnId ?? undefined, returnNo: p.returnId ? retNo.get(p.returnId) : undefined, createdAt: p.createdAt, purchaseId: p.purchaseId ?? undefined, accountId: p.returnId ? undefined : outAccount.get(p.id)?.accountId, accountName: p.returnId ? undefined : outAccount.get(p.id)?.accountName })),
    movements: movements.map(mv => {
      const sale = mv.refId ? sales.find(row => row.id === mv.refId) : undefined;
      const purchase = mv.refId ? purchases.find(row => row.id === mv.refId) : undefined;
      const transactionNo = sale?.invoiceNo ?? purchase?.invoiceNo ?? undefined;
      const isEditReversal = mv.type === 'SALE_EDIT_REVERSAL' || mv.type === 'PURCHASE_EDIT_REVERSAL';
      const transactionNote = transactionNo ? `${isEditReversal ? 'Correction reversal for' : 'Posted against'} ${transactionNo}` : undefined;
      return { id: mv.id, productId: mv.productId, productName: mv.product.name, type: mv.type, qty: mv.qtyKg, bags: mv.product.mediumBagKg > 0 ? round2(mv.qtyKg / mv.product.mediumBagKg) : 0, unitCost: mv.unitCost, bagUnitPrice: round2(mv.unitCost * (mv.product.mediumBagKg || 0)), amount: mv.value, date: mv.date, transactionNo, note: [mv.note, transactionNote].filter(Boolean).join(' · ') || undefined };
    }),
    expenses: [
      ...expenses.map(e => ({ id: e.id, voucherNo: e.voucherNo ?? undefined, category: e.category, customName: e.customName ?? undefined, amount: e.amount, date: e.date, note: e.note ?? undefined, capitalized: e.capitalized, method: expMethod.get(e.id)?.method, accountId: expMethod.get(e.id)?.moneyAccountId ?? undefined })),
      ...stockAdjustments.map(mv => ({ id: `stockadj:${mv.id}`, voucherNo: `ADJ-${mv.id.slice(-8).toUpperCase()}`, category: 'other', customName: 'Inventory adjustment', amount: -mv.value, date: mv.date, note: `${mv.product.name}${mv.refId ? ` · ${mv.refId}` : mv.type === 'REVALUE' ? ' · Stock cost revaluation' : ''}`, capitalized: false, sourceMovementId: mv.id, stockAdjustment: true, accountName: 'Inventory adjustments' })),
    ],
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
