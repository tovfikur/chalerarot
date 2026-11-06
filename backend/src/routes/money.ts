import { Router, Request, Response } from 'express';
import { db } from '../db';
import {
  ACCOUNT_TYPES, ACCOUNT_TYPE_LABEL, accountBalance, accountBalances, isAccountType, lockAccount, lockAccounts,
  moneyBalances, nextMoneyTransactionNo, recordMovement, requireAccountType, resolveAccount, type AccountRow,
} from '../money';
import { nextInvoiceNo } from './transactions';
import type { TxClient } from './transactions';
import { transactionDay, businessToday } from '../units';

const num = (v: unknown, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : d;
};
const round2 = (n: number) => Math.round(n * 100) / 100;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validDate = (value: unknown): value is string => typeof value === 'string' && DATE_RE.test(value)
  && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const today = () => businessToday();
const fail = (res: Response, error: string, code: string, status = 400) =>
  res.status(status).json({ error, code });

export const money = Router();

// External money in/out, distinct from sales, expenses and internal transfers.
money.post('/entries', async (req: Request, res: Response) => {
  const { accountId, direction, amount, date, note, requestId } = req.body ?? {};
  if (typeof accountId !== 'string' || !['in', 'out'].includes(direction) ||
      typeof amount !== 'number' || !Number.isFinite(amount) || round2(amount) <= 0 ||
      typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 100 ||
      typeof date !== 'string' || !DATE_RE.test(date) || !Number.isFinite(Date.parse(date)) || new Date(date).toISOString().slice(0, 10) !== date ||
      (note !== undefined && (typeof note !== 'string' || note.length > 500))) {
    return fail(res, 'Invalid money entry', 'INVALID_ENTRY');
  }
  try {
    const result = await db.$transaction(async t => {
      await lockAccount(t, accountId);
      const account = await t.moneyAccount.findUnique({ where: { id: accountId } });
      if (!account?.active) throw Object.assign(new Error('Account is unavailable'), { status: 400 });
      const sourceType = direction === 'in' ? 'deposit' : 'withdrawal';
      const existing = await t.moneyMovement.findUnique({ where: { sourceType_sourceId: { sourceType, sourceId: requestId } } });
      if (existing) {
        if (existing.moneyAccountId !== accountId || existing.amount !== round2(amount) || existing.date !== date || (existing.note ?? '') !== (note?.trim() ?? '')) {
          throw Object.assign(new Error('Entry reference already used'), { status: 409 });
        }
        return existing;
      }
      if (direction === 'out' && round2(await accountBalance(t, accountId)) < round2(amount)) {
        throw Object.assign(new Error('Not enough money in this account'), { status: 400, code: 'INSUFFICIENT_FUNDS' });
      }
      return t.moneyMovement.create({ data: {
        transactionNo: await nextMoneyTransactionNo(t),
        moneyAccountId: accountId, method: account.type, direction, amount: round2(amount), date,
        sourceType, sourceId: requestId, note: note?.trim() || null,
      } });
    });
    res.status(201).json(result);
  } catch (e) {
    const err = e as { status?: number; message?: string; code?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Could not save entry', code: err.code });
  }
});

// Only standalone deposits and withdrawals can be edited here. Sales,
// purchases, expenses, transfers and journal rows must be changed at source.
money.put('/entries/:id', async (req: Request, res: Response) => {
  const amount = req.body?.amount;
  const note = req.body?.note;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || round2(amount) <= 0 ||
      (note !== undefined && (typeof note !== 'string' || note.length > 500))) {
    return fail(res, 'Enter a valid amount and note', 'INVALID_ENTRY');
  }
  try {
    const updated = await db.$transaction(async t => {
      const current = await t.moneyMovement.findUnique({ where: { id: req.params.id } });
      if (!current?.active) throw Object.assign(new Error('Transaction not found'), { status: 404 });
      if (!['deposit', 'withdrawal'].includes(current.sourceType)) {
        throw Object.assign(new Error('Edit this transaction in its source module.'), { status: 409, code: 'SOURCE_TRANSACTION' });
      }
      if (!current.moneyAccountId) throw Object.assign(new Error('This transaction has no linked account and cannot be edited here.'), { status: 409, code: 'ACCOUNT_MISSING' });
      await lockAccount(t, current.moneyAccountId);
      const nextAmount = round2(amount);
      if (current.direction === 'out' && nextAmount > current.amount &&
          round2(await accountBalance(t, current.moneyAccountId) + current.amount) < nextAmount) {
        throw Object.assign(new Error('Not enough money in this account'), { status: 400, code: 'INSUFFICIENT_FUNDS' });
      }
      const saved = await t.moneyMovement.update({
        where: { id: current.id },
        data: { amount: nextAmount, note: typeof note === 'string' ? note.trim() || null : null },
      });
      return { ...saved, previousAmount: current.amount };
    });
    res.json(updated);
  } catch (e) {
    const err = e as { status?: number; message?: string; code?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Could not edit transaction', code: err.code });
  }
});

const accountBody = (b: Record<string, unknown>) => ({
  name: String(b.name ?? '').trim(),
  type: String(b.type ?? ''),
  openingBalance: round2(num(b.openingBalance, 0)),
  openingDate: typeof b.openingDate === 'string' ? b.openingDate : '',
  bankName: String(b.bankName ?? '').trim() || null,
  accountNumber: String(b.accountNumber ?? '').trim() || null,
  branch: String(b.branch ?? '').trim() || null,
  mobileNumber: String(b.mobileNumber ?? '').trim() || null,
  note: String(b.note ?? '').trim() || null,
});

// GET /api/money/types — account types + labels for the Add Account form
money.get('/types', (_req: Request, res: Response) => {
  res.json(ACCOUNT_TYPES.map(t => ({ type: t, ...ACCOUNT_TYPE_LABEL[t] })));
});

// GET /api/money/accounts — every account with its derived balance
money.get('/accounts', async (req: Request, res: Response) => {
  const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
  if (asOf && !validDate(asOf)) return fail(res, 'Invalid account balance date', 'INVALID_DATE');
  const list = await accountBalances(db, undefined, asOf);
  res.json({
    accounts: list,
    totalMoney: round2(list.filter(a => a.active).reduce((s, a) => s + a.balance, 0)),
  });
});

// GET /api/money/balances — legacy per-TYPE payload (sum of that type's accounts)
money.get('/balances', async (_req: Request, res: Response) => {
  res.json(await moneyBalances());
});

// GET /api/money/accounts/:id — one account + its ledger
money.get('/accounts/:id', async (req: Request, res: Response) => {
  const [list, rows] = await Promise.all([
    accountBalances(),
    db.moneyMovement.findMany({
      where: { moneyAccountId: req.params.id, active: true },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: { transfer: { select: { transferNo: true, fromAccountId: true, toAccountId: true } } },
    }),
  ]);
  const acc = list.find(a => a.id === req.params.id);
  if (!acc) return res.status(404).json({ error: 'Money account not found' });
  const chartAccount = await db.chartAccount.findUnique({ where: { moneyAccountId: acc.id } });
  const journalLines = chartAccount ? await db.journalLine.findMany({ where: { accountId: chartAccount.id, entry: { active: true, sourceType: 'manual' } }, include: { entry: { select: { id: true, entryNo: true, date: true, memo: true, sourceType: true, sourceRef: true } } } }) : [];
  const merged = [
    ...rows.map(m => ({ id: m.id, transactionNo: m.transactionNo, date: m.date, direction: m.direction as 'in' | 'out', amount: m.amount, sourceType: m.sourceType, sourceId: m.sourceId, note: m.note ?? undefined, transferNo: m.transfer?.transferNo, counterpartyAccountId: m.transfer ? (m.transfer.fromAccountId === acc.id ? m.transfer.toAccountId : m.transfer.fromAccountId) ?? undefined : undefined, active: m.active, createdAt: m.createdAt })),
    ...journalLines.filter(line => line.debit > 0 || line.credit > 0).map(line => ({ id: `journal-${line.id}`, transactionNo: line.entry.entryNo, date: line.entry.date, direction: line.debit > 0 ? 'in' as const : 'out' as const, amount: line.debit > 0 ? line.debit : line.credit, sourceType: 'journal', sourceId: line.entry.id, note: `${line.entry.entryNo} · ${line.entry.memo}`, transferNo: undefined, counterpartyAccountId: undefined, active: true, createdAt: line.createdAt })),
  ].sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.getTime() - a.createdAt.getTime() || b.id.localeCompare(a.id));
  // Running balance from the newest entry backwards.
  let running = acc.balance;
  const movements = merged.map(m => {
    const signed = m.direction === 'in' ? m.amount : -m.amount;
    const entry = {
      id: m.id, transactionNo: m.transactionNo, date: m.date, direction: m.direction, amount: m.amount,
      sourceType: m.sourceType, sourceId: m.sourceId, note: m.note,
      transferNo: m.transferNo,
      counterpartyAccountId: m.counterpartyAccountId,
      active: m.active, balance: running,
    };
    running = round2(running - signed);
    return entry;
  });
  res.json({ account: acc, movements });
});

