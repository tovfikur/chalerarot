import { Router, Request, Response } from 'express';
import { db } from '../db';
import { todayStr } from '../units';
import { lifetimeFinance, periodFinance } from '../finance';
import { buildSettlement } from '../settlement';

const sum = (a: { amount: number }[]) => a.reduce((s, x) => s + x.amount, 0);

const LEDGER_ACCOUNTS = [
  { code: '1100', account: 'Accounts receivable' },
  { code: '1200', account: 'Inventory' }, { code: '2000', account: 'Accounts payable' },
  { code: '3000', account: 'Owner equity' }, { code: '3200', account: 'Owner drawings / other expense' },
  { code: '4000', account: 'Sales revenue' }, { code: '4100', account: 'Sales returns' },
  { code: '5000', account: 'Cost of goods sold' }, { code: '6000', account: 'Operating expenses' },
  { code: '6100', account: 'Inventory adjustments' }, { code: '9000', account: 'Other' },
];

const moneyAccountLedgerName = (account?: { name: string; type: string } | null) => {
  if (!account) return 'Cash: Unassigned';
  const labels: Record<string, string> = { cash: 'Cash', bank: 'Bank', bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket' };
  return `${labels[account.type] ?? 'Cash'}: ${account.name}`;
};

const ledgerAccountCode = (name: string) => {
  if (name.startsWith('Cash:')) return '1010';
  if (name.startsWith('Bank:')) return '1020';
  if (name.startsWith('bKash:')) return '1030';
  if (name.startsWith('Nagad:')) return '1040';
  if (name.startsWith('Rocket:')) return '1050';
  if (name === 'Accounts receivable') return '1100';
  if (name === 'Inventory') return '1200';
  if (name === 'Accounts payable') return '2000';
  if (name.startsWith('Owner equity')) return '3000';
  if (name === 'Sales revenue') return '4000';
  if (name === 'Sales returns') return '4100';
  if (name === 'Cost of goods sold') return '5000';
  if (name.startsWith('Operating expense')) return '6000';
  if (name === 'Inventory adjustments') return '6100';
  if (name.startsWith('Owner drawings')) return '3200';
  return '9000';
};

export const reports = Router();

// Operating entries are built from source documents; saved manual journals are
// layered into the same ledger below.
reports.get('/balance-sheet', async (req: Request, res: Response) => {
  const asOf = typeof req.query.asOf === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.asOf) ? req.query.asOf : todayStr();
  const [accounts, movements, stock, customers, sales, cPays, sReturns, vendors, purchases, vPays, pReturns] = await Promise.all([
    db.moneyAccount.findMany({ select: { id: true, openingBalance: true, openingDate: true, type: true } }),
    db.moneyMovement.findMany({ where: { active: true, date: { lte: asOf } }, select: { moneyAccountId: true, method: true, direction: true, amount: true } }),
    db.stockMovement.findMany({ where: { date: { lte: asOf }, bucket: 'sellable' } }),
    db.customer.findMany({ where: { deletedAt: null } }), db.sale.findMany({ where: { date: { lte: asOf } } }),
    db.customerPayment.findMany({ where: { active: true, date: { lte: asOf } } }),
    db.productReturn.findMany({ where: { kind: 'sale', date: { lte: asOf } } }),
    db.vendor.findMany({ where: { deletedAt: null } }), db.purchase.findMany({ where: { date: { lte: asOf } } }),
    db.vendorPayment.findMany({ where: { active: true, date: { lte: asOf } } }),
    db.productReturn.findMany({ where: { kind: 'purchase', date: { lte: asOf } } }),
  ]);
  const accountBalance = (type: string) => {
    const typedAccounts = accounts.filter(a => a.type === type);
    const legacyMovements = movements.filter(m => !m.moneyAccountId && m.method === type);
    if (!typedAccounts.length && !legacyMovements.length) return null;
    return typedAccounts.reduce((total, a) => total + (a.openingDate && a.openingDate > asOf ? 0 : a.openingBalance)
      + movements.filter(m => m.moneyAccountId === a.id).reduce((sum, m) => sum + (m.direction === 'in' ? m.amount : -m.amount), 0), 0)
      + legacyMovements.reduce((sum, m) => sum + (m.direction === 'in' ? m.amount : -m.amount), 0);
  };
  const savedJournalLines = await db.journalLine.findMany({ where: { entry: { active: true, date: { lte: asOf } } }, include: { account: { select: { name: true, type: true, moneyAccount: { select: { type: true } } } } } });
  const delta = (fn: (name: string, type: string, moneyType?: string) => boolean) => savedJournalLines.filter(line => fn(line.account.name, line.account.type, line.account.moneyAccount?.type)).reduce((total, line) => total + line.debit - line.credit, 0);
  const cash = (accountBalance('cash') ?? 0) + delta((_name, _type, moneyType) => moneyType === 'cash');
  const bank = (accountBalance('bank') ?? 0) + delta((_name, _type, moneyType) => moneyType === 'bank');
  const walletBalances = ['bkash', 'nagad', 'rocket'].map(type => (accountBalance(type) ?? 0) + delta((_name, _accountType, moneyType) => moneyType === type));
  const wallets = walletBalances.length ? walletBalances.reduce((total, balance) => total + balance, 0) : null;
  const receivables = customers.reduce((t, c) => t + Math.max(0, c.openingDue
    + sales.filter(x => x.customerId === c.id).reduce((s, x) => s + x.total, 0)
    - cPays.filter(x => x.customerId === c.id && !x.returnId).reduce((s, x) => s + x.amount, 0)
    - sReturns.filter(x => x.customerId === c.id).reduce((s, x) => s + x.totalAmount, 0)), 0) + delta(name => name === 'Accounts receivable');
  const payables = vendors.reduce((t, v) => t + Math.max(0, v.openingPayable
    + purchases.filter(x => x.vendorId === v.id).reduce((s, x) => s + x.total, 0)
    - vPays.filter(x => x.vendorId === v.id && !x.returnId).reduce((s, x) => s + x.amount, 0)
    - pReturns.filter(x => x.vendorId === v.id).reduce((s, x) => s + x.totalAmount, 0)), 0);
  const inventory = stock.reduce((t, x) => t + x.value, 0) + delta(name => name === 'Inventory');
  const payablesFinal = payables - delta((name, type) => type === 'liability' && name === 'Accounts payable');
  const otherAssets = delta((name, type, moneyType) => type === 'asset' && !moneyType && name !== 'Accounts receivable' && name !== 'Inventory');
  const otherLiabilities = -delta((name, type) => type === 'liability' && name !== 'Accounts payable');
  const assets = (cash ?? 0) + (bank ?? 0) + (wallets ?? 0) + receivables + inventory + otherAssets;
  const equity = assets - payablesFinal - otherLiabilities;
  const journalRows = await buildJournalRows('0001-01-01', asOf);
  const journalEquity = +journalRows.filter(row => row.account === 'Owner equity').reduce((total, row) => total + row.credit - row.debit, 0).toFixed(2);
  const otherEquity = +(equity - journalEquity).toFixed(2);
  res.json({ asOf, assets: { cash, bank, wallets, receivables, inventory, other: otherAssets, total: assets }, liabilities: { payables: payablesFinal, other: otherLiabilities, total: payablesFinal + otherLiabilities }, equity, journalEquity, otherEquity, totalLiabilitiesAndEquity: payablesFinal + otherLiabilities + equity, balanced: Math.abs(assets - payablesFinal - otherLiabilities - equity) < 0.01 });
});

