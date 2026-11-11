// REST client for the chalarot-api backend.
// Base URL comes from EXPO_PUBLIC_API_URL (see .env.example).
const BASE = process.env.EXPO_PUBLIC_API_URL ?? (__DEV__
  ? 'http://localhost:4000/api'
  : '/api');

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
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (e) {
    throw new Error('Cannot reach server');
  }
  if (!r.headers.get('content-type')?.includes('application/json')) {
    throw new Error('Server returned an invalid response. Check the API URL and backend server.');
  }
  const data = (await r.json()) as { error?: string; code?: string; amount?: number };
  if (!r.ok) {
    if (r.status === 401 && !path.startsWith('/auth/')) authExpired?.();
    throw new ApiError(data?.error ?? `Request failed (${r.status})`, data?.code, data?.amount);
  }
  return data as T;
}

export type IdRes = { id: string };
export type AppUser = { id: string; name: string; phone: string; email: string; role: 'admin' | 'staff'; active: boolean };
export type UserInput = { name: string; phone: string; email: string; password: string; role: 'admin' | 'staff'; active: boolean };
export type ActivityRow = {
  id: string; userId?: string | null; userName: string; userRole?: string | null;
  action: string; entity: string; entityId?: string | null; reference?: string | null;
  amount?: number | null; summary: string; detail?: Record<string, any> | null;
  createdAt: string;
};
export type ActivityQuery = { group?: string; q?: string; userId?: string; from?: string; to?: string; take?: number; skip?: number };
let authExpired: (() => void) | undefined;
export const onAuthExpired = (callback?: () => void) => { authExpired = callback; };
export type MoneyMovementRow = { id: string; transactionNo: string; moneyAccountId: string; direction: string; amount: number; date: string; sourceType: string; transferId?: string | null; note?: string | null; moneyAccount?: { name: string; type: string } };
export type HouseExpenseRow = { id: string; transactionNo: string; date: string; amount: number; accountId: string; accountName: string; description: string; note: string };
export type BusinessSettings = { name: string; address: string; phone: string; currency: string; fiscalStartMonth: number; language: 'bn' | 'en'; allowNegativeStock: boolean };
export type BulkImportRes = {
  total: number;
  successCount: number;
  errors: { row: number; name?: string; error: string }[];
  created: any[];
};
/** Product create/update response: the saved row (already mapped for the app). */
export type ProductRes = { id: string; product: {
  id: string; code?: string; name: string; description?: string; cost: number; price: number; opening: number; qty: number;
  damagedQty: number; uom: string; stockValue: number; damagedValue: number;
  openingUnitCost: number; openingValue: number;
  smallBagKg: number; mediumBagKg: number; largeBagKg: number;
} };
export type StockAdjustmentHistoryRow = {
  id: string; date: string; createdAt: string; productId: string; productCode: string;
  productName: string; quantityKg: number; unitCost: number; value: number; reason: string;
};

export type TxnResult = { id: string; invoiceNo?: string; total: number };

/** Canonical per-invoice settlement status, derived by the backend. */
export type SettlementStatus = 'paid' | 'partial' | 'due';

export type TxnItem = {
  productId?: string; productName: string; unit: string; enteredQty: number; qtyKg: number; rate: number; otherCost?: number; unitCost?: number;
};
export type InvoicePayment = { id: string; paymentNo?: string; transactionNo?: string; description?: string; descriptionCode?: 'transport' | 'advance' | 'invoice'; accountId?: string | null; accountName?: string; amount: number; date?: string; note?: string; advance?: boolean; transportPayment?: boolean; transportContra?: boolean; contraPurchaseInvoiceNo?: string; contraSaleInvoiceNo?: string };
/** Payment account recorded on the ledger row when the document was saved. */
export type TxnPayment = { accountName: string | null; method: string; amount: number; date: string } | null;
export type SaleDetail = {
  id: string; invoiceNo?: string; date: string; createdAt: string; discount: number;
  total: number; paid: number; due: number; status?: SettlementStatus; nextDate?: string;
  customer: { id?: string; name: string; mobile: string } | null; items: TxnItem[];
  payment?: TxnPayment; payments?: InvoicePayment[]; returns?: { id: string; returnNo?: string; date: string; amount: number }[];
};
export type PurchaseDetail = {
  id: string; invoiceNo?: string; date: string; createdAt: string;
  total: number; paid: number; due: number; status?: SettlementStatus; nextDate?: string;
  vendor: { id?: string; name: string; mobile: string }; items: TxnItem[];
  payment?: TxnPayment; payments?: InvoicePayment[]; returns?: { id: string; returnNo?: string; date: string; amount: number }[];
};

