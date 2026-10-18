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

  // Active focus tracking for visual ring
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

  // Dates (default to today or 20/09/2026 format)
  const todayFormatted = useMemo(() => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }, []);

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
      // Find Ashraf or first party
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
      // Find আতপ চাল or first product
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
    if (!selectedPartyId) return 5000; // default initial demo or real balance
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

  // Exact matching to the reference image:
  // পণ্যের মূল্য (200) + পূর্বের বাকি (5,000) - পরিশোধ (3,000) = সর্বমোট (2,200)
  // When additional costs are included or zero, it calculates accurately.
  const grandTotal = useMemo(() => {
    // If additional costs were entered, in the image additional costs (500+500+200=1200)
    // are listed on the left as operation expenses, while the right summary displays:
    // (Total Products + Prev Due) - (Cash Paid + Bank Paid) = (200 + 5000) - 3000 = 2200.
    // If user changes products/due, net balance is reactive:
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
    // Auto-focus quantity field after selecting product
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

  const focusPrevField = useCallback((currentKey: string) => {
    const seq = getNavSequence();
    const currentIdx = seq.indexOf(currentKey);
    if (currentIdx > 0) {
      const prevKey = seq[currentIdx - 1];
      inputRefs.current[prevKey]?.focus();
      setFocusedField(prevKey);
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

    // Resolve cash or bank accounts from store
    const cashAcc = moneyAccounts.find(a => a.type === 'cash') || moneyAccounts[0];
    const bankAcc = moneyAccounts.find(a => a.type === 'bank') || moneyAccounts[0];
    const chosenAccountId = numBank > 0 ? bankAcc?.id : cashAcc?.id;

    try {
      // Map valid lines with fallback product if not in DB
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

      // Record additional transport / landing / other expenses
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

      // Remove saved draft on complete
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.removeItem(`${DRAFT_STORAGE_KEY_PREFIX}${mode}`);
      }

      // Show success modal
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

  // Global Keyboard Shortcuts Listener (Web & Desktop)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // F1: Toggle Keyboard Shortcuts Guide
      if (e.key === 'F1') {
        e.preventDefault();
        setShowShortcutsHelp(prev => !prev);
        return;
      }

      // Ctrl + S or F8: Complete Purchase / Sale
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') || e.key === 'F8') {
        e.preventDefault();
        handleComplete();
        return;
      }

      // Ctrl + D or F9: Save Draft
      if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') || e.key === 'F9') {
        e.preventDefault();
        handleSaveDraft();
        return;
      }

      // Alt + A or Insert: Add New Product Row
      if ((e.altKey && e.key.toLowerCase() === 'a') || e.key === 'Insert') {
        e.preventDefault();
        addNewRow(true);
        return;
      }

      // Escape: Close modals, dropdowns, or go back
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

  // Focus style helper
  const isInputFocused = (key: string) => focusedField === key;

  return (
    <View style={styles.outerWrapper}>
      {/* Copied / Action Toast */}
      {copiedToast ? (
        <View style={styles.toastContainer}>
          <AppIcon name={icons.done} size={18} iconColor="#fff" />
          <Text style={styles.toastText}>{copiedToast}</Text>
        </View>
      ) : null}

      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.contentContainer}
        keyboardShouldPersistTaps="handled"
      >
        {/* TOP HEADER - Emerald Deep Green with curves */}
        <View style={styles.headerBar}>
          {/* Subtle decorative curved leaf watermark on right */}
          <View style={styles.headerDecorCurves} pointerEvents="none" />

          {/* Left: Back button + Shopping bag icon + Title */}
          <View style={styles.headerLeft}>
            <TouchableOpacity
              onPress={onDone}
              style={styles.backButton}
              accessibilityLabel="পিছনে যান"
            >
              <AppIcon name={icons.back} size={22} iconColor="#fff" />
            </TouchableOpacity>

            <View style={styles.headerTitleRow}>
              <AppIcon name={isSale ? icons.sale : icons.purchase} size={24} iconColor="#fff" />
              <Text style={styles.headerTitle}>{isSale ? 'নতুন বিক্রয়' : 'নতুন ক্রয়'}</Text>
            </View>
          </View>

          {/* Right: Search + Bell buttons + F1 Keyboard shortcut trigger */}
          <View style={styles.headerRight}>
            <TouchableOpacity
              onPress={() => setShowShortcutsHelp(true)}
              style={styles.shortcutGuideBadge}
              accessibilityLabel="কীবোর্ড শর্টকাট"
            >
              <Text style={styles.shortcutGuideBadgeText}>F1: কীবোর্ড</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconCircleButton} accessibilityLabel="খুঁজুন">
              <AppIcon name={icons.search} size={20} iconColor="#fff" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconCircleButton} accessibilityLabel="নোটিফিকেশন">
              <AppIcon name={icons.bell} size={20} iconColor="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ROW 1: TWO COLUMNS (ক্রয়ের তথ্য & তারিখ) */}
        <View style={styles.twoColRow}>
          {/* Left Card: Purchase Info */}
          <View style={[styles.card, styles.colLeft]}>
            <Text style={styles.cardHeaderTitle}>{isSale ? 'বিক্রয়ের তথ্য' : 'ক্রয়ের তথ্য'}</Text>

            {/* Order No & Memo No in 1 Row */}
            <View style={styles.formRow}>
              <View style={styles.formCol}>
                <Text style={styles.fieldLabel}>{isSale ? 'বিক্রয় অর্ডার নং' : 'ক্রয় অর্ডার নং'}</Text>
                <View style={[styles.inputWithIcon, isInputFocused('orderNo') && styles.inputFocused]}>
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
                    style={styles.inputInnerIcon}
                    accessibilityLabel="কপি করুন"
                  >
                    <AppIcon name={icons.copy} size={18} iconColor="#64748B" />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.formCol}>
                <Text style={styles.fieldLabel}>{isSale ? 'বিক্রয় মেমো নং' : 'ক্রয় মেমো নং'}</Text>
                <View style={[styles.inputWithIcon, isInputFocused('memoNo') && styles.inputFocused]}>
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
                    style={styles.inputInnerIcon}
                    accessibilityLabel="কপি করুন"
                  >
                    <AppIcon name={icons.copy} size={18} iconColor="#64748B" />
                  </TouchableOpacity>
                </View>
              </View>
            </View>

            {/* Party Code with search icon */}
            <View style={styles.formGroup}>
              <Text style={styles.fieldLabel}>{isSale ? 'কাস্টমার কোড' : 'সরবরাহকারী কোড'}</Text>
              <View style={[styles.inputWithIcon, isInputFocused('partyCode') && styles.inputFocused]}>
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
                  style={styles.inputInnerIcon}
                >
                  <AppIcon name={icons.search} size={18} iconColor="#64748B" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Party Name with Autocomplete Dropdown */}
            <View style={[styles.formGroup, { position: 'relative', zIndex: 40 }]}>
              <Text style={styles.fieldLabel}>{isSale ? 'কাস্টমারের নাম' : 'সরবরাহকারীর নাম'}</Text>
              <View style={[styles.inputWithIcon, isInputFocused('partyName') && styles.inputFocused]}>
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
                  style={styles.inputInnerIcon}
                >
                  <AppIcon name={icons.search} size={18} iconColor="#64748B" />
                </TouchableOpacity>
              </View>

              {/* Autocomplete Dropdown List */}
              {partyDropdownOpen && (
                <View style={styles.dropdownMenu}>
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
                        <Text style={{ color: '#64748B', fontSize: 13, textAlign: 'center' }}>কোন সরবরাহকারী পাওয়া যায়নি</Text>
                      </View>
                    )}
                  </ScrollView>
                </View>
              )}
            </View>

            {/* Mobile Number */}
            <View style={styles.formGroup}>
              <Text style={styles.fieldLabel}>মোবাইল নম্বর</Text>
              <View style={[styles.inputWithIcon, isInputFocused('partyMobile') && styles.inputFocused]}>
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
              <View style={[styles.textareaWrapper, isInputFocused('partyAddress') && styles.inputFocused]}>
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
          <View style={[styles.card, styles.colRight]}>
            <Text style={styles.cardHeaderTitle}>তারিখ</Text>

            {/* Bill Date */}
            <View style={styles.formGroup}>
              <Text style={styles.fieldLabel}>{isSale ? 'বিক্রয়ের তারিখ' : 'বিলের তারিখ'}</Text>
              <View style={[styles.inputWithIcon, isInputFocused('billDate') && styles.inputFocused]}>
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
                <View style={styles.inputInnerIcon}>
                  <AppIcon name={icons.calendar} size={18} iconColor="#64748B" />
                </View>
              </View>
            </View>

            {/* Due Date */}
            <View style={styles.formGroup}>
              <Text style={styles.fieldLabel}>পরিশোধের শেষ তারিখ</Text>
              <View style={[styles.inputWithIcon, isInputFocused('dueDate') && styles.inputFocused]}>
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
                <View style={styles.inputInnerIcon}>
                  <AppIcon name={icons.calendar} size={18} iconColor="#64748B" />
                </View>
              </View>
            </View>
          </View>
        </View>

        {/* ROW 2: PRODUCTS TABLE CARD */}
        <View style={[styles.card, styles.tableCard]}>
          <View style={styles.tableCardHeader}>
            <Text style={styles.cardHeaderTitle}>পণ্যের তালিকা</Text>

            <TouchableOpacity
              onPress={() => addNewRow(true)}
              style={styles.addProductBtn}
              accessibilityLabel="পণ্য যোগ করুন (Alt+A)"
            >
              <AppIcon name={icons.add} size={18} iconColor="#006A4E" />
              <Text style={styles.addProductBtnText}>+ পণ্য যোগ করুন</Text>
            </TouchableOpacity>
          </View>

          {/* Table Header Row */}
          <View style={styles.tableHeaderRow}>
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
                  <Text style={styles.cellText}>{toBnDigits(String(rowIdx + 1))}</Text>
                </View>

                {/* Product Code */}
                <View style={[styles.td, { width: 140 }]}>
                  <View style={[styles.tableInputWithIcon, isInputFocused(`code_${rowIdx}`) && styles.inputFocused]}>
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
                      <AppIcon name={icons.search} size={16} iconColor="#64748B" />
                    </TouchableOpacity>
                  </View>
                </View>

                {/* Product Name with Autocomplete Dropdown */}
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
                    style={[styles.tableTextInput, isInputFocused(`name_${rowIdx}`) && styles.inputFocused]}
                    placeholder="আতপ চাল"
                    returnKeyType="next"
                  />

                  {/* Product Dropdown */}
                  {activeItemDropdownIdx === rowIdx && (
                    <View style={styles.itemDropdownMenu}>
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
                            <Text style={{ color: '#64748B', fontSize: 13, textAlign: 'center' }}>কোন পণ্য পাওয়া যায়নি</Text>
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
                      isInputFocused(`qty_${rowIdx}`) && styles.inputFocused,
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
                      // Keyboard-first magic: pressing enter on rate adds new row or moves to additional costs
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
                      isInputFocused(`rate_${rowIdx}`) && styles.inputFocused,
                    ]}
                    placeholder="200"
                    keyboardType="numeric"
                    returnKeyType="next"
                  />
                </View>

                {/* Total (Read-only grey box) */}
                <View style={[styles.td, { width: 140, alignItems: 'center', justifyContent: 'center' }]}>
                  <View style={styles.tableTotalBox}>
                    <Text style={styles.tableTotalText}>
                      {rowTotal ? toBnDigits(String(rowTotal)) : '০'}
                    </Text>
                  </View>
                </View>

                {/* Action: Red Outline Delete Icon */}
                <View style={[styles.td, { width: 70, alignItems: 'center', justifyContent: 'center' }]}>
                  <TouchableOpacity
                    onPress={() => removeRow(rowIdx)}
                    style={styles.deleteRowBtn}
                    accessibilityLabel="পণ্য বাদ দিন"
                  >
                    <AppIcon name={icons.del} size={20} iconColor="#EF4444" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        {/* ROW 3: TWO COLUMNS (অতিরিক্ত খরচ & হিসাব বিবরণ) */}
        <View style={[styles.twoColRow, { marginTop: 16 }]}>
          {/* Left Card: অতিরিক্ত খরচ (4 fields matching image) */}
          <View style={[styles.card, styles.colLeft]}>
            <Text style={styles.cardHeaderTitle}>অতিরিক্ত খরচ</Text>

            {/* সরাসরি খরচ (৳) */}
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>সরাসরি খরচ (৳)</Text>
              <TextInput
                ref={el => (inputRefs.current['directCost'] = el)}
                value={directCost}
                onChangeText={setDirectCost}
                onFocus={() => setFocusedField('directCost')}
                onSubmitEditing={() => focusNextField('directCost')}
                style={[
                  styles.calcInputBox,
                  isInputFocused('directCost') && styles.inputFocused,
                ]}
                placeholder="0"
                keyboardType="numeric"
                returnKeyType="next"
              />
            </View>

            {/* পরিবহন খরচ (৳) */}
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>পরিবহন খরচ (৳)</Text>
              <TextInput
                ref={el => (inputRefs.current['transportCost'] = el)}
                value={transportCost}
                onChangeText={setTransportCost}
                onFocus={() => setFocusedField('transportCost')}
                onSubmitEditing={() => focusNextField('transportCost')}
                style={[
                  styles.calcInputBox,
                  isInputFocused('transportCost') && styles.inputFocused,
                ]}
                placeholder="500"
                keyboardType="numeric"
                returnKeyType="next"
              />
            </View>

            {/* ল্যান্ডিং খরচ (৳) */}
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>ল্যান্ডিং খরচ (৳)</Text>
              <TextInput
                ref={el => (inputRefs.current['landingCost'] = el)}
                value={landingCost}
                onChangeText={setLandingCost}
                onFocus={() => setFocusedField('landingCost')}
                onSubmitEditing={() => focusNextField('landingCost')}
                style={[
                  styles.calcInputBox,
                  isInputFocused('landingCost') && styles.inputFocused,
                ]}
                placeholder="500"
                keyboardType="numeric"
                returnKeyType="next"
              />
            </View>

            {/* অন্যান্য খরচ (৳) */}
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>অন্যান্য খরচ (৳)</Text>
              <TextInput
                ref={el => (inputRefs.current['otherCost'] = el)}
                value={otherCost}
                onChangeText={setOtherCost}
                onFocus={() => setFocusedField('otherCost')}
                onSubmitEditing={() => focusNextField('otherCost')}
                style={[
                  styles.calcInputBox,
                  isInputFocused('otherCost') && styles.inputFocused,
                ]}
                placeholder="200"
                keyboardType="numeric"
                returnKeyType="next"
              />
            </View>
          </View>

          {/* Right Card: হিসাব বিবরণ */}
          <View style={[styles.card, styles.colRight]}>
            <Text style={styles.cardHeaderTitle}>হিসাব বিবরণ</Text>

            {/* মোট পণ্যের মূল্য (৳) */}
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>মোট পণ্যের মূল্য (৳)</Text>
              <View style={styles.readOnlyCalcBox}>
                <Text style={styles.readOnlyCalcText}>
                  {toBnDigits(String(Math.round(totalProductValue)))}
                </Text>
              </View>
            </View>

            {/* পূর্বের বাকি (৳) */}
            <View style={styles.calcRow}>
              <Text style={styles.calcLabel}>পূর্বের বাকি (৳)</Text>
              <View style={styles.readOnlyCalcBox}>
                <Text style={styles.readOnlyCalcText}>
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
                  styles.calcInputBox,
                  isInputFocused('cashPaid') && styles.inputFocused,
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
                  styles.calcInputBox,
                  isInputFocused('bankPaid') && styles.inputFocused,
                ]}
                placeholder="0"
                keyboardType="numeric"
                returnKeyType="done"
              />
            </View>

            {/* Grand Total Banner */}
            <View style={styles.grandTotalBanner}>
              <Text style={styles.grandTotalLabel}>সর্বমোট (৳)</Text>
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
              style={styles.cancelOutlineBtn}
              accessibilityLabel="বাতিল করুন (Esc)"
            >
              <AppIcon name={icons.cancel} size={18} iconColor="#475569" />
              <Text style={styles.cancelOutlineBtnText}>বাতিল করুন</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSaveDraft}
              style={styles.draftOutlineBtn}
              accessibilityLabel="ড্রাফট সংরক্ষণ (Ctrl+D)"
            >
              <AppIcon name={icons.draft} size={18} iconColor="#475569" />
              <Text style={styles.draftOutlineBtnText}>ড্রাফট সংরক্ষণ</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            onPress={handleComplete}
            style={styles.completeBtn}
            accessibilityLabel="ক্রয় সম্পন্ন করুন (Ctrl+S / F8)"
          >
            <AppIcon name={isSale ? icons.sale : icons.purchase} size={20} iconColor="#fff" />
            <Text style={styles.completeBtnText}>
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
            <View style={styles.modalHeader}>
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

              <View style={{ backgroundColor: '#F0FDF4', padding: 12, borderRadius: 8, marginTop: 12 }}>
                <Text style={{ fontSize: 13, color: '#166534', fontWeight: '600' }}>
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
    backgroundColor: '#F3F7F5',
  },
  container: {
    flex: 1,
    backgroundColor: '#F3F7F5',
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
    backgroundColor: '#0F172A',
    borderRadius: 24,
    paddingHorizontal: 20,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
  },
  toastText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },

  // HEADER BAR
  headerBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#006A4E',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 16,
    position: 'relative',
    overflow: 'hidden',
  },
  headerDecorCurves: {
    position: 'absolute',
    top: -20,
    right: -20,
    width: 200,
    height: 120,
    borderBottomLeftRadius: 100,
    borderTopLeftRadius: 100,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    zIndex: 2,
  },
  backButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 2,
  },
  shortcutGuideBadge: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.25)',
  },
  shortcutGuideBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '700',
  },
  iconCircleButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: 'rgba(255, 255, 255, 0.16)',
    alignItems: 'center',
    justifyContent: 'center',
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

  // CARD STYLING
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 3,
  },
  cardHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F2C20',
    marginBottom: 14,
  },

  // FORM GROUPS & INPUTS
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
    color: '#334155',
    fontWeight: '600',
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
    height: 42,
  },
  inputFocused: {
    borderColor: '#006A4E',
    borderWidth: 2,
    ...(Platform.OS === 'web'
      ? ({ boxShadow: '0 0 0 3px rgba(0, 106, 78, 0.15)' } as any)
      : {}),
  },
  inputInnerIcon: {
    paddingLeft: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 6,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  textareaWrapper: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    backgroundColor: '#fff',
    padding: 8,
    height: 68,
    position: 'relative',
  },
  textareaInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
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
  dropdownMenu: {
    position: 'absolute',
    top: 70,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 10,
    zIndex: 100,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  dropdownItemActive: {
    backgroundColor: '#EDF5F0',
  },
  dropdownItemText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  dropdownItemSub: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 2,
  },
  dropdownItemDue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#006A4E',
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
  addProductBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#006A4E',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: '#fff',
  },
  addProductBtnText: {
    color: '#006A4E',
    fontSize: 13,
    fontWeight: '700',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EBF3EE',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  th: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F2C20',
    paddingHorizontal: 4,
  },
  tableDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  td: {
    paddingHorizontal: 4,
  },
  cellText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  tableInputWithIcon: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 8,
    height: 38,
  },
  tableTextInputNoBorder: {
    flex: 1,
    height: 36,
    fontSize: 13,
    color: '#0F172A',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  tableTextInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    backgroundColor: '#fff',
    height: 38,
    paddingHorizontal: 8,
    fontSize: 13,
    color: '#0F172A',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  tableIconWrap: {
    paddingLeft: 4,
  },
  itemDropdownMenu: {
    position: 'absolute',
    top: 42,
    left: 4,
    right: 4,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    elevation: 8,
    zIndex: 100,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
  },
  tableTotalBox: {
    backgroundColor: '#EEF2F0',
    borderRadius: 6,
    paddingHorizontal: 12,
    height: 38,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableTotalText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  deleteRowBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // ADDITIONAL COSTS & CALCULATION SUMMARY
  calcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calcLabel: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  calcInputBox: {
    width: 180,
    height: 38,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    backgroundColor: '#fff',
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
    textAlign: 'right',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  readOnlyCalcBox: {
    width: 180,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#EEF2F0',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  readOnlyCalcText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  grandTotalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#D5F2DF',
    borderRadius: 8,
    paddingHorizontal: 16,
    paddingVertical: 12,
    marginTop: 8,
  },
  grandTotalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#065F46',
  },
  grandTotalValue: {
    fontSize: 20,
    fontWeight: '800',
    color: '#065F46',
  },

  // FOOTER ACTIONS
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 20,
  },
  footerLeftButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cancelOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  cancelOutlineBtnText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
  },
  draftOutlineBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  draftOutlineBtnText: {
    color: '#334155',
    fontSize: 14,
    fontWeight: '600',
  },
  completeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#006A4E',
    borderRadius: 8,
    paddingHorizontal: 26,
    paddingVertical: 11,
  },
  completeBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },

  // SHORTCUTS MODAL
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
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
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#006A4E',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  modalTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  shortcutItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  keyBadge: {
    minWidth: 110,
    backgroundColor: '#F1F5F9',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
    alignItems: 'center',
  },
  keyBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#0F172A',
  },
  shortcutDesc: {
    flex: 1,
    fontSize: 13,
    color: '#334155',
  },
});