async function buildJournalRows(from: string, to: string) {
  const [sales, purchases, expenses, returns, payments, accounts, customers, vendors, stockAdjustments, savedEntries, linkedCashAccounts] = await Promise.all([
    db.sale.findMany({ where: { date: { gte: from, lte: to } }, include: { items: true } }),
    db.purchase.findMany({ where: { date: { gte: from, lte: to } }, include: { items: true } }),
    db.expense.findMany({ where: { date: { gte: from, lte: to }, deletedAt: null } }),
    db.productReturn.findMany({ where: { date: { gte: from, lte: to } }, include: { items: true } }),
    db.moneyMovement.findMany({ where: { active: true, date: { gte: from, lte: to } }, include: { moneyAccount: { select: { id: true, name: true, type: true } } } }),
    db.moneyAccount.findMany(),
    db.customer.findMany({ where: { deletedAt: null, openingDue: { not: 0 } } }),
    db.vendor.findMany({ where: { deletedAt: null, openingPayable: { not: 0 } } }),
    db.stockMovement.findMany({ where: { date: { gte: from, lte: to }, type: { in: ['OPENING', 'ADJUSTMENT', 'REVALUE'] }, bucket: 'sellable' } }),
    db.journalEntry.findMany({ where: { active: true, date: { gte: from, lte: to } }, include: { lines: { include: { account: true } } } }),
    db.chartAccount.findMany({ where: { moneyAccountId: { not: null } }, select: { moneyAccountId: true, name: true } }),
  ]);
  const linkedName = new Map(linkedCashAccounts.map(a => [a.moneyAccountId!, a.name]));
  const cashLedgerName = (a?: { id?: string; name: string; type: string } | null) => a?.id ? linkedName.get(a.id) ?? moneyAccountLedgerName(a) : moneyAccountLedgerName(a);
  const rows: { date: string; reference: string; account: string; accountId?: string; description: string; debit: number; credit: number; journalNo: string; sequence: number; entryId?: string; editable?: boolean; sourceType?: string; sourceId?: string | null; sourceRef?: string | null }[] = [];
  const add = (date: string, reference: string, account: string, description: string, debit: number, credit: number) => {
    if (date < from || date > to) return;
    rows.push({ date, reference, account, description, debit: +debit.toFixed(2), credit: +credit.toFixed(2), journalNo: '', sequence: 0 });
  };
  for (const a of accounts) {
    const date = a.openingDate ?? '0001-01-01';
    if (a.openingBalance !== 0) {
      const amount = Math.abs(a.openingBalance); const moneyAccount = cashLedgerName(a);
      add(date, `OPEN-${a.id}`, a.openingBalance > 0 ? moneyAccount : 'Owner equity', 'Account opening balance', amount, 0);
      add(date, `OPEN-${a.id}`, a.openingBalance > 0 ? 'Owner equity' : moneyAccount, 'Account opening balance', 0, amount);
    }
  }
  for (const c of customers) { add('0001-01-01', `OPEN-C-${c.id}`, 'Accounts receivable', 'Customer opening due', c.openingDue, 0); add('0001-01-01', `OPEN-C-${c.id}`, 'Owner equity', 'Customer opening due', 0, c.openingDue); }
  for (const v of vendors) { add('0001-01-01', `OPEN-V-${v.id}`, 'Owner equity', 'Vendor opening payable', v.openingPayable, 0); add('0001-01-01', `OPEN-V-${v.id}`, 'Accounts payable', 'Vendor opening payable', 0, v.openingPayable); }
  for (const s of stockAdjustments) {
    const isDebit = s.value >= 0; const amount = Math.abs(s.value); const counterpart = s.type === 'OPENING' ? 'Owner equity' : 'Inventory adjustments';
    const description = s.type === 'ADJUSTMENT' ? `Stock audit adjustment · ${s.refId ?? s.id}` : `${s.type.toLowerCase()} stock valuation`;
    add(s.date, s.refId ?? s.id, isDebit ? 'Inventory' : counterpart, description, isDebit ? amount : 0, isDebit ? 0 : amount);
    add(s.date, s.refId ?? s.id, isDebit ? counterpart : 'Inventory', description, isDebit ? 0 : amount, isDebit ? amount : 0);
  }
  for (const s of sales) { const ref = s.invoiceNo ?? s.id; const cogs = s.items.reduce((n, i) => n + i.cogs, 0); add(s.date, ref, 'Accounts receivable', 'Credit sale', s.total, 0); add(s.date, ref, 'Sales revenue', 'Sale', 0, s.total); if (cogs) { add(s.date, ref, 'Cost of goods sold', 'AVCO cost at sale', cogs, 0); add(s.date, ref, 'Inventory', 'Stock issued', 0, cogs); } }
  for (const p of purchases) { const ref = p.invoiceNo ?? p.id; add(p.date, ref, 'Inventory', 'Purchase at invoice cost', p.total, 0); add(p.date, ref, 'Accounts payable', 'Purchase invoice', 0, p.total); }
  for (const e of expenses) {
    const movement = payments.find(m => m.sourceType === 'expense' && m.sourceId === e.id);
    add(e.date, e.voucherNo ?? e.id, e.capitalized ? 'Inventory' : 'Operating expenses', e.capitalized ? 'Capitalized landed cost' : `Expense · ${e.category}`, e.amount, 0);
    add(e.date, e.voucherNo ?? e.id, cashLedgerName(movement?.moneyAccount ?? (movement ? { name: movement.method, type: movement.method } : null)), 'Expense paid', 0, e.amount);
  }
  for (const r of returns) {
    const ref = r.returnNo ?? r.id;
    if (r.kind === 'sale') {
      const refund = Math.min(r.totalAmount, r.refundAmount);
      add(r.date, ref, 'Sales returns', 'Sales return / credit', r.totalAmount, 0);
      if (refund) add(r.date, ref, 'Cash: Unassigned', 'Customer refund', 0, refund);
      if (r.totalAmount > refund) add(r.date, ref, 'Accounts receivable', 'Customer credit', 0, r.totalAmount - refund);
      const stockCost = r.items.reduce((n, i) => n + i.cogs, 0);
      if (stockCost) { add(r.date, ref, 'Inventory', 'Returned goods at original AVCO', stockCost, 0); add(r.date, ref, 'Cost of goods sold', 'Reverse returned goods cost', 0, stockCost); }
    } else {
      const refund = Math.min(r.totalAmount, r.refundAmount);
      if (r.totalAmount > refund) add(r.date, ref, 'Accounts payable', 'Purchase return credit', r.totalAmount - refund, 0);
      if (refund) add(r.date, ref, 'Cash: Unassigned', 'Supplier refund', refund, 0);
      add(r.date, ref, 'Inventory', 'Purchase return', 0, r.totalAmount);
    }
  }
  for (const m of payments) {
    const ref = m.sourceId;
    const cashAccount = cashLedgerName(m.moneyAccount ?? { name: m.method, type: m.method });
    if (m.sourceType === 'sale') { add(m.date, ref, cashAccount, 'Sale receipt', m.amount, 0); add(m.date, ref, 'Accounts receivable', 'Receipt applied', 0, m.amount); }
    else if (m.sourceType === 'purchase') { add(m.date, ref, 'Accounts payable', 'Supplier payment', m.amount, 0); add(m.date, ref, cashAccount, 'Purchase payment', 0, m.amount); }
    else if (m.sourceType === 'customerPayment') { add(m.date, ref, cashAccount, 'Customer receipt', m.amount, 0); add(m.date, ref, 'Accounts receivable', 'Customer receipt applied', 0, m.amount); }
    else if (m.sourceType === 'vendorPayment') { add(m.date, ref, 'Accounts payable', 'Vendor payment', m.amount, 0); add(m.date, ref, cashAccount, 'Vendor payment', 0, m.amount); }
    else if (m.sourceType === 'expense') continue; // expense document posts the matching cash line below
    else if (m.sourceType === 'saleReturn' || m.sourceType === 'purchaseReturn') continue; // return document owns the posting
    else if (m.sourceType === 'transferOut') { add(m.date, ref, 'Transfer clearing', 'Account transfer out', m.amount, 0); add(m.date, ref, cashAccount, 'Account transfer out', 0, m.amount); }
    else if (m.sourceType === 'transferIn') { add(m.date, ref, cashAccount, 'Account transfer in', m.amount, 0); add(m.date, ref, 'Transfer clearing', 'Account transfer in', 0, m.amount); }
    else if (m.sourceType === 'openingAdjust') {
      if (m.direction === 'in') { add(m.date, ref, cashAccount, 'Opening balance adjustment', m.amount, 0); add(m.date, ref, 'Owner equity', 'Opening balance adjustment', 0, m.amount); }
      else { add(m.date, ref, 'Owner equity', 'Opening balance adjustment', m.amount, 0); add(m.date, ref, cashAccount, 'Opening balance adjustment', 0, m.amount); }
    } else if (m.sourceType === 'deposit') { add(m.date, ref, cashAccount, 'External deposit', m.amount, 0); add(m.date, ref, 'Owner equity', 'External deposit / other income', 0, m.amount); }
    else if (m.sourceType === 'withdrawal') { add(m.date, ref, 'Owner drawings / other expense', 'External withdrawal', m.amount, 0); add(m.date, ref, cashAccount, 'External withdrawal', 0, m.amount); }
  }
  for (const entry of savedEntries) for (const line of entry.lines) {
    const row = { date: entry.date, reference: entry.entryNo, account: line.account.name, accountId: line.accountId, description: `${entry.memo}${line.description ? ` · ${line.description}` : ''}`, debit: +line.debit.toFixed(2), credit: +line.credit.toFixed(2), journalNo: '', sequence: 0, entryId: entry.id, editable: entry.sourceType === 'manual', sourceType: entry.sourceType, sourceId: entry.sourceId, sourceRef: entry.sourceRef };
    if (entry.date >= from && entry.date <= to) rows.push(row);
  }
  rows.sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  let currentDate = ''; let sequence = 0; let previousJournal = '';
  for (const row of rows) {
    const journalKey = `${row.date}|${row.reference}`;
    if (row.date !== currentDate) { currentDate = row.date; sequence = 0; previousJournal = ''; }
    if (journalKey !== previousJournal) { sequence++; previousJournal = journalKey; }
    row.sequence = sequence;
    row.journalNo = `JRN-${row.date.replace(/-/g, '')}-${String(sequence).padStart(4, '0')}`;
  }
  return rows;
}

