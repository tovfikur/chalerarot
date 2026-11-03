import 'dotenv/config';
import { db } from '../src/db';

async function main() {
  const date = new Date().toISOString().slice(0, 10);
  await db.$transaction(async tx => {
    for (const type of ['cash', 'bank', 'bkash', 'nagad']) {
      await tx.moneyAccount.upsert({ where: { id: type }, update: {}, create: {
        id: type, name: `Demo ${type}`, type, legacyMethod: type,
        openingBalance: type === 'cash' ? 100000 : 0, openingDate: date, active: true,
      } });
    }
    for (const [i, name] of ['Miniket Rice', 'Nazirshail Rice', 'Basmati Rice'].entries()) {
      const id = `demo-rice-${i + 1}`;
      if (await tx.product.findUnique({ where: { id } })) continue;
      const cost = 50 + i * 15;
      await tx.product.create({ data: {
        id, name, code: `DEMO-${i + 1}`, cost, price: cost + 10,
        openingQtyKg: 500, openingUnitCost: cost, openingValue: cost * 500,
        qtyKg: 500, stockValue: cost * 500,
        movements: { create: { type: 'OPENING', qtyKg: 500, unitCost: cost, value: cost * 500, date } },
      } });
    }
    await tx.customer.upsert({ where: { id: 'demo-customer' }, update: {}, create: {
      id: 'demo-customer', name: 'Demo Rice Shop', address: 'Dhaka',
    } });
    await tx.vendor.upsert({ where: { id: 'demo-vendor' }, update: {}, create: {
      id: 'demo-vendor', name: 'Demo Rice Mill', address: 'Kushtia',
    } });
  });
  console.log('Demo accounts, products, opening stock, customer and vendor are ready.');
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.$disconnect());
