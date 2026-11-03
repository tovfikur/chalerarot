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

const presetRange = (id: 'today' | 'last7' | 'thisMonth' | 'last3m' | 'thisYear', td: string, fiscalMonth = 7): AcctFilter => {
  if (id === 'last7') return { from: addDays(td, -6), to: td };
  if (id === 'thisMonth') return { from: monthStart(td), to: monthEnd(td) };
  if (id === 'last3m') return { from: monthStart(monthShiftStart(td, -3)), to: monthEnd(monthShiftStart(td, -1)) };
  if (id === 'thisYear') { const y = Number(td.slice(0, 4)) - (Number(td.slice(5, 7)) < fiscalMonth ? 1 : 0); const from = `${y}-${pad2n(fiscalMonth)}-01`; return { from, to: addDays(`${y + 1}-${pad2n(fiscalMonth)}-01`, -1) }; }
  return { from: td, to: td };
};

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
    returns = [],
    products = [],
    moneyAccounts = [],
    moneyBalances = [],
    moneyTransfers: transfers = [],
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
  // 'overview' | 'accounts' | 'due' | 'pay' | 'expense'
  const [activeTab, setActiveTab] = useState<'overview' | 'accounts' | 'due' | 'pay' | 'expense'>('overview');

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
    setFlt(presetRange(p, td, business.fiscalStartMonth));
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
                {lang === 'bn' ? 'হিসাব ও আর্থিক অ্যানালিটিক্স' : 'Accounts & Financial Analytics'}
              </Text>
              
            </View>
            
          </View>
        </View>

        {/* Quick Action Toolbar */}
        <View style={styles.headerRight}>
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
            onPress={() => setExpenseFormItem(null)}
            activeOpacity={0.85}
          >
            <AppIcon name={icons.add} size={16} iconColor="#FFFFFF" />
            <Text style={styles.headerActionBtnTranslucentText}>
              {lang === 'bn' ? 'নতুন খরচ' : 'Add Expense'}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.headerActionBtnTranslucent}
            onPress={handlePrintStatement}
            activeOpacity={0.85}
          >
            <AppIcon name={icons.print} size={16} iconColor="#FFFFFF" />
            <Text style={styles.headerActionBtnTranslucentText}>
              {lang === 'bn' ? 'প্রিন্ট রিপোর্ট' : 'Print'}
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

      {/* ==================== TAB 2: CASH & BANK ACCOUNTS ==================== */}
      {activeTab === 'accounts' && (
        <View style={styles.tabContentArea}>
          <View style={styles.cardHeaderWithAction}>
            <View>
              <Text style={styles.blockTitle}>{lang === 'bn' ? 'ক্যাশ ও ব্যাংক তহবিল ব্যবস্থাপনা' : 'Cash & Bank Reserves'}</Text>
              
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