reports.get('/journal-entries', async (req: Request, res: Response) => {
  const from = typeof req.query.from === 'string' ? req.query.from : '0001-01-01';
  const to = typeof req.query.to === 'string' ? req.query.to : todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return res.status(400).json({ error: 'Valid from and to dates are required' });
  const rows = await buildJournalRows(from, to);
  const groups = new Map<string, typeof rows>();
  for (const row of rows) { const key = `${row.date}|${row.reference}`; groups.set(key, [...(groups.get(key) ?? []), row]); }
  const entries = [...groups.values()].map(lines => ({ date: lines[0].date, reference: lines[0].reference, lines,
    entryId: lines.find(line => line.entryId)?.entryId, editable: lines.some(line => line.editable), sourceType: lines.find(line => line.sourceType)?.sourceType,
    sourceId: lines.find(line => line.sourceId)?.sourceId, sourceRef: lines.find(line => line.sourceRef)?.sourceRef,
    debitTotal: +lines.reduce((n, x) => n + x.debit, 0).toFixed(2), creditTotal: +lines.reduce((n, x) => n + x.credit, 0).toFixed(2) }));
  res.json({ from, to, entries, debitTotal: +rows.reduce((n, r) => n + r.debit, 0).toFixed(2), creditTotal: +rows.reduce((n, r) => n + r.credit, 0).toFixed(2), balanced: entries.every(e => Math.abs(e.debitTotal - e.creditTotal) < 0.01) });
});

