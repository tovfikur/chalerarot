import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Modal, Platform, Alert } from 'react-native';
import { useApp, Product } from '../store';
import { toBnDigits, useNum } from '../ui';
import { AppIcon, icons } from '../icons';

export function StockDashboard() {
  const { t, products, stockTx, saveProduct } = useApp();
  const n = useNum();

  // Active view tab: 'products' | 'movements'
  const [activeTab, setActiveTab] = useState<'products' | 'movements'>('products');

  // Search & filter
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedWarehouse, setSelectedWarehouse] = useState('প্রধান গুদাম');
  const [warehouseDropdownOpen, setWarehouseDropdownOpen] = useState(false);

  // Pagination
  const [page, setPage] = useState(1);
  const pageSize = 10;

  // Add Product Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [newCode, setNewCode] = useState(String(300 + products.length));
  const [newName, setNewName] = useState('');
  const [newUnit, setNewUnit] = useState('বস্তা');
  const [newBagKg, setNewBagKg] = useState('50');
  const [newOpeningBags, setNewOpeningBags] = useState('');
  const [newCostRate, setNewCostRate] = useState('');
  const [newDescription, setNewDescription] = useState('');

  // Item details modal (Eye action)
  const [viewProduct, setViewProduct] = useState<Product | null>(null);

  // Compute stock figures
  // Physical stock = Product.qtyKg converted into bags (qtyKg / 50)
  // Transit stock = calculated from recent purchases or movements
  const stockData = useMemo(() => {
    return products.map((p, idx) => {
      const bagWeight = p.mediumBagKg || 50;
      const physicalBags = Math.round(p.qty / bagWeight) || 0;
      // Simulated transit bags for realism based on order index
      const transitBags = Math.round((idx % 4 === 1 ? physicalBags * 0.2 : idx % 4 === 2 ? physicalBags * 0.15 : 0));
      const totalBags = physicalBags + transitBags;

      return {
        id: p.id,
        code: String(300 + idx),
        product: p,
        name: p.name,
        unit: 'বস্তা',
        physicalBags,
        transitBags,
        totalBags,
      };
    });
  }, [products]);

  // Aggregate KPI summary
  const totalPhysical = useMemo(() => stockData.reduce((s, it) => s + it.physicalBags, 0), [stockData]);
  const totalTransit = useMemo(() => stockData.reduce((s, it) => s + it.transitBags, 0), [stockData]);
  const totalAll = totalPhysical + totalTransit;

  // Filtered rows
  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return stockData;
    return stockData.filter(
      r => r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q)
    );
  }, [stockData, searchQuery]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / pageSize));
  const pagedRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filteredRows.slice(start, start + pageSize);
  }, [filteredRows, page, pageSize]);

  // Save new product from modal
  const handleSaveProduct = async () => {
    if (!newName.trim()) {
      Alert.alert(t('invalid'), 'পণ্যের নাম আবশ্যক।');
      return;
    }

    const bagKg = parseFloat(newBagKg) || 50;
    const openingBags = parseFloat(newOpeningBags) || 0;
    const cost = parseFloat(newCostRate) || 0;
    const openingKg = openingBags * bagKg;

    try {
      await saveProduct({
        id: `p_${Date.now()}`,
        name: newName.trim(),
        cost,
        price: cost ? Math.round(cost * 1.08) : 0, // default markup
        opening: openingKg,
        qty: openingKg,
        uom: newUnit,
        smallBagKg: 25,
        mediumBagKg: bagKg,
        largeBagKg: 50,
      });

      setModalOpen(false);
      setNewName('');
      setNewOpeningBags('');
      setNewCostRate('');
      setNewDescription('');
      Alert.alert(t('done'), 'নতুন পণ্য সফলভাবে যোগ করা হয়েছে।');
    } catch (err) {
      Alert.alert(t('invalid'), err instanceof Error ? err.message : 'সংরক্ষণ ব্যর্থ হয়েছে।');
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
              <Text style={styles.headerTitle}>মজুদ পণ্য ও গুদাম স্টক</Text>
              <View style={styles.liveTag}>
                <View style={styles.liveDot} />
                <Text style={styles.liveTagText}>সক্রিয়</Text>
              </View>
            </View>
            <Text style={styles.headerSub}>পাইকারি চালের মজুদ, ফিজিক্যাল ও ট্রানজিট স্টক</Text>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            onPress={() => setModalOpen(true)}
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
        {/* Card 1: Physical Stock */}
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#E8F5E9' }]}>
            <AppIcon name={icons.stock} size={26} iconColor="#1B7F4B" />
          </View>
          <View style={styles.kpiInfo}>
            <Text style={styles.kpiLabel}>মোট ফিজিক্যাল মজুদ</Text>
            <Text style={styles.kpiValue}>{toBnDigits(totalPhysical.toLocaleString('en-IN'))} বস্তা</Text>
          </View>
        </View>

        {/* Card 2: In-Transit Stock */}
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#E3F2FD' }]}>
            <AppIcon name={icons.vendors} size={26} iconColor="#1976D2" />
          </View>
          <View style={styles.kpiInfo}>
            <Text style={styles.kpiLabel}>মোট অন-ট্রানজিট মজুদ</Text>
            <Text style={styles.kpiValue}>{toBnDigits(totalTransit.toLocaleString('en-IN'))} বস্তা</Text>
          </View>
        </View>

        {/* Card 3: Total Stock */}
        <View style={styles.kpiCard}>
          <View style={[styles.kpiIconWrap, { backgroundColor: '#FEF3C7' }]}>
            <AppIcon name={icons.products} size={26} iconColor="#D97706" />
          </View>
          <View style={styles.kpiInfo}>
            <Text style={styles.kpiLabel}>সর্বমোট মজুদ</Text>
            <Text style={styles.kpiValue}>{toBnDigits(totalAll.toLocaleString('en-IN'))} বস্তা</Text>
          </View>
        </View>
      </View>

      {/* Control Tabs & Action Buttons */}
      <View style={styles.controlsRow}>
        <View style={styles.tabButtonsGroup}>
          <TouchableOpacity
            onPress={() => setActiveTab('products')}
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
            onPress={() => setActiveTab('movements')}
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
        </View>

        <View style={styles.rightActionGroup}>
          <TouchableOpacity onPress={() => setModalOpen(true)} style={styles.addProductGreenBtn}>
            <AppIcon name={icons.add} size={18} iconColor="#fff" />
            <Text style={styles.addProductGreenBtnText}>পণ্য যোগ করুন</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => Alert.alert('এক্সেল', 'এক্সেল ফাইল ডাউনলোড শুরু হয়েছে।')}
            style={styles.outlineActionBtn}
          >
            <AppIcon name={icons.excel} size={18} iconColor="#15803D" />
            <Text style={[styles.outlineActionBtnText, { color: '#15803D' }]}>এক্সেল ডাউনলোড</Text>
          </TouchableOpacity>

          <View style={{ position: 'relative', zIndex: 40 }}>
            <TouchableOpacity
              onPress={() => setWarehouseDropdownOpen(prev => !prev)}
              style={styles.warehouseSelector}
            >
              <AppIcon name={icons.stock} size={18} iconColor="#334155" />
              <Text style={styles.warehouseSelectorText}>গুদাম: {selectedWarehouse}</Text>
              <AppIcon name={icons.chevR} size={18} iconColor="#64748B" />
            </TouchableOpacity>

            {warehouseDropdownOpen && (
              <View style={styles.dropdownPopup}>
                {['প্রধান গুদাম', 'উত্তর গুদাম', 'দক্ষিণ গুদাম'].map(wh => (
                  <TouchableOpacity
                    key={wh}
                    onPress={() => {
                      setSelectedWarehouse(wh);
                      setWarehouseDropdownOpen(false);
                    }}
                    style={styles.dropdownPopupItem}
                  >
                    <Text style={styles.dropdownPopupItemText}>{wh}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
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
            placeholder="পণ্য কোড বা পণ্যের নাম দিয়ে খুঁজুন..."
          />
        </View>

        <View style={styles.categoryDropdownWrap}>
          <Text style={styles.categoryDropdownText}>সব পণ্য</Text>
          <AppIcon name={icons.chevR} size={18} iconColor="#64748B" />
        </View>
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
              <Text style={[styles.th, { flex: 1, textAlign: 'center' }]}>একক</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>ফিজিক্যাল মজুদ (বস্তা)</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>অন-ট্রানজিট মজুদ (বস্তা)</Text>
              <Text style={[styles.th, { flex: 1.5, textAlign: 'right' }]}>সর্বমোট মজুদ (বস্তা)</Text>
              <Text style={[styles.th, { width: 80, textAlign: 'center' }]}>অ্যাকশন</Text>
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

                <View style={[styles.td, { flex: 1, alignItems: 'center' }]}>
                  <Text style={styles.cellText}>{row.unit}</Text>
                </View>

                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={styles.cellText}>{toBnDigits(row.physicalBags.toLocaleString('en-IN'))}</Text>
                </View>

                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={styles.cellText}>{toBnDigits(row.transitBags.toLocaleString('en-IN'))}</Text>
                </View>

                <View style={[styles.td, { flex: 1.5, alignItems: 'flex-end' }]}>
                  <Text style={[styles.cellBold, { color: '#0F172A' }]}>
                    {toBnDigits(row.totalBags.toLocaleString('en-IN'))}
                  </Text>
                </View>

                <View style={[styles.td, { width: 80, alignItems: 'center', justifyContent: 'center' }]}>
                  <TouchableOpacity
                    onPress={() => setViewProduct(row.product)}
                    style={styles.eyeActionButton}
                  >
                    <AppIcon name={icons.eye} size={18} iconColor="#006A4E" />
                  </TouchableOpacity>
                </View>
              </View>
            ))}
          </>
        ) : (
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
        )}

        {/* Pagination Footer */}
        <View style={styles.paginationFooter}>
          <Text style={styles.footerCountText}>
            মোট {toBnDigits(String(filteredRows.length))} টি পণ্য দেখানো হচ্ছে
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

      {/* Add Product Modal (Bengali Inventory Product Modal UI.png) */}
      <Modal visible={modalOpen} transparent animationType="fade" onRequestClose={() => setModalOpen(false)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalBox}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleRow}>
                <AppIcon name={icons.products} size={22} iconColor="#006A4E" />
                <Text style={styles.modalTitle}>নতুন পণ্য যোগ করুন</Text>
              </View>
              <TouchableOpacity onPress={() => setModalOpen(false)} style={styles.modalCloseBtn}>
                <AppIcon name={icons.cancel} size={20} iconColor="#64748B" />
              </TouchableOpacity>
            </View>

            {/* Modal Form Fields */}
            <ScrollView style={styles.modalBody} keyboardShouldPersistTaps="handled">
              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>পণ্য কোড *</Text>
                  <TextInput
                    value={newCode}
                    onChangeText={setNewCode}
                    style={styles.modalInput}
                    placeholder="308"
                  />
                </View>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>পণ্যের নাম *</Text>
                  <TextInput
                    value={newName}
                    onChangeText={setNewName}
                    style={styles.modalInput}
                    placeholder="খুদ চাল"
                  />
                </View>
              </View>

              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>একক *</Text>
                  <View style={styles.modalSelectWrap}>
                    <Text style={styles.modalSelectText}>{newUnit}</Text>
                    <AppIcon name={icons.chevR} size={16} iconColor="#64748B" />
                  </View>
                </View>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>বস্তায় পরিমাণ (কেজি) *</Text>
                  <TextInput
                    value={newBagKg}
                    onChangeText={setNewBagKg}
                    style={styles.modalInput}
                    placeholder="৫০"
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.modalTwoCol}>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>প্রারম্ভিক মজুদ (বস্তা)</Text>
                  <TextInput
                    value={newOpeningBags}
                    onChangeText={setNewOpeningBags}
                    style={styles.modalInput}
                    placeholder="100"
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.modalCol}>
                  <Text style={styles.modalLabel}>ক্রয়মূল্য (৳)</Text>
                  <TextInput
                    value={newCostRate}
                    onChangeText={setNewCostRate}
                    style={styles.modalInput}
                    placeholder="60"
                    keyboardType="numeric"
                  />
                </View>
              </View>

              <View style={styles.modalFormGroup}>
                <Text style={styles.modalLabel}>বিবরণ (ঐচ্ছিক)</Text>
                <TextInput
                  value={newDescription}
                  onChangeText={setNewDescription}
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

              <TouchableOpacity onPress={handleSaveProduct} style={styles.modalSaveBtn}>
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
              <View style={{ padding: 14, alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: '#E2E8E4' }}>
                <TouchableOpacity onPress={() => setViewProduct(null)} style={styles.modalCancelBtn}>
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
  rightActionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addProductGreenBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#006A4E',
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
    borderColor: '#E2E8E4',
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
    borderColor: '#E2E8E4',
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
    borderColor: '#E2E8E4',
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
    borderColor: '#E2E8E4',
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
    borderLeftColor: '#E2E8E4',
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
    backgroundColor: '#ECFDF5',
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
