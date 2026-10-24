import { Router, Request, Response } from 'express';
import { db } from '../db';
import { transactionDay } from '../units';
import { recordMovement, resolveAccount, setMovementActive, updateMovement } from '../money';

export const EXPENSE_CATS = [
  'salary', 'rent', 'electricity', 'water', 'gas', 'internet',
  'lunch', 'tea', 'labour', 'loading', 'transport', 'vehicle',
  'fuel', 'bags', 'shopRepair', 'vehicleRepair', 'cleaning',
  'office', 'bankCharge', 'other',
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: unknown, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : d;
};

const shape = (
  e: { id: string; voucherNo: string | null; category: string; customName: string | null; amount: number; date: string; note: string | null },
  mv?: { method: string; moneyAccountId: string | null },
) => ({
  id: e.id, voucherNo: e.voucherNo ?? undefined, category: e.category, customName: e.customName ?? undefined,
  amount: e.amount, date: e.date, note: e.note ?? undefined,
  method: mv?.method, accountId: mv?.moneyAccountId ?? undefined,
});

type CleanExpense = { category: string; customName: string | null; amount: number; date: string; note: string | null };
type Valid = { error?: string; code?: string; clean?: CleanExpense };

function validate(body: Record<string, unknown>, opts?: { allowPastDate?: boolean }): Valid {
  const category = String(body.category ?? '');
  if (!EXPENSE_CATS.includes(category)) return { error: 'Expense type is required' };
  const amount = num(body.amount);
  if (!(amount > 0)) return { error: 'Amount must be greater than 0' };
  const customName = String(body.customName ?? '').trim();
  if (category === 'other' && !customName) return { error: 'Expense name is required' };
  let date: string;
  if (opts?.allowPastDate && typeof body.date === 'string' && DATE_RE.test(body.date)) {
    // Edit that leaves the historical date untouched: the stored record keeps
    // its exact date. Only a newly chosen date faces the no-past rule.
    date = body.date;
  } else {
    try {
      date = transactionDay(body.date);
    } catch (e) {
      const err = e as { message?: string; code?: string };
      return { error: err.message ?? 'Invalid date', code: err.code ?? 'DATE_IN_PAST' };
    }
  }
  const note = String(body.note ?? '').trim();
  // An expense always spends real money, so an account is mandatory. Older
  // clients may still send a payment method; it is resolved to that account.
  if (!body.accountId && !body.method) return { error: 'Payment account is required' };
  return { clean: { category, customName: category === 'other' ? customName : null, amount, date, note: note || null } };
}

export const expenses = Router();

// GET /api/expenses (active only, newest first)
expenses.get('/', async (_req: Request, res: Response) => {
  const list = await db.expense.findMany({ where: { deletedAt: null }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] });
  const mv = await db.moneyMovement.findMany({ where: { sourceType: 'expense', sourceId: { in: list.map(e => e.id) } }, select: { sourceId: true, method: true, moneyAccountId: true } });
  const byId = new Map(mv.map(m => [m.sourceId, { method: m.method, moneyAccountId: m.moneyAccountId }]));
  res.json(list.map(e => shape(e, byId.get(e.id))));
});

// GET /api/expenses/:id
expenses.get('/:id', async (req: Request, res: Response) => {
  const e = await db.expense.findUnique({ where: { id: req.params.id } });
  if (!e || e.deletedAt) return res.status(404).json({ error: 'Expense not found' });
  const mv = await db.moneyMovement.findUnique({ where: { sourceType_sourceId: { sourceType: 'expense', sourceId: e.id } }, select: { method: true, moneyAccountId: true } });
  res.json(shape(e, mv ?? undefined));
});

// POST /api/expenses
expenses.post('/', async (req: Request, res: Response) => {
  const v = validate(req.body ?? {});
  const clean = v.clean;
  if (!clean) return res.status(400).json({ error: v.error, code: v.code ?? 'EXPENSE_INVALID' });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const e = await db.$transaction(async t => {
    const acc = await resolveAccount(t, { accountId: body.accountId ? String(body.accountId) : null, method: body.method ? String(body.method) : null });
    const created = await t.expense.create({ data: clean });
    const saved = await t.expense.update({
      where: { id: created.id },
      data: { voucherNo: `EXP-${created.id.slice(-8).toUpperCase()}` },
    });
    await recordMovement(t, {
      accountId: acc.id, method: acc.type, direction: 'out', amount: clean.amount, date: clean.date,
      sourceType: 'expense', sourceId: created.id, note: clean.note,
    });
    return saved;
  });
  res.status(201).json({ id: e.id });
});

// PUT /api/expenses/:id
expenses.put('/:id', async (req: Request, res: Response) => {
  const cur = await db.expense.findUnique({ where: { id: req.params.id } });
  if (!cur || cur.deletedAt) return res.status(404).json({ error: 'Expense not found' });
  const curMv = await db.moneyMovement.findUnique({ where: { sourceType_sourceId: { sourceType: 'expense', sourceId: cur.id } }, select: { method: true, moneyAccountId: true } });
  const merged: Record<string, unknown> = {
    category: req.body.category ?? cur.category,
    customName: req.body.customName ?? cur.customName ?? '',
    amount: req.body.amount ?? cur.amount,
    date: req.body.date ?? cur.date,
    note: req.body.note ?? cur.note ?? '',
    // Keep the original account when the caller does not resend it.
    accountId: req.body.accountId ?? curMv?.moneyAccountId ?? '',
    method: req.body.method ?? curMv?.method ?? '',
  };
  const v = validate(merged, {
    // An edit that does not touch the date keeps the historical record
    // exactly as-is; only a newly chosen date must be today-or-future.
    allowPastDate: req.body.date === undefined || req.body.date === cur.date,
  });
  const clean = v.clean;
  if (!clean) return res.status(400).json({ error: v.error, code: v.code ?? 'EXPENSE_INVALID' });
  await db.$transaction(async t => {
    const acc = await resolveAccount(t, { accountId: merged.accountId ? String(merged.accountId) : null, method: merged.method ? String(merged.method) : null });
    await t.expense.update({ where: { id: cur.id }, data: clean });
    await updateMovement(t, 'expense', cur.id, { accountId: acc.id, method: acc.type, direction: 'out', amount: clean.amount, date: clean.date });
  });
  res.json({ id: cur.id });
});

// DELETE /api/expenses/:id → soft delete (Trash). Expenses have no child
// records, so trash is always allowed; purge rules live in trash routes.
expenses.delete('/:id', async (req: Request, res: Response) => {
  const cur = await db.expense.findUnique({ where: { id: req.params.id } });
  if (!cur || cur.deletedAt) return res.status(404).json({ error: 'Expense not found' });
  await db.$transaction(async t => {
    await t.expense.update({ where: { id: cur.id }, data: { deletedAt: new Date() } });
    // Trashed expenses stop counting against the method balance.
    await setMovementActive(t, 'expense', cur.id, false);
  });
  res.json({ id: cur.id });
});