reports.get('/general-ledger', async (req: Request, res: Response) => {
  const from = typeof req.query.from === 'string' ? req.query.from : '0001-01-01';
  const to = typeof req.query.to === 'string' ? req.query.to : todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return res.status(400).json({ error: 'Valid from and to dates are required' });
  const [allRows, moneyAccounts, chartAccounts] = await Promise.all([
    buildJournalRows('0001-01-01', to),
    db.moneyAccount.findMany({ orderBy: [{ type: 'asc' }, { name: 'asc' }] }),
    db.chartAccount.findMany({ where: { active: true }, orderBy: [{ code: 'asc' }] }),
  ]);
  const accounts = new Map<string, { account: string; code: string; openingBalance: number; periodDebit: number; periodCredit: number; closingBalance: number; netBalance: number; balanceSide: 'Dr' | 'Cr'; rows: (typeof allRows[number] & { runningBalance: number })[] }>();
  for (const chartAccount of LEDGER_ACCOUNTS) accounts.set(chartAccount.account, { ...chartAccount, openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0, netBalance: 0, balanceSide: 'Dr', rows: [] });
  for (const chartAccount of chartAccounts) accounts.set(chartAccount.name, { account: chartAccount.name, code: chartAccount.code, openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0, netBalance: 0, balanceSide: 'Dr', rows: [] });
  for (const moneyAccount of moneyAccounts) {
    const linkedChart = chartAccounts.find(row => row.moneyAccountId === moneyAccount.id);
    const account = linkedChart?.name ?? moneyAccountLedgerName(moneyAccount);
    const chartCode = linkedChart?.code;
    accounts.set(account, { account, code: chartCode ?? ledgerAccountCode(account), openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0, netBalance: 0, balanceSide: 'Dr', rows: [] });
  }
  for (const row of allRows) {
    let account = accounts.get(row.account);
    if (!account) { account = { account: row.account, code: ledgerAccountCode(row.account), openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0, netBalance: 0, balanceSide: 'Dr', rows: [] }; accounts.set(row.account, account); }
    account.closingBalance += row.debit - row.credit;
    if (row.date < from) account.openingBalance += row.debit - row.credit;
    else { account.rows.push({ ...row, runningBalance: +account.closingBalance.toFixed(2) }); account.periodDebit += row.debit; account.periodCredit += row.credit; }
  }
  for (const account of accounts.values()) { account.netBalance = +Math.abs(account.closingBalance).toFixed(2); account.balanceSide = account.closingBalance < 0 ? 'Cr' : 'Dr'; }
  const list = [...accounts.values()].sort((a, b) => a.code.localeCompare(b.code) || a.account.localeCompare(b.account));
  const debitTotal = +list.reduce((n, a) => n + a.periodDebit, 0).toFixed(2);
  const creditTotal = +list.reduce((n, a) => n + a.periodCredit, 0).toFixed(2);
  res.json({ from, to, accounts: list, debitTotal, creditTotal, balanced: Math.abs(debitTotal - creditTotal) < 0.01 });
});

