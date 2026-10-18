/**
 * Runtime check of the valuation write path. Everything runs inside ONE
 * transaction that is deliberately rolled back, so no record is changed.
 */
import { db } from '../src/db';
import { currentAvgCost, writeMovement, revalueStock } from '../src/valuation';

const r2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const p0 = await db.product.findFirst({ where: { qtyKg: { gt: 100 } }, orderBy: { id: 'asc' } });
  if (!p0) throw new Error('no product');
  const day = new Date().toISOString().slice(0, 10);
  const log: string[] = [];

  try {
    await db.$transaction(async t => {
      const before = await t.product.findUnique({ where: { id: p0.id } });
      log.push(`start        qty=${before!.qtyKg} value=${before!.stockValue} avg=${before!.cost}`);

      const q0 = before!.qtyKg, v0 = before!.stockValue;
      const avg0 = r2(v0 / q0);

      // 1) buy 100 KG @ 60 -> weighted average re-blends
      const buy = await writeMovement(t, p0.id, { type: 'PURCHASE', bucket: 'sellable', qtyKg: 100, unitCost: 60, date: day });
      const avg1Raw = (v0 + 6000) / (q0 + 100);   // unrounded: the engine must not round intermediates
      const avg1 = r2(avg1Raw);
      log.push(`buy 100@60   qty=${buy.qtyAfter} value=${buy.valueAfter} avg=${buy.avgAfter} (expected ${avg1})`);
      if (Math.abs(buy.avgAfter - avg1) > 0.05) throw new Error('AVCO blend wrong');

      // 2) sell 20 KG at the current average
      const unitCost = await currentAvgCost(t, p0.id);
      const sale = await writeMovement(t, p0.id, { type: 'SALE', bucket: 'sellable', qtyKg: -20, unitCost, date: day });
      const expectCogs = r2(20 * avg1Raw);
      log.push(`sell 20      qty=${sale.qtyAfter} value=${sale.valueAfter} avg=${sale.avgAfter} costUsed=${sale.unitCost} (expected cogs -${expectCogs})`);
      if (Math.abs(sale.value + expectCogs) > 0.05) throw new Error('sale COGS wrong');

      // 3) good sales return 5 KG at the ORIGINAL sale cost (avg1)
      const good = await writeMovement(t, p0.id, { type: 'SRETURN', bucket: 'sellable', qtyKg: 5, unitCost: avg1, date: day });
      const expectGood = r2(5 * avg1Raw);
      log.push(`good ret 5   qty=${good.qtyAfter} value=${good.valueAfter} (expected +${expectGood})`);
      if (Math.abs(good.value - expectGood) > 0.05) throw new Error('good return value wrong');

      // 4) damaged sales return 3 KG -> damaged bucket only, sellable value untouched
      const dmg = await writeMovement(t, p0.id, { type: 'SRETURN_DMG', bucket: 'damaged', qtyKg: 3, unitCost: avg1, date: day });
      const pd = await t.product.findUnique({ where: { id: p0.id } });
      log.push(`dmg ret 3    sellableQty=${dmg.qtyAfter} sellableValue=${dmg.valueAfter} damagedQty=${pd!.damagedQtyKg} damagedValue=${pd!.damagedValue}`);
      if (Math.abs(dmg.valueAfter - (sale.valueAfter + expectGood)) > 0.05) throw new Error('damaged return leaked into sellable value');
      if (Math.abs(pd!.damagedValue - r2(3 * avg1)) > 0.05) throw new Error('damaged value wrong');

      // 5) purchase return 10 KG at the ORIGINAL purchase rate 60
      const pret = await writeMovement(t, p0.id, { type: 'PRETURN', bucket: 'sellable', qtyKg: -10, unitCost: 60, date: day, forceUnitCost: true });
      log.push(`pret 10@60   qty=${pret.qtyAfter} value=${pret.valueAfter} (expect -600 at original rate)`);
      if (Math.abs(pret.value + 600) > 0.001) throw new Error('purchase return valuation wrong');

      // 6) manual cost edit re-values stock on hand and records REVALUE
      await revalueStock(t, p0.id, 70, day);
      const p2 = await t.product.findUnique({ where: { id: p0.id } });
      log.push(`cost->70     qty=${p2!.qtyKg} value=${p2!.stockValue} avg=${p2!.cost} (expect value=qty*70)`);
      if (Math.abs(p2!.stockValue - p2!.qtyKg * 70) > 0.01) throw new Error('revalue inconsistent');

      const mvs = await t.stockMovement.findMany({ where: { productId: p0.id, date: day }, orderBy: { createdAt: 'asc' } });
      log.push('movements written today: ' + mvs.map(m => `${m.type}/${m.bucket} q=${m.qtyKg}@${m.unitCost}=>${m.value}`).join(' , '));

      throw new Error('__ROLLBACK__');
    });
  } catch (e) {
    if (!(e instanceof Error) || e.message !== '__ROLLBACK__') throw e;
  }

  const after = await db.product.findUnique({ where: { id: p0.id } });
  const afterMv = await db.stockMovement.count({ where: { productId: p0.id, date: day } });
  log.push(`after rollback qty=${after!.qtyKg} value=${after!.stockValue} avg=${after!.cost} movementsToday=${afterMv}`);
  console.log(log.join('\n'));
  console.log('\nALL VALUATION ASSERTIONS PASSED (transaction rolled back, no data changed)');
}

main().finally(() => db.$disconnect());
