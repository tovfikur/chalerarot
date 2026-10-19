import type { TxClient } from './routes/transactions';

/**
 * Inventory valuation (weighted average / AVCO).
 *
 * Every inventory change is written as one immutable StockMovement that carries
 * the KG quantity, the per-KG cost used at that moment, and the signed value
 * impact. Product.stockValue / damagedValue are only a running cache of those
 * movements, so any historical date can be rebuilt from the movements alone.
 *
 * Stock lives in two buckets that are never merged:
 *   sellable -> qtyKg / stockValue     (can be sold)
 *   damaged  -> damagedQtyKg / damagedValue (written down, not sellable)
 */

export type Bucket = 'sellable' | 'damaged';

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Weighted average cost of the sellable bucket; falls back to the last known cost. */
export function avgCost(qtyKg: number, stockValue: number, lastCost: number): number {
  if (qtyKg > 0) return stockValue / qtyKg;
  return lastCost;
}

export type ProductRow = {
  id: string; qtyKg: number; stockValue: number; cost: number;
  damagedQtyKg: number; damagedValue: number;
};

type Movement = {
  type: string; bucket: Bucket; qtyKg: number; unitCost: number; value: number;
  date: string;
};

/**
 * Core AVCO step. Returns the movement to persist plus the new product state.
 * Pure function so the legacy backfill can replay history through exactly the
 * same maths as live transactions.
 *
 * IN  (purchase / opening / good return): value += qty * unitCost, avg re-blends.
 * OUT (sale / purchase return):           value -= qty * unitCost, avg stays.
 */
export function applyMovement(
  p: ProductRow,
  m: { type: string; bucket: Bucket; qtyKg: number; unitCost: number; date: string; forceUnitCost?: boolean },
): { movement: Movement; next: ProductRow } {
  const signedQty = round2(m.qtyKg);
  const unitCost = m.unitCost;
  let qtyKg = p.qtyKg;
  let stockValue = p.stockValue;
  let damagedQtyKg = p.damagedQtyKg;
  let damagedValue = p.damagedValue;
  let value: number;

  if (m.bucket === 'damaged') {
    value = round2(signedQty * unitCost);
    damagedQtyKg = round2(damagedQtyKg + signedQty);
    damagedValue = round2(damagedValue + value);
  } else if (signedQty >= 0) {
    // Stock coming IN: value at the incoming cost, average re-blends.
    value = round2(signedQty * unitCost);
    qtyKg = round2(qtyKg + signedQty);
    stockValue = round2(stockValue + value);
  } else {
    // Stock going OUT. Default: the running average cost (sales COGS).
    // `forceUnitCost` is used by purchase returns, which unwind stock at the
    // ORIGINAL purchase rate so the supplier credit and the inventory value
    // reduction are the same number.
    const out = Math.abs(signedQty);
    const useCost = m.forceUnitCost ? unitCost : avgCost(p.qtyKg, p.stockValue, p.cost);
    value = round2(-out * useCost);
    qtyKg = round2(p.qtyKg - out);
    stockValue = round2(p.stockValue + value);
    if (qtyKg <= 0 || stockValue < 0) {
      qtyKg = qtyKg < 0 ? 0 : qtyKg;
      stockValue = 0;
    }
  }

  const cost = round2(avgCost(qtyKg, stockValue, unitCost || p.cost));
  return {
    movement: {
      type: m.type, bucket: m.bucket, qtyKg: signedQty,
      unitCost: m.bucket === 'sellable' && signedQty < 0
        ? round2(Math.abs(value) / Math.max(Math.abs(signedQty), 1e-9))
        : round2(unitCost),
      value, date: m.date,
    },
    next: { ...p, qtyKg, stockValue, damagedQtyKg, damagedValue, cost },
  };
}

/** Persist one movement + the product cache. Must run inside a transaction. */
export async function writeMovement(
  t: TxClient,
  productId: string,
  m: { type: string; bucket: Bucket; qtyKg: number; unitCost: number; date: string; refId?: string | null; forceUnitCost?: boolean },
): Promise<{ unitCost: number; value: number; qtyAfter: number; valueAfter: number; avgAfter: number }> {
  const p = await t.product.findUnique({ where: { id: productId } });
  if (!p) throw Object.assign(new Error('Product not found'), { status: 400 });
  const { movement, next } = applyMovement(
    { id: p.id, qtyKg: p.qtyKg, stockValue: p.stockValue, cost: p.cost, damagedQtyKg: p.damagedQtyKg, damagedValue: p.damagedValue },
    { type: m.type, bucket: m.bucket, qtyKg: m.qtyKg, unitCost: m.unitCost, date: m.date, forceUnitCost: m.forceUnitCost },
  );
  await t.product.update({
    where: { id: p.id },
    data: {
      qtyKg: next.qtyKg,
      stockValue: next.stockValue,
      damagedQtyKg: next.damagedQtyKg,
      damagedValue: next.damagedValue,
      cost: next.cost,
    },
  });
  await t.stockMovement.create({
    data: {
      productId: p.id,
      type: movement.type,
      bucket: movement.bucket,
      qtyKg: movement.qtyKg,
      unitCost: round2(movement.unitCost),
      value: movement.value,
      date: movement.date,
      refId: m.refId ?? null,
    },
  });
  return {
    unitCost: round2(movement.unitCost),
    value: movement.value,
    qtyAfter: next.qtyKg,
    valueAfter: next.stockValue,
    avgAfter: next.cost,
  };
}

/** Effective weighted average cost of the sellable bucket right now. */
export async function currentAvgCost(t: TxClient, productId: string): Promise<number> {
  const p = await t.product.findUnique({ where: { id: productId }, select: { qtyKg: true, stockValue: true, cost: true } });
  if (!p) throw Object.assign(new Error('Product not found'), { status: 400 });
  return round2(avgCost(p.qtyKg, p.stockValue, p.cost));
}

/**
 * Value still available in the sellable bucket. Selling more than this is
 * impossible (the routes check stock first), but the guard keeps the books
 * consistent if quantities are ever edited directly.
 */
export function cogsFor(qtyKg: number, p: { qtyKg: number; stockValue: number; cost: number }): number {
  const useCost = avgCost(p.qtyKg, p.stockValue, p.cost);
  return round2(qtyKg * useCost);
}

/**
 * Manual cost edit on a product: re-value the stock on hand to the new average
 * so stockValue and cost stay consistent, and record a REVALUE movement so the
 * change is auditable instead of silently rewriting history.
 */
export async function revalueStock(t: TxClient, productId: string, newCost: number, date: string): Promise<void> {
  const p = await t.product.findUnique({ where: { id: productId } });
  if (!p) return;
  if (p.qtyKg <= 0) {
    await t.product.update({ where: { id: p.id }, data: { cost: round2(newCost) } });
    return;
  }
  const targetValue = round2(p.qtyKg * newCost);
  const delta = round2(targetValue - p.stockValue);
  if (delta === 0) {
    await t.product.update({ where: { id: p.id }, data: { cost: round2(newCost) } });
    return;
  }
  await t.product.update({
    where: { id: p.id },
    data: { stockValue: targetValue, cost: round2(newCost) },
  });
  await t.stockMovement.create({
    data: {
      productId: p.id, type: 'REVALUE', bucket: 'sellable',
      qtyKg: 0, unitCost: round2(newCost), value: delta, date, refId: null,
    },
  });
}