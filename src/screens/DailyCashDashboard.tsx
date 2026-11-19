import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, TouchableOpacity, View } from 'react-native';
import { api, Expense, MoneyAccountDetail, MoneyAccountMovement } from '../api';
import { useApp, today } from '../store';
import { Btn, Card, color, Screen, Title, useMoney, useDateStr } from '../ui';
import { DateField } from '../screens';
import { downloadCSV } from '../stockReport';
import { printReport, printedAtStamp, type ReportDoc } from '../report';
import { icons } from '../icons';
import { useBreakpoint } from '../responsive';

type CashCategoryId = 'purchase' | 'sale' | 'invoicePaid' | 'invoiceReceived' | 'cashIn' | 'cashWithdraw' | 'labour' | 'transport' | 'otherIn' | 'otherOut' | 'transfer';
type CashRow = MoneyAccountMovement & { accountName: string; category: CashCategoryId };
type CategoryInfo = { id: CashCategoryId; bn: string; en: string; direction?: 'in' | 'out'; tone: string };

const CATEGORIES: CategoryInfo[] = [
  { id: 'purchase', bn: 'ক্রয় ইনভয়েস পেমেন্ট', en: 'Purchase invoice payments', direction: 'out', tone: '#EA580C' },
  { id: 'sale', bn: 'বিক্রয় ইনভয়েসে নগদ', en: 'Cash received on sales', direction: 'in', tone: '#0D9488' },
  { id: 'invoicePaid', bn: 'সরবরাহকারী ইনভয়েস পরিশোধ', en: 'Supplier invoice payments', direction: 'out', tone: '#C2410C' },
  { id: 'invoiceReceived', bn: 'ক্রেতার ইনভয়েস আদায়', en: 'Customer invoice receipts', direction: 'in', tone: '#059669' },
  { id: 'cashIn', bn: 'নগদ জমা', en: 'Cash deposits', direction: 'in', tone: '#0284C7' },
  { id: 'cashWithdraw', bn: 'নগদ উত্তোলন', en: 'Cash withdrawals', direction: 'out', tone: '#DC2626' },
  { id: 'labour', bn: 'শ্রমিক খরচ পরিশোধ', en: 'Labour cost payments', direction: 'out', tone: '#7C3AED' },
  { id: 'transport', bn: 'পরিবহন খরচ পরিশোধ', en: 'Transport cost payments', direction: 'out', tone: '#2563EB' },
  { id: 'otherIn', bn: 'অন্যান্য নগদ গ্রহণ', en: 'Other cash received', direction: 'in', tone: '#0891B2' },
  { id: 'otherOut', bn: 'অন্যান্য নগদ প্রদান', en: 'Other cash payments', direction: 'out', tone: '#64748B' },
  { id: 'transfer', bn: 'ক্যাশ অ্যাকাউন্ট স্থানান্তর', en: 'Cash account transfers', tone: '#475569' },
];

const previousDay = (date: string) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() - 1);
  return value.toISOString().slice(0, 10);
};

