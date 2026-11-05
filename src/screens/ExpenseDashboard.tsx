import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Text, TouchableOpacity, View } from 'react-native';
import { useApp, today } from '../store';
import { api, type Expense, type ExpenseCategoryKind, type ExpenseCategoryRow } from '../api';
import {
  AccountPicker,
  Btn,
  Card,
  Chips,
  Empty,
  Field,
  ListTable,
  Muted,
  PageHeader,
  Screen,
  Title,
  color,
  useAccountName,
  useDateStr,
  useMoney,
  useNum,
  type TableColumn,
} from '../ui';
import { AppIcon, icons, type IconName } from '../icons';
import { RGrid, useBreakpoint, useFs } from '../responsive';
import { parseNum, toEnDigits } from '../bn';
import { SearchField } from '../search';
import { downloadCSV } from '../stockReport';
import { DetailShell } from '../screens';

type Cat = { id: string; name: string; kind: ExpenseCategoryKind; key?: string; custom?: boolean; customName?: string };

const SYSTEM_META: { key: string; kind: ExpenseCategoryKind; bn: string; en: string }[] = [
  { key: 'loading', kind: 'landing', bn: 'ল্যান্ডিং খরচ', en: 'Landing Cost' },
  { key: 'salary', kind: 'operating', bn: 'কর্মচারীর বেতন', en: 'Salary' },
  { key: 'rent', kind: 'operating', bn: 'দোকান/গুদাম ভাড়া', en: 'Shop/Warehouse Rent' },
  { key: 'electricity', kind: 'operating', bn: 'বিদ্যুৎ বিল', en: 'Electricity Bill' },
  { key: 'water', kind: 'operating', bn: 'পানি বিল', en: 'Water Bill' },
  { key: 'gas', kind: 'operating', bn: 'গ্যাস বিল', en: 'Gas Bill' },
  { key: 'internet', kind: 'operating', bn: 'ইন্টারনেট/মোবাইল বিল', en: 'Internet/Mobile Bill' },
  { key: 'lunch', kind: 'operating', bn: 'দুপুরের খাবার', en: 'Lunch' },
  { key: 'tea', kind: 'operating', bn: 'চা/নাস্তা', en: 'Tea/Snacks' },
  { key: 'labour', kind: 'landing', bn: 'শ্রমিক খরচ', en: 'Labour Cost' },
  { key: 'transport', kind: 'transport', bn: 'পরিবহন ভাড়া', en: 'Transport' },
  { key: 'vehicle', kind: 'transport', bn: 'গাড়ি/ভ্যান ভাড়া', en: 'Vehicle/Van Rent' },
  { key: 'fuel', kind: 'transport', bn: 'জ্বালানি', en: 'Fuel' },
  { key: 'bags', kind: 'operating', bn: 'বস্তা/প্যাকেজিং', en: 'Bags/Packaging' },
  { key: 'shopRepair', kind: 'operating', bn: 'দোকান/গুদাম মেরামত', en: 'Shop/Warehouse Maintenance' },
  { key: 'vehicleRepair', kind: 'operating', bn: 'গাড়ি মেরামত', en: 'Vehicle Maintenance' },
  { key: 'cleaning', kind: 'operating', bn: 'পরিষ্কার-পরিচ্ছন্নতা', en: 'Cleaning' },
  { key: 'office', kind: 'operating', bn: 'অফিস সামগ্রী', en: 'Office Supplies' },
  { key: 'bankCharge', kind: 'operating', bn: 'ব্যাংক/মোবাইল ব্যাংকিং চার্জ', en: 'Bank/Mobile Banking Charge' },
];

const KIND_OPTIONS: { id: ExpenseCategoryKind; bn: string; en: string }[] = [
  { id: 'operating', bn: 'পরিচালন খরচ', en: 'Operating Expenses' },
  { id: 'landing', bn: 'ল্যান্ডিং খরচ', en: 'Landing Cost' },
  { id: 'transport', bn: 'পরিবহন খরচ', en: 'Transport Cost' },
  { id: 'other', bn: 'অন্যান্য', en: 'Other' },
];

const PAGE_SIZE = 10;

interface ExpenseDashboardProps {
  go?: (route: string) => void;
}

