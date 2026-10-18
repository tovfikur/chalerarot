import React, { useState, useEffect, useRef, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Alert, Platform } from 'react-native';
import { useApp, Product, Party } from '../store';
import { color, useMoney, useNum, toBnDigits } from '../ui';
import { AppIcon, icons } from '../icons';

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

export function TradeDashboardForm({ mode, onDone }: TradeDashboardFormProps) {
  const isSale = mode === 'sale';
  const { t, products, vendors, customers, bal, purchase, sale, moneyAccounts, saveExpense } = useApp();
  const m = useMoney();
  const n = useNum();

  // Parties list
  const parties: Party[] = isSale ? customers : vendors;

  // Auto-generated order no & memo no (with serial persistence)
  const defaultOrderNo = useMemo(() => {
    return String(Math.floor(100 + Math.random() * 900));
  }, []);

  const [orderNo, setOrderNo] = useState(defaultOrderNo);
  const [memoNo, setMemoNo] = useState('90876');

  // Party selection
  const [selectedPartyId, setSelectedPartyId] = useState<string>('');
  const [partyCode, setPartyCode] = useState('');
  const [partyName, setPartyName] = useState('');
  const [partyMobile, setPartyMobile] = useState('');
  const [partyAddress, setPartyAddress] = useState('');
  const [partyDropdownOpen, setPartyDropdownOpen] = useState(false);

  // Dates
  const todayStr = useMemo(() => {
    const d = new Date();
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const yyyy = d.getFullYear();
    return `${dd}/${mm}/${yyyy}`;
  }, []);

  const [billDate, setBillDate] = useState(todayStr);
  const [dueDate, setDueDate] = useState(todayStr);

  // Items table
  const [items, setItems] = useState<FormItemLine[]>([
    { id: '1', code: '', productId: '', name: '', qty: '', rate: '' },
  ]);
  const [activeItemDropdownIdx, setActiveItemDropdownIdx] = useState<number | null>(null);

  // Additional costs (per video: transport + landing only)
  const [transportCost, setTransportCost] = useState('0');
  const [landingCost, setLandingCost] = useState('0');

  // Payments
  const [cashPaid, setCashPaid] = useState('0');
  const [bankPaid, setBankPaid] = useState('0');

  // Active product code generator/mapper
  const getProductCode = (p: Product, idx: number) => {
    // Generate a clean 3-digit code like 300, 301, 302...
    return String(300 + idx);
  };

  // Sync selected party
  const onSelectParty = (p: Party, idx: number) => {
    setSelectedPartyId(p.id);
    setPartyCode(String(340 + idx));
    setPartyName(p.name);
    setPartyMobile(p.mobile || '');
    setPartyAddress(p.address || '');
    setPartyDropdownOpen(false);
  };

  // Previous balance for selected party
  const prevDue = useMemo(() => {
    if (!selectedPartyId) return 0;
    const b = bal(isSale ? 'c' : 'v', selectedPartyId);
    return Math.max(0, b.balance);
  }, [selectedPartyId, bal, isSale]);

  // Handle product selection in table
  const onSelectProduct = (rowIdx: number, p: Product, pIdx: number) => {
    setItems(prev => {
      const copy = [...prev];
      copy[rowIdx] = {
        ...copy[rowIdx],
        code: getProductCode(p, pIdx),
        productId: p.id,
        name: p.name,
        qty: copy[rowIdx].qty || '1',
        rate: String(isSale ? p.price : p.cost),
      };
      return copy;
    });
    setActiveItemDropdownIdx(null);
  };

  // Add new row
  const addNewRow = () => {
    setItems(prev => [
      ...prev,
      { id: String(Date.now() + Math.random()), code: '', productId: '', name: '', qty: '', rate: '' },
    ]);
  };

  // Remove row
  const removeRow = (idx: number) => {
    if (items.length <= 1) {
      setItems([{ id: '1', code: '', productId: '', name: '', qty: '', rate: '' }]);
      return;
    }
    setItems(prev => prev.filter((_, i) => i !== idx));
  };

  // Calculations
  const totalProductValue = useMemo(() => {
    return items.reduce((sum, item) => {
      const q = parseFloat(item.qty) || 0;
      const r = parseFloat(item.rate) || 0;
      return sum + q * r;
    }, 0);
  }, [items]);

  const numTransport = parseFloat(transportCost) || 0;
  const numLanding = parseFloat(landingCost) || 0;
  const numCash = parseFloat(cashPaid) || 0;
  const numBank = parseFloat(bankPaid) || 0;

  // Grand total calculation:
  // (Total product value + Transport + Landing + Previous due) - (Cash Paid + Bank Paid)
  const grandTotal = useMemo(() => {
    const net = (totalProductValue + numTransport + numLanding + prevDue) - (numCash + numBank);
    return Math.max(0, net);
  }, [totalProductValue, numTransport, numLanding, prevDue, numCash, numBank]);

  // References for inputs to support keyboard navigation
  const inputRefs = useRef<Record<string, TextInput | null>>({});

  // Submission handler
  const handleComplete = async () => {
    const validLines = items.filter(it => it.productId && (parseFloat(it.qty) || 0) > 0);
    if (!validLines.length) {
      Alert.alert(t('invalid'), 'অনুগ্রহ করে অন্তত একটি পণ্য যোগ করুন এবং পরিমাণ দিন।');
      return;
    }

    if (!isSale && !selectedPartyId) {
      Alert.alert(t('invalid'), 'অনুগ্রহ করে সরবরাহকারী নির্বাচন করুন।');
      return;
    }

    // Resolve cash or bank accounts from store
    const cashAcc = moneyAccounts.find(a => a.type === 'cash') || moneyAccounts[0];
    const bankAcc = moneyAccounts.find(a => a.type === 'bank') || moneyAccounts[0];

    const totalPaid = numCash + numBank;
    const chosenAccountId = numBank > 0 ? bankAcc?.id : cashAcc?.id;

    try {
      if (isSale) {
        await sale({
          customerId: selectedPartyId || undefined,
          lines: validLines.map(l => ({
            productId: l.productId,
            unit: 'kg',
            enteredQty: parseFloat(l.qty) || 0,
            rate: parseFloat(l.rate) || 0,
          })),
          discount: 0,
          paid: totalPaid,
          accountId: chosenAccountId,
          next: dueDate !== billDate ? dueDate.split('/').reverse().join('-') : undefined,
        });
      } else {
        await purchase({
          vendorId: selectedPartyId,
          lines: validLines.map(l => ({
            productId: l.productId,
            unit: 'kg',
            enteredQty: parseFloat(l.qty) || 0,
            rate: parseFloat(l.rate) || 0,
          })),
          paid: totalPaid,
          accountId: chosenAccountId,
          next: dueDate !== billDate ? dueDate.split('/').reverse().join('-') : undefined,
        });
      }

      // Record additional transport / landing expenses if entered
      const todayISO = new Date().toISOString().slice(0, 10);
      if (numTransport > 0 && chosenAccountId) {
        await saveExpense({
          category: 'transport',
          customName: 'পরিবহন খরচ',
          amount: numTransport,
          accountId: chosenAccountId,
          date: todayISO,
          note: `${isSale ? 'বিক্রয়' : 'ক্রয়'} অর্ডার #${orderNo} পরিবহন খরচ`,
        }).catch(() => {});
      }
      if (numLanding > 0 && chosenAccountId) {
        await saveExpense({
          category: 'loading',
          customName: 'ল্যান্ডিং খরচ',
          amount: numLanding,
          accountId: chosenAccountId,
          date: todayISO,
          note: `${isSale ? 'বিক্রয়' : 'ক্রয়'} অর্ডার #${orderNo} ল্যান্ডিং খরচ`,
        }).catch(() => {});
      }

      // Increment memo number for next order
      const parsedMemo = parseInt(memoNo, 10);
      if (!isNaN(parsedMemo)) {
        setMemoNo(String(parsedMemo + 1));
      }

      Alert.alert(t('done'), isSale ? 'বিক্রয় সফলভাবে সম্পন্ন হয়েছে।' : 'ক্রয় সফলভাবে সম্পন্ন হয়েছে।', [
        { text: 'ঠিক আছে', onPress: onDone },
      ]);
    } catch (err) {
      Alert.alert(t('invalid'), err instanceof Error ? err.message : 'লেনদেন সম্পন্ন করা সম্ভব হয়নি।');
    }
  };

  const copyToClipboard = (text: string) => {
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(text);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer} keyboardShouldPersistTaps="handled">
      {/* Top Header Card */}
      <View style={styles.headerBar}>
        <View style={styles.headerLeft}>
          <TouchableOpacity onPress={onDone} style={styles.backButton}>
            <AppIcon name={icons.back} size={22} iconColor="#fff" />
          </TouchableOpacity>
          <View style={styles.headerTitleRow}>
            <AppIcon name={isSale ? icons.sale : icons.purchase} size={24} iconColor="#fff" />
            <Text style={styles.headerTitle}>{isSale ? 'নতুন বিক্রয়' : 'নতুন ক্রয়'}</Text>
          </View>
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

      {/* Row 1: Information and Dates (2 Columns) */}
      <View style={styles.twoColRow}>
        {/* Left Column: Purchase / Sale Info */}
        <View style={[styles.card, styles.colLeft]}>
          <Text style={styles.cardHeaderTitle}>{isSale ? 'বিক্রয়ের তথ্য' : 'ক্রয়ের তথ্য'}</Text>

          {/* Order No & Memo No */}
          <View style={styles.formRow}>
            <View style={styles.formCol}>
              <Text style={styles.fieldLabel}>{isSale ? 'বিক্রয় অর্ডার নং' : 'ক্রয় অর্ডার নং'}</Text>
              <View style={styles.inputWithIcon}>
                <TextInput
                  value={orderNo}
                  onChangeText={setOrderNo}
                  style={styles.textInput}
                  placeholder="303"
                />
                <TouchableOpacity onPress={() => copyToClipboard(orderNo)} style={styles.inputInnerIcon}>
                  <AppIcon name={icons.copy} size={18} iconColor="#64748B" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.formCol}>
              <Text style={styles.fieldLabel}>{isSale ? 'বিক্রয় মেমো নং' : 'ক্রয় মেমো নং'}</Text>
              <View style={styles.inputWithIcon}>
                <TextInput
                  value={memoNo}
                  onChangeText={setMemoNo}
                  style={styles.textInput}
                  placeholder="90876"
                  keyboardType="numeric"
                />
                <TouchableOpacity onPress={() => copyToClipboard(memoNo)} style={styles.inputInnerIcon}>
                  <AppIcon name={icons.copy} size={18} iconColor="#64748B" />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* Party Code */}
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>{isSale ? 'কাস্টমার কোড' : 'সরবরাহকারী কোড'}</Text>
            <View style={styles.inputWithIcon}>
              <TextInput
                value={partyCode}
                onChangeText={setPartyCode}
                style={styles.textInput}
                placeholder="345"
              />
              <TouchableOpacity onPress={() => setPartyDropdownOpen(prev => !prev)} style={styles.inputInnerIcon}>
                <AppIcon name={icons.search} size={18} iconColor="#64748B" />
              </TouchableOpacity>
            </View>
          </View>

          {/* Party Name with Autocomplete Dropdown */}
          <View style={[styles.formGroup, { position: 'relative', zIndex: 30 }]}>
            <Text style={styles.fieldLabel}>{isSale ? 'কাস্টমারের নাম' : 'সরবরাহকারীর নাম'}</Text>
            <View style={styles.inputWithIcon}>
              <TextInput
                value={partyName}
                onChangeText={v => {
                  setPartyName(v);
                  setPartyDropdownOpen(true);
                }}
                onFocus={() => setPartyDropdownOpen(true)}
                style={styles.textInput}
                placeholder={isSale ? 'করিম ট্রেডার্স' : 'আশরাফ'}
              />
              <TouchableOpacity onPress={() => setPartyDropdownOpen(prev => !prev)} style={styles.inputInnerIcon}>
                <AppIcon name={icons.search} size={18} iconColor="#64748B" />
              </TouchableOpacity>
            </View>

            {partyDropdownOpen && (
              <View style={styles.dropdownMenu}>
                <ScrollView style={{ maxHeight: 180 }} keyboardShouldPersistTaps="handled">
                  {parties
                    .filter(p => !partyName.trim() || p.name.toLowerCase().includes(partyName.toLowerCase()))
                    .map((p, idx) => (
                      <TouchableOpacity
                        key={p.id}
                        onPress={() => onSelectParty(p, idx)}
                        style={styles.dropdownItem}
                      >
                        <Text style={styles.dropdownItemText}>{p.name}</Text>
                        <Text style={styles.dropdownItemSub}>{p.mobile || 'কোন নম্বর নেই'}</Text>
                      </TouchableOpacity>
                    ))}
                </ScrollView>
              </View>
            )}
          </View>

          {/* Mobile */}
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>মোবাইল নম্বর</Text>
            <TextInput
              value={partyMobile}
              onChangeText={setPartyMobile}
              style={styles.textInput}
              placeholder="01712345678"
              keyboardType="phone-pad"
            />
          </View>

          {/* Address */}
          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>ঠিকানা</Text>
            <TextInput
              value={partyAddress}
              onChangeText={setPartyAddress}
              style={[styles.textInput, { height: 60, textAlignVertical: 'top' }]}
              placeholder="ঢাকা"
              multiline
            />
          </View>
        </View>

        {/* Right Column: Dates */}
        <View style={[styles.card, styles.colRight]}>
          <Text style={styles.cardHeaderTitle}>তারিখ</Text>

          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>{isSale ? 'বিক্রয়ের তারিখ' : 'বিলের তারিখ'}</Text>
            <View style={styles.inputWithIcon}>
              <TextInput
                value={billDate}
                onChangeText={setBillDate}
                style={styles.textInput}
                placeholder="20/09/2026"
              />
              <View style={styles.inputInnerIcon}>
                <AppIcon name={icons.calendar} size={18} iconColor="#64748B" />
              </View>
            </View>
          </View>

          <View style={styles.formGroup}>
            <Text style={styles.fieldLabel}>পরিশোধের শেষ তারিখ</Text>
            <View style={styles.inputWithIcon}>
              <TextInput
                value={dueDate}
                onChangeText={setDueDate}
                style={styles.textInput}
                placeholder="20/09/2026"
              />
              <View style={styles.inputInnerIcon}>
                <AppIcon name={icons.calendar} size={18} iconColor="#64748B" />
              </View>
            </View>
          </View>
        </View>
      </View>

      {/* Row 2: Products Table Card */}
      <View style={[styles.card, { marginTop: 16, zIndex: 20 }]}>
        <View style={styles.tableCardHeader}>
          <Text style={styles.cardHeaderTitle}>পণ্যের তালিকা</Text>
          <TouchableOpacity onPress={addNewRow} style={styles.addProductBtn}>
            <AppIcon name={icons.add} size={18} iconColor="#006A4E" />
            <Text style={styles.addProductBtnText}>পণ্য যোগ করুন</Text>
          </TouchableOpacity>
        </View>

        {/* Table Header */}
        <View style={styles.tableHeaderRow}>
          <Text style={[styles.th, { width: 50, textAlign: 'center' }]}>ক্রম</Text>
          <Text style={[styles.th, { flex: 1.2 }]}>পণ্য কোড</Text>
          <Text style={[styles.th, { flex: 2 }]}>পণ্যের নাম</Text>
          <Text style={[styles.th, { flex: 1, textAlign: 'center' }]}>পরিমাণ</Text>
          <Text style={[styles.th, { flex: 1, textAlign: 'center' }]}>দর (৳)</Text>
          <Text style={[styles.th, { flex: 1.2, textAlign: 'center' }]}>মোট (৳)</Text>
          <Text style={[styles.th, { width: 70, textAlign: 'center' }]}>অ্যাকশন</Text>
        </View>

        {/* Table Rows */}
        {items.map((row, rowIdx) => {
          const rowTotal = (parseFloat(row.qty) || 0) * (parseFloat(row.rate) || 0);

          return (
            <View key={row.id} style={styles.tableDataRow}>
              {/* Serial # */}
              <View style={[styles.td, { width: 50, alignItems: 'center', justifyContent: 'center' }]}>
                <Text style={styles.cellText}>{toBnDigits(String(rowIdx + 1))}</Text>
              </View>

              {/* Product Code */}
              <View style={[styles.td, { flex: 1.2 }]}>
                <View style={styles.tableInputWithIcon}>
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
                    onSubmitEditing={() => inputRefs.current[`name_${rowIdx}`]?.focus()}
                    style={styles.tableTextInput}
                    placeholder="300"
                  />
                  <TouchableOpacity
                    onPress={() => setActiveItemDropdownIdx(activeItemDropdownIdx === rowIdx ? null : rowIdx)}
                    style={styles.tableIconWrap}
                  >
                    <AppIcon name={icons.search} size={16} iconColor="#64748B" />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Product Name with Dropdown */}
              <View style={[styles.td, { flex: 2, position: 'relative' }]}>
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
                  onFocus={() => setActiveItemDropdownIdx(rowIdx)}
                  onSubmitEditing={() => inputRefs.current[`qty_${rowIdx}`]?.focus()}
                  style={styles.tableTextInput}
                  placeholder="আতপ চাল"
                />

                {activeItemDropdownIdx === rowIdx && (
                  <View style={styles.itemDropdownMenu}>
                    <ScrollView style={{ maxHeight: 160 }} keyboardShouldPersistTaps="handled">
                      {products
                        .filter(p => !row.name.trim() || p.name.toLowerCase().includes(row.name.toLowerCase()))
                        .map((p, pIdx) => (
                          <TouchableOpacity
                            key={p.id}
                            onPress={() => onSelectProduct(rowIdx, p, pIdx)}
                            style={styles.dropdownItem}
                          >
                            <Text style={styles.dropdownItemText}>{p.name}</Text>
                            <Text style={styles.dropdownItemSub}>
                              {m(isSale ? p.price : p.cost)} • স্টক: {n(p.qty)} কেজি
                            </Text>
                          </TouchableOpacity>
                        ))}
                    </ScrollView>
                  </View>
                )}
              </View>

              {/* Quantity */}
              <View style={[styles.td, { flex: 1 }]}>
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
                  onSubmitEditing={() => inputRefs.current[`rate_${rowIdx}`]?.focus()}
                  style={[styles.tableTextInput, { textAlign: 'center' }]}
                  placeholder="1"
                  keyboardType="numeric"
                />
              </View>

              {/* Rate */}
              <View style={[styles.td, { flex: 1 }]}>
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
                  onSubmitEditing={() => {
                    // Enter adds new row as specified in user video
                    if (rowIdx === items.length - 1) {
                      addNewRow();
                    } else {
                      inputRefs.current[`qty_${rowIdx + 1}`]?.focus();
                    }
                  }}
                  style={[styles.tableTextInput, { textAlign: 'center' }]}
                  placeholder="200"
                  keyboardType="numeric"
                />
              </View>

              {/* Total (readonly calculation) */}
              <View style={[styles.td, { flex: 1.2, alignItems: 'center', justifyContent: 'center' }]}>
                <View style={styles.totalPill}>
                  <Text style={styles.totalPillText}>{rowTotal ? toBnDigits(String(rowTotal)) : '০'}</Text>
                </View>
              </View>

              {/* Action (Delete) */}
              <View style={[styles.td, { width: 70, alignItems: 'center', justifyContent: 'center' }]}>
                <TouchableOpacity onPress={() => removeRow(rowIdx)} style={styles.deleteRowBtn}>
                  <AppIcon name={icons.del} size={20} iconColor="#EF4444" />
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      {/* Row 3: Additional Costs and Account Summary (2 Columns) */}
      <View style={[styles.twoColRow, { marginTop: 16 }]}>
        {/* Additional Costs (Transport + Landing) */}
        <View style={[styles.card, styles.colLeft]}>
          <Text style={styles.cardHeaderTitle}>অতিরিক্ত খরচ</Text>

          <View style={styles.calcRow}>
            <Text style={styles.calcLabel}>পরিবহন খরচ (৳)</Text>
            <TextInput
              value={transportCost}
              onChangeText={setTransportCost}
              style={[styles.textInput, styles.calcInput]}
              placeholder="0"
              keyboardType="numeric"
            />
          </View>

          <View style={styles.calcRow}>
            <Text style={styles.calcLabel}>ল্যান্ডিং খরচ (৳)</Text>
            <TextInput
              value={landingCost}
              onChangeText={setLandingCost}
              style={[styles.textInput, styles.calcInput]}
              placeholder="0"
              keyboardType="numeric"
            />
          </View>
        </View>

        {/* Account Summary */}
        <View style={[styles.card, styles.colRight]}>
          <Text style={styles.cardHeaderTitle}>হিসাব বিবরণ</Text>

          <View style={styles.calcRow}>
            <Text style={styles.calcLabel}>মোট পণ্যের মূল্য (৳)</Text>
            <View style={styles.readOnlyCalcBox}>
              <Text style={styles.readOnlyCalcText}>{toBnDigits(String(Math.round(totalProductValue)))}</Text>
            </View>
          </View>

          <View style={styles.calcRow}>
            <Text style={styles.calcLabel}>পূর্বের বাকি (৳)</Text>
            <View style={styles.readOnlyCalcBox}>
              <Text style={styles.readOnlyCalcText}>{toBnDigits(String(Math.round(prevDue)))}</Text>
            </View>
          </View>

          <View style={styles.calcRow}>
            <Text style={styles.calcLabel}>ক্যাশ পরিশোধ (৳)</Text>
            <TextInput
              value={cashPaid}
              onChangeText={setCashPaid}
              style={[styles.textInput, styles.calcInput]}
              placeholder="0"
              keyboardType="numeric"
            />
          </View>

          <View style={styles.calcRow}>
            <Text style={styles.calcLabel}>ব্যাংক পরিশোধ (৳)</Text>
            <TextInput
              value={bankPaid}
              onChangeText={setBankPaid}
              style={[styles.textInput, styles.calcInput]}
              placeholder="0"
              keyboardType="numeric"
            />
          </View>

          {/* Grand Total Highlight */}
          <View style={styles.grandTotalBanner}>
            <Text style={styles.grandTotalLabel}>সর্বমোট (৳)</Text>
            <Text style={styles.grandTotalValue}>{toBnDigits(String(Math.round(grandTotal)))}</Text>
          </View>
        </View>
      </View>

      {/* Row 4: Footer Action Buttons */}
      <View style={styles.footerRow}>
        <View style={styles.footerLeftButtons}>
          <TouchableOpacity onPress={onDone} style={styles.cancelOutlineBtn}>
            <AppIcon name={icons.cancel} size={18} iconColor="#475569" />
            <Text style={styles.cancelOutlineBtnText}>বাতিল করুন</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => Alert.alert('ড্রাফট', 'ড্রাফট সফলভাবে সংরক্ষণ করা হয়েছে।')}
            style={styles.draftOutlineBtn}
          >
            <AppIcon name={icons.draft} size={18} iconColor="#475569" />
            <Text style={styles.draftOutlineBtnText}>ড্রাফট সংরক্ষণ</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={handleComplete} style={styles.completeBtn}>
          <AppIcon name={isSale ? icons.sale : icons.purchase} size={20} iconColor="#fff" />
          <Text style={styles.completeBtnText}>{isSale ? 'বিক্রয় সম্পন্ন করুন' : 'ক্রয় সম্পন্ন করুন'}</Text>
        </TouchableOpacity>
      </View>
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
  backButton: {
    padding: 6,
    borderRadius: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  headerTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
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
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8E4',
    padding: 16,
  },
  cardHeaderTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    marginBottom: 14,
  },
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
    color: '#475569',
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
    height: 42,
  },
  inputInnerIcon: {
    paddingLeft: 6,
  },
  textInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    paddingVertical: 6,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  dropdownMenu: {
    position: 'absolute',
    top: 68,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 6,
    zIndex: 100,
  },
  dropdownItem: {
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
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
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#F0FDF4',
  },
  addProductBtnText: {
    color: '#006A4E',
    fontSize: 13,
    fontWeight: '700',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#E6F0EB',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  th: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
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
  tableTextInput: {
    flex: 1,
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
  totalPill: {
    backgroundColor: '#F1F5F9',
    borderRadius: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    width: '100%',
    alignItems: 'center',
  },
  totalPillText: {
    fontSize: 13,
    fontWeight: '600',
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
  calcRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  calcLabel: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '500',
  },
  calcInput: {
    maxWidth: 180,
    height: 38,
    textAlign: 'right',
  },
  readOnlyCalcBox: {
    width: 180,
    height: 38,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
    alignItems: 'flex-end',
    justifyContent: 'center',
    paddingHorizontal: 10,
  },
  readOnlyCalcText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  grandTotalBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#DCFCE7',
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 8,
  },
  grandTotalLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#065F46',
  },
  grandTotalValue: {
    fontSize: 18,
    fontWeight: '800',
    color: '#065F46',
  },
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
    borderColor: '#94A3B8',
    borderRadius: 8,
    paddingHorizontal: 16,
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
    borderColor: '#94A3B8',
    borderRadius: 8,
    paddingHorizontal: 16,
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
    paddingHorizontal: 22,
    paddingVertical: 11,
  },
  completeBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
});
