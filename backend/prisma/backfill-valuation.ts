/**
 * One-time legacy backfill for inventory valuation.
 *
 * Existing documents are NOT rewritten. This script only fills in the new
 * valuation columns by replaying the historical movement trail through the
 * exact same AVCO maths the live routes use (src/valuation.ts).
 *
 * Legacy evidence used, in order of reliability:
 *  1. Sale.profit  -> frozen at sale creation, so invoice COGS = total - profit
 *     (this is the historical cost the system itself recorded)
 *  2. PurchaseItem.rate -> the real purchase price at that time
 *  3. ProductReturnItem.rate -> the original line rate
 *
 * Known limitations (documented, not fabricated):
 *  - Opening stock had no stored value. The opening unit cost is taken from the
 *    product's EARLIEST recorded purchase rate; if the product was never
 *    purchased, the earliest sale-implied cost; otherwise the product's cost.
 *  - Invoice-level historical COGS is exact, but a single invoice's cost is
 *    spread across its lines in proportion to each line's value. Line-level
 *    cost is therefore an allocation, not a stored fact.
 *  - The seeded OPENING movement is dated after some seeded transactions, so
 *    opening stock is always applied FIRST (it is the initial state, not a
 *    dated event).
 *
 * Run: npx tsx prisma/backfill-valuation.ts
 */
import { PrismaClient } from '@prisma/client';
import { applyMovement, round2, type Bucket, type ProductRow } from '../src/valuation';

const r2 = round2;

const db = new PrismaClient();

type Row = ProductRow & { openingQtyKg: number; openingValue: number; openingUnitCost: number };

const DRY = process.argv.includes('--dry');

