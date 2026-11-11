import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  ScrollView,
  StyleSheet,
  Alert,
  Platform,
  Modal,
} from 'react-native';
import { useApp, today, Product, Party } from '../store';
import { color, useMoney, useNum, toBnDigits, AccountPicker, Field, RequiredLabel } from '../ui';
import { parseNum, localeDigits, toEnDigits } from '../bn';
import { AppIcon, icons } from '../icons';
import { MonthCal } from '../screens';
import { BagUnit, kgPerUnit } from '../bags';
import { api, SaleDetail, PurchaseDetail } from '../api';
import { UnitNames, InvData, fmtTime, unitDetail, buildInvoiceHTML, invoicePaymentAmount, invoicePaymentDescription } from '../invoice';
import { showEntryError } from '../entryDialog';

export interface FormItemLine {
  id: string;
  code: string;
  productId: string;
  name: string;
  unit: BagUnit;
  qty: string;
  purchaseRate: string;
  rate: string;
  otherCost?: string;
}

interface TradeDashboardFormProps {
  mode: 'purchase' | 'sale';
  onDone: () => void;
  onOpenHistory?: () => void;
  editId?: string | null;
}

const DRAFT_STORAGE_KEY_PREFIX = 'chaler_arot_draft_';
const SESSION_BILL_DATE_KEY = 'chaler_arot_session_bill_date';
const DATE_LOCK_STORAGE_KEY = 'chaler_arot_is_date_locked';
const LOCKED_DATE_STORAGE_KEY = 'chaler_arot_locked_date';
export const DEFAULT_CUSTOMER_STORAGE_KEY = 'chaler_arot_default_customer_code';
export const DEFAULT_VENDOR_STORAGE_KEY = 'chaler_arot_default_vendor_code';
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

export const getNextMemoNo = (isSale: boolean, txns: { invoiceNo?: string }[] = []): string => {
  const storageKey = isSale ? 'chaler_arot_next_memo_sale' : 'chaler_arot_next_memo_purchase';
  let storedNext = 0;
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      const v = window.localStorage.getItem(storageKey);
      if (v) {
        const parsed = parseInt(v.trim().replace(/\D/g, ''), 10);
        if (!isNaN(parsed) && parsed > 0) storedNext = parsed;
      }
    }
  } catch {}

  let maxTxnNo = 0;
  for (const t of txns) {
    if (t.invoiceNo) {
      const p = parseInt(t.invoiceNo.trim().replace(/\D/g, ''), 10);
      if (!isNaN(p) && p > maxTxnNo) maxTxnNo = p;
    }
  }

  const nextVal = Math.max(storedNext, maxTxnNo > 0 ? maxTxnNo + 1 : txns.length + 1);
  return String(nextVal);
};

const toCalendarDate = (value: string): string => {
  const parts = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return parts ? `${parts[3]}-${parts[2].padStart(2, '0')}-${parts[1].padStart(2, '0')}` : '';
};

const fromCalendarDate = (value: string): string => {
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return parts ? `${parts[3]}/${parts[2]}/${parts[1]}` : '';
};
const roundToMoney = (value: number) => Math.round(value * 100) / 100;

