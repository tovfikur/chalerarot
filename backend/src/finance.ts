import { db } from './db';
import { todayStr } from './units';

/**
 * THE single canonical financial calculation. Home, Accounts and the API all
 * read these numbers; nothing else is allowed to compute profit independently.
 *
 *   Net Sales     = Sales - Sales Return
 *   Net Purchase  = Purchase - Purchase Return
 *   COGS          = Opening Stock Value + Net Purchase - Closing Stock Value
 *   Gross Profit  = Net Sales - COGS
 *   Net Profit    = Gross Profit - Expenses
 *
 * Opening/closing stock values come from the dated StockMovement trail (never
 * from the Product's current cost), so any Day/Month/Year period is correct.
 */

export type PeriodMode = 'day' | 'month' | 'year' | 'all' | 'range';

export type PeriodFinance = {
  mode: PeriodMode;
  start: string;
  end: string;
  sales: number;
  salesReturn: number;
  netSales: number;
  /** Opening Stock Value used by the formula = carry-in + baseline added in period. */
  openingStockValue: number;
  /** Inventory already on hand when the period started. */
  openingStockCarryIn: number;
  /** Opening-stock baseline recorded inside the period (product setup). */
  openingStockAdded: number;
  purchase: number;
  purchaseReturn: number;
  netPurchase: number;
  closingStockValue: number;
  damagedStockValue: number;
  cogs: number;
  grossProfit: number;
  expense: number;
  netProfit: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const sum = (a: number[]) => round2(a.reduce((s, x) => s + x, 0));

/** Inclusive business-date bounds for a period. */
export function periodBounds(mode: PeriodMode, ref?: string, end?: string): { start: string; end: string } {
  if (mode === 'all') return { start: '0000-01-01', end: '9999-12-31' };
  if (mode === 'range') {
    const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
    const s = ok(ref) ? ref! : todayStr();
    const e = ok(end) ? end! : s;
    return s <= e ? { start: s, end: e } : { start: e, end: s };
  }
  const day = ref && /^\d{4}-\d{2}-\d{2}$/.test(ref) ? ref : todayStr();
  const [y, m, d] = day.split('-').map(Number);
  if (mode === 'day') return { start: day, end: day };
  if (mode === 'month') {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return { start: `${day.slice(0, 7)}-01`, end: `${day.slice(0, 7)}-${String(last).padStart(2, '0')}` };
  }
  return { start: `${y}-01-01`, end: `${y}-12-31` };
}

/**
 * Sellable inventory value immediately BEFORE `start` (opening) and up to and
 * including `end` (closing), from the movement trail only.
 * Damaged stock is reported separately and never counted as sellable stock.
 */
export async function inventoryValueAt(date: string, inclusive: boolean): Promise<{ sellable: number; damaged: number }> {
  const rows = await db.stockMovement.findMany({
    where: inclusive ? { date: { lte: date } } : { date: { lt: date } },
    select: { bucket: true, value: true },
  });
  let sellable = 0;
  let damaged = 0;
  for (const r of rows) {
    if (r.bucket === 'damaged') damaged += r.value;
    else sellable += r.value;
  }
  return { sellable: round2(sellable), damaged: round2(damaged) };
}

export async function periodFinance(mode: PeriodMode, ref?: string, end?: string): Promise<PeriodFinance> {
  const bounds = periodBounds(mode, ref, end);
  const { start, end: endDate } = bounds;
  const inRange = { gte: start, lte: endDate };
  const before = { lt: start };

  const [sales, rets, purchases, expenses, openV, closeV, openingAdded] = await Promise.all([
    db.sale.findMany({ where: { date: inRange }, select: { total: true } }),
    db.productReturn.findMany({ where: { date: inRange }, select: { kind: true, totalAmount: true } }),
    db.purchase.findMany({ where: { date: inRange }, select: { total: true } }),
    db.expense.findMany({ where: { date: inRange, deletedAt: null }, select: { amount: true } }),
    inventoryValueAt(start, false),
    inventoryValueAt(endDate, true),
    // Opening stock set up inside the period is an inflow of inventory value. It
    // is not a Purchase, so without this a period that begins before the shop
    // existed would show a negative COGS.
    db.stockMovement.findMany({ where: { type: 'OPENING', bucket: 'sellable', date: inRange }, select: { value: true } }),
  ]);

  const salesTotal = sum(sales.map(s => s.total));
  const salesReturn = sum(rets.filter(r => r.kind === 'sale').map(r => r.totalAmount));
  const purchase = sum(purchases.map(p => p.total));
  const purchaseReturn = sum(rets.filter(r => r.kind === 'purchase').map(r => r.totalAmount));
  const expense = sum(expenses.map(e => e.amount));

  const netSales = round2(salesTotal - salesReturn);
  const netPurchase = round2(purchase - purchaseReturn);
  const openingStockCarryIn = openV.sellable;
  const openingStockAdded = round2(openingAdded.reduce((acc, x) => acc + x.value, 0));
  const openingStockValue = round2(openingStockCarryIn + openingStockAdded);
  const closingStockValue = closeV.sellable;
  const cogs = round2(openingStockValue + netPurchase - closingStockValue);
  const grossProfit = round2(netSales - cogs);
  const netProfit = round2(grossProfit - expense);

  return {
    mode, start, end: endDate,
    sales: salesTotal, salesReturn, netSales,
    openingStockValue, openingStockCarryIn, openingStockAdded,
    purchase, purchaseReturn, netPurchase,
    closingStockValue, damagedStockValue: closeV.damaged,
    cogs, grossProfit, expense, netProfit,
  };
}

/**
 * Lifetime (all-time) figures: the exact same canonical calculation over the
 * widest possible window, so there is only ever one implementation.
 */
export async function lifetimeFinance(): Promise<PeriodFinance> {
  const f = await periodFinance('all');
  return { ...f, mode: 'all', start: '', end: '' };
}