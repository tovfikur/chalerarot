import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { db } from '../db';

export const accounting = Router();
const types = ['asset', 'liability', 'equity', 'income', 'expense'] as const;
const defaults = [
  ['1010', 'Cash', 'asset'], ['1020', 'Bank', 'asset'], ['1030', 'bKash', 'asset'], ['1040', 'Nagad', 'asset'], ['1050', 'Rocket', 'asset'],
  ['1100', 'Accounts receivable', 'asset'], ['1110', 'Supplier advances', 'asset'], ['1200', 'Inventory', 'asset'],
  ['2000', 'Accounts payable', 'liability'], ['2010', 'Customer credits', 'liability'],
  ['3000', 'Owner equity', 'equity'], ['3200', 'Owner drawings / other expense', 'expense'], ['4000', 'Sales revenue', 'income'],
  ['4100', 'Sales returns', 'income'], ['5000', 'Cost of goods sold', 'expense'], ['6000', 'Operating expenses', 'expense'],
  ['6100', 'Inventory adjustments', 'expense'], ['9000', 'Other income/expenses', 'expense'],
] as const;
const moneyLedgerName = (type: string, name: string) => `${({ cash: 'Cash', bank: 'Bank', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket' } as Record<string, string>)[type] ?? 'Cash'}: ${name}`;
export const seedChart = async () => {
  for (const [code, name, type] of defaults) await db.chartAccount.upsert({ where: { code }, update: {}, create: { code, name, type, system: true } });
  const moneyAccounts = await db.moneyAccount.findMany({ select: { id: true, name: true, type: true } });
  for (const a of moneyAccounts) {
    const name = moneyLedgerName(a.type, a.name);
    const code = `${({ cash: '10', bank: '11', bkash: '12', nagad: '13', rocket: '14' } as Record<string, string>)[a.type] ?? '19'}-${a.id.slice(-8).toUpperCase()}`;
    await db.chartAccount.upsert({ where: { moneyAccountId: a.id }, update: {}, create: { code, name, type: 'asset', system: true, moneyAccountId: a.id } });
  }
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
accounting.post('/chart-of-accounts', async (req, res) => {
  const { code, name, type } = req.body ?? {};
  if (typeof code !== 'string' || !/^[A-Za-z0-9-]{2,20}$/.test(code.trim()) || typeof name !== 'string' || !name.trim() || !types.includes(type)) return respondError(res, 'Enter an account code, name, and valid account type.');
  try { res.status(201).json(await db.chartAccount.create({ data: { code: code.trim(), name: name.trim(), type, system: false } })); }
  catch { return respondError(res, 'Account code or name already exists.', 409); }
});
accounting.put('/chart-of-accounts/:id', async (req, res) => {
  const { code, name, type, active } = req.body ?? {};
  if (typeof code !== 'string' || !/^[A-Za-z0-9-]{2,20}$/.test(code.trim()) || typeof name !== 'string' || !name.trim() || !types.includes(type) || typeof active !== 'boolean') return respondError(res, 'Invalid chart account.');
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
  if (!lines || !validDate(date) || !memo) return respondError(res, 'A date, memo, and balanced debit/credit lines are required.');
  const accounts = await db.chartAccount.findMany({ where: { id: { in: lines.map(l => l.accountId) }, active: true } });
  if (new Set(accounts.map(a => a.id)).size !== new Set(lines.map(l => l.accountId)).size) return respondError(res, 'Select active chart accounts for every journal line.');
  const entry = await db.journalEntry.create({ data: { entryNo: entryNo(date), date, memo, sourceType: 'manual', lines: { create: lines } }, include: { lines: { include: { account: true } } } });
  res.status(201).json(entry);
});
accounting.put('/journal-entries/:id', async (req, res) => {
  const current = await db.journalEntry.findUnique({ where: { id: req.params.id } });
  if (!current || !current.active) return respondError(res, 'Journal entry not found.', 404);
  const body = req.body ?? {}, lines = cleanLines(body.lines), date = body.date, memo = String(body.memo ?? '').trim();
  if (!lines || !validDate(date) || !memo) return respondError(res, 'A date, memo, and balanced debit/credit lines are required.');
  if (current.sourceType !== 'manual') return respondError(res, 'Only manual journal entries can be edited.', 409);
  const accounts = await db.chartAccount.findMany({ where: { id: { in: lines.map(l => l.accountId) }, active: true } });
  if (new Set(accounts.map(a => a.id)).size !== new Set(lines.map(l => l.accountId)).size) return respondError(res, 'Select active chart accounts for every journal line.');
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
  await db.journalEntry.update({ where: { id: current.id }, data: { active: false } }); res.json({ id: current.id, active: false });
});
