import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, Modal, ScrollView } from 'react-native';
import { useApp, today } from '../store';
import { api, MoneyMovementRow } from '../api';
import { Screen, Card, Title, Btn, Row, Empty, useMoney, useDateStr, color } from '../ui';
import { RGrid } from '../responsive';
import { AppIcon, icons } from '../icons';
import { AccountFormModal, MoneyTransferModal, MoneyEntry, DetailShell, DateField } from '../screens';
import { AccountPage } from './AccountPage';
import { downloadCSV } from '../stockReport';
import { MoneyMovementDetail, MoneyMovementItem } from './MoneyMovementDetail';
import { printReport, printedAtStamp, type ReportDoc } from '../report';
import { showEntryError } from '../entryDialog';

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
  const [bankReportOpen, setBankReportOpen] = useState(false);
  const [bankReportAccountId, setBankReportAccountId] = useState<string | null>(null);
  const [bankReportFrom, setBankReportFrom] = useState('');
  const [bankReportTo, setBankReportTo] = useState('');
  const [bankReportBusy, setBankReportBusy] = useState(false);
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
    houseExpense: label('বাসার খরচ', 'House expense'),
    customerPayment: t('collect'), vendorPayment: t('pay'), expense: t('expense'), saleReturn: t('saleReturnLabel2'), purchaseReturn: t('purchaseReturnLabel'),
    transferIn: t('transferMoney'), transferOut: t('transferMoney'), openingAdjust: t('openingMoney'),
  };
  const accountTypeName = (type: string) => ({ cash: label('নগদ', 'Cash'), bank: label('ব্যাংক', 'Bank') }[type] ?? type);
  // One row per internal transfer; other movements each retain their own row.
  const seen = new Set<string>();
  const recent = rows.filter(row => row.sourceType !== 'openingAdjust').filter(row => { if (!row.transferId) return true; if (seen.has(row.transferId)) return false; seen.add(row.transferId); return true; }).slice(0, 12);
  const buildBankLedgerReport = async (): Promise<{ doc: ReportDoc; csvRows: string[][] } | null> => {
    if (bankReportFrom && bankReportTo && bankReportFrom > bankReportTo) {
      showEntryError(lang, label('Start date must be on or before the end date.', 'শুরুর তারিখ শেষ তারিখের আগে বা সমান হতে হবে।'));
      return null;
    }
    const end = bankReportTo || today();
    const accounts = moneyAccounts.filter(account => !bankReportAccountId || account.id === bankReportAccountId);
    if (!accounts.length) {
      showEntryError(lang, label('No account is available for this report.', 'এই রিপোর্টের জন্য কোনো অ্যাকাউন্ট নেই।'));
      return null;
    }
    setBankReportBusy(true);
    try {
      const priorDate = bankReportFrom ? (() => {
        const value = new Date(`${bankReportFrom}T00:00:00.000Z`);
        value.setUTCDate(value.getUTCDate() - 1);
        return value.toISOString().slice(0, 10);
      })() : '';
      const [details, priorBalances] = await Promise.all([
        Promise.all(accounts.map(account => api.moneyAccountDetail(account.id))),
        priorDate ? api.moneyAccountsAsOf(priorDate) : Promise.resolve(null),
      ]);
      const sections: ReportDoc['sections'] = [];
      const csvRows: string[][] = [[label('Name', 'নাম'), label('Amount', 'পরিমাণ'), label('Balance', 'ব্যালেন্স')]];
      let allOpening = 0, allClosing = 0, allDebit = 0, allCredit = 0;
      for (const detail of details) {
        const account = detail.account;
        const from = bankReportFrom || account.openingDate;
        const openingBalance = bankReportFrom
          ? priorBalances?.accounts.find(row => row.id === account.id)?.balance ?? 0
          : account.openingDate <= end ? account.openingBalance : 0;
        let running = openingBalance;
        const movements = detail.movements.filter(row => row.date >= from && row.date <= end)
          .sort((a, b) => a.date.localeCompare(b.date) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')) || a.id.localeCompare(b.id));
        const reportRows: ReportDoc['sections'][number]['rows'] = [{ label: label('Opening balance', 'প্রারম্ভিক ব্যালেন্স'), right: m(openingBalance), bold: true, cells: [label('Opening balance', 'প্রারম্ভিক ব্যালেন্স'), m(0), m(openingBalance)] }];
        csvRows.push([`${account.name} · ${label('Opening balance', 'প্রারম্ভিক ব্যালেন্স')} · ${from}`, '0', String(openingBalance)]);
        let debitTotal = 0, creditTotal = 0;
        for (const movement of movements) {
          const debit = movement.direction === 'in' ? movement.amount : 0;
          const credit = movement.direction === 'out' ? movement.amount : 0;
          debitTotal += debit;
          creditTotal += credit;
          running = Math.round((running + debit - credit) * 100) / 100;
          const other = moneyAccounts.find(item => item.id === movement.counterpartyAccountId)?.name;
          const description = [names[movement.sourceType] ?? movement.sourceType, movement.transferNo && other ? `${movement.transferNo} · ${other}` : movement.transferNo, movement.note].filter(Boolean).join(' · ');
          const signedAmount = debit ? debit : -credit;
          const name = `${fd(movement.date)} · ${movement.transferNo ?? movement.transactionNo} · ${description}`;
          reportRows.push({ label: name, right: m(running), neg: running < 0, cells: [name, m(signedAmount), m(running)] });
          csvRows.push([`${account.name} · ${name}`, String(signedAmount), String(running)]);
        }
        const closing = Math.round(running * 100) / 100;
        reportRows.push({ label: label('Closing balance', 'সমাপনী ব্যালেন্স'), right: m(closing), bold: true, neg: closing < 0, cells: [label('Closing balance', 'সমাপনী ব্যালেন্স'), m(0), m(closing)] });
        csvRows.push([`${account.name} · ${label('Closing balance', 'সমাপনী ব্যালেন্স')} · ${end}`, '0', String(closing)]);
        sections.push({ title: `${account.name} · ${accountTypeName(account.type)}`, columns: [label('Name', 'নাম'), label('Amount', 'পরিমাণ'), label('Balance', 'ব্যালেন্স')], rows: reportRows });
        allOpening += openingBalance;
        allClosing += closing;
        allDebit += debitTotal;
        allCredit += creditTotal;
      }
      const doc: ReportDoc = {
        language: lang,
        shop: label('Bank & Cash', 'ব্যাংক ও নগদ'),
        title: label('Bank and Cash Ledger', 'ব্যাংক ও নগদ খতিয়ান'),
        period: `${bankReportFrom || label('Account opening', 'অ্যাকাউন্ট খোলার তারিখ')} – ${end}`,
        meta: [
          { label: label('Opening balance', 'প্রারম্ভিক ব্যালেন্স'), value: m(allOpening) },
          { label: label('Debit total', 'মোট ডেবিট'), value: m(allDebit) },
          { label: label('Credit total', 'মোট ক্রেডিট'), value: m(allCredit) },
          { label: label('Closing balance', 'সমাপনী ব্যালেন্স'), value: m(allClosing) },
        ],
        sections,
        total: { label: label('Closing balance', 'সমাপনী ব্যালেন্স'), value: m(allClosing) },
        printedAt: printedAtStamp(lang),
        printLabel: label('Print / Save PDF', 'প্রিন্ট / PDF সংরক্ষণ'),
      };
      return { doc, csvRows };
    } catch (error) {
      showEntryError(lang, error instanceof Error ? error.message : label('Could not build bank and cash report.', 'ব্যাংক ও নগদ রিপোর্ট তৈরি করা যায়নি।'));
      return null;
    } finally {
      setBankReportBusy(false);
    }
  };
  const exportBankReport = async (format: 'pdf' | 'csv') => {
    if (bankReportBusy) return;
    const result = await buildBankLedgerReport();
    if (!result) return;
    if (format === 'pdf') {
      if (!printReport(result.doc)) showEntryError(lang, label('Could not open the print dialog.', 'প্রিন্ট ডায়ালগ খোলা যায়নি।'));
      return;
    }
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = result.csvRows.map(row => row.map(cell).join(',')).join('\r\n');
    downloadCSV(`bank_cash_ledger_${bankReportFrom || 'all'}_${bankReportTo || today()}.csv`, csv);
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
        <Btn label={label('রিপোর্ট ডাউনলোড', 'Download report')} icon={icons.excel} kind="ghost" onPress={() => setBankReportOpen(true)} />
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
    <Modal visible={bankReportOpen} transparent animationType="fade" onRequestClose={() => setBankReportOpen(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.48)', justifyContent: 'center', padding: 14 }}>
        <View style={{ width: '100%', maxWidth: 620, maxHeight: '92%', alignSelf: 'center', backgroundColor: '#F8FAFC', borderRadius: 18, overflow: 'hidden' }}>
          <View style={{ backgroundColor: '#123D64', paddingHorizontal: 16, paddingVertical: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <View><Text style={{ color: '#FFFFFF', fontSize: 19, fontWeight: '800' }}>{label('Bank & Cash report', 'ব্যাংক ও নগদ রিপোর্ট')}</Text><Text style={{ color: '#D6E7F5', fontSize: 12, marginTop: 2 }}>{label('Opening, debit, credit, running and closing balances', 'প্রারম্ভিক, ডেবিট, ক্রেডিট, চলতি ও সমাপনী ব্যালেন্স')}</Text></View>
            <TouchableOpacity onPress={() => setBankReportOpen(false)} accessibilityRole="button" style={{ minWidth: 42, minHeight: 42, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#FFFFFF', fontSize: 26 }}>×</Text></TouchableOpacity>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 11 }}>
            <Card>
              <Text style={{ color: '#123D64', fontSize: 15, fontWeight: '800', marginBottom: 8 }}>{label('Select date range', 'তারিখের সীমা নির্বাচন')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                <View style={{ flex: 1, minWidth: 180 }}><DateField label={label('From date', 'শুরুর তারিখ')} value={bankReportFrom} onChange={setBankReportFrom} clearable /></View>
                <View style={{ flex: 1, minWidth: 180 }}><DateField label={label('To date', 'শেষ তারিখ')} value={bankReportTo} onChange={setBankReportTo} clearable minDate={bankReportFrom || undefined} /></View>
              </View>
              <Text style={{ color: '#475569', fontSize: 13, fontWeight: '700', marginBottom: 7 }}>{label('Account', 'অ্যাকাউন্ট')}</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
                <TouchableOpacity onPress={() => setBankReportAccountId(null)} style={{ borderRadius: 18, borderWidth: 1, borderColor: bankReportAccountId === null ? '#1D4ED8' : '#CBD5E1', backgroundColor: bankReportAccountId === null ? '#EFF6FF' : '#FFFFFF', paddingHorizontal: 12, paddingVertical: 8 }}><Text style={{ color: bankReportAccountId === null ? '#1D4ED8' : '#334155', fontWeight: '700' }}>{label('All accounts', 'সকল অ্যাকাউন্ট')}</Text></TouchableOpacity>
                {moneyAccounts.map(account => <TouchableOpacity key={account.id} onPress={() => setBankReportAccountId(account.id)} style={{ borderRadius: 18, borderWidth: 1, borderColor: bankReportAccountId === account.id ? '#1D4ED8' : '#CBD5E1', backgroundColor: bankReportAccountId === account.id ? '#EFF6FF' : '#FFFFFF', paddingHorizontal: 12, paddingVertical: 8 }}><Text style={{ color: bankReportAccountId === account.id ? '#1D4ED8' : '#334155', fontWeight: '700' }}>{account.name}</Text></TouchableOpacity>)}
              </View>
              <Text style={{ color: '#64748B', fontSize: 12, marginTop: 8 }}>{label('The report includes each account’s opening balance, transactions with debit and credit amounts, a running balance, and closing balance.', 'রিপোর্টে প্রতিটি অ্যাকাউন্টের প্রারম্ভিক ব্যালেন্স, ডেবিট-ক্রেডিটসহ লেনদেন, প্রতিটি লাইনের চলতি ব্যালেন্স এবং সমাপনী ব্যালেন্স থাকবে।')}</Text>
            </Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Btn icon={icons.excel} label={bankReportBusy ? label('Preparing…', 'তৈরি হচ্ছে…') : label('Download Excel (CSV)', 'এক্সেল ডাউনলোড (CSV)')} onPress={() => { void exportBankReport('csv'); }} />
              <Btn kind="ghost" icon={icons.print} label={label('Print / Save PDF', 'প্রিন্ট / PDF সংরক্ষণ')} onPress={() => { void exportBankReport('pdf'); }} />
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  </Screen>;
}
