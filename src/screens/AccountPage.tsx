import React, { useEffect, useState } from 'react';
import { ScrollView, View, Text } from 'react-native';
import { api, MoneyAccountDetail, MoneyAccountMovement } from '../api';
import { useApp, today } from '../store';
import { Screen, Card, Title, Btn, Field, Chips, Row, ListTable, TableColumn, useMoney, useDateStr, methodName } from '../ui';
import { RGrid } from '../responsive';
import { icons } from '../icons';
import { toEnDigits } from '../bn';
import { AccountFormModal, AccountDetailModal } from '../screens';

export function AccountPage({ id, onBack }: { id: string; onBack: () => void }) {
  const { lang, t, moneyAccounts } = useApp();
  const m = useMoney(), fd = useDateStr();
  const l = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const [data, setData] = useState<MoneyAccountDetail | null>(null), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0), [edit, setEdit] = useState(false), [manage, setManage] = useState(false);
  const [query, setQuery] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState(''), [kind, setKind] = useState('all'), [direction, setDirection] = useState('all'), [page, setPage] = useState(0);
  useEffect(() => {
    let current = true; setLoading(true); setError('');
    api.moneyAccountDetail(id).then(value => { if (current) setData(value); }).catch(() => { if (current) setError(l('অ্যাকাউন্টের তথ্য পাওয়া যায়নি', 'Could not load account')); }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [id, moneyAccounts, retry]);
  useEffect(() => setPage(0), [query, from, to, kind, direction, data]);
  const names: Record<string, string> = { deposit: l('জমা', 'Deposit'), withdrawal: l('উত্তোলন', 'Withdrawal'), sale: t('sale'), purchase: t('purchase'), customerPayment: t('collect'), vendorPayment: t('pay'), expense: t('expense'), saleReturn: t('saleReturnLabel2'), purchaseReturn: t('purchaseReturnLabel'), transferIn: l('ট্রান্সফার গ্রহণ', 'Transfer in'), transferOut: l('ট্রান্সফার প্রদান', 'Transfer out'), openingAdjust: t('openingMoney') };
  const otherName = (row: MoneyAccountMovement) => moneyAccounts.find(a => a.id === row.counterpartyAccountId)?.name ?? '';
  const start = toEnDigits(from), end = toEnDigits(to);
  const validDate = (value: string) => !value || (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
  const invalid = !validDate(start) || !validDate(end) || (!!start && !!end && start > end);
  const filtered = invalid ? [] : (data?.movements ?? []).filter(row =>
    (!start || row.date >= start) && (!end || row.date <= end) && (kind === 'all' || row.sourceType === kind) &&
    (direction === 'all' || row.direction === direction) &&
    `${names[row.sourceType] ?? row.sourceType} ${row.note ?? ''} ${row.transferNo ?? ''} ${otherName(row)} ${row.amount}`.toLowerCase().includes(toEnDigits(query).trim().toLowerCase()));
  const incoming = filtered.filter(r => r.direction === 'in').reduce((s, r) => s + r.amount, 0);
  const outgoing = filtered.filter(r => r.direction === 'out').reduce((s, r) => s + r.amount, 0);
  const pages = Math.max(1, Math.ceil(filtered.length / 25));
  const visiblePage = Math.min(page, pages - 1);
  const columns: TableColumn<MoneyAccountMovement>[] = [
    { key: 'date', label: l('তারিখ', 'Date'), render: r => <Text>{fd(r.date)}</Text> },
    { key: 'type', label: l('লেনদেনের ধরন', 'Transaction'), flex: 1.3, render: r => <Text>{names[r.sourceType] ?? r.sourceType}</Text> },
    { key: 'note', label: l('বিবরণ / রেফারেন্স', 'Details / Reference'), flex: 2, render: r => <Text>{[r.transferNo, otherName(r), r.note !== r.transferNo ? r.note : ''].filter(Boolean).join(' · ') || '—'}</Text> },
    { key: 'in', label: l('জমা', 'Money in'), align: 'right', render: r => <Text style={{ color: '#15803D' }}>{r.direction === 'in' ? m(r.amount) : '—'}</Text> },
    { key: 'out', label: l('উত্তোলন', 'Money out'), align: 'right', render: r => <Text style={{ color: '#DC2626' }}>{r.direction === 'out' ? m(r.amount) : '—'}</Text> },
    { key: 'balance', label: l('স্থিতি', 'Balance'), align: 'right', render: r => <Text style={{ fontWeight: '600' }}>{m(r.balance)}</Text> },
  ];
  const account = data?.account;
  return <Screen>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, marginBottom: 16 }}>
      <Btn kind="ghost" icon={icons.back} label={t('bankCash')} onPress={onBack} testID="account-back" />
      {account ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Btn kind="ghost" icon={icons.edit} label={t('editAccount')} onPress={() => setEdit(true)} /><Btn kind="ghost" label={l('অ্যাকাউন্ট পরিচালনা', 'Manage account')} onPress={() => setManage(true)} /></View> : null}
    </View>
    {loading ? <Text>{t('wait')}</Text> : error ? <Card><Text accessibilityRole="alert">{error}</Text><Btn label={l('আবার চেষ্টা করুন', 'Retry')} onPress={() => setRetry(v => v + 1)} /></Card> : account ? <>
      <Title>{account.name}</Title>
      <RGrid mobile={1} tablet={2} desktop={2}>
        <Card><Text>{t('accountBalanceLabel')}</Text><Text testID="account-current-balance" style={{ fontSize: 34, fontWeight: '800', color: '#123D64', marginVertical: 12 }}>{m(account.balance)}</Text><Text>{account.active ? t('activeAccount') : t('inactiveAccount')}</Text></Card>
        <Card><Row left={t('accountType')} right={methodName(account.type, t)} /><Row left={t('openingMoney')} right={m(account.openingBalance)} />
          {account.bankName ? <Row left={t('bankName')} right={account.bankName} /> : null}
          {account.accountNumber ? <Row left={t('accountNumber')} right={account.accountNumber} /> : null}
          {account.branch ? <Row left={t('branch')} right={account.branch} /> : null}
          {account.mobileNumber ? <Text>{account.mobileNumber}</Text> : null}
          {account.note ? <Text>{account.note}</Text> : null}
        </Card>
      </RGrid>
      <Card><Title>{l('লেনদেনের তালিকা', 'Transactions')}</Title>
        <Field label={l('খুঁজুন', 'Search transactions')} value={query} onChange={setQuery} />
        <RGrid mobile={1} tablet={2} desktop={2}><Field label={l('শুরুর তারিখ (YYYY-MM-DD)', 'From date (YYYY-MM-DD)')} value={from} onChange={setFrom} /><Field label={l('শেষ তারিখ (YYYY-MM-DD)', 'To date (YYYY-MM-DD)')} value={to} onChange={setTo} /></RGrid>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}><Btn kind="ghost" label={l('আজ', 'Today')} onPress={() => { setFrom(today()); setTo(today()); }} /><Btn kind="ghost" label={l('চলতি মাস', 'This month')} onPress={() => { setFrom(today().slice(0, 7) + '-01'); setTo(today()); }} /><Btn kind="ghost" label={l('ফিল্টার মুছুন', 'Clear filters')} onPress={() => { setFrom(''); setTo(''); setQuery(''); setKind('all'); setDirection('all'); }} testID="clear-account-filters" /></View>
        <Chips value={direction} onPick={setDirection} items={[{ id: 'all', name: l('সব লেনদেন', 'All directions') }, { id: 'in', name: l('জমা', 'Money in') }, { id: 'out', name: l('উত্তোলন', 'Money out') }]} />
        <Chips value={kind} onPick={setKind} items={[{ id: 'all', name: l('সব ধরন', 'All types') }, ...Object.entries(names).map(([id, name]) => ({ id, name }))]} />
        {invalid ? <Text accessibilityRole="alert" style={{ color: '#DC2626' }}>{l('সঠিক তারিখসীমা দিন', 'Enter a valid date range')}</Text> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 20, marginVertical: 14 }}><Text>{l('মোট জমা', 'Filtered money in')}: {m(incoming)}</Text><Text>{l('মোট উত্তোলন', 'Filtered money out')}: {m(outgoing)}</Text><Text testID="account-result-count">{l('লেনদেন', 'Transactions')}: {filtered.length}</Text></View>
        <ScrollView horizontal><View testID="account-transactions" style={{ minWidth: 960, flex: 1 }}><ListTable columns={columns} rows={filtered.slice(visiblePage * 25, (visiblePage + 1) * 25)} rowKey={r => r.id} /></View></ScrollView>
        {pages > 1 ? <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center', marginTop: 16 }}><Btn kind="ghost" label={l('আগের', 'Previous')} onPress={() => setPage(Math.max(0, visiblePage - 1))} /><Text>{visiblePage + 1} / {pages}</Text><Btn kind="ghost" label={l('পরের', 'Next')} onPress={() => setPage(Math.min(pages - 1, visiblePage + 1))} /></View> : null}
      </Card>
    </> : null}
    {edit ? <AccountFormModal id={id} onClose={() => setEdit(false)} /> : null}
    {manage ? <AccountDetailModal id={id} onClose={() => { setManage(false); if (!moneyAccounts.some(a => a.id === id)) onBack(); }} onEdit={() => { setManage(false); setEdit(true); }} /> : null}
  </Screen>;
}
