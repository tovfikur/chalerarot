import { Router, Request, Response } from 'express';
import { db } from '../db';
import { toKg, isUnit, transactionDay } from '../units';
import { recordMovement, resolveAccount } from '../money';
import { currentAvgCost, round2 as r2, writeMovement } from '../valuation';
import { syncPartyInvoices } from '../settlement';
import { nextInvoiceNo } from './transactions';

export const returns = Router();

const num = (v: unknown, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : d;
};

const CONDS = ['good', 'damaged', 'partial'];
const REASONS = ['torn', 'wet', 'pest', 'spoiled', 'transport', 'other'];
const UNITS = ['kg', 'small', 'medium', 'large', 'ton', 'others'];
const round2 = (n: number) => Math.round(n * 100) / 100;

// Remaining returnable KG per original line and invoice totals.
async function remainingFor(kind: 'sale' | 'purchase', parentId: string) {
  const rets = await db.productReturn.findMany({
    where: kind === 'sale' ? { saleId: parentId } : { purchaseId: parentId },
    include: { items: true },
  });
  const perLine = new Map<string, number>();
  let total = 0;
  for (const r of rets) for (const it of r.items) {
    total += it.qtyKg;
    const key = it.saleItemId ?? it.purchaseItemId ?? '';
    if (key) perLine.set(key, (perLine.get(key) ?? 0) + it.qtyKg);
  }
  return { perLine, total };
}

// GET /api/returns/invoices?kind=sale|purchase — picker list (active parties only)
returns.get('/invoices', async (req: Request, res: Response) => {
  const kind = req.query.kind === 'purchase' ? 'purchase' : 'sale';
  if (kind === 'sale') {
    const list = await db.sale.findMany({
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200,
      include: { customer: { select: { name: true, mobile: true, deletedAt: true } } },
    });
    return res.json(list
      .filter(s => !s.customer || !s.customer.deletedAt)
      .map(s => ({ id: s.id, no: s.invoiceNo ?? '', date: s.date, total: s.total, partyName: s.customer?.name ?? null, partyMobile: s.customer?.mobile ?? null })));
  }
  const list = await db.purchase.findMany({
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 200,
    include: { vendor: { select: { name: true, mobile: true, deletedAt: true } } },
  });
  res.json(list
    .filter(p => !p.vendor.deletedAt)
    .map(p => ({ id: p.id, no: p.invoiceNo ?? '', date: p.date, total: p.total, partyName: p.vendor.name, partyMobile: p.vendor.mobile })));
});

// GET /api/returns/:id — full return with items + party + original invoice
returns.get('/:id', async (req: Request, res: Response) => {
  const r = await db.productReturn.findUnique({
    where: { id: req.params.id },
    include: {
      items: { include: { product: { select: { name: true } } } },
      sale: { select: { invoiceNo: true, date: true, customer: { select: { name: true, mobile: true } } } },
      purchase: { select: { invoiceNo: true, date: true, vendor: { select: { name: true, mobile: true } } } },
    },
  });
  if (!r) return res.status(404).json({ error: 'Return not found' });
  const party = r.kind === 'sale'
    ? (r.sale?.customer ? { name: r.sale.customer.name, mobile: r.sale.customer.mobile } : null)
    : (r.purchase ? { name: r.purchase.vendor.name, mobile: r.purchase.vendor.mobile } : null);
  res.json({
    id: r.id, returnNo: r.returnNo, kind: r.kind, date: r.date, createdAt: r.createdAt,
    totalAmount: r.totalAmount, profitImpact: r.profitImpact,
    settlement: r.settlement, refundAmount: r.refundAmount,
    origInvoiceNo: r.kind === 'sale' ? r.sale?.invoiceNo ?? null : r.purchase?.invoiceNo ?? null,
    origDate: r.kind === 'sale' ? r.sale?.date ?? null : r.purchase?.date ?? null,
    party,
    items: r.items.map(it => ({
      productName: it.product.name, unit: it.unit, enteredQty: it.enteredQty, qtyKg: it.qtyKg,
      goodKg: it.goodKg, damagedKg: it.damagedKg, condition: it.condition,
      damageReason: it.damageReason ?? undefined, note: it.note ?? undefined,
      rate: it.rate, amount: it.amount,
      // Historical cost basis actually used (original sale/purchase cost).
      unitCost: it.unitCost, cogs: it.cogs, damagedValue: it.damagedValue,
    })),
  });
});

