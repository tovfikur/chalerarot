// Shared KG conversion. Stock is ALWAYS KG; bags/ton are entry units only.
export type BagUnit = 'kg' | 'small' | 'medium' | 'large' | 'ton';

export const KG_PER_TON = 1000;
export const DEFAULT_BAGS = { small: 25, medium: 40, large: 50 };

type BagHolder = { smallBagKg: number; mediumBagKg: number; largeBagKg: number };

export function kgPerUnit(p: BagHolder | undefined, unit: BagUnit): number {
  if (unit === 'kg') return 1;
  if (unit === 'ton') return KG_PER_TON;
  const v = !p ? 0 : unit === 'small' ? p.smallBagKg : unit === 'medium' ? p.mediumBagKg : p.largeBagKg;
  return v > 0 ? v : DEFAULT_BAGS[unit];
}

export function toKg(p: BagHolder | undefined, unit: BagUnit, qty: number): number {
  return qty * kgPerUnit(p, unit);
}

export const isUnit = (u: unknown): u is BagUnit =>
  u === 'kg' || u === 'small' || u === 'medium' || u === 'large' || u === 'ton';

export const todayStr = () => businessToday();

// Business calendar date (Asia/Dhaka) as YYYY-MM-DD.
export const businessToday = () => {
  try {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
};

const TXN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Operational transaction dates (sale, purchase, payment, return, expense,
// transfer). If a valid YYYY-MM-DD string is provided, use it; otherwise default to businessToday().
export function transactionDay(date: unknown): string {
  if (typeof date === 'string' && TXN_DATE_RE.test(date)) return date;
  return businessToday();
}

// Promise dates ("next payment date").
export function checkPromiseDay(_next: unknown): void {
  // Pass-through validation
}

export const addDays = (dstr: string, days: number) => {
  const d = new Date(dstr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
