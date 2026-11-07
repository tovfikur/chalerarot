import { randomUUID } from 'node:crypto';
import { Router, Request, Response } from 'express';
import { db } from '../db';
import { todayStr } from '../units';
import { lifetimeFinance, periodFinance } from '../finance';
import { buildSettlement } from '../settlement';
import { seedChart } from './accounting';

const sum = (a: { amount: number }[]) => a.reduce((s, x) => s + x.amount, 0);
const round2 = (n: number) => Math.round(n * 100) / 100;

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
  if (name === 'Supplier advances') return '1110';
  if (name === 'Inventory') return '1200';
  if (name === 'Accounts payable') return '2000';
  if (name === 'Customer credits') return '2010';
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
  await reconcileAutomaticJournalEntries();
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
  const savedJournalLines = await db.journalLine.findMany({ where: { entry: { active: true, sourceType: { in: ['manual', 'houseExpense'] }, date: { lte: asOf } } }, include: { entry: { select: { sourceType: true } }, account: { select: { code: true, name: true, type: true, moneyAccount: { select: { type: true } } } } } });
  // House expense cash movements are already reflected in MoneyMovement; only
  // manual journals need to adjust the derived cash and party balances here.
  const delta = (fn: (code: string, name: string, type: string, moneyType?: string) => boolean) => savedJournalLines.filter(line => line.entry.sourceType === 'manual' && fn(line.account.code, line.account.name, line.account.type, line.account.moneyAccount?.type)).reduce((total, line) => total + line.debit - line.credit, 0);
  const cash = (accountBalance('cash') ?? 0) + delta((code, _name, _type, moneyType) => moneyType === 'cash' || (!moneyType && code === '1010'));
  const bank = (accountBalance('bank') ?? 0) + delta((code, _name, _type, moneyType) => moneyType === 'bank' || (!moneyType && code === '1020'));
  const walletBalances = ['bkash', 'nagad', 'rocket'].map((type, index) => (accountBalance(type) ?? 0) + delta((code, _name, _accountType, moneyType) => moneyType === type || (!moneyType && code === String(1030 + index * 10))));
  const wallets = walletBalances.length ? walletBalances.reduce((total, balance) => total + balance, 0) : null;
  const customerBalances = customers.map(c => c.openingDue
    + sales.filter(x => x.customerId === c.id).reduce((s, x) => s + x.total, 0)
    - cPays.filter(x => x.customerId === c.id && !x.returnId).reduce((s, x) => s + x.amount, 0)
    - sReturns.filter(x => x.customerId === c.id).reduce((s, x) => s + x.totalAmount, 0)
    + sReturns.filter(x => x.customerId === c.id).reduce((s, x) => s + x.refundAmount, 0));
  const customerReceivableBase = customerBalances.reduce((sum, balance) => sum + Math.max(0, balance), 0);
  const customerCreditBase = customerBalances.reduce((sum, balance) => sum + Math.max(0, -balance), 0);
  const receivableAdjustment = delta(code => code === '1100');
  const receivables = customerReceivableBase + Math.max(0, receivableAdjustment);
  const customerCredits = customerCreditBase + Math.max(0, -receivableAdjustment);
  const vendorBalances = vendors.map(v => v.openingPayable
    + purchases.filter(x => x.vendorId === v.id).reduce((s, x) => s + x.total, 0)
    - vPays.filter(x => x.vendorId === v.id && !x.returnId).reduce((s, x) => s + x.amount, 0)
    - pReturns.filter(x => x.vendorId === v.id).reduce((s, x) => s + x.totalAmount, 0)
    + pReturns.filter(x => x.vendorId === v.id).reduce((s, x) => s + x.refundAmount, 0));
  const vendorPayableBase = vendorBalances.reduce((sum, balance) => sum + Math.max(0, balance), 0);
  const vendorAdvanceBase = vendorBalances.reduce((sum, balance) => sum + Math.max(0, -balance), 0);
  const payableAdjustment = delta(code => code === '2000');
  const supplierAdvances = vendorAdvanceBase + Math.max(0, payableAdjustment);
  const payables = vendorPayableBase + Math.max(0, -payableAdjustment);
  const inventory = stock.reduce((t, x) => t + x.value, 0) + delta(code => code === '1200');
  const payablesFinal = payables;
  const otherAssets = delta((code, _name, type, moneyType) => type === 'asset' && !moneyType && !['1010', '1020', '1030', '1040', '1050', '1100', '1110', '1200'].includes(code));
  const otherLiabilities = -delta((code, _name, type) => type === 'liability' && code !== '2000');
  const assets = (cash ?? 0) + (bank ?? 0) + (wallets ?? 0) + receivables + supplierAdvances + inventory + otherAssets;
  const totalLiabilities = payablesFinal + customerCredits + otherLiabilities;
  const equity = assets - totalLiabilities;
  const journalRows = await buildJournalRows('0001-01-01', asOf);
  const chart = await db.chartAccount.findMany();
  const equityAccountIds = new Set(chart.filter(account => account.type === 'equity').map(account => account.id));
  const journalEquity = +journalRows.filter(row => equityAccountIds.has(row.accountId ?? '')).reduce((total, row) => total + row.credit - row.debit, 0).toFixed(2);
  const otherEquity = +(equity - journalEquity).toFixed(2);
  const byId = new Map(chart.map(account => [account.id, account]));
  const byName = new Map(chart.map(account => [account.name, account]));
  const byCode = new Map(chart.map(account => [account.code, account]));
  const accountTotals = new Map<string, { code: string; name: string; type: string; balance: number }>();
  for (const row of journalRows.filter(item => item.sourceType === 'manual' || item.sourceType === 'houseExpense')) {
    const account = byId.get(row.accountId ?? '') ?? byName.get(row.account) ?? byCode.get(ledgerAccountCode(row.account));
    if (!account || !['asset', 'liability', 'equity'].includes(account.type)) continue;
    const key = account.id;
    const entry = accountTotals.get(key) ?? { code: account.code, name: account.name, type: account.type, balance: 0 };
    entry.balance += account.type === 'asset' ? row.debit - row.credit : row.credit - row.debit;
    accountTotals.set(key, entry);
  }
  const rowsOfType = (type: string) => [...accountTotals.values()].filter(row => row.type === type && Math.abs(row.balance) >= 0.01).map(row => ({ ...row, balance: +row.balance.toFixed(2) })).sort((a, b) => a.code.localeCompare(b.code));
  const managedMoneyCodes = new Set(chart.filter(account => account.moneyAccountId).map(account => account.code));
  const dynamicBalance = (code: string, name: string, type: string, balance: number) => ({ code, name: byCode.get(code)?.name ?? name, type, balance: +balance.toFixed(2) });
  const accountBreakdown = {
    assets: [
      ...rowsOfType('asset').filter(row => !['1010', '1020', '1030', '1040', '1050', '1100', '1110', '1200'].includes(row.code) && !managedMoneyCodes.has(row.code)),
      ...(cash !== null ? [dynamicBalance('1010', 'Cash', 'asset', cash)] : []),
      ...(bank !== null ? [dynamicBalance('1020', 'Bank', 'asset', bank)] : []),
      ...(walletBalances[0] ? [dynamicBalance('1030', 'bKash', 'asset', walletBalances[0])] : []),
      ...(walletBalances[1] ? [dynamicBalance('1040', 'Nagad', 'asset', walletBalances[1])] : []),
      ...(walletBalances[2] ? [dynamicBalance('1050', 'Rocket', 'asset', walletBalances[2])] : []),
      ...(receivables ? [dynamicBalance('1100', 'Accounts receivable', 'asset', receivables)] : []),
      ...(supplierAdvances ? [dynamicBalance('1110', 'Supplier advances', 'asset', supplierAdvances)] : []),
      ...(inventory ? [dynamicBalance('1200', 'Inventory', 'asset', inventory)] : []),
    ].sort((a, b) => a.code.localeCompare(b.code)),
    liabilities: [
      ...rowsOfType('liability').filter(row => !['2000', '2010'].includes(row.code)),
      ...(payablesFinal ? [dynamicBalance('2000', 'Accounts payable', 'liability', payablesFinal)] : []),
      ...(customerCredits ? [dynamicBalance('2010', 'Customer credits', 'liability', customerCredits)] : []),
    ].sort((a, b) => a.code.localeCompare(b.code)),
    equity: [...rowsOfType('equity'), ...(Math.abs(otherEquity) >= 0.01 ? [{ code: '', name: 'Retained earnings and other equity', type: 'equity', balance: otherEquity }] : [])],
  };
  const debits = journalRows.reduce((total, row) => total + row.debit, 0);
  const credits = journalRows.reduce((total, row) => total + row.credit, 0);
  const detailAssets = accountBreakdown.assets.reduce((total, row) => total + row.balance, 0);
  const detailLiabilities = accountBreakdown.liabilities.reduce((total, row) => total + row.balance, 0);
  const totalLiabilitiesAndEquity = totalLiabilities + equity;
  const balanced = Math.abs(debits - credits) < 0.01
    && Math.abs(detailAssets - assets) < 0.01
    && Math.abs(detailLiabilities - totalLiabilities) < 0.01
    && Math.abs(assets - totalLiabilitiesAndEquity) < 0.01;
  res.json({ asOf, assets: { cash, bank, wallets, receivables, supplierAdvances, inventory, other: otherAssets, total: assets }, liabilities: { payables: payablesFinal, customerCredits, other: otherLiabilities, total: totalLiabilities }, equity, journalEquity, otherEquity, accounts: accountBreakdown, totalLiabilitiesAndEquity, balanced });
});

