// One-time backfill: assign invoice numbers to sales/purchases created
// before the invoice feature, ordered by (date, createdAt) per year.
// Amounts/history are never modified. Safe to re-run (skips numbered rows).
import { db } from '../src/db';

const pad = (n: number) => String(n).padStart(6, '0');

async function backfill(
  list: { id: string; date: string }[],
  prefix: string,
  apply: (id: string, no: string) => Promise<unknown>,
) {
  const byYear = new Map<string, { id: string; date: string }[]>();
  for (const r of list) {
    const y = r.date.slice(0, 4);
    if (!byYear.has(y)) byYear.set(y, []);
    byYear.get(y)!.push(r);
  }
  let done = 0;
  for (const [year, rows] of [...byYear.entries()].sort()) {
    rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id < b.id ? -1 : 1));
    const existing = await db.sequence.findUnique({ where: { key: `${prefix}:${year}` } });
    let n = existing?.last ?? 0;
    for (const r of rows) {
      n++;
      await apply(r.id, `${prefix}-${year}-${pad(n)}`);
      done++;
    }
    await db.sequence.upsert({
      where: { key: `${prefix}:${year}` },
      update: { last: Math.max(n, existing?.last ?? 0) },
      create: { key: `${prefix}:${year}`, last: n },
    });
  }
  return done;
}

async function main() {
  const sales = await db.sale.findMany({ where: { invoiceNo: null }, select: { id: true, date: true, createdAt: true } });
  const purs = await db.purchase.findMany({ where: { invoiceNo: null }, select: { id: true, date: true, createdAt: true } });
  const s = await backfill(
    sales.map(x => ({ ...x })),
    'SAL',
    (id, no) => db.sale.update({ where: { id }, data: { invoiceNo: no } }),
  );
  const p = await backfill(
    purs.map(x => ({ ...x })),
    'PUR',
    (id, no) => db.purchase.update({ where: { id }, data: { invoiceNo: no } }),
  );
  console.log(`backfilled sales=${s} purchases=${p}`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => db.$disconnect());
