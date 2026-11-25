import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, LabourAccountsData } from '../api';
import { useApp } from '../store';
import { useAuth } from '../auth';
import { icons } from '../icons';
import { Btn, Card, color, Field, SectionHead, useMoney, useNum } from '../ui';
import { useBreakpoint } from '../responsive';

const todayDhaka = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

type LabourOperation = 'transport' | 'stockInLabour' | 'stockOutLabour';

export function LabourAccounts({ initialPaymentOperation }: { initialPaymentOperation?: LabourOperation } = {}) {
  const { lang, moneyAccounts, refresh, sales, business, saveBusiness } = useApp();
  const { user } = useAuth();
  const bn = lang === 'bn';
  const m = useMoney();
  const n = useNum();
  const { width, isMobile } = useBreakpoint();
  const useCompactRows = width < 960;
  const [data, setData] = useState<LabourAccountsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeOperation, setActiveOperation] = useState<LabourOperation | null>(null);
  const requestedPaymentOperation = useRef<LabourOperation | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [addLabourOpen, setAddLabourOpen] = useState(false);
  const [newLabourName, setNewLabourName] = useState('');
  const [selectedLabourerIds, setSelectedLabourerIds] = useState<string[]>([]);
  const [labourAllocationKind, setLabourAllocationKind] = useState<'wage' | 'advance'>('wage');
  const [labourDropdownOpen, setLabourDropdownOpen] = useState(false);
  const [showStockOutLabourAccount, setShowStockOutLabourAccount] = useState(false);
  const [selectedLedgerWorkerId, setSelectedLedgerWorkerId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [accountId, setAccountId] = useState('');
  const [landingPayAmount, setLandingPayAmount] = useState('');
  const [landingPayDescription, setLandingPayDescription] = useState('');
  const [landingPayDate, setLandingPayDate] = useState(todayDhaka());
  const [salesHistoryPage, setSalesHistoryPage] = useState(false);
  const [attendanceDashboardOpen, setAttendanceDashboardOpen] = useState(false);
  const [attendanceMonth, setAttendanceMonth] = useState(todayDhaka().slice(0, 7));
  const [attendanceLabourers, setAttendanceLabourers] = useState<{ id: string; name: string }[]>([]);
  const [attendanceDraft, setAttendanceDraft] = useState<Record<string, string>>({});
  const [attendanceLoading, setAttendanceLoading] = useState(false);
  const [attendanceSaving, setAttendanceSaving] = useState(false);
  const [attendanceError, setAttendanceError] = useState('');
  const [saleDateFrom, setSaleDateFrom] = useState('');
  const [saleDateTo, setSaleDateTo] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarTarget, setCalendarTarget] = useState<'from' | 'to' | 'attendance'>('from');
  const [calendarMonth, setCalendarMonth] = useState(() => { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), 1); });
  const [ratesConfigOpen, setRatesConfigOpen] = useState(false);
  const [ratesDraft, setRatesDraft] = useState<Record<string, string>>({});
  const [newRateWeight, setNewRateWeight] = useState('');
  const [newRateAmount, setNewRateAmount] = useState('');
  const [savingRates, setSavingRates] = useState(false);
  const [ratesError, setRatesError] = useState('');
  const [ratesSaved, setRatesSaved] = useState(false);
  const tx = (bnText: string, enText: string) => bn ? bnText : enText;
  const attendanceCellKey = (date: string, labourerId: string) => `${date}|${labourerId}`;
  const openDatePicker = (target: 'from' | 'to') => {
    const selected = target === 'from' ? saleDateFrom : saleDateTo;
    const match = selected.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const base = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date();
    setCalendarTarget(target); setCalendarMonth(new Date(base.getFullYear(), base.getMonth(), 1)); setCalendarOpen(true);
  };
  const openAttendanceDatePicker = () => {
    const match = attendanceMonth.match(/^(\d{4})-(\d{2})$/);
    const base = match ? new Date(Number(match[1]), Number(match[2]) - 1, 1) : new Date();
    setCalendarTarget('attendance'); setCalendarMonth(new Date(base.getFullYear(), base.getMonth(), 1)); setCalendarOpen(true);
  };
  const calendarMonthLabel = calendarMonth.toLocaleDateString(bn ? 'bn-BD' : 'en-US', { month: 'long', year: 'numeric' });
  const calendarWeekdays = bn ? ['রবি', 'সোম', 'মঙ্গল', 'বুধ', 'বৃহঃ', 'শুক্র', 'শনি'] : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const calendarFirstWeekday = calendarMonth.getDay();
  const calendarDayCount = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 0).getDate();
  const calendarCells: (number | null)[] = [...Array.from({ length: calendarFirstWeekday }, () => null), ...Array.from({ length: calendarDayCount }, (_, index) => index + 1)];
  const calendarDateKey = (day: number) => `${calendarMonth.getFullYear()}-${String(calendarMonth.getMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const activeCalendarDate = calendarTarget === 'from' ? saleDateFrom : calendarTarget === 'to' ? saleDateTo : `${attendanceMonth}-01`;
  const activeAccounts = useMemo(() => moneyAccounts.filter(a => a.active), [moneyAccounts]);
  const saleBagBreakdown = useMemo(() => {
    const counts = new Map<number, number>();
    for (const sale of sales) {
      if (sale.date !== todayDhaka()) continue;
      for (const item of sale.items ?? []) {
        if (!['small', 'medium', 'large'].includes(item.unit) || item.enteredQty <= 0 || item.qtyKg <= 0) continue;
        const kgPerBag = Math.round(item.qtyKg / item.enteredQty * 100) / 100;
        if (kgPerBag > 0) counts.set(kgPerBag, (counts.get(kgPerBag) ?? 0) + item.enteredQty);
      }
    }
    return [...counts.entries()].sort((a, b) => b[0] - a[0]);
  }, [sales]);
  const totalSaleBags = saleBagBreakdown.reduce((sum, [, count]) => sum + count, 0);
  const bagLinesFor = (sale: typeof sales[number]) => (sale.items ?? []).flatMap(item => {
    if (!['small', 'medium', 'large'].includes(item.unit) || item.enteredQty <= 0 || item.qtyKg <= 0) return [];
    return [{ productName: item.productName, count: item.enteredQty, kgPerBag: Math.round(item.qtyKg / item.enteredQty * 100) / 100, totalKg: item.qtyKg }];
  });
  const saleHistory = sales.map(sale => ({ ...sale, bagLines: bagLinesFor(sale) })).filter(sale => sale.bagLines.length).sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  const todaySaleHistory = saleHistory.filter(sale => sale.date === todayDhaka());
  const transportRates = business.bagTransportRates ?? { '25': 3, '50': 6 };
  const configuredBagWeights = [...new Set([...saleHistory.flatMap(sale => sale.bagLines.map(line => line.kgPerBag)), ...Object.keys(transportRates).map(Number).filter(weight => weight > 0), 25, 50])].sort((a, b) => b - a);
  const transportTotalFor = (rows: typeof saleHistory, rates: Record<string, number>) => rows.reduce((total, sale) => total + sale.bagLines.reduce((sum, line) => sum + line.count * (rates[String(line.kgPerBag)] ?? 0), 0), 0);
  const todayTransportTotal = transportTotalFor(todaySaleHistory, transportRates);
  const openSalesHistoryPage = () => setSalesHistoryPage(true);
  const openRatesConfig = () => {
    const current = business.bagTransportRates ?? { '25': 3, '50': 6 };
    setRatesDraft(Object.fromEntries(Object.entries(current).map(([weight, rate]) => [weight, String(rate)])));
    setNewRateWeight(''); setNewRateAmount(''); setRatesError(''); setRatesSaved(false); setRatesConfigOpen(true);
  };
  const addRate = () => {
    if (user.role !== 'admin') { setRatesError(tx('শুধু প্রশাসক পরিবহন দর পরিবর্তন করতে পারবেন।', 'Only an administrator can change transport rates.')); return; }
    const weight = Number(newRateWeight), rate = Number(newRateAmount);
    if (!Number.isFinite(weight) || weight <= 0 || !Number.isFinite(rate) || rate < 0) { setRatesError(tx('সঠিক বস্তার ওজন ও পরিবহন দর দিন।', 'Enter a valid bag weight and transport rate.')); return; }
    setRatesDraft(current => ({ ...current, [String(weight)]: String(rate) })); setNewRateWeight(''); setNewRateAmount(''); setRatesError(''); setRatesSaved(false);
  };
  const saveRates = async () => {
    if (user.role !== 'admin') { setRatesError(tx('শুধু প্রশাসক পরিবহন দর পরিবর্তন করতে পারবেন।', 'Only an administrator can change transport rates.')); return; }
    const entries = Object.entries(ratesDraft).filter(([weight, rate]) => Number(weight) > 0 && Number.isFinite(Number(rate)) && Number(rate) >= 0);
    if (entries.length !== Object.keys(ratesDraft).length) { setRatesError(tx('প্রতিটি বস্তার জন্য বৈধ পরিবহন দর দিন।', 'Enter a valid transport rate for each bag size.')); return; }
    setSavingRates(true); setRatesError('');
    try {
      const bagTransportRates = Object.fromEntries(entries.map(([weight, rate]) => [String(Number(weight)), Number(rate)]));
      await saveBusiness({ ...business, bagTransportRates });
      setRatesSaved(true);
    } catch (e) { setRatesError(e instanceof Error ? e.message : tx('দর সংরক্ষণ করা যায়নি।', 'Could not save transport rates.')); }
    finally { setSavingRates(false); }
  };
  const historyTotalKg = saleHistory.reduce((total, sale) => total + sale.bagLines.reduce((sum, line) => sum + line.totalKg, 0), 0);
  const historyTotalBags = saleHistory.reduce((total, sale) => total + sale.bagLines.reduce((sum, line) => sum + line.count, 0), 0);
  const historyTransportTotal = transportTotalFor(saleHistory, transportRates);
  const filteredSaleHistory = saleHistory.filter(sale => (!saleDateFrom || sale.date >= saleDateFrom) && (!saleDateTo || sale.date <= saleDateTo));
  const filteredTotalBags = filteredSaleHistory.reduce((total, sale) => total + sale.bagLines.reduce((sum, line) => sum + line.count, 0), 0);
  const filteredTransportTotal = transportTotalFor(filteredSaleHistory, transportRates);
  type DailyBagSale = { date: string; bagsByWeight: Record<string, number>; totalBags: number; transportTotal: number };
  const dailySaleRows = filteredSaleHistory.reduce((days, sale) => {
    const day = days.get(sale.date) ?? { date: sale.date, bagsByWeight: {}, totalBags: 0, transportTotal: 0 };
    for (const line of sale.bagLines) {
      const weight = String(line.kgPerBag);
      day.bagsByWeight[weight] = (day.bagsByWeight[weight] ?? 0) + line.count;
      day.totalBags += line.count;
      day.transportTotal += line.count * (transportRates[weight] ?? 0);
    }
    days.set(sale.date, day);
    return days;
  }, new Map<string, DailyBagSale>()).values();
  const dailySaleRowsSorted = [...dailySaleRows].sort((a, b) => b.date.localeCompare(a.date));
  const loadAttendance = useCallback(async () => {
    if (!attendanceDashboardOpen) return;
    setAttendanceLoading(true); setAttendanceError('');
    try {
      const result = await api.labourAttendance(attendanceMonth);
      setAttendanceLabourers(result.labourers);
      setAttendanceDraft(Object.fromEntries(result.entries.map(entry => [attendanceCellKey(entry.date, entry.labourerId), String(entry.value)])));
    } catch (e) { setAttendanceError(e instanceof Error ? e.message : tx('উপস্থিতির তালিকা লোড করা যায়নি।', 'Could not load attendance.')); }
    finally { setAttendanceLoading(false); }
  }, [attendanceDashboardOpen, attendanceMonth, lang]);
  useEffect(() => { void loadAttendance(); }, [loadAttendance]);
  const saveAttendance = async () => {
    setAttendanceSaving(true); setAttendanceError('');
    try {
      const [year, month] = attendanceMonth.split('-').map(Number);
      const dayCount = new Date(year, month, 0).getDate();
      const entries: { date: string; labourerId: string; value: number | null }[] = [];
      for (let day = 1; day <= dayCount; day++) {
        const date = `${attendanceMonth}-${String(day).padStart(2, '0')}`;
        for (const labourer of attendanceLabourers) {
          const raw = attendanceDraft[attendanceCellKey(date, labourer.id)]?.trim() ?? '';
          const value = raw === '' ? null : Number(raw);
          if (value !== null && (!Number.isFinite(value) || value < 0 || value > 1)) {
            setAttendanceError(tx('প্রতিটি দিনের অনুপাত ০ থেকে ১-এর মধ্যে দিন।', 'Enter a ratio from 0 to 1 for each day.'));
            setAttendanceSaving(false);
            return;
          }
          entries.push({ date, labourerId: labourer.id, value });
        }
      }
      await api.saveLabourAttendance({ month: attendanceMonth, entries });
      await Promise.all([loadAttendance(), load()]);
    } catch (e) { setAttendanceError(e instanceof Error ? e.message : tx('উপস্থিতি সংরক্ষণ করা যায়নি।', 'Could not save attendance.')); }
    finally { setAttendanceSaving(false); }
  };
  const [attendanceYear, attendanceMonthNumber] = attendanceMonth.split('-').map(Number);
  const attendanceDayCount = new Date(attendanceYear, attendanceMonthNumber, 0).getDate();
  const attendanceBagSales = useMemo(() => {
    const daily = new Map<string, number>();
    for (const sale of sales) {
      if (!sale.date.startsWith(`${attendanceMonth}-`)) continue;
      for (const item of sale.items ?? []) {
        if (['small', 'medium', 'large'].includes(item.unit) && item.enteredQty > 0) {
          daily.set(sale.date, (daily.get(sale.date) ?? 0) + item.enteredQty);
        }
      }
    }
    return daily;
  }, [attendanceMonth, sales]);
  const attendanceBagTransportAmounts = useMemo(() => {
    const daily = new Map<string, number>();
    for (const sale of sales) {
      if (!sale.date.startsWith(`${attendanceMonth}-`)) continue;
      for (const item of sale.items ?? []) {
        if (!['small', 'medium', 'large'].includes(item.unit) || item.enteredQty <= 0 || item.qtyKg <= 0) continue;
        const kgPerBag = Math.round(item.qtyKg / item.enteredQty * 100) / 100;
        const charge = item.enteredQty * (transportRates[String(kgPerBag)] ?? 0);
        daily.set(sale.date, (daily.get(sale.date) ?? 0) + charge);
      }
    }
    return daily;
  }, [attendanceMonth, sales, transportRates]);
  const attendanceMonthBagSales = [...attendanceBagSales.values()].reduce((sum, quantity) => sum + quantity, 0);
  const attendanceMonthBagTransportAmount = [...attendanceBagTransportAmounts.values()].reduce((sum, amount) => sum + amount, 0);
  const markedAttendanceValues = Object.values(attendanceDraft).filter(value => value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1).map(Number);
  const fullDayCount = markedAttendanceValues.filter(value => value === 1).length;
  const partialDayCount = markedAttendanceValues.filter(value => value > 0 && value < 1).length;
  const absentDayCount = markedAttendanceValues.filter(value => value === 0).length;
  const dayEquivalentTotal = markedAttendanceValues.reduce((sum, value) => sum + value, 0);
  const load = useCallback(async () => {
    try { setError(''); setData(await api.labourAccounts()); }
    catch (e) { setError(e instanceof Error ? e.message : tx('তথ্য লোড করা যায়নি।', 'Could not load landing costs.')); }
    finally { setLoading(false); }
  }, [lang]);
  useEffect(() => { void load(); }, [load]);
  const openPayment = () => {
    if (!activeOperation) return;
    const operation = data?.operations?.[activeOperation];
    setLandingPayAmount(activeOperation === 'stockOutLabour' ? '' : String(operation?.unpaid ?? 0)); setSelectedLabourerIds([]); setLabourAllocationKind('wage'); setLabourDropdownOpen(false); setLandingPayDescription(''); setLandingPayDate(todayDhaka()); setAccountId(activeAccounts.find(a => a.type === 'cash')?.id ?? activeAccounts[0]?.id ?? ''); setError(''); setPaymentOpen(true);
  };
  const openAdvance = () => {
    setAdvanceAmount('');
    setLandingPayDate(todayDhaka());
    setLandingPayDescription('');
    setAccountId(activeAccounts.find(account => account.type === 'cash')?.id ?? activeAccounts[0]?.id ?? '');
    setError('');
    setAdvanceOpen(true);
  };
  const submitAdvance = async () => {
    const amount = Number(advanceAmount);
    if (!activeOperation || !accountId || !landingPayDate || !Number.isFinite(amount) || amount <= 0) {
      setError(tx('সঠিক অগ্রিমের পরিমাণ, তারিখ ও অ্যাকাউন্ট দিন।', 'Enter a valid advance amount, date, and account.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await api.recordLandingAdvance({ landingType: activeOperation, amount, accountId, date: landingPayDate, note: landingPayDescription.trim() || undefined });
      setAdvanceOpen(false);
      await refresh();
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : tx('অগ্রিম সংরক্ষণ করা যায়নি।', 'Could not record advance.')); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (!initialPaymentOperation || loading || !data || requestedPaymentOperation.current === initialPaymentOperation) return;
    requestedPaymentOperation.current = initialPaymentOperation;
    setActiveOperation(initialPaymentOperation);
    setLandingPayAmount(initialPaymentOperation === 'stockOutLabour' ? '' : String(data.operations[initialPaymentOperation]?.unpaid ?? 0));
    setSelectedLabourerIds([]);
    setLabourAllocationKind('wage');
    setLabourDropdownOpen(false);
    setLandingPayDescription('');
    setLandingPayDate(todayDhaka());
    setAccountId(activeAccounts.find(account => account.type === 'cash')?.id ?? activeAccounts[0]?.id ?? '');
    setError('');
    setPaymentOpen(true);
  }, [activeAccounts, data, initialPaymentOperation, loading]);
  const submitPayment = async () => {
    const amount = Number(landingPayAmount);
    const selectedWorkers = data?.labourers.filter(worker => selectedLabourerIds.includes(worker.id)) ?? [];
    if (activeOperation === 'stockOutLabour' && labourAllocationKind === 'advance' && !selectedLabourerIds.length) {
      setError(tx('অগ্রিম দিতে অন্তত একজন শ্রমিক নির্বাচন করুন।', 'Select at least one labourer for an advance.')); return;
    }
    const splitLimit = labourAllocationKind === 'wage' && selectedWorkers.length ? Math.min(selectedOperation.unpaid, Math.min(...selectedWorkers.map(worker => worker.stockOutUnpaid)) * selectedWorkers.length) : selectedOperation.unpaid;
    if (!activeOperation || !accountId || !landingPayDate || !Number.isFinite(amount) || amount <= 0 || amount > splitLimit + 0.01) {
      setError(tx('বকেয়ার মধ্যে সঠিক পেমেন্টের পরিমাণ, তারিখ ও অ্যাকাউন্ট দিন।', 'Enter a valid payment amount up to the balance, date, and account.')); return;
    }
    setBusy(true);
    try {
      await api.payOperation(activeOperation, { accountId, date: landingPayDate, amount, note: landingPayDescription.trim() || undefined, labourerIds: selectedLabourerIds.length ? selectedLabourerIds : undefined, allocationKind: labourAllocationKind });
      setPaymentOpen(false); setSelectedLabourerIds([]); await refresh(); await load();
    }
    catch (e) { setError(e instanceof Error ? e.message : tx('পেমেন্ট সংরক্ষণ করা যায়নি।', 'Could not record payment.')); }
    finally { setBusy(false); }
  };
  const submitAddLabourer = async () => {
    const name = newLabourName.trim();
    if (!name) { setError(tx('শ্রমিকের নাম লিখুন।', 'Enter a labourer name.')); return; }
    setBusy(true);
    try {
      await api.createLabourer(name);
      setNewLabourName(''); setAddLabourOpen(false); setError(''); await refresh(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : tx('শ্রমিক যোগ করা যায়নি।', 'Could not add labourer.')); }
    finally { setBusy(false); }
  };
  const operationCards = [
    { id: 'transport' as const, label: tx('পরিবহন খরচ', 'Transport Expenses'), recordsLabel: tx('পরিবহন খরচের রেকর্ড', 'Transport Expense Records'), color: '#0369A1' },
    { id: 'stockInLabour' as const, label: tx('স্টক ইন খরচ', 'Stock In Cost'), recordsLabel: tx('স্টক ইন রেকর্ড', 'Stock In Records'), color: '#047857' },
    { id: 'stockOutLabour' as const, label: tx('স্টক আউট খরচ', 'Stock Out Cost'), recordsLabel: tx('স্টক আউট রেকর্ড', 'Stock Out Records'), color: '#7C3AED' },
  ];
  const selectedOperation = data?.operations?.[activeOperation ?? 'transport'] ?? { total: 0, paid: 0, advanceBalance: 0, unpaid: 0, entries: [] };
  const selectedLabel = operationCards.find(card => card.id === activeOperation)?.label ?? '';
  const selectedLedgerWorker = data?.labourers.find(worker => worker.id === selectedLedgerWorkerId) ?? null;
  return <View style={{ flex: 1, backgroundColor: 'transparent' }}>
    <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 1200, alignSelf: 'center', padding: isMobile ? 12 : 20, gap: 14, paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        {activeOperation || salesHistoryPage || attendanceDashboardOpen ? <TouchableOpacity accessibilityRole="button" onPress={() => { if (attendanceDashboardOpen) setAttendanceDashboardOpen(false); else if (salesHistoryPage) setSalesHistoryPage(false); else if (selectedLedgerWorkerId) setSelectedLedgerWorkerId(null); else if (showStockOutLabourAccount) { setShowStockOutLabourAccount(false); setActiveOperation(null); } else setActiveOperation(null); setError(''); }} style={{ minHeight: 42, justifyContent: 'center', paddingHorizontal: 14, backgroundColor: '#E2E8F0', borderRadius: 9 }}><Text style={{ color: color.text, fontWeight: '800' }}>{tx('ফিরে যান', 'Back')}</Text></TouchableOpacity> : null}
        <View style={{ flex: 1, minWidth: 180 }}><SectionHead icon={icons.vendors}>{selectedLedgerWorker ? `${selectedLedgerWorker.name} · ${tx('স্টক আউট শ্রমিক লেজার', 'Stock-out Labour Ledger')}` : attendanceDashboardOpen ? tx('শ্রমিক উপস্থিতি', 'Labour Attendance') : salesHistoryPage ? tx('আজকের বিক্রির বস্তার ইতিহাস', 'Bag Sale History') : showStockOutLabourAccount ? tx('শ্রমিক হিসাব', 'Labour Account') : activeOperation ? operationCards.find(card => card.id === activeOperation)?.recordsLabel : tx('ল্যান্ডিং খরচের হিসাব', 'Landing Cost System')}</SectionHead></View>
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 9, padding: 10 }}>{error}</Text> : null}
      {!activeOperation && !salesHistoryPage && !attendanceDashboardOpen ? <View style={{ gap: 10 }}>
        <TouchableOpacity accessibilityRole="button" onPress={openSalesHistoryPage} activeOpacity={0.88} style={{ backgroundColor: '#fff', borderRadius: 13, padding: isMobile ? 14 : 18, borderWidth: 1, borderColor: '#E2E8F0', shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: saleBagBreakdown.length ? 12 : 0 }}>
            <Text style={{ color: '#0F766E', fontWeight: '800', fontSize: 15 }}>{tx('আজকের বিক্রির পরিমাণ (বস্তা)', 'Today Sale Quantity (Bags)')}</Text>
            <Text style={{ color: '#0F172A', fontWeight: '900', fontSize: 22 }}>{n(totalSaleBags)} {tx('বস্তা', 'bags')}</Text>
          </View>
          {saleBagBreakdown.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {saleBagBreakdown.map(([kgPerBag, count]) => <View key={kgPerBag} style={{ flexGrow: 1, minWidth: 170, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: 10, backgroundColor: '#F0FDFA', borderRadius: 9, borderWidth: 1, borderColor: '#CCFBF1' }}>
              <View><Text style={{ color: '#115E59', fontWeight: '800' }}>{n(kgPerBag)} kg {tx('বস্তা', 'bag')}</Text><Text style={{ color: '#64748B', fontSize: 12, marginTop: 2 }}>{n(count)} × {n(kgPerBag)} = {n(count * kgPerBag)} kg</Text></View>
              <Text style={{ color: '#0F766E', fontWeight: '900' }}>{n(count)} {tx('টি', 'bags')}</Text>
            </View>)}
          </View> : <Text style={{ color: '#64748B', marginTop: 5 }}>{tx('আজ বস্তায় কোনো বিক্রি নেই', 'No bag sales recorded today')}</Text>}
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, paddingTop: 10, marginTop: 10, borderTopWidth: 1, borderTopColor: '#E2E8F0' }}><Text style={{ color: '#475569', fontWeight: '800' }}>{tx('মোট পরিবহন খরচ', 'Total Bag Transport')}</Text><Text style={{ color: '#0F766E', fontWeight: '900' }}>{m(todayTransportTotal)}</Text></View>
          <Text style={{ color: '#64748B', fontSize: 12, marginTop: 5 }}>{tx('আজকের বিক্রির ইতিহাস দেখতে চাপ দিন', 'Tap to view today’s sale history')}</Text>
        </TouchableOpacity>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {operationCards.map(card => {
            const operation = data?.operations?.[card.id] ?? { total: 0, paid: 0, unpaid: 0, entries: [] };
            return <TouchableOpacity key={card.id} accessibilityRole="button" onPress={() => { setActiveOperation(card.id); setError(''); }} style={{ flex: 1, minWidth: useCompactRows ? '100%' : 220, backgroundColor: '#fff', borderRadius: 13, padding: isMobile ? 14 : 18, borderWidth: 1, borderColor: '#E2E8F0', shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 }}>
              <Text style={{ color: card.color, fontWeight: '800' }}>{card.label}</Text>
              <Text style={{ color: color.text, fontSize: isMobile ? 20 : 22, fontWeight: '900', marginTop: 8 }}>{m(operation.total)}</Text>
              <Text style={{ color: '#64748B', marginTop: 5 }}>{operation.unpaid < 0 ? tx('অগ্রিম', 'Advance balance') : tx('বাকি', 'Due')}: <Text style={{ color: operation.unpaid > 0 ? '#DC2626' : '#059669', fontWeight: '800' }}>{operation.unpaid < 0 ? `−${m(Math.abs(operation.unpaid))}` : m(operation.unpaid)}</Text></Text>
              <Text style={{ color: '#64748B', marginTop: 2 }}>{tx('পরিশোধিত', 'Paid')}: {m(operation.paid)}</Text>
            </TouchableOpacity>;
          })}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          <Btn kind="ghost" label={tx('শ্রমিক হিসাব', 'Labour Account')} onPress={() => { setActiveOperation('stockOutLabour'); setShowStockOutLabourAccount(true); setSelectedLedgerWorkerId(null); setError(''); }} />
          <Btn kind="ghost" label={tx('শ্রমিক উপস্থিতি', 'Labour Attendance')} onPress={() => { setAttendanceError(''); setAttendanceDashboardOpen(true); }} />
          <Btn kind="ghost" label={tx('শ্রমিক যোগ করুন', 'Add Labour')} onPress={() => { setNewLabourName(''); setAddLabourOpen(true); setError(''); }} />
        </View>
      </View> : attendanceDashboardOpen ? <View style={{ gap: 12 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 13, padding: isMobile ? 14 : 18, borderWidth: 1, borderColor: '#E2E8F0', gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <View><Text style={{ color: color.text, fontSize: 18, fontWeight: '900' }}>{tx('শ্রমিক উপস্থিতি ড্যাশবোর্ড', 'Labour Attendance Dashboard')}</Text><Text style={{ color: '#64748B', marginTop: 3 }}>{tx('মাস অনুযায়ী শ্রমিকদের দৈনিক কাজের অনুপাত লিখুন', 'Enter each labourer’s daily attendance ratio for the month')}</Text></View>
            <TouchableOpacity accessibilityRole="button" onPress={openAttendanceDatePicker} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 9 }}><Text style={{ color: color.text, fontWeight: '800' }}>{new Date(attendanceYear, attendanceMonthNumber - 1, 1).toLocaleDateString(bn ? 'bn-BD' : 'en-US', { month: 'long', year: 'numeric' })}</Text><Text style={{ color: '#64748B' }}>▦</Text></TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 9 }}>
            {[[tx('পূর্ণ দিন', 'Full days'), fullDayCount, '#047857', '#ECFDF5'], [tx('আংশিক দিন', 'Partial days'), partialDayCount, '#B45309', '#FFFBEB'], [tx('অনুপস্থিত', 'Absent'), absentDayCount, '#B91C1C', '#FEF2F2'], [tx('মোট দিন-সমতুল্য', 'Day equivalents'), n(dayEquivalentTotal), '#1D4ED8', '#EFF6FF']].map(([label, count, tone, background]) => <View key={String(label)} style={{ flexGrow: 1, minWidth: isMobile ? '45%' : 150, padding: 12, backgroundColor: background as string, borderRadius: 10 }}><Text style={{ color: '#64748B', fontWeight: '700' }}>{label}</Text><Text style={{ color: tone as string, fontSize: 22, fontWeight: '900', marginTop: 3 }}>{count}</Text></View>)}
          </View>
          <Text style={{ color: '#64748B', fontSize: 12 }}>{tx('১ = পূর্ণ দিন · ০.৫ = অর্ধদিবস · ০ = অনুপস্থিত · ০ থেকে ১-এর মধ্যে অন্য অনুপাতও লিখতে পারবেন', '1 = full day · 0.5 = half day · 0 = absent · enter any other ratio from 0 to 1')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', gap: 8 }}><Btn label={attendanceSaving ? tx('সংরক্ষণ হচ্ছে…', 'Saving…') : tx('উপস্থিতি সংরক্ষণ', 'Save Attendance')} onPress={() => { if (!attendanceSaving) void saveAttendance(); }} /></View>
          {attendanceError ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 10, borderRadius: 8 }}>{attendanceError}</Text> : null}
        </View>
        <View style={{ backgroundColor: '#fff', borderRadius: 13, padding: isMobile ? 12 : 16, borderWidth: 1, borderColor: '#E2E8F0', gap: 8 }}>
          <Text style={{ color: color.text, fontSize: 16, fontWeight: '900', marginBottom: 3 }}>{tx('তারিখ × শ্রমিকের উপস্থিতির অনুপাত', 'Daily attendance ratio by labourer')}</Text>
          {attendanceLoading ? <ActivityIndicator color={color.primary} style={{ padding: 20 }} /> : !attendanceLabourers.length ? <Text style={{ color: '#64748B', textAlign: 'center', padding: 20 }}>{tx('কোনো শ্রমিক নেই। আগে শ্রমিক যোগ করুন।', 'No labourers found. Add labourers first.')}</Text> : <ScrollView horizontal showsHorizontalScrollIndicator keyboardShouldPersistTaps="handled">
            <ScrollView style={{ maxHeight: 480 }} nestedScrollEnabled stickyHeaderIndices={[0]} showsVerticalScrollIndicator keyboardShouldPersistTaps="handled">
            <View style={{ minWidth: 130 + attendanceLabourers.length * 92 + 335 }}>
              <View style={{ position: 'sticky' as any, top: 0, zIndex: 3, flexDirection: 'row', alignItems: 'center', minHeight: 50, paddingHorizontal: 8, backgroundColor: '#E0F2FE', borderRadius: 8 }}>
                <Text style={{ position: 'sticky' as any, left: 0, zIndex: 4, width: 130, color: '#075985', fontWeight: '900', backgroundColor: '#E0F2FE' }}>{tx('তারিখ', 'Date')}</Text>
                {attendanceLabourers.map(labourer => <Text key={labourer.id} numberOfLines={2} style={{ width: 92, paddingHorizontal: 3, color: '#075985', textAlign: 'center', fontSize: 12, fontWeight: '900' }}>{labourer.name}</Text>)}
                <Text style={{ width: 100, color: '#075985', textAlign: 'center', fontWeight: '900' }}>{tx('মোট', 'Total')}</Text>
                <Text style={{ width: 110, color: '#075985', textAlign: 'center', fontWeight: '900' }}>{tx('বস্তা বিক্রি', 'Bags sold')}</Text>
                <Text style={{ width: 125, color: '#075985', textAlign: 'center', fontWeight: '900' }}>{tx('বস্তা পরিবহন', 'Bag transport (BDT)')}</Text>
              </View>
              {Array.from({ length: attendanceDayCount }, (_, index) => index + 1).map(day => {
                const date = `${attendanceMonth}-${String(day).padStart(2, '0')}`;
                const dayTotal = attendanceLabourers.reduce((sum, labourer) => {
                  const raw = attendanceDraft[attendanceCellKey(date, labourer.id)] ?? '';
                  const value = raw.trim() ? Number(raw) : 0;
                  return sum + (Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0);
                }, 0);
                return <View key={date} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
                  <Text style={{ position: 'sticky' as any, left: 0, zIndex: 1, width: 130, color: color.text, fontWeight: '700', backgroundColor: '#fff' }}>{date}</Text>
                  {attendanceLabourers.map(labourer => {
                    const key = attendanceCellKey(date, labourer.id);
                    const value = attendanceDraft[key] ?? '';
                    const ratio = Number(value);
                    const valid = value.trim() !== '' && Number.isFinite(ratio) && ratio >= 0 && ratio <= 1;
                    return <View key={labourer.id} style={{ width: 92, alignItems: 'center' }}><TextInput accessibilityLabel={`${date} attendance for ${labourer.name}`} value={value} onChangeText={next => setAttendanceDraft(current => ({ ...current, [key]: next }))} keyboardType="decimal-pad" placeholder="—" maxLength={5} style={{ width: 66, height: 36, paddingHorizontal: 5, backgroundColor: value === '' ? '#fff' : valid ? ratio === 1 ? '#ECFDF5' : ratio === 0 ? '#FEF2F2' : '#FFFBEB' : '#FEF2F2', borderWidth: 1, borderColor: valid || value === '' ? '#CBD5E1' : '#DC2626', borderRadius: 7, color: color.text, textAlign: 'center', fontWeight: '800' }} /></View>;
                  })}
                  <Text style={{ width: 100, color: '#0F766E', textAlign: 'center', fontWeight: '900' }}>{n(dayTotal)}</Text>
                  <Text style={{ width: 110, color: '#0369A1', textAlign: 'center', fontWeight: '900' }}>{n(attendanceBagSales.get(date) ?? 0)}</Text>
                  <Text style={{ width: 125, color: '#0369A1', textAlign: 'center', fontWeight: '900' }}>৳{n(attendanceBagTransportAmounts.get(date) ?? 0)}</Text>
                </View>;
              })}
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 8, backgroundColor: '#F0FDFA', borderRadius: 8, marginTop: 4 }}>
                <Text style={{ width: 130, color: color.text, fontWeight: '900' }}>{tx('মাসের মোট', 'Month total')}</Text>
                {attendanceLabourers.map(labourer => {
                  const total = Object.entries(attendanceDraft).filter(([key]) => key.endsWith(`|${labourer.id}`)).reduce((sum, [, value]) => sum + (value.trim() && Number.isFinite(Number(value)) ? Number(value) : 0), 0);
                  return <Text key={labourer.id} style={{ width: 92, color: '#0F766E', textAlign: 'center', fontWeight: '900' }}>{n(total)}</Text>;
                })}
                <Text style={{ width: 100, color: '#0F766E', textAlign: 'center', fontWeight: '900' }}>{n(dayEquivalentTotal)}</Text>
                <Text style={{ width: 110, color: '#0369A1', textAlign: 'center', fontWeight: '900' }}>{n(attendanceMonthBagSales)}</Text>
                <Text style={{ width: 125, color: '#0369A1', textAlign: 'center', fontWeight: '900' }}>৳{n(attendanceMonthBagTransportAmount)}</Text>
              </View>
            </View>
            </ScrollView>
          </ScrollView>}
        </View>
      </View> : salesHistoryPage ? <View style={{ gap: 12 }}>
        <View style={{ backgroundColor: '#fff', borderRadius: 13, padding: isMobile ? 14 : 18, borderWidth: 1, borderColor: '#E2E8F0', gap: 12 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <View><Text style={{ color: color.text, fontSize: 17, fontWeight: '900' }}>{tx('সব দিনের বস্তা বিক্রির হিসাব', 'Bag sales across all dates')}</Text><Text style={{ color: '#64748B', marginTop: 3 }}>{tx('আজকের বিক্রি', 'Today')}: {n(totalSaleBags)} {tx('বস্তা', 'bags')} · {m(todayTransportTotal)}</Text></View>
            <Btn label={tx('দাম কনফিগার করুন', 'Configure Price')} onPress={openRatesConfig} />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {[ [tx('মোট বস্তা', 'All-time bags'), n(historyTotalBags)], [tx('মোট ওজন', 'All-time weight'), `${n(historyTotalKg)} kg`], [tx('মোট পরিবহন', 'Transport at current rates'), m(historyTransportTotal)] ].map(([label, value]) => <View key={String(label)} style={{ flexGrow: 1, minWidth: isMobile ? '100%' : 180, padding: 11, borderRadius: 9, backgroundColor: '#F0FDFA', borderWidth: 1, borderColor: '#CCFBF1' }}><Text style={{ color: '#64748B', fontWeight: '700' }}>{label}</Text><Text style={{ color: '#0F766E', fontSize: 17, fontWeight: '900', marginTop: 4 }}>{value}</Text></View>)}
          </View>
          <Text style={{ color: '#64748B', fontSize: 12 }}>{tx('পরিবহন মোট বর্তমান কনফিগার করা দর অনুযায়ী হিসাব করা হয়েছে।', 'Transport totals use the currently configured per-bag rates.')}</Text>
        </View>
        <View style={{ backgroundColor: '#fff', borderRadius: 13, padding: isMobile ? 12 : 16, borderWidth: 1, borderColor: '#E2E8F0', gap: 9 }}>
          <Text style={{ color: color.text, fontSize: 16, fontWeight: '900' }}>{tx('তারিখ অনুযায়ী বস্তা বিক্রি', 'Bag Sales by Date')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 10 }}>
            <View style={{ flex: 1, minWidth: isMobile ? 130 : 180 }}><Text style={{ color: '#64748B', fontSize: 12, fontWeight: '700', marginBottom: 4 }}>{tx('শুরুর তারিখ', 'From date')}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel={tx('ক্যালেন্ডার থেকে শুরুর তারিখ বাছুন', 'Choose start date from calendar')} onPress={() => openDatePicker('from')} style={{ height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8 }}><Text style={{ color: saleDateFrom ? color.text : '#94A3B8' }}>{saleDateFrom || tx('তারিখ নির্বাচন', 'Select date')}</Text><Text style={{ color: '#64748B' }}>▦</Text></TouchableOpacity></View>
            <View style={{ flex: 1, minWidth: isMobile ? 130 : 180 }}><Text style={{ color: '#64748B', fontSize: 12, fontWeight: '700', marginBottom: 4 }}>{tx('শেষ তারিখ', 'To date')}</Text><TouchableOpacity accessibilityRole="button" accessibilityLabel={tx('ক্যালেন্ডার থেকে শেষ তারিখ বাছুন', 'Choose end date from calendar')} onPress={() => openDatePicker('to')} style={{ height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8 }}><Text style={{ color: saleDateTo ? color.text : '#94A3B8' }}>{saleDateTo || tx('তারিখ নির্বাচন', 'Select date')}</Text><Text style={{ color: '#64748B' }}>▦</Text></TouchableOpacity></View>
            <TouchableOpacity accessibilityRole="button" onPress={() => { setSaleDateFrom(''); setSaleDateTo(''); }} style={{ minHeight: 42, justifyContent: 'center', paddingHorizontal: 12, backgroundColor: '#E2E8F0', borderRadius: 8 }}><Text style={{ color: color.text, fontWeight: '800' }}>{tx('মুছুন', 'Clear')}</Text></TouchableOpacity>
          </View>
          {!dailySaleRowsSorted.length ? <Text style={{ color: '#64748B', textAlign: 'center', padding: 20 }}>{tx('কোনো বস্তা বিক্রির ইতিহাস নেই', 'No bag sale history found')}</Text> : <ScrollView horizontal showsHorizontalScrollIndicator>
            <View style={{ minWidth: 130 + configuredBagWeights.length * 90 + 105 + 125 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 9, backgroundColor: '#E0F2FE', borderRadius: 8 }}>
                <Text style={{ width: 130, color: '#075985', fontWeight: '900' }}>{tx('তারিখ', 'Date')}</Text>
                {configuredBagWeights.map(weight => <Text key={weight} style={{ width: 90, color: '#075985', textAlign: 'right', fontWeight: '900' }}>{n(weight)} kg</Text>)}
                <Text style={{ width: 105, color: '#075985', textAlign: 'right', fontWeight: '900' }}>{tx('মোট বস্তা', 'Total Bags')}</Text>
                <Text style={{ width: 125, color: '#075985', textAlign: 'right', fontWeight: '900' }}>{tx('পরিবহন টাকা', 'Transport ৳')}</Text>
              </View>
              {dailySaleRowsSorted.map(day => <View key={day.date} style={{ borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 9 }}>
                  <Text style={{ width: 130, color: color.text, fontWeight: '700' }}>{day.date}</Text>
                  {configuredBagWeights.map(weight => <Text key={weight} style={{ width: 90, color: color.text, textAlign: 'right' }}>{n(day.bagsByWeight[String(weight)] ?? 0)}</Text>)}
                  <Text style={{ width: 105, color: '#0F766E', textAlign: 'right', fontWeight: '900' }}>{n(day.totalBags)}</Text>
                  <Text style={{ width: 125, color: '#0F766E', textAlign: 'right', fontWeight: '800' }}>{m(day.transportTotal)}</Text>
                </View>
              </View>)}
              <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 9, backgroundColor: '#F0FDFA', borderRadius: 8, marginTop: 4 }}>
                <Text style={{ width: 130, color: color.text, fontWeight: '900' }}>{tx('সর্বমোট', 'Grand Total')}</Text>
                {configuredBagWeights.map(weight => <Text key={weight} style={{ width: 90, color: color.text, textAlign: 'right', fontWeight: '800' }}>{n(filteredSaleHistory.reduce((sum, sale) => sum + sale.bagLines.filter(line => line.kgPerBag === weight).reduce((lineSum, line) => lineSum + line.count, 0), 0))}</Text>)}
                <Text style={{ width: 105, color: '#0F766E', textAlign: 'right', fontWeight: '900' }}>{n(filteredTotalBags)}</Text>
                <Text style={{ width: 125, color: '#0F766E', textAlign: 'right', fontWeight: '900' }}>{m(filteredTransportTotal)}</Text>
              </View>
            </View>
          </ScrollView>}
        </View>
      </View> : <Card style={{ padding: 14 }}>
        {activeOperation && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {[
            [tx('মোট খরচ', 'Total Cost'), selectedOperation.total, '#1D4ED8'],
            [tx('পরিশোধিত', 'Paid'), selectedOperation.paid, '#059669'],
            [selectedOperation.unpaid < 0 ? tx('অগ্রিম ব্যালেন্স', 'Advance balance') : tx('বাকি', 'Due'), selectedOperation.unpaid, selectedOperation.unpaid > 0 ? '#DC2626' : '#059669'],
          ].map(([label, value, tone]) => <View key={String(label)} style={{ flexGrow: 1, minWidth: useCompactRows ? 105 : 150, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: isMobile ? 9 : 12 }}><Text style={{ color: '#64748B', fontWeight: '700' }}>{label}</Text><Text style={{ color: tone as string, fontWeight: '900', fontSize: 17, marginTop: 4 }}>{Number(value) < 0 ? `−${m(Math.abs(Number(value)))}` : m(Number(value))}</Text></View>)}
        </View>}
        {!showStockOutLabourAccount && activeOperation ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <Btn kind="ghost" label={tx('অগ্রিম রেকর্ড করুন', 'Record Advance')} onPress={openAdvance} />
          {selectedOperation.unpaid > 0 ? <Btn label={`${tx('সমষ্টিগত বকেয়া পরিশোধ', 'Pay collective balance')} · ${m(selectedOperation.unpaid)}`} onPress={openPayment} /> : null}
        </View> : null}
        {showStockOutLabourAccount ? <View style={{ gap: 10 }}>
          {selectedLedgerWorker ? <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[[tx('স্টক আউট মজুরি', 'Stock-out wages'), selectedLedgerWorker.stockOutWages, '#1D4ED8'], [tx('অগ্রিম সমন্বয়', 'Advance applied'), selectedLedgerWorker.stockOutAdvanceApplied, '#7C3AED'], [tx('অগ্রিম বাকি', 'Advance balance'), selectedLedgerWorker.stockOutAdvanceBalance, '#7C3AED'], [tx('পরিশোধিত', 'Paid'), selectedLedgerWorker.stockOutPaid, '#059669'], [tx('বাকি', 'Balance due'), selectedLedgerWorker.stockOutUnpaid, '#DC2626']].map(([label, value, tone]) => <View key={String(label)} style={{ flexGrow: 1, minWidth: useCompactRows ? 105 : 145, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: isMobile ? 9 : 12 }}><Text style={{ color: '#64748B', fontWeight: '700' }}>{label}</Text><Text style={{ color: tone as string, fontSize: 17, fontWeight: '900', marginTop: 4 }}>{m(Number(value))}</Text></View>)}
            </View>
            {useCompactRows ? <View style={{ gap: 9 }}>{!selectedLedgerWorker.stockOutLedger.length ? <Text style={{ color: '#64748B', textAlign: 'center', padding: 18 }}>{tx('কোনো স্টক আউট লেজার নেই।', 'No stock-out ledger entries yet.')}</Text> : selectedLedgerWorker.stockOutLedger.map(item => <View key={`${item.kind}-${item.id}`} style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}><Text style={{ color: '#475569', fontWeight: '700' }}>{item.date}</Text><Text style={{ color: item.kind === 'payment' ? '#059669' : item.kind === 'advance' ? '#7C3AED' : '#1D4ED8', fontWeight: '900' }}>{item.kind === 'payment' ? '−' : ''}{m(item.amount)}</Text></View>
              <Text style={{ color: color.text, fontWeight: '700' }}>{item.kind === 'wage' ? `${tx('স্টক আউট মজুরি', 'Stock-out wage')} · ${n(item.quantity ?? 0)} ${tx('বস্তা', 'bags')} × ${m(item.pricePerBag ?? 0)}${item.advanceApplied ? ` · ${tx('অগ্রিম সমন্বয়', 'advance applied')}: ${m(item.advanceApplied)}` : ''}` : item.kind === 'advance' ? tx('অগ্রিম প্রদান', 'Advance paid') : tx('স্টক আউট পেমেন্ট', 'Stock-out payment')}</Text>
              {item.note ? <Text style={{ color: '#64748B' }}>{item.note}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Text style={{ color: item.dueBalance > 0 ? '#DC2626' : '#059669' }}>{tx('মজুরি বাকি', 'Wages due')}: {m(item.dueBalance)}</Text><Text style={{ color: item.advanceBalance > 0 ? '#7C3AED' : '#64748B' }}>{tx('অগ্রিম বাকি', 'Advance balance')}: {m(item.advanceBalance)}</Text></View>
            </View>)}</View> : <ScrollView horizontal showsHorizontalScrollIndicator><View style={{ minWidth: 900 }}>
              <View style={{ flexDirection: 'row', backgroundColor: '#E0F2FE', borderRadius: 8, padding: 11 }}>{[tx('তারিখ', 'Date'), tx('লেনদেন', 'Transaction'), tx('পরিমাণ', 'Amount'), tx('বাকি স্থিতি', 'Wages due'), tx('অগ্রিম বাকি', 'Advance balance')].map((label, i) => <Text key={label} style={{ flex: [1, 2.2, 1, 1, 1][i], color: '#075985', fontWeight: '800' }}>{label}</Text>)}</View>
              {!selectedLedgerWorker.stockOutLedger.length ? <Text style={{ color: '#64748B', textAlign: 'center', padding: 18 }}>{tx('কোনো স্টক আউট লেজার নেই।', 'No stock-out ledger entries yet.')}</Text> : selectedLedgerWorker.stockOutLedger.map(item => <View key={`${item.kind}-${item.id}`} style={{ minHeight: 45, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
                <Text style={{ flex: 1, color: color.text }}>{item.date}</Text><Text style={{ flex: 2.2, color: color.text }}>{item.kind === 'wage' ? `${tx('স্টক আউট মজুরি', 'Stock-out wage')} · ${n(item.quantity ?? 0)} ${tx('বস্তা', 'bags')} × ${m(item.pricePerBag ?? 0)}${item.advanceApplied ? ` · ${tx('অগ্রিম সমন্বয়', 'advance applied')}: ${m(item.advanceApplied)}` : ''}` : item.kind === 'advance' ? tx('অগ্রিম প্রদান', 'Advance paid') : tx('স্টক আউট পেমেন্ট', 'Stock-out payment')}{item.note ? ` · ${item.note}` : ''}</Text><Text style={{ flex: 1, color: item.kind === 'payment' ? '#059669' : color.text }}>{item.kind === 'payment' ? '−' : ''}{m(item.amount)}</Text><Text style={{ flex: 1, color: item.dueBalance > 0 ? '#DC2626' : '#059669' }}>{m(item.dueBalance)}</Text><Text style={{ flex: 1, color: item.advanceBalance > 0 ? '#7C3AED' : '#64748B' }}>{m(item.advanceBalance)}</Text>
              </View>)}
            </View></ScrollView>}
          </> : useCompactRows ? <View style={{ gap: 9 }}>{!(data?.labourers ?? []).length ? <Text style={{ color: '#64748B', textAlign: 'center', padding: 18 }}>{tx('কোনো শ্রমিক যোগ করা হয়নি।', 'No labourers added yet.')}</Text> : (data?.labourers ?? []).map(worker => <TouchableOpacity key={worker.id} accessibilityRole="button" onPress={() => setSelectedLedgerWorkerId(worker.id)} style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, gap: 9 }}>
            <Text style={{ color: color.text, fontWeight: '900', fontSize: 16 }}>{worker.name} <Text style={{ color: '#64748B', fontSize: 13 }}>›</Text></Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{[[tx('মজুরি', 'Wages'), worker.stockOutWages, '#1D4ED8'], [tx('অগ্রিম বাকি', 'Advance'), worker.stockOutAdvanceBalance, '#7C3AED'], [tx('পরিশোধিত', 'Paid'), worker.stockOutPaid, '#059669'], [tx('বাকি', 'Due'), worker.stockOutUnpaid, worker.stockOutUnpaid > 0 ? '#DC2626' : '#059669']].map(([label, value, tone]) => <View key={String(label)} style={{ flexGrow: 1, flexBasis: '45%', backgroundColor: '#F8FAFC', borderRadius: 8, padding: 9 }}><Text style={{ color: '#64748B', fontSize: 12 }}>{label}</Text><Text style={{ color: tone as string, fontWeight: '900', marginTop: 3 }}>{m(Number(value))}</Text></View>)}</View>
          </TouchableOpacity>)}</View> : <ScrollView horizontal showsHorizontalScrollIndicator><View style={{ minWidth: 900 }}>
            <View style={{ flexDirection: 'row', backgroundColor: '#E0F2FE', borderRadius: 8, padding: 11 }}>{[tx('শ্রমিকের নাম', 'Labourer'), tx('স্টক আউট মজুরি', 'Stock-out wages'), tx('অগ্রিম বাকি', 'Advance balance'), tx('পরিশোধিত', 'Paid'), tx('বাকি', 'Balance due')].map((label, i) => <Text key={label} style={{ flex: [1.5, 1, 1, 1, 1][i], color: '#075985', fontWeight: '800' }}>{label}</Text>)}</View>
            {(data?.labourers ?? []).map(worker => <TouchableOpacity key={worker.id} accessibilityRole="button" onPress={() => setSelectedLedgerWorkerId(worker.id)} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}><Text style={{ flex: 1.5, color: color.text, fontWeight: '700' }}>{worker.name}</Text><Text style={{ flex: 1, color: color.text }}>{m(worker.stockOutWages)}</Text><Text style={{ flex: 1, color: '#7C3AED' }}>{m(worker.stockOutAdvanceBalance)}</Text><Text style={{ flex: 1, color: '#059669' }}>{m(worker.stockOutPaid)}</Text><Text style={{ flex: 1, color: worker.stockOutUnpaid > 0 ? '#DC2626' : '#059669', fontWeight: '800' }}>{m(worker.stockOutUnpaid)}</Text></TouchableOpacity>)}
          </View></ScrollView>}
        </View> : useCompactRows ? <View style={{ gap: 10 }}>{loading ? <ActivityIndicator color={color.primary} style={{ padding: 18 }} /> : !selectedOperation.entries.length ? <Text style={{ color: '#64748B', textAlign: 'center', padding: 20 }}>{tx('এই হিসাবে এখনো কোনো খরচ নেই।', 'No costs recorded in this account yet.')}</Text> : selectedOperation.entries.map((entry, index) => <View key={`${entry.id}-${index}`} style={{ backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 12, padding: 12, gap: 8 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}><Text style={{ color: '#64748B', fontWeight: '700' }}>{entry.date}</Text><Text style={{ color: color.text, fontWeight: '900' }}>{m(entry.amount)}</Text></View>
          <Text style={{ color: color.text, fontWeight: '800' }}>{activeOperation === 'transport' ? entry.vendorName ?? entry.workerName ?? '—' : entry.workerName ?? entry.vendorName ?? (entry.source === 'purchase' ? tx('ক্রয় ইনভয়েস', 'Purchase invoice') : '—')}</Text>
          {entry.invoiceNo || entry.voucherNo ? <Text style={{ color: '#64748B' }}>{entry.invoiceNo ?? entry.voucherNo}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Text style={{ color: '#059669' }}>{tx('পরিশোধিত', 'Paid')}: {m(entry.paid)}</Text><Text style={{ color: entry.unpaid > 0 ? '#DC2626' : '#059669', fontWeight: '800' }}>{tx('বাকি', 'Unpaid')}: {m(entry.unpaid)}</Text></View>
        </View>)}</View> : <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ minWidth: activeOperation === 'transport' ? 1050 : 950, width: '100%' }}>
            <View style={{ flexDirection: 'row', backgroundColor: '#E0F2FE', borderRadius: 8, padding: 11 }}>
              {[
                tx('তারিখ', 'Date'),
                activeOperation === 'transport' ? tx('পরিবহন বিক্রেতা', 'Transport Vendor') : tx('লেনদেন/শ্রমিক', 'Transaction / Labourer'),
                tx('ইনভয়েস/ভাউচার', 'Invoice / Voucher'), tx('খরচ', 'Cost'), tx('পরিশোধিত', 'Paid'), tx('বাকি', 'Unpaid'),
              ].map((label, index) => <Text key={label} style={{ flex: [0.9, 1.4, 1.3, 1, 1, 1][index], color: '#075985', fontWeight: '800' }}>{label}</Text>)}
            </View>
            {loading ? <ActivityIndicator color={color.primary} style={{ padding: 18 }} /> : !selectedOperation.entries.length ? <Text style={{ color: '#64748B', textAlign: 'center', padding: 20 }}>{tx('এই হিসাবে এখনো কোনো খরচ নেই।', 'No costs recorded in this account yet.')}</Text> : selectedOperation.entries.map((entry, index) => <View key={`${entry.id}-${index}`} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
              <Text style={{ flex: 0.9, color: color.text }}>{entry.date}</Text>
              <Text style={{ flex: 1.4, color: color.text, fontWeight: '700' }}>{activeOperation === 'transport' ? entry.vendorName ?? entry.workerName ?? '—' : entry.workerName ?? entry.vendorName ?? (entry.source === 'purchase' ? tx('ক্রয় ইনভয়েস', 'Purchase invoice') : '—')}</Text>
              <Text style={{ flex: 1.3, color: color.text }}>{entry.invoiceNo ?? entry.voucherNo ?? '—'}</Text>
              <Text style={{ flex: 1, color: color.text, fontWeight: '800' }}>{m(entry.amount)}</Text>
              <Text style={{ flex: 1, color: '#059669' }}>{m(entry.paid)}</Text>
              <Text style={{ flex: 1, color: entry.unpaid > 0 ? '#DC2626' : '#059669', fontWeight: '700' }}>{m(entry.unpaid)}</Text>
            </View>)}
          </View>
        </ScrollView>}
      </Card>}
    </ScrollView>
    <Modal visible={calendarOpen} transparent animationType="fade" onRequestClose={() => setCalendarOpen(false)}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.48)', padding: 16 }}>
        <View style={{ width: '100%', maxWidth: 380, backgroundColor: '#fff', borderRadius: 16, padding: 16 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={tx('আগের মাস', 'Previous month')} onPress={() => setCalendarMonth(month => new Date(month.getFullYear(), month.getMonth() - 1, 1))} style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#F1F5F9' }}><Text style={{ color: color.text, fontSize: 24, fontWeight: '800' }}>‹</Text></TouchableOpacity>
            <Text style={{ color: color.text, fontSize: 17, fontWeight: '900' }}>{calendarMonthLabel}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityLabel={tx('পরের মাস', 'Next month')} onPress={() => setCalendarMonth(month => new Date(month.getFullYear(), month.getMonth() + 1, 1))} style={{ width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#F1F5F9' }}><Text style={{ color: color.text, fontSize: 24, fontWeight: '800' }}>›</Text></TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginBottom: 4 }}>
            {calendarWeekdays.map(day => <View key={day} style={{ width: '14.285%', minHeight: 34, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#64748B', fontSize: 12, fontWeight: '800' }}>{day}</Text></View>)}
            {calendarCells.map((day, index) => {
              if (day === null) return <View key={`blank-${index}`} style={{ width: '14.285%', height: 44 }} />;
              const key = calendarDateKey(day);
              const selected = activeCalendarDate === key;
              const isToday = todayDhaka() === key;
              return <View key={key} style={{ width: '14.285%', height: 44, padding: 2 }}><TouchableOpacity accessibilityRole="button" accessibilityState={{ selected }} onPress={() => { if (calendarTarget === 'from') setSaleDateFrom(key); else if (calendarTarget === 'to') setSaleDateTo(key); else setAttendanceMonth(key.slice(0, 7)); setCalendarOpen(false); }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: selected ? color.primary : isToday ? '#E0F2FE' : 'transparent', borderWidth: isToday && !selected ? 1 : 0, borderColor: '#7DD3FC' }}><Text style={{ color: selected ? '#fff' : color.text, fontWeight: selected || isToday ? '900' : '500' }}>{n(day)}</Text></TouchableOpacity></View>;
            })}
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
            <TouchableOpacity accessibilityRole="button" onPress={() => { if (calendarTarget === 'from') setSaleDateFrom(''); else if (calendarTarget === 'to') setSaleDateTo(''); else setAttendanceMonth(todayDhaka().slice(0, 7)); setCalendarOpen(false); }} style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#F1F5F9' }}><Text style={{ color: color.text, fontWeight: '700' }}>{calendarTarget === 'attendance' ? tx('এই মাস', 'This month') : tx('তারিখ মুছুন', 'Clear date')}</Text></TouchableOpacity>
            <TouchableOpacity accessibilityRole="button" onPress={() => setCalendarOpen(false)} style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#E2E8F0' }}><Text style={{ color: color.text, fontWeight: '700' }}>{tx('বন্ধ', 'Close')}</Text></TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
    <Modal visible={ratesConfigOpen} transparent animationType="fade" onRequestClose={() => setRatesConfigOpen(false)}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.48)', padding: 12 }}>
        <View style={{ width: '100%', maxWidth: 900, maxHeight: '95%', backgroundColor: '#F8FAFC', borderRadius: 16, padding: isMobile ? 13 : 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12 }}>
            <Text style={{ flex: 1, fontSize: 20, fontWeight: '900', color: color.text }}>{tx('বস্তার পরিবহন দর', 'Bag Transport Rates')}</Text>
            <TouchableOpacity accessibilityRole="button" onPress={() => setRatesConfigOpen(false)} style={{ minHeight: 40, justifyContent: 'center', paddingHorizontal: 12, borderRadius: 8, backgroundColor: '#E2E8F0' }}><Text style={{ color: color.text, fontWeight: '800' }}>{tx('বন্ধ', 'Close')}</Text></TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 4 }}>
            <View style={{ backgroundColor: '#fff', borderRadius: 12, padding: 13, borderWidth: 1, borderColor: '#CBD5E1', gap: 8 }}>
              <Text style={{ color: color.text, fontSize: 15, fontWeight: '900' }}>{tx('বস্তাপ্রতি পরিবহন দর সেট করুন (৳)', 'Configure Transport Rate per Bag (৳)')}</Text>
              <Text style={{ color: '#64748B', fontSize: 12 }}>{tx('ওজন অনুযায়ী প্রতি বস্তার দর দিন। উদাহরণ: ৫০ কেজি = ৬ টাকা, ২৫ কেজি = ৩ টাকা।', 'Set the transport rate per bag by weight. Example: 50 kg = ৳6, 25 kg = ৳3.')}</Text>
              {user.role !== 'admin' ? <Text style={{ color: '#B45309', fontSize: 12 }}>{tx('দর পরিবর্তন করতে প্রশাসক অ্যাকাউন্ট ব্যবহার করুন।', 'Use an administrator account to change rates.')}</Text> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {configuredBagWeights.map(weight => <View key={weight} style={{ flexGrow: 1, minWidth: isMobile ? '100%' : 220, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: 9, backgroundColor: '#F8FAFC', borderRadius: 9, borderWidth: 1, borderColor: '#E2E8F0' }}>
                  <Text style={{ color: color.text, fontWeight: '800' }}>{n(weight)} kg {tx('বস্তা', 'bag')}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}><Text style={{ color: '#64748B', fontSize: 12 }}>{tx('দর', 'Rate')}</Text><TextInput editable={user.role === 'admin'} accessibilityLabel={`${weight} kg bag transport rate`} keyboardType="decimal-pad" value={ratesDraft[String(weight)] ?? ''} onChangeText={value => { setRatesDraft(current => ({ ...current, [String(weight)]: value })); setRatesSaved(false); }} placeholder="0" style={{ width: 90, height: 40, paddingHorizontal: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, color: color.text, textAlign: 'right', fontWeight: '800' }} /></View>
                </View>)}
              </View>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end', gap: 8 }}>
                <View style={{ flex: 1, minWidth: 120 }}><Text style={{ color: '#64748B', fontSize: 12, marginBottom: 4 }}>{tx('নতুন বস্তার ওজন (কেজি)', 'New bag weight (kg)')}</Text><TextInput editable={user.role === 'admin'} keyboardType="decimal-pad" value={newRateWeight} onChangeText={setNewRateWeight} placeholder="e.g. 40" style={{ height: 40, paddingHorizontal: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, color: color.text }} /></View>
                <View style={{ flex: 1, minWidth: 120 }}><Text style={{ color: '#64748B', fontSize: 12, marginBottom: 4 }}>{tx('পরিবহন দর (৳/বস্তা)', 'Transport rate (৳/bag)')}</Text><TextInput editable={user.role === 'admin'} keyboardType="decimal-pad" value={newRateAmount} onChangeText={setNewRateAmount} placeholder="e.g. 5" style={{ height: 40, paddingHorizontal: 10, backgroundColor: '#fff', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, color: color.text }} /></View>
                <Btn kind="ghost" label={tx('দর যোগ করুন', 'Add Rate')} onPress={addRate} />
                <Btn label={savingRates ? tx('সংরক্ষণ হচ্ছে…', 'Saving…') : tx('দর সংরক্ষণ', 'Save Rates')} onPress={() => { if (!savingRates) void saveRates(); }} />
              </View>
              {ratesError ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 9, borderRadius: 8 }}>{ratesError}</Text> : null}
              {ratesSaved ? <Text style={{ color: '#047857', fontWeight: '700' }}>{tx('পরিবহন দর সংরক্ষিত হয়েছে', 'Transport rates saved')}</Text> : null}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
    <Modal visible={advanceOpen} transparent animationType="fade" onRequestClose={() => setAdvanceOpen(false)}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.48)', padding: 16 }}>
        <View style={{ width: '100%', maxWidth: 500, maxHeight: '92%', backgroundColor: '#F8FAFC', borderRadius: 16, padding: isMobile ? 14 : 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '900', color: color.text, marginBottom: 12 }}>{tx('অগ্রিম রেকর্ড করুন', 'Record Advance')} · {selectedLabel}</Text>
          <Field label={tx('তারিখ', 'Date')} value={landingPayDate} onChange={setLandingPayDate} required />
          <Field label={tx('অগ্রিমের পরিমাণ', 'Advance amount')} value={advanceAmount} onChange={setAdvanceAmount} num required />
          <Field label={tx('বিবরণ', 'Description')} value={landingPayDescription} onChange={setLandingPayDescription} />
          <Text style={{ color: '#475569', marginBottom: 6, fontWeight: '700' }}>{tx('ক্যাশ/ব্যাংক অ্যাকাউন্ট', 'Cash/Bank Account')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>{activeAccounts.map(account => <TouchableOpacity key={account.id} onPress={() => setAccountId(account.id)} style={{ padding: 9, borderRadius: 9, borderWidth: 1, borderColor: account.id === accountId ? color.primary : '#CBD5E1', backgroundColor: account.id === accountId ? '#EAF3FC' : '#fff' }}><Text style={{ color: color.text, fontWeight: '700' }}>{account.name}</Text></TouchableOpacity>)}</View>
          {error ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 9, borderRadius: 8, marginBottom: 10 }}>{error}</Text> : null}
          {!activeAccounts.length ? <Text style={{ color: '#B91C1C', marginBottom: 12 }}>{tx('আগে একটি সক্রিয় ক্যাশ বা ব্যাংক অ্যাকাউন্ট তৈরি করুন।', 'Create an active cash or bank account first.')}</Text> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}><Btn kind="ghost" label={tx('বাতিল', 'Cancel')} onPress={() => setAdvanceOpen(false)} /><Btn label={busy ? tx('সংরক্ষণ হচ্ছে…', 'Saving…') : tx('অগ্রিম সংরক্ষণ করুন', 'Save Advance')} onPress={() => { if (!busy) void submitAdvance(); }} /></View>
        </View>
      </View>
    </Modal>
    <Modal visible={paymentOpen} transparent animationType="fade" onRequestClose={() => setPaymentOpen(false)}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.48)', padding: 16 }}>
        <View style={{ width: '100%', maxWidth: 500, maxHeight: '92%', backgroundColor: '#F8FAFC', borderRadius: 16, padding: isMobile ? 14 : 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '900', color: color.text, marginBottom: 12 }}>{tx('সমষ্টিগত বকেয়া পরিশোধ', 'Pay collective balance')} · {selectedLabel}</Text>
          <Field label={tx('তারিখ', 'Date')} value={landingPayDate} onChange={setLandingPayDate} required />
          <Text style={{ color: '#64748B', marginBottom: 12 }}>{tx('মোট বকেয়া', 'Total unpaid')}: {m(selectedOperation.unpaid)}</Text>
          {activeOperation === 'stockOutLabour' ? <>
            <Text style={{ color: '#475569', marginBottom: 6, fontWeight: '700' }}>{tx('বণ্টনের ধরন', 'Allocation type')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
              {([['wage', tx('মজুরি পরিশোধ', 'Wage payment')], ['advance', tx('অগ্রিম প্রদান', 'Pay advance')]] as const).map(([kind, label]) => <TouchableOpacity key={kind} onPress={() => { setLabourAllocationKind(kind); setSelectedLabourerIds([]); setError(''); }} style={{ flex: 1, minHeight: 42, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 10, borderRadius: 9, borderWidth: 1, borderColor: labourAllocationKind === kind ? color.primary : '#CBD5E1', backgroundColor: labourAllocationKind === kind ? '#EAF3FC' : '#fff' }}><Text style={{ color: color.text, fontWeight: '800' }}>{label}</Text></TouchableOpacity>)}
            </View>
            <Text style={{ color: '#475569', marginBottom: 6, fontWeight: '700' }}>{labourAllocationKind === 'advance' ? tx('অগ্রিমের শ্রমিক নির্বাচন করুন — সমান ভাগ হবে', 'Select labourers for an equal advance split') : tx('মজুরির শ্রমিক নির্বাচন করুন — পেমেন্ট সমান ভাগ হবে', 'Select labourers — wage payment will be split equally')}</Text>
            <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: labourDropdownOpen }} onPress={() => setLabourDropdownOpen(open => !open)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: labourDropdownOpen ? 0 : 10, backgroundColor: '#fff', borderWidth: 1, borderColor: labourDropdownOpen ? color.primary : '#CBD5E1', borderRadius: 9 }}>
              <Text numberOfLines={1} style={{ flex: 1, color: selectedLabourerIds.length ? color.text : '#64748B', fontWeight: '700' }}>{selectedLabourerIds.length ? (data?.labourers ?? []).filter(worker => selectedLabourerIds.includes(worker.id)).map(worker => worker.name).join(', ') : tx('শ্রমিক নির্বাচন করুন', 'Select labourers')}</Text>
              <Text style={{ marginLeft: 10, color: '#475569', fontSize: 18, fontWeight: '800' }}>{labourDropdownOpen ? '⌃' : '⌄'}</Text>
            </TouchableOpacity>
            {labourDropdownOpen ? <View style={{ maxHeight: 180, marginBottom: 10, backgroundColor: '#fff', borderColor: '#CBD5E1', borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, overflow: 'hidden' }}>
              <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
                {(data?.labourers ?? []).map(worker => {
                  const selected = selectedLabourerIds.includes(worker.id);
                  const eligible = labourAllocationKind === 'advance' || worker.stockOutUnpaid > 0;
                  const balanceLabel = labourAllocationKind === 'advance' ? `${tx('অগ্রিম বাকি', 'Advance balance')}: ${m(worker.stockOutAdvanceBalance)}` : eligible ? `${tx('মজুরি বাকি', 'Wages due')}: ${m(worker.stockOutUnpaid)}` : tx('মজুরি বাকি নেই', 'No wages due');
                  return <TouchableOpacity key={worker.id} disabled={!eligible} accessibilityRole="checkbox" accessibilityState={{ checked: selected, disabled: !eligible }} onPress={() => setSelectedLabourerIds(current => selected ? current.filter(id => id !== worker.id) : [...current, worker.id])} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: selected ? '#EFF6FF' : '#fff', opacity: eligible ? 1 : 0.55 }}><Text style={{ color: color.text, fontWeight: selected ? '800' : '600' }}>{worker.name}</Text><Text style={{ color: '#64748B' }}>{balanceLabel}{selected ? '  ✓' : ''}</Text></TouchableOpacity>;
                })}
                {!(data?.labourers ?? []).length ? <Text style={{ color: '#64748B', padding: 12 }}>{tx('শ্রমিক হিসাব থেকে আগে শ্রমিক যোগ করুন।', 'Add labourers in Labour Account first.')}</Text> : null}
              </ScrollView>
            </View> : null}
            {selectedLabourerIds.length ? <Text style={{ color: '#64748B', marginBottom: 10 }}>{labourAllocationKind === 'advance' ? tx('প্রতি শ্রমিকের অগ্রিম', 'Advance per labourer') : tx('প্রতি শ্রমিকের পেমেন্ট', 'Payment per labourer')}: {m(Number(landingPayAmount || 0) / selectedLabourerIds.length)}</Text> : null}
          </> : null}
          {error ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 9, borderRadius: 8, marginBottom: 10 }}>{error}</Text> : null}
          <Field label={tx('পেমেন্টের পরিমাণ', 'Payment amount')} value={landingPayAmount} onChange={setLandingPayAmount} num required />
          <Field label={tx('বিবরণ', 'Description')} value={landingPayDescription} onChange={setLandingPayDescription} />
          <Text style={{ color: '#475569', marginBottom: 6, fontWeight: '700' }}>{tx('ক্যাশ/ব্যাংক অ্যাকাউন্ট', 'Cash/Bank Account')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>{activeAccounts.map(account => <TouchableOpacity key={account.id} onPress={() => setAccountId(account.id)} style={{ padding: 9, borderRadius: 9, borderWidth: 1, borderColor: account.id === accountId ? color.primary : '#CBD5E1', backgroundColor: account.id === accountId ? '#EAF3FC' : '#fff' }}><Text style={{ color: color.text, fontWeight: '700' }}>{account.name}</Text></TouchableOpacity>)}</View>
          {!activeAccounts.length ? <Text style={{ color: '#B91C1C', marginBottom: 12 }}>{tx('আগে একটি সক্রিয় ক্যাশ বা ব্যাংক অ্যাকাউন্ট তৈরি করুন।', 'Create an active cash or bank account first.')}</Text> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}><Btn kind="ghost" label={tx('বাতিল', 'Cancel')} onPress={() => setPaymentOpen(false)} /><Btn label={busy ? tx('সংরক্ষণ হচ্ছে…', 'Saving…') : tx('পেমেন্ট রেকর্ড করুন', 'Record Payment')} onPress={() => { if (!busy) void submitPayment(); }} /></View>
        </View>
      </View>
    </Modal>
    <Modal visible={addLabourOpen} transparent animationType="fade" onRequestClose={() => setAddLabourOpen(false)}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.48)', padding: 16 }}>
        <View style={{ width: '100%', maxWidth: 440, backgroundColor: '#F8FAFC', borderRadius: 16, padding: 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '900', color: color.text, marginBottom: 12 }}>{tx('শ্রমিক যোগ করুন', 'Add Labourer')}</Text>
          <Field label={tx('শ্রমিকের নাম', 'Labourer name')} value={newLabourName} onChange={setNewLabourName} required />
          {error ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 9, borderRadius: 8, marginBottom: 10 }}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}><Btn kind="ghost" label={tx('বাতিল', 'Cancel')} onPress={() => setAddLabourOpen(false)} /><Btn label={busy ? tx('সংরক্ষণ হচ্ছে…', 'Saving…') : tx('শ্রমিক সংরক্ষণ করুন', 'Save Labourer')} onPress={() => { if (!busy) void submitAddLabourer(); }} /></View>
        </View>
      </View>
    </Modal>
  </View>;
}
