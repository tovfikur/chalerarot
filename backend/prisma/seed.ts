// Dev database seed. Idempotent for development: wipes business data first,
// then rebuilds the same realistic demo dataset. NEVER run against production.
import { db } from '../src/db';
import { toKg } from '../src/units';
import {
  PRODUCT_DEFS, CUSTOMER_DEFS, VENDOR_DEFS,
  PURCHASE_UNITS, SALE_UNITS, PURCHASE_DATES, SALE_DATES, COLLECT_DATES, VPAY_DATES,
} from '../../src/seed';

let s = 7;
const rng = () => {
  s |= 0; s = (s + 0x6d2b79f5) | 0;
  let t = Math.imul(s ^ (s >>> 15), 1 | s);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const ri = (a: number, b: number) => a + Math.floor(rng() * (b - a + 1));
const pick = <T,>(arr: T[]): T => arr[Math.floor(rng() * arr.length)];
const dstr = (delta: number) => {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return d.toISOString().slice(0, 10);
};

const METHODS = ['cash', 'bkash', 'nagad', 'bank'] as const;
type M = (typeof METHODS)[number];
// Demo ledger helpers: seeded history mirrors the real API rules so balances
// move exactly like they do when the shop records a transaction.
const mv = (method: M, direction: 'in' | 'out', amount: number, date: string, sourceType: string, sourceId: string) =>
  ({ method, direction, amount, date, sourceType, sourceId, moneyAccountId: method });
const demoMethod = (i: number): M => METHODS[i % METHODS.length];

async function main() {
  // Wipe in FK-safe order (dev only).
  await db.stockMovement.deleteMany();
  await db.saleItem.deleteMany();
  await db.purchaseItem.deleteMany();
  await db.customerPayment.deleteMany();
  await db.vendorPayment.deleteMany();
  await db.expense.deleteMany();
  await db.moneyMovement.deleteMany();
  await db.moneyAccount.deleteMany();
  await db.productReturnItem.deleteMany();
  await db.productReturn.deleteMany();
  await db.notification.deleteMany();
  await db.sale.deleteMany();
  await db.purchase.deleteMany();
  await db.product.deleteMany();
  await db.customer.deleteMany();
  await db.vendor.deleteMany();

  const products = await Promise.all(PRODUCT_DEFS.map(([name, cost, price, opening, sb, mb, lb], i) =>
    db.product.create({
      data: {
        id: `p${i + 1}`, name, cost, price, openingQtyKg: opening, qtyKg: opening,
        smallBagKg: sb ?? 25, mediumBagKg: mb ?? 40, largeBagKg: lb ?? 50,
        movements: opening > 0 ? { create: [{ type: 'OPENING', qtyKg: opening, date: dstr(0) }] } : undefined,
      },
    }),
  ));
  const customers = await Promise.all(CUSTOMER_DEFS.map(([name, mobile, address, opening], i) =>
    db.customer.create({ data: { id: `c${i + 1}`, name, mobile, address, openingDue: opening } }),
  ));
  const vendors = await Promise.all(VENDOR_DEFS.map(([name, mobile, address, opening], i) =>
    db.vendor.create({ data: { id: `v${i + 1}`, name, mobile, address, openingPayable: opening } }),
  ));

  const avail: Record<string, number> = {};
  products.forEach(p => { avail[p.id] = p.qtyKg; });
  const owed: Record<string, number> = {};
  const paid: Record<string, number> = {};
  customers.forEach(c => { owed[c.id] = c.openingDue; paid[c.id] = 0; });
  vendors.forEach(v => { owed[v.id] = v.openingPayable; paid[v.id] = 0; });

  const bagsOf = (p: (typeof products)[number]) => ({ smallBagKg: p.smallBagKg, mediumBagKg: p.mediumBagKg, largeBagKg: p.largeBagKg });

  // Demo accounts + opening balances so Bank & Cash is not empty and FK is satisfied.
  const DEMO_ACCOUNTS: [string, string, number][] = [
    ['cash', 'Main Cash', 25000],
    ['bkash', 'bKash', 8000],
    ['nagad', 'Nagad', 5000],
    ['bank', 'Main Bank', 15000],
  ];
  for (const [type, name, opening] of DEMO_ACCOUNTS) {
    await db.moneyAccount.create({
      data: { id: type, name, type, legacyMethod: type, openingBalance: opening, openingDate: dstr(0), active: true },
    });
  }

  // Purchases
  for (let i = 0; i < PURCHASE_DATES.length; i++) {
    const v = vendors[i % vendors.length];
    const p = pick(products);
    const unit = PURCHASE_UNITS[i % PURCHASE_UNITS.length];
    const entered = unit === 'ton' ? (rng() < 0.5 ? 1 : 1.5) : unit === 'kg' ? ri(200, 800) : ri(5, 30);
    const qtyKg = Math.round(toKg(bagsOf(p), unit, entered));
    if (qtyKg <= 0) continue;
    const total = Math.round(qtyKg * p.cost);
    const date = dstr(-PURCHASE_DATES[i]);
    const pay = i % 3 === 0 ? total : i % 3 === 1 ? Math.round(total * (0.4 + rng() * 0.3)) : 0;
    await db.$transaction(async t => {
      const pur = await t.purchase.create({
        data: {
          vendorId: v.id, date, total, paid: pay, due: total - pay,
          items: { create: [{ productId: p.id, unit, enteredQty: entered, qtyKg, rate: p.cost }] },
        },
      });
      await t.product.update({ where: { id: p.id }, data: { qtyKg: { increment: qtyKg } } });
      await t.stockMovement.create({ data: { productId: p.id, type: 'PURCHASE', qtyKg, date, refId: pur.id } });
      if (pay > 0) {
        await t.vendorPayment.create({ data: { vendorId: v.id, purchaseId: pur.id, amount: pay, date } });
        await t.moneyMovement.create({ data: mv(demoMethod(i), 'out', pay, date, 'purchase', pur.id) });
      }
    });
    avail[p.id] += qtyKg;
    owed[v.id] += total; paid[v.id] += pay;
  }

  // Sales
  const order = [...products, ...products.slice(0, 7)];
  for (let i = 0; i < SALE_DATES.length; i++) {
    const p = order[i % order.length];
    let unit = SALE_UNITS[i % SALE_UNITS.length];
    if (unit === 'ton' && avail[p.id] < 1000) unit = 'large';
    const per = unit === 'kg' ? 1 : unit === 'ton' ? 1000
      : unit === 'small' ? p.smallBagKg : unit === 'medium' ? p.mediumBagKg : p.largeBagKg;
    let entered = unit === 'kg' ? ri(20, 120) : unit === 'ton' ? 1 : ri(1, 6);
    let qtyKg = Math.round(entered * per);
    if (qtyKg > avail[p.id]) {
      if (avail[p.id] <= 0) continue;
      qtyKg = Math.floor(avail[p.id]);
      entered = unit === 'kg' ? qtyKg : Math.max(1, Math.floor(qtyKg / per));
      qtyKg = Math.round(entered * per);
      if (qtyKg > avail[p.id] || qtyKg <= 0) continue;
    }
    const total = Math.round(qtyKg * p.price);
    const profit = total - Math.round(qtyKg * p.cost);
    const date = dstr(-SALE_DATES[i]);
    const r = rng();
    const fullCash = r < 0.35;
    const cid: string | null = fullCash ? (rng() < 0.5 ? null : pick(customers).id) : pick(customers).id;
    const pay = fullCash ? total : r < 0.75 ? Math.round(total * (0.3 + rng() * 0.4)) : 0;
    await db.$transaction(async t => {
      const sale = await t.sale.create({
        data: {
          customerId: cid, date, discount: 0, total, paid: pay, due: total - pay, profit,
          items: { create: [{ productId: p.id, unit, enteredQty: entered, qtyKg, rate: p.price }] },
        },
      });
      await t.product.update({ where: { id: p.id }, data: { qtyKg: { decrement: qtyKg } } });
      await t.stockMovement.create({ data: { productId: p.id, type: 'SALE', qtyKg: -qtyKg, date, refId: sale.id } });
      if (pay > 0) {
        await t.customerPayment.create({ data: { customerId: cid, saleId: sale.id, amount: pay, date } });
        await t.moneyMovement.create({ data: mv(demoMethod(i + 1), 'in', pay, date, 'sale', sale.id) });
      }
    });
    avail[p.id] -= qtyKg;
    if (cid) { owed[cid] += total; paid[cid] += pay; }
  }

  // Collections
  for (const ago of COLLECT_DATES) {
    for (let k = 0; k < 12; k++) {
      const c = pick(customers);
      const rem = owed[c.id] - paid[c.id];
      if (rem > 500) {
        const amt = Math.min(rem, ri(1000, 12000));
        const p1 = await db.customerPayment.create({ data: { customerId: c.id, amount: amt, date: dstr(-ago), note: 'আদায়' } });
        await db.moneyMovement.create({ data: mv(demoMethod(k), 'in', amt, dstr(-ago), 'customerPayment', p1.id) });
        paid[c.id] += amt;
        break;
      }
    }
  }

  // Vendor payments
  for (const ago of VPAY_DATES) {
    for (let k = 0; k < 12; k++) {
      const v = pick(vendors);
      const rem = owed[v.id] - paid[v.id];
      if (rem > 1000) {
        const amt = Math.min(rem, ri(5000, 40000));
        const p2 = await db.vendorPayment.create({ data: { vendorId: v.id, amount: amt, date: dstr(-ago) } });
        await db.moneyMovement.create({ data: mv(demoMethod(k + 2), 'out', amt, dstr(-ago), 'vendorPayment', p2.id) });
        paid[v.id] += amt;
        break;
      }
    }
  }

  // Demo expenses (2 today so Today's Expense/Profit show values)
  const demoExpenses = [
    { category: 'loading', amount: 2500, ago: 0, note: '২ ট্রাক চাল আনলোড' },
    { category: 'lunch', amount: 800, ago: 0, note: '' },
    { category: 'tea', amount: 350, ago: 1, note: '' },
    { category: 'transport', amount: 4500, ago: 3, note: 'দিনাজপুর ট্রিপ' },
    { category: 'salary', amount: 12000, ago: 5, note: 'কর্মচারী অগ্রিম' },
    { category: 'other', customName: 'বাজার কমিটি চাঁদা', amount: 1500, ago: 8, note: 'অক্টোবর মাসের চাঁদা' },
    { category: 'electricity', amount: 2200, ago: 12, note: '' },
  ];
  for (let i = 0; i < demoExpenses.length; i++) {
    const e = demoExpenses[i];
    const day = dstr(-e.ago);
    const created = await db.expense.create({
      data: { category: e.category, customName: (e as { customName?: string }).customName ?? null, amount: e.amount, date: day, note: e.note || null },
    });
    await db.moneyMovement.create({ data: mv(demoMethod(i + 3), 'out', e.amount, day, 'expense', created.id) });
  }

  // Expected payment dates
  for (let i = 0; i < customers.length; i++) {
    if (owed[customers[i].id] - paid[customers[i].id] > 1000 && i % 3 !== 2) {
      await db.customer.update({ where: { id: customers[i].id }, data: { nextDate: dstr(ri(3, 14)) } });
    }
  }
  for (let i = 0; i < vendors.length; i++) {
    if (owed[vendors[i].id] - paid[vendors[i].id] > 5000 && i % 3 !== 2) {
      await db.vendor.update({ where: { id: vendors[i].id }, data: { nextDate: dstr(ri(3, 14)) } });
    }
  }

  const counts = await Promise.all([
    db.product.count(), db.customer.count(), db.vendor.count(),
    db.purchase.count(), db.sale.count(), db.customerPayment.count(), db.vendorPayment.count(),
  ]);
  console.log(`seeded products=${counts[0]} customers=${counts[1]} vendors=${counts[2]} purchases=${counts[3]} sales=${counts[4]} collections=${counts[5]} vendorPayments=${counts[6]}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
