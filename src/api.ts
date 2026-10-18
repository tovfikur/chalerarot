// REST client for the chalarot-api backend.
// Base URL comes from EXPO_PUBLIC_API_URL (see .env.example).
const BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export class ApiError extends Error {
  code?: string;
  amount?: number;
  constructor(message: string, code?: string, amount?: number) {
    super(message);
    this.code = code;
    this.amount = amount;
  }
}

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  let r: Response;
  try {
    r = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (e) {
    throw new Error('Cannot reach server');
  }
  const data = (await r.json().catch(() => ({}))) as { error?: string; code?: string; amount?: number };
  if (!r.ok) throw new ApiError(data?.error ?? `Request failed (${r.status})`, data?.code, data?.amount);
  return data as T;
}

export type IdRes = { id: string };
/** Product create/update response: the saved row (already mapped for the app). */
export type ProductRes = { id: string; product: {
  id: string; name: string; cost: number; price: number; opening: number; qty: number;
  damagedQty: number; uom: string; stockValue: number; damagedValue: number;
  openingUnitCost: number; openingValue: number;
  smallBagKg: number; mediumBagKg: number; largeBagKg: number;
} };

export type TxnResult = { id: string; invoiceNo?: string; total: number };

/** Canonical per-invoice settlement status, derived by the backend. */
export type SettlementStatus = 'paid' | 'partial' | 'due';

export type TxnItem = {
  productName: string; unit: string; enteredQty: number; qtyKg: number; rate: number;
};
/** Payment account recorded on the ledger row when the document was saved. */
export type TxnPayment = { accountName: string | null; method: string; amount: number; date: string } | null;
export type SaleDetail = {
  id: string; invoiceNo?: string; date: string; createdAt: string; discount: number;
  total: number; paid: number; due: number; status?: SettlementStatus; nextDate?: string;
  customer: { name: string; mobile: string } | null; items: TxnItem[];
  payment?: TxnPayment;
};
export type PurchaseDetail = {
  id: string; invoiceNo?: string; date: string; createdAt: string;
  total: number; paid: number; due: number; status?: SettlementStatus; nextDate?: string;
  vendor: { name: string; mobile: string }; items: TxnItem[];
  payment?: TxnPayment;
};

// Stable internal payment method values. Never store translated labels.
export type MoneyMethod = 'cash' | 'bkash' | 'nagad' | 'bank';

export type Expense = {
  id: string; category: string; customName?: string;
  amount: number; date: string; note?: string; method?: MoneyMethod; accountId?: string;
};

export const MONEY_METHODS: MoneyMethod[] = ['cash', 'bkash', 'nagad', 'bank'];

export type MoneyBalance = {
  method: MoneyMethod; opening: number; balance: number; todayIn: number; todayOut: number;
};

/** A real money account the shop owns (Main Cash, BRAC Bank, bKash Merchant...). */
export type AccountType = 'cash' | 'bank' | 'bkash' | 'nagad' | 'rocket';

export type MoneyAccountRow = {
  id: string; name: string; type: AccountType;
  openingBalance: number; openingDate?: string;
  bankName?: string; accountNumber?: string; branch?: string; mobileNumber?: string; note?: string;
  active: boolean;
  /** Backend-computed financial history; drives whether Delete is offered. */
  movementCount?: number; transferCount?: number; hasHistory?: boolean;
  balance: number; todayIn: number; todayOut: number;
};

export type MoneyAccountList = { accounts: MoneyAccountRow[]; totalMoney: number };

export type MoneyAccountMovement = {
  id: string; date: string; direction: 'in' | 'out'; amount: number;
  sourceType: string; sourceId: string; note?: string; transferNo?: string;
  counterpartyAccountId?: string; active: boolean; balance: number;
};

export type MoneyAccountDetail = { account: MoneyAccountRow; movements: MoneyAccountMovement[] };

/**
 * Canonical financial breakdown for a period. Produced by ONE backend service
 * (src/finance.ts) so Home and Accounts can never disagree.
 */
export type PeriodFinance = {
  mode: 'day' | 'month' | 'year' | 'all' | 'range';
  start: string; end: string;
  sales: number; salesReturn: number; netSales: number;
  openingStockValue: number; openingStockCarryIn: number; openingStockAdded: number;
  purchase: number; purchaseReturn: number; netPurchase: number;
  closingStockValue: number; damagedStockValue: number;
  cogs: number; grossProfit: number; expense: number; netProfit: number;
};

/** One money transfer = one business event (its two movements stay linked). */
export type MoneyTransfer = {
  id: string; transferNo: string;
  /** Concrete accounts the money moved between. */
  fromId: string; toId: string;
  /** Resolved names (fallback to the legacy type for old rows). */
  from: string; to: string;
  amount: number; date: string; note?: string; createdAt?: string;
};