// Stable internal payment method values. Never store translated labels.
export type MoneyMethod = 'cash' | 'bkash' | 'nagad' | 'bank';

export type Expense = {
  id: string; voucherNo?: string; category: string; customName?: string;
  amount: number; date: string; createdAt?: string; note?: string; method?: MoneyMethod; accountId?: string; capitalized?: boolean;
  sourceMovementId?: string; stockAdjustment?: boolean; accountName?: string;
};

export type ExpenseCategoryKind = 'operating' | 'landing' | 'transport' | 'other';

export type ExpenseCategoryRow = {
  id: string; name: string; kind: ExpenseCategoryKind; createdAt?: string;
};

export const MONEY_METHODS: MoneyMethod[] = ['cash', 'bkash', 'nagad', 'bank'];

export type MoneyBalance = {
  method: MoneyMethod; opening: number; balance: number; todayIn: number; todayOut: number;
};

/** A real money account the shop owns (Main Cash, BRAC Bank, bKash Merchant...). */
export type AccountType = 'cash' | 'bank' | 'bkash' | 'nagad' | 'rocket';

export type MoneyAccountRow = {
  id: string; name: string; type: AccountType;
  openingBalance: number; openingDate: string; openingAdjustments?: number; adjustedOpeningBalance?: number;
  bankName?: string; accountNumber?: string; branch?: string; mobileNumber?: string; note?: string;
  active: boolean;
  /** Backend-computed financial history; drives whether Delete is offered. */
  movementCount?: number; transferCount?: number; hasHistory?: boolean;
  balance: number; todayIn: number; todayOut: number;
};

export type MoneyAccountList = { accounts: MoneyAccountRow[]; totalMoney: number };

export type MoneyAccountMovement = {
  id: string; transactionNo: string; date: string; direction: 'in' | 'out'; amount: number;
  sourceType: string; sourceId: string; note?: string; transferNo?: string;
  counterpartyAccountId?: string; active: boolean; balance: number; createdAt?: string;
};

export type StockMovementReportRow = { id: string; productId: string; type: string; bucket: string; qtyKg: number; unitCost: number; value: number; date: string; refId?: string | null; note?: string | null; createdAt?: string };

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
  purchase: number; purchaseReturn: number; netPurchase: number; capitalizedLandedCost: number;
  closingStockValue: number; damagedStockValue: number;
  cogs: number; grossProfit: number; expense: number; otherIncomeExpense: number; netProfit: number;
};

export type CashFlowStatement = {
  from: string; to: string; openingBalance: number; customerReceipts: number;
  supplierPayments: number; inventoryCostPayments: number; expensePayments: number; returnInflows: number;
  returnOutflows: number; otherInflows: number; otherOutflows: number;
  operatingInflows: number; operatingOutflows: number; netCashFlow: number; closingBalance: number;
};

