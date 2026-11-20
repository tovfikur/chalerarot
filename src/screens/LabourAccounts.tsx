import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { api, LabourAccountsData } from '../api';
import { useApp } from '../store';
import { icons } from '../icons';
import { Btn, Card, color, Field, SectionHead, useMoney, useNum } from '../ui';
import { useBreakpoint } from '../responsive';

const todayDhaka = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

export function LabourAccounts() {
  const { lang, moneyAccounts, refresh } = useApp();
  const bn = lang === 'bn';
  const m = useMoney();
  const n = useNum();
  const { width, isMobile } = useBreakpoint();
  const useCompactRows = width < 960;
  const [data, setData] = useState<LabourAccountsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeOperation, setActiveOperation] = useState<'transport' | 'stockInLabour' | 'stockOutLabour' | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [addLabourOpen, setAddLabourOpen] = useState(false);
  const [addWageOpen, setAddWageOpen] = useState(false);
  const [wageBags, setWageBags] = useState('');
  const [wageRate, setWageRate] = useState('6');
  const [wageLabourerIds, setWageLabourerIds] = useState<string[]>([]);
  const [wageDate, setWageDate] = useState(todayDhaka());
  const [wageNote, setWageNote] = useState('');
  const [wageDropdownOpen, setWageDropdownOpen] = useState(false);
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
  const tx = (bnText: string, enText: string) => bn ? bnText : enText;
  const activeAccounts = useMemo(() => moneyAccounts.filter(a => a.active), [moneyAccounts]);
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
  const openAddWage = () => {
    setWageLabourerIds([]); setWageBags(''); setWageRate('6'); setWageDate(todayDhaka()); setWageNote(''); setWageDropdownOpen(false); setError(''); setAddWageOpen(true);
  };
  const submitAddWage = async () => {
    const quantity = Number(wageBags);
    const pricePerBag = Number(wageRate);
    if (!wageLabourerIds.length || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(pricePerBag) || pricePerBag <= 0 || !wageDate) { setError(tx('তারিখ, বস্তার পরিমাণ, প্রতি বস্তার মজুরি ও অন্তত একজন শ্রমিক নির্বাচন করুন।', 'Enter the date, bag count, wage per bag, and select at least one labourer.')); return; }
    setBusy(true);
    try {
      await api.createStockOutWages({ date: wageDate, quantity, pricePerBag, labourerIds: wageLabourerIds, note: wageNote.trim() || undefined });
      setAddWageOpen(false); setError(''); await refresh(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : tx('মজুরি যোগ করা যায়নি।', 'Could not add stock-out wages.')); }
    finally { setBusy(false); }
  };
  const operationCards = [
    { id: 'transport' as const, label: tx('পরিবহন খরচ', 'Transport Expenses'), recordsLabel: tx('পরিবহন খরচের রেকর্ড', 'Transport Expense Records'), color: '#0369A1' },
    { id: 'stockInLabour' as const, label: tx('স্টক ইন খরচ', 'Stock In Cost'), recordsLabel: tx('স্টক ইন রেকর্ড', 'Stock In Records'), color: '#047857' },
    { id: 'stockOutLabour' as const, label: tx('স্টক আউট খরচ', 'Stock Out Cost'), recordsLabel: tx('স্টক আউট রেকর্ড', 'Stock Out Records'), color: '#7C3AED' },
  ];
  const selectedOperation = data?.operations?.[activeOperation ?? 'transport'] ?? { total: 0, paid: 0, unpaid: 0, entries: [] };
  const selectedLabel = operationCards.find(card => card.id === activeOperation)?.label ?? '';
  const selectedLedgerWorker = data?.labourers.find(worker => worker.id === selectedLedgerWorkerId) ?? null;
  const wageTotal = Math.round((Number(wageBags) || 0) * (Number(wageRate) || 0) * 100) / 100;
  return <View style={{ flex: 1, backgroundColor: 'transparent' }}>
    <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 1200, alignSelf: 'center', padding: isMobile ? 12 : 20, gap: 14, paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        {activeOperation ? <TouchableOpacity accessibilityRole="button" onPress={() => { if (selectedLedgerWorkerId) setSelectedLedgerWorkerId(null); else if (showStockOutLabourAccount) setShowStockOutLabourAccount(false); else setActiveOperation(null); setError(''); }} style={{ minHeight: 42, justifyContent: 'center', paddingHorizontal: 14, backgroundColor: '#E2E8F0', borderRadius: 9 }}><Text style={{ color: color.text, fontWeight: '800' }}>{tx('ফিরে যান', 'Back')}</Text></TouchableOpacity> : null}
        <View style={{ flex: 1, minWidth: 180 }}><SectionHead icon={icons.vendors}>{selectedLedgerWorker ? `${selectedLedgerWorker.name} · ${tx('স্টক আউট শ্রমিক লেজার', 'Stock-out Labour Ledger')}` : showStockOutLabourAccount ? tx('শ্রমিক হিসাব', 'Labour Account') : activeOperation ? operationCards.find(card => card.id === activeOperation)?.recordsLabel : tx('ল্যান্ডিং খরচের হিসাব', 'Landing Cost System')}</SectionHead></View>
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 9, padding: 10 }}>{error}</Text> : null}
      {!activeOperation ? <View style={{ gap: 10 }}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {operationCards.map(card => {
            const operation = data?.operations?.[card.id] ?? { total: 0, paid: 0, unpaid: 0, entries: [] };
            return <TouchableOpacity key={card.id} accessibilityRole="button" onPress={() => { setActiveOperation(card.id); setError(''); }} style={{ flex: 1, minWidth: useCompactRows ? '100%' : 220, backgroundColor: '#fff', borderRadius: 13, padding: isMobile ? 14 : 18, borderWidth: 1, borderColor: '#E2E8F0', shadowColor: '#0F172A', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 2 }}>
              <Text style={{ color: card.color, fontWeight: '800' }}>{card.label}</Text>
              <Text style={{ color: color.text, fontSize: isMobile ? 20 : 22, fontWeight: '900', marginTop: 8 }}>{m(operation.total)}</Text>
              <Text style={{ color: '#64748B', marginTop: 5 }}>{tx('বাকি', 'Unpaid')}: <Text style={{ color: operation.unpaid > 0 ? '#DC2626' : '#059669', fontWeight: '800' }}>{m(operation.unpaid)}</Text></Text>
              <Text style={{ color: '#64748B', marginTop: 2 }}>{tx('পরিশোধিত', 'Paid')}: {m(operation.paid)}</Text>
            </TouchableOpacity>;
          })}
        </View>
        <Btn kind="ghost" label={tx('শ্রমিক হিসাব', 'Labour Account')} onPress={() => { setActiveOperation('stockOutLabour'); setShowStockOutLabourAccount(true); setSelectedLedgerWorkerId(null); setError(''); }} />
      </View> : <Card style={{ padding: 14 }}>
        {activeOperation && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
          {[
            [tx('মোট খরচ', 'Total Cost'), selectedOperation.total, '#1D4ED8'],
            [tx('পরিশোধিত', 'Paid'), selectedOperation.paid, '#059669'],
            [tx('বাকি', 'Unpaid'), selectedOperation.unpaid, '#DC2626'],
          ].map(([label, value, tone]) => <View key={String(label)} style={{ flexGrow: 1, minWidth: useCompactRows ? 105 : 150, backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: isMobile ? 9 : 12 }}><Text style={{ color: '#64748B', fontWeight: '700' }}>{label}</Text><Text style={{ color: tone as string, fontWeight: '900', fontSize: 17, marginTop: 4 }}>{m(Number(value))}</Text></View>)}
        </View>}
        {activeOperation === 'stockOutLabour' && !showStockOutLabourAccount ? <Btn kind="ghost" label={tx('শ্রমিক হিসাব', 'Labour Account')} onPress={() => { setShowStockOutLabourAccount(true); setSelectedLedgerWorkerId(null); }} /> : null}
        {showStockOutLabourAccount && !selectedLedgerWorker ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Btn kind="ghost" label={tx('শ্রমিক যোগ করুন', 'Add Labourer')} onPress={() => { setNewLabourName(''); setAddLabourOpen(true); setError(''); }} /><Btn label={tx('স্টক আউট মজুরি যোগ করুন', 'Add Stock-out Wages')} onPress={openAddWage} /></View> : null}
        {!showStockOutLabourAccount && selectedOperation.unpaid > 0 ? <Btn label={`${tx('সমষ্টিগত বকেয়া পরিশোধ', 'Pay collective balance')} · ${m(selectedOperation.unpaid)}`} onPress={openPayment} /> : null}
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
    <Modal visible={addWageOpen} transparent animationType="fade" onRequestClose={() => setAddWageOpen(false)}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.48)', padding: 16 }}>
        <View style={{ width: '100%', maxWidth: 500, maxHeight: '92%', backgroundColor: '#F8FAFC', borderRadius: 16, padding: 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '900', color: color.text, marginBottom: 12 }}>{tx('স্টক আউট মজুরি যোগ করুন', 'Add Stock-out Wages')}</Text>
          <Field label={tx('তারিখ', 'Date')} value={wageDate} onChange={setWageDate} required />
          <Field label={tx('বস্তার সংখ্যা', 'Number of bags')} value={wageBags} onChange={setWageBags} num required />
          <Field label={tx('প্রতি বস্তার মজুরি', 'Wage per bag')} value={wageRate} onChange={setWageRate} num required />
          <Text style={{ color: '#475569', marginBottom: 6, fontWeight: '700' }}>{tx('শ্রমিক নির্বাচন করুন — বস্তা ও মজুরি সমান ভাগ হবে', 'Select labourers — bags and wages will be split equally')}</Text>
          <TouchableOpacity accessibilityRole="button" accessibilityState={{ expanded: wageDropdownOpen }} onPress={() => setWageDropdownOpen(open => !open)} style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, marginBottom: wageDropdownOpen ? 0 : 10, backgroundColor: '#fff', borderWidth: 1, borderColor: wageDropdownOpen ? color.primary : '#CBD5E1', borderRadius: 9 }}><Text numberOfLines={1} style={{ flex: 1, color: wageLabourerIds.length ? color.text : '#64748B', fontWeight: '700' }}>{wageLabourerIds.length ? (data?.labourers ?? []).filter(worker => wageLabourerIds.includes(worker.id)).map(worker => worker.name).join(', ') : tx('শ্রমিক নির্বাচন করুন', 'Select labourers')}</Text><Text style={{ color: '#475569', fontSize: 18, fontWeight: '800' }}>{wageDropdownOpen ? '⌃' : '⌄'}</Text></TouchableOpacity>
          {wageDropdownOpen ? <View style={{ maxHeight: 150, marginBottom: 10, backgroundColor: '#fff', borderColor: '#CBD5E1', borderWidth: 1, borderTopWidth: 0, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, overflow: 'hidden' }}><ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">{(data?.labourers ?? []).map(worker => {
            const selected = wageLabourerIds.includes(worker.id);
            return <TouchableOpacity key={worker.id} accessibilityRole="checkbox" accessibilityState={{ checked: selected }} onPress={() => setWageLabourerIds(current => selected ? current.filter(id => id !== worker.id) : [...current, worker.id])} style={{ minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: selected ? '#EFF6FF' : '#fff' }}><Text style={{ color: color.text, fontWeight: selected ? '800' : '500' }}>{worker.name}</Text><Text style={{ color: '#64748B' }}>{selected ? '✓' : ''}</Text></TouchableOpacity>;
          })}</ScrollView></View> : null}
          {!data?.labourers.length ? <View style={{ marginBottom: 10 }}><Text style={{ color: '#64748B', marginBottom: 8 }}>{tx('আগে শ্রমিক যোগ করুন।', 'Add a labourer first.')}</Text><Btn kind="ghost" label={tx('শ্রমিক যোগ করুন', 'Add Labourer')} onPress={() => { setAddWageOpen(false); setAddLabourOpen(true); }} /></View> : null}
          <Text style={{ color: '#64748B', marginBottom: 10, fontWeight: '700' }}>{tx('মোট মজুরি', 'Total wages')}: {m(wageTotal)}{wageLabourerIds.length ? ` · ${tx('প্রতি শ্রমিক', 'per labourer')}: ${m(wageTotal / wageLabourerIds.length)}` : ''}</Text>
          <Field label={tx('বিবরণ', 'Description')} value={wageNote} onChange={setWageNote} />
          {error ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 9, borderRadius: 8, marginBottom: 10 }}>{error}</Text> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}><Btn kind="ghost" label={tx('বাতিল', 'Cancel')} onPress={() => setAddWageOpen(false)} /><Btn label={busy ? tx('সংরক্ষণ হচ্ছে…', 'Saving…') : tx('মজুরি সংরক্ষণ করুন', 'Save Wages')} onPress={() => { if (!busy) void submitAddWage(); }} /></View>
        </View>
      </View>
    </Modal>
  </View>;
}
