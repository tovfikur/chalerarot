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
 * Negative sellable quantity and value are kept when negative-stock sales are
 * enabled; later purchases resolve their provisional COGS in writeMovement.
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
    if (qtyKg === 0 && Math.abs(stockValue) < 0.01) stockValue = 0;
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
  m: { type: string; bucket: Bucket; qtyKg: number; unitCost: number; date: string; refId?: string | null; forceUnitCost?: boolean; note?: string | null },
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
      note: m.note ?? null,
    },
  });
  let valueAfter = next.stockValue;
  let avgAfter = next.cost;

  // A receipt that covers previously sold negative stock changes the actual
  // cost of those sales. Assign received units to the oldest unresolved sale
  // lines first, update their COGS/profit, and write an auditable value change.
  if (m.type === 'PURCHASE' && m.bucket === 'sellable' && m.qtyKg > 0 && p.qtyKg < 0) {
    let left = Math.min(round2(m.qtyKg), round2(-p.qtyKg));
    let totalCostDelta = 0;
    // Negative opening quantities imported in bulk have no sale invoice line
    // to re-cost. Resolve those opening deficits first, at the incoming
    // purchase's actual unit cost, and retain the matched quantity on the
    // opening movement so later purchases only adjust the remaining deficit.
    const negativeOpenings = await t.stockMovement.findMany({
      where: { productId: p.id, type: 'OPENING', bucket: 'sellable', note: 'bulk-negative-opening-stock', qtyKg: { lt: 0 } },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const opening of negativeOpenings) {
      if (left <= 0) break;
      const openNegativeQty = round2(Math.max(0, Math.abs(opening.qtyKg) - opening.negativeStockCostAdjustedQtyKg));
      const matchedQty = round2(Math.min(left, openNegativeQty));
      if (matchedQty <= 0) continue;
      const delta = round2(matchedQty * (m.unitCost - opening.unitCost));
      await t.stockMovement.update({
        where: { id: opening.id },
        data: { negativeStockCostAdjustedQtyKg: round2(opening.negativeStockCostAdjustedQtyKg + matchedQty) },
      });
      if (delta !== 0) {
        await t.stockMovement.create({ data: {
          productId: p.id, type: 'NEGATIVE_STOCK_COGS_ADJUSTMENT', bucket: 'sellable',
          qtyKg: 0, unitCost: round2(m.unitCost), value: round2(-delta), date: m.date,
          refId: m.refId ?? null,
          note: `Imported opening stock cost adjusted by ${delta.toFixed(2)} for ${matchedQty.toFixed(2)} kg at receipt cost ${m.unitCost.toFixed(2)}.`,
        } });
      }
      totalCostDelta = round2(totalCostDelta + delta);
      left = round2(left - matchedQty);
    }
    const priorSaleItems = await t.saleItem.findMany({
      where: { productId: p.id, negativeStockQtyKg: { gt: 0 } },
      include: { sale: { select: { id: true, profit: true } } },
      orderBy: [{ sale: { date: 'asc' } }, { sale: { createdAt: 'asc' } }, { id: 'asc' }],
    });
    const profitBySale = new Map<string, number>();
    for (const item of priorSaleItems) {
      if (left <= 0) break;
      const openNegativeQty = round2(Math.max(0, item.negativeStockQtyKg - item.negativeStockCostAdjustedQtyKg));
      const matchedQty = round2(Math.min(left, openNegativeQty));
      if (matchedQty <= 0) continue;
      const delta = round2(matchedQty * (m.unitCost - item.unitCost));
      await t.saleItem.update({ where: { id: item.id }, data: {
        cogs: round2(item.cogs + delta),
        unitCost: item.qtyKg > 0 ? round2((item.cogs + delta) / item.qtyKg) : item.unitCost,
        negativeStockCostAdjustedQtyKg: round2(item.negativeStockCostAdjustedQtyKg + matchedQty),
      } });
      const currentProfit = profitBySale.get(item.sale.id) ?? item.sale.profit;
      const newProfit = round2(currentProfit - delta);
      profitBySale.set(item.sale.id, newProfit);
      await t.sale.update({ where: { id: item.sale.id }, data: { profit: newProfit } });
      if (delta !== 0) {
        await t.stockMovement.create({ data: {
          productId: p.id, type: 'NEGATIVE_STOCK_COGS_ADJUSTMENT', bucket: 'sellable',
          qtyKg: 0, unitCost: round2(m.unitCost), value: round2(-delta), date: m.date,
          refId: m.refId ?? null,
          note: `Negative stock COGS adjusted by ${delta.toFixed(2)} for ${matchedQty.toFixed(2)} kg at receipt cost ${m.unitCost.toFixed(2)}.`,
        } });
      }
      totalCostDelta = round2(totalCostDelta + delta);
      left = round2(left - matchedQty);
    }
    if (totalCostDelta !== 0) {
      valueAfter = round2(next.stockValue - totalCostDelta);
      avgAfter = next.qtyKg > 0 ? round2(valueAfter / next.qtyKg) : next.cost;
      await t.product.update({ where: { id: p.id }, data: { stockValue: valueAfter, cost: avgAfter } });
    }
  }
  return {
    unitCost: round2(movement.unitCost),
    value: movement.value,
    qtyAfter: next.qtyKg,
    valueAfter,
    avgAfter,
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