export const api = {
  bootstrap: () => req<{
    products: import('./store').Product[];
    customers: import('./store').Party[];
    vendors: import('./store').Party[];
    sales: { id: string; customerId?: string; date: string; total: number; paid: number; due: number; status: SettlementStatus; profit: number; cogs: number; invoiceNo?: string; createdAt?: string }[];
    purchases: { id: string; vendorId: string; date: string; total: number; paid: number; due: number; status: SettlementStatus; invoiceNo?: string }[];
    customerPayments: { id: string; customerId: string; amount: number; date: string; note?: string; method?: string; returnId?: string; returnNo?: string; createdAt?: string; saleId?: string; accountId?: string; accountName?: string }[];
    vendorPayments: { id: string; vendorId: string; amount: number; date: string; note?: string; returnId?: string; returnNo?: string; createdAt?: string; purchaseId?: string; accountId?: string; accountName?: string }[];
    movements: { id: string; productId: string; productName: string; type: string; qty: number; date: string }[];
    expenses: Expense[];
    returns: ReturnSummary[];
    money: MoneyBalance[];
    moneyAccounts: MoneyAccountRow[];
    transfers: MoneyTransfer[];
    finance: { today: PeriodFinance; lifetime: PeriodFinance };
  }>('/bootstrap'),

  // Both return the saved row so the store can patch one product in place.
  createProduct: (b: object) => req<ProductRes>('/products', { method: 'POST', body: JSON.stringify(b) }),
  updateProduct: (id: string, b: object) => req<ProductRes>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteProduct: (id: string) => req<IdRes>(`/products/${id}`, { method: 'DELETE' }),

  createParty: (kind: 'c' | 'v', b: object) =>
    req<IdRes>(kind === 'c' ? '/customers' : '/vendors', { method: 'POST', body: JSON.stringify(b) }),
  updateParty: (kind: 'c' | 'v', id: string, b: object) =>
    req<IdRes>(`${kind === 'c' ? '/customers' : '/vendors'}/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteParty: (kind: 'c' | 'v', id: string) =>
    req<IdRes>(`${kind === 'c' ? '/customers' : '/vendors'}/${id}`, { method: 'DELETE' }),

  createSale: (b: object) => req<TxnResult>('/sales', { method: 'POST', body: JSON.stringify(b) }),
  createPurchase: (b: object) => req<TxnResult>('/purchases', { method: 'POST', body: JSON.stringify(b) }),
  saleDetail: (id: string) => req<SaleDetail>(`/sales/${id}`),
  purchaseDetail: (id: string) => req<PurchaseDetail>(`/purchases/${id}`),
  customerPayment: (b: object) => req<IdRes>('/customer-payments', { method: 'POST', body: JSON.stringify(b) }),
  vendorPayment: (b: object) => req<IdRes>('/vendor-payments', { method: 'POST', body: JSON.stringify(b) }),

  expenses: () => req<Expense[]>('/expenses'),
  createExpense: (b: object) => req<IdRes>('/expenses', { method: 'POST', body: JSON.stringify(b) }),
  updateExpense: (id: string, b: object) => req<IdRes>(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteExpense: (id: string) => req<IdRes>(`/expenses/${id}`, { method: 'DELETE' }),

  moneyBalances: () => req<MoneyBalance[]>('/money/balances'),
  moneyAccounts: () => req<MoneyAccountList>('/money/accounts'),
  moneyAccountTypes: () => req<{ type: AccountType; bn: string; en: string }[]>('/money/types'),
  moneyAccountDetail: (id: string) => req<MoneyAccountDetail>(`/money/accounts/${id}`),
  createMoneyAccount: (b: Partial<MoneyAccountRow>) => req<IdRes>('/money/accounts', { method: 'POST', body: JSON.stringify(b) }),
  updateMoneyAccount: (id: string, b: Partial<MoneyAccountRow>) => req<IdRes>(`/money/accounts/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  // Permanent delete. The API refuses when any movement/transfer references
  // the account, so the UI can never destroy financial history.
  deleteMoneyAccount: (id: string) => req<{ id: string; deleted: boolean }>(`/money/accounts/${id}`, { method: 'DELETE' }),
  setAccountOpening: (id: string, openingBalance: number, date?: string) =>
    req<IdRes>(`/money/accounts/${id}/opening`, { method: 'PUT', body: JSON.stringify({ openingBalance, date }) }),
  /** Canonical Net Sales / COGS / Gross Profit / Expenses / Net Profit. */
  finance: (mode: 'day' | 'month' | 'year' | 'all' | 'range', from?: string, to?: string) =>
    req<PeriodFinance>(`/finance?mode=${mode}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`),
  moneyTransfers: (limit?: number) => req<MoneyTransfer[]>(`/money/transfers${limit ? `?limit=${limit}` : ''}`),
  createMoneyTransfer: (b: { fromId: string; toId: string; amount: number; date?: string; note?: string }) =>
    req<MoneyTransfer & { money: MoneyBalance[] }>('/money/transfers', { method: 'POST', body: JSON.stringify(b) }),
  setOpeningBalances: (b: Partial<Record<MoneyMethod, number>>) =>
    req<MoneyBalance[]>('/money/opening', { method: 'PUT', body: JSON.stringify(b) }),

  createReturn: (b: object) => req<{ id: string; returnNo?: string; totalAmount: number }>('/returns', { method: 'POST', body: JSON.stringify(b) }),
  returnDetail: (id: string) => req<ReturnDetail>(`/returns/${id}`),
  returnInvoices: (kind: 'sale' | 'purchase') => req<ReturnInvoice[]>(`/returns/invoices?kind=${kind}`),
  saleReturnable: (id: string) => req<ReturnableTxn>(`/sales/${id}/returnable`),
  purchaseReturnable: (id: string) => req<ReturnableTxn>(`/purchases/${id}/returnable`),

  receivableDetail: (id: string) => req<RecvDetail>(`/accounts/receivables/${id}`),
  payableDetail: (id: string) => req<PayDetail>(`/accounts/payables/${id}`),

  trashList: () => req<TrashItem[]>('/trash'),  trashRestore: (kind: string, id: string) => req<IdRes>(`/trash/${kind}/${id}/restore`, { method: 'POST' }),
  trashPurge: (kind: string, id: string) => req<IdRes>(`/trash/${kind}/${id}/purge`, { method: 'DELETE' }),
  trashPurgeExpired: () => req<{ purged: number }>('/trash/purge-expired', { method: 'POST' }),

  reminders: () => req<{ reminders: Reminder[]; unreadCount: number }>('/reminders'),
  reminderRead: (id: string) => req<IdRes>(`/reminders/${id}/read`, { method: 'POST' }),

  gsearch: (q: string, limit?: number) =>
    req<GSearchRes>(`/search?q=${encodeURIComponent(q)}${limit ? `&limit=${limit}` : ''}`),
};

export type GSearchInvoice = {
  kind: 'sale' | 'purchase'; id: string; no: string;
  partyName: string | null; total: number; date: string;
};
export type GSearchParty = { id: string; name: string; mobile: string; balance: number };
export type GSearchRes = {
  invoices: GSearchInvoice[];
  returns: { kind: 'sreturn' | 'preturn'; id: string; no: string; partyName: string | null; total: number; date: string }[];
  customers: GSearchParty[];
  vendors: GSearchParty[];
  more: { invoices: boolean; returns: boolean; customers: boolean; vendors: boolean };
};

export type Reminder = {
  id: string; refType: 'sale' | 'purchase'; refId: string;
  occasion: 'today' | 'tomorrow'; dueDate: string;
  partyKind: 'c' | 'v'; partyId: string; partyName: string; amount: number;
};

export type TrashItem = { kind: 'product' | 'customer' | 'vendor' | 'expense'; id: string; name: string; deletedAt: string };

export type ReturnSummary = {
  id: string; kind: 'sale' | 'purchase'; date: string;
  amount: number; profit: number; returnNo?: string;
};

export type ReturnInvoice = {
  id: string; no: string; date: string; total: number;
  partyName: string | null; partyMobile: string | null;
};

export type ReturnableItem = {
  id: string; productId: string; productName: string;
  unit: string; enteredQty: number; qtyKg: number; rate: number;
  bags: { small: number; medium: number; large: number };
  returnedQty: number;
};

export type ReturnableTxn = {
  id: string; invoiceNo?: string; date: string; total: number; paid: number; due: number;
  customer?: { id: string; name: string; mobile: string } | null;
  vendor?: { id: string; name: string; mobile: string } | null;
  items: ReturnableItem[];
};

export type ReturnDetailItem = {
  productName: string; unit: string; enteredQty: number; qtyKg: number;
  goodKg: number; damagedKg: number; condition: string;
  damageReason?: string; note?: string; rate: number; amount: number;
};

export type ReturnDetail = {
  id: string; returnNo?: string; kind: 'sale' | 'purchase'; date: string; createdAt: string;
  totalAmount: number; profitImpact: number; settlement: string; refundAmount: number;
  origInvoiceNo?: string | null; origDate?: string | null;
  party: { name: string; mobile: string } | null;
  items: ReturnDetailItem[];
};

export type DetailItem = {
  productName: string; unit: string; enteredQty: number; qtyKg: number; rate: number;
};
export type DetailPayment = { id: string; amount: number; date: string; note?: string };
export type RecvDetail = {
  party: { id: string; name: string; mobile: string; opening: number; next?: string };
  opening: number;
  sales: { id: string; invoiceNo?: string; date: string; total: number; paid: number; due: number; status?: SettlementStatus; items: DetailItem[] }[];
  payments: DetailPayment[];
  totalSales: number; totalPaid: number; balance: number;
};
export type PayDetail = {
  party: { id: string; name: string; mobile: string; opening: number; next?: string };
  opening: number;
  purchases: { id: string; invoiceNo?: string; date: string; total: number; paid: number; due: number; status?: SettlementStatus; items: DetailItem[] }[];
  payments: DetailPayment[];
  totalPurchase: number; totalPaid: number; balance: number;
};