type AdvancePostings = {
  customerPaymentApplied: Map<string, number>;
  vendorPaymentApplied: Map<string, number>;
  saleAdvanceApplied: Map<string, number>;
  purchaseAdvanceApplied: Map<string, number>;
  saleReturnReceivable: Map<string, number>;
  purchaseReturnPayable: Map<string, number>;
};

/** Split party payments into receivable/payable settlement and advance
 * balances in transaction order. These are the same customer credits and
 * supplier advances that the balance sheet derives from the party ledgers.
 */
async function computeAdvancePostings(to: string): Promise<AdvancePostings> {
  const [customers, vendors, sales, purchases, customerPayments, vendorPayments, returns] = await Promise.all([
    db.customer.findMany({ where: { deletedAt: null }, select: { id: true, openingDue: true } }),
    db.vendor.findMany({ where: { deletedAt: null }, select: { id: true, openingPayable: true } }),
    db.sale.findMany({ where: { date: { lte: to }, customerId: { not: null } }, select: { id: true, customerId: true, date: true, total: true, createdAt: true, advanceAllocationControlled: true } }),
    db.purchase.findMany({ where: { date: { lte: to } }, select: { id: true, vendorId: true, date: true, total: true, createdAt: true, advanceAllocationControlled: true } }),
    db.customerPayment.findMany({ where: { active: true, date: { lte: to } }, select: { id: true, customerId: true, saleId: true, returnId: true, date: true, amount: true, createdAt: true, allocationLocked: true, allocations: { select: { saleId: true, amount: true } } } }),
    db.vendorPayment.findMany({ where: { active: true, date: { lte: to } }, select: { id: true, vendorId: true, purchaseId: true, returnId: true, date: true, amount: true, createdAt: true, allocationLocked: true, allocations: { select: { purchaseId: true, amount: true } } } }),
    db.productReturn.findMany({ where: { date: { lte: to } }, select: { id: true, kind: true, saleId: true, purchaseId: true, customerId: true, vendorId: true, date: true, totalAmount: true, refundAmount: true, createdAt: true } }),
  ]);
  type Event = { partyId: string; date: string; at: number; order: number; kind: 'invoice' | 'return' | 'payment' | 'apply'; id: string; amount: number; controlled?: boolean };
  const customerEvents: Event[] = [];
  const vendorEvents: Event[] = [];
  const time = (value: Date) => value.getTime();
  const grouped = <T,>(rows: T[], keyOf: (row: T) => string | null) => {
    const out = new Map<string, T[]>();
    for (const row of rows) {
      const key = keyOf(row);
      if (!key) continue;
      const group = out.get(key) ?? [];
      group.push(row);
      out.set(key, group);
    }
    return out;
  };
  const saleReturnsByInvoice = grouped(returns, row => row.saleId);
  const purchaseReturnsByInvoice = grouped(returns, row => row.purchaseId);
  const salePaymentsByInvoice = grouped(customerPayments, row => row.saleId);
  const purchasePaymentsByInvoice = grouped(vendorPayments, row => row.purchaseId);

  for (const invoice of sales) {
    const partyId = invoice.customerId;
    if (!partyId) continue;
    customerEvents.push({ partyId, date: invoice.date, at: time(invoice.createdAt), order: 0, kind: 'invoice', id: invoice.id, amount: invoice.total });
    const linkedReturns = saleReturnsByInvoice.get(invoice.id) ?? [];
    const linkedPayments = (salePaymentsByInvoice.get(invoice.id) ?? []).filter(p => !p.returnId);
    for (const ret of linkedReturns) customerEvents.push({ partyId, date: ret.date, at: time(ret.createdAt), order: 1, kind: 'return', id: ret.id, amount: Math.max(0, ret.totalAmount - ret.refundAmount) });
    for (const payment of linkedPayments) customerEvents.push({ partyId, date: payment.date, at: time(payment.createdAt), order: 2, kind: 'payment', id: payment.id, amount: payment.amount });
    const applyAt = Math.max(time(invoice.createdAt), ...linkedReturns.map(r => time(r.createdAt)), ...linkedPayments.map(p => time(p.createdAt))) + 1;
    const advanceAllocation = customerPayments.reduce((sum, p) => sum + p.allocations.filter(a => a.saleId === invoice.id).reduce((n, a) => n + a.amount, 0), 0);
    customerEvents.push({ partyId, date: invoice.date, at: applyAt, order: 3, kind: 'apply', id: invoice.id, amount: advanceAllocation, controlled: invoice.advanceAllocationControlled });
  }
  for (const payment of customerPayments) {
    if (payment.customerId && !payment.saleId && !payment.returnId) customerEvents.push({ partyId: payment.customerId, date: payment.date, at: time(payment.createdAt), order: 2, kind: 'payment', id: payment.id, amount: payment.amount });
  }
  for (const ret of returns) {
    if (ret.kind === 'sale' && ret.customerId && !ret.saleId) customerEvents.push({ partyId: ret.customerId, date: ret.date, at: time(ret.createdAt), order: 1, kind: 'return', id: ret.id, amount: Math.max(0, ret.totalAmount - ret.refundAmount) });
  }

  for (const invoice of purchases) {
    const partyId = invoice.vendorId;
    vendorEvents.push({ partyId, date: invoice.date, at: time(invoice.createdAt), order: 0, kind: 'invoice', id: invoice.id, amount: invoice.total });
    const linkedReturns = purchaseReturnsByInvoice.get(invoice.id) ?? [];
    const linkedPayments = (purchasePaymentsByInvoice.get(invoice.id) ?? []).filter(p => !p.returnId);
    for (const ret of linkedReturns) vendorEvents.push({ partyId, date: ret.date, at: time(ret.createdAt), order: 1, kind: 'return', id: ret.id, amount: Math.max(0, ret.totalAmount - ret.refundAmount) });
    for (const payment of linkedPayments) vendorEvents.push({ partyId, date: payment.date, at: time(payment.createdAt), order: 2, kind: 'payment', id: payment.id, amount: payment.amount });
    const applyAt = Math.max(time(invoice.createdAt), ...linkedReturns.map(r => time(r.createdAt)), ...linkedPayments.map(p => time(p.createdAt))) + 1;
    const advanceAllocation = vendorPayments.reduce((sum, p) => sum + p.allocations.filter(a => a.purchaseId === invoice.id).reduce((n, a) => n + a.amount, 0), 0);
    vendorEvents.push({ partyId, date: invoice.date, at: applyAt, order: 3, kind: 'apply', id: invoice.id, amount: advanceAllocation, controlled: invoice.advanceAllocationControlled });
  }
  for (const payment of vendorPayments) {
    if (!payment.purchaseId && !payment.returnId) vendorEvents.push({ partyId: payment.vendorId, date: payment.date, at: time(payment.createdAt), order: 2, kind: 'payment', id: payment.id, amount: payment.amount });
  }
  for (const ret of returns) {
    if (ret.kind === 'purchase' && ret.vendorId && !ret.purchaseId) vendorEvents.push({ partyId: ret.vendorId, date: ret.date, at: time(ret.createdAt), order: 1, kind: 'return', id: ret.id, amount: Math.max(0, ret.totalAmount - ret.refundAmount) });
  }

  const sortEvents = (a: Event, b: Event) => a.date.localeCompare(b.date) || a.at - b.at || a.order - b.order || a.id.localeCompare(b.id);
  const customerState = new Map(customers.map(row => [row.id, { due: Math.max(0, row.openingDue), advance: Math.max(0, -row.openingDue) }]));
  const vendorState = new Map(vendors.map(row => [row.id, { due: Math.max(0, row.openingPayable), advance: Math.max(0, -row.openingPayable) }]));
  const result: AdvancePostings = {
    customerPaymentApplied: new Map(), vendorPaymentApplied: new Map(),
    saleAdvanceApplied: new Map(), purchaseAdvanceApplied: new Map(),
    saleReturnReceivable: new Map(), purchaseReturnPayable: new Map(),
  };
  for (const event of customerEvents.sort(sortEvents)) {
    const state = customerState.get(event.partyId);
    if (!state) continue;
    if (event.kind === 'invoice') state.due = round2(state.due + event.amount);
    else if (event.kind === 'return') {
      const applied = round2(Math.min(state.due, event.amount));
      state.due = round2(state.due - applied); state.advance = round2(state.advance + event.amount - applied);
      result.saleReturnReceivable.set(event.id, applied);
    } else if (event.kind === 'payment') {
      const applied = round2(Math.min(state.due, event.amount));
      state.due = round2(state.due - applied); state.advance = round2(state.advance + event.amount - applied);
      result.customerPaymentApplied.set(event.id, applied);
    } else {
      const applied = round2(Math.min(state.due, state.advance, event.controlled ? event.amount : Number.POSITIVE_INFINITY));
      state.due = round2(state.due - applied); state.advance = round2(state.advance - applied);
      result.saleAdvanceApplied.set(event.id, applied);
    }
  }
  for (const event of vendorEvents.sort(sortEvents)) {
    const state = vendorState.get(event.partyId);
    if (!state) continue;
    if (event.kind === 'invoice') state.due = round2(state.due + event.amount);
    else if (event.kind === 'return') {
      const applied = round2(Math.min(state.due, event.amount));
      state.due = round2(state.due - applied); state.advance = round2(state.advance + event.amount - applied);
      result.purchaseReturnPayable.set(event.id, applied);
    } else if (event.kind === 'payment') {
      const applied = round2(Math.min(state.due, event.amount));
      state.due = round2(state.due - applied); state.advance = round2(state.advance + event.amount - applied);
      result.vendorPaymentApplied.set(event.id, applied);
    } else {
      const applied = round2(Math.min(state.due, state.advance, event.controlled ? event.amount : Number.POSITIVE_INFINITY));
      state.due = round2(state.due - applied); state.advance = round2(state.advance - applied);
      result.purchaseAdvanceApplied.set(event.id, applied);
    }
  }
  return result;
}

