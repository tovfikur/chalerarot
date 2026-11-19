import { Router } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db';
import { resolveAccount, recordMovement } from '../money';
import { transactionDay } from '../units';
import { allocateLabourPayments, expenseLandingType, landedPaymentType, landingShares, linkedLandedExpenseId, LandingCostType } from '../landingCosts';
import { seedChart } from './accounting';

export const labour = Router();
const round2 = (n: number) => Math.round(n * 100) / 100;
const cleanName = (v: unknown) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);

labour.get('/', async (_req, res) => {
  await seedChart();
  const [workers, costs, labourPayments, advances, landedExpenses] = await Promise.all([
    db.labourer.findMany({ orderBy: { name: 'asc' } }),
    db.labourCost.findMany({ include: { labourer: { select: { id: true, name: true } } }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
    db.labourPayment.findMany({ select: { id: true, labourerId: true, amount: true, date: true, note: true, direction: true, createdAt: true } }),
    db.labourAdvance.findMany({ select: { id: true, labourerId: true, amount: true, appliedAmount: true, date: true, accountId: true, note: true, memoOnly: true, createdAt: true } }),
    db.expense.findMany({ where: { capitalized: true, deletedAt: null }, select: { id: true, voucherNo: true, amount: true, date: true, note: true, customName: true, landingType: true, capitalized: true } }),
  ]);
  const expenseIds = new Set(landedExpenses.map(expense => expense.id));
  const expenseMovements = landedExpenses.length ? await db.moneyMovement.findMany({ where: { sourceType: 'expense', active: true }, select: { sourceId: true, amount: true } }) : [];
  const paidByExpense = new Map<string, number>();
  const paidByExpenseType = new Map<string, Partial<Record<LandingCostType, number>>>();
  for (const movement of expenseMovements) {
    const expenseId = linkedLandedExpenseId(movement.sourceId, expenseIds);
    if (!expenseId) continue;
    const type = landedPaymentType(movement.sourceId, expenseId);
    if (type) {
      const shares = paidByExpenseType.get(expenseId) ?? {};
      shares[type] = round2((shares[type] ?? 0) + movement.amount);
      paidByExpenseType.set(expenseId, shares);
    } else paidByExpense.set(expenseId, round2((paidByExpense.get(expenseId) ?? 0) + movement.amount));
  }
  const linkedInvoiceNumbers = [...new Set(landedExpenses.map(e => e.note?.match(/#([^\s]+)/)?.[1]).filter((value): value is string => Boolean(value)))];
  const linkedPurchases = linkedInvoiceNumbers.length ? await db.purchase.findMany({ where: { invoiceNo: { in: linkedInvoiceNumbers } }, select: { invoiceNo: true, vendor: { select: { name: true } } } }) : [];
  const vendorByInvoice = new Map(linkedPurchases.map(purchase => [purchase.invoiceNo, purchase.vendor.name]));
  const labourAllocation = allocateLabourPayments(costs, labourPayments);
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
  const advanceBalanceTotal = round2(advances.reduce((s, a) => s + a.amount - a.appliedAmount, 0));
  const paidExistingLanding = landedExpenses.reduce((sum, expense) => {
    const shares = landingShares(paidByExpense.get(expense.id) ?? 0, expenseLandingType(expense));
    const typedShares = paidByExpenseType.get(expense.id) ?? {};
    return sum + Math.min(expense.amount, (Object.values(shares).reduce((total, value) => total + (value ?? 0), 0) + Object.values(typedShares).reduce((total, value) => total + (value ?? 0), 0)));
  }, 0);
  const existingLanding = landedExpenses.reduce((s, e) => s + e.amount, 0);
  const workersView = workers.map(worker => {
    const wage = round2(wagesByWorker.get(worker.id) ?? 0);
    const paid = round2((paymentsByWorker.get(worker.id) ?? 0) + (advanceAppliedByWorker.get(worker.id) ?? 0));
    const advanceBalance = round2((advancePaidByWorker.get(worker.id) ?? 0) - (advanceAppliedByWorker.get(worker.id) ?? 0));
    const workerCosts = costs.filter(c => c.labourerId === worker.id);
    const workerPayments = labourPayments.filter(p => p.labourerId === worker.id);
    const workerAdvances = advances.filter(a => a.labourerId === worker.id);
    const stockOutWages = round2(workerCosts.filter(c => c.direction === 'stockOut').reduce((sum, c) => sum + c.amount, 0));
    const stockOutPaid = round2(workerCosts.filter(c => c.direction === 'stockOut').reduce((sum, c) => sum + (labourAllocation.paidByCost.get(c.id) ?? 0), 0));
    const stockOutAdvanceBalance = round2(workerAdvances.filter(a => a.memoOnly).reduce((sum, a) => sum + a.amount - a.appliedAmount, 0));
    const stockOutAdvanceApplied = round2(workerCosts.filter(c => c.direction === 'stockOut').reduce((sum, c) => sum + c.advanceApplied, 0));
    const stockOutEvents: { id: string; date: string; createdAt: Date; kind: 'wage' | 'payment' | 'advance'; amount: number; advanceApplied?: number; note?: string; quantity?: number; pricePerBag?: number }[] = [
      ...workerCosts.filter(c => c.direction === 'stockOut').map(c => ({ id: c.id, date: c.date, createdAt: c.createdAt, kind: 'wage' as const, amount: c.amount, advanceApplied: c.advanceApplied, note: c.note ?? undefined, quantity: c.quantity, pricePerBag: c.pricePerBag })),
      ...workerPayments.flatMap(p => {
        const amount = labourAllocation.paidByPayment.get(p.id)?.stockOutLabour ?? 0;
        return amount > 0 ? [{ id: p.id, date: p.date, createdAt: p.createdAt, kind: 'payment' as const, amount, note: p.note ?? undefined }] : [];
      }),
      ...workerAdvances.filter(a => a.memoOnly).map(a => ({ id: a.id, date: a.date, createdAt: a.createdAt, kind: 'advance' as const, amount: a.amount, note: a.note ?? undefined })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime());
    let stockOutDueBalance = 0, stockOutAdvanceRunning = 0;
    const stockOutLedger = stockOutEvents.map(event => {
      if (event.kind === 'advance') stockOutAdvanceRunning += event.amount;
      else if (event.kind === 'wage') {
        stockOutDueBalance += event.amount - (event.advanceApplied ?? 0);
        stockOutAdvanceRunning -= event.advanceApplied ?? 0;
      } else stockOutDueBalance -= event.amount;
      return { ...event, dueBalance: round2(stockOutDueBalance), advanceBalance: round2(stockOutAdvanceRunning) };
    }).reverse();
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
    return { id: worker.id, name: worker.name, totalWages: wage, totalPaid: paid, unpaid: round2(wage - paid), advanceBalance, stockOutWages, stockOutPaid, stockOutAdvanceApplied, stockOutAdvanceBalance, stockOutUnpaid: round2(stockOutWages - stockOutAdvanceApplied - stockOutPaid), stockOutLedger, ledger, advances: workerAdvances.map(a => ({ id: a.id, date: a.date, amount: a.amount, appliedAmount: a.appliedAmount, accountId: a.accountId })), costs: workerCosts.map(c => ({ id: c.id, date: c.date, pricePerBag: c.pricePerBag, quantity: c.quantity, direction: c.direction, amount: c.amount, advanceApplied: c.advanceApplied, note: c.note ?? undefined })) };
  });
  const total = round2(existingLanding);
  const paid = round2(paidExistingLanding);
  const landingCosts: any[] = [];
  const operationEntries: Record<LandingCostType, any[]> = { transport: [], stockInLabour: [], stockOutLabour: [] };
  for (const expense of landedExpenses) {
    const type = expenseLandingType(expense);
    const shares = landingShares(expense.amount, type);
    const genericPaidShares = landingShares(paidByExpense.get(expense.id) ?? 0, type);
    const directPaidShares = paidByExpenseType.get(expense.id) ?? {};
    const invoiceNo = expense.note?.match(/#([^\s]+)/)?.[1];
    for (const operationType of Object.keys(shares) as LandingCostType[]) {
      const amount = shares[operationType] ?? 0;
      const paidAmount = Math.min(amount, round2((genericPaidShares[operationType] ?? 0) + (directPaidShares[operationType] ?? 0)));
      const note = expense.note ?? expense.customName ?? undefined;
      landingCosts.push({ id: expense.id, voucherNo: expense.voucherNo ?? undefined, invoiceNo, date: expense.date, amount, type: operationType, note, paid: paidAmount >= amount - 0.01 });
      operationEntries[operationType].push({ id: expense.id, date: expense.date, amount, paid: paidAmount, unpaid: round2(amount - paidAmount), paymentAmount: expense.amount, source: 'purchase', invoiceNo, voucherNo: expense.voucherNo ?? undefined, vendorName: invoiceNo ? vendorByInvoice.get(invoiceNo) : undefined, note });
    }
  }
  const operations = Object.fromEntries((['transport', 'stockInLabour', 'stockOutLabour'] as const).map(type => {
    const entries = operationEntries[type].sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
    return [type, { total: round2(entries.reduce((sum, entry) => sum + entry.amount, 0)), paid: round2(entries.reduce((sum, entry) => sum + entry.paid, 0)), unpaid: round2(entries.reduce((sum, entry) => sum + entry.unpaid, 0)), entries }];
  })) as Record<LandingCostType, { total: number; paid: number; unpaid: number; entries: any[] }>;
  res.json({ summary: { total, paid, unpaid: round2(total - paid), advanceBalance: advanceBalanceTotal }, labourers: workersView, landingCosts, operations });
});

labour.post('/labourers', async (req, res) => {
  const name = cleanName(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Labourer name is required.' });
  const nameKey = name.toLocaleLowerCase();
  try {
    const worker = await db.labourer.upsert({ where: { nameKey }, update: {}, create: { name, nameKey }, select: { id: true, name: true } });
    res.status(201).json(worker);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Could not add labourer.' });
  }
});

labour.post('/landing-costs/:expenseId/payments', async (req, res) => {
  const expense = await db.expense.findUnique({ where: { id: req.params.expenseId } });
  if (!expense || expense.deletedAt || !expense.capitalized || !expenseLandingType(expense)) return res.status(404).json({ error: 'Landed cost not found.' });
  const landingType = expenseLandingType(expense);
  const requestedAmount = req.body?.amount === undefined ? undefined : Number(req.body.amount);
  if (requestedAmount !== undefined && (!Number.isFinite(requestedAmount) || requestedAmount <= 0)) return res.status(400).json({ error: 'Payment amount must be greater than 0.' });
  const description = String(req.body?.note ?? '').trim();
  if (description.length > 500) return res.status(400).json({ error: 'Description cannot exceed 500 characters.' });
  let date: string;
  try { date = transactionDay(req.body?.date); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  try {
    const result = await db.$transaction(async t => {
      await t.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${expense.id} FOR UPDATE`;
      const existing = await t.moneyMovement.findMany({
        where: { sourceType: 'expense', active: true, OR: [{ sourceId: expense.id }, { sourceId: { startsWith: `${expense.id}:` } }] },
        select: { amount: true },
      });
      const paid = round2(existing.reduce((sum, movement) => sum + movement.amount, 0));
      const remaining = round2(Math.max(0, expense.amount - paid));
      if (remaining <= 0.009) throw Object.assign(new Error('This landed cost is already fully paid.'), { status: 409 });
      const amount = requestedAmount === undefined ? remaining : round2(requestedAmount);
      if (amount > remaining + 0.01) throw Object.assign(new Error('Payment cannot exceed the remaining balance.'), { status: 400 });
      const account = await resolveAccount(t, { accountId: req.body?.accountId ? String(req.body.accountId) : null });
      await recordMovement(t, {
        accountId: account.id, method: account.type, direction: 'out', amount, date,
        sourceType: 'expense', sourceId: `${expense.id}:${randomUUID()}`,
        note: `Landed cost payment · ${expense.voucherNo ?? expense.id}${description ? ` · ${description}` : ''}`,
      });
      return { id: expense.id, amount, remaining: round2(remaining - amount) };
    });
    res.status(201).json(result);
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status ?? 400).json({ error: err.message || 'Could not record landed cost payment.' });
  }
});

labour.post('/operations/:type/payments', async (req, res) => {
  const type = req.params.type as LandingCostType;
  if (!['transport', 'stockInLabour', 'stockOutLabour'].includes(type)) return res.status(400).json({ error: 'Choose a valid expense page.' });
  const amount = Number(req.body?.amount);
  if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: 'Payment amount must be greater than 0.' });
  const description = String(req.body?.note ?? '').trim();
  if (description.length > 500) return res.status(400).json({ error: 'Description cannot exceed 500 characters.' });
  const labourerIds: string[] = Array.isArray(req.body?.labourerIds) ? [...new Set<string>(req.body.labourerIds.map((id: unknown) => String(id).trim()).filter(Boolean))] : [];
  const allocationKind = req.body?.allocationKind === 'advance' ? 'advance' : 'wage';
  if (req.body?.allocationKind !== undefined && !['wage', 'advance'].includes(String(req.body.allocationKind))) return res.status(400).json({ error: 'Choose wage payment or advance.' });
  if (type !== 'stockOutLabour' && labourerIds.length) return res.status(400).json({ error: 'Labourer splits are only supported for stock-out payments.' });
  if (allocationKind === 'advance' && (type !== 'stockOutLabour' || !labourerIds.length)) return res.status(400).json({ error: 'Select at least one stock-out labourer for an advance.' });
  let date: string;
  try { date = transactionDay(req.body?.date); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  try {
    const result = await db.$transaction(async t => {
      const [expenses, costs, payments, account] = await Promise.all([
        t.expense.findMany({ where: { capitalized: true, deletedAt: null }, select: { id: true, amount: true, date: true, createdAt: true, voucherNo: true, note: true, customName: true, landingType: true, capitalized: true } }),
        t.labourCost.findMany({ include: { labourer: { select: { id: true, name: true } } } }),
        t.labourPayment.findMany({ select: { id: true, labourerId: true, amount: true, date: true, createdAt: true, direction: true } }),
        resolveAccount(t, { accountId: req.body?.accountId ? String(req.body.accountId) : null }),
      ]);
      const expenseIds = new Set(expenses.map(expense => expense.id));
      const movementRows = expenses.length ? await t.moneyMovement.findMany({ where: { sourceType: 'expense', active: true }, select: { sourceId: true, amount: true } }) : [];
      const genericPaid = new Map<string, number>();
      const typedPaid = new Map<string, number>();
      for (const movement of movementRows) {
        const expenseId = linkedLandedExpenseId(movement.sourceId, expenseIds);
        if (!expenseId) continue;
        const type = landedPaymentType(movement.sourceId, expenseId);
        if (type) {
          const key = `${expenseId}:${type}`;
          typedPaid.set(key, round2((typedPaid.get(key) ?? 0) + movement.amount));
        } else genericPaid.set(expenseId, round2((genericPaid.get(expenseId) ?? 0) + movement.amount));
      }
      const expenseRows = expenses.flatMap(expense => {
        const shares = landingShares(expense.amount, expenseLandingType(expense));
        const genericShares = landingShares(genericPaid.get(expense.id) ?? 0, expenseLandingType(expense));
        const due = round2(Math.max(0, (shares[type] ?? 0) - (genericShares[type] ?? 0) - (typedPaid.get(`${expense.id}:${type}`) ?? 0)));
        return due > 0.009 ? [{ kind: 'expense' as const, id: expense.id, due, date: expense.date, createdAt: expense.createdAt, voucherNo: expense.voucherNo }] : [];
      });
      const wageAllocation = allocateLabourPayments(costs, payments);
      const rows = expenseRows.sort((a, b) => a.date.localeCompare(b.date) || a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
      const available = round2(rows.reduce((sum, row) => sum + row.due, 0));
      if (available <= 0.009) throw Object.assign(new Error('This page has no unpaid landed cost balance.'), { status: 409 });
      if (amount > available + 0.01) throw Object.assign(new Error('Payment cannot exceed the stock-out landed cost balance.'), { status: 400 });
      if (type === 'stockOutLabour' && labourerIds.length) {
        const dueByWorker = new Map<string, number>();
        if (allocationKind === 'wage') for (const cost of costs) {
          if (cost.direction !== 'stockOut' || !labourerIds.includes(cost.labourerId)) continue;
          const due = round2(Math.max(0, cost.amount - cost.advanceApplied - (wageAllocation.paidByCost.get(cost.id) ?? 0)));
          dueByWorker.set(cost.labourerId, round2((dueByWorker.get(cost.labourerId) ?? 0) + due));
        }
        const shareCents = Math.floor(round2(amount) * 100 / labourerIds.length);
        const remainderCents = Math.round(round2(amount) * 100) - shareCents * labourerIds.length;
        const allocations = labourerIds.map((labourerId: string, index: number) => ({ labourerId, amount: (shareCents + (index < remainderCents ? 1 : 0)) / 100 }));
        for (const allocation of allocations) {
          if (allocationKind === 'wage' && (dueByWorker.get(allocation.labourerId) ?? 0) + 0.001 < allocation.amount) {
            const worker = costs.find(cost => cost.labourerId === allocation.labourerId)?.labourer.name ?? 'Selected labourer';
            throw Object.assign(new Error(`${worker} does not have enough unpaid stock-out wages for an equal split.`), { status: 400 });
          }
        }
        let paymentRemaining = round2(amount);
        for (const row of rows) {
          if (paymentRemaining <= 0) break;
          const applied = round2(Math.min(row.due, paymentRemaining));
          await t.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${row.id} FOR UPDATE`;
          await recordMovement(t, {
            accountId: account.id, method: account.type, direction: 'out', amount: applied, date,
            sourceType: 'expense', sourceId: `${row.id}:${type}:${randomUUID()}`,
            note: `Landed cost payment · ${row.voucherNo ?? row.id}${description ? ` · ${description}` : ''}`,
          });
          paymentRemaining = round2(paymentRemaining - applied);
        }
        for (const allocation of allocations) {
          if (allocationKind === 'advance') {
            await t.labourAdvance.create({ data: { labourerId: allocation.labourerId, amount: allocation.amount, appliedAmount: 0, date, accountId: account.id, memoOnly: true, note: description || 'Advance allocated from stock-out payment' } });
          } else {
            await t.labourPayment.create({ data: { labourerId: allocation.labourerId, amount: allocation.amount, date, accountId: account.id, direction: 'stockOut', memoOnly: true, note: description || 'Allocated from stock-out payment' } });
          }
        }
        return { amount: round2(amount), remaining: round2(available - amount), allocationKind, allocations };
      }
      let remaining = round2(amount);
      for (const row of rows) {
        if (remaining <= 0) break;
        const applied = round2(Math.min(row.due, remaining));
        if (row.kind === 'expense') {
          await t.$queryRaw`SELECT "id" FROM "Expense" WHERE "id" = ${row.id} FOR UPDATE`;
          await recordMovement(t, {
            accountId: account.id, method: account.type, direction: 'out', amount: applied, date,
            sourceType: 'expense', sourceId: `${row.id}:${type}:${randomUUID()}`,
            note: `Landed cost payment · ${row.voucherNo ?? row.id}${description ? ` · ${description}` : ''}`,
          });
        }
        remaining = round2(remaining - applied);
      }
      return { amount: round2(amount), remaining: round2(available - amount) };
    });
    res.status(201).json(result);
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status ?? 400).json({ error: err.message || 'Could not record collective payment.' });
  }
});

labour.post('/costs', async (req, res) => {
  const name = cleanName(req.body?.name);
  const directAmount = req.body?.amount === undefined ? null : Number(req.body.amount);
  const pricePerBag = directAmount === null ? Number(req.body?.pricePerBag ?? 6) : directAmount;
  const quantity = directAmount === null ? Number(req.body?.quantity) : 1;
  const direction = String(req.body?.direction ?? '');
  const note = String(req.body?.note ?? '').trim();
  if (!name) return res.status(400).json({ error: 'Labour name is required.' });
  if (note.length > 500) return res.status(400).json({ error: 'Description cannot exceed 500 characters.' });
  if (!Number.isFinite(pricePerBag) || pricePerBag < 0) return res.status(400).json({ error: 'Enter a valid labour price per bag.' });
  if (directAmount !== null && pricePerBag <= 0) return res.status(400).json({ error: 'Wage amount must be greater than 0.' });
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Quantity must be greater than 0.' });
  if (!['stockIn', 'stockOut'].includes(direction)) return res.status(400).json({ error: 'Choose stock in or stock out.' });
  let date: string;
  try { date = transactionDay(req.body?.date); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  const amount = round2(pricePerBag * quantity);
  const nameKey = name.toLocaleLowerCase();
  const result = await db.$transaction(async t => {
    const worker = await t.labourer.upsert({ where: { nameKey }, update: {}, create: { name, nameKey } });
    const cost = await t.labourCost.create({ data: { labourerId: worker.id, pricePerBag: round2(pricePerBag), quantity, direction, amount, advanceApplied: 0, date, note: note || null } });
    return { id: cost.id, labourerId: worker.id, amount };
  });
  res.status(201).json(result);
});

labour.post('/stock-out-wages', async (req, res) => {
  const quantity = Number(req.body?.quantity);
  const pricePerBag = Number(req.body?.pricePerBag);
  const labourerIds: string[] = Array.isArray(req.body?.labourerIds) ? [...new Set<string>(req.body.labourerIds.map((id: unknown) => String(id).trim()).filter(Boolean))] : [];
  const note = String(req.body?.note ?? '').trim();
  if (!Number.isFinite(quantity) || quantity <= 0) return res.status(400).json({ error: 'Bag quantity must be greater than 0.' });
  if (!Number.isFinite(pricePerBag) || pricePerBag <= 0) return res.status(400).json({ error: 'Wage per bag must be greater than 0.' });
  if (!labourerIds.length) return res.status(400).json({ error: 'Select at least one labourer.' });
  if (note.length > 500) return res.status(400).json({ error: 'Description cannot exceed 500 characters.' });
  let date: string;
  try { date = transactionDay(req.body?.date); } catch (e) { return res.status(400).json({ error: (e as Error).message }); }
  try {
    const result = await db.$transaction(async t => {
      const workers = await t.labourer.findMany({ where: { id: { in: labourerIds } }, select: { id: true, name: true } });
      if (workers.length !== labourerIds.length) throw Object.assign(new Error('One or more selected labourers were not found.'), { status: 404 });
      const totalAmount = round2(quantity * pricePerBag);
      const amountCents = Math.round(totalAmount * 100);
      const baseCents = Math.floor(amountCents / workers.length);
      const remainderCents = amountCents - baseCents * workers.length;
      const shareQuantity = quantity / workers.length;
      const entries = [];
      for (const [index, worker] of workers.entries()) {
        const workerAmount = (baseCents + (index < remainderCents ? 1 : 0)) / 100;
        let advanceToApply = workerAmount;
        const availableAdvances = await t.labourAdvance.findMany({ where: { labourerId: worker.id, memoOnly: true, date: { lte: date } }, orderBy: [{ date: 'asc' }, { createdAt: 'asc' }] });
        for (const advance of availableAdvances) {
          if (advanceToApply <= 0) break;
          const unapplied = round2(advance.amount - advance.appliedAmount);
          const applied = round2(Math.min(unapplied, advanceToApply));
          if (applied > 0) {
            await t.labourAdvance.update({ where: { id: advance.id }, data: { appliedAmount: round2(advance.appliedAmount + applied) } });
            advanceToApply = round2(advanceToApply - applied);
          }
        }
        const advanceApplied = round2(workerAmount - advanceToApply);
        const cost = await t.labourCost.create({ data: {
          labourerId: worker.id, pricePerBag: round2(pricePerBag), quantity: shareQuantity, direction: 'stockOut',
          amount: workerAmount, advanceApplied, date, note: note || null,
        } });
        entries.push({ id: cost.id, labourerId: worker.id, labourerName: worker.name, bags: shareQuantity, amount: workerAmount, advanceApplied });
      }
      return { totalBags: quantity, totalAmount, entries };
    });
    res.status(201).json(result);
  } catch (e) {
    const err = e as Error & { status?: number };
    res.status(err.status ?? 400).json({ error: err.message || 'Could not add stock-out wages.' });
  }
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
      const stockOutCosts = worker.costs.filter(cost => cost.direction === 'stockOut');
      const stockOutPaymentTotal = worker.payments.filter(row => row.direction === 'stockOut').reduce((sum, row) => sum + row.amount, 0);
      const due = round2(stockOutCosts.reduce((sum, cost) => sum + cost.amount - cost.advanceApplied, 0) - stockOutPaymentTotal);
      if (amount > due + 0.01) throw Object.assign(new Error('Payment cannot exceed the unpaid labour balance.'), { status: 400 });
      const account = await resolveAccount(t, { accountId: req.body?.accountId ? String(req.body.accountId) : null, method: req.body?.method ? String(req.body.method) : null });
      const row = await t.labourPayment.create({ data: { labourerId: worker.id, amount: round2(amount), date, accountId: account.id, direction: 'stockOut', memoOnly: true, note: String(req.body?.note ?? '').trim() || null } });
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
