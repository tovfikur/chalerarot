import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal, Platform, Alert } from 'react-native';
import { useApp, Product } from '../store';
import { api, StockAdjustmentHistoryRow } from '../api';
import { toBnDigits, useNum, RequiredLabel } from '../ui';
import { toEnDigits, normalizeInput, parseNum } from '../bn';
import { AppIcon, icons } from '../icons';
import { BulkUploadModal } from '../BulkUploadModal';
import { showEntryError } from '../entryDialog';
import {
  exportStockExcel,
  exportStockPDF,
  exportAuditExcel,
  exportAuditPDF,
  AuditRow,
  movementTypeLabel,
} from '../stockReport';

export function StockDashboard() {
  const { t, lang, products, stockTx, saveProduct, adjustStock, deleteProduct } = useApp();
  const label = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const digits = (value: string | number) => lang === 'bn' ? toBnDigits(String(value)) : String(value);
  const n = useNum();

  // Active view tab: 'products' | 'movements' | 'audit'
  const [activeTab, setActiveTab] = useState<'products' | 'movements' | 'audit'>('products');

  // Search & filter
  const [codeQuery, setCodeQuery] = useState('');
  const [nameQuery, setNameQuery] = useState('');
  const searchQuery = [codeQuery.trim() ? `Code: ${codeQuery.trim()}` : '', nameQuery.trim() ? `Name: ${nameQuery.trim()}` : ''].filter(Boolean).join(' | ');

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 100;

  // Add Product Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [newCode, setNewCode] = useState('');
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('বস্তা');
  const [newBagKg, setNewBagKg] = useState('');
  const [newOpeningBags, setNewOpeningBags] = useState('');
  const [newCostRate, setNewCostRate] = useState('');
  const [newSalePrice, setNewSalePrice] = useState('');
  const [newDescription, setNewDescription] = useState('');

  // Item details modal (Eye action)
  const [viewProduct, setViewProduct] = useState<Product | null>(null);

  // Manual Stock Audit state
  const [physicalBagsMap, setPhysicalBagsMap] = useState<Record<string, string>>({});
  const [physicalKgMap, setPhysicalKgMap] = useState<Record<string, string>>({});
  const [auditReasons, setAuditReasons] = useState<Record<string, string>>({});
  const [showOnlyDiscrepancies, setShowOnlyDiscrepancies] = useState(false);
  const [auditConfirmModalOpen, setAuditConfirmModalOpen] = useState(false);
  const [auditNote, setAuditNote] = useState('ম্যানুয়াল স্টক অডিট সমন্বয়');
  const [isAdjusting, setIsAdjusting] = useState(false);
  const [adjustmentHistoryOpen, setAdjustmentHistoryOpen] = useState(false);
  const [adjustmentHistoryBusy, setAdjustmentHistoryBusy] = useState(false);
  const [adjustmentHistoryError, setAdjustmentHistoryError] = useState('');
  const [adjustmentHistory, setAdjustmentHistory] = useState<StockAdjustmentHistoryRow[]>([]);
  const [selectedAdjustment, setSelectedAdjustment] = useState<StockAdjustmentHistoryRow | null>(null);

  const openAdjustmentHistory = async () => {
    setAdjustmentHistoryOpen(true);
    setSelectedAdjustment(null);
    setAdjustmentHistoryBusy(true);
    setAdjustmentHistoryError('');
    try {
      setAdjustmentHistory(await api.stockAdjustmentHistory());
    } catch (error) {
      setAdjustmentHistoryError(error instanceof Error ? error.message : label('স্টক সমন্বয়ের ইতিহাস লোড করা যায়নি।', 'Could not load stock adjustment history.'));
    } finally {
      setAdjustmentHistoryBusy(false);
    }
  };

  const openNewProduct = () => {
    setEditingProduct(null);
    setNewCode('');
    setNewName('');
    setNewUnit('বস্তা');
    setNewBagKg('50');
    setNewOpeningBags('');
    setNewCostRate('');
    setNewSalePrice('');
    setNewDescription('');
    setModalOpen(true);
  };

  const openEditProduct = (product: Product) => {
    const bagKg = product.mediumBagKg || 50;
    setEditingProduct(product);
    setNewCode(product.code ?? '');
    setNewName(product.name);
    setNewUnit(product.uom || 'বস্তা');
    setNewBagKg(String(bagKg));
    const opBags = bagKg > 0 ? Math.round(((product.opening || 0) / bagKg) * 100) / 100 : 0;
    setNewOpeningBags(opBags > 0 ? String(opBags) : '');
    setNewCostRate(product.cost > 0 ? String(product.cost) : '');
    setNewSalePrice(product.price > 0 ? String(product.price) : '');
    setNewDescription(product.description ?? '');
    setModalOpen(true);
  };

  // Compute stock figures
  const stockData = useMemo(() => {
    return products.map(p => {
      const bagWeight = p.mediumBagKg || 50;
      const bags = Math.round(p.qty / bagWeight) || 0;
      const totalKg = p.qty || 0;
      const stockVal = p.stockValue ?? (p.qty * (p.cost || 0));

      return {
        id: p.id,
        code: p.code ?? '',
        product: p,
        name: p.name,
        unit: p.uom || 'বস্তা',
        bags,
        totalKg,
        stockVal,
        avgUnitCost: totalKg > 0 ? stockVal / totalKg : (p.cost || 0),
        avgBagCost: (totalKg > 0 ? stockVal / totalKg : (p.cost || 0)) * (p.mediumBagKg || 50),
      };
    });
  }, [products]);

  // Aggregate KPI summary
  const totalBags = useMemo(() => stockData.reduce((s, it) => s + it.bags, 0), [stockData]);
  const totalKg = useMemo(() => stockData.reduce((s, it) => s + it.totalKg, 0), [stockData]);
  const totalValuation = useMemo(() => stockData.reduce((s, it) => s + it.stockVal, 0), [stockData]);

  // Filtered rows for Product list
  const filteredRows = useMemo(() => {
    const code = codeQuery.trim().toLowerCase();
    const name = nameQuery.trim().toLowerCase();
    return stockData.filter(r => (!code || r.code.trim().toLowerCase().startsWith(code)) && (!name || r.name.toLowerCase().startsWith(name)));
  }, [stockData, codeQuery, nameQuery]);

  // Audit rows computation
  const auditRows = useMemo<AuditRow[]>(() => {
    return products.map(p => {
      const bagKg = p.mediumBagKg || 50;
      const systemKg = p.qty || 0;
      const systemBags = Math.round(systemKg / bagKg) || 0;
      const cost = p.stockValue && p.qty ? Math.round((p.stockValue / p.qty) * 100) / 100 : (p.cost || 0);

      const rawBags = physicalBagsMap[p.id];
      const rawKg = physicalKgMap[p.id];

      let physicalBags: number | null = null;
      let physicalKg: number | null = null;

      if (rawKg !== undefined && rawKg.trim() !== '') {
        const parsedKg = parseFloat(normalizeInput(rawKg));
        if (Number.isFinite(parsedKg)) {
          physicalKg = Math.max(0, parsedKg);
          const parsedBags = rawBags !== undefined && rawBags.trim() !== '' ? parseFloat(normalizeInput(rawBags)) : null;
          physicalBags = parsedBags !== null && Number.isFinite(parsedBags)
            ? parsedBags
            : Math.round((physicalKg / bagKg) * 10) / 10;
        }
      } else if (rawBags !== undefined && rawBags.trim() !== '') {
        const parsedBags = parseFloat(normalizeInput(rawBags));
        if (Number.isFinite(parsedBags)) {
          physicalBags = Math.max(0, parsedBags);
          physicalKg = Math.round(parsedBags * bagKg * 100) / 100;
        }
      }

      const hasCount = physicalKg !== null;
      const deltaKg = physicalKg !== null ? Math.round((physicalKg - systemKg) * 100) / 100 : 0;
      const deltaBags = physicalBags !== null ? Math.round((physicalBags - systemBags) * 10) / 10 : 0;
      const deltaValue = Math.round(deltaKg * cost);

      return {
        id: p.id,
        code: p.code ?? '',
        name: p.name,
        bagKg,
        systemBags,
        systemKg,
        physicalBags,
        physicalKg,
        deltaBags,
        deltaKg,
        deltaValue,
        cost,
        reason: auditReasons[p.id] || '',
      };
    });
  }, [products, physicalBagsMap, physicalKgMap, auditReasons]);

  // Aggregate audit KPI summary
  const auditSummary = useMemo(() => {
    let discrepancyCount = 0;
    let totalSystemBags = 0;
    let totalSystemKg = 0;
    let totalPhysicalBags = 0;
    let totalPhysicalKg = 0;
    let totalDeltaKg = 0;
    let totalDeltaValue = 0;

    auditRows.forEach(r => {
      totalSystemBags += r.systemBags;
      totalSystemKg += r.systemKg;
      const countBags = r.physicalBags !== null ? r.physicalBags : r.systemBags;
      const countKg = r.physicalKg !== null ? r.physicalKg : r.systemKg;
      totalPhysicalBags += countBags;
      totalPhysicalKg += countKg;

      if (r.physicalKg !== null && Math.abs(r.deltaKg) >= 0.01) {
        discrepancyCount++;
        totalDeltaKg += r.deltaKg;
        totalDeltaValue += r.deltaValue;
      }
    });

    return {
      totalItems: auditRows.length,
      discrepancyCount,
      totalSystemBags,
      totalSystemKg,
      totalPhysicalBags: Math.round(totalPhysicalBags),
      totalPhysicalKg: Math.round(totalPhysicalKg),
      totalDeltaKg: Math.round(totalDeltaKg * 100) / 100,
      totalDeltaValue: Math.round(totalDeltaValue),
    };
  }, [auditRows]);

  // Discrepancy items for adjustment
  const itemsToAdjust = useMemo(() => {
    return auditRows.filter(r => r.physicalKg !== null && Math.abs(r.deltaKg) >= 0.01);
  }, [auditRows]);

  // Filtered audit rows
  const filteredAuditRows = useMemo(() => {
    const code = codeQuery.trim().toLowerCase();
    const name = nameQuery.trim().toLowerCase();
    let list = auditRows;
    if (showOnlyDiscrepancies) {
      list = list.filter(r => r.physicalKg !== null && Math.abs(r.deltaKg) >= 0.01);
    }
    if (code || name) list = list.filter(r => (!code || r.code.trim().toLowerCase().startsWith(code)) && (!name || r.name.toLowerCase().startsWith(name)));
    return list;
  }, [auditRows, showOnlyDiscrepancies, codeQuery, nameQuery]);

  // Pagination for current view
  const currentTotalRows = activeTab === 'audit' ? filteredAuditRows.length : filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(currentTotalRows / pageSize));
  const visiblePages = Array.from(new Set([1, page - 1, page, page + 1, totalPages]
    .filter(p => p >= 1 && p <= totalPages))).sort((a, b) => a - b);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page]);

  const pagedAuditRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAuditRows.slice(start, start + pageSize);
  }, [filteredAuditRows, page]);

  // Auto-prefill audit counts with current system stock on entering audit tab if not initialized
  const auditInitializedRef = useRef(false);
  useEffect(() => {
    if (activeTab === 'audit' && !auditInitializedRef.current && products.length > 0) {
      auditInitializedRef.current = true;
      handlePreFillWithSystem();
    }
  }, [activeTab, products]);

  // Audit input handlers
  const handleBagsChange = (id: string, val: string, bagKg: number) => {
    setPhysicalBagsMap(prev => ({ ...prev, [id]: val }));
    const normalized = normalizeInput(val).trim();
    if (normalized === '') {
      setPhysicalKgMap(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    const parsed = parseFloat(normalized);
    if (Number.isFinite(parsed) && parsed >= 0) {
      const kgVal = String(Math.round(parsed * bagKg));
      setPhysicalKgMap(prev => ({ ...prev, [id]: kgVal }));
    }
  };

  const handleKgChange = (id: string, val: string, bagKg: number) => {
    setPhysicalKgMap(prev => ({ ...prev, [id]: val }));
    const normalized = normalizeInput(val).trim();
    if (normalized === '') {
      setPhysicalBagsMap(prev => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }
    const parsed = parseFloat(normalized);
    if (Number.isFinite(parsed) && parsed >= 0) {
      const bagsVal = String(Math.round((parsed / bagKg) * 10) / 10);
      setPhysicalBagsMap(prev => ({ ...prev, [id]: bagsVal }));
    }
  };

  const handleReasonChange = (id: string, val: string) => {
    setAuditReasons(prev => ({ ...prev, [id]: val }));
  };

  const handlePreFillWithSystem = () => {
    const newBags: Record<string, string> = {};
    const newKg: Record<string, string> = {};
    products.forEach(p => {
      const bagKg = p.mediumBagKg || 50;
      const bags = Math.round(p.qty / bagKg);
      newBags[p.id] = String(bags);
      newKg[p.id] = String(Math.round(p.qty));
    });
    setPhysicalBagsMap(newBags);
    setPhysicalKgMap(newKg);
  };

  const handleClearAudit = () => {
    setPhysicalBagsMap({});
    setPhysicalKgMap({});
    setAuditReasons({});
  };

  const handleExportAuditPDF = () => {
    const ok = exportAuditPDF({
      auditRows: filteredAuditRows,
      summary: auditSummary,
      note: auditNote,
      lang,
    });
    if (!ok && Platform.OS !== 'web') {
      Alert.alert(label('অডিট রিপোর্ট', 'Audit report'), label('পিডিএফ রিপোর্ট তৈরি করা হয়েছে।', 'PDF report created.'));
    }
  };

  const handleExportAuditExcel = () => {
    const ok = exportAuditExcel({
      auditRows: filteredAuditRows,
      summary: auditSummary,
      lang,
    });
    if (!ok && Platform.OS !== 'web') {
      Alert.alert(label('অডিট শিট', 'Audit sheet'), label('এক্সেল ফাইল ডাউনলোড সম্পন্ন হয়েছে।', 'Excel file downloaded.'));
    }
  };

  const handleApplyStockAdjustment = async () => {
    if (itemsToAdjust.length === 0) {
      Alert.alert(label('সতর্কতা', 'Notice'), label('সমন্বয় করার মতো কোনো গরমিল বা পরিবর্তন পাওয়া যায়নি। বাস্তব গণনায় পরিবর্তন আনুন।', 'No stock differences to adjust. Update the physical counts first.'));
      return;
    }
    setIsAdjusting(true);
    try {
      const payloadItems = itemsToAdjust.map(it => ({
        productId: it.id,
        physicalQtyKg: it.physicalKg!,
        deltaKg: it.deltaKg,
        reason: it.reason || undefined,
      }));
      await adjustStock({
        items: payloadItems,
        note: auditNote,
      });
      setAuditConfirmModalOpen(false);
      handleClearAudit();
      Alert.alert(label('সফল', 'Success'), label(`${toBnDigits(String(itemsToAdjust.length))} টি পণ্যের স্টক সমন্বয় সফলভাবে সম্পন্ন হয়েছে।`, `Stock adjusted for ${itemsToAdjust.length} products.`));
    } catch (err) {
      Alert.alert(label('ত্রুটি', 'Error'), err instanceof Error ? err.message : label('স্টক সমন্বয় ব্যর্থ হয়েছে।', 'Stock adjustment failed.'));
    } finally {
      setIsAdjusting(false);
    }
  };

  // Save or update product from modal
  const handleSaveProduct = async () => {
    const trimmedName = newName.trim();
    if (!trimmedName) {
      showEntryError(lang, label('পণ্যের নাম আবশ্যক।', 'Product name is required.'));
      return;
    }

    const bagKg = parseNum(newBagKg) || 50;
    if (bagKg <= 0) {
      showEntryError(lang, label('প্রতি বস্তায় কেজির পরিমাণ ০ এর বেশি হতে হবে।', 'Bag weight must be greater than zero.'));
      return;
    }
    const openingBags = parseNum(newOpeningBags) || 0;
    const cost = parseNum(newCostRate) || 0;
    const price = parseNum(newSalePrice);
    if (!Number.isFinite(price) || price <= 0) {
      showEntryError(lang, label('সঠিক বিক্রয়দর দিন (০ এর বেশি)।', 'Enter a sale price greater than zero.'));
      return;
    }
    const openingKg = Math.round(openingBags * bagKg * 100) / 100;

    try {
      const isEdit = !!editingProduct;
      const targetId = editingProduct?.id ?? `p_${Date.now()}`;
      const openingDelta = openingKg - (editingProduct?.opening || 0);
      const computedQty = isEdit ? Math.max(0, (editingProduct.qty || 0) + openingDelta) : openingKg;

      await saveProduct({
        id: targetId,
        code: newCode.trim(),
        name: trimmedName,
        description: newDescription.trim(),
        cost,
        price: Math.round(price * 100) / 100,
        opening: openingKg,
        qty: computedQty,
        uom: newUnit || 'বস্তা',
        smallBagKg: editingProduct?.smallBagKg || 25,
        mediumBagKg: bagKg,
        largeBagKg: editingProduct?.largeBagKg || 50,
      });

      setModalOpen(false);
      setEditingProduct(null);
      setNewName('');
      setNewCode('');
      setNewOpeningBags('');
      setNewCostRate('');
      setNewSalePrice('');
      setNewDescription('');
      Alert.alert(t('done'), isEdit ? label('পণ্য সফলভাবে আপডেট করা হয়েছে।', 'Product updated.') : label('নতুন পণ্য সফলভাবে যোগ করা হয়েছে।', 'Product added.'));
    } catch (err) {
      showEntryError(lang, err instanceof Error ? err.message : label('সংরক্ষণ ব্যর্থ হয়েছে।', 'Save failed.'));
    }
  };

  const handleExportExcel = () => {
    if (activeTab === 'audit') {
      handleExportAuditExcel();
      return;
    }
    const ok = exportStockExcel({
      activeTab,
      items: filteredRows,
      movements: stockTx,
      totalBags,
      totalKg,
      totalValuation,
      lang,
    });
    if (!ok && Platform.OS !== 'web') {
      Alert.alert(label('এক্সেল', 'Excel'), label('ফাইল ডাউনলোড সম্পন্ন হয়েছে।', 'File downloaded.'));
    }
  };

  const handleExportPDF = () => {
    if (activeTab === 'audit') {
      handleExportAuditPDF();
      return;
    }
    const ok = exportStockPDF({
      activeTab,
      items: filteredRows,
      movements: stockTx,
      totalBags,
      totalKg,
      totalValuation,
      searchQuery: searchQuery.trim(),
      lang,
    });
    if (!ok && Platform.OS !== 'web') {
      Alert.alert('PDF', label('পিডিএফ রিপোর্ট তৈরি করা হয়েছে।', 'PDF report created.'));
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.contentContainer}>
      {/* Top Header Banner - Consistent Royal Blue Executive Skeuomorphic Theme */}
      <View style={styles.headerBar}>
        <View style={styles.headerGlossSheen} pointerEvents="none" />
        <View style={styles.headerLeft}>
          <View style={styles.titleIconBadge}>
            <AppIcon name={icons.stock} size={22} iconColor="#fff" />
          </View>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={styles.headerTitle}>{label('মজুদ চাল ও স্টক বিবরণ', 'Rice inventory')}</Text>
              
            </View>
            
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => setBulkOpen(true)}
            testID="stock-bulk-upload"
            style={styles.headerBulkBtn}
            activeOpacity={0.85}
          >
            <AppIcon name={icons.upload} size={18} iconColor="#FFFFFF" />
            <Text style={styles.headerAddBtnText}>{label('বাল্ক পণ্য আপলোড', 'Bulk upload')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={openNewProduct}
            testID="stock-add-product"
            style={styles.headerAddBtn}
            activeOpacity={0.85}
          >
            <AppIcon name={icons.plus} size={18} iconColor="#FFFFFF" />
            <Text style={styles.headerAddBtnText}>{label('নতুন পণ্য', 'New product')}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* KPI Cards (3 Cards) */}
      <View style={styles.kpiRow}>
        {/* Card 1: Total Bags */}
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#E0F0FE' }]}>
            <AppIcon name={icons.stock} size={26} iconColor="#1c70b9" />
          </View>
          <View style={styles.kpiInfo}>
            <Text style={styles.kpiLabel}>{label('মোট মজুদ (বস্তা)', 'Total stock (bags)')}</Text>
            <Text style={styles.kpiValue}>{digits(totalBags.toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))} {label('বস্তা', 'bags')}</Text>
          </View>
        </View>

        {/* Card 2: Total KG */}
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#E3F2FD' }]}>
            <AppIcon name={icons.products} size={26} iconColor="#1976D2" />
          </View>
          <View style={styles.kpiInfo}>
            <Text style={styles.kpiLabel}>{label('মোট মজুদ (কেজি)', 'Total stock (kg)')}</Text>
            <Text style={styles.kpiValue}>{digits(Math.round(totalKg).toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))} {label('কেজি', 'kg')}</Text>
          </View>
        </View>

        {/* Card 3: Total Valuation */}
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#FEF3C7' }]}>
            <AppIcon name={icons.profit} size={26} iconColor="#D97706" />
          </View>
          <View style={styles.kpiInfo}>
            <Text style={styles.kpiLabel}>{label('মোট মজুদ মূল্যায়ন', 'Total inventory value')}</Text>
            <Text style={styles.kpiValue}>৳{digits(Math.round(totalValuation).toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))}</Text>
          </View>
        </View>
      </View>

      {/* Control Tabs & Action Buttons */}
      <View style={styles.controlsRow}>
        <View style={styles.tabButtonsGroup}>
          <TouchableOpacity
            onPress={() => {
              setActiveTab('products');
              setPage(1);
            }}
            style={[styles.tabBtn, activeTab === 'products' ? styles.tabBtnActive : styles.tabBtnInactive]}
          >
            <AppIcon
              name={icons.products}
              size={18}
              iconColor={activeTab === 'products' ? '#fff' : '#0F172A'}
            />
            <Text
              style={[styles.tabBtnText, activeTab === 'products' ? styles.tabBtnTextActive : styles.tabBtnTextInactive]}
            >
              {label('পণ্য তালিকা', 'Products')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setActiveTab('movements');
              setPage(1);
            }}
            style={[styles.tabBtn, activeTab === 'movements' ? styles.tabBtnActive : styles.tabBtnInactive]}
          >
            <AppIcon
              name={icons.transfer}
              size={18}
              iconColor={activeTab === 'movements' ? '#fff' : '#0F172A'}
            />
            <Text
              style={[styles.tabBtnText, activeTab === 'movements' ? styles.tabBtnTextActive : styles.tabBtnTextInactive]}
            >
              {label('স্টক মুভমেন্ট', 'Stock movements')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => {
              setActiveTab('audit');
              setPage(1);
            }}
            style={[styles.tabBtn, activeTab === 'audit' ? styles.tabBtnActive : styles.tabBtnInactive]}
          >
            <AppIcon
              name={icons.stock}
              size={18}
              iconColor={activeTab === 'audit' ? '#fff' : '#0F172A'}
            />
            <Text
              style={[styles.tabBtnText, activeTab === 'audit' ? styles.tabBtnTextActive : styles.tabBtnTextInactive]}
            >
              {label('স্টক অডিট ও সমন্বয়', 'Stock audit and adjustment')}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.rightActionGroup}>
          {activeTab === 'audit' ? (
            <>
              <TouchableOpacity
                onPress={openAdjustmentHistory}
                style={[styles.outlineActionBtn, { borderColor: '#7C3AED' }]}
                testID="stock-adjustment-history"
                accessibilityLabel={label('স্টক সমন্বয়ের ইতিহাস দেখুন', 'View stock adjustment history')}
              >
                <AppIcon name={icons.history} size={17} iconColor="#7C3AED" />
                <Text style={[styles.outlineActionBtnText, { color: '#7C3AED', fontWeight: '700' }]}>{label('সমন্বয়ের ইতিহাস', 'Adjustment history')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handlePreFillWithSystem}
                style={[styles.outlineActionBtn, { borderColor: '#1c70b9', backgroundColor: '#F0F7FF' }]}
                accessibilityLabel={label('সিস্টেম মজুদ দিয়ে অটো পূরণ', 'Fill using system stock')}
              >
                <AppIcon name={icons.transfer} size={16} iconColor="#1c70b9" />
                <Text style={[styles.outlineActionBtnText, { color: '#1c70b9', fontWeight: '700' }]}>{label('অটো-পূরণ', 'Auto-fill')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleClearAudit}
                style={[styles.outlineActionBtn, { borderColor: '#94A3B8' }]}
                accessibilityLabel={label('অডিট গণনা খালি করুন', 'Clear audit counts')}
              >
                <AppIcon name={icons.cancel} size={16} iconColor="#64748B" />
                <Text style={[styles.outlineActionBtnText, { color: '#64748B', fontWeight: '600' }]}>{label('মুছুন', 'Clear')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleExportAuditPDF}
                style={[styles.outlineActionBtn, { borderColor: '#DC2626' }]}
                testID="stock-audit-pdf"
                accessibilityLabel={label('অডিট রিপোর্ট ডাউনলোড (PDF)', 'Download audit report (PDF)')}
              >
                <AppIcon name={icons.print} size={18} iconColor="#DC2626" />
                <Text style={[styles.outlineActionBtnText, { color: '#DC2626', fontWeight: '700' }]}>{label('অডিট রিপোর্ট (PDF)', 'Audit report (PDF)')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleExportAuditExcel}
                style={[styles.outlineActionBtn, { borderColor: '#16A34A' }]}
                testID="stock-audit-excel"
                accessibilityLabel={label('অডিট শিট ডাউনলোড (Excel)', 'Download audit sheet (Excel)')}
              >
                <AppIcon name={icons.excel} size={18} iconColor="#16A34A" />
                <Text style={[styles.outlineActionBtnText, { color: '#16A34A', fontWeight: '700' }]}>{label('অডিট শিট (Excel)', 'Audit sheet (Excel)')}</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity onPress={() => setModalOpen(true)} style={styles.addProductGreenBtn}>
                <AppIcon name={icons.add} size={18} iconColor="#fff" />
                <Text style={styles.addProductGreenBtnText}>{label('পণ্য যোগ করুন', 'Add product')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleExportPDF}
                style={[styles.outlineActionBtn, { borderColor: '#DC2626' }]}
                testID="stock-pdf-download"
                accessibilityLabel={label('পিডিএফ রিপোর্ট ডাউনলোড', 'Download PDF report')}
              >
                <AppIcon name={icons.print} size={18} iconColor="#DC2626" />
                <Text style={[styles.outlineActionBtnText, { color: '#DC2626', fontWeight: '700' }]}>{label('পিডিএফ রিপোর্ট', 'PDF report')}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleExportExcel}
                style={[styles.outlineActionBtn, { borderColor: '#16A34A' }]}
                testID="stock-excel-download"
                accessibilityLabel={label('এক্সেল ডাউনলোড', 'Download Excel')}
              >
                <AppIcon name={icons.excel} size={18} iconColor="#16A34A" />
                <Text style={[styles.outlineActionBtnText, { color: '#16A34A', fontWeight: '700' }]}>{label('এক্সেল ডাউনলোড', 'Download Excel')}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Filter and Search Bar */}
      <View style={styles.filterCard}>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          <View style={[styles.searchInputWrap, { flex: 1, minWidth: 220 }]}>
            <AppIcon name={icons.search} size={18} iconColor="#94A3B8" />
            <TextInput value={codeQuery} onChangeText={v => { setCodeQuery(v); setPage(1); }} style={styles.filterTextInput}
              placeholder={label('সঠিক পণ্য কোড', 'Exact product code')} accessibilityLabel="Exact product code" />
          </View>
          <View style={[styles.searchInputWrap, { flex: 1, minWidth: 220 }]}>
            <AppIcon name={icons.search} size={18} iconColor="#94A3B8" />
            <TextInput value={nameQuery} onChangeText={v => { setNameQuery(v); setPage(1); }} style={styles.filterTextInput}
              placeholder={label('পণ্যের নাম খুঁজুন', 'Search product name')} accessibilityLabel="Search product name" />
          </View>
        </View>

        {activeTab === 'audit' ? (
          <TouchableOpacity
            onPress={() => {
              setShowOnlyDiscrepancies(prev => !prev);
              setPage(1);
            }}
            style={[styles.discrepancyToggleBtn, showOnlyDiscrepancies && styles.discrepancyToggleBtnActive]}
          >
            <View style={[styles.discrepancyDot, showOnlyDiscrepancies && { backgroundColor: '#DC2626' }]} />
            <Text style={[styles.discrepancyToggleText, showOnlyDiscrepancies && styles.discrepancyToggleTextActive]}>
              {label('শুধু অমিলগুলো দেখান', 'Show discrepancies only')} ({digits(auditSummary.discrepancyCount)})
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.categoryDropdownWrap}>
            <Text style={styles.categoryDropdownText}>{label('সব পণ্য', 'All products')}</Text>
            <AppIcon name={icons.chevR} size={18} iconColor="#64748B" />
          </View>
        )}
      </View>

      {/* Main Table Card */}
      <View style={styles.tableCard}>
        {activeTab === 'products' ? (
          <>
            {/* Table Header */}
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.th, { width: 50, textAlign: 'center' }]}>#</Text>
              <Text style={[styles.th, { flex: 1.2 }]}>{label('পণ্য কোড', 'Product code')}</Text>
              <Text style={[styles.th, { flex: 2.2 }]}>{label('পণ্যের নাম', 'Product name')}</Text>
              
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>{label('মজুদ (বস্তা)', 'Stock (bags)')}</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>{label('মজুদ (কেজি)', 'Stock (kg)')}</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>{t('avgUnitCost')}</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>{t('avgBagCost')}</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>{label('স্টক মূল্য (৳)', 'Stock value (৳)')}</Text>
              <Text style={[styles.th, { width: 112, textAlign: 'center' }]}>{label('অ্যাকশন', 'Actions')}</Text>
            </View>

            {/* Table Rows */}
            {pagedRows.map((row, idx) => (
              <View key={row.id} style={styles.tableDataRow}>
                <View style={[styles.td, { width: 50, alignItems: 'center' }]}>
                  <Text style={styles.cellMuted}>{(page - 1) * pageSize + idx + 1}</Text>
                </View>

                <View style={[styles.td, { flex: 1.2 }]}>
                  <Text style={styles.cellBold}>{row.code}</Text>
                </View>

                <View style={[styles.td, { flex: 2.2 }]}>
                  <Text style={styles.cellName}>{row.name}</Text>
                </View>

                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={[styles.cellBold, { color: row.bags < 0 ? '#DC2626' : '#0F172A' }]}>{digits(row.bags.toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))}</Text>
                </View>

                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={[styles.cellText, { color: row.totalKg < 0 ? '#DC2626' : undefined, fontWeight: row.totalKg < 0 ? '800' : undefined }]}>{digits(Math.round(row.totalKg).toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))}</Text>
                </View>

                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={styles.cellBold}>{digits(row.avgUnitCost.toFixed(2))}</Text>
                </View>

                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={styles.cellBold}>{digits(row.avgBagCost.toFixed(2))}</Text>
                </View>

                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={[styles.cellBold, { color: row.stockVal < 0 ? '#DC2626' : '#1c70b9' }]}>
                    ৳{digits(Math.round(row.stockVal).toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))}
                  </Text>
                </View>

                <View style={[styles.td, { width: 112, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 4 }]}>
                  <TouchableOpacity
                    onPress={() => setViewProduct(row.product)}
                    testID={`view-product-${row.id}`}
                    style={styles.eyeActionButton}
                  >
                    <AppIcon name={icons.eye} size={18} iconColor="#1c70b9" />
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => openEditProduct(row.product)}
                    testID={`edit-product-${row.id}`}
                    style={styles.eyeActionButton}
                    accessibilityLabel={`Edit product ${row.name}`}
                  >
                    <AppIcon name={icons.edit} size={18} iconColor="#1c70b9" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        ) : activeTab === 'movements' ? (
          /* Movement view */
          <View>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.th, { width: 50, textAlign: 'center' }]}>#</Text>
              <Text style={[styles.th, { flex: 1.2 }]}>{label('তারিখ', 'Date')}</Text>
              <Text style={[styles.th, { flex: 2 }]}>{label('পণ্যের নাম', 'Product name')}</Text>
              <Text style={[styles.th, { flex: 1.5 }]}>{label('ধরন', 'Type')}</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>{label('পরিমাণ (কেজি)', 'Quantity (kg)')}</Text>
              <Text style={[styles.th, { flex: 1.2, textAlign: 'right' }]}>{t('bagQty')}</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>{t('avgUnitCost')}</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>{t('unitPricePerBag')}</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>{t('amount')}</Text>
            </View>
            {stockTx.slice(0, 15).map((mv, idx) => (
              <View key={mv.id} style={styles.tableDataRow}>
                <View style={[styles.td, { width: 50, alignItems: 'center' }]}>
                  <Text style={styles.cellMuted}>{idx + 1}</Text>
                </View>
                <View style={[styles.td, { flex: 1.2 }]}>
                  <Text style={styles.cellText}>{digits(mv.date)}</Text>
                </View>
                <View style={[styles.td, { flex: 2 }]}>
                  <Text style={styles.cellName}>{mv.productName || label('পণ্য', 'Product')}</Text>
                </View>
                <View style={[styles.td, { flex: 1.5 }]}>
                  <Text style={styles.cellBold}>{movementTypeLabel(mv.type, lang)}</Text>
                  {mv.transactionNo ? <Text style={styles.cellMuted}>#{digits(mv.transactionNo)}</Text> : null}
                  {mv.note ? <Text style={styles.cellMuted}>{mv.note}</Text> : null}
                </View>
                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={[styles.cellBold, { color: mv.qty >= 0 ? '#16A34A' : '#DC2626' }]}>
                    {digits(mv.qty)}
                  </Text>
                </View>
                <View style={[styles.td, { flex: 1.2, alignItems: 'flex-end' }]}>
                  <Text style={styles.cellBold}>{toBnDigits(Math.abs(mv.bags).toFixed(2))}</Text>
                </View>
                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={styles.cellBold}>৳{toBnDigits(mv.unitCost.toFixed(2))}</Text>
                </View>
                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={styles.cellBold}>৳{toBnDigits(mv.bagUnitPrice.toFixed(2))}</Text>
                </View>
                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={[styles.cellBold, { color: mv.amount >= 0 ? '#16A34A' : '#DC2626' }]}>
                    {mv.amount < 0 ? '-৳' : '৳'}{toBnDigits(Math.abs(mv.amount).toFixed(2))}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        ) : (
          /* Manual Stock Audit view */
          <View>
            <View style={styles.tableHeaderRow}>
              <Text style={[styles.th, { width: 40, textAlign: 'center' }]}>#</Text>
              <Text style={[styles.th, { flex: 2 }]}>{label('পণ্য ও সাইজ', 'Product and size')}</Text>
              <Text style={[styles.th, { width: 125, textAlign: 'right' }]}>{label('সিস্টেম মজুদ', 'System stock')}</Text>
              <Text style={[styles.th, { width: 110, textAlign: 'center' }]}>{label('বাস্তব বস্তা', 'Counted bags')}</Text>
              <Text style={[styles.th, { width: 120, textAlign: 'center' }]}>{label('বাস্তব কেজি', 'Counted kg')}</Text>
              <Text style={[styles.th, { width: 120, textAlign: 'right' }]}>{label('পার্থক্য', 'Difference')}</Text>
              <Text style={[styles.th, { width: 110, textAlign: 'right' }]}>{label('আর্থিক প্রভাব', 'Financial impact')}</Text>
              <Text style={[styles.th, { flex: 1.6 }]}>{label('কারণ / মন্তব্য', 'Reason / note')}</Text>
            </View>

            {pagedAuditRows.length === 0 ? (
              <View style={{ padding: 36, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 14, color: '#64748B', fontWeight: '500' }}>
                  {showOnlyDiscrepancies ? label('কোনো অমিলযুক্ত পণ্য পাওয়া যায়নি।', 'No products with discrepancies.') : label('কোনো পণ্য পাওয়া যায়নি।', 'No products found.')}
                </Text>
              </View>
            ) : (
              pagedAuditRows.map((row, idx) => {
                const hasCount = row.physicalKg !== null;
                const isMatched = hasCount && Math.abs(row.deltaKg) < 0.01;
                const isSurplus = hasCount && row.deltaKg >= 0.01;
                const isShortage = hasCount && row.deltaKg <= -0.01;

                return (
                  <View
                    key={row.id}
                    style={[
                      styles.tableDataRow,
                      isShortage ? styles.shortageRow : isSurplus ? styles.surplusRow : null,
                    ]}
                  >
                    <View style={[styles.td, { width: 40, alignItems: 'center' }]}>
                      <Text style={styles.cellMuted}>{(page - 1) * pageSize + idx + 1}</Text>
                    </View>

                    <View style={[styles.td, { flex: 2 }]}>
                      <Text style={styles.cellName} numberOfLines={1}>{row.name}</Text>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        {row.code ? <Text style={styles.auditCodeBadge}>{row.code}</Text> : null}
                        <Text style={styles.auditBagWeightBadge}>{digits(row.bagKg)} {label('কেজি বস্তা', 'kg bag')}</Text>
                      </View>
                    </View>

                    <View style={[styles.td, { width: 125, alignItems: 'flex-end' }]}>
                      <Text style={[styles.cellBold, { color: '#0F172A' }]}>
                        {digits(row.systemBags.toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))} {label('বস্তা', 'bags')}
                      </Text>
                      <Text style={{ fontSize: 11.5, color: '#64748B', marginTop: 1 }}>
                        {digits(Math.round(row.systemKg).toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))} {label('কেজি', 'kg')}
                      </Text>
                    </View>

                    <View style={[styles.td, { width: 110, alignItems: 'center' }]}>
                      <TextInput
                        value={physicalBagsMap[row.id] !== undefined ? physicalBagsMap[row.id] : String(row.systemBags)}
                        onChangeText={val => handleBagsChange(row.id, val, row.bagKg)}
                        placeholder={digits(row.systemBags)}
                        placeholderTextColor="#94A3B8"
                        keyboardType="numeric"
                        selectTextOnFocus
                        style={[
                          styles.auditTableCellInput,
                          isShortage ? styles.auditTableCellInputShortage : isSurplus ? styles.auditTableCellInputSurplus : null,
                        ]}
                      />
                    </View>

                    <View style={[styles.td, { width: 120, alignItems: 'center' }]}>
                      <TextInput
                        value={physicalKgMap[row.id] !== undefined ? physicalKgMap[row.id] : String(Math.round(row.systemKg))}
                        onChangeText={val => handleKgChange(row.id, val, row.bagKg)}
                        placeholder={digits(Math.round(row.systemKg))}
                        placeholderTextColor="#94A3B8"
                        keyboardType="numeric"
                        selectTextOnFocus
                        style={[
                          styles.auditTableCellInput,
                          isShortage ? styles.auditTableCellInputShortage : isSurplus ? styles.auditTableCellInputSurplus : null,
                        ]}
                      />
                    </View>

                    <View style={[styles.td, { width: 120, alignItems: 'flex-end' }]}>
                      {!hasCount ? (
                        <Text style={{ fontSize: 13, color: '#94A3B8' }}>-</Text>
                      ) : isMatched ? (
                        <View style={styles.matchBadge}>
                          <Text style={styles.matchBadgeText}>✓ {label('মিলেছে', 'Matched')}</Text>
                        </View>
                      ) : isSurplus ? (
                        <View style={styles.surplusBadge}>
                          <Text style={styles.surplusBadgeText}>
                            +{digits(row.deltaBags)} {label('বস্তা', 'bags')}
                          </Text>
                          <Text style={styles.surplusSubText}>
                            (+{digits(Math.round(row.deltaKg).toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))} {label('কেজি', 'kg')})
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.shortageBadge}>
                          <Text style={styles.shortageBadgeText}>
                            {digits(row.deltaBags)} {label('বস্তা', 'bags')}
                          </Text>
                          <Text style={styles.shortageSubText}>
                            ({digits(Math.round(row.deltaKg).toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))} {label('কেজি', 'kg')})
                          </Text>
                        </View>
                      )}
                    </View>

                    <View style={[styles.td, { width: 110, alignItems: 'flex-end' }]}>
                      {!hasCount || isMatched ? (
                        <Text style={{ fontSize: 13, color: '#94A3B8' }}>{lang === 'bn' ? '৳০' : '৳0'}</Text>
                      ) : (
                        <Text style={[styles.cellBold, { color: isSurplus ? '#16A34A' : '#DC2626' }]}>
                          {row.deltaValue > 0 ? '+' : ''}৳{toBnDigits(Math.round(Math.abs(row.deltaValue)).toLocaleString('en-IN'))}
                        </Text>
                      )}
                    </View>

                    <View style={[styles.td, { flex: 1.6 }]}>
                      <TextInput
                        value={auditReasons[row.id] ?? ''}
                        onChangeText={val => handleReasonChange(row.id, val)}
                        placeholder={label('মন্তব্য / কারণ...', 'Note / reason...')}
                        placeholderTextColor="#94A3B8"
                        style={styles.auditReasonInput}
                      />
                    </View>
                  </View>
                );
              })
            )}
          </View>
        )}

        {/* Pagination Footer */}
        <View style={styles.paginationFooter}>
          <Text style={styles.footerCountText}>
            {label(
              `${currentTotalRows ? toBnDigits(String((page - 1) * pageSize + 1)) : '০'}–${toBnDigits(String(Math.min(page * pageSize, currentTotalRows)))} / ${toBnDigits(String(currentTotalRows))} টি পণ্য`,
              `Showing ${currentTotalRows ? (page - 1) * pageSize + 1 : 0}–${Math.min(page * pageSize, currentTotalRows)} of ${currentTotalRows} products`,
            )}
          </Text>

          <View style={styles.paginationControls}>
            <Text style={styles.pageSizeText}>{label('প্রতি পৃষ্ঠায় ১০০টি', '100 per page')}</Text>

            <View style={styles.pageButtonsRow}>
              <TouchableOpacity
                disabled={page <= 1}
                onPress={() => setPage(p => Math.max(1, p - 1))}
                style={[styles.pageNavBtn, page <= 1 && styles.pageNavBtnDisabled]}
              >
                <Text style={styles.pageNavText}>‹</Text>
              </TouchableOpacity>

              {visiblePages.map((pNum, idx) => <React.Fragment key={pNum}>
                {idx > 0 && pNum - visiblePages[idx - 1] > 1 ? <Text style={styles.pageNumberText}>…</Text> : null}
                <TouchableOpacity
                  onPress={() => setPage(pNum)}
                  style={[styles.pageNumberBtn, page === pNum && styles.pageNumberBtnActive]}
                >
                  <Text style={[styles.pageNumberText, page === pNum && styles.pageNumberTextActive]}>
                    {digits(pNum)}
                  </Text>
                </TouchableOpacity>
              </React.Fragment>)}

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

      {/* Bottom Action Bar for Manual Stock Adjustment */}
      {activeTab === 'audit' && (
        <View style={styles.auditBottomActionBar}>
          <View style={styles.auditBottomSummary}>
            <View style={styles.auditBottomItem}>
              <Text style={styles.auditBottomLabel}>{label('অডিটকৃত পণ্য:', 'Products counted:')}</Text>
              <Text style={styles.auditBottomValue}>{digits(auditSummary.totalItems)} {label('টি', '')}</Text>
            </View>
            <View style={styles.auditDivider} />
            <View style={styles.auditBottomItem}>
              <Text style={styles.auditBottomLabel}>{label('পার্থক্যযুক্ত পণ্য:', 'Products with differences:')}</Text>
              <Text style={[styles.auditBottomValue, { color: auditSummary.discrepancyCount > 0 ? '#DC2626' : '#16A34A' }]}>
                {digits(auditSummary.discrepancyCount)} {label('টি', '')}
              </Text>
            </View>
            <View style={styles.auditDivider} />
            <View style={styles.auditBottomItem}>
              <Text style={styles.auditBottomLabel}>{label('ওজন তারতম্য:', 'Weight difference:')}</Text>
              <Text style={[styles.auditBottomValue, { color: auditSummary.totalDeltaKg < 0 ? '#DC2626' : auditSummary.totalDeltaKg > 0 ? '#16A34A' : '#0F172A' }]}>
                {auditSummary.totalDeltaKg > 0 ? '+' : ''}{digits(Math.round(auditSummary.totalDeltaKg).toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))} {label('কেজি', 'kg')}
              </Text>
            </View>
            <View style={styles.auditDivider} />
            <View style={styles.auditBottomItem}>
              <Text style={styles.auditBottomLabel}>{label('আর্থিক প্রভাব:', 'Financial impact:')}</Text>
              <Text style={[styles.auditBottomValue, { color: auditSummary.totalDeltaValue < 0 ? '#DC2626' : auditSummary.totalDeltaValue > 0 ? '#16A34A' : '#0F172A' }]}>
                {auditSummary.totalDeltaValue > 0 ? '+' : ''}৳{digits(Math.round(Math.abs(auditSummary.totalDeltaValue)).toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))}
              </Text>
            </View>
          </View>

          <TouchableOpacity
            disabled={itemsToAdjust.length === 0}
            onPress={() => setAuditConfirmModalOpen(true)}
            style={[styles.applyAdjustmentBtn, itemsToAdjust.length === 0 && styles.applyAdjustmentBtnDisabled]}
          >
            <AppIcon name={icons.done} size={18} iconColor="#FFFFFF" />
            <Text style={styles.applyAdjustmentBtnText}>
              {label('স্টক সমন্বয় প্রয়োগ করুন', 'Apply stock adjustment')} ({digits(itemsToAdjust.length)})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Add / Edit Product Modal */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => { setModalOpen(false); setEditingProduct(null); }}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <AppIcon name={icons.products} size={22} iconColor="#1c70b9" />
                <Text style={styles.modalTitle}>{editingProduct ? label('পণ্য সম্পাদনা', 'Edit product') : label('নতুন পণ্য যোগ করুন', 'Add new product')}</Text>
              </View>
              <TouchableOpacity onPress={() => { setModalOpen(false); setEditingProduct(null); }} style={styles.modalCloseBtn}>
                <AppIcon name={icons.cancel} size={20} iconColor="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Modal Form Fields */}
            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <View style={styles.modalTwoCol}>
                <View style={[styles.modalCol, { flex: 1 }]}>
                  <Text style={styles.modalLabel}>{label('পণ্য কোড (ঐচ্ছিক)', 'Product code (optional)')}</Text>
                  <TextInput
                    value={newCode}
                    onChangeText={setNewCode}
                    testID="stock-product-code"
                    style={styles.modalInput}
                    placeholder={label('কোড', 'Code')}
                    placeholderTextColor="#94A3B8"
                  />
                </View>
                <View style={[styles.modalCol, { flex: 1.6 }]}>
                  <RequiredLabel text={label('পণ্যের নাম', 'Product name')} required style={styles.modalLabel} />
                  <TextInput
                    value={newName}
                    onChangeText={setNewName}
                    testID="stock-product-name"
                    style={styles.modalInput}
                    placeholder={label('পণ্যের নাম লিখুন...', 'Enter product name...')}
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              </View>

              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>{label('প্রতি বস্তায় পরিমাণ (কেজি)', 'Quantity per bag (kg)')}</Text>
                  <TextInput
                    value={newBagKg}
                    onChangeText={setNewBagKg}
                    testID="stock-product-bag-kg"
                    style={styles.modalInput}
                    keyboardType="numeric"
                    placeholder={label('৫০', '50')}
                    placeholderTextColor="#94A3B8"
                  />
                </View>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>{label('প্রারম্ভিক মজুদ (বস্তা)', 'Opening stock (bags)')}</Text>
                  <TextInput
                    value={newOpeningBags}
                    onChangeText={setNewOpeningBags}
                    testID="stock-product-opening"
                    style={styles.modalInput}
                    keyboardType="numeric"
                    placeholder={label('০', '0')}
                    placeholderTextColor="#94A3B8"
                  />
                </View>
              </View>

              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>{label('ক্রয়দর (প্রতি কেজি ৳)', 'Purchase rate (৳/kg)')}</Text>
                  <TextInput
                    value={newCostRate}
                    onChangeText={setNewCostRate}
                    testID="stock-product-cost"
                    style={styles.modalInput}
                    keyboardType="numeric"
                    placeholder="০"
                    placeholderTextColor="#94A3B8"
                  />
                  {parseNum(newCostRate) > 0 && (
                    <Text style={{ fontSize: 11, color: '#64748B', marginTop: 4 }}>
                      প্রতি বস্তা: ৳{toBnDigits(String(Math.round(parseNum(newCostRate) * (parseNum(newBagKg) || 50))))}
                    </Text>
                  )}
                </View>
                <View style={styles.modalCol}>
                  <RequiredLabel text={label('বিক্রয়দর (প্রতি কেজি ৳)', 'Sale rate (৳/kg)')} required style={styles.modalLabel} />
                  <TextInput
                    value={newSalePrice}
                    onChangeText={setNewSalePrice}
                    testID="stock-product-price"
                    style={styles.modalInput}
                    keyboardType="numeric"
                    placeholder="০"
                    placeholderTextColor="#94A3B8"
                  />
                  {parseNum(newSalePrice) > 0 && (
                    <Text style={{ fontSize: 11, color: '#047857', fontWeight: '600', marginTop: 4 }}>
                      প্রতি বস্তা: ৳{toBnDigits(String(Math.round(parseNum(newSalePrice) * (parseNum(newBagKg) || 50))))}
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.modalFormGroup}>
                <Text style={styles.modalLabel}>{label('বিবরণ (ঐচ্ছিক)', 'Description (optional)')}</Text>
                <TextInput
                  value={newDescription}
                  onChangeText={setNewDescription}
                  testID="stock-product-description"
                  style={[styles.modalInput, { height: 65, textAlignVertical: 'top' }]}
                  placeholder={label('পণ্যের অতিরিক্ত বিবরণ লিখুন...', 'Enter an additional description...')}
                  placeholderTextColor="#94A3B8"
                  multiline
                />
              </View>
            </ScrollView>

            {/* Modal Actions */}
            <View style={styles.modalFooter}>
              <TouchableOpacity onPress={() => { setModalOpen(false); setEditingProduct(null); }} style={styles.modalCancelBtn}>
                <AppIcon name={icons.cancel} size={16} iconColor="#475569" />
                <Text style={styles.modalCancelBtnText}>{label('বাতিল', 'Cancel')}</Text>
              </TouchableOpacity>

              {editingProduct && (
                <TouchableOpacity
                  onPress={() => {
                    Alert.alert(
                      label('নিশ্চিত করুন', 'Confirm'),
                      `${label('আপনি কি', 'Move')} '${editingProduct.name}' ${label('পণ্যটি ট্র্যাশে পাঠাতে চান?', 'to Trash?')}`,
                      [
                        { text: label('না', 'No'), style: 'cancel' },
                        {
                          text: label('মুছুন', 'Delete'),
                          style: 'destructive',
                          onPress: async () => {
                            try {
                              await deleteProduct(editingProduct.id);
                              setModalOpen(false);
                              setEditingProduct(null);
                              Alert.alert(t('done'), label('পণ্য সফলভাবে ট্র্যাশে পাঠানো হয়েছে।', 'Product moved to Trash.'));
                            } catch (err) {
                              Alert.alert(t('invalid'), err instanceof Error ? err.message : label('মুছে ফেলা ব্যর্থ হয়েছে।', 'Could not delete the product.'));
                            }
                          },
                        },
                      ]
                    );
                  }}
                  style={[styles.modalCancelBtn, { borderColor: '#FCA5A5', backgroundColor: '#FEF2F2' }]}
                >
                  <AppIcon name={icons.del} size={16} iconColor="#DC2626" />
                  <Text style={[styles.modalCancelBtnText, { color: '#DC2626' }]}>{label('মুছুন', 'Delete')}</Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity onPress={handleSaveProduct} testID="stock-save-product" style={styles.modalSaveBtn}>
                <AppIcon name={icons.save} size={18} iconColor="#fff" />
                <Text style={styles.modalSaveBtnText}>{editingProduct ? label('আপডেট করুন', 'Update') : label('সংরক্ষণ করুন', 'Save')}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* View Details Modal */}
      {viewProduct && (
        <Modal visible={!!viewProduct} transparent animationType="fade" onRequestClose={() => setViewProduct(null)}>
          <View style={styles.modalBackdrop}>
            <View style={[styles.modalBox, { maxWidth: 440 }]}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{viewProduct.name}</Text>
                <TouchableOpacity onPress={() => setViewProduct(null)}>
                  <AppIcon name={icons.cancel} size={20} iconColor="#64748B" />
                </TouchableOpacity>
              </View>
              <View style={{ padding: 20, gap: 10 }}>
                {viewProduct.code ? <Text style={{ fontSize: 14, color: '#334155' }}>Code: {viewProduct.code}</Text> : null}
                {viewProduct.description ? <Text testID="product-details-description" style={{ fontSize: 14, color: '#334155' }}>{viewProduct.description}</Text> : null}
                <Text style={{ fontSize: 14, color: '#334155' }}>
                  {label('বর্তমান মজুদ:', 'Current stock:')} <Text style={{ fontWeight: '700', color: viewProduct.qty < 0 ? '#DC2626' : '#334155' }}>{n(viewProduct.qty)} {label('কেজি', 'kg')}</Text>
                </Text>
                <Text style={{ fontSize: 14, color: '#334155' }}>
                  {label('বস্তার ওজন:', 'Bag weight:')} <Text style={{ fontWeight: '700' }}>{viewProduct.mediumBagKg || 50} {label('কেজি', 'kg')}</Text>
                </Text>
                <Text style={{ fontSize: 14, color: '#334155' }}>
                  {label('আনুমানিক বস্তা:', 'Approx. bags:')} <Text style={{ fontWeight: '700' }}>{Math.round(viewProduct.qty / (viewProduct.mediumBagKg || 50))} {label('বস্তা', 'bags')}</Text>
                </Text>
                <Text style={{ fontSize: 14, color: '#334155' }}>
                  {label('ক্রয়মূল্য:', 'Purchase rate:')} <Text style={{ fontWeight: '700' }}>৳ {viewProduct.cost} / {label('কেজি', 'kg')}</Text>
                </Text>
                <Text style={{ fontSize: 14, color: '#334155' }}>
                  {label('বিক্রয়মূল্য:', 'Sale rate:')} <Text style={{ fontWeight: '700' }}>৳ {viewProduct.price} / {label('কেজি', 'kg')}</Text>
                </Text>
              </View>
              <View style={{ padding: 14, alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: '#D2E3F3' }}>
                <TouchableOpacity onPress={() => setViewProduct(null)} style={styles.modalCancelBtn}>
                  <Text style={styles.modalCancelBtnText}>{label('বন্ধ করুন', 'Close')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {bulkOpen && (
        <BulkUploadModal kind="product" onClose={() => setBulkOpen(false)} />
      )}

      <Modal
        visible={adjustmentHistoryOpen}
        transparent
        animationType="fade"
        onRequestClose={() => { setAdjustmentHistoryOpen(false); setSelectedAdjustment(null); }}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalBox, { maxWidth: 820 }]}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                {selectedAdjustment ? (
                  <TouchableOpacity onPress={() => setSelectedAdjustment(null)} accessibilityLabel={label('ইতিহাসে ফিরুন', 'Back to history')}>
                    <AppIcon name={icons.back} size={20} iconColor="#1c70b9" />
                  </TouchableOpacity>
                ) : <AppIcon name={icons.history} size={21} iconColor="#7C3AED" />}
                <Text style={styles.modalTitle}>{selectedAdjustment ? label('সমন্বয়ের বিস্তারিত', 'Adjustment details') : label('স্টক সমন্বয়ের ইতিহাস', 'Stock adjustment history')}</Text>
              </View>
              <TouchableOpacity onPress={() => { setAdjustmentHistoryOpen(false); setSelectedAdjustment(null); }} style={styles.modalCloseBtn} accessibilityLabel={label('বন্ধ করুন', 'Close')}>
                <AppIcon name={icons.cancel} size={20} iconColor="#64748B" />
              </TouchableOpacity>
            </View>

            {selectedAdjustment ? (
              <ScrollView style={[styles.modalBody, { maxHeight: 560 }]} contentContainerStyle={{ gap: 12 }}>
                <Text style={styles.adjustmentDetailName}>{selectedAdjustment.productName}</Text>
                {selectedAdjustment.productCode ? <Text style={styles.adjustmentDetailText}>{label('পণ্য কোড', 'Product code')}: {selectedAdjustment.productCode}</Text> : null}
                <Text style={styles.adjustmentDetailText}>{label('তারিখ', 'Date')}: {digits(selectedAdjustment.date.split('-').reverse().join('-'))}</Text>
                <Text style={styles.adjustmentDetailText}>{label('সমন্বয়ের পরিমাণ', 'Adjustment quantity')}: <Text style={{ color: selectedAdjustment.quantityKg < 0 ? '#DC2626' : '#059669', fontWeight: '800' }}>{selectedAdjustment.quantityKg > 0 ? '+' : ''}{n(selectedAdjustment.quantityKg)} {label('কেজি', 'kg')}</Text></Text>
                <Text style={styles.adjustmentDetailText}>{label('প্রতি কেজির মূল্য', 'Unit cost')}: ৳{n(selectedAdjustment.unitCost)}</Text>
                <Text style={styles.adjustmentDetailText}>{label('মজুদের মূল্যের প্রভাব', 'Inventory value impact')}: <Text style={{ fontWeight: '800' }}>৳{n(selectedAdjustment.value)}</Text></Text>
                {selectedAdjustment.reason ? <Text style={styles.adjustmentDetailText}>{label('বিবরণ / কারণ', 'Description / reason')}: {selectedAdjustment.reason}</Text> : null}
                <Text style={styles.adjustmentDetailMuted}>{label('রেকর্ডের সময়', 'Recorded at')}: {new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en-GB', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(selectedAdjustment.createdAt))}</Text>
              </ScrollView>
            ) : adjustmentHistoryBusy ? (
              <View style={styles.adjustmentHistoryMessage}><Text style={styles.adjustmentDetailText}>{label('ইতিহাস লোড হচ্ছে…', 'Loading history…')}</Text></View>
            ) : adjustmentHistoryError ? (
              <View style={styles.adjustmentHistoryMessage}><Text style={{ color: '#DC2626' }}>{adjustmentHistoryError}</Text></View>
            ) : adjustmentHistory.length === 0 ? (
              <View style={styles.adjustmentHistoryMessage}><Text style={styles.adjustmentDetailText}>{label('এখনও কোনো স্টক সমন্বয়ের রেকর্ড নেই।', 'No stock adjustment records yet.')}</Text></View>
            ) : (
              <View style={{ padding: 14 }}>
                <View style={styles.adjustmentHistoryHeader}>
                  <Text style={[styles.adjustmentHistoryHeadCell, { flex: 1 }]}>{label('তারিখ', 'Date')}</Text>
                  <Text style={[styles.adjustmentHistoryHeadCell, { flex: 2 }]}>{label('পণ্য', 'Product')}</Text>
                  <Text style={[styles.adjustmentHistoryHeadCell, { flex: 1, textAlign: 'right' }]}>{label('পরিমাণ', 'Quantity')}</Text>
                  <Text style={[styles.adjustmentHistoryHeadCell, { flex: 1, textAlign: 'right' }]}>{label('মূল্য প্রভাব', 'Value impact')}</Text>
                </View>
                <ScrollView style={{ maxHeight: 520 }}>
                  {adjustmentHistory.map(row => (
                    <TouchableOpacity key={row.id} onPress={() => setSelectedAdjustment(row)} style={styles.adjustmentHistoryRow} accessibilityRole="button">
                      <Text style={[styles.adjustmentHistoryCell, { flex: 1 }]}>{digits(row.date.split('-').reverse().join('-'))}</Text>
                      <View style={{ flex: 2, minWidth: 0 }}>
                        <Text style={styles.adjustmentHistoryProduct} numberOfLines={1}>{row.productName}</Text>
                        {row.productCode ? <Text style={styles.adjustmentDetailMuted} numberOfLines={1}>{row.productCode}</Text> : null}
                      </View>
                      <Text style={[styles.adjustmentHistoryCell, { flex: 1, textAlign: 'right', color: row.quantityKg < 0 ? '#DC2626' : '#059669' }]}>{row.quantityKg > 0 ? '+' : ''}{n(row.quantityKg)} {label('কেজি', 'kg')}</Text>
                      <Text style={[styles.adjustmentHistoryCell, { flex: 1, textAlign: 'right' }]}>৳{n(row.value)}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        </View>
      </Modal>

      {/* Stock Adjustment Confirmation Modal */}
      <Modal
        visible={auditConfirmModalOpen}
        transparent
        animationType="fade"
        onRequestClose={() => !isAdjusting && setAuditConfirmModalOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.modalBox, { maxWidth: 680 }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <AppIcon name={icons.stock} size={22} iconColor="#1c70b9" />
                <Text style={styles.modalTitle}>{label('স্টক সমন্বয় নিশ্চিতকরণ', 'Confirm stock adjustment')}</Text>
              </View>
              <TouchableOpacity
                disabled={isAdjusting}
                onPress={() => setAuditConfirmModalOpen(false)}
                style={styles.modalCloseBtn}
              >
                <AppIcon name={icons.cancel} size={20} iconColor="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Modal Body */}
            <ScrollView style={[styles.modalBody, { maxHeight: 520 }]} keyboardShouldPersistTaps="handled">
              {/* Notice Banner */}
              <View style={styles.auditModalNotice}>
                <Text style={styles.auditModalNoticeText}>
                  {label('আপনি', 'You are about to adjust the stock of')} <Text style={{ fontWeight: '800' }}>{digits(itemsToAdjust.length)}</Text> {label('টি পণ্যের বর্তমান মজুদ সংশোধন করতে যাচ্ছেন। এর মাধ্যমে পণ্যের মজুদ সমন্বয় হবে এবং স্টক মুভমেন্ট হিস্ট্রিতে স্থায়ী রেকর্ড সংরক্ষিত হবে।', 'products. This updates inventory and creates a permanent stock movement record.')}
                </Text>
              </View>

              {/* KPI Summary Grid */}
              <View style={styles.auditModalSummaryRow}>
                <View style={styles.auditModalSummaryCard}>
                  <Text style={styles.auditModalSummaryLabel}>{label('সমন্বয়কৃত পণ্য', 'Products to adjust')}</Text>
                  <Text style={styles.auditModalSummaryVal}>{digits(itemsToAdjust.length)}</Text>
                </View>
                <View style={styles.auditModalSummaryCard}>
                  <Text style={styles.auditModalSummaryLabel}>{label('মোট ওজন তারতম্য', 'Total weight difference')}</Text>
                  <Text
                    style={[
                      styles.auditModalSummaryVal,
                      { color: auditSummary.totalDeltaKg < 0 ? '#DC2626' : auditSummary.totalDeltaKg > 0 ? '#16A34A' : '#0F172A' },
                    ]}
                  >
                    {auditSummary.totalDeltaKg > 0 ? '+' : ''}{digits(Math.round(auditSummary.totalDeltaKg).toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))} {label('কেজি', 'kg')}
                  </Text>
                </View>
                <View style={styles.auditModalSummaryCard}>
                  <Text style={styles.auditModalSummaryLabel}>{label('মোট আর্থিক প্রভাব', 'Total financial impact')}</Text>
                  <Text
                    style={[
                      styles.auditModalSummaryVal,
                      { color: auditSummary.totalDeltaValue < 0 ? '#DC2626' : auditSummary.totalDeltaValue > 0 ? '#16A34A' : '#0F172A' },
                    ]}
                  >
                    {auditSummary.totalDeltaValue > 0 ? '+' : ''}৳{digits(Math.round(Math.abs(auditSummary.totalDeltaValue)).toLocaleString(lang === 'bn' ? 'en-IN' : 'en-US'))}
                  </Text>
                </View>
              </View>

              {/* Audit Note */}
              <View style={styles.modalFormGroup}>
                <RequiredLabel text={label('অডিট সমন্বয়ের কারণ বা রেফারেন্স নোট', 'Reason or reference note')} required style={styles.modalLabel} />
                <TextInput
                  value={auditNote}
                  onChangeText={setAuditNote}
                  style={styles.modalInput}
                  placeholder={label('যেমন: গুদাম নিরীক্ষা ও বার্ষিক স্টক সমন্বয়', 'Example: warehouse count and annual stock adjustment')}
                />
              </View>

              {/* Preview Table of Adjustments */}
              <Text style={[styles.modalLabel, { marginTop: 6, marginBottom: 8 }]}>
                {label('সমন্বয়যোগ্য পণ্যসমূহের বিবরণ:', 'Products to be adjusted:')}
              </Text>
              <View style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, overflow: 'hidden' }}>
                <View style={[styles.tableHeaderRow, { backgroundColor: '#F1F5F9' }]}>
                  <Text style={[styles.th, { flex: 2 }]}>{label('পণ্য', 'Product')}</Text>
                  <Text style={[styles.th, { flex: 1.1, textAlign: 'right' }]}>{label('বর্তমান (কেজি)', 'Current (kg)')}</Text>
                  <Text style={[styles.th, { flex: 1.1, textAlign: 'right' }]}>{label('বাস্তব (কেজি)', 'Counted (kg)')}</Text>
                  <Text style={[styles.th, { flex: 1.1, textAlign: 'right' }]}>{label('পার্থক্য (কেজি)', 'Difference (kg)')}</Text>
                  <Text style={[styles.th, { flex: 1.3, textAlign: 'right' }]}>{label('আর্থিক প্রভাব (৳)', 'Financial impact (৳)')}</Text>
                </View>
                {itemsToAdjust.map(it => (
                  <View key={it.id} style={[styles.tableDataRow, { paddingVertical: 8 }]}>
                    <View style={[styles.td, { flex: 2 }]}>
                      <Text style={styles.cellName}>{it.name}</Text>
                      {it.reason ? (
                        <Text style={{ fontSize: 11, color: '#64748B', marginTop: 1 }}>
                          {label('কারণ:', 'Reason:')} {it.reason}
                        </Text>
                      ) : null}
                    </View>
                    <View style={[styles.td, { flex: 1.1, alignItems: 'flex-end' }]}>
                      <Text style={styles.cellText}>
                        {toBnDigits(Math.round(it.systemKg).toLocaleString('en-IN'))}
                      </Text>
                    </View>
                    <View style={[styles.td, { flex: 1.1, alignItems: 'flex-end' }]}>
                      <Text style={[styles.cellBold, { color: '#0F172A' }]}>
                        {toBnDigits(Math.round(it.physicalKg!).toLocaleString('en-IN'))}
                      </Text>
                    </View>
                    <View style={[styles.td, { flex: 1.1, alignItems: 'flex-end' }]}>
                      <Text
                        style={[
                          styles.cellBold,
                          { color: it.deltaKg >= 0 ? '#16A34A' : '#DC2626' },
                        ]}
                      >
                        {it.deltaKg > 0 ? '+' : ''}
                        {toBnDigits(Math.round(it.deltaKg).toLocaleString('en-IN'))}
                      </Text>
                    </View>
                    <View style={[styles.td, { flex: 1.3, alignItems: 'flex-end' }]}>
                      <Text
                        style={[
                          styles.cellBold,
                          { color: it.deltaValue >= 0 ? '#16A34A' : '#DC2626' },
                        ]}
                      >
                        {it.deltaValue > 0 ? '+' : ''}৳
                        {toBnDigits(Math.round(Math.abs(it.deltaValue)).toLocaleString('en-IN'))}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            </ScrollView>

            {/* Modal Actions */}
            <View style={styles.modalFooter}>
              <TouchableOpacity
                disabled={isAdjusting}
                onPress={() => setAuditConfirmModalOpen(false)}
                style={styles.modalCancelBtn}
              >
                <Text style={styles.modalCancelBtnText}>{label('বাতিল', 'Cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={isAdjusting}
                onPress={handleApplyStockAdjustment}
                style={[styles.modalSaveBtn, { backgroundColor: '#15803D' }]}
              >
                <AppIcon name={icons.done} size={18} iconColor="#fff" />
                <Text style={styles.modalSaveBtnText}>
                  {isAdjusting ? label('সমন্বয় করা হচ্ছে...', 'Applying adjustment...') : label('নিশ্চিত ও সমন্বয় সংরক্ষণ করুন', 'Confirm and save adjustment')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F0F6FC',
  },
  contentContainer: {
    padding: 18,
    paddingBottom: 40,
  },
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
  titleIconBadge: {
    width: 40,
    height: 40,
    borderRadius: 12,
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
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  liveTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.35)',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#86EFAC',
  },
  liveTagText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  headerSub: {
    color: '#DCEBFA',
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 2,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 2,
  },
  headerBulkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#15803D',
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0, 0, 0, 0.25)',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  headerAddBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0, 0, 0, 0.25)',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  headerAddBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
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
    borderColor: '#D2E3F3',
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
    backgroundColor: '#1c70b9',
  },
  tabBtnInactive: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D2E3F3',
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
  rightActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addProductGreenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1c70b9',
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  addProductGreenBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  outlineActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D2E3F3',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  outlineActionBtnText: {
    fontSize: 13,
    fontWeight: '600',
  },
  warehouseSelector: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#D2E3F3',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  warehouseSelectorText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '600',
  },
  dropdownPopup: {
    position: 'absolute',
    top: 46,
    right: 0,
    width: 170,
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D2E3F3',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 8,
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
    fontWeight: '500',
  },
  filterCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 10,
    borderWidth: 1,
    borderColor: '#D2E3F3',
    marginBottom: 16,
    gap: 12,
  },
  searchInputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
  },
  filterTextInput: {
    flex: 1,
    fontSize: 14,
    color: '#0F172A',
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  categoryDropdownWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderLeftWidth: 1,
    borderLeftColor: '#D2E3F3',
  },
  categoryDropdownText: {
    fontSize: 13,
    color: '#334155',
    fontWeight: '500',
  },
  tableCard: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#D2E3F3',
    overflow: 'hidden',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
    borderBottomWidth: 1,
    borderBottomColor: '#D2E3F3',
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
    color: '#334155',
  },
  cellName: {
    fontSize: 14,
    color: '#0F172A',
    fontWeight: '500',
  },
  cellText: {
    fontSize: 13,
    color: '#334155',
  },
  eyeActionButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#E0F0FE',
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
    backgroundColor: '#1c70b9',
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
    maxWidth: 540,
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
    borderBottomColor: '#D2E3F3',
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
  modalCloseBtn: {
    padding: 4,
  },
  modalBody: {
    padding: 18,
    maxHeight: 460,
  },
  adjustmentHistoryMessage: {
    minHeight: 120,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  adjustmentHistoryHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    backgroundColor: '#EAF2FC',
    borderRadius: 8,
    marginBottom: 4,
  },
  adjustmentHistoryHeadCell: {
    fontSize: 12,
    fontWeight: '800',
    color: '#334155',
  },
  adjustmentHistoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 54,
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  adjustmentHistoryCell: {
    fontSize: 13,
    color: '#334155',
  },
  adjustmentHistoryProduct: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  adjustmentDetailName: {
    fontSize: 18,
    fontWeight: '800',
    color: '#0F172A',
  },
  adjustmentDetailText: {
    fontSize: 14,
    lineHeight: 21,
    color: '#334155',
  },
  adjustmentDetailMuted: {
    fontSize: 12,
    color: '#64748B',
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
  modalFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 12,
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#D2E3F3',
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
    backgroundColor: '#1c70b9',
    borderRadius: 8,
    paddingHorizontal: 18,
    paddingVertical: 8,
  },
  modalSaveBtnText: {
    fontSize: 13,
    color: '#fff',
    fontWeight: '700',
  },
  // Audit UI styles
  discrepancyToggleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#D2E3F3',
    backgroundColor: '#fff',
  },
  discrepancyToggleBtnActive: {
    backgroundColor: '#FEF2F2',
    borderColor: '#FCA5A5',
  },
  discrepancyDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#94A3B8',
  },
  discrepancyToggleText: {
    fontSize: 12.5,
    fontWeight: '600',
    color: '#475569',
  },
  discrepancyToggleTextActive: {
    color: '#DC2626',
    fontWeight: '700',
  },
  auditCodeBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: '#1c70b9',
    backgroundColor: '#E0F0FE',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  auditBagWeightBadge: {
    fontSize: 11,
    color: '#64748B',
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  auditTableCellInput: {
    height: 38,
    width: '100%',
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
    paddingHorizontal: 6,
    paddingVertical: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  auditTableCellInputShortage: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FFF5F5',
    color: '#DC2626',
  },
  auditTableCellInputSurplus: {
    borderColor: '#86EFAC',
    backgroundColor: '#F0FDF4',
    color: '#15803D',
  },
  auditReasonInput: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 38,
    fontSize: 13,
    color: '#0F172A',
    width: '100%',
    paddingVertical: 0,
    ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as any) : {}),
  },
  shortageRow: {
    backgroundColor: '#FFF7F7',
  },
  surplusRow: {
    backgroundColor: '#F7FCF8',
  },
  matchBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  matchBadgeText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: '#64748B',
  },
  surplusBadge: {
    alignItems: 'flex-end',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  surplusBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
  },
  surplusSubText: {
    fontSize: 10,
    color: '#166534',
  },
  shortageBadge: {
    alignItems: 'flex-end',
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  shortageBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
  },
  shortageSubText: {
    fontSize: 10,
    color: '#991B1B',
  },
  auditBottomActionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginTop: 14,
    borderWidth: 1,
    borderColor: '#D2E3F3',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 4px 16px rgba(0, 0, 0, 0.08)',
    } as any : {}),
  },
  auditBottomSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  auditBottomItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  auditBottomLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  auditBottomValue: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F172A',
  },
  auditDivider: {
    width: 1,
    height: 18,
    backgroundColor: '#E2E8F0',
  },
  applyAdjustmentBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#15803D',
    borderRadius: 10,
    paddingHorizontal: 20,
    paddingVertical: 11,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.4)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0, 0, 0, 0.2)',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  applyAdjustmentBtnDisabled: {
    backgroundColor: '#94A3B8',
    opacity: 0.6,
  },
  applyAdjustmentBtnText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  auditModalNotice: {
    backgroundColor: '#FEF3C7',
    borderLeftWidth: 4,
    borderLeftColor: '#D97706',
    borderRadius: 6,
    padding: 12,
    marginBottom: 16,
  },
  auditModalNoticeText: {
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
  },
  auditModalSummaryRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  auditModalSummaryCard: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  auditModalSummaryLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginBottom: 4,
  },
  auditModalSummaryVal: {
    fontSize: 16,
    fontWeight: '800',
    color: '#0F172A',
  },
});
