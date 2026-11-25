import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { db } from '../db';
import { accountBalance, accountBalances, lockAccount, nextMoneyTransactionNo } from '../money';

export const accounting = Router();
const types = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
const isReservedLegacyMoneyCode = (code: string) => /^109[0-4]$/.test(code);
const defaults = [
  ['1100', 'Accounts receivable', 'asset'], ['1110', 'Supplier advances', 'asset'], ['1120', 'Labour Advances', 'asset'], ['1121', 'Landing Cost Advances', 'asset'], ['1200', 'Inventory', 'asset'],
  ['2000', 'Accounts payable', 'liability'], ['2010', 'Customer credits', 'liability'], ['2020', 'Landing Cost Payable', 'liability'],
  ['2021', 'Transport Cost Payable', 'liability'], ['2022', 'Stock In Labour Payable', 'liability'], ['2023', 'Stock Out Labour Payable', 'liability'],
  ['3000', 'Owner equity', 'equity'], ['3200', 'Owner drawings', 'equity'], ['3300', 'House Expenses', 'equity'], ['4000', 'Sales revenue', 'income'],
  ['4100', 'Sales returns', 'income'], ['5000', 'Cost of goods sold', 'expense'], ['6000', 'Operating expenses', 'expense'],
  ['6100', 'Inventory adjustments', 'expense'], ['9000', 'Other income/expenses', 'expense'],
] as const;
const moneyLedgerName = (type: string, name: string) => `${({ cash: 'Cash', bank: 'Bank', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket' } as Record<string, string>)[type] ?? 'Cash'}: ${name}`;
const fourDigitCode = (code: string) => /^\d{4}$/.test(code);
const codeRangeByType: Record<string, [number, number]> = {
  asset: [1300, 1999], liability: [2100, 2999], equity: [3100, 3999], income: [4200, 4999], expense: [6200, 6999],
};
const findFreeCode = (used: Set<string>, type: string, start?: number, end?: number): string => {
  const [rangeStart, rangeEnd] = codeRangeByType[type] ?? [7000, 7999];
  const first = start ?? rangeStart, last = end ?? rangeEnd;
  for (let candidate = first; candidate <= last; candidate++) {
    const code = String(candidate);
    if (!used.has(code)) return code;
  }
  if (start === undefined) return findFreeCode(used, type, 1000, 9999);
  throw new Error(`No free four-digit account code is available for ${type}.`);
};
let chartSeedPromise: Promise<void> | undefined;
const seedChartOnce = async () => {
  for (const [code, name, type] of defaults) await db.chartAccount.upsert({ where: { code }, update: code === '3200' ? { name, type } : {}, create: { code, name, type, system: true } });
  const moneyAccounts = await db.moneyAccount.findMany({ select: { id: true, name: true, type: true, active: true }, orderBy: { id: 'asc' } });
  const initialChart = await db.chartAccount.findMany();
  const used = new Set(initialChart.filter(account => fourDigitCode(account.code)).map(account => account.code));
  const byMoneyAccount = new Map(initialChart.filter(account => account.moneyAccountId).map(account => [account.moneyAccountId!, account]));
  for (const a of moneyAccounts) {
    const name = moneyLedgerName(a.type, a.name);
    const existing = byMoneyAccount.get(a.id);
    if (existing && fourDigitCode(existing.code)) continue;
    const code = findFreeCode(used, 'asset');
    used.add(code);
    if (existing) await db.chartAccount.update({ where: { id: existing.id }, data: { code } });
    else await db.chartAccount.create({ data: { code, name, type: 'asset', system: true, moneyAccountId: a.id } });
  }
  // Retire the old generic cash/bank control accounts. Move their journal
  // lines and unassigned money movements onto the linked money account with
  // the strongest existing balance, preserving the original ledger history.
  const accountTypeSpecs: { type: string; oldCode: string; fallbackCode?: number; fallbackName?: string }[] = [
    { type: 'cash', oldCode: '1010', fallbackCode: 1090, fallbackName: 'Legacy unassigned cash' },
    { type: 'bank', oldCode: '1020', fallbackCode: 1091, fallbackName: 'Legacy unassigned bank' },
    { type: 'bkash', oldCode: '1030' },
    { type: 'nagad', oldCode: '1040' },
    { type: 'rocket', oldCode: '1050' },
  ];
  const moneyBalances = await accountBalances(db);
  const currentChart = await db.chartAccount.findMany();
  for (const spec of accountTypeSpecs) {
    const reservedCode = spec.fallbackCode ? String(spec.fallbackCode) : undefined;
    const codeOwner = reservedCode ? currentChart.find(account => account.code === reservedCode) : undefined;
    if (codeOwner && codeOwner.name !== spec.fallbackName) {
      const replacement = findFreeCode(used, codeOwner.type);
      used.add(replacement);
      await db.chartAccount.update({ where: { id: codeOwner.id }, data: { code: replacement } });
    }
    const oldAccount = currentChart.find(account => account.code === spec.oldCode);
    const linkedAccounts = moneyAccounts.filter(account => account.type === spec.type).sort((a, b) => {
      const balanceA = moneyBalances.find(balance => balance.id === a.id)?.balance ?? 0;
      const balanceB = moneyBalances.find(balance => balance.id === b.id)?.balance ?? 0;
      return Number(Math.abs(balanceB) >= 0.01) - Number(Math.abs(balanceA) >= 0.01) || Math.abs(balanceB) - Math.abs(balanceA) || Number(b.active) - Number(a.active) || a.id.localeCompare(b.id);
    });
    const targetMoneyAccount = linkedAccounts[0];
    const targetChartAccount = targetMoneyAccount ? await db.chartAccount.findUnique({ where: { moneyAccountId: targetMoneyAccount.id } }) : null;
    const unassignedMovements = await db.moneyMovement.count({ where: { moneyAccountId: null, method: spec.type } });
    if (targetMoneyAccount && targetChartAccount) {
      if (oldAccount && oldAccount.id !== targetChartAccount.id) {
        await db.journalLine.updateMany({ where: { accountId: oldAccount.id }, data: { accountId: targetChartAccount.id } });
        await db.chartAccount.delete({ where: { id: oldAccount.id } });
      }
      await db.moneyMovement.updateMany({ where: { moneyAccountId: null, method: spec.type }, data: { moneyAccountId: targetMoneyAccount.id } });
    } else if (oldAccount && spec.type !== 'cash' && spec.type !== 'bank') {
      const historyCount = await db.journalLine.count({ where: { accountId: oldAccount.id } });
      if (historyCount) {
        const cashBankTarget = currentChart.find(account => account.code === '1091' || account.code === '1090')
          ?? currentChart.find(account => account.moneyAccountId && moneyAccounts.some(money => money.id === account.moneyAccountId && (money.type === 'bank' || money.type === 'cash')));
        let target = cashBankTarget;
        if (!target) target = await db.chartAccount.create({ data: { code: '1091', name: 'Legacy unassigned bank', type: 'asset', system: true } });
        await db.journalLine.updateMany({ where: { accountId: oldAccount.id }, data: { accountId: target.id } });
      }
      await db.chartAccount.delete({ where: { id: oldAccount.id } });
    } else if (oldAccount || (unassignedMovements > 0 && (spec.type === 'cash' || spec.type === 'bank'))) {
      const fallbackName = spec.fallbackName ?? 'Legacy unassigned bank';
      let fallback = await db.chartAccount.findFirst({ where: { name: fallbackName } });
      if (!fallback) {
        const fallbackCode = reservedCode ?? '1091';
        used.add(fallbackCode);
        fallback = await db.chartAccount.create({ data: { code: fallbackCode, name: fallbackName, type: 'asset', system: true } });
      }
      if (oldAccount && oldAccount.id !== fallback.id) {
        await db.journalLine.updateMany({ where: { accountId: oldAccount.id }, data: { accountId: fallback.id } });
        await db.chartAccount.delete({ where: { id: oldAccount.id } });
      }
    }
  }
  // Mobile-wallet suspense accounts are no longer part of the chart. Retain
  // their journal history by reclassifying it into an existing cash/bank
  // ledger, or the consolidated legacy bank suspense account if none exists.
  const walletFallbacks = await db.chartAccount.findMany({
    where: { OR: [
      { AND: [{ code: { in: ['1092', '1093', '1094'] } }, { system: true }] },
      { name: { in: ['Legacy unassigned bKash', 'Legacy unassigned Nagad', 'Legacy unassigned Rocket'] } },
    ] },
  });
  if (walletFallbacks.length) {
    const linesExist = await db.journalLine.count({ where: { accountId: { in: walletFallbacks.map(account => account.id) } } });
    let reclassAccount: Awaited<ReturnType<typeof db.chartAccount.findFirst>> = null;
    if (linesExist) {
      const freshChart = await db.chartAccount.findMany();
      const moneyTargets = moneyAccounts.filter(account => account.type === 'bank' || account.type === 'cash').sort((a, b) => {
        const balanceA = moneyBalances.find(balance => balance.id === a.id)?.balance ?? 0;
        const balanceB = moneyBalances.find(balance => balance.id === b.id)?.balance ?? 0;
        return Number(Math.abs(balanceB) >= 0.01) - Number(Math.abs(balanceA) >= 0.01) || Math.abs(balanceB) - Math.abs(balanceA) || Number(b.type === 'bank') - Number(a.type === 'bank') || a.id.localeCompare(b.id);
      });
      for (const target of moneyTargets) {
        reclassAccount = freshChart.find(account => account.moneyAccountId === target.id) ?? null;
        if (reclassAccount) break;
      }
      reclassAccount ??= freshChart.find(account => account.code === '1091' || account.code === '1090') ?? null;
      if (!reclassAccount) reclassAccount = await db.chartAccount.create({ data: { code: '1091', name: 'Legacy unassigned bank', type: 'asset', system: true } });
    }
    for (const account of walletFallbacks) {
      if (reclassAccount) await db.journalLine.updateMany({ where: { accountId: account.id }, data: { accountId: reclassAccount.id } });
      await db.chartAccount.delete({ where: { id: account.id } });
    }
  }
  const remainingReservedWalletCodes = await db.chartAccount.findMany({ where: { code: { in: ['1092', '1093', '1094'] } } });
  for (const account of remainingReservedWalletCodes) {
    const replacement = findFreeCode(used, account.type);
    used.add(replacement);
    await db.chartAccount.update({ where: { id: account.id }, data: { code: replacement } });
  }
  // Preserve account IDs and journal history while upgrading legacy/custom codes.
  const legacyCodes = await db.chartAccount.findMany();
  const invalidCodes = legacyCodes.filter(account => !fourDigitCode(account.code)).sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code));
  for (const account of invalidCodes) {
    const code = findFreeCode(used, account.type);
    used.add(code);
    await db.chartAccount.update({ where: { id: account.id }, data: { code } });
  }
};
export const seedChart = () => {
  if (!chartSeedPromise) chartSeedPromise = seedChartOnce().finally(() => { chartSeedPromise = undefined; });
  return chartSeedPromise;
};
const validDate = (x: unknown): x is string => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) && !Number.isNaN(Date.parse(x));
const cleanLines = (x: unknown) => {
  if (!Array.isArray(x) || x.length < 2 || x.length > 100) return null;
  const lines = x.map((v: any) => ({ accountId: String(v?.accountId ?? ''), description: String(v?.description ?? '').trim().slice(0, 250), debit: Number(v?.debit ?? 0), credit: Number(v?.credit ?? 0) }));
  if (lines.some(l => !l.accountId || !Number.isFinite(l.debit) || !Number.isFinite(l.credit) || l.debit < 0 || l.credit < 0 || (l.debit > 0) === (l.credit > 0))) return null;
  const rounded = lines.map(l => ({ ...l, debit: Math.round(l.debit * 100) / 100, credit: Math.round(l.credit * 100) / 100 }));
  const dr = rounded.reduce((n, l) => n + Math.round(l.debit * 100), 0), cr = rounded.reduce((n, l) => n + Math.round(l.credit * 100), 0);
  if (dr <= 0 || dr !== cr) return null;
  return rounded;
};
const entryNo = (date: string) => `JRN-${date.replace(/-/g, '')}-${randomUUID().slice(0, 6).toUpperCase()}`;
const respondError = (res: Response, message: string, status = 400) => res.status(status).json({ error: message });

