import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { localeDigits, parseNum, toEnDigits } from '../bn';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Alert,
  Linking,
} from 'react-native';
import {
  useApp,
  today,
  Party,
  Product,
  SaleRec,
  Expense,
  type PeriodFinance,
  type MoneyAccountRow,
  type MoneyBalance,
} from '../store';
import {
  useMoney,
  useNum,
  useDateStr,
  toBnDigits,
  color,
  Card,
  SectionHead,
  Row,
  Muted,
  Empty,
  Btn,
  Field,
  RequiredLabel,
} from '../ui';
import { AppIcon, icons } from '../icons';
import { useBreakpoint } from '../responsive';
import { SearchableSelect, matchParty, matchProduct } from '../search';
import { printReport, previewReport, printedAtStamp, downloadReportCSV, type ReportDoc, type ReportRow } from '../report';
import { api } from '../api';
import { showEntryError } from '../entryDialog';
import { EntryReportButtons } from '../EntryReportButtons';
import type { GeneralLedger, JournalEntries, SavedJournalEntry, HouseExpenseRow, MoneyMovementRow, StockMovementReportRow } from '../api';
import type { Key } from '../i18n';
import {
  FilterModal,
  ExpenseModal,
  ReceivableModal,
  PayableModal,
  KpiDetailModal,
  type AcctFilter,
  type KpiKind,
  JournalEntryModal,
  ChartOfAccountsModal,
  DateField,
  MoneyTransferModal,
  MoneyEntry,
} from '../screens';

interface AccountsDashboardProps {
  go?: (route: string) => void;
  focus?: { kind: 'c' | 'v'; id: string } | null;
  onFocusDone?: () => void;
}

function HouseExpenseEntryForm({ onSaved }: { onSaved: () => Promise<void> }) {
  const { lang, t, moneyAccounts } = useApp();
  const label = (en: string, bn: string) => lang === 'bn' ? bn : en;
  const entryAccounts = moneyAccounts.filter(account => account.active && (account.type === 'cash' || account.type === 'bank'))
    .sort((a, b) => Number(b.type === 'cash') - Number(a.type === 'cash'));
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const requestId = useRef(`house-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const amountRefs = useRef<TextInput[]>([]);
  const descriptionRef = useRef<TextInput>(null);
  const noteRef = useRef<TextInput>(null);
  const save = async () => {
    if (busy) return;
    const entries = entryAccounts.map(account => ({ accountId: account.id, amount: parseNum(amounts[account.id] ?? '') })).filter(entry => entry.amount > 0);
    if (!entries.length || !description.trim()) {
      showEntryError(lang, label('Enter at least one cash or bank amount and a description.', 'ক্যাশ বা ব্যাংকের অন্তত একটি পরিমাণ ও বিবরণ লিখুন।'));
      return;
    }
    setBusy(true);
    try {
      for (const entry of entries) await api.createHouseExpense({ ...entry, date: toEnDigits(date), description: description.trim(), note: note.trim(), requestId: `${requestId.current}-${entry.accountId}` });
      await onSaved();
      setAmounts({});
      setDate(today());
      setDescription('');
      setNote('');
      requestId.current = `house-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    } catch (e) {
      showEntryError(lang, e instanceof Error ? e.message : label('Could not save house expense.', 'বাসার খরচ সংরক্ষণ করা যায়নি।'));
    } finally { setBusy(false); }
  };
  return <View style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#DBEAFE', borderRadius: 14, padding: 14, marginBottom: 14 }}>
    <Text style={{ fontSize: 17, fontWeight: '800', color: '#123D64', marginBottom: 8 }}>{label('Record house expense withdrawal', 'বাসার খরচ উত্তোলন নথিভুক্ত করুন')}</Text>
    <DateField label={label('Date', 'তারিখ')} value={date} onChange={value => { setDate(value); requestAnimationFrame(() => amountRefs.current[0]?.focus()); }} allowPast required />
    <RequiredLabel text={label('Cash or bank amount (enter one or more)', 'ক্যাশ বা ব্যাংকের পরিমাণ (একটি বা একাধিক)')} required />
    {entryAccounts.map((account, index) => <Field
      key={account.id}
      inputRef={node => { amountRefs.current[index] = node as TextInput; }}
      label={`${account.name} ${label('Amount', 'পরিমাণ')}`}
      value={amounts[account.id] ?? ''}
      onChange={value => setAmounts(current => ({ ...current, [account.id]: value }))}
      num
      returnKeyType={index === entryAccounts.length - 1 ? 'done' : 'next'}
      onSubmitEditing={() => index < entryAccounts.length - 1 ? amountRefs.current[index + 1]?.focus() : descriptionRef.current?.focus()}
    />)}
    <Field inputRef={descriptionRef} label={label('Description', 'বিবরণ')} value={description} onChange={setDescription} required returnKeyType="next" onSubmitEditing={() => noteRef.current?.focus()} />
    <Field inputRef={noteRef} label={label('Log note (optional)', 'লগ নোট (ঐচ্ছিক)')} value={note} onChange={setNote} returnKeyType="done" onSubmitEditing={() => { void save(); }} />
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
      <Btn label={busy ? t('wait') : label('Save withdrawal', 'উত্তোলন সংরক্ষণ')} icon={icons.moneyOut} onPress={() => { if (!busy) void save(); }} />
    </View>
  </View>;
}
// Preset Range Calculator
const pad2n = (n: number) => String(n).padStart(2, '0');
const addDays = (ds: string, delta: number) => {
  const [y, m1, d] = ds.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m1 - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad2n(dt.getUTCMonth() + 1)}-${pad2n(dt.getUTCDate())}`;
};
const monthStart = (ds: string) => `${ds.slice(0, 7)}-01`;
const monthEnd = (ds: string) => {
  const [y, m1] = ds.split('-').map(Number);
  return `${ds.slice(0, 7)}-${pad2n(new Date(Date.UTC(y, m1, 0)).getUTCDate())}`;
};
const monthShiftStart = (ds: string, delta: number) => {
  const [y, m1] = ds.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m1 - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${pad2n(dt.getUTCMonth() + 1)}-01`;
};

const presetRange = (id: 'today' | 'last7' | 'thisMonth' | 'last3m' | 'thisYear', td: string, fiscalMonth = 7): AcctFilter => {
  if (id === 'last7') return { from: addDays(td, -6), to: td };
  if (id === 'thisMonth') return { from: monthStart(td), to: monthEnd(td) };
  if (id === 'last3m') return { from: monthStart(monthShiftStart(td, -3)), to: monthEnd(monthShiftStart(td, -1)) };
  if (id === 'thisYear') { const y = Number(td.slice(0, 4)) - (Number(td.slice(5, 7)) < fiscalMonth ? 1 : 0); const from = `${y}-${pad2n(fiscalMonth)}-01`; return { from, to: addDays(`${y + 1}-${pad2n(fiscalMonth)}-01`, -1) }; }
  return { from: td, to: td };
};
const expenseTranslationKey = (category: string) => `ex${category.charAt(0).toUpperCase()}${category.slice(1)}` as Key;
type AccountReportType = 'sales' | 'purchases' | 'collections' | 'supplierPayments' | 'deposits' | 'withdrawals' | 'expenses' | 'houseExpenses' | 'inventory' | 'stockMovements' | 'returns' | 'customerBalances' | 'supplierBalances' | 'customers' | 'suppliers' | 'transfers' | 'cashflow' | 'profitLoss' | 'journal';
const ACCOUNT_REPORT_TYPES: { id: AccountReportType; en: string; bn: string }[] = [
  { id: 'sales', en: 'Sales', bn: 'বিক্রয়' }, { id: 'purchases', en: 'Purchases', bn: 'ক্রয়' },
  { id: 'collections', en: 'Customer collections', bn: 'গ্রাহক আদায়' }, { id: 'supplierPayments', en: 'Supplier payments', bn: 'সরবরাহকারী পরিশোধ' },
  { id: 'deposits', en: 'Deposits', bn: 'জমা' }, { id: 'withdrawals', en: 'Withdrawals', bn: 'উত্তোলন' },
  { id: 'expenses', en: 'Expenses', bn: 'ব্যয়' }, { id: 'houseExpenses', en: 'House expenses', bn: 'বাসার খরচ' },
  { id: 'inventory', en: 'Current inventory', bn: 'বর্তমান মজুদ' }, { id: 'stockMovements', en: 'Inventory movements', bn: 'মজুদ লেনদেন' }, { id: 'returns', en: 'Sales and purchase returns', bn: 'বিক্রয় ও ক্রয় ফেরত' },
  { id: 'customerBalances', en: 'Customer balances', bn: 'গ্রাহক পাওনা' }, { id: 'supplierBalances', en: 'Supplier balances', bn: 'সরবরাহকারী দেনা' },
  { id: 'customers', en: 'Customer directory', bn: 'গ্রাহক তালিকা' }, { id: 'suppliers', en: 'Supplier directory', bn: 'সরবরাহকারী তালিকা' },
  { id: 'transfers', en: 'Account transfers', bn: 'অ্যাকাউন্ট স্থানান্তর' }, { id: 'cashflow', en: 'Cash flow', bn: 'নগদ প্রবাহ' },
  { id: 'profitLoss', en: 'Profit and loss', bn: 'লাভ-ক্ষতি' }, { id: 'journal', en: 'Journal entries', bn: 'জার্নাল এন্ট্রি' },
];

