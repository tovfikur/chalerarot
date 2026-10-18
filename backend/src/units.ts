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

export const todayStr = () => new Date().toISOString().slice(0, 10);

// Business calendar date (Asia/Dhaka) as YYYY-MM-DD. Used for reminders so
// the "today/tomorrow" boundary matches the shop's day, not UTC.
export const businessToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });

const TXN_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const pastErr = (what: string) =>
  Object.assign(new Error(`${what} cannot be in the past`), { status: 400, code: 'DATE_IN_PAST' });

// Operational transaction dates (sale, purchase, payment, return, expense,
// transfer) are recorded for the current business day or a future one.
// Absent/malformed input resolves to the business day (never rejected, so the
// default can never trip the rule in the UTC-midnight window); an explicit
// past date throws a 400-coded error so direct API calls cannot backdate.
export function transactionDay(date: unknown): string {
  if (typeof date !== 'string' || !TXN_DATE_RE.test(date)) return businessToday();
  if (date < businessToday()) throw pastErr('Transaction date');
  return date;
}

// Promise dates ("next payment date") follow the same today-or-future rule —
// today is valid because reminders fire for today's promises too. Anything
// that is not a well-formed date passes through untouched (existing leniency
// for omitted/cleared values is preserved); only an explicit past date fails.
export function checkPromiseDay(next: unknown): void {
  if (typeof next === 'string' && TXN_DATE_RE.test(next) && next < businessToday()) {
    throw pastErr('Next date');
  }
}

export const addDays = (dstr: string, days: number) => {
  const d = new Date(dstr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
