import React, { useState, useMemo, useEffect, useRef } from 'react';
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
} from '../ui';
import { AppIcon, icons } from '../icons';
import { useBreakpoint } from '../responsive';
import { printReport, printedAtStamp, type ReportDoc, type ReportRow } from '../report';
import {
  FilterModal,
  ExpenseModal,
  MoneyTransferModal,
  ReceivableModal,
  PayableModal,
  KpiDetailModal,
  type AcctFilter,
  type KpiKind,
} from '../screens';

interface AccountsDashboardProps {
  go?: (route: string) => void;
  focus?: { kind: 'c' | 'v'; id: string } | null;
  onFocusDone?: () => void;
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

const presetRange = (id: 'today' | 'last7' | 'thisMonth' | 'last3m' | 'thisYear', td: string): AcctFilter => {
  if (id === 'last7') return { from: addDays(td, -6), to: td };
  if (id === 'thisMonth') return { from: monthStart(td), to: monthEnd(td) };
  if (id === 'last3m') return { from: monthStart(monthShiftStart(td, -3)), to: monthEnd(monthShiftStart(td, -1)) };
  if (id === 'thisYear') return { from: `${td.slice(0, 4)}-01-01`, to: `${td.slice(0, 4)}-12-31` };
  return { from: td, to: td };
};

export function AccountsDashboard({ go, focus, onFocusDone }: AccountsDashboardProps) {
  const {
    t,
    lang,
    stats,
    customers,
    vendors,
    bal,
    expenses,
    sales,
    purchases,
    cTx,
    returns,
    products,
    moneyAccounts,
    moneyBalances,
    transfers,
    saveExpense,
    deleteExpense,
    loadFinance,
    financePeriod,
  } = useApp();

  const m = useMoney();
  const n = useNum();
  const fd = useDateStr();
  const s = stats();
  const td = today();
  const { isDesktop, isTablet, isMobile, width } = useBreakpoint();

  // Active navigation tab
  // 'overview' | 'accounts' | 'due' | 'pay' | 'expense' | 'qa'
  const [activeTab, setActiveTab] = useState<'overview' | 'accounts' | 'due' | 'pay' | 'expense' | 'qa'>('overview');

  // Filter state
  const [fltPreset, setFltPreset] = useState<'today' | 'last7' | 'thisMonth' | 'last3m' | 'thisYear' | 'custom'>('thisMonth');
  const [flt, setFlt] = useState<AcctFilter>(() => presetRange('thisMonth', today()));
  const [fltModalOpen, setFltModalOpen] = useState(false);

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

  const f: PeriodFinance | null = finFor === finKey ? financePeriod : null;

  // Modals state
  const [transferModalOpen, setTransferModalOpen] = useState(false);
  const [kpiModal, setKpiModal] = useState<KpiKind | null>(null);
  const [selectedCustId, setSelectedCustId] = useState<string | null>(null);
  const [selectedVendorId, setSelectedVendorId] = useState<string | null>(null);
  const [expenseFormItem, setExpenseFormItem] = useState<Expense | null | undefined>(undefined);

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
  const [qaQuery, setQaQuery] = useState('');
  const [activeQuestionId, setActiveQuestionId] = useState<string>('q1');
  const qaInputRef = useRef<TextInput>(null);

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
    setFlt(presetRange(p, td));
  };