// GET /api/dashboard
reports.get('/dashboard', async (_req: Request, res: Response) => {
  const td = todayStr();
  const [cPays, customers, vendors] = await Promise.all([
    db.customerPayment.findMany({ where: { returnId: null, active: true } }),
    db.customer.findMany({ where: { deletedAt: null } }),
    db.vendor.findMany({ where: { deletedAt: null } }),
  ]);
  // Profit is NEVER computed here: /dashboard only reads the canonical
  // finance service so Home, Accounts and the API cannot drift apart.
  const [today, life] = await Promise.all([periodFinance('day', td), lifetimeFinance()]);
  const todayCollect = sum(cPays.filter(p => p.date === td));
  const due = await dueTotal('c');
  const payable = await dueTotal('v');
  res.json({
    todaySale: today.netSales,
    todayCollect,
    todayPurchase: today.netPurchase,
    todayProfit: today.netProfit,
    todayExpense: today.expense,
    todayDue: Math.max(0, today.netSales - todayCollect),
    totalSale: life.netSales,
    totalPurchase: life.netPurchase,
    totalProfit: life.netProfit,
    totalExpense: life.expense,
    today,
    lifetime: life,
    due, payable,
    customerCount: customers.length, vendorCount: vendors.length,
  });
});

// GET /api/finance?mode=day|month|year|range&date=YYYY-MM-DD&from=&to=
// The one canonical financial breakdown used by Home and Accounts.
reports.get('/finance', async (req: Request, res: Response) => {
  const mode = (['day', 'month', 'year', 'all', 'range'].includes(String(req.query.mode)) ? req.query.mode : 'day') as 'day' | 'month' | 'year' | 'all' | 'range';
  const date = typeof req.query.date === 'string' ? req.query.date : undefined;
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  res.json(await periodFinance(mode, from ?? date, to));
});