// POST /api/money/accounts — create an account with its own opening balance
money.post('/accounts', async (req: Request, res: Response) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const v = accountBody(b);
    if (!v.name) return fail(res, 'Account name is required', 'ACCOUNT_NAME');
    if (!isAccountType(v.type)) return fail(res, 'Invalid account type', 'ACCOUNT_TYPE');
    if (!validDate(v.openingDate)) return fail(res, 'A valid opening balance date is required (YYYY-MM-DD)', 'ACCOUNT_OPENING_DATE');
    if (v.openingBalance < 0) return fail(res, 'Opening balance cannot be negative', 'ACCOUNT_OPENING');
    const dup = await db.moneyAccount.findFirst({ where: { name: v.name, type: v.type } });
    if (dup) return fail(res, 'An account with this name already exists', 'ACCOUNT_DUP');
    const created = await db.$transaction(async t => {
      const acc = await t.moneyAccount.create({ data: v });
      // First account of its type keeps the legacy method link so old clients
      // that still post a method keep resolving to it.
      if (!(await t.moneyAccount.count({ where: { legacyMethod: v.type } }))) {
        await t.moneyAccount.update({ where: { id: acc.id }, data: { legacyMethod: v.type } });
      }
      return acc;
    });
    res.status(201).json({ id: created.id, accounts: await accountBalances() });
  } catch (e: unknown) {
    const err = e as { message?: string; code?: string };
    res.status(err.code === 'P2002' ? 400 : 500).json({ error: err.code === 'P2002' ? 'An account with this name already exists' : (err.message ?? 'Failed to create account'), code: err.code });
  }
});