async function main() {
  const products = await db.product.findMany({ orderBy: { id: 'asc' } });
  let touched = 0;
  const skipped: string[] = [];
  const legacyDelta: string[] = [];

  for (const p of products) {
    const saleItems = await db.saleItem.findMany({ where: { productId: p.id }, include: { sale: { include: { items: true } } } });
    const purchaseItems = await db.purchaseItem.findMany({ where: { productId: p.id }, include: { purchase: true } });
    const returnItems = await db.productReturnItem.findMany({ where: { productId: p.id }, include: { ret: true } });
    type SaleItemRow = (typeof saleItems)[number];

    // ---------- 1. opening unit cost ----------
    const purchaseDates = purchaseItems
      .map((i: (typeof purchaseItems)[number]) => ({ date: i.purchase.date, createdAt: i.purchase.createdAt, rate: i.rate }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.getTime() - b.createdAt.getTime()));
    const saleDates = saleItems
      .filter(i => i.sale.total !== i.sale.profit && i.qtyKg > 0)
      .map(i => ({ date: i.sale.date, createdAt: i.sale.createdAt, cost: (i.sale.total - i.sale.profit) / i.sale.items.reduce((a: number, x: { qtyKg: number }) => a + x.qtyKg, 0) }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt.getTime() - b.createdAt.getTime()));
    const openingUnitCost = round2(
      purchaseDates[0]?.rate ?? saleDates[0]?.cost ?? p.cost,
    );
    const openingValue = round2(p.openingQtyKg * openingUnitCost);
    const openingQty = p.openingQtyKg;
    // Opening stock is the state BEFORE the product's first recorded movement.
    // Its own date was never stored, so it is placed at the earlier of the
    // product's setup date and its first recorded transaction date. That date is
    // derived from existing rows; nothing is invented.
    const setupDay = p.createdAt.toISOString().slice(0, 10);
    const firstTxDay = [
      ...purchaseItems.map(i => i.purchase.date),
      ...saleItems.map(i => i.sale.date),
      ...returnItems.map(i => i.ret.date),
    ].sort()[0];
    const openingDay = firstTxDay && firstTxDay < setupDay ? firstTxDay : setupDay;

    // ---------- 2. legacy snapshot (kept only as a cross-check) ----------
    // Sale.profit was frozen at creation, so invoice COGS = total - profit.
    // It is recorded here for comparison only: the authoritative historical cost
    // comes from the AVCO replay of real purchase prices below.
    const cogsBySale = new Map<string, number>();
    for (const i of saleItems) {
      if (!cogsBySale.has(i.saleId)) {
        cogsBySale.set(i.saleId, round2(i.sale.total - i.sale.profit));
      }
    }
    const revenueBySale = new Map<string, number>();
    for (const i of saleItems) {
      revenueBySale.set(i.saleId, round2((revenueBySale.get(i.saleId) ?? 0) + i.qtyKg * i.rate));
    }
    const lineUnitCost = new Map<string, number>();
    const lineCogs = new Map<string, number>();
    const legacyAllocCogs = new Map<string, number>();
    const returnUnitCost = new Map<string, number>();
    void (undefined as SaleItemRow | undefined);
    for (const i of saleItems) {
      const rev = revenueBySale.get(i.saleId) ?? 0;
      const share = rev > 0 ? (i.qtyKg * i.rate) / rev : 1 / Math.max(1, saleItems.filter(x => x.saleId === i.saleId).length);
      const cogs = round2((cogsBySale.get(i.saleId) ?? 0) * share);
      legacyAllocCogs.set(i.id, cogs);
    }

    // ---------- 3. ordered movement list ----------
    type Ev = { seq: number; type: string; bucket: Bucket; qtyKg: number; unitCost: number; date: string; refId: string | null; refKind: string; refItemId?: string };
    const evs: Ev[] = [];
    evs.push({ seq: 0, type: 'OPENING', bucket: 'sellable', qtyKg: p.openingQtyKg, unitCost: openingUnitCost, date: '0000-01-01', refId: p.id, refKind: 'opening' });

    for (const i of purchaseItems) {
      evs.push({
        seq: i.purchase.createdAt.getTime(), type: 'PURCHASE', bucket: 'sellable', qtyKg: i.qtyKg,
        unitCost: i.rate, date: i.purchase.date, refId: i.purchaseId, refKind: 'purchaseItem', refItemId: i.id,
      });
    }
    for (const i of saleItems) {
      evs.push({
        seq: i.sale.createdAt.getTime(), type: 'SALE', bucket: 'sellable', qtyKg: -i.qtyKg,
        unitCost: 0, date: i.sale.date, refId: i.saleId, refKind: 'saleItem', refItemId: i.id,
      });
    }
    // A return's historical cost can only be resolved once its parent sale line
    // has been replayed, so these events carry a placeholder and the replay
    // fills in the real cost (see the SRETURN branch in the replay loop).
    for (const i of returnItems) {
      if (i.goodKg > 0) {
        evs.push({ seq: i.ret.createdAt.getTime(), type: 'SRETURN', bucket: 'sellable', qtyKg: i.goodKg, unitCost: 0, date: i.ret.date, refId: i.ret.id, refKind: 'returnItem', refItemId: i.id });
      }
      if (i.damagedKg > 0) {
        evs.push({ seq: i.ret.createdAt.getTime(), type: 'SRETURN_DMG', bucket: 'damaged', qtyKg: i.damagedKg, unitCost: 0, date: i.ret.date, refId: i.ret.id, refKind: 'returnItem', refItemId: i.id });
      }
      if (i.purchaseItemId && i.qtyKg > 0) {
        // Purchase return: value leaves at the ORIGINAL purchase rate, i.e. the
        // same figure as the supplier credit.
        const credit = round2(i.qtyKg * (purchaseItems.find(x => x.id === i.purchaseItemId)?.rate ?? i.rate));
        evs.push({ seq: i.ret.createdAt.getTime(), type: 'PRETURN', bucket: 'sellable', qtyKg: -i.qtyKg, unitCost: credit / i.qtyKg, date: i.ret.date, refId: i.ret.id, refKind: 'returnItem', refItemId: i.id });
      }
    }
    // purchase returns out of the damaged bucket
    for (const i of returnItems.filter(x => x.purchaseItemId && x.damagedKg > 0 && x.goodKg === 0 && x.qtyKg > 0)) {
      const origUnitCost = round2(purchaseItems.find(x => x.id === i.purchaseItemId)?.rate ?? i.rate);
      const credit = round2(i.qtyKg * origUnitCost);
      evs.push({ seq: i.ret.createdAt.getTime(), type: 'PRETURN_DMG', bucket: 'damaged', qtyKg: -i.qtyKg, unitCost: credit / i.qtyKg, date: i.ret.date, refId: i.ret.id, refKind: 'returnItem', refItemId: i.id });
    }
    evs.sort((a, b) => a.seq - b.seq);

    // ---------- 4. replay ----------
    let state: ProductRow = {
      id: p.id, qtyKg: 0, stockValue: 0, cost: openingUnitCost || p.cost,
      damagedQtyKg: 0, damagedValue: 0,
    };
    const movementWrites: { productId: string; type: string; bucket: string; qtyKg: number; unitCost: number; value: number; date: string; refId: string | null; mvId: string }[] = [];
    let createdCount = 0;

    // Re-pair legacy movements with valuation data. Legacy rows are inconsistent
    // (some seeded movements carry refId, API-created ones do not), so matching
    // is by type + quantity + date, and only then by type + quantity.
    const existing = await db.stockMovement.findMany({ where: { productId: p.id } });
    const used = new Set<string>();
    const pick = (type: string, qty: number, date: string) => {
      const free = existing.filter(m => !used.has(m.id) && m.type === type && Math.abs(m.qtyKg - qty) < 0.005);
      const chosen = free.find(m => m.date === date) ?? free[0];
      if (chosen) used.add(chosen.id);
      return chosen;
    };

    for (const e of evs) {
      if (e.type === 'OPENING') {
        // Reuse the real OPENING movement row if one exists.
        const legacy = existing.filter(m => !used.has(m.id) && m.type === 'OPENING')[0];
        const res = applyMovement(state, { type: 'OPENING', bucket: 'sellable', qtyKg: e.qtyKg, unitCost: e.unitCost, date: openingDay });
        state = res.next;
        if (legacy && !DRY) {
          used.add(legacy.id);
          await db.stockMovement.update({ where: { id: legacy.id }, data: { bucket: 'sellable', unitCost: res.movement.unitCost, value: res.movement.value, date: openingDay } });
        } else if (!legacy && !DRY) {
          movementWrites.push({ productId: p.id, type: 'OPENING', bucket: 'sellable', qtyKg: res.movement.qtyKg, unitCost: res.movement.unitCost, value: res.movement.value, date: openingDay, refId: p.id, mvId: '' });
        }
        continue;
      }
      const legacy = pick(e.type, e.qtyKg, e.date);
      const force = e.type === 'PRETURN' || e.type === 'PRETURN_DMG';
      let unitCost = e.unitCost;
      if (e.type === 'SRETURN' || e.type === 'SRETURN_DMG') {
        // ORIGINAL sale line cost for a sales return; never the product's
        // current cost. Falls back to the original rate only when the parent
        // line is missing, and to the purchase rate for a purchase-side return.
        const ri = returnItems.find(x => x.id === e.refItemId);
        unitCost = ri
          ? (ri.saleItemId
            ? round2(lineUnitCost.get(ri.saleItemId) ?? ri.rate)
            : ri.purchaseItemId
              ? round2(purchaseItems.find(x => x.id === ri.purchaseItemId)?.rate ?? ri.rate)
              : round2(ri.rate))
          : 0;
        if (ri) returnUnitCost.set(ri.id, unitCost);
      }
      const res = applyMovement(state, { type: e.type, bucket: e.bucket, qtyKg: e.qtyKg, unitCost, date: e.date, forceUnitCost: force });
      state = res.next;
      if (e.type === 'SALE' && e.refItemId) {
        // The cost actually consumed is the replay's average at that moment and
        // becomes this line's immutable COGS snapshot.
        lineUnitCost.set(e.refItemId, res.movement.unitCost);
        lineCogs.set(e.refItemId, r2(-res.movement.value));
      }
      if (legacy) {
        used.add(legacy.id);
        if (!DRY) await db.stockMovement.update({ where: { id: legacy.id }, data: { bucket: e.bucket, unitCost: res.movement.unitCost, value: res.movement.value } });
      } else {
        createdCount++;
        if (!DRY) {
          movementWrites.push({ productId: p.id, type: e.type, bucket: e.bucket, qtyKg: res.movement.qtyKg, unitCost: res.movement.unitCost, value: res.movement.value, date: e.date, refId: e.refId, mvId: '' });
        }
      }
    }

    // ---------- 5. safety guard ----------
    // Live stock quantity is the number the shop physically sees. Only accept
    // the replay when it reproduces today's quantity, otherwise leave the
    // product untouched and report it instead of silently moving stock.
    const qtyOk = Math.abs(state.qtyKg - p.qtyKg) < 0.011;
    const dmgOk = Math.abs(state.damagedQtyKg - p.damagedQtyKg) < 0.011;
    if (!qtyOk || !dmgOk) {
      skipped.push(`${p.name}: replay qty=${state.qtyKg} db qty=${p.qtyKg} | replay dmg=${state.damagedQtyKg} db dmg=${p.damagedQtyKg}`);
      continue;
    }
    if (DRY) {
      touched++;
    const snapDelta = round2([...lineCogs.values()].reduce((a, b2) => a + b2, 0) - [...legacyAllocCogs.values()].reduce((a, b2) => a + b2, 0));
    if (Math.abs(snapDelta) >= 1) legacyDelta.push(`${p.name}: AVCO ${r2([...lineCogs.values()].reduce((a, b2) => a + b2, 0))} vs legacy snapshot ${r2([...legacyAllocCogs.values()].reduce((a, b2) => a + b2, 0))}`);
      console.log(`[dry] ${p.name}: opening=${openingQty}@${openingUnitCost}=${openingValue} dated ${openingDay} -> qty=${state.qtyKg} value=${state.stockValue} avg=${state.cost} unmatched=${createdCount}`);
      continue;
    }
    if (createdCount > 0) console.log(`  ${p.name}: created ${createdCount} missing movement row(s)`);

    // ---------- 5. write ----------
    for (const m of movementWrites) {
      await db.stockMovement.create({ data: { productId: m.productId, type: m.type, bucket: m.bucket, qtyKg: m.qtyKg, unitCost: m.unitCost, value: m.value, date: m.date, refId: m.refId } });
    }
    for (const [id, cogs] of lineCogs) await db.saleItem.update({ where: { id }, data: { cogs, unitCost: lineUnitCost.get(id) ?? 0 } });
    for (const i of returnItems) {
      const origUnitCost = returnUnitCost.get(i.id) ?? round2(
        i.saleItemId ? lineUnitCost.get(i.saleItemId) ?? i.rate
          : i.purchaseItemId ? purchaseItems.find(x => x.id === i.purchaseItemId)?.rate ?? i.rate
            : i.rate,
      );
      await db.productReturnItem.update({
        where: { id: i.id },
        data: {
          unitCost: origUnitCost,
          cogs: round2(i.goodKg * origUnitCost),
          damagedValue: round2(i.damagedKg * origUnitCost),
        },
      });
    }
    await db.product.update({
      where: { id: p.id },
      data: {
        openingUnitCost,
        openingValue,
        qtyKg: state.qtyKg,
        stockValue: state.stockValue,
        damagedQtyKg: state.damagedQtyKg,
        damagedValue: state.damagedValue,
        cost: state.cost,
      },
    });
    touched++;
  }

  // Returns keep their stored profitImpact for display; recompute from the new
  // historical cost basis so the two agree.
  if (skipped.length) {
    console.log(`\nSKIPPED ${skipped.length} product(s) whose replay does not match live stock:`);
    for (const s of skipped) console.log('  - ' + s);
  }
  if (DRY) { await db.$disconnect(); return; }
  const rets = await db.productReturn.findMany({ include: { items: true } });
  for (const r of rets) {
    if (r.kind !== 'sale') continue;
    const impact = round2(r.items.reduce((s, i) => s + i.amount - i.cogs, 0));
    await db.productReturn.update({ where: { id: r.id }, data: { profitImpact: impact } });
  }

  console.log(`${DRY ? 'DRY RUN: would backfill' : 'backfilled'} ${touched} products`);
  if (legacyDelta.length) {
    console.log(`\nAVCO vs legacy Sale.profit snapshot differs for ${legacyDelta.length} product(s) (AVCO is used):`);
    for (const s of legacyDelta) console.log('  - ' + s);
  }
  const bad = await db.product.findMany({ where: { OR: [{ qtyKg: { lt: 0 } }, { stockValue: { lt: -0.01 } }] }, select: { name: true, qtyKg: true, stockValue: true } });
  if (bad.length) console.log('WARNING negative stock/value:', bad);
}

main().finally(() => db.$disconnect());