// Direct cash flow for the selected period. Transfers between the shop's own
// accounts are excluded from operating flows and cancel out of closing cash.
reports.get('/cashflow', async (req: Request, res: Response) => {
  const from = typeof req.query.from === 'string' ? req.query.from : undefined;
  const to = typeof req.query.to === 'string' ? req.query.to : undefined;
  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) {
    return res.status(400).json({ error: 'Valid from and to dates are required' });
  }
  const [accounts, movements, landedCostRows, cashJournalLines] = await Promise.all([
    db.moneyAccount.findMany({ select: { openingBalance: true, openingDate: true } }),
    db.moneyMovement.findMany({ where: { active: true, date: { lte: to } } }),
    db.expense.findMany({ where: { capitalized: true, deletedAt: null, date: { gte: from, lte: to } }, select: { id: true } }),
    db.journalLine.findMany({ where: { entry: { active: true, date: { lte: to } }, account: { moneyAccountId: { not: null } } }, include: { entry: { select: { date: true } }, account: { select: { moneyAccountId: true } } } }),
  ]);
  const journalCashDeltaBefore = cashJournalLines.filter(line => line.entry.date < from).reduce((total, line) => total + line.debit - line.credit, 0);
  const journalCashDeltaPeriod = cashJournalLines.filter(line => line.entry.date >= from).reduce((total, line) => total + line.debit - line.credit, 0);
  const openingBalance = accounts.reduce((total, a) => total + (!a.openingDate || a.openingDate < from ? a.openingBalance : 0), 0) +
    movements.filter(m => m.date < from).reduce((total, m) => total + (m.direction === 'in' ? m.amount : -m.amount), 0) + journalCashDeltaBefore;
  const period = movements.filter(m => m.date >= from && m.date <= to);
  const amount = (types: string[], direction: 'in' | 'out') => period
    .filter(m => types.includes(m.sourceType) && m.direction === direction)
    .reduce((total, m) => total + m.amount, 0);
  const customerReceipts = amount(['sale', 'customerPayment'], 'in');
  const supplierPayments = amount(['purchase', 'vendorPayment'], 'out');
  const landedIds = new Set(landedCostRows.map(e => e.id));
  const inventoryCostPayments = period.filter(m => m.sourceType === 'expense' && landedIds.has(m.sourceId) && m.direction === 'out').reduce((total, m) => total + m.amount, 0);
  const expensePayments = amount(['expense'], 'out') - inventoryCostPayments;
  const returnInflows = amount(['saleReturn', 'purchaseReturn'], 'in');
  const returnOutflows = amount(['saleReturn', 'purchaseReturn'], 'out');
  const openingDeposits = accounts.filter(a => a.openingDate && a.openingDate >= from && a.openingDate <= to).reduce((total, a) => total + a.openingBalance, 0);
  const otherInflows = amount(['deposit', 'openingAdjust'], 'in') + openingDeposits + Math.max(0, journalCashDeltaPeriod);
  const otherOutflows = amount(['withdrawal', 'openingAdjust'], 'out') + Math.max(0, -journalCashDeltaPeriod);
  const operatingInflows = customerReceipts + returnInflows + otherInflows;
  const operatingOutflows = supplierPayments + inventoryCostPayments + expensePayments + returnOutflows + otherOutflows;
  const netCashFlow = Math.round((operatingInflows - operatingOutflows) * 100) / 100;
  res.json({
    from, to, openingBalance: Math.round(openingBalance * 100) / 100,
    customerReceipts, supplierPayments, inventoryCostPayments, expensePayments, returnInflows, returnOutflows,
    otherInflows, otherOutflows, operatingInflows: Math.round(operatingInflows * 100) / 100,
    operatingOutflows: Math.round(operatingOutflows * 100) / 100, netCashFlow,
    closingBalance: Math.round((openingBalance + netCashFlow) * 100) / 100,
  });
});

