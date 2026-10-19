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
import { BagUnit, kgPerUnit } from '../bags';

export interface FormItemLine {
  id: string;
  code: string;
  productId: string;
  name: string;
  unit: BagUnit;
  qty: string;
  purchaseRate: string;
  rate: string;
}

interface TradeDashboardFormProps {
  mode: 'purchase' | 'sale';
  onDone: () => void;
}

const DRAFT_STORAGE_KEY_PREFIX = 'chaler_arot_draft_';
const SESSION_BILL_DATE_KEY = 'chaler_arot_session_bill_date';
let inMemorySessionBillDate = '';

export const getSessionBillDate = (): string => {
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      const stored = window.sessionStorage.getItem(SESSION_BILL_DATE_KEY);
      if (stored) return stored;
    }
  } catch {}
  if (inMemorySessionBillDate) return inMemorySessionBillDate;
  const d = new Date();
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${day}/${month}/${year}`;
};

export const setSessionBillDate = (val: string): void => {
  inMemorySessionBillDate = val;
  try {
    if (typeof window !== 'undefined' && window.sessionStorage) {
      window.sessionStorage.setItem(SESSION_BILL_DATE_KEY, val);
    }
  } catch {}
};

export function TradeDashboardForm({ mode, onDone }: TradeDashboardFormProps) {
  const isSale = mode === 'sale';
  const { t, lang, products, vendors, customers, bal, purchase, sale, moneyAccounts, saveExpense } = useApp();
  const m = useMoney();
  const n = useNum();

  // Parties list based on mode
  const parties: Party[] = isSale ? customers : vendors;

  // Active focus tracking for skeuomorphic glowing ring
  const [focusedField, setFocusedField] = useState<string>('memoNo');

  // Input refs for keyboard navigation
  const inputRefs = useRef<Record<string, TextInput | null>>({});

  // Auto-generated order no & memo no (with serial persistence)
  const [orderNo, setOrderNo] = useState(() => String(Math.floor(100 + Math.random() * 900)));
  const [memoNo, setMemoNo] = useState('90876');

  // Party selection state
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [partyCode, setPartyCode] = useState('340');
  const [partyName, setPartyName] = useState('');
  const [partyMobile, setPartyMobile] = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [partyDropdownOpen, setPartyDropdownOpen] = useState(false);
  const [partyHighlightIdx, setPartyHighlightIdx] = useState(0);

  // Date persists in session until changed by user
  const [billDate, setBillDateState] = useState(() => getSessionBillDate());
  const setBillDate = useCallback((val: string) => {
    setBillDateState(val);
    setSessionBillDate(val);
  }, []);

  // Products table items
  const [items, setItems] = useState<FormItemLine[]>([
    { id: 'item_1', code: '300', productId: '', name: 'আতপ চাল', unit: 'medium', qty: '', purchaseRate: '200', rate: '200' },
  ]);
  const [activeItemDropdownIdx, setActiveItemDropdownIdx] = useState<number | null>(null);
  const [itemHighlightIdx, setItemHighlightIdx] = useState(0);

  // Additional costs (Transport, Landing)
  const [transportCost, setTransportCost] = useState('0');
  const [landingCost, setLandingCost] = useState('0');

  // Payments (Cash, Bank)
  const [cashPaid, setCashPaid] = useState('0');
  const [bankPaid, setBankPaid] = useState('0');

  // Split Confirmation Modal state
  const [reviewSplitOpen, setReviewSplitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Success modal state
  const [successTxn, setSuccessTxn] = useState<{ id: string; invoiceNo: string; total: number } | null>(null);

  // Keyboard shortcut help modal
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Copy feedback toast
  const [copiedToast, setCopiedToast] = useState<string | null>(null);

  // Initialize matching product/party if available from store
  useEffect(() => {
    if (parties.length > 0 && !selectedPartyId) {
      const match = parties[0];
      if (match) {
        setSelectedPartyId(match.id);
        setPartyCode('340');
        setPartyName(match.name);
        setPartyMobile(match.mobile || '');
        setPartyAddress(match.address || '');
      }
    }
  }, [parties, selectedPartyId]);

  useEffect(() => {
    if (products.length > 0 && items.length > 0 && !items[0].productId) {
      const match = products.find(p => p.name.includes('আতপ')) || products[0];
      if (match) {
        const u = items[0].unit || 'medium';
        const per = kgPerUnit(match, u);
        const costVal = Math.round((match.cost || 0) * per);
        const priceVal = isSale
          ? Math.round((match.price || 0) * per)
          : (costVal || 200);

        setItems(prev => [
          {
            ...prev[0],
            productId: match.id,
            name: match.name,
            code: prev[0].code || '300',
            unit: u,
            purchaseRate: prev[0].purchaseRate || String(costVal || (isSale ? 0 : 200)),
            rate: prev[0].rate || String(priceVal),
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

  const totalEstimatedCost = useMemo(() => {
    return items.reduce((sum, item) => {
      const q = parseNum(item.qty);
      const pr = parseNum(item.purchaseRate);
      return sum + q * pr;
    }, 0);
  }, [items]);

  const estimatedProfit = useMemo(() => {
    return isSale ? (totalProductValue - totalEstimatedCost) : 0;
  }, [isSale, totalProductValue, totalEstimatedCost]);

  const numTransport = parseNum(transportCost);
  const numLanding = parseNum(landingCost);
  const totalAdditionalCosts = numTransport + numLanding;

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
      const matchesCode = !codeQ || pCode.includes(codeQ) || String(idx + 1) === codeQ;
      return matchesName || matchesCode;
    }).slice(0, 8);
  }, [parties, partyName, partyCode]);

  // Find party by code (340+ or 1..N), ID, mobile, or name from database
  const findPartyByCode = useCallback((codeQuery: string): { party: Party; code: string; index: number } | null => {
    if (!codeQuery) return null;
    const q = codeQuery.trim().toLowerCase();

    // 1. Numeric matching
    const num = parseInt(q, 10);
    if (!isNaN(num)) {
      // 340+ base code
      if (num >= 340 && num < 340 + parties.length) {
        const idx = num - 340;
        return { party: parties[idx], code: String(num), index: idx };
      }
      // 1-based index (1, 2, 3...)
      if (num >= 1 && num <= parties.length) {
        const idx = num - 1;
        return { party: parties[idx], code: String(340 + idx), index: idx };
      }
    }

    // 2. Party ID (e.g. v1, v2, c1, c2)
    const byIdIdx = parties.findIndex(p => p.id.toLowerCase() === q);
    if (byIdIdx !== -1) {
      return { party: parties[byIdIdx], code: String(340 + byIdIdx), index: byIdIdx };
    }

    // 3. Mobile
    const cleanQ = q.replace(/\D/g, '');
    if (cleanQ.length >= 3) {
      const byMobileIdx = parties.findIndex(p => p.mobile && p.mobile.replace(/\D/g, '').includes(cleanQ));
      if (byMobileIdx !== -1) {
        return { party: parties[byMobileIdx], code: String(340 + byMobileIdx), index: byMobileIdx };
      }
    }

    // 4. Exact or prefix name
    const byNameIdx = parties.findIndex(p => p.name.toLowerCase() === q || p.name.toLowerCase().startsWith(q));
    if (byNameIdx !== -1) {
      return { party: parties[byNameIdx], code: String(340 + byNameIdx), index: byNameIdx };
    }

    return null;
  }, [parties]);

  const onSelectParty = useCallback((p: Party, idx?: number) => {
    const fullIdx = idx !== undefined && idx >= 0 ? idx : parties.findIndex(x => x.id === p.id);
    setSelectedPartyId(p.id);
    setPartyCode(String(340 + (fullIdx !== -1 ? fullIdx : 0)));
    setPartyName(p.name);
    setPartyMobile(p.mobile || '');
    setPartyAddress(p.address || '');
    setPartyDropdownOpen(false);
  }, [parties]);

  // Find product by code, index, or ID
  const findProductByCode = useCallback((codeQuery: string): { product: Product; code: string } | null => {
    if (!codeQuery) return null;
    const q = codeQuery.trim().toLowerCase();
    // 1. Match numeric index (1, 2, 3...)
    const num = parseInt(q, 10);
    if (!isNaN(num)) {
      if (num >= 1 && num <= products.length) {
        return { product: products[num - 1], code: String(num) };
      }
      if (num >= 300 && num < 300 + products.length) {
        return { product: products[num - 300], code: String(num) };
      }
    }
    // 2. Match product ID (e.g. p1, p2)
    const byIdIdx = products.findIndex(p => p.id.toLowerCase() === q);
    if (byIdIdx !== -1) {
      return { product: products[byIdIdx], code: String(byIdIdx + 1) };
    }
    // 3. Match product name
    const byNameIdx = products.findIndex(p => p.name.toLowerCase().includes(q));
    if (byNameIdx !== -1) {
      return { product: products[byNameIdx], code: String(byNameIdx + 1) };
    }
    return null;
  }, [products]);

  // Code change handler: auto selects product name, unit, purchaseRate & rate
  const handleCodeChange = useCallback((rowIdx: number, val: string) => {
    setItems(prev => {
      const copy = [...prev];
      const match = findProductByCode(val);
      if (match) {
        const u = copy[rowIdx].unit || 'medium';
        const per = kgPerUnit(match.product, u);
        const costVal = Math.round((match.product.cost || 0) * per);
        const priceVal = isSale
          ? Math.round((match.product.price || 0) * per)
          : (costVal || 200);

        copy[rowIdx] = {
          ...copy[rowIdx],
          code: val,
          productId: match.product.id,
          name: match.product.name,
          unit: u,
          qty: copy[rowIdx].qty || '',
          purchaseRate: String(costVal || (isSale ? 0 : 200)),
          rate: String(priceVal),
        };
      } else {
        copy[rowIdx] = {
          ...copy[rowIdx],
          code: val,
          productId: '',
          name: '',
          purchaseRate: '',
        };
      }
      return copy;
    });
  }, [findProductByCode, isSale]);

  // Product selection
  const onSelectProduct = useCallback((rowIdx: number, p: Product, pIdx: number) => {
    setItems(prev => {
      const copy = [...prev];
      const u = copy[rowIdx].unit || 'medium';
      const per = kgPerUnit(p, u);
      const costVal = Math.round((p.cost || 0) * per);
      const priceVal = isSale
        ? Math.round((p.price || 0) * per)
        : (costVal || 200);

      copy[rowIdx] = {
        ...copy[rowIdx],
        code: String(pIdx + 1),
        productId: p.id,
        name: p.name,
        unit: u,
        qty: copy[rowIdx].qty || '',
        purchaseRate: String(costVal || (isSale ? 0 : 200)),
        rate: String(priceVal),
      };
      return copy;
    });
    setActiveItemDropdownIdx(null);
  }, [isSale]);

  // Unit change handler (toggle between 'medium' [বস্তা] and 'kg' [কেজি])
  const handleUnitChange = useCallback((rowIdx: number, newUnit: BagUnit) => {
    setItems(prev => {
      const copy = [...prev];
      const row = copy[rowIdx];
      const p = products.find(x => x.id === row.productId || x.name === row.name);
      const newPer = p ? kgPerUnit(p, newUnit) : (newUnit === 'kg' ? 1 : 50);

      const newCost = p ? Math.round((p.cost || 0) * newPer) : 0;
      const newPrice = p ? (isSale ? Math.round((p.price || 0) * newPer) : (newCost || 200)) : 0;

      copy[rowIdx] = {
        ...row,
        unit: newUnit,
        purchaseRate: String(newCost || row.purchaseRate),
        rate: String(newPrice || row.rate),
      };
      return copy;
    });
  }, [products, isSale]);

  // Add new product row
  const addNewRow = useCallback((autoFocus = true) => {
    const newIdx = items.length;
    const newId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    setItems(prev => [
      ...prev,
      { id: newId, code: '', productId: '', name: '', unit: 'medium', qty: '', purchaseRate: '', rate: '' },
    ]);
    if (autoFocus) {
      setTimeout(() => {
        inputRefs.current[`code_${newIdx}`]?.focus();
        setFocusedField(`code_${newIdx}`);
      }, 50);
    }
  }, [items.length]);

  // Remove product row
  const removeRow = useCallback((idx: number) => {
    if (items.length <= 1) {
      setItems([{ id: 'item_1', code: '', productId: '', name: '', unit: 'medium', qty: '', purchaseRate: '', rate: '' }]);
      return;
    }
    setItems(prev => prev.filter((_, i) => i !== idx));
  }, [items.length]);

  // Keyboard navigation sequence
  const getNavSequence = useCallback((): string[] => {
    const seq: string[] = [];
    seq.push('memoNo');
    seq.push('partyCode');
    seq.push('billDate');

    items.forEach((_, idx) => {
      seq.push(`code_${idx}`);
      seq.push(`qty_${idx}`);
      if (isSale) {
        seq.push(`purchaseRate_${idx}`);
      }
      seq.push(`rate_${idx}`);
    });

    return seq;
  }, [isSale, items]);

  const focusNextField = useCallback((currentKey: string) => {
    const seq = getNavSequence();
    const currentIdx = seq.indexOf(currentKey);
    if (currentIdx >= 0 && currentIdx < seq.length - 1) {
      const nextKey = seq[currentIdx + 1];
      inputRefs.current[nextKey]?.focus();
      setFocusedField(nextKey);
    } else if (currentKey.startsWith('rate_')) {
      // If pressing Enter on the last rate field, automatically add a new product row and focus it!
      addNewRow(true);
    }
  }, [getNavSequence, addNewRow]);

  const focusPrevField = useCallback((currentKey: string) => {
    const seq = getNavSequence();
    const currentIdx = seq.indexOf(currentKey);
    if (currentIdx > 0) {
      const prevKey = seq[currentIdx - 1];
      inputRefs.current[prevKey]?.focus();
      setFocusedField(prevKey);
    }
  }, [getNavSequence]);

  // Handle Enter on Party Code: fetch vendor from DB, fill name/mobile/address, and move focus
  const handlePartyCodeSubmit = useCallback(() => {
    const trimmed = partyCode.trim();
    const match = findPartyByCode(trimmed);
    if (match) {
      onSelectParty(match.party, match.index);
      setPartyDropdownOpen(false);
      focusNextField('partyCode');
      return;
    }
    if (filteredParties.length > 0 && partyHighlightIdx >= 0 && partyHighlightIdx < filteredParties.length) {
      const p = filteredParties[partyHighlightIdx];
      const fullIdx = parties.findIndex(x => x.id === p.id);
      onSelectParty(p, fullIdx !== -1 ? fullIdx : partyHighlightIdx);
      setPartyDropdownOpen(false);
      focusNextField('partyCode');
      return;
    }
    if (filteredParties.length === 1) {
      const p = filteredParties[0];
      const fullIdx = parties.findIndex(x => x.id === p.id);
      onSelectParty(p, fullIdx !== -1 ? fullIdx : 0);
      setPartyDropdownOpen(false);
      focusNextField('partyCode');
      return;
    }
    focusNextField('partyCode');
  }, [partyCode, findPartyByCode, onSelectParty, filteredParties, partyHighlightIdx, parties, focusNextField]);

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
      items,
      transportCost,
      landingCost,
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
    partyAddress, billDate, items, transportCost,
    landingCost, cashPaid, bankPaid
  ]);

  // Open Split Confirmation Modal after preliminary validation
  const handleOpenConfirm = useCallback(() => {
    const validLines = items.filter(it => it.name.trim() && parseNum(it.qty) > 0);
    if (!validLines.length) {
      Alert.alert(t('invalid'), 'অনুগ্রহ করে অন্তত একটি পণ্যের নাম ও পরিমাণ (কেজি/বস্তা) দিন।');
      return;
    }

    if (!selectedPartyId && !parties.length) {
      Alert.alert(t('invalid'), isSale ? 'অনুগ্রহ করে কাস্টমার নির্বাচন করুন।' : 'অনুগ্রহ করে সরবরাহকারী নির্বাচন করুন।');
      return;
    }

    setReviewSplitOpen(true);
  }, [items, isSale, selectedPartyId, parties, t]);

  // Final submission handler that creates the invoice
  const executeTransaction = useCallback(async () => {
    if (submitting) return;
    const validLines = items.filter(it => it.name.trim() && parseNum(it.qty) > 0);
    if (!validLines.length) {
      Alert.alert(t('invalid'), 'অনুগ্রহ করে অন্তত একটি পণ্যের নাম ও পরিমাণ দিন।');
      return;
    }

    const effectivePartyId = selectedPartyId || (parties[0]?.id ?? '');
    const cashAcc = moneyAccounts.find(a => a.type === 'cash') || moneyAccounts[0];
    const bankAcc = moneyAccounts.find(a => a.type === 'bank') || moneyAccounts[0];
    const chosenAccountId = numBank > 0 ? bankAcc?.id : cashAcc?.id;

    setSubmitting(true);
    try {
      const processedLines = validLines.map(l => {
        let pId = l.productId;
        let prod = products.find(p => p.id === pId);
        if (!pId || !prod) {
          prod = products.find(p => p.name.toLowerCase() === l.name.toLowerCase()) || products[0];
          pId = prod?.id || 'p1';
        }
        const unit = (l.unit || 'medium') as BagUnit;
        const per = prod ? kgPerUnit(prod, unit) : (unit === 'kg' ? 1 : 50);
        const enteredQty = parseNum(l.qty) || 1;
        const enteredRate = parseNum(l.rate);
        const enteredPurchaseRate = parseNum(l.purchaseRate);

        // Rate per KG for backend (since backend records rate per KG and sub += qtyKg * rate)
        const ratePerKg = per > 0 ? (enteredRate / per) : enteredRate;
        // Purchase cost per KG for backend (if admin modified purchase price)
        const unitCostPerKg = enteredPurchaseRate > 0 ? (enteredPurchaseRate / per) : (prod?.cost || 0);

        return {
          productId: pId,
          unit: unit,
          enteredQty: enteredQty,
          rate: Math.round(ratePerKg * 100) / 100,
          unitCost: isSale ? Math.round(unitCostPerKg * 100) / 100 : undefined,
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
        });
      } else {
        res = await purchase({
          vendorId: effectivePartyId,
          lines: processedLines,
          paid: totalPaid,
          accountId: chosenAccountId,
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
          note: `${isSale ? 'বিক্রয়' : 'ক্রয়'} #${memoNo} পরিবহন খরচ`,
        }).catch(() => {});
      }
      if (numLanding > 0 && chosenAccountId) {
        await saveExpense({
          category: 'loading',
          customName: 'ল্যান্ডিং খরচ',
          amount: numLanding,
          accountId: chosenAccountId,
          date: todayISO,
          note: `${isSale ? 'বিক্রয়' : 'ক্রয়'} #${memoNo} ল্যান্ডিং খরচ`,
        }).catch(() => {});
      }

      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.removeItem(`${DRAFT_STORAGE_KEY_PREFIX}${mode}`);
      }

      setReviewSplitOpen(false);
      setSuccessTxn({
        id: res.id,
        invoiceNo: res.invoiceNo || memoNo,
        total: res.total || totalProductValue,
      });
    } catch (err) {
      Alert.alert(t('invalid'), err instanceof Error ? err.message : 'লেনদেন সম্পন্ন করা সম্ভব হয়নি।');
    } finally {
      setSubmitting(false);
    }
  }, [
    items, isSale, selectedPartyId, parties, moneyAccounts, numBank, products,
    totalPaid, billDate, sale, purchase, numTransport,
    numLanding, mode, memoNo, totalProductValue, saveExpense, t, submitting
  ]);

  // Global Keyboard Shortcuts Listener
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;

    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // 1. ESC: Close modals / dropdowns or return
      if (e.key === 'Escape') {
        if (showShortcutsHelp) {
          setShowShortcutsHelp(false);
          e.preventDefault();
          return;
        }
        if (reviewSplitOpen) {
          setReviewSplitOpen(false);
          e.preventDefault();
          return;
        }
        if (partyDropdownOpen) {
          setPartyDropdownOpen(false);
          e.preventDefault();
          return;
        }
        if (activeItemDropdownIdx !== null) {
          setActiveItemDropdownIdx(null);
          e.preventDefault();
          return;
        }
      }

      // 2. F1: Toggle shortcuts help guide
      if (e.key === 'F1') {
        e.preventDefault();
        setShowShortcutsHelp(prev => !prev);
        return;
      }

      // 3. Ctrl+S or F8: Confirm & Open Split Review / Complete
      if ((e.ctrlKey && e.key.toLowerCase() === 's') || e.key === 'F8') {
        e.preventDefault();
        if (reviewSplitOpen) {
          executeTransaction();
        } else {
          handleOpenConfirm();
        }
        return;
      }

      // 4. Ctrl+D or F9: Save Draft
      if ((e.ctrlKey && e.key.toLowerCase() === 'd') || e.key === 'F9') {
        e.preventDefault();
        handleSaveDraft();
        return;
      }

      // 5. Alt+A or Insert: Add new product row
      if ((e.altKey && e.key.toLowerCase() === 'a') || e.key === 'Insert') {
        e.preventDefault();
        addNewRow(true);
        return;
      }
    };

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => window.removeEventListener('keydown', handleGlobalKeyDown);
  }, [
    showShortcutsHelp, reviewSplitOpen, partyDropdownOpen, activeItemDropdownIdx,
    executeTransaction, handleOpenConfirm, handleSaveDraft, addNewRow
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

            {/* Memo No */}
            <View style={styles.formGroup}>
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

            {/* Party Code */}
            <View style={[styles.formGroup, { position: 'relative', zIndex: 50 }]}>
              <Text style={styles.fieldLabel}>{isSale ? 'কাস্টমার কোড' : 'সরবরাহকারী কোড'}</Text>
              <View style={[styles.inputDebossed, isInputFocused('partyCode') && styles.inputFocusedGlow]}>
                <TextInput
                  ref={el => (inputRefs.current['partyCode'] = el)}
                  value={partyCode}
                  onChangeText={v => {
                    setPartyCode(v);
                    setPartyDropdownOpen(true);
                    if (v.trim().length >= 3) {
                      const match = findPartyByCode(v.trim());
                      if (match) {
                        setSelectedPartyId(match.party.id);
                        setPartyName(match.party.name);
                        setPartyMobile(match.party.mobile || '');
                        setPartyAddress(match.party.address || '');
                      }
                    } else if (!v.trim()) {
                      setSelectedPartyId('');
                      setPartyName('');
                      setPartyMobile('');
                      setPartyAddress('');
                    }
                  }}
                  onFocus={() => {
                    setFocusedField('partyCode');
                    setPartyDropdownOpen(true);
                  }}
                  onBlur={() => {
                    if (partyCode.trim()) {
                      const match = findPartyByCode(partyCode.trim());
                      if (match && selectedPartyId !== match.party.id) {
                        onSelectParty(match.party, match.index);
                      }
                    }
                  }}
                  onSubmitEditing={handlePartyCodeSubmit}
                  onKeyPress={(e: any) => {
                    if (partyDropdownOpen) {
                      if (e.nativeEvent.key === 'ArrowDown') {
                        e.preventDefault?.();
                        setPartyHighlightIdx(i => Math.min(filteredParties.length - 1, i + 1));
                      } else if (e.nativeEvent.key === 'ArrowUp') {
                        e.preventDefault?.();
                        setPartyHighlightIdx(i => Math.max(0, i - 1));
                      } else if (e.nativeEvent.key === 'Escape') {
                        setPartyDropdownOpen(false);
                      }
                    }
                  }}
                  style={styles.textInput}
                  placeholder={!isSale ? "340" : "345"}
                  keyboardType="numeric"
                  returnKeyType="next"
                />
                <TouchableOpacity
                  onPress={() => {
                    setFocusedField('partyCode');
                    setPartyDropdownOpen(prev => !prev);
                  }}
                  style={styles.tactileInnerBtn}
                >
                  <AppIcon name={icons.search} size={18} iconColor="#1c70b9" />
                </TouchableOpacity>
              </View>

              {/* Autocomplete Dropdown anchored under Party Code */}
              {partyDropdownOpen && (
                <View style={styles.dropdownMenu3D}>
                  <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
                    {filteredParties.length ? (
                      filteredParties.map((p, idx) => {
                        const isHighlighted = idx === partyHighlightIdx;
                        const fullIdx = parties.findIndex(x => x.id === p.id);
                        const pDisplayCode = String(340 + (fullIdx !== -1 ? fullIdx : idx));
                        return (
                          <TouchableOpacity
                            key={p.id}
                            onPress={() => {
                              onSelectParty(p, fullIdx !== -1 ? fullIdx : idx);
                              focusNextField('partyCode');
                            }}
                            style={[styles.dropdownItem, isHighlighted && styles.dropdownItemActive]}
                          >
                            <View style={{ flex: 1 }}>
                              <Text style={styles.dropdownItemText}>{p.name}</Text>
                              <Text style={styles.dropdownItemSub}>{p.mobile || 'কোন নম্বর নেই'} • কোড: {pDisplayCode}</Text>
                            </View>
                            <Text style={styles.dropdownItemDue}>{m(bal(isSale ? 'c' : 'v', p.id).balance)}</Text>
                          </TouchableOpacity>
                        );
                      })
                    ) : (
                      <View style={{ padding: 12 }}>
                        <Text style={{ color: '#5B728F', fontSize: 13, textAlign: 'center' }}>
                          {isSale ? 'কোন কাস্টমার পাওয়া যায়নি' : 'কোন সরবরাহকারী পাওয়া যায়নি'}
                        </Text>
                      </View>
                    )}
                  </ScrollView>
                </View>
              )}
            </View>

            {/* Party Name */}
            <View style={styles.formGroup}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={styles.fieldLabel}>{isSale ? 'কাস্টমারের নাম' : 'সরবরাহকারীর নাম'}</Text>
                <View style={styles.readOnlyBadge}>
                  <AppIcon name={icons.lock} size={11} iconColor="#64748B" />
                  <Text style={styles.readOnlyBadgeText}>ডাটাবেজ থেকে</Text>
                </View>
              </View>
              <View style={[styles.inputDebossed, styles.inputReadOnly]}>
                <TextInput
                  ref={el => (inputRefs.current['partyName'] = el)}
                  value={partyName}
                  editable={false}
                  style={[styles.textInput, styles.textInputReadOnly]}
                  placeholder="কোড লিখলে নাম স্বয়ংক্রিয় আসবে"
                  placeholderTextColor="#94A3B8"
                />
              </View>
            </View>

            {/* Mobile */}
            <View style={styles.formGroup}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={styles.fieldLabel}>মোবাইল নম্বর</Text>
                <View style={styles.readOnlyBadge}>
                  <Text style={styles.readOnlyBadgeText}>রিড-অনলি</Text>
                </View>
              </View>
              <View style={[styles.inputDebossed, styles.inputReadOnly]}>
                <TextInput
                  ref={el => (inputRefs.current['partyMobile'] = el)}
                  value={partyMobile}
                  editable={false}
                  style={[styles.textInput, styles.textInputReadOnly]}
                  placeholder="মোবাইল নম্বর"
                  placeholderTextColor="#94A3B8"
                />
              </View>
            </View>

            {/* Address */}
            <View style={styles.formGroup}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={styles.fieldLabel}>ঠিকানা</Text>
                <View style={styles.readOnlyBadge}>
                  <Text style={styles.readOnlyBadgeText}>রিড-অনলি</Text>
                </View>
              </View>
              <View style={[styles.textareaDebossed, styles.inputReadOnly]}>
                <TextInput
                  ref={el => (inputRefs.current['partyAddress'] = el)}
                  value={partyAddress}
                  editable={false}
                  style={[styles.textareaInput, styles.textInputReadOnly]}
                  placeholder="ঠিকানা"
                  placeholderTextColor="#94A3B8"
                  multiline
                />
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
                  placeholder={getSessionBillDate()}
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
                <Text style={styles.flashyInfoTitle}>{isSale ? 'দ্রুত বিক্রয় ও ইনভয়েস' : 'দ্রুত ক্রয় ও ইনভয়েস'}</Text>
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
              style={styles.addProductBtnModern}
              activeOpacity={0.85}
              accessibilityLabel="পণ্য যোগ করুন (Alt+A)"
            >
              <View style={styles.addIconCircle}>
                <AppIcon name={icons.plus} size={15} iconColor="#FFFFFF" />
              </View>
              <Text style={styles.addProductBtnText}>পণ্য যোগ করুন</Text>
              <View style={styles.shortcutKeyBadge}>
                <Text style={styles.shortcutKeyText}>Alt+A</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Table Header Row */}
          <View style={styles.tableHeaderRow3D}>
            <Text style={[styles.th, { width: isSale ? 48 : 50, textAlign: 'center' }]}>ক্রম</Text>
            <Text style={[styles.th, { width: isSale ? 120 : 130 }]}>পণ্য কোড</Text>
            <Text style={[styles.th, { flex: 2, minWidth: isSale ? 150 : 160 }]}>পণ্যের নাম</Text>
            <Text style={[styles.th, { width: isSale ? 90 : 95, textAlign: 'center' }]}>একক</Text>
            <Text style={[styles.th, { width: isSale ? 85 : 95, textAlign: 'center' }]}>পরিমাণ</Text>
            {isSale && (
              <Text style={[styles.th, { width: 125, textAlign: 'center' }]}>গড় ক্রয়দর (৳)</Text>
            )}
            <Text style={[styles.th, { width: isSale ? 110 : 125, textAlign: 'center' }]}>
              {isSale ? 'বিক্রয় দর (৳)' : 'ক্রয় দর (৳)'}
            </Text>
            <Text style={[styles.th, { width: isSale ? 120 : 130, textAlign: 'center' }]}>মোট (৳)</Text>
            <Text style={[styles.th, { width: isSale ? 55 : 60, textAlign: 'center' }]}>অ্যাকশন</Text>
          </View>

          {/* Table Rows */}
          {items.map((row, rowIdx) => {
            const rowQty = parseNum(row.qty);
            const rowRate = parseNum(row.rate);
            const rowTotal = Math.round(rowQty * rowRate);
            const rowProduct = products.find(p => p.id === row.productId || p.name === row.name);
            const bagKg = rowProduct?.mediumBagKg || 50;
            const isBag = (row.unit || 'medium') === 'medium';
            const per = isBag ? bagKg : 1;
            const basePurchaseRate = rowProduct ? Math.round((rowProduct.cost || 0) * per) : 0;
            const rowPurchaseRate = parseNum(row.purchaseRate);
            const rowProfit = isSale && rowQty > 0 && rowPurchaseRate > 0
              ? Math.round((rowRate - rowPurchaseRate) * rowQty)
              : null;

            return (
              <View key={row.id} style={styles.tableDataRow}>
                {/* Serial # */}
                <View style={[styles.td, { width: isSale ? 48 : 50, alignItems: 'center', justifyContent: 'center' }]}>
                  <View style={styles.serialBadge}>
                    <Text style={styles.serialText}>{toBnDigits(String(rowIdx + 1))}</Text>
                  </View>
                </View>

                {/* Product Code */}
                <View style={[styles.td, { width: isSale ? 120 : 130, position: 'relative', zIndex: 40 - rowIdx }]}>
                  <View style={[styles.tableInputDebossed, isInputFocused(`code_${rowIdx}`) && styles.inputFocusedGlow]}>
                    <TextInput
                      ref={el => (inputRefs.current[`code_${rowIdx}`] = el)}
                      value={row.code}
                      onChangeText={txt => handleCodeChange(rowIdx, txt)}
                      onFocus={() => {
                        setFocusedField(`code_${rowIdx}`);
                        setActiveItemDropdownIdx(rowIdx);
                      }}
                      onSubmitEditing={() => {
                        setActiveItemDropdownIdx(null);
                        focusNextField(`code_${rowIdx}`);
                      }}
                      onKeyPress={(e: any) => {
                        if (e.nativeEvent.key === 'Escape') {
                          setActiveItemDropdownIdx(null);
                        }
                      }}
                      style={styles.tableTextInputNoBorder}
                      placeholder={lang === 'bn' ? 'কোড (১, ২...)' : 'Code (1, 2...)'}
                      returnKeyType="next"
                    />
                  </View>

                  {/* Product Dropdown (from Code) */}
                  {activeItemDropdownIdx === rowIdx && (
                    <View style={styles.dropdownMenu3D}>
                      <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
                        {products.length ? products.map((p, pIdx) => {
                          const pCode = String(pIdx + 1);
                          const pBagKg = p.mediumBagKg || 50;
                          const pPer = isBag ? pBagKg : 1;
                          const pCost = Math.round((p.cost || 0) * pPer);
                          const pPrice = Math.round((p.price || 0) * pPer);
                          return (
                            <TouchableOpacity
                              key={p.id}
                              onPress={() => {
                                onSelectProduct(rowIdx, p, pIdx);
                                focusNextField(`code_${rowIdx}`);
                              }}
                              style={styles.dropdownItem}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={styles.dropdownItemText}>{p.name}</Text>
                                <Text style={styles.dropdownItemSub}>
                                  কোড: {toBnDigits(pCode)} ({pCode}) • স্টক: {n(p.qty)} কেজি ({n(Math.round(p.qty / pBagKg))} বস্তা)
                                </Text>
                              </View>
                              <View style={{ alignItems: 'flex-end' }}>
                                <Text style={styles.dropdownItemDue}>{m(isSale ? pPrice : (pCost || 200))}</Text>
                                {isSale && (
                                  <Text style={{ fontSize: 10, fontWeight: '700', color: '#B45309' }}>
                                    গড় ক্রয়: {m(pCost)}
                                  </Text>
                                )}
                              </View>
                            </TouchableOpacity>
                          );
                        }) : (
                          <View style={{ padding: 12 }}>
                            <Text style={{ color: '#5B728F', fontSize: 13, textAlign: 'center' }}>
                              {lang === 'bn' ? 'কোনো চাল পাওয়া যায়নি (প্রথমে স্টক এন্ট্রি করুন)' : 'No products found (add in stock)'}
                            </Text>
                          </View>
                        )}
                      </ScrollView>
                    </View>
                  )}
                </View>

                {/* Product Name: AUTO-SELECTED DISPLAY */}
                <View style={[styles.td, { flex: 2, minWidth: isSale ? 150 : 160 }]}>
                  <View style={styles.productDisplayBox}>
                    <Text
                      style={[styles.productDisplayText, !row.name && styles.productDisplayEmpty]}
                      numberOfLines={1}
                    >
                      {row.name || (lang === 'bn' ? '— কোড লিখলে নাম আসবে —' : '— Enter Code —')}
                    </Text>
                    {rowProduct ? (
                      <Text style={styles.productStockText}>
                        {lang === 'bn'
                          ? `স্টক: ${n(rowProduct.qty)} কেজি (${n(Math.round(rowProduct.qty / bagKg))} বস্তা)`
                          : `Stock: ${n(rowProduct.qty)} kg (${n(Math.round(rowProduct.qty / bagKg))} bags)`}
                      </Text>
                    ) : null}
                  </View>
                </View>

                {/* Unit (বস্তা / কেজি) */}
                <View style={[styles.td, { width: isSale ? 90 : 95, alignItems: 'center', justifyContent: 'center' }]}>
                  <TouchableOpacity
                    onPress={() => handleUnitChange(rowIdx, (row.unit || 'medium') === 'medium' ? 'kg' : 'medium')}
                    style={styles.unitToggleBtn}
                    accessibilityLabel="একক পরিবর্তন করুন (Space / Click)"
                  >
                    <Text style={styles.unitToggleText}>
                      {(row.unit || 'medium') === 'kg' ? 'কেজি' : 'বস্তা'}
                    </Text>
                    <Text style={styles.unitToggleSub}>
                      {(row.unit || 'medium') === 'kg' ? '১ কেজি' : `${toBnDigits(String(bagKg))} কেজি`}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Quantity */}
                <View style={[styles.td, { width: isSale ? 85 : 95 }]}>
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
                    onSubmitEditing={() => focusNextField(`qty_${rowIdx}`)}
                    selectTextOnFocus={true}
                    style={[
                      styles.tableTextInput,
                      { textAlign: 'center' },
                      isInputFocused(`qty_${rowIdx}`) && styles.inputFocusedGlow,
                    ]}
                    placeholder="পরিমাণ"
                    keyboardType="numeric"
                    returnKeyType="next"
                  />
                </View>

                {/* Avg Purchase Price (Editable on sale by admin) */}
                {isSale && (
                  <View style={[styles.td, { width: 125 }]}>
                    <TextInput
                      ref={el => (inputRefs.current[`purchaseRate_${rowIdx}`] = el)}
                      value={row.purchaseRate}
                      onChangeText={txt => {
                        setItems(prev => {
                          const copy = [...prev];
                          copy[rowIdx].purchaseRate = txt;
                          return copy;
                        });
                      }}
                      onFocus={() => setFocusedField(`purchaseRate_${rowIdx}`)}
                      onSubmitEditing={() => focusNextField(`purchaseRate_${rowIdx}`)}
                      selectTextOnFocus={true}
                      style={[
                        styles.tableTextInput,
                        { textAlign: 'center', borderColor: '#F59E0B', backgroundColor: '#FFFDF7' },
                        isInputFocused(`purchaseRate_${rowIdx}`) && styles.inputFocusedGlow,
                      ]}
                      placeholder={String(basePurchaseRate || 0)}
                      keyboardType="numeric"
                      returnKeyType="next"
                    />
                    {rowProduct ? (
                      <Text style={styles.baseAvgHintText} numberOfLines={1}>
                        {lang === 'bn' ? `গড়: ${toBnDigits(String(basePurchaseRate))}` : `Avg: ${basePurchaseRate}`}
                      </Text>
                    ) : null}
                  </View>
                )}

                {/* Rate */}
                <View style={[styles.td, { width: isSale ? 110 : 125 }]}>
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
                    onSubmitEditing={() => focusNextField(`rate_${rowIdx}`)}
                    selectTextOnFocus={true}
                    style={[
                      styles.tableTextInput,
                      { textAlign: 'center' },
                      isInputFocused(`rate_${rowIdx}`) && styles.inputFocusedGlow,
                    ]}
                    placeholder={isSale ? "3000" : "2500"}
                    keyboardType="numeric"
                    returnKeyType="next"
                  />
                </View>

                {/* Total Box */}
                <View style={[styles.td, { width: isSale ? 120 : 130, alignItems: 'center', justifyContent: 'center' }]}>
                  <View style={styles.tableTotalBox3D}>
                    <Text style={styles.tableTotalText}>
                      {rowTotal ? toBnDigits(String(rowTotal)) : '০'}
                    </Text>
                  </View>
                  {rowProfit !== null && (
                    <Text style={[
                      styles.rowProfitBadge,
                      rowProfit >= 0 ? styles.rowProfitPos : styles.rowProfitNeg
                    ]} numberOfLines={1}>
                      {rowProfit >= 0 ? '+' : ''}
                      {toBnDigits(String(rowProfit))}
                    </Text>
                  )}
                </View>

                {/* Direct Action (Delete) Button */}
                <View style={[styles.td, { width: isSale ? 55 : 60, alignItems: 'center', justifyContent: 'center' }]}>
                  <TouchableOpacity
                    onPress={() => removeRow(rowIdx)}
                    style={styles.deleteRowBtnDirect}
                    accessibilityLabel="পণ্য বাদ দিন"
                  >
                    <AppIcon name={icons.del} size={18} iconColor="#DC2626" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {/* Quick Add Row at bottom of table */}
          <TouchableOpacity
            onPress={() => addNewRow(true)}
            style={styles.tableBottomAddBtn}
            activeOpacity={0.8}
            accessibilityLabel="নতুন চালের সারি যোগ করুন"
          >
            <View style={styles.tableBottomAddCircle}>
              <AppIcon name={icons.plus} size={14} iconColor="#15803D" />
            </View>
            <Text style={styles.tableBottomAddText}>+ নতুন পণ্যের সারি যোগ করুন</Text>
          </TouchableOpacity>
        </View>

        {/* ACTION BUTTON TO CONFIRM AND OPEN SPLIT REVIEW MODAL */}
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
            onPress={handleOpenConfirm}
            style={styles.completeButton3D}
            accessibilityLabel={isSale ? 'বিক্রয় নিশ্চিত করুন' : 'ক্রয় নিশ্চিত করুন'}
          >
            <AppIcon name={isSale ? icons.sale : icons.purchase} size={22} iconColor="#fff" />
            <Text style={styles.completeButton3DText}>
              {isSale ? 'বিক্রয় নিশ্চিত করুন' : 'ক্রয় নিশ্চিত করুন'}
            </Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* SPLIT CONFIRMATION REVIEW MODAL */}
      <Modal
        visible={reviewSplitOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setReviewSplitOpen(false)}
      >
        <TouchableOpacity
          activeOpacity={1}
          onPress={() => setReviewSplitOpen(false)}
          style={styles.modalOverlay}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={[styles.shortcutModalBox, { maxWidth: 960, width: '95%', maxHeight: '90%' }]}
          >
            {/* Modal Header */}
            <View style={styles.modalHeader3D}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <AppIcon name={isSale ? icons.sale : icons.purchase} size={24} iconColor="#fff" />
                <Text style={styles.modalTitle}>
                  {isSale ? 'বিক্রয় নিশ্চিতকরণ ও বিবরণ পর্যালোচনা' : 'ক্রয় নিশ্চিতকরণ ও বিবরণ পর্যালোচনা'}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setReviewSplitOpen(false)}
                style={{ padding: 6 }}
                accessibilityLabel="বন্ধ করুন"
              >
                <AppIcon name={icons.cancel} size={22} iconColor="#fff" />
              </TouchableOpacity>
            </View>

            {/* Split Content: Two Columns */}
            <ScrollView style={{ padding: 16 }} contentContainerStyle={{ paddingBottom: 16 }}>
              <View style={{ flexDirection: Platform.OS === 'web' ? 'row' : 'column', gap: 16 }}>
                
                {/* LEFT SIDE: Products List with prices, costs, units */}
                <View style={{ flex: 1.2, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, borderWidth: 1.5, borderColor: '#CBD5E1' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingBottom: 8 }}>
                    <AppIcon name={icons.stock} size={20} iconColor="#1c70b9" />
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F1E36' }}>পণ্যের তালিকা ও দর</Text>
                  </View>

                  {items.filter(it => it.name.trim()).map((it, idx) => {
                    const q = parseNum(it.qty) || 0;
                    const r = parseNum(it.rate) || 0;
                    const pr = parseNum(it.purchaseRate) || 0;
                    const rowTotal = Math.round(q * r);
                    const prod = products.find(p => p.id === it.productId || p.name === it.name);
                    const bagKg = prod ? kgPerUnit(prod, it.unit || 'medium') : ((it.unit || 'medium') === 'kg' ? 1 : 50);

                    return (
                      <View
                        key={it.id || idx}
                        style={{
                          backgroundColor: '#F8FAFC',
                          borderRadius: 10,
                          padding: 12,
                          marginBottom: 8,
                          borderWidth: 1,
                          borderColor: '#E2E8F0',
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <Text style={{ fontSize: 16, fontWeight: '700', color: '#1E293B' }}>{it.name}</Text>
                          <Text style={{ fontSize: 16, fontWeight: '800', color: '#1c70b9' }}>৳{toBnDigits(String(rowTotal))}</Text>
                        </View>

                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>
                          <Text style={{ fontSize: 13, color: '#475569' }}>
                            একক: <Text style={{ fontWeight: '700' }}>{(it.unit || 'medium') === 'kg' ? 'কেজি' : `বস্তা (${toBnDigits(String(bagKg))} কেজি)`}</Text>
                          </Text>
                          <Text style={{ fontSize: 13, color: '#475569' }}>
                            পরিমাণ: <Text style={{ fontWeight: '700' }}>{toBnDigits(String(q))}</Text>
                          </Text>
                          <Text style={{ fontSize: 13, color: '#475569' }}>
                            দর: <Text style={{ fontWeight: '700' }}>৳{toBnDigits(String(r))}</Text>
                          </Text>
                          {isSale && pr > 0 ? (
                            <Text style={{ fontSize: 13, color: '#B45309' }}>
                              ক্রয় খরচ: <Text style={{ fontWeight: '700' }}>৳{toBnDigits(String(pr))}</Text>
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}

                  <View style={{ marginTop: 8, paddingTop: 10, borderTopWidth: 1.5, borderTopColor: '#E2E8F0', flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#334155' }}>মোট পণ্যের মূল্য:</Text>
                    <Text style={{ fontSize: 17, fontWeight: '800', color: '#0F172A' }}>৳{toBnDigits(String(Math.round(totalProductValue)))}</Text>
                  </View>

                  {isSale ? (
                    <View style={{ marginTop: 4, flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 14, color: '#475569' }}>মোট আনুমানিক ক্রয় খরচ:</Text>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#B45309' }}>৳{toBnDigits(String(Math.round(totalEstimatedCost)))}</Text>
                    </View>
                  ) : null}

                  {isSale ? (
                    <View style={{ marginTop: 4, flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 14, color: '#475569' }}>প্রত্যাশিত লাভ:</Text>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: estimatedProfit >= 0 ? '#15803D' : '#DC2626' }}>
                        {estimatedProfit >= 0 ? '+' : ''}৳{toBnDigits(String(Math.round(estimatedProfit)))}
                      </Text>
                    </View>
                  ) : null}
                </View>

                {/* RIGHT SIDE: Other Details (Party, Date, Memo, Payments, Final Total) */}
                <View style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, borderWidth: 1.5, borderColor: '#CBD5E1', justifyContent: 'space-between' }}>
                  <View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingBottom: 8 }}>
                      <AppIcon name={icons.accounts} size={20} iconColor="#1c70b9" />
                      <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F1E36' }}>লেনদেন ও পার্টির তথ্য</Text>
                    </View>

                    <View style={{ gap: 8 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 14, color: '#64748B' }}>{isSale ? 'কাস্টমার' : 'সরবরাহকারী'}:</Text>
                        <Text style={{ fontSize: 15, fontWeight: '700', color: '#0F172A' }}>{partyName || 'ক্যাশ'}</Text>
                      </View>
                      {partyMobile ? (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 14, color: '#64748B' }}>মোবাইল:</Text>
                          <Text style={{ fontSize: 14, color: '#334155' }}>{partyMobile}</Text>
                        </View>
                      ) : null}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 14, color: '#64748B' }}>তারিখ:</Text>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: '#334155' }}>{billDate}</Text>
                      </View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 14, color: '#64748B' }}>মেমো নং:</Text>
                        <Text style={{ fontSize: 14, fontWeight: '700', color: '#1c70b9' }}>{memoNo}</Text>
                      </View>

                      {/* Payment inputs if user wants to record payment right here */}
                      <View style={{ marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F1F5F9' }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 6 }}>পরিশোধের পরিমাণ</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 2 }}>ক্যাশ (৳)</Text>
                            <TextInput
                              ref={el => (inputRefs.current['modal_cashPaid'] = el)}
                              value={cashPaid}
                              onChangeText={setCashPaid}
                              keyboardType="numeric"
                              placeholder="0"
                              onSubmitEditing={() => inputRefs.current['modal_bankPaid']?.focus()}
                              style={{ borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 8, height: 38, fontSize: 14, backgroundColor: '#F8FAFC' }}
                              returnKeyType="next"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 2 }}>ব্যাংক (৳)</Text>
                            <TextInput
                              ref={el => (inputRefs.current['modal_bankPaid'] = el)}
                              value={bankPaid}
                              onChangeText={setBankPaid}
                              keyboardType="numeric"
                              placeholder="0"
                              onSubmitEditing={executeTransaction}
                              style={{ borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 8, height: 38, fontSize: 14, backgroundColor: '#F8FAFC' }}
                              returnKeyType="done"
                            />
                          </View>
                        </View>
                      </View>

                      {/* Additional Costs inputs */}
                      <View style={{ marginTop: 6 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 6 }}>অতিরিক্ত খরচ (ঐচ্ছিক)</Text>
                        <View style={{ flexDirection: 'row', gap: 8 }}>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 2 }}>পরিবহন (৳)</Text>
                            <TextInput
                              ref={el => (inputRefs.current['modal_transportCost'] = el)}
                              value={transportCost}
                              onChangeText={setTransportCost}
                              keyboardType="numeric"
                              placeholder="0"
                              onSubmitEditing={() => inputRefs.current['modal_landingCost']?.focus()}
                              style={{ borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 8, height: 38, fontSize: 14, backgroundColor: '#F8FAFC' }}
                              returnKeyType="next"
                            />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ fontSize: 12, color: '#64748B', marginBottom: 2 }}>ল্যান্ডিং (৳)</Text>
                            <TextInput
                              ref={el => (inputRefs.current['modal_landingCost'] = el)}
                              value={landingCost}
                              onChangeText={setLandingCost}
                              keyboardType="numeric"
                              placeholder="0"
                              onSubmitEditing={executeTransaction}
                              style={{ borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 8, height: 38, fontSize: 14, backgroundColor: '#F8FAFC' }}
                              returnKeyType="done"
                            />
                          </View>
                        </View>
                      </View>
                    </View>
                  </View>

                  {/* Summary & Create Invoice Button */}
                  <View style={{ marginTop: 14, paddingTop: 12, borderTopWidth: 1.5, borderTopColor: '#E2E8F0' }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ fontSize: 14, color: '#64748B' }}>পূর্বের বাকি:</Text>
                      <Text style={{ fontSize: 15, fontWeight: '600', color: '#DC2626' }}>৳{toBnDigits(String(Math.round(prevDue)))}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ fontSize: 14, color: '#64748B' }}>মোট পরিশোধ:</Text>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#15803D' }}>৳{toBnDigits(String(Math.round(totalPaid)))}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12, backgroundColor: '#EFF6FF', padding: 8, borderRadius: 8 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#1E3A8A' }}>সর্বমোট নিট বাকি:</Text>
                      <Text style={{ fontSize: 18, fontWeight: '800', color: '#1E3A8A' }}>৳{toBnDigits(String(Math.round(grandTotal)))}</Text>
                    </View>

                    {/* CONFIRM AND CREATE INVOICE BUTTON */}
                    <TouchableOpacity
                      onPress={executeTransaction}
                      disabled={submitting}
                      style={{
                        backgroundColor: '#16A34A',
                        borderRadius: 12,
                        minHeight: 48,
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexDirection: 'row',
                        gap: 8,
                        borderBottomWidth: 3,
                        borderBottomColor: '#15803D',
                        cursor: 'pointer' as any,
                      }}
                    >
                      <AppIcon name={icons.print} size={20} iconColor="#FFFFFF" />
                      <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>
                        {submitting ? 'ইনভয়েস তৈরি হচ্ছে...' : 'নিশ্চিত করুন ও ইনভয়েস তৈরি করুন'}
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>

              </View>
            </ScrollView>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>

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
    padding: 18,
    paddingBottom: 40,
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
  inputReadOnly: {
    backgroundColor: '#F1F5F9',
    borderColor: '#CBD5E1',
    borderWidth: 1.5,
    opacity: 0.95,
    ...(Platform.OS === 'web' ? {
      boxShadow: 'none',
      cursor: 'not-allowed',
    } as any : {}),
  },
  textInputReadOnly: {
    color: '#334155',
    fontWeight: '600',
    ...(Platform.OS === 'web' ? ({ cursor: 'not-allowed' } as any) : {}),
  },
  readOnlyBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  readOnlyBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#64748B',
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
  addProductBtnModern: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: '#1c70b9',
    borderWidth: 1.5,
    borderColor: '#60b0f4',
    borderBottomWidth: 3,
    borderBottomColor: '#124c7e',
    borderTopWidth: 1,
    borderTopColor: '#70bcf7',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      backgroundImage: 'linear-gradient(180deg, #258ee0 0%, #1c70b9 52%, #135591 100%)',
      boxShadow: '0 4px 14px rgba(28, 112, 185, 0.35), inset 0 1px 0 rgba(255, 255, 255, 0.4)',
    } as any : {
      elevation: 3,
    }),
  },
  addIconCircle: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addProductBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 0.3,
    ...(Platform.OS === 'web' ? {
      textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
    } as any : {}),
  },
  shortcutKeyBadge: {
    backgroundColor: 'rgba(0, 0, 0, 0.25)',
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
    marginLeft: 2,
  },
  shortcutKeyText: {
    color: '#BAE6FD',
    fontSize: 11,
    fontWeight: '800',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  tableBottomAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    borderStyle: 'dashed',
    backgroundColor: '#EFF6FF',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
    } as any : {}),
  },
  tableBottomAddCircle: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#DBEAFE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableBottomAddText: {
    color: '#0F3B63',
    fontSize: 13,
    fontWeight: '700',
  },
  tableBottomShortcutBadge: {
    backgroundColor: '#DBEAFE',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  tableBottomShortcutText: {
    color: '#1E40AF',
    fontSize: 10.5,
    fontWeight: '800',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
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
    backgroundColor: '#E0F0FE',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#93C5FD',
  },
  serialText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#034575',
  },
  tableInputDebossed: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#CCE0F2',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
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
    fontWeight: '700',
    color: '#0F1E36',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  tableTextInput: {
    borderWidth: 1.5,
    borderColor: '#CCE0F2',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    height: 38,
    paddingHorizontal: 8,
    fontSize: 13,
    fontWeight: '700',
    color: '#0F1E36',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  tableIconWrap: {
    paddingLeft: 4,
  },
  tableTotalBox3D: {
    backgroundColor: '#F0F6FC',
    borderRadius: 8,
    paddingHorizontal: 12,
    height: 38,
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#CFE2F4',
    borderBottomWidth: 2.5,
    borderBottomColor: '#B6D7F6',
  },
  tableTotalText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F1E36',
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
  deleteRowBtnDirect: {
    width: 38,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#FECACA',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  productDisplayBox: {
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    paddingHorizontal: 10,
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  productDisplayText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
    flex: 1,
  },
  productDisplayEmpty: {
    color: '#94A3B8',
    fontWeight: '500',
    fontStyle: 'italic',
  },
  productStockText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#A7F3D0',
    marginLeft: 6,
  },
  unitToggleBtn: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    borderRadius: 8,
    paddingHorizontal: 8,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  unitToggleText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0F3B63',
  },
  unitToggleSub: {
    fontSize: 9.5,
    fontWeight: '700',
    color: '#0284C7',
  },
  baseAvgHintText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#B45309',
    textAlign: 'center',
    marginTop: 2,
  },
  rowProfitBadge: {
    fontSize: 10,
    fontWeight: '800',
    marginTop: 2,
    textAlign: 'center',
  },
  rowProfitPos: {
    color: '#047857',
  },
  rowProfitNeg: {
    color: '#DC2626',
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
    color: '#1E293B',
    fontWeight: '700',
  },
  calcInputDebossed: {
    width: 180,
    height: 38,
    borderWidth: 1.5,
    borderColor: '#CCE0F2',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    fontSize: 14,
    fontWeight: '800',
    color: '#0F1E36',
    textAlign: 'right',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  readOnlySunkenBox: {
    width: 180,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#F0F6FC',
    borderWidth: 1.5,
    borderColor: '#CFE2F4',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  readOnlySunkenText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F1E36',
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
    borderWidth: 2,
    borderColor: '#38BDF8',
    borderBottomWidth: 3.5,
    borderBottomColor: '#0284C7',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(135deg, #E0F2FE 0%, #BAE6FD 50%, #90CDF4 100%)',
      boxShadow: '0 6px 18px rgba(28, 112, 185, 0.22), inset 0 1px 1px #FFFFFF',
    } as any : {}),
  },
  grandTotalLabel: {
    fontSize: 15,
    fontWeight: '900',
    color: '#062E4D',
  },
  grandTotalSub: {
    fontSize: 11,
    fontWeight: '700',
    color: '#035488',
    marginTop: 2,
  },
  grandTotalValue: {
    fontSize: 24,
    fontWeight: '900',
    color: '#062E4D',
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
    borderBottomColor: '#64748B',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      boxShadow: '0 3px 8px rgba(0, 0, 0, 0.05), inset 0 1px 0 #FFFFFF',
    } as any : {}),
  },
  cancelButton3DText: {
    color: '#0F1E36',
    fontSize: 14,
    fontWeight: '800',
  },
  draftButton3D: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#1c70b9',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 11,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 3,
    borderBottomColor: '#124c7e',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #F4F9FD 100%)',
      boxShadow: '0 3px 8px rgba(28, 112, 185, 0.1), inset 0 1px 0 #FFFFFF',
    } as any : {}),
  },
  draftButton3DText: {
    color: '#0F2B48',
    fontSize: 14,
    fontWeight: '800',
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
    borderBottomColor: '#0a3359',
    ...(Platform.OS === 'web' ? {
      cursor: 'pointer',
      backgroundImage: 'linear-gradient(180deg, #258ee0 0%, #1c70b9 52%, #104c82 100%)',
      boxShadow: '0 8px 22px rgba(28, 112, 185, 0.45), inset 0 1px 1px rgba(255, 255, 255, 0.5)',
    } as any : {}),
  },
  completeButton3DText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '900',
    letterSpacing: 0.3,
    ...(Platform.OS === 'web' ? {
      textShadow: '0 1px 2px rgba(0, 0, 0, 0.35)',
    } as any : {}),
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