export function AccountsDashboard({ go, focus, onFocusDone }: AccountsDashboardProps) {
  const {
    t,
    lang, business,
    stats,
    customers = [],
    vendors = [],
    bal,
    expenses = [],
    sales = [],
    purchases = [],
    cTx = [],
    vTx = [],
    returns = [],
    products = [],
    moneyAccounts = [],
    moneyBalances = [],
    moneyTransfers = [],
    saveExpense,
    deleteExpense,
    loadFinance,
    financePeriod,
    refresh,
  } = useApp();
  const label = (en: string, bn: string) => lang === 'bn' ? bn : en;

  const m = useMoney();
  const n = useNum();
  const fd = useDateStr();
  const expenseCategoryLabel = useCallback((category: string, customName?: string) =>
    category === 'other' && customName
      ? customName === 'Inventory adjustment' && lang === 'bn' ? 'স্টক সমন্বয়' : customName
      : t(expenseTranslationKey(category)), [t, lang]);
  const s = stats();
  const td = today();
  const { isDesktop, isTablet, isMobile, width } = useBreakpoint();

  // Active navigation tab
  // 'overview' | 'due' | 'pay' | 'expense' | 'houseExpense'
  const [activeTab, setActiveTab] = useState<'overview' | 'reports' | 'due' | 'pay' | 'expense' | 'houseExpense'>('overview');

  // Filter state
  const [fltPreset, setFltPreset] = useState<'today' | 'last7' | 'thisMonth' | 'last3m' | 'thisYear' | 'custom'>('today');
  const [flt, setFlt] = useState<AcctFilter>(() => presetRange('today', today()));
  const [fltModalOpen, setFltModalOpen] = useState(false);
  const [moneyEntry, setMoneyEntry] = useState<'in' | 'out' | null>(null);
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [accountRefresh, setAccountRefresh] = useState(0);
  const [houseExpenseRows, setHouseExpenseRows] = useState<HouseExpenseRow[]>([]);
  const [houseExpenseLoading, setHouseExpenseLoading] = useState(false);
  const [reportCenterOpen, setReportCenterOpen] = useState(false);
  const [selectedReportTypes, setSelectedReportTypes] = useState<AccountReportType[]>(['sales', 'purchases']);
  const [reportFrom, setReportFrom] = useState('');
  const [reportTo, setReportTo] = useState('');
  const [reportCustomerId, setReportCustomerId] = useState<string | undefined>();
  const [reportSupplierId, setReportSupplierId] = useState<string | undefined>();
  const [reportProductId, setReportProductId] = useState<string | undefined>();
  const [customReportTitle, setCustomReportTitle] = useState('');
  const [reportMoneyRows, setReportMoneyRows] = useState<MoneyMovementRow[]>([]);
  const [reportStockRows, setReportStockRows] = useState<StockMovementReportRow[]>([]);
  const [reportHouseRows, setReportHouseRows] = useState<HouseExpenseRow[]>([]);
  const [reportDataLoading, setReportDataLoading] = useState(false);
  const [reportGenerating, setReportGenerating] = useState(false);
  const [generatedReport, setGeneratedReport] = useState<ReportDoc | null>(null);

  // Focus effect for navigation from outside
  useEffect(() => {
    if (focus) {
      if (focus.kind === 'c') {
        setSelectedCustId(focus.id);
        setActiveTab('due');
      } else {
        setSelectedVendorId(focus.id);
        setActiveTab('pay');
      }
      onFocusDone?.();
    }
  }, [focus]);

  // Load backend finance data for exact active range
  const finKey = `${flt.from}|${flt.to}`;
  const [finFor, setFinFor] = useState('');
  useEffect(() => {
    let on = true;
    loadFinance('range', flt.from, flt.to)
      .then(() => {
        if (on) setFinFor(finKey);
      })
      .catch(() => {
        if (on) setFinFor('');
      });
    return () => {
      on = false;
    };
  }, [finKey]);

  const [rangeAccounts, setRangeAccounts] = useState<MoneyAccountRow[]>([]);
  const [accountsFor, setAccountsFor] = useState('');
  useEffect(() => {
    let on = true;
    api.moneyAccountsAsOf(flt.to).then(result => {
      if (on) { setRangeAccounts(result.accounts); setAccountsFor(flt.to); }
    }).catch(() => { if (on) setAccountsFor(''); });
    return () => { on = false; };
  }, [flt.to, accountRefresh]);

  useEffect(() => {
    if (activeTab !== 'houseExpense') return;
    let on = true;
    setHouseExpenseLoading(true);
    api.houseExpenses().then(rows => { if (on) setHouseExpenseRows(rows); })
      .catch(() => { if (on) Alert.alert(lang === 'bn' ? 'বাসার খরচ লোড করা যায়নি' : 'Could not load house expenses'); })
      .finally(() => { if (on) setHouseExpenseLoading(false); });
    return () => { on = false; };
  }, [activeTab, accountRefresh, lang]);

  useEffect(() => {
    if (!reportCenterOpen) return;
    let on = true;
    setReportDataLoading(true);
    Promise.all([api.moneyMovements(5000), api.stockMovements(5000), api.houseExpenses()])
      .then(([moneyRows, stockRows, houseRows]) => {
        if (!on) return;
        setReportMoneyRows(moneyRows); setReportStockRows(stockRows); setReportHouseRows(houseRows);
      })
      .catch(() => { if (on) Alert.alert(label('Could not load report data', 'রিপোর্টের তথ্য লোড করা যায়নি')); })
      .finally(() => { if (on) setReportDataLoading(false); });
    return () => { on = false; };
  }, [reportCenterOpen, accountRefresh, lang]);

  const f: PeriodFinance | null = finFor === finKey ? financePeriod : null;

  // Modals state
  const [kpiModal, setKpiModal] = useState<KpiKind | null>(null);
  const [selectedCustId, setSelectedCustId] = useState<string | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [expenseFormItem, setExpenseFormItem] = useState<Expense | null | undefined>(undefined);
  const [reportViewDoc, setReportViewDoc] = useState<ReportDoc | null>(null);
  const [generalLedgerData, setGeneralLedgerData] = useState<GeneralLedger | null>(null);
  const [selectedLedgerAccount, setSelectedLedgerAccount] = useState<string | null>(null);
  const [journalData, setJournalData] = useState<JournalEntries | null>(null);
  const [selectedJournalEntry, setSelectedJournalEntry] = useState<JournalEntries['entries'][number] | null>(null);
  const [journalDetailTab, setJournalDetailTab] = useState<'items' | 'info'>('items');
  const [journalSearch, setJournalSearch] = useState('');
  const [journalAccountFilter, setJournalAccountFilter] = useState('');
  const [journalStatusFilter, setJournalStatusFilter] = useState('all');
  const [journalComposer, setJournalComposer] = useState<{ initial?: SavedJournalEntry } | null>(null);
  const [chartModalOpen, setChartModalOpen] = useState(false);
  const [journalFrom, setJournalFrom] = useState(flt.from);
  const [journalTo, setJournalTo] = useState(flt.to);
  const [profitFrom, setProfitFrom] = useState(flt.from);
  const [profitTo, setProfitTo] = useState(flt.to);

  // Searches in ledgers
  const [dueSearch, setDueSearch] = useState('');
  const [paySearch, setPaySearch] = useState('');
  const [expSearch, setExpSearch] = useState('');
  const [expCatFilter, setExpCatFilter] = useState('all');

  // Interactive Curves state
  const [curveSeries, setCurveSeries] = useState<{ sales: boolean; expense: boolean; profit: boolean }>({
    sales: true,
    expense: true,
    profit: true,
  });
  const [activeCurvePoint, setActiveCurvePoint] = useState<{
    date: string;
    sales: number;
    expense: number;
    profit: number;
    margin: number;
  } | null>(null);

  // Interactive Q&A Assistant state
  
  
  

  // Period Date Range Checker
  const inPeriod = (d: string) => d >= flt.from && d <= flt.to;
  const isToday = flt.from === td && flt.to === td;

  // Core Financial Aggregates
  const fSale = f?.netSales ?? 0;
  const fCogs = f?.cogs ?? 0;
  const fGrossProfit = f?.grossProfit ?? (fSale - fCogs);
  const fExp = f?.expense ?? 0;
  const fProfit = f?.netProfit ?? (fGrossProfit - fExp);
  const fCollect = useMemo(() => {
    return cTx.filter(x => x.kind === 'payment' && inPeriod(x.date)).reduce((a, x) => a + x.amount, 0);
  }, [cTx, flt]);

  // Liquid Reserves
  const totalCashInHand = useMemo(() => {
    const cashAcc = moneyAccounts.find(a => a.type === 'cash');
    return cashAcc?.balance ?? 0;
  }, [moneyAccounts]);

  const totalBankBalances = useMemo(() => {
    return moneyAccounts.filter(a => a.type !== 'cash').reduce((sum, a) => sum + (a.balance || 0), 0);
  }, [moneyAccounts]);

  const totalLiquidMoney = useMemo(() => {
    return moneyAccounts.reduce((sum, a) => sum + (a.balance || 0), 0);
  }, [moneyAccounts]);
  const filteredAccountsReady = accountsFor === flt.to;
  const filteredCashBalance = filteredAccountsReady ? rangeAccounts.filter(a => a.type === 'cash').reduce((sum, a) => sum + (a.balance || 0), 0) : 0;
  const filteredBankBalance = filteredAccountsReady ? rangeAccounts.filter(a => a.type === 'bank').reduce((sum, a) => sum + (a.balance || 0), 0) : 0;
  const fPayment = useMemo(() => vTx.filter(x => x.kind === 'payment' && inPeriod(x.date)).reduce((sum, x) => sum + x.amount, 0), [vTx, flt]);

  // Customer Receivables (পাওনা)
  const customerDues = useMemo(() => {
    return customers
      .map(c => ({ customer: c, balance: bal('c', c.id).balance }))
      .filter(item => item.balance > 0)
      .sort((a, b) => b.balance - a.balance);
  }, [customers, bal]);

  const totalDueAmount = s.due;
  const totalDueCount = customerDues.length;

  // Vendor Payables (দেনা)
  const vendorPayables = useMemo(() => {
    return vendors
      .map(v => ({ vendor: v, balance: bal('v', v.id).balance }))
      .filter(item => item.balance > 0)
      .sort((a, b) => b.balance - a.balance);
  }, [vendors, bal]);

  const totalPayableAmount = s.payable;
  const totalPayableCount = vendorPayables.length;

  // Aging reports use open invoice balances and age them from the invoice date.
  // Legacy opening balances have no invoice date, so they are shown in 90+ days.
  const agingRows = (kind: 'receivable' | 'payable') => {
    const buckets = [
      { label: '0–30 days', total: 0, rows: [] as ReportRow[] },
      { label: '31–60 days', total: 0, rows: [] as ReportRow[] },
      { label: '61–90 days', total: 0, rows: [] as ReportRow[] },
      { label: '90+ days', total: 0, rows: [] as ReportRow[] },
    ];
    const add = (name: string, date: string, amount: number) => {
      if (amount <= 0) return;
      const age = date === 'Opening balance' ? 91 : Math.max(0, Math.floor((Date.parse(`${td}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86400000));
      const bucket = buckets[age <= 30 ? 0 : age <= 60 ? 1 : age <= 90 ? 2 : 3];
      bucket.total += amount;
      bucket.rows.push({ label: name, sub: date, right: m(amount) });
    };
    if (kind === 'receivable') {
      customers.forEach(c => add(c.name + ' · Opening balance', 'Opening balance', c.opening));
      sales.forEach(x => { const party = customers.find(c => c.id === x.customerId); if (party) add(`${party.name}${x.invoiceNo ? ` · ${x.invoiceNo}` : ''}`, x.date, x.due); });
    } else {
      vendors.forEach(v => add(v.name + ' · Opening balance', 'Opening balance', v.opening));
      purchases.forEach(x => { const party = vendors.find(v => v.id === x.vendorId); if (party) add(`${party.name}${x.invoiceNo ? ` · ${x.invoiceNo}` : ''}`, x.date, x.due); });
    }
    return buckets.map(b => ({ title: `${b.label} · ${m(b.total)}`, rows: b.rows }));
  };

  const printAging = (kind: 'receivable' | 'payable') => {
    const sections = agingRows(kind);
    setReportViewDoc({
      language: lang,
      shop: business.name,
      title: kind === 'receivable' ? label('Aged Receivables', 'বয়সভিত্তিক পাওনা') : label('Aged Payables', 'বয়সভিত্তিক দেনা'),
      period: `${label('As of', 'তারিখ')} ${td}`,
      meta: [{ label: label('Basis', 'ভিত্তি'), value: label('Open invoice balances grouped by invoice date; opening balances shown as 90+ days', 'খোলা ইনভয়েসের বয়স অনুযায়ী বাকি ভাগ করা হয়েছে; প্রারম্ভিক বাকি ৯০ দিনের বেশি হিসেবে দেখানো হয়েছে') }],
      sections,
      total: { label: label('Total outstanding', 'মোট বকেয়া'), value: m(kind === 'receivable' ? totalDueAmount : totalPayableAmount) },
      printedAt: printedAtStamp(lang), printLabel: lang === 'bn' ? 'প্রিন্ট করুন' : 'Print',
    });
  };

  const profitLossReportDoc = (finance: PeriodFinance): ReportDoc => {
    const sale = finance.netSales; const cogs = finance.cogs; const gross = finance.grossProfit; const expense = finance.expense; const profit = finance.netProfit;
    return { language: lang, shop: business.name, title: label('Profit & Loss Statement', 'লাভ-ক্ষতির বিবরণী'), period: formatPeriodLabel(finance.start || profitFrom, finance.end || profitTo),
      meta: [{ label: lang === 'bn' ? 'মজুদে অন্তর্ভুক্ত ল্যান্ডিং খরচ' : 'Landed cost capitalized into inventory', value: m(finance.capitalizedLandedCost) }],
      sections: [{ title: label('Trading result', 'বাণিজ্যিক ফলাফল'), rows: [
        { label: label('Net sales', 'নিট বিক্রয়'), right: m(sale) }, { label: label('Cost of goods sold', 'বিক্রিত পণ্যের ক্রয়মূল্য'), right: m(cogs), neg: true },
        { label: label('Gross profit', 'মোট মুনাফা'), right: m(gross), bold: true }, { label: label('Operating expenses', 'পরিচালন ব্যয়'), right: m(expense), neg: true },
        { label: label('Other income / (expense)', 'অন্যান্য আয় / (ব্যয়)'), right: m(-(finance.otherIncomeExpense ?? 0)), neg: finance.otherIncomeExpense > 0 },
        { label: label('Net profit / (loss)', 'নিট মুনাফা / (ক্ষতি)'), right: m(profit), bold: true },
      ] }], total: { label: label('Net profit / (loss)', 'নিট মুনাফা / (ক্ষতি)'), value: m(profit), neg: profit < 0 },
      printedAt: printedAtStamp(lang), printLabel: lang === 'bn' ? 'প্রিন্ট করুন' : 'Print' };
  };

  const printProfitLoss = async () => {
    setProfitFrom(flt.from); setProfitTo(flt.to);
    const finance = f ?? await loadFinance('range', flt.from, flt.to);
    setReportViewDoc(profitLossReportDoc(finance));
  };

  const applyProfitLossDateFilter = async () => {
    try {
      const finance = await loadFinance('range', profitFrom, profitTo);
      setReportViewDoc(profitLossReportDoc(finance));
    } catch {
      showEntryError(lang, lang === 'bn' ? 'YYYY-MM-DD ফরম্যাটে শুরু ও শেষ তারিখ দিন।' : 'Enter valid start and end dates in YYYY-MM-DD format.');
    }
  };

  const printCashStatement = () => setReportViewDoc({ language: lang, shop: business.name, title: label('Cash & Bank Statement', 'নগদ ও ব্যাংক বিবরণী'), period: `${label('Balances as of', 'স্থিতি তারিখ')} ${td}`,
    sections: [{ title: label('Cash and bank accounts', 'নগদ ও ব্যাংক অ্যাকাউন্ট'), rows: moneyAccounts.map(a => ({ label: a.name, sub: `${a.type.toUpperCase()} · ${label('Opening balance', 'প্রারম্ভিক স্থিতি')} ${m(a.adjustedOpeningBalance ?? a.openingBalance)} · ${fd(a.openingDate)}`, right: m(a.balance), neg: a.balance < 0 })) }],
    total: { label: label('Total cash and bank', 'মোট নগদ ও ব্যাংক'), value: m(totalLiquidMoney), neg: totalLiquidMoney < 0 },
    note: label('This statement shows current account balances. Use each account ledger for dated money movements.', 'এই বিবরণীতে বর্তমান অ্যাকাউন্টের স্থিতি দেখানো হয়েছে। তারিখভিত্তিক লেনদেন দেখতে প্রতিটি অ্যাকাউন্টের খতিয়ান দেখুন।'),
    printedAt: printedAtStamp(lang), printLabel: lang === 'bn' ? 'প্রিন্ট করুন' : 'Print' });

  const printCashFlow = async () => {
    const flow = await api.cashflow(flt.from, flt.to);
    setReportViewDoc({ language: lang, shop: business.name, title: label('Cash Flow Statement', 'নগদ প্রবাহ বিবরণী'), period: formatPeriodLabel(flt.from, flt.to),
      sections: [{ title: lang === 'bn' ? 'পরিচালন নগদ প্রবাহ' : 'Operating cash flows', rows: [
        { label: lang === 'bn' ? 'গ্রাহকের কাছ থেকে আদায়' : 'Receipts from customers', right: m(flow.customerReceipts) },
        { label: lang === 'bn' ? 'সরবরাহকারীকে পরিশোধ' : 'Payments to suppliers', right: m(flow.supplierPayments), neg: true },
        { label: lang === 'bn' ? 'মজুদে যোগ করা ল্যান্ডিং খরচ' : 'Landed costs added to inventory', right: m(flow.inventoryCostPayments), neg: true },
        { label: lang === 'bn' ? 'খরচের পরিশোধ' : 'Expense payments', right: m(flow.expensePayments), neg: true },
        { label: lang === 'bn' ? 'ফেরত ও অন্যান্য অর্থের নিট প্রবাহ' : 'Net returns and other cash flows', right: m(flow.returnInflows - flow.returnOutflows + flow.otherInflows - flow.otherOutflows) },
        { label: lang === 'bn' ? 'নিট নগদ প্রবাহ' : 'Net cash flow', right: m(flow.netCashFlow), bold: true },
        { label: lang === 'bn' ? 'প্রারম্ভিক নগদ ও ব্যাংক' : 'Opening cash and bank', right: m(flow.openingBalance) },
        { label: lang === 'bn' ? 'সমাপনী নগদ ও ব্যাংক' : 'Closing cash and bank', right: m(flow.closingBalance), bold: true },
      ] }], total: { label: lang === 'bn' ? 'সমাপনী নগদ ও ব্যাংক' : 'Closing cash and bank', value: m(flow.closingBalance) },
      printedAt: printedAtStamp(lang), printLabel: lang === 'bn' ? 'প্রিন্ট / PDF সংরক্ষণ' : 'Print / Save PDF' });
  };

  const printBalanceSheet = async () => {
    const b = await api.balanceSheet(td);
    setReportViewDoc({ language: lang, shop: business.name, title: label('Balance sheet', 'উদ্বৃত্তপত্র'), period: `${label('As of', 'তারিখ')} ${b.asOf}`,
      sections: [
        { title: lang === 'bn' ? 'সম্পদ' : 'Assets', rows: [
          ...(b.accounts ? b.accounts.assets.map(account => ({ label: `${account.code} · ${account.name}`, right: m(account.balance) })) : [
            ...(b.assets.cash !== null ? [{ label: lang === 'bn' ? 'নগদ' : 'Cash', right: m(b.assets.cash) }] : []),
            ...(b.assets.bank !== null ? [{ label: lang === 'bn' ? 'ব্যাংক' : 'Bank', right: m(b.assets.bank) }] : []),
            ...(b.assets.wallets !== null ? [{ label: lang === 'bn' ? 'মোবাইল ওয়ালেট' : 'Digital wallets', right: m(b.assets.wallets) }] : []),
            { label: lang === 'bn' ? 'গ্রাহকের পাওনা' : 'Receivables', right: m(b.assets.receivables) },
            { label: lang === 'bn' ? 'মজুদ' : 'Inventory', right: m(b.assets.inventory) },
            ...(b.assets.other ? [{ label: lang === 'bn' ? 'অন্যান্য সম্পদ' : 'Other assets', right: m(b.assets.other) }] : []),
          ]),
          { label: lang === 'bn' ? 'মোট সম্পদ' : 'Total assets', right: m(b.assets.total), bold: true },
        ] },
        { title: lang === 'bn' ? 'দায় ও মালিকানা' : 'Liabilities and equity', rows: [
          ...(b.accounts ? b.accounts.liabilities.map(account => ({ label: `${account.code} · ${account.name}`, right: m(account.balance) })) : [
            { label: lang === 'bn' ? 'সরবরাহকারীর দেনা' : 'Payables', right: m(b.liabilities.payables) },
            ...(b.liabilities.other ? [{ label: lang === 'bn' ? 'অন্যান্য দায়' : 'Other liabilities', right: m(b.liabilities.other) }] : []),
          ]),
          ...(b.accounts ? b.accounts.equity.map(account => ({ label: account.code ? `${account.code} · ${account.name}` : account.name, right: m(account.balance) })) : [
            { label: lang === 'bn' ? 'জার্নালে নথিভুক্ত মালিকানা' : 'Owner equity from journal entries', right: m(b.journalEquity) },
            { label: lang === 'bn' ? 'অবশিষ্ট লাভ ও অন্যান্য মালিকানা' : 'Retained earnings and other equity', right: m(b.otherEquity) },
          ]),
          { label: lang === 'bn' ? 'মোট মালিকানা' : 'Total equity', right: m(b.equity), bold: true },
          { label: lang === 'bn' ? 'মোট দায় ও মালিকানা' : 'Total liabilities and equity', right: m(b.totalLiabilitiesAndEquity), bold: true },
        ] },
      ], note: lang === 'bn' ? 'জার্নাল এন্ট্রিতে সরাসরি নথিভুক্ত মালিকানা আলাদা দেখানো হয়েছে; অবশিষ্ট অংশ সমীকরণ মেলাতে লাভ ও অন্যান্য মালিকানা হিসেবে দেখানো হয়।' : 'Journal-posted owner equity is shown separately. The remaining amount includes retained earnings and other equity needed to reconcile the accounting equation.',
      total: { label: lang === 'bn' ? 'হিসাব সমতা' : 'Accounting equation', value: b.balanced ? (lang === 'bn' ? 'মিলেছে' : 'Balanced') : (lang === 'bn' ? 'মেলেনি' : 'Out of balance') }, printedAt: printedAtStamp(lang), printLabel: lang === 'bn' ? 'প্রিন্ট / PDF সংরক্ষণ' : 'Print / Save PDF' });
  };

  const journalEntriesReportDoc = (j: JournalEntries): ReportDoc => {
    const sections: ReportDoc['sections'] = j.entries.map(e => ({ title: `${e.date} · ${e.reference}`, rows: [
      ...e.lines.map(l => ({ label: l.account, sub: l.description, right: l.debit ? `${lang === 'bn' ? 'ডেবিট' : 'Dr'} ${m(l.debit)}` : `${lang === 'bn' ? 'ক্রেডিট' : 'Cr'} ${m(l.credit)}` })),
      { label: lang === 'bn' ? 'এন্ট্রি মোট (ডেবিট / ক্রেডিট)' : 'Entry total (debit / credit)', right: `${m(e.debitTotal)} / ${m(e.creditTotal)}`, bold: true },
    ] }));
    return { language: lang, shop: business.name, title: label('Journal entries', 'জার্নাল এন্ট্রি'), period: formatPeriodLabel(j.from, j.to), sections,
      note: j.balanced ? (lang === 'bn' ? 'প্রতিটি জার্নাল এন্ট্রিতে ডেবিট ও ক্রেডিট সমান।' : 'Each journal entry balances: total debits equal total credits.') : (lang === 'bn' ? 'কিছু এন্ট্রিতে ডেবিট ও ক্রেডিট মিলছে না; উৎস লেনদেন যাচাই করুন।' : 'Some entries do not balance. Review the source transactions.'),
      total: { label: lang === 'bn' ? 'সর্বমোট ডেবিট / ক্রেডিট' : 'Total debits / credits', value: `${m(j.debitTotal)} / ${m(j.creditTotal)}`, neg: !j.balanced }, printedAt: printedAtStamp(lang), printLabel: lang === 'bn' ? 'প্রিন্ট / PDF সংরক্ষণ' : 'Print / Save PDF' };
  };

  const printJournalEntries = async () => {
    setJournalFrom(flt.from); setJournalTo(flt.to);
    setJournalSearch(''); setJournalAccountFilter(''); setJournalStatusFilter('all'); setSelectedJournalEntry(null);
    const j = await api.journalEntries(flt.from, flt.to, true);
    setJournalData(j);
    setReportViewDoc(journalEntriesReportDoc(j));
  };

  const applyJournalDateFilter = async () => {
    try {
      const j = await api.journalEntries(journalFrom, journalTo, true);
      setJournalData(j);
      setSelectedJournalEntry(null);
      setReportViewDoc(journalEntriesReportDoc(j));
    } catch {
      showEntryError(lang, lang === 'bn' ? 'YYYY-MM-DD ফরম্যাটে শুরু ও শেষ তারিখ দিন।' : 'Enter valid start and end dates in YYYY-MM-DD format.');
    }
  };

  const changeJournalStatus = async (entry: NonNullable<typeof selectedJournalEntry>, status: 'draft' | 'posted' | 'cancelled') => {
    if (!entry.entryId) return;
    const prompt = status === 'cancelled'
      ? (lang === 'bn' ? 'এই জার্নাল এন্ট্রি বাতিল করবেন?' : 'Cancel this journal entry?')
      : status === 'draft' ? (lang === 'bn' ? 'এন্ট্রিটি খসড়ায় ফেরত যাবে এবং হিসাব থেকে বাদ যাবে।' : 'This entry will return to draft and be removed from posted balances.')
      : (lang === 'bn' ? 'এই খসড়া এন্ট্রি পোস্ট করবেন?' : 'Post this draft entry?');
    Alert.alert(lang === 'bn' ? 'নিশ্চিত করুন' : 'Confirm', prompt, [
      { text: lang === 'bn' ? 'বাতিল' : 'Back', style: 'cancel' },
      { text: status === 'cancelled' ? (lang === 'bn' ? 'বাতিল করুন' : 'Cancel entry') : status === 'draft' ? (lang === 'bn' ? 'খসড়ায় ফেরত' : 'Reset to draft') : (lang === 'bn' ? 'পোস্ট' : 'Post'), style: status === 'cancelled' ? 'destructive' : 'default', onPress: () => {
        void api.setJournalEntryStatus(entry.entryId!, status).then(() => applyJournalDateFilter()).catch(error => showEntryError(lang, error instanceof Error ? error.message : (lang === 'bn' ? 'জার্নাল স্ট্যাটাস পরিবর্তন করা যায়নি।' : 'Could not update journal status.')));
      } },
    ]);
  };

  const ledgerReportDoc = (g: GeneralLedger, account?: GeneralLedger['accounts'][number]): ReportDoc => {
    const sideAmount = (amount: number) => `${m(Math.abs(amount))} ${amount < 0 ? label('Cr', 'ক্রেডিট') : label('Dr', 'ডেবিট')}`;
    const sections: ReportDoc['sections'] = account ? [{ title: `${account.code} · ${account.account}`, rows: [
      { label: lang === 'bn' ? 'প্রারম্ভিক স্থিতি' : 'Opening balance', right: sideAmount(account.openingBalance), bold: true },
      ...account.rows.map(r => ({ label: r.journalNo, sub: `${r.date} · ${r.reference} · ${r.description}`, right: `${r.debit ? `${label('Dr', 'ডেবিট')} ${m(r.debit)}` : `${label('Cr', 'ক্রেডিট')} ${m(r.credit)}`} · ${sideAmount(r.runningBalance)}` })),
      { label: lang === 'bn' ? 'সমাপনী স্থিতি' : 'Closing balance', right: sideAmount(account.closingBalance), bold: true },
    ] }] : [{ title: lang === 'bn' ? 'অ্যাকাউন্ট সারাংশ' : 'Account summary', rows: g.accounts.map(a => ({
      label: `${a.code} · ${a.account}`, sub: `${lang === 'bn' ? 'প্রারম্ভিক' : 'Opening'} ${sideAmount(a.openingBalance)} · ${lang === 'bn' ? 'ডেবিট' : 'Dr'} ${m(a.periodDebit)} · ${lang === 'bn' ? 'ক্রেডিট' : 'Cr'} ${m(a.periodCredit)}`,
      right: sideAmount(a.closingBalance),
    })) }];
    return { language: lang, shop: business.name, title: label('General ledger', 'সাধারণ খতিয়ান'), period: formatPeriodLabel(g.from, g.to), sections,
      note: account ? (lang === 'bn' ? 'প্রতিটি লাইনে জার্নাল নম্বর, লেনদেন এবং চলতি স্থিতি দেখানো হয়েছে।' : 'Each posting shows its journal number, transaction details, and running balance.') : (lang === 'bn' ? 'অ্যাকাউন্ট নির্বাচন করলে ওই অ্যাকাউন্টের জার্নালভিত্তিক লেনদেন দেখা যাবে।' : 'Select an account to review its journal postings.'),
      printedAt: printedAtStamp(lang), printLabel: lang === 'bn' ? 'প্রিন্ট / PDF সংরক্ষণ' : 'Print / Save PDF' };
  };

  const printGeneralLedger = async () => {
    const g = await api.generalLedger(flt.from, flt.to);
    setGeneralLedgerData(g);
    setSelectedLedgerAccount(null);
    setReportViewDoc(ledgerReportDoc(g));
  };

  const downloadActiveReport = () => setReportCenterOpen(true);

  // Net Working Capital & Solvency
  const netSolvencyScore = totalLiquidMoney + totalDueAmount - totalPayableAmount;
  const solvencyRatio = totalPayableAmount > 0 ? ((totalLiquidMoney + totalDueAmount) / totalPayableAmount) * 100 : 999;

  // Inventory valuation
  const inventorySummary = useMemo(() => {
    const totalBags = products.reduce((sum, p) => sum + Math.round(p.qty / (p.mediumBagKg || 50)), 0);
    const totalKg = products.reduce((sum, p) => sum + Math.max(0, p.qty), 0);
    const totalValuation = products.reduce((sum, p) => sum + (p.qty * (p.cost > 0 ? p.cost : p.price || 0)), 0);
    return { totalBags, totalKg, totalValuation };
  }, [products]);

  // Timeline Data Points for Bezier Curves
  const timelineData = useMemo(() => {
    // Generate dates to display in chart
    let dateList: string[] = [];
    if (flt.from === flt.to) {
      // If 1-day selected, show last 7 days ending on selected day
      for (let i = 6; i >= 0; i--) {
        dateList.push(addDays(flt.to, -i));
      }
    } else {
      // Calculate day span
      const d1 = new Date(flt.from);
      const d2 = new Date(flt.to);
      const diffDays = Math.min(31, Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24))));
      
      if (diffDays <= 14) {
        // Show every day
        for (let i = 0; i <= diffDays; i++) {
          dateList.push(addDays(flt.from, i));
        }
      } else {
        // Sample 10-12 key points across period
        const step = Math.ceil(diffDays / 10);
        for (let i = 0; i <= diffDays; i += step) {
          dateList.push(addDays(flt.from, i));
        }
        if (!dateList.includes(flt.to)) dateList.push(flt.to);
      }
    }

    return dateList.map(ds => {
      // Sales on this date
      const daySalesRecs = sales.filter(s => s.date === ds);
      const daySales = daySalesRecs.reduce((sum, r) => sum + r.total, 0);
      const daySalesProfit = daySalesRecs.reduce((sum, r) => sum + r.profit, 0);
      
      // Expenses on this date
      const dayExpRecs = expenses.filter(e => e.date === ds);
      const dayExpense = dayExpRecs.reduce((sum, e) => sum + e.amount, 0);

      // Net profit = sales profit - expenses
      const dayProfit = daySalesProfit - dayExpense;
      const margin = daySales > 0 ? Math.round((dayProfit / daySales) * 100) : 0;

      return {
        date: ds,
        label: ds.slice(5), // MM-DD
        sales: daySales,
        expense: dayExpense,
        profit: dayProfit,
        margin,
      };
    });
  }, [flt, sales, expenses]);

  // Set default active tooltip for curve
  useEffect(() => {
    if (timelineData.length > 0 && !activeCurvePoint) {
      const lastPoint = timelineData[timelineData.length - 1];
      setActiveCurvePoint(lastPoint);
    }
  }, [timelineData]);

  // Formatted Period Label
  const formatPeriodLabel = (dsFrom: string, dsTo: string) => {
    if (dsFrom === dsTo) {
      return dsFrom === td ? (lang === 'bn' ? 'আজকের হিসাব' : 'Today') : fd(dsFrom);
    }
    return `${fd(dsFrom)} – ${fd(dsTo)}`;
  };

  // Change preset
  const handleSelectPreset = (p: 'today' | 'last7' | 'thisMonth' | 'last3m' | 'thisYear') => {
    setFltPreset(p);
    setFlt(presetRange(p, td, business.fiscalStartMonth));
  };

  // Expense categories breakdown
  const expenseBreakdown = useMemo(() => {
    const periodExps = expenses.filter(e => inPeriod(e.date));
    const totalExp = periodExps.reduce((sum, e) => sum + e.amount, 0);
    const catMap: Record<string, number> = {};
    for (const e of periodExps) {
      const cat = expenseCategoryLabel(e.category, e.customName);
      catMap[cat] = (catMap[cat] || 0) + e.amount;
    }
    return Object.entries(catMap)
      .map(([cat, amt]) => ({
        category: cat,
        amount: amt,
        pct: totalExp > 0 ? Math.round((amt / totalExp) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses, flt, expenseCategoryLabel]);

  // Print Complete Accounts Statement
  const handlePrintStatement = () => {
    const doc: ReportDoc = {
      language: lang,
      shop: business.name,
      title: lang === 'bn' ? 'আর্থিক বিবরণী ও অডিট রিপোর্ট' : 'Financial Statement & Audit Report',
      period: formatPeriodLabel(flt.from, flt.to),
      meta: [
        { label: lang === 'bn' ? 'তারিখ পরিসীমা' : 'Period', value: `${flt.from} to ${flt.to}` },
        { label: lang === 'bn' ? 'প্রিন্ট সময়' : 'Printed At', value: printedAtStamp(lang) },
      ],
      sections: [
        {
          title: lang === 'bn' ? '১. নগদ ও ব্যাংক তহবিল' : '1. Liquid Funds',
          rows: [
            { label: lang === 'bn' ? 'ক্যাশ ইন হ্যান্ড (ক্যাশ বাক্স)' : 'Cash in Hand', right: m(totalCashInHand) },
            { label: lang === 'bn' ? 'ব্যাংক ও মোবাইল ব্যাংকিং' : 'Bank Accounts', right: m(totalBankBalances) },
            { label: lang === 'bn' ? 'সর্বমোট তরল তহবিল' : 'Total Liquid Reserves', right: m(totalLiquidMoney), bold: true },
          ],
        },
        {
          title: lang === 'bn' ? '২. আয় ও পরিচালন মুনাফা' : '2. Income & Net Profit',
          rows: [
            { label: lang === 'bn' ? 'মোট বিক্রয়' : 'Net Sales', right: m(fSale) },
            { label: lang === 'bn' ? 'বিক্রিত পণ্যের ক্রয়মূল্য' : 'Cost of Goods Sold', right: m(fCogs), neg: true },
            { label: lang === 'bn' ? 'মোট বাণিজ্যিক মুনাফা' : 'Gross Profit', right: m(fGrossProfit), bold: true },
            { label: lang === 'bn' ? 'পরিচালন ব্যয়' : 'Operating Expenses', right: m(fExp), neg: true },
            { label: lang === 'bn' ? 'নিট মুনাফা' : 'Net Profit', right: m(fProfit), bold: true },
          ],
        },
        {
          title: lang === 'bn' ? '৩. পাওনা ও দেনা স্থিতি' : '3. Receivables & Payables',
          rows: [
            { label: lang === 'bn' ? 'বাজারে কাস্টমারদের কাছে মোট বাকি' : 'Customer Receivables', right: m(totalDueAmount) },
            { label: lang === 'bn' ? 'মহাজন/মিলের মোট দেনা' : 'Vendor Payables', right: m(totalPayableAmount), neg: true },
            { label: lang === 'bn' ? 'নিট কার্যকরী মূলধন' : 'Net Working Capital', right: m(netSolvencyScore), bold: true },
          ],
        },
      ],
      total: {
        label: lang === 'bn' ? 'ব্যবসায়িক নিট উদ্বৃত্ত' : 'Net Business Surplus',
        value: m(netSolvencyScore),
      },
      printedAt: printedAtStamp(lang),
      printLabel: lang === 'bn' ? 'প্রিন্ট করুন' : 'Print',
    };
    printReport(doc);
  };

  // Q&A Pre-Configured Questions & Dynamic Engine
  

  // Selected Q&A or search match
  

  // Bezier curve coordinate math
  const chartHeight = 220;
  const chartWidth = 740;
  const paddingLeft = 45;
  const paddingRight = 25;
  const paddingTop = 25;
  const paddingBottom = 35;
  const usableWidth = chartWidth - paddingLeft - paddingRight;
  const usableHeight = chartHeight - paddingTop - paddingBottom;

  const maxChartVal = useMemo(() => {
    let m = 1000;
    for (const p of timelineData) {
      if (p.sales > m) m = p.sales;
      if (p.expense > m) m = p.expense;
      if (p.profit > m) m = p.profit;
    }
    return Math.ceil(m * 1.18);
  }, [timelineData]);

  // Generate smooth SVG curve path string
  const getCurvePath = (values: number[]) => {
    if (values.length === 0) return '';
    const points = values.map((val, idx) => {
      const x = paddingLeft + (idx / Math.max(1, values.length - 1)) * usableWidth;
      const normalizedY = Math.max(0, val) / maxChartVal;
      const y = paddingTop + usableHeight - normalizedY * usableHeight;
      return { x, y };
    });

    if (points.length === 1) {
      return `M ${points[0].x} ${points[0].y}`;
    }

    let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];

      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;

      d += ` C ${cp1x.toFixed(1)} ${cp1y.toFixed(1)}, ${cp2x.toFixed(1)} ${cp2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
    }
    return d;
  };

  const getAreaPath = (values: number[]) => {
    const curve = getCurvePath(values);
    if (!curve) return '';
    const lastX = paddingLeft + usableWidth;
    const bottomY = paddingTop + usableHeight;
    return `${curve} L ${lastX.toFixed(1)} ${bottomY.toFixed(1)} L ${paddingLeft.toFixed(1)} ${bottomY.toFixed(1)} Z`;
  };

  // Filtered lists for ledgers
  const filteredCustomerDues = useMemo(() => {
    const q = dueSearch.trim().toLowerCase();
    if (!q) return customerDues;
    return customerDues.filter(item =>
      item.customer.name.toLowerCase().startsWith(q) || (item.customer.mobile && item.customer.mobile.startsWith(q))
    );
  }, [customerDues, dueSearch]);

  const filteredVendorPayables = useMemo(() => {
    const q = paySearch.trim().toLowerCase();
    if (!q) return vendorPayables;
    return vendorPayables.filter(item =>
      item.vendor.name.toLowerCase().startsWith(q) || (item.vendor.mobile && item.vendor.mobile.startsWith(q))
    );
  }, [vendorPayables, paySearch]);

  const filteredExpensesList = useMemo(() => {
    const q = expSearch.trim().toLowerCase();
    return expenses
      .filter(e => {
        if (expCatFilter !== 'all' && e.category !== expCatFilter) return false;
        if (!q) return true;
        const catName = expenseCategoryLabel(e.category, e.customName);
        const accountName = e.accountName ?? moneyAccounts.find(account => account.id === e.accountId)?.name ?? '';
        return catName.toLowerCase().startsWith(q) || e.category.toLowerCase().startsWith(q) || (e.note && e.note.toLowerCase().startsWith(q)) || (e.voucherNo ?? '').toLowerCase().startsWith(q) || accountName.toLowerCase().startsWith(q);
      })
      .sort((a, b) => b.date.localeCompare(a.date) || String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')) || b.id.localeCompare(a.id));
  }, [expenses, moneyAccounts, expSearch, expCatFilter, expenseCategoryLabel]);

  const expenseRegisterDoc: ReportDoc = {
    language: lang, shop: business.name, title: label('Expense Register', 'ব্যয় রেজিস্টার'), period: label('Filtered entries', 'ফিল্টার করা এন্ট্রি'),
    sections: [{ title: label('Expenses', 'ব্যয়সমূহ'), rows: filteredExpensesList.map(e => ({
      label: expenseCategoryLabel(e.category, e.customName),
      sub: [fd(e.date), e.voucherNo ? `#${e.voucherNo}` : '', e.accountName ?? moneyAccounts.find(account => account.id === e.accountId)?.name ?? '', e.note ?? ''].filter(Boolean).join(' · '),
      right: m(Math.abs(e.amount)), neg: true,
    })) }],
    total: { label: label('Total expenses', 'মোট ব্যয়'), value: m(filteredExpensesList.reduce((sum, e) => sum + Math.abs(e.amount), 0)), neg: true },
    printedAt: printedAtStamp(lang), printLabel: label('Print', 'প্রিন্ট'),
  };
  const houseExpenseRegisterDoc: ReportDoc = {
    language: lang, shop: business.name, title: label('House Expenses Register', 'বাসার খরচ রেজিস্টার'), period: label('All recorded entries', 'সকল নথিভুক্ত এন্ট্রি'),
    sections: [{ title: label('House expenses', 'বাসার খরচ'), rows: houseExpenseRows.map(row => ({ label: row.description, sub: [row.transactionNo, fd(row.date), row.accountName, row.note].filter(Boolean).join(' · '), right: m(row.amount), neg: true })) }],
    total: { label: label('Total house expenses', 'মোট বাসার খরচ'), value: m(houseExpenseRows.reduce((sum, row) => sum + row.amount, 0)), neg: true },
    printedAt: printedAtStamp(lang), printLabel: label('Print', 'প্রিন্ট'),
  };

  const toggleReportType = (id: AccountReportType) => {
    setGeneratedReport(null);
    setSelectedReportTypes(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  };
  const generateMultiReport = async () => {
    if (reportDataLoading) return;
    if (!selectedReportTypes.length) { showEntryError(lang, label('Select at least one report type.', 'অন্তত একটি রিপোর্টের ধরন নির্বাচন করুন।')); return; }
    if (reportFrom && reportTo && reportFrom > reportTo) { showEntryError(lang, label('The start date must be before the end date.', 'শুরুর তারিখ শেষ তারিখের আগে হতে হবে।')); return; }
    setReportGenerating(true);
    try {
      const from = reportFrom || '1900-01-01';
      const to = reportTo || today();
      const inRange = (date: string) => date >= from && date <= to;
      const productMatches = (items?: { productId: string }[]) => !reportProductId || Boolean(items?.some(item => item.productId === reportProductId));
      const selectedCustomer = customers.find(customer => customer.id === reportCustomerId);
      const selectedSupplier = vendors.find(vendor => vendor.id === reportSupplierId);
      const selectedProduct = products.find(product => product.id === reportProductId);
      const sections: ReportDoc['sections'] = [];
      const addSection = (type: AccountReportType, rows: ReportRow[]) => {
        const option = ACCOUNT_REPORT_TYPES.find(item => item.id === type)!;
        sections.push({ title: lang === 'bn' ? option.bn : option.en, rows });
      };
      for (const type of selectedReportTypes) {
        if (type === 'sales') {
          const rows = sales.filter(row => inRange(row.date) && (!reportCustomerId || row.customerId === reportCustomerId) && productMatches(row.items))
            .map(row => { const party = customers.find(customer => customer.id === row.customerId); return { label: row.invoiceNo ?? row.id, sub: [row.date, party?.code, party?.name, row.items?.map(item => item.productName).join(', ')].filter(Boolean).join(' · '), right: m(row.total), neg: row.due > 0 }; });
          addSection(type, rows);
        } else if (type === 'purchases') {
          const rows = purchases.filter(row => inRange(row.date) && (!reportSupplierId || row.vendorId === reportSupplierId) && productMatches(row.items))
            .map(row => { const party = vendors.find(vendor => vendor.id === row.vendorId); return { label: row.invoiceNo ?? row.id, sub: [row.date, party?.code, party?.name, row.items?.map(item => item.productName).join(', ')].filter(Boolean).join(' · '), right: m(row.total), neg: row.due > 0 }; });
          addSection(type, rows);
        } else if (type === 'collections' || type === 'supplierPayments') {
          const customerKind = type === 'collections';
          const rowsSource = customerKind ? cTx : vTx;
          const partyList = customerKind ? customers : vendors;
          const partyFilter = customerKind ? reportCustomerId : reportSupplierId;
          const rows = rowsSource.filter(row => row.kind === 'payment' && inRange(row.date) && (!partyFilter || row.partyId === partyFilter))
            .map(row => { const party = partyList.find(item => item.id === row.partyId); return { label: row.transactionNo ?? row.ref ?? row.id, sub: [row.date, party?.code, party?.name, row.note, row.method].filter(Boolean).join(' · '), right: m(row.amount) }; });
          addSection(type, rows);
        } else if (type === 'deposits' || type === 'withdrawals') {
          const sourceType = type === 'deposits' ? 'deposit' : 'withdrawal';
          addSection(type, reportMoneyRows.filter(row => row.sourceType === sourceType && inRange(row.date)).map(row => ({ label: row.transactionNo, sub: [row.date, row.moneyAccount?.name, row.note].filter(Boolean).join(' · '), right: m(row.amount), neg: type === 'withdrawals' })));
        } else if (type === 'expenses') {
          addSection(type, expenses.filter(row => inRange(row.date)).map(row => ({ label: expenseCategoryLabel(row.category, row.customName), sub: [row.date, row.voucherNo, row.accountName, row.note].filter(Boolean).join(' · '), right: m(Math.abs(row.amount)), neg: true })));
        } else if (type === 'houseExpenses') {
          addSection(type, reportHouseRows.filter(row => inRange(row.date)).map(row => ({ label: row.description, sub: [row.transactionNo, row.date, row.accountName, row.note].filter(Boolean).join(' · '), right: m(row.amount), neg: true })));
        } else if (type === 'inventory') {
          addSection(type, products.filter(product => !reportProductId || product.id === reportProductId).map(product => ({ label: product.name, sub: [product.code, `${localeDigits(String(product.qty), lang)} ${product.uom}`].filter(Boolean).join(' · '), right: m(product.stockValue ?? product.qty * product.cost) })));
        } else if (type === 'stockMovements') {
          addSection(type, reportStockRows.filter(row => inRange(row.date) && (!reportProductId || row.productId === reportProductId)).map(row => {
            const product = products.find(item => item.id === row.productId);
            return { label: `${product?.name ?? row.productId} · ${row.type}`, sub: [row.date, row.bucket, row.note].filter(Boolean).join(' · '), right: m(row.value), neg: row.value < 0 };
          }));
        } else if (type === 'returns') {
          addSection(type, returns.filter(row => inRange(row.date)).map(row => ({ label: row.returnNo ?? row.id, sub: `${row.date} · ${row.kind === 'sale' ? label('Sales return', 'বিক্রয় ফেরত') : label('Purchase return', 'ক্রয় ফেরত')}`, right: m(row.amount) })));
        } else if (type === 'customerBalances') {
          const rows = customers.filter(customer => (!reportCustomerId || customer.id === reportCustomerId) && (!reportProductId || sales.some(saleRow => saleRow.customerId === customer.id && saleRow.items?.some(item => item.productId === reportProductId))))
            .map(customer => ({ label: `${customer.code ?? ''} ${customer.name}`.trim(), sub: localeDigits(customer.mobile, lang), right: m(bal('c', customer.id).balance) }));
          addSection(type, rows);
        } else if (type === 'supplierBalances') {
          const rows = vendors.filter(vendor => (!reportSupplierId || vendor.id === reportSupplierId) && (!reportProductId || purchases.some(purchaseRow => purchaseRow.vendorId === vendor.id && purchaseRow.items?.some(item => item.productId === reportProductId))))
            .map(vendor => ({ label: `${vendor.code ?? ''} ${vendor.name}`.trim(), sub: localeDigits(vendor.mobile, lang), right: m(bal('v', vendor.id).balance) }));
          addSection(type, rows);
        } else if (type === 'customers') {
          addSection(type, customers.filter(customer => !reportCustomerId || customer.id === reportCustomerId).map(customer => ({ label: customer.name, sub: [customer.code, localeDigits(customer.mobile, lang), customer.address].filter(Boolean).join(' · '), right: m(bal('c', customer.id).balance) })));
        } else if (type === 'suppliers') {
          addSection(type, vendors.filter(vendor => !reportSupplierId || vendor.id === reportSupplierId).map(vendor => ({ label: vendor.name, sub: [vendor.code, localeDigits(vendor.mobile, lang), vendor.address].filter(Boolean).join(' · '), right: m(bal('v', vendor.id).balance) })));
        } else if (type === 'transfers') {
          addSection(type, moneyTransfers.filter(row => inRange(row.date)).map(row => ({ label: row.transferNo, sub: `${row.date} · ${row.from} → ${row.to}${row.note ? ` · ${row.note}` : ''}`, right: m(row.amount) })));
        } else if (type === 'cashflow') {
          const flow = await api.cashflow(from, to);
          addSection(type, [
            { label: label('Customer receipts', 'গ্রাহকের কাছ থেকে আদায়'), right: m(flow.customerReceipts) },
            { label: label('Supplier payments', 'সরবরাহকারীকে পরিশোধ'), right: m(flow.supplierPayments), neg: true },
            { label: label('Expenses', 'ব্যয়'), right: m(flow.expensePayments), neg: true },
            { label: label('Other inflows', 'অন্যান্য জমা'), right: m(flow.otherInflows) },
            { label: label('Other outflows', 'অন্যান্য উত্তোলন'), right: m(flow.otherOutflows), neg: true },
            { label: label('Net cash flow', 'নিট নগদ প্রবাহ'), right: m(flow.netCashFlow), neg: flow.netCashFlow < 0, bold: true },
          ]);
        } else if (type === 'profitLoss') {
          const finance = await api.finance('range', from, to);
          addSection(type, [
            { label: label('Net sales', 'নিট বিক্রয়'), right: m(finance.netSales) },
            { label: label('Cost of goods sold', 'বিক্রিত পণ্যের খরচ'), right: m(finance.cogs), neg: true },
            { label: label('Gross profit', 'মোট মুনাফা'), right: m(finance.grossProfit), bold: true },
            { label: label('Expenses', 'ব্যয়'), right: m(finance.expense), neg: true },
            { label: label('Net profit', 'নিট লাভ'), right: m(finance.netProfit), neg: finance.netProfit < 0, bold: true },
          ]);
        } else if (type === 'journal') {
          const journal = await api.journalEntries(from, to);
          addSection(type, journal.entries.flatMap(entry => entry.lines.map(line => ({ label: `${entry.reference} · ${line.account}`, sub: `${entry.date} · ${line.description}`, right: `${line.debit ? `${label('Dr', 'ডেবিট')} ${m(line.debit)}` : ''}${line.debit && line.credit ? ' · ' : ''}${line.credit ? `${label('Cr', 'ক্রেডিট')} ${m(line.credit)}` : ''}` }))));
        }
      }
      const period = reportFrom || reportTo ? `${reportFrom || '1900-01-01'} – ${reportTo || today()}` : label('All available dates', 'সকল উপলব্ধ তারিখ');
      const meta = [
        selectedReportTypes.some(type => type === 'customerBalances' || type === 'supplierBalances' || type === 'customers' || type === 'suppliers')
          ? { label: label('Balance basis', 'ব্যালেন্সের ভিত্তি'), value: label('Current balances as of today; date range applies only to transaction reports.', 'আজকের বর্তমান ব্যালেন্স; তারিখের সীমা শুধু লেনদেনের রিপোর্টে প্রযোজ্য।') } : null,
        selectedCustomer ? { label: label('Customer', 'গ্রাহক'), value: `${selectedCustomer.code ?? ''} ${selectedCustomer.name}`.trim() } : null,
        selectedSupplier ? { label: label('Supplier', 'সরবরাহকারী'), value: `${selectedSupplier.code ?? ''} ${selectedSupplier.name}`.trim() } : null,
        selectedProduct ? { label: label('Product', 'পণ্য'), value: `${selectedProduct.code ?? ''} ${selectedProduct.name}`.trim() } : null,
      ].filter((item): item is { label: string; value: string } => Boolean(item));
      const doc: ReportDoc = { language: lang, shop: business.name, title: customReportTitle.trim() || label('Combined business reports', 'সমন্বিত ব্যবসায়িক প্রতিবেদন'), period, meta, sections,
        printedAt: printedAtStamp(lang), printLabel: label('Print / Save PDF', 'প্রিন্ট / PDF সংরক্ষণ') };
      setGeneratedReport(doc);
    } catch (error) {
      showEntryError(lang, error instanceof Error ? error.message : label('Could not generate report.', 'রিপোর্ট তৈরি করা যায়নি।'));
    } finally { setReportGenerating(false); }
  };

  if (reportCenterOpen) return <View style={{ flex: 1, backgroundColor: '#F1F5F9' }}>
    <View style={{ backgroundColor: '#123D64', paddingHorizontal: 18, paddingVertical: 15, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <TouchableOpacity accessibilityRole="button" onPress={() => { setReportCenterOpen(false); setGeneratedReport(null); }} style={{ paddingVertical: 8, paddingRight: 6 }}><Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '700' }}>‹ {label('Back', 'ফিরে যান')}</Text></TouchableOpacity>
      <View style={{ flex: 1 }}><Text style={{ color: '#FFFFFF', fontSize: 21, fontWeight: '800' }}>{label('Report center', 'রিপোর্ট কেন্দ্র')}</Text><Text style={{ color: '#D6E7F5', fontSize: 12 }}>{label('Choose multiple reports and apply shared filters.', 'একাধিক রিপোর্ট বেছে নিয়ে সাধারণ ফিল্টার প্রয়োগ করুন।')}</Text></View>
    </View>
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ width: '100%', maxWidth: 1100, alignSelf: 'center', padding: 16, gap: 12 }}>
      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14 }}>
        <Text style={{ color: '#123D64', fontSize: 16, fontWeight: '800', marginBottom: 10 }}>{label('Customize report', 'রিপোর্ট কাস্টমাইজ করুন')}</Text>
        <Field label={label('Report title (optional)', 'রিপোর্টের শিরোনাম (ঐচ্ছিক)')} value={customReportTitle} onChange={value => { setCustomReportTitle(value); setGeneratedReport(null); }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 190 }}><DateField label={label('From date', 'শুরুর তারিখ')} value={reportFrom} onChange={value => { setReportFrom(value); setGeneratedReport(null); }} clearable /></View>
          <View style={{ flex: 1, minWidth: 190 }}><DateField label={label('To date', 'শেষ তারিখ')} value={reportTo} onChange={value => { setReportTo(value); setGeneratedReport(null); }} clearable minDate={reportFrom || undefined} /></View>
        </View>
        <Text style={{ color: '#475569', fontSize: 12, fontWeight: '700', marginBottom: 5 }}>{label('Optional filters (apply where relevant)', 'ঐচ্ছিক ফিল্টার (প্রযোজ্য রিপোর্টে প্রয়োগ হবে)')}</Text>
        <SearchableSelect items={customers} value={reportCustomerId} onPick={id => { setReportCustomerId(id); setGeneratedReport(null); }} placeholder={label('Select customer', 'গ্রাহক নির্বাচন করুন')} match={matchParty} subOf={item => item.code ? `${label('Code', 'কোড')}: ${item.code}` : item.mobile} />
        <SearchableSelect items={vendors} value={reportSupplierId} onPick={id => { setReportSupplierId(id); setGeneratedReport(null); }} placeholder={label('Select supplier', 'সরবরাহকারী নির্বাচন করুন')} match={matchParty} subOf={item => item.code ? `${label('Code', 'কোড')}: ${item.code}` : item.mobile} />
        <SearchableSelect items={products} value={reportProductId} onPick={id => { setReportProductId(id); setGeneratedReport(null); }} placeholder={label('Select product', 'পণ্য নির্বাচন করুন')} match={matchProduct} subOf={item => item.code} />
      </View>
      <View style={{ backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#E2E8F0', padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <View><Text style={{ color: '#123D64', fontSize: 16, fontWeight: '800' }}>{label('Report types', 'রিপোর্টের ধরন')}</Text><Text style={{ color: '#64748B', fontSize: 12 }}>{selectedReportTypes.length} {label('selected', 'টি নির্বাচিত')}</Text></View>
          <View style={{ flexDirection: 'row', gap: 7 }}><Btn kind="ghost" label={label('Select all', 'সব নির্বাচন')} onPress={() => { setSelectedReportTypes(ACCOUNT_REPORT_TYPES.map(item => item.id)); setGeneratedReport(null); }} /><Btn kind="ghost" label={label('Clear', 'মুছুন')} onPress={() => { setSelectedReportTypes([]); setGeneratedReport(null); }} /></View>
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {ACCOUNT_REPORT_TYPES.map(option => { const selected = selectedReportTypes.includes(option.id); return <TouchableOpacity key={option.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => toggleReportType(option.id)} style={{ borderWidth: 1, borderColor: selected ? '#1D4ED8' : '#CBD5E1', backgroundColor: selected ? '#EFF6FF' : '#FFFFFF', borderRadius: 10, paddingHorizontal: 11, paddingVertical: 9 }}><Text style={{ color: selected ? '#1D4ED8' : '#334155', fontWeight: '700' }}>{selected ? '✓ ' : ''}{lang === 'bn' ? option.bn : option.en}</Text></TouchableOpacity>; })}
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        <Btn icon={icons.report} label={reportDataLoading ? label('Loading data…', 'তথ্য লোড হচ্ছে…') : reportGenerating ? label('Generating…', 'তৈরি হচ্ছে…') : label('Generate preview', 'প্রিভিউ তৈরি করুন')} onPress={() => { if (!reportGenerating) void generateMultiReport(); }} />
        {generatedReport ? <>
          <Btn kind="ghost" icon={icons.print} label={label('Print / Save PDF', 'প্রিন্ট / PDF সংরক্ষণ')} onPress={() => { if (!printReport(generatedReport)) Alert.alert(label('Could not open print dialog', 'প্রিন্ট খোলা যায়নি')); }} />
          <Btn kind="ghost" icon={icons.excel} label={label('Download Excel (CSV)', 'এক্সেল ডাউনলোড (CSV)')} onPress={() => { downloadReportCSV(generatedReport, `business_reports_${today()}.csv`); }} />
        </> : null}
      </View>
      {reportDataLoading ? <Text style={{ color: '#64748B' }}>{label('Loading report data…', 'রিপোর্টের তথ্য লোড হচ্ছে…')}</Text> : null}
      {generatedReport ? <View style={{ gap: 10 }}>
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 14, borderWidth: 1, borderColor: '#CBD5E1', padding: 14 }}><Text style={{ color: '#0F172A', fontSize: 18, fontWeight: '800' }}>{generatedReport.title}</Text><Text style={{ color: '#64748B', marginTop: 3 }}>{generatedReport.period}</Text>{generatedReport.meta?.map((item, index) => <Text key={index} style={{ color: '#64748B', marginTop: 3 }}>{item.label}: {item.value}</Text>)}</View>
        {generatedReport.sections.map((section, index) => <View key={`${section.title}-${index}`} style={{ backgroundColor: '#FFFFFF', borderRadius: 12, borderWidth: 1, borderColor: '#E2E8F0', padding: 13 }}><Text style={{ color: '#123D64', fontWeight: '800', marginBottom: 7 }}>{section.title} · {section.rows.length}</Text>{section.rows.slice(0, 6).map((row, rowIndex) => <Row key={`${index}-${rowIndex}`} left={row.label} sub={row.sub} right={row.right} neg={row.neg} />)}{section.rows.length > 6 ? <Text style={{ color: '#64748B', marginTop: 6 }}>{label(`and ${section.rows.length - 6} more rows`, `আরও ${section.rows.length - 6}টি সারি`)}</Text> : null}{section.rows.length === 0 ? <Empty /> : null}</View>)}
      </View> : null}
    </ScrollView>
  </View>;

  const isJournalReport = reportViewDoc?.title === 'Journal entries' || reportViewDoc?.title === 'জার্নাল এন্ট্রি';
  const journalAccounts = [...new Set(journalData?.entries.flatMap(entry => entry.lines.map(line => line.account)) ?? [])].sort((a, b) => a.localeCompare(b));
  const visibleJournalEntries = (journalData?.entries ?? []).filter(entry => {
    const status = entry.status ?? 'posted';
    const query = journalSearch.trim().toLocaleLowerCase();
    const matchesSearch = !query || `${entry.reference} ${entry.date} ${entry.lines.map(line => `${line.account} ${line.description}`).join(' ')}`.toLocaleLowerCase().includes(query);
    return matchesSearch && (!journalAccountFilter || entry.lines.some(line => line.account === journalAccountFilter)) && (journalStatusFilter === 'all' || status === journalStatusFilter);
  });

  if (reportViewDoc) return (<>
    <View style={{ flex: 1, backgroundColor: '#F1F5F9' }}>
      <View style={{ backgroundColor: '#FFFFFF', paddingHorizontal: 18, paddingTop: 14, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
        <TouchableOpacity onPress={() => setReportViewDoc(null)} accessibilityRole="button" style={{ paddingVertical: 8, alignSelf: 'flex-start' }}>
          <Text style={{ color: '#1D4ED8', fontSize: 15, fontWeight: '700' }}>‹ {lang === 'bn' ? 'রিপোর্টসমূহে ফিরুন' : 'Back to reports'}</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <Text style={{ color: '#0F172A', fontSize: 22, fontWeight: '800' }}>{reportViewDoc.title}</Text>
            <Text style={{ color: '#64748B', fontSize: 13, marginTop: 3 }}>{reportViewDoc.period}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 9 }}>
            <TouchableOpacity accessibilityRole="button" onPress={() => { if (!previewReport(reportViewDoc)) Alert.alert(lang === 'bn' ? 'প্রিভিউ খোলা যায়নি' : 'Could not open preview', lang === 'bn' ? 'পপ-আপ অনুমতি দিন এবং আবার চেষ্টা করুন।' : 'Allow the preview window and try again.'); }} style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#1D4ED8', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 11 }}>
              <Text style={{ color: '#1D4ED8', fontWeight: '700' }}>{lang === 'bn' ? 'প্রিভিউ' : 'Preview'}</Text>
            </TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={() => { if (!printReport(reportViewDoc)) Alert.alert(lang === 'bn' ? 'প্রিন্ট খোলা যায়নি' : 'Could not open print dialog'); }} style={{ backgroundColor: '#1D4ED8', borderRadius: 10, paddingHorizontal: 18, paddingVertical: 11 }}>
              <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{lang === 'bn' ? 'প্রিন্ট' : 'Print'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
      <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 960, alignSelf: 'center', padding: 18, gap: 14 }}>
        <View style={{ backgroundColor: '#FFFFFF', borderRadius: 16, padding: 22, borderWidth: 1, borderColor: '#E2E8F0' }}>
          <Text style={{ color: '#0F172A', textAlign: 'center', fontSize: 19, fontWeight: '800' }}>{reportViewDoc.shop}</Text>
          <Text style={{ color: '#475569', textAlign: 'center', fontSize: 13, marginTop: 5 }}>{reportViewDoc.period}</Text>
          {(reportViewDoc.meta ?? []).map((item, index) => <Text key={`meta-${index}`} style={{ color: '#475569', marginTop: 10 }}>{item.label}: {item.value}</Text>)}
          {(reportViewDoc.title === 'Journal entries' || reportViewDoc.title === 'জার্নাল এন্ট্রি') && <View style={{ flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 18, padding: 14, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' }}>
            <View style={{ flex: 1, minWidth: 145 }}><DateField label={lang === 'bn' ? 'শুরুর তারিখ' : 'From date'} value={journalFrom} onChange={setJournalFrom} clearable /></View>
            <View style={{ flex: 1, minWidth: 145 }}><DateField label={lang === 'bn' ? 'শেষ তারিখ' : 'To date'} value={journalTo} onChange={setJournalTo} clearable minDate={journalFrom || undefined} /></View>
            <TouchableOpacity accessibilityRole="button" onPress={() => { void applyJournalDateFilter(); }} style={{ backgroundColor: '#1D4ED8', borderRadius: 8, paddingHorizontal: 17, paddingVertical: 12 }}><Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{lang === 'bn' ? 'ফিল্টার করুন' : 'Apply filter'}</Text></TouchableOpacity>
          </View>}
          {(reportViewDoc.title === 'Journal entries' || reportViewDoc.title === 'জার্নাল এন্ট্রি') && reportViewDoc.sections.length === 0 && <Text style={{ color: '#64748B', textAlign: 'center', paddingVertical: 24 }}>{lang === 'bn' ? 'এই তারিখের মধ্যে কোনো জার্নাল এন্ট্রি নেই।' : 'No journal entries in this date range.'}</Text>}
          {(reportViewDoc.title === 'Journal entries' || reportViewDoc.title === 'জার্নাল এন্ট্রি') && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
            <TouchableOpacity onPress={() => setJournalComposer({})} style={{ backgroundColor: '#1D4ED8', borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 }}><Text style={{ color: '#fff', fontWeight: '700' }}>{lang === 'bn' ? 'নতুন জার্নাল এন্ট্রি' : 'New journal entry'}</Text></TouchableOpacity>
            <TouchableOpacity onPress={() => setChartModalOpen(true)} style={{ backgroundColor: '#E2E8F0', borderRadius: 9, paddingHorizontal: 13, paddingVertical: 10 }}><Text style={{ color: '#1E293B', fontWeight: '700' }}>{lang === 'bn' ? 'হিসাবের চার্ট' : 'Chart of accounts'}</Text></TouchableOpacity>
          </View>}
          {isJournalReport && journalData ? <View style={{ marginTop: 16, gap: 12 }}>
            <View style={{ gap: 9, padding: 13, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12 }}>
              <Text style={{ color: '#0F172A', fontSize: 16, fontWeight: '800' }}>{lang === 'bn' ? 'জার্নাল ফিল্টার' : 'Journal filters'}</Text>
              <TextInput value={journalSearch} onChangeText={setJournalSearch} placeholder={lang === 'bn' ? 'জার্নাল নম্বর, অ্যাকাউন্ট বা বিবরণ খুঁজুন' : 'Search journal, account or description'} placeholderTextColor="#94A3B8" style={{ minHeight: 44, borderWidth: 1, borderColor: '#CBD5E1', backgroundColor: '#FFFFFF', borderRadius: 9, paddingHorizontal: 12, color: '#0F172A' }} />
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {[['all', lang === 'bn' ? 'সব স্ট্যাটাস' : 'All statuses'], ['draft', lang === 'bn' ? 'খসড়া' : 'Draft'], ['posted', lang === 'bn' ? 'পোস্ট করা' : 'Posted'], ['cancelled', lang === 'bn' ? 'বাতিল' : 'Cancelled']].map(([key, title]) => <TouchableOpacity key={key} onPress={() => setJournalStatusFilter(key)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, backgroundColor: journalStatusFilter === key ? '#DBEAFE' : '#FFFFFF', borderWidth: 1, borderColor: journalStatusFilter === key ? '#2563EB' : '#CBD5E1' }}><Text style={{ color: journalStatusFilter === key ? '#1D4ED8' : '#475569', fontWeight: '700', fontSize: 12 }}>{title}</Text></TouchableOpacity>)}
              </View>
              {journalAccounts.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                {[['', lang === 'bn' ? 'সব অ্যাকাউন্ট' : 'All accounts'], ...journalAccounts.map(account => [account, account])].map(([key, title]) => <TouchableOpacity key={key || 'all'} onPress={() => setJournalAccountFilter(key)} style={{ paddingHorizontal: 10, paddingVertical: 7, borderRadius: 16, backgroundColor: journalAccountFilter === key ? '#DBEAFE' : '#FFFFFF', borderWidth: 1, borderColor: journalAccountFilter === key ? '#2563EB' : '#CBD5E1' }}><Text style={{ color: journalAccountFilter === key ? '#1D4ED8' : '#475569', fontWeight: '700', fontSize: 12 }}>{title}</Text></TouchableOpacity>)}
              </ScrollView> : null}
            </View>
            {selectedJournalEntry ? <View style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 4, overflow: 'hidden' }}>
              <View style={{ paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#D8DEE5', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <TouchableOpacity onPress={() => setJournalComposer({})} style={{ borderWidth: 1, borderColor: '#7C3AED', borderRadius: 6, paddingHorizontal: 17, paddingVertical: 9 }}><Text style={{ color: '#6D28D9', fontSize: 15 }}>{lang === 'bn' ? 'নতুন' : 'New'}</Text></TouchableOpacity>
                <View style={{ flex: 1 }}><Text style={{ color: '#0F766E', fontSize: 15, fontWeight: '700' }}>{lang === 'bn' ? 'জার্নাল এন্ট্রি' : 'Journal Entries'}</Text><Text style={{ color: '#334155', fontSize: 16, marginTop: 2 }}>{selectedJournalEntry.reference} <Text style={{ color: '#94A3B8' }}>⚙</Text></Text></View>
                <TouchableOpacity onPress={() => setSelectedJournalEntry(null)} style={{ paddingHorizontal: 10, paddingVertical: 8 }}><Text style={{ color: '#475569', fontWeight: '700' }}>‹ {lang === 'bn' ? 'তালিকায় ফিরুন' : 'Back to list'}</Text></TouchableOpacity>
              </View>
              {selectedJournalEntry.editable && selectedJournalEntry.entryId ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 18, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#D8DEE5', backgroundColor: '#F8FAFC' }}>
                {(selectedJournalEntry.status ?? 'posted') === 'draft' ? <>
                  <Btn label={lang === 'bn' ? 'সম্পাদনা' : 'Edit'} onPress={() => setJournalComposer({ initial: { id: selectedJournalEntry.entryId!, entryNo: selectedJournalEntry.lines[0]?.journalNo ?? selectedJournalEntry.reference, date: selectedJournalEntry.date, memo: selectedJournalEntry.lines[0]?.description.split(' · ')[0] ?? '', sourceType: selectedJournalEntry.sourceType ?? 'manual', sourceId: selectedJournalEntry.sourceId, sourceRef: selectedJournalEntry.sourceRef, active: true, status: 'draft', lines: selectedJournalEntry.lines.map(line => ({ accountId: line.accountId ?? '', description: line.description.includes(' · ') ? line.description.slice(line.description.indexOf(' · ') + 3) : '', debit: line.debit, credit: line.credit })) } })} />
                  <Btn kind="ghost" label={lang === 'bn' ? 'পোস্ট করুন' : 'Post'} onPress={() => changeJournalStatus(selectedJournalEntry, 'posted')} />
                </> : <Btn kind="ghost" label={lang === 'bn' ? 'খসড়ায় ফেরত' : 'Reset to Draft'} onPress={() => changeJournalStatus(selectedJournalEntry, 'draft')} />}
                {(selectedJournalEntry.status ?? 'posted') !== 'cancelled' ? <Btn kind="danger" label={lang === 'bn' ? 'বাতিল করুন' : 'Cancel Entry'} onPress={() => changeJournalStatus(selectedJournalEntry, 'cancelled')} /> : null}
              </View> : null}
              <View style={{ padding: 22 }}>
                <Text style={{ color: '#111827', fontSize: 38, fontWeight: '600', marginBottom: 17 }}>{selectedJournalEntry.lines[0]?.journalNo ?? selectedJournalEntry.reference}</Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 26, marginBottom: 26 }}>
                  <View style={{ flex: 1, minWidth: 250, gap: 13 }}><View style={{ flexDirection: 'row', gap: 16 }}><Text style={{ width: 105, color: '#111827', fontWeight: '700' }}>{lang === 'bn' ? 'রেফারেন্স' : 'Reference'}</Text><Text style={{ color: '#475569' }}>{selectedJournalEntry.sourceRef ?? selectedJournalEntry.reference}</Text></View></View>
                  <View style={{ flex: 1, minWidth: 270, gap: 13 }}>
                    <View style={{ flexDirection: 'row', gap: 16 }}><Text style={{ width: 125, color: '#6B7280', fontWeight: '700' }}>{lang === 'bn' ? 'হিসাবের তারিখ' : 'Accounting Date'}</Text><Text style={{ color: '#475569' }}>{fd(selectedJournalEntry.date)}</Text></View>
                    <View style={{ flexDirection: 'row', gap: 16 }}><Text style={{ width: 125, color: '#6B7280', fontWeight: '700' }}>{lang === 'bn' ? 'জার্নাল' : 'Journal'}</Text><Text style={{ color: '#475569' }}>{selectedJournalEntry.sourceType === 'manual' ? (lang === 'bn' ? 'ম্যানুয়াল জার্নাল' : 'Miscellaneous Operations') : selectedJournalEntry.lines.find(line => line.accountType === 'asset')?.account ?? (lang === 'bn' ? 'স্বয়ংক্রিয় জার্নাল' : 'Automatic Journal')}</Text></View>
                  </View>
                </View>
                <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#CBD5E1', marginBottom: 0 }}>
                  <TouchableOpacity onPress={() => setJournalDetailTab('items')} style={{ paddingHorizontal: 17, paddingVertical: 11, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: journalDetailTab === 'items' ? '#A78BFA' : '#D1D5DB', backgroundColor: journalDetailTab === 'items' ? '#FFFFFF' : '#F8FAFC' }}><Text style={{ color: '#334155' }}>{lang === 'bn' ? 'জার্নাল আইটেম' : 'Journal Items'}</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => setJournalDetailTab('info')} style={{ paddingHorizontal: 17, paddingVertical: 11, borderTopWidth: 1, borderLeftWidth: 1, borderRightWidth: 1, borderColor: journalDetailTab === 'info' ? '#A78BFA' : '#D1D5DB', backgroundColor: journalDetailTab === 'info' ? '#FFFFFF' : '#F8FAFC' }}><Text style={{ color: '#334155' }}>{lang === 'bn' ? 'অন্যান্য তথ্য' : 'Other Info'}</Text></TouchableOpacity>
                </View>
                {journalDetailTab === 'items' ? <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={{ minWidth: 880 }}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', backgroundColor: '#F8FAFC', borderBottomWidth: 1, borderColor: '#CBD5E1', paddingVertical: 12, paddingHorizontal: 9 }}>
                      {[lang === 'bn' ? 'সম্পদ বিভাগ' : 'Asset Category', lang === 'bn' ? 'অ্যাকাউন্ট' : 'Account', lang === 'bn' ? 'লেবেল' : 'Label', lang === 'bn' ? 'ডেবিট' : 'Debit', lang === 'bn' ? 'ক্রেডিট' : 'Credit'].map((heading, i) => <Text key={heading} style={{ flex: [1.1, 2, 4, 1.4, 1.4][i], textAlign: i >= 3 ? 'right' : 'left', color: '#111827', fontWeight: '700', paddingHorizontal: 5 }}>{heading}</Text>)}
                    </View>
                    {selectedJournalEntry.lines.map((line, index) => <View key={`${line.accountId}-${index}`} style={{ flexDirection: 'row', paddingVertical: 12, paddingHorizontal: 9, borderBottomWidth: 1, borderColor: '#D1D5DB', alignItems: 'center' }}>
                      <Text style={{ flex: 1.1, color: '#64748B', paddingHorizontal: 5 }}>{line.accountType ?? ''}</Text>
                      <Text style={{ flex: 2, color: '#475569', paddingHorizontal: 5 }}>{line.accountCode ? `${line.accountCode} ` : ''}{line.account}</Text>
                      <Text style={{ flex: 4, color: '#475569', paddingHorizontal: 5 }}>{line.description}</Text>
                      <Text style={{ flex: 1.4, color: '#475569', textAlign: 'right', paddingHorizontal: 5 }}>{m(line.debit)}</Text>
                      <Text style={{ flex: 1.4, color: '#475569', textAlign: 'right', paddingHorizontal: 5 }}>{m(line.credit)}</Text>
                    </View>)}
                    <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 24, paddingVertical: 13, paddingHorizontal: 15 }}><Text style={{ color: '#334155', fontWeight: '800' }}>{lang === 'bn' ? 'ডেবিট' : 'Debit'}: {m(selectedJournalEntry.debitTotal)}</Text><Text style={{ color: '#334155', fontWeight: '800' }}>{lang === 'bn' ? 'ক্রেডিট' : 'Credit'}: {m(selectedJournalEntry.creditTotal)}</Text></View>
                  </View>
                </ScrollView> : <View style={{ minHeight: 120, padding: 17, gap: 12, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0' }}>
                  <Text style={{ color: '#475569' }}>{lang === 'bn' ? 'বিবরণ' : 'Memo'}: {selectedJournalEntry.lines[0]?.description.split(' · ')[0] ?? ''}</Text>
                  <Text style={{ color: '#475569' }}>{lang === 'bn' ? 'উৎসের ধরন' : 'Source type'}: {selectedJournalEntry.sourceType}</Text>
                  <Text style={{ color: '#475569' }}>{lang === 'bn' ? 'স্ট্যাটাস' : 'Status'}: {(selectedJournalEntry.status ?? 'posted').toUpperCase()}</Text>
                </View>}
              </View>
            </View> : <View style={{ gap: 8 }}>
              {visibleJournalEntries.map(entry => <TouchableOpacity key={entry.entryId ?? entry.reference} onPress={() => setSelectedJournalEntry(entry)} style={{ padding: 13, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                <View style={{ flex: 1 }}><Text style={{ color: '#1D4ED8', fontWeight: '800' }}>{entry.reference}</Text><Text style={{ color: '#334155', marginTop: 3 }}>{entry.date} · {entry.lines.map(line => line.account).join(', ')}</Text><Text style={{ color: '#64748B', fontSize: 12, marginTop: 3 }}>{entry.lines[0]?.description}</Text></View>
                <View style={{ alignItems: 'flex-end' }}><Text style={{ color: '#0F172A', fontWeight: '800' }}>{m(entry.debitTotal)}</Text><Text style={{ color: (entry.status ?? 'posted') === 'posted' ? '#15803D' : (entry.status ?? '') === 'draft' ? '#B45309' : '#B91C1C', fontSize: 11, fontWeight: '800', marginTop: 4 }}>{entry.status ?? 'posted'}</Text></View>
              </TouchableOpacity>)}
              {!visibleJournalEntries.length ? <Text style={{ textAlign: 'center', padding: 20, color: '#64748B' }}>{lang === 'bn' ? 'এই ফিল্টারে কোনো জার্নাল নেই।' : 'No journal entries match these filters.'}</Text> : null}
            </View>}
          </View> : null}
          {reportViewDoc.title === 'Profit & Loss Statement' && <View style={{ flexDirection: 'row', alignItems: 'flex-end', flexWrap: 'wrap', gap: 10, marginTop: 18, padding: 14, borderRadius: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0' }}>
            <View style={{ flex: 1, minWidth: 145 }}><DateField label={lang === 'bn' ? 'শুরুর তারিখ' : 'From date'} value={profitFrom} onChange={setProfitFrom} clearable /></View>
            <View style={{ flex: 1, minWidth: 145 }}><DateField label={lang === 'bn' ? 'শেষ তারিখ' : 'To date'} value={profitTo} onChange={setProfitTo} clearable minDate={profitFrom || undefined} /></View>
            <TouchableOpacity accessibilityRole="button" onPress={() => { void applyProfitLossDateFilter(); }} style={{ backgroundColor: '#1D4ED8', borderRadius: 8, paddingHorizontal: 17, paddingVertical: 12 }}><Text style={{ color: '#FFFFFF', fontWeight: '700' }}>{lang === 'bn' ? 'ফিল্টার করুন' : 'Apply filter'}</Text></TouchableOpacity>
          </View>}
          {reportViewDoc.title === 'General ledger' && generalLedgerData ? (
            selectedLedgerAccount ? (() => {
              const account = generalLedgerData.accounts.find(a => a.account === selectedLedgerAccount);
              if (!account) return null;
              const side = (amount: number) => `${m(Math.abs(amount))} ${amount < 0 ? 'Cr' : 'Dr'}`;
              const compactHeader = { color: '#475569', fontSize: 11, fontWeight: '800' as const };
              return <View style={{ marginTop: 20 }}>
                <TouchableOpacity accessibilityRole="button" onPress={() => { setSelectedLedgerAccount(null); setReportViewDoc(ledgerReportDoc(generalLedgerData)); }} style={{ alignSelf: 'flex-start', paddingVertical: 7, paddingHorizontal: 11, borderRadius: 8, backgroundColor: '#EFF6FF', marginBottom: 12 }}>
                  <Text style={{ color: '#1D4ED8', fontWeight: '700' }}>‹ {lang === 'bn' ? 'সকল অ্যাকাউন্ট' : 'All accounts'}</Text>
                </TouchableOpacity>
                <Text style={{ color: '#123B5D', fontSize: 17, fontWeight: '800', marginBottom: 4 }}>{account.code} · {account.account}</Text>
                <Text style={{ color: '#64748B', marginBottom: 14 }}>{lang === 'bn' ? 'প্রারম্ভিক স্থিতি' : 'Opening balance'}: {side(account.openingBalance)}</Text>
                <View style={{ flexDirection: 'row', paddingVertical: 9, borderBottomWidth: 2, borderBottomColor: '#CBD5E1' }}>
                  <Text style={[compactHeader, { flex: 4 }]}>{lang === 'bn' ? 'জার্নাল / তারিখ / বিবরণ' : 'Journal / date / details'}</Text>
                  <Text style={[compactHeader, { flex: 1, textAlign: 'right' }]}>{lang === 'bn' ? 'ডেবিট' : 'Debit'}</Text>
                  <Text style={[compactHeader, { flex: 1, textAlign: 'right' }]}>{lang === 'bn' ? 'ক্রেডিট' : 'Credit'}</Text>
                  <Text style={[compactHeader, { flex: 1.4, textAlign: 'right' }]}>{lang === 'bn' ? 'স্থিতি' : 'Balance'}</Text>
                </View>
                {account.rows.length ? account.rows.map((row, index) => <View key={`${row.journalNo}-${index}`} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
                  <View style={{ flex: 4, paddingRight: 7 }}><Text style={{ color: '#1D4ED8', fontSize: 12, fontWeight: '800' }}>{row.journalNo}</Text><Text style={{ color: '#334155', fontSize: 12, marginTop: 2 }}>{row.date} · {row.reference}</Text><Text style={{ color: '#64748B', fontSize: 12, marginTop: 2 }}>{row.description}</Text></View>
                  <Text style={{ flex: 1, textAlign: 'right', color: '#0F172A', fontSize: 12 }}>{row.debit ? m(row.debit) : '—'}</Text>
                  <Text style={{ flex: 1, textAlign: 'right', color: '#0F172A', fontSize: 12 }}>{row.credit ? m(row.credit) : '—'}</Text>
                  <Text style={{ flex: 1.4, textAlign: 'right', color: '#0F172A', fontSize: 12, fontWeight: '700' }}>{side(row.runningBalance)}</Text>
                </View>) : <Text style={{ color: '#64748B', paddingVertical: 18, textAlign: 'center' }}>{lang === 'bn' ? 'এই সময়সীমায় কোনো লেনদেন নেই।' : 'No transactions for this period.'}</Text>}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginTop: 15, paddingTop: 12, borderTopWidth: 2, borderTopColor: '#1D4ED8' }}>
                  <Text style={{ color: '#334155', fontWeight: '700' }}>{lang === 'bn' ? 'মোট ডেবিট' : 'Period debits'}: {m(account.periodDebit)}</Text>
                  <Text style={{ color: '#334155', fontWeight: '700' }}>{lang === 'bn' ? 'মোট ক্রেডিট' : 'Period credits'}: {m(account.periodCredit)}</Text>
                  <Text style={{ color: '#0F172A', fontWeight: '800' }}>{lang === 'bn' ? 'সমাপনী স্থিতি' : 'Closing balance'}: {side(account.closingBalance)}</Text>
                </View>
              </View>;
            })() : <View style={{ marginTop: 18, gap: 10 }}>
              <Text style={{ color: '#123B5D', fontSize: 16, fontWeight: '800', marginBottom: 3 }}>{lang === 'bn' ? 'অ্যাকাউন্ট তালিকা ও নিট স্থিতি' : 'Accounts and net balances'}</Text>
              {generalLedgerData.accounts.map(account => <TouchableOpacity key={account.account} accessibilityRole="button" onPress={() => { setSelectedLedgerAccount(account.account); setReportViewDoc(ledgerReportDoc(generalLedgerData, account)); }} style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                <View style={{ flex: 1 }}><Text style={{ color: '#1D4ED8', fontSize: 12, fontWeight: '800' }}>{account.code}</Text><Text style={{ color: '#0F172A', fontWeight: '700', marginTop: 2 }}>{account.account}</Text><Text style={{ color: '#64748B', fontSize: 11, marginTop: 3 }}>{lang === 'bn' ? 'ডেবিট' : 'Dr'} {m(account.periodDebit)} · {lang === 'bn' ? 'ক্রেডিট' : 'Cr'} {m(account.periodCredit)}</Text></View>
                <View style={{ alignItems: 'flex-end' }}><Text style={{ color: '#0F172A', fontWeight: '800' }}>{m(account.netBalance)} {account.balanceSide}</Text><Text style={{ color: '#1D4ED8', fontSize: 12, fontWeight: '700', marginTop: 5 }}>{lang === 'bn' ? 'খুলুন' : 'View account'} ›</Text></View>
              </TouchableOpacity>)}
              {!generalLedgerData.accounts.length && <Text style={{ color: '#64748B', paddingVertical: 18, textAlign: 'center' }}>{lang === 'bn' ? 'কোনো অ্যাকাউন্ট লেনদেন পাওয়া যায়নি।' : 'No account activity found.'}</Text>}
            </View>
          ) : !isJournalReport && reportViewDoc.sections.map((section, sectionIndex) => (
            <View key={`section-${sectionIndex}`} style={{ marginTop: 20 }}>
              {!!section.title && <Text style={{ color: '#123B5D', fontSize: 15, fontWeight: '800', marginBottom: 6 }}>{section.title}</Text>}
              {section.rows.map((row, rowIndex) => (
                <View key={`row-${sectionIndex}-${rowIndex}`} style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 14, paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
                  <View style={{ flex: 1 }}><Text style={{ color: '#1E293B', fontWeight: row.bold ? '800' : '500' }}>{row.label}</Text>{row.sub ? <Text style={{ color: '#64748B', fontSize: 12, marginTop: 2 }}>{row.sub}</Text> : null}</View>
                  <Text style={{ color: row.neg ? '#DC2626' : '#0F172A', fontWeight: row.bold ? '800' : '600', textAlign: 'right' }}>{row.right}</Text>
                </View>
              ))}
            </View>
          ))}
          {reportViewDoc.total && <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 14, borderTopWidth: 2, borderTopColor: '#1D4ED8', marginTop: 16, paddingTop: 12 }}><Text style={{ color: '#0F172A', fontWeight: '800', flex: 1 }}>{reportViewDoc.total.label}</Text><Text style={{ color: reportViewDoc.total.neg ? '#DC2626' : '#0F172A', fontWeight: '800' }}>{reportViewDoc.total.value}</Text></View>}
          {reportViewDoc.note ? <Text style={{ color: '#64748B', fontSize: 12, marginTop: 14, lineHeight: 18 }}>{reportViewDoc.note}</Text> : null}
          <Text style={{ color: '#94A3B8', fontSize: 11, textAlign: 'right', marginTop: 18 }}>{reportViewDoc.printedAt}</Text>
        </View>
      </ScrollView>
    </View>
    {journalComposer ? <JournalEntryModal initial={journalComposer.initial} onClose={() => setJournalComposer(null)} onSaved={() => { setJournalComposer(null); void applyJournalDateFilter(); }} /> : null}
    {chartModalOpen ? <ChartOfAccountsModal onClose={() => setChartModalOpen(false)} onSaved={() => { setChartModalOpen(false); void applyJournalDateFilter(); }} /> : null}
  </>);

  return (
    <ScrollView style={styles.screenBg} contentContainerStyle={styles.scrollContent}>
      {/* 1. EXECUTIVE HEADER BANNER */}
      {/* 1. SKEUOMORPHIC HEADER BAR - Royal Blue #1c70b9 */}
      <View style={styles.headerBar}>
        <View style={styles.headerGlossSheen} pointerEvents="none" />
        <View style={styles.headerLeft}>
          <View style={styles.titleIconBadge}>
            <AppIcon name={icons.accounts} size={22} iconColor="#FFFFFF" />
          </View>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.headerTitle}>
                {lang === 'bn' ? 'অ্যাকাউন্টিং ড্যাশবোর্ড' : 'Accounting Dashboard'}
              </Text>
              
            </View>
            
          </View>
        </View>

        {/* Quick Action Toolbar */}
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.headerActionBtnWhite} onPress={() => setMoneyEntry('in')} activeOpacity={0.85}>
            <AppIcon name={icons.moneyIn} size={16} iconColor="#168A64" />
            <Text style={styles.headerActionBtnWhiteText}>{lang === 'bn' ? 'জমা' : 'Deposit'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.headerActionBtnTranslucent} onPress={() => setMoneyEntry('out')} activeOpacity={0.85}>
            <AppIcon name={icons.moneyOut} size={16} iconColor="#FFFFFF" />
            <Text style={styles.headerActionBtnTranslucentText}>{lang === 'bn' ? 'উত্তোলন' : 'Withdraw'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.headerActionBtnWhite}
            onPress={() => go?.('collect')}
            activeOpacity={0.85}
          >
            <AppIcon name={icons.collect} size={16} iconColor="#1c70b9" />
            <Text style={styles.headerActionBtnWhiteText}>
              {lang === 'bn' ? 'কালেকশন' : 'Collect'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerActionBtnTranslucent}
            onPress={() => go?.('pay')}
            activeOpacity={0.85}
          >
            <AppIcon name={icons.pay} size={16} iconColor="#FFFFFF" />
            <Text style={styles.headerActionBtnTranslucentText}>
              {lang === 'bn' ? 'মহাজন পরিশোধ' : 'Pay Vendor'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerActionBtnTranslucent}
            onPress={() => setTransferModalOpen(true)}
            activeOpacity={0.85}
          >
            <AppIcon name={icons.transfer} size={16} iconColor="#FFFFFF" />
            <Text style={styles.headerActionBtnTranslucentText}>
              {lang === 'bn' ? 'ফান্ড ট্রান্সফার' : 'Transfer'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerActionBtnTranslucent}
            onPress={() => setReportCenterOpen(true)}
            activeOpacity={0.85}
          >
            <AppIcon name={icons.print} size={16} iconColor="#FFFFFF" />
            <Text style={styles.headerActionBtnTranslucentText}>
              {lang === 'bn' ? 'রিপোর্ট' : 'Reports'}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Period Preset Filter Card */}
      <View style={styles.periodCard}>
        <View style={styles.presetButtonsRow}>
          {(['today', 'last7', 'thisMonth', 'last3m', 'thisYear'] as const).map(p => {
            const active = fltPreset === p;
            const label =
              p === 'today'
                ? (lang === 'bn' ? 'আজ' : 'Today')
                : p === 'last7'
                ? (lang === 'bn' ? 'গত ৭ দিন' : 'Last 7 Days')
                : p === 'thisMonth'
                ? (lang === 'bn' ? 'এই মাস' : 'This Month')
                : p === 'last3m'
                ? (lang === 'bn' ? 'শেষ ৩ মাস' : 'Last 3 Months')
                : (lang === 'bn' ? 'চলতি অর্থবছর' : 'Fiscal Year');
            return (
              <TouchableOpacity
                key={p}
                style={[styles.presetChip, active && styles.presetChipActive]}
                onPress={() => handleSelectPreset(p)}
              >
                <Text style={[styles.presetChipText, active && styles.presetChipTextActive]}>
                  {label}
                </Text>
              </TouchableOpacity>
            );
          })}

          <TouchableOpacity
            style={[styles.presetChip, fltPreset === 'custom' && styles.presetChipActive, { flexDirection: 'row', alignItems: 'center', gap: 6 }]}
            onPress={() => setFltModalOpen(true)}
          >
            <AppIcon name={icons.calendar} size={16} iconColor={fltPreset === 'custom' ? '#1c70b9' : '#64748B'} />
            <Text style={[styles.presetChipText, fltPreset === 'custom' && styles.presetChipTextActive]}>
              {formatPeriodLabel(flt.from, flt.to)}
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={downloadActiveReport} style={{ alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 10, paddingHorizontal: 13, paddingVertical: 9, borderRadius: 10, backgroundColor: '#EAF1F7' }}>
          <AppIcon name={icons.excel} size={17} iconColor="#123B5D" />
          <Text style={{ color: '#123B5D', fontSize: 13, fontWeight: '700' }}>{lang === 'bn' ? 'একাধিক রিপোর্ট ডাউনলোড' : 'Download multiple reports'}</Text>
        </TouchableOpacity>

        {/* Business Health Quick Badge */}
        <View style={styles.solvencyBannerPill}>
          <Text style={styles.solvencyPillLabel}>
            {lang === 'bn' ? 'তারল্য নিরাপত্তা:' : 'Solvency:'}
          </Text>
          <Text style={[styles.solvencyPillValue, { color: solvencyRatio >= 100 ? '#10B981' : '#EF4444' }]}>
            {solvencyRatio >= 100
              ? (lang === 'bn' ? `নিরাপদ (${toBnDigits(String(Math.min(999, Math.round(solvencyRatio))))}% কাভারেজ)` : `Healthy (${Math.min(999, Math.round(solvencyRatio))}% Coverage)`)
              : (lang === 'bn' ? `সতর্কতা: দেনা বেশি (${toBnDigits(String(Math.round(solvencyRatio)))}%)` : `Caution: Low Coverage (${Math.round(solvencyRatio)}%)`)}
          </Text>
        </View>
      </View>

      {/* 2. EXECUTIVE FINANCIAL KPI CARDS GRID */}
      {false && <View style={styles.kpiGridContainer}>
        {/* Card 1: Total Liquid Funds */}
        <TouchableOpacity
          style={[styles.kpiCard, { borderTopColor: '#10B981', borderTopWidth: 4 }]}
          onPress={() => go?.('bank')}
        >
          <View style={styles.kpiCardHeader}>
            <Text style={styles.kpiCardTitle}>{lang === 'bn' ? 'মোট তরল তহবিল' : 'Total Liquid Funds'}</Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: '#ECFDF5' }]}>
              <AppIcon name={icons.bankCash} size={20} iconColor="#10B981" />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: '#0F172A' }]}>{m(totalLiquidMoney)}</Text>
          <View style={styles.kpiCardFooter}>
            <Text style={styles.kpiFooterNote}>
              {lang === 'bn'
                ? `ক্যাশ: ${m(totalCashInHand)} • ব্যাংক: ${m(totalBankBalances)}`
                : `Cash: ${m(totalCashInHand)} • Bank: ${m(totalBankBalances)}`}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Card 2: Net Sales */}
        <TouchableOpacity
          style={[styles.kpiCard, { borderTopColor: '#3B82F6', borderTopWidth: 4 }]}
          onPress={() => setKpiModal('sales')}
        >
          <View style={styles.kpiCardHeader}>
            <Text style={styles.kpiCardTitle}>{lang === 'bn' ? 'নিট চাল বিক্রয়' : 'Net Sales'}</Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: '#EFF6FF' }]}>
              <AppIcon name={icons.sale} size={20} iconColor="#3B82F6" />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: '#1E293B' }]}>{m(fSale)}</Text>
          <View style={styles.kpiCardFooter}>
            <Text style={styles.kpiFooterNote}>
              {lang === 'bn' ? `নগদ আদায়: ${m(fCollect)}` : `Collected: ${m(fCollect)}`}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Card 3: Gross Profit */}
        <TouchableOpacity
          style={[styles.kpiCard, { borderTopColor: '#8B5CF6', borderTopWidth: 4 }]}
          onPress={() => setKpiModal('profit')}
        >
          <View style={styles.kpiCardHeader}>
            <Text style={styles.kpiCardTitle}>{lang === 'bn' ? 'মোট বাণিজ্যিক লাভ' : 'Gross Profit'}</Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: '#F5F3FF' }]}>
              <AppIcon name={icons.profit} size={20} iconColor="#8B5CF6" />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: '#059669' }]}>{m(fGrossProfit)}</Text>
          <View style={styles.kpiCardFooter}>
            <Text style={styles.kpiFooterNote}>
              {fSale > 0 ? `${lang === 'bn' ? 'গ্রস মার্জিন' : 'Gross Margin'}: ${Math.round((fGrossProfit / fSale) * 100)}%` : '—'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Card 4: Operating Expenses */}
        <TouchableOpacity
          style={[styles.kpiCard, { borderTopColor: '#F59E0B', borderTopWidth: 4 }]}
          onPress={() => setKpiModal('expense')}
        >
          <View style={styles.kpiCardHeader}>
            <Text style={styles.kpiCardTitle}>{lang === 'bn' ? 'পরিচালন ও দোকান খরচ' : 'Operating Expenses'}</Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: '#FFFBEB' }]}>
              <AppIcon name={icons.expense} size={20} iconColor="#F59E0B" />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: '#D97706' }]}>{m(fExp)}</Text>
          <View style={styles.kpiCardFooter}>
            <Text style={styles.kpiFooterNote}>
              {fSale > 0 ? `${lang === 'bn' ? 'বিক্রয়ের' : 'Of Sales'}: ${Math.round((fExp / fSale) * 100)}%` : '—'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Card 5: Net Profit (আসল লাভ) */}
        <TouchableOpacity
          style={[styles.kpiCard, { borderTopColor: fProfit >= 0 ? '#10B981' : '#EF4444', borderTopWidth: 4, backgroundColor: fProfit >= 0 ? '#F0FDF4' : '#FEF2F2' }]}
          onPress={() => setKpiModal('profit')}
        >
          <View style={styles.kpiCardHeader}>
            <Text style={[styles.kpiCardTitle, { fontWeight: '700', color: fProfit >= 0 ? '#065F46' : '#991B1B' }]}>
              {lang === 'bn' ? 'প্রকৃত নিট মুনাফা (আসল লাভ)' : 'Net Profit in Pocket'}
            </Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: fProfit >= 0 ? '#DCFCE7' : '#FEE2E2' }]}>
              <AppIcon name={icons.profit} size={20} iconColor={fProfit >= 0 ? '#10B981' : '#EF4444'} />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: fProfit >= 0 ? '#047857' : '#DC2626', fontWeight: '800' }]}>
            {m(fProfit)}
          </Text>
          <View style={styles.kpiCardFooter}>
            <Text style={[styles.kpiFooterNote, { color: fProfit >= 0 ? '#065F46' : '#991B1B', fontWeight: '600' }]}>
              {lang === 'bn' ? 'সব খরচ বাদ দিয়ে যা পকেটে থাকে' : 'Final bottom-line profit'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Card 6: Customer Receivables */}
        <TouchableOpacity
          style={[styles.kpiCard, { borderTopColor: '#EC4899', borderTopWidth: 4 }]}
          onPress={() => setActiveTab('due')}
        >
          <View style={styles.kpiCardHeader}>
            <Text style={styles.kpiCardTitle}>{lang === 'bn' ? 'বাজারে কাস্টমার পাওনা' : 'Customer Receivables'}</Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: '#FDF2F8' }]}>
              <AppIcon name={icons.customers} size={20} iconColor="#EC4899" />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: '#BE185D' }]}>{m(totalDueAmount)}</Text>
          <View style={styles.kpiCardFooter}>
            <Text style={styles.kpiFooterNote}>
              {lang === 'bn' ? `${totalDueCount} জন খরিদ্দারের কাছে বাকি` : `From ${totalDueCount} customers`}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Card 7: Vendor Payables */}
        <TouchableOpacity
          style={[styles.kpiCard, { borderTopColor: '#DC2626', borderTopWidth: 4 }]}
          onPress={() => setActiveTab('pay')}
        >
          <View style={styles.kpiCardHeader}>
            <Text style={styles.kpiCardTitle}>{lang === 'bn' ? 'মহাজনদের মোট দেনা' : 'Vendor Payables'}</Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: '#FEF2F2' }]}>
              <AppIcon name={icons.vendors} size={20} iconColor="#DC2626" />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: '#B91C1C' }]}>{m(totalPayableAmount)}</Text>
          <View style={styles.kpiCardFooter}>
            <Text style={styles.kpiFooterNote}>
              {lang === 'bn' ? `${totalPayableCount} জন মহাজনের পাওনা মেটানো বাকি` : `Owed to ${totalPayableCount} suppliers`}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Card 8: Net Working Solvency */}
        <TouchableOpacity
          style={[styles.kpiCard, { borderTopColor: '#0284C7', borderTopWidth: 4 }]}
          onPress={handlePrintStatement}
        >
          <View style={styles.kpiCardHeader}>
            <Text style={styles.kpiCardTitle}>{lang === 'bn' ? 'নিট আর্থিক অবস্থান' : 'Net Business Solvency'}</Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: '#F0F9FF' }]}>
              <AppIcon name={icons.report} size={20} iconColor="#0284C7" />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: '#0369A1' }]}>{m(netSolvencyScore)}</Text>
          <View style={styles.kpiCardFooter}>
            <Text style={styles.kpiFooterNote}>
              {lang === 'bn' ? '(ক্যাশ + পাওনা) - দেনা' : '(Cash + Due) - Payable'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>}

      {/* 3. MAIN TAB NAVIGATION */}
      <View style={styles.tabNavContainer}>
        {[
          { key: 'overview', labelBn: 'সারসংক্ষেপ', labelEn: 'Overview', icon: icons.profit },
          { key: 'reports', labelBn: 'রিপোর্ট', labelEn: 'Reports', icon: icons.report },
          { key: 'due', labelBn: `👥 কাস্টমার বাকি (${n(totalDueCount)})`, labelEn: `Receivables (${totalDueCount})`, icon: icons.customers },
          { key: 'pay', labelBn: `🏢 মহাজন দেনা (${n(totalPayableCount)})`, labelEn: `Payables (${totalPayableCount})`, icon: icons.vendors },
          { key: 'expense', labelBn: '📉 খরচের রেজিস্টার', labelEn: 'Expense Register', icon: icons.expense },
          { key: 'houseExpense', labelBn: '🏠 বাসার খরচ', labelEn: 'House Expenses', icon: icons.moneyOut },
        ].map(tTab => {
          const active = activeTab === tTab.key;
          return (
            <TouchableOpacity
              key={tTab.key}
              style={[styles.tabNavButton, active && styles.tabNavButtonActive]}
              onPress={() => setActiveTab(tTab.key as any)}
            >
              <Text style={[styles.tabNavText, active && styles.tabNavTextActive]}>
                {lang === 'bn' ? tTab.labelBn : tTab.labelEn}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* ==================== TAB 1: OVERVIEW & PERFORMANCE CURVES ==================== */}
      {activeTab === 'reports' && (
        <View style={styles.tabContentArea}>
          <View style={styles.reportIntroCard}>
            <View style={styles.reportIntroIcon}><AppIcon name={icons.report} size={22} iconColor="#1D4ED8" /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.reportIntroTitle}>{lang === 'bn' ? 'হিসাবের রিপোর্ট' : 'Accounting reports'}</Text>
              <Text style={styles.reportIntroText}>{lang === 'bn' ? 'সময়সীমা বেছে নিয়ে লাভ-ক্ষতি দেখুন, অথবা আজকের পাওনা, দেনা ও নগদ স্থিতি প্রিন্ট করুন।' : 'Choose a period for profit and loss, or print today’s receivables, payables, and cash position.'}</Text>
            </View>
          </View>
          <View style={styles.reportCardsGrid}>
            {([
              { id: 'pnl', icon: icons.profit, color: '#047857', bg: '#ECFDF5', title: lang === 'bn' ? 'লাভ-ক্ষতির বিবরণী' : 'Profit & loss statement', value: f ? m(fProfit) : (lang === 'bn' ? 'লোড হচ্ছে…' : 'Loading…'), note: formatPeriodLabel(flt.from, flt.to), action: printProfitLoss, accent: fProfit < 0 ? '#DC2626' : '#047857' },
              { id: 'recv', icon: icons.customers, color: '#2563EB', bg: '#EFF6FF', title: lang === 'bn' ? 'বয়সভিত্তিক পাওনা' : 'Aged receivables', value: m(totalDueAmount), note: `${totalDueCount} ${lang === 'bn' ? 'জন কাস্টমার' : 'customers'}`, action: () => printAging('receivable'), accent: '#1D4ED8' },
              { id: 'pay', icon: icons.vendors, color: '#C2410C', bg: '#FFF7ED', title: lang === 'bn' ? 'বয়সভিত্তিক দেনা' : 'Aged payables', value: m(totalPayableAmount), note: `${totalPayableCount} ${lang === 'bn' ? 'জন সরবরাহকারী' : 'suppliers'}`, action: () => printAging('payable'), accent: '#C2410C' },
              { id: 'cash', icon: icons.bankCash, color: '#7C3AED', bg: '#F5F3FF', title: lang === 'bn' ? 'নগদ ও ব্যাংক বিবরণী' : 'Cash statement', value: m(totalLiquidMoney), note: `${moneyAccounts.length} ${lang === 'bn' ? 'টি অ্যাকাউন্ট' : 'accounts'} · ${td}`, action: printCashStatement, accent: '#6D28D9' },
              { id: 'balance', icon: icons.bankCash, color: '#0369A1', bg: '#E0F2FE', title: lang === 'bn' ? 'উদ্বৃত্তপত্র' : 'Balance sheet', value: lang === 'bn' ? 'আজ পর্যন্ত' : 'As of today', note: lang === 'bn' ? 'সম্পদ = দায় + মালিকানা' : 'Assets = liabilities + equity', action: () => { void printBalanceSheet().catch(() => Alert.alert(lang === 'bn' ? 'রিপোর্ট খোলা যায়নি' : 'Could not open report')); }, accent: '#0369A1' },
              { id: 'journal', icon: icons.report, color: '#7C3AED', bg: '#F5F3FF', title: lang === 'bn' ? 'জার্নাল এন্ট্রি' : 'Journal entries', value: lang === 'bn' ? 'ডেবিট ও ক্রেডিট' : 'Debits and credits', note: formatPeriodLabel(flt.from, flt.to), action: () => { void printJournalEntries().catch(() => Alert.alert(lang === 'bn' ? 'রিপোর্ট খোলা যায়নি' : 'Could not open report')); }, accent: '#7C3AED' },
              { id: 'ledger', icon: icons.report, color: '#6D28D9', bg: '#F5F3FF', title: lang === 'bn' ? 'সাধারণ খতিয়ান' : 'General ledger', value: lang === 'bn' ? 'অ্যাকাউন্ট অনুযায়ী' : 'By account', note: formatPeriodLabel(flt.from, flt.to), action: () => { void printGeneralLedger().catch(() => Alert.alert(lang === 'bn' ? 'রিপোর্ট খোলা যায়নি' : 'Could not open report')); }, accent: '#6D28D9' },
            ] as const).map(card => (
              <TouchableOpacity key={card.id} accessibilityRole="button" onPress={card.action} style={styles.reportCard} activeOpacity={0.82}>
                <View style={styles.reportCardTop}>
                  <View style={[styles.reportCardIcon, { backgroundColor: card.bg }]}><AppIcon name={card.icon} size={21} iconColor={card.color} /></View>
                  <AppIcon name={icons.chevR} size={18} iconColor="#94A3B8" />
                </View>
                <Text style={styles.reportCardTitle}>{card.title}</Text>
                <Text style={[styles.reportCardValue, { color: card.accent }]}>{card.value}</Text>
                <Text style={styles.reportCardNote}>{card.note}</Text>
                <View style={styles.reportCardAction}><AppIcon name={icons.print} size={15} iconColor="#1D4ED8" /><Text style={styles.reportCardActionText}>{lang === 'bn' ? 'রিপোর্ট খুলুন' : 'Open report'}</Text></View>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {false && activeTab === 'overview' && (
        <View style={styles.tabContentArea}>
          {/* Section A: Multi-Series Financial Trajectory Curve */}
          <View style={styles.chartCard}>
            <View style={styles.chartHeader}>
              <View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Text style={styles.chartSectionTitle}>
                    {lang === 'bn' ? 'আয়, ব্যয় ও মুনাফার ট্রেন্ড কার্ভ' : 'Revenue, Expense & Net Profit Curve'}
                  </Text>
                  <View style={styles.smoothPill}>
                    <Text style={styles.smoothPillText}>
                      {lang === 'bn' ? 'স্মুথ বেজিয়ার কার্ভ' : 'Smooth Bezier'}
                    </Text>
                  </View>
                </View>
                
              </View>

              {/* Curve Series Toggles */}
              <View style={styles.seriesToggleRow}>
                <TouchableOpacity
                  style={[styles.seriesToggleChip, curveSeries.sales && { backgroundColor: '#DCFCE7', borderColor: '#10B981' }]}
                  onPress={() => setCurveSeries(prev => ({ ...prev, sales: !prev.sales }))}
                >
                  <View style={[styles.seriesDot, { backgroundColor: '#10B981' }]} />
                  <Text style={[styles.seriesToggleText, curveSeries.sales && { color: '#065F46', fontWeight: '700' }]}>
                    {lang === 'bn' ? 'বিক্রয় কার্ভ' : 'Sales'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.seriesToggleChip, curveSeries.expense && { backgroundColor: '#FEE2E2', borderColor: '#EF4444' }]}
                  onPress={() => setCurveSeries(prev => ({ ...prev, expense: !prev.expense }))}
                >
                  <View style={[styles.seriesDot, { backgroundColor: '#EF4444' }]} />
                  <Text style={[styles.seriesToggleText, curveSeries.expense && { color: '#991B1B', fontWeight: '700' }]}>
                    {lang === 'bn' ? 'ব্যয় কার্ভ' : 'Expenses'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.seriesToggleChip, curveSeries.profit && { backgroundColor: '#EEF2FF', borderColor: '#6366F1' }]}
                  onPress={() => setCurveSeries(prev => ({ ...prev, profit: !prev.profit }))}
                >
                  <View style={[styles.seriesDot, { backgroundColor: '#6366F1' }]} />
                  <Text style={[styles.seriesToggleText, curveSeries.profit && { color: '#3730A3', fontWeight: '700' }]}>
                    {lang === 'bn' ? 'আসল লাভ কার্ভ' : 'Net Profit'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Interactive Inspector Badge */}
            {activeCurvePoint && (
              <View style={styles.pointInspectorBox}>
                <View style={styles.pointInspectorHeader}>
                  <Text style={styles.pointInspectorDate}>
                    📅 {fd(activeCurvePoint?.date ?? td)}
                  </Text>
                  <View style={styles.marginPill}>
                    <Text style={styles.marginPillText}>
                      {lang === 'bn' ? 'মার্জিন:' : 'Margin:'} {activeCurvePoint?.margin ?? 0}%
                    </Text>
                  </View>
                </View>

                <View style={styles.pointInspectorMetrics}>
                  <View style={styles.pointMetricItem}>
                    <Text style={styles.pointMetricLabel}>{lang === 'bn' ? 'বিক্রয়' : 'Sales'}</Text>
                    <Text style={[styles.pointMetricValue, { color: '#10B981' }]}>{m(activeCurvePoint?.sales ?? 0)}</Text>
                  </View>
                  <View style={styles.pointMetricItem}>
                    <Text style={styles.pointMetricLabel}>{lang === 'bn' ? 'খরচ' : 'Expense'}</Text>
                    <Text style={[styles.pointMetricValue, { color: '#EF4444' }]}>{m(activeCurvePoint?.expense ?? 0)}</Text>
                  </View>
                  <View style={styles.pointMetricItem}>
                    <Text style={styles.pointMetricLabel}>{lang === 'bn' ? 'আসল নিট লাভ' : 'Net Profit'}</Text>
                    <Text style={[styles.pointMetricValue, { color: '#6366F1' }]}>{m(activeCurvePoint?.profit ?? 0)}</Text>
                  </View>
                </View>
              </View>
            )}

            {/* THE VECTOR BEZIER CURVE CHART */}
            <View style={styles.chartCanvasContainer}>
              {Platform.OS === 'web' ? (
                <svg
                  viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                  style={{ width: '100%', height: chartHeight, overflow: 'visible' }}
                >
                  <defs>
                    <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#10B981" stopOpacity="0.25" />
                      <stop offset="100%" stopColor="#10B981" stopOpacity="0.0" />
                    </linearGradient>
                    <linearGradient id="expGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#EF4444" stopOpacity="0.2" />
                      <stop offset="100%" stopColor="#EF4444" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Horizontal Grid lines */}
                  {[0, 0.25, 0.5, 0.75, 1].map((pct, i) => {
                    const y = paddingTop + usableHeight * (1 - pct);
                    const val = Math.round(maxChartVal * pct);
                    return (
                      <g key={i}>
                        <line
                          x1={paddingLeft}
                          y1={y}
                          x2={paddingLeft + usableWidth}
                          y2={y}
                          stroke="#E2E8F0"
                          strokeDasharray="4 4"
                          strokeWidth="1"
                        />
                        <text
                          x={paddingLeft - 8}
                          y={y + 4}
                          textAnchor="end"
                          fontSize="10"
                          fill="#94A3B8"
                          fontWeight="600"
                        >
                          {val >= 1000 ? `${Math.round(val / 1000)}k` : val}
                        </text>
                      </g>
                    );
                  })}

                  {/* Shaded Areas */}
                  {curveSeries.sales && (
                    <path
                      d={getAreaPath(timelineData.map(p => p.sales))}
                      fill="url(#salesGradient)"
                    />
                  )}
                  {curveSeries.expense && (
                    <path
                      d={getAreaPath(timelineData.map(p => p.expense))}
                      fill="url(#expGradient)"
                    />
                  )}

                  {/* Bezier Curves */}
                  {curveSeries.sales && (
                    <path
                      d={getCurvePath(timelineData.map(p => p.sales))}
                      fill="none"
                      stroke="#10B981"
                      strokeWidth="3.2"
                      strokeLinecap="round"
                    />
                  )}
                  {curveSeries.expense && (
                    <path
                      d={getCurvePath(timelineData.map(p => p.expense))}
                      fill="none"
                      stroke="#EF4444"
                      strokeWidth="2.8"
                      strokeLinecap="round"
                    />
                  )}
                  {curveSeries.profit && (
                    <path
                      d={getCurvePath(timelineData.map(p => p.profit))}
                      fill="none"
                      stroke="#6366F1"
                      strokeWidth="3.2"
                      strokeDasharray="5 3"
                      strokeLinecap="round"
                    />
                  )}

                  {/* Data Points on Curve */}
                  {timelineData.map((pt, idx) => {
                    const x = paddingLeft + (idx / Math.max(1, timelineData.length - 1)) * usableWidth;
                    const salesY = paddingTop + usableHeight - (Math.max(0, pt.sales) / maxChartVal) * usableHeight;
                    const isSelected = activeCurvePoint?.date === pt.date;

                    return (
                      <g
                        key={pt.date}
                        style={{ cursor: 'pointer' }}
                        onClick={() => setActiveCurvePoint(pt)}
                      >
                        {/* Vertical Hover Guide Line */}
                        {isSelected && (
                          <line
                            x1={x}
                            y1={paddingTop}
                            x2={x}
                            y2={paddingTop + usableHeight}
                            stroke="#64748B"
                            strokeWidth="1.5"
                            strokeDasharray="3 3"
                          />
                        )}

                        {/* Interactive Dot */}
                        {curveSeries.sales && (
                          <circle
                            cx={x}
                            cy={salesY}
                            r={isSelected ? 6.5 : 4}
                            fill="#10B981"
                            stroke="#FFFFFF"
                            strokeWidth={isSelected ? 3 : 2}
                          />
                        )}

                        {/* X-axis date labels */}
                        <text
                          x={x}
                          y={paddingTop + usableHeight + 18}
                          textAnchor="middle"
                          fontSize="11"
                          fontWeight={isSelected ? '700' : '500'}
                          fill={isSelected ? '#0F172A' : '#64748B'}
                        >
                          {pt.label}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <View style={{ height: chartHeight, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: '#64748B' }}>
                    {lang === 'bn' ? 'চার্ট লোড হচ্ছে...' : 'Loading Visual Chart...'}
                  </Text>
                </View>
              )}
            </View>

            {/* Bottom Summary Bar for Curves */}
            <View style={styles.chartFootRow}>
              <View style={styles.chartFootMetric}>
                <Text style={styles.chartFootLabel}>{lang === 'bn' ? 'গড় দৈনিক বিক্রয়' : 'Avg Daily Sales'}</Text>
                <Text style={styles.chartFootValue}>{m(Math.round(fSale / (timelineData.length || 1)))}</Text>
              </View>
              <View style={styles.chartFootMetric}>
                <Text style={styles.chartFootLabel}>{lang === 'bn' ? 'গড় দৈনিক খরচ' : 'Avg Daily Expense'}</Text>
                <Text style={styles.chartFootValue}>{m(Math.round(fExp / (timelineData.length || 1)))}</Text>
              </View>
              <View style={styles.chartFootMetric}>
                <Text style={styles.chartFootLabel}>{lang === 'bn' ? 'গড় দৈনিক নিট লাভ' : 'Avg Daily Net Profit'}</Text>
                <Text style={[styles.chartFootValue, { color: '#047857' }]}>{m(Math.round(fProfit / (timelineData.length || 1)))}</Text>
              </View>
              <View style={styles.chartFootMetric}>
                <Text style={styles.chartFootLabel}>{lang === 'bn' ? 'সামগ্রিক লাভ মার্জিন' : 'Overall Margin'}</Text>
                <Text style={[styles.chartFootValue, { color: '#6366F1' }]}>
                  {fSale > 0 ? `${Math.round((fProfit / fSale) * 100)}%` : '0%'}
                </Text>
              </View>
            </View>
          </View>

          {/* Section B: Two Column Visuals — P&L Waterfall + Solvency Liquidity Curve */}
          <View style={[styles.twoColGrid, isMobile && { flexDirection: 'column' }]}>
            {/* Left: Visual P&L Waterfall (লাভ-ক্ষতির স্পষ্ট ধাপ) */}
            <View style={[styles.colCard, { flex: 1.2 }]}>
              <View style={styles.cardHeaderWithIcon}>
                <AppIcon name={icons.profit} size={22} iconColor="#10B981" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.blockTitle}>
                    {lang === 'bn' ? 'লাভ-ক্ষতির স্পষ্ট ধাপ (Visual P&L Waterfall)' : 'Income Statement Waterfall'}
                  </Text>
                  
                </View>
              </View>

              {/* Waterfall Steps */}
              <View style={styles.waterfallContainer}>
                {/* Step 1: Gross Sales */}
                <View style={styles.waterfallStep}>
                  <View style={styles.waterfallStepHeader}>
                    <Text style={styles.wfStepTitle}>1. {lang === 'bn' ? 'মোট বিক্রয় (Net Sales)' : 'Net Sales'}</Text>
                    <Text style={[styles.wfStepAmount, { color: '#0F172A' }]}>{m(fSale)}</Text>
                  </View>
                  <View style={styles.wfProgressBarBg}>
                    <View style={[styles.wfProgressBarFill, { width: '100%', backgroundColor: '#3B82F6' }]} />
                  </View>
                  <Text style={styles.wfStepHelp}>
                    {lang === 'bn' ? 'দোকান থেকে সরবরাহকৃত মোট চালের মূল্য (১০০%)' : 'Base revenue generated (100%)'}
                  </Text>
                </View>

                {/* Step 2: Less COGS */}
                <View style={styles.waterfallStep}>
                  <View style={styles.waterfallStepHeader}>
                    <Text style={styles.wfStepTitle}>2. {lang === 'bn' ? 'বাদ: চালের পাইকারি ক্রয় খরচ (COGS)' : 'Less: Cost of Rice (COGS)'}</Text>
                    <Text style={[styles.wfStepAmount, { color: '#EF4444' }]}>- {m(fCogs)}</Text>
                  </View>
                  <View style={styles.wfProgressBarBg}>
                    <View style={[styles.wfProgressBarFill, { width: fSale > 0 ? `${Math.min(100, Math.round((fCogs / fSale) * 100))}%` : '85%', backgroundColor: '#EF4444' }]} />
                  </View>
                  <Text style={styles.wfStepHelp}>
                    {lang === 'bn'
                      ? `যে চালগুলো বিক্রি হয়েছে তার প্রকৃত পাইকারি ক্রয়মূল্য (${fSale > 0 ? Math.round((fCogs / fSale) * 100) : 85}%)`
                      : 'Direct purchasing cost of goods sold'}
                  </Text>
                </View>

                {/* Step 3: Gross Profit */}
                <View style={styles.waterfallStep}>
                  <View style={styles.waterfallStepHeader}>
                    <Text style={[styles.wfStepTitle, { fontWeight: '700', color: '#059669' }]}>
                      3. {lang === 'bn' ? '= মোট বাণিজ্যিক লাভ (Gross Profit)' : '= Gross Commercial Profit'}
                    </Text>
                    <Text style={[styles.wfStepAmount, { color: '#059669', fontWeight: '800' }]}>{m(fGrossProfit)}</Text>
                  </View>
                  <View style={styles.wfProgressBarBg}>
                    <View style={[styles.wfProgressBarFill, { width: fSale > 0 ? `${Math.min(100, Math.round((fGrossProfit / fSale) * 100))}%` : '15%', backgroundColor: '#059669' }]} />
                  </View>
                  <Text style={styles.wfStepHelp}>
                    {lang === 'bn'
                      ? `দোকানের খরচ দেওয়ার আগের সরাসরি কেনা-বেচার লাভ (${fSale > 0 ? Math.round((fGrossProfit / fSale) * 100) : 15}%)`
                      : 'Direct trading profit before operating costs'}
                  </Text>
                </View>

                {/* Step 4: Less Operating Expenses */}
                <View style={styles.waterfallStep}>
                  <View style={styles.waterfallStepHeader}>
                    <Text style={styles.wfStepTitle}>4. {lang === 'bn' ? 'বাদ: দোকান পরিচালনা ও পরিবহন খরচ' : 'Less: Operating Expenses'}</Text>
                    <Text style={[styles.wfStepAmount, { color: '#D97706' }]}>- {m(fExp)}</Text>
                  </View>
                  <View style={styles.wfProgressBarBg}>
                    <View style={[styles.wfProgressBarFill, { width: fSale > 0 ? `${Math.min(100, Math.round((fExp / fSale) * 100))}%` : '4%', backgroundColor: '#F59E0B' }]} />
                  </View>
                  <Text style={styles.wfStepHelp}>
                    {lang === 'bn'
                      ? `দোকান ভাড়া, কর্মচারীর বেতন, ট্রাক ভাড়া, বিদ্যুৎ বিল ইত্যাদি (${fSale > 0 ? Math.round((fExp / fSale) * 100) : 4}%)`
                      : 'Store rent, staff salaries, electricity, transport'}
                  </Text>
                </View>

                {/* Step 5: Final Net Profit */}
                <View style={[styles.waterfallStep, styles.waterfallFinalStep]}>
                  <View style={styles.waterfallStepHeader}>
                    <Text style={[styles.wfStepTitle, { fontSize: 16, fontWeight: '800', color: '#065F46' }]}>
                      5. {lang === 'bn' ? '= আসল লাভ / নিট মুনাফা (Net Profit)' : '= Net Bottom-Line Profit'}
                    </Text>
                    <Text style={[styles.wfStepAmount, { fontSize: 18, fontWeight: '900', color: '#047857' }]}>
                      {m(fProfit)}
                    </Text>
                  </View>
                  <Text style={[styles.wfStepHelp, { color: '#065F46', fontWeight: '600' }]}>
                    {lang === 'bn'
                      ? `🎉 সব দেনা ও খরচ মেটানোর পর এই টাকা মালিকের প্রকৃত উদ্বৃত্ত/পকেটের মুনাফা।`
                      : 'Final pocketable earnings after covering all operational costs.'}
                  </Text>
                </View>
              </View>
            </View>

            {/* Right: Solvency, Liquidity Gauge & Expense Distribution */}
            <View style={[styles.colCard, { flex: 1 }]}>
              <View style={styles.cardHeaderWithIcon}>
                <AppIcon name={icons.bankCash} size={22} iconColor="#2563EB" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.blockTitle}>
                    {lang === 'bn' ? 'তারল্য ও দেনা-পাওনা ভারসাম্য' : 'Liquidity & Solvency Balance'}
                  </Text>
                  
                </View>
              </View>

              {/* Visual Liquidity Comparison Bars */}
              <View style={styles.liquidityBarsBox}>
                <View style={styles.liqItem}>
                  <View style={styles.liqLabelRow}>
                    <Text style={styles.liqName}>{lang === 'bn' ? 'বাজারে কাস্টমার পাওনা' : 'Customer Receivables'}</Text>
                    <Text style={[styles.liqVal, { color: '#BE185D' }]}>{m(totalDueAmount)}</Text>
                  </View>
                  <View style={styles.liqTrack}>
                    <View style={[styles.liqFill, { width: '85%', backgroundColor: '#EC4899' }]} />
                  </View>
                </View>

                <View style={styles.liqItem}>
                  <View style={styles.liqLabelRow}>
                    <Text style={styles.liqName}>{lang === 'bn' ? 'হাতে ক্যাশ ও ব্যাংক তহবিল' : 'Liquid Cash Reserves'}</Text>
                    <Text style={[styles.liqVal, { color: '#10B981' }]}>{m(totalLiquidMoney)}</Text>
                  </View>
                  <View style={styles.liqTrack}>
                    <View style={[styles.liqFill, { width: '60%', backgroundColor: '#10B981' }]} />
                  </View>
                </View>

                <View style={styles.liqItem}>
                  <View style={styles.liqLabelRow}>
                    <Text style={styles.liqName}>{lang === 'bn' ? 'মহাজনদের মোট দেনা' : 'Vendor Payables'}</Text>
                    <Text style={[styles.liqVal, { color: '#DC2626' }]}>{m(totalPayableAmount)}</Text>
                  </View>
                  <View style={styles.liqTrack}>
                    <View style={[styles.liqFill, { width: '45%', backgroundColor: '#EF4444' }]} />
                  </View>
                </View>

                {/* Solvency Diagnosis Banner */}
                <View style={[styles.solvencyDiagnosisBox, { backgroundColor: solvencyRatio >= 100 ? '#ECFDF5' : '#FEF2F2' }]}>
                  <AppIcon
                    name={solvencyRatio >= 100 ? icons.done : icons.bell}
                    size={22}
                    iconColor={solvencyRatio >= 100 ? '#10B981' : '#EF4444'}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.solvencyDiagTitle, { color: solvencyRatio >= 100 ? '#065F46' : '#991B1B' }]}>
                      {solvencyRatio >= 100
                        ? (lang === 'bn' ? 'ব্যবসার আর্থিক স্বাস্থ্য অত্যন্ত নিরাপদ' : 'Strong Financial Solvency')
                        : (lang === 'bn' ? 'সতর্কতা: দেনা আদায়ের দিকে নজর দিন' : 'Caution: Tight Liquidity')}
                    </Text>
                    <Text style={[styles.solvencyDiagDesc, { color: solvencyRatio >= 100 ? '#047857' : '#B91C1C' }]}>
                      {lang === 'bn'
                        ? `আপনার হাতে থাকা ক্যাশ ও বাজারের পাওনা দিয়ে মোট মহাজন দেনার ${Math.round(solvencyRatio)}% তাৎক্ষণিক মেটানো সম্ভব।`
                        : `Current liquid funds and customer dues cover ${Math.round(solvencyRatio)}% of all supplier liabilities.`}
                    </Text>
                  </View>
                </View>
              </View>

              {/* Expense Category Breakdown Bars */}
              <View style={{ marginTop: 16 }}>
                <Text style={[styles.blockTitle, { fontSize: 14, marginBottom: 8 }]}>
                  {lang === 'bn' ? 'ব্যয়ের শীর্ষ খাতসমূহ' : 'Top Expense Categories'}
                </Text>
                {expenseBreakdown.slice(0, 4).map(eb => (
                  <View key={eb.category} style={{ marginBottom: 8 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 2 }}>
                      <Text style={{ fontSize: 13, color: '#334155', fontWeight: '500' }}>{eb.category}</Text>
                      <Text style={{ fontSize: 13, color: '#0F172A', fontWeight: '700' }}>{m(eb.amount)} ({eb.pct}%)</Text>
                    </View>
                    <View style={styles.wfProgressBarBg}>
                      <View style={[styles.wfProgressBarFill, { width: `${Math.min(100, eb.pct * 1.5)}%`, backgroundColor: '#F59E0B' }]} />
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </View>

          {/* Section C: Plain Language Accounts Guide (সহজ ভাষায় হিসাব নির্দেশিকা) */}
          
        </View>
      )}

      {activeTab === 'overview' && (
        <View style={styles.tabContentArea}>
          <View style={{ marginBottom: 18 }}>
            <Text style={{ color: '#102A43', fontSize: 24, fontWeight: '800' }}>{lang === 'bn' ? 'ব্যবসার হিসাব এক নজরে' : 'Your business at a glance'}</Text>
            <Text style={{ color: '#64748B', fontSize: 14, marginTop: 4 }}>{lang === 'bn' ? `${formatPeriodLabel(flt.from, flt.to)} · সহজ আর্থিক সারসংক্ষেপ` : `${formatPeriodLabel(flt.from, flt.to)} · a clear financial summary`}</Text>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 18 }}>
            {([
              { title: lang === 'bn' ? 'বিক্রয়' : 'Sales', value: fSale, icon: icons.sale, color: '#168A64', bg: '#E8F7EF', tab: 'sale' },
              { title: lang === 'bn' ? 'ক্রয়' : 'Purchases', value: f?.netPurchase ?? 0, icon: icons.purchase, color: '#5B63B7', bg: '#EFF0FF', tab: 'purchase' },
              { title: lang === 'bn' ? 'খরচ' : 'Expenses', value: fExp, icon: icons.expense, color: '#C6811D', bg: '#FFF5E5', tab: 'expense' },
              { title: t('collect'), value: fCollect, icon: icons.collect, color: '#087E8B', bg: '#E6F7F8', tab: 'collect' },
              { title: t('pay'), value: fPayment, icon: icons.pay, color: '#B45309', bg: '#FFF4E5', tab: 'pay' },
              { title: lang === 'bn' ? 'নগদ' : 'Cash', value: filteredCashBalance, icon: icons.cash, color: '#168A64', bg: '#E8F7EF', tab: 'bank' },
              { title: lang === 'bn' ? 'ব্যাংক' : 'Bank', value: filteredBankBalance, icon: icons.bank, color: '#2863C7', bg: '#EAF1FF', tab: 'bank' },
            ] as const).map(card => (
              <TouchableOpacity key={card.title} onPress={() => card.tab === 'expense' ? setActiveTab('expense') : card.tab === 'collect' ? go?.('collect') : card.tab === 'pay' ? go?.('pay') : go?.(card.tab)} activeOpacity={0.82}
                style={{ flexGrow: 1, flexBasis: isMobile ? '45%' : 200, minWidth: isMobile ? 145 : 190, backgroundColor: '#FFFFFF', borderRadius: 18, padding: 17, borderWidth: 1, borderColor: '#E5EAF0', shadowColor: '#102A43', shadowOpacity: 0.04, shadowRadius: 8, elevation: 1 }}>
                <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: card.bg, alignItems: 'center', justifyContent: 'center', marginBottom: 13 }}><AppIcon name={card.icon} size={20} iconColor={card.color} /></View>
                <Text style={{ color: '#64748B', fontSize: 13, fontWeight: '600' }}>{card.title}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#102A43', fontSize: 22, fontWeight: '800', marginTop: 6 }}>{!filteredAccountsReady && card.tab === 'bank' ? '…' : m(card.value)}</Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity onPress={() => setActiveTab('reports')} activeOpacity={0.82}
              style={{ flexGrow: 1, flexBasis: isMobile ? '45%' : 200, minWidth: isMobile ? 145 : 190, backgroundColor: '#123B5D', borderRadius: 18, padding: 17, justifyContent: 'space-between' }}>
              <View style={{ width: 40, height: 40, borderRadius: 13, backgroundColor: '#FFFFFF22', alignItems: 'center', justifyContent: 'center' }}><AppIcon name={icons.report} size={20} iconColor="#FFFFFF" /></View>
              <View><Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginTop: 13 }}>{lang === 'bn' ? 'রিপোর্ট দেখুন' : 'View reports'}</Text><Text style={{ color: '#D1E4F1', fontSize: 12, marginTop: 4 }}>{lang === 'bn' ? 'লাভ-ক্ষতি ও নগদ প্রবাহ' : 'Profit, balances & cash flow'}</Text></View>
            </TouchableOpacity>
          </View>
          <View style={{ backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E5EAF0', borderRadius: 18, padding: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
              <View><Text style={{ color: '#102A43', fontSize: 18, fontWeight: '800' }}>{lang === 'bn' ? 'এই সময়ের আর্থিক চিত্র' : 'Period overview'}</Text><Text style={{ color: '#64748B', fontSize: 13, marginTop: 3 }}>{lang === 'bn' ? 'বিক্রয়, ক্রয় ও খরচ পাশাপাশি দেখুন' : 'Compare sales, purchases and expenses'}</Text></View>
              <Text style={{ color: fProfit >= 0 ? '#168A64' : '#C43D3D', fontWeight: '800', fontSize: 16 }}>{lang === 'bn' ? 'নিট লাভ ' : 'Net profit '}{m(fProfit)}</Text>
            </View>
            {([
              { label: lang === 'bn' ? 'বিক্রয়' : 'Sales', value: fSale, color: '#168A64' },
              { label: lang === 'bn' ? 'ক্রয়' : 'Purchases', value: f?.netPurchase ?? 0, color: '#646CC8' },
              { label: lang === 'bn' ? 'খরচ' : 'Expenses', value: fExp, color: '#D8922B' },
            ]).map(row => {
              const max = Math.max(fSale, f?.netPurchase ?? 0, fExp, 1);
              return <View key={row.label} style={{ marginTop: 12 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}><Text style={{ color: '#475569', fontSize: 13, fontWeight: '600' }}>{row.label}</Text><Text style={{ color: '#102A43', fontSize: 13, fontWeight: '700' }}>{m(row.value)}</Text></View>
                <View style={{ height: 10, borderRadius: 10, backgroundColor: '#F1F5F9', overflow: 'hidden' }}><View style={{ width: `${Math.max(row.value > 0 ? 2 : 0, Math.round(row.value / max * 100))}%`, height: '100%', borderRadius: 10, backgroundColor: row.color }} /></View>
              </View>;
            })}
          </View>
        </View>
      )}

      {activeTab === 'due' && (
        <View style={styles.tabContentArea}>
          <View style={styles.cardHeaderWithAction}>
            <View>
              <Text style={styles.blockTitle}>
                {lang === 'bn' ? 'কাস্টমারদের কাছে মোট বাকি ও পাওনা খতিয়ান' : 'Customer Receivables Ledger'}
              </Text>
              
            </View>
            <TouchableOpacity style={styles.primaryActionButton} onPress={() => go?.('collect')}>
              <AppIcon name={icons.collect} size={18} iconColor="#fff" />
              <Text style={styles.primaryActionText}>{lang === 'bn' ? 'কালেকশন এন্ট্রি' : 'Receive Due'}</Text>
            </TouchableOpacity>
          </View>

          {/* Search Box */}
          <View style={styles.searchBarContainer}>
            <AppIcon name={icons.search} size={20} iconColor="#64748B" />
            <TextInput
              style={styles.searchBarInput}
              placeholder={lang === 'bn' ? 'খরিদ্দারের নাম বা মোবাইল নম্বর দিয়ে খুঁজুন...' : 'Search customer by name or mobile...'}
              value={dueSearch}
              onChangeText={setDueSearch}
            />
            {dueSearch.length > 0 && (
              <TouchableOpacity onPress={() => setDueSearch('')}>
                <AppIcon name={icons.cancel} size={18} iconColor="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Customers Due List */}
          <View style={styles.colCard}>
            {filteredCustomerDues.length === 0 ? (
              <Empty />
            ) : (
              filteredCustomerDues.map((item, idx) => (
                <View key={item.customer.id} style={styles.partyRowItem}>
                  <View style={styles.partyRankBadge}>
                    <Text style={styles.partyRankText}>#{idx + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.partyName}>{item.customer.name}</Text>
                    <Text style={styles.partyDetails}>
                      {localeDigits(item.customer.mobile, lang) || (lang === 'bn' ? 'মোবাইল নেই' : 'No mobile')}
                      {item.customer.address ? ` • ${item.customer.address}` : ''}
                      {item.customer.next ? ` • ${lang === 'bn' ? 'পরবর্তী তাগাদা:' : 'Follow-up:'} ${fd(item.customer.next)}` : ''}
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end', marginRight: 12 }}>
                    <Text style={[styles.partyBalance, { color: '#BE185D' }]}>{m(item.balance)}</Text>
                    <Text style={styles.partyBalanceTag}>{lang === 'bn' ? 'বাকি বকেয়া' : 'Pending'}</Text>
                  </View>

                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {item.customer.mobile ? (
                      <TouchableOpacity
                        style={styles.callIconButton}
                        onPress={() => Linking.openURL(`tel:${item.customer.mobile}`)}
                      >
                        <AppIcon name={icons.phone} size={16} iconColor="#2563EB" />
                      </TouchableOpacity>
                    ) : null}
                    <TouchableOpacity
                      style={styles.detailLinkButton}
                      onPress={() => setSelectedCustId(item.customer.id)}
                    >
                      <Text style={styles.detailLinkText}>{lang === 'bn' ? 'চালান খতিয়ান' : 'Ledger'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              ))
            )}
          </View>
        </View>
      )}

      {/* ==================== TAB 4: VENDOR PAYABLES (দেনা) ==================== */}
      {activeTab === 'pay' && (
        <View style={styles.tabContentArea}>
          <View style={styles.cardHeaderWithAction}>
            <View>
              <Text style={styles.blockTitle}>
                {lang === 'bn' ? 'চাল সরবরাহকারী ও মহাজনদের দেনা খতিয়ান' : 'Vendor Payables Ledger'}
              </Text>
              
            </View>
            <TouchableOpacity style={[styles.primaryActionButton, { backgroundColor: '#2563EB' }]} onPress={() => go?.('pay')}>
              <AppIcon name={icons.pay} size={18} iconColor="#fff" />
              <Text style={styles.primaryActionText}>{lang === 'bn' ? 'মহাজনকে পরিশোধ' : 'Pay Vendor'}</Text>
            </TouchableOpacity>
          </View>

          {/* Search Box */}
          <View style={styles.searchBarContainer}>
            <AppIcon name={icons.search} size={20} iconColor="#64748B" />
            <TextInput
              style={styles.searchBarInput}
              placeholder={lang === 'bn' ? 'মহাজন বা মিলের নাম দিয়ে খুঁজুন...' : 'Search vendor by name...'}
              value={paySearch}
              onChangeText={setPaySearch}
            />
            {paySearch.length > 0 && (
              <TouchableOpacity onPress={() => setPaySearch('')}>
                <AppIcon name={icons.cancel} size={18} iconColor="#94A3B8" />
              </TouchableOpacity>
            )}
          </View>

          {/* Vendor Payables List */}
          <View style={styles.colCard}>
            {filteredVendorPayables.length === 0 ? (
              <Empty />
            ) : (
              filteredVendorPayables.map((item, idx) => (
                <View key={item.vendor.id} style={styles.partyRowItem}>
                  <View style={[styles.partyRankBadge, { backgroundColor: '#FEF2F2' }]}>
                    <Text style={[styles.partyRankText, { color: '#DC2626' }]}>#{idx + 1}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.partyName}>{item.vendor.name}</Text>
                    <Text style={styles.partyDetails}>
                      {localeDigits(item.vendor.mobile, lang) || (lang === 'bn' ? 'মোবাইল নেই' : 'No mobile')}
                      {item.vendor.address ? ` • ${item.vendor.address}` : ''}
                    </Text>
                  </View>

                  <View style={{ alignItems: 'flex-end', marginRight: 12 }}>
                    <Text style={[styles.partyBalance, { color: '#DC2626' }]}>{m(item.balance)}</Text>
                    <Text style={[styles.partyBalanceTag, { color: '#B91C1C' }]}>{lang === 'bn' ? 'দেনা পরিশোধ বাকি' : 'Payable'}</Text>
                  </View>

                  <TouchableOpacity
                    style={[styles.detailLinkButton, { borderColor: '#2563EB' }]}
                    onPress={() => setSelectedVendorId(item.vendor.id)}
                  >
                    <Text style={[styles.detailLinkText, { color: '#2563EB' }]}>{lang === 'bn' ? 'দেনা খতিয়ান' : 'Ledger'}</Text>
                  </TouchableOpacity>
                </View>
              ))
            )}
          </View>
        </View>
      )}

      {/* ==================== TAB 5: EXPENSE REGISTER ==================== */}
      {activeTab === 'expense' && (
        <View style={styles.tabContentArea}>
          <View style={styles.cardHeaderWithAction}>
            <View>
              <Text style={styles.blockTitle}>{lang === 'bn' ? 'দোকান পরিচালনা ব্যয়ের রেজিস্টার' : 'Expense Register'}</Text>
              
            </View>
          </View>

          <ExpenseModal
            inline
            init={expenseFormItem ?? null}
            onClose={() => setExpenseFormItem(null)}
            onSave={async val => {
              for (let index = 0; index < val.payments.length; index += 1) {
                const payment = val.payments[index];
                await saveExpense({ id: index === 0 ? val.id : undefined, category: val.category, customName: val.customName, amount: payment.amount, accountId: payment.accountId, date: val.date, note: val.note });
              }
              setExpenseFormItem(null);
            }}
            onTrash={async id => { await deleteExpense(id); setExpenseFormItem(null); }}
          />
          <EntryReportButtons doc={expenseRegisterDoc} filename={`expense_register_${today()}.csv`} />

          {/* Search & Category Filter */}
          <View style={[styles.searchBarContainer, { marginBottom: 12 }]}>
            <AppIcon name={icons.search} size={20} iconColor="#64748B" />
            <TextInput
              style={styles.searchBarInput}
              placeholder={lang === 'bn' ? 'খাতের নাম বা বিবরণ দিয়ে খুঁজুন...' : 'Search expense by category or description...'}
              value={expSearch}
              onChangeText={setExpSearch}
            />
          </View>

          {/* Expense Rows */}
          <View style={styles.colCard}>
            {filteredExpensesList.length === 0 ? (
              <Empty />
            ) : (
              filteredExpensesList.map(e => {
                const label = expenseCategoryLabel(e.category, e.customName);
                return (
                  <TouchableOpacity
                    key={e.id}
                    style={styles.expenseItemRow}
                    onPress={() => { if (!e.stockAdjustment) setExpenseFormItem(e); }}
                  >
                    <View style={styles.expIconBox}>
                      <AppIcon name={icons.expense} size={18} iconColor="#D97706" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.expTitle}>{label}</Text>
                      <Text style={styles.expSub}>
                        {fd(e.date)} · {e.stockAdjustment ? (lang === 'bn' ? 'স্বয়ংক্রিয়' : 'Automated') : (lang === 'bn' ? 'ম্যানুয়াল এন্ট্রি' : 'Manual entry')}{e.voucherNo ? ` · #${e.voucherNo}` : ''}
                      </Text>
                      <Text style={{ color: '#64748B', fontSize: 12, marginTop: 3 }}>
                        {lang === 'bn' ? 'অ্যাকাউন্ট: ' : 'Account: '}{e.accountName ?? moneyAccounts.find(account => account.id === e.accountId)?.name ?? (lang === 'bn' ? 'অজানা' : 'Unknown')}
                      </Text>
                      {e.note ? <Text style={{ color: '#64748B', fontSize: 12, marginTop: 3 }} numberOfLines={2}>{lang === 'bn' ? 'বিবরণ: ' : 'Description: '}{e.note}</Text> : null}
                    </View>
                    <Text style={[styles.expAmt, { color: e.amount < 0 ? '#047857' : '#DC2626' }]}>{e.amount < 0 ? '+' : '−'} {m(Math.abs(e.amount))}</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>
      )}

      {activeTab === 'houseExpense' && (
        <View style={styles.tabContentArea}>
          <View style={styles.cardHeaderWithAction}>
            <View style={{ flex: 1, marginRight: 10 }}>
              <Text style={styles.blockTitle}>{lang === 'bn' ? 'বাসার খরচ উত্তোলন রেজিস্টার' : 'House Expenses Register'}</Text>
              <Text style={{ color: '#64748B', fontSize: 12, marginTop: 3 }}>{lang === 'bn' ? 'মালিকানা থেকে আলাদা উত্তোলন হিসেবে নথিভুক্ত হবে' : 'Recorded separately as an owner equity withdrawal'}</Text>
            </View>
          </View>
          <HouseExpenseEntryForm
            onSaved={async () => {
              await refresh();
              setAccountRefresh(value => value + 1);
              setHouseExpenseRows(await api.houseExpenses());
            }}
          />
          <EntryReportButtons doc={houseExpenseRegisterDoc} filename={`house_expense_register_${today()}.csv`} />
          <View style={styles.colCard}>
            {houseExpenseLoading ? <Text style={{ padding: 14, color: '#64748B' }}>{lang === 'bn' ? 'লোড হচ্ছে…' : 'Loading…'}</Text>
              : houseExpenseRows.length === 0 ? <Empty />
              : houseExpenseRows.map(row => <View key={row.id} style={{ paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#0F172A' }}>{row.description}</Text>
                    <Text style={{ color: '#64748B', fontSize: 12, marginTop: 3 }}>{row.transactionNo} · {fd(row.date)} · {row.accountName}</Text>
                    {row.note ? <Text style={{ color: '#64748B', fontSize: 12, marginTop: 3 }}>{lang === 'bn' ? 'লগ নোট: ' : 'Log note: '}{row.note}</Text> : null}
                  </View>
                  <Text style={{ fontSize: 15, fontWeight: '800', color: '#B91C1C' }}>−{m(row.amount)}</Text>
                </View>
              </View>)}
          </View>
        </View>
      )}

      {/* ==================== TAB 6: INTELLIGENT ACCOUNTS Q&A ASSISTANT ==================== */}
      

      {/* ==================== ACTIVE DRILLDOWN MODALS ==================== */}
      {/* 1. Date Range Filter Modal */}
      {fltModalOpen && (
        <FilterModal
          init={flt}
          onClose={() => setFltModalOpen(false)}
          onApply={newFlt => {
            setFlt(newFlt);
            setFltPreset('custom');
            setFltModalOpen(false);
          }}
        />
      )}

      {/* 2. Customer Due Receivable Detail Modal */}
      {selectedCustId && (
        <ReceivableModal
          id={selectedCustId}
          onClose={() => setSelectedCustId(null)}
        />
      )}

      {/* 3. Vendor Payable Detail Modal */}
      {selectedVendorId && (
        <PayableModal
          id={selectedVendorId}
          onClose={() => setSelectedVendorId(null)}
        />
      )}

      {/* 6. KPI Deep Dive Modal */}
      {kpiModal && (
        <KpiDetailModal
          kind={kpiModal}
          period={{ label: formatPeriodLabel(flt.from, flt.to), inPeriod, isCurrent: isToday }}
          fin={f}
          kpiTotal={fSale}
          collectTotal={fCollect}
          dueTotal={s.due}
          payTotal={s.payable}
          onClose={() => setKpiModal(null)}
        />
      )}
      {chartModalOpen ? <ChartOfAccountsModal onClose={() => setChartModalOpen(false)} onSaved={() => setChartModalOpen(false)} /> : null}
      {moneyEntry ? <MoneyEntry direction={moneyEntry} onClose={() => setMoneyEntry(null)} onSaved={async () => { await refresh(); setAccountRefresh(v => v + 1); }} /> : null}
      {transferModalOpen ? <MoneyTransferModal onClose={() => { setTransferModalOpen(false); setAccountRefresh(v => v + 1); }} /> : null}
    </ScrollView>
  );
}

// STYLES
const styles = StyleSheet.create({
  reportIntroCard: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 18, backgroundColor: '#EFF6FF', borderWidth: 1, borderColor: '#DBEAFE' },
  reportIntroIcon: { width: 46, height: 46, borderRadius: 14, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  reportIntroTitle: { color: '#0F172A', fontSize: 17, fontWeight: '800' },
  reportIntroText: { color: '#475569', fontSize: 13, lineHeight: 19, marginTop: 3 },
  reportCardsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  reportCard: { flexGrow: 1, flexBasis: 230, minWidth: 210, padding: 18, borderRadius: 18, backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#E2E8F0', shadowColor: '#0F172A', shadowOffset: { width: 0, height: 3 }, shadowOpacity: 0.05, shadowRadius: 8, ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}) },
  reportCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  reportCardIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  reportCardTitle: { color: '#334155', fontSize: 14, fontWeight: '700' },
  reportCardValue: { fontSize: 22, fontWeight: '800', marginTop: 9 },
  reportCardNote: { color: '#64748B', fontSize: 12, marginTop: 4 },
  reportCardAction: { flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: 1, borderTopColor: '#F1F5F9', paddingTop: 12, marginTop: 15 },
  reportCardActionText: { color: '#1D4ED8', fontSize: 13, fontWeight: '700' },
  screenBg: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 60,
  },

  // 1. Header Bar
  headerBar: {
    backgroundColor: '#1c70b9',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 16,
    borderTopWidth: 1.5,
    borderTopColor: '#60b0f4',
    borderBottomWidth: 3.5,
    borderBottomColor: '#124c7e',
    overflow: 'hidden',
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(135deg, #2592ed 0%, #1c70b9 52%, #12518e 100%)',
      boxShadow: '0 8px 22px rgba(28, 112, 185, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.45)',
    } as any : {
      elevation: 4,
    }),
  },
  headerGlossSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    zIndex: 2,
    flex: 1,
    minWidth: 260,
  },
  titleIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0, 0, 0, 0.2)',
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#86EFAC',
  },
  liveTagText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  headerSub: {
    color: '#DCEBFA',
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    zIndex: 2,
    flexWrap: 'wrap',
  },
  headerActionBtnWhite: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderTopWidth: 1,
    borderTopColor: '#FFFFFF',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0, 0, 0, 0.25)',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  headerActionBtnWhiteText: {
    color: '#1c70b9',
    fontSize: 13,
    fontWeight: '800',
  },
  headerActionBtnTranslucent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0, 0, 0, 0.25)',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  headerActionBtnTranslucentText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
  periodCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 12,
  },
  presetButtonsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  presetChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  presetChipActive: {
    backgroundColor: '#ECFDF5',
    borderColor: '#10B981',
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  presetChipTextActive: {
    color: '#065F46',
    fontWeight: '700',
  },
  solvencyBannerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  solvencyPillLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  solvencyPillValue: {
    fontSize: 12,
    fontWeight: '700',
  },

  // 2. KPI Cards Grid
  kpiGridContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    minWidth: 160,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
  },
  kpiCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  kpiCardTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
    flex: 1,
  },
  kpiIconBadge: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiCardAmount: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
    marginVertical: 4,
  },
  kpiCardFooter: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 6,
    marginTop: 4,
  },
  kpiFooterNote: {
    fontSize: 11,
    color: '#64748B',
  },

  // 3. Tab Nav
  tabNavContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    padding: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  tabNavButton: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
  },
  tabNavButtonActive: {
    backgroundColor: '#10B981',
  },
  tabNavText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  tabNavTextActive: {
    color: '#FFFFFF',
    fontWeight: '700',
  },

  // Tab Content Area
  tabContentArea: {
    gap: 16,
  },

  // 4. Performance Bezier Curve Chart
  chartCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
  },
  chartHeader: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 12,
  },
  chartSectionTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  smoothPill: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  smoothPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  chartSectionSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  seriesToggleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  seriesToggleChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  seriesDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  seriesToggleText: {
    fontSize: 12,
    color: '#475569',
    fontWeight: '500',
  },

  pointInspectorBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pointInspectorHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  pointInspectorDate: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  marginPill: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
  },
  marginPillText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338CA',
  },
  pointInspectorMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
  },
  pointMetricItem: {
    flex: 1,
    minWidth: 100,
  },
  pointMetricLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  pointMetricValue: {
    fontSize: 15,
    fontWeight: '800',
    marginTop: 2,
  },

  chartCanvasContainer: {
    width: '100%',
    paddingVertical: 6,
  },

  chartFootRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 12,
    marginTop: 10,
    gap: 16,
  },
  chartFootMetric: {
    flex: 1,
    minWidth: 120,
  },
  chartFootLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  chartFootValue: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F172A',
    marginTop: 2,
  },

  // 5. Two Col Layout
  twoColGrid: {
    flexDirection: 'row',
    gap: 16,
  },
  colCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cardHeaderWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
  },
  cardHeaderWithAction: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  blockTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  blockSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },

  // P&L Waterfall
  waterfallContainer: {
    gap: 12,
  },
  waterfallStep: {
    padding: 10,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  waterfallFinalStep: {
    backgroundColor: '#ECFDF5',
    borderColor: '#A7F3D0',
    borderWidth: 1.5,
  },
  waterfallStepHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  wfStepTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },
  wfStepAmount: {
    fontSize: 14,
    fontWeight: '700',
  },
  wfProgressBarBg: {
    height: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 3,
    overflow: 'hidden',
    marginVertical: 4,
  },
  wfProgressBarFill: {
    height: 6,
    borderRadius: 3,
  },
  wfStepHelp: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },

  // Liquidity Bars
  liquidityBarsBox: {
    gap: 12,
  },
  liqItem: {
    backgroundColor: '#F8FAFC',
    padding: 10,
    borderRadius: 8,
  },
  liqLabelRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  liqName: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  liqVal: {
    fontSize: 14,
    fontWeight: '700',
  },
  liqTrack: {
    height: 8,
    backgroundColor: '#E2E8F0',
    borderRadius: 4,
    overflow: 'hidden',
  },
  liqFill: {
    height: 8,
    borderRadius: 4,
  },
  solvencyDiagnosisBox: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    marginTop: 6,
  },
  solvencyDiagTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  solvencyDiagDesc: {
    fontSize: 12,
    marginTop: 2,
    lineHeight: 17,
  },

  // Plain Accounts Guide
  plainGuideCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  guidePillGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  guideItem: {
    flex: 1,
    minWidth: 260,
    backgroundColor: '#F8FAFC',
    padding: 14,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#8B5CF6',
  },
  guideTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 6,
  },
  guideDesc: {
    fontSize: 12,
    color: '#475569',
    lineHeight: 18,
  },

  // Accounts Tab
  accountsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  accountCard: {
    flex: 1,
    minWidth: 220,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  cashAccountCard: {
    borderColor: '#A7F3D0',
    backgroundColor: '#F0FDF4',
  },
  accCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
  },
  accIconBox: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  accName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  accTypeLabel: {
    fontSize: 11,
    color: '#64748B',
  },
  accBalance: {
    fontSize: 22,
    fontWeight: '800',
    marginVertical: 8,
  },
  accCardBottom: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    paddingTop: 8,
  },
  accStatusText: {
    fontSize: 11,
    color: '#10B981',
    fontWeight: '600',
  },
  accTransferBtn: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  accTransferBtnText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0F172A',
  },

  transferRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  trIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  trRoute: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  trSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  trAmount: {
    fontSize: 15,
    fontWeight: '700',
    color: '#6366F1',
  },

  // Party rows
  searchBarContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    height: 44,
    marginBottom: 8,
  },
  searchBarInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  partyRowItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  partyRankBadge: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#FDF2F8',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
  },
  partyRankText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#BE185D',
  },
  partyName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  partyDetails: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  partyBalance: {
    fontSize: 15,
    fontWeight: '800',
  },
  partyBalanceTag: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
    marginTop: 1,
  },
  callIconButton: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailLinkButton: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BE185D',
    backgroundColor: '#FFFFFF',
  },
  detailLinkText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#BE185D',
  },

  primaryActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#10B981',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  primaryActionText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },

  // Expense Rows
  expenseItemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  expIconBox: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#FFFBEB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  expTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  expSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  expAmt: {
    fontSize: 15,
    fontWeight: '700',
    color: '#D97706',
  },

  // 6. Q&A Assistant Section
  qaSearchCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  qaHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  qaIconBadge: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: '#EEF2FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  qaMainTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  qaMainSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  qaInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1.5,
    borderColor: '#6366F1',
    borderRadius: 12,
    paddingHorizontal: 14,
    height: 52,
    marginBottom: 16,
  },
  qaTextInput: {
    flex: 1,
    fontSize: 15,
    color: '#0F172A',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  qaPillsHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 10,
  },
  qaChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  qaChip: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  qaChipActive: {
    backgroundColor: '#EEF2FF',
    borderColor: '#6366F1',
  },
  qaChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  qaChipTextActive: {
    color: '#4338CA',
    fontWeight: '700',
  },

  qaAnswerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1.5,
    borderColor: '#6366F1',
    shadowColor: '#6366F1',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  qaAnswerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 12,
    marginBottom: 14,
  },
  qaTagPill: {
    backgroundColor: '#EEF2FF',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  qaTagText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#4338CA',
  },
  qaQuestionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
    flex: 1,
  },
  qaAnswerBody: {
    gap: 14,
  },
  qaHeadlineRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
  },
  qaAnswerHeadline: {
    fontSize: 26,
    fontWeight: '900',
    color: '#0F172A',
  },
  qaAnswerBadge: {
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  qaAnswerBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#065F46',
  },
  qaBreakdownGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    backgroundColor: '#F8FAFC',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  qaDetailItem: {
    flex: 1,
    minWidth: 160,
  },
  qaDetailLabel: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  qaDetailVal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    marginTop: 2,
  },
  qaExplanationBox: {
    backgroundColor: '#FAF5FF',
    padding: 14,
    borderRadius: 10,
    borderLeftWidth: 3,
    borderLeftColor: '#8B5CF6',
  },
  qaExplanationTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#6B21A8',
    marginBottom: 4,
  },
  qaExplanationText: {
    fontSize: 13,
    color: '#581C87',
    lineHeight: 19,
  },
  qaActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#6366F1',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    marginTop: 4,
  },
  qaActionBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
});
