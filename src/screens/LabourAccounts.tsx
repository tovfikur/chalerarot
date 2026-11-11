import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Platform, ScrollView, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, LabourAccountsData, LabourAccountRow } from '../api';
import { useApp } from '../store';
import { AppIcon, icons } from '../icons';
import { Btn, Card, color, Field, SectionHead, useMoney, useNum } from '../ui';

const todayDhaka = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date());

export function LabourAccounts() {
  const { lang, moneyAccounts } = useApp();
  const bn = lang === 'bn';
  const m = useMoney();
  const n = useNum();
  const [data, setData] = useState<LabourAccountsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [payWorker, setPayWorker] = useState<LabourAccountRow | null>(null);
  const [advanceWorker, setAdvanceWorker] = useState<LabourAccountRow | null>(null);
  const [ledgerWorker, setLedgerWorker] = useState<LabourAccountRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [labourNamePickerOpen, setLabourNamePickerOpen] = useState(false);
  const [price, setPrice] = useState('6');
  const [quantity, setQuantity] = useState('');
  const [direction, setDirection] = useState<'stockIn' | 'stockOut'>('stockIn');
  const [date, setDate] = useState(todayDhaka());
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(todayDhaka());
  const [accountId, setAccountId] = useState('');
  const [advanceAmount, setAdvanceAmount] = useState('');
  const [advanceDate, setAdvanceDate] = useState(todayDhaka());
  const tx = (bnText: string, enText: string) => bn ? bnText : enText;
  const activeAccounts = useMemo(() => moneyAccounts.filter(a => a.active), [moneyAccounts]);
  const load = useCallback(async () => {
    try { setError(''); setData(await api.labourAccounts()); }
    catch (e) { setError(e instanceof Error ? e.message : tx('তথ্য লোড করা যায়নি।', 'Could not load labour accounts.')); }
    finally { setLoading(false); }
  }, [lang]);
  useEffect(() => { void load(); }, [load]);
  const resetForm = () => { setName(''); setPrice('6'); setQuantity(''); setDirection('stockIn'); setDate(todayDhaka()); };
  const submitCost = async () => {
    const parsedPrice = Number(price), parsedQty = Number(quantity);
    if (!name.trim() || !Number.isFinite(parsedPrice) || parsedPrice < 0 || !Number.isFinite(parsedQty) || parsedQty <= 0 || !date) {
      setError(tx('শ্রমিকের নাম, সঠিক দর, পরিমাণ ও তারিখ দিন।', 'Enter a labourer name, valid rate, quantity, and date.')); return;
    }
    setBusy(true);
    try {
      await api.createLabourCost({ name: name.trim(), pricePerBag: parsedPrice, quantity: parsedQty, direction, date });
      setFormOpen(false); resetForm(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : tx('শ্রমিক খরচ সংরক্ষণ করা যায়নি।', 'Could not save labour cost.')); }
    finally { setBusy(false); }
  };
  const openPay = (worker: LabourAccountRow) => { setPayWorker(worker); setPayAmount(String(worker.unpaid)); setPayDate(todayDhaka()); setAccountId(activeAccounts.find(a => a.type === 'cash')?.id ?? activeAccounts[0]?.id ?? ''); setError(''); };
  const submitPayment = async () => {
    const parsed = Number(payAmount);
    if (!payWorker || !accountId || !Number.isFinite(parsed) || parsed <= 0 || parsed > payWorker.unpaid + 0.01) {
      setError(tx('সঠিক পরিশোধের পরিমাণ ও ক্যাশ/ব্যাংক অ্যাকাউন্ট নির্বাচন করুন।', 'Enter a valid payment amount and select a cash or bank account.')); return;
    }
    setBusy(true);
    try { await api.payLabourer(payWorker.id, { amount: parsed, accountId, date: payDate }); setPayWorker(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : tx('পরিশোধ সংরক্ষণ করা যায়নি।', 'Could not save labour payment.')); }
    finally { setBusy(false); }
  };
  const openAdvance = (worker: LabourAccountRow) => { setAdvanceWorker(worker); setAdvanceAmount(''); setAdvanceDate(todayDhaka()); setAccountId(activeAccounts.find(a => a.type === 'cash')?.id ?? activeAccounts[0]?.id ?? ''); setError(''); };
  const submitAdvance = async () => {
    const parsed = Number(advanceAmount);
    if (!advanceWorker || !accountId || !Number.isFinite(parsed) || parsed <= 0 || !advanceDate) {
      setError(tx('অগ্রিমের পরিমাণ, তারিখ ও ক্যাশ/ব্যাংক অ্যাকাউন্ট নির্বাচন করুন।', 'Enter an advance amount and date, and select a cash or bank account.')); return;
    }
    setBusy(true);
    try { await api.addLabourAdvance(advanceWorker.id, { amount: parsed, accountId, date: advanceDate }); setAdvanceWorker(null); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : tx('অগ্রিম সংরক্ষণ করা যায়নি।', 'Could not save labour advance.')); }
    finally { setBusy(false); }
  };
  const inputStyle = { minHeight: 44, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 9, paddingHorizontal: 12, backgroundColor: '#fff', color: color.text, fontSize: 16 } as const;
  const summary = data?.summary ?? { total: 0, paid: 0, unpaid: 0, advanceBalance: 0 };
  const labourSuggestions = (data?.labourers ?? []).filter(worker => !name.trim() || worker.name.toLocaleLowerCase().startsWith(name.trim().toLocaleLowerCase())).slice(0, 10);
  const cards = [
    { label: tx('মোট ল্যান্ডিং খরচের দায়', 'Total Landing Cost Payable'), value: summary.total, tone: '#1D4ED8' },
    { label: tx('ল্যান্ডিং খরচ পরিশোধ', 'Landing Cost Paid'), value: summary.paid, tone: '#059669' },
    { label: tx('ল্যান্ডিং খরচ বাকি', 'Landing Cost Unpaid'), value: summary.unpaid, tone: '#DC2626' },
  ];
  return <View style={{ flex: 1, backgroundColor: color.bg }}>
    <ScrollView contentContainerStyle={{ width: '100%', maxWidth: 1200, alignSelf: 'center', padding: 16, gap: 14, paddingBottom: 36 }} keyboardShouldPersistTaps="handled">
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
        <View style={{ flex: 1, minWidth: 180 }}><SectionHead icon={icons.vendors}>{tx('শ্রমিকের হিসাব', 'Labour Accounts')}</SectionHead></View>
        <TouchableOpacity onPress={() => { setError(''); resetForm(); setFormOpen(true); }} accessibilityRole="button" style={{ minHeight: 44, borderRadius: 10, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: color.primary }}>
          <AppIcon name={icons.add} size={20} iconColor="#fff" /><Text style={{ color: '#fff', fontWeight: '800' }}>{tx('শ্রমিক খরচ যোগ করুন', 'Add Labour Cost')}</Text>
        </TouchableOpacity>
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', backgroundColor: '#FEF2F2', borderColor: '#FECACA', borderWidth: 1, borderRadius: 9, padding: 10 }}>{error}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {cards.map((card, index) => <Card key={card.label} style={{ flex: 1, minWidth: 200, padding: 16 }}>
          <Text style={{ color: '#64748B', fontWeight: '700' }}>{card.label}</Text>
          <Text style={{ color: card.tone, fontSize: 24, fontWeight: '900', marginTop: 8 }}>{m(card.value)}</Text>
          {index === 2 && summary.advanceBalance > 0 ? <Text style={{ color: '#7C3AED', marginTop: 6 }}>{tx('সমন্বয়ের অপেক্ষায় অগ্রিম', 'Unadjusted labour advances')}: {m(summary.advanceBalance)}</Text> : null}
        </Card>)}
      </View>
      <Card style={{ padding: 14 }}>
        <Text style={{ color: color.text, fontSize: 18, fontWeight: '800', marginBottom: 12 }}>{tx('শ্রমিকভিত্তিক মজুরির হিসাব', 'Labourer Wage Summary')}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator>
          <View style={{ minWidth: 980, width: '100%' }}>
            <View style={{ flexDirection: 'row', backgroundColor: '#EAF3FC', borderRadius: 8, padding: 11 }}>
              {[tx('শ্রমিকের নাম', 'Labourer Name'), tx('অগ্রিম', 'Advance'), tx('মোট মজুরি', 'Total Wages'), tx('মোট পরিশোধ', 'Total Paid'), tx('মোট বাকি', 'Total Unpaid'), tx('কাজ', 'Action')].map((h, i) => <Text key={h} style={{ flex: [2, 1.1, 1.1, 1.1, 1.1, 2.4][i], color: '#27415E', fontWeight: '800' }}>{h}</Text>)}
            </View>
            {loading ? <ActivityIndicator color={color.primary} style={{ padding: 22 }} /> : !data?.labourers.length ? <Text style={{ color: '#64748B', textAlign: 'center', padding: 24 }}>{tx('এখনো কোনো শ্রমিক খরচ নেই।', 'No labour costs recorded yet.')}</Text> : data.labourers.map(worker => <View key={worker.id}>
              <View style={{ minHeight: 58, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', gap: 4 }}>
                <TouchableOpacity onPress={() => setLedgerWorker(worker)} style={{ flex: 2, paddingVertical: 10 }}><Text style={{ color: color.primary, fontWeight: '800' }}>{worker.name}</Text><Text style={{ color: '#64748B', fontSize: 12 }}>{tx('আলাদা লেজার খুলুন', 'Open separate ledger')} · {tx('অগ্রিম বাকি', 'Advance balance')} {m(worker.advanceBalance)}</Text></TouchableOpacity>
                <Text style={{ flex: 1.1, color: '#7C3AED', fontWeight: '700' }}>{m(worker.advanceBalance)}</Text>
                <Text style={{ flex: 1.1, color: color.text }}>{m(worker.totalWages)}</Text>
                <Text style={{ flex: 1.1, color: '#059669', fontWeight: '700' }}>{m(worker.totalPaid)}</Text>
                <Text style={{ flex: 1.1, color: worker.unpaid > 0 ? '#DC2626' : color.text, fontWeight: '700' }}>{m(worker.unpaid)}</Text>
                <View style={{ flex: 2.4, flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}><TouchableOpacity onPress={() => setLedgerWorker(worker)} style={{ backgroundColor: '#475569', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 8, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '700' }}>{tx('লেজার', 'Ledger')}</Text></TouchableOpacity>{worker.unpaid > 0 ? <TouchableOpacity onPress={() => openPay(worker)} style={{ backgroundColor: '#1D4ED8', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 9, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '700' }}>{tx('পরিশোধ', 'Pay')}</Text></TouchableOpacity> : null}<TouchableOpacity onPress={() => openAdvance(worker)} style={{ backgroundColor: '#7C3AED', borderRadius: 8, paddingVertical: 7, paddingHorizontal: 8, alignItems: 'center' }}><Text style={{ color: '#fff', fontWeight: '700' }}>{tx('অগ্রিম', 'Advance')}</Text></TouchableOpacity></View>
              </View>
            </View>)}
          </View>
        </ScrollView>
      </Card>
    </ScrollView>
    <Modal visible={formOpen} transparent animationType="fade" onRequestClose={() => setFormOpen(false)}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.48)', padding: 16 }}>
        <View style={{ width: '100%', maxWidth: 520, maxHeight: '92%', backgroundColor: '#F8FAFC', borderRadius: 16, padding: 18 }}>
          <ScrollView keyboardShouldPersistTaps="handled"><Text style={{ fontSize: 20, fontWeight: '900', color: color.text, marginBottom: 16 }}>{tx('নতুন শ্রমিক খরচ', 'New Labour Cost')}</Text>
            {error ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 9, borderRadius: 8, marginBottom: 10 }}>{error}</Text> : null}
            <View style={{ marginBottom: 10, position: 'relative', zIndex: 1000, elevation: 30, overflow: 'visible' }}>
              <Text style={{ color: '#5B728F', fontSize: 14, marginBottom: 5 }}>{tx('শ্রমিকের নাম', 'Labourer Name')} <Text style={{ color: '#DC2626', fontWeight: '900' }}>*</Text></Text>
              <TextInput value={name} onChangeText={value => { setName(value); setLabourNamePickerOpen(true); }} onFocus={() => setLabourNamePickerOpen(true)} placeholder={tx('শ্রমিকের নাম লিখুন বা নির্বাচন করুন', 'Type or select a labourer')} placeholderTextColor="#94A3B8" style={{ minHeight: 44, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 9, paddingHorizontal: 12, backgroundColor: '#fff', color: color.text, fontSize: 16 }} />
              {labourNamePickerOpen && data?.labourers.length ? <View style={{ position: 'absolute', top: 72, left: 0, right: 0, zIndex: 1001, elevation: 31, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 9, backgroundColor: '#fff', overflow: 'hidden', ...(Platform.OS === 'web' ? { boxShadow: '0 8px 20px rgba(15,23,42,0.18)' } as any : {}) }}>
                <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 190 }}>
                  {labourSuggestions.map(worker => <TouchableOpacity key={worker.id} onPress={() => { setName(worker.name); setLabourNamePickerOpen(false); }} style={{ paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}><Text style={{ color: color.text, fontWeight: '700' }}>{worker.name}</Text><Text style={{ color: '#64748B', fontSize: 12 }}>{tx('মজুরি বাকি', 'Wages due')}: {m(worker.unpaid)} · {tx('অগ্রিম স্থিতি', 'Advance balance')}: {m(worker.advanceBalance)}</Text></TouchableOpacity>)}
                  {!labourSuggestions.length ? <Text style={{ color: '#64748B', padding: 10 }}>{tx('নতুন শ্রমিক হিসেবে যোগ হবে', 'Will be added as a new labourer')}</Text> : null}
                </ScrollView>
              </View> : null}
            </View>
            <Field label={tx('প্রতি বস্তার শ্রমিক খরচ', 'Labour Price per Bag')} value={price} onChange={setPrice} num required returnKeyType="next" />
            <Field label={tx('পরিমাণ (বস্তা)', 'Quantity (bags)')} value={quantity} onChange={setQuantity} num required returnKeyType="done" />
            <Field label={tx('তারিখ', 'Date')} value={date} onChange={setDate} required />
            <Text style={{ color: '#475569', marginBottom: 7, fontWeight: '700' }}>{tx('স্টকের ধরন', 'Stock Direction')}</Text>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 16 }}>
              {(['stockIn', 'stockOut'] as const).map(value => <TouchableOpacity key={value} onPress={() => setDirection(value)} style={{ flex: 1, padding: 12, alignItems: 'center', borderRadius: 9, borderWidth: 1, borderColor: direction === value ? color.primary : '#CBD5E1', backgroundColor: direction === value ? '#EAF3FC' : '#fff' }}><Text style={{ color: color.text, fontWeight: '700' }}>{value === 'stockIn' ? tx('স্টক ইন', 'Stock In') : tx('স্টক আউট', 'Stock Out')}</Text></TouchableOpacity>)}
            </View>
            <Text style={{ color: '#475569', marginBottom: 16 }}>{tx('মোট মজুরি', 'Total Wages')}: <Text style={{ color: color.text, fontWeight: '900' }}>{m((Number(price) || 0) * (Number(quantity) || 0))}</Text></Text>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}><Btn kind="ghost" label={tx('বাতিল', 'Cancel')} onPress={() => { setFormOpen(false); setLabourNamePickerOpen(false); }} /><Btn label={busy ? tx('সংরক্ষণ হচ্ছে…', 'Saving…') : tx('নিশ্চিত করুন', 'Confirm')} onPress={() => { setLabourNamePickerOpen(false); if (!busy) void submitCost(); }} /></View>
          </ScrollView>
        </View>
      </View>
    </Modal>
    <Modal visible={!!payWorker} transparent animationType="fade" onRequestClose={() => setPayWorker(null)}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.48)', padding: 16 }}>
        <View style={{ width: '100%', maxWidth: 500, backgroundColor: '#F8FAFC', borderRadius: 16, padding: 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '900', color: color.text, marginBottom: 5 }}>{tx('শ্রমিকের মজুরি পরিশোধ', 'Pay Labour Wages')}</Text>
          {error ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 9, borderRadius: 8, marginVertical: 8 }}>{error}</Text> : null}
          <Text style={{ color: '#64748B', marginBottom: 14 }}>{payWorker?.name} · {tx('বাকি', 'Due')}: {m(payWorker?.unpaid ?? 0)}</Text>
          <Field label={tx('পরিশোধের পরিমাণ', 'Payment Amount')} value={payAmount} onChange={setPayAmount} num required />
          <Field label={tx('তারিখ', 'Date')} value={payDate} onChange={setPayDate} required />
          <Text style={{ color: '#475569', marginBottom: 6, fontWeight: '700' }}>{tx('ক্যাশ/ব্যাংক অ্যাকাউন্ট', 'Cash/Bank Account')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>{activeAccounts.map(account => <TouchableOpacity key={account.id} onPress={() => setAccountId(account.id)} style={{ padding: 9, borderRadius: 9, borderWidth: 1, borderColor: account.id === accountId ? color.primary : '#CBD5E1', backgroundColor: account.id === accountId ? '#EAF3FC' : '#fff' }}><Text style={{ color: color.text, fontWeight: '700' }}>{account.name}</Text></TouchableOpacity>)}</View>
          {!activeAccounts.length ? <Text style={{ color: '#B91C1C', marginBottom: 12 }}>{tx('আগে একটি সক্রিয় ক্যাশ বা ব্যাংক অ্যাকাউন্ট তৈরি করুন।', 'Create an active cash or bank account first.')}</Text> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}><Btn kind="ghost" label={tx('বাতিল', 'Cancel')} onPress={() => setPayWorker(null)} /><Btn label={busy ? tx('সংরক্ষণ হচ্ছে…', 'Saving…') : tx('পরিশোধ রেকর্ড করুন', 'Record Payment')} onPress={() => { if (!busy) void submitPayment(); }} /></View>
        </View>
      </View>
    </Modal>
    <Modal visible={!!advanceWorker} transparent animationType="fade" onRequestClose={() => setAdvanceWorker(null)}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.48)', padding: 16 }}>
        <View style={{ width: '100%', maxWidth: 500, backgroundColor: '#F8FAFC', borderRadius: 16, padding: 18 }}>
          <Text style={{ fontSize: 20, fontWeight: '900', color: color.text, marginBottom: 5 }}>{tx('শ্রমিককে অগ্রিম দিন', 'Pay Labour Advance')}</Text>
          <Text style={{ color: '#64748B', marginBottom: 14 }}>{advanceWorker?.name} · {tx('অগ্রিমটি পরবর্তী মজুরির সঙ্গে সমন্বয় হবে।', 'This advance will be adjusted against future wages.')}</Text>
          {error ? <Text accessibilityRole="alert" style={{ color: '#B91C1C', backgroundColor: '#FEF2F2', padding: 9, borderRadius: 8, marginBottom: 10 }}>{error}</Text> : null}
          <Field label={tx('অগ্রিমের পরিমাণ', 'Advance Amount')} value={advanceAmount} onChange={setAdvanceAmount} num required />
          <Field label={tx('তারিখ', 'Date')} value={advanceDate} onChange={setAdvanceDate} required />
          <Text style={{ color: '#475569', marginBottom: 6, fontWeight: '700' }}>{tx('ক্যাশ/ব্যাংক অ্যাকাউন্ট', 'Cash/Bank Account')}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 16 }}>{activeAccounts.map(account => <TouchableOpacity key={account.id} onPress={() => setAccountId(account.id)} style={{ padding: 9, borderRadius: 9, borderWidth: 1, borderColor: account.id === accountId ? color.primary : '#CBD5E1', backgroundColor: account.id === accountId ? '#EAF3FC' : '#fff' }}><Text style={{ color: color.text, fontWeight: '700' }}>{account.name}</Text></TouchableOpacity>)}</View>
          {!activeAccounts.length ? <Text style={{ color: '#B91C1C', marginBottom: 12 }}>{tx('আগে একটি সক্রিয় ক্যাশ বা ব্যাংক অ্যাকাউন্ট তৈরি করুন।', 'Create an active cash or bank account first.')}</Text> : null}
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}><Btn kind="ghost" label={tx('বাতিল', 'Cancel')} onPress={() => setAdvanceWorker(null)} /><Btn label={busy ? tx('সংরক্ষণ হচ্ছে…', 'Saving…') : tx('অগ্রিম রেকর্ড করুন', 'Record Advance')} onPress={() => { if (!busy) void submitAdvance(); }} /></View>
        </View>
      </View>
    </Modal>
    <Modal visible={!!ledgerWorker} transparent animationType="fade" onRequestClose={() => setLedgerWorker(null)}>
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: 'rgba(15,23,42,0.5)', padding: 12 }}>
        <View style={{ width: '100%', maxWidth: 1050, maxHeight: '94%', backgroundColor: '#F8FAFC', borderRadius: 16, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: color.primary, gap: 12 }}>
            <View style={{ flex: 1 }}><Text style={{ color: '#fff', fontSize: 20, fontWeight: '900' }}>{ledgerWorker?.name}</Text><Text style={{ color: '#DBEAFE', marginTop: 3 }}>{tx('শ্রমিকের আলাদা লেজার', 'Individual Labour Ledger')}</Text></View>
            <TouchableOpacity onPress={() => setLedgerWorker(null)} accessibilityRole="button" style={{ padding: 8 }}><Text style={{ color: '#fff', fontSize: 24, fontWeight: '700' }}>×</Text></TouchableOpacity>
          </View>
          {ledgerWorker ? <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {[
                [tx('মোট মজুরি', 'Total Wages'), m(ledgerWorker.totalWages), '#1D4ED8'],
                [tx('পরিশোধ/সমন্বয়', 'Paid / Adjusted'), m(ledgerWorker.totalPaid), '#059669'],
                [tx('মজুরি বাকি', 'Wages Due'), m(ledgerWorker.unpaid), '#DC2626'],
                [tx('অগ্রিম বাকি', 'Advance Balance'), m(ledgerWorker.advanceBalance), '#7C3AED'],
              ].map(([label, value, tone]) => <View key={label} style={{ flexGrow: 1, minWidth: 170, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 10, padding: 12 }}><Text style={{ color: '#64748B', fontWeight: '700' }}>{label}</Text><Text style={{ color: tone, fontWeight: '900', fontSize: 18, marginTop: 5 }}>{value}</Text></View>)}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator>
              <View style={{ minWidth: 900 }}>
                <View style={{ flexDirection: 'row', backgroundColor: '#EAF3FC', padding: 10, borderTopLeftRadius: 8, borderTopRightRadius: 8 }}>
                  {[tx('তারিখ', 'Date'), tx('লেনদেনের বিবরণ', 'Transaction'), tx('মজুরি/অগ্রিম', 'Wage / Advance'), tx('মজুরির সমন্বয়', 'Advance Applied'), tx('মজুরি বাকি', 'Wages Due'), tx('অগ্রিম স্থিতি', 'Advance Balance')].map((label, i) => <Text key={label} style={{ flex: [1.1, 2.4, 1.3, 1.3, 1.3, 1.3][i], color: '#27415E', fontWeight: '800', paddingRight: 6 }}>{label}</Text>)}
                </View>
                {!ledgerWorker.ledger.length ? <Text style={{ color: '#64748B', textAlign: 'center', padding: 22 }}>{tx('এই শ্রমিকের কোনো লেনদেন নেই।', 'No transactions for this labourer yet.')}</Text> : ledgerWorker.ledger.map(entry => {
                  const description = entry.kind === 'wage'
                    ? `${tx('মজুরি', 'Wage')} · ${entry.direction === 'stockOut' ? tx('স্টক আউট', 'Stock Out') : tx('স্টক ইন', 'Stock In')} · ${n(entry.quantity ?? 0)} ${tx('বস্তা', 'bags')} × ${m(entry.pricePerBag ?? 0)}`
                    : entry.kind === 'payment' ? tx('মজুরি পরিশোধ', 'Wage Payment') : tx('শ্রমিক অগ্রিম প্রদান', 'Labour Advance Paid');
                  return <View key={`${entry.kind}-${entry.id}`} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 10, borderBottomWidth: 1, borderBottomColor: '#E2E8F0', backgroundColor: '#fff' }}>
                    <Text style={{ flex: 1.1, color: '#475569', paddingRight: 6 }}>{entry.date}</Text>
                    <Text style={{ flex: 2.4, color: color.text, paddingRight: 6 }}>{description}{entry.note ? ` · ${entry.note}` : ''}</Text>
                    <Text style={{ flex: 1.3, color: entry.kind === 'payment' ? '#059669' : color.text, paddingRight: 6 }}>{m(entry.amount)}</Text>
                    <Text style={{ flex: 1.3, color: '#7C3AED', paddingRight: 6 }}>{m(entry.kind === 'wage' ? entry.advanceApplied ?? 0 : entry.kind === 'advance' ? entry.appliedAmount ?? 0 : 0)}</Text>
                    <Text style={{ flex: 1.3, color: '#B91C1C', paddingRight: 6 }}>{m(entry.dueBalance)}</Text>
                    <Text style={{ flex: 1.3, color: '#6D28D9' }}>{m(entry.advanceBalance)}</Text>
                  </View>;
                })}
              </View>
            </ScrollView>
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
              {ledgerWorker.unpaid > 0 ? <Btn label={tx('মজুরি পরিশোধ', 'Pay Wages')} onPress={() => { const worker = ledgerWorker; setLedgerWorker(null); openPay(worker); }} /> : null}
              <Btn kind="ghost" label={tx('বন্ধ করুন', 'Close')} onPress={() => setLedgerWorker(null)} />
            </View>
          </ScrollView> : null}
        </View>
      </View>
    </Modal>
  </View>;
}
