import { Router } from 'express';
import { db } from '../db';
import { resolveAccount, recordMovement } from '../money';
import { transactionDay } from '../units';

export const labour = Router();
const round2 = (n: number) => Math.round(n * 100) / 100;
const cleanName = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);

labour.get('/', async (_req, res) => {
  const [workers, costs, labourPayments, advances, landedExpenses] = await Promise.all([
    db.labourer.findMany({ orderBy: { name: 'asc' } }),
    db.labourCost.findMany({ include: { labourer: { select: { id: true, name: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.labourPayment.findMany({ select: { id: true, labourerId: true, amount: true, date: true, note: true, createdAt: true } }),
    db.labourAdvance.findMany({ select: { id: true, labourerId: true, amount: true, appliedAmount: true, date: true, accountId: true, note: true, createdAt: true } }),
    db.expense.findMany({ where: { capitalized: true, deletedAt: null }, select: { id: true, amount: true } }),
  ]);
  const expenseMovements = landedExpenses.length ? await db.moneyMovement.findMany({ where: { sourceType: 'expense', sourceId: { in: landedExpenses.map(e => e.id) }, active: true }, select: { sourceId: true } }) : [];
  const paidExpenseIds = new Set(expenseMovements.map(m => m.sourceId));
  const paymentsByWorker = new Map<string, number>();
  for (const p of labourPayments) paymentsByWorker.set(p.labourerId, (paymentsByWorker.get(p.labourerId) ?? 0) + p.amount);
  const wagesByWorker = new Map<string, number>();
  for (const c of costs) wagesByWorker.set(c.labourerId, (wagesByWorker.get(c.labourerId) ?? 0) + c.amount);
  const advancePaidByWorker = new Map<string, number>();
  const advanceAppliedByWorker = new Map<string, number>();
  for (const a of advances) {
    advancePaidByWorker.set(a.labourerId, (advancePaidByWorker.get(a.labourerId) ?? 0) + a.amount);
    advanceAppliedByWorker.set(a.labourerId, (advanceAppliedByWorker.get(a.labourerId) ?? 0) + a.appliedAmount);
  }
  const labourTotal = [...wagesByWorker.values()].reduce((s, x) => s + x, 0);
  const labourPaid = [...paymentsByWorker.values()].reduce((s, x) => s + x, 0) + [...advanceAppliedByWorker.values()].reduce((s, x) => s + x, 0);
  const advanceBalanceTotal = round2(advances.reduce((s, a) => s + a.amount - a.appliedAmount, 0));
  const paidExistingLanding = landedExpenses.filter(e => paidExpenseIds.has(e.id)).reduce((s, e) => s + e.amount, 0);
  const existingLanding = landedExpenses.reduce((s, e) => s + e.amount, 0);
  const workersView = workers.map(worker => {
    const wage = round2(wagesByWorker.get(worker.id) ?? 0);
    const paid = round2((paymentsByWorker.get(worker.id) ?? 0) + (advanceAppliedByWorker.get(worker.id) ?? 0));
    const advanceBalance = round2((advancePaidByWorker.get(worker.id) ?? 0) - (advanceAppliedByWorker.get(worker.id) ?? 0));
    const workerCosts = costs.filter(c => c.labourerId === worker.id);
    const workerPayments = labourPayments.filter(p => p.labourerId === worker.id);
    const workerAdvances = advances.filter(a => a.labourerId === worker.id);
    const events: { id: string; date: string; createdAt: Date; kind: 'wage' | 'payment' | 'advance'; amount: number; advanceApplied?: number; appliedAmount?: number; note?: string; direction?: string; quantity?: number; pricePerBag?: number; accountId?: string }[] = [
      ...workerCosts.map(c => ({ id: c.id, date: c.date, createdAt: c.createdAt, kind: 'wage' as const, amount: c.amount, advanceApplied: c.advanceApplied, note: c.note ?? undefined, direction: c.direction, quantity: c.quantity, pricePerBag: c.pricePerBag })),
      ...workerPayments.map(p => ({ id: p.id, date: p.date, createdAt: p.createdAt, kind: 'payment' as const, amount: p.amount, note: p.note ?? undefined })),
      ...workerAdvances.map(a => ({ id: a.id, date: a.date, createdAt: a.createdAt, kind: 'advance' as const, amount: a.amount, appliedAmount: a.appliedAmount, accountId: a.accountId, note: a.note ?? undefined })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime());
    let dueBalance = 0, advanceRunning = 0;
    const ledger = events.map(event => {
      if (event.kind === 'wage') { dueBalance += event.amount - (event.advanceApplied ?? 0); advanceRunning -= event.advanceApplied ?? 0; }
      else if (event.kind === 'payment') dueBalance -= event.amount;
      else advanceRunning += event.amount;
      return { ...event, dueBalance: round2(dueBalance), advanceBalance: round2(advanceRunning) };
    }).reverse();
    return { id: worker.id, name: worker.name, totalWages: wage, totalPaid: paid, unpaid: round2(wage - paid), advanceBalance, ledger, advances: workerAdvances.map(a => ({ id: a.id, date: a.date, amount: a.amount, appliedAmount: a.appliedAmount, accountId: a.accountId })), costs: workerCosts.map(c => ({ id: c.id, date: c.date, pricePerBag: c.pricePerBag, quantity: c.quantity, direction: c.direction, amount: c.amount, advanceApplied: c.advanceApplied, note: c.note ?? undefined })) };
  });
  const total = round2(existingLanding + labourTotal);
  const paid = round2(paidExistingLanding + labourPaid);
  res.json({ summary: { total, paid, unpaid: round2(total - paid), advanceBalance: advanceBalanceTotal }, labourers: workersView });
});

labour.post('/costs', async (req, res) => {
  const name = cleanName(req.body?.name);
  const pricePerBag = Number(req.body?.pricePerBag ?? 6);
  const quantity = Number(req.body?.quantity);
  const direction = String(req.body?.direction ?? '');
  if (!name) return res.status(400).json({ error: 'Labour name is required.' });
  if (!Number.isFinite(pricePerBag) || pricePerBag < 0) return res.status(400).json({ error: 'Enter a valid labour price per bag.' });
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Quantity must be greater than 0.' });
  if (!['stockIn', 'stockOut'].includes(direction)) return res.status(400).json({ error: 'Choose stock in or stock out.' });
  let date: string;
  try { date = transactionDay(req.body?.date); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  const amount = round2(pricePerBag * quantity);
  const nameKey = name.toLocaleLowerCase();
  const result = await db.$transaction(async t => {
    const worker = await t.labourer.upsert({ where: { nameKey }, update: {}, create: { name, nameKey } });
    let advanceToApply = amount;
    const availableAdvances = await t.labourAdvance.findMany({ where: { labourerId: worker.id, date: { lte: date } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
    for (const advance of availableAdvances) {
      if (advanceToApply <= 0) break;
      const available = round2(advance.amount - advance.appliedAmount);
      const applied = round2(Math.min(available, advanceToApply));
      if (applied > 0) {
        await t.labourAdvance.update({ where: { id: advance.id }, data: { appliedAmount: round2(advance.appliedAmount + applied) } });
        advanceToApply = round2(advanceToApply - applied);
      }
    }
    const advanceApplied = round2(amount - advanceToApply);
    const cost = await t.labourCost.create({ data: { labourerId: worker.id, pricePerBag: round2(pricePerBag), quantity, direction, amount, advanceApplied, date } });
    return { id: cost.id, labourerId: worker.id, amount };
  });
  res.status(201).json(result);
});

labour.post('/:labourerId/payments', async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Payment amount must be greater than 0.' });
  let date: string;
  try { date = transactionDay(req.body?.date); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  try {
    const payment = await db.$transaction(async t => {
      const worker = await t.labourer.findUnique({ where: { id: req.params.labourerId }, include: { costs: true, payments: true } });
      if (!worker) throw Object.assign(new Error('Labourer not found.'), { status: 404 });
      const due = round2(worker.costs.reduce((s, c) => s + c.amount - c.advanceApplied, 0) - worker.payments.reduce((s, p) => s + p.amount, 0));
      if (amount > due + 0.01) throw Object.assign(new Error('Payment cannot exceed the unpaid labour balance.'), { status: 400 });
      const account = await resolveAccount(t, { accountId: req.body?.accountId ? String(req.body.accountId) : null, method: req.body?.method ? String(req.body.method) : null });
      const row = await t.labourPayment.create({ data: { labourerId: worker.id, amount: round2(amount), date, accountId: account.id, note: String(req.body?.note ?? '').trim() || null } });
      await recordMovement(t, { accountId: account.id, method: account.type, direction: 'out', amount: row.amount, date, sourceType: 'labourPayment', sourceId: row.id, note: `Labour payment · ${worker.name}` });
      return { id: row.id, amount: row.amount };
    });
    res.status(201).json(payment);
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status ?? 400).json({ error: err.message || 'Could not record labour payment.' });
  }
});

labour.post('/:labourerId/advances', async (req, res) => {
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Advance amount must be greater than 0.' });
  let date: string;
  try { date = transactionDay(req.body?.date); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  try {
    const advance = await db.$transaction(async t => {
      const worker = await t.labourer.findUnique({ where: { id: req.params.labourerId }, select: { id: true, name: true } });
      if (!worker) throw Object.assign(new Error('Labourer not found.'), { status: 404 });
      const account = await resolveAccount(t, { accountId: req.body?.accountId ? String(req.body.accountId) : null, method: req.body?.method ? String(req.body.method) : null });
      const row = await t.labourAdvance.create({ data: { labourerId: worker.id, amount: round2(amount), date, accountId: account.id, note: String(req.body?.note ?? '').trim() || null } });
      await recordMovement(t, { accountId: account.id, method: account.type, direction: 'out', amount: row.amount, date, sourceType: 'labourAdvance', sourceId: row.id, note: `Labour advance · ${worker.name}` });
      return { id: row.id, amount: row.amount };
    });
    res.status(201).json(advance);
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status ?? 400).json({ error: err.message || 'Could not record labour advance.' });
  }
});