export function DailyCashDashboard({ embedded = false }: { embedded?: boolean }) {
  const { moneyAccounts, lang, business } = useApp();
  const bn = lang === 'bn';
  const label = (bnText: string, enText: string) => bn ? bnText : enText;
  const m = useMoney();
  const fd = useDateStr();
  const [date, setDate] = useState(today());
  const [details, setDetails] = useState<MoneyAccountDetail[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [opening, setOpening] = useState(0);
  const [selected, setSelected] = useState<CashCategoryId | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true); setError('');
    try {
      const cashIds = moneyAccounts.filter(account => account.type === 'cash').map(account => account.id);
      const [nextDetails, nextExpenses, priorBalances] = await Promise.all([
        Promise.all(cashIds.map(id => api.moneyAccountDetail(id))),
        api.expenses(),
        api.moneyAccountsAsOf(previousDay(date)),
      ]);
      setDetails(nextDetails); setExpenses(nextExpenses);
      setOpening(priorBalances.accounts.filter(account => account.type === 'cash').reduce((sum, account) => sum + account.balance, 0));
    } catch (e) {
      setError(e instanceof Error ? e.message : label('দৈনিক ক্যাশ হিসাব লোড করা যায়নি।', 'Could not load daily cash activity.'));
    } finally { setLoading(false); }
  }, [date, moneyAccounts, lang]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo<CashRow[]>(() => {
    const expenseById = new Map(expenses.map(expense => [expense.id, expense]));
    const cashTypeById = new Map(moneyAccounts.map(account => [account.id, account.type]));
    const identifyExpense = (sourceId: string) => {
      const id = sourceId.split(':')[0];
      return expenseById.get(id);
    };
    const all = details.flatMap(detail => detail.movements
      .filter(movement => movement.active && movement.date === date)
      .map(movement => {
        let category: CashCategoryId;
        if (movement.sourceType === 'purchase') category = 'purchase';
        else if (movement.sourceType === 'sale') category = 'sale';
        else if (movement.sourceType === 'vendorPayment') category = 'invoicePaid';
        else if (movement.sourceType === 'customerPayment') category = 'invoiceReceived';
        else if (movement.sourceType === 'deposit') category = 'cashIn';
        else if (movement.sourceType === 'withdrawal') category = 'cashWithdraw';
        else if (movement.sourceType === 'transferIn' || movement.sourceType === 'transferOut') category = 'transfer';
        else if (movement.sourceType === 'labourAdvance' || movement.sourceType === 'labourPayment') category = 'labour';
        else if (movement.sourceType === 'expense') {
          const expense = identifyExpense(movement.sourceId);
          const landingType = movement.sourceId.split(':')[1];
          const type = landingType === 'transport' || landingType === 'stockInLabour' || landingType === 'stockOutLabour'
            ? landingType : expense?.landingType;
          category = type === 'transport' ? 'transport' : type === 'stockInLabour' || type === 'stockOutLabour' || type === 'splitLabour' ? 'labour' : 'otherOut';
        } else if (movement.direction === 'in') category = 'otherIn';
        else category = 'otherOut';
        return { ...movement, accountName: detail.account.name, category };
      }));
    const transferIds = new Set(all.filter(row => row.category === 'transfer' && cashTypeById.get(row.counterpartyAccountId ?? '') === 'cash').map(row => row.transferNo ?? row.sourceId));
    return all.filter(row => !(row.category === 'transfer' && transferIds.has(row.transferNo ?? row.sourceId)));
  }, [date, details, expenses, moneyAccounts]);

  // Transfers inside cash accounts are removed above; transfers crossing into
  // bank or wallet accounts remain in the cash in/out totals.
  const isIncluded = (_row: CashRow) => true;
  const totalIn = rows.filter(row => isIncluded(row) && row.direction === 'in').reduce((sum, row) => sum + row.amount, 0);
  const totalOut = rows.filter(row => isIncluded(row) && row.direction === 'out').reduce((sum, row) => sum + row.amount, 0);
  const closing = Math.round((opening + totalIn - totalOut) * 100) / 100;
  const getCategoryAmount = (id: CashCategoryId) => rows.filter(row => row.category === id && (id === 'transfer' || isIncluded(row))).reduce((sum, row) => sum + row.amount, 0);
  const categoryRows = selected ? rows.filter(row => row.category === selected).sort((a, b) => a.date.localeCompare(b.date) || (a.createdAt ?? '').localeCompare(b.createdAt ?? '')) : [];
  const selectedInfo = CATEGORIES.find(category => category.id === selected);

  const exportReport = (format: 'pdf' | 'csv') => {
    const csvRows: string[][] = [[label('তারিখ', 'Date'), label('ধরন', 'Operation'), label('লেনদেন নম্বর', 'Transaction'), label('অ্যাকাউন্ট', 'Account'), label('বিবরণ', 'Description'), label('নগদ প্রবাহ', 'Cash flow')]];
    const sections: ReportDoc['sections'] = [];
    for (const category of CATEGORIES) {
      const categoryList = rows.filter(row => row.category === category.id);
      if (!categoryList.length) continue;
      const catRows: ReportDoc['sections'][number]['rows'] = categoryList.map(row => {
        const flow = `${row.direction === 'in' ? '+' : '−'}${m(row.amount)}`;
        const note = row.note ?? '';
        const transactionLabel = `${row.transactionNo}${note ? ` · ${note}` : ''}`;
        csvRows.push([row.date, label(category.bn, category.en), row.transactionNo, row.accountName, note, `${row.direction === 'in' ? '+' : '-'}${row.amount}`]);
        return { label: `${fd(row.date)} · ${transactionLabel}`, right: flow, neg: row.direction === 'out', cells: [fd(row.date), row.transactionNo, row.accountName, note || label(category.bn, category.en), flow] };
      });
      sections.push({ title: `${label(category.bn, category.en)} · ${m(getCategoryAmount(category.id))}`, columns: [label('তারিখ', 'Date'), label('লেনদেন', 'Transaction'), label('অ্যাকাউন্ট', 'Account'), label('বিবরণ', 'Description'), label('পরিমাণ', 'Amount')], rows: catRows });
    }
    if (format === 'pdf') {
      const doc: ReportDoc = {
        language: lang, shop: business?.name ?? label('চালের আড়ৎ', 'Rice Wholesale'),
        title: label('দৈনিক নগদ হিসাব', 'Daily Cash Dashboard'), period: `${label('তারিখ', 'Date')}: ${fd(date)}`,
        meta: [
          { label: label('প্রারম্ভিক ব্যালেন্স', 'Opening balance'), value: m(opening) },
          { label: label('নগদ গ্রহণ', 'Cash received'), value: m(totalIn) },
          { label: label('নগদ প্রদান', 'Cash paid'), value: m(totalOut) },
          { label: label('বর্তমান সমাপনী ব্যালেন্স', 'Live closing balance'), value: m(closing) },
        ], sections, total: { label: label('সমাপনী ব্যালেন্স', 'Closing balance'), value: m(closing) }, printedAt: printedAtStamp(lang),
        printLabel: label('প্রিন্ট / PDF সংরক্ষণ', 'Print / Save PDF'),
      };
      printReport(doc);
      return;
    }
    downloadCSV(`daily_cash_${date}.csv`, csvRows.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n'));
  };

  const cashAccountsExist = moneyAccounts.some(account => account.type === 'cash');
  const content = <View style={{ gap: 12 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
      {selected ? <Btn kind="ghost" label={label('← ফিরে যান', '← Back')} onPress={() => setSelected(null)} /> : null}
      <Title>{selectedInfo ? label(selectedInfo.bn, selectedInfo.en) : label('দৈনিক নগদ হিসাব', 'Daily Cash Dashboard')}</Title>
      <View style={{ flexDirection: 'row', gap: 8 }}><Btn icon={icons.excel} kind="ghost" label={label('Excel ডাউনলোড (CSV)', 'Download Excel (CSV)')} onPress={() => exportReport('csv')} /><Btn icon={icons.print} kind="ghost" label={label('প্রিন্ট / PDF', 'Print / Save PDF')} onPress={() => exportReport('pdf')} /></View>
    </View>
    <View style={{ marginBottom: 12 }}><DateField label={label('দিন নির্বাচন করুন', 'Select day')} value={date} onChange={setDate} allowPast required /></View>
    {error ? <Card><Text style={{ color: '#B91C1C' }}>{error}</Text><Btn kind="ghost" label={label('আবার চেষ্টা করুন', 'Retry')} onPress={() => { void load(); }} /></Card> : null}
    {!cashAccountsExist ? <Card><Text style={{ color: color.muted }}>{label('ক্যাশ অ্যাকাউন্ট তৈরি করুন, তারপর দৈনিক হিসাব দেখা যাবে।', 'Create a cash account to view the daily cash dashboard.')}</Text></Card> : null}
    {loading ? <ActivityIndicator color={color.primary} style={{ padding: 30 }} /> : <>
      {!selected ? <>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
          {[
            { label: label('দিনের শুরু', 'Opening balance'), value: opening, tone: '#1D4ED8' },
            { label: label('আজ নগদ এসেছে', 'Cash received'), value: totalIn, tone: '#059669' },
            { label: label('আজ নগদ গেছে', 'Cash paid'), value: totalOut, tone: '#DC2626' },
            { label: label('লাইভ সমাপনী ব্যালেন্স', 'Live closing balance'), value: closing, tone: closing < 0 ? '#DC2626' : '#0F172A' },
          ].map(item => <Card key={item.label} style={{ flex: 1, minWidth: 190, padding: 16 }}><Text style={{ color: '#64748B', fontWeight: '700' }}>{item.label}</Text><Text style={{ color: item.tone, fontSize: 23, fontWeight: '900', marginTop: 7 }}>{m(item.value)}</Text>{item.label === label('লাইভ সমাপনী ব্যালেন্স', 'Live closing balance') ? <Text style={{ color: '#64748B', marginTop: 4 }}>{label('দিনের লেনদেনসহ', 'Including today’s transactions')}</Text> : null}</Card>)}
        </View>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
          {CATEGORIES.map(category => {
            const items = rows.filter(row => row.category === category.id);
            return <TouchableOpacity key={category.id} accessibilityRole="button" onPress={() => setSelected(category.id)} style={{ flexGrow: 1, flexBasis: 210, minWidth: 185, backgroundColor: '#fff', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 14, padding: 15, borderTopWidth: 3, borderTopColor: category.tone, shadowColor: '#0F172A', shadowOpacity: 0.04, shadowRadius: 7, shadowOffset: { width: 0, height: 2 }, elevation: 1 }}>
              <Text style={{ color: '#334155', fontWeight: '800' }}>{label(category.bn, category.en)}</Text>
              <Text style={{ color: category.tone, fontSize: 20, fontWeight: '900', marginTop: 8 }}>{m(getCategoryAmount(category.id))}</Text>
              <Text style={{ color: '#64748B', marginTop: 4 }}>{items.length} {label('টি লেনদেন', 'transactions')} · {label('বিস্তারিত দেখুন', 'View details')} ›</Text>
            </TouchableOpacity>;
          })}
        </View>
        <Card style={{ padding: 14 }}>
          <Text style={{ color: color.text, fontSize: 17, fontWeight: '900', marginBottom: 10 }}>{label('আজকের নগদ লেনদেন', 'Today’s cash transactions')}</Text>
          <CashTable rows={rows.filter(isIncluded)} money={m} dateFormat={fd} bn={bn} />
        </Card>
      </> : <Card style={{ padding: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <Text style={{ color: color.text, fontWeight: '900', fontSize: 17 }}>{label(selectedInfo!.bn, selectedInfo!.en)} · {categoryRows.length} {label('টি রেকর্ড', 'records')}</Text>
          <Text style={{ color: selectedInfo!.tone, fontWeight: '900', fontSize: 18 }}>{m(getCategoryAmount(selected!))}</Text>
        </View>
        <CashTable rows={categoryRows} money={m} dateFormat={fd} bn={bn} />
      </Card>}
    </>}
  </View>;
  return embedded ? content : <Screen>{content}</Screen>;
}

function CashTable({ rows, money, dateFormat, bn }: { rows: CashRow[]; money: (value: number) => string; dateFormat: (value: string) => string; bn: boolean }) {
  const tx = (bnText: string, enText: string) => bn ? bnText : enText;
  const { width } = useBreakpoint();
  const compact = width < 1200;
  if (!rows.length) return <Text style={{ color: '#64748B', textAlign: 'center', padding: 22 }}>{tx('এই তারিখে কোনো লেনদেন নেই।', 'No transactions for this date.')}</Text>;
  if (compact) return <View style={{ gap: 9 }}>
    {rows.map(row => {
      const category = CATEGORIES.find(item => item.id === row.category)!;
      return <View key={`${row.id}-${row.accountName}`} style={{ backgroundColor: '#F8FAFC', borderWidth: 1, borderColor: '#E2E8F0', borderRadius: 11, padding: 12, gap: 7 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <Text style={{ color: '#475569', fontWeight: '700' }}>{dateFormat(row.date)}</Text>
          <Text style={{ color: row.direction === 'in' ? '#059669' : '#DC2626', fontWeight: '900' }}>{row.direction === 'in' ? '+' : '−'}{money(row.amount)}</Text>
        </View>
        <Text style={{ color: category.tone, fontWeight: '800' }}>{tx(category.bn, category.en)}</Text>
        <Text style={{ color: color.text }} numberOfLines={3}>{row.transactionNo}{row.note ? ` · ${row.note}` : ''}</Text>
        <Text style={{ color: '#64748B', fontSize: 12 }}>{tx('অ্যাকাউন্ট', 'Account')}: {row.accountName}</Text>
      </View>;
    })}
  </View>;
  return <ScrollView horizontal showsHorizontalScrollIndicator><View style={{ minWidth: 760, width: '100%' }}>
    <View style={{ flexDirection: 'row', backgroundColor: '#E0F2FE', borderRadius: 9, padding: 10 }}>
      {[tx('তারিখ', 'Date'), tx('লেনদেন', 'Operation'), tx('রেফারেন্স / বিবরণ', 'Reference / Description'), tx('অ্যাকাউন্ট', 'Account'), tx('গ্রহণ', 'In'), tx('প্রদান', 'Out')].map((title, index) => <Text key={title} style={{ flex: [0.9, 1.5, 2.4, 1.2, 1, 1][index], color: '#075985', fontWeight: '800' }}>{title}</Text>)}
    </View>
    {rows.map(row => {
      const category = CATEGORIES.find(item => item.id === row.category)!;
      return <View key={`${row.id}-${row.accountName}`} style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
        <Text style={{ flex: 0.9, color: color.text }}>{dateFormat(row.date)}</Text>
        <Text style={{ flex: 1.5, color: category.tone, fontWeight: '700' }}>{tx(category.bn, category.en)}</Text>
        <Text style={{ flex: 2.4, color: color.text }}>{row.transactionNo}{row.note ? ` · ${row.note}` : ''}</Text>
        <Text style={{ flex: 1.2, color: color.text }}>{row.accountName}</Text>
        <Text style={{ flex: 1, color: '#059669', fontWeight: '700' }}>{row.direction === 'in' ? money(row.amount) : '—'}</Text>
        <Text style={{ flex: 1, color: '#DC2626', fontWeight: '700' }}>{row.direction === 'out' ? money(row.amount) : '—'}</Text>
      </View>;
    })}
  </View></ScrollView>;
}
