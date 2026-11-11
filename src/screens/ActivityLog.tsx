import React, { useEffect, useMemo, useState } from 'react';
import { Text, TextInput, TouchableOpacity, View } from 'react-native';
import { api, ActivityRow } from '../api';
import { useApp } from '../store';
import { Card, Title, Btn, Chips, color, useMoney } from '../ui';
import { AppIcon, IconName, icons } from '../icons';

const PAGE = 50;

const ENTITY: Record<string, { bn: string; en: string; icon: IconName; tone: string }> = {
  sale: { bn: 'বিক্রয়', en: 'Sale', icon: icons.sale, tone: color.green },
  purchase: { bn: 'ক্রয়', en: 'Purchase', icon: icons.purchase, tone: color.primary },
  customerPayment: { bn: 'কাস্টমার পেমেন্ট', en: 'Customer payment', icon: icons.moneyIn, tone: color.green },
  vendorPayment: { bn: 'মহাজন পেমেন্ট', en: 'Vendor payment', icon: icons.moneyOut, tone: color.amber },
  transfer: { bn: 'মানি ট্রান্সফার', en: 'Money transfer', icon: icons.transfer, tone: color.purple },
  moneyEntry: { bn: 'নগদ জমা/উত্তোলন', en: 'Money entry', icon: icons.accounts, tone: color.cyan },
  moneyAccount: { bn: 'মানি অ্যাকাউন্ট', en: 'Money account', icon: icons.bank, tone: color.primary },
  expense: { bn: 'খরচ', en: 'Expense', icon: icons.expense, tone: color.red },
  expenseCategory: { bn: 'খরচের ক্যাটাগরি', en: 'Expense category', icon: icons.expense, tone: color.amber },
  product: { bn: 'পণ্য', en: 'Product', icon: icons.products, tone: color.purple },
  stock: { bn: 'স্টক সমন্বয়', en: 'Stock', icon: icons.stock, tone: color.amber },
  customer: { bn: 'কাস্টমার', en: 'Customer', icon: icons.customers, tone: color.cyan },
  vendor: { bn: 'মহাজন', en: 'Vendor', icon: icons.vendors, tone: color.purple },
  return: { bn: 'রিটার্ন', en: 'Return', icon: icons.retSale, tone: color.amber },
  settings: { bn: 'সেটিংস', en: 'Settings', icon: icons.settings, tone: color.primary },
  user: { bn: 'ব্যবহারকারী', en: 'User', icon: icons.customers, tone: color.cyan },
  profile: { bn: 'প্রোফাইল', en: 'Profile', icon: icons.customers, tone: color.primary },
  auth: { bn: 'অ্যাকাউন্ট', en: 'Account', icon: icons.lock, tone: color.green },
  trash: { bn: 'ট্র্যাশ', en: 'Trash', icon: icons.del, tone: color.red },
};

const ACTION: Record<string, { bn: string; en: string }> = {
  edit: { bn: 'সংশোধন করে পোস্ট', en: 'edited and reposted' },
  create: { bn: 'তৈরি', en: 'created' },
  update: { bn: 'আপডেট', en: 'updated' },
  delete: { bn: 'মুছে ফেলা', en: 'deleted' },
  bulk: { bn: 'বাল্ক যোগ', en: 'bulk added' },
  adjust: { bn: 'সমন্বয়', en: 'adjusted' },
  opening: { bn: 'ওপেনিং সেট', en: 'opening set' },
  login: { bn: 'লগইন', en: 'login' },
  restore: { bn: 'পুনরুদ্ধার', en: 'restored' },
  purge: { bn: 'স্থায়ীভাবে মুছে ফেলা', en: 'purged' },
};

const push = (list: string[], value: unknown) => {
  const text = value === undefined || value === null ? '' : String(value).trim();
  if (text) list.push(text);
};