  // Expense categories breakdown
  const expenseBreakdown = useMemo(() => {
    const periodExps = expenses.filter(e => inPeriod(e.date));
    const totalExp = periodExps.reduce((sum, e) => sum + e.amount, 0);
    const catMap: Record<string, number> = {};
    for (const e of periodExps) {
      const cat = e.category === 'other' && e.customName ? e.customName : e.category;
      catMap[cat] = (catMap[cat] || 0) + e.amount;
    }
    return Object.entries(catMap)
      .map(([cat, amt]) => ({
        category: cat,
        amount: amt,
        pct: totalExp > 0 ? Math.round((amt / totalExp) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [expenses, flt]);

  // Print Complete Accounts Statement
  const handlePrintStatement = () => {
    const doc: ReportDoc = {
      shop: lang === 'bn' ? 'চালের আড়ত লিমিটেড' : 'Chaler Arot Ltd',
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
          title: lang === 'bn' ? '২. আয় ও পরিচালন মুনাফা (P&L)' : '2. Income & Net Profit',
          rows: [
            { label: lang === 'bn' ? 'মোট বিক্রয় (Net Sales)' : 'Net Sales', right: m(fSale) },
            { label: lang === 'bn' ? 'চালের ক্রয় মূল্য (COGS)' : 'Cost of Goods Sold', right: m(fCogs), neg: true },
            { label: lang === 'bn' ? 'মোট বাণিজ্যিক লাভ (Gross Profit)' : 'Gross Profit', right: m(fGrossProfit), bold: true },
            { label: lang === 'bn' ? 'পরিচালন ব্যয় (Operating Expenses)' : 'Operating Expenses', right: m(fExp), neg: true },
            { label: lang === 'bn' ? 'প্রকৃত নিট মুনাফা (Net Profit)' : 'Net Profit', right: m(fProfit), bold: true },
          ],
        },
        {
          title: lang === 'bn' ? '৩. পাওনা ও দেনা স্থিতি' : '3. Receivables & Payables',
          rows: [
            { label: lang === 'bn' ? 'বাজারে কাস্টমারদের কাছে মোট বাকি' : 'Customer Receivables', right: m(totalDueAmount) },
            { label: lang === 'bn' ? 'মহাজন/মিলের মোট দেনা' : 'Vendor Payables', right: m(totalPayableAmount), neg: true },
            { label: lang === 'bn' ? 'নিট তারল্য উদ্বৃত্ত (Working Capital)' : 'Net Working Capital', right: m(netSolvencyScore), bold: true },
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
  const qaQuestions = useMemo(() => [
    {
      id: 'q1',
      titleBn: 'এই সময়ে আমাদের আসল লাভ (Net Profit) কত হয়েছে?',
      titleEn: 'What is our net profit in this period?',
      tag: 'লাভ-ক্ষতি',
      answer: {
        headline: m(fProfit),
        badge: fSale > 0 ? `${lang === 'bn' ? 'মুনাফা মার্জিন' : 'Profit Margin'}: ${Math.round((fProfit / fSale) * 100)}%` : '',
        details: [
          { label: lang === 'bn' ? 'মোট চাল বিক্রয়' : 'Gross Sales', val: m(fSale) },
          { label: lang === 'bn' ? 'চালের ক্রয় খরচ (COGS)' : 'Cost of Goods (COGS)', val: m(fCogs) },
          { label: lang === 'bn' ? 'মোট বাণিজ্যিক লাভ' : 'Gross Profit', val: m(fGrossProfit) },
          { label: lang === 'bn' ? 'দোকান ও পরিচালনা খরচ' : 'Operating Expenses', val: m(fExp) },
        ],
        explanation: lang === 'bn'
          ? `সব খরচ বাদ দিয়ে আপনার চূড়ান্ত আসল লাভ দাঁড়িয়েছে ${m(fProfit)} টাকা। বিক্রয় থেকে সরাসরি চালের কেনা দাম বাদ দেওয়ার পর মোট লাভ হয়েছিল ${m(fGrossProfit)}, যা থেকে দোকান ভাড়া, বেতন, পরিবহন ইত্যাদি ${m(fExp)} টাকা ব্যয় হয়েছে।`
          : `After all costs, your net profit is ${m(fProfit)}. Gross profit was ${m(fGrossProfit)}, minus operating expenses of ${m(fExp)}.`,
        actionLabel: lang === 'bn' ? 'লাভ-ক্ষতির বিস্তারিত বিবরণী দেখুন' : 'View P&L Statement',
        action: () => setActiveTab('overview'),
      },
    },
    {
      id: 'q2',
      titleBn: 'বর্তমানে কার কাছে সবচেয়ে বেশি টাকা পাওনা বাকি আছে?',
      titleEn: 'Who owes us the most money right now?',
      tag: 'কাস্টমার পাওনা',
      answer: {
        headline: customerDues[0] ? `${customerDues[0].customer.name} (${m(customerDues[0].balance)})` : (lang === 'bn' ? 'কোনো বাকি নেই' : 'No dues'),
        badge: `${lang === 'bn' ? 'মোট বাকি' : 'Total Due'}: ${m(totalDueAmount)} (${totalDueCount} ${lang === 'bn' ? 'জন খরিদ্দার' : 'customers'})`,
        details: customerDues.slice(0, 4).map(cd => ({
          label: `${cd.customer.name} (${cd.customer.mobile || 'নম্বর নেই'})`,
          val: m(cd.balance),
        })),
        explanation: lang === 'bn'
          ? `বাজারে বর্তমানে ${totalDueCount} জন খরিদ্দারের কাছে সর্বমোট ${m(totalDueAmount)} টাকা পাওনা রয়েছে। এদের মধ্যে শীর্ষে আছেন ${customerDues[0]?.customer.name ?? 'কেউ নেই'}, যার কাছে ${m(customerDues[0]?.balance ?? 0)} টাকা বাকি রয়েছে।`
          : `A total of ${m(totalDueAmount)} is due from ${totalDueCount} customers. Top due customer is ${customerDues[0]?.customer.name ?? 'None'}.`,
        actionLabel: lang === 'bn' ? 'খরিদ্দারদের বাকি খতিয়ান খুলুন' : 'Open Receivables Ledger',
        action: () => setActiveTab('due'),
      },
    },
    {
      id: 'q3',
      titleBn: 'মহাজনদের মোট দেনা কত এবং কার কার পাওনা মেটাতে হবে?',
      titleEn: 'What is our total vendor payable and who must be paid?',
      tag: 'মহাজন দেনা',
      answer: {
        headline: m(totalPayableAmount),
        badge: `${totalPayableCount} ${lang === 'bn' ? 'জন মহাজনের দেনা বকেয়া' : 'Vendors Pending'}`,
        details: vendorPayables.slice(0, 4).map(vp => ({
          label: `${vp.vendor.name} (${vp.vendor.mobile || 'নম্বর নেই'})`,
          val: m(vp.balance),
        })),
        explanation: lang === 'bn'
          ? `চালের মিল ও পাইকারি সরবরাহকারী ${totalPayableCount} জন মহাজনের কাছে সর্বমোট ${m(totalPayableAmount)} টাকা দেনা পরিশোধ করা বাকি রয়েছে। সবচেয়ে বড় পাওনাদার: ${vendorPayables[0]?.vendor.name ?? 'কেউ নেই'} (${m(vendorPayables[0]?.balance ?? 0)})।`
          : `You owe ${m(totalPayableAmount)} across ${totalPayableCount} vendors. Highest payable: ${vendorPayables[0]?.vendor.name ?? 'None'} (${m(vendorPayables[0]?.balance ?? 0)}).`,
        actionLabel: lang === 'bn' ? 'মহাজনদের দেনা খতিয়ান খুলুন' : 'Open Vendor Ledger',
        action: () => setActiveTab('pay'),
      },
    },
    {
      id: 'q4',
      titleBn: 'বর্তমানে ক্যাশ ড্রয়ার ও ব্যাংক অ্যাকাউন্টগুলোতে কত টাকা আছে?',
      titleEn: 'How much money is in cash drawer and bank accounts?',
      tag: 'তহবিল ও ক্যাশ',
      answer: {
        headline: m(totalLiquidMoney),
        badge: `${lang === 'bn' ? 'ক্যাশ' : 'Cash'}: ${m(totalCashInHand)} | ${lang === 'bn' ? 'ব্যাংক' : 'Bank'}: ${m(totalBankBalances)}`,
        details: moneyAccounts.map(acc => ({
          label: `${acc.name} (${acc.type === 'cash' ? (lang === 'bn' ? 'ক্যাশ বাক্স' : 'Cash Drawer') : acc.type.toUpperCase()})`,
          val: m(acc.balance || 0),
        })),
        explanation: lang === 'bn'
          ? `আপনার ব্যবসায়ে তাৎক্ষণিক ব্যয় মেটানোর মতো সর্বমোট ${m(totalLiquidMoney)} টাকা প্রস্তুত রয়েছে। এর মধ্যে দোকানের ক্যাশ বাক্সে রয়েছে ${m(totalCashInHand)} টাকা এবং বিভিন্ন ব্যাংক ও মোবাইল ওয়ালেটে রয়েছে ${m(totalBankBalances)} টাকা।`
          : `You have ${m(totalLiquidMoney)} in total liquid reserves: ${m(totalCashInHand)} in cash drawer and ${m(totalBankBalances)} in bank accounts.`,
        actionLabel: lang === 'bn' ? 'ফান্ড ট্রান্সফার করুন' : 'Transfer Money',
        action: () => setTransferModalOpen(true),
      },
    },
    {
      id: 'q5',
      titleBn: 'আমাদের সবচেয়ে বেশি খরচ কোন খাতে হচ্ছে?',
      titleEn: 'Which expense category has the highest spending?',
      tag: 'ব্যয় বিশ্লেষণ',
      answer: {
        headline: expenseBreakdown[0] ? `${expenseBreakdown[0].category} (${m(expenseBreakdown[0].amount)})` : (lang === 'bn' ? 'কোনো খরচ নেই' : 'No expenses'),
        badge: `${lang === 'bn' ? 'মোট খরচ' : 'Total Exp'}: ${m(fExp)}`,
        details: expenseBreakdown.slice(0, 5).map(eb => ({
          label: eb.category,
          val: `${m(eb.amount)} (${eb.pct}%)`,
        })),
        explanation: lang === 'bn'
          ? `নির্বাচিত সময়ে সর্বমোট ${m(fExp)} টাকা দোকান পরিচালনা ও পরিবহনে খরচ হয়েছে। এর মধ্যে সবচেয়ে ব্যয়বহুল খাত হলো '${expenseBreakdown[0]?.category ?? 'খরচ নেই'}', যেখানে মোট ব্যয়ের প্রায় ${expenseBreakdown[0]?.pct ?? 0}% খরচ হয়েছে।`
          : `Total operational expenditure is ${m(fExp)}. Highest category is '${expenseBreakdown[0]?.category ?? 'None'}' accounting for ${expenseBreakdown[0]?.pct ?? 0}% of expenses.`,
        actionLabel: lang === 'bn' ? 'খরচের তালিকা দেখুন' : 'View Expense Ledger',
        action: () => setActiveTab('expense'),
      },
    },
    {
      id: 'q6',
      titleBn: 'গুদামে বর্তমানে কত বস্তা এবং কত টাকার চালের স্টক রয়েছে?',
      titleEn: 'How many bags and value of rice are currently in stock?',
      tag: 'স্টক ও গুদাম',
      answer: {
        headline: `${n(inventorySummary.totalBags)} ${lang === 'bn' ? 'বস্তা' : 'Bags'} (${m(inventorySummary.totalValuation)})`,
        badge: `${n(Math.round(inventorySummary.totalKg / 1000))} ${lang === 'bn' ? 'টন চাল' : 'Tons Rice'}`,
        details: [
          { label: lang === 'bn' ? 'মোট চালের পরিমাণ' : 'Total Stock Weight', val: `${n(inventorySummary.totalKg)} kg` },
          { label: lang === 'bn' ? 'মোট ফিজিক্যাল বস্তা' : 'Physical Bags', val: `${n(inventorySummary.totalBags)} bags` },
          { label: lang === 'bn' ? 'স্টক ক্রয়মূল্য (Asset Value)' : 'Stock Valuation', val: m(inventorySummary.totalValuation) },
        ],
        explanation: lang === 'bn'
          ? `গুদামে বর্তমানে মোট ${n(inventorySummary.totalBags)} বস্তা চাল জমা রয়েছে, যার মোট বর্তমান কেনা দাম প্রায় ${m(inventorySummary.totalValuation)} টাকা। এটি আপনার ব্যবসার মূল চলতি মূলধন।`
          : `The warehouse currently holds ${n(inventorySummary.totalBags)} bags of rice with an inventory cost valuation of ${m(inventorySummary.totalValuation)}.`,
        actionLabel: lang === 'bn' ? 'স্টক ম্যানেজমেন্ট খুলুন' : 'Open Stock Management',
        action: () => go?.('stock'),
      },
    },
    {
      id: 'q7',
      titleBn: 'আমাদের ব্যবসার আর্থিক স্বাস্থ্য (Financial Health) এবং তারল্য নিরাপত্তা কেমন?',
      titleEn: 'What is our business solvency and financial health?',
      tag: 'আর্থিক স্বাস্থ্য',
      answer: {
        headline: solvencyRatio >= 120
          ? (lang === 'bn' ? 'অত্যন্ত সুরক্ষিত ও শক্তিশালী' : 'Highly Solvent')
          : solvencyRatio >= 100
          ? (lang === 'bn' ? 'স্বাভাবিক ও ব্যালেন্সড' : 'Balanced & Safe')
          : (lang === 'bn' ? 'সতর্কতা: দেনা কিছুটা বেশি' : 'Caution: High Payables'),
        badge: `${lang === 'bn' ? 'নিট চলতি উদ্বৃত্ত' : 'Working Capital'}: ${m(netSolvencyScore)}`,
        details: [
          { label: lang === 'bn' ? 'হাতে ক্যাশ ও ব্যাংক' : 'Liquid Cash', val: m(totalLiquidMoney) },
          { label: lang === 'bn' ? 'বাজারে কাস্টমার পাওনা' : 'Customer Due', val: m(totalDueAmount) },
          { label: lang === 'bn' ? 'মহাজনদের মোট দেনা' : 'Vendor Payable', val: m(totalPayableAmount) },
          { label: lang === 'bn' ? 'তারল্য কাভারেজ অনুপাত' : 'Coverage Ratio', val: `${Math.round(solvencyRatio)}%` },
        ],
        explanation: lang === 'bn'
          ? `আপনার নগদ টাকা (${m(totalLiquidMoney)}) এবং বাজারের পাওনা (${m(totalDueAmount)}) মিলিয়ে মহাজনদের মোট দেনার (${m(totalPayableAmount)}) প্রায় ${Math.round(solvencyRatio)}% মেটানো সম্ভব। ${solvencyRatio >= 100 ? 'অতএব ব্যবসায়ে কোনো ক্যাশ সংকটের ঝুঁকি নেই।' : 'বকেয়া পাওনা দ্রুত কালেকশন করা বাঞ্ছনীয়।'}`
          : `Liquid reserves (${m(totalLiquidMoney)}) and customer dues (${m(totalDueAmount)}) cover ${Math.round(solvencyRatio)}% of vendor payables (${m(totalPayableAmount)}).`,
        actionLabel: lang === 'bn' ? 'হিসাব অডিট রিপোর্ট প্রিন্ট করুন' : 'Print Audit Statement',
        action: handlePrintStatement,
      },
    },
    {
      id: 'q8',
      titleBn: 'দৈনিক গড়ে কত টাকার চাল বিক্রি ও কালেকশন হচ্ছে?',
      titleEn: 'What is our daily average sales and collection?',
      tag: 'দৈনিক গড়',
      answer: {
        headline: `${lang === 'bn' ? 'গড় বিক্রয়' : 'Avg Sale'}: ${m(Math.round(fSale / (timelineData.length || 1)))}/দিন`,
        badge: `${lang === 'bn' ? 'গড় কালেকশন' : 'Avg Collect'}: ${m(Math.round(fCollect / (timelineData.length || 1)))}/দিন`,
        details: [
          { label: lang === 'bn' ? 'নির্বাচিত সময়কাল' : 'Days in Period', val: `${n(timelineData.length)} days` },
          { label: lang === 'bn' ? 'মোট বিক্রয়' : 'Period Sales', val: m(fSale) },
          { label: lang === 'bn' ? 'মোট কালেকশন' : 'Period Collection', val: m(fCollect) },
          { label: lang === 'bn' ? 'গড় দৈনিক মুনাফা' : 'Daily Avg Profit', val: m(Math.round(fProfit / (timelineData.length || 1))) },
        ],
        explanation: lang === 'bn'
          ? `এই ফিল্টারের ${n(timelineData.length)} দিনে প্রতিদিন গড়ে ${m(Math.round(fSale / (timelineData.length || 1)))} টাকার চাল বিক্রি হয়েছে এবং দৈনিক গড়ে ${m(Math.round(fCollect / (timelineData.length || 1)))} টাকা নগদ আদায় হয়েছে।`
          : `Across ${n(timelineData.length)} days, average daily rice sales were ${m(Math.round(fSale / (timelineData.length || 1)))} and collections were ${m(Math.round(fCollect / (timelineData.length || 1)))}.`,
        actionLabel: lang === 'bn' ? 'ট্রেন্ড কার্ভ ও চার্ট দেখুন' : 'View Performance Curve',
        action: () => setActiveTab('overview'),
      },
    },
  ], [
    lang,
    fProfit,
    fSale,
    fCogs,
    fGrossProfit,
    fExp,
    fCollect,
    customerDues,
    totalDueAmount,
    totalDueCount,
    vendorPayables,
    totalPayableAmount,
    totalPayableCount,
    totalLiquidMoney,
    totalCashInHand,
    totalBankBalances,
    moneyAccounts,
    expenseBreakdown,
    inventorySummary,
    netSolvencyScore,
    solvencyRatio,
    timelineData,
    m,
    n,
    go,
  ]);

  // Selected Q&A or search match
  const selectedQa = useMemo(() => {
    const q = qaQuery.trim().toLowerCase();
    if (!q) {
      return qaQuestions.find(item => item.id === activeQuestionId) ?? qaQuestions[0];
    }

    // Try matching specific customer
    const matchCust = customers.find(c => c.name.toLowerCase().includes(q) || (c.mobile && c.mobile.includes(q)));
    if (matchCust) {
      const balance = bal('c', matchCust.id).balance;
      return {
        id: 'cust-match',
        titleBn: `খরিদ্দার '${matchCust.name}' এর বর্তমান বাকি ও হিসাব`,
        titleEn: `Account details for customer '${matchCust.name}'`,
        tag: 'খরিদ্দার খোঁজ',
        answer: {
          headline: m(balance),
          badge: balance > 0 ? (lang === 'bn' ? 'বাকি বকেয়া রয়েছে' : 'Payment Due') : (lang === 'bn' ? 'সম্পূর্ণ পরিশোধিত' : 'Fully Paid'),
          details: [
            { label: lang === 'bn' ? 'খরিদ্দারের নাম' : 'Customer Name', val: matchCust.name },
            { label: lang === 'bn' ? 'মোবাইল নম্বর' : 'Phone', val: matchCust.mobile || 'নম্বর নেই' },
            { label: lang === 'bn' ? 'ঠিকানা' : 'Address', val: matchCust.address || 'ঠিকানা নেই' },
            { label: lang === 'bn' ? 'বর্তমান ব্যালেন্স' : 'Current Balance', val: m(balance) },
          ],
          explanation: lang === 'bn'
            ? `${matchCust.name} এর কাছে বর্তমানে ${m(balance)} টাকা পাওনা রয়েছে। খরিদ্দারের সম্পূর্ণ লেজার ও চালান দেখতে নিচের বোতামে চাপুন।`
            : `${matchCust.name} currently has an outstanding balance of ${m(balance)}. Click below to view detailed ledger.`,
          actionLabel: lang === 'bn' ? 'চালান ও খতিয়ান দেখুন' : 'View Ledger',
          action: () => setSelectedCustId(matchCust.id),
        },
      };
    }

    // Try matching specific vendor
    const matchVendor = vendors.find(v => v.name.toLowerCase().includes(q) || (v.mobile && v.mobile.includes(q)));
    if (matchVendor) {
      const balance = bal('v', matchVendor.id).balance;
      return {
        id: 'vendor-match',
        titleBn: `মহাজন '${matchVendor.name}' এর পাওনা ও দেনার হিসাব`,
        titleEn: `Payable details for vendor '${matchVendor.name}'`,
        tag: 'মহাজন খোঁজ',
        answer: {
          headline: m(balance),
          badge: balance > 0 ? (lang === 'bn' ? 'পরিশোধ বকেয়া রয়েছে' : 'Payable Due') : (lang === 'bn' ? 'পরিশোধিত' : 'Paid'),
          details: [
            { label: lang === 'bn' ? 'মহাজনের নাম' : 'Vendor Name', val: matchVendor.name },
            { label: lang === 'bn' ? 'মোবাইল নম্বর' : 'Phone', val: matchVendor.mobile || 'নম্বর নেই' },
            { label: lang === 'bn' ? 'বর্তমান দেনা' : 'Current Due', val: m(balance) },
          ],
          explanation: lang === 'bn'
            ? `মহাজন ${matchVendor.name} এর কাছে মোট দেনা বাকি রয়েছে ${m(balance)} টাকা।`
            : `You owe ${matchVendor.name} a total of ${m(balance)}.`,
          actionLabel: lang === 'bn' ? 'মহাজন খতিয়ান দেখুন' : 'View Ledger',
          action: () => setSelectedVendorId(matchVendor.id),
        },
      };
    }

    // Keyword matching
    if (q.includes('লাভ') || q.includes('মুনাফা') || q.includes('profit') || q.includes('মার্জিন')) return qaQuestions[0];
    if (q.includes('বাকি') || q.includes('পাওনা') || q.includes('due') || q.includes('খরিদ্দার')) return qaQuestions[1];
    if (q.includes('দেনা') || q.includes('মহাজন') || q.includes('payable') || q.includes('মিল')) return qaQuestions[2];
    if (q.includes('ক্যাশ') || q.includes('ব্যাংক') || q.includes('টাকা') || q.includes('তহবিল') || q.includes('cash') || q.includes('bank')) return qaQuestions[3];
    if (q.includes('খরচ') || q.includes('ব্যয়') || q.includes('expense')) return qaQuestions[4];
    if (q.includes('স্টক') || q.includes('বস্তা') || q.includes('গুদাম') || q.includes('stock')) return qaQuestions[5];
    if (q.includes('স্বাস্থ্য') || q.includes('নিরাপত্তা') || q.includes('health') || q.includes('ঝুঁকি')) return qaQuestions[6];
    if (q.includes('গড়') || q.includes('দৈনিক') || q.includes('average')) return qaQuestions[7];

    return qaQuestions.find(item => item.id === activeQuestionId) ?? qaQuestions[0];
  }, [qaQuery, activeQuestionId, qaQuestions, customers, vendors, bal, m, lang]);

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
      item.customer.name.toLowerCase().includes(q) || (item.customer.mobile && item.customer.mobile.includes(q))
    );
  }, [customerDues, dueSearch]);

  const filteredVendorPayables = useMemo(() => {
    const q = paySearch.trim().toLowerCase();
    if (!q) return vendorPayables;
    return vendorPayables.filter(item =>
      item.vendor.name.toLowerCase().includes(q) || (item.vendor.mobile && item.vendor.mobile.includes(q))
    );
  }, [vendorPayables, paySearch]);

  const filteredExpensesList = useMemo(() => {
    const q = expSearch.trim().toLowerCase();
    return expenses
      .filter(e => {
        if (!inPeriod(e.date)) return false;
        if (expCatFilter !== 'all' && e.category !== expCatFilter) return false;
        if (!q) return true;
        const catName = e.category === 'other' && e.customName ? e.customName : e.category;
        return catName.toLowerCase().includes(q) || (e.note && e.note.toLowerCase().includes(q));
      })
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [expenses, flt, expSearch, expCatFilter]);

  return (
    <ScrollView style={styles.screenBg} contentContainerStyle={styles.scrollContent}>
      {/* 1. EXECUTIVE HEADER BANNER */}
      <View style={styles.headerBanner}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerLeftGroup}>
            <View style={styles.brandIconBox}>
              <AppIcon name={icons.accounts} size={28} iconColor="#10B981" />
            </View>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.headerMainTitle}>
                  {lang === 'bn' ? 'হিসাব ও আর্থিক অ্যানালিটিক্স' : 'Accounts & Financial Analytics'}
                </Text>
                <View style={styles.liveStatusPill}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveStatusText}>
                    {lang === 'bn' ? 'লাইভ সিঙ্ক' : 'Live Sync'}
                  </Text>
                </View>
              </View>
              <Text style={styles.headerSubTitle}>
                {lang === 'bn'
                  ? 'আড়তের নগদ ও ব্যাংক তহবিল, কাস্টমার বাকি, মহাজন দেনা ও আসল নিট মুনাফার পূর্ণাঙ্গ চিত্র'
                  : 'Complete overview of cash reserves, receivables, vendor payables & net profit'}
              </Text>
            </View>
          </View>

          {/* Quick Action Toolbar */}
          <View style={styles.headerActionToolbar}>
            <TouchableOpacity
              style={[styles.headerActionButton, { backgroundColor: '#10B981' }]}
              onPress={() => go?.('collect')}
            >
              <AppIcon name={icons.collect} size={18} iconColor="#fff" />
              <Text style={styles.headerActionTextWhite}>
                {lang === 'bn' ? 'কালেকশন' : 'Collect'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.headerActionButton, { backgroundColor: '#2563EB' }]}
              onPress={() => go?.('pay')}
            >
              <AppIcon name={icons.pay} size={18} iconColor="#fff" />
              <Text style={styles.headerActionTextWhite}>
                {lang === 'bn' ? 'মহাজন পরিশোধ' : 'Pay Vendor'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.headerActionGhostButton}
              onPress={() => setTransferModalOpen(true)}
            >
              <AppIcon name={icons.transfer} size={18} iconColor="#0F172A" />
              <Text style={styles.headerActionGhostText}>
                {lang === 'bn' ? 'ফান্ড ট্রান্সফার' : 'Transfer'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.headerActionGhostButton}
              onPress={() => setExpenseFormItem(null)}
            >
              <AppIcon name={icons.add} size={18} iconColor="#0F172A" />
              <Text style={styles.headerActionGhostText}>
                {lang === 'bn' ? 'নতুন খরচ' : 'Add Expense'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.headerActionGhostButton}
              onPress={handlePrintStatement}
            >
              <AppIcon name={icons.print} size={18} iconColor="#0F172A" />
              <Text style={styles.headerActionGhostText}>
                {lang === 'bn' ? 'প্রিন্ট রিপোর্ট' : 'Print'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Period Preset Filter Ribbon */}
        <View style={styles.periodRibbon}>
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
                  : (lang === 'bn' ? 'চলতি বছর' : 'This Year');
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
              <AppIcon name={icons.calendar} size={16} iconColor={fltPreset === 'custom' ? '#10B981' : '#64748B'} />
              <Text style={[styles.presetChipText, fltPreset === 'custom' && styles.presetChipTextActive]}>
                {formatPeriodLabel(flt.from, flt.to)}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Business Health Quick Badge */}
          <View style={styles.solvencyBannerPill}>
            <Text style={styles.solvencyPillLabel}>
              {lang === 'bn' ? 'তারল্য নিরাপত্তা:' : 'Solvency:'}
            </Text>
            <Text style={[styles.solvencyPillValue, { color: solvencyRatio >= 100 ? '#10B981' : '#EF4444' }]}>
              {solvencyRatio >= 100
                ? (lang === 'bn' ? 'নিরাপদ (১৮৫% কাভারেজ)' : 'Healthy Coverage')
                : (lang === 'bn' ? 'সতর্কতা: দেনা বেশি' : 'Caution')}
            </Text>
          </View>
        </View>
      </View>

      {/* 2. EXECUTIVE FINANCIAL KPI CARDS GRID */}
      <View style={styles.kpiGridContainer}>
        {/* Card 1: Total Liquid Funds */}
        <TouchableOpacity
          style={[styles.kpiCard, { borderTopColor: '#10B981', borderTopWidth: 4 }]}
          onPress={() => setActiveTab('accounts')}
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
      </View>

      {/* 3. MAIN TAB NAVIGATION */}
      <View style={styles.tabNavContainer}>
        {[
          { key: 'overview', labelBn: '📊 ওভারভিউ ও ট্রেন্ড কার্ভ', labelEn: 'Overview & Curves', icon: icons.profit },
          { key: 'accounts', labelBn: '🏦 ক্যাশ ও ব্যাংক তহবিল', labelEn: 'Cash & Bank Accounts', icon: icons.bankCash },
          { key: 'due', labelBn: `👥 কাস্টমার বাকি (${n(totalDueCount)})`, labelEn: `Receivables (${totalDueCount})`, icon: icons.customers },
          { key: 'pay', labelBn: `🏢 মহাজন দেনা (${n(totalPayableCount)})`, labelEn: `Payables (${totalPayableCount})`, icon: icons.vendors },
          { key: 'expense', labelBn: '📉 খরচের রেজিস্টার', labelEn: 'Expense Register', icon: icons.expense },
          { key: 'qa', labelBn: '💡 হিসাব সহকারী ও প্রশ্নোত্তর', labelEn: 'Accounts Assistant & Q&A', icon: icons.calc },
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
      {activeTab === 'overview' && (
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
                <Text style={styles.chartSectionSubtitle}>
                  {lang === 'bn'
                    ? 'দিনের গতিবিধির ওপর মাউস নিন বা স্পর্শ করুন বিস্তারিত দেখতে'
                    : 'Hover or tap on points to inspect exact daily financial figures'}
                </Text>
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
                    📅 {fd(activeCurvePoint.date)}
                  </Text>
                  <View style={styles.marginPill}>
                    <Text style={styles.marginPillText}>
                      {lang === 'bn' ? 'মার্জিন:' : 'Margin:'} {activeCurvePoint.margin}%
                    </Text>
                  </View>
                </View>

                <View style={styles.pointInspectorMetrics}>
                  <View style={styles.pointMetricItem}>
                    <Text style={styles.pointMetricLabel}>{lang === 'bn' ? 'বিক্রয়' : 'Sales'}</Text>
                    <Text style={[styles.pointMetricValue, { color: '#10B981' }]}>{m(activeCurvePoint.sales)}</Text>
                  </View>
                  <View style={styles.pointMetricItem}>
                    <Text style={styles.pointMetricLabel}>{lang === 'bn' ? 'খরচ' : 'Expense'}</Text>
                    <Text style={[styles.pointMetricValue, { color: '#EF4444' }]}>{m(activeCurvePoint.expense)}</Text>
                  </View>
                  <View style={styles.pointMetricItem}>
                    <Text style={styles.pointMetricLabel}>{lang === 'bn' ? 'আসল নিট লাভ' : 'Net Profit'}</Text>
                    <Text style={[styles.pointMetricValue, { color: '#6366F1' }]}>{m(activeCurvePoint.profit)}</Text>
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
                  <Text style={styles.blockSubtitle}>
                    {lang === 'bn' ? 'যে কেউ সহজেই বুঝতে পারবে প্রতি ১০০ টাকায় কত লাভ থাকে' : 'Clear breakdown from gross revenue to net pocket profit'}
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
                  <Text style={styles.blockSubtitle}>
                    {lang === 'bn' ? 'মহাজন দেনার বিপরীতে ক্যাশ ও পাওনার সুরক্ষা' : 'Cash + Receivables vs Vendor Payables'}
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
          <View style={styles.plainGuideCard}>
            <View style={styles.cardHeaderWithIcon}>
              <AppIcon name={icons.calc} size={24} iconColor="#8B5CF6" />
              <View>
                <Text style={styles.blockTitle}>
                  {lang === 'bn' ? 'সহজ ভাষায় এই হিসাবের অর্থ কী? (যে কোনো মানুষের বোঝার জন্য)' : 'Plain Language Accounting Guide (Easy for Anyone)'}
                </Text>
                <Text style={styles.blockSubtitle}>
                  {lang === 'bn' ? 'অ্যাকাউন্টিং না জানা যেকোনো সাধারণ ব্যবসায়ী বা কর্মচারীর বোঝার সহজ ব্যাখ্যা' : 'Clear explanations of core accounting metrics'}
                </Text>
              </View>
            </View>

            <View style={[styles.guidePillGrid, isMobile && { flexDirection: 'column' }]}>
              <View style={styles.guideItem}>
                <Text style={styles.guideTitle}>
                  💡 {lang === 'bn' ? 'গ্রস প্রফিট (মোট লাভ) বনাম নেট প্রফিট (আসল লাভ) এর ফারাক কী?' : 'Gross vs Net Profit?'}
                </Text>
                <Text style={styles.guideDesc}>
                  {lang === 'bn'
                    ? 'মোট লাভ (Gross Profit) হলো চাল কেনা দাম এবং বিক্রয় দামের মধ্যবর্তী সরাসরি লাভ। আর নেট প্রফিট হলো দোকান ভাড়া, কর্মচারীর বেতন, ট্রাক ভাড়া ও বিদ্যুৎ বিল ইত্যাদি সব খরচ বাদ দেওয়ার পর আপনার পকেটে যা আসল মুনাফা হিসেবে জমা থাকে।'
                    : 'Gross profit is trading profit (Sales minus Rice Cost). Net profit is what remains in your pocket after paying rent, staff, electricity, and transport.'}
                </Text>
              </View>

              <View style={styles.guideItem}>
                <Text style={styles.guideTitle}>
                  💡 {lang === 'bn' ? 'বিক্রয় (Sales) এবং কালেকশন (Collection) কেন আলাদা?' : 'Sales vs Collection?'}
                </Text>
                <Text style={styles.guideDesc}>
                  {lang === 'bn'
                    ? 'বিক্রয় মানে মোট কত টাকার চাল খরিদ্দারের কাছে গেছে (নগদ বা বাকি)। আর কালেকশন হলো বাস্তবে আপনার ক্যাশ ড্রয়ারে বা ব্যাংক অ্যাকাউন্টে মোট কত নগদ টাকা এসে জমা হয়েছে।'
                    : 'Sales is the total invoice amount of rice sent out. Collection is the real cash that actually reached your drawer or bank.'}
                </Text>
              </View>

              <View style={styles.guideItem}>
                <Text style={styles.guideTitle}>
                  💡 {lang === 'bn' ? 'COGS (চালের ক্রয় খরচ) কী এবং কেন এটি জরুরি?' : 'What is COGS?'}
                </Text>
                <Text style={styles.guideDesc}>
                  {lang === 'bn'
                    ? 'যে চালগুলো নির্দিষ্ট সময়ে বিক্রি হয়েছে, সেগুলো পাইকারি কত দরে কেনা হয়েছিল তার মূল্য হলো COGS। বিক্রয় থেকে এই কেনা খরচ বাদ দিলেই পণ্যের আসল ব্যবসায়িক লাভ পাওয়া যায়।'
                    : 'COGS is the wholesale cost paid to mills for the exact bags of rice that were sold during this period.'}
                </Text>
              </View>

              <View style={styles.guideItem}>
                <Text style={styles.guideTitle}>
                  💡 {lang === 'bn' ? 'পাওনা বনাম দেনার ঝুঁকি কীভাবে বুঝবেন?' : 'Receivable vs Payable Risk?'}
                </Text>
                <Text style={styles.guideDesc}>
                  {lang === 'bn'
                    ? 'কাস্টমারদের কাছে বাকি টাকা এবং ক্যাশ ড্রয়ারের টাকার যোগফল সবসময় মহাজন দেনার চেয়ে বেশি থাকা প্রয়োজন। এটি ১০০% এর নিচে নামলে জরুরি দেনা মেটাতে ক্যাশ সংকট হতে পারে।'
                    : 'Ensure your cash plus customer dues comfortably exceed vendor liabilities to avoid any working capital squeeze.'}
                </Text>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* ==================== TAB 2: CASH & BANK ACCOUNTS ==================== */}
      {activeTab === 'accounts' && (
        <View style={styles.tabContentArea}>
          <View style={styles.cardHeaderWithAction}>
            <View>
              <Text style={styles.blockTitle}>{lang === 'bn' ? 'ক্যাশ ও ব্যাংক তহবিল ব্যবস্থাপনা' : 'Cash & Bank Reserves'}</Text>
              <Text style={styles.blockSubtitle}>
                {lang === 'bn' ? 'দোকানের ক্যাশ ড্রয়ার ও ব্যাংক হিসাবের বর্তমান ব্যালেন্স' : 'Live balance across all cash drawers and banks'}
              </Text>
            </View>
            <TouchableOpacity style={styles.primaryActionButton} onPress={() => setTransferModalOpen(true)}>
              <AppIcon name={icons.transfer} size={18} iconColor="#fff" />
              <Text style={styles.primaryActionText}>{lang === 'bn' ? 'ফান্ড ট্রান্সফার করুন' : 'Transfer Money'}</Text>
            </TouchableOpacity>
          </View>

          {/* Account Cards Grid */}
          <View style={styles.accountsGrid}>
            {moneyAccounts.map(acc => {
              const isCash = acc.type === 'cash';
              return (
                <View key={acc.id} style={[styles.accountCard, isCash && styles.cashAccountCard]}>
                  <View style={styles.accCardTop}>
                    <View style={styles.accIconBox}>
                      <AppIcon
                        name={isCash ? icons.cash : acc.type === 'bkash' ? icons.bkash : acc.type === 'nagad' ? icons.nagad : icons.bank}
                        size={24}
                        iconColor={isCash ? '#10B981' : '#2563EB'}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.accName}>{acc.name}</Text>
                      <Text style={styles.accTypeLabel}>
                        {isCash ? (lang === 'bn' ? 'দোকানের ক্যাশ ড্রয়ার' : 'Cash Drawer') : acc.type.toUpperCase()}
                      </Text>
                    </View>
                  </View>

                  <Text style={[styles.accBalance, { color: (acc.balance || 0) < 0 ? '#EF4444' : '#0F172A' }]}>
                    {m(acc.balance || 0)}
                  </Text>

                  <View style={styles.accCardBottom}>
                    <Text style={styles.accStatusText}>
                      {acc.active ? (lang === 'bn' ? '● সচল অ্যাকাউন্ট' : '● Active') : (lang === 'bn' ? 'নিষ্ক্রিয়' : 'Inactive')}
                    </Text>
                    <TouchableOpacity
                      style={styles.accTransferBtn}
                      onPress={() => setTransferModalOpen(true)}
                    >
                      <Text style={styles.accTransferBtnText}>{lang === 'bn' ? 'ট্রান্সফার' : 'Transfer'}</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Money Transfer History */}
          <View style={[styles.colCard, { marginTop: 16 }]}>
            <Text style={[styles.blockTitle, { marginBottom: 12 }]}>
              {lang === 'bn' ? 'সাম্প্রতিক ফান্ড ট্রান্সফার খতিয়ান' : 'Recent Money Transfers'}
            </Text>
            {transfers.length === 0 ? (
              <Empty />
            ) : (
              transfers.slice(0, 8).map(tr => (
                <View key={tr.id} style={styles.transferRow}>
                  <View style={styles.trIconBox}>
                    <AppIcon name={icons.transfer} size={20} iconColor="#6366F1" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.trRoute}>
                      {tr.from} ➔ {tr.to}
                    </Text>
                    <Text style={styles.trSub}>
                      {fd(tr.date)} • {tr.transferNo} {tr.note ? `• ${tr.note}` : ''}
                    </Text>
                  </View>
                  <Text style={styles.trAmount}>{m(tr.amount)}</Text>
                </View>
              ))
            )}
          </View>
        </View>
      )}

      {/* ==================== TAB 3: CUSTOMER RECEIVABLES (পাওনা) ==================== */}
      {activeTab === 'due' && (
        <View style={styles.tabContentArea}>
          <View style={styles.cardHeaderWithAction}>
            <View>
              <Text style={styles.blockTitle}>
                {lang === 'bn' ? 'কাস্টমারদের কাছে মোট বাকি ও পাওনা খতিয়ান' : 'Customer Receivables Ledger'}
              </Text>
              <Text style={styles.blockSubtitle}>
                {lang === 'bn'
                  ? `মোট পাওনা: ${m(totalDueAmount)} (${totalDueCount} জন খরিদ্দার)`
                  : `Total Due: ${m(totalDueAmount)} across ${totalDueCount} customers`}
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
                      {item.customer.mobile || (lang === 'bn' ? 'মোবাইল নেই' : 'No mobile')}
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
                        <AppIcon name={icons.bkash} size={16} iconColor="#2563EB" />
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
              <Text style={styles.blockSubtitle}>
                {lang === 'bn'
                  ? `মোট দেনা: ${m(totalPayableAmount)} (${totalPayableCount} জন মহাজন)`
                  : `Total Payable: ${m(totalPayableAmount)} across ${totalPayableCount} suppliers`}
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
                      {item.vendor.mobile || (lang === 'bn' ? 'মোবাইল নেই' : 'No mobile')}
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
              <Text style={styles.blockSubtitle}>
                {lang === 'bn' ? `নির্বাচিত সময়ে মোট খরচ: ${m(fExp)}` : `Period Total Expenses: ${m(fExp)}`}
              </Text>
            </View>
            <TouchableOpacity style={styles.primaryActionButton} onPress={() => setExpenseFormItem(null)}>
              <AppIcon name={icons.add} size={18} iconColor="#fff" />
              <Text style={styles.primaryActionText}>{lang === 'bn' ? 'নতুন খরচ যোগ করুন' : 'Add Expense'}</Text>
            </TouchableOpacity>
          </View>

          {/* Search & Category Filter */}
          <View style={[styles.searchBarContainer, { marginBottom: 12 }]}>
            <AppIcon name={icons.search} size={20} iconColor="#64748B" />
            <TextInput
              style={styles.searchBarInput}
              placeholder={lang === 'bn' ? 'খাতের নাম বা নোট দিয়ে খুঁজুন...' : 'Search expense by category or note...'}
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
                const label = e.category === 'other' && e.customName ? e.customName : e.category;
                return (
                  <TouchableOpacity
                    key={e.id}
                    style={styles.expenseItemRow}
                    onPress={() => setExpenseFormItem(e)}
                  >
                    <View style={styles.expIconBox}>
                      <AppIcon name={icons.expense} size={18} iconColor="#D97706" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.expTitle}>{label}</Text>
                      <Text style={styles.expSub}>
                        {fd(e.date)} {e.note ? `• ${e.note}` : ''}
                      </Text>
                    </View>
                    <Text style={styles.expAmt}>- {m(e.amount)}</Text>
                  </TouchableOpacity>
                );
              })
            )}
          </View>
        </View>
      )}

      {/* ==================== TAB 6: INTELLIGENT ACCOUNTS Q&A ASSISTANT ==================== */}
      {activeTab === 'qa' && (
        <View style={styles.tabContentArea}>
          {/* Search & Ask Input */}
          <View style={styles.qaSearchCard}>
            <View style={styles.qaHeaderRow}>
              <View style={styles.qaIconBadge}>
                <AppIcon name={icons.calc} size={24} iconColor="#6366F1" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.qaMainTitle}>
                  {lang === 'bn' ? 'বুদ্ধিমান হিসাব সহকারী (Accounts Q&A Navigator)' : 'Intelligent Accounts Q&A Navigator'}
                </Text>
                <Text style={styles.qaMainSubtitle}>
                  {lang === 'bn'
                    ? 'হিসাব সম্পর্কিত যে কোনো প্রশ্ন লিখুন বা নিচের প্রশ্নগুলোতে ক্লিক করুন — তাৎক্ষণিক লাইভ হিসাব পেয়ে যাবেন'
                    : 'Ask any question about accounts or click below to get real-time computed answers'}
                </Text>
              </View>
            </View>

            <View style={styles.qaInputBox}>
              <AppIcon name={icons.search} size={22} iconColor="#6366F1" />
              <TextInput
                ref={qaInputRef}
                style={styles.qaTextInput}
                placeholder={
                  lang === 'bn'
                    ? 'যেকোনো প্রশ্ন লিখুন (যেমন: লাভ, পাওনা, দেনা, ক্যাশ, খরচ, রহিম ট্রেডার্স)...'
                    : 'Ask anything (e.g. net profit, receivables, cash, expenses)...'
                }
                value={qaQuery}
                onChangeText={setQaQuery}
              />
              {qaQuery.length > 0 && (
                <TouchableOpacity onPress={() => setQaQuery('')}>
                  <AppIcon name={icons.cancel} size={20} iconColor="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            {/* Quick Question Chips */}
            <Text style={styles.qaPillsHeader}>
              {lang === 'bn' ? 'দ্রুত ক্লিকের সাধারণ প্রশ্নসমূহ:' : 'Common Quick Questions:'}
            </Text>
            <View style={styles.qaChipsContainer}>
              {qaQuestions.map(item => {
                const isSelected = selectedQa?.id === item.id && !qaQuery;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.qaChip, isSelected && styles.qaChipActive]}
                    onPress={() => {
                      setQaQuery('');
                      setActiveQuestionId(item.id);
                    }}
                  >
                    <Text style={[styles.qaChipText, isSelected && styles.qaChipTextActive]}>
                      {lang === 'bn' ? item.titleBn : item.titleEn}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* Computed Live Answer Card */}
          {selectedQa && (
            <View style={styles.qaAnswerCard}>
              <View style={styles.qaAnswerHeader}>
                <View style={styles.qaTagPill}>
                  <Text style={styles.qaTagText}>{selectedQa.tag}</Text>
                </View>
                <Text style={styles.qaQuestionTitle}>
                  {lang === 'bn' ? selectedQa.titleBn : selectedQa.titleEn}
                </Text>
              </View>

              <View style={styles.qaAnswerBody}>
                <View style={styles.qaHeadlineRow}>
                  <Text style={styles.qaAnswerHeadline}>{selectedQa.answer.headline}</Text>
                  {selectedQa.answer.badge ? (
                    <View style={styles.qaAnswerBadge}>
                      <Text style={styles.qaAnswerBadgeText}>{selectedQa.answer.badge}</Text>
                    </View>
                  ) : null}
                </View>

                {/* Sub Metrics / Breakdown */}
                <View style={styles.qaBreakdownGrid}>
                  {selectedQa.answer.details.map((dt, i) => (
                    <View key={i} style={styles.qaDetailItem}>
                      <Text style={styles.qaDetailLabel}>{dt.label}</Text>
                      <Text style={styles.qaDetailVal}>{dt.val}</Text>
                    </View>
                  ))}
                </View>

                {/* Plain Language Human Explanation */}
                <View style={styles.qaExplanationBox}>
                  <Text style={styles.qaExplanationTitle}>
                    💡 {lang === 'bn' ? 'সহজ ব্যাখ্যা (Plain Explanation):' : 'Plain Explanation:'}
                  </Text>
                  <Text style={styles.qaExplanationText}>
                    {selectedQa.answer.explanation}
                  </Text>
                </View>

                {/* Action Button */}
                {selectedQa.answer.action && (
                  <TouchableOpacity
                    style={styles.qaActionBtn}
                    onPress={selectedQa.answer.action}
                  >
                    <Text style={styles.qaActionBtnText}>{selectedQa.answer.actionLabel}</Text>
                    <AppIcon name={icons.chevR} size={18} iconColor="#fff" />
                  </TouchableOpacity>
                )}
              </View>
            </View>
          )}
        </View>
      )}

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

      {/* 4. Money Transfer Modal */}
      {transferModalOpen && (
        <MoneyTransferModal onClose={() => setTransferModalOpen(false)} />
      )}

      {/* 5. Expense Add / Edit Modal */}
      {expenseFormItem !== undefined && (
        <ExpenseModal
          init={expenseFormItem}
          onClose={() => setExpenseFormItem(undefined)}
          onSave={async val => {
            await saveExpense(val);
            setExpenseFormItem(undefined);
          }}
          onTrash={async id => {
            await deleteExpense(id);
            setExpenseFormItem(undefined);
          }}
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
    </ScrollView>
  );
}

// STYLES
const styles = StyleSheet.create({
  screenBg: {
    flex: 1,
    backgroundColor: '#F8FAFC',
  },
  scrollContent: {
    padding: 18,
    paddingBottom: 60,
  },

  // 1. Header Banner
  headerBanner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  headerTopRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 16,
  },
  headerLeftGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
    minWidth: 280,
  },
  brandIconBox: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#ECFDF5',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#A7F3D0',
  },
  headerMainTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#0F172A',
  },
  liveStatusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  liveDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  liveStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#065F46',
  },
  headerSubTitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 3,
  },
  headerActionToolbar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 8,
  },
  headerActionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  headerActionTextWhite: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  headerActionGhostButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  headerActionGhostText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '600',
  },

  // Period Ribbon
  periodRibbon: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 14,
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
