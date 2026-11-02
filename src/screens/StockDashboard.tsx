import React, { useState, useMemo, useEffect, useRef } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal, Platform, Alert } from 'react-native';
import { useApp, Product } from '../store';
import { toBnDigits, useNum } from '../ui';
import { toEnDigits, normalizeInput } from '../bn';
import { AppIcon, icons } from '../icons';
import { BulkUploadModal } from '../BulkUploadModal';
import {
  exportStockExcel,
  exportStockPDF,
  exportAuditExcel,
  exportAuditPDF,
  AuditRow,
} from '../stockReport';

export function StockDashboard() {
  const { t, products, stockTx, saveProduct, adjustStock } = useApp();
  const n = useNum();

  // Active view tab: 'products' | 'movements' | 'audit'
  const [activeTab, setActiveTab] = useState<'products' | 'movements' | 'audit'>('products');

  // Search & filter
  const [searchQuery, setSearchQuery] = useState('');

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 10;

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

  const openNewProduct = () => {
    setEditingProduct(null);
    setNewCode('');
    setNewName('');
    setNewUnit('বস্তা');
    setNewBagKg('');
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
    setNewOpeningBags(String(product.opening / bagKg));
    setNewCostRate(String(product.cost));
    setNewSalePrice(String(product.price));
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
      };
    });
  }, [products]);

  // Aggregate KPI summary
  const totalBags = useMemo(() => stockData.reduce((s, it) => s + it.bags, 0), [stockData]);
  const totalKg = useMemo(() => stockData.reduce((s, it) => s + it.totalKg, 0), [stockData]);
  const totalValuation = useMemo(() => stockData.reduce((s, it) => s + it.stockVal, 0), [stockData]);

  // Filtered rows for Product list
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return stockData;
    return stockData.filter(
      r => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
    );
  }, [stockData, searchQuery]);

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
    const q = searchQuery.trim().toLowerCase();
    let list = auditRows;
    if (showOnlyDiscrepancies) {
      list = list.filter(r => r.physicalKg !== null && Math.abs(r.deltaKg) >= 0.01);
    }
    if (q) {
      list = list.filter(r => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
    }
    return list;
  }, [auditRows, showOnlyDiscrepancies, searchQuery]);

  // Pagination for current view
  const currentTotalRows = activeTab === 'audit' ? filteredAuditRows.length : filteredRows.length;
  const totalPages = Math.max(1, Math.ceil(currentTotalRows / pageSize));

  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  const pagedAuditRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredAuditRows.slice(start, start + pageSize);
  }, [filteredAuditRows, page, pageSize]);

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
    });
    if (!ok && Platform.OS !== 'web') {
      Alert.alert('অডিট রিপোর্ট', 'পিডিএফ রিপোর্ট তৈরি করা হয়েছে।');
    }
  };

  const handleExportAuditExcel = () => {
    const ok = exportAuditExcel({
      auditRows: filteredAuditRows,
      summary: auditSummary,
    });
    if (!ok && Platform.OS !== 'web') {
      Alert.alert('অডিট শিট', 'এক্সেল ফাইল ডাউনলোড সম্পন্ন হয়েছে।');
    }
  };

  const handleApplyStockAdjustment = async () => {
    if (itemsToAdjust.length === 0) {
      Alert.alert('সতর্কতা', 'সমন্বয় করার মতো কোনো গরমিল বা পরিবর্তন পাওয়া যায়নি। বাস্তব গণনায় পরিবর্তন আনুন।');
      return;
    }
    setIsAdjusting(true);
    try {
      const payloadItems = itemsToAdjust.map(it => ({
        productId: it.id,
        physicalQtyKg: it.physicalKg!,
        deltaKg: it.deltaKg,
        reason: it.reason || auditNote,
      }));
      await adjustStock({
        items: payloadItems,
        note: auditNote,
      });
      setAuditConfirmModalOpen(false);
      handleClearAudit();
      Alert.alert('সফল', `${itemsToAdjust.length} টি পণ্যের স্টক সমন্বয় সফলভাবে সম্পন্ন হয়েছে।`);
    } catch (err) {
      Alert.alert('ত্রুটি', err instanceof Error ? err.message : 'স্টক সমন্বয় ব্যর্থ হয়েছে।');
    } finally {
      setIsAdjusting(false);
    }
  };

  // Save new product from modal
  const handleSaveProduct = async () => {
    if (!newName.trim()) {
      Alert.alert(t('invalid'), 'পণ্যের নাম আবশ্যক।');
      return;
    }

    const bagKg = parseFloat(newBagKg);
    if (!Number.isFinite(bagKg) || bagKg <= 0) {
      Alert.alert(t('invalidBag'));
      return;
    }
    const openingBags = parseFloat(newOpeningBags) || 0;
    const cost = parseFloat(newCostRate) || 0;
    const price = parseFloat(newSalePrice);
    if (!Number.isFinite(price) || price <= 0) {
      Alert.alert(t('invalidSalePrice'));
      return;
    }
    const openingKg = openingBags * bagKg;

    try {
      await saveProduct({
        id: editingProduct?.id ?? `p_${Date.now()}`,
        code: newCode.trim(),
        name: newName.trim(),
        description: newDescription.trim(),
        cost,
        price: Math.round(price * 100) / 100,
        opening: openingKg,
        qty: openingKg,
        uom: newUnit,
        smallBagKg: 25,
        mediumBagKg: bagKg,
        largeBagKg: 50,
      });

      setModalOpen(false);
      setEditingProduct(null);
      setNewName('');
      setNewCode('');
      setNewOpeningBags('');
      setNewCostRate('');
      setNewSalePrice('');
      setNewDescription('');
      Alert.alert(t('done'), 'নতুন পণ্য সফলভাবে যোগ করা হয়েছে।');
    } catch (err) {
      Alert.alert(t('invalid'), err instanceof Error ? err.message : 'সংরক্ষণ ব্যর্থ হয়েছে।');
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
    });
    if (!ok && Platform.OS !== 'web') {
      Alert.alert('এক্সেল', 'ফাইল ডাউনলোড সম্পন্ন হয়েছে।');
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
    });
    if (!ok && Platform.OS !== 'web') {
      Alert.alert('পিডিএফ', 'পিডিএফ রিপোর্ট তৈরি করা হয়েছে।');
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
              <Text style={styles.headerTitle}>মজুদ চাল ও স্টক বিবরণ</Text>
              <View style={styles.liveTag}>
                <View style={styles.liveDot} />
                <Text style={styles.liveTagText}>সক্রিয়</Text>
              </View>
            </View>
            <Text style={styles.headerSub}>পাইকারি চালের বর্তমান স্টক হিসাব ও নিরীক্ষা</Text>
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
            <Text style={styles.headerAddBtnText}>বাল্ক পণ্য আপলোড</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={openNewProduct}
            testID="stock-add-product"
            style={styles.headerAddBtn}
            activeOpacity={0.85}
          >
            <AppIcon name={icons.plus} size={18} iconColor="#FFFFFF" />
            <Text style={styles.headerAddBtnText}>নতুন পণ্য</Text>
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
            <Text style={styles.kpiLabel}>মোট মজুদ (বস্তা)</Text>
            <Text style={styles.kpiValue}>{toBnDigits(totalBags.toLocaleString('en-IN'))} বস্তা</Text>
          </View>
        </View>

        {/* Card 2: Total KG */}
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#E3F2FD' }]}>
            <AppIcon name={icons.products} size={26} iconColor="#1976D2" />
          </View>
          <View style={styles.kpiInfo}>
            <Text style={styles.kpiLabel}>মোট মজুদ (কেজি)</Text>
            <Text style={styles.kpiValue}>{toBnDigits(Math.round(totalKg).toLocaleString('en-IN'))} কেজি</Text>
          </View>
        </View>

        {/* Card 3: Total Valuation */}
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#FEF3C7' }]}>
            <AppIcon name={icons.profit} size={26} iconColor="#D97706" />
          </View>
          <View style={styles.kpiInfo}>
            <Text style={styles.kpiLabel}>মোট মজুদ মূল্যায়ন</Text>
            <Text style={styles.kpiValue}>৳{toBnDigits(Math.round(totalValuation).toLocaleString('en-IN'))}</Text>
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
              পণ্য তালিকা
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
              স্টক মুভমেন্ট
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
              স্টক অডিট ও সমন্বয়
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.rightActionGroup}>
          {activeTab === 'audit' ? (
            <>
              <TouchableOpacity
                onPress={handlePreFillWithSystem}
                style={[styles.outlineActionBtn, { borderColor: '#1c70b9', backgroundColor: '#F0F7FF' }]}
                accessibilityLabel="সিস্টেম মজুদ দিয়ে অটো পূরণ"
              >
                <AppIcon name={icons.transfer} size={16} iconColor="#1c70b9" />
                <Text style={[styles.outlineActionBtnText, { color: '#1c70b9', fontWeight: '700' }]}>অটো-পূরণ</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleClearAudit}
                style={[styles.outlineActionBtn, { borderColor: '#94A3B8' }]}
                accessibilityLabel="অডিট গণনা খালি করুন"
              >
                <AppIcon name={icons.cancel} size={16} iconColor="#64748B" />
                <Text style={[styles.outlineActionBtnText, { color: '#64748B', fontWeight: '600' }]}>মুছুন</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleExportAuditPDF}
                style={[styles.outlineActionBtn, { borderColor: '#DC2626' }]}
                testID="stock-audit-pdf"
                accessibilityLabel="অডিট রিপোর্ট ডাউনলোড (PDF)"
              >
                <AppIcon name={icons.print} size={18} iconColor="#DC2626" />
                <Text style={[styles.outlineActionBtnText, { color: '#DC2626', fontWeight: '700' }]}>অডিট রিপোর্ট (PDF)</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleExportAuditExcel}
                style={[styles.outlineActionBtn, { borderColor: '#16A34A' }]}
                testID="stock-audit-excel"
                accessibilityLabel="অডিট শিট ডাউনলোড (Excel)"
              >
                <AppIcon name={icons.excel} size={18} iconColor="#16A34A" />
                <Text style={[styles.outlineActionBtnText, { color: '#16A34A', fontWeight: '700' }]}>অডিট শিট (Excel)</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <TouchableOpacity onPress={() => setModalOpen(true)} style={styles.addProductGreenBtn}>
                <AppIcon name={icons.add} size={18} iconColor="#fff" />
                <Text style={styles.addProductGreenBtnText}>পণ্য যোগ করুন</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleExportPDF}
                style={[styles.outlineActionBtn, { borderColor: '#DC2626' }]}
                testID="stock-pdf-download"
                accessibilityLabel="পিডিএফ রিপোর্ট ডাউনলোড"
              >
                <AppIcon name={icons.print} size={18} iconColor="#DC2626" />
                <Text style={[styles.outlineActionBtnText, { color: '#DC2626', fontWeight: '700' }]}>পিডিএফ রিপোর্ট</Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={handleExportExcel}
                style={[styles.outlineActionBtn, { borderColor: '#16A34A' }]}
                testID="stock-excel-download"
                accessibilityLabel="এক্সেল ডাউনলোড"
              >
                <AppIcon name={icons.excel} size={18} iconColor="#16A34A" />
                <Text style={[styles.outlineActionBtnText, { color: '#16A34A', fontWeight: '700' }]}>এক্সেল ডাউনলোড</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* Filter and Search Bar */}
      <View style={styles.filterCard}>
        <View style={styles.searchInputWrap}>
          <AppIcon name={icons.search} size={18} iconColor="#94A3B8" />
          <TextInput
            value={searchQuery}
            onChangeText={v => {
              setSearchQuery(v);
              setPage(1);
            }}
            style={styles.filterTextInput}
            placeholder={activeTab === 'audit' ? 'অডিট তালিকায় পণ্য কোড বা নাম দিয়ে খুঁজুন...' : 'পণ্য কোড বা পণ্যের নাম দিয়ে খুঁজুন...'}
          />
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
              শুধু অমিলগুলো দেখান ({toBnDigits(String(auditSummary.discrepancyCount))})
            </Text>
          </TouchableOpacity>
        ) : (
          <View style={styles.categoryDropdownWrap}>
            <Text style={styles.categoryDropdownText}>সব পণ্য</Text>
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
              <Text style={[styles.th, { flex: 1.2 }]}>পণ্য কোড</Text>
              <Text style={[styles.th, { flex: 2.2 }]}>পণ্যের নাম</Text>
              
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>মজুদ (বস্তা)</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>মজুদ (কেজি)</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>স্টক মূল্য (৳)</Text>
              <Text style={[styles.th, { width: 112, textAlign: 'center' }]}>অ্যাকশন</Text>
            </View>

            {/* Table Rows */}
            {pagedRows.map((row, idx) => (
              <View key={row.id} style={styles.tableDataRow}>
                <View style={[styles.td, { width: 50, alignItems: 'center' }]}>
                  <Text style={styles.cellMuted}>{(page - 1) * pageSize + idx + 1}</Text>
                </View>

                <View style={[styles.td, { flex: 1.2 }]}>
                  <Text style={styles.cellBold}>{toBnDigits(row.code)}</Text>
                </View>

                <View style={[styles.td, { flex: 2.2 }]}>
                  <Text style={styles.cellName}>{row.name}</Text>
                </View>

                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={[styles.cellBold, { color: '#0F172A' }]}>{toBnDigits(row.bags.toLocaleString('en-IN'))}</Text>
                </View>

                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={styles.cellText}>{toBnDigits(Math.round(row.totalKg).toLocaleString('en-IN'))}</Text>
                </View>

                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={[styles.cellBold, { color: '#1c70b9' }]}>
                    ৳{toBnDigits(Math.round(row.stockVal).toLocaleString('en-IN'))}
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
              <Text style={[styles.th, { flex: 1.2 }]}>তারিখ</Text>
              <Text style={[styles.th, { flex: 2 }]}>পণ্যের নাম</Text>
              <Text style={[styles.th, { flex: 1.5 }]}>ধরন</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>পরিমাণ (কেজি)</Text>
            </View>
            {stockTx.slice(0, 15).map((mv, idx) => (
              <View key={mv.id} style={styles.tableDataRow}>
                <View style={[styles.td, { width: 50, alignItems: 'center' }]}>
                  <Text style={styles.cellMuted}>{idx + 1}</Text>
                </View>
                <View style={[styles.td, { flex: 1.2 }]}>
                  <Text style={styles.cellText}>{toBnDigits(mv.date)}</Text>
                </View>
                <View style={[styles.td, { flex: 2 }]}>
                  <Text style={styles.cellName}>{mv.productName || 'পণ্য'}</Text>
                </View>
                <View style={[styles.td, { flex: 1.5 }]}>
                  <Text style={styles.cellBold}>{mv.type}</Text>
                </View>
                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={[styles.cellBold, { color: mv.qty >= 0 ? '#16A34A' : '#DC2626' }]}>
                    {toBnDigits(String(mv.qty))}
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
              <Text style={[styles.th, { flex: 2 }]}>পণ্য ও সাইজ</Text>
              <Text style={[styles.th, { width: 125, textAlign: 'right' }]}>সিস্টেম মজুদ</Text>
              <Text style={[styles.th, { width: 110, textAlign: 'center' }]}>বাস্তব বস্তা</Text>
              <Text style={[styles.th, { width: 120, textAlign: 'center' }]}>বাস্তব কেজি</Text>
              <Text style={[styles.th, { width: 120, textAlign: 'right' }]}>পার্থক্য</Text>
              <Text style={[styles.th, { width: 110, textAlign: 'right' }]}>আর্থিক প্রভাব</Text>
              <Text style={[styles.th, { flex: 1.6 }]}>কারণ / মন্তব্য</Text>
            </View>

            {pagedAuditRows.length === 0 ? (
              <View style={{ padding: 36, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 14, color: '#64748B', fontWeight: '500' }}>
                  {showOnlyDiscrepancies ? 'কোনো অমিলযুক্ত পণ্য পাওয়া যায়নি।' : 'কোনো পণ্য পাওয়া যায়নি।'}
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
                        {row.code ? <Text style={styles.auditCodeBadge}>{toBnDigits(row.code)}</Text> : null}
                        <Text style={styles.auditBagWeightBadge}>{toBnDigits(String(row.bagKg))} কেজি বস্তা</Text>
                      </View>
                    </View>

                    <View style={[styles.td, { width: 125, alignItems: 'flex-end' }]}>
                      <Text style={[styles.cellBold, { color: '#0F172A' }]}>
                        {toBnDigits(row.systemBags.toLocaleString('en-IN'))} বস্তা
                      </Text>
                      <Text style={{ fontSize: 11.5, color: '#64748B', marginTop: 1 }}>
                        {toBnDigits(Math.round(row.systemKg).toLocaleString('en-IN'))} কেজি
                      </Text>
                    </View>

                    <View style={[styles.td, { width: 110, alignItems: 'center' }]}>
                      <TextInput
                        value={physicalBagsMap[row.id] !== undefined ? physicalBagsMap[row.id] : String(row.systemBags)}
                        onChangeText={val => handleBagsChange(row.id, val, row.bagKg)}
                        placeholder={toBnDigits(String(row.systemBags))}
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
                        placeholder={toBnDigits(String(Math.round(row.systemKg)))}
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
                          <Text style={styles.matchBadgeText}>✓ মিলেছে</Text>
                        </View>
                      ) : isSurplus ? (
                        <View style={styles.surplusBadge}>
                          <Text style={styles.surplusBadgeText}>
                            +{toBnDigits(String(row.deltaBags))} বস্তা
                          </Text>
                          <Text style={styles.surplusSubText}>
                            (+{toBnDigits(Math.round(row.deltaKg).toLocaleString('en-IN'))} কেজি)
                          </Text>
                        </View>
                      ) : (
                        <View style={styles.shortageBadge}>
                          <Text style={styles.shortageBadgeText}>
                            {toBnDigits(String(row.deltaBags))} বস্তা
                          </Text>
                          <Text style={styles.shortageSubText}>
                            ({toBnDigits(Math.round(row.deltaKg).toLocaleString('en-IN'))} কেজি)
                          </Text>
                        </View>
                      )}
                    </View>

                    <View style={[styles.td, { width: 110, alignItems: 'flex-end' }]}>
                      {!hasCount || isMatched ? (
                        <Text style={{ fontSize: 13, color: '#94A3B8' }}>৳০</Text>
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
                        placeholder="মন্তব্য / কারণ..."
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
            মোট {toBnDigits(String(currentTotalRows))} টি পণ্য দেখানো হচ্ছে
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

      {/* Bottom Action Bar for Manual Stock Adjustment */}
      {activeTab === 'audit' && (
        <View style={styles.auditBottomActionBar}>
          <View style={styles.auditBottomSummary}>
            <View style={styles.auditBottomItem}>
              <Text style={styles.auditBottomLabel}>অডিটকৃত পণ্য:</Text>
              <Text style={styles.auditBottomValue}>{toBnDigits(String(auditSummary.totalItems))} টি</Text>
            </View>
            <View style={styles.auditDivider} />
            <View style={styles.auditBottomItem}>
              <Text style={styles.auditBottomLabel}>পার্থক্যযুক্ত পণ্য:</Text>
              <Text style={[styles.auditBottomValue, { color: auditSummary.discrepancyCount > 0 ? '#DC2626' : '#16A34A' }]}>
                {toBnDigits(String(auditSummary.discrepancyCount))} টি
              </Text>
            </View>
            <View style={styles.auditDivider} />
            <View style={styles.auditBottomItem}>
              <Text style={styles.auditBottomLabel}>ওজন তারতম্য:</Text>
              <Text style={[styles.auditBottomValue, { color: auditSummary.totalDeltaKg < 0 ? '#DC2626' : auditSummary.totalDeltaKg > 0 ? '#16A34A' : '#0F172A' }]}>
                {auditSummary.totalDeltaKg > 0 ? '+' : ''}{toBnDigits(Math.round(auditSummary.totalDeltaKg).toLocaleString('en-IN'))} কেজি
              </Text>
            </View>
            <View style={styles.auditDivider} />
            <View style={styles.auditBottomItem}>
              <Text style={styles.auditBottomLabel}>আর্থিক প্রভাব:</Text>
              <Text style={[styles.auditBottomValue, { color: auditSummary.totalDeltaValue < 0 ? '#DC2626' : auditSummary.totalDeltaValue > 0 ? '#16A34A' : '#0F172A' }]}>
                {auditSummary.totalDeltaValue > 0 ? '+' : ''}৳{toBnDigits(Math.round(Math.abs(auditSummary.totalDeltaValue)).toLocaleString('en-IN'))}
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
              স্টক সমন্বয় প্রয়োগ করুন ({toBnDigits(String(itemsToAdjust.length))} টি)
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Add Product Modal (Bengali Inventory Product Modal UI.png) */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <AppIcon name={icons.products} size={22} iconColor="#1c70b9" />
                <Text style={styles.modalTitle}>{editingProduct ? 'পণ্য সম্পাদনা' : 'নতুন পণ্য যোগ করুন'}</Text>
              </View>
              <TouchableOpacity onPress={() => setModalOpen(false)} style={styles.modalCloseBtn}>
                <AppIcon name={icons.cancel} size={20} iconColor="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Modal Form Fields */}
            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>পণ্য কোড</Text>
                  <TextInput
                    value={newCode}
                    onChangeText={setNewCode}
                    testID="stock-product-code"
                    style={styles.modalInput}
                  />
                </View>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>পণ্যের নাম *</Text>
                  <TextInput
                    value={newName}
                    onChangeText={setNewName}
                    testID="stock-product-name"
                    style={styles.modalInput}
                    placeholder="খুদ চাল"
                  />
                </View>
              </View>

              <View style={styles.modalCol}>
                <Text style={styles.modalLabel}>প্রতি বস্তায় পরিমাণ (কেজি) *</Text>
                <TextInput
                  value={newBagKg}
                  onChangeText={setNewBagKg}
                  testID="stock-product-bag-kg"
                  style={styles.modalInput}
                  keyboardType="numeric"
                  placeholder="৫০"
                />
              </View>

              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>প্রারম্ভিক মজুদ (বস্তা)</Text>
                  <TextInput
                    value={newOpeningBags}
                    onChangeText={setNewOpeningBags}
                    testID="stock-product-opening"
                    style={styles.modalInput}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>ক্রয়মূল্য (৳)</Text>
                  <TextInput
                    value={newCostRate}
                    onChangeText={setNewCostRate}
                    testID="stock-product-cost"
                    style={styles.modalInput}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>বিক্রয়মূল্য (৳) *</Text>
                  <TextInput
                    value={newSalePrice}
                    onChangeText={setNewSalePrice}
                    testID="stock-product-price"
                    style={styles.modalInput}
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.modalFormGroup}>
                <Text style={styles.modalLabel}>বিবরণ (ঐচ্ছিক)</Text>
                <TextInput
                  value={newDescription}
                  onChangeText={setNewDescription}
                  testID="stock-product-description"
                  style={[styles.modalInput, { height: 75, textAlignVertical: 'top' }]}
                  placeholder="পণ্যের অতিরিক্ত বিবরণ লিখুন..."
                  multiline
                />
              </View>
            </ScrollView>

            {/* Modal Actions */}
            <View style={styles.modalFooter}>
              <TouchableOpacity onPress={() => setModalOpen(false)} style={styles.modalCancelBtn}>
                <AppIcon name={icons.cancel} size={16} iconColor="#475569" />
                <Text style={styles.modalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleSaveProduct} testID="stock-save-product" style={styles.modalSaveBtn}>
                <AppIcon name={icons.save} size={18} iconColor="#fff" />
                <Text style={styles.modalSaveBtnText}>সংরক্ষণ করুন</Text>
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
                  বর্তমান মজুদ: <Text style={{ fontWeight: '700' }}>{n(viewProduct.qty)} কেজি</Text>
                </Text>
                <Text style={{ fontSize: 14, color: '#334155' }}>
                  বস্তার ওজন: <Text style={{ fontWeight: '700' }}>{viewProduct.mediumBagKg || 50} কেজি</Text>
                </Text>
                <Text style={{ fontSize: 14, color: '#334155' }}>
                  আনুমানিক বস্তা: <Text style={{ fontWeight: '700' }}>{Math.round(viewProduct.qty / (viewProduct.mediumBagKg || 50))} বস্তা</Text>
                </Text>
                <Text style={{ fontSize: 14, color: '#334155' }}>
                  ক্রয়মূল্য: <Text style={{ fontWeight: '700' }}>৳ {viewProduct.cost} / কেজি</Text>
                </Text>
                <Text style={{ fontSize: 14, color: '#334155' }}>
                  বিক্রয়মূল্য: <Text style={{ fontWeight: '700' }}>৳ {viewProduct.price} / কেজি</Text>
                </Text>
              </View>
              <View style={{ padding: 14, alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: '#D2E3F3' }}>
                <TouchableOpacity onPress={() => setViewProduct(null)} style={styles.modalCancelBtn}>
                  <Text style={styles.modalCancelBtnText}>বন্ধ করুন</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}

      {bulkOpen && (
        <BulkUploadModal kind="product" onClose={() => setBulkOpen(false)} />
      )}

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
                <Text style={styles.modalTitle}>স্টক সমন্বয় নিশ্চিতকরণ (Stock Adjustment)</Text>
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
                  আপনি <Text style={{ fontWeight: '800' }}>{toBnDigits(String(itemsToAdjust.length))} টি</Text> পণ্যের বর্তমান মজুদ সংশোধন করতে যাচ্ছেন। এর মাধ্যমে পণ্যের মজুদ সমন্বয় হবে এবং স্টক মুভমেন্ট হিস্ট্রিতে স্থায়ী রেকর্ড সংরক্ষিত হবে।
                </Text>
              </View>

              {/* KPI Summary Grid */}
              <View style={styles.auditModalSummaryRow}>
                <View style={styles.auditModalSummaryCard}>
                  <Text style={styles.auditModalSummaryLabel}>সমন্বয়কৃত পণ্য</Text>
                  <Text style={styles.auditModalSummaryVal}>{toBnDigits(String(itemsToAdjust.length))} টি</Text>
                </View>
                <View style={styles.auditModalSummaryCard}>
                  <Text style={styles.auditModalSummaryLabel}>মোট ওজন তারতম্য</Text>
                  <Text
                    style={[
                      styles.auditModalSummaryVal,
                      { color: auditSummary.totalDeltaKg < 0 ? '#DC2626' : auditSummary.totalDeltaKg > 0 ? '#16A34A' : '#0F172A' },
                    ]}
                  >
                    {auditSummary.totalDeltaKg > 0 ? '+' : ''}{toBnDigits(Math.round(auditSummary.totalDeltaKg).toLocaleString('en-IN'))} কেজি
                  </Text>
                </View>
                <View style={styles.auditModalSummaryCard}>
                  <Text style={styles.auditModalSummaryLabel}>মোট আর্থিক প্রভাব</Text>
                  <Text
                    style={[
                      styles.auditModalSummaryVal,
                      { color: auditSummary.totalDeltaValue < 0 ? '#DC2626' : auditSummary.totalDeltaValue > 0 ? '#16A34A' : '#0F172A' },
                    ]}
                  >
                    {auditSummary.totalDeltaValue > 0 ? '+' : ''}৳{toBnDigits(Math.round(Math.abs(auditSummary.totalDeltaValue)).toLocaleString('en-IN'))}
                  </Text>
                </View>
              </View>

              {/* Audit Note */}
              <View style={styles.modalFormGroup}>
                <Text style={styles.modalLabel}>অডিট সমন্বয়ের কারণ বা রেফারেন্স নোট *</Text>
                <TextInput
                  value={auditNote}
                  onChangeText={setAuditNote}
                  style={styles.modalInput}
                  placeholder="যেমন: গুদাম নিরীক্ষা ও বার্ষিক স্টক সমন্বয়"
                />
              </View>

              {/* Preview Table of Adjustments */}
              <Text style={[styles.modalLabel, { marginTop: 6, marginBottom: 8 }]}>
                সমন্বয়যোগ্য পণ্যসমূহের বিবরণ:
              </Text>
              <View style={{ borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 8, overflow: 'hidden' }}>
                <View style={[styles.tableHeaderRow, { backgroundColor: '#F1F5F9' }]}>
                  <Text style={[styles.th, { flex: 2 }]}>পণ্য</Text>
                  <Text style={[styles.th, { flex: 1.1, textAlign: 'right' }]}>বর্তমান (কেজি)</Text>
                  <Text style={[styles.th, { flex: 1.1, textAlign: 'right' }]}>বাস্তব (কেজি)</Text>
                  <Text style={[styles.th, { flex: 1.1, textAlign: 'right' }]}>পার্থক্য (কেজি)</Text>
                  <Text style={[styles.th, { flex: 1.3, textAlign: 'right' }]}>আর্থিক প্রভাব (৳)</Text>
                </View>
                {itemsToAdjust.map(it => (
                  <View key={it.id} style={[styles.tableDataRow, { paddingVertical: 8 }]}>
                    <View style={[styles.td, { flex: 2 }]}>
                      <Text style={styles.cellName}>{it.name}</Text>
                      {it.reason ? (
                        <Text style={{ fontSize: 11, color: '#64748B', marginTop: 1 }}>
                          কারণ: {it.reason}
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
                <Text style={styles.modalCancelBtnText}>বাতিল</Text>
              </TouchableOpacity>
              <TouchableOpacity
                disabled={isAdjusting}
                onPress={handleApplyStockAdjustment}
                style={[styles.modalSaveBtn, { backgroundColor: '#15803D' }]}
              >
                <AppIcon name={icons.done} size={18} iconColor="#fff" />
                <Text style={styles.modalSaveBtnText}>
                  {isAdjusting ? 'সমন্বয় করা হচ্ছে...' : 'নিশ্চিত ও সমন্বয় সংরক্ষণ করুন'}
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