export function ActivityLog() {
  const { lang } = useApp();
  const money = useMoney();
  const l = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [total, setTotal] = useState(0);
  const [group, setGroup] = useState('all');
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(true);
  const [moreBusy, setMoreBusy] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(query.trim()), 400);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setBusy(true); setError('');
    api.activity({ group: group === 'all' ? undefined : group, q: search || undefined, take: PAGE, skip: 0 })
      .then(result => { if (!cancelled) { setRows(result.rows); setTotal(result.total); } })
      .catch(e => { if (!cancelled) setError(e instanceof Error ? e.message : l('লগ লোড করা যায়নি', 'Could not load the log')); })
      .finally(() => { if (!cancelled) setBusy(false); });
    return () => { cancelled = true; };
  }, [group, search, refresh]);

  const more = async () => {
    if (moreBusy) return;
    setMoreBusy(true);
    try {
      const result = await api.activity({ group: group === 'all' ? undefined : group, q: search || undefined, take: PAGE, skip: rows.length });
      setRows(prev => [...prev, ...result.rows]);
      setTotal(result.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : l('লগ লোড করা যায়নি', 'Could not load the log'));
    } finally { setMoreBusy(false); }
  };

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }), [lang]);
  const timeFmt = useMemo(() => new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { hour: '2-digit', minute: '2-digit' }), [lang]);

  const dayLabel = (d: Date) => {
    const today = new Date();
    if (d.toDateString() === today.toDateString()) return l('আজ', 'Today');
    return dateFmt.format(d);
  };

  const sections = useMemo(() => {
    const out: { key: string; label: string; items: ActivityRow[] }[] = [];
    for (const row of rows) {
      const d = new Date(row.createdAt);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      let section = out[out.length - 1];
      if (!section || section.key !== key) {
        section = { key, label: dayLabel(d), items: [] };
        out.push(section);
      }
      section.items.push(row);
    }
    return out;
  }, [rows, lang]);

  return <View style={{ gap: 16 }}>
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 12 }}>
        <View style={{ flex: 1 }}>
          <Title>{l('লগ নোট', 'Log Note')}</Title>
          <Text style={{ color: color.muted, marginTop: 4 }}>{l('সকল কার্যক্রমের সার্বজনীন লগ — কে, কখন, কী করেছে', 'Universal activity log — who did what, and when')}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel={l('রিফ্রেশ', 'Refresh')} onPress={() => setRefresh(v => v + 1)} style={styles.refresh}>
          <AppIcon name={icons.history} size={20} iconColor={color.primary} />
        </TouchableOpacity>
      </View>

      <View style={styles.searchBox}>
        <AppIcon name={icons.search} size={19} iconColor={color.muted} />
        <TextInput
          accessibilityLabel={l('লগ খুঁজুন', 'Search log')}
          value={query}
          onChangeText={setQuery}
          placeholder={l('ব্যবহারকারী, ইনভয়েস বা বিবরণ খুঁজুন…', 'Search user, invoice or note…')}
          placeholderTextColor={color.muted}
          style={styles.searchInput}
        />
        {query ? <TouchableOpacity onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel={l('মুছুন', 'Clear')}><AppIcon name={icons.cancel} size={18} iconColor={color.muted} /></TouchableOpacity> : null}
      </View>

      <Chips
        items={[
          { id: 'all', name: l('সব', 'All') },
          { id: 'sales', name: l('বিক্রয়', 'Sales') },
          { id: 'purchases', name: l('ক্রয়', 'Purchases') },
          { id: 'payments', name: l('পেমেন্ট', 'Payments') },
          { id: 'money', name: l('টাকা', 'Money') },
          { id: 'other', name: l('অন্যান্য', 'Other') },
        ]}
        value={group}
        onPick={setGroup}
      />
      <Text style={{ color: color.muted, fontSize: 13 }}>{total} {l('টি এন্ট্রি', 'entries')}</Text>
    </Card>

    {error ? <Card>
      <Text style={{ color: color.red, marginBottom: 10 }}>{error}</Text>
      <Btn kind="ghost" label={l('আবার চেষ্টা করুন', 'Retry')} onPress={() => setRefresh(v => v + 1)} />
    </Card> : null}

    {!error && !busy && !rows.length ? <Card>
      <View style={{ alignItems: 'center', paddingVertical: 24, gap: 10 }}>
        <View style={styles.emptyIcon}><AppIcon name={icons.history} size={30} iconColor={color.primary} /></View>
        <Text style={{ color: color.text, fontWeight: '700', fontSize: 16 }}>{l('এখনও কোনো লগ নেই', 'No activity yet')}</Text>
        <Text style={{ color: color.muted, textAlign: 'center' }}>{l('বিক্রয়, ক্রয়, পেমেন্ট বা অন্য কাজ করলে এখানে দেখা যাবে।', 'Sales, purchases, payments and other actions will appear here.')}</Text>
      </View>
    </Card> : null}

    {sections.map(section => <Card key={section.key}>
      <Text style={styles.day}>{section.label}</Text>
      {section.items.map(row => {
        const meta = ENTITY[row.entity] ?? { bn: row.entity, en: row.entity, icon: icons.history, tone: color.primary };
        const act = ACTION[row.action] ?? { bn: row.action, en: row.action };
        const detail = row.detail ?? {};
        const subtitle: string[] = [];
        push(subtitle, row.reference ? '#' + row.reference : '');
        push(subtitle, detail.transactionNo ? `${l('লেনদেন আইডি', 'Transaction ID')}: ${detail.transactionNo}` : '');
        push(subtitle, detail.partyName);
        if (detail.from || detail.to) push(subtitle, `${detail.from ?? '?'} → ${detail.to ?? '?'}`);
        push(subtitle, detail.accountName);
        push(subtitle, detail.category ?? detail.customName);
        if (typeof detail.openingStockValue === 'number') {
          push(subtitle, `${l('প্রারম্ভিক মজুদের মূল্য', 'Opening inventory')}: ${money(detail.openingStockValue)}`);
        }
        if (detail.accountingImpact === 'expenseDelete') {
          push(subtitle, l('হিসাবের প্রভাব: খরচের ডেবিট ও ক্যাশ/ব্যাংকের ক্রেডিট সক্রিয় হিসাব থেকে বাদ দেওয়া হয়েছে; মূল লেনদেনের তথ্য সংরক্ষিত।', 'Accounting impact: expense debit and cash/bank credit were removed from active balances; original transaction details are retained.'));
        } else push(subtitle, detail.journalPosting);
        if (typeof detail.failedCount === 'number' && detail.failedCount > 0) {
          push(subtitle, `${detail.failedCount} ${l('টি সারি ব্যর্থ', 'rows skipped')}`);
        }
        if (detail.direction) push(subtitle, detail.direction === 'in' ? l('জমা', 'In') : l('উত্তোলন', 'Out'));
        if (detail.kind) push(subtitle, detail.kind === 'sale' ? l('বিক্রয়', 'Sale') : detail.kind === 'purchase' ? l('ক্রয়', 'Purchase') : detail.kind);
        push(subtitle, detail.note);
        if (typeof detail.previousAmount === 'number' && row.amount != null) {
          push(subtitle, `${l('পরিমাণ', 'Amount')}: ${money(detail.previousAmount)} → ${money(row.amount)}`);
        }
        const count = typeof detail.count === 'number' ? detail.count : typeof detail.items === 'number' ? detail.items : undefined;
        if (count) push(subtitle, `${count} ${l('আইটেম', 'items')}`);
        const role = row.userRole === 'admin' ? l('প্রশাসক', 'Admin') : row.userRole === 'staff' ? l('কর্মী', 'Staff') : '';
        const when = new Date(row.createdAt);
        const title = lang === 'bn' ? `${meta.bn} ${act.bn}` : `${meta.en} ${act.en}`;
        return <View key={row.id} style={styles.row}>
          <View style={[styles.iconBox, { backgroundColor: meta.tone + '18' }]}>
            <AppIcon name={meta.icon} size={20} iconColor={meta.tone} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={styles.rowTitle}>{title}</Text>
              {row.amount != null ? <Text style={styles.amount}>{money(row.amount)}</Text> : null}
            </View>
            {subtitle.length ? <Text style={styles.subtitle} numberOfLines={3}>{subtitle.slice(0, 6).join(' · ')}</Text> : null}
            <Text style={styles.by}>{row.userName}{role ? ` · ${role}` : ''} · {timeFmt.format(when)}</Text>
          </View>
        </View>;
      })}
    </Card>)}

    {busy ? <Text style={{ color: color.muted, textAlign: 'center' }}>{l('লোড হচ্ছে…', 'Loading…')}</Text> : null}
    {!busy && rows.length < total ? <Btn kind="ghost" label={moreBusy ? l('অপেক্ষা করুন…', 'Please wait…') : l('আরও দেখুন', 'Load more')} onPress={more} /> : null}
  </View>;
}