accounting.get('/chart-of-accounts', async (_req, res) => { await seedChart(); res.json(await db.chartAccount.findMany({ orderBy: [{ code: 'asc' }, { name: 'asc' }] })); });

accounting.get('/house-expenses', async (req, res) => {
  await seedChart();
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  const movements = await db.moneyMovement.findMany({
    where: { active: true, sourceType: 'houseExpense', ...(from && to ? { date: { gte: from, lte: to } } : {}) },
    orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], take: 500,
    include: { moneyAccount: { select: { name: true, type: true } } },
  });
  const entries = await db.journalEntry.findMany({
    where: { active: true, sourceType: 'houseExpense', sourceId: { in: movements.map(row => row.sourceId) } },
    select: { sourceId: true, memo: true },
  });
  const descriptionById = new Map(entries.map(entry => [entry.sourceId ?? '', entry.memo]));
  res.json(movements.map(row => ({
    id: row.id, transactionNo: row.transactionNo, date: row.date, amount: row.amount,
    accountId: row.moneyAccountId, accountName: row.moneyAccount?.name ?? '',
    description: descriptionById.get(row.sourceId) ?? '', note: row.note ?? '',
  })));
});

accounting.post('/house-expenses', async (req, res) => {
  const { accountId, amount, date, description, note, requestId } = req.body ?? {};
  const cleanDescription = typeof description === 'string' ? description.trim() : '';
  const cleanNote = typeof note === 'string' ? note.trim() : '';
  if (typeof accountId !== 'string' || !accountId || typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 ||
      !validDate(date) || !cleanDescription || cleanDescription.length > 250 || cleanNote.length > 500 ||
      typeof requestId !== 'string' || requestId.length < 8 || requestId.length > 100) {
    return respondError(res, 'Enter a valid account, amount, date, and description.', 400);
  }
  try {
    await seedChart();
    const result = await db.$transaction(async t => {
      const existing = await t.moneyMovement.findUnique({ where: { sourceType_sourceId: { sourceType: 'houseExpense', sourceId: requestId } }, include: { moneyAccount: { select: { name: true, type: true } } } });
      if (existing) return existing;
      await lockAccount(t, accountId);
      const account = await t.moneyAccount.findUnique({ where: { id: accountId } });
      if (!account?.active || !['cash', 'bank'].includes(account.type)) throw Object.assign(new Error('Select an active cash or bank account.'), { status: 400 });
      const roundedAmount = Math.round(amount * 100) / 100;
      if (Math.round(await accountBalance(t, accountId) * 100) / 100 < roundedAmount) {
        throw Object.assign(new Error('Not enough money in this account.'), { status: 400, code: 'INSUFFICIENT_FUNDS' });
      }
      const houseAccount = await t.chartAccount.upsert({
        where: { code: '3300' }, update: {},
        create: { code: '3300', name: 'House Expenses', type: 'equity', system: true },
      });
      const moneyChart = await t.chartAccount.findUnique({ where: { moneyAccountId: accountId } });
      if (!moneyChart) throw Object.assign(new Error('The selected account is missing from the chart of accounts.'), { status: 400 });
      const entryNo = `HSE-${date.replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
      await t.journalEntry.create({ data: {
        entryNo, date, memo: cleanDescription, sourceType: 'houseExpense', sourceId: requestId,
        lines: { create: [
          { accountId: houseAccount.id, description: cleanDescription, debit: roundedAmount, credit: 0 },
          { accountId: moneyChart.id, description: account.name, debit: 0, credit: roundedAmount },
        ] },
      } });
      return t.moneyMovement.create({ data: {
        transactionNo: await nextMoneyTransactionNo(t), moneyAccountId: accountId, method: account.type,
        direction: 'out', amount: roundedAmount, date, sourceType: 'houseExpense', sourceId: requestId,
        note: cleanNote || null,
      }, include: { moneyAccount: { select: { name: true, type: true } } } });
    });
    res.status(201).json({
      id: result.id, transactionNo: result.transactionNo, date: result.date, amount: result.amount,
      accountId: result.moneyAccountId, accountName: result.moneyAccount?.name ?? '',
      description: cleanDescription, note: result.note ?? '',
    });
  } catch (e) {
    const err = e as { status?: number; message?: string; code?: string };
    res.status(err.status ?? 500).json({ error: err.message ?? 'Could not save house expense.', code: err.code });
  }
});

accounting.post('/chart-of-accounts', async (req, res) => {
  await seedChart();
  const { code, name, type } = req.body ?? {};
  if (typeof code !== 'string' || !/^\d{4}$/.test(code.trim()) || typeof name !== 'string' || !name.trim() || !types.includes(type)) return respondError(res, 'Enter a four-digit numeric account code, account name, and valid account type.');
  if (isReservedLegacyMoneyCode(code.trim())) return respondError(res, 'This code range is reserved for unassigned legacy money movements. Choose another four-digit code.');
  try { res.status(201).json(await db.chartAccount.create({ data: { code: code.trim(), name: name.trim(), type, system: false } })); }
  catch { return respondError(res, 'Account code or name already exists.', 409); }
});
accounting.put('/chart-of-accounts/:id', async (req, res) => {
  await seedChart();
  const { code, name, type, active } = req.body ?? {};
  if (typeof code !== 'string' || !/^\d{4}$/.test(code.trim()) || typeof name !== 'string' || !name.trim() || !types.includes(type) || typeof active !== 'boolean') return respondError(res, 'Chart account codes must contain exactly four digits.');
  if (isReservedLegacyMoneyCode(code.trim())) return respondError(res, 'This code range is reserved for unassigned legacy money movements. Choose another four-digit code.');
  const current = await db.chartAccount.findUnique({ where: { id: req.params.id } });
  if (!current) return respondError(res, 'Account not found.', 404);
  if (current.system && (code.trim() !== current.code || type !== current.type)) return respondError(res, 'System account codes and types are fixed so automatic postings stay connected to the correct account.', 409);
  if (current.system && !active) return respondError(res, 'System accounts cannot be archived because automatic postings depend on them.', 409);
  if (current.moneyAccountId && type !== 'asset') return respondError(res, 'Cash and bank ledger accounts must stay in the asset group.', 409);
  try { res.json(await db.chartAccount.update({ where: { id: current.id }, data: { code: code.trim(), name: name.trim(), type, active } })); }
  catch { return respondError(res, 'Account code or name already exists.', 409); }
});
accounting.delete('/chart-of-accounts/:id', async (req, res) => {
  const account = await db.chartAccount.findUnique({ where: { id: req.params.id } });
  if (!account) return respondError(res, 'Account not found.', 404);
  if (account.system) return respondError(res, 'System accounts cannot be deleted; archive them instead.', 409);
  if (await db.journalLine.count({ where: { accountId: account.id } })) return respondError(res, 'This account has journal history. Archive it instead.', 409);
  await db.chartAccount.delete({ where: { id: account.id } }); res.json({ id: account.id, deleted: true });
});

accounting.post('/journal-entries', async (req, res) => {
  const body = req.body ?? {}, lines = cleanLines(body.lines), date = body.date, memo = String(body.memo ?? '').trim();
  const status = body.status ?? 'posted';
  if (!['draft', 'posted'].includes(status)) return respondError(res, 'Choose draft or posted status.');
  if (!lines || !validDate(date) || !memo) return respondError(res, 'A date, memo, and balanced debit/credit lines are required.');
  const accounts = await db.chartAccount.findMany({ where: { id: { in: lines.map(l => l.accountId) }, active: true }, include: { moneyAccount: { select: { type: true } } } });
  if (new Set(accounts.map(a => a.id)).size !== new Set(lines.map(l => l.accountId)).size) return respondError(res, 'Select active chart accounts for every journal line.');
  if (accounts.some(account => account.moneyAccount && !['cash', 'bank'].includes(account.moneyAccount.type))) return respondError(res, 'New journal entries can use cash and bank accounts only.');
  const entry = await db.journalEntry.create({ data: { entryNo: entryNo(date), date, memo, sourceType: 'manual', status, lines: { create: lines } }, include: { lines: { include: { account: true } } } });
  res.status(201).json(entry);
});
accounting.put('/journal-entries/:id', async (req, res) => {
  const current = await db.journalEntry.findUnique({ where: { id: req.params.id } });
  if (!current || current.status !== 'draft') return respondError(res, 'Reset the journal entry to draft before editing it.', 409);
  const body = req.body ?? {}, lines = cleanLines(body.lines), date = body.date, memo = String(body.memo ?? '').trim();
  if (!lines || !validDate(date) || !memo) return respondError(res, 'A date, memo, and balanced debit/credit lines are required.');
  if (current.sourceType !== 'manual') return respondError(res, 'Only manual journal entries can be edited.', 409);
  const accounts = await db.chartAccount.findMany({ where: { id: { in: lines.map(l => l.accountId) }, active: true }, include: { moneyAccount: { select: { type: true } } } });
  if (new Set(accounts.map(a => a.id)).size !== new Set(lines.map(l => l.accountId)).size) return respondError(res, 'Select active chart accounts for every journal line.');
  if (accounts.some(account => account.moneyAccount && !['cash', 'bank'].includes(account.moneyAccount.type))) return respondError(res, 'Journal entries can use cash and bank accounts only.');
  const entry = await db.$transaction(async t => {
    await t.journalLine.deleteMany({ where: { entryId: current.id } });
    return t.journalEntry.update({ where: { id: current.id }, data: { date, memo, lines: { create: lines } }, include: { lines: { include: { account: true } } } });
  });
  res.json(entry);
});
accounting.delete('/journal-entries/:id', async (req, res) => {
  const current = await db.journalEntry.findUnique({ where: { id: req.params.id } });
  if (!current) return respondError(res, 'Journal entry not found.', 404);
  if (current.sourceType !== 'manual') return respondError(res, 'Only manual journal entries can be voided here.', 409);
  await db.journalEntry.update({ where: { id: current.id }, data: { active: false, status: 'cancelled' } }); res.json({ id: current.id, active: false, status: 'cancelled' });
});
accounting.put('/journal-entries/:id/status', async (req, res) => {
  const status = req.body?.status;
  if (!['draft', 'posted', 'cancelled'].includes(status)) return respondError(res, 'Choose draft, posted, or cancelled status.');
  const current = await db.journalEntry.findUnique({ where: { id: req.params.id } });
  if (!current) return respondError(res, 'Journal entry not found.', 404);
  if (current.sourceType !== 'manual') return respondError(res, 'Automatic journal entries cannot be changed here.', 409);
  const updated = await db.journalEntry.update({ where: { id: current.id }, data: { status, active: status !== 'cancelled' } });
  res.json({ id: updated.id, status: updated.status });
});
