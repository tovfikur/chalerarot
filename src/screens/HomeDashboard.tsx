import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { useApp, today, Product, SaleRec } from '../store';
import { useMoney, useNum, useDateStr, toBnDigits, color } from '../ui';
import { AppIcon, icons } from '../icons';
import { useBreakpoint } from '../responsive';
import { fmtTime } from '../invoice';

interface HomeDashboardProps {
  go?: (route: string) => void;
  onOpenInvoice: (id: string) => void;
  onOpenRecv?: (id: string) => void;
  onOpenReturn?: (id: string) => void;
  onDrillDown: (view: 'sale' | 'due' | 'collect' | 'profit' | 'cogs' | 'pexp') => void;
}

export function HomeDashboard({
  go,
  onOpenInvoice,
  onDrillDown,
}: HomeDashboardProps) {
  const {
    lang,
    stats,
    customers,
    vendors,
    sales,
    products,
    moneyAccounts,
    bal,
  } = useApp();

  const m = useMoney();
  const n = useNum();
  const fd = useDateStr();
  const s = stats();
  const td = today();
  const { isDesktop } = useBreakpoint();

  // Tab filter: 'today' | 'due' | 'all'
  const [invoiceTab, setInvoiceTab] = useState<'today' | 'due' | 'all'>('today');

  // Today's data
  const tSales = useMemo(() => sales.filter(x => x.date === td), [sales, td]);

  // Customer name lookup
  const custName = (id?: string) => {
    if (!id || id === 'cash') return lang === 'bn' ? 'নগদ বিক্রয়' : 'Cash Sale';
    return customers.find(c => c.id === id)?.name ?? (lang === 'bn' ? 'নগদ বিক্রয়' : 'Cash Sale');
  };

  // Filtered sales for recent invoices list
  const displaySales = useMemo(() => {
    let list: SaleRec[];
    if (invoiceTab === 'today') {
      list = tSales;
    } else if (invoiceTab === 'due') {
      list = sales.filter(x => (x.total - x.paid) > 0);
    } else {
      list = sales;
    }
    return list.slice(0, 8);
  }, [invoiceTab, tSales, sales]);

  // Inventory & Stock summary
  const stockSummary = useMemo(() => {
    return products.map(p => {
      const bagWeight = p.mediumBagKg || 50;
      const physicalBags = Math.round(p.qty / bagWeight) || 0;
      const stockVal = p.qty * (p.cost > 0 ? p.cost : p.price || 0);
      return {
        product: p,
        physicalBags,
        bagWeight,
        stockVal,
        isLow: physicalBags < 40,
      };
    });
  }, [products]);

  const totalStockBags = useMemo(() => stockSummary.reduce((sum, item) => sum + item.physicalBags, 0), [stockSummary]);
  const totalStockVal = useMemo(() => stockSummary.reduce((sum, item) => sum + item.stockVal, 0), [stockSummary]);

  // Top stock items for clean widget
  const topStock = useMemo(() => {
    return [...stockSummary].sort((a, b) => b.physicalBags - a.physicalBags).slice(0, 6);
  }, [stockSummary]);

  // Liquid cash & bank balances
  const totalLiquidMoney = useMemo(() => {
    return moneyAccounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);
  }, [moneyAccounts]);

  const activeDueCustCount = useMemo(() => customers.filter(c => bal('c', c.id).balance > 0).length, [customers, bal]);
  const activePayableVendCount = useMemo(() => vendors.filter(v => bal('v', v.id).balance > 0).length, [vendors, bal]);

  // Today formatted
  const formattedToday = useMemo(() => {
    const now = new Date();
    const day = now.getDate();
    const monthNamesBn = ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর'];
    const monthNamesEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const year = now.getFullYear();
    if (lang === 'bn') {
      return `${toBnDigits(day)} ${monthNamesBn[now.getMonth()]}, ${toBnDigits(year)}`;
    }
    return `${day} ${monthNamesEn[now.getMonth()]} ${year}`;
  }, [lang]);

  return (
    <View style={styles.container}>
      {/* 1. MINIMALIST EXECUTIVE HEADER */}
      <View style={styles.header}>
        <View style={styles.headerInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Text style={styles.headerTitle}>
              {lang === 'bn' ? 'চালের আড়ত' : 'Chaler Arot'}
            </Text>
            <View style={styles.liveBadge}>
              <View style={styles.liveDot} />
              <Text style={styles.liveText}>{lang === 'bn' ? 'সিস্টেম সক্রিয়' : 'Live'}</Text>
            </View>
          </View>
          <Text style={styles.headerSubtitle}>
            {lang === 'bn' ? `আজ: ${formattedToday} • পাইকারি আড়ত ও ব্যবসায়িক হিসাব` : `Date: ${formattedToday} • Wholesale Dashboard`}
          </Text>
        </View>

        {/* Primary Quick Actions */}
        <View style={styles.actionGroup}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => go?.('sale')}
            style={[styles.actionBtn, styles.btnSale]}
          >
            <AppIcon name={icons.sale} size={16} iconColor="#FFFFFF" />
            <Text style={styles.actionBtnText}>{lang === 'bn' ? 'নতুন বিক্রয়' : 'New Sale'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => go?.('purchase')}
            style={[styles.actionBtn, styles.btnPurchase]}
          >
            <AppIcon name={icons.purchase} size={16} iconColor="#FFFFFF" />
            <Text style={styles.actionBtnText}>{lang === 'bn' ? 'চাল ক্রয়' : 'Purchase'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => go?.('accounts')}
            style={[styles.actionBtn, styles.btnSecondary]}
          >
            <AppIcon name={icons.accounts} size={16} iconColor="#1E293B" />
            <Text style={styles.btnSecondaryText}>{lang === 'bn' ? 'হিসাব খাতা' : 'Accounts'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. 4 EXECUTIVE KPI CARDS */}
      <View style={styles.kpiGrid}>
        {/* Today's Sales */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onDrillDown('sale')}
          style={styles.kpiCard}
        >
          <View style={styles.kpiHeader}>
            <Text style={styles.kpiTitle}>{lang === 'bn' ? 'আজকের বিক্রয়' : "Today's Sales"}</Text>
            <View style={[styles.kpiBadge, { backgroundColor: '#ECFDF5' }]}>
              <Text style={[styles.kpiBadgeText, { color: '#059669' }]}>
                {lang === 'bn' ? `${toBnDigits(tSales.length)} চালান` : `${tSales.length} Invoices`}
              </Text>
            </View>
          </View>
          <Text style={[styles.kpiAmount, { color: '#0F172A' }]}>{m(s.todaySale)}</Text>
          <Text style={styles.kpiFooterLink}>
            {lang === 'bn' ? 'চালান তালিকা দেখুন →' : 'View invoices →'}
          </Text>
        </TouchableOpacity>

        {/* Today's Collection */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onDrillDown('collect')}
          style={styles.kpiCard}
        >
          <View style={styles.kpiHeader}>
            <Text style={styles.kpiTitle}>{lang === 'bn' ? 'আজকের নগদ আদায়' : "Today's Collection"}</Text>
            <View style={[styles.kpiBadge, { backgroundColor: '#EFF6FF' }]}>
              <Text style={[styles.kpiBadgeText, { color: '#2563EB' }]}>
                {lang === 'bn' ? 'ক্যাশ/ব্যাংক' : 'Cash/Bank'}
              </Text>
            </View>
          </View>
          <Text style={[styles.kpiAmount, { color: '#2563EB' }]}>{m(s.todayCollect)}</Text>
          <Text style={styles.kpiFooterLink}>
            {lang === 'bn' ? 'জমার খাতা দেখুন →' : 'View collection →'}
          </Text>
        </TouchableOpacity>

        {/* Today's Profit */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onDrillDown('profit')}
          style={styles.kpiCard}
        >
          <View style={styles.kpiHeader}>
            <Text style={styles.kpiTitle}>{lang === 'bn' ? 'আজকের নীট লাভ' : "Today's Profit"}</Text>
            <View style={[styles.kpiBadge, { backgroundColor: '#FEF3C7' }]}>
              <Text style={[styles.kpiBadgeText, { color: '#D97706' }]}>
                {lang === 'bn' ? 'মার্জিন' : 'Margin'}
              </Text>
            </View>
          </View>
          <Text style={[styles.kpiAmount, { color: s.todayProfit >= 0 ? '#059669' : '#DC2626' }]}>
            {m(s.todayProfit)}
          </Text>
          <Text style={styles.kpiFooterLink}>
            {lang === 'bn' ? 'লাভ বিশ্লেষণ →' : 'Profit breakdown →'}
          </Text>
        </TouchableOpacity>

        {/* Godown Stock Value */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => go?.('stock')}
          style={styles.kpiCard}
        >
          <View style={styles.kpiHeader}>
            <Text style={styles.kpiTitle}>{lang === 'bn' ? 'গুদামে মোট মজুদ' : 'Godown Stock'}</Text>
            <View style={[styles.kpiBadge, { backgroundColor: '#F1F5F9' }]}>
              <Text style={[styles.kpiBadgeText, { color: '#475569' }]}>
                {lang === 'bn' ? `${toBnDigits(totalStockBags)} বস্তা` : `${totalStockBags} Bags`}
              </Text>
            </View>
          </View>
          <Text style={[styles.kpiAmount, { color: '#1E293B' }]}>{m(totalStockVal)}</Text>
          <Text style={styles.kpiFooterLink}>
            {lang === 'bn' ? 'স্টক ড্যাশবোর্ড →' : 'Open stock →'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 3. FINANCIAL STANDING STRIP */}
      <View style={styles.snapshotStrip}>
        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => go?.('customers')}
          style={styles.snapshotItem}
        >
          <Text style={styles.snapshotLabel}>{lang === 'bn' ? 'কাস্টমার মোট বাকি' : 'Customer Market Due'}</Text>
          <Text style={[styles.snapshotVal, { color: '#DC2626' }]}>{m(s.due)}</Text>
          <Text style={styles.snapshotSub}>
            {lang === 'bn' ? `${toBnDigits(activeDueCustCount)} জন কাস্টমার` : `${activeDueCustCount} parties`}
          </Text>
        </TouchableOpacity>

        <View style={styles.snapshotDivider} />

        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => go?.('vendors')}
          style={styles.snapshotItem}
        >
          <Text style={styles.snapshotLabel}>{lang === 'bn' ? 'মিল ও মহাজন দেনা' : 'Vendor Payables'}</Text>
          <Text style={[styles.snapshotVal, { color: '#D97706' }]}>{m(s.payable)}</Text>
          <Text style={styles.snapshotSub}>
            {lang === 'bn' ? `${toBnDigits(activePayableVendCount)} টি মিল/সরবরাহকারী` : `${activePayableVendCount} vendors`}
          </Text>
        </TouchableOpacity>

        <View style={styles.snapshotDivider} />

        <TouchableOpacity
          activeOpacity={0.75}
          onPress={() => go?.('bank')}
          style={styles.snapshotItem}
        >
          <Text style={styles.snapshotLabel}>{lang === 'bn' ? 'ক্যাশ ও ব্যাংক স্থিতি' : 'Cash & Bank Balance'}</Text>
          <Text style={[styles.snapshotVal, { color: '#2563EB' }]}>{m(totalLiquidMoney)}</Text>
          <Text style={styles.snapshotSub}>
            {lang === 'bn' ? `${toBnDigits(moneyAccounts.length)} টি একাউন্ট` : `${moneyAccounts.length} accounts`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* 4. MAIN OPERATING 2-COLUMN SECTION */}
      <View style={[styles.mainLayout, isDesktop ? { flexDirection: 'row' } : { flexDirection: 'column' }]}>
        {/* Left Column: Recent Sales */}
        <View style={[styles.columnCard, isDesktop ? { flex: 1.3 } : { width: '100%' }]}>
          <View style={styles.cardTop}>
            <View>
              <Text style={styles.cardHeading}>{lang === 'bn' ? 'সাম্প্রতিক বিক্রয় চালান' : 'Recent Invoices'}</Text>
              <Text style={styles.cardSubheading}>{lang === 'bn' ? 'সর্বশেষ চালানসমূহ' : 'Latest sales records'}</Text>
            </View>

            {/* Filter Pills */}
            <View style={styles.pillGroup}>
              <TouchableOpacity
                onPress={() => setInvoiceTab('today')}
                style={[styles.pill, invoiceTab === 'today' && styles.pillActive]}
              >
                <Text style={[styles.pillText, invoiceTab === 'today' && styles.pillTextActive]}>
                  {lang === 'bn' ? `আজকের (${toBnDigits(tSales.length)})` : `Today (${tSales.length})`}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setInvoiceTab('due')}
                style={[styles.pill, invoiceTab === 'due' && styles.pillActive]}
              >
                <Text style={[styles.pillText, invoiceTab === 'due' && styles.pillTextActive]}>
                  {lang === 'bn' ? 'বাকি' : 'Due'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setInvoiceTab('all')}
                style={[styles.pill, invoiceTab === 'all' && styles.pillActive]}
              >
                <Text style={[styles.pillText, invoiceTab === 'all' && styles.pillTextActive]}>
                  {lang === 'bn' ? 'সকল' : 'All'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Invoice List */}
          <View style={styles.invoiceList}>
            {displaySales.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyMessage}>
                  {lang === 'bn' ? 'কোনো চালান পাওয়া যায়নি।' : 'No invoices found.'}
                </Text>
                <TouchableOpacity onPress={() => go?.('sale')} style={styles.emptyAddBtn}>
                  <Text style={styles.emptyAddBtnText}>{lang === 'bn' ? '+ নতুন চালান তৈরি করুন' : '+ New Invoice'}</Text>
                </TouchableOpacity>
              </View>
            ) : (
              displaySales.map((sale, idx) => {
                const isDue = (sale.total - sale.paid) > 0;
                const isPaid = sale.paid >= sale.total;
                const isPartial = sale.paid > 0 && !isPaid;

                return (
                  <TouchableOpacity
                    key={sale.id || idx}
                    activeOpacity={0.7}
                    onPress={() => onOpenInvoice(sale.id)}
                    style={styles.invoiceRow}
                  >
                    <View style={styles.invLeft}>
                      <View style={styles.invNoBadge}>
                        <Text style={styles.invNoText}>{sale.invoiceNo || (lang === 'bn' ? 'চালান' : 'INV')}</Text>
                      </View>
                      <View>
                        <Text style={styles.invCust}>{custName(sale.customerId)}</Text>
                        <Text style={styles.invDate}>
                          {sale.createdAt ? fmtTime(sale.createdAt, lang === 'bn') : fd(sale.date)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.invRight}>
                      <View style={{ alignItems: 'flex-end', marginRight: 10 }}>
                        <Text style={styles.invTotal}>{m(sale.total)}</Text>
                        {isDue ? (
                          <Text style={styles.invDue}>
                            {lang === 'bn' ? `বাকি: ${m(sale.total - sale.paid)}` : `Due: ${m(sale.total - sale.paid)}`}
                          </Text>
                        ) : null}
                      </View>

                      <View style={[
                        styles.statusBadge,
                        isPaid ? { backgroundColor: '#DCFCE7' } : isPartial ? { backgroundColor: '#FEF3C7' } : { backgroundColor: '#FEE2E2' }
                      ]}>
                        <Text style={[
                          styles.statusBadgeText,
                          isPaid ? { color: '#15803D' } : isPartial ? { color: '#B45309' } : { color: '#B91C1C' }
                        ]}>
                          {isPaid ? (lang === 'bn' ? 'পরিশোধ' : 'Paid') : isPartial ? (lang === 'bn' ? 'আংশিক' : 'Partial') : (lang === 'bn' ? 'বাকি' : 'Due')}
                        </Text>
                      </View>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
          </View>

          <View style={styles.cardBottom}>
            <TouchableOpacity onPress={() => go?.('sale')}>
              <Text style={styles.bottomLinkText}>
                {lang === 'bn' ? 'সকল বিক্রয় ও বিস্তারিত খাতা দেখুন →' : 'View all sales →'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Right Column: Rice Godown Stock */}
        <View style={[styles.columnCard, isDesktop ? { flex: 1 } : { width: '100%' }]}>
          <View style={styles.cardTop}>
            <View>
              <Text style={styles.cardHeading}>{lang === 'bn' ? 'চালের গুদাম স্টক' : 'Rice Stock'}</Text>
              <Text style={styles.cardSubheading}>
                {lang === 'bn' ? `মোট চাল: ${toBnDigits(totalStockBags)} বস্তা` : `${totalStockBags} Bags in Godown`}
              </Text>
            </View>

            <TouchableOpacity onPress={() => go?.('stock')} style={styles.headerSmallBtn}>
              <Text style={styles.headerSmallBtnText}>{lang === 'bn' ? 'স্টক ড্যাশবোর্ড' : 'Stock'}</Text>
            </TouchableOpacity>
          </View>

          {/* Top Products */}
          <View style={styles.stockList}>
            {topStock.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyMessage}>{lang === 'bn' ? 'কোনো চাল পাওয়া যায়নি।' : 'No products found.'}</Text>
              </View>
            ) : (
              topStock.map((item, idx) => {
                const p = item.product;
                return (
                  <View key={p.id || idx} style={styles.stockRow}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                        <Text style={styles.stockName}>{p.name}</Text>
                        {item.isLow && (
                          <View style={styles.lowTag}>
                            <Text style={styles.lowTagText}>{lang === 'bn' ? 'কম স্টক' : 'Low'}</Text>
                          </View>
                        )}
                      </View>
                      <Text style={styles.stockMeta}>
                        {lang === 'bn' ? `${toBnDigits(item.bagWeight)} কেজি বস্তা • দর: ${m(p.price)}` : `${item.bagWeight}kg bag • ${m(p.price)}`}
                      </Text>
                    </View>

                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={[styles.stockBags, item.isLow && { color: '#DC2626' }]}>
                        {lang === 'bn' ? `${toBnDigits(item.physicalBags)} বস্তা` : `${item.physicalBags} Bags`}
                      </Text>
                      <Text style={styles.stockKg}>
                        {lang === 'bn' ? `${n(p.qty)} কেজি` : `${n(p.qty)} kg`}
                      </Text>
                    </View>
                  </View>
                );
              })
            )}
          </View>

          <View style={styles.cardBottom}>
            <TouchableOpacity onPress={() => go?.('stock')}>
              <Text style={styles.bottomLinkText}>
                {lang === 'bn' ? 'সম্পূর্ণ স্টক খাতা দেখুন →' : 'View complete stock →'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: 16,
    maxWidth: 1400,
    alignSelf: 'center',
    width: '100%',
  },
  header: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
  },
  headerInfo: {
    gap: 4,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#ECFDF5',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#A7F3D0',
  },
  liveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  liveText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#047857',
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flexWrap: 'wrap',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 8,
    minHeight: 38,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  btnSale: {
    backgroundColor: '#2563EB',
  },
  btnPurchase: {
    backgroundColor: '#0F172A',
  },
  btnSecondary: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  actionBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  btnSecondaryText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },

  /* KPI Grid */
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    minWidth: 220,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    gap: 8,
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
      cursor: 'pointer',
    } : { elevation: 1 }),
  },
  kpiHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kpiTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#64748B',
  },
  kpiBadge: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 6,
  },
  kpiBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  kpiAmount: {
    fontSize: 22,
    fontWeight: '800',
    letterSpacing: -0.5,
  },
  kpiFooterLink: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
    marginTop: 2,
  },

  /* Snapshot Strip */
  snapshotStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 20,
    alignItems: 'center',
    gap: 12,
  },
  snapshotItem: {
    flex: 1,
    minWidth: 180,
    gap: 3,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  snapshotLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '600',
  },
  snapshotVal: {
    fontSize: 18,
    fontWeight: '800',
  },
  snapshotSub: {
    fontSize: 11,
    color: '#94A3B8',
  },
  snapshotDivider: {
    width: 1,
    height: 36,
    backgroundColor: '#E2E8F0',
  },

  /* 2-Column Layout */
  mainLayout: {
    gap: 16,
  },
  columnCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 18,
    gap: 14,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  cardHeading: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardSubheading: {
    fontSize: 12,
    color: '#64748B',
  },
  pillGroup: {
    flexDirection: 'row',
    gap: 6,
  },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#F1F5F9',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  pillActive: {
    backgroundColor: '#2563EB',
  },
  pillText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  invoiceList: {
    gap: 8,
  },
  invoiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#F1F5F9',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  invLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  invNoBadge: {
    backgroundColor: '#E2E8F0',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  invNoText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#334155',
  },
  invCust: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  invDate: {
    fontSize: 11,
    color: '#64748B',
  },
  invRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  invTotal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  invDue: {
    fontSize: 11,
    fontWeight: '600',
    color: '#DC2626',
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  cardBottom: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    alignItems: 'center',
  },
  bottomLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2563EB',
  },
  headerSmallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#FFFFFF',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  headerSmallBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  stockList: {
    gap: 8,
  },
  stockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#F1F5F9',
  },
  stockName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#0F172A',
  },
  lowTag: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  lowTagText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#DC2626',
  },
  stockMeta: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 2,
  },
  stockBags: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  stockKg: {
    fontSize: 11,
    color: '#64748B',
  },
  emptyWrap: {
    padding: 24,
    alignItems: 'center',
    gap: 10,
  },
  emptyMessage: {
    fontSize: 13,
    color: '#94A3B8',
  },
  emptyAddBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#2563EB',
  },
  emptyAddBtnText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
