import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { useApp, today } from '../store';
import { api, MoneyMovementRow } from '../api';
import { Screen, Card, Title, Btn, Row, Empty, useMoney, useDateStr, color } from '../ui';
import { RGrid } from '../responsive';
import { AppIcon, icons } from '../icons';
import { AccountFormModal, MoneyTransferModal, MoneyEntry, DetailShell } from '../screens';
import { AccountPage } from './AccountPage';
import { downloadCSV } from '../stockReport';
import { MoneyMovementDetail, MoneyMovementItem } from './MoneyMovementDetail';

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
  const [selectedMovement, setSelectedMovement] = useState<MoneyMovementRow | null>(null);
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
  const recent = rows.filter(row => row.sourceType !== 'openingAdjust').filter(row => { if (!row.transferId) return true; if (seen.has(row.transferId)) return false; seen.add(row.transferId); return true; }).slice(0, 12);
  const downloadBankReport = () => {
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const lines = [
      [label('অ্যাকাউন্ট', 'Account'), label('ধরন', 'Type'), label('শুরুর ব্যালেন্স', 'Opening balance'), label('শুরুর তারিখ', 'Opening date'), label('বর্তমান স্থিতি', 'Current balance'), label('লেনদেনের তারিখ', 'Transaction date'), label('লেনদেন', 'Transaction'), label('পরিমাণ', 'Amount')].map(cell).join(','),
      ...shown.map(a => [a.name, a.type, a.adjustedOpeningBalance ?? a.openingBalance, a.openingDate, a.balance, '', '', ''].map(cell).join(',')),
      ...recent.map(r => ['', '', '', '', '', r.date, names[r.sourceType] ?? r.sourceType, `${r.direction === 'in' ? '+' : '-'}${r.amount}`].map(cell).join(',')),
    ];
    downloadCSV(`bank_cash_report_${today()}.csv`, lines.join('\r\n'));
  };
  if (detail) return <AccountPage key={detail} id={detail} onBack={() => openAccount(null)} />;
  return <Screen>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18 }}>
      <Title>{t('bankCash')}</Title>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, width: '100%' }}>
        <Btn label={label('জমা', 'Deposit')} icon={icons.moneyIn} onPress={() => setEntry('in')} testID="bank-deposit" />
        <Btn label={label('উত্তোলন', 'Withdraw')} icon={icons.moneyOut} kind="ghost" onPress={() => setEntry('out')} testID="bank-withdraw" />
        <Btn label={t('transferMoney')} icon={icons.transfer} kind="ghost" onPress={() => setTransfer(true)} />
        <Btn label={t('addAccount')} icon={icons.plus} kind="ghost" onPress={() => setAdd(true)} testID="bank-add-account" />
        <Btn label={label('রিপোর্ট ডাউনলোড', 'Download report')} icon={icons.excel} kind="ghost" onPress={downloadBankReport} />
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
        <Text style={{ fontSize: 12, color: color.muted, marginTop: 6 }}>{label('শুরুর ব্যালেন্স', 'Opening')}: {m(a.adjustedOpeningBalance ?? a.openingBalance)} · {fd(a.openingDate)}</Text>
      </TouchableOpacity>)}
    </RGrid>
    {!shown.length ? <Card><Empty /></Card> : null}
    <View style={{ marginTop: 24 }}><Card>
      <Title>{t('recentTx')}</Title>
      {error ? <><Text style={{ color: color.red }}>{error}</Text><Btn kind="ghost" label={label('আবার চেষ্টা করুন', 'Retry')} onPress={() => setRetry(n => n + 1)} /></> : loading ? <Text>{t('wait')}</Text> : recent.length ? recent.map(row => {
        const other = row.transferId ? rows.find(r => r.transferId === row.transferId && r.id !== row.id) : undefined;
        const from = row.direction === 'out' ? row : other, to = row.direction === 'in' ? row : other;
        const accountName = row.transferId ? `${from?.moneyAccount?.name ?? ''} → ${to?.moneyAccount?.name ?? ''}` : row.moneyAccount?.name ?? '';
        return <TouchableOpacity key={row.id} onPress={() => setSelectedMovement(row)} accessibilityRole="button" accessibilityLabel={label(`লেনদেনের বিবরণ ${row.amount}`, `View transaction ${row.amount}`)} style={{ paddingVertical: 2 }}><Row left={`${row.transactionNo} · ${names[row.sourceType] ?? row.sourceType} · ${accountName}`} sub={fd(row.date)} right={`${row.transferId ? '' : row.direction === 'in' ? '+' : '−'}${m(row.amount)}`} neg={!row.transferId && row.direction === 'out'} /></TouchableOpacity>;
      }) : <Empty />}
    </Card></View>
    {add ? <AccountFormModal onClose={() => setAdd(false)} /> : null}
    {transfer ? <MoneyTransferModal onClose={() => setTransfer(false)} /> : null}
    {entry ? <MoneyEntry direction={entry} onClose={() => setEntry(null)} onSaved={refresh} /> : null}
    {selectedMovement ? <MoneyMovementDetail movement={selectedMovement as MoneyMovementItem} accountName={selectedMovement.moneyAccount?.name} onClose={() => setSelectedMovement(null)} onSaved={async () => { await refresh(); setRows(await api.moneyMovements()); }} /> : null}
  </Screen>;
}
