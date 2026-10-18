import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal, Alert, Platform } from 'react-native';
import { useApp } from '../store';
import { toBnDigits, useMoney } from '../ui';
import { AppIcon, icons } from '../icons';

export interface ExpenseRowData {
  id: string;
  date: string;
  voucherNo: string;
  type: 'operation' | 'transport' | 'landing';
  typeLabel: string;
  category: string;
  amount: number;
  description?: string;
  payerName?: string;
  responsiblePerson?: string;
  paymentMethod?: string;
}

export function ExpenseDashboard() {
  const { t, expenses, saveExpense, deleteExpense, moneyAccounts } = useApp();
  const m = useMoney();

  // Active Type Tab: 'all' | 'operation' | 'transport' | 'landing'
  const [activeTab, setActiveTab] = useState<'all' | 'operation' | 'transport' | 'landing'>('all');

  // Filters
  const [fromDate, setFromDate] = useState('01/09/2026');
  const [toDate, setToDate] = useState('30/09/2026');
  const [selectedTypeFilter, setSelectedTypeFilter] = useState('সব খরচ');
  const [selectedCatFilter, setSelectedCatFilter] = useState('সব ক্যাটাগরি');
  const [searchQuery, setSearchQuery] = useState('');

  // Dropdown states
  const [typeDropdownOpen, setTypeDropdownOpen] = useState(false);
  const [catDropdownOpen, setCatDropdownOpen] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Modal State for adding/editing expense
  const [modalOpen, setModalOpen] = useState(false);
  const [editingExpenseId, setEditingExpenseId] = useState<string | null>(null);

  // Modal Fields
  const [modalDate, setModalDate] = useState('15/09/2026');
  const [modalType, setModalType] = useState<'operation' | 'transport' | 'landing'>('operation');
  const [modalVoucherNo, setModalVoucherNo] = useState('EXP-0011');
  const [modalCategory, setModalCategory] = useState('অফিস ভাড়া');
  const [modalDescription, setModalDescription] = useState('');
  const [modalAmount, setModalAmount] = useState('');
  const [modalMethod, setModalMethod] = useState('ক্যাশ');
  const [modalPayer, setModalPayer] = useState('');
  const [modalResponsible, setModalResponsible] = useState('');

  // Modal dropdowns
  const [modalTypeDropdownOpen, setModalTypeDropdownOpen] = useState(false);
  const [modalCatDropdownOpen, setModalCatDropdownOpen] = useState(false);
  const [modalMethodDropdownOpen, setModalMethodDropdownOpen] = useState(false);

  // View Modal
  const [viewExpense, setViewExpense] = useState<ExpenseRowData | null>(null);

  const expenseTypes = [
    { key: 'operation', label: 'অপারেশন খরচ' },
    { key: 'transport', label: 'পরিবহন খরচ' },
    { key: 'landing', label: 'ল্যান্ডিং খরচ' },
  ];

  const expenseCategories = [
    'অফিস ভাড়া',
    'বেতন ও ভাতা',
    'বিদ্যুৎ বিল',
    'লোডিং/আনলোডিং',
    'ট্রাক ভাড়া',
    'বন্দর চার্জ',
    'শুল্ক ও ট্যাক্স',
    'লোকাল পরিবহন',
    'ডকুমেন্টেশন চার্জ',
    'খাবার ও আপ্যায়ন',
    'অন্যান্য',
  ];

  // Map category to operational / transport / landing
  const resolveExpenseType = (cat: string, note?: string | null): 'operation' | 'transport' | 'landing' => {
    if (note && note.includes('ধরন: পরিবহন খরচ')) return 'transport';
    if (note && note.includes('ধরন: ল্যান্ডিং খরচ')) return 'landing';
    if (cat === 'transport' || cat === 'vehicle' || cat === 'fuel') return 'transport';
    if (cat === 'loading' || cat === 'landing') return 'landing';
    return 'operation';
  };

  const getCategoryLabel = (cat: string, customName?: string | null) => {
    if (customName) return customName;
    const catMap: Record<string, string> = {
      salary: 'বেতন ও ভাতা',
      rent: 'অফিস ভাড়া',
      electricity: 'বিদ্যুৎ বিল',
      transport: 'ট্রাক ভাড়া',
      loading: 'লোডিং/আনলোডিং',
      office: 'অফিস সামগ্রী',
      tea: 'খাবার ও আপ্যায়ন',
      lunch: 'খাবার ও আপ্যায়ন',
      other: 'অন্যান্য',
    };
    return catMap[cat] || cat;
  };

  // Build full row list combining store expenses and mock data if store has few rows
  const allExpenseRows: ExpenseRowData[] = useMemo(() => {
    if (expenses.length > 5) {
      return expenses.map((e, idx) => {
        const type = resolveExpenseType(e.category, e.note);
        const typeLabel = type === 'operation' ? 'অপারেশন খরচ' : type === 'transport' ? 'পরিবহন খরচ' : 'ল্যান্ডিং খরচ';
        const voucherNo = `EXP-${String(idx + 1).padStart(4, '0')}`;
        return {
          id: e.id,
          date: e.date,
          voucherNo,
          type,
          typeLabel,
          category: getCategoryLabel(e.category, e.customName),
          amount: e.amount,
          description: e.note || undefined,
        };
      });
    }

    // Default 10 realistic demo rows mirroring screenshot `Bengali Expense Dashboard Interface.png`
    const defaultData: ExpenseRowData[] = [
      { id: '1', date: '02/09/2026', voucherNo: 'EXP-0001', type: 'operation', typeLabel: 'অপারেশন খরচ', category: 'অফিস ভাড়া', amount: 15000 },
      { id: '2', date: '03/09/2026', voucherNo: 'EXP-0002', type: 'operation', typeLabel: 'অপারেশন খরচ', category: 'বেতন ও ভাতা', amount: 25000 },
      { id: '3', date: '05/09/2026', voucherNo: 'EXP-0003', type: 'transport', typeLabel: 'পরিবহন খরচ', category: 'ট্রাক ভাড়া', amount: 18000 },
      { id: '4', date: '08/09/2026', voucherNo: 'EXP-0004', type: 'transport', typeLabel: 'পরিবহন খরচ', category: 'লোডিং/আনলোডিং', amount: 5500 },
      { id: '5', date: '10/09/2026', voucherNo: 'EXP-0005', type: 'landing', typeLabel: 'ল্যান্ডিং খরচ', category: 'বন্দর চার্জ', amount: 12000 },
      { id: '6', date: '12/09/2026', voucherNo: 'EXP-0006', type: 'landing', typeLabel: 'ল্যান্ডিং খরচ', category: 'শুল্ক ও ট্যাক্স', amount: 8000 },
      { id: '7', date: '15/09/2026', voucherNo: 'EXP-0007', type: 'operation', typeLabel: 'অপারেশন খরচ', category: 'বিদ্যুৎ বিল', amount: 4500 },
      { id: '8', date: '18/09/2026', voucherNo: 'EXP-0008', type: 'transport', typeLabel: 'পরিবহন খরচ', category: 'লোকাল পরিবহন', amount: 7000 },
      { id: '9', date: '22/09/2026', voucherNo: 'EXP-0009', type: 'landing', typeLabel: 'ল্যান্ডিং খরচ', category: 'ডকুমেন্টেশন চার্জ', amount: 6000 },
      { id: '10', date: '26/09/2026', voucherNo: 'EXP-0010', type: 'operation', typeLabel: 'অপারেশন খরচ', category: 'খাবার ও আপ্যায়ন', amount: 11000 },
    ];

    // Merge store expenses
    const mappedStore = expenses.map((e, idx) => {
      const type = resolveExpenseType(e.category, e.note);
      const typeLabel = type === 'operation' ? 'অপারেশন খরচ' : type === 'transport' ? 'পরিবহন খরচ' : 'ল্যান্ডিং খরচ';
      return {
        id: e.id,
        date: e.date,
        voucherNo: `EXP-${String(11 + idx).padStart(4, '0')}`,
        type,
        typeLabel,
        category: getCategoryLabel(e.category, e.customName),
        amount: e.amount,
        description: e.note || undefined,
      };
    });

    return [...defaultData, ...mappedStore];
  }, [expenses]);

  // Aggregated totals for top cards
  const totalOperation = useMemo(() => {
    return allExpenseRows.filter(r => r.type === 'operation').reduce((sum, r) => sum + r.amount, 0);
  }, [allExpenseRows]);

  const totalTransport = useMemo(() => {
    return allExpenseRows.filter(r => r.type === 'transport').reduce((sum, r) => sum + r.amount, 0);
  }, [allExpenseRows]);

  const totalLanding = useMemo(() => {
    return allExpenseRows.filter(r => r.type === 'landing').reduce((sum, r) => sum + r.amount, 0);
  }, [allExpenseRows]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    return allExpenseRows.filter(r => {
      // Tab filter
      if (activeTab !== 'all' && r.type !== activeTab) return false;

      // Dropdown type filter
      if (selectedTypeFilter !== 'সব খরচ' && r.typeLabel !== selectedTypeFilter) return false;

      // Dropdown cat filter
      if (selectedCatFilter !== 'সব ক্যাটাগরি' && r.category !== selectedCatFilter) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matches =
          r.voucherNo.toLowerCase().includes(q) ||
          r.category.toLowerCase().includes(q) ||
          r.typeLabel.toLowerCase().includes(q) ||
          (r.description && r.description.toLowerCase().includes(q));
        if (!matches) return false;
      }

      return true;
    });
  }, [allExpenseRows, activeTab, selectedTypeFilter, selectedCatFilter, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  // Open modal for adding
  const handleOpenAdd = () => {
    setEditingExpenseId(null);
    setModalDate(new Date().toISOString().slice(0, 10));
    setModalType('operation');
    setModalVoucherNo(`EXP-${String(allExpenseRows.length + 1).padStart(4, '0')}`);
    setModalCategory('অফিস ভাড়া');
    setModalDescription('');
    setModalAmount('');
    setModalMethod('ক্যাশ');
    setModalPayer('');
    setModalResponsible('');
    setModalOpen(true);
  };

  // Open modal for editing
  const handleOpenEdit = (item: ExpenseRowData) => {
    setEditingExpenseId(item.id);
    setModalDate(item.date);
    setModalType(item.type);
    setModalVoucherNo(item.voucherNo);
    setModalCategory(item.category);
    setModalDescription(item.description || '');
    setModalAmount(String(item.amount));
    setModalMethod(item.paymentMethod || 'ক্যাশ');
    setModalPayer(item.payerName || '');
    setModalResponsible(item.responsiblePerson || '');
    setModalOpen(true);
  };

  // Delete expense
  const handleDelete = (id: string) => {
    Alert.alert('নিশ্চিত করুন', 'আপনি কি এই খরচটি মুছে ফেলতে চান?', [
      { text: 'বাতিল', style: 'cancel' },
      {
        text: 'মুছুন',
        style: 'destructive',
        onPress: async () => {
          try {
            await deleteExpense(id);
            Alert.alert('সফল', 'খরচ মুছে ফেলা হয়েছে।');
          } catch (e) {
            Alert.alert('ব্যর্থ', 'খরচ মুছে ফেলা যায়নি।');
          }
        },
      },
    ]);
  };

  // Save Expense Handler
  const handleSaveModal = async () => {
    const amt = parseFloat(modalAmount);
    if (!amt || amt <= 0) {
      Alert.alert('ভুল তথ্য', 'অনুগ্রহ করে সঠিক পরিমাণ দিন।');
      return;
    }

    const matchedAccount =
      modalMethod === 'ব্যাংক'
        ? moneyAccounts.find(a => a.type === 'bank') || moneyAccounts[0]
        : moneyAccounts.find(a => a.type === 'cash') || moneyAccounts[0];

    const typeLabel = modalType === 'operation' ? 'অপারেশন খরচ' : modalType === 'transport' ? 'পরিবহন খরচ' : 'ল্যান্ডিং খরচ';
    const noteText = `[ভাউচার: ${modalVoucherNo} | ধরন: ${typeLabel} | প্রদানকারী: ${modalPayer || '-'} | দায়িত্বপ্রাপ্ত: ${modalResponsible || '-'}] ${modalDescription}`;

    try {
      await saveExpense({
        id: editingExpenseId || undefined,
        category: modalCategory === 'অন্যান্য' ? 'other' : 'office',
        customName: modalCategory,
        amount: amt,
        accountId: matchedAccount?.id || 'cash',
        date: modalDate.includes('/') ? modalDate.split('/').reverse().join('-') : modalDate,
        note: noteText,
      });

      setModalOpen(false);
      Alert.alert('সফল', 'খরচ সফলভাবে সংরক্ষণ করা হয়েছে।');
    } catch (e) {
      Alert.alert('ব্যর্থ', e instanceof Error ? e.message : 'খরচ সংরক্ষণ করা যায়নি।');
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Top Header Banner */}
      <View style={styles.headerBar}>
        <View style={styles.headerLeft}>
          <AppIcon name={icons.expense} size={24} iconColor="#fff" />
          <Text style={styles.headerTitle}>খরচ</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity style={styles.iconCircleButton}>
            <AppIcon name={icons.search} size={20} iconColor="#fff" />
          </TouchableOpacity>
          <TouchableOpacity style={styles.iconCircleButton}>
            <AppIcon name={icons.bell} size={20} iconColor="#fff" />
          </TouchableOpacity>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarText}>SR</Text>
          </View>
        </View>
      </View>

      {/* KPI Cards (3 Cards) */}
      <View style={styles.kpiRow}>
        {/* Card 1: Operation Expense */}
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#E8F5E9' }]}>
            <AppIcon name={icons.settings} size={26} iconColor="#1B7F4B" />
          </View>
          <View style={styles.kpiInfo}>
            <Text style={styles.kpiLabel}>অপারেশন খরচ</Text>
            <Text style={styles.kpiValue}>৳ {toBnDigits(totalOperation.toLocaleString('en-IN'))}</Text>
          </View>
        </View>

        {/* Card 2: Transport Expense */}
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#E3F2FD' }]}>
            <AppIcon name={icons.vendors} size={26} iconColor="#1976D2" />
          </View>
          <View style={styles.kpiInfo}>
            <Text style={styles.kpiLabel}>পরিবহন খরচ</Text>
            <Text style={styles.kpiValue}>৳ {toBnDigits(totalTransport.toLocaleString('en-IN'))}</Text>
          </View>
        </View>

        {/* Card 3: Landing Expense */}
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#FEF3C7' }]}>
            <AppIcon name={icons.ship} size={26} iconColor="#D97706" />
          </View>
          <View style={styles.kpiInfo}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={styles.kpiLabel}>ল্যান্ডিং খরচ</Text>
              <View style={styles.dateBadgePill}>
                <AppIcon name={icons.calendar} size={13} iconColor="#64748B" />
                <Text style={styles.dateBadgePillText}>01/09/2026 - 30/09/2026</Text>
              </View>
            </View>
            <Text style={styles.kpiValue}>৳ {toBnDigits(totalLanding.toLocaleString('en-IN'))}</Text>
          </View>
        </View>
      </View>

      {/* Category Tabs & Add Button */}
      <View style={styles.controlsRow}>
        <View style={styles.tabButtonsGroup}>
          <TouchableOpacity
            onPress={() => {
              setActiveTab('all');
              setPage(1);
            }}
            style={[styles.tabBtn, activeTab === 'all' ? styles.tabBtnActive : styles.tabBtnInactive]}
          >
            <AppIcon name={icons.more} size={18} iconColor={activeTab === 'all' ? '#fff' : '#0F172A'} />
            <Text style={[styles.tabBtnText, activeTab === 'all' ? styles.tabBtnTextActive : styles.tabBtnTextInactive]}>
              সকল খরচ
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setActiveTab('operation');
              setPage(1);
            }}
            style={[styles.tabBtn, activeTab === 'operation' ? styles.tabBtnActive : styles.tabBtnInactive]}
          >
            <AppIcon name={icons.settings} size={18} iconColor={activeTab === 'operation' ? '#fff' : '#0F172A'} />
            <Text
              style={[styles.tabBtnText, activeTab === 'operation' ? styles.tabBtnTextActive : styles.tabBtnTextInactive]}
            >
              অপারেশন খরচ
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setActiveTab('transport');
              setPage(1);
            }}
            style={[styles.tabBtn, activeTab === 'transport' ? styles.tabBtnActive : styles.tabBtnInactive]}
          >
            <AppIcon name={icons.vendors} size={18} iconColor={activeTab === 'transport' ? '#fff' : '#0F172A'} />
            <Text
              style={[styles.tabBtnText, activeTab === 'transport' ? styles.tabBtnTextActive : styles.tabBtnTextInactive]}
            >
              পরিবহন খরচ
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setActiveTab('landing');
              setPage(1);
            }}
            style={[styles.tabBtn, activeTab === 'landing' ? styles.tabBtnActive : styles.tabBtnInactive]}
          >
            <AppIcon name={icons.ship} size={18} iconColor={activeTab === 'landing' ? '#fff' : '#0F172A'} />
            <Text
              style={[styles.tabBtnText, activeTab === 'landing' ? styles.tabBtnTextActive : styles.tabBtnTextInactive]}
            >
              ল্যান্ডিং খরচ
            </Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={handleOpenAdd} style={styles.addExpenseBtn}>
          <AppIcon name={icons.add} size={18} iconColor="#fff" />
          <Text style={styles.addExpenseBtnText}>খরচ যোগ করুন</Text>
        </TouchableOpacity>
      </View>

      {/* Filter Row Card */}
      <View style={styles.filterCard}>
        {/* Date From - To */}
        <View style={styles.dateRangeWrap}>
          <Text style={styles.filterLabelSmall}>তারিখ</Text>
          <View style={styles.dateInputsRow}>
            <View style={styles.dateInputBox}>
              <AppIcon name={icons.calendar} size={16} iconColor="#64748B" />
              <TextInput value={fromDate} onChangeText={setFromDate} style={styles.dateTextInput} />
            </View>
            <Text style={{ color: '#64748B', fontSize: 13 }}>থেকে</Text>
            <View style={styles.dateInputBox}>
              <AppIcon name={icons.calendar} size={16} iconColor="#64748B" />
              <TextInput value={toDate} onChangeText={setToDate} style={styles.dateTextInput} />
            </View>
          </View>
        </View>

        {/* Expense Type Dropdown */}
        <View style={{ position: 'relative', zIndex: 30 }}>
          <Text style={styles.filterLabelSmall}>খরচের ধরন</Text>
          <TouchableOpacity
            onPress={() => setTypeDropdownOpen(prev => !prev)}
            style={styles.dropdownSelectorBox}
          >
            <Text style={styles.dropdownSelectorText}>{selectedTypeFilter}</Text>
            <AppIcon name={icons.chevR} size={16} iconColor="#64748B" />
          </TouchableOpacity>

          {typeDropdownOpen && (
            <View style={styles.dropdownList}>
              {['সব খরচ', 'অপারেশন খরচ', 'পরিবহন খরচ', 'ল্যান্ডিং খরচ'].map(opt => (
                <TouchableOpacity
                  key={opt}
                  onPress={() => {
                    setSelectedTypeFilter(opt);
                    setTypeDropdownOpen(false);
                  }}
                  style={styles.dropdownListItem}
                >
                  <Text style={styles.dropdownListItemText}>{opt}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Expense Category Dropdown */}
        <View style={{ position: 'relative', zIndex: 30 }}>
          <Text style={styles.filterLabelSmall}>খরচের ক্যাটাগরি</Text>
          <TouchableOpacity
            onPress={() => setCatDropdownOpen(prev => !prev)}
            style={styles.dropdownSelectorBox}
          >
            <Text style={styles.dropdownSelectorText}>{selectedCatFilter}</Text>
            <AppIcon name={icons.chevR} size={16} iconColor="#64748B" />
          </TouchableOpacity>

          {catDropdownOpen && (
            <View style={styles.dropdownList}>
              {['সব ক্যাটাগরি', ...expenseCategories].map(cat => (
                <TouchableOpacity
                  key={cat}
                  onPress={() => {
                    setSelectedCatFilter(cat);
                    setCatDropdownOpen(false);
                  }}
                  style={styles.dropdownListItem}
                >
                  <Text style={styles.dropdownListItemText}>{cat}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>

        {/* Search Bar */}
        <View style={styles.searchBarWrap}>
          <AppIcon name={icons.search} size={18} iconColor="#94A3B8" />
          <TextInput
            value={searchQuery}
            onChangeText={setSearchQuery}
            style={styles.searchBarInput}
            placeholder="বিবরণ, ভাউচার নং বা সরবরাহকারীর নাম দিয়ে খুঁজুন..."
          />
        </View>
      </View>

      {/* Main Expense Table Card */}
      <View style={styles.tableCard}>
        {/* Table Header */}
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.th, { width: 50, textAlign: 'center' }]}>#</Text>
          <Text style={[styles.th, { flex: 1.2 }]}>তারিখ</Text>
          <Text style={[styles.th, { flex: 1.2 }]}>ভাউচার নং</Text>
          <Text style={[styles.th, { flex: 1.5, textAlign: 'center' }]}>খরচের ধরন</Text>
          <Text style={[styles.th, { flex: 1.8 }]}>ক্যাটাগরি</Text>
          <Text style={[styles.th, { flex: 1.4, textAlign: 'right' }]}>পরিমাণ (৳)</Text>
          <Text style={[styles.th, { width: 110, textAlign: 'center' }]}>অ্যাকশন</Text>
        </View>

        {/* Table Rows */}
        {pagedRows.map((row, idx) => {
          // Pill badge color by type
          const pillBg =
            row.type === 'operation' ? '#ECFDF5' : row.type === 'transport' ? '#EFF6FF' : '#FEF3C7';
          const pillText =
            row.type === 'operation' ? '#065F46' : row.type === 'transport' ? '#1E40AF' : '#92400E';

          return (
            <View key={row.id} style={styles.tableDataRow}>
              <View style={[styles.td, { width: 50, alignItems: 'center' }]}>
                <Text style={styles.cellMuted}>{(page - 1) * pageSize + idx + 1}</Text>
              </View>

              <View style={[styles.td, { flex: 1.2 }]}>
                <Text style={styles.cellText}>{toBnDigits(row.date)}</Text>
              </View>

              <View style={[styles.td, { flex: 1.2 }]}>
                <Text style={styles.cellBold}>{row.voucherNo}</Text>
              </View>

              <View style={[styles.td, { flex: 1.5, alignItems: 'center' }]}>
                <View style={[styles.typePill, { backgroundColor: pillBg }]}>
                  <Text style={[styles.typePillText, { color: pillText }]}>{row.typeLabel}</Text>
                </View>
              </View>

              <View style={[styles.td, { flex: 1.8 }]}>
                <Text style={styles.cellText}>{row.category}</Text>
              </View>

              <View style={[styles.td, { flex: 1.4, alignItems: 'flex-end' }]}>
                <Text style={styles.cellBold}>{toBnDigits(row.amount.toLocaleString('en-IN'))}</Text>
              </View>

              <View style={[styles.td, { width: 110, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }]}>
                <TouchableOpacity onPress={() => setViewExpense(row)} style={styles.iconCircleAction}>
                  <AppIcon name={icons.eye} size={16} iconColor="#15803D" />
                </TouchableOpacity>

                <TouchableOpacity onPress={() => handleOpenEdit(row)} style={styles.iconCircleAction}>
                  <AppIcon name={icons.edit} size={16} iconColor="#2563EB" />
                </TouchableOpacity>

                <TouchableOpacity onPress={() => handleDelete(row.id)} style={styles.iconCircleAction}>
                  <AppIcon name={icons.del} size={16} iconColor="#DC2626" />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}

        {/* Pagination Footer */}
        <View style={styles.paginationFooter}>
          <Text style={styles.footerCountText}>
            মোট {toBnDigits(String(filteredRows.length))} টি খরচ দেখানো হচ্ছে
          </Text>

          <View style={styles.paginationControls}>
            <View style={styles.pageSizeSelector}>
              <Text style={styles.pageSizeText}>প্রতি পেজে ১০</Text>
              <AppIcon name={icons.chevR} size={16} iconColor="#64748B" />
            </View>

            <View style={styles.pageButtonsRow}>
              <TouchableOpacity
                disabled={page <= 1}
                onPress={() => setPage(p => Math.max(1, p - 1))}
                style={[styles.pageNavBtn, page <= 1 && styles.pageNavBtnDisabled]}
              >
                <Text style={styles.pageNavText}>‹</Text>
              </TouchableOpacity>

              {Array.from({ length: totalPages }, (_, i) => i + 1).map(pNum => (
                <TouchableOpacity
                  key={pNum}
                  onPress={() => setPage(pNum)}
                  style={[styles.pageNumberBtn, page === pNum && styles.pageNumberBtnActive]}
                >
                  <Text style={[styles.pageNumberText, page === pNum && styles.pageNumberTextActive]}>
                    {toBnDigits(String(pNum))}
                  </Text>
                </TouchableOpacity>
              ))}

              <TouchableOpacity
                disabled={page >= totalPages}
                onPress={() => setPage(p => Math.min(totalPages, p + 1))}
                style={[styles.pageNavBtn, page >= totalPages && styles.pageNavBtnDisabled]}
              >
                <Text style={styles.pageNavText}>›</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>

      {/* Add / Edit Expense Modal (Bengali Expense Entry Dashboard Modal.png) */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <AppIcon name={icons.expense} size={22} iconColor="#006A4E" />
                <Text style={styles.modalTitle}>খরচ যোগ করুন</Text>
              </View>
              <TouchableOpacity onPress={() => setModalOpen(false)}>
                <AppIcon name={icons.cancel} size={20} iconColor="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Modal Form */}
            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              {/* Row 1: Date & Type */}
              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>খরচের তারিখ *</Text>
                  <View style={styles.inputWithIcon}>
                    <TextInput value={modalDate} onChangeText={setModalDate} style={styles.modalTextInput} />
                    <AppIcon name={icons.calendar} size={18} iconColor="#64748B" />
                  </View>
                </View>

                <View style={[styles.modalCol, { position: 'relative', zIndex: 50 }]}>
                  <Text style={styles.modalLabel}>খরচের ধরন *</Text>
                  <TouchableOpacity
                    onPress={() => setModalTypeDropdownOpen(prev => !prev)}
                    style={styles.modalSelectWrap}
                  >
                    <Text style={styles.modalSelectText}>
                      {expenseTypes.find(t => t.key === modalType)?.label}
                    </Text>
                    <AppIcon name={icons.chevR} size={16} iconColor="#64748B" />
                  </TouchableOpacity>

                  {modalTypeDropdownOpen && (
                    <View style={styles.modalDropdownPopup}>
                      {expenseTypes.map(t => (
                        <TouchableOpacity
                          key={t.key}
                          onPress={() => {
                            setModalType(t.key as any);
                            setModalTypeDropdownOpen(false);
                          }}
                          style={styles.dropdownPopupItem}
                        >
                          <Text style={styles.dropdownPopupItemText}>{t.label}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              {/* Row 2: Voucher No & Category */}
              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>ভাউচার নং *</Text>
                  <TextInput
                    value={modalVoucherNo}
                    onChangeText={setModalVoucherNo}
                    style={styles.modalInput}
                    placeholder="EXP-0011"
                  />
                </View>

                <View style={[styles.modalCol, { position: 'relative', zIndex: 40 }]}>
                  <Text style={styles.modalLabel}>খরচের ক্যাটাগরি *</Text>
                  <TouchableOpacity
                    onPress={() => setModalCatDropdownOpen(prev => !prev)}
                    style={styles.modalSelectWrap}
                  >
                    <Text style={styles.modalSelectText}>{modalCategory}</Text>
                    <AppIcon name={icons.chevR} size={16} iconColor="#64748B" />
                  </TouchableOpacity>

                  {modalCatDropdownOpen && (
                    <View style={styles.modalDropdownPopup}>
                      <ScrollView style={{ maxHeight: 150 }} keyboardShouldPersistTaps="handled">
                        {expenseCategories.map(cat => (
                          <TouchableOpacity
                            key={cat}
                            onPress={() => {
                              setModalCategory(cat);
                              setModalCatDropdownOpen(false);
                            }}
                            style={styles.dropdownPopupItem}
                          >
                            <Text style={styles.dropdownPopupItemText}>{cat}</Text>
                          </TouchableOpacity>
                        ))}
                      </ScrollView>
                    </View>
                  )}
                </View>
              </View>

              {/* Row 3: Description */}
              <View style={styles.modalFormGroup}>
                <Text style={styles.modalLabel}>বিবরণ (ঐচ্ছিক)</Text>
                <TextInput
                  value={modalDescription}
                  onChangeText={setModalDescription}
                  style={[styles.modalInput, { height: 75, textAlignVertical: 'top' }]}
                  placeholder="সেপ্টেম্বর মাসের অফিস ভাড়া প্রদান"
                  multiline
                />
              </View>

              {/* Row 4: Amount & Payment Method */}
              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>পরিমাণ (৳) *</Text>
                  <TextInput
                    value={modalAmount}
                    onChangeText={setModalAmount}
                    style={styles.modalInput}
                    placeholder="15,000"
                    keyboardType="numeric"
                  />
                </View>

                <View style={[styles.modalCol, { position: 'relative', zIndex: 30 }]}>
                  <Text style={styles.modalLabel}>প্রদান পদ্ধতি *</Text>
                  <TouchableOpacity
                    onPress={() => setModalMethodDropdownOpen(prev => !prev)}
                    style={styles.modalSelectWrap}
                  >
                    <Text style={styles.modalSelectText}>{modalMethod}</Text>
                    <AppIcon name={icons.chevR} size={16} iconColor="#64748B" />
                  </TouchableOpacity>

                  {modalMethodDropdownOpen && (
                    <View style={styles.modalDropdownPopup}>
                      {['ক্যাশ', 'ব্যাংক', 'বিকাশ', 'নগদ'].map(mth => (
                        <TouchableOpacity
                          key={mth}
                          onPress={() => {
                            setModalMethod(mth);
                            setModalMethodDropdownOpen(false);
                          }}
                          style={styles.dropdownPopupItem}
                        >
                          <Text style={styles.dropdownPopupItemText}>{mth}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )}
                </View>
              </View>

              {/* Row 5: Payer Name & Responsible Person */}
              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>প্রদানকারীর নাম (ঐচ্ছিক)</Text>
                  <TextInput
                    value={modalPayer}
                    onChangeText={setModalPayer}
                    style={styles.modalInput}
                    placeholder="মোঃ রফিকুল ইসলাম"
                  />
                </View>

                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>দায়িত্বপ্রাপ্ত ব্যক্তি (ঐচ্ছিক)</Text>
                  <TextInput
                    value={modalResponsible}
                    onChangeText={setModalResponsible}
                    style={styles.modalInput}
                    placeholder="মোঃ সাইফুর রহমান"
                  />
                </View>
              </View>
            </ScrollView>

            {/* Modal Actions */}
            <View style={styles.modalFooter}>
              <TouchableOpacity onPress={() => setModalOpen(false)} style={styles.modalCancelBtn}>
                <AppIcon name={icons.cancel} size={16} iconColor="#475569" />
                <Text style={styles.modalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleSaveModal} style={styles.modalSaveBtn}>
                <AppIcon name={icons.save} size={18} iconColor="#fff" />
                <Text style={styles.modalSaveBtnText}>সংরক্ষণ করুন</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* View Expense Modal */}
      {viewExpense && (
        <Modal visible={!!viewExpense} transparent animationType="fade" onRequestClose={() => setViewExpense(null)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalBox, { maxWidth: 440 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{viewExpense.voucherNo} - {viewExpense.category}</Text>
                <TouchableOpacity onPress={() => setViewExpense(null)}>
                  <AppIcon name={icons.cancel} size={20} iconColor="#64748B" />
                </TouchableOpacity>
              </View>
              <View style={{ padding: 20, gap: 10 }}>
                <Text style={{ fontSize: 14, color: '#334155' }}>
                  তারিখ: <Text style={{ fontWeight: '700' }}>{toBnDigits(viewExpense.date)}</Text>
                </Text>
                <Text style={{ fontSize: 14, color: '#334155' }}>
                  ধরন: <Text style={{ fontWeight: '700' }}>{viewExpense.typeLabel}</Text>
                </Text>
                <Text style={{ fontSize: 14, color: '#334155' }}>
                  পরিমাণ: <Text style={{ fontWeight: '700' }}>৳ {toBnDigits(viewExpense.amount.toLocaleString('en-IN'))}</Text>
                </Text>
                {viewExpense.description ? (
                  <Text style={{ fontSize: 14, color: '#334155' }}>
                    বিবরণ: <Text style={{ fontWeight: '500' }}>{viewExpense.description}</Text>
                  </Text>
                ) : null}
              </View>
              <View style={{ padding: 14, alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: '#E2E8E4' }}>
                <TouchableOpacity onPress={() => setViewExpense(null)} style={styles.modalCancelBtn}>
                  <Text style={styles.modalCancelBtnText}>বন্ধ করুন</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F1F5F2',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
  },
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#006A4E',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  iconCircleButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarCircle: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#0F766E',
    borderWidth: 1.5,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  kpiRow: {
    flexDirection: 'row',
    gap: 16,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8E4',
    gap: 14,
  },
  kpiIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiInfo: {
    flex: 1,
  },
  kpiLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
    marginBottom: 4,
  },
  dateBadgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  dateBadgePillText: {
    fontSize: 11,
    color: '#64748B',
    fontWeight: '500',
  },
  kpiValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#0F172A',
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  tabButtonsGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  tabBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 10,
  },
  tabBtnActive: {
    backgroundColor: '#006A4E',
  },
  tabBtnInactive: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E2E8E4',
  },
  tabBtnText: {
    fontSize: 14,
    fontWeight: '600',
  },
  tabBtnTextActive: {
    color: '#fff',
  },
  tabBtnTextInactive: {
    color: '#334155',
  },
  addExpenseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#006A4E',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  addExpenseBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  filterCard: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8E4',
    marginBottom: 16,
    gap: 14,
  },
  dateRangeWrap: {
    gap: 4,
  },
  filterLabelSmall: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginBottom: 4,
  },
  dateInputsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  dateInputBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 38,
    backgroundColor: '#fff',
  },
  dateTextInput: {
    fontSize: 13,
    color: '#0F172A',
    width: 90,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  dropdownSelectorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 38,
    width: 140,
    backgroundColor: '#fff',
  },
  dropdownSelectorText: {
    fontSize: 13,
    color: '#0F172A',
  },
  dropdownList: {
    position: 'absolute',
    top: 60,
    left: 0,
    width: 160,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 100,
  },
  dropdownListItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownListItemText: {
    fontSize: 13,
    color: '#334155',
  },
  searchBarWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 38,
    backgroundColor: '#fff',
    gap: 8,
  },
  searchBarInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  tableCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8E4',
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8E4',
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  th: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
    paddingHorizontal: 6,
  },
  tableDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingVertical: 12,
    paddingHorizontal: 10,
  },
  td: {
    paddingHorizontal: 6,
  },
  cellMuted: {
    fontSize: 13,
    color: '#64748B',
  },
  cellBold: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  cellText: {
    fontSize: 13,
    color: '#334155',
  },
  typePill: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 16,
  },
  typePillText: {
    fontSize: 12,
    fontWeight: '600',
  },
  iconCircleAction: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F1F5F9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  paginationFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  footerCountText: {
    fontSize: 13,
    color: '#64748B',
  },
  paginationControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  pageSizeSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  pageSizeText: {
    fontSize: 12,
    color: '#334155',
  },
  pageButtonsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  pageNavBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNavBtnDisabled: {
    opacity: 0.4,
  },
  pageNavText: {
    fontSize: 14,
    color: '#334155',
  },
  pageNumberBtn: {
    width: 28,
    height: 28,
    borderRadius: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pageNumberBtnActive: {
    backgroundColor: '#006A4E',
  },
  pageNumberText: {
    fontSize: 12,
    color: '#334155',
    fontWeight: '600',
  },
  pageNumberTextActive: {
    color: '#fff',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalBox: {
    width: '100%',
    maxWidth: 560,
    backgroundColor: '#fff',
    borderRadius: 14,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8E4',
  },
  modalTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  modalBody: {
    padding: 18,
    maxHeight: 480,
  },
  modalTwoCol: {
    flexDirection: 'row',
    gap: 14,
    marginBottom: 12,
  },
  modalCol: {
    flex: 1,
  },
  modalFormGroup: {
    marginBottom: 12,
  },
  modalLabel: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '500',
    marginBottom: 6,
  },
  inputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    height: 40,
  },
  modalTextInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  modalInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    height: 40,
    fontSize: 13,
    color: '#0F172A',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  modalSelectWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    height: 40,
  },
  modalSelectText: {
    fontSize: 13,
    color: '#0F172A',
  },
  modalDropdownPopup: {
    position: 'absolute',
    top: 68,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 8,
    zIndex: 100,
  },
  dropdownPopupItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownPopupItemText: {
    fontSize: 13,
    color: '#334155',
  },
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#E2E8E4',
  },
  modalCancelBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#94A3B8',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  modalCancelBtnText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  modalSaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#006A4E',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  modalSaveBtnText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '700',
  },
});