// POST /api/returns — atomic: validate, number, lines, stock, settlement
returns.post('/', async (req: Request, res: Response) => {
  try {
    const { kind, saleId, purchaseId, lines, settlement, method, accountId, date, note } = req.body ?? {};
    if (kind !== 'sale' && kind !== 'purchase') return res.status(400).json({ error: 'Invalid return type' });
    if (!Array.isArray(lines) || !lines.length) return res.status(400).json({ error: 'No return items' });
    if (settlement !== 'credit' && settlement !== 'refund') return res.status(400).json({ error: 'Invalid settlement' });
    const day = transactionDay(date);

    const result = await db.$transaction(async t => {
      const parent = kind === 'sale'
        ? await t.sale.findUnique({ where: { id: String(saleId ?? '') }, include: { items: true, customer: true } })
        : await t.purchase.findUnique({ where: { id: String(purchaseId ?? '') }, include: { items: true, vendor: true } });
      if (!parent) throw Object.assign(new Error(kind === 'sale' ? 'Sale not found' : 'Purchase not found'), { status: 400 });

      const rem = await remainingFor(kind, parent.id);
      const origTotalKg = parent.items.reduce((s, l) => s + l.qtyKg, 0);
      let invoiceRemaining = Math.round((origTotalKg - rem.total) * 100) / 100;

      let totalAmount = 0;
      let profitImpact = 0;
      const built: {
        saleItemId: string | null; purchaseItemId: string | null; productId: string;
        unit: string; enteredQty: number; qtyKg: number; goodKg: number; damagedKg: number;
        condition: string; damageReason: string | null; note: string | null;
        rate: number; amount: number; source: string;
        unitCost: number; cogs: number; damagedValue: number;
      }[] = [];
      // per-product bucket usage inside this request (purchase returns)
      const usedAvail: Record<string, number> = {};
      const usedDmg: Record<string, number> = {};

      for (const l of lines) {
        const unit = String(l?.unit ?? '');
        if (!UNITS.includes(unit)) throw Object.assign(new Error('Invalid unit'), { status: 400 });
        const condition = String(l?.condition ?? 'good');
        if (!CONDS.includes(condition)) throw Object.assign(new Error('Invalid condition'), { status: 400 });
        const entered = num(l?.enteredQty);
        if (!(entered > 0)) throw Object.assign(new Error('Quantity must be greater than 0'), { status: 400 });

        const p = await t.product.findUnique({ where: { id: String(l?.productId ?? '') } });
        if (!p) throw Object.assign(new Error('Product not found'), { status: 400 });

        // Original line reference (required except for 'others').
        const lineKey = kind === 'sale' ? String(l?.saleItemId ?? '') : String(l?.purchaseItemId ?? '');
        const orig = lineKey ? parent.items.find(x => x.id === lineKey && x.productId === p.id) : undefined;
        if (unit !== 'others' && !orig) throw Object.assign(new Error('Item is not part of the original invoice'), { status: 400 });

        let qtyKg: number;
        let rate: number;
        if (unit === 'others') {
          const manual = num(l?.manualKg);
          if (!(manual > 0)) throw Object.assign(new Error('Actual KG quantity is required'), { status: 400 });
          const desc = String(l?.note ?? '').trim();
          if (!desc) throw Object.assign(new Error('Note is required for Others unit'), { status: 400 });
          qtyKg = Math.round(manual * 100) / 100;
          // Prefer the ORIGINAL line's rate whenever we know which line this
          // return belongs to, even for 'others'. The product's current sale
          // price is only a last resort for a truly standalone 'others' return.
          rate = orig ? orig.rate : (kind === 'sale' ? p.price : p.cost);
          if (qtyKg - invoiceRemaining > 0.009) throw Object.assign(new Error('Return exceeds remaining invoice quantity'), { status: 400 });
          invoiceRemaining = Math.round((invoiceRemaining - qtyKg) * 100) / 100;
        } else {
          rate = orig!.rate;
          qtyKg = Math.round(toKg(p, unit as 'kg' | 'small' | 'medium' | 'large' | 'ton', entered) * 100) / 100;
          const lineRemaining = Math.round((orig!.qtyKg - (rem.perLine.get(orig!.id) ?? 0)) * 100) / 100;
          if (qtyKg - lineRemaining > 0.009 || qtyKg - invoiceRemaining > 0.009) {
            throw Object.assign(new Error('Return exceeds remaining quantity'), { status: 400 });
          }
          invoiceRemaining = Math.round((invoiceRemaining - qtyKg) * 100) / 100;
        }

        let goodKg = 0, damagedKg = 0;
        if (condition === 'good') { goodKg = qtyKg; }
        else if (condition === 'damaged') { damagedKg = qtyKg; }
        else {
          goodKg = num(l?.goodKg); damagedKg = num(l?.damagedKg);
          if (!(goodKg >= 0) || !(damagedKg >= 0) || Math.abs(goodKg + damagedKg - qtyKg) > 0.01) {
            throw Object.assign(new Error('Good + damaged must equal total'), { status: 400 });
          }
          goodKg = Math.round(goodKg * 100) / 100; damagedKg = Math.round(damagedKg * 100) / 100;
        }
        let damageReason: string | null = null;
        if (condition !== 'good') {
          damageReason = String(l?.damageReason ?? '');
          if (!['torn', 'wet', 'pest', 'spoiled', 'transport', 'other'].includes(damageReason)) {
            throw Object.assign(new Error('Damage reason is required'), { status: 400 });
          }
          if (damageReason === 'other' && !String(l?.note ?? '').trim()) {
            throw Object.assign(new Error('Note is required'), { status: 400 });
          }
        }

        const source = kind === 'purchase' ? String(l?.source ?? 'available') : 'available';
        if (kind === 'purchase' && source !== 'available' && source !== 'damaged') {
          throw Object.assign(new Error('Invalid stock source'), { status: 400 });
        }

        const amount = r2(qtyKg * rate);
        totalAmount = r2(totalAmount + amount);

        // Historical cost basis for this return line:
        //  - sales return   -> the ORIGINAL sale line's frozen unit cost
        //  - purchase return-> the ORIGINAL purchase line's rate, i.e. the same
        //    credit the supplier gives back, so Net Purchase and the inventory
        //    reduction are the same figure and COGS is left undisturbed
        //  - 'others' line  -> no original line exists, so the stock's current
        //    weighted average cost is used (the one documented exception)
        const origUnitCost = (orig as { unitCost?: number } | undefined)?.unitCost;
        const unitCost = orig
          ? (kind === 'sale' ? r2(origUnitCost ?? 0) : r2(orig.rate))
          : r2(await currentAvgCost(t, p.id));
        const cogsReversed = r2(goodKg * unitCost);
        const damagedValue = r2(damagedKg * unitCost);
        if (kind === 'sale') profitImpact = r2(profitImpact + amount - cogsReversed);

        if (kind === 'sale') {
          // Sellable goods go back into sellable stock at the ORIGINAL sale
          // cost, so that part of the original COGS is genuinely reversed.
          if (goodKg > 0) {
            await writeMovement(t, p.id, { type: 'SRETURN', bucket: 'sellable', qtyKg: goodKg, unitCost, date: day, refId: lineKey || null });
          }
          // Damaged goods are NOT sellable stock. They are valued in the
          // damaged bucket at the same historical cost and excluded from
          // closing sellable value, so this cost is written down rather than
          // pretending it can be sold again.
          if (damagedKg > 0) {
            await writeMovement(t, p.id, { type: 'SRETURN_DMG', bucket: 'damaged', qtyKg: damagedKg, unitCost, date: day });
          }
        } else {
          usedAvail[p.id] = (usedAvail[p.id] ?? 0) + (source === 'available' ? qtyKg : 0);
          usedDmg[p.id] = (usedDmg[p.id] ?? 0) + (source === 'damaged' ? qtyKg : 0);
          if (usedAvail[p.id] - p.qtyKg > 0.009) throw Object.assign(new Error('Not enough available stock'), { status: 400 });
          if (usedDmg[p.id] - p.damagedQtyKg > 0.009) throw Object.assign(new Error('Not enough damaged stock'), { status: 400 });
          // Value leaves at the ORIGINAL purchase rate (forceUnitCost), so the
          // inventory reduction equals the supplier credit exactly.
          if (source === 'available') {
            await writeMovement(t, p.id, {
              type: 'PRETURN', bucket: 'sellable', qtyKg: -qtyKg, unitCost,
              date: day, refId: lineKey || null, forceUnitCost: true,
            });
          } else {
            await writeMovement(t, p.id, {
              type: 'PRETURN_DMG', bucket: 'damaged', qtyKg: -qtyKg, unitCost,
              date: day, forceUnitCost: true,
            });
          }
        }

        built.push({
          saleItemId: kind === 'sale' ? (lineKey || null) : null,
          purchaseItemId: kind === 'purchase' ? (lineKey || null) : null,
          productId: p.id, unit, enteredQty: entered, qtyKg, goodKg, damagedKg,
          condition, damageReason, note: String(l?.note ?? '').trim() || null,
          rate, amount, source, unitCost, cogs: cogsReversed, damagedValue,
        });
      }

      const returnNo = await nextInvoiceNo(t, kind === 'sale' ? 'SRN' : 'PRN', day);
      const created = await t.productReturn.create({
        data: {
          returnNo, kind,
          saleId: kind === 'sale' ? parent.id : null,
          purchaseId: kind === 'purchase' ? parent.id : null,
          customerId: kind === 'sale' ? (parent as { customerId?: string | null }).customerId ?? null : null,
          vendorId: kind === 'purchase' ? (parent as { vendorId?: string }).vendorId : null,
          date: day, totalAmount, profitImpact,
          settlement, refundAmount: settlement === 'refund' ? totalAmount : 0,
          note: typeof note === 'string' && note.trim() ? note.trim() : null,
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          items: { create: built.map(({ source, ...it }) => it) },
        },
      });
      // Financial settlement: credit memo against due/payable (negative sum
      // via a linked payment row keeps existing balance math intact).
      if (kind === 'sale') {
        const s = parent as { customerId?: string | null };
        await t.customerPayment.create({
          data: { customerId: s.customerId ?? null, saleId: null, returnId: created.id, amount: totalAmount, date: day, note: returnNo },
        });
        // The credit reduces that invoice's remaining: re-attribute in-tx.
        await syncPartyInvoices('sale', s.customerId ?? null, t);
      } else {
        const v = parent as { vendorId: string };
        await t.vendorPayment.create({
          data: { vendorId: v.vendorId, purchaseId: null, returnId: created.id, amount: totalAmount, date: day, note: returnNo },
        });
        await syncPartyInvoices('purchase', v.vendorId, t);
      }
      // Only an actual refund moves money: sales return pays the customer back
      // (out), purchase return receives money from the vendor (in). A credit
      // memo is just a due/payable adjustment and never touches a balance.
      if (settlement === 'refund' && totalAmount > 0) {
        // A real refund moves money, so it needs the concrete account.
        const acc = await resolveAccount(t, { accountId, method });
        await recordMovement(t, {
          accountId: acc.id,
          method: acc.type,
          direction: kind === 'sale' ? 'out' : 'in',
          amount: totalAmount,
          date: day,
          sourceType: kind === 'sale' ? 'saleReturn' : 'purchaseReturn',
          sourceId: created.id,
          note: returnNo,
        });
      }
      return { id: created.id, returnNo, totalAmount };
    });
    res.status(201).json(result);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Failed to create return' });
  }
});