export function ExpenseDashboard(_props: ExpenseDashboardProps) {
  const { expenses, moneyAccounts, saveExpense, deleteExpense, lang } = useApp();
  const m = useMoney();
  const n = useNum();
  const fd = useDateStr();
  const accountName = useAccountName();
  const { isMobile } = useBreakpoint();
  const fs = useFs(13, 14);
  const tx = useCallback((bn: string, en: string) => (lang === 'bn' ? bn : en), [lang]);

  const [customCats, setCustomCats] = useState<ExpenseCategoryRow[]>([]);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [catOpen, setCatOpen] = useState(false);
  const [categoryManageOpen, setCategoryManageOpen] = useState(false);
  const [catEditId, setCatEditId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [voucher, setVoucher] = useState('');
  const [date, setDate] = useState(today());
  const [catId, setCatId] = useState('');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [catName, setCatName] = useState('');
  const [catKind, setCatKind] = useState<ExpenseCategoryKind>('operating');
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState('');
  const [deleteCategoryTarget, setDeleteCategoryTarget] = useState<ExpenseCategoryRow | null>(null);

  useEffect(() => {
    let live = true;
    api.expenseCategories()
      .then(rows => { if (live) setCustomCats(rows); })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  const categoryByLower = useMemo(
    () => new Map(customCats.map(c => [c.name.toLowerCase(), c])),
    [customCats],
  );

  const allCategories = useMemo<Cat[]>(() => {
    const list: Cat[] = [];
    const seen = new Set<string>();
    const add = (cat: Cat, dedupe: string) => {
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      list.push(cat);
    };
    add({ id: 'builtin:other', name: lang === 'bn' ? '\u0985\u09a8\u09cd\u09af\u09be\u09a8\u09cd\u09af' : 'Other', kind: 'other', key: 'other' }, 'builtin:other');
    customCats.forEach(c => {
      add(
        { id: `custom:${c.id}`, name: c.name, kind: c.kind, custom: true },
        `name:${c.name.toLowerCase()}`,
      );
    });
    expenses.forEach(e => {
      if (e.category === 'other') {
        if (!e.customName) return;
        const lower = e.customName.toLowerCase();
        if (categoryByLower.has(lower)) return;
        add(
          { id: `custom-name:${e.customName}`, name: e.customName, kind: 'other', custom: true },
          `name:${lower}`,
        );
        return;
      }
      const meta = SYSTEM_META.find(b => b.key === e.category);
      const customName = e.customName ?? '';
      add(
        {
          id: customName ? `expense:${e.category}:${customName}` : `builtin:${e.category}`,
          name: customName || (meta ? (lang === 'bn' ? meta.bn : meta.en) : e.category),
          kind: meta?.kind ?? 'operating',
          key: e.category,
          customName: customName || undefined,
        },
        customName ? `system:${e.category}:${customName.toLowerCase()}` : `builtin:${e.category}`,
      );
    });
    return list;
  }, [customCats, expenses, lang, categoryByLower]);

  const defaultCatId = useMemo(() => allCategories[0]?.id ?? '', [allCategories]);
  const defaultAccountId = useMemo(() => moneyAccounts.find(a => a.active)?.id ?? '', [moneyAccounts]);

  const catIdOf = useCallback((e: Expense) => {
    if (e.category === 'other' && e.customName) {
      const row = categoryByLower.get(e.customName.toLowerCase());
      return row ? `custom:${row.id}` : `custom-name:${e.customName}`;
    }
    return e.customName ? `expense:${e.category}:${e.customName}` : `builtin:${e.category}`;
  }, [categoryByLower]);

  const kindOf = useCallback((e: Expense): ExpenseCategoryKind => {
    if (e.category === 'other' && e.customName) {
      return categoryByLower.get(e.customName.toLowerCase())?.kind ?? 'other';
    }
    return SYSTEM_META.find(b => b.key === e.category)?.kind ?? (e.category === 'other' ? 'other' : 'operating');
  }, [categoryByLower]);

  const catLabel = useCallback((e: Expense) => {
    if (e.customName) return e.customName;
    const b = SYSTEM_META.find(x => x.key === e.category);
    return b ? (lang === 'bn' ? b.bn : b.en) : e.category === 'other' ? (lang === 'bn' ? '\u0985\u09a8\u09cd\u09af\u09be\u09a8\u09cd\u09af' : 'Other') : e.category;
  }, [lang]);

  const total = useMemo(() => expenses.reduce((s, e) => s + e.amount, 0), [expenses]);
  const operating = useMemo(() => expenses.filter(e => !e.capitalized && kindOf(e) === 'operating').reduce((s, e) => s + e.amount, 0), [expenses, kindOf]);
  const landing = useMemo(() => expenses.filter(e => kindOf(e) === 'landing').reduce((s, e) => s + e.amount, 0), [expenses, kindOf]);
  const todayTotal = useMemo(() => {
    const d = today();
    return expenses.filter(e => e.date === d).reduce((s, e) => s + e.amount, 0);
  }, [expenses]);

  const filterItems = useMemo(
    () => [{ id: 'all', name: tx('সব', 'All') }, ...allCategories.map(c => ({ id: c.id, name: c.name }))],
    [allCategories, tx],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return expenses
      .filter(e => catFilter === 'all' || catIdOf(e) === catFilter)
      .filter(e => {
        if (!q) return true;
        return [e.voucherNo, catLabel(e), e.note, accountName(e.accountId), String(e.amount)]
          .some(v => String(v ?? '').toLowerCase().includes(q));
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, catFilter, search, catIdOf, catLabel, accountName]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);
  const paged = useMemo(
    () => filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [filtered, safePage],
  );

  useEffect(() => { setPage(1); }, [search, catFilter]);

  const openNew = useCallback((initialCat?: string) => {
    setEditId(null);
    setVoucher('');
    setDate(today());
    setAmount('');
    setNote('');
    setFormError('');
    setAccountId(defaultAccountId);
    setCatId(initialCat && initialCat !== 'all' ? initialCat : defaultCatId);
    setFormOpen(true);
  }, [defaultAccountId, defaultCatId]);

  const openEdit = useCallback((e: Expense) => {
    const current = catIdOf(e);
    setEditId(e.id);
    setVoucher(e.voucherNo ?? '');
    setDate(e.date);
    setAmount(String(e.amount));
    setNote(e.note ?? '');
    setAccountId(e.accountId ?? defaultAccountId);
    setCatId(allCategories.some(c => c.id === current) ? current : defaultCatId);
    setFormError('');
    setFormOpen(true);
  }, [allCategories, catIdOf, defaultAccountId, defaultCatId]);

  const save = async () => {
    const cat = allCategories.find(c => c.id === catId);
    const value = parseNum(amount);
    if (!cat) { setFormError(tx('একটি ক্যাটাগরি বাছুন।', 'Choose a category.')); return; }
    if (value <= 0) { setFormError(tx('সঠিক পরিমাণ লিখুন।', 'Enter a valid amount.')); return; }
    if (!accountId) { setFormError(tx('টাকার অ্যাকাউন্ট বাছুন।', 'Choose a money account.')); return; }
    setSaving(true);
    setFormError('');
    try {
      await saveExpense({
        id: editId ?? undefined,
        category: cat.custom ? 'other' : cat.key!,
        customName: cat.custom ? cat.name : '',
        amount: value,
        accountId,
        date: toEnDigits(date),
        note: note.trim() || undefined,
      });
      setFormOpen(false);
    } catch (e: any) {
      setFormError(e?.message ?? tx('খরচ সংরক্ষণ করা যায়নি।', 'Could not save the expense.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!editId) return;
    Alert.alert(
      tx('খরচ মুছবেন?', 'Delete expense?'),
      tx('এই খরচটি ট্র্যাশে যাবে।', 'This expense will be moved to Trash.'),
      [
        { text: tx('বাতিল', 'Cancel'), style: 'cancel' },
        {
          text: tx('মুছুন', 'Delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteExpense(editId);
              setFormOpen(false);
            } catch (e: any) {
              setFormError(e?.message ?? tx('খরচ মোছা যায়নি।', 'Could not delete the expense.'));
            }
          },
        },
      ],
    );
  };

  const createCategory = async () => {
    const name = catName.trim();
    if (!name) { setCatError(tx('ক্যাটাগরির নাম লিখুন।', 'Enter a category name.')); return; }
    if (allCategories.some(c => c.id !== `custom:${catEditId}` && c.name.trim().toLowerCase() === name.toLowerCase())) {
      setCatError(tx('এই নামে ক্যাটাগরি আছে।', 'A category with this name already exists.'));
      return;
    }
    setCatBusy(true);
    setCatError('');
    try {
      const row = catEditId
        ? await api.updateExpenseCategory(catEditId, { name, kind: catKind })
        : await api.createExpenseCategory({ name, kind: catKind });
      setCustomCats(prev => catEditId ? prev.map(c => c.id === row.id ? row : c) : [...prev, row]);
      const id = `custom:${row.id}`;
      setCatOpen(false);
      if (formOpen) setCatId(id);
      else setCatFilter(id);
      setCatEditId(null);
    } catch (e: any) {
      setCatError(e?.message ?? tx('ক্যাটাগরি তৈরি করা যায়নি।', 'Could not create the category.'));
    } finally {
      setCatBusy(false);
    }
  };

  const editCategory = (category: ExpenseCategoryRow) => {
    setCatEditId(category.id);
    setCatName(category.name);
    setCatKind(category.kind);
    setCatError('');
    setCategoryManageOpen(false);
    setCatOpen(true);
  };

  const removeCategory = (category: ExpenseCategoryRow) => setDeleteCategoryTarget(category);

  const confirmDeleteCategory = async () => {
    const category = deleteCategoryTarget;
    if (!category) return;
    setCatError('');
    try {
      await api.deleteExpenseCategory(category.id);
      setCustomCats(prev => prev.filter(c => c.id !== category.id));
      if (catFilter === 'custom:' + category.id) setCatFilter('all');
      if (catId === 'custom:' + category.id) {
        setCatId(allCategories.find(c => c.id !== 'custom:' + category.id)?.id ?? 'builtin:other');
      }
      setDeleteCategoryTarget(null);
    } catch (e: any) {
      setCatError(e?.message ?? 'Could not delete the category.');
      setDeleteCategoryTarget(null);
    }
  };
  const columns = useMemo<TableColumn<Expense>[]>(() => {
    const cols: TableColumn<Expense>[] = [
      {
        key: 'date',
        label: tx('তারিখ', 'Date'),
        flex: 1,
        sort: r => r.date,
        render: (r, size) => (
          <View>
            <Text style={{ fontSize: size, color: color.text, fontWeight: '600' }}>{fd(r.date)}</Text>
            {r.voucherNo ? <Text style={{ fontSize: size - 2, color: color.muted }}>#{r.voucherNo}</Text> : null}
          </View>
        ),
      },
      {
        key: 'category',
        label: tx('ক্যাটাগরি', 'Category'),
        flex: 1.7,
        render: (r, size) => (
          <View>
            <Text style={{ fontSize: size, color: color.text, fontWeight: '600' }}>{catLabel(r)}</Text>
            {r.capitalized ? <Text style={{ fontSize: size - 2, color: color.purple }}>{tx('মজুদের মূল্যে যোগ; পরিচালন খরচ নয়', 'Added to inventory cost; not an operating expense')}</Text> : null}
            {r.note ? <Text numberOfLines={1} style={{ fontSize: size - 2, color: color.muted }}>{r.note}</Text> : null}
            {isMobile && accountName(r.accountId) ? <Text style={{ fontSize: size - 2, color: color.muted }}>{accountName(r.accountId)}</Text> : null}
          </View>
        ),
      },
    ];
    if (!isMobile) {
      cols.push({
        key: 'account',
        label: tx('অ্যাকাউন্ট', 'Account'),
        flex: 1.2,
        render: (r, size) => (
          <Text style={{ fontSize: size, color: color.text }}>{accountName(r.accountId) || '-'}</Text>
        ),
      });
    }
    cols.push({
      key: 'amount',
      label: tx('পরিমাণ', 'Amount'),
      flex: 1,
      align: 'right',
      sort: r => r.amount,
      render: (r, size) => (
        <Text style={{ fontSize: size, color: color.red, fontWeight: '700', textAlign: 'right' }}>-{m(r.amount)}</Text>
      ),
    });
    return cols;
  }, [accountName, catLabel, fd, isMobile, m, tx]);

  const exportFilteredExpenses = () => {
    const cell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [
      [tx('তারিখ', 'Date'), tx('খাত', 'Category'), tx('হিসাবের ধরন', 'Treatment'), tx('অ্যাকাউন্ট', 'Account'), tx('বিবরণ', 'Note'), tx('পরিমাণ', 'Amount')].map(cell).join(','),
      ...filtered.map(e => [e.date, catLabel(e), e.capitalized ? tx('মজুদের মূল্যে যোগ', 'Capitalized into inventory') : tx('পরিচালন খরচ', 'Operating expense'), accountName(e.accountId), e.note ?? '', e.amount].map(cell).join(',')),
    ].join('\r\n');
    downloadCSV(`expense_report_${today()}.csv`, csv);
  };

  return (
    <Screen maxWidth={1400}>
      <PageHeader
        title={tx('খরচ ড্যাশবোর্ড', 'Expense Dashboard')}
        subtitle={tx('সব খরচ, ক্যাটাগরি ও ল্যান্ডিং খরচ এক জায়গায়', 'All expenses, categories and landing costs in one place')}
        icon={icons.expense}
        actions={<View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Btn kind="ghost" label={tx('রিপোর্ট ডাউনলোড', 'Download report')} icon={icons.excel} onPress={exportFilteredExpenses} />
          <Btn label={tx('নতুন খরচ', 'New Expense')} icon={icons.plus} onPress={() => openNew(catFilter)} testID="expense-new" />
        </View>}
      />

      <RGrid mobile={2} tablet={2} desktop={4}>
        <SummaryCard label={tx('মোট পরিশোধ', 'Total Cash Paid')} value={m(total)} sub={tx('মজুদে যোগ করা ল্যান্ডিং খরচসহ', 'Includes costs capitalized into stock')} icon={icons.expense} tone={color.primary} />
        <SummaryCard label={tx('পরিচালন খরচ', 'Operating')} value={m(operating)} sub={tx('দৈনন্দিন খরচ', 'Running costs')} icon={icons.office} tone={color.amber} />
        <SummaryCard label={tx('ল্যান্ডিং খরচ', 'Landing Cost')} value={m(landing)} sub={tx('লোডিং ও শ্রমিক', 'Loading and labour')} icon={icons.ship} tone={color.purple} />
        <SummaryCard label={tx('আজকের খরচ', 'Today')} value={m(todayTotal)} sub={fd(today())} icon={icons.history} tone={color.green} />
      </RGrid>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
          <Title>{tx('ক্যাটাগরি', 'Categories')}</Title>
          <Btn
            label='Categories'
            kind="ghost"
            icon={icons.plus}
            onPress={() => { setCatError(''); setCategoryManageOpen(true); }}
          />
        </View>
        <Muted>{tx('ক্যাটাগরি বেছে নিলে নিচের টেবিলে সেই খরচগুলো দেখাবে।', 'Pick a category to filter the expense table below.')}</Muted>
        <Chips items={filterItems} value={catFilter} onPick={setCatFilter} />
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
          <View style={{ flex: 1, minWidth: 220 }}>
            <Title>{tx('সাম্প্রতিক খরচ', 'Recent Expenses')}</Title>
            <Muted>{`${n(filtered.length)} ${tx('টি খরচ', 'expenses')}`}</Muted>
          </View>
          <View style={{ width: 280, maxWidth: '100%' }}>
            <SearchField value={search} onChange={setSearch} placeholder={tx('খরচ, নোট বা ভাউচার খুঁজুন', 'Search expense, note or voucher')} />
          </View>
        </View>

        {filtered.length ? (
          <ListTable
            columns={columns}
            rows={paged}
            rowKey={r => r.id}
            onRowPress={openEdit}
            empty={<Empty />}
          />
        ) : (
          <Empty />
        )}

        {filtered.length > PAGE_SIZE ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 10, gap: 8 }}>
            <Text style={{ color: color.muted, fontSize: fs }}>
              {tx('পৃষ্ঠা', 'Page')} {n(safePage)} / {n(pageCount)}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {safePage > 1 ? <Btn label={tx('আগের', 'Previous')} kind="ghost" onPress={() => setPage(p => Math.max(1, p - 1))} /> : null}
              {safePage < pageCount ? <Btn label={tx('পরের', 'Next')} kind="ghost" onPress={() => setPage(p => Math.min(pageCount, p + 1))} /> : null}
            </View>
          </View>
        ) : null}
      </Card>

      {formOpen ? (
        <DetailShell
          title={editId ? tx('খরচ সম্পাদনা', 'Edit Expense') : tx('নতুন খরচ', 'New Expense')}
          onClose={() => setFormOpen(false)}
          footer={
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {editId ? <Btn label={tx('মুছুন', 'Delete')} kind="danger" icon={icons.del} onPress={remove} /> : null}
              <View style={{ flex: 1 }} />
              <Btn label={saving ? tx('সংরক্ষণ হচ্ছে...', 'Saving...') : tx('সংরক্ষণ', 'Save')} onPress={save} />
            </View>
          }
        >
          {voucher ? <Muted>{tx('ভাউচার', 'Voucher')}: #{voucher}</Muted> : null}
          <Field label={tx('তারিখ', 'Date')} value={date} onChange={setDate} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
            <Muted>{tx('ক্যাটাগরি', 'Category')} *</Muted>
          </View>
          <Chips items={allCategories} value={catId} onPick={setCatId} />
          <Field label={tx('পরিমাণ', 'Amount')} value={amount} onChange={setAmount} num />
          <AccountPicker accountId={accountId} onPick={setAccountId} label={tx('টাকার অ্যাকাউন্ট', 'Money Account')} required />
          <Field label={tx('নোট (ঐচ্ছিক)', 'Note (optional)')} value={note} onChange={setNote} />
          {formError ? <Text style={{ color: color.red, marginTop: 4, fontSize: fs }}>{formError}</Text> : null}
        </DetailShell>
      ) : null}

      {categoryManageOpen ? (
        <DetailShell title="Manage Categories" onClose={() => setCategoryManageOpen(false)}>
          <Btn
            label="New Category"
            icon={icons.plus}
            onPress={() => {
              setCatEditId(null);
              setCatName('');
              setCatKind('operating');
              setCatError('');
              setCategoryManageOpen(false);
              setCatOpen(true);
            }}
          />
          {deleteCategoryTarget ? (
            <View style={{ padding: 14, borderWidth: 1, borderColor: color.line, borderRadius: 10, gap: 10, marginTop: 12 }}>
              <Text style={{ color: color.text }}>
                Delete "{deleteCategoryTarget.name}"? Existing expenses will stay under Other.
              </Text>
              <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8 }}>
                <Btn label="Cancel" kind="ghost" onPress={() => setDeleteCategoryTarget(null)} />
                <Btn label="Delete" kind="danger" icon={icons.del} onPress={confirmDeleteCategory} />
              </View>
            </View>
          ) : null}
          <View style={{ gap: 8, marginTop: 10 }}>
            {customCats.length ? customCats.map(category => (
              <View key={category.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderWidth: 1, borderColor: color.line, borderRadius: 10 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: color.text, fontWeight: '700' }}>{category.name}</Text>
                  <Text style={{ color: color.muted, fontSize: 12 }}>
                    {KIND_OPTIONS.find(k => k.id === category.kind)?.[lang === 'bn' ? 'bn' : 'en'] ?? category.kind}
                  </Text>
                </View>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Edit category" onPress={() => editCategory(category)} style={{ padding: 8 }}>
                  <AppIcon name={icons.edit} size={18} iconColor={color.primary} />
                </TouchableOpacity>
                <TouchableOpacity accessibilityRole="button" accessibilityLabel="Delete category" onPress={() => removeCategory(category)} style={{ padding: 8 }}>
                  <AppIcon name={icons.del} size={18} iconColor={color.red} />
                </TouchableOpacity>
              </View>
            )) : <Muted>No custom categories yet.</Muted>}
            {catError ? <Text style={{ color: color.red, fontSize: fs }}>{catError}</Text> : null}
          </View>
        </DetailShell>
      ) : null}
      {catOpen ? (
        <DetailShell
          title={catEditId ? 'Edit Category' : 'New Category'}
          onClose={() => { setCatOpen(false); setCatEditId(null); }}
          footer={<Btn label={catBusy ? tx('তৈরি হচ্ছে...', 'Creating...') : catEditId ? 'Save Category' : 'Create Category'} onPress={createCategory} />}
        >
          <Field label={tx('ক্যাটাগরির নাম', 'Category Name')} value={catName} onChange={setCatName} />
          <Muted>{tx('ধরন', 'Type')}</Muted>
          <Chips
            items={KIND_OPTIONS.map(k => ({ id: k.id, name: lang === 'bn' ? k.bn : k.en }))}
            value={catKind}
            onPick={id => setCatKind(id as ExpenseCategoryKind)}
          />
          {catError ? <Text style={{ color: color.red, marginTop: 4, fontSize: fs }}>{catError}</Text> : null}
        </DetailShell>
      ) : null}
    </Screen>
  );
}

function SummaryCard({
  label,
  value,
  sub,
  icon,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  icon: IconName;
  tone: string;
}) {
  const fs = useFs(12, 13);
  return (
    <Card style={{ borderLeftWidth: 4, borderLeftColor: tone }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: color.primaryLight, alignItems: 'center', justifyContent: 'center' }}>
          <AppIcon name={icon} size={20} iconColor={tone} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={{ fontSize: fs, color: color.muted, fontWeight: '600' }}>{label}</Text>
          <Text numberOfLines={1} style={{ fontSize: fs + 8, color: color.text, fontWeight: '800', marginTop: 2 }}>{value}</Text>
          <Text numberOfLines={1} style={{ fontSize: fs - 1, color: color.muted }}>{sub}</Text>
        </View>
      </View>
    </Card>
  );
}
