import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { Lang, Key, tr } from './i18n';
import { api, Expense, MoneyAccountRow, MoneyBalance, MoneyMethod, MoneyTransfer, PeriodFinance, SettlementStatus } from './api';

export type { MoneyAccountRow, MoneyBalance, MoneyMethod, MoneyTransfer, PeriodFinance };

export type Product = { id: string; name: string; cost: number; price: number; opening: number; qty: number; uom: string; smallBagKg: number; mediumBagKg: number; largeBagKg: number; damagedQty?: number };
export const UOMS = ['kg', 'বস্তা', 'ton', 'pcs'];
export const uomLabel = (uom: string | undefined, kgLabel: string) => (!uom || uom === 'kg' ? kgLabel : uom);
export type Party = { id: string; name: string; mobile: string; address?: string; opening: number; next?: string };
export type Tx = { id: string; partyId: string; kind: 'sale' | 'purchase' | 'payment' | 'sreturn' | 'preturn'; amount: number; date: string; note?: string; ref?: string; method?: string; returnId?: string; returnId2?: never; createdAt?: string; saleId?: string; purchaseId?: string; account?: string };
export type Line = { productId: string; qty: number; rate: number };
export type SaleLineIn = { productId: string; unit: string; enteredQty: number; rate: number; unitCost?: number };
export type PurchaseLineIn = { productId: string; unit: string; enteredQty: number; rate: number };
export type StockTx = { id: string; productId: string; productName?: string; type: 'OPENING' | 'PURCHASE' | 'SALE' | 'ADJUSTMENT'; qty: number; date: string };
export type SaleRec = { id: string; date: string; profit: number; total: number; customerId?: string; invoiceNo?: string; paid: number; due: number; status: SettlementStatus; cogs: number; createdAt?: string };
/** Completed purchase, straight from the bootstrap payload (no extra request). */
export type PurchaseRec = { id: string; vendorId: string; date: string; total: number; paid: number; due: number; status: SettlementStatus; invoiceNo?: string };

export const today = () => new Date().toISOString().slice(0, 10);

// Service interface is unchanged in shape; implementations now persist via REST.
export interface Service {
  saveProduct(p: Product): Promise<void>; deleteProduct(id: string): Promise<void>;
  saveParty(kind: 'c' | 'v', p: Party): Promise<void>; deleteParty(kind: 'c' | 'v', id: string): Promise<void>;
  sale(a: { customerId?: string; lines: SaleLineIn[]; discount: number; paid: number; accountId?: string; next?: string }): Promise<{ id: string; invoiceNo?: string; total: number }>;
  purchase(a: { vendorId: string; lines: PurchaseLineIn[]; paid: number; accountId?: string; next?: string }): Promise<{ id: string; invoiceNo?: string; total: number }>;
  money(kind: 'c' | 'v', a: { partyId: string; amount: number; accountId: string; date: string; note?: string; next?: string }): Promise<void>;
  saveExpense(e: { id?: string; category: string; customName?: string; amount: number; accountId: string; date: string; note?: string }): Promise<void>;
  deleteExpense(id: string): Promise<void>;
  saveReturn(a: { kind: 'sale' | 'purchase'; saleId?: string; purchaseId?: string; lines: object[]; settlement: 'credit' | 'refund'; accountId?: string; date?: string; note?: string }): Promise<{ id: string; returnNo?: string; totalAmount: number }>;
  saveAccount(a: Partial<MoneyAccountRow> & { id?: string }): Promise<void>;
  setAccountOpening(id: string, openingBalance: number): Promise<void>;
  deleteAccount(id: string): Promise<void>;
  loadFinance(mode: 'day' | 'month' | 'year' | 'all' | 'range', from?: string, to?: string): Promise<PeriodFinance>;
  transferMoney(a: { fromId: string; toId: string; amount: number; date?: string; note?: string }): Promise<MoneyTransfer>;
}

export type ReturnSum = { id: string; kind: 'sale' | 'purchase'; date: string; amount: number; profit: number; returnNo?: string };

type Ctx = Service & {
  lang: Lang; setLang: (l: Lang) => void; t: (k: Key) => string;
  ready: boolean; loadError: string | null; retry: () => void;
  products: Product[]; customers: Party[]; vendors: Party[]; cTx: Tx[]; vTx: Tx[]; stockTx: StockTx[]; sales: SaleRec[]; purchases: PurchaseRec[]; expenses: Expense[]; returns: ReturnSum[];
  moneyBalances: MoneyBalance[];
  /** Canonical money accounts (Bank & Cash). Balance is derived, never stored twice. */
  moneyAccounts: MoneyAccountRow[];
  moneyTransfers: MoneyTransfer[];
  /** Canonical financial figures. Nothing in the UI recomputes profit. */
  financeToday: PeriodFinance | null;
  financeLifetime: PeriodFinance | null;
  financePeriod: PeriodFinance | null;
  bal: (kind: 'c' | 'v', id: string) => { balance: number; total: number; paid: number };
  stats: () => { todaySale: number; todayCollect: number; todayPurchase: number; todayProfit: number; todayDue: number; todayExpense: number; totalSale: number; totalPurchase: number; totalProfit: number; due: number; payable: number };
};
const C = createContext<Ctx>(null as any);
export const useApp = () => useContext(C);

