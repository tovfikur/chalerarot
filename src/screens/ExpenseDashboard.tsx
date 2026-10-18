import React, { useState, useMemo, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Modal,
  Alert,
  Platform,
} from 'react-native';
import { useApp, today, Expense, type MoneyAccountRow } from '../store';
import {
  useMoney,
  useNum,
  useDateStr,
  toBnDigits,
  color,
  Empty,
} from '../ui';
import { AppIcon, icons } from '../icons';
import { useBreakpoint } from '../responsive';
import { printReport, printedAtStamp, type ReportDoc } from '../report';
import { MoneyTransferModal, FilterModal, type AcctFilter } from '../screens';

interface ExpenseDashboardProps {
  go?: (route: string) => void;
}

export interface ExpenseRowData {
  id: string;
  date: string;
  voucherNo: string;
  type: 'operation' | 'transport' | 'landing';
  typeLabel: string;
  category: string;
  amount: number;
  description?: string;
  payerName?: string;
  responsiblePerson?: string;
  paymentMethod?: string;
  accountId?: string;
}

// Date Arithmetic Helpers
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

export function ExpenseDashboard({ go }: ExpenseDashboardProps = {}) {
  const { t, lang, expenses, saveExpense, deleteExpense, moneyAccounts, sales } = useApp();
  const m = useMoney();
  const n = useNum();
  const fd = useDateStr();
  const td = today();
  const { isDesktop, isTablet, isMobile } = useBreakpoint();

  // Active Type Tab: 'all' | 'operation' | 'transport' | 'landing'
  const [activeTab, setActiveTab] = useState<'all' | 'operation' | 'transport' | 'landing'>('all');

  // Period Filter State
  const [fltPreset, setFltPreset] = useState<'today' | 'last7' | 'thisMonth' | 'last3m' | 'thisYear' | 'custom'>('thisMonth');
  const [flt, setFlt] = useState<AcctFilter>(() => presetRange('thisMonth', today()));
  const [fltModalOpen, setFltModalOpen] = useState(false);

  // Search & Category Dropdown
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCatFilter, setSelectedCatFilter] = useState('সব ক্যাটাগরি');
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Transfer Modal
  const [transferModalOpen, setTransferModalOpen] = useState(false);

  // Add/Edit Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);

  // Modal Fields
  const [modalDate, setModalDate] = useState(td);
  const [modalType, setModalType] = useState<'operation' | 'transport' | 'landing'>('operation');
  const [modalVoucherNo, setModalVoucherNo] = useState('EXP-0001');
  const [modalCategory, setModalCategory] = useState('অফিস ভাড়া');
  const [modalDescription, setModalDescription] = useState('');
  const [modalAmount, setModalAmount] = useState('');
  const [modalAccountId, setModalAccountId] = useState(moneyAccounts[0]?.id || 'cash');
  const [modalPayer, setModalPayer] = useState('');
  const [modalResponsible, setModalResponsible] = useState('');

  // Modal Dropdown toggles
  const [modalTypeDropdownOpen, setModalTypeDropdownOpen] = useState(false);
  const [modalCatDropdownOpen, setModalCatDropdownOpen] = useState(false);
  const [modalAccountDropdownOpen, setModalAccountDropdownOpen] = useState(false);

  // View Details Modal
  const [viewExpense, setViewExpense] = useState<ExpenseRowData | null>(null);

  // Curve inspection point
  const [activeCurvePoint, setActiveCurvePoint] = useState<{ date: string; amount: number; label: string } | null>(null);

  const expenseTypes = [
    { key: 'operation', label: 'অপারেশন খরচ' },
    { key: 'transport', label: 'পরিবহন খরচ' },
    { key: 'landing', label: 'লোডিং/ল্যান্ডিং খরচ' },
  ];

  const expenseCategories = [
    'অফিস ভাড়া',
    'কর্মচারীর বেতন ও ভাতা',
    'বিদ্যুৎ বিল',
    'লোডিং ও আনলোডিং',
    'ট্রাক ও পরিবহন ভাড়া',
    'গুদাম ভাড়া ও রক্ষণাবেক্ষণ',
    'বন্দর ও ঘাট চার্জ',
    'শুল্ক ও সরকারি ট্যাক্স',
    'লোকাল পরিবহন ও ভ্যান ভাড়া',
    'বস্তা ও সুতলি ক্রয়',
    'খাবার ও আপ্যায়ন',
    'অন্যান্য পরিচালনা ব্যয়',
  ];

  // Helper: check if date falls in active filter
  const inPeriod = (d: string) => d >= flt.from && d <= flt.to;

  // Resolve type from category / note
  const resolveExpenseType = (cat: string, note?: string | null): 'operation' | 'transport' | 'landing' => {
    if (note && note.includes('ধরন: পরিবহন')) return 'transport';
    if (note && note.includes('ধরন: ল্যান্ডিং')) return 'landing';
    if (cat === 'transport' || cat === 'vehicle' || cat === 'fuel') return 'transport';
    if (cat === 'loading' || cat === 'landing' || cat === 'labour') return 'landing';
    return 'operation';
  };

  const getCategoryLabel = (cat: string, customName?: string | null) => {
    if (customName) return customName;
    const catMap: Record<string, string> = {
      salary: 'কর্মচারীর বেতন ও ভাতা',
      rent: 'অফিস ভাড়া',
      electricity: 'বিদ্যুৎ বিল',
      transport: 'ট্রাক ও পরিবহন ভাড়া',
      loading: 'লোডিং ও আনলোডিং',
      office: 'অফিস সামগ্রী',
      tea: 'খাবার ও আপ্যায়ন',
      lunch: 'খাবার ও আপ্যায়ন',
      bags: 'বস্তা ও সুতলি ক্রয়',
      shopRepair: 'দোকান মেরামত',
      bankCharge: 'ব্যাংক চার্জ',
      other: 'অন্যান্য পরিচালনা ব্যয়',
    };
    return catMap[cat] || cat;
  };

  // Convert raw store expenses to ExpenseRowData
  const allExpenseRows: ExpenseRowData[] = useMemo(() => {
    return expenses.map((e, idx) => {
      const type = resolveExpenseType(e.category, e.note);
      const typeLabel =
        type === 'operation' ? 'অপারেশন খরচ' : type === 'transport' ? 'পরিবহন খরচ' : 'লোডিং/ল্যান্ডিং';
      const voucherNo = `EXP-${String(expenses.length - idx).padStart(4, '0')}`;

      // Extract payer / responsible from note if saved
      let payerName: string | undefined;
      let responsiblePerson: string | undefined;
      let cleanDesc = e.note || '';

      if (e.note && e.note.includes('প্রদানকারী:')) {
        const m1 = e.note.match(/প্রদানকারী:\s*([^|\]]+)/);
        if (m1 && m1[1].trim() !== '-') payerName = m1[1].trim();
      }
      if (e.note && e.note.includes('দায়িত্বপ্রাপ্ত:')) {
        const m2 = e.note.match(/দায়িত্বপ্রাপ্ত:\s*([^|\]]+)/);
        if (m2 && m2[1].trim() !== '-') responsiblePerson = m2[1].trim();
      }
      if (cleanDesc.includes(']')) {
        cleanDesc = cleanDesc.split(']')[1]?.trim() || cleanDesc;
      }

      // Method label from account
      const acc = moneyAccounts.find(a => a.id === e.accountId);
      const paymentMethod = acc ? acc.name : e.method || 'ক্যাশ';

      return {
        id: e.id,
        date: e.date,
        voucherNo,
        type,
        typeLabel,
        category: getCategoryLabel(e.category, e.customName),
        amount: e.amount,
        description: cleanDesc,
        payerName,
        responsiblePerson,
        paymentMethod,
        accountId: e.accountId,
      };
    }).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  }, [expenses, moneyAccounts]);

  // Aggregated totals in selected period
  const periodRows = useMemo(() => {
    return allExpenseRows.filter(r => inPeriod(r.date));
  }, [allExpenseRows, flt]);

  const totalPeriodAmount = useMemo(() => {
    return periodRows.reduce((sum, r) => sum + r.amount, 0);
  }, [periodRows]);

  const totalOperation = useMemo(() => {
    return periodRows.filter(r => r.type === 'operation').reduce((sum, r) => sum + r.amount, 0);
  }, [periodRows]);

  const totalTransport = useMemo(() => {
    return periodRows.filter(r => r.type === 'transport').reduce((sum, r) => sum + r.amount, 0);
  }, [periodRows]);

  const totalLanding = useMemo(() => {
    return periodRows.filter(r => r.type === 'landing').reduce((sum, r) => sum + r.amount, 0);
  }, [periodRows]);

  const todayExpenses = useMemo(() => {
    return allExpenseRows.filter(r => r.date === td);
  }, [allExpenseRows, td]);

  const totalTodayAmount = useMemo(() => {
    return todayExpenses.reduce((sum, r) => sum + r.amount, 0);
  }, [todayExpenses]);

  // Period sales for comparison
  const periodSales = useMemo(() => {
    return sales.filter(s => inPeriod(s.date)).reduce((sum, s) => sum + s.total, 0);
  }, [sales, flt]);

  const expenseRatioOfSales = periodSales > 0 ? Math.round((totalPeriodAmount / periodSales) * 100) : 0;

  // Filtered rows for the table
  const filteredRows = useMemo(() => {
    return periodRows.filter(r => {
      // Tab filter
      if (activeTab !== 'all' && r.type !== activeTab) return false;

      // Category filter
      if (selectedCatFilter !== 'সব ক্যাটাগরি' && r.category !== selectedCatFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matches =
          r.voucherNo.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.typeLabel.toLowerCase().includes(q) ||
          (r.description && r.description.toLowerCase().includes(q)) ||
          (r.payerName && r.payerName.toLowerCase().includes(q)) ||
          (r.responsiblePerson && r.responsiblePerson.toLowerCase().includes(q));
        if (!matches) return false;
      }

      return true;
    });
  }, [periodRows, activeTab, selectedCatFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  // Formatted date period string
  const formatPeriodLabel = (dsFrom: string, dsTo: string) => {
    if (dsFrom === dsTo) {
      return dsFrom === td ? (lang === 'bn' ? 'আজকের খরচ' : 'Today') : fd(dsFrom);
    }
    return `${fd(dsFrom)} – ${fd(dsTo)}`;
  };

  const handleSelectPreset = (p: 'today' | 'last7' | 'thisMonth' | 'last3m' | 'thisYear') => {
    setFltPreset(p);
    setFlt(presetRange(p, td));
    setPage(1);
  };

  // Timeline Data Points for Expense Curve
  const timelineData = useMemo(() => {
    let dateList: string[] = [];
    if (flt.from === flt.to) {
      for (let i = 6; i >= 0; i--) {
        dateList.push(addDays(flt.to, -i));
      }
    } else {
      const d1 = new Date(flt.from);
      const d2 = new Date(flt.to);
      const diffDays = Math.min(31, Math.max(1, Math.round((d2.getTime() - d1.getTime()) / (1000 * 3600 * 24))));
      if (diffDays <= 14) {
        for (let i = 0; i <= diffDays; i++) dateList.push(addDays(flt.from, i));
      } else {
        const step = Math.ceil(diffDays / 10);
        for (let i = 0; i <= diffDays; i += step) dateList.push(addDays(flt.from, i));
        if (!dateList.includes(flt.to)) dateList.push(flt.to);
      }
    }

    return dateList.map(ds => {
      const dayExps = expenses.filter(e => e.date === ds);
      const amount = dayExps.reduce((sum, e) => sum + e.amount, 0);
      return {
        date: ds,
        label: ds.slice(5),
        amount,
      };
    });
  }, [flt, expenses]);

  useEffect(() => {
    if (timelineData.length > 0 && !activeCurvePoint) {
      setActiveCurvePoint(timelineData[timelineData.length - 1]);
    }
  }, [timelineData]);

  // Expense Categories Breakdown
  const categoryBreakdown = useMemo(() => {
    const catMap: Record<string, number> = {};
    for (const r of periodRows) {
      catMap[r.category] = (catMap[r.category] || 0) + r.amount;
    }
    return Object.entries(catMap)
      .map(([cat, amt]) => ({
        category: cat,
        amount: amt,
        pct: totalPeriodAmount > 0 ? Math.round((amt / totalPeriodAmount) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);
  }, [periodRows, totalPeriodAmount]);

  // Bezier Curve SVG Calculations
  const chartHeight = 160;
  const chartWidth = 720;
  const paddingLeft = 45;
  const paddingRight = 20;
  const paddingTop = 20;
  const paddingBottom = 30;
  const usableWidth = chartWidth - paddingLeft - paddingRight;
  const usableHeight = chartHeight - paddingTop - paddingBottom;

  const maxChartVal = useMemo(() => {
    let mx = 500;
    for (const p of timelineData) {
      if (p.amount > mx) mx = p.amount;
    }
    return Math.ceil(mx * 1.2);
  }, [timelineData]);

  const getCurvePath = (values: number[]) => {
    if (values.length === 0) return '';
    const points = values.map((val, idx) => {
      const x = paddingLeft + (idx / Math.max(1, values.length - 1)) * usableWidth;
      const normalizedY = Math.max(0, val) / maxChartVal;
      const y = paddingTop + usableHeight - normalizedY * usableHeight;
      return { x, y };
    });

    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

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

  // Open Modal for Adding Expense
  const handleOpenAdd = () => {
    setEditingExpenseId(null);
    setModalDate(td);
    setModalType('operation');
    setModalVoucherNo(`EXP-${String(expenses.length + 1).padStart(4, '0')}`);
    setModalCategory('অফিস ভাড়া');
    setModalDescription('');
    setModalAmount('');
    setModalAccountId(moneyAccounts[0]?.id || 'cash');
    setModalPayer('');
    setModalResponsible('');
    setModalOpen(true);
  };

  // Open Modal for Editing Expense
  const handleOpenEdit = (item: ExpenseRowData) => {
    setEditingExpenseId(item.id);
    setModalDate(item.date);
    setModalType(item.type);
    setModalVoucherNo(item.voucherNo);
    setModalCategory(item.category);
    setModalDescription(item.description || '');
    setModalAmount(String(item.amount));
    setModalAccountId(item.accountId || moneyAccounts[0]?.id || 'cash');
    setModalPayer(item.payerName || '');
    setModalResponsible(item.responsiblePerson || '');
    setModalOpen(true);
  };

  // Save Modal Action
  const handleSaveModal = async () => {
    const amt = parseFloat(modalAmount);
    if (!amt || amt <= 0) {
      Alert.alert('সতর্কতা', 'অনুগ্রহ করে খরচের সঠিক পরিমাণ লিখুন।');
      return;
    }

    const typeLabel =
      modalType === 'operation' ? 'অপারেশন খরচ' : modalType === 'transport' ? 'পরিবহন খরচ' : 'ল্যান্ডিং খরচ';
    const noteText = `[ভাউচার: ${modalVoucherNo} | ধরন: ${typeLabel} | প্রদানকারী: ${modalPayer || '-'} | দায়িত্বপ্রাপ্ত: ${modalResponsible || '-'}] ${modalDescription}`;

    try {
      await saveExpense({
        id: editingExpenseId || undefined,
        category: modalCategory === 'অন্যান্য পরিচালনা ব্যয়' ? 'other' : 'office',
        customName: modalCategory,
        amount: amt,
        accountId: modalAccountId,
        date: modalDate,
        note: noteText,
      });

      setModalOpen(false);
      Alert.alert('সফল', 'খরচ সফলভাবে সংরক্ষণ করা হয়েছে।');
    } catch (e) {
      Alert.alert('ব্যর্থ', e instanceof Error ? e.message : 'খরচ সংরক্ষণ করা যায়নি।');
    }
  };

  // Delete Action
  const handleDelete = (id: string) => {
    Alert.alert('নিশ্চিত করুন', 'আপনি কি এই খরচটি মুছে ফেলতে চান?', [
      { text: 'বাতিল', style: 'cancel' },
      {
        text: 'মুছুন',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteExpense(id);
          } catch (e) {
            Alert.alert('ব্যর্থ', 'খরচ মুছে ফেলা যায়নি।');
          }
        },
      },
    ]);
  };

  // Print Expense Audit Statement
  const handlePrintAudit = () => {
    const doc: ReportDoc = {
      shop: lang === 'bn' ? 'চালের আড়ত লিমিটেড' : 'Chaler Arot Ltd',
      title: lang === 'bn' ? 'ব্যয় বিবরণী ও পরিচালন খরচ অডিট রিপোর্ট' : 'Expense & Operating Cost Audit Report',
      period: formatPeriodLabel(flt.from, flt.to),
      meta: [
        { label: lang === 'bn' ? 'তারিখ পরিসীমা' : 'Date Range', value: `${flt.from} to ${flt.to}` },
        { label: lang === 'bn' ? 'প্রিন্ট সময়' : 'Printed At', value: printedAtStamp(lang) },
      ],
      sections: [
        {
          title: lang === 'bn' ? '১. ব্যয়ের ধরন অনুযায়ী সংক্ষেপ' : '1. Summary by Type',
          rows: [
            { label: lang === 'bn' ? 'অপারেশন ও দোকান পরিচালনা খরচ' : 'Operation Expense', right: m(totalOperation) },
            { label: lang === 'bn' ? 'পরিবহন ও ট্রাক ভাড়া' : 'Transport Expense', right: m(totalTransport) },
            { label: lang === 'bn' ? 'লোডিং ও ল্যান্ডিং খরচ' : 'Landing / Loading Expense', right: m(totalLanding) },
            { label: lang === 'bn' ? 'নির্বাচিত সময়ের সর্বমোট ব্যয়' : 'Total Period Expenses', right: m(totalPeriodAmount), bold: true },
          ],
        },
        {
          title: lang === 'bn' ? '২. ব্যয়ের শীর্ষ খাতসমূহ' : '2. Top Categories Breakdown',
          rows: categoryBreakdown.slice(0, 6).map(cb => ({
            label: cb.category,
            sub: `${cb.pct}% of total`,
            right: m(cb.amount),
          })),
        },
      ],
      total: {
        label: lang === 'bn' ? 'সর্বমোট পরিচালন খরচ' : 'Grand Total Expenses',
        value: m(totalPeriodAmount),
        neg: true,
      },
      printedAt: printedAtStamp(lang),
      printLabel: lang === 'bn' ? 'প্রিন্ট করুন' : 'Print',
    };
    printReport(doc);
  };

  return (
    <ScrollView style={styles.screenBg} contentContainerStyle={styles.scrollContent}>
      {/* 1. EXECUTIVE HEADER BANNER */}
      <View style={styles.headerBanner}>
        <View style={styles.headerTopRow}>
          <View style={styles.headerLeftGroup}>
            <View style={styles.brandIconBox}>
              <AppIcon name={icons.expense} size={28} iconColor="#DC2626" />
            </View>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <Text style={styles.headerMainTitle}>
                  {lang === 'bn' ? 'খরচ ও ব্যয় ব্যবস্থাপনা' : 'Expense & Cost Management'}
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
                  ? 'দোকান পরিচালনা, পরিবহন, লেবার ও আনুষঙ্গিক খরচের সম্পূর্ণ খতিয়ান'
                  : 'Complete ledger for shop operations, freight, labor, and overhead costs'}
              </Text>
            </View>
          </View>

          {/* Action Toolbar */}
          <View style={styles.headerActionToolbar}>
            <TouchableOpacity
              style={[styles.headerActionButton, { backgroundColor: '#DC2626' }]}
              onPress={handleOpenAdd}
            >
              <AppIcon name={icons.add} size={18} iconColor="#FFFFFF" />
              <Text style={styles.headerActionTextWhite}>
                {lang === 'bn' ? 'নতুন খরচ যোগ করুন' : 'Add Expense'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.headerActionGhostButton}
              onPress={handlePrintAudit}
            >
              <AppIcon name={icons.print} size={18} iconColor="#0F172A" />
              <Text style={styles.headerActionGhostText}>
                {lang === 'bn' ? 'প্রিন্ট রিপোর্ট' : 'Print Audit'}
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

            {go && (
              <TouchableOpacity
                style={styles.headerActionGhostButton}
                onPress={() => go('accounts')}
              >
                <AppIcon name={icons.accounts} size={18} iconColor="#0F172A" />
                <Text style={styles.headerActionGhostText}>
                  {lang === 'bn' ? 'হিসাব ড্যাশবোর্ড' : 'Accounts'}
                </Text>
              </TouchableOpacity>
            )}
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
              style={[
                styles.presetChip,
                fltPreset === 'custom' && styles.presetChipActive,
                { flexDirection: 'row', alignItems: 'center', gap: 6 },
              ]}
              onPress={() => setFltModalOpen(true)}
            >
              <AppIcon
                name={icons.calendar}
                size={16}
                iconColor={fltPreset === 'custom' ? '#DC2626' : '#0F172A'}
              />
              <Text
                style={[
                  styles.presetChipText,
                  fltPreset === 'custom' && styles.presetChipTextActive,
                ]}
              >
                {formatPeriodLabel(flt.from, flt.to)}
              </Text>
            </TouchableOpacity>
          </View>

          {/* Quick Expense Metric Banner */}
          <View style={styles.ratioBannerPill}>
            <Text style={styles.ratioPillLabel}>
              {lang === 'bn' ? 'বিক্রয়ের তুলনায় ব্যয়:' : 'Exp/Sales Ratio:'}
            </Text>
            <Text style={styles.ratioPillValue}>
              {expenseRatioOfSales}%
            </Text>
          </View>
        </View>
      </View>

      {/* 2. EXECUTIVE EXPENSE KPI CARDS */}
      <View style={styles.kpiGridContainer}>
        {/* Card 1: Total Period Expenses */}
        <View style={[styles.kpiCard, { borderTopColor: '#DC2626', borderTopWidth: 4 }]}>
          <View style={styles.kpiCardHeader}>
            <Text style={styles.kpiCardTitle}>
              {lang === 'bn' ? 'নির্বাচিত সময়ের মোট ব্যয়' : 'Total Period Expenses'}
            </Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: '#FEE2E2' }]}>
              <AppIcon name={icons.expense} size={20} iconColor="#DC2626" />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: '#B91C1C' }]}>{m(totalPeriodAmount)}</Text>
          <View style={styles.kpiCardFooter}>
            <Text style={styles.kpiFooterNote}>
              {lang === 'bn'
                ? `মোট ${n(periodRows.length)} টি ভাউচার এন্ট্রি`
                : `${periodRows.length} total expense entries`}
            </Text>
          </View>
        </View>

        {/* Card 2: Operation Expenses */}
        <View style={[styles.kpiCard, { borderTopColor: '#3B82F6', borderTopWidth: 4 }]}>
          <View style={styles.kpiCardHeader}>
            <Text style={styles.kpiCardTitle}>
              {lang === 'bn' ? 'অপারেশন ও দোকান পরিচালনা' : 'Operation Expenses'}
            </Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: '#EFF6FF' }]}>
              <AppIcon name={icons.office} size={20} iconColor="#2563EB" />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: '#1E293B' }]}>{m(totalOperation)}</Text>
          <View style={styles.kpiCardFooter}>
            <Text style={styles.kpiFooterNote}>
              {totalPeriodAmount > 0
                ? `${lang === 'bn' ? 'মোট ব্যয়ের' : 'Of Total'}: ${Math.round((totalOperation / totalPeriodAmount) * 100)}%`
                : '—'}
            </Text>
          </View>
        </View>

        {/* Card 3: Transport Expenses */}
        <View style={[styles.kpiCard, { borderTopColor: '#F59E0B', borderTopWidth: 4 }]}>
          <View style={styles.kpiCardHeader}>
            <Text style={styles.kpiCardTitle}>
              {lang === 'bn' ? 'পরিবহন ও ট্রাক ভাড়া' : 'Transport Expenses'}
            </Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: '#FFFBEB' }]}>
              <AppIcon name={icons.vendors} size={20} iconColor="#D97706" />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: '#D97706' }]}>{m(totalTransport)}</Text>
          <View style={styles.kpiCardFooter}>
            <Text style={styles.kpiFooterNote}>
              {totalPeriodAmount > 0
                ? `${lang === 'bn' ? 'মোট ব্যয়ের' : 'Of Total'}: ${Math.round((totalTransport / totalPeriodAmount) * 100)}%`
                : '—'}
            </Text>
          </View>
        </View>

        {/* Card 4: Landing & Labor */}
        <View style={[styles.kpiCard, { borderTopColor: '#8B5CF6', borderTopWidth: 4 }]}>
          <View style={styles.kpiCardHeader}>
            <Text style={styles.kpiCardTitle}>
              {lang === 'bn' ? 'লোডিং, ঘাট ও কুলি খরচ' : 'Loading & Labor'}
            </Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: '#F5F3FF' }]}>
              <AppIcon name={icons.ship} size={20} iconColor="#8B5CF6" />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: '#7C3AED' }]}>{m(totalLanding)}</Text>
          <View style={styles.kpiCardFooter}>
            <Text style={styles.kpiFooterNote}>
              {totalPeriodAmount > 0
                ? `${lang === 'bn' ? 'মোট ব্যয়ের' : 'Of Total'}: ${Math.round((totalLanding / totalPeriodAmount) * 100)}%`
                : '—'}
            </Text>
          </View>
        </View>

        {/* Card 5: Today's Expense */}
        <View style={[styles.kpiCard, { borderTopColor: '#10B981', borderTopWidth: 4 }]}>
          <View style={styles.kpiCardHeader}>
            <Text style={styles.kpiCardTitle}>
              {lang === 'bn' ? 'আজকের মোট খরচ' : "Today's Expense"}
            </Text>
            <View style={[styles.kpiIconBadge, { backgroundColor: '#ECFDF5' }]}>
              <AppIcon name={icons.calendar} size={20} iconColor="#10B981" />
            </View>
          </View>
          <Text style={[styles.kpiCardAmount, { color: '#0F172A' }]}>{m(totalTodayAmount)}</Text>
          <View style={styles.kpiCardFooter}>
            <Text style={styles.kpiFooterNote}>
              {lang === 'bn'
                ? `আজকের এন্ট্রি: ${n(todayExpenses.length)} টি`
                : `${todayExpenses.length} entries today`}
            </Text>
          </View>
        </View>
      </View>

      {/* 3. VISUAL CHARTS ROW: EXPENSE TRAJECTORY CURVE & CATEGORY BREAKDOWN */}
      <View style={[styles.twoColGrid, isMobile && { flexDirection: 'column' }]}>
        {/* Left: Trend Curve */}
        <View style={[styles.colCard, { flex: 1.4 }]}>
          <View style={styles.cardHeaderWithIcon}>
            <AppIcon name={icons.profit} size={22} iconColor="#DC2626" />
            <View style={{ flex: 1 }}>
              <Text style={styles.blockTitle}>
                {lang === 'bn' ? 'দৈনিক খরচের ট্রেন্ড কার্ভ' : 'Daily Expense Trajectory Curve'}
              </Text>
              <Text style={styles.blockSubtitle}>
                {lang === 'bn'
                  ? 'দিনের গতিবিধির ওপর স্পর্শ করুন নির্দিষ্ট দিনের খরচ দেখতে'
                  : 'Tap or hover points on the curve to inspect daily totals'}
              </Text>
            </View>
          </View>

          {/* Active Curve Point Badge */}
          {activeCurvePoint && (
            <View style={styles.pointInspectorBox}>
              <Text style={styles.pointInspectorDate}>📅 {fd(activeCurvePoint.date)}</Text>
              <Text style={styles.pointInspectorAmount}>{m(activeCurvePoint.amount)}</Text>
            </View>
          )}

          {/* Bezier Vector Curve */}
          <View style={styles.chartCanvasContainer}>
            {Platform.OS === 'web' ? (
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                style={{ width: '100%', height: chartHeight, overflow: 'visible' }}
              >
                <defs>
                  <linearGradient id="expenseGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#EF4444" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="#EF4444" stopOpacity="0.0" />
                  </linearGradient>
                </defs>

                {/* Grid Lines */}
                {[0, 0.5, 1].map((pct, i) => {
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

                {/* Area Gradient */}
                <path
                  d={getAreaPath(timelineData.map(p => p.amount))}
                  fill="url(#expenseGradient)"
                />

                {/* Main Curve Line */}
                <path
                  d={getCurvePath(timelineData.map(p => p.amount))}
                  fill="none"
                  stroke="#DC2626"
                  strokeWidth="3.2"
                  strokeLinecap="round"
                />

                {/* Interactive Dots */}
                {timelineData.map((pt, idx) => {
                  const x = paddingLeft + (idx / Math.max(1, timelineData.length - 1)) * usableWidth;
                  const y = paddingTop + usableHeight - (Math.max(0, pt.amount) / maxChartVal) * usableHeight;
                  const isSelected = activeCurvePoint?.date === pt.date;

                  return (
                    <g key={pt.date} style={{ cursor: 'pointer' }} onClick={() => setActiveCurvePoint(pt)}>
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
                      <circle
                        cx={x}
                        cy={y}
                        r={isSelected ? 6.5 : 4}
                        fill="#DC2626"
                        stroke="#FFFFFF"
                        strokeWidth={isSelected ? 3 : 2}
                      />
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
            ) : null}
          </View>
        </View>

        {/* Right: Top Expense Categories Breakdown */}
        <View style={[styles.colCard, { flex: 1 }]}>
          <View style={styles.cardHeaderWithIcon}>
            <AppIcon name={icons.report} size={22} iconColor="#2563EB" />
            <View style={{ flex: 1 }}>
              <Text style={styles.blockTitle}>
                {lang === 'bn' ? 'ব্যয়ের শীর্ষ খাতসমূহ' : 'Top Categories Breakdown'}
              </Text>
              <Text style={styles.blockSubtitle}>
                {lang === 'bn' ? 'কোন খাতে কত শতাংশ ব্যয় হয়েছে' : 'Percentage share across expense categories'}
              </Text>
            </View>
          </View>

          <View style={{ gap: 12 }}>
            {categoryBreakdown.slice(0, 5).map(cb => (
              <View key={cb.category}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                  <Text style={{ fontSize: 13, color: '#0F172A', fontWeight: '700' }}>{cb.category}</Text>
                  <Text style={{ fontSize: 13, color: '#DC2626', fontWeight: '800' }}>
                    {m(cb.amount)} <Text style={{ color: '#64748B', fontWeight: '500' }}>({cb.pct}%)</Text>
                  </Text>
                </View>
                <View style={styles.progressBarTrack}>
                  <View style={[styles.progressBarFill, { width: `${Math.min(100, cb.pct * 1.5)}%` }]} />
                </View>
              </View>
            ))}
          </View>
        </View>
      </View>

      {/* 4. TYPE TABS & CONTROLS */}
      <View style={styles.tabNavContainer}>
        {[
          { key: 'all', labelBn: 'সকল খরচ', labelEn: 'All Expenses', icon: icons.more },
          { key: 'operation', labelBn: 'অপারেশন খরচ', labelEn: 'Operation', icon: icons.office },
          { key: 'transport', labelBn: 'পরিবহন খরচ', labelEn: 'Transport', icon: icons.vendors },
          { key: 'landing', labelBn: 'লোডিং ও ঘাট খরচ', labelEn: 'Loading / Labor', icon: icons.ship },
        ].map(tTab => {
          const active = activeTab === tTab.key;
          return (
            <TouchableOpacity
              key={tTab.key}
              style={[styles.tabNavButton, active && styles.tabNavButtonActive]}
              onPress={() => {
                setActiveTab(tTab.key as any);
                setPage(1);
              }}
            >
              <AppIcon
                name={tTab.icon as any}
                size={18}
                iconColor={active ? '#FFFFFF' : '#0F172A'}
              />
              <Text style={[styles.tabNavText, active && styles.tabNavTextActive]}>
                {lang === 'bn' ? tTab.labelBn : tTab.labelEn}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* 5. SEARCH & FILTER CARD */}
      <View style={styles.filterCard}>
        {/* Search Input */}
        <View style={styles.searchBarWrap}>
          <AppIcon name={icons.search} size={20} iconColor="#0F172A" />
          <TextInput
            value={searchQuery}
            onChangeText={tVal => {
              setSearchQuery(tVal);
              setPage(1);
            }}
            style={styles.searchBarInput}
            placeholder={
              lang === 'bn'
                ? 'বিবরণ, ভাউচার নং বা প্রদানকারীর নাম দিয়ে খুঁজুন...'
                : 'Search voucher no, note, or payer...'
            }
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <AppIcon name={icons.cancel} size={18} iconColor="#94A3B8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Category Dropdown Filter */}
        <View style={{ position: 'relative', zIndex: 30 }}>
          <TouchableOpacity
            onPress={() => setCatDropdownOpen(prev => !prev)}
            style={styles.dropdownSelectorBox}
          >
            <Text style={styles.dropdownSelectorText}>{selectedCatFilter}</Text>
            <AppIcon name={icons.chevR} size={16} iconColor="#0F172A" />
          </TouchableOpacity>

          {catDropdownOpen && (
            <View style={styles.dropdownList}>
              {['সব ক্যাটাগরি', ...expenseCategories].map(cat => (
                <TouchableOpacity
                  key={cat}
                  onPress={() => {
                    setSelectedCatFilter(cat);
                    setCatDropdownOpen(false);
                    setPage(1);
                  }}
                  style={styles.dropdownListItem}
                >
                  <Text style={styles.dropdownListItemText}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      </View>

      {/* 6. EXPENSE LEDGER TABLE */}
      <View style={styles.tableCard}>
        {/* Table Header */}
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.th, { width: 50, textAlign: 'center' }]}>#</Text>
          <Text style={[styles.th, { flex: 1.2 }]}>তারিখ</Text>
          <Text style={[styles.th, { flex: 1.2 }]}>ভাউচার নং</Text>
          <Text style={[styles.th, { flex: 1.4, textAlign: 'center' }]}>ধরন</Text>
          <Text style={[styles.th, { flex: 1.8 }]}>খাত / ক্যাটাগরি</Text>
          <Text style={[styles.th, { flex: 1.5 }]}>অ্যাকাউন্ট</Text>
          <Text style={[styles.th, { flex: 1.4, textAlign: 'right' }]}>পরিমাণ (৳)</Text>
          <Text style={[styles.th, { width: 120, textAlign: 'center' }]}>অ্যাকশন</Text>
        </View>

        {/* Table Rows */}
        {pagedRows.length === 0 ? (
          <Empty />
        ) : (
          pagedRows.map((row, idx) => {
            const pillBg =
              row.type === 'operation' ? '#EFF6FF' : row.type === 'transport' ? '#FFFBEB' : '#F5F3FF';
            const pillText =
              row.type === 'operation' ? '#1E40AF' : row.type === 'transport' ? '#92400E' : '#6B21A8';

            return (
              <View key={row.id} style={styles.tableDataRow}>
                <View style={[styles.td, { width: 50, alignItems: 'center' }]}>
                  <Text style={styles.cellMuted}>{(page - 1) * pageSize + idx + 1}</Text>
                </View>

                <View style={[styles.td, { flex: 1.2 }]}>
                  <Text style={styles.cellText}>{fd(row.date)}</Text>
                </View>

                <View style={[styles.td, { flex: 1.2 }]}>
                  <Text style={styles.cellBold}>{row.voucherNo}</Text>
                </View>

                <View style={[styles.td, { flex: 1.4, alignItems: 'center' }]}>
                  <View style={[styles.typePill, { backgroundColor: pillBg }]}>
                    <Text style={[styles.typePillText, { color: pillText }]}>{row.typeLabel}</Text>
                  </View>
                </View>

                <View style={[styles.td, { flex: 1.8 }]}>
                  <Text style={styles.cellText}>{row.category}</Text>
                  {row.description ? (
                    <Text style={styles.cellSub} numberOfLines={1}>
                      {row.description}
                    </Text>
                  ) : null}
                </View>

                <View style={[styles.td, { flex: 1.5 }]}>
                  <Text style={styles.cellText}>{row.paymentMethod}</Text>
                </View>

                <View style={[styles.td, { flex: 1.4, alignItems: 'flex-end' }]}>
                  <Text style={[styles.cellBold, { color: '#DC2626' }]}>- {m(row.amount)}</Text>
                </View>

                {/* High Contrast Action Buttons */}
                <View style={[styles.td, { width: 120, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]}>
                  <TouchableOpacity
                    onPress={() => setViewExpense(row)}
                    style={[styles.actionBtnIconBox, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}
                  >
                    <AppIcon name={icons.eye} size={16} iconColor="#1D4ED8" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => handleOpenEdit(row)}
                    style={[styles.actionBtnIconBox, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}
                  >
                    <AppIcon name={icons.edit} size={16} iconColor="#15803D" />
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => handleDelete(row.id)}
                    style={[styles.actionBtnIconBox, { backgroundColor: '#FEF2F2', borderColor: '#FECACA' }]}
                  >
                    <AppIcon name={icons.del} size={16} iconColor="#DC2626" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}

        {/* Pagination Footer */}
        <View style={styles.paginationFooter}>
          <Text style={styles.footerCountText}>
            মোট {toBnDigits(String(filteredRows.length))} টি খরচ রেকর্ড
          </Text>

          <View style={styles.paginationControls}>
            <View style={styles.pageButtonsRow}>
              <TouchableOpacity
                disabled={page <= 1}
                onPress={() => setPage(p => Math.max(1, p - 1))}
                style={[styles.pageNavBtn, page <= 1 && styles.pageNavBtnDisabled]}
              >
                <Text style={styles.pageNavText}>‹</Text>
              </TouchableOpacity>

              {Array.from({ length: totalPages }, (_, i) => i + 1).map(pNum => (
                <TouchableOpacity
                  key={pNum}
                  onPress={() => setPage(pNum)}
                  style={[styles.pageNumberBtn, page === pNum && styles.pageNumberBtnActive]}
                >
                  <Text style={[styles.pageNumberText, page === pNum && styles.pageNumberTextActive]}>
                    {toBnDigits(String(pNum))}
                  </Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                disabled={page >= totalPages}
                onPress={() => setPage(p => Math.min(totalPages, p + 1))}
                style={[styles.pageNavBtn, page >= totalPages && styles.pageNavBtnDisabled]}
              >
                <Text style={styles.pageNavText}>›</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* 7. ADD / EDIT EXPENSE MODAL */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <AppIcon name={editingExpenseId ? icons.edit : icons.add} size={22} iconColor="#DC2626" />
                <Text style={styles.modalTitle}>
                  {editingExpenseId ? 'খরচ সম্পাদনা করুন' : 'নতুন খরচ যোগ করুন'}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setModalOpen(false)}>
                <AppIcon name={icons.cancel} size={20} iconColor="#0F172A" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              {/* Row 1: Date & Type */}
              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>খরচের তারিখ *</Text>
                  <TextInput
                    value={modalDate}
                    onChangeText={setModalDate}
                    style={styles.modalInput}
                    placeholder="YYYY-MM-DD"
                  />
                </View>

                <View style={[styles.modalCol, { position: 'relative', zIndex: 50 }]}>
                  <Text style={styles.modalLabel}>খরচের ধরন *</Text>
                  <TouchableOpacity
                    onPress={() => setModalTypeDropdownOpen(prev => !prev)}
                    style={styles.modalSelectWrap}
                  >
                    <Text style={styles.modalSelectText}>
                      {expenseTypes.find(t => t.key === modalType)?.label}
                    </Text>
                    <AppIcon name={icons.chevR} size={16} iconColor="#0F172A" />
                  </TouchableOpacity>

                  {modalTypeDropdownOpen && (
                    <View style={styles.modalDropdownPopup}>
                      {expenseTypes.map(t => (
                        <TouchableOpacity
                          key={t.key}
                          onPress={() => {
                            setModalType(t.key as any);
                            setModalTypeDropdownOpen(false);
                          }}
                          style={styles.dropdownPopupItem}
                        >
                          <Text style={styles.dropdownPopupItemText}>{t.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              {/* Row 2: Voucher No & Category */}
              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>ভাউচার নং *</Text>
                  <TextInput
                    value={modalVoucherNo}
                    onChangeText={setModalVoucherNo}
                    style={styles.modalInput}
                    placeholder="EXP-0001"
                  />
                </View>

                <View style={[styles.modalCol, { position: 'relative', zIndex: 40 }]}>
                  <Text style={styles.modalLabel}>খরচের ক্যাটাগরি *</Text>
                  <TouchableOpacity
                    onPress={() => setModalCatDropdownOpen(prev => !prev)}
                    style={styles.modalSelectWrap}
                  >
                    <Text style={styles.modalSelectText}>{modalCategory}</Text>
                    <AppIcon name={icons.chevR} size={16} iconColor="#0F172A" />
                  </TouchableOpacity>

                  {modalCatDropdownOpen && (
                    <View style={styles.modalDropdownPopup}>
                      <ScrollView style={{ maxHeight: 160 }} keyboardShouldPersistTaps="handled">
                        {expenseCategories.map(cat => (
                          <TouchableOpacity
                            key={cat}
                            onPress={() => {
                              setModalCategory(cat);
                              setModalCatDropdownOpen(false);
                            }}
                            style={styles.dropdownPopupItem}
                          >
                            <Text style={styles.dropdownPopupItemText}>{cat}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
              </View>

              {/* Row 3: Amount & Payment Account */}
              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>পরিমাণ (৳) *</Text>
                  <TextInput
                    value={modalAmount}
                    onChangeText={setModalAmount}
                    style={styles.modalInput}
                    placeholder="0"
                    keyboardType="numeric"
                  />
                </View>

                <View style={[styles.modalCol, { position: 'relative', zIndex: 30 }]}>
                  <Text style={styles.modalLabel}>পরিশোধ অ্যাকাউন্ট *</Text>
                  <TouchableOpacity
                    onPress={() => setModalAccountDropdownOpen(prev => !prev)}
                    style={styles.modalSelectWrap}
                  >
                    <Text style={styles.modalSelectText}>
                      {moneyAccounts.find(a => a.id === modalAccountId)?.name || 'ক্যাশ ড্রয়ার'}
                    </Text>
                    <AppIcon name={icons.chevR} size={16} iconColor="#0F172A" />
                  </TouchableOpacity>

                  {modalAccountDropdownOpen && (
                    <View style={styles.modalDropdownPopup}>
                      {moneyAccounts.map(acc => (
                        <TouchableOpacity
                          key={acc.id}
                          onPress={() => {
                            setModalAccountId(acc.id);
                            setModalAccountDropdownOpen(false);
                          }}
                          style={styles.dropdownPopupItem}
                        >
                          <Text style={styles.dropdownPopupItemText}>
                            {acc.name} ({m(acc.balance || 0)})
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              {/* Row 4: Description */}
              <View style={styles.modalFormGroup}>
                <Text style={styles.modalLabel}>বিবরণ বা নোট</Text>
                <TextInput
                  value={modalDescription}
                  onChangeText={setModalDescription}
                  style={[styles.modalInput, { height: 60, textAlignVertical: 'top' }]}
                  placeholder="খরচের বিবরণ লিখুন..."
                  multiline
                />
              </View>

              {/* Row 5: Payer Name & Responsible Person */}
              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>প্রদানকারীর নাম</Text>
                  <TextInput
                    value={modalPayer}
                    onChangeText={setModalPayer}
                    style={styles.modalInput}
                    placeholder="নাম..."
                  />
                </View>

                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>দায়িত্বপ্রাপ্ত ব্যক্তি</Text>
                  <TextInput
                    value={modalResponsible}
                    onChangeText={setModalResponsible}
                    style={styles.modalInput}
                    placeholder="নাম..."
                  />
                </View>
              </View>
            </ScrollView>

            {/* High Contrast Modal Actions */}
            <View style={styles.modalFooter}>
              <TouchableOpacity onPress={() => setModalOpen(false)} style={styles.modalCancelBtn}>
                <AppIcon name={icons.cancel} size={18} iconColor="#0F172A" />
                <Text style={styles.modalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleSaveModal} style={styles.modalSaveBtn}>
                <AppIcon name={icons.save} size={18} iconColor="#FFFFFF" />
                <Text style={styles.modalSaveBtnText}>সংরক্ষণ করুন</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* 8. VIEW EXPENSE DETAILS MODAL */}
      {viewExpense && (
        <Modal visible={!!viewExpense} transparent animationType="fade" onRequestClose={() => setViewExpense(null)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalBox, { maxWidth: 460 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>
                  {viewExpense.voucherNo} - {viewExpense.category}
                </Text>
                <TouchableOpacity onPress={() => setViewExpense(null)}>
                  <AppIcon name={icons.cancel} size={20} iconColor="#0F172A" />
                </TouchableOpacity>
              </View>

              <View style={{ padding: 20, gap: 12 }}>
                <View style={styles.viewRow}>
                  <Text style={styles.viewLabel}>তারিখ:</Text>
                  <Text style={styles.viewValue}>{fd(viewExpense.date)}</Text>
                </View>

                <View style={styles.viewRow}>
                  <Text style={styles.viewLabel}>খরচের ধরন:</Text>
                  <Text style={styles.viewValue}>{viewExpense.typeLabel}</Text>
                </View>

                <View style={styles.viewRow}>
                  <Text style={styles.viewLabel}>ক্যাটাগরি:</Text>
                  <Text style={styles.viewValue}>{viewExpense.category}</Text>
                </View>

                <View style={styles.viewRow}>
                  <Text style={styles.viewLabel}>পরিশোধ পদ্ধতি:</Text>
                  <Text style={styles.viewValue}>{viewExpense.paymentMethod}</Text>
                </View>

                <View style={styles.viewRow}>
                  <Text style={styles.viewLabel}>পরিমাণ:</Text>
                  <Text style={[styles.viewValue, { color: '#DC2626', fontSize: 18, fontWeight: '800' }]}>
                    - {m(viewExpense.amount)}
                  </Text>
                </View>

                {viewExpense.description ? (
                  <View style={styles.viewRow}>
                    <Text style={styles.viewLabel}>বিবরণ:</Text>
                    <Text style={styles.viewValue}>{viewExpense.description}</Text>
                  </View>
                ) : null}

                {viewExpense.payerName ? (
                  <View style={styles.viewRow}>
                    <Text style={styles.viewLabel}>প্রদানকারী:</Text>
                    <Text style={styles.viewValue}>{viewExpense.payerName}</Text>
                  </View>
                ) : null}

                {viewExpense.responsiblePerson ? (
                  <View style={styles.viewRow}>
                    <Text style={styles.viewLabel}>দায়িত্বপ্রাপ্ত:</Text>
                    <Text style={styles.viewValue}>{viewExpense.responsiblePerson}</Text>
                  </View>
                ) : null}
              </View>

              <View style={styles.modalFooter}>
                <TouchableOpacity onPress={() => setViewExpense(null)} style={styles.modalCancelBtn}>
                  <Text style={styles.modalCancelBtnText}>বন্ধ করুন</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {/* 9. DATE RANGE FILTER MODAL */}
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

      {/* 10. MONEY TRANSFER MODAL */}
      {transferModalOpen && (
        <MoneyTransferModal onClose={() => setTransferModalOpen(false)} />
      )}
    </ScrollView>
  );
}

// STYLES — Consistent with Executive Brand Standard
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
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#FECACA',
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
    paddingHorizontal: 16,
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
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  headerActionGhostText: {
    color: '#0F172A',
    fontSize: 13,
    fontWeight: '700',
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
    paddingVertical: 7,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  presetChipActive: {
    backgroundColor: '#FEE2E2',
    borderColor: '#DC2626',
  },
  presetChipText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  presetChipTextActive: {
    color: '#991B1B',
    fontWeight: '800',
  },
  ratioBannerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  ratioPillLabel: {
    fontSize: 12,
    color: '#0F172A',
    fontWeight: '600',
  },
  ratioPillValue: {
    fontSize: 12,
    fontWeight: '800',
    color: '#DC2626',
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
    borderRadius: 14,
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
    fontWeight: '700',
    color: '#475569',
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
    fontWeight: '500',
  },

  // 3. Two Column Grid
  twoColGrid: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  colCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
  },
  cardHeaderWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingBottom: 10,
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

  pointInspectorBox: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  pointInspectorDate: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  pointInspectorAmount: {
    fontSize: 15,
    fontWeight: '800',
    color: '#DC2626',
  },
  chartCanvasContainer: {
    width: '100%',
    paddingVertical: 4,
  },

  progressBarTrack: {
    height: 8,
    backgroundColor: '#F1F5F9',
    borderRadius: 4,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: 8,
    backgroundColor: '#DC2626',
    borderRadius: 4,
  },

  // 4. Tab Navigation
  tabNavContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
  },
  tabNavButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
  },
  tabNavButtonActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  tabNavText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  tabNavTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },

  // 5. Search & Filters
  filterCard: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 12,
    marginBottom: 14,
  },
  searchBarWrap: {
    flex: 1,
    minWidth: 260,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    paddingHorizontal: 12,
    height: 44,
  },
  searchBarInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '600',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  dropdownSelectorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    paddingHorizontal: 14,
    height: 44,
    minWidth: 170,
  },
  dropdownSelectorText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  dropdownList: {
    position: 'absolute',
    top: 50,
    left: 0,
    width: 220,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 100,
  },
  dropdownListItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownListItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },

  // 6. Table Card
  tableCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    overflow: 'hidden',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.04,
    shadowRadius: 6,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1.5,
    borderBottomColor: '#E2E8F0',
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  th: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
    paddingHorizontal: 6,
  },
  tableDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  td: {
    paddingHorizontal: 6,
  },
  cellMuted: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '600',
  },
  cellBold: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F172A',
  },
  cellText: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '600',
  },
  cellSub: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  typePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  typePillText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Action Icon Buttons (High Contrast)
  actionBtnIconBox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Pagination Footer
  paginationFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#FFFFFF',
  },
  footerCountText: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '700',
  },
  paginationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pageButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pageNavBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNavBtnDisabled: {
    opacity: 0.35,
  },
  pageNavText: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
  pageNumberBtn: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNumberBtnActive: {
    backgroundColor: '#0F172A',
    borderColor: '#0F172A',
  },
  pageNumberText: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '700',
  },
  pageNumberTextActive: {
    color: '#FFFFFF',
    fontWeight: '800',
  },

  // 7. Modals
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.65)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalBox: {
    width: '100%',
    maxWidth: 580,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
  },
  modalBody: {
    padding: 20,
    maxHeight: 480,
  },
  modalTwoCol: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 14,
  },
  modalCol: {
    flex: 1,
  },
  modalFormGroup: {
    marginBottom: 14,
  },
  modalLabel: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '700',
    marginBottom: 6,
  },
  modalInput: {
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    height: 44,
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  modalSelectWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    height: 44,
  },
  modalSelectText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalDropdownPopup: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 100,
  },
  dropdownPopupItem: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownPopupItemText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    backgroundColor: '#F8FAFC',
  },
  modalCancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#FFFFFF',
  },
  modalCancelBtnText: {
    fontSize: 13,
    color: '#0F172A',
    fontWeight: '700',
  },
  modalSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#DC2626',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  modalSaveBtnText: {
    fontSize: 13,
    color: '#FFFFFF',
    fontWeight: '800',
  },

  // View Row Details
  viewRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingVertical: 8,
  },
  viewLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#475569',
  },
  viewValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'right',
  },
});