const styles = {
  refresh: { minHeight: 44, minWidth: 44, alignItems: 'center' as const, justifyContent: 'center' as const, borderRadius: 12, backgroundColor: color.primaryLight },
  searchBox: {
    flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, marginTop: 16, marginBottom: 6,
    backgroundColor: '#F7FAFE', borderWidth: 1, borderColor: color.line, borderRadius: 12, paddingHorizontal: 12, minHeight: 48,
  },
  searchInput: { flex: 1, fontSize: 15, color: color.text, paddingVertical: 10, ...({ outlineStyle: 'none' } as any) },
  day: { color: color.text, fontWeight: '700' as const, fontSize: 14, marginBottom: 6 },
  row: { flexDirection: 'row' as const, alignItems: 'flex-start' as const, gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderColor: '#EEF3F8' },
  iconBox: { width: 38, height: 38, borderRadius: 11, alignItems: 'center' as const, justifyContent: 'center' as const },
  rowTitle: { color: color.text, fontWeight: '700' as const, fontSize: 15, flex: 1 },
  amount: { color: color.primary, fontWeight: '700' as const, fontSize: 14 },
  subtitle: { color: color.muted, fontSize: 13, marginTop: 3, lineHeight: 18 },
  by: { color: color.muted, fontSize: 12, marginTop: 3 },
  emptyIcon: { width: 58, height: 58, borderRadius: 18, backgroundColor: color.primaryLight, alignItems: 'center' as const, justifyContent: 'center' as const },
};