async function dueTotal(kind: 'c' | 'v') {
  if (kind === 'c') {
    const [cs, sales, pays] = await Promise.all([
      db.customer.findMany({ where: { deletedAt: null } }), db.sale.findMany(), db.customerPayment.findMany({ where: { active: true } }),
    ]);
    const byCust = (id: string) =>
      Math.max(0, (cs.find(c => c.id === id)?.openingDue ?? 0) +
      sales.filter(s => s.customerId === id).reduce((s, x) => s + x.total, 0) -
      pays.filter(p => p.customerId === id).reduce((s, x) => s + x.amount, 0));
    return cs.reduce((s, c) => s + byCust(c.id), 0);
  }
  const [vs, purs, pays] = await Promise.all([
      db.vendor.findMany({ where: { deletedAt: null } }), db.purchase.findMany(), db.vendorPayment.findMany({ where: { active: true } }),
  ]);
  const byVend = (id: string) =>
    Math.max(0, (vs.find(v => v.id === id)?.openingPayable ?? 0) +
    purs.filter(p => p.vendorId === id).reduce((s, x) => s + x.total, 0) -
    pays.filter(p => p.vendorId === id).reduce((s, x) => s + x.amount, 0));
  return vs.reduce((s, v) => s + byVend(v.id), 0);
}