// PUT /api/money/accounts/:id — edit details / activate / archive
money.put('/accounts/:id', async (req: Request, res: Response) => {
  const cur = await db.moneyAccount.findUnique({ where: { id: req.params.id } });
  if (!cur) return res.status(404).json({ error: 'Money account not found' });
  const b = (req.body ?? {}) as Record<string, unknown>;
  const data: Record<string, unknown> = {};
  if (b.name !== undefined) {
    const n = String(b.name).trim();
    if (!n) return fail(res, 'Account name is required', 'ACCOUNT_NAME');
    data.name = n;
  }
  if (b.bankName !== undefined) data.bankName = String(b.bankName).trim() || null;
  if (b.accountNumber !== undefined) data.accountNumber = String(b.accountNumber).trim() || null;
  if (b.branch !== undefined) data.branch = String(b.branch).trim() || null;
  if (b.mobileNumber !== undefined) data.mobileNumber = String(b.mobileNumber).trim() || null;
  if (b.note !== undefined) data.note = String(b.note).trim() || null;
  if (b.active !== undefined) data.active = b.active !== false && b.active !== 'false';
  if (b.active === false) {
    // Never strand money: deactivating would drop the balance out of the Bank &
    // Cash total, so the money must be moved (or resolved) first.
    const bal = await accountBalance(db, cur.id);
    if (round2(bal) !== 0) return fail(res, 'This account still has money. Move it first.', 'ACCOUNT_NOT_EMPTY', 409);
  }
  const updated = await db.moneyAccount.update({ where: { id: cur.id }, data });
  const accounts = await accountBalances();
  const mine = accounts.find(a => a.id === updated.id);
  res.json({ id: updated.id, account: mine ?? null, accounts });
});

/**
 * DELETE /api/money/accounts/:id — permanent delete, ONLY for an account that
 * never held money.
 *
 * Financial history is checked directly (not inferred from the balance), so an
 * account that is now 0 but had 100 transactions can never be destroyed:
 *   - any MoneyMovement on the account            -> ACCOUNT_HAS_HISTORY
 *   - any transfer where it is source or target   -> ACCOUNT_HAS_HISTORY
 *   - a non-zero opening balance                  -> ACCOUNT_HAS_OPENING
 * The re-check inside the transaction plus the existing ON DELETE RESTRICT
 * foreign keys make this safe against concurrent writes as well.
 */