export type BalanceSheet = { asOf: string; assets: { cash: number | null; bank: number | null; wallets: number | null; receivables: number; supplierAdvances?: number; inventory: number; other?: number; total: number }; liabilities: { payables: number; customerCredits?: number; other?: number; total: number }; equity: number; journalEquity: number; otherEquity: number; accounts?: { assets: { code: string; name: string; type: string; balance: number }[]; liabilities: { code: string; name: string; type: string; balance: number }[]; equity: { code: string; name: string; type: string; balance: number }[] }; totalLiabilitiesAndEquity: number; balanced: boolean };
export type JournalLine = { date: string; reference: string; account: string; accountId?: string; accountCode?: string; accountType?: string; description: string; debit: number; credit: number; journalNo: string; sequence: number; entryId?: string; editable?: boolean };
export type JournalEntries = { from: string; to: string; entries: { date: string; reference: string; lines: JournalLine[]; debitTotal: number; creditTotal: number; entryId?: string; editable?: boolean; sourceType?: string; sourceId?: string; sourceRef?: string; status?: 'draft' | 'posted' | 'cancelled' }[]; debitTotal: number; creditTotal: number; balanced: boolean };
export type GeneralLedger = { from: string; to: string; accounts: { account: string; code: string; openingBalance: number; periodDebit: number; periodCredit: number; closingBalance: number; netBalance: number; balanceSide: 'Dr' | 'Cr'; rows: (JournalLine & { runningBalance: number })[] }[]; debitTotal: number; creditTotal: number; balanced: boolean };
export type ChartAccountRow = { id: string; code: string; name: string; type: 'asset' | 'liability' | 'equity' | 'income' | 'expense'; active: boolean; system: boolean };
export type JournalEntryLine = { id?: string; accountId: string; account?: ChartAccountRow; description: string; debit: number; credit: number };
export type SavedJournalEntry = { id: string; entryNo: string; date: string; memo: string; sourceType: string; sourceId?: string | null; sourceRef?: string | null; active: boolean; status?: 'draft' | 'posted' | 'cancelled'; lines: JournalEntryLine[] };
export type JournalWrite = { date: string; memo: string; sourceType?: 'manual'; status?: 'draft' | 'posted'; lines: JournalEntryLine[] };

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
  authStatus: () => req<{ setup: boolean; user: AppUser | null }>('/auth/status'),
  login: (email: string, password: string) => req<AppUser>('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) }),
  setup: (body: UserInput) => req<AppUser>('/auth/setup', { method: 'POST', body: JSON.stringify(body) }),
  logout: () => req('/auth/logout', { method: 'POST' }),
  users: () => req<AppUser[]>('/users'),
  saveUser: (body: UserInput, id?: string) => req<AppUser>(id ? `/users/${id}` : '/users', { method: id ? 'PUT' : 'POST', body: JSON.stringify(body) }),
  profile: (body: { name: string; phone: string; email: string; password: string; currentPassword: string }) => req<AppUser>('/auth/profile', { method: 'PUT', body: JSON.stringify(body) }),
  moneyMovements: (limit = 30) => req<MoneyMovementRow[]>(`/money/movements?limit=${encodeURIComponent(String(limit))}`),
  stockMovements: (limit = 500) => req<StockMovementReportRow[]>(`/stock-movements?limit=${encodeURIComponent(String(limit))}`),
  moneyEntry: (body: { accountId: string; direction: 'in' | 'out'; amount: number; date: string; note: string; requestId: string }) => req<MoneyMovementRow>('/money/entries', { method: 'POST', body: JSON.stringify(body) }),
  houseExpenses: () => req<HouseExpenseRow[]>('/house-expenses'),
  createHouseExpense: (body: { accountId: string; amount: number; date: string; description: string; note: string; requestId: string }) => req<HouseExpenseRow>('/house-expenses', { method: 'POST', body: JSON.stringify(body) }),
  updateMoneyEntry: (id: string, body: { amount: number; note: string }) => req<MoneyMovementRow & { previousAmount: number }>(`/money/entries/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  settings: () => req<BusinessSettings>('/settings'),
  saveSettings: (value: BusinessSettings) => req<BusinessSettings>('/settings', { method: 'PUT', body: JSON.stringify(value) }),
  bootstrap: () => req<{
    products: import('./store').Product[];
    customers: import('./store').Party[];
    vendors: import('./store').Party[];
    sales: { id: string; customerId?: string; date: string; total: number; paid: number; due: number; status: SettlementStatus; profit: number; cogs: number; invoiceNo?: string; createdAt?: string; items?: { productId: string; productName: string; productCode?: string }[] }[];
    purchases: { id: string; vendorId: string; date: string; createdAt?: string; total: number; paid: number; due: number; status: SettlementStatus; invoiceNo?: string; items?: { productId: string; productName: string; productCode?: string }[] }[];
    customerPayments: { id: string; paymentNo: string; transactionNo?: string; customerId: string; amount: number; date: string; note?: string; method?: string; returnId?: string; returnNo?: string; createdAt?: string; saleId?: string; accountId?: string; accountName?: string }[];
    vendorPayments: { id: string; paymentNo: string; transactionNo?: string; vendorId: string; amount: number; date: string; note?: string; returnId?: string; returnNo?: string; createdAt?: string; purchaseId?: string; accountId?: string; accountName?: string }[];
    movements: { id: string; productId: string; productName: string; type: string; qty: number; bags: number; unitCost: number; bagUnitPrice: number; amount: number; date: string; transactionNo?: string; note?: string }[];
    expenses: Expense[];
    returns: ReturnSummary[];
    money: MoneyBalance[];
    moneyAccounts: MoneyAccountRow[];
    transfers: MoneyTransfer[];
    finance: { today: PeriodFinance; lifetime: PeriodFinance };
  }>('/bootstrap'),

  // Both return the saved row so the store can patch one product in place.
  createProduct: (b: object) => req<ProductRes>('/products', { method: 'POST', body: JSON.stringify(b) }),
  bulkCreateProducts: (items: any[]) => req<BulkImportRes>('/products/bulk', { method: 'POST', body: JSON.stringify({ items }) }),
  adjustStock: (b: { items: any[]; date?: string; note?: string }) =>
    req<{ success: boolean; count: number; adjusted: any[] }>('/products/adjust', { method: 'POST', body: JSON.stringify(b) }),
  stockAdjustmentHistory: (limit = 1000) => req<StockAdjustmentHistoryRow[]>(`/products/adjustments?limit=${limit}`),
  updateProduct: (id: string, b: object) => req<ProductRes>(`/products/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteProduct: (id: string) => req<IdRes>(`/products/${id}`, { method: 'DELETE' }),

  createParty: (kind: 'c' | 'v', b: object) =>
    req<IdRes>(kind === 'c' ? '/customers' : '/vendors', { method: 'POST', body: JSON.stringify(b) }),
  bulkCreateCustomers: (items: any[]) => req<BulkImportRes>('/customers/bulk', { method: 'POST', body: JSON.stringify({ items }) }),
  bulkCreateVendors: (items: any[]) => req<BulkImportRes>('/vendors/bulk', { method: 'POST', body: JSON.stringify({ items }) }),
  updateParty: (kind: 'c' | 'v', id: string, b: object) =>
    req<IdRes>(`${kind === 'c' ? '/customers' : '/vendors'}/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteParty: (kind: 'c' | 'v', id: string) =>
    req<IdRes>(`${kind === 'c' ? '/customers' : '/vendors'}/${id}`, { method: 'DELETE' }),

  createSale: (b: object) => req<TxnResult>('/sales', { method: 'POST', body: JSON.stringify(b) }),
  createPurchase: (b: object) => req<TxnResult>('/purchases', { method: 'POST', body: JSON.stringify(b) }),
  updateSale: (id: string, b: object) => req<TxnResult>(`/sales/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  updatePurchase: (id: string, b: object) => req<TxnResult>(`/purchases/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteSale: (id: string) => req<{ id: string; invoiceNo?: string; deleted: boolean; note: string }>(`/sales/${id}`, { method: 'DELETE' }),
  deletePurchase: (id: string) => req<{ id: string; invoiceNo?: string; deleted: boolean; note: string }>(`/purchases/${id}`, { method: 'DELETE' }),
  saleDetail: (id: string) => req<SaleDetail>(`/sales/${id}`),
  purchaseDetail: (id: string) => req<PurchaseDetail>(`/purchases/${id}`),
  customerPayment: (b: object) => req<IdRes>('/customer-payments', { method: 'POST', body: JSON.stringify(b) }),
  partyPaymentSplit: (b: { kind: 'c' | 'v'; partyId: string; payments: { accountId: string; amount: number }[]; date: string; note?: string }) => req<{ payments: { id: string; paymentNo: string; amount: number; accountId: string }[] }>('/party-payments/split', { method: 'POST', body: JSON.stringify(b) }),
  vendorPayment: (b: object) => req<IdRes>('/vendor-payments', { method: 'POST', body: JSON.stringify(b) }),

  expenses: () => req<Expense[]>('/expenses'),
  createExpense: (b: object) => req<IdRes>('/expenses', { method: 'POST', body: JSON.stringify(b) }),
  updateExpense: (id: string, b: object) => req<IdRes>(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteExpense: (id: string) => req<IdRes>(`/expenses/${id}`, { method: 'DELETE' }),
  expenseCategories: () => req<ExpenseCategoryRow[]>('/expense-categories'),
  createExpenseCategory: (b: { name: string; kind: ExpenseCategoryKind }) =>
    req<ExpenseCategoryRow>('/expense-categories', { method: 'POST', body: JSON.stringify(b) }),
  updateExpenseCategory: (id: string, b: { name: string; kind: ExpenseCategoryKind }) =>
    req<ExpenseCategoryRow>(`/expense-categories/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  deleteExpenseCategory: (id: string) =>
    req<{ id: string }>(`/expense-categories/${id}`, { method: 'DELETE' }),

  moneyBalances: () => req<MoneyBalance[]>('/money/balances'),
  moneyAccounts: () => req<MoneyAccountList>('/money/accounts'),
  moneyAccountsAsOf: (date: string) => req<MoneyAccountList>(`/money/accounts?asOf=${encodeURIComponent(date)}`),
  moneyAccountTypes: () => req<{ type: AccountType; bn: string; en: string }[]>('/money/types'),
  moneyAccountDetail: (id: string) => req<MoneyAccountDetail>(`/money/accounts/${id}`),
  createMoneyAccount: (b: Partial<MoneyAccountRow>) => req<IdRes>('/money/accounts', { method: 'POST', body: JSON.stringify(b) }),
  updateMoneyAccount: (id: string, b: Partial<MoneyAccountRow>) => req<IdRes>(`/money/accounts/${id}`, { method: 'PUT', body: JSON.stringify(b) }),
  // Permanent delete. The API refuses when any movement/transfer references
  // the account, so the UI can never destroy financial history.
  deleteMoneyAccount: (id: string) => req<{ id: string; deleted: boolean }>(`/money/accounts/${id}`, { method: 'DELETE' }),
  setAccountOpening: (id: string, openingBalance: number, date: string) =>
    req<IdRes>(`/money/accounts/${id}/opening`, { method: 'PUT', body: JSON.stringify({ openingBalance, date }) }),
  /** Canonical Net Sales / COGS / Gross Profit / Expenses / Net Profit. */
  finance: (mode: 'day' | 'month' | 'year' | 'all' | 'range', from?: string, to?: string) =>
    req<PeriodFinance>(`/finance?mode=${mode}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`),
  cashflow: (from: string, to: string) => req<CashFlowStatement>(`/cashflow?from=${from}&to=${to}`),
  balanceSheet: (asOf: string) => req<BalanceSheet>(`/balance-sheet?asOf=${asOf}`),
  generalLedger: (from: string, to: string) => req<GeneralLedger>(`/general-ledger?from=${from}&to=${to}`),
  journalEntries: (from: string, to: string, includeStatuses = false) => req<JournalEntries>(`/journal-entries?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}${includeStatuses ? '&includeStatuses=true' : ''}`),
  chartAccounts: () => req<ChartAccountRow[]>('/chart-of-accounts'),
  createChartAccount: (body: { code: string; name: string; type: ChartAccountRow['type'] }) => req<ChartAccountRow>('/chart-of-accounts', { method: 'POST', body: JSON.stringify(body) }),
  updateChartAccount: (id: string, body: Partial<ChartAccountRow>) => req<ChartAccountRow>(`/chart-of-accounts/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  createJournalEntry: (body: JournalWrite) => req<SavedJournalEntry>('/journal-entries', { method: 'POST', body: JSON.stringify(body) }),
  updateJournalEntry: (id: string, body: JournalWrite) => req<SavedJournalEntry>(`/journal-entries/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  setJournalEntryStatus: (id: string, status: 'draft' | 'posted' | 'cancelled') => req<{ id: string; status: string }>(`/journal-entries/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
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

  activity: (query: ActivityQuery = {}) => {
    const params = Object.entries(query)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`)
      .join('&');
    return req<{ rows: ActivityRow[]; total: number; take: number; skip: number }>(`/activity${params ? '?' + params : ''}`);
  },

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
