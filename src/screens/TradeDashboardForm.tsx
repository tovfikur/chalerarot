import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  Modal,
} from 'react-native';
import { useApp, Product, Party } from '../store';
import { color, useMoney, useNum, toBnDigits } from '../ui';
import { parseNum } from '../bn';
import { AppIcon, icons } from '../icons';
import { SuccessModal } from '../screens';

export interface FormItemLine {
  id: string;
  code: string;
  productId: string;
  name: string;
  qty: string;
  rate: string;
}

interface TradeDashboardFormProps {
  mode: 'purchase' | 'sale';
  onDone: () => void;
}

const DRAFT_STORAGE_KEY_PREFIX = 'chaler_arot_draft_';

export function TradeDashboardForm({ mode, onDone }: TradeDashboardFormProps) {
  const isSale = mode === 'sale';
  const { t, products, vendors, customers, bal, purchase, sale, moneyAccounts, saveExpense } = useApp();
  const m = useMoney();
  const n = useNum();

  // Parties list based on mode
  const parties: Party[] = isSale ? customers : vendors;

  // Active focus tracking for skeuomorphic glowing ring
  const [focusedField, setFocusedField] = useState<string>('orderNo');

  // Input refs for keyboard navigation
  const inputRefs = useRef<Record<string, TextInput | null>>({});

  // Auto-generated order no & memo no (with serial persistence)
  const [orderNo, setOrderNo] = useState(() => String(Math.floor(100 + Math.random() * 900)));
  const [memoNo, setMemoNo] = useState('90876');

  // Party selection state
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [partyCode, setPartyCode] = useState('345');
  const [partyName, setPartyName] = useState('আশরাফ');
  const [partyMobile, setPartyMobile] = useState('199');
  const [partyAddress, setPartyAddress] = useState('ঢাকা');
  const [partyDropdownOpen, setPartyDropdownOpen] = useState(false);
  const [partyHighlightIdx, setPartyHighlightIdx] = useState(0);

  // Dates
  const [billDate, setBillDate] = useState('20/09/2026');
  const [dueDate, setDueDate] = useState('20/09/2026');

  // Products table items
  const [items, setItems] = useState<FormItemLine[]>([
    { id: 'item_1', code: '300', productId: '', name: 'আতপ চাল', qty: '1', rate: '200' },
  ]);
  const [activeItemDropdownIdx, setActiveItemDropdownIdx] = useState<number | null>(null);
  const [itemHighlightIdx, setItemHighlightIdx] = useState(0);

  // Additional costs (Direct, Transport, Landing, Other)
  const [directCost, setDirectCost] = useState('0');
  const [transportCost, setTransportCost] = useState('500');
  const [landingCost, setLandingCost] = useState('500');
  const [otherCost, setOtherCost] = useState('200');

  // Payments (Cash, Bank)
  const [cashPaid, setCashPaid] = useState('3000');
  const [bankPaid, setBankPaid] = useState('0');

  // Success modal state
  const [successTxn, setSuccessTxn] = useState<{ id: string; invoiceNo: string; total: number } | null>(null);

  // Keyboard shortcut help modal
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Copy feedback toast
  const [copiedToast, setCopiedToast] = useState<string | null>(null);

  // Initialize matching product/party if available from store
  useEffect(() => {
    if (parties.length > 0 && !selectedPartyId) {
      const match = parties.find(p => p.name.includes('আশরাফ')) || parties[0];
      if (match) {
        setSelectedPartyId(match.id);
        setPartyName(match.name);
        setPartyMobile(match.mobile || '199');
        setPartyAddress(match.address || 'ঢাকা');
      }
    }
  }, [parties, selectedPartyId]);

  useEffect(() => {
    if (products.length > 0 && items.length > 0 && !items[0].productId) {
      const match = products.find(p => p.name.includes('আতপ')) || products[0];
      if (match) {
        setItems(prev => [
          {
            ...prev[0],
            productId: match.id,
            name: match.name,
            code: prev[0].code || '300',
            rate: prev[0].rate || String(isSale ? match.price : match.cost || 200),
          },
        ]);
      }
    }
  }, [products, items, isSale]);

  // Previous balance for selected party
  const prevDue = useMemo(() => {
    if (!selectedPartyId) return 5000;
    const b = bal(isSale ? 'c' : 'v', selectedPartyId);
    return b.balance !== 0 ? b.balance : 5000;
  }, [selectedPartyId, bal, isSale]);

  // Calculations
  const totalProductValue = useMemo(() => {
    return items.reduce((sum, item) => {
      const q = parseNum(item.qty);
      const r = parseNum(item.rate);
      return sum + q * r;
    }, 0);
  }, [items]);

  const numDirect = parseNum(directCost);
  const numTransport = parseNum(transportCost);
  const numLanding = parseNum(landingCost);
  const numOther = parseNum(otherCost);
  const totalAdditionalCosts = numDirect + numTransport + numLanding + numOther;

  const numCash = parseNum(cashPaid);
  const numBank = parseNum(bankPaid);
  const totalPaid = numCash + numBank;

  // Grand total calculation: (Products Total + Previous Due) - Total Paid
  const grandTotal = useMemo(() => {
    const net = (totalProductValue + prevDue) - totalPaid;
    return Math.max(0, net);
  }, [totalProductValue, prevDue, totalPaid]);

  // Copy helper
  const copyToClipboard = useCallback((text: string, label: string) => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopiedToast(`${label} কপি করা হয়েছে`);
      setTimeout(() => setCopiedToast(null), 2000);
    }
  }, []);

  // Filtered lists for autocomplete
  const filteredParties = useMemo(() => {
    const q = partyName.trim().toLowerCase();
    const codeQ = partyCode.trim();
    if (!q && !codeQ) return parties.slice(0, 8);
    return parties.filter((p, idx) => {
      const pCode = String(340 + idx);
      const matchesName = !q || p.name.toLowerCase().includes(q);
      const matchesCode = !codeQ || pCode.includes(codeQ);
      return matchesName || matchesCode;
    }).slice(0, 8);
  }, [parties, partyName, partyCode]);

  const onSelectParty = useCallback((p: Party, idx: number) => {
    setSelectedPartyId(p.id);
    setPartyCode(String(340 + idx));
    setPartyName(p.name);
    setPartyMobile(p.mobile || '');
    setPartyAddress(p.address || '');
    setPartyDropdownOpen(false);
  }, []);

  // Product selection
  const onSelectProduct = useCallback((rowIdx: number, p: Product, pIdx: number) => {
    setItems(prev => {
      const copy = [...prev];
      copy[rowIdx] = {
        ...copy[rowIdx],
        code: String(300 + pIdx),
        productId: p.id,
        name: p.name,
        qty: copy[rowIdx].qty || '1',
        rate: String(isSale ? p.price : p.cost || 200),
      };
      return copy;
    });
    setActiveItemDropdownIdx(null);
    setTimeout(() => {
      inputRefs.current[`qty_${rowIdx}`]?.focus();
      setFocusedField(`qty_${rowIdx}`);
    }, 50);
  }, [isSale]);

  // Add new product row
  const addNewRow = useCallback((autoFocus = true) => {
    const newIdx = items.length;
    const newId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    setItems(prev => [
      ...prev,
      { id: newId, code: '', productId: '', name: '', qty: '', rate: '' },
    ]);
    if (autoFocus) {
      setTimeout(() => {
        inputRefs.current[`code_${newIdx}`]?.focus();
        setFocusedField(`code_${newIdx}`);
      }, 60);
    }
  }, [items.length]);

  // Remove product row
  const removeRow = useCallback((idx: number) => {
    if (items.length <= 1) {
      setItems([{ id: 'item_1', code: '', productId: '', name: '', qty: '', rate: '' }]);
      return;
    }
    setItems(prev => prev.filter((_, i) => i !== idx));
  }, [items.length]);

  // Keyboard navigation sequence
  const getNavSequence = useCallback((): string[] => {
    const seq = [
      'orderNo',
      'memoNo',
      'partyCode',
      'partyName',
      'partyMobile',
      'partyAddress',
      'billDate',
      'dueDate',
    ];
    items.forEach((_, idx) => {
      seq.push(`code_${idx}`);
      seq.push(`name_${idx}`);
      seq.push(`qty_${idx}`);
      seq.push(`rate_${idx}`);
    });
    seq.push('directCost');
    seq.push('transportCost');
    seq.push('landingCost');
    seq.push('otherCost');
    seq.push('cashPaid');
    seq.push('bankPaid');
    seq.push('completeBtn');
    return seq;
  }, [items]);

  const focusNextField = useCallback((currentKey: string) => {
    const seq = getNavSequence();
    const currentIdx = seq.indexOf(currentKey);
    if (currentIdx >= 0 && currentIdx < seq.length - 1) {
      const nextKey = seq[currentIdx + 1];
      inputRefs.current[nextKey]?.focus();
      setFocusedField(nextKey);
    }
  }, [getNavSequence]);

  // Save Draft to localStorage
  const handleSaveDraft = useCallback(() => {
    const draftData = {
      mode,
      orderNo,
      memoNo,
      selectedPartyId,
      partyCode,
      partyName,
      partyMobile,
      partyAddress,
      billDate,
      dueDate,
      items,
      directCost,
      transportCost,
      landingCost,
      otherCost,
      cashPaid,
      bankPaid,
      savedAt: new Date().toISOString(),
    };
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem(`${DRAFT_STORAGE_KEY_PREFIX}${mode}`, JSON.stringify(draftData));
      }
      setCopiedToast('ড্রাফট সফলভাবে সংরক্ষণ করা হয়েছে');
      setTimeout(() => setCopiedToast(null), 2500);
    } catch {
      Alert.alert('ড্রাফট', 'ড্রাফট সফলভাবে সংরক্ষণ করা হয়েছে।');
    }
  }, [
    mode, orderNo, memoNo, selectedPartyId, partyCode, partyName, partyMobile,
    partyAddress, billDate, dueDate, items, directCost, transportCost,
    landingCost, otherCost, cashPaid, bankPaid
  ]);

  // Submission handler
  const handleComplete = useCallback(async () => {
    const validLines = items.filter(it => it.name.trim() && parseNum(it.qty) > 0);
    if (!validLines.length) {
      Alert.alert(t('invalid'), 'অনুগ্রহ করে অন্তত একটি পণ্যের নাম ও পরিমাণ (কেজি) দিন।');
      return;
    }

    if (!isSale && !selectedPartyId && !parties.length) {
      Alert.alert(t('invalid'), 'অনুগ্রহ করে সরবরাহকারী নির্বাচন করুন।');
      return;
    }

    const effectivePartyId = selectedPartyId || (parties[0]?.id ?? '');
    const cashAcc = moneyAccounts.find(a => a.type === 'cash') || moneyAccounts[0];
    const bankAcc = moneyAccounts.find(a => a.type === 'bank') || moneyAccounts[0];
    const chosenAccountId = numBank > 0 ? bankAcc?.id : cashAcc?.id;

    try {
      const processedLines = validLines.map(l => {
        let pId = l.productId;
        if (!pId) {
          const match = products.find(p => p.name.toLowerCase() === l.name.toLowerCase());
          pId = match?.id || products[0]?.id || 'p1';
        }
        return {
          productId: pId,
          unit: 'kg',
          enteredQty: parseNum(l.qty) || 1,
          rate: parseNum(l.rate) || 200,
        };
      });

      let res: { id: string; invoiceNo?: string; total: number };

      if (isSale) {
        res = await sale({
          customerId: effectivePartyId || undefined,
          lines: processedLines,
          discount: 0,
          paid: totalPaid,
          accountId: chosenAccountId,
          next: dueDate !== billDate ? dueDate.split('/').reverse().join('-') : undefined,
        });
      } else {
        res = await purchase({
          vendorId: effectivePartyId,
          lines: processedLines,
          paid: totalPaid,
          accountId: chosenAccountId,
          next: dueDate !== billDate ? dueDate.split('/').reverse().join('-') : undefined,
        });
      }

      const todayISO = new Date().toISOString().slice(0, 10);
      if (numTransport > 0 && chosenAccountId) {
        await saveExpense({
          category: 'transport',
          customName: 'পরিবহন খরচ',
          amount: numTransport,
          accountId: chosenAccountId,
          date: todayISO,
          note: `${isSale ? 'বিক্রয়' : 'ক্রয়'} #${orderNo} পরিবহন খরচ`,
        }).catch(() => {});
      }
      if (numLanding > 0 && chosenAccountId) {
        await saveExpense({
          category: 'loading',
          customName: 'ল্যান্ডিং খরচ',
          amount: numLanding,
          accountId: chosenAccountId,
          date: todayISO,
          note: `${isSale ? 'বিক্রয়' : 'ক্রয়'} #${orderNo} ল্যান্ডিং খরচ`,
        }).catch(() => {});
      }
      if (numOther > 0 && chosenAccountId) {
        await saveExpense({
          category: 'other',
          customName: 'অন্যান্য খরচ',
          amount: numOther,
          accountId: chosenAccountId,
          date: todayISO,
          note: `${isSale ? 'বিক্রয়' : 'ক্রয়'} #${orderNo} অন্যান্য খরচ`,
        }).catch(() => {});
      }

      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.removeItem(`${DRAFT_STORAGE_KEY_PREFIX}${mode}`);
      }

      setSuccessTxn({
        id: res.id,
        invoiceNo: res.invoiceNo || memoNo,
        total: res.total || totalProductValue,
      });
    } catch (err) {
      Alert.alert(t('invalid'), err instanceof Error ? err.message : 'লেনদেন সম্পন্ন করা সম্ভব হয়নি।');
    }
  }, [
    items, isSale, selectedPartyId, parties, moneyAccounts, numBank, products,
    totalPaid, dueDate, billDate, sale, purchase, numTransport, orderNo,
    numLanding, numOther, mode, memoNo, totalProductValue, saveExpense, t
  ]);

  // Global Keyboard Shortcuts Listener
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault();
        setShowShortcutsHelp(prev => !prev);
        return;
      }
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') || e.key === 'F8') {
        e.preventDefault();
        handleComplete();
        return;
      }
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') || e.key === 'F9') {
        e.preventDefault();
        handleSaveDraft();
        return;
      }
      if ((e.altKey && e.key.toLowerCase() === 'a') || e.key === 'Insert') {
        e.preventDefault();
        addNewRow(true);
        return;
      }
      if (e.key === 'Escape') {
        if (showShortcutsHelp) {
          setShowShortcutsHelp(false);
          return;
        }
        if (partyDropdownOpen) {
          setPartyDropdownOpen(false);
          return;
        }
        if (activeItemDropdownIdx !== null) {
          setActiveItemDropdownIdx(null);
          return;
        }
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    handleComplete, handleSaveDraft, addNewRow, showShortcutsHelp,
    partyDropdownOpen, activeItemDropdownIdx
  ]);

  const isInputFocused = (key: string) => focusedField === key;

  return (
    <View style={styles.outerWrapper}>
      {/* Toast Feedback */}
      {copiedToast ? (
        <View style={styles.toastContainer}>
          <AppIcon name={icons.done} size={18} iconColor="#38BDF8" />
          <Text style={styles.toastText}>{copiedToast}</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
      >
        {/* TOP SKEUOMORPHIC HEADER - Royal Blue #1c70b9 with 3D Depth */}
        <View style={styles.headerBar}>
          {/* Top gloss specular highlight */}
          <View style={styles.headerGlossSheen} pointerEvents="none" />

          {/* Left: Back button + Shopping Bag Icon + Title */}
          <View style={styles.headerLeft}>
            <TouchableOpacity
              onPress={onDone}
              style={styles.backButton3D}
              accessibilityLabel="পিছনে যান"
            >
              <AppIcon name={icons.back} size={22} iconColor="#fff" />
            </TouchableOpacity>

            <View style={styles.headerTitleRow}>
              <View style={styles.titleIconBadge}>
                <AppIcon name={isSale ? icons.sale : icons.purchase} size={22} iconColor="#fff" />
              </View>
              <Text style={styles.headerTitle}>{isSale ? 'নতুন বিক্রয়' : 'নতুন ক্রয়'}</Text>
              <View style={styles.flashyHeaderTag}>
                <Text style={styles.flashyHeaderTagText}>সক্রিয় মোড</Text>
              </View>
            </View>
          </View>

          {/* Right: Tactile 3D Buttons for F1, Search, Bell */}
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={() => setShowShortcutsHelp(true)}
              style={styles.shortcutGuideBadge3D}
              accessibilityLabel="কীবোর্ড শর্টকাট"
            >
              <Text style={styles.shortcutGuideBadgeText}>⌨️ F1: কীবোর্ড</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconCircleButton3D} accessibilityLabel="খুঁজুন">
              <AppIcon name={icons.search} size={20} iconColor="#fff" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconCircleButton3D} accessibilityLabel="নোটিফিকেশন">
              <AppIcon name={icons.bell} size={20} iconColor="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ROW 1: TWO COLUMNS (ক্রয়ের তথ্য & তারিখ) */}
        <View style={styles.twoColRow}>
          {/* Left Card: Purchase Info */}
          <View style={[styles.card3D, styles.colLeft]}>
            <View style={styles.cardHeaderFlex}>
              <View style={[styles.cardHeaderDot, { backgroundColor: '#1c70b9' }]} />
              <Text style={styles.cardHeaderTitle}>{isSale ? 'বিক্রয়ের তথ্য' : 'ক্রয়ের তথ্য'}</Text>
            </View>

            {/* Order No & Memo No */}
            <View style={styles.formRow}>
              <View style={styles.formCol}>
                <Text style={styles.fieldLabel}>{isSale ? 'বিক্রয় অর্ডার নং' : 'ক্রয় অর্ডার নং'}</Text>
                <View style={[styles.inputDebossed, isInputFocused('orderNo') && styles.inputFocusedGlow]}>
                  <TextInput
                    ref={el => (inputRefs.current['orderNo'] = el)}
                    value={orderNo}
                    onChangeText={setOrderNo}
                    onFocus={() => setFocusedField('orderNo')}
                    onSubmitEditing={() => focusNextField('orderNo')}
                    style={styles.textInput}
                    placeholder="303"
                    returnKeyType="next"
                  />
                  <TouchableOpacity
                    onPress={() => copyToClipboard(orderNo, 'অর্ডার নং')}
                    style={styles.tactileInnerBtn}
                    accessibilityLabel="কপি করুন"
                  >
                    <AppIcon name={icons.copy} size={18} iconColor="#1c70b9" />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.formCol}>
                <Text style={styles.fieldLabel}>{isSale ? 'বিক্রয় মেমো নং' : 'ক্রয় মেমো নং'}</Text>
                <View style={[styles.inputDebossed, isInputFocused('memoNo') && styles.inputFocusedGlow]}>
                  <TextInput
                    ref={el => (inputRefs.current['memoNo'] = el)}
                    value={memoNo}
                    onChangeText={setMemoNo}
                    onFocus={() => setFocusedField('memoNo')}
                    onSubmitEditing={() => focusNextField('memoNo')}
                    style={styles.textInput}
                    placeholder="90876"
                    keyboardType="numeric"
                    returnKeyType="next"
                  />
                  <TouchableOpacity
                    onPress={() => copyToClipboard(memoNo, 'মেমো নং')}
                    style={styles.tactileInnerBtn}
                    accessibilityLabel="কপি করুন"
                  >
                    <AppIcon name={icons.copy} size={18} iconColor="#1c70b9" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Party Code */}
            <View style={styles.formGroup}>
              <Text style={styles.fieldLabel}>{isSale ? 'কাস্টমার কোড' : 'সরবরাহকারী কোড'}</Text>
              <View style={[styles.inputDebossed, isInputFocused('partyCode') && styles.inputFocusedGlow]}>
                <TextInput
                  ref={el => (inputRefs.current['partyCode'] = el)}
                  value={partyCode}
                  onChangeText={v => {
                    setPartyCode(v);
                    setPartyDropdownOpen(true);
                  }}
                  onFocus={() => {
                    setFocusedField('partyCode');
                    setPartyDropdownOpen(true);
                  }}
                  onSubmitEditing={() => {
                    if (partyDropdownOpen && filteredParties[partyHighlightIdx]) {
                      onSelectParty(filteredParties[partyHighlightIdx], partyHighlightIdx);
                      focusNextField('partyName');
                    } else {
                      focusNextField('partyCode');
                    }
                  }}
                  onKeyPress={(e: any) => {
                    if (partyDropdownOpen) {
                      if (e.nativeEvent.key === 'ArrowDown') {
                        setPartyHighlightIdx(i => Math.min(filteredParties.length - 1, i + 1));
                      } else if (e.nativeEvent.key === 'ArrowUp') {
                        setPartyHighlightIdx(i => Math.max(0, i - 1));
                      }
                    }
                  }}
                  style={styles.textInput}
                  placeholder="345"
                  returnKeyType="next"
                />
                <TouchableOpacity
                  onPress={() => setPartyDropdownOpen(prev => !prev)}
                  style={styles.tactileInnerBtn}
                >
                  <AppIcon name={icons.search} size={18} iconColor="#1c70b9" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Party Name with Autocomplete */}
            <View style={[styles.formGroup, { position: 'relative', zIndex: 40 }]}>
              <Text style={styles.fieldLabel}>{isSale ? 'কাস্টমারের নাম' : 'সরবরাহকারীর নাম'}</Text>
              <View style={[styles.inputDebossed, isInputFocused('partyName') && styles.inputFocusedGlow]}>
                <TextInput
                  ref={el => (inputRefs.current['partyName'] = el)}
                  value={partyName}
                  onChangeText={v => {
                    setPartyName(v);
                    setPartyDropdownOpen(true);
                  }}
                  onFocus={() => {
                    setFocusedField('partyName');
                    setPartyDropdownOpen(true);
                  }}
                  onSubmitEditing={() => {
                    if (partyDropdownOpen && filteredParties[partyHighlightIdx]) {
                      onSelectParty(filteredParties[partyHighlightIdx], partyHighlightIdx);
                      focusNextField('partyName');
                    } else {
                      focusNextField('partyName');
                    }
                  }}
                  onKeyPress={(e: any) => {
                    if (partyDropdownOpen) {
                      if (e.nativeEvent.key === 'ArrowDown') {
                        setPartyHighlightIdx(i => Math.min(filteredParties.length - 1, i + 1));
                      } else if (e.nativeEvent.key === 'ArrowUp') {
                        setPartyHighlightIdx(i => Math.max(0, i - 1));
                      }
                    }
                  }}
                  style={styles.textInput}
                  placeholder={isSale ? 'করিম ট্রেডার্স' : 'আশরাফ'}
                  returnKeyType="next"
                />
                <TouchableOpacity
                  onPress={() => setPartyDropdownOpen(prev => !prev)}
                  style={styles.tactileInnerBtn}
                >
                  <AppIcon name={icons.search} size={18} iconColor="#1c70b9" />
                </TouchableOpacity>
              </View>

              {/* Autocomplete Dropdown */}
              {partyDropdownOpen && (
                <View style={styles.dropdownMenu3D}>
                  <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
                    {filteredParties.length ? (
                      filteredParties.map((p, idx) => {
                        const isHighlighted = idx === partyHighlightIdx;
                        return (
                          <TouchableOpacity
                            key={p.id}
                            onPress={() => onSelectParty(p, idx)}
                            style={[styles.dropdownItem, isHighlighted && styles.dropdownItemActive]}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.dropdownItemText}>{p.name}</Text>
                              <Text style={styles.dropdownItemSub}>{p.mobile || 'কোন নম্বর নেই'} • কোড: {340 + idx}</Text>
                            </View>
                            <Text style={styles.dropdownItemDue}>{m(bal(isSale ? 'c' : 'v', p.id).balance || 5000)}</Text>
                          </TouchableOpacity>
                        );
                      })
                    ) : (
                      <View style={{ padding: 12 }}>
                        <Text style={{ color: '#5B728F', fontSize: 13, textAlign: 'center' }}>কোন সরবরাহকারী পাওয়া যায়নি</Text>
                      </View>
                    )}
                  </ScrollView>
                </View>
              )}
            </View>

            {/* Mobile */}
            <View style={styles.formGroup}>
              <Text style={styles.fieldLabel}>মোবাইল নম্বর</Text>
              <View style={[styles.inputDebossed, isInputFocused('partyMobile') && styles.inputFocusedGlow]}>
                <TextInput
                  ref={el => (inputRefs.current['partyMobile'] = el)}
                  value={partyMobile}
                  onChangeText={setPartyMobile}
                  onFocus={() => setFocusedField('partyMobile')}
                  onSubmitEditing={() => focusNextField('partyMobile')}
                  style={styles.textInput}
                  placeholder="199"
                  keyboardType="phone-pad"
                  returnKeyType="next"
                />
              </View>
            </View>

            {/* Address */}
            <View style={styles.formGroup}>
              <Text style={styles.fieldLabel}>ঠিকানা</Text>
              <View style={[styles.textareaDebossed, isInputFocused('partyAddress') && styles.inputFocusedGlow]}>
                <TextInput
                  ref={el => (inputRefs.current['partyAddress'] = el)}
                  value={partyAddress}
                  onChangeText={setPartyAddress}
                  onFocus={() => setFocusedField('partyAddress')}
                  onSubmitEditing={() => focusNextField('partyAddress')}
                  style={styles.textareaInput}
                  placeholder="ঢাকা"
                  multiline
                  returnKeyType="next"
                />
                <View style={styles.textareaCornerGrip}>
                  <View style={styles.gripLine} />
                  <View style={[styles.gripLine, { width: 4 }]} />
                </View>
              </View>
            </View>
          </View>

          {/* Right Card: Date */}
          <View style={[styles.card3D, styles.colRight]}>
            <View style={styles.cardHeaderFlex}>
              <View style={[styles.cardHeaderDot, { backgroundColor: '#0284C7' }]} />
              <Text style={styles.cardHeaderTitle}>তারিখ বিবরণ</Text>
            </View>

            {/* Bill Date */}
            <View style={styles.formGroup}>
              <Text style={styles.fieldLabel}>{isSale ? 'বিক্রয়ের তারিখ' : 'বিলের তারিখ'}</Text>
              <View style={[styles.inputDebossed, isInputFocused('billDate') && styles.inputFocusedGlow]}>
                <TextInput
                  ref={el => (inputRefs.current['billDate'] = el)}
                  value={billDate}
                  onChangeText={setBillDate}
                  onFocus={() => setFocusedField('billDate')}
                  onSubmitEditing={() => focusNextField('billDate')}
                  style={styles.textInput}
                  placeholder="20/09/2026"
                  returnKeyType="next"
                />
                <View style={styles.tactileInnerBtn}>
                  <AppIcon name={icons.calendar} size={18} iconColor="#1c70b9" />
                </View>
              </View>
            </View>

            {/* Due Date */}
            <View style={styles.formGroup}>
              <Text style={styles.fieldLabel}>পরিশোধের শেষ তারিখ</Text>
              <View style={[styles.inputDebossed, isInputFocused('dueDate') && styles.inputFocusedGlow]}>
                <TextInput
                  ref={el => (inputRefs.current['dueDate'] = el)}
                  value={dueDate}
                  onChangeText={setDueDate}
                  onFocus={() => setFocusedField('dueDate')}
                  onSubmitEditing={() => {
                    inputRefs.current['code_0']?.focus();
                    setFocusedField('code_0');
                  }}
                  style={styles.textInput}
                  placeholder="20/09/2026"
                  returnKeyType="next"
                />
                <View style={styles.tactileInnerBtn}>
                  <AppIcon name={icons.calendar} size={18} iconColor="#1c70b9" />
                </View>
              </View>
            </View>

            {/* Decorative Flashy Skeuomorphic Widget */}
            <View style={styles.flashyInfoBanner}>
              <View style={styles.flashyInfoIcon}>
                <AppIcon name={icons.profit} size={20} iconColor="#1c70b9" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.flashyInfoTitle}>দ্রুত ক্রয় ও ইনভয়েস</Text>
                <Text style={styles.flashyInfoSub}>কীবোর্ড শর্টকাট ব্যবহারে সময় বাঁচান এবং নির্ভুল হিসাব রাখুন।</Text>
              </View>
            </View>
          </View>
        </View>

        {/* ROW 2: PRODUCTS TABLE CARD */}
        <View style={[styles.card3D, styles.tableCard]}>
          <View style={styles.tableCardHeader}>
            <View style={styles.cardHeaderFlex}>
              <View style={[styles.cardHeaderDot, { backgroundColor: '#10B981' }]} />
              <Text style={styles.cardHeaderTitle}>পণ্যের তালিকা</Text>
            </View>

            <TouchableOpacity
              onPress={() => addNewRow(true)}
              style={styles.addProductBtn3D}
              accessibilityLabel="পণ্য যোগ করুন (Alt+A)"
            >
              <AppIcon name={icons.add} size={18} iconColor="#1c70b9" />
              <Text style={styles.addProductBtnText}>+ পণ্য যোগ করুন</Text>
            </TouchableOpacity>
          </View>

          {/* Table Header Row */}
          <View style={styles.tableHeaderRow3D}>
            <Text style={[styles.th, { width: 55, textAlign: 'center' }]}>ক্রম</Text>
            <Text style={[styles.th, { width: 140 }]}>পণ্য কোড</Text>
            <Text style={[styles.th, { flex: 2 }]}>পণ্যের নাম</Text>
            <Text style={[styles.th, { width: 110, textAlign: 'center' }]}>পরিমাণ</Text>
            <Text style={[styles.th, { width: 120, textAlign: 'center' }]}>দর (৳)</Text>
            <Text style={[styles.th, { width: 140, textAlign: 'center' }]}>মোট (৳)</Text>
            <Text style={[styles.th, { width: 70, textAlign: 'center' }]}>অ্যাকশন</Text>
          </View>

          {/* Table Rows */}
          {items.map((row, rowIdx) => {
            const rowQty = parseNum(row.qty);
            const rowRate = parseNum(row.rate);
            const rowTotal = Math.round(rowQty * rowRate);

            const filteredRowProducts = products.filter(p => {
              const q = row.name.trim().toLowerCase();
              return !q || p.name.toLowerCase().includes(q);
            }).slice(0, 8);

            return (
              <View key={row.id} style={styles.tableDataRow}>
                {/* Serial # */}
                <View style={[styles.td, { width: 55, alignItems: 'center', justifyContent: 'center' }]}>
                  <View style={styles.serialBadge}>
                    <Text style={styles.serialText}>{toBnDigits(String(rowIdx + 1))}</Text>
                  </View>
                </View>

                {/* Product Code */}
                <View style={[styles.td, { width: 140 }]}>
                  <View style={[styles.tableInputDebossed, isInputFocused(`code_${rowIdx}`) && styles.inputFocusedGlow]}>
                    <TextInput
                      ref={el => (inputRefs.current[`code_${rowIdx}`] = el)}
                      value={row.code}
                      onChangeText={txt => {
                        setItems(prev => {
                          const copy = [...prev];
                          copy[rowIdx].code = txt;
                          return copy;
                        });
                      }}
                      onFocus={() => setFocusedField(`code_${rowIdx}`)}
                      onSubmitEditing={() => {
                        inputRefs.current[`name_${rowIdx}`]?.focus();
                        setFocusedField(`name_${rowIdx}`);
                      }}
                      style={styles.tableTextInputNoBorder}
                      placeholder="300"
                      returnKeyType="next"
                    />
                    <TouchableOpacity
                      onPress={() => setActiveItemDropdownIdx(activeItemDropdownIdx === rowIdx ? null : rowIdx)}
                      style={styles.tableIconWrap}
                    >
                      <AppIcon name={icons.search} size={16} iconColor="#1c70b9" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Product Name with Autocomplete */}
                <View style={[styles.td, { flex: 2, position: 'relative', zIndex: 30 - rowIdx }]}>
                  <TextInput
                    ref={el => (inputRefs.current[`name_${rowIdx}`] = el)}
                    value={row.name}
                    onChangeText={txt => {
                      setItems(prev => {
                        const copy = [...prev];
                        copy[rowIdx].name = txt;
                        return copy;
                      });
                      setActiveItemDropdownIdx(rowIdx);
                    }}
                    onFocus={() => {
                      setFocusedField(`name_${rowIdx}`);
                      setActiveItemDropdownIdx(rowIdx);
                    }}
                    onSubmitEditing={() => {
                      if (activeItemDropdownIdx === rowIdx && filteredRowProducts[itemHighlightIdx]) {
                        onSelectProduct(rowIdx, filteredRowProducts[itemHighlightIdx], itemHighlightIdx);
                      } else {
                        inputRefs.current[`qty_${rowIdx}`]?.focus();
                        setFocusedField(`qty_${rowIdx}`);
                      }
                    }}
                    onKeyPress={(e: any) => {
                      if (activeItemDropdownIdx === rowIdx) {
                        if (e.nativeEvent.key === 'ArrowDown') {
                          setItemHighlightIdx(i => Math.min(filteredRowProducts.length - 1, i + 1));
                        } else if (e.nativeEvent.key === 'ArrowUp') {
                          setItemHighlightIdx(i => Math.max(0, i - 1));
                        }
                      }
                    }}
                    style={[styles.tableTextInput, isInputFocused(`name_${rowIdx}`) && styles.inputFocusedGlow]}
                    placeholder="আতপ চাল"
                    returnKeyType="next"
                  />

                  {/* Product Dropdown */}
                  {activeItemDropdownIdx === rowIdx && (
                    <View style={styles.dropdownMenu3D}>
                      <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
                        {filteredRowProducts.length ? (
                          filteredRowProducts.map((p, pIdx) => {
                            const isHigh = pIdx === itemHighlightIdx;
                            return (
                              <TouchableOpacity
                                key={p.id}
                                onPress={() => onSelectProduct(rowIdx, p, pIdx)}
                                style={[styles.dropdownItem, isHigh && styles.dropdownItemActive]}
                              >
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.dropdownItemText}>{p.name}</Text>
                                  <Text style={styles.dropdownItemSub}>কোড: {300 + pIdx} • স্টক: {n(p.qty)} কেজি</Text>
                                </View>
                                <Text style={styles.dropdownItemDue}>{m(isSale ? p.price : p.cost || 200)}</Text>
                              </TouchableOpacity>
                            );
                          })
                        ) : (
                          <View style={{ padding: 10 }}>
                            <Text style={{ color: '#5B728F', fontSize: 13, textAlign: 'center' }}>কোন পণ্য পাওয়া যায়নি</Text>
                          </View>
                        )}
                      </ScrollView>
                    </View>
                  )}
                </View>

                {/* Quantity */}
                <View style={[styles.td, { width: 110 }]}>
                  <TextInput
                    ref={el => (inputRefs.current[`qty_${rowIdx}`] = el)}
                    value={row.qty}
                    onChangeText={txt => {
                      setItems(prev => {
                        const copy = [...prev];
                        copy[rowIdx].qty = txt;
                        return copy;
                      });
                    }}
                    onFocus={() => setFocusedField(`qty_${rowIdx}`)}
                    onSubmitEditing={() => {
                      inputRefs.current[`rate_${rowIdx}`]?.focus();
                      setFocusedField(`rate_${rowIdx}`);
                    }}
                    style={[
                      styles.tableTextInput,
                      { textAlign: 'center' },
                      isInputFocused(`qty_${rowIdx}`) && styles.inputFocusedGlow,
                    ]}
                    placeholder="1"
                    keyboardType="numeric"
                    returnKeyType="next"
                  />
                </View>

                {/* Rate */}
                <View style={[styles.td, { width: 120 }]}>
                  <TextInput
                    ref={el => (inputRefs.current[`rate_${rowIdx}`] = el)}
                    value={row.rate}
                    onChangeText={txt => {
                      setItems(prev => {
                        const copy = [...prev];
                        copy[rowIdx].rate = txt;
                        return copy;
                      });
                    }}
                    onFocus={() => setFocusedField(`rate_${rowIdx}`)}
                    onSubmitEditing={() => {
                      if (rowIdx === items.length - 1) {
                        if (row.name.trim() || parseNum(row.qty) > 0) {
                          addNewRow(true);
                        } else {
                          inputRefs.current['directCost']?.focus();
                          setFocusedField('directCost');
                        }
                      } else {
                        inputRefs.current[`code_${rowIdx + 1}`]?.focus();
                        setFocusedField(`code_${rowIdx + 1}`);
                      }
                    }}
                    style={[
                      styles.tableTextInput,
                      { textAlign: 'center' },
                      isInputFocused(`rate_${rowIdx}`) && styles.inputFocusedGlow,
                    ]}
                    placeholder="200"
                    keyboardType="numeric"
                    returnKeyType="next"
                  />
                </View>

                {/* Total Box */}
                <View style={[styles.td, { width: 140, alignItems: 'center', justifyContent: 'center' }]}>
                  <View style={styles.tableTotalBox3D}>
                    <Text style={styles.tableTotalText}>
                      {rowTotal ? toBnDigits(String(rowTotal)) : '০'}
                    </Text>
                  </View>
                </View>

                {/* Delete Button */}
                <View style={[styles.td, { width: 70, alignItems: 'center', justifyContent: 'center' }]}>
                  <TouchableOpacity
                    onPress={() => removeRow(rowIdx)}
                    style={styles.deleteRowBtn3D}
                    accessibilityLabel="পণ্য বাদ দিন"
                  >
                    <AppIcon name={icons.del} size={18} iconColor="#E11D48" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        {/* ROW 3: TWO COLUMNS (অতিরিক্ত খরচ & হিসাব বিবরণ) */}
        <View style={[styles.twoColRow, { marginTop: 16 }]}>
          {/* Left Card: অতিরিক্ত খরচ */}
          <View style={[styles.card3D, styles.colLeft]}>
            <View style={styles.cardHeaderFlex}>
              <View style={[styles.cardHeaderDot, { backgroundColor: '#F59E0B' }]} />
              <Text style={styles.cardHeaderTitle}>অতিরিক্ত খরচ</Text>
            </View>

            {/* সরাসরি খরচ (৳) */}
            <View style={styles.calcRow}>
              <View style={styles.calcLabelRow}>
                <View style={[styles.calcDot, { backgroundColor: '#F59E0B' }]} />
                <Text style={styles.calcLabel}>সরাসরি খরচ (৳)</Text>
              </View>
              <TextInput
                ref={el => (inputRefs.current['directCost'] = el)}
                value={directCost}
                onChangeText={setDirectCost}
                onFocus={() => setFocusedField('directCost')}
                onSubmitEditing={() => focusNextField('directCost')}
                style={[
                  styles.calcInputDebossed,
                  isInputFocused('directCost') && styles.inputFocusedGlow,
                ]}
                placeholder="0"
                keyboardType="numeric"
                returnKeyType="next"
              />
            </View>

            {/* পরিবহন খরচ (৳) */}
            <View style={styles.calcRow}>
              <View style={styles.calcLabelRow}>
                <View style={[styles.calcDot, { backgroundColor: '#0284C7' }]} />
                <Text style={styles.calcLabel}>পরিবহন খরচ (৳)</Text>
              </View>
              <TextInput
                ref={el => (inputRefs.current['transportCost'] = el)}
                value={transportCost}
                onChangeText={setTransportCost}
                onFocus={() => setFocusedField('transportCost')}
                onSubmitEditing={() => focusNextField('transportCost')}
                style={[
                  styles.calcInputDebossed,
                  isInputFocused('transportCost') && styles.inputFocusedGlow,
                ]}
                placeholder="500"
                keyboardType="numeric"
                returnKeyType="next"
              />
            </View>

            {/* ল্যান্ডিং খরচ (৳) */}
            <View style={styles.calcRow}>
              <View style={styles.calcLabelRow}>
                <View style={[styles.calcDot, { backgroundColor: '#10B981' }]} />
                <Text style={styles.calcLabel}>ল্যান্ডিং খরচ (৳)</Text>
              </View>
              <TextInput
                ref={el => (inputRefs.current['landingCost'] = el)}
                value={landingCost}
                onChangeText={setLandingCost}
                onFocus={() => setFocusedField('landingCost')}
                onSubmitEditing={() => focusNextField('landingCost')}
                style={[
                  styles.calcInputDebossed,
                  isInputFocused('landingCost') && styles.inputFocusedGlow,
                ]}
                placeholder="500"
                keyboardType="numeric"
                returnKeyType="next"
              />
            </View>

            {/* অন্যান্য খরচ (৳) */}
            <View style={styles.calcRow}>
              <View style={styles.calcLabelRow}>
                <View style={[styles.calcDot, { backgroundColor: '#8B5CF6' }]} />
                <Text style={styles.calcLabel}>অন্যান্য খরচ (৳)</Text>
              </View>
              <TextInput
                ref={el => (inputRefs.current['otherCost'] = el)}
                value={otherCost}
                onChangeText={setOtherCost}
                onFocus={() => setFocusedField('otherCost')}
                onSubmitEditing={() => focusNextField('otherCost')}
                style={[
                  styles.calcInputDebossed,
                  isInputFocused('otherCost') && styles.inputFocusedGlow,
                ]}
                placeholder="200"
                keyboardType="numeric"
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Right Card: হিসাব বিবরণ */}
          <View style={[styles.card3D, styles.colRight]}>
            <View style={styles.cardHeaderFlex}>
              <View style={[styles.cardHeaderDot, { backgroundColor: '#1c70b9' }]} />
              <Text style={styles.cardHeaderTitle}>হিসাব বিবরণ</Text>
            </View>

            {/* মোট পণ্যের মূল্য (৳) */}
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>মোট পণ্যের মূল্য (৳)</Text>
              <View style={styles.readOnlySunkenBox}>
                <Text style={styles.readOnlySunkenText}>
                  {toBnDigits(String(Math.round(totalProductValue)))}
                </Text>
              </View>
            </View>

            {/* পূর্বের বাকি (৳) */}
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>পূর্বের বাকি (৳)</Text>
              <View style={[styles.readOnlySunkenBox, { backgroundColor: '#FFF5F5', borderColor: '#FED7D7' }]}>
                <Text style={[styles.readOnlySunkenText, { color: '#C53030' }]}>
                  {toBnDigits(String(Math.round(prevDue)).replace(/\B(?=(\d{3})+(?!\d))/g, ','))}
                </Text>
              </View>
            </View>

            {/* ক্যাশ পরিশোধ (৳) */}
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>ক্যাশ পরিশোধ (৳)</Text>
              <TextInput
                ref={el => (inputRefs.current['cashPaid'] = el)}
                value={cashPaid}
                onChangeText={setCashPaid}
                onFocus={() => setFocusedField('cashPaid')}
                onSubmitEditing={() => focusNextField('cashPaid')}
                style={[
                  styles.calcInputDebossed,
                  isInputFocused('cashPaid') && styles.inputFocusedGlow,
                ]}
                placeholder="3000"
                keyboardType="numeric"
                returnKeyType="next"
              />
            </View>

            {/* ব্যাংক পরিশোধ (৳) */}
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>ব্যাংক পরিশোধ (৳)</Text>
              <TextInput
                ref={el => (inputRefs.current['bankPaid'] = el)}
                value={bankPaid}
                onChangeText={setBankPaid}
                onFocus={() => setFocusedField('bankPaid')}
                onSubmitEditing={() => handleComplete()}
                style={[
                  styles.calcInputDebossed,
                  isInputFocused('bankPaid') && styles.inputFocusedGlow,
                ]}
                placeholder="0"
                keyboardType="numeric"
                returnKeyType="done"
              />
            </View>

            {/* Flashy Grand Total Banner (Skeuomorphic Azure-Cyan) */}
            <View style={styles.grandTotalBanner3D}>
              <View>
                <Text style={styles.grandTotalLabel}>সর্বমোট (৳)</Text>
                <Text style={styles.grandTotalSub}>নিট প্রদেয় বা অবশিষ্ট বাকি</Text>
              </View>
              <Text style={styles.grandTotalValue}>
                {toBnDigits(String(Math.round(grandTotal)).replace(/\B(?=(\d{3})+(?!\d))/g, ','))}
              </Text>
            </View>
          </View>
        </View>

        {/* ROW 4: FOOTER ACTION BUTTONS */}
        <View style={styles.footerRow}>
          <View style={styles.footerLeftButtons}>
            <TouchableOpacity
              onPress={onDone}
              style={styles.cancelButton3D}
              accessibilityLabel="বাতিল করুন (Esc)"
            >
              <AppIcon name={icons.cancel} size={18} iconColor="#4B627E" />
              <Text style={styles.cancelButton3DText}>বাতিল করুন</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSaveDraft}
              style={styles.draftButton3D}
              accessibilityLabel="ড্রাফট সংরক্ষণ (Ctrl+D)"
            >
              <AppIcon name={icons.draft} size={18} iconColor="#1c70b9" />
              <Text style={styles.draftButton3DText}>ড্রাফট সংরক্ষণ</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={handleComplete}
            style={styles.completeButton3D}
            accessibilityLabel="ক্রয় সম্পন্ন করুন (Ctrl+S / F8)"
          >
            <AppIcon name={isSale ? icons.sale : icons.purchase} size={22} iconColor="#fff" />
            <Text style={styles.completeButton3DText}>
              {isSale ? 'বিক্রয় সম্পন্ন করুন' : 'ক্রয় সম্পন্ন করুন'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* SUCCESS INVOICE MODAL */}
      {successTxn && (
        <SuccessModal
          kind={isSale ? 'sale' : 'purchase'}
          invoiceNo={successTxn.invoiceNo}
          total={successTxn.total}
          txnId={successTxn.id}
          onClose={() => {
            setSuccessTxn(null);
            onDone();
          }}
        />
      )}

      {/* KEYBOARD SHORTCUTS HELP MODAL */}
      <Modal
        visible={showShortcutsHelp}
        transparent
        animationType="fade"
        onRequestClose={() => setShowShortcutsHelp(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setShowShortcutsHelp(false)}
          style={styles.modalOverlay}
        >
          <TouchableOpacity activeOpacity={1} style={styles.shortcutModalBox}>
            <View style={styles.modalHeader3D}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                <AppIcon name={icons.calc} size={22} iconColor="#fff" />
                <Text style={styles.modalTitle}>কীবোর্ড শর্টকাট সহায়িকা (Keyboard First)</Text>
              </View>
              <TouchableOpacity
                onPress={() => setShowShortcutsHelp(false)}
                style={{ padding: 4 }}
              >
                <AppIcon name={icons.cancel} size={22} iconColor="#fff" />
              </TouchableOpacity>
            </View>

            <ScrollView style={{ padding: 18, maxHeight: 420 }}>
              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>Enter</Text></View>
                <Text style={styles.shortcutDesc}>পরবর্তী ঘরে যান (Next Field) / ড্রপডাউন থেকে নির্বাচন</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>Shift + Enter</Text></View>
                <Text style={styles.shortcutDesc}>পূর্ববর্তী ঘরে ফেরত যান (Previous Field)</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>Alt + A / Insert</Text></View>
                <Text style={styles.shortcutDesc}>নতুন পণ্যের সারি যোগ করুন (Add Product Row)</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>Ctrl + S / F8</Text></View>
                <Text style={styles.shortcutDesc}>ক্রয় সম্পন্ন করুন ও সেভ করুন (Complete Purchase)</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>Ctrl + D / F9</Text></View>
                <Text style={styles.shortcutDesc}>ড্রাফট সংরক্ষণ করুন (Save Draft)</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>↑ / ↓</Text></View>
                <Text style={styles.shortcutDesc}>পণ্য ও সরবরাহকারী সাজেশনে স্ক্রল করুন (Navigate Dropdown)</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>Esc</Text></View>
                <Text style={styles.shortcutDesc}>ড্রপডাউন বা ডায়লগ বন্ধ করুন / বাতিল করুন (Cancel/Close)</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>F1</Text></View>
                <Text style={styles.shortcutDesc}>শর্টকাট সহায়িকা খুলুন বা বন্ধ করুন (Toggle Shortcuts)</Text>
              </View>

              <View style={{ backgroundColor: '#F0F9FF', padding: 12, borderRadius: 8, marginTop: 12, borderWidth: 1, borderColor: '#BAE6FD' }}>
                <Text style={{ fontSize: 13, color: '#0369A1', fontWeight: '600' }}>
                  💡 টিপস: রেট (দর) ঘরে এন্টার চাপলে স্বয়ংক্রিয়ভাবে নতুন সারিতে চলে যাবে। বাংলা ও ইংরেজি উভয় সংখ্যাই টাইপ করা যাবে।
                </Text>
              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  outerWrapper: {
    flex: 1,
    position: 'relative',
    backgroundColor: '#F0F6FC',
  },
  container: {
    flex: 1,
    backgroundColor: '#F0F6FC',
  },
  contentContainer: {
    padding: 16,
    paddingBottom: 40,
    maxWidth: 1400,
    alignSelf: 'center',
    width: '100%',
  },
  toastContainer: {
    position: 'absolute',
    top: 20,
    alignSelf: 'center',
    zIndex: 9999,
    backgroundColor: '#0F1E36',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#38BDF8',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 8px 24px rgba(15, 30, 54, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
    } as any : {}),
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },

  // SKEUOMORPHIC HEADER BAR
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1c70b9',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 16,
    position: 'relative',
    overflow: 'hidden',
    borderTopWidth: 1.5,
    borderTopColor: '#60b0f4',
    borderBottomWidth: 3.5,
    borderBottomColor: '#124c7e',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(135deg, #2592ed 0%, #1c70b9 52%, #12518e 100%)',
      boxShadow: '0 8px 22px rgba(28, 112, 185, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.45)',
    } as any : {}),
  },
  headerGlossSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    zIndex: 2,
  },
  backButton3D: {
    padding: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.4)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0, 0, 0, 0.25)',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
    } as any : {}),
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  titleIconBadge: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0, 0, 0, 0.2)',
  },
  headerTitle: {
    color: '#fff',
    fontSize: 21,
    fontWeight: '800',
    letterSpacing: 0.3,
    ...(Platform.OS === 'web' ? {
      textShadow: '0 1px 2px rgba(0, 0, 0, 0.25)',
    } as any : {}),
  },
  flashyHeaderTag: {
    backgroundColor: '#38BDF8',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    marginLeft: 4,
    borderWidth: 1,
    borderColor: '#7DD3FC',
  },
  flashyHeaderTagText: {
    color: '#0C4A7E',
    fontSize: 11,
    fontWeight: '800',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 2,
  },
  shortcutGuideBadge3D: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.4)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0, 0, 0, 0.25)',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
    } as any : {}),
  },
  shortcutGuideBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '800',
  },
  iconCircleButton3D: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.4)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0, 0, 0, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      boxShadow: '0 2px 6px rgba(0, 0, 0, 0.15)',
    } as any : {}),
  },

  // TWO COLUMN LAYOUT
  twoColRow: {
    flexDirection: 'row',
    gap: 16,
  },
  colLeft: {
    flex: 1.5,
  },
  colRight: {
    flex: 1,
  },

  // SKEUOMORPHIC 3D CARDS
  card3D: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#D8E7F5',
    padding: 18,
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 10px 28px -4px rgba(28, 112, 185, 0.09), 0 2px 6px rgba(0, 0, 0, 0.03), inset 0 1px 0 #FFFFFF',
    } as any : {
      elevation: 4,
      shadowColor: '#1c70b9',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
    }),
  },
  cardHeaderFlex: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
  },
  cardHeaderDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  cardHeaderTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F2B48',
    letterSpacing: 0.2,
  },

  // FORM GROUPS & DEBOSSED INPUTS
  formRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  formCol: {
    flex: 1,
  },
  formGroup: {
    marginBottom: 12,
  },
  fieldLabel: {
    fontSize: 13,
    color: '#3A526E',
    fontWeight: '700',
    marginBottom: 6,
  },
  inputDebossed: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#CCE0F2',
    borderRadius: 10,
    backgroundColor: '#F8FAFD',
    paddingHorizontal: 10,
    height: 42,
    ...(Platform.OS === 'web' ? {
      boxShadow: 'inset 0 2px 4px rgba(28, 112, 185, 0.05)',
    } as any : {}),
  },
  inputFocusedGlow: {
    borderColor: '#1c70b9',
    borderWidth: 2,
    backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 0 0 4px rgba(28, 112, 185, 0.22), inset 0 1px 2px rgba(28, 112, 185, 0.06)',
    } as any : {}),
  },
  tactileInnerBtn: {
    padding: 6,
    borderRadius: 6,
    backgroundColor: '#EAF3FC',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      boxShadow: '0 1px 3px rgba(28, 112, 185, 0.1)',
    } as any : {}),
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#0F1E36',
    paddingVertical: 6,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  textareaDebossed: {
    borderWidth: 1.5,
    borderColor: '#CCE0F2',
    borderRadius: 10,
    backgroundColor: '#F8FAFD',
    padding: 8,
    height: 68,
    position: 'relative',
    ...(Platform.OS === 'web' ? {
      boxShadow: 'inset 0 2px 4px rgba(28, 112, 185, 0.05)',
    } as any : {}),
  },
  textareaInput: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: '#0F1E36',
    textAlignVertical: 'top',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none', resize: 'none' } as any) : {}),
  },
  textareaCornerGrip: {
    position: 'absolute',
    bottom: 4,
    right: 4,
    alignItems: 'flex-end',
    gap: 2,
  },
  gripLine: {
    height: 1.5,
    width: 8,
    backgroundColor: '#94A3B8',
    borderRadius: 1,
  },

  // DROPDOWNS
  dropdownMenu3D: {
    position: 'absolute',
    top: 70,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#BEE0FA',
    shadowColor: '#1c70b9',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 12,
    zIndex: 100,
    overflow: 'hidden',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 12px 30px rgba(28, 112, 185, 0.18), inset 0 1px 0 #FFFFFF',
    } as any : {}),
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F6FC',
  },
  dropdownItemActive: {
    backgroundColor: '#EBF4FE',
  },
  dropdownItemText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
  },
  dropdownItemSub: {
    fontSize: 12,
    color: '#5B728F',
    marginTop: 2,
  },
  dropdownItemDue: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1c70b9',
  },

  // WIDGET CARD
  flashyInfoBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 12,
    marginTop: 10,
    borderWidth: 1.5,
    borderColor: '#BFDBFE',
    borderBottomWidth: 3,
    borderBottomColor: '#93C5FD',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 3px 8px rgba(28, 112, 185, 0.08), inset 0 1px 0 #FFFFFF',
    } as any : {}),
  },
  flashyInfoIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  flashyInfoTitle: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1E40AF',
  },
  flashyInfoSub: {
    fontSize: 12,
    color: '#3B82F6',
    marginTop: 2,
  },

  // PRODUCTS TABLE CARD
  tableCard: {
    marginTop: 16,
    zIndex: 20,
  },
  tableCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
  },
  addProductBtn3D: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#1c70b9',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 3,
    borderBottomColor: '#124c7e',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #EFF6FC 100%)',
      boxShadow: '0 4px 10px rgba(28, 112, 185, 0.16), inset 0 1px 0 #FFFFFF',
    } as any : {}),
  },
  addProductBtnText: {
    color: '#1c70b9',
    fontSize: 13,
    fontWeight: '800',
  },
  tableHeaderRow3D: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F2FD',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#CCE2F7',
    borderBottomWidth: 2,
    borderBottomColor: '#B6D7F6',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(180deg, #EDF5FE 0%, #DFEFFD 100%)',
    } as any : {}),
  },
  th: {
    fontSize: 13,
    fontWeight: '800',
    color: '#0F3B63',
    paddingHorizontal: 4,
  },
  tableDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#EDF5FC',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  td: {
    paddingHorizontal: 4,
  },
  serialBadge: {
    width: 28,
    height: 28,
    borderRadius: 7,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  serialText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1c70b9',
  },
  tableInputDebossed: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#CCE0F2',
    borderRadius: 8,
    backgroundColor: '#F8FAFD',
    paddingHorizontal: 8,
    height: 38,
    ...(Platform.OS === 'web' ? {
      boxShadow: 'inset 0 1px 3px rgba(28, 112, 185, 0.05)',
    } as any : {}),
  },
  tableTextInputNoBorder: {
    flex: 1,
    height: 36,
    fontSize: 13,
    fontWeight: '600',
    color: '#0F1E36',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  tableTextInput: {
    borderWidth: 1.5,
    borderColor: '#CCE0F2',
    borderRadius: 8,
    backgroundColor: '#F8FAFD',
    height: 38,
    paddingHorizontal: 8,
    fontSize: 13,
    fontWeight: '600',
    color: '#0F1E36',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  tableIconWrap: {
    paddingLeft: 4,
  },
  tableTotalBox3D: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 38,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    borderBottomWidth: 2,
    borderBottomColor: '#93C5FD',
  },
  tableTotalText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#1c70b9',
  },
  deleteRowBtn3D: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#FFE4E6',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FECDD3',
    borderBottomWidth: 2,
    borderBottomColor: '#FDA4AF',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
    } as any : {}),
  },

  // ADDITIONAL COSTS & CALCULATION SUMMARY
  calcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calcLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  calcDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  calcLabel: {
    fontSize: 13,
    color: '#3A526E',
    fontWeight: '700',
  },
  calcInputDebossed: {
    width: 180,
    height: 38,
    borderWidth: 1.5,
    borderColor: '#CCE0F2',
    borderRadius: 8,
    backgroundColor: '#F8FAFD',
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
    textAlign: 'right',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  readOnlySunkenBox: {
    width: 180,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    borderWidth: 1,
    borderColor: '#BFDBFE',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  readOnlySunkenText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#1c70b9',
  },

  // FLASHY SKEUOMORPHIC GRAND TOTAL BANNER
  grandTotalBanner3D: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E0F2FE',
    borderRadius: 12,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginTop: 10,
    borderWidth: 1.5,
    borderColor: '#7DD3FC',
    borderBottomWidth: 3.5,
    borderBottomColor: '#38BDF8',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(135deg, #E0F2FE 0%, #BAE6FD 50%, #A5D8FD 100%)',
      boxShadow: '0 6px 18px rgba(28, 112, 185, 0.18), inset 0 1px 1px #FFFFFF',
    } as any : {}),
  },
  grandTotalLabel: {
    fontSize: 15,
    fontWeight: '800',
    color: '#034575',
  },
  grandTotalSub: {
    fontSize: 11,
    fontWeight: '600',
    color: '#0284C7',
    marginTop: 2,
  },
  grandTotalValue: {
    fontSize: 22,
    fontWeight: '900',
    color: '#034575',
    letterSpacing: 0.5,
  },

  // FOOTER ACTIONS
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 22,
  },
  footerLeftButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cancelButton3D: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 11,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 3,
    borderBottomColor: '#94A3B8',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      boxShadow: '0 3px 8px rgba(0, 0, 0, 0.05), inset 0 1px 0 #FFFFFF',
    } as any : {}),
  },
  cancelButton3DText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '700',
  },
  draftButton3D: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 11,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 3,
    borderBottomColor: '#3B82F6',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #F4F9FD 100%)',
      boxShadow: '0 3px 8px rgba(28, 112, 185, 0.1), inset 0 1px 0 #FFFFFF',
    } as any : {}),
  },
  draftButton3DText: {
    color: '#1c70b9',
    fontSize: 14,
    fontWeight: '700',
  },
  completeButton3D: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#1c70b9',
    borderRadius: 10,
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderTopWidth: 1.5,
    borderTopColor: '#6cb8f7',
    borderBottomWidth: 3.5,
    borderBottomColor: '#0c3a64',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      backgroundImage: 'linear-gradient(180deg, #2c93ea 0%, #1c70b9 52%, #145591 100%)',
      boxShadow: '0 8px 22px rgba(28, 112, 185, 0.42), inset 0 1px 1px rgba(255, 255, 255, 0.5)',
    } as any : {}),
  },
  completeButton3DText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.3,
  },

  // SHORTCUTS MODAL
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(15, 30, 54, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  shortcutModalBox: {
    width: '100%',
    maxWidth: 580,
    backgroundColor: '#fff',
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#1c70b9',
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 10,
    borderWidth: 1.5,
    borderColor: '#BEE0FA',
  },
  modalHeader3D: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#1c70b9',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 3,
    borderBottomColor: '#124c7e',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(135deg, #2592ed 0%, #1c70b9 52%, #12518e 100%)',
    } as any : {}),
  },
  modalTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  shortcutItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F6FC',
  },
  keyBadge: {
    minWidth: 110,
    backgroundColor: '#F0F6FC',
    borderWidth: 1.5,
    borderColor: '#CCE0F2',
    borderBottomWidth: 2.5,
    borderBottomColor: '#B6D7F6',
    borderRadius: 7,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  keyBadgeText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#1c70b9',
  },
  shortcutDesc: {
    flex: 1,
    fontSize: 13,
    color: '#3A526E',
    fontWeight: '600',
  },
});