money.delete('/accounts/:id', async (req: Request, res: Response) => {
  const id = req.params.id;
  const cur = await db.moneyAccount.findUnique({ where: { id } });
  if (!cur) return fail(res, 'Money account not found', 'ACCOUNT_NOT_FOUND', 404);

  const blockers = async (t: TxClient) => {
    const movements = await t.moneyMovement.count({ where: { moneyAccountId: id } });
    const transfers = await t.moneyTransfer.count({ where: { OR: [{ fromAccountId: id }, { toAccountId: id }] } });
    const journalLines = await t.journalLine.count({ where: { account: { moneyAccountId: id } } });
    return { movements, transfers, journalLines };
  };
  const first = await blockers(db);
  if (first.movements > 0 || first.transfers > 0 || first.journalLines > 0) {
    return fail(res, 'This account has transaction history and cannot be deleted. Deactivate it instead.', 'ACCOUNT_HAS_HISTORY', 409);
  }
  // Opening money is real value even without a single movement: never delete it
  // silently, the user must clear it (or move it) first.
  if (round2(cur.openingBalance) !== 0) {
    return fail(res, 'This account still has an opening balance. Clear or transfer it first.', 'ACCOUNT_HAS_OPENING', 409);
  }
  try {
    await db.$transaction(async t => {
      const again = await blockers(t);
      if (again.movements > 0 || again.transfers > 0 || again.journalLines > 0) {
        throw Object.assign(new Error('This account has transaction history and cannot be deleted. Deactivate it instead.'), { status: 409, code: 'ACCOUNT_HAS_HISTORY' });
      }
      const fresh = await t.moneyAccount.findUnique({ where: { id } });
      if (!fresh) throw Object.assign(new Error('Money account not found'), { status: 404, code: 'ACCOUNT_NOT_FOUND' });
      if (round2(fresh.openingBalance) !== 0) {
        throw Object.assign(new Error('This account still has an opening balance. Clear or transfer it first.'), { status: 409, code: 'ACCOUNT_HAS_OPENING' });
      }
      // Hand the legacy method link to another active account of the same type
      // so old method-only payloads keep resolving after the delete.
      if (fresh.legacyMethod) {
        const heir = await t.moneyAccount.findFirst({
          where: { type: fresh.type, id: { not: id }, legacyMethod: null },
          orderBy: { createdAt: 'asc' },
        });
        if (heir) await t.moneyAccount.update({ where: { id: heir.id }, data: { legacyMethod: fresh.legacyMethod } });
      }
      await t.moneyAccount.delete({ where: { id } });
    });
  } catch (e: unknown) {
    const err = e as { message?: string; status?: number; code?: string };
    // FK RESTRICT fired: a concurrent write attached history after our check.
    if (err.code === 'P2003') return fail(res, 'This account has transaction history and cannot be deleted. Deactivate it instead.', 'ACCOUNT_HAS_HISTORY', 409);
    return fail(res, err.message ?? 'Failed to delete account', err.code ?? 'ACCOUNT_DELETE', err.status ?? 500);
  }
  res.json({ id, deleted: true, accounts: await accountBalances() });
});

/**
 * PUT /api/money/accounts/:id/opening — edit the account's single opening entry.
 * The journal opening line is generated from this value. Older adjustment
 * movements are retired so they do not appear as additional opening entries.
 */
money.put('/accounts/:id/opening', async (req: Request, res: Response) => {
  const cur = await db.moneyAccount.findUnique({ where: { id: req.params.id } });
  if (!cur) return res.status(404).json({ error: 'Money account not found' });
  const value = round2(num((req.body ?? {}).openingBalance, NaN));
  if (!Number.isFinite(value)) return fail(res, 'Invalid amount', 'ACCOUNT_OPENING');
  const day = (req.body ?? {}).date;
  if (!validDate(day)) return fail(res, 'A valid opening balance date is required (YYYY-MM-DD)', 'ACCOUNT_OPENING_DATE');
  await db.$transaction(async t => {
    await t.moneyAccount.update({ where: { id: cur.id }, data: { openingBalance: value, openingDate: day } });
    await t.moneyMovement.updateMany({
      where: { moneyAccountId: cur.id, sourceType: 'openingAdjust', active: true },
      data: { active: false },
    });
  });
  const accounts = await accountBalances();
  res.json({ id: cur.id, account: accounts.find(a => a.id === cur.id) ?? null, accounts });
});