export function TradeDashboardForm({ mode, onDone, onOpenHistory, editId }: TradeDashboardFormProps) {
  const isSale = mode === 'sale';
  const { t, lang, products, vendors, customers, bal, purchase, sale, moneyAccounts, saveExpense, deleteExpense, expenses, sales, purchases, refresh } = useApp();
  const tx = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const showFormError = (message: string) => showEntryError(lang, message);
  const m = useMoney();
  const n = useNum();

  // Parties list based on mode
  const parties: Party[] = isSale ? customers : vendors;

  // Active focus tracking: cursor starts from party code (customer/vendor code), NOT memoNo
  const [focusedField, setFocusedField] = useState<string>('partyCode');

  // Input refs for keyboard navigation
  const inputRefs = useRef<Record<string, any>>({});
  const confirmBtnRef = useRef<any>(null);

  // Auto-generated order no & memo no: starts from last set manually and auto-increments
  const [orderNo, setOrderNo] = useState('');
  const [memoNo, setMemoNo] = useState<string>(() => getNextMemoNo(isSale, isSale ? sales : purchases));

  // Default customer/vendor code stored in localStorage
  const defaultStorageKey = isSale ? DEFAULT_CUSTOMER_STORAGE_KEY : DEFAULT_VENDOR_STORAGE_KEY;
  const [defaultPartyCode, setDefaultPartyCode] = useState<string>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(defaultStorageKey) || '';
      }
    } catch {}
    return '';
  });

  const handleMemoNoChange = useCallback((val: string) => {
    setMemoNo(val);
    const num = parseInt(val.trim().replace(/\D/g, ''), 10);
    if (!isNaN(num) && num > 0) {
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const storageKey = isSale ? 'chaler_arot_next_memo_sale' : 'chaler_arot_next_memo_purchase';
          window.localStorage.setItem(storageKey, String(num));
        }
      } catch {}
    }
  }, [isSale]);

  // Party selection state
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const partyCodeEditedRef = useRef(false);
  const [partyCode, setPartyCode] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partyMobile, setPartyMobile] = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [partyDropdownOpen, setPartyDropdownOpen] = useState(false);
  const [partyHighlightIdx, setPartyHighlightIdx] = useState(0);

  // Focus helper for customer / vendor code
  const focusCustomerInput = useCallback(() => {
    const el = inputRefs.current['partyCode'];
    if (el) {
      if (typeof el.focus === 'function') {
        el.focus();
      }
      const dom = (el as any)?._inputRef || (el as any)?.getNativeRef?.();
      if (dom && typeof dom.focus === 'function') {
        dom.focus();
      }
      if (typeof el.select === 'function') {
        try { el.select(); } catch {}
      }
    }
    setFocusedField('partyCode');
  }, []);

  // Auto-focus on partyCode (vendor/customer code) on component mount
  useEffect(() => {
    const timers = [50, 150, 300].map(delay => setTimeout(focusCustomerInput, delay));
    return () => timers.forEach(clearTimeout);
  }, [mode, focusCustomerInput]);

  // Automatically load default customer/vendor when available and no party is selected
  useEffect(() => {
    if (!editId && !partyCodeEditedRef.current && !selectedPartyId && defaultPartyCode && parties.length > 0) {
      const match = parties.find(p => p.code && p.code.trim().toLowerCase() === defaultPartyCode.trim().toLowerCase());
      if (match) {
        setSelectedPartyId(match.id);
        setPartyCode(match.code!.trim());
        setPartyName(match.name);
        setPartyMobile(match.mobile || '');
        setPartyAddress(match.address || '');
      }
    }
  }, [parties, defaultPartyCode, selectedPartyId, editId]);

  // Set or toggle default party code
  const handleToggleDefaultParty = useCallback((codeToSet?: string) => {
    const targetCode = (codeToSet ?? partyCode).trim();
    if (!targetCode) return;
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (defaultPartyCode.trim().toLowerCase() === targetCode.toLowerCase()) {
          window.localStorage.removeItem(defaultStorageKey);
          setDefaultPartyCode('');
          setCopiedToast(isSale ? tx('ডিফল্ট কাস্টমার কোড সরানো হয়েছে', 'Default customer code removed') : tx('ডিফল্ট সরবরাহকারী কোড সরানো হয়েছে', 'Default vendor code removed'));
        } else {
          window.localStorage.setItem(defaultStorageKey, targetCode);
          setDefaultPartyCode(targetCode);
          setCopiedToast(isSale ? tx(`কাস্টমার কোড '${targetCode}' ডিফল্ট সেট করা হয়েছে`, `Customer code '${targetCode}' set as default`) : tx(`সরবরাহকারী কোড '${targetCode}' ডিফল্ট সেট করা হয়েছে`, `Vendor code '${targetCode}' set as default`));
        }
        setTimeout(() => setCopiedToast(null), 2500);
      }
    } catch {}
  }, [defaultPartyCode, defaultStorageKey, isSale, partyCode]);

  // Date persists across reloads when locked by user
  const [isDateLocked, setIsDateLocked] = useState<boolean>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        return window.localStorage.getItem(DATE_LOCK_STORAGE_KEY) === 'true';
      }
    } catch {}
    return false;
  });

  const [billDate, setBillDateState] = useState<string>(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        const locked = window.localStorage.getItem(DATE_LOCK_STORAGE_KEY) === 'true';
        if (locked) {
          const storedDate = window.localStorage.getItem(LOCKED_DATE_STORAGE_KEY);
          if (storedDate) return storedDate;
        }
      }
    } catch {}
    return '';
  });

  const [dateCalendarOpen, setDateCalendarOpen] = useState(false);

  const setBillDate = useCallback((val: string) => {
    setBillDateState(val);
    setSessionBillDate(val);
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        if (window.localStorage.getItem(DATE_LOCK_STORAGE_KEY) === 'true') {
          window.localStorage.setItem(LOCKED_DATE_STORAGE_KEY, val);
        }
      }
    } catch {}
  }, []);

  const toggleDateLock = useCallback(() => {
    setIsDateLocked(prev => {
      const nextLocked = !prev;
      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          window.localStorage.setItem(DATE_LOCK_STORAGE_KEY, nextLocked ? 'true' : 'false');
          if (nextLocked) {
            const effectiveDate = billDate.trim() || getSessionBillDate();
            window.localStorage.setItem(LOCKED_DATE_STORAGE_KEY, effectiveDate);
            if (!billDate.trim()) {
              setBillDateState(effectiveDate);
              setSessionBillDate(effectiveDate);
            }
          } else {
            window.localStorage.removeItem(LOCKED_DATE_STORAGE_KEY);
          }
        }
      } catch {}
      return nextLocked;
    });
  }, [billDate]);

  // Products table items (empty, no default pre-selected product)
  const [items, setItems] = useState<FormItemLine[]>([
    { id: 'item_1', code: '', productId: '', name: '', unit: 'medium', qty: '', purchaseRate: '', rate: '', otherCost: '' },
  ]);
  const [activeItemDropdownIdx, setActiveItemDropdownIdx] = useState<number | null>(null);
  const [itemHighlightIdx, setItemHighlightIdx] = useState(0);

  // Additional costs (Transport, Landing)
  const [transportCost, setTransportCost] = useState('');
  const [transportPurchaseInvoiceNo, setTransportPurchaseInvoiceNo] = useState('');
  const [transportPurchaseFocused, setTransportPurchaseFocused] = useState(false);
  const [transportExpenseId, setTransportExpenseId] = useState<string>();
  const [landingExpenseId, setLandingExpenseId] = useState<string>();

  // Payments (Cash, Bank) & Discount (no default '0' strings)
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
  const [paymentNote, setPaymentNote] = useState('');
  const [advanceToApply, setAdvanceToApply] = useState(0);
  const [expenseAccountId, setExpenseAccountId] = useState('');
  const [discount, setDiscount] = useState('');

  useEffect(() => {
    const active = moneyAccounts.filter(a => a.active);
    const cash = active.find(a => a.type === 'cash');
    const bank = active.find(a => a.type === 'bank');
    setExpenseAccountId(prev => active.some(a => a.id === prev) ? prev : cash?.id ?? bank?.id ?? '');
  }, [moneyAccounts]);

  // Split Confirmation Modal state
  const [reviewSplitOpen, setReviewSplitOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  // Keyboard shortcut help modal
  const [showShortcutsHelp, setShowShortcutsHelp] = useState(false);

  // Copy feedback toast
  const [copiedToast, setCopiedToast] = useState<string | null>(null);
  const [editLoading, setEditLoading] = useState(!!editId);
  const [editPaymentUnsupported, setEditPaymentUnsupported] = useState(false);

  useEffect(() => {
    if (!editId) { setEditLoading(false); return; }
    let active = true;
    setEditLoading(true);
    const load = async () => {
      const doc = mode === 'sale' ? await api.saleDetail(editId) : await api.purchaseDetail(editId);
      if (!active) return;
      const partyId = mode === 'sale'
        ? (doc as SaleDetail).customer?.id ?? ''
        : (doc as PurchaseDetail).vendor.id ?? '';
      const party = (mode === 'sale' ? customers : vendors).find(p => p.id === partyId);
      setSelectedPartyId(partyId ?? ''); setPartyCode(party?.code ?? '');
      setPartyName(party?.name ?? (mode === 'sale' ? (doc as SaleDetail).customer?.name ?? '' : (doc as PurchaseDetail).vendor.name));
      setPartyMobile(party?.mobile ?? ''); setPartyAddress(party?.address ?? '');
      setMemoNo(doc.invoiceNo ?? ''); setBillDate(`${doc.date.slice(8, 10)}/${doc.date.slice(5, 7)}/${doc.date.slice(0, 4)}`);
      setDiscount(mode === 'sale' ? String((doc as SaleDetail).discount ?? 0) : '');
      setItems(doc.items.filter(line => line.productId && line.enteredQty > 0).map((line, index) => {
        const product = products.find(p => p.id === line.productId);
        const unit = (line.unit || 'medium') as BagUnit;
        const per = product ? kgPerUnit(product, unit) : 1;
        return { id: `edit_${index}`, code: product?.code ?? '', productId: line.productId!, name: line.productName, unit,
          qty: String(line.enteredQty), rate: String(roundToMoney(line.rate * per)),
          purchaseRate: mode === 'sale' ? String(roundToMoney((line.unitCost ?? product?.cost ?? 0) * per)) : '',
          otherCost: mode === 'purchase' ? String(line.otherCost ?? 0) : '' };
      }));
      const paymentLines = doc.payments ?? [];
      const transportPayments = paymentLines.filter(p => p.transportPayment);
      const ordinaryPaymentLines = paymentLines.filter(p => !p.transportPayment);
      const unsupportedPaymentLines = ordinaryPaymentLines.filter(p => {
        const account = moneyAccounts.find(a => a.id === p.accountId);
        return !account || !['cash', 'bank'].includes(account.type);
      });
      if (unsupportedPaymentLines.length) setEditPaymentUnsupported(true);
      if (transportPayments.length) setTransportCost(String(transportPayments.reduce((sum, p) => sum + p.amount, 0)));
      const contraTransport = transportPayments.find(p => p.contraPurchaseInvoiceNo);
      setTransportPurchaseInvoiceNo(contraTransport?.contraPurchaseInvoiceNo ?? '');
      for (const p of ordinaryPaymentLines) {
        const account = moneyAccounts.find(a => a.id === p.accountId);
        if (account?.type === 'bank' || account?.type === 'cash') {
          setPaymentAmounts(v => ({ ...v, [account.id]: String(parseNum(v[account.id]) + p.amount) }));
        }
      }
      if (unsupportedPaymentLines.length) setFormError(tx('এই ইনভয়েসে ক্যাশ/ব্যাংক ছাড়া অন্য অ্যাকাউন্টের পেমেন্ট আছে। সম্পাদনার আগে হিসাবরক্ষকের সাহায্য নিন।', 'This invoice has a payment account the editor cannot preserve. Ask an administrator before editing it.'));
      const invoiceRef = doc.invoiceNo ?? editId;
      const linkedTransport = expenses.find(e => e.category === 'transport' && (e.note ?? '').includes(`#${invoiceRef}`));
      const linkedLanding = expenses.find(e => e.capitalized && (e.note ?? '').includes(`#${invoiceRef}`));
      setTransportExpenseId(linkedTransport?.id); setLandingExpenseId(linkedLanding?.id);
      if (!transportPayments.length) setTransportCost(linkedTransport ? String(linkedTransport.amount) : '');
      if (linkedTransport?.accountId) setExpenseAccountId(linkedTransport.accountId);
      if (linkedLanding?.accountId) setExpenseAccountId(linkedLanding.accountId);
      setEditLoading(false);
    };
    load().catch(error => { if (active) { setFormError(error instanceof Error ? error.message : tx('ইনভয়েস লোড করা যায়নি।', 'Could not load invoice.')); setEditLoading(false); } });
    return () => { active = false; };
  }, [editId]);

  // Previous balance for selected party
  const prevDue = useMemo(() => {
    if (!selectedPartyId) return 0;
    const b = bal(isSale ? 'c' : 'v', selectedPartyId);
    return b ? b.balance : 0;
  }, [selectedPartyId, bal, isSale]);

  useEffect(() => { setAdvanceToApply(0); }, [selectedPartyId]);

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
      const prod = products.find(p => p.id === item.productId || p.name === item.name);
      const per = kgPerUnit(prod, item.unit || 'medium');
      const defaultPurchaseRate = Math.round((prod?.cost || 0) * per);
      const pr = parseNum(item.purchaseRate) || defaultPurchaseRate;
      return sum + q * pr;
    }, 0);
  }, [items, products]);

  const belowCostLoss = useMemo(() => {
    if (!isSale) return 0;
    return items.reduce((sum, item) => {
      const qty = Math.max(0, parseNum(item.qty));
      if (!qty) return sum;
      const product = products.find(p => p.id === item.productId || p.name === item.name);
      const per = kgPerUnit(product, item.unit || 'medium');
      const costPerUnit = parseNum(item.purchaseRate) || Math.round((product?.cost || 0) * per);
      const salePerUnit = parseNum(item.rate);
      return sum + Math.max(0, costPerUnit - salePerUnit) * qty;
    }, 0);
  }, [isSale, items, products]);

  const totalOtherCost = useMemo(() => {
    if (isSale) return 0;
    return items.reduce((sum, item) => {
      const q = Math.abs(parseNum(item.qty));
      const oc = parseNum(item.otherCost);
      return sum + (q * oc);
    }, 0);
  }, [items, isSale]);

  const estimatedProfit = useMemo(() => {
    return isSale ? (totalProductValue - parseNum(discount) - totalEstimatedCost) : 0;
  }, [isSale, totalProductValue, totalEstimatedCost, discount]);

  const numTransport = parseNum(transportCost);

  const paymentAccounts = useMemo(() => moneyAccounts.filter(account =>
    (account.active || parseNum(paymentAmounts[account.id]) > 0) &&
    (account.type === 'cash' || account.type === 'bank')
  ), [moneyAccounts, paymentAmounts]);
  const paymentLines = paymentAccounts
    .map(account => ({ accountId: account.id, amount: parseNum(paymentAmounts[account.id]), type: account.type, active: account.active }))
    .filter(payment => payment.amount > 0);
  const numCash = paymentLines.filter(payment => payment.type === 'cash').reduce((sum, payment) => sum + payment.amount, 0);
  const numBank = paymentLines.filter(payment => payment.type === 'bank').reduce((sum, payment) => sum + payment.amount, 0);
  const numDiscount = parseNum(discount);
  const cashBankPaid = numCash + numBank;
  const totalPaid = cashBankPaid + (isSale ? numTransport : 0);

  // Customer-paid transport counts toward the invoice settlement, but is not shop cash.
  const netInvoiceBalance = totalProductValue - totalPaid - numDiscount;
  const invoiceDue = Math.max(0, netInvoiceBalance);
  // Total due: invoice due + previous due (or reduced by net return credit)
  const selectedAdvance = Math.min(advanceToApply, Math.max(0, -prevDue), invoiceDue);
  const totalDue = Math.max(0, Math.max(0, prevDue) + invoiceDue - selectedAdvance);
  const grandTotal = totalDue;

  // Copy helper
  const copyToClipboard = useCallback((text: string, label: string) => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
    setCopiedToast(lang === 'bn' ? `${label} কপি করা হয়েছে` : `${label} copied`);
      setTimeout(() => setCopiedToast(null), 2000);
    }
  }, []);

  // Filtered lists for autocomplete
  const filteredParties = useMemo(() => {
    const q = (partyCode.trim() || partyName.trim()).toLowerCase();
    if (!q) return parties.slice(0, 8);
    return parties.filter(p => {
      const pCode = p.code?.trim().toLowerCase() ?? '';
      return p.name.toLowerCase().startsWith(q) || pCode.startsWith(q) || (p.mobile ?? '').toLowerCase().startsWith(q);
    }).slice(0, 8);
  }, [parties, partyName, partyCode]);

  // Match the code stored with the party; never substitute a row number for a missing code.
  const findPartyByCode = useCallback((codeQuery: string): { party: Party; code: string; index: number } | null => {
    if (!codeQuery) return null;
    const q = codeQuery.trim().toLowerCase();

    // 0. Match explicit custom code first
    const byCustomCodeIdx = parties.findIndex(p => p.code && p.code.trim().toLowerCase() === q);
    if (byCustomCodeIdx !== -1) {
      const p = parties[byCustomCodeIdx];
      return { party: p, code: p.code!.trim(), index: byCustomCodeIdx };
    }

    return null;
  }, [parties]);

  const onSelectParty = useCallback((p: Party, _idx?: number) => {
    const resolvedCode = p.code?.trim() ?? '';
    setSelectedPartyId(p.id);
    setPartyCode(resolvedCode);
    setPartyName(p.name);
    setPartyMobile(p.mobile || '');
    setPartyAddress(p.address || '');
    setPartyDropdownOpen(false);
  }, []);

  // Find product by code, index, or ID
  const findProductByCode = useCallback((codeQuery: string): { product: Product; code: string } | null => {
    if (!codeQuery) return null;
    const q = codeQuery.trim().toLowerCase();
    // Product codes are data entered by the user, never generated from list order.
    const product = products.find(p => p.code?.trim().toLowerCase() === q);
    return product ? { product, code: product.code!.trim() } : null;
  }, [products]);

  // Product selection fills identity only; prices remain blank until entered.
  const handleCodeChange = useCallback((rowIdx: number, val: string) => {
    setItems(prev => {
      const copy = [...prev];
      const match = findProductByCode(val);
      if (match) {
        const u = copy[rowIdx].unit || 'medium';
        copy[rowIdx] = {
          ...copy[rowIdx],
          code: val,
          productId: match.product.id,
          name: match.product.name,
          unit: u,
          qty: '',
          purchaseRate: '',
          rate: '',
          otherCost: copy[rowIdx].otherCost ?? '',
        };
      } else {
        copy[rowIdx] = {
          ...copy[rowIdx],
          code: val,
          productId: '',
          name: '',
          qty: '',
          purchaseRate: '',
          rate: '',
          otherCost: copy[rowIdx].otherCost ?? '',
        };
      }
      return copy;
    });
  }, [findProductByCode]);

  // Product selection
  const onSelectProduct = useCallback((rowIdx: number, p: Product) => {
    setItems(prev => {
      const copy = [...prev];
      const u = copy[rowIdx].unit || 'medium';
      copy[rowIdx] = {
        ...copy[rowIdx],
        code: p.code?.trim() ?? '',
        productId: p.id,
        name: p.name,
        unit: u,
        qty: '',
        purchaseRate: '',
        rate: '',
        otherCost: copy[rowIdx].otherCost ?? '',
      };
      return copy;
    });
    setActiveItemDropdownIdx(null);
  }, []);

  // Unit change handler (toggle between 'medium' [বস্তা] and 'kg' [কেজি])
  const handleUnitChange = useCallback((rowIdx: number, newUnit: BagUnit) => {
    setItems(prev => {
      const copy = [...prev];
      const row = copy[rowIdx];
      copy[rowIdx] = {
        ...row,
        unit: newUnit,
      };
      return copy;
    });
  }, []);

  // Add new product row
  const addNewRow = useCallback((autoFocus = true) => {
    const newIdx = items.length;
    const newId = `item_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
    setItems(prev => [
      ...prev,
      { id: newId, code: '', productId: '', name: '', unit: 'medium', qty: '', purchaseRate: '', rate: '', otherCost: '' },
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
      setItems([{ id: 'item_1', code: '', productId: '', name: '', unit: 'medium', qty: '', purchaseRate: '', rate: '', otherCost: '' }]);
      return;
    }
    setItems(prev => prev.filter((_, i) => i !== idx));
  }, [items.length]);

  // Keyboard navigation sequence (skips billDate when date is locked)
  const getNavSequence = useCallback((): string[] => {
    const seq: string[] = [];
    seq.push('memoNo');
    seq.push('partyCode');
    if (!isDateLocked) {
      seq.push('billDate');
    }

    items.forEach((_, idx) => {
      seq.push(`code_${idx}`);
      seq.push(`qty_${idx}`);
      if (isSale) {
        seq.push(`purchaseRate_${idx}`);
      }
      seq.push(`rate_${idx}`);
      if (!isSale) {
        seq.push(`otherCost_${idx}`);
      }
    });

    return seq;
  }, [isSale, items, isDateLocked]);

  const focusInputAfterKey = useCallback((key: string) => {
    setFocusedField(key);
    setTimeout(() => inputRefs.current[key]?.focus(), 0);
  }, []);

  const focusNextField = useCallback((currentKey: string) => {
    const seq = getNavSequence();
    const currentIdx = seq.indexOf(currentKey);
    if (currentIdx >= 0 && currentIdx < seq.length - 1) {
      const nextKey = seq[currentIdx + 1];
      inputRefs.current[nextKey]?.focus();
      setFocusedField(nextKey);
    } else if (isSale ? currentKey.startsWith('rate_') : currentKey.startsWith('otherCost_')) {
      // If pressing Enter on the last rate/otherCost field, automatically add a new product row and focus it!
      addNewRow(true);
    }
  }, [getNavSequence, addNewRow, isSale]);

  const getVisibleProducts = useCallback((query: string) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return products;
    return products.filter(product =>
      product.name.toLowerCase().startsWith(normalized) ||
      (product.code ?? '').trim().toLowerCase().startsWith(normalized)
    );
  }, [products]);

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
      paymentAmounts,
      savedAt: new Date().toISOString(),
    };
    try {
      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.setItem(`${DRAFT_STORAGE_KEY_PREFIX}${mode}`, JSON.stringify(draftData));
      }
      setCopiedToast(tx('ড্রাফট সফলভাবে সংরক্ষণ করা হয়েছে', 'Draft saved'));
      setTimeout(() => setCopiedToast(null), 2500);
    } catch {
      Alert.alert(tx('ড্রাফট', 'Draft'), tx('ড্রাফট সফলভাবে সংরক্ষণ করা হয়েছে।', 'Draft saved.'));
    }
  }, [
    mode, orderNo, memoNo, selectedPartyId, partyCode, partyName, partyMobile,
    partyAddress, billDate, items, transportCost,
    paymentAmounts
  ]);

  // Reset form to clean state for a new entry (cursor starts at partyCode, pre-fills default customer/vendor)
  const resetForm = useCallback((nextNo?: number | string) => {
    const newMemo = String(nextNo ?? getNextMemoNo(isSale, isSale ? sales : purchases));
    setMemoNo(newMemo);
    setOrderNo('');

    // Pre-fill default customer/vendor if configured
    let defId = '', defCode = '', defName = '', defMobile = '', defAddress = '';
    if (defaultPartyCode && parties.length > 0) {
      const match = parties.find(p => p.code && p.code.trim().toLowerCase() === defaultPartyCode.trim().toLowerCase());
      if (match) {
        defId = match.id;
        defCode = match.code!.trim();
        defName = match.name;
        defMobile = match.mobile || '';
        defAddress = match.address || '';
      }
    }
    setSelectedPartyId(defId);
    partyCodeEditedRef.current = false;
    setPartyCode(defCode);
    setPartyName(defName);
    setPartyMobile(defMobile);
    setPartyAddress(defAddress);

    setItems([{ id: 'item_1', code: '', productId: '', name: '', unit: 'medium', qty: '', purchaseRate: '', rate: '', otherCost: '' }]);
    setPaymentAmounts({});
    setAdvanceToApply(0);
    setPaymentNote('');
    setDiscount('');
    setTransportCost('');
    setFormError('');
    setReviewSplitOpen(false);
    setActiveItemDropdownIdx(null);
    setPartyDropdownOpen(false);
    [50, 150, 300, 500].forEach(delay => setTimeout(focusCustomerInput, delay));
  }, [isSale, sales, purchases, defaultPartyCode, parties, focusCustomerInput]);

  // Direct invoice print handler
  const printDoc = useCallback((kind: 'sale' | 'purchase', id: string, targetWindow?: Window | null) => {
    if (typeof window === 'undefined') return;
    const w = targetWindow || window.open('', '_blank');
    if (w && !w.document.body?.innerHTML) {
      w.document.write(`<html><body>${tx('লোড হচ্ছে...', 'Loading...')}</body></html>`);
    }
    (kind === 'sale' ? api.saleDetail(id) : api.purchaseDetail(id)).then(
      d => {
        if (!w || w.closed) return;
        const isSaleKind = kind === 'sale';
        const sd = d as any, pd = d as any;
        const party = isSaleKind ? sd.customer : pd.vendor;
        const belowCostLoss = isSaleKind
          ? sd.items.reduce((sum: number, item: any) => sum + Math.max(0, (item.unitCost ?? 0) - item.rate) * Math.max(0, item.qtyKg), 0)
          : 0;
        const un: UnitNames = lang === 'bn'
          ? { kg: 'কেজি', small: 'ছোট বস্তা', medium: 'বস্তা', large: 'বড় বস্তা', ton: 'টন' }
          : { kg: 'kg', small: 'Small bag', medium: 'Bag', large: 'Large bag', ton: 'ton' };
        const paymentTotals = invoicePaymentAmount(d.payments, d.paid, d.total);
        const doc: InvData = {
          no: (d.invoiceNo ?? '').toString(),
          date: lang === 'bn' ? localeDigits(d.date, lang) : d.date,
          time: fmtTime(d.createdAt, lang === 'bn'),
          partyName: party?.name ?? (isSaleKind ? tx('ক্যাশ কাস্টমার', 'Cash customer') : tx('সরবরাহকারী', 'Vendor')),
          partyMobile: party?.mobile ?? '',
          lines: d.items.map((it: any) => ({
            name: it.productName,
            detail: `${unitDetail(it.unit, it.enteredQty, it.qtyKg, un, n)} • ${m(it.rate)}/${tx('কেজি', 'kg')}`,
            total: m(it.qtyKg * it.rate),
          })),
          total: m(d.total),
          paid: m(paymentTotals.paid),
          due: m(paymentTotals.due),
          fullyPaid: paymentTotals.fullyPaid,
          payments: (d.payments ?? []).map((payment: any) => ({
            transactionId: payment.transactionNo ?? payment.paymentNo ?? payment.id,
            date: payment.date ? (lang === 'bn' ? localeDigits(payment.date, lang) : payment.date) : undefined,
            description: invoicePaymentDescription(payment, lang),
            accountName: payment.accountName,
            amount: m(payment.amount),
          })),
          next: d.nextDate,
          extra: belowCostLoss > 0 ? [{
            label: tx('ক্রয়দরের নিচে বিক্রির লোকসান', 'Loss on below-cost items'),
            value: `-${m(belowCostLoss)}`,
            tone: 'loss',
          }] : undefined,
          labels: {
            shop: tx('চালের আড়ৎ', 'Chaler Arot'),
            docTitle: isSaleKind ? tx('বিক্রয় ইনভয়েস', 'Sales invoice') : tx('ক্রয় ইনভয়েস', 'Purchase invoice'),
            invoiceNo: tx('ইনভয়েস নং', 'Invoice no.'), date: tx('তারিখ', 'Date'), time: tx('সময়', 'Time'),
            partyLabel: isSaleKind ? tx('কাস্টমার', 'Customer') : tx('সরবরাহকারী', 'Vendor'),
            mobile: tx('মোবাইল', 'Mobile'), product: tx('পণ্য', 'Product'), qty: tx('পরিমাণ', 'Quantity'), rate: tx('দর', 'Rate'),
            total: tx('মোট', 'Total'), paid: tx('পরিশোধ', 'Paid'), due: tx('বাকি', 'Due'), payDate: tx('পরবর্তী তারিখ', 'Next date'), thanks: tx('ধন্যবাদ, আবার আসবেন', 'Thank you for your business'),
            paymentBreakdown: tx('পেমেন্টের বিবরণ', 'Payment breakdown'), transactionId: tx('লেনদেন আইডি', 'Transaction ID'), description: tx('বিবরণ', 'Description'), account: tx('অ্যাকাউন্ট', 'Account'),
            totalDue: tx('মোট বকেয়া', 'Total due'), fullyPaid: tx('সম্পূর্ণ পরিশোধিত', 'Fully paid'), transportPayment: tx('পরিবহন পেমেন্ট', 'Transport payment'), advancePayment: tx('অগ্রিম পেমেন্ট সমন্বয়', 'Advance payment applied'), invoicePayment: tx('ইনভয়েস পেমেন্ট', 'Invoice payment'), purchaseInvoice: tx('ক্রয় ইনভয়েস', 'Purchase invoice'), salesInvoice: tx('বিক্রয় ইনভয়েস', 'Sales invoice'),
          },
        };
        w.document.open();
        w.document.write(buildInvoiceHTML(doc));
        w.document.close();
        w.focus();
        w.print();
      },
      () => {
        if (w && !w.closed) w.close();
      }
    );
  }, [lang, n]);

  // Open Split Confirmation Modal after preliminary validation
  const handleOpenConfirm = useCallback(() => {
    if (editPaymentUnsupported) {
      showFormError(tx('এই ইনভয়েসের পেমেন্ট অ্যাকাউন্ট সম্পাদনা করা যাবে না।', 'This invoice uses a payment account that this editor cannot preserve.'));
      return;
    }
    setFormError('');
    const validLines = items.filter(it => it.name.trim() && parseNum(it.qty) !== 0);
    if (!validLines.length) {
      showFormError(lang === 'bn' ? 'অনুগ্রহ করে অন্তত একটি পণ্য ও তার পরিমাণ (ধনাত্মক বা ফেরত) দিন।' : 'Add at least one selected product with a non-zero quantity.');
      return;
    }

    if (!selectedPartyId) {
      showFormError(isSale ? tx('ইনভয়েস তৈরির আগে কাস্টমার নির্বাচন করুন।', 'Select a customer before creating this invoice.') : tx('ইনভয়েস তৈরির আগে সরবরাহকারী নির্বাচন করুন।', 'Select a supplier before creating this invoice.'));
      return;
    }

    const hasInvalidLine = validLines.some(it => {
      const enteredRate = parseNum(it.rate);
      return !(enteredRate > 0);
    });
    if (hasInvalidLine) {
      showFormError(isSale ? tx('পণ্যের সঠিক বিক্রয় দর দিন।', 'Enter a valid sale rate.') : tx('পণ্যের সঠিক ক্রয় দর দিন।', 'Enter a valid purchase rate.'));
      return;
    }

    if (isSale && numTransport > 0 && transportPurchaseInvoiceNo.trim()) {
      const contraPurchase = purchases.find(p => p.invoiceNo?.trim().toLocaleLowerCase() === transportPurchaseInvoiceNo.trim().toLocaleLowerCase());
      if (!contraPurchase) { showFormError(tx('ক্রয়ের ইনভয়েস নম্বরটি খুঁজে পাওয়া যায়নি।', 'Purchase invoice number not found.')); return; }
      if (contraPurchase.due + 0.009 < numTransport) { showFormError(tx('ক্রয় ইনভয়েসের বকেয়া পরিবহন পেমেন্টের চেয়ে কম।', 'Purchase invoice balance is less than the transport payment.')); return; }
    }

    // Default cash receive (sale) or cash payment (purchase) to the exact invoice amount
    const invoiceAmt = Math.max(0, Math.round(totalProductValue - numTransport - numDiscount));
    const hasEnteredPaymentAmount = Object.values(paymentAmounts).some(value => value.trim() !== '');
    if (!editId && !hasEnteredPaymentAmount) {
      const defaultPaymentAccount = paymentAccounts.find(account => account.type === 'cash') ?? paymentAccounts[0];
      setPaymentAmounts(defaultPaymentAccount ? { [defaultPaymentAccount.id]: String(invoiceAmt) } : {});
    }

    setReviewSplitOpen(true);
  }, [items, isSale, selectedPartyId, parties, t, lang, products, totalProductValue, numTransport, numDiscount, editId, editPaymentUnsupported, tx, paymentAccounts, paymentAmounts, showFormError]);

  // Final submission handler that creates the invoice
  const executeTransaction = useCallback(async (printWin?: any) => {
    const win = (printWin && typeof printWin === 'object' && typeof printWin.close === 'function') ? (printWin as Window) : null;
    if (submitting) return;
    if (editPaymentUnsupported) {
      showFormError(tx('এই ইনভয়েসের পেমেন্ট অ্যাকাউন্ট সম্পাদনা করা যাবে না।', 'This invoice uses a payment account that this editor cannot preserve.'));
      if (win && !win.closed) win.close();
      return;
    }
    setFormError('');
    const validLines = items.filter(it => it.name.trim() && parseNum(it.qty) !== 0);
    if (!validLines.length) {
      if (win && !win.closed) win.close();
      showFormError(tx('অনুগ্রহ করে অন্তত একটি পণ্যের নাম ও পরিমাণ দিন।', 'Enter at least one product and quantity.'));
      return;
    }

    if (!selectedPartyId) {
      if (win && !win.closed) win.close();
      showFormError(isSale ? tx('ইনভয়েস তৈরির আগে কাস্টমার নির্বাচন করুন।', 'Select a customer before creating the invoice.') : tx('ইনভয়েস তৈরির আগে সরবরাহকারী নির্বাচন করুন।', 'Select a supplier before creating the invoice.'));
      return;
    }

    const hasInvalidLine = validLines.some(it => {
      const enteredRate = parseNum(it.rate);
      return !(enteredRate > 0);
    });

    if (hasInvalidLine) {
      if (win && !win.closed) win.close();
      showFormError(isSale ? tx('পণ্যের সঠিক বিক্রয় দর দিন।', 'Enter a valid sale rate.') : tx('পণ্যের সঠিক ক্রয় দর দিন।', 'Enter a valid purchase rate.'));
      return;
    }

    const effectivePartyId = selectedPartyId;
    if (paymentLines.some(payment => !payment.active)) { showFormError(tx('পেমেন্টের জন্য সক্রিয় ক্যাশ বা ব্যাংক অ্যাকাউন্ট বাছুন।', 'Choose an active cash or bank account for the payment.')); return; }
    const chosenAccountId = paymentLines[0]?.accountId ?? paymentAccounts[0]?.id ?? expenseAccountId;
    if (!isSale && validLines.some(l => parseNum(l.otherCost) > 0) && !expenseAccountId) { showFormError(tx('ক্রয় খরচের জন্য একটি সক্রিয় অ্যাকাউন্ট নির্বাচন করুন।', 'Select an active account for purchase costs.')); return; }

    setSubmitting(true);
    try {
      let targetDate = billDate.trim();
      if (!targetDate) {
        targetDate = getSessionBillDate();
      }
      let isoDate: string | undefined = undefined;
      const dParts = targetDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      if (dParts) {
        isoDate = `${dParts[3]}-${dParts[2].padStart(2, '0')}-${dParts[1].padStart(2, '0')}`;
      }

      const processedLines = validLines.map(l => {
        let pId = l.productId;
        let prod = products.find(p => p.id === pId);
        if (!pId || !prod) {
          prod = products.find(p => p.name.toLowerCase() === l.name.toLowerCase());
          pId = prod?.id || '';
        }
        if (!prod || !pId) {
          throw new Error(lang === 'bn' ? `পণ্য '${l.name}' খুঁজে পাওয়া যায়নি।` : `Product '${l.name}' not found.`);
        }
        const unit = (l.unit || 'medium') as BagUnit;
        const per = kgPerUnit(prod, unit);
        const enteredQty = parseNum(l.qty);
        const enteredRate = parseNum(l.rate);
        const defaultRate = isSale
          ? Math.round((prod?.price || 0) * per)
          : Math.round((prod?.cost || 0) * per);
        const effectiveRate = enteredRate > 0 ? enteredRate : defaultRate;

        if (!(effectiveRate > 0)) {
          throw new Error(lang === 'bn' ? `পণ্য '${l.name}' এর সঠিক দর দিন।` : `Enter a valid rate for '${l.name}'.`);
        }

        const enteredPurchaseRate = parseNum(l.purchaseRate);
        const defaultPurchaseRate = Math.round((prod?.cost || 0) * per);
        const effectivePurchaseRate = enteredPurchaseRate > 0 ? enteredPurchaseRate : defaultPurchaseRate;

        // Rate per KG for backend (since backend records rate per KG and sub += qtyKg * rate)
        const ratePerKg = per > 0 ? (effectiveRate / per) : effectiveRate;
        // Purchase cost per KG for backend (if admin modified purchase price)
        const unitCostPerKg = effectivePurchaseRate > 0 ? (effectivePurchaseRate / per) : (prod?.cost || 0);
        const otherCostPerBag = !isSale ? parseNum(l.otherCost) : 0;

        return {
          productId: pId,
          unit: unit,
          enteredQty: enteredQty,
          rate: Math.round(ratePerKg * 100) / 100,
          unitCost: isSale ? Math.round(unitCostPerKg * 100) / 100 : undefined,
          otherCost: !isSale && otherCostPerBag > 0 ? otherCostPerBag : undefined,
          otherCostPerBag: !isSale && otherCostPerBag > 0 ? otherCostPerBag : undefined,
        };
      });

      let res: { id: string; invoiceNo?: string; total: number };

      if (isSale) {
        const payload = {
          customerId: effectivePartyId || undefined,
          lines: processedLines,
          discount: numDiscount,
          paid: totalPaid,
          transportPaid: numTransport,
          transportContraPurchaseNo: transportPurchaseInvoiceNo.trim() || undefined,
          transportPaymentNote: tx('পরিবহন পেমেন্ট (গ্রাহক সরাসরি দিয়েছেন)', 'Transport payment (paid directly by customer)'),
          accountId: chosenAccountId,
          payments: paymentLines.map(({ accountId, amount }) => ({ accountId, amount })),
          paymentNote: paymentNote.trim() || undefined,
          advanceToApply: selectedAdvance,
          date: isoDate,
          memoNo: memoNo.trim() || undefined,
        };
        res = editId ? await api.updateSale(editId, payload) : await sale(payload);
      } else {
        const payload = {
          vendorId: effectivePartyId,
          lines: processedLines,
          paid: totalPaid,
          accountId: chosenAccountId,
          payments: paymentLines.map(({ accountId, amount }) => ({ accountId, amount })),
          paymentNote: paymentNote.trim() || undefined,
          advanceToApply: selectedAdvance,
          date: isoDate,
          memoNo: memoNo.trim() || undefined,
        };
        res = editId ? await api.updatePurchase(editId, payload) : await purchase(payload);
      }
      if (editId) await refresh();

      const todayISO = isoDate || today();
      const invoiceRef = res?.invoiceNo || memoNo.trim() || 'Invoice';
      const expAccountId = isSale ? chosenAccountId : expenseAccountId;
      const expenseSaveFailures: string[] = [];

      if (!isSale && numTransport > 0 && expAccountId) {
        try {
          await saveExpense({
            id: editId ? transportExpenseId : undefined,
            category: 'transport',
            customName: 'পরিবহন খরচ',
            amount: numTransport,
            accountId: expAccountId,
            date: todayISO,
            note: `[ধরন: পরিবহন] ${isSale ? 'বিক্রয়' : 'ক্রয়'} #${invoiceRef} পরিবহন খরচ`,
          });
        } catch (e) {
          console.error('Failed to save transport expense:', e);
          expenseSaveFailures.push('transport');
        }
      }
      if (editId && transportExpenseId && (isSale || numTransport <= 0)) {
        await deleteExpense(transportExpenseId);
      }

      const totalLinesOtherCost = !isSale
        ? validLines.reduce((sum, l) => {
            const product = products.find(p => p.id === l.productId)
              || products.find(p => p.name.toLowerCase() === l.name.toLowerCase());
            const unit = (l.unit || 'medium') as BagUnit;
            const bagKg = product?.mediumBagKg || 50;
            const bagEquivalent = bagKg > 0
              ? Math.abs(parseNum(l.qty)) * kgPerUnit(product, unit) / bagKg
              : 0;
            const oc = parseNum(l.otherCost);
            return sum + (bagEquivalent * oc);
          }, 0)
        : 0;

      if (totalLinesOtherCost > 0 && expAccountId && !isSale) {
        const lineDetails = validLines
          .filter(l => parseNum(l.otherCost) > 0)
          .map(l => {
            const product = products.find(p => p.id === l.productId)
              || products.find(p => p.name.toLowerCase() === l.name.toLowerCase());
            const unit = (l.unit || 'medium') as BagUnit;
            const bagKg = product?.mediumBagKg || 50;
            const bagEquivalent = bagKg > 0
              ? Math.abs(parseNum(l.qty)) * kgPerUnit(product, unit) / bagKg
              : 0;
            return `${l.name || 'পণ্য'}: ${bagEquivalent.toFixed(2)} বস্তা x ৳${parseNum(l.otherCost)}`;
          })
          .join(', ');

        try {
          await saveExpense({
            id: editId ? landingExpenseId : undefined,
            category: 'loading',
            customName: 'ক্রয় খরচ (প্রতি বস্তা)',
            amount: totalLinesOtherCost,
            accountId: expAccountId,
            date: todayISO,
            capitalized: true,
            note: `[ধরন: ল্যান্ডিং] ক্রয় #${invoiceRef} বস্তা প্রতি খরচ (${lineDetails})`,
          });
        } catch (e) {
          console.error('Failed to save per-bag other expense:', e);
          expenseSaveFailures.push('per-bag landing cost');
        }
      }
      if (editId && totalLinesOtherCost <= 0 && landingExpenseId) {
        await deleteExpense(landingExpenseId);
      }

      if (Platform.OS === 'web' && typeof localStorage !== 'undefined') {
        localStorage.removeItem(`${DRAFT_STORAGE_KEY_PREFIX}${mode}`);
      }

      // If user selected Confirm & Print, trigger print
      if (win && res.id) {
        printDoc(isSale ? 'sale' : 'purchase', res.id, win);
      }

      setReviewSplitOpen(false);

      // Show toast and reset form for fresh entry
      const savedMemo = res.invoiceNo || memoNo;
      setCopiedToast(
        isSale
          ? tx(`বিক্রয় সফল হয়েছে (মেমো নং: ${savedMemo})`, `Sale completed (memo no.: ${savedMemo})`)
          : tx(`ক্রয় সফল হয়েছে (মেমো নং: ${savedMemo})`, `Purchase completed (memo no.: ${savedMemo})`)
      );
      setTimeout(() => setCopiedToast(null), 3500);

      // Increment memo from what was used/set
      const curMemoNum = parseInt(memoNo.trim().replace(/\D/g, ''), 10);
      const nextNo = (!isNaN(curMemoNum) && curMemoNum > 0)
        ? curMemoNum + 1
        : ((isSale ? sales : purchases).length + 1);

      try {
        if (typeof window !== 'undefined' && window.localStorage) {
          const storageKey = isSale ? 'chaler_arot_next_memo_sale' : 'chaler_arot_next_memo_purchase';
          window.localStorage.setItem(storageKey, String(nextNo));
        }
      } catch {}

      resetForm(nextNo);
      setTimeout(focusCustomerInput, 150);
      setTimeout(focusCustomerInput, 350);
      if (editId) onDone();
      if (expenseSaveFailures.length) {
        Alert.alert(
          lang === 'bn' ? 'ইনভয়েস হয়েছে, খরচ সংরক্ষণ হয়নি' : 'Invoice saved, expense not recorded',
          lang === 'bn'
            ? tx(`ইনভয়েস ${invoiceRef} সংরক্ষিত হয়েছে, কিন্তু ${expenseSaveFailures.join(', ')} খরচ সংরক্ষণ করা যায়নি। খরচের হিসাব পরীক্ষা করুন।`, `Invoice ${invoiceRef} was saved, but these expenses could not be recorded: ${expenseSaveFailures.join(', ')}. Please check expenses.`)
            : `Invoice ${invoiceRef} was saved, but these expense records failed: ${expenseSaveFailures.join(', ')}. Please review the expense ledger.`,
        );
      }
    } catch (err) {
      if (win && !win.closed) win.close();
      showFormError(err instanceof Error ? err.message : tx('লেনদেন সম্পন্ন করা সম্ভব হয়নি।', 'Could not complete the transaction.'));
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting, items, selectedPartyId, isSale, products, moneyAccounts, paymentLines, paymentAccounts, numBank, billDate, editPaymentUnsupported,
    lang, sale, numDiscount, totalPaid, memoNo, purchase, numTransport, paymentNote, saveExpense, deleteExpense, mode,
    printDoc, resetForm, sales, purchases, focusCustomerInput, editId, refresh, onDone, showFormError
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
        if (dateCalendarOpen) {
          setDateCalendarOpen(false);
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
    showShortcutsHelp, reviewSplitOpen, dateCalendarOpen, partyDropdownOpen, activeItemDropdownIdx,
    executeTransaction, handleOpenConfirm, handleSaveDraft, addNewRow
  ]);

  const prevReviewOpen = useRef(reviewSplitOpen);
  useEffect(() => {
    if (reviewSplitOpen) {
      if (Platform.OS === 'web') {
        const focusTimer = setTimeout(() => {
          const firstPayment = paymentAccounts.find(account => account.type === 'cash') ?? paymentAccounts[0];
          const el = firstPayment ? inputRefs.current[`modal_payment_${firstPayment.id}`] : inputRefs.current['modal_discount'];
          el?.focus();
          try { el?.select(); } catch {}
          const dom = (el as any)?._inputRef || (el as any)?.getNativeRef?.();
          try { dom?.select(); } catch {}
        }, 50);
        return () => clearTimeout(focusTimer);
      }
    } else if (prevReviewOpen.current && !reviewSplitOpen) {
      // Review split modal just closed - ensure cursor moves back to customer/vendor
      const timers = [50, 150, 300, 500].map(delay => setTimeout(focusCustomerInput, delay));
      return () => timers.forEach(clearTimeout);
    }
    prevReviewOpen.current = reviewSplitOpen;
  // Focus only when the review modal opens. paymentAccounts can change when a
  // payment amount is typed; including it here re-selects the field on every
  // keystroke and makes multi-digit entry impossible.
  }, [reviewSplitOpen, focusCustomerInput]);

  const isInputFocused = (key: string) => focusedField === key;

  if (editLoading) return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F4F8FC' }}><Text style={{ color: '#64748B' }}>{t('wait')}</Text></View>;

  return (
    <View style={styles.outerWrapper}>
      {/* Floating Error Toast (highest z-index, always on top) */}
      {formError ? (
        <View
          accessibilityRole="alert"
          style={{
            position: 'absolute',
            top: 16,
            left: 0,
            right: 0,
            zIndex: 9999999,
            elevation: 999,
            alignItems: 'center',
            paddingHorizontal: 16,
            ...(Platform.OS === 'web' ? { position: 'fixed' as any } : {}),
          }}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => setFormError('')}
            style={{
              backgroundColor: '#FEF2F2',
              borderWidth: 2,
              borderColor: '#F87171',
              borderRadius: 12,
              padding: 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              maxWidth: 560,
              width: '100%',
              ...(Platform.OS === 'web' ? {
                boxShadow: '0 8px 32px rgba(220,38,38,0.25)',
              } as any : {
                shadowColor: '#DC2626',
                shadowOpacity: 0.3,
                shadowRadius: 10,
                elevation: 999,
              }),
            }}
          >
            <AppIcon name={icons.cancel} size={20} iconColor="#DC2626" />
            <Text style={{ color: '#991B1B', fontSize: 14, fontWeight: '700', flex: 1 }}>{formError}</Text>
            <Text style={{ color: '#DC2626', fontSize: 12, fontWeight: '600' }}>âœ•</Text>
          </TouchableOpacity>
        </View>
      ) : null}

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
              accessibilityLabel={tx('পিছনে যান', 'Go back')}
            >
              <AppIcon name={icons.back} size={22} iconColor="#fff" />
            </TouchableOpacity>

            <View style={styles.headerTitleRow}>
              <View style={styles.titleIconBadge}>
                <AppIcon name={isSale ? icons.sale : icons.purchase} size={22} iconColor="#fff" />
              </View>
              <Text style={styles.headerTitle}>{editId ? (isSale ? tx('বিক্রয় সম্পাদনা', 'Edit sale') : tx('ক্রয় সম্পাদনা', 'Edit purchase')) : (isSale ? tx('নতুন বিক্রয়', 'New sale') : tx('নতুন ক্রয়', 'New purchase'))}</Text>
            </View>
            {editId ? <Text style={{ color: '#DBEAFE', fontSize: 12, marginTop: 4, marginLeft: 54 }}>{tx('ড্রাফট পরিবর্তন', 'Draft changes')} · #{lang === 'bn' ? toBnDigits(memoNo) : memoNo} · {tx('নিশ্চিত না করা পর্যন্ত ইনভয়েস ও স্টক পোস্ট হবে না', 'Invoice and stock stay unchanged until confirmed')}</Text> : null}
          </View>

          {/* Right: Tactile 3D Buttons for F1, Search, Bell */}
          <View style={styles.headerRight}>
            {onOpenHistory ? (
              <TouchableOpacity
                onPress={onOpenHistory}
                style={styles.shortcutGuideBadge3D}
                accessibilityRole="button"
                accessibilityLabel={isSale ? 'Sales list' : 'Purchase list'}
                testID={isSale ? 'open-sales-history' : 'open-purchase-history'}
              >
                <Text style={styles.shortcutGuideBadgeText}>{isSale ? tx('বিক্রয় তালিকা', 'Sales list') : tx('ক্রয় তালিকা', 'Purchase list')}</Text>
              </TouchableOpacity>
            ) : null}
            <TouchableOpacity
              onPress={() => setShowShortcutsHelp(true)}
              style={styles.shortcutGuideBadge3D}
              accessibilityLabel={tx('কীবোর্ড শর্টকাট', 'Keyboard shortcuts')}
            >
              <Text style={styles.shortcutGuideBadgeText}>⌨️ F1: {tx('কীবোর্ড', 'Shortcuts')}</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconCircleButton3D} accessibilityLabel={tx('খুঁজুন', 'Search')}>
              <AppIcon name={icons.search} size={20} iconColor="#fff" />
            </TouchableOpacity>

            <TouchableOpacity style={styles.iconCircleButton3D} accessibilityLabel={tx('নোটিফিকেশন', 'Notifications')}>
              <AppIcon name={icons.bell} size={20} iconColor="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        {/* ROW 1: TWO COLUMNS (ক্রয়ের তথ্য & তারিখ) */}
        {/* formError shown inside a high-zIndex floating toast */}
        <View style={[styles.twoColRow, { position: 'relative', zIndex: partyDropdownOpen ? 1000 : 10 }]}>
          {/* Left Card: Purchase Info */}
          <View style={[styles.card3D, styles.colLeft, { position: 'relative', zIndex: partyDropdownOpen ? 1000 : 10 }]}>
            <View style={styles.cardHeaderFlex}>
              <View style={[styles.cardHeaderDot, { backgroundColor: '#1c70b9' }]} />
              <Text style={styles.cardHeaderTitle}>{isSale ? tx('বিক্রয়ের তথ্য', 'Sale details') : tx('ক্রয়ের তথ্য', 'Purchase details')}</Text>
            </View>

            {/* Memo No */}
            <View style={styles.formGroup}>
                <Text style={styles.fieldLabel}>{isSale ? tx('বিক্রয় মেমো নং', 'Sale memo no.') : tx('ক্রয় মেমো নং', 'Purchase memo no.')}</Text>
              <View style={[styles.inputDebossed, isInputFocused('memoNo') && styles.inputFocusedGlow]}>
                <TextInput
                  ref={el => (inputRefs.current['memoNo'] = el)}
                  accessibilityLabel={isSale ? 'Sale memo number' : 'Purchase memo number'}
                  value={memoNo}
                  onChangeText={handleMemoNoChange}
                  onFocus={() => setFocusedField('memoNo')}
                  onSubmitEditing={() => focusNextField('memoNo')}
                  style={styles.textInput}
                  keyboardType="numeric"
                  returnKeyType="next"
                />
                <TouchableOpacity
                  onPress={() => copyToClipboard(memoNo, tx('মেমো নং', 'Memo no.'))}
                  style={styles.tactileInnerBtn}
                  accessibilityLabel={tx('কপি করুন', 'Copy')}
                >
                  <AppIcon name={icons.copy} size={18} iconColor="#1c70b9" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Party Code (Cursor starts here by default) */}
            <View style={[styles.formGroup, { position: 'relative', zIndex: partyDropdownOpen ? 1100 : 1 }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                <RequiredLabel text={isSale ? tx('কাস্টমার কোড', 'Customer code') : tx('সরবরাহকারী কোড', 'Supplier code')} required style={styles.fieldLabel} />
                {/* Default Code Indicator & Toggle Button */}
                {partyCode.trim() ? (
                  <TouchableOpacity
                    onPress={() => handleToggleDefaultParty()}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingVertical: 2,
                      paddingHorizontal: 7,
                      borderRadius: 6,
                      backgroundColor: defaultPartyCode.trim().toLowerCase() === partyCode.trim().toLowerCase() ? '#FEF3C7' : '#F1F5F9',
                      borderWidth: 1,
                      borderColor: defaultPartyCode.trim().toLowerCase() === partyCode.trim().toLowerCase() ? '#F59E0B' : '#CBD5E1',
                    }}
                    accessibilityLabel={tx('ডিফল্ট হিসেবে সেট বা মুছুন', 'Set or remove default')}
                  >
                    <Text style={{
                      fontSize: 11,
                      fontWeight: '800',
                      color: defaultPartyCode.trim().toLowerCase() === partyCode.trim().toLowerCase() ? '#B45309' : '#475569',
                    }}>
                      {defaultPartyCode.trim().toLowerCase() === partyCode.trim().toLowerCase()
                        ? tx('★ ডিফল্ট কোড (মুছুন)', '★ Default code (remove)')
                        : tx('☆ ডিফল্ট সেট করুন', '☆ Set default')}
                    </Text>
                  </TouchableOpacity>
                ) : defaultPartyCode ? (
                  <TouchableOpacity
                    onPress={() => {
                      setPartyCode(defaultPartyCode);
                      const match = findPartyByCode(defaultPartyCode);
                      if (match) onSelectParty(match.party, match.index);
                    }}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      paddingVertical: 2,
                      paddingHorizontal: 7,
                      borderRadius: 6,
                      backgroundColor: '#FEF3C7',
                      borderWidth: 1,
                      borderColor: '#F59E0B',
                    }}
                  >
                    <Text style={{ fontSize: 11, fontWeight: '800', color: '#B45309' }}>
                      {tx('★ ডিফল্ট:', '★ Default:')} {defaultPartyCode} ({tx('লোড করুন', 'Load')})
                    </Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={[styles.inputDebossed, isInputFocused('partyCode') && styles.inputFocusedGlow]}>
                <TextInput
                  ref={el => (inputRefs.current['partyCode'] = el)}
                  accessibilityLabel={isSale ? 'Customer code' : 'Vendor code'}
                  autoFocus
                  value={partyCode}
                  onChangeText={v => {
                    partyCodeEditedRef.current = true;
                    setPartyCode(v);
                    setPartyDropdownOpen(true);
                    if (v.trim().length > 0) {
                      const match = findPartyByCode(v.trim());
                      if (match) {
                        setSelectedPartyId(match.party.id);
                        setPartyName(match.party.name);
                        setPartyMobile(match.party.mobile || '');
                        setPartyAddress(match.party.address || '');
                      } else {
                        setSelectedPartyId('');
                        setPartyName('');
                        setPartyMobile('');
                        setPartyAddress('');
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
                      } else if (e.nativeEvent.key === 'Enter' && filteredParties[partyHighlightIdx]) {
                        e.preventDefault?.();
                        const p = filteredParties[partyHighlightIdx];
                        const fullIdx = parties.findIndex(x => x.id === p.id);
                        onSelectParty(p, fullIdx);
                        focusNextField('partyCode');
                      } else if (e.nativeEvent.key === 'Escape') {
                        setPartyDropdownOpen(false);
                      }
                    }
                  }}
                  style={styles.textInput}
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
                <View style={[styles.dropdownMenu3D, { zIndex: 9999, elevation: 999 }]}>
                  <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
                    {filteredParties.length ? (
                      filteredParties.map((p, idx) => {
                        const isHighlighted = idx === partyHighlightIdx;
                        const fullIdx = parties.findIndex(x => x.id === p.id);
                        const pDisplayCode = p.code?.trim() ?? '';
                        const isThisDefault = !!pDisplayCode && pDisplayCode.toLowerCase() === defaultPartyCode.trim().toLowerCase();
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
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                <Text style={styles.dropdownItemText}>{p.name}</Text>
                                {isThisDefault && (
                                  <View style={{ backgroundColor: '#FEF3C7', paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: '#F59E0B' }}>
                                    <Text style={{ fontSize: 10, fontWeight: '800', color: '#B45309' }}>★ {tx('ডিফল্ট', 'Default')}</Text>
                                  </View>
                                )}
                              </View>
                              <Text style={styles.dropdownItemSub}>{[localeDigits(p.mobile, lang), pDisplayCode ? `${tx('কোড:', 'Code:')} ${pDisplayCode}` : ''].filter(Boolean).join(' • ')}</Text>
                            </View>
                            <View style={{ alignItems: 'flex-end', gap: 2 }}>
                              <Text style={styles.dropdownItemDue}>{m(bal(isSale ? 'c' : 'v', p.id).balance)}</Text>
                              {pDisplayCode ? (
                                <TouchableOpacity
                                  onPress={(e) => {
                                    e.stopPropagation?.();
                                    handleToggleDefaultParty(pDisplayCode);
                                  }}
                                  style={{ padding: 2 }}
                                  accessibilityLabel={tx('ডিফল্ট হিসেবে সেট বা মুছুন', 'Set or remove default')}
                                >
                                  <Text style={{ fontSize: 10, color: isThisDefault ? '#B45309' : '#94A3B8', fontWeight: '700' }}>
                                    {isThisDefault ? `★ ${tx('ডিফল্ট', 'Default')}` : `☆ ${tx('ডিফল্ট করুন', 'Set default')}`}
                                  </Text>
                                </TouchableOpacity>
                              ) : null}
                            </View>
                          </TouchableOpacity>
                        );
                      })
                    ) : (
                      <View style={{ padding: 12 }}>
                        <Text style={{ color: '#5B728F', fontSize: 13, textAlign: 'center' }}>
                          {isSale ? tx('কোন কাস্টমার পাওয়া যায়নি', 'No customers found') : tx('কোন সরবরাহকারী পাওয়া যায়নি', 'No vendors found')}
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
                <Text style={styles.fieldLabel}>{isSale ? tx('কাস্টমারের নাম', 'Customer name') : tx('সরবরাহকারীর নাম', 'Vendor name')}</Text>
                <View style={styles.readOnlyBadge}>
                  <AppIcon name={icons.lock} size={11} iconColor="#64748B" />
                  <Text style={styles.readOnlyBadgeText}>{tx('ডাটাবেজ থেকে', 'From database')}</Text>
                </View>
              </View>
              <View style={[styles.inputDebossed, styles.inputReadOnly]}>
                <TextInput
                  ref={el => (inputRefs.current['partyName'] = el)}
                  value={partyName}
                  editable={false}
                  style={[styles.textInput, styles.textInputReadOnly]}
                  placeholder={tx('কোড লিখলে নাম স্বয়ংক্রিয় আসবে', 'Name fills in when you enter a code')}
                  placeholderTextColor="#94A3B8"
                />
              </View>
            </View>

            {/* Mobile */}
            <View style={styles.formGroup}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={styles.fieldLabel}>{tx('মোবাইল নম্বর', 'Mobile number')}</Text>
                <View style={styles.readOnlyBadge}>
                  <Text style={styles.readOnlyBadgeText}>{tx('রিড-অনলি', 'Read only')}</Text>
                </View>
              </View>
              <View style={[styles.inputDebossed, styles.inputReadOnly]}>
                <TextInput
                  ref={el => (inputRefs.current['partyMobile'] = el)}
                  value={localeDigits(partyMobile, lang)}
                  editable={false}
                  style={[styles.textInput, styles.textInputReadOnly]}
                  placeholder={tx('মোবাইল নম্বর', 'Mobile number')}
                  placeholderTextColor="#94A3B8"
                />
              </View>
            </View>

            {/* Address */}
            <View style={styles.formGroup}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <Text style={styles.fieldLabel}>{tx('ঠিকানা', 'Address')}</Text>
                <View style={styles.readOnlyBadge}>
                  <Text style={styles.readOnlyBadgeText}>{tx('রিড-অনলি', 'Read only')}</Text>
                </View>
              </View>
              <View style={[styles.textareaDebossed, styles.inputReadOnly]}>
                <TextInput
                  ref={el => (inputRefs.current['partyAddress'] = el)}
                  value={partyAddress}
                  editable={false}
                  style={[styles.textareaInput, styles.textInputReadOnly]}
                  placeholder={tx('ঠিকানা', 'Address')}
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
              <Text style={styles.cardHeaderTitle}>{tx('তারিখ বিবরণ', 'Date details')}</Text>
            </View>

            {/* Bill Date with Lock / Unlock and Set Buttons */}
            <View style={styles.formGroup}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <RequiredLabel text={isSale ? tx('বিক্রয়ের তারিখ', 'Sale date') : tx('বিলের তারিখ', 'Bill date')} required style={styles.fieldLabel} />

                {/* Lock / Unlock and Set Buttons */}
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  {/* Set Button */}
                  <TouchableOpacity
                    onPress={() => {
                      if (!isDateLocked) {
                        const todayStr = getSessionBillDate();
                        setBillDate(todayStr);
                      }
                    }}
                    disabled={isDateLocked}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: isDateLocked ? '#F1F5F9' : '#EFF6FF',
                      borderWidth: 1,
                      borderColor: isDateLocked ? '#CBD5E1' : '#93C5FD',
                      borderRadius: 6,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      opacity: isDateLocked ? 0.6 : 1,
                      cursor: isDateLocked ? 'not-allowed' as any : 'pointer' as any,
                    }}
                  >
                    <AppIcon name={icons.calendar} size={13} iconColor={isDateLocked ? '#94A3B8' : '#1D4ED8'} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: isDateLocked ? '#94A3B8' : '#1D4ED8' }}>সেট (আজ)</Text>
                  </TouchableOpacity>

                  {/* Lock / Unlock Toggle Button */}
                  <TouchableOpacity
                    onPress={toggleDateLock}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: isDateLocked ? '#FEF2F2' : '#F8FAFC',
                      borderWidth: 1,
                      borderColor: isDateLocked ? '#FCA5A5' : '#CBD5E1',
                      borderRadius: 6,
                      paddingHorizontal: 8,
                      paddingVertical: 3,
                      cursor: 'pointer' as any,
                    }}
                  >
                    <AppIcon name={isDateLocked ? icons.lock : icons.unlock} size={13} iconColor={isDateLocked ? '#DC2626' : '#475569'} />
                    <Text style={{ fontSize: 12, fontWeight: '700', color: isDateLocked ? '#DC2626' : '#475569' }}>
                      {isDateLocked ? '🔒 লক' : '🔓 আনলক'}
                    </Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={[
                styles.inputDebossed,
                isInputFocused('billDate') && styles.inputFocusedGlow,
                isDateLocked && { backgroundColor: '#F1F5F9', borderColor: '#CBD5E1' }
              ]}>
                <TextInput
                  ref={el => (inputRefs.current['billDate'] = el)}
                  accessibilityLabel="Invoice date"
                  value={billDate}
                  editable={!isDateLocked}
                  onChangeText={setBillDate}
                  onFocus={() => setFocusedField('billDate')}
                  onSubmitEditing={() => focusNextField('billDate')}
                  style={[styles.textInput, isDateLocked && { color: '#64748B' }]}
                  placeholder="DD/MM/YYYY"
                  placeholderTextColor="#94A3B8"
                  returnKeyType="next"
                />
                <TouchableOpacity
                  onPress={() => !isDateLocked && setDateCalendarOpen(true)}
                  disabled={isDateLocked}
                  accessibilityRole="button"
                  accessibilityLabel="Open calendar"
                  testID="open-invoice-calendar"
                  style={styles.tactileInnerBtn}
                >
                  <AppIcon name={isDateLocked ? icons.lock : icons.calendar} size={18} iconColor={isDateLocked ? '#94A3B8' : '#1c70b9'} />
                </TouchableOpacity>
              </View>
            </View>

            <Modal
              visible={dateCalendarOpen}
              transparent
              animationType="fade"
              onRequestClose={() => setDateCalendarOpen(false)}
            >
              <View style={styles.modalOverlay}>
                <View testID="invoice-calendar-modal" style={[styles.shortcutModalBox, { maxWidth: 400 }]}>
                  <View style={styles.modalHeader3D}>
                    <Text style={styles.modalTitle}>{tx('তারিখ নির্বাচন', 'Select date')}</Text>
                    <TouchableOpacity
                      onPress={() => setDateCalendarOpen(false)}
                      accessibilityRole="button"
                      accessibilityLabel="Close calendar"
                      style={{ minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' }}
                    >
                      <AppIcon name={icons.cancel} size={22} iconColor="#fff" />
                    </TouchableOpacity>
                  </View>
                  <View style={{ padding: 14 }}>
                    <MonthCal
                      key={dateCalendarOpen ? `open-${getSessionBillDate()}` : 'closed'}
                      selected={toCalendarDate(getSessionBillDate())}
                      onPick={date => {
                        const formatted = fromCalendarDate(date);
                        if (formatted) setBillDate(formatted);
                        setDateCalendarOpen(false);
                      }}
                    />
                  </View>
                </View>
              </View>
            </Modal>

            {/* Decorative Flashy Skeuomorphic Widget */}
            
          </View>
        </View>

        {/* ROW 2: PRODUCTS TABLE CARD */}
        <View style={[styles.card3D, styles.tableCard, { position: 'relative', zIndex: activeItemDropdownIdx !== null ? 200 : 1 }]}>
          <View style={styles.tableCardHeader}>
            <View style={styles.cardHeaderFlex}>
              <View style={[styles.cardHeaderDot, { backgroundColor: '#10B981' }]} />
              <Text style={styles.cardHeaderTitle}>{tx('পণ্যের তালিকা', 'Product list')}</Text>
            </View>

            <TouchableOpacity
              onPress={() => addNewRow(true)}
              testID="add-product-row"
              style={styles.addProductBtnModern}
              activeOpacity={0.85}
              accessibilityLabel={tx('পণ্য যোগ করুন (Alt+A)', 'Add product (Alt+A)')}
            >
              <View style={styles.addIconCircle}>
                <AppIcon name={icons.plus} size={15} iconColor="#FFFFFF" />
              </View>
              <Text style={styles.addProductBtnText}>{tx('পণ্য যোগ করুন', 'Add product')}</Text>
              <View style={styles.shortcutKeyBadge}>
                <Text style={styles.shortcutKeyText}>Alt+A</Text>
              </View>
            </TouchableOpacity>
          </View>

          {/* Table Header Row */}
          <View style={styles.tableHeaderRow3D}>
            <Text style={[styles.th, { width: 44, textAlign: 'center' }]}>{tx('ক্রম', '#')}</Text>
            <Text style={[styles.th, { width: 120 }]}>{tx('পণ্য কোড', 'Product code')}</Text>
            <Text style={[styles.th, { flex: 1, minWidth: 0 }]}>
              {tx('পণ্যের নাম', 'Product name')}<Text style={{ color: '#DC2626', fontWeight: '900' }}> *</Text>
            </Text>
            <Text style={[styles.th, { width: 120, minWidth: 0, textAlign: 'center' }]}>
              {tx('পরিমাণ (বস্তা)', 'Quantity (bags)')}<Text style={{ color: '#DC2626', fontWeight: '900' }}> *</Text>
            </Text>
            <Text style={[styles.th, { width: 110, textAlign: 'center' }]}>{tx('মোট কেজি', 'Total kg')}</Text>
            {isSale && (
              <Text style={[styles.th, { width: 120, textAlign: 'center' }]}>{tx('গড় ক্রয়দর (৳)', 'Average cost (৳)')}</Text>
            )}
            <Text style={[styles.th, { width: 120, textAlign: 'center' }]}>
              {isSale ? tx('বিক্রয় দর (৳)', 'Sale rate (৳)') : tx('ক্রয় দর (৳)', 'Purchase rate (৳)')}<Text style={{ color: '#DC2626', fontWeight: '900' }}> *</Text>
            </Text>
            {!isSale && (
              <Text style={[styles.th, { width: 130, textAlign: 'center' }]}>{tx('অন্যান্য খরচ/বস্তা (৳)', 'Other cost/bag (৳)')}</Text>
            )}
            <Text style={[styles.th, { width: 125, textAlign: 'center' }]}>{tx('মোট (৳)', 'Total (৳)')}</Text>
            <Text style={[styles.th, { width: 48, textAlign: 'center' }]}>{tx('অ্যাকশন', 'Action')}</Text>
          </View>

          {/* Table Rows */}
          {items.map((row, rowIdx) => {
            const rowQty = parseNum(row.qty);
            const rowRate = parseNum(row.rate);
            const rowProduct = products.find(p => p.id === row.productId || p.name === row.name);
            const bagKg = rowProduct?.mediumBagKg || 50;
            const per = kgPerUnit(rowProduct, row.unit || 'medium');
            const rowTotal = Math.round(rowQty * rowRate);
            const basePurchaseRate = rowProduct ? Math.round((rowProduct.cost || 0) * per) : 0;
            const rowKg = rowQty !== 0 ? Math.round(rowQty * per * 100) / 100 : 0;
            const isReturnLine = rowQty < 0;

            return (
              <View key={row.id} style={[
                styles.tableDataRow,
                {
                  position: 'relative',
                  zIndex: activeItemDropdownIdx === rowIdx ? 1000 : (items.length - rowIdx),
                  backgroundColor: isReturnLine ? '#FFF5F5' : (rowIdx % 2 === 1 ? '#F8FAFC' : '#FFFFFF'),
                }
              ]}>
                {/* Serial # */}
                <View style={[styles.td, { width: 44, alignItems: 'center', justifyContent: 'center' }]}>
                  <View style={[styles.serialBadge, isReturnLine && { backgroundColor: '#FEE2E2', borderColor: '#FCA5A5' }]}>
                    <Text style={[styles.serialText, isReturnLine && { color: '#DC2626', fontWeight: '900' }]}>
                      {isReturnLine ? '↩' : toBnDigits(String(rowIdx + 1))}
                    </Text>
                  </View>
                </View>

                {/* Product Code */}
                <View style={[styles.td, {
                  width: 120,
                  position: 'relative',
                  zIndex: activeItemDropdownIdx === rowIdx ? 1100 : 1,
                  elevation: activeItemDropdownIdx === rowIdx ? 20 : 0,
                }]}>
                  <View style={[styles.tableInputDebossed, { height: 40 }, isInputFocused(`code_${rowIdx}`) && styles.inputFocusedGlow]}>
                    <TextInput
                      ref={el => (inputRefs.current[`code_${rowIdx}`] = el)}
                      accessibilityLabel={`Product code ${rowIdx + 1}`}
                      value={row.code}
                      onChangeText={txt => {
                        setItemHighlightIdx(0);
                        handleCodeChange(rowIdx, txt);
                      }}
                      onFocus={() => {
                        setFocusedField(`code_${rowIdx}`);
                        setItemHighlightIdx(0);
                        setActiveItemDropdownIdx(rowIdx);
                      }}
                      onSubmitEditing={() => {
                        const visibleProducts = getVisibleProducts(row.code);
                        if (visibleProducts.length) {
                          const selectedProduct = visibleProducts[itemHighlightIdx] || visibleProducts[0];
                          onSelectProduct(rowIdx, selectedProduct);
                        }
                        setActiveItemDropdownIdx(null);
                        focusNextField(`code_${rowIdx}`);
                      }}
                      onKeyPress={(e: any) => {
                        const visibleProducts = getVisibleProducts(row.code);
                        if (e.nativeEvent.key === 'ArrowDown') {
                          e.preventDefault?.();
                          setItemHighlightIdx(i => Math.min(visibleProducts.length - 1, i + 1));
                        } else if (e.nativeEvent.key === 'ArrowUp') {
                          e.preventDefault?.();
                          setItemHighlightIdx(i => Math.max(0, i - 1));
                        } else if (e.nativeEvent.key === 'Escape') {
                          setActiveItemDropdownIdx(null);
                        }
                      }}
                    placeholder={tx('কোড', 'Code')}
                      placeholderTextColor="#94A3B8"
                      style={styles.tableTextInputNoBorder}
                      returnKeyType="next"
                    />
                  </View>

                  {/* Product Dropdown (from Code) */}
                  {activeItemDropdownIdx === rowIdx && (
                    <View testID={`product-dropdown-${rowIdx + 1}`} style={[styles.dropdownMenu3D, styles.productDropdownMenu, { zIndex: 2000, elevation: 30 }]}>
                      <ScrollView style={{ maxHeight: 200 }} keyboardShouldPersistTaps="handled">
                        {getVisibleProducts(row.code).length ? getVisibleProducts(row.code).map((p, visibleIdx) => {
                          const pCode = p.code?.trim() ?? '';
                          const pBagKg = p.mediumBagKg || 50;
                          return (
                            <TouchableOpacity
                              key={p.id}
                              onPress={() => {
                                onSelectProduct(rowIdx, p);
                                focusNextField(`code_${rowIdx}`);
                              }}
                              style={[styles.dropdownItem, itemHighlightIdx === visibleIdx && styles.dropdownItemActive]}
                              accessibilityRole="button"
                              accessibilityLabel={`Select product ${p.name}`}
                            >
                              <View style={{ flex: 1 }}>
                                <Text style={styles.dropdownItemText}>{p.name}</Text>
                                <Text style={styles.dropdownItemSub}>
                        {tx('কোড:', 'Code:')} {lang === 'bn' ? toBnDigits(pCode) : pCode} • {tx('স্টক:', 'Stock:')} {n(p.qty)} {tx('কেজি', 'kg')} ({n(Math.round(p.qty / pBagKg))} {tx('বস্তা', 'bags')}) • {tx('প্রতি বস্তা:', 'Per bag:')} {n(pBagKg)} {tx('কেজি', 'kg')}
                                </Text>
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
                <View style={[styles.td, { flex: 1, minWidth: 0 }]}>
                  <View style={{
                    backgroundColor: row.name ? '#F8FAFC' : '#F1F5F9',
                    borderRadius: 8,
                    borderWidth: 1.5,
                    borderColor: row.name ? '#CBD5E1' : '#E2E8F0',
                    paddingHorizontal: 10,
                    height: 40,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}>
                    <Text
                      style={[styles.productDisplayText, !row.name && styles.productDisplayEmpty]}
                      numberOfLines={1}
                      ellipsizeMode="tail"
                    >
                      {row.name || (lang === 'bn' ? '— কোড লিখলে নাম আসবে —' : '— Enter Code —')}
                    </Text>
                    {rowProduct ? (
                      <View style={{
                        backgroundColor: '#ECFDF5',
                        borderWidth: 1,
                        borderColor: '#A7F3D0',
                        borderRadius: 6,
                        paddingHorizontal: 7,
                        paddingVertical: 2,
                        marginLeft: 8,
                      }}>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: '#047857' }} numberOfLines={1}>
                        {tx('স্টক:', 'Stock:')} {n(Math.round(rowProduct.qty / bagKg))} {tx('বস্তা', 'bags')}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </View>

                {/* Quantity (বস্তা) */}
                <View style={[styles.td, { width: 120, alignItems: 'center' }]}>
                  <TextInput
                    ref={el => (inputRefs.current[`qty_${rowIdx}`] = el)}
                    accessibilityLabel={`Quantity ${rowIdx + 1}`}
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
                      if (Platform.OS === 'web') return;
                      if (isSale) {
                        inputRefs.current[`rate_${rowIdx}`]?.focus();
                        setFocusedField(`rate_${rowIdx}`);
                      } else {
                        focusNextField(`qty_${rowIdx}`);
                      }
                    }}
                    onKeyPress={(e: any) => {
                      if (Platform.OS !== 'web' || e.nativeEvent?.key !== 'Enter') return;
                      e.preventDefault?.();
                      e.stopPropagation?.();
                      if (isSale) focusInputAfterKey(`rate_${rowIdx}`);
                      else focusNextField(`qty_${rowIdx}`);
                    }}
                    selectTextOnFocus={true}
                    style={[
                      styles.tableTextInput,
                      { height: 40, width: '100%', textAlign: 'center' },
                      isInputFocused(`qty_${rowIdx}`) && styles.inputFocusedGlow,
                    ]}
                    placeholder={tx('বস্তা', 'Bags')}
                    placeholderTextColor="#94A3B8"
                    keyboardType="numeric"
                    returnKeyType="next"
                  />
                </View>

                {/* Total KG (মোট কেজি) Column */}
                <View style={[styles.td, { width: 110, alignItems: 'center' }]}>
                  <View style={{
                    backgroundColor: isReturnLine ? '#FEF2F2' : (rowKg > 0 ? '#F0F9FF' : '#F8FAFC'),
                    borderRadius: 8,
                    borderWidth: 1.5,
                    borderColor: isReturnLine ? '#FECACA' : (rowKg > 0 ? '#BAE6FD' : '#E2E8F0'),
                    height: 40,
                    width: '100%',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingHorizontal: 6,
                  }}>
                    <Text style={{
                      fontSize: 13,
                      fontWeight: '800',
                      color: isReturnLine ? '#DC2626' : (rowKg > 0 ? '#0284C7' : '#94A3B8'),
                    }}>
                      {rowKg !== 0 ? `${rowKg < 0 ? '-' : ''}${toBnDigits(String(Math.abs(rowKg)))} কেজি` : '০ কেজি'}
                    </Text>
                  </View>
                </View>

                {/* Avg Purchase Price (Editable on sale by admin) */}
                {isSale && (
                  <View style={[styles.td, { width: 120, alignItems: 'center' }]}>
                    <TextInput
                      ref={el => (inputRefs.current[`purchaseRate_${rowIdx}`] = el)}
                      accessibilityLabel={`Purchase cost ${rowIdx + 1}`}
                      value={row.purchaseRate}
                      onChangeText={txt => {
                        setItems(prev => {
                          const copy = [...prev];
                          copy[rowIdx].purchaseRate = txt;
                          return copy;
                        });
                      }}
                      onFocus={() => setFocusedField(`purchaseRate_${rowIdx}`)}
                      onSubmitEditing={() => {
                        if (Platform.OS !== 'web') {
                          inputRefs.current[`rate_${rowIdx}`]?.focus();
                          setFocusedField(`rate_${rowIdx}`);
                        }
                      }}
                      onKeyPress={(e: any) => {
                        if (Platform.OS !== 'web' || e.nativeEvent?.key !== 'Enter') return;
                        e.preventDefault?.();
                        e.stopPropagation?.();
                        focusInputAfterKey(`rate_${rowIdx}`);
                      }}
                      selectTextOnFocus={true}
                      style={[
                        styles.tableTextInput,
                        { height: 40, width: '100%', textAlign: 'center', borderColor: '#F59E0B', backgroundColor: '#FFFDF7' },
                        isInputFocused(`purchaseRate_${rowIdx}`) && styles.inputFocusedGlow,
                      ]}
                      placeholder={basePurchaseRate > 0 ? String(basePurchaseRate) : 'গড় ক্রয়'}
                      placeholderTextColor="#94A3B8"
                      keyboardType="numeric"
                      returnKeyType="next"
                    />
                  </View>
                )}

                {/* Rate */}
                <View style={[styles.td, { width: 120, alignItems: 'center' }]}>
                  <TextInput
                    ref={el => (inputRefs.current[`rate_${rowIdx}`] = el)}
                    editable={true}
                    accessibilityLabel={`${isSale ? 'Sale rate' : 'Purchase rate'} ${rowIdx + 1}`}
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
                      if (Platform.OS !== 'web') focusNextField(`rate_${rowIdx}`);
                    }}
                    onKeyPress={(e: any) => {
                      if (Platform.OS === 'web' && e.nativeEvent?.key === 'Enter') {
                        e.preventDefault?.();
                        e.stopPropagation?.();
                        setTimeout(() => focusNextField(`rate_${rowIdx}`), 0);
                        return;
                      }
                      if (e.nativeEvent?.key === 'Tab' && !e.nativeEvent?.shiftKey) {
                        e.preventDefault?.();
                        if (!isSale) {
                          inputRefs.current[`otherCost_${rowIdx}`]?.focus();
                          setFocusedField(`otherCost_${rowIdx}`);
                        } else if (rowIdx < items.length - 1) {
                          inputRefs.current[`code_${rowIdx + 1}`]?.focus();
                          setFocusedField(`code_${rowIdx + 1}`);
                        } else {
                          confirmBtnRef.current?.focus();
                          setFocusedField('completeButton');
                        }
                      }
                    }}
                    selectTextOnFocus={true}
                    style={[
                      styles.tableTextInput,
                      { height: 40, width: '100%', textAlign: 'center' },
                      isInputFocused(`rate_${rowIdx}`) && styles.inputFocusedGlow,
                    ]}
                    placeholder={isSale ? 'বিক্রয় দর লিখুন' : 'ক্রয় দর লিখুন'}
                    placeholderTextColor="#94A3B8"
                    keyboardType="numeric"
                    returnKeyType="next"
                  />
                </View>

                {/* Other Cost per Bag (Purchase Mode only) */}
                {!isSale && (
                  <View style={[styles.td, { width: 130, alignItems: 'center' }]}>
                    <TextInput
                      ref={el => (inputRefs.current[`otherCost_${rowIdx}`] = el)}
                      accessibilityLabel={`Other cost per bag ${rowIdx + 1}`}
                      value={row.otherCost ?? ''}
                      onChangeText={txt => {
                        setItems(prev => {
                          const copy = [...prev];
                          copy[rowIdx] = { ...copy[rowIdx], otherCost: txt };
                          return copy;
                        });
                      }}
                      onFocus={() => setFocusedField(`otherCost_${rowIdx}`)}
                      onSubmitEditing={() => focusNextField(`otherCost_${rowIdx}`)}
                      {...(Platform.OS === 'web' ? {
                        onKeyDown: (e: any) => {
                          if (e.key === 'Tab' && !e.shiftKey) {
                            e.preventDefault?.();
                            if (rowIdx < items.length - 1) {
                              inputRefs.current[`code_${rowIdx + 1}`]?.focus();
                              setFocusedField(`code_${rowIdx + 1}`);
                            } else {
                              confirmBtnRef.current?.focus();
                              setFocusedField('completeButton');
                            }
                          }
                        }
                      } as any : {})}
                      onKeyPress={(e: any) => {
                        if (e.nativeEvent?.key === 'Tab' && !e.nativeEvent?.shiftKey) {
                          e.preventDefault?.();
                          if (rowIdx < items.length - 1) {
                            inputRefs.current[`code_${rowIdx + 1}`]?.focus();
                            setFocusedField(`code_${rowIdx + 1}`);
                          } else {
                            confirmBtnRef.current?.focus();
                            setFocusedField('completeButton');
                          }
                        }
                      }}
                      selectTextOnFocus={true}
                      style={[
                        styles.tableTextInput,
                        { height: 40, width: '100%', textAlign: 'center', borderColor: '#CBD5E1', backgroundColor: '#FFFFFF' },
                        isInputFocused(`otherCost_${rowIdx}`) && styles.inputFocusedGlow,
                      ]}
                      placeholder="০"
                      placeholderTextColor="#94A3B8"
                      keyboardType="numeric"
                      returnKeyType="next"
                    />
                  </View>
                )}

                {/* Total Box */}
                <View style={[styles.td, { width: 125, alignItems: 'center' }]}>
                  <View style={[
                    styles.tableTotalBox3D,
                    { height: 40 },
                    isReturnLine && { backgroundColor: '#FFF1F2', borderColor: '#FDA4AF' },
                  ]}>
                    <Text style={[styles.tableTotalText, isReturnLine && { color: '#DC2626' }]}>
                      {rowTotal !== 0 ? m(rowTotal) : '০'}
                    </Text>
                  </View>
                </View>

                {/* Direct Action (Delete) Button - Mouse only, skipped by keyboard Tab */}
                <View style={[styles.td, { width: 48, alignItems: 'center', justifyContent: 'center' }]}>
                  <TouchableOpacity
                    onPress={() => removeRow(rowIdx)}
                    style={[styles.deleteRowBtnDirect, { height: 38, width: 38 }]}
                    accessibilityLabel="পণ্য বাদ দিন"
                    focusable={false}
                    {...(Platform.OS === 'web' ? { tabIndex: -1 } as any : {})}
                  >
                    <AppIcon name={icons.del} size={18} iconColor="#DC2626" />
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}

          {/* Table Summary Strip: Total Bags and Total KG */}
          <View style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            backgroundColor: '#F8FAFC',
            borderTopWidth: 1.5,
            borderTopColor: '#E2E8F0',
            paddingVertical: 10,
            paddingHorizontal: 16,
          }}>
            <Text style={{ fontSize: 13, fontWeight: '700', color: '#64748B' }}>
                  {tx('মোট আইটেম:', 'Items:')} {lang === 'bn' ? toBnDigits(String(items.filter(it => it.name.trim()).length || items.length)) : (items.filter(it => it.name.trim()).length || items.length)}
            </Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F172A' }}>
                  {tx('মোট পরিমাণ:', 'Total quantity:')}{' '}
                <Text style={{ color: '#1c70b9', fontWeight: '800' }}>
                    {lang === 'bn' ? toBnDigits(String(Math.round(items.reduce((sum, it) => sum + parseNum(it.qty), 0)))) : Math.round(items.reduce((sum, it) => sum + parseNum(it.qty), 0))} {tx('বস্তা', 'bags')}
                </Text>
                {' '}(
                <Text style={{ color: '#059669', fontWeight: '800' }}>
                  {toBnDigits(String(Math.round(items.reduce((sum, it) => {
                    const prod = products.find(p => p.id === it.productId || p.name === it.name);
                    const per = kgPerUnit(prod, it.unit || 'medium');
                    return sum + parseNum(it.qty) * per;
                  }, 0))))} {tx('কেজি', 'kg')}
                </Text>
                )
              </Text>
              {items.some(it => parseNum(it.qty) < 0) && (
                <View style={{ backgroundColor: '#FEF2F2', paddingVertical: 2, paddingHorizontal: 7, borderRadius: 6, borderWidth: 1, borderColor: '#FECACA' }}>
                  <Text style={{ fontSize: 12, fontWeight: '800', color: '#DC2626' }}>
                    {isSale ? 'বিক্রয় ফেরত' : 'ক্রয় ফেরত'}: {toBnDigits(String(Math.abs(items.filter(it => parseNum(it.qty) < 0).reduce((s, it) => s + parseNum(it.qty), 0))))} বস্তা
                  </Text>
                </View>
              )}
              <Text style={{ fontSize: 15, fontWeight: '800', color: '#0F172A' }}>
                মোট মূল্য: <Text style={{ color: totalProductValue < 0 ? '#DC2626' : '#1c70b9', fontWeight: '900' }}>
                  {totalProductValue < 0 ? '-' : ''}৳{toBnDigits(String(Math.abs(Math.round(totalProductValue))))}
                </Text>
              </Text>
            </View>
          </View>
          {isSale && belowCostLoss > 0 ? (
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 8, paddingVertical: 9, paddingHorizontal: 14, marginTop: 8 }}>
              <Text style={{ fontSize: 13, color: '#B91C1C', fontWeight: '800' }}>{tx('ক্রয়দরের নিচে বিক্রির লোকসান:', 'Loss on below-cost items:')}</Text>
              <Text style={{ fontSize: 15, color: '#DC2626', fontWeight: '900' }}>-৳{toBnDigits(String(Math.round(belowCostLoss)))}</Text>
            </View>
          ) : null}

        </View>

        {/* ACTION BUTTONS: Confirm (Most Left) -> Draft -> Cancel (Right) */}
        <View style={styles.footerRow}>
          <TouchableOpacity
            ref={confirmBtnRef}
            onPress={handleOpenConfirm}
            testID="complete-invoice"
            style={[
              styles.completeButton3D,
              focusedField === 'completeButton' && styles.buttonFocusedGlow,
            ]}
            onFocus={() => setFocusedField('completeButton')}
            onBlur={() => setFocusedField('')}
            onKeyDown={(e: any) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault?.();
                handleOpenConfirm();
              }
            }}
            focusable={true}
            {...(Platform.OS === 'web' ? { tabIndex: 0 } as any : {})}
            accessibilityLabel={editId ? tx('পরিবর্তন নিশ্চিত করুন', 'Confirm changes') : isSale ? tx('বিক্রয় নিশ্চিত করুন', 'Confirm sale') : tx('ক্রয় নিশ্চিত করুন', 'Confirm purchase')}
          >
            <AppIcon name={isSale ? icons.sale : icons.purchase} size={22} iconColor="#fff" />
            <Text style={styles.completeButton3DText}>
              {editId ? tx('পরিবর্তন নিশ্চিত করুন', 'Confirm changes') : isSale ? tx('বিক্রয় নিশ্চিত করুন', 'Confirm sale') : tx('ক্রয় নিশ্চিত করুন', 'Confirm purchase')}
            </Text>
          </TouchableOpacity>

          <View style={styles.footerRightButtons}>
            <TouchableOpacity
              onPress={handleSaveDraft}
              style={styles.draftButton3D}
                accessibilityLabel={tx('ড্রাফট সংরক্ষণ (Ctrl+D)', 'Save draft (Ctrl+D)')}
            >
              <AppIcon name={icons.draft} size={18} iconColor="#1c70b9" />
                <Text style={styles.draftButton3DText}>{tx('ড্রাফট সংরক্ষণ', 'Save draft')}</Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={onDone}
              style={styles.cancelButton3D}
                accessibilityLabel={tx('বাতিল করুন (Esc)', 'Cancel (Esc)')}
            >
              <AppIcon name={icons.cancel} size={18} iconColor="#4B627E" />
                <Text style={styles.cancelButton3DText}>{tx('বাতিল করুন', 'Cancel')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </ScrollView>

      {/* SPLIT CONFIRMATION REVIEW MODAL */}
      <Modal
        visible={reviewSplitOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setReviewSplitOpen(false)}
        onDismiss={focusCustomerInput}
      >
        <View style={styles.modalOverlay}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={lang === 'bn' ? 'ডায়ালগ বন্ধ করুন' : 'Close dialog'}
            onPress={() => setReviewSplitOpen(false)}
            style={StyleSheet.absoluteFillObject}
          />
          <View
            style={[styles.shortcutModalBox, { maxWidth: 1280, width: '98%', maxHeight: '96%', minHeight: '82%' }]}
          >
            {/* Modal Header */}
            <View style={styles.modalHeader3D}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <AppIcon name={isSale ? icons.sale : icons.purchase} size={24} iconColor="#fff" />
                <Text style={styles.modalTitle}>
                  {editId ? tx('ইনভয়েস পরিবর্তন ও পেমেন্ট পর্যালোচনা', 'Review invoice changes and payment') : isSale ? tx('বিক্রয় নিশ্চিতকরণ ও বিবরণ পর্যালোচনা', 'Review and confirm sale') : tx('ক্রয় নিশ্চিতকরণ ও বিবরণ পর্যালোচনা', 'Review and confirm purchase')}
                </Text>
              </View>
              <TouchableOpacity
                onPress={() => setReviewSplitOpen(false)}
                style={{ padding: 6 }}
              accessibilityLabel={tx('বন্ধ করুন', 'Close')}
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
              <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F1E36' }}>{tx('পণ্যের তালিকা ও দর', 'Products and rates')}</Text>
                  </View>

                  {items.filter(it => it.name.trim()).map((it, idx) => {
                    const q = parseNum(it.qty) || 0;
                    const r = parseNum(it.rate) || 0;
                    const pr = parseNum(it.purchaseRate) || 0;
                    const rowTotal = Math.round(q * r);
                    const prod = products.find(p => p.id === it.productId || p.name === it.name);
                    const bagKg = prod ? kgPerUnit(prod, it.unit || 'medium') : ((it.unit || 'medium') === 'kg' ? 1 : 50);
                    const isRet = q < 0;

                    return (
                      <View
                        key={it.id || idx}
                        style={{
                          backgroundColor: isRet ? '#FFF5F5' : '#F8FAFC',
                          borderRadius: 10,
                          padding: 12,
                          marginBottom: 8,
                          borderWidth: 1.5,
                          borderColor: isRet ? '#FECACA' : '#E2E8F0',
                        }}
                      >
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 }}>
                            <Text style={{ fontSize: 16, fontWeight: '700', color: '#1E293B' }}>{it.name}</Text>
                            {isRet && (
                              <View style={{ backgroundColor: '#FEE2E2', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, borderWidth: 1, borderColor: '#FCA5A5' }}>
                                <Text style={{ fontSize: 11, fontWeight: '800', color: '#DC2626' }}>{isSale ? tx('বিক্রয় ফেরত', 'Sales return') : tx('ক্রয় ফেরত', 'Purchase return')}</Text>
                              </View>
                            )}
                          </View>
                          <Text style={{ fontSize: 16, fontWeight: '800', color: isRet ? '#DC2626' : '#1c70b9' }}>
                            {rowTotal !== 0 ? `${rowTotal < 0 ? '-' : ''}৳${toBnDigits(String(Math.abs(rowTotal)))}` : '০'}
                          </Text>
                        </View>

                        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 4 }}>

                          <Text style={{ fontSize: 13, color: '#475569' }}>
                            পরিমাণ: <Text style={{ fontWeight: '700', color: isRet ? '#DC2626' : undefined }}>
                              {q < 0 ? '-' : ''}{lang === 'bn' ? toBnDigits(String(Math.abs(q))) : Math.abs(q)} {tx('বস্তা', 'bags')} ({q < 0 ? '-' : ''}{lang === 'bn' ? toBnDigits(String(Math.abs(Math.round(q * bagKg)))) : Math.abs(Math.round(q * bagKg))} {tx('কেজি', 'kg')})
                            </Text>
                          </Text>
                          <Text style={{ fontSize: 13, color: '#475569' }}>
                            {tx('দর:', 'Rate:')} <Text style={{ fontWeight: '700' }}>৳{lang === 'bn' ? toBnDigits(String(r)) : r}</Text>
                          </Text>
                          {!isSale && parseNum(it.otherCost) > 0 ? (
                            <Text style={{ fontSize: 13, color: '#047857' }}>
                              {tx('অন্যান্য খরচ:', 'Other cost:')} <Text style={{ fontWeight: '700' }}>৳{lang === 'bn' ? toBnDigits(String(parseNum(it.otherCost))) : parseNum(it.otherCost)}/{tx('বস্তা', 'bag')}</Text> ({tx('মোট:', 'Total:')} ৳{lang === 'bn' ? toBnDigits(String(Math.abs(q) * parseNum(it.otherCost))) : Math.abs(q) * parseNum(it.otherCost)})
                            </Text>
                          ) : null}
                          {isSale && pr > 0 ? (
                            <Text style={{ fontSize: 13, color: '#B45309' }}>
                              {tx('ক্রয় খরচ:', 'Cost:')} <Text style={{ fontWeight: '700' }}>৳{lang === 'bn' ? toBnDigits(String(pr)) : pr}</Text>
                            </Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}

                  <View style={{ marginTop: 8, paddingTop: 10, borderTopWidth: 1.5, borderTopColor: '#E2E8F0', flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: '#334155' }}>{tx('মোট পণ্যের মূল্য:', 'Total product value:')}</Text>
                    <Text style={{ fontSize: 17, fontWeight: '800', color: totalProductValue < 0 ? '#DC2626' : '#0F172A' }}>
                      {totalProductValue < 0 ? '-' : ''}৳{toBnDigits(String(Math.abs(Math.round(totalProductValue))))}
                    </Text>
                  </View>

                  {!isSale && totalOtherCost > 0 ? (
                    <View style={{ marginTop: 4, flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#FEF3C7', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 }}>
                      <Text style={{ fontSize: 13, color: '#92400E', fontWeight: '700' }}>
                        {tx('মোট বস্তা প্রতি খরচ (খরচ খাতায় যাবে):', 'Total cost per bag (recorded as expense):')}
                      </Text>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: '#92400E' }}>
                        ৳{toBnDigits(String(Math.round(totalOtherCost)))}
                      </Text>
                    </View>
                  ) : null}

                  {isSale ? (
                    <View style={{ marginTop: 4, flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 14, color: '#475569' }}>{tx('মোট আনুমানিক ক্রয় খরচ:', 'Estimated total purchase cost:')}</Text>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#B45309' }}>৳{toBnDigits(String(Math.round(totalEstimatedCost)))}</Text>
                    </View>
                  ) : null}

                  {isSale ? (
                    <View style={{ marginTop: 4, flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ fontSize: 14, color: estimatedProfit >= 0 ? '#475569' : '#DC2626', fontWeight: estimatedProfit < 0 ? '800' : '400' }}>
                        {estimatedProfit >= 0 ? tx('প্রত্যাশিত লাভ:', 'Expected profit:') : tx('প্রত্যাশিত লোকসান:', 'Expected loss:')}
                      </Text>
                      <Text style={{ fontSize: 15, fontWeight: '800', color: estimatedProfit >= 0 ? '#15803D' : '#DC2626' }}>
                        {estimatedProfit >= 0 ? '+' : '-'}৳{toBnDigits(String(Math.abs(Math.round(estimatedProfit))))}
                      </Text>
                    </View>
                  ) : null}

                </View>

                {/* RIGHT SIDE: Total Invoice Value, Cash, Bank, Discount, Invoice Due, Previous Due, Line, Total Due */}
                <View style={{ flex: 1, backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14, borderWidth: 1.5, borderColor: '#CBD5E1', justifyContent: 'space-between' }}>
                  <View>
                    {/* Header: Party & Memo Info */}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10, borderBottomWidth: 1.5, borderBottomColor: '#E2E8F0', paddingBottom: 8 }}>
                      <AppIcon name={icons.accounts} size={20} iconColor="#1c70b9" />
                    <Text style={{ fontSize: 16, fontWeight: '700', color: '#0F1E36' }}>{tx('পেমেন্ট ও হিসাব বিবরণ', 'Payment details')}</Text>
                    </View>

                    <View style={{ gap: 4, marginBottom: 10 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: 13, color: '#64748B' }}>{isSale ? 'কাস্টমার' : 'সরবরাহকারী'}:</Text>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: '#0F172A' }}>{partyName || tx('ক্যাশ', 'Cash')}</Text>
                      </View>
                      {partyMobile ? (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13, color: '#64748B' }}>{tx('মোবাইল:', 'Mobile:')}</Text>
                          <Text style={{ fontSize: 13, color: '#334155' }}>{localeDigits(partyMobile, lang)}</Text>
                        </View>
                      ) : null}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    <Text style={{ fontSize: 13, color: '#64748B' }}>{tx('তারিখ:', 'Date:')}</Text>
                    <Text style={{ fontSize: 13, fontWeight: '600', color: '#334155' }}>{billDate ? localeDigits(billDate, lang) : tx('আজ', 'Today')}</Text>
                      </View>
                      {memoNo ? (
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                          <Text style={{ fontSize: 13, color: '#64748B' }}>{tx('মেমো নং:', 'Memo no.:')}</Text>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#1c70b9' }}>{localeDigits(memoNo, lang)}</Text>
                        </View>
                      ) : null}
                    </View>

                    {/* 1. TOTAL INVOICE VALUE */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#F8FAFC', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1.5, borderColor: '#E2E8F0', marginBottom: 10 }}>
                      <Text style={{ fontSize: 14, fontWeight: '800', color: '#1E293B' }}>{tx('মোট ইনভয়েস মূল্য:', 'Invoice total:')}</Text>
                      <Text style={{ fontSize: 18, fontWeight: '900', color: '#0F172A' }}>৳{localeDigits(String(Math.round(totalProductValue)), lang)}</Text>
                    </View>

                    {/* Every active cash and bank account gets its own payment amount. */}
                    {paymentAccounts.map((account, index) => {
                      const fieldKey = `modal_payment_${account.id}`;
                      const isCash = account.type === 'cash';
                      const defaultCashAccount = paymentAccounts.find(candidate => candidate.type === 'cash');
                      return <View key={account.id} style={{ marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 }}>
                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569' }}>
                            {isCash
                              ? (isSale ? tx('ক্যাশ গ্রহণ', 'Cash received') : tx('ক্যাশ পরিশোধ', 'Cash paid'))
                              : (isSale ? tx('ব্যাংকে গ্রহণ', 'Bank received') : tx('ব্যাংক পরিশোধ', 'Bank paid'))} · {account.name} (৳)
                          </Text>
                          {isCash && account.id === defaultCashAccount?.id ? <TouchableOpacity
                            onPress={() => {
                              const invoiceAmt = Math.max(0, Math.round(totalProductValue - numTransport - numDiscount));
                              setPaymentAmounts(previous => ({ ...previous, [account.id]: String(invoiceAmt) }));
                            }}
                            style={{ paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4, backgroundColor: '#E0F2FE', borderWidth: 1, borderColor: '#BAE6FD' }}
                          >
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#0369A1' }}>
                          {tx('পরিবহন পেমেন্টের পর নগদ গ্রহণ', 'Cash to receive after transport payment')} (৳{lang === 'bn' ? toBnDigits(String(Math.max(0, Math.round(totalProductValue - numTransport - numDiscount)))) : Math.max(0, Math.round(totalProductValue - numTransport - numDiscount))})
                            </Text>
                          </TouchableOpacity> : null}
                        </View>
                        <TextInput
                          ref={el => (inputRefs.current[fieldKey] = el)}
                          accessibilityLabel={`${isCash ? 'Cash' : 'Bank'} payment amount: ${account.name}`}
                          value={localeDigits(paymentAmounts[account.id] ?? '', lang)}
                          onChangeText={value => setPaymentAmounts(previous => ({ ...previous, [account.id]: toEnDigits(value) }))}
                          keyboardType="numeric"
                          onFocus={(e: any) => {
                            setFocusedField(fieldKey);
                            try { e?.target?.select?.(); } catch {}
                          }}
                          onSubmitEditing={() => inputRefs.current[index + 1 < paymentAccounts.length ? `modal_payment_${paymentAccounts[index + 1].id}` : 'modal_discount']?.focus()}
                          style={{ borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, height: 38, fontSize: 15, backgroundColor: '#FFFFFF', fontWeight: '700', color: '#0F172A' }}
                          returnKeyType="next"
                        />
                      </View>;
                    })}
                    {paymentAccounts.length === 0 ? <Text style={{ color: '#64748B', marginBottom: 8 }}>{tx('সক্রিয় ক্যাশ বা ব্যাংক অ্যাকাউন্ট নেই', 'No active cash or bank accounts')}</Text> : null}

                    {numCash > 0 ? <View style={{ marginBottom: 8 }}>
                      <View
                        testID="modal-due-after-cash"
                        style={{
                          flexDirection: 'row',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginTop: 4,
                          paddingHorizontal: 8,
                          paddingVertical: 4,
                          backgroundColor: totalDue > 0 ? '#FEF2F2' : '#F0FDF4',
                          borderRadius: 6,
                          borderWidth: 1,
                          borderColor: totalDue > 0 ? '#FECACA' : '#BBF7D0',
                        }}
                      >
                        <Text style={{ fontSize: 12, fontWeight: '700', color: totalDue > 0 ? '#991B1B' : '#166534' }}>
                          {isSale ? tx('সব পেমেন্টের পর বাকি:', 'Due after payments:') : tx('ক্যাশ পরিশোধের পর বাকি:', 'Due after cash paid:')}
                        </Text>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: totalDue > 0 ? '#DC2626' : '#15803D' }}>
                          ৳{localeDigits(String(Math.round(totalDue)), lang)}
                          {prevDue > 0 ? ` (${tx('ইনভয়েস বাকি:', 'Invoice due:')} ৳${lang === 'bn' ? toBnDigits(String(Math.round(invoiceDue))) : Math.round(invoiceDue)})` : ''}
                          {prevDue + netInvoiceBalance < 0 ? ` (${tx('ফেরত:', 'Refund:')} ৳${lang === 'bn' ? toBnDigits(String(Math.round(Math.abs(prevDue + netInvoiceBalance)))) : Math.round(Math.abs(prevDue + netInvoiceBalance))})` : ''}
                        </Text>
                      </View>
                    </View> : null}
                    <Field label={tx('পেমেন্টের নোট', 'Payment note')} value={paymentNote} onChange={setPaymentNote} />

                    {/* 4. DISCOUNT */}
                    <View style={{ marginBottom: 10 }}>
                      <Text style={{ fontSize: 13, fontWeight: '700', color: '#475569', marginBottom: 3 }}>{tx('ছাড় / ডিসকাউন্ট (৳):', 'Discount (৳):')}</Text>
                      <TextInput
                        ref={el => (inputRefs.current['modal_discount'] = el)}
                        accessibilityLabel="Discount"
                        value={discount}
                        onChangeText={setDiscount}
                        keyboardType="numeric"
                        onSubmitEditing={() => isSale ? inputRefs.current['modal_transportCost']?.focus() : executeTransaction()}
                        style={{ borderWidth: 1.5, borderColor: '#CBD5E1', borderRadius: 8, paddingHorizontal: 10, height: 38, fontSize: 15, backgroundColor: '#FFFFFF', fontWeight: '700', color: '#B45309' }}
                        returnKeyType="done"
                      />
                    </View>

                    {/* Optional Transport Cost */}
                    {!isSale && totalOtherCost > 0 ? (
                      <AccountPicker accountId={expenseAccountId} onPick={setExpenseAccountId} label="Account for purchase costs" required />
                    ) : null}
                    {isSale ? <View style={{ marginBottom: 8, padding: 8, backgroundColor: '#F8FAFC', borderRadius: 8, borderWidth: 1, borderColor: '#E2E8F0' }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#64748B', marginBottom: 4 }}>{tx('পরিবহন বাবদ পেমেন্ট (ঐচ্ছিক)', 'Transport payment (optional)')}</Text>
                      <TextInput
                        ref={el => (inputRefs.current['modal_transportCost'] = el)}
                        accessibilityLabel={tx('পরিবহন বাবদ পেমেন্ট', 'Transport payment')}
                        value={transportCost}
                        onChangeText={setTransportCost}
                        keyboardType="numeric"
                        onSubmitEditing={() => executeTransaction()}
                        returnKeyType="next"
                        style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 6, paddingHorizontal: 8, height: 36, fontSize: 14, backgroundColor: '#FFFFFF', fontWeight: '700' }}
                        placeholder="০"
                      />
                      {numTransport > 0 && (
                        <Text style={{ fontSize: 11, color: '#1c70b9', marginTop: 3, fontWeight: '600' }}>
                          {tx('গ্রাহক সরাসরি পরিবহন বাবদ দিয়েছেন:', 'Paid directly by customer for transport:')} ৳{lang === 'bn' ? toBnDigits(String(numTransport)) : numTransport}
                        </Text>
                      )}
                      <Field
                        label={tx('যে ক্রয় ইনভয়েসের বিপরীতে সমন্বয় হবে', 'Purchase invoice to settle against')}
                        value={transportPurchaseInvoiceNo}
                        onChange={setTransportPurchaseInvoiceNo}
                        accessibilityLabel={tx('ক্রয় ইনভয়েস নম্বর', 'Purchase invoice number')}
                        returnKeyType="done"
                        onSubmitEditing={() => executeTransaction()}
                        onFocus={() => setTransportPurchaseFocused(true)}
                      />
                      {transportPurchaseFocused ? (() => {
                        const query = transportPurchaseInvoiceNo.trim().toLocaleLowerCase();
                        const suggestions = [...purchases]
                          .filter(p => !query || (p.invoiceNo ?? '').toLocaleLowerCase().startsWith(query))
                          .sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
                          .slice(0, 8);
                        return suggestions.length ? <ScrollView keyboardShouldPersistTaps="handled" style={{ maxHeight: 180, marginTop: -6, marginBottom: 6, borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 7, backgroundColor: '#FFFFFF' }}>
                          {suggestions.map(p => {
                            const supplier = vendors.find(v => v.id === p.vendorId);
                            return <TouchableOpacity key={p.id} onPress={() => { setTransportPurchaseInvoiceNo(p.invoiceNo ?? ''); setTransportPurchaseFocused(false); }} style={{ paddingHorizontal: 9, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#E2E8F0' }}>
                              <Text style={{ fontSize: 12, fontWeight: '700', color: '#0F2B48' }}>{p.invoiceNo ?? '—'} · {supplier?.code ? `${tx('কোড', 'Code')}: ${supplier.code} · ` : ''}{supplier?.name ?? tx('সরবরাহকারী অজানা', 'Supplier unavailable')}</Text>
                              <Text style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{p.date ?? ''} · {tx('বকেয়া', 'Due')}: ৳{localeDigits(String(p.due), lang)}</Text>
                            </TouchableOpacity>;
                          })}
                        </ScrollView> : null;
                      })() : null}
                      {transportPurchaseInvoiceNo.trim() ? (() => {
                        const contraPurchase = purchases.find(p => p.invoiceNo?.trim().toLocaleLowerCase() === transportPurchaseInvoiceNo.trim().toLocaleLowerCase());
                        const supplier = contraPurchase ? vendors.find(v => v.id === contraPurchase.vendorId) : undefined;
                        return <Text style={{ fontSize: 11, color: contraPurchase && contraPurchase.due >= numTransport ? '#15803D' : '#B91C1C', marginTop: 2 }}>
                          {contraPurchase
                            ? `${supplier?.code ? `${tx('কোড', 'Code')}: ${supplier.code} · ` : ''}${supplier?.name ?? tx('সরবরাহকারী অজানা', 'Supplier unavailable')} · ${tx('বকেয়া', 'Due')}: ৳${localeDigits(String(contraPurchase.due), lang)}`
                            : tx('ক্রয় ইনভয়েস পাওয়া যায়নি', 'Purchase invoice not found')}
                        </Text>;
                      })() : <Text style={{ fontSize: 11, color: '#64748B', marginTop: 2 }}>{tx('ঐচ্ছিক: এখানে নম্বর দিলে কাস্টমারের পাওনা ও সরবরাহকারীর দেনা সমন্বয় হবে।', 'Optional: entering an invoice number offsets the customer receivable against that supplier payable.')}</Text>}
                    </View> : null}

                    {!isSale && totalOtherCost > 0 && (
                      <View style={{ marginBottom: 8, padding: 8, backgroundColor: '#FEF3C7', borderRadius: 8, borderWidth: 1, borderColor: '#FDE68A' }}>
                        <Text style={{ fontSize: 12, fontWeight: '700', color: '#92400E', marginBottom: 2 }}>
                          {tx('ক্রয় খরচ (প্রতি বস্তা)', 'Purchase cost (per bag)')}
                        </Text>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: '#B45309' }}>
                          {tx('মোট খরচ:', 'Total cost:')} ৳{lang === 'bn' ? toBnDigits(String(Math.round(totalOtherCost))) : Math.round(totalOtherCost)} ({tx('খরচ খাতায় স্বয়ংক্রিয় যুক্ত হবে', 'added to expenses automatically')})
                        </Text>
                      </View>
                    )}

                    {/* 5. TOTAL INVOICE DUE */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#475569' }}>
                        {numTransport > 0
                          ? `${tx('পরিবহন পেমেন্ট বাদে ইনভয়েস বাকি', 'Invoice due after transport payment')} ৳${lang === 'bn' ? toBnDigits(String(Math.round(numTransport))) : Math.round(numTransport)}:`
                          : tx('মোট ইনভয়েস বাকি:', 'Invoice due:')}
                      </Text>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: '#B45309' }}>৳{toBnDigits(String(Math.round(invoiceDue)))}</Text>
                    </View>

                    {/* 6. Prior due or available party advance */}
                    {prevDue < 0 ? <View style={{ padding: 9, backgroundColor: '#ECFDF5', borderRadius: 8, borderWidth: 1, borderColor: '#A7F3D0', marginVertical: 5 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: '#047857' }}>{tx('আগের অগ্রিম জমা:', 'Available party advance:')}</Text>
                        <Text style={{ fontSize: 14, fontWeight: '800', color: '#047857' }}>৳{toBnDigits(String(Math.round(Math.abs(prevDue))))}</Text>
                      </View>
                      <Text style={{ fontSize: 11, color: '#047857', marginBottom: 4 }}>{tx('ইনভয়েসে অগ্রিম সমন্বয় করতে বাটনে চাপ দিন।', 'Press the button to apply advance to this invoice.')}</Text>
                      <TouchableOpacity
                        onPress={() => setAdvanceToApply(current => current > 0 ? 0 : Math.min(Math.abs(prevDue), invoiceDue))}
                        disabled={invoiceDue <= 0}
                        style={{ backgroundColor: selectedAdvance > 0 ? '#047857' : '#059669', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 7, alignSelf: 'flex-start', marginVertical: 4, opacity: invoiceDue <= 0 ? 0.5 : 1 }}
                      >
                        <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '800' }}>{selectedAdvance > 0 ? tx('অগ্রিম সমন্বয় বাতিল', 'Remove advance adjustment') : tx('অগ্রিম সমন্বয় করুন', 'Apply advance')}</Text>
                      </TouchableOpacity>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 3 }}>
                        <Text style={{ fontSize: 12, fontWeight: '600', color: '#047857' }}>{tx('এই ইনভয়েসে সমন্বয়:', 'Applied to this invoice:')}</Text>
                        <Text style={{ fontSize: 13, fontWeight: '800', color: '#047857' }}>৳{toBnDigits(String(Math.round(selectedAdvance)))}</Text>
                      </View>
                    </View> : <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 }}>
                      <Text style={{ fontSize: 14, fontWeight: '700', color: '#64748B' }}>{tx('পূর্বের মোট বাকি:', 'Previous balance due:')}</Text>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: '#DC2626' }}>৳{toBnDigits(String(Math.round(prevDue)))}</Text>
                    </View>}

                    {/* 7. A CLEAR SEPARATOR LINE */}
                    <View style={{ height: 2, backgroundColor: '#94A3B8', marginVertical: 8 }} />

                    {/* 8. TOTAL DUE */}
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#EFF6FF', paddingVertical: 10, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#93C5FD', marginBottom: 12 }}>
                      <Text style={{ fontSize: 16, fontWeight: '800', color: '#1E3A8A' }}>{tx('সর্বমোট বাকি:', 'Total due:')}</Text>
                      <Text style={{ fontSize: 22, fontWeight: '900', color: '#1E3A8A' }}>৳{toBnDigits(String(Math.round(totalDue)))}</Text>
                    </View>

                    {/* TWO ACTION BUTTONS: Confirm on Top, then Confirm & Print */}
                    <View style={{ gap: 10, marginTop: 4 }}>
                      <TouchableOpacity
                        onPress={() => executeTransaction(null)}
                        testID="execute-invoice"
                        disabled={submitting}
                        style={{
                          backgroundColor: '#1c70b9',
                          borderRadius: 12,
                          minHeight: 46,
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexDirection: 'row',
                          gap: 8,
                          borderBottomWidth: 3,
                          borderBottomColor: '#0a3359',
                          cursor: 'pointer' as any,
                        }}
                      >
                        <AppIcon name={icons.done} size={20} iconColor="#FFFFFF" />
                        <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>
                          {submitting ? 'প্রক্রিয়াধীন...' : 'নিশ্চিত করুন'}
                        </Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        onPress={() => {
                          const w = typeof window !== 'undefined' ? window.open('', '_blank') : null;
                          executeTransaction(w);
                        }}
                        testID="execute-print-invoice"
                        disabled={submitting}
                        style={{
                          backgroundColor: '#16A34A',
                          borderRadius: 12,
                          minHeight: 44,
                          alignItems: 'center',
                          justifyContent: 'center',
                          flexDirection: 'row',
                          gap: 8,
                          borderBottomWidth: 3,
                          borderBottomColor: '#15803D',
                          cursor: 'pointer' as any,
                        }}
                      >
                        <AppIcon name={icons.print} size={18} iconColor="#FFFFFF" />
                        <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '800' }}>
                          {submitting ? 'প্রক্রিয়াধীন...' : 'নিশ্চিত ও প্রিন্ট করুন'}
                        </Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                </View>

              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>



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
                <Text style={styles.modalTitle}>{tx('কীবোর্ড শর্টকাট সহায়িকা', 'Keyboard shortcuts')}</Text>
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
                <Text style={styles.shortcutDesc}>{tx('পরবর্তী ঘরে যান / ড্রপডাউন থেকে নির্বাচন', 'Go to the next field or choose from a dropdown')}</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>Shift + Enter</Text></View>
                <Text style={styles.shortcutDesc}>{tx('পূর্ববর্তী ঘরে ফেরত যান', 'Go to the previous field')}</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>Alt + A / Insert</Text></View>
                <Text style={styles.shortcutDesc}>{tx('নতুন পণ্যের সারি যোগ করুন', 'Add a product row')}</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>Ctrl + S / F8</Text></View>
                <Text style={styles.shortcutDesc}>{tx('ক্রয় সম্পন্ন করুন ও সেভ করুন', 'Complete and save the purchase')}</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>Ctrl + D / F9</Text></View>
                <Text style={styles.shortcutDesc}>{tx('ড্রাফট সংরক্ষণ করুন', 'Save draft')}</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>↑ / ↓</Text></View>
                <Text style={styles.shortcutDesc}>{tx('পণ্য ও সরবরাহকারীর সাজেশনে চলাচল করুন', 'Navigate product and vendor suggestions')}</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>Esc</Text></View>
                <Text style={styles.shortcutDesc}>{tx('ড্রপডাউন বা ডায়লগ বন্ধ করুন / বাতিল করুন', 'Close the dropdown or dialog / cancel')}</Text>
              </View>

              <View style={styles.shortcutItem}>
                <View style={styles.keyBadge}><Text style={styles.keyBadgeText}>F1</Text></View>
                <Text style={styles.shortcutDesc}>{tx('শর্টকাট সহায়িকা খুলুন বা বন্ধ করুন', 'Show or hide keyboard shortcuts')}</Text>
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
    zIndex: 999999,
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
      position: 'fixed' as any,
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
  productDropdownMenu: {
    top: 44,
    width: 440,
    maxWidth: Platform.OS === 'web' ? 'min(560px, calc(100vw - 32px))' as any : 440,
  },
  dropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 14,
    minHeight: 60,
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
    flexShrink: 1,
    minWidth: 0,
  },
  tableDataRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 8,
    marginVertical: 2,
  },
  td: {
    paddingHorizontal: 4,
    flexShrink: 1,
    minWidth: 0,
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
    height: 40,
    ...(Platform.OS === 'web' ? {
      boxShadow: 'inset 0 1px 3px rgba(28, 112, 185, 0.05)',
    } as any : {}),
  },
  tableTextInputNoBorder: {
    flex: 1,
    height: 38,
    fontSize: 14,
    fontWeight: '700',
    color: '#0F1E36',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  tableTextInput: {
    borderWidth: 1.5,
    borderColor: '#CCE0F2',
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    height: 40,
    paddingHorizontal: 8,
    fontSize: 14,
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
    height: 40,
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
    paddingHorizontal: 8,
    paddingVertical: 4,
    minHeight: 40,
    justifyContent: 'center',
    overflow: 'hidden',
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
  footerRightButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
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
  buttonFocusedGlow: {
    borderWidth: 2,
    borderColor: '#38BDF8',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 0 0 4px rgba(56, 189, 248, 0.45), 0 8px 22px rgba(28, 112, 185, 0.5)',
      outline: 'none',
    } as any : {}),
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
    zIndex: 99999,
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