// GET /api/accounts/receivables/:id — one customer: opening + sales w/ items + standalone collections + balance
reports.get('/accounts/receivables/:id', async (req: Request, res: Response) => {
  const c = await db.customer.findUnique({ where: { id: req.params.id } });
  if (!c || c.deletedAt) return res.status(404).json({ error: 'Customer not found' });
  const [sales, allPays] = await Promise.all([
    db.sale.findMany({
      where: { customerId: c.id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { items: { include: { product: { select: { name: true } } } } },
    }),
    db.customerPayment.findMany({ where: { customerId: c.id, active: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
  ]);
  const ids = sales.map(s => s.id);
  const saleRets = ids.length
    ? await db.productReturn.findMany({ where: { saleId: { in: ids } }, select: { saleId: true, totalAmount: true } })
    : [];
  // Per-invoice paid/due/status derived from the canonical settlement. The sum
  // of derived paid already covers every collection (dedicated + FIFO +
  // return credits), so it is used directly — never added to collections.
  const st = buildSettlement(
    sales.map(s => ({ id: s.id, partyId: c.id, date: s.date, total: s.total, createdAt: s.createdAt })),
    saleRets.map(r => ({ invoiceId: r.saleId, amount: r.totalAmount })),
    allPays.map(p => ({ partyId: c.id, invoiceId: p.saleId, returnId: p.returnId, date: p.date, amount: p.amount, createdAt: p.createdAt })),
  );
  const pays = allPays.filter(p => !p.saleId);
  const saleTotal = sales.reduce((s, x) => s + x.total, 0);
  const salePaid = [...st.values()].reduce((s, x) => s + x.paid, 0);
  res.json({
    party: { id: c.id, name: c.name, mobile: c.mobile, opening: c.openingDue, next: c.nextDate ?? undefined },
    opening: c.openingDue,
    sales: sales.map(s => {
      const sst = st.get(s.id);
      return {
        id: s.id, invoiceNo: s.invoiceNo ?? undefined, date: s.date, total: s.total,
        paid: sst?.paid ?? s.paid, due: sst?.due ?? s.due, status: sst?.status,
        items: s.items.map(it => ({
          productName: it.product.name, unit: it.unit,
          enteredQty: it.enteredQty, qtyKg: it.qtyKg, rate: it.rate,
        })),
      };
    }),
    payments: pays.map(p => ({ id: p.id, amount: p.amount, date: p.date, note: p.note ?? undefined })),
    totalSales: saleTotal,
    totalPaid: Math.round(salePaid * 100) / 100,
    balance: Math.round((c.openingDue + saleTotal - salePaid) * 100) / 100,
  });
});

// GET /api/accounts/payables/:id — one vendor: opening + purchases w/ items + standalone payments + balance
reports.get('/accounts/payables/:id', async (req: Request, res: Response) => {
  const v = await db.vendor.findUnique({ where: { id: req.params.id } });
  if (!v || v.deletedAt) return res.status(404).json({ error: 'Vendor not found' });
  const [purs, allPays] = await Promise.all([
    db.purchase.findMany({
      where: { vendorId: v.id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      include: { items: { include: { product: { select: { name: true } } } } },
    }),
    db.vendorPayment.findMany({ where: { vendorId: v.id, active: true }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }] }),
  ]);
  const pids = purs.map(p => p.id);
  const purRets = pids.length
    ? await db.productReturn.findMany({ where: { purchaseId: { in: pids } }, select: { purchaseId: true, totalAmount: true } })
    : [];
  // Canonical per-invoice settlement; its paid sum already covers every
  // payment (dedicated + FIFO + return credits).
  const st = buildSettlement(
    purs.map(p => ({ id: p.id, partyId: v.id, date: p.date, total: p.total, createdAt: p.createdAt })),
    purRets.map(r => ({ invoiceId: r.purchaseId, amount: r.totalAmount })),
    allPays.map(p => ({ partyId: v.id, invoiceId: p.purchaseId, returnId: p.returnId, date: p.date, amount: p.amount, createdAt: p.createdAt })),
  );
  const pays = allPays.filter(p => !p.purchaseId);
  const purTotal = purs.reduce((s, x) => s + x.total, 0);
  const purPaid = [...st.values()].reduce((s, x) => s + x.paid, 0);
  res.json({
    party: { id: v.id, name: v.name, mobile: v.mobile, opening: v.openingPayable, next: v.nextDate ?? undefined },
    opening: v.openingPayable,
    purchases: purs.map(p => {
      const pst = st.get(p.id);
      return {
        id: p.id, invoiceNo: p.invoiceNo ?? undefined, date: p.date, total: p.total,
        paid: pst?.paid ?? p.paid, due: pst?.due ?? p.due, status: pst?.status,
        items: p.items.map(it => ({
          productName: it.product.name, unit: it.unit,
          enteredQty: it.enteredQty, qtyKg: it.qtyKg, rate: it.rate,
        })),
      };
    }),
    payments: pays.map(p => ({ id: p.id, amount: p.amount, date: p.date, note: p.note ?? undefined })),
    totalPurchase: purTotal,
    totalPaid: Math.round(purPaid * 100) / 100,
    balance: Math.round((v.openingPayable + purTotal - purPaid) * 100) / 100,
  });
});
// GET /api/accounts/receivables — customers with balance > 0
reports.get('/accounts/receivables', async (_req: Request, res: Response) => {
  const [cs, sales, pays] = await Promise.all([
    db.customer.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.sale.findMany(), db.customerPayment.findMany({ where: { active: true } }),
  ]);
  res.json(cs
    .map(c => ({
      id: c.id, name: c.name, mobile: c.mobile,
      balance: c.openingDue + sales.filter(s => s.customerId === c.id).reduce((s, x) => s + x.total, 0)
        - pays.filter(p => p.customerId === c.id).reduce((s, x) => s + x.amount, 0),
      next: c.nextDate ?? undefined,
    }))
    .filter(x => x.balance > 0));
});

// GET /api/accounts/payables — vendors with balance > 0
reports.get('/accounts/payables', async (_req: Request, res: Response) => {
  const [vs, purs, pays] = await Promise.all([
    db.vendor.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.purchase.findMany(), db.vendorPayment.findMany({ where: { active: true } }),
  ]);
  res.json(vs
    .map(v => ({
      id: v.id, name: v.name, mobile: v.mobile,
      balance: v.openingPayable + purs.filter(p => p.vendorId === v.id).reduce((s, x) => s + x.total, 0)
        - pays.filter(p => p.vendorId === v.id).reduce((s, x) => s + x.amount, 0),
      next: v.nextDate ?? undefined,
    }))
    .filter(x => x.balance > 0));
});