export function AppProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>('bn');
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);
  const [vendors, setVendors] = useState<Party[]>([]);
  const [cTx, setCTx] = useState<Tx[]>([]);
  const [vTx, setVTx] = useState<Tx[]>([]);
  const [stockTx, setStockTx] = useState<StockTx[]>([]);
  const [sales, setSales] = useState<SaleRec[]>([]);
  const [purchases, setPurchases] = useState<PurchaseRec[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [returns, setReturns] = useState<ReturnSum[]>([]);
  const [money, setMoney] = useState<MoneyBalance[]>([]);
  const [accounts, setAccounts] = useState<MoneyAccountRow[]>([]);
  const [transfers, setTransfers] = useState<MoneyTransfer[]>([]);
  const [financeToday, setFinanceToday] = useState<PeriodFinance | null>(null);
  const [financeLifetime, setFinanceLifetime] = useState<PeriodFinance | null>(null);
  const [financePeriod, setFinancePeriod] = useState<PeriodFinance | null>(null);

  const refresh = useCallback(async () => {
    const b = await api.bootstrap();
    setProducts(b.products);
    setCustomers(b.customers);
    setVendors(b.vendors);
    const ctx: Tx[] = [
      ...b.sales.map(s => ({ id: s.id, partyId: s.customerId ?? 'cash', kind: 'sale' as const, amount: s.total, date: s.date, ref: s.invoiceNo })),
      ...b.customerPayments.map(p => p.returnId
        ? ({ id: p.id, partyId: p.customerId, kind: 'sreturn' as const, amount: p.amount, date: p.date, note: p.note, createdAt: p.createdAt, ref: p.returnNo, returnId: p.returnId })
        : ({ id: p.id, partyId: p.customerId, kind: 'payment' as const, amount: p.amount, date: p.date, note: p.note, method: p.method as MoneyMethod | undefined, account: p.accountName, createdAt: p.createdAt, saleId: p.saleId })),
    ];
    const vtx: Tx[] = [
      ...b.purchases.map(p => ({ id: p.id, partyId: p.vendorId, kind: 'purchase' as const, amount: p.total, date: p.date, ref: p.invoiceNo })),
      ...b.vendorPayments.map(p => p.returnId
        ? ({ id: p.id, partyId: p.vendorId, kind: 'preturn' as const, amount: p.amount, date: p.date, note: p.note, createdAt: p.createdAt, ref: p.returnNo, returnId: p.returnId })
        : ({ id: p.id, partyId: p.vendorId, kind: 'payment' as const, amount: p.amount, date: p.date, note: p.note, account: p.accountName, createdAt: p.createdAt, purchaseId: p.purchaseId })),
    ];
    setCTx(ctx);
    setVTx(vtx);
    setStockTx(b.movements.map(mv => ({ id: mv.id, productId: mv.productId, productName: mv.productName, type: mv.type as StockTx['type'], qty: mv.qty, date: mv.date })));
    setSales(b.sales.map(s => ({ id: s.id, date: s.date, total: s.total, profit: s.profit, cogs: s.cogs ?? 0, customerId: s.customerId, invoiceNo: s.invoiceNo, paid: s.paid, due: s.due, status: s.status ?? (s.due > 0 ? 'due' : 'paid'), createdAt: s.createdAt })));
    // Purchases were already fetched by /bootstrap; keep the saved fields so the
    // Purchase module can list its own records without another request.
    setPurchases(b.purchases.map(p => ({ id: p.id, vendorId: p.vendorId, date: p.date, total: p.total, paid: p.paid, due: p.due, status: p.status ?? (p.due > 0 ? 'due' : 'paid'), invoiceNo: p.invoiceNo })));
    setExpenses(b.expenses);
    setReturns(b.returns);
    setMoney(b.money ?? []);
    setAccounts(b.moneyAccounts ?? []);
    setTransfers(b.transfers ?? []);
    setFinanceToday(b.finance?.today ?? null);
    setFinanceLifetime(b.finance?.lifetime ?? null);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      await refresh();
      setReady(true);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Load failed');
    }
  }, [refresh]);

  useEffect(() => { load(); }, [load]);

  // Stable translator identity: memoized components (e.g. the POS product grid)
  // use `t` in their callback deps, so it must not change on every store render.
  const t = useCallback((k: Key) => tr(lang, k), [lang]);

  const svc: Service = {
    saveProduct: async p => {
      const body = { name: p.name, cost: p.cost, price: p.price, opening: p.opening, smallBagKg: p.smallBagKg, mediumBagKg: p.mediumBagKg, largeBagKg: p.largeBagKg };
      const cur = products.find(x => x.id === p.id);
      const r = cur ? await api.updateProduct(p.id, body) : await api.createProduct(body);
      // Changing only the sale price (or name/bag weights) touches nothing that
      // other screens derive, so patch this single product locally instead of
      // refetching the whole product list. A cost or opening change revalues
      // stock, so that path still refreshes everything.
      const valuationTouched = !cur || p.cost !== cur.cost || p.opening !== cur.opening;
      if (!valuationTouched && r.product) {
        setProducts(list => list.map(x => (x.id === r.product!.id ? { ...x, ...r.product } : x)));
        return;
      }
      await refresh();
    },
    deleteProduct: async id => { await api.deleteProduct(id); await refresh(); },
    saveParty: async (k, p) => {
      const body = { name: p.name, mobile: p.mobile, address: p.address, opening: p.opening, next: p.next };
      const list = k === 'c' ? customers : vendors;
      if (list.some(x => x.id === p.id)) await api.updateParty(k, p.id, body);
      else await api.createParty(k, body);
      await refresh();
    },
    deleteParty: async (k, id) => { await api.deleteParty(k, id); await refresh(); },
    sale: async ({ customerId, lines, discount, paid, accountId, next }) => {
      const r = await api.createSale({ customerId, lines, discount, paid, accountId, next });
      await refresh();
      return r;
    },
    purchase: async ({ vendorId, lines, paid, accountId, next }) => {
      const r = await api.createPurchase({ vendorId, lines, paid, accountId, next });
      await refresh();
      return r;
    },
    money: async (k, a) => {
      if (k === 'c') await api.customerPayment({ customerId: a.partyId, amount: a.amount, accountId: a.accountId, date: a.date, note: a.note, next: a.next });
      else await api.vendorPayment({ vendorId: a.partyId, amount: a.amount, accountId: a.accountId, date: a.date, note: a.note, next: a.next });
      await refresh();
    },
    saveExpense: async e => {
      const body = { category: e.category, customName: e.customName, amount: e.amount, accountId: e.accountId, date: e.date, note: e.note };
      if (e.id && expenses.some(x => x.id === e.id)) await api.updateExpense(e.id, body);
      else await api.createExpense(body);
      await refresh();
    },
    deleteExpense: async id => { await api.deleteExpense(id); await refresh(); },
    saveReturn: async a => {
      const r = await api.createReturn(a);
      await refresh();
      return r;
    },
    saveAccount: async a => {
      if (a.id && accounts.some(x => x.id === a.id)) await api.updateMoneyAccount(a.id, a);
      else await api.createMoneyAccount(a);
      await refresh();
    },
    setAccountOpening: async (id, openingBalance) => {
      await api.setAccountOpening(id, openingBalance);
      await refresh();
    },
    deleteAccount: async id => {
      await api.deleteMoneyAccount(id);
      await refresh();
    },
    transferMoney: async a => {
      const r = await api.createMoneyTransfer(a);
      await refresh();
      return r;
    },
    loadFinance: async (mode, from, to) => {
      const f = await api.finance(mode, from, to);
      setFinancePeriod(f);
      return f;
    },
  };

  const bal: Ctx['bal'] = (k, id) => {
    const party = (k === 'c' ? customers : vendors).find(p => p.id === id);
    const tx = (k === 'c' ? cTx : vTx).filter(x => x.partyId === id);
    const total = tx.filter(x => x.kind === 'sale' || x.kind === 'purchase').reduce((s, x) => s + x.amount, 0);
    const paid = tx.filter(x => x.kind === 'payment' || x.kind === 'sreturn' || x.kind === 'preturn').reduce((s, x) => s + x.amount, 0);
    return { balance: (party?.opening ?? 0) + total - paid, total, paid };
  };
  /**
   * Home KPIs. Every sales/profit figure comes from the canonical backend
   * service; only money collection and party balances are computed locally.
   */
  const stats: Ctx['stats'] = () => {
    const td = today(), sum = (a: { amount: number }[]) => a.reduce((s, x) => s + x.amount, 0);
    const todayCollect = sum(cTx.filter(x => x.kind === 'payment' && x.date === td));
    const d = financeToday;
    const life = financeLifetime;
    const todaySale = d?.netSales ?? 0;
    return {
      todaySale,
      todayProfit: d?.netProfit ?? 0,
      todayCollect,
      todayDue: Math.max(0, todaySale - todayCollect),
      todayPurchase: d?.netPurchase ?? 0,
      todayExpense: d?.expense ?? 0,
      totalSale: life?.netSales ?? 0,
      totalProfit: life?.netProfit ?? 0,
      totalPurchase: life?.netPurchase ?? 0,
      due: customers.reduce((s, c) => s + bal('c', c.id).balance, 0),
      payable: vendors.reduce((s, v) => s + bal('v', v.id).balance, 0),
    };
  };
  return <C.Provider value={{ ...svc, lang, setLang, t, ready, loadError, retry: load, products, customers, vendors, cTx, vTx, stockTx, sales, purchases, expenses, returns, moneyBalances: money, moneyTransfers: transfers, moneyAccounts: accounts, financeToday, financeLifetime, financePeriod, bal, stats }}>{children}</C.Provider>;
}
