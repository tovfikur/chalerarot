import React, { useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useApp, today } from '../store';
import { api, MoneyMovementRow } from '../api';
import { Screen, Card, Title, Btn, Field, AccountPicker, Row, Empty, useMoney, useDateStr, color } from '../ui';
import { RGrid } from '../responsive';
import { AppIcon, icons } from '../icons';
import { parseNum, toEnDigits } from '../bn';
import { AccountFormModal, MoneyTransferModal, DetailShell } from '../screens';
import { AccountPage } from './AccountPage';

const accountFromUrl = () => typeof window !== 'undefined' ? new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('account') : null;

export function BankCashDashboard() {
  const { moneyAccounts, refresh, lang, t } = useApp();
  const m = useMoney(), fd = useDateStr();
  const label = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const [add, setAdd] = useState(false), [detail, setDetail] = useState<string | null>(accountFromUrl);
  const openAccount = (id: string | null) => {
    setDetail(id);
    if (typeof window !== 'undefined') window.location.hash = id ? `/bank?account=${encodeURIComponent(id)}` : '/bank';
  };
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const update = () => setDetail(accountFromUrl());
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);
  const [transfer, setTransfer] = useState(false), [entry, setEntry] = useState<'in' | 'out' | null>(null);
  const [archived, setArchived] = useState(false);
  const [rows, setRows] = useState<MoneyMovementRow[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const active = moneyAccounts.filter(a => a.active);
  const shown = moneyAccounts.filter(a => archived ? !a.active : a.active);
  const total = active.reduce((sum, a) => sum + a.balance, 0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError('');
    api.moneyMovements().then(data => { if (current) setRows(data); }).catch(() => { if (current) setError(label('লেনদেন লোড করা যায়নি', 'Could not load transactions')); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [moneyAccounts, retry, lang]);
  const names: Record<string, string> = {
    deposit: label('জমা', 'Deposit'), withdrawal: label('উত্তোলন', 'Withdrawal'), sale: t('sale'), purchase: t('purchase'),
    customerPayment: t('collect'), vendorPayment: t('pay'), expense: t('expense'), saleReturn: t('saleReturnLabel2'), purchaseReturn: t('purchaseReturnLabel'),
    transferIn: t('transferMoney'), transferOut: t('transferMoney'), openingAdjust: t('openingMoney'),
  };
  // One row per internal transfer; other movements each retain their own row.
  const seen = new Set<string>();
  const recent = rows.filter(row => { if (!row.transferId) return true; if (seen.has(row.transferId)) return false; seen.add(row.transferId); return true; }).slice(0, 12);
  if (detail) return <AccountPage key={detail} id={detail} onBack={() => openAccount(null)} />;
  return <Screen>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
      <Title>{t('bankCash')}</Title>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%' }}>
        <Btn label={label('জমা', 'Deposit')} icon={icons.moneyIn} onPress={() => setEntry('in')} testID="bank-deposit" />
        <Btn label={label('উত্তোলন', 'Withdraw')} icon={icons.moneyOut} kind="ghost" onPress={() => setEntry('out')} testID="bank-withdraw" />
        <Btn label={t('transferMoney')} icon={icons.transfer} kind="ghost" onPress={() => setTransfer(true)} />
        <Btn label={t('addAccount')} icon={icons.plus} kind="ghost" onPress={() => setAdd(true)} testID="bank-add-account" />
      </View>
    </View>
    <View style={{ backgroundColor: '#123D64', borderRadius: 20, padding: 24, marginBottom: 22 }}>
      <Text style={{ color: '#CDE4F8', fontSize: 15 }}>{label('মোট নগদ ও ব্যাংক স্থিতি', 'Total cash & account balance')}</Text>
      <Text testID="bank-total" style={{ color: '#fff', fontSize: 36, fontWeight: '800', marginTop: 8 }}>{m(total)}</Text>
    </View>
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
      <Title>{label('অ্যাকাউন্টসমূহ', 'Accounts')}</Title>
      {moneyAccounts.some(a => !a.active) ? <Btn kind="ghost" label={archived ? t('activeAccountsTab') : t('inactiveAccountsTab')} onPress={() => setArchived(!archived)} /> : null}
    </View>
    <RGrid mobile={1} tablet={2} desktop={3}>
      {shown.map(a => <TouchableOpacity key={a.id} testID={`account-card-${a.id}`} accessibilityRole="button" accessibilityLabel={a.name} onPress={() => openAccount(a.id)} style={{ backgroundColor: '#fff', borderRadius: 18, padding: 20, minHeight: 150, marginBottom: 12, borderWidth: 1, borderColor: '#DCE6EF' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{ padding: 10, backgroundColor: a.type === 'cash' ? '#E8F7EE' : '#EAF2FC', borderRadius: 12 }}><AppIcon name={a.type === 'cash' ? icons.cash : a.type === 'bank' ? icons.bank : icons.bkash} size={24} iconColor={a.type === 'cash' ? '#16834B' : '#2867AD'} /></View>
          <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: color.text }}>{a.name}</Text>
        </View>
        <Text style={{ fontSize: 28, fontWeight: '800', marginTop: 22, color: a.balance < 0 ? color.red : color.text }}>{m(a.balance)}</Text>
      </TouchableOpacity>)}
    </RGrid>
    {!shown.length ? <Card><Empty /></Card> : null}
    <View style={{ marginTop: 24 }}><Card>
      <Title>{t('recentTx')}</Title>
      {error ? <><Text style={{ color: color.red }}>{error}</Text><Btn kind="ghost" label={label('আবার চেষ্টা করুন', 'Retry')} onPress={() => setRetry(n => n + 1)} /></> : loading ? <Text>{t('wait')}</Text> : recent.length ? recent.map(row => {
        const other = row.transferId ? rows.find(r => r.transferId === row.transferId && r.id !== row.id) : undefined;
        const from = row.direction === 'out' ? row : other, to = row.direction === 'in' ? row : other;
        const accountName = row.transferId ? `${from?.moneyAccount?.name ?? ''} → ${to?.moneyAccount?.name ?? ''}` : row.moneyAccount?.name ?? '';
        return <Row key={row.id} left={`${names[row.sourceType] ?? row.sourceType} · ${accountName}`} sub={fd(row.date)} right={`${row.transferId ? '' : row.direction === 'in' ? '+' : '−'}${m(row.amount)}`} neg={!row.transferId && row.direction === 'out'} />;
      }) : <Empty />}
    </Card></View>
    {add ? <AccountFormModal onClose={() => setAdd(false)} /> : null}
    {transfer ? <MoneyTransferModal onClose={() => setTransfer(false)} /> : null}
    {entry ? <MoneyEntry direction={entry} onClose={() => setEntry(null)} onSaved={refresh} /> : null}
  </Screen>;
}

function MoneyEntry({ direction, onClose, onSaved }: { direction: 'in' | 'out'; onClose: () => void; onSaved: () => Promise<void> }) {
  const { lang, moneyAccounts, t } = useApp();
  const label = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const [accountId, setAccountId] = useState(moneyAccounts.find(a => a.active)?.id ?? '');
  const [amount, setAmount] = useState(''), [date, setDate] = useState(today()), [note, setNote] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const lock = useRef(false);
  const [requestId] = useState(() => `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const [saved, setSaved] = useState(false);
  const submit = async () => {
    if (lock.current) return;
    if (!accountId || !(parseNum(amount) > 0)) { setError(label('অ্যাকাউন্ট ও সঠিক পরিমাণ দিন', 'Select an account and enter a valid amount')); return; }
    lock.current = true; setBusy(true); setError('');
    try {
      if (!saved) { await api.moneyEntry({ accountId, direction, amount: parseNum(amount), date: toEnDigits(date), note, requestId }); setSaved(true); }
      await onSaved(); onClose();
    } catch (e) { setError((e as { code?: string }).code === 'INSUFFICIENT_FUNDS' ? label('এই অ্যাকাউন্টে পর্যাপ্ত টাকা নেই', 'Insufficient account balance') : label('সংরক্ষণ বা হালনাগাদ করা যায়নি। আবার চেষ্টা করুন।', 'Could not save or refresh. Please try again.')); }
    finally { lock.current = false; setBusy(false); }
  };
  return <DetailShell title={direction === 'in' ? label('টাকা জমা', 'Deposit') : label('টাকা উত্তোলন', 'Withdraw')} onClose={onClose}>
    <Card>
      <View pointerEvents={busy || saved ? 'none' : 'auto'}>
        <AccountPicker accountId={accountId} onPick={setAccountId} required />
        <Field label={label('পরিমাণ', 'Amount')} value={amount} onChange={setAmount} num />
        <Field label={label('তারিখ (YYYY-MM-DD)', 'Date (YYYY-MM-DD)')} value={date} onChange={setDate} />
        <Field label={label('বিবরণ', 'Note')} value={note} onChange={setNote} />
      </View>
      {error ? <Text accessibilityRole="alert" style={{ color: color.red, marginBottom: 12 }}>{error}</Text> : null}
      <Btn label={busy ? t('wait') : t('save')} onPress={submit} testID="save-money-entry" />
    </Card>
  </DetailShell>;
}
