import { db } from './db';
import type { TxClient } from './routes/transactions';
import { businessToday } from './units';

/**
 * Money accounts + ledger.
 *
 * MoneyAccount rows are the shop's real accounts (Main Cash, BRAC Bank, bKash
 * Merchant...). Each account owns an opening balance; every actual money
 * movement is a MoneyMovement row pointing at that account. The current balance
 * is always DERIVED (opening + IN - OUT), never a second stored counter.
 *
 * `method` on a movement is the account TYPE label (cash|bank|bkash|nagad|rocket)
 * and is kept for legacy rows and quick grouping.
 */

export const MONEY_METHODS = ['cash', 'bkash', 'nagad', 'bank'] as const;
export type MoneyMethod = (typeof MONEY_METHODS)[number];

/** Account types. Extra types can be added here without touching movements. */
export const ACCOUNT_TYPES = ['cash', 'bank', 'bkash', 'nagad', 'rocket'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

export const ACCOUNT_TYPE_LABEL: Record<AccountType, { bn: string; en: string }> = {
  cash: { bn: 'ক্যাশ', en: 'Cash' },
  bank: { bn: 'ব্যাংক', en: 'Bank' },
  bkash: { bn: 'বিকাশ', en: 'bKash' },
  nagad: { bn: 'নগদ', en: 'Nagad' },
  rocket: { bn: 'রকেট', en: 'Rocket' },
};

export type MoneyDirection = 'in' | 'out';
export type MoneySourceType =
  | 'sale'
  | 'purchase'
  | 'customerPayment'
  | 'vendorPayment'
  | 'expense'
  | 'saleReturn'
  | 'purchaseReturn'
  | 'transferOut'
  | 'transferIn'
  | 'openingAdjust';

export const isMoneyMethod = (v: unknown): v is MoneyMethod =>
  typeof v === 'string' && (MONEY_METHODS as readonly string[]).includes(v);

export const isAccountType = (v: unknown): v is AccountType =>
  typeof v === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(v);

/** Validate a payment method coming from a request body (legacy payloads). */
export function requireMethod(v: unknown): MoneyMethod {
  if (!isMoneyMethod(v)) throw Object.assign(new Error('Invalid payment method'), { status: 400 });
  return v;
}

export function requireAccountType(v: unknown): AccountType {
  if (!isAccountType(v)) throw Object.assign(new Error('Invalid account type'), { status: 400 });
  return v;
}

/**
 * Method is only optional when no money actually moves, or when the request
 * already names the concrete account (accountId) that the money moves through.
 */
export function methodForAmount(v: unknown, amount: number, hasAccount = false): MoneyMethod | null {
  if (!(amount > 0)) return null;
  if (hasAccount) return isMoneyMethod(v) ? v : null;
  return requireMethod(v);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export type AccountRow = {
  id: string; name: string; type: string; openingBalance: number;
  openingDate: string | null; bankName: string | null; accountNumber: string | null;
  branch: string | null; mobileNumber: string | null; note: string | null; active: boolean;
};

/**
 * Resolve which account a payment should move through.
 *  - an explicit accountId wins (validated, must be active)
 *  - otherwise the legacy method/type is used: the original account of that
 *    type, else the single active account of that type
 *  - if the shop has no account of that type yet, one is created so money is
 *    never dropped
 */
export async function resolveAccount(
  t: TxClient,
  input: { accountId?: string | null; method?: string | null },
): Promise<AccountRow> {
  if (input.accountId) {
    const a = await t.moneyAccount.findUnique({ where: { id: String(input.accountId) } });
    if (!a) throw Object.assign(new Error('Money account not found'), { status: 400 });
    if (!a.active) throw Object.assign(new Error('This money account is inactive'), { status: 400 });
    return a;
  }
  const method = String(input.method ?? 'cash');
  if (!isAccountType(method)) throw Object.assign(new Error('Invalid payment method'), { status: 400 });
  const legacy = await t.moneyAccount.findFirst({ where: { legacyMethod: method }, orderBy: { createdAt: 'asc' } });
  if (legacy) return legacy;
  const activeOfType = await t.moneyAccount.findMany({ where: { type: method, active: true }, orderBy: { createdAt: 'asc' } });
  if (activeOfType.length) return activeOfType[0];
  const created = await t.moneyAccount.create({
    data: {
      name: ACCOUNT_TYPE_LABEL[method].en, type: method,
      legacyMethod: activeOfType.length || (await t.moneyAccount.count({ where: { type: method } })) === 0 ? method : null,
      openingBalance: 0, openingDate: businessToday(),
    },
  });
  return created;
}

/**
 * Lock several accounts in a stable order (sorted by id) so two transfers in
 * opposite directions can never deadlock each other.
 */
export async function lockAccounts(t: TxClient, accountIds: string[]): Promise<void> {
  for (const id of [...new Set(accountIds)].sort()) await lockAccount(t, id);
}

/** Serialize concurrent money work that touches the same account. */
export async function lockAccount(t: TxClient, accountId: string): Promise<void> {
  // $executeRaw (not $queryRaw): pg_advisory_xact_lock returns void, which
  // Prisma cannot deserialize. Only the row count is needed.
  await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${accountId}))`;
}

/**
 * Record one actual money movement. Called inside the same transaction as the
 * business document so the ledger can never drift from sales/due totals.
 * The unique (sourceType, sourceId) pair makes retries idempotent.
 */
export async function recordMovement(
  t: TxClient,
  m: {
    accountId: string; method: string; direction: MoneyDirection; amount: number; date: string;
    sourceType: MoneySourceType; sourceId: string; note?: string | null; transferId?: string | null;
  },
): Promise<void> {
  if (!(m.amount > 0)) return;
  await t.moneyMovement.create({
    data: {
      moneyAccountId: m.accountId,
      method: m.method,
      direction: m.direction,
      amount: round2(m.amount),
      date: m.date,
      sourceType: m.sourceType,
      sourceId: m.sourceId,
      transferId: m.transferId ?? null,
      note: m.note ?? null,
    },
  });
}

/** Keep the ledger in step with an edited source document (expense edit). */
export async function updateMovement(
  t: TxClient,
  sourceType: MoneySourceType,
  sourceId: string,
  m: { accountId: string; method: string; direction: MoneyDirection; amount: number; date: string },
): Promise<void> {
  // Upsert: expenses saved before this feature have no ledger row yet, so the
  // first edit after the upgrade creates it instead of failing.
  await t.moneyMovement.upsert({
    where: { sourceType_sourceId: { sourceType, sourceId } },
    create: {
      moneyAccountId: m.accountId, method: m.method, direction: m.direction,
      amount: round2(m.amount), date: m.date, sourceType, sourceId,
    },
    update: {
      moneyAccountId: m.accountId, method: m.method, direction: m.direction,
      amount: round2(m.amount), date: m.date, active: true,
    },
  });
}

/** Trashing a source document must stop counting its movement. Restore reverses this. */
export async function setMovementActive(
  t: TxClient,
  sourceType: MoneySourceType,
  sourceId: string,
  active: boolean,
): Promise<void> {
  await t.moneyMovement.updateMany({ where: { sourceType, sourceId }, data: { active } });
}

export type AccountBalance = {
  id: string; name: string; type: string;
  openingBalance: number; openingDate: string | null;
  bankName?: string; accountNumber?: string; branch?: string; mobileNumber?: string; note?: string;
  active: boolean;
  /** Financial history that must never be destroyed by a delete. */
  movementCount: number; transferCount: number; hasHistory: boolean;
  balance: number; todayIn: number; todayOut: number;
};

/**
 * Canonical per-account balances: opening + active IN - active OUT.
 * Derived from the ledger every time; nothing is stored.
 */
export async function accountBalances(client: typeof db | TxClient = db, today?: string): Promise<AccountBalance[]> {
  const accounts = await client.moneyAccount.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'asc' }] });
  const grouped = await client.moneyMovement.groupBy({
    by: ['moneyAccountId', 'direction'],
    where: { active: true },
    _sum: { amount: true },
  });
  // Two grouped counts (not per-account queries) tell the UI whether permanent
  // deletion is allowed: any movement or transfer side is financial history.
  const mvCounts = await client.moneyMovement.groupBy({ by: ['moneyAccountId'], _count: { _all: true } });
  const outCounts = await client.moneyTransfer.groupBy({ by: ['fromAccountId'], _count: { _all: true } });
  const inCounts = await client.moneyTransfer.groupBy({ by: ['toAccountId'], _count: { _all: true } });
  const countOf = (rows: { [k: string]: unknown; _count: { _all: number } }[], k: string, id: string) =>
    rows.find(r => (r[k] as string | null) === id)?._count._all ?? 0;
  const day = today ?? businessToday();
  const todayRows = await client.moneyMovement.groupBy({
    by: ['moneyAccountId', 'direction'],
    where: { active: true, date: day },
    _sum: { amount: true },
  });
  const sumFor = (rows: typeof grouped, accountId: string | null, d: MoneyDirection) =>
    round2(rows.find(r => r.moneyAccountId === accountId && r.direction === d)?._sum.amount ?? 0);
  return accounts.map(a => {
    const inflow = sumFor(grouped, a.id, 'in');
    const outflow = sumFor(grouped, a.id, 'out');
    return {
      id: a.id, name: a.name, type: a.type,
      openingBalance: round2(a.openingBalance), openingDate: a.openingDate,
      bankName: a.bankName ?? undefined, accountNumber: a.accountNumber ?? undefined,
      branch: a.branch ?? undefined, mobileNumber: a.mobileNumber ?? undefined, note: a.note ?? undefined,
      active: a.active,
      movementCount: countOf(mvCounts, 'moneyAccountId', a.id),
      transferCount: countOf(outCounts, 'fromAccountId', a.id) + countOf(inCounts, 'toAccountId', a.id),
      hasHistory: countOf(mvCounts, 'moneyAccountId', a.id) > 0
        || countOf(outCounts, 'fromAccountId', a.id) > 0
        || countOf(inCounts, 'toAccountId', a.id) > 0,
      balance: round2(a.openingBalance + inflow - outflow),
      todayIn: sumFor(todayRows, a.id, 'in'),
      todayOut: sumFor(todayRows, a.id, 'out'),
    };
  });
}

/** Current balance of ONE account (canonical maths). */
export async function accountBalance(client: typeof db | TxClient, accountId: string): Promise<number> {
  const [a, grouped] = await Promise.all([
    client.moneyAccount.findUnique({ where: { id: accountId } }),
    client.moneyMovement.groupBy({ by: ['direction'], where: { moneyAccountId: accountId, active: true }, _sum: { amount: true } }),
  ]);
  if (!a) return 0;
  const sumOf = (d: MoneyDirection) => grouped.find(g => g.direction === d)?._sum.amount ?? 0;
  return round2(a.openingBalance + sumOf('in') - sumOf('out'));
}

export type MoneyBalance = {
  method: MoneyMethod;
  opening: number;
  balance: number;
  todayIn: number;
  todayOut: number;
};

/**
 * Legacy per-TYPE payload (method = payment type). Kept so older clients keep
 * working; it is the sum of the accounts of that type.
 */
export async function moneyBalances(client: typeof db | TxClient = db, today?: string): Promise<MoneyBalance[]> {
  const perAccount = await accountBalances(client, today);
  return MONEY_METHODS.map(method => {
    const rows = perAccount.filter(a => a.type === method);
    return {
      method,
      opening: round2(rows.reduce((s, a) => s + a.openingBalance, 0)),
      balance: round2(rows.reduce((s, a) => s + a.balance, 0)),
      todayIn: round2(rows.reduce((s, a) => s + a.todayIn, 0)),
      todayOut: round2(rows.reduce((s, a) => s + a.todayOut, 0)),
    };
  });
}