const shapeTransfer = (t: {
  id: string; transferNo: string; fromAccountId: string | null; toAccountId: string | null;
  fromMethod: string; toMethod: string; amount: number; date: string; note: string | null; createdAt: Date;
}, names: Map<string, string>) => ({
  id: t.id, transferNo: t.transferNo,
  fromId: t.fromAccountId ?? t.fromMethod, toId: t.toAccountId ?? t.toMethod,
  from: names.get(t.fromAccountId ?? t.fromMethod) ?? t.fromMethod,
  to: names.get(t.toAccountId ?? t.toMethod) ?? t.toMethod,
  amount: t.amount, date: t.date, note: t.note ?? undefined, createdAt: t.createdAt,
});

// GET /api/money/transfers?limit=50 — one row per transfer (not per movement)
money.get('/transfers', async (req: Request, res: Response) => {
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? '50'), 10) || 50));
  const [list, accounts] = await Promise.all([
    db.moneyTransfer.findMany({ orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: limit }),
    db.moneyAccount.findMany({ select: { id: true, name: true } }),
  ]);
  const names = new Map(accounts.map(a => [a.id, a.name]));
  res.json(list.map(t => shapeTransfer(t, names)));
});

/**
 * POST /api/money/transfers { fromId, toId, amount, date?, note? }
 * OUT from one owned account + IN to another under ONE transfer reference, in a
 * single transaction: half a transfer can never be saved.
 */
money.post('/transfers', async (req: Request, res: Response) => {
  try {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const fromId = String(b.fromId ?? b.from ?? '');
    const toId = String(b.toId ?? b.to ?? '');
    if (!fromId || !toId) return fail(res, 'From and To account are required', 'TRANSFER_ACCOUNTS');
    if (fromId === toId) return fail(res, 'Cannot transfer to the same account', 'TRANSFER_SAME');
    const amount = round2(num(b.amount, NaN));
    if (!(amount > 0)) return fail(res, 'Amount must be greater than 0', 'TRANSFER_AMOUNT');
    let day: string;
    try {
      day = transactionDay(b.date);
    } catch (e) {
      const err = e as { message?: string; code?: string };
      return fail(res, err.message ?? 'Invalid date', err.code ?? 'DATE_IN_PAST');
    }
    const note = typeof b.note === 'string' && b.note.trim() ? b.note.trim() : null;

    const result = await db.$transaction(async t => {
      const from = await t.moneyAccount.findUnique({ where: { id: fromId } });
      const to = await t.moneyAccount.findUnique({ where: { id: toId } });
      if (!from || !to) throw Object.assign(new Error('Money account not found'), { status: 400 });
      if (!from.active || !to.active) throw Object.assign(new Error('This money account is inactive'), { status: 400 });
      // Serialize same-account work so two transfers cannot both pass the check.
      await lockAccounts(t, [from.id, to.id]);
      const available = await accountBalance(t, from.id);
      if (round2(available) < amount) {
        throw Object.assign(new Error('Not enough money in this account'), { status: 400, code: 'TRANSFER_FUNDS' });
      }
      const transferNo = await nextInvoiceNo(t, 'TRF', day);
      const transfer = await t.moneyTransfer.create({
        data: { transferNo, fromMethod: from.type, toMethod: to.type, fromAccountId: from.id, toAccountId: to.id, amount, date: day, note },
      });
      await recordMovement(t, {
        accountId: from.id, method: from.type, direction: 'out', amount, date: day,
        sourceType: 'transferOut', sourceId: transfer.id, transferId: transfer.id, note: transferNo,
      });
      await recordMovement(t, {
        accountId: to.id, method: to.type, direction: 'in', amount, date: day,
        sourceType: 'transferIn', sourceId: transfer.id, transferId: transfer.id, note: transferNo,
      });
      return transfer;
    });

    const accounts = await accountBalances();
    const names = new Map(accounts.map(a => [a.id, a.name]));
    res.status(201).json({ ...shapeTransfer(result, names), accounts, totalMoney: round2(accounts.filter(a => a.active).reduce((s, a) => s + a.balance, 0)) });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string; code?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Failed to transfer money', code: err.code });
  }
});

// GET /api/money/movements?limit=100 — recent ledger entries (all accounts)
money.get('/movements', async (req: Request, res: Response) => {
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit ?? '100'), 10) || 100));
  const list = await db.moneyMovement.findMany({
    where: { active: true, ...(req.query.accountId ? { moneyAccountId: String(req.query.accountId) } : {}) },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: limit,
    include: { moneyAccount: { select: { name: true, type: true } } },
  });
  res.json(list);
});
