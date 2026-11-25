import { db } from './db';

const WAGE_PER_BAG = 6;
const round2 = (value: number) => Math.round(value * 100) / 100;
const BAG_UNITS = new Set(['small', 'medium', 'large']);

/** Reconcile attendance-weighted stock-out wages for a calendar month. */
export async function syncAttendanceWages(month: string) {
  const attendance = await db.labourAttendance.findMany({
    where: { date: { startsWith: `${month}-` } },
    select: { date: true, labourerId: true, value: true },
  });
  const attendanceByDate = new Map<string, typeof attendance>();
  for (const row of attendance) {
    const rows = attendanceByDate.get(row.date) ?? [];
    rows.push(row);
    attendanceByDate.set(row.date, rows);
  }

  const existingAuto = await db.labourCost.findMany({
    where: { direction: 'stockOut', attendanceAutoKey: { startsWith: `${month}-` } },
    select: { date: true },
    distinct: ['date'],
  });
  const dates = new Set([...attendanceByDate.keys(), ...existingAuto.map(row => row.date)]);
  for (const date of dates) {
    const dayAttendance = attendanceByDate.get(date) ?? [];
    const [saleItems, manualCosts, autoCosts] = await Promise.all([
      db.saleItem.findMany({ where: { sale: { is: { date } } }, select: { unit: true, enteredQty: true } }),
      db.labourCost.findMany({ where: { date, direction: 'stockOut', attendanceAutoKey: null }, select: { id: true } }),
      db.labourCost.findMany({ where: { date, direction: 'stockOut', attendanceAutoKey: { startsWith: `${date}:` } }, select: { id: true, labourerId: true, attendanceAutoKey: true } }),
    ]);
    // Keep historic manual entries as-is and remove any generated duplicate for that day.
    if (manualCosts.length) {
      const workerIds = [...new Set(autoCosts.map(row => row.labourerId))];
      const hasPayments = workerIds.length ? await db.labourPayment.count({ where: { labourerId: { in: workerIds }, direction: 'stockOut', date: { gte: date } } }) : 0;
      if (!hasPayments) await db.labourCost.deleteMany({ where: { date, direction: 'stockOut', attendanceAutoKey: { startsWith: `${date}:` } } });
      continue;
    }
    const soldBags = saleItems.reduce((sum, item) => sum + (BAG_UNITS.has(item.unit) ? item.enteredQty : 0), 0);
    const activeAttendance = dayAttendance.filter(row => row.value > 0);
    const attendanceUnits = activeAttendance.reduce((sum, row) => sum + row.value, 0);
    if (soldBags <= 0 || attendanceUnits <= 0) {
      const workerIds = [...new Set([...autoCosts.map(row => row.labourerId), ...dayAttendance.map(row => row.labourerId)])];
      const hasPayments = workerIds.length ? await db.labourPayment.count({ where: { labourerId: { in: workerIds }, direction: 'stockOut', date: { gte: date } } }) : 0;
      if (!hasPayments) await db.labourCost.deleteMany({ where: { date, direction: 'stockOut', attendanceAutoKey: { startsWith: `${date}:` } } });
      continue;
    }

    const workerIds = activeAttendance.map(row => row.labourerId);
    const laterPayments = await db.labourPayment.count({ where: { labourerId: { in: workerIds }, direction: 'stockOut', date: { gte: date } } });
    // Once a payment has been allocated, freeze that day's generated wages.
    if (autoCosts.length && laterPayments > 0) continue;

    const activeIds = new Set(workerIds);
    for (const stale of autoCosts) {
      if (!activeIds.has(stale.labourerId) && stale.attendanceAutoKey) await db.labourCost.delete({ where: { id: stale.id } });
    }
    for (const row of activeAttendance) {
      const quantity = soldBags * row.value / attendanceUnits;
      const amount = round2(quantity * WAGE_PER_BAG);
      const key = `${date}:${row.labourerId}`;
      await db.labourCost.upsert({
        where: { attendanceAutoKey: key },
        create: {
          attendanceAutoKey: key, labourerId: row.labourerId, date, direction: 'stockOut',
          quantity, pricePerBag: WAGE_PER_BAG, amount, advanceApplied: 0,
          note: `Automatic attendance wage · ${round2(soldBags)} bags × ৳${WAGE_PER_BAG}/bag`,
        },
        update: { quantity, pricePerBag: WAGE_PER_BAG, amount, note: `Automatic attendance wage · ${round2(soldBags)} bags × ৳${WAGE_PER_BAG}/bag` },
      });
    }
  }
}