async function deriveJournalRows(from: string, to: string) {
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
    db.journalEntry.findMany({ where: { active: true, sourceType: { in: ['manual', 'houseExpense'] }, date: { gte: from, lte: to } }, include: { lines: { include: { account: true } } } }),
    db.chartAccount.findMany({ where: { moneyAccountId: { not: null } }, select: { moneyAccountId: true, name: true } }),
  ]);
  const linkedName = new Map(linkedCashAccounts.map(a => [a.moneyAccountId!, a.name]));
  const cashLedgerName = (a?: { id?: string; name: string; type: string } | null) => a?.id ? linkedName.get(a.id) ?? moneyAccountLedgerName(a) : moneyAccountLedgerName(a);
  const advancePostings = await computeAdvancePostings(to);
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
  for (const c of customers) {
    const amount = Math.abs(c.openingDue);
    if (c.openingDue >= 0) { add('0001-01-01', `OPEN-C-${c.id}`, 'Accounts receivable', 'Customer opening due', amount, 0); add('0001-01-01', `OPEN-C-${c.id}`, 'Owner equity', 'Customer opening due', 0, amount); }
    else { add('0001-01-01', `OPEN-C-${c.id}`, 'Owner equity', 'Customer opening advance', amount, 0); add('0001-01-01', `OPEN-C-${c.id}`, 'Customer credits', 'Customer opening advance', 0, amount); }
  }
  for (const v of vendors) {
    const amount = Math.abs(v.openingPayable);
    if (v.openingPayable >= 0) { add('0001-01-01', `OPEN-V-${v.id}`, 'Owner equity', 'Vendor opening payable', amount, 0); add('0001-01-01', `OPEN-V-${v.id}`, 'Accounts payable', 'Vendor opening payable', 0, amount); }
    else { add('0001-01-01', `OPEN-V-${v.id}`, 'Supplier advances', 'Supplier opening advance', amount, 0); add('0001-01-01', `OPEN-V-${v.id}`, 'Owner equity', 'Supplier opening advance', 0, amount); }
  }
  for (const s of stockAdjustments) {
    const isDebit = s.value >= 0; const amount = Math.abs(s.value); const counterpart = s.type === 'OPENING' ? 'Owner equity' : 'Inventory adjustments';
    const description = s.type === 'ADJUSTMENT' ? `Stock audit adjustment · ${s.refId ?? s.id}` : `${s.type.toLowerCase()} stock valuation`;
    add(s.date, s.refId ?? s.id, isDebit ? 'Inventory' : counterpart, description, isDebit ? amount : 0, isDebit ? 0 : amount);
    add(s.date, s.refId ?? s.id, isDebit ? counterpart : 'Inventory', description, isDebit ? 0 : amount, isDebit ? amount : 0);
  }
  for (const s of sales) {
    const ref = s.invoiceNo ?? s.id; const cogs = s.items.reduce((n, i) => n + i.cogs, 0);
    add(s.date, ref, 'Accounts receivable', 'Credit sale', s.total, 0);
    add(s.date, ref, 'Sales revenue', 'Sale', 0, s.total);
    const advanceApplied = advancePostings.saleAdvanceApplied.get(s.id) ?? 0;
    if (advanceApplied > 0) { add(s.date, ref, 'Customer credits', 'Apply customer advance to invoice', advanceApplied, 0); add(s.date, ref, 'Accounts receivable', 'Apply customer advance to invoice', 0, advanceApplied); }
    if (cogs) { add(s.date, ref, 'Cost of goods sold', 'AVCO cost at sale', cogs, 0); add(s.date, ref, 'Inventory', 'Stock issued', 0, cogs); }
  }
  for (const p of purchases) {
    const ref = p.invoiceNo ?? p.id;
    add(p.date, ref, 'Inventory', 'Purchase at invoice cost', p.total, 0);
    add(p.date, ref, 'Accounts payable', 'Purchase invoice', 0, p.total);
    const advanceApplied = advancePostings.purchaseAdvanceApplied.get(p.id) ?? 0;
    if (advanceApplied > 0) { add(p.date, ref, 'Accounts payable', 'Apply supplier advance to invoice', advanceApplied, 0); add(p.date, ref, 'Supplier advances', 'Apply supplier advance to invoice', 0, advanceApplied); }
  }
  for (const e of expenses) {
    const movement = payments.find(m => m.sourceType === 'expense' && m.sourceId === e.id);
    add(e.date, e.voucherNo ?? e.id, e.capitalized ? 'Inventory' : 'Operating expenses', e.capitalized ? 'Capitalized landed cost' : `Expense · ${e.category}`, e.amount, 0);
    add(e.date, e.voucherNo ?? e.id, cashLedgerName(movement?.moneyAccount ?? (movement ? { name: movement.method, type: movement.method } : null)), 'Expense paid', 0, e.amount);
  }
  for (const r of returns) {
    const ref = r.returnNo ?? r.id;
    const refundMovement = payments.find(m => m.sourceId === r.id && m.sourceType === (r.kind === 'sale' ? 'saleReturn' : 'purchaseReturn'));
    const refundAccount = cashLedgerName(refundMovement?.moneyAccount ?? (refundMovement ? { name: refundMovement.method, type: refundMovement.method } : null));
    if (r.kind === 'sale') {
      const refund = Math.min(r.totalAmount, r.refundAmount);
      add(r.date, ref, 'Sales returns', 'Sales return / credit', r.totalAmount, 0);
      if (refund) add(r.date, ref, refundAccount, 'Customer refund', 0, refund);
      const netCredit = r.totalAmount - refund;
      const receivableCredit = advancePostings.saleReturnReceivable.get(r.id) ?? netCredit;
      if (receivableCredit > 0) add(r.date, ref, 'Accounts receivable', 'Customer credit', 0, receivableCredit);
      if (netCredit - receivableCredit > 0) add(r.date, ref, 'Customer credits', 'Customer return credit', 0, netCredit - receivableCredit);
      const stockCost = r.items.reduce((n, i) => n + i.cogs, 0);
      if (stockCost) { add(r.date, ref, 'Inventory', 'Returned goods at original AVCO', stockCost, 0); add(r.date, ref, 'Cost of goods sold', 'Reverse returned goods cost', 0, stockCost); }
    } else {
      const refund = Math.min(r.totalAmount, r.refundAmount);
      const netCredit = r.totalAmount - refund;
      const payableDebit = advancePostings.purchaseReturnPayable.get(r.id) ?? netCredit;
      if (payableDebit > 0) add(r.date, ref, 'Accounts payable', 'Purchase return credit', payableDebit, 0);
      if (netCredit - payableDebit > 0) add(r.date, ref, 'Supplier advances', 'Supplier return credit', netCredit - payableDebit, 0);
      if (refund) add(r.date, ref, refundAccount, 'Supplier refund', refund, 0);
      add(r.date, ref, 'Inventory', 'Purchase return', 0, r.totalAmount);
    }
  }
  for (const m of payments) {
    const ref = m.sourceId;
    const cashAccount = cashLedgerName(m.moneyAccount ?? { name: m.method, type: m.method });
    if (m.sourceType === 'sale') { add(m.date, ref, cashAccount, 'Sale receipt', m.amount, 0); add(m.date, ref, 'Accounts receivable', 'Receipt applied', 0, m.amount); }
    else if (m.sourceType === 'purchase') { add(m.date, ref, 'Accounts payable', 'Supplier payment', m.amount, 0); add(m.date, ref, cashAccount, 'Purchase payment', 0, m.amount); }
    else if (m.sourceType === 'customerPayment') {
      const applied = advancePostings.customerPaymentApplied.get(m.sourceId) ?? m.amount;
      add(m.date, ref, cashAccount, 'Customer receipt', m.amount, 0);
      if (applied > 0) add(m.date, ref, 'Accounts receivable', 'Customer receipt applied', 0, applied);
      if (m.amount - applied > 0) add(m.date, ref, 'Customer credits', 'Customer advance received', 0, m.amount - applied);
    }
    else if (m.sourceType === 'vendorPayment') {
      const applied = advancePostings.vendorPaymentApplied.get(m.sourceId) ?? m.amount;
      if (applied > 0) add(m.date, ref, 'Accounts payable', 'Vendor payment', applied, 0);
      if (m.amount - applied > 0) add(m.date, ref, 'Supplier advances', 'Supplier advance paid', m.amount - applied, 0);
      add(m.date, ref, cashAccount, 'Vendor payment', 0, m.amount);
    }
    else if (m.sourceType === 'expense') continue; // expense document posts the matching cash line below
    else if (m.sourceType === 'saleReturn' || m.sourceType === 'purchaseReturn') continue; // return document owns the posting
    else if (m.sourceType === 'transferOut') add(m.date, ref, cashAccount, 'Account transfer out', 0, m.amount);
    else if (m.sourceType === 'transferIn') add(m.date, ref, cashAccount, 'Account transfer in', m.amount, 0);
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
  const chartRows = await db.chartAccount.findMany();
  const chartById = new Map(chartRows.map(account => [account.id, account]));
  const chartByName = new Map(chartRows.map(account => [account.name, account]));
  const chartByCode = new Map(chartRows.map(account => [account.code, account]));
  for (const row of rows) {
    const account = chartById.get(row.accountId ?? '') ?? chartByName.get(row.account) ?? chartByCode.get(ledgerAccountCode(row.account));
    if (account) { row.accountId = account.id; row.account = account.name; }
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

/** Materialize transaction-generated entries beside manual journals. Source
 * records remain authoritative; stable source keys make refreshes idempotent.
 */
export async function reconcileAutomaticJournalEntries() {
  await seedChart();
  const rows = await deriveJournalRows('0001-01-01', '9999-12-31');
  const grouped = new Map<string, typeof rows>();
  for (const row of rows) {
    if (row.entryId) continue;
    const key = `${row.date}|${row.reference}`;
    grouped.set(key, [...(grouped.get(key) ?? []), row]);
  }
  const chart = await db.chartAccount.findMany();
  const byName = new Map(chart.map(account => [account.name, account]));
  const byCode = new Map(chart.map(account => [account.code, account]));
  const entries = [...grouped.entries()];
  const activeKeys = entries.map(([key]) => key);
  await db.$transaction(async t => {
    await t.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('chalarot-auto-journal-reconcile'))`;
    const existingEntries = await t.journalEntry.findMany({ where: { sourceType: 'automatic' }, select: { id: true, entryNo: true, sourceId: true } });
    const existingBySource = new Map(existingEntries.map(entry => [entry.sourceId, entry]));
    for (const [sourceId, lines] of entries) {
      const debit = lines.reduce((sum, line) => sum + Math.round(line.debit * 100), 0);
      const credit = lines.reduce((sum, line) => sum + Math.round(line.credit * 100), 0);
      if (debit <= 0 || debit !== credit) throw new Error(`Automatic journal is unbalanced: ${sourceId}`);
      const journalLines = lines.map(line => {
        const account = byName.get(line.account) ?? byCode.get(ledgerAccountCode(line.account));
        if (!account) throw new Error(`No chart account is mapped for ${line.account}`);
        return { accountId: account.id, description: line.description, debit: line.debit, credit: line.credit };
      });
      const first = lines[0];
      const data = { date: first.date, memo: `Automatic posting · ${first.reference}`, sourceType: 'automatic', sourceId, sourceRef: first.reference, active: true };
      const current = existingBySource.get(sourceId);
      if (current) {
        await t.journalLine.deleteMany({ where: { entryId: current.id } });
        await t.journalEntry.update({ where: { id: current.id }, data: { ...data, lines: { create: journalLines } } });
      } else {
        const entryNo = `AUTO-${first.date.replace(/-/g, '')}-${randomUUID().slice(0, 8).toUpperCase()}`;
        await t.journalEntry.create({ data: { ...data, entryNo, lines: { create: journalLines } } });
      }
    }
    await t.journalEntry.updateMany({
      where: { sourceType: 'automatic', active: true, ...(activeKeys.length ? { sourceId: { notIn: activeKeys } } : {}) },
      data: { active: false },
    });
  }, { maxWait: 10_000, timeout: 120_000 });
}

/** Reports read the saved journal records, so automatic and manual postings
 * share the same ledger source after reconciliation.
 */
async function buildJournalRows(from: string, to: string) {
  const entries = await db.journalEntry.findMany({
    where: { active: true, date: { gte: from, lte: to } },
    include: { lines: { include: { account: true } } },
    orderBy: [{ date: 'asc' }, { entryNo: 'asc' }],
  });
  return entries.flatMap(entry => entry.lines.map((line, index) => ({
    date: entry.date,
    reference: entry.sourceRef ?? entry.entryNo,
    account: line.account.name,
    accountId: line.accountId,
    description: `${entry.memo}${line.description ? ` · ${line.description}` : ''}`,
    debit: +line.debit.toFixed(2),
    credit: +line.credit.toFixed(2),
    journalNo: entry.entryNo,
    sequence: index + 1,
    entryId: entry.id,
    editable: entry.sourceType === 'manual',
    sourceType: entry.sourceType,
    sourceId: entry.sourceId,
    sourceRef: entry.sourceRef,
  })));
}

reports.get('/journal-entries', async (req: Request, res: Response) => {
  const from = typeof req.query.from === 'string' ? req.query.from : '0001-01-01';
  const to = typeof req.query.to === 'string' ? req.query.to : todayStr();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) return res.status(400).json({ error: 'Valid from and to dates are required' });
  await reconcileAutomaticJournalEntries();
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
  await reconcileAutomaticJournalEntries();
  const [allRows, chartAccounts] = await Promise.all([
    buildJournalRows('0001-01-01', to),
    db.chartAccount.findMany({ orderBy: [{ code: 'asc' }] }),
  ]);
  const accounts = new Map<string, { account: string; code: string; openingBalance: number; periodDebit: number; periodCredit: number; closingBalance: number; netBalance: number; balanceSide: 'Dr' | 'Cr'; rows: (typeof allRows[number] & { runningBalance: number })[] }>();
  for (const row of allRows) {
    const chart = chartAccounts.find(candidate => candidate.id === row.accountId || candidate.name === row.account)
      ?? chartAccounts.find(candidate => candidate.code === ledgerAccountCode(row.account));
    const accountName = chart?.name ?? row.account;
    let account = accounts.get(accountName);
    if (!account) {
      account = { account: accountName, code: chart?.code ?? ledgerAccountCode(row.account), openingBalance: 0, periodDebit: 0, periodCredit: 0, closingBalance: 0, netBalance: 0, balanceSide: 'Dr', rows: [] };
      accounts.set(accountName, account);
    }
    account.closingBalance += row.debit - row.credit;
    if (row.date < from) account.openingBalance += row.debit - row.credit;
    else { account.rows.push({ ...row, account: accountName, accountId: chart?.id ?? row.accountId, runningBalance: +account.closingBalance.toFixed(2) }); account.periodDebit += row.debit; account.periodCredit += row.credit; }
  }
  for (const account of accounts.values()) { account.netBalance = +Math.abs(account.closingBalance).toFixed(2); account.balanceSide = account.closingBalance < 0 ? 'Cr' : 'Dr'; }
  const list = [...accounts.values()]
    .filter(account => Math.abs(account.openingBalance) >= 0.01 || account.periodDebit >= 0.01 || account.periodCredit >= 0.01)
    .sort((a, b) => a.code.localeCompare(b.code) || a.account.localeCompare(b.account));
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
    db.journalLine.findMany({ where: { entry: { active: true, sourceType: 'manual', date: { lte: to } }, account: { moneyAccountId: { not: null } } }, include: { entry: { select: { date: true } }, account: { select: { moneyAccountId: true } } } }),
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
  const otherOutflows = amount(['withdrawal', 'houseExpense', 'openingAdjust'], 'out') + Math.max(0, -journalCashDeltaPeriod);
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
    const [cs, sales, pays, returns] = await Promise.all([
      db.customer.findMany({ where: { deletedAt: null } }), db.sale.findMany(), db.customerPayment.findMany({ where: { active: true } }),
      db.productReturn.findMany({ where: { kind: 'sale' } }),
    ]);
    const byCust = (id: string) =>
      Math.max(0, (cs.find(c => c.id === id)?.openingDue ?? 0) +
      sales.filter(s => s.customerId === id).reduce((s, x) => s + x.total, 0) -
      pays.filter(p => p.customerId === id && !p.returnId).reduce((s, x) => s + x.amount, 0) -
      returns.filter(r => r.customerId === id).reduce((s, x) => s + x.totalAmount, 0) +
      returns.filter(r => r.customerId === id).reduce((s, x) => s + x.refundAmount, 0));
    return cs.reduce((s, c) => s + byCust(c.id), 0);
  }
  const [vs, purs, pays, returns] = await Promise.all([
      db.vendor.findMany({ where: { deletedAt: null } }), db.purchase.findMany(), db.vendorPayment.findMany({ where: { active: true } }),
      db.productReturn.findMany({ where: { kind: 'purchase' } }),
  ]);
  const byVend = (id: string) =>
    Math.max(0, (vs.find(v => v.id === id)?.openingPayable ?? 0) +
    purs.filter(p => p.vendorId === id).reduce((s, x) => s + x.total, 0) -
    pays.filter(p => p.vendorId === id && !p.returnId).reduce((s, x) => s + x.amount, 0) -
    returns.filter(r => r.vendorId === id).reduce((s, x) => s + x.totalAmount, 0) +
    returns.filter(r => r.vendorId === id).reduce((s, x) => s + x.refundAmount, 0));
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
    ? await db.productReturn.findMany({ where: { saleId: { in: ids } }, select: { saleId: true, totalAmount: true, settlement: true, refundAmount: true } })
    : [];
  // Per-invoice paid/due/status derived from the canonical settlement. The sum
  // of derived paid already covers every collection (dedicated + FIFO +
  // return credits), so it is used directly — never added to collections.
  const st = buildSettlement(
    sales.map(s => ({ id: s.id, partyId: c.id, date: s.date, total: s.total, createdAt: s.createdAt })),
    saleRets.map(r => ({ invoiceId: r.saleId, amount: r.totalAmount, settlement: r.settlement as 'credit' | 'refund', refundAmount: r.refundAmount })),
    allPays.map(p => ({ partyId: c.id, invoiceId: p.saleId, returnId: p.returnId, date: p.date, amount: p.amount, createdAt: p.createdAt })),
  );
  const pays = allPays.filter(p => !p.saleId);
  const saleTotal = sales.reduce((s, x) => s + x.total - saleRets.filter(r => r.saleId === x.id).reduce((total, r) => total + r.totalAmount, 0), 0);
  const salePaid = allPays.filter(p => !p.returnId).reduce((sum, payment) => sum + payment.amount, 0);
  const saleRefunds = saleRets.reduce((sum, ret) => sum + ret.refundAmount, 0);
  res.json({
    party: { id: c.id, name: c.name, mobile: c.mobile, opening: c.openingDue, next: c.nextDate ?? undefined },
    opening: c.openingDue,
    sales: sales.map(s => {
      const sst = st.get(s.id);
      return {
        id: s.id, invoiceNo: s.invoiceNo ?? undefined, date: s.date, total: Math.max(0, s.total - saleRets.filter(r => r.saleId === s.id).reduce((total, r) => total + r.totalAmount, 0)),
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
    balance: Math.round((c.openingDue + saleTotal + saleRefunds - salePaid) * 100) / 100,
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
    ? await db.productReturn.findMany({ where: { purchaseId: { in: pids } }, select: { purchaseId: true, totalAmount: true, settlement: true, refundAmount: true } })
    : [];
  // Canonical per-invoice settlement; its paid sum already covers every
  // payment (dedicated + FIFO + return credits).
  const st = buildSettlement(
    purs.map(p => ({ id: p.id, partyId: v.id, date: p.date, total: p.total, createdAt: p.createdAt })),
    purRets.map(r => ({ invoiceId: r.purchaseId, amount: r.totalAmount, settlement: r.settlement as 'credit' | 'refund', refundAmount: r.refundAmount })),
    allPays.map(p => ({ partyId: v.id, invoiceId: p.purchaseId, returnId: p.returnId, date: p.date, amount: p.amount, createdAt: p.createdAt })),
  );
  const pays = allPays.filter(p => !p.purchaseId);
  const purTotal = purs.reduce((s, x) => s + x.total - purRets.filter(r => r.purchaseId === x.id).reduce((total, r) => total + r.totalAmount, 0), 0);
  const purPaid = allPays.filter(p => !p.returnId).reduce((sum, payment) => sum + payment.amount, 0);
  const purRefunds = purRets.reduce((sum, ret) => sum + ret.refundAmount, 0);
  res.json({
    party: { id: v.id, name: v.name, mobile: v.mobile, opening: v.openingPayable, next: v.nextDate ?? undefined },
    opening: v.openingPayable,
    purchases: purs.map(p => {
      const pst = st.get(p.id);
      return {
        id: p.id, invoiceNo: p.invoiceNo ?? undefined, date: p.date, total: Math.max(0, p.total - purRets.filter(r => r.purchaseId === p.id).reduce((total, r) => total + r.totalAmount, 0)),
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
    balance: Math.round((v.openingPayable + purTotal + purRefunds - purPaid) * 100) / 100,
  });
});
// GET /api/accounts/receivables — customers with balance > 0
reports.get('/accounts/receivables', async (_req: Request, res: Response) => {
  const [cs, sales, pays, returns] = await Promise.all([
    db.customer.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.sale.findMany(), db.customerPayment.findMany({ where: { active: true } }), db.productReturn.findMany({ where: { kind: 'sale' } }),
  ]);
  res.json(cs
    .map(c => ({
      id: c.id, name: c.name, mobile: c.mobile,
      balance: c.openingDue + sales.filter(s => s.customerId === c.id).reduce((s, x) => s + x.total, 0)
        - pays.filter(p => p.customerId === c.id && !p.returnId).reduce((s, x) => s + x.amount, 0)
        - returns.filter(r => r.customerId === c.id).reduce((s, x) => s + x.totalAmount, 0)
        + returns.filter(r => r.customerId === c.id).reduce((s, x) => s + x.refundAmount, 0),
      next: c.nextDate ?? undefined,
    }))
    .filter(x => x.balance > 0));
});

// GET /api/accounts/payables — vendors with balance > 0
reports.get('/accounts/payables', async (_req: Request, res: Response) => {
  const [vs, purs, pays, returns] = await Promise.all([
    db.vendor.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } }),
    db.purchase.findMany(), db.vendorPayment.findMany({ where: { active: true } }), db.productReturn.findMany({ where: { kind: 'purchase' } }),
  ]);
  res.json(vs
    .map(v => ({
      id: v.id, name: v.name, mobile: v.mobile,
      balance: v.openingPayable + purs.filter(p => p.vendorId === v.id).reduce((s, x) => s + x.total, 0)
        - pays.filter(p => p.vendorId === v.id && !p.returnId).reduce((s, x) => s + x.amount, 0)
        - returns.filter(r => r.vendorId === v.id).reduce((s, x) => s + x.totalAmount, 0)
        + returns.filter(r => r.vendorId === v.id).reduce((s, x) => s + x.refundAmount, 0),
      next: v.nextDate ?? undefined,
    }))
    .filter(x => x.balance > 0));
});
