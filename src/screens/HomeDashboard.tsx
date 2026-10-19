import React, { useState, useMemo } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Platform, ScrollView } from 'react-native';
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
    <ScrollView style={styles.scrollWrapper} contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
      {/* 1. EXECUTIVE LUXURY HERO HEADER - Royal Blue #1c70b9 */}
      <View style={styles.heroHeaderBar}>
        <View style={styles.headerGlossSheen} pointerEvents="none" />
        <View style={styles.headerInfo}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={styles.appLogoCircle}>
              <AppIcon name={icons.stock} size={22} iconColor="#FFFFFF" />
            </View>
            <View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={styles.headerTitle}>
                  {lang === 'bn' ? 'চালের আড়ত' : 'Chaler Arot'}
                </Text>
                <View style={styles.liveBadge}>
                  <View style={styles.liveDot} />
                  <Text style={styles.liveText}>{lang === 'bn' ? 'লাইভ কার্যক্রম' : 'Live'}</Text>
                </View>
              </View>
              <Text style={styles.headerSubtitle}>
                {lang === 'bn' ? `আজ: ${formattedToday} • পাইকারি চালের আধুনিক হিসাব ও ম্যানেজমেন্ট` : `Date: ${formattedToday} • Wholesale Rice Operations`}
              </Text>
            </View>
          </View>
        </View>

        {/* Primary Quick Tactile Actions */}
        <View style={styles.actionGroup}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => go?.('sale')}
            style={[styles.tactileHeroBtn, styles.btnSaleHero]}
          >
            <View style={[styles.heroBtnIconWrap, { backgroundColor: '#E0F2FE' }]}>
              <AppIcon name={icons.sale} size={18} iconColor="#1c70b9" />
            </View>
            <View>
              <Text style={[styles.heroBtnText, { color: '#1c70b9' }]}>{lang === 'bn' ? 'নতুন বিক্রয়' : 'New Sale'}</Text>
              <Text style={[styles.heroBtnSub, { color: '#0369A1' }]}>{lang === 'bn' ? 'চালান তৈরি করুন' : 'Create Invoice'}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => go?.('purchase')}
            style={[styles.tactileHeroBtn, styles.btnPurchaseHero]}
          >
            <View style={[styles.heroBtnIconWrap, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <AppIcon name={icons.purchase} size={18} iconColor="#FFFFFF" />
            </View>
            <View>
              <Text style={styles.heroBtnText}>{lang === 'bn' ? 'চাল ক্রয়' : 'Purchase'}</Text>
              <Text style={styles.heroBtnSub}>{lang === 'bn' ? 'স্টক ইনভেন্টরি' : 'Stock Entry'}</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => go?.('accounts')}
            style={[styles.tactileHeroBtn, styles.btnAccountsHero]}
          >
            <View style={[styles.heroBtnIconWrap, { backgroundColor: 'rgba(255,255,255,0.2)' }]}>
              <AppIcon name={icons.accounts} size={18} iconColor="#FFFFFF" />
            </View>
            <View>
              <Text style={styles.heroBtnText}>{lang === 'bn' ? 'হিসাব খাতা' : 'Accounts'}</Text>
              <Text style={styles.heroBtnSub}>{lang === 'bn' ? 'আদায় ও দেনা' : 'Cash & Ledger'}</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. 4 LUXURIOUS KPI CARDS WITH GLOW & GRADIENTS */}
      <View style={styles.kpiGrid}>
        {/* Today's Sales */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => onDrillDown('sale')}
          style={[styles.kpiCard, styles.kpiCardSales]}
        >
          <View style={styles.kpiTopRow}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#DBEAFE' }]}>
              <AppIcon name={icons.sale} size={22} iconColor="#1D4ED8" />
            </View>
            <View style={[styles.kpiBadge, { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE' }]}>
              <Text style={[styles.kpiBadgeText, { color: '#1E40AF' }]}>
                {lang === 'bn' ? `${toBnDigits(tSales.length)} টি চালান` : `${tSales.length} Invoices`}
              </Text>
            </View>
          </View>
          <Text style={styles.kpiTitle}>{lang === 'bn' ? 'আজকের বিক্রয়' : "Today's Sales"}</Text>
          <Text style={[styles.kpiAmount, { color: '#0F1E36' }]}>{m(s.todaySale)}</Text>
          <View style={styles.kpiFooterWrap}>
            <Text style={[styles.kpiFooterLink, { color: '#2563EB' }]}>
              {lang === 'bn' ? 'চালান তালিকা দেখুন →' : 'View invoices →'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Today's Collection */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => onDrillDown('collect')}
          style={[styles.kpiCard, styles.kpiCardCollection]}
        >
          <View style={styles.kpiTopRow}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#DCFCE7' }]}>
              <AppIcon name={icons.collect} size={22} iconColor="#15803D" />
            </View>
            <View style={[styles.kpiBadge, { backgroundColor: '#F0FDF4', borderColor: '#BBF7D0' }]}>
              <Text style={[styles.kpiBadgeText, { color: '#166534' }]}>
                {lang === 'bn' ? 'নগদ ও ব্যাংক' : 'Cash & Bank'}
              </Text>
            </View>
          </View>
          <Text style={styles.kpiTitle}>{lang === 'bn' ? 'আজকের নগদ আদায়' : "Today's Collection"}</Text>
          <Text style={[styles.kpiAmount, { color: '#15803D' }]}>{m(s.todayCollect)}</Text>
          <View style={styles.kpiFooterWrap}>
            <Text style={[styles.kpiFooterLink, { color: '#16A34A' }]}>
              {lang === 'bn' ? 'জমার খাতা দেখুন →' : 'View collection →'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Today's Profit */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => onDrillDown('profit')}
          style={[styles.kpiCard, styles.kpiCardProfit]}
        >
          <View style={styles.kpiTopRow}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#FEF3C7' }]}>
              <AppIcon name={icons.profit} size={22} iconColor="#B45309" />
            </View>
            <View style={[styles.kpiBadge, { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' }]}>
              <Text style={[styles.kpiBadgeText, { color: '#92400E' }]}>
                {lang === 'bn' ? 'নীট মার্জিন' : 'Net Margin'}
              </Text>
            </View>
          </View>
          <Text style={styles.kpiTitle}>{lang === 'bn' ? 'আজকের প্রত্যাশিত লাভ' : "Today's Profit"}</Text>
          <Text style={[styles.kpiAmount, { color: s.todayProfit >= 0 ? '#047857' : '#DC2626' }]}>
            {m(s.todayProfit)}
          </Text>
          <View style={styles.kpiFooterWrap}>
            <Text style={[styles.kpiFooterLink, { color: '#D97706' }]}>
              {lang === 'bn' ? 'লাভ বিশ্লেষণ →' : 'Profit breakdown →'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Godown Stock Value */}
        <TouchableOpacity
          activeOpacity={0.88}
          onPress={() => go?.('stock')}
          style={[styles.kpiCard, styles.kpiCardStock]}
        >
          <View style={styles.kpiTopRow}>
            <View style={[styles.kpiIconBox, { backgroundColor: '#F3E8FF' }]}>
              <AppIcon name={icons.stock} size={22} iconColor="#7E22CE" />
            </View>
            <View style={[styles.kpiBadge, { backgroundColor: '#FAF5FF', borderColor: '#E9D5FF' }]}>
              <Text style={[styles.kpiBadgeText, { color: '#6B21A8' }]}>
                {lang === 'bn' ? `${toBnDigits(totalStockBags)} বস্তা চাল` : `${totalStockBags} Bags`}
              </Text>
            </View>
          </View>
          <Text style={styles.kpiTitle}>{lang === 'bn' ? 'গুদামে মোট চালের মূল্য' : 'Godown Stock'}</Text>
          <Text style={[styles.kpiAmount, { color: '#4C1D95' }]}>{m(totalStockVal)}</Text>
          <View style={styles.kpiFooterWrap}>
            <Text style={[styles.kpiFooterLink, { color: '#7C3AED' }]}>
              {lang === 'bn' ? 'স্টক ড্যাশবোর্ড →' : 'Open stock →'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* 3. EXECUTIVE FINANCIAL LIQUIDITY & LIABILITIES BAR */}
      <View style={styles.financialRibbonCard}>
        <View style={styles.ribbonHeaderWrap}>
          <View style={styles.ribbonDotIndicator} />
          <Text style={styles.ribbonHeadingText}>
            {lang === 'bn' ? 'আড়তের আর্থিক স্থিতি ও মার্কেট বাকি' : 'Financial Position & Balance Snapshot'}
          </Text>
        </View>

        <View style={styles.ribbonContentRow}>
          {/* Customer Market Due */}
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => go?.('customers')}
            style={styles.ribbonItem}
          >
            <View style={styles.ribbonItemIconWrap}>
              <AppIcon name={icons.customers} size={20} iconColor="#DC2626" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.ribbonLabel}>{lang === 'bn' ? 'মার্কেটে মোট বাকি' : 'Customer Market Due'}</Text>
              <Text style={[styles.ribbonVal, { color: '#DC2626' }]}>{m(s.due)}</Text>
              <Text style={styles.ribbonSub}>
                {lang === 'bn' ? `${toBnDigits(activeDueCustCount)} জন কাস্টমারের কাছে বাকি` : `${activeDueCustCount} debtors`}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.ribbonDivider} />

          {/* Vendor Payables */}
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => go?.('vendors')}
            style={styles.ribbonItem}
          >
            <View style={[styles.ribbonItemIconWrap, { backgroundColor: '#FEF3C7' }]}>
              <AppIcon name={icons.vendors} size={20} iconColor="#D97706" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.ribbonLabel}>{lang === 'bn' ? 'মিল ও মহাজনদের দেনা' : 'Vendor Payables'}</Text>
              <Text style={[styles.ribbonVal, { color: '#D97706' }]}>{m(s.payable)}</Text>
              <Text style={styles.ribbonSub}>
                {lang === 'bn' ? `${toBnDigits(activePayableVendCount)} টি মিল/সরবরাহকারী` : `${activePayableVendCount} creditors`}
              </Text>
            </View>
          </TouchableOpacity>

          <View style={styles.ribbonDivider} />

          {/* Cash & Bank Balances */}
          <TouchableOpacity
            activeOpacity={0.75}
            onPress={() => go?.('bank')}
            style={styles.ribbonItem}
          >
            <View style={[styles.ribbonItemIconWrap, { backgroundColor: '#E0F2FE' }]}>
              <AppIcon name={icons.bankCash} size={20} iconColor="#0284C7" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.ribbonLabel}>{lang === 'bn' ? 'ক্যাশ ও ব্যাংকে নগদ স্থিতি' : 'Cash & Bank Balance'}</Text>
              <Text style={[styles.ribbonVal, { color: '#0284C7' }]}>{m(totalLiquidMoney)}</Text>
              <Text style={styles.ribbonSub}>
                {lang === 'bn' ? `${toBnDigits(moneyAccounts.length)} টি ব্যাংক ও ক্যাশ বাক্স` : `${moneyAccounts.length} accounts ready`}
              </Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* 4. MAIN OPERATING 2-COLUMN SECTION */}
      <View style={[styles.mainLayout, isDesktop ? { flexDirection: 'row' } : { flexDirection: 'column' }]}>
        {/* Left Column: Recent Sales */}
        <View style={[styles.columnCard, isDesktop ? { flex: 1.35 } : { width: '100%' }]}>
          <View style={styles.cardTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[styles.sectionIndicatorCircle, { backgroundColor: '#3B82F6' }]} />
              <View>
                <Text style={styles.cardHeading}>{lang === 'bn' ? 'সাম্প্রতিক বিক্রয় চালান' : 'Recent Invoices'}</Text>
                <Text style={styles.cardSubheading}>{lang === 'bn' ? 'সর্বশেষ চালানসমূহ ও আদায়ের অবস্থা' : 'Latest sales & payment status'}</Text>
              </View>
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
                  {lang === 'bn' ? 'বাকি চালান' : 'Due'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                onPress={() => setInvoiceTab('all')}
                style={[styles.pill, invoiceTab === 'all' && styles.pillActive]}
              >
                <Text style={[styles.pillText, invoiceTab === 'all' && styles.pillTextActive]}>
                  {lang === 'bn' ? 'সকল চালান' : 'All'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Invoice List */}
          <View style={styles.invoiceList}>
            {displaySales.length === 0 ? (
              <View style={styles.emptyWrap}>
                <AppIcon name={icons.sale} size={40} iconColor="#CBD5E1" />
                <Text style={styles.emptyMessage}>
                  {lang === 'bn' ? 'এই ফিল্টারে কোনো চালান পাওয়া যায়নি।' : 'No invoices found.'}
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
                      <View style={{ flex: 1 }}>
                        <Text style={styles.invCust} numberOfLines={1}>{custName(sale.customerId)}</Text>
                        <Text style={styles.invDate}>
                          {sale.createdAt ? fmtTime(sale.createdAt, lang === 'bn') : fd(sale.date)}
                        </Text>
                      </View>
                    </View>

                    <View style={styles.invRight}>
                      <View style={{ alignItems: 'flex-end', marginRight: 12 }}>
                        <Text style={styles.invTotal}>{m(sale.total)}</Text>
                        {isDue ? (
                          <Text style={styles.invDue}>
                            {lang === 'bn' ? `বাকি: ${m(sale.total - sale.paid)}` : `Due: ${m(sale.total - sale.paid)}`}
                          </Text>
                        ) : null}
                      </View>

                      <View style={[
                        styles.statusBadge,
                        isPaid ? { backgroundColor: '#DCFCE7', borderColor: '#86EFAC' } : isPartial ? { backgroundColor: '#FEF3C7', borderColor: '#FDE68A' } : { backgroundColor: '#FEE2E2', borderColor: '#FECACA' }
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
            <TouchableOpacity onPress={() => go?.('sale')} style={styles.bottomLinkButton}>
              <Text style={styles.bottomLinkText}>
                {lang === 'bn' ? 'সকল বিক্রয় ও বিস্তারিত লেজার দেখুন →' : 'View all sales & ledger →'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Right Column: Rice Godown Stock */}
        <View style={[styles.columnCard, isDesktop ? { flex: 1 } : { width: '100%' }]}>
          <View style={styles.cardTop}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View style={[styles.sectionIndicatorCircle, { backgroundColor: '#10B981' }]} />
              <View>
                <Text style={styles.cardHeading}>{lang === 'bn' ? 'চালের গুদাম মজুদ' : 'Rice Stock'}</Text>
                <Text style={styles.cardSubheading}>
                  {lang === 'bn' ? `মোট চাল: ${toBnDigits(totalStockBags)} বস্তা` : `${totalStockBags} Bags in Godown`}
                </Text>
              </View>
            </View>

            <TouchableOpacity onPress={() => go?.('stock')} style={styles.headerSmallBtn}>
              <Text style={styles.headerSmallBtnText}>{lang === 'bn' ? 'সম্পূর্ণ স্টক' : 'Stock'}</Text>
            </TouchableOpacity>
          </View>

          {/* Top Products */}
          <View style={styles.stockList}>
            {topStock.length === 0 ? (
              <View style={styles.emptyWrap}>
                <AppIcon name={icons.stock} size={40} iconColor="#CBD5E1" />
                <Text style={styles.emptyMessage}>{lang === 'bn' ? 'কোনো চাল পাওয়া যায়নি।' : 'No products found.'}</Text>
              </View>
            ) : (
              topStock.map((item, idx) => {
                const p = item.product;
                return (
                  <View key={p.id || idx} style={styles.stockRow}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <Text style={styles.stockName} numberOfLines={1}>{p.name}</Text>
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
                      <View style={styles.stockBagsPill}>
                        <Text style={[styles.stockBags, item.isLow && { color: '#DC2626' }]}>
                          {lang === 'bn' ? `${toBnDigits(item.physicalBags)} বস্তা` : `${item.physicalBags} Bags`}
                        </Text>
                      </View>
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
            <TouchableOpacity onPress={() => go?.('stock')} style={styles.bottomLinkButton}>
              <Text style={styles.bottomLinkText}>
                {lang === 'bn' ? 'সম্পূর্ণ স্টক খাতা ও নতুন চাল এন্ট্রি →' : 'View full stock & entries →'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollWrapper: {
    flex: 1,
    backgroundColor: '#F0F6FC',
  },
  container: {
    padding: 20,
    maxWidth: 1440,
    alignSelf: 'center',
    width: '100%',
    paddingBottom: 48,
  },

  /* 1. HERO HEADER */
  heroHeaderBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 16,
    marginBottom: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderRadius: 16,
    backgroundColor: '#1c70b9',
    borderTopWidth: 1.5,
    borderTopColor: '#60b0f4',
    borderBottomWidth: 3.5,
    borderBottomColor: '#124c7e',
    overflow: 'hidden',
    position: 'relative',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(135deg, #2592ed 0%, #1c70b9 52%, #12518e 100%)',
      boxShadow: '0 8px 22px rgba(28, 112, 185, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.45)',
    } as any : { elevation: 4 }),
  },
  headerGlossSheen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  headerInfo: {
    gap: 6,
    zIndex: 2,
  },
  appLogoCircle: {
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
    fontSize: 22,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 12.5,
    color: '#DCEBFA',
    fontWeight: '500',
    marginTop: 2,
  },
  liveBadge: {
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
  liveText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  actionGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexWrap: 'wrap',
    zIndex: 2,
  },
  tactileHeroBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    borderTopWidth: 1,
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0, 0, 0, 0.25)',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  heroBtnIconWrap: {
    width: 28,
    height: 28,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBtnText: {
    fontSize: 13,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  heroBtnSub: {
    fontSize: 11,
    fontWeight: '600',
    color: '#DCEBFA',
  },
  btnSaleHero: {
    backgroundColor: '#FFFFFF',
    borderTopColor: '#FFFFFF',
    borderBottomColor: 'rgba(0, 0, 0, 0.25)',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
    } as any : {}),
  },
  btnPurchaseHero: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomColor: 'rgba(0, 0, 0, 0.25)',
  },
  btnAccountsHero: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderTopColor: 'rgba(255, 255, 255, 0.45)',
    borderBottomColor: 'rgba(0, 0, 0, 0.25)',
  },

  /* 2. KPI CARDS */
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 16,
    marginBottom: 20,
  },
  kpiCard: {
    flex: 1,
    minWidth: 230,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1.5,
    borderColor: '#D2E3F3',
    borderBottomWidth: 3.5,
    borderBottomColor: '#B6D7F6',
    gap: 8,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(180deg, #FFFFFF 0%, #F9FBFE 100%)',
      boxShadow: '0 6px 18px rgba(28, 112, 185, 0.07)',
      cursor: 'pointer',
      transition: 'transform 0.2s ease, box-shadow 0.2s ease',
    } as any : { elevation: 2 }),
  },
  kpiCardSales: {
    borderTopWidth: 3.5,
    borderTopColor: '#2563EB',
  },
  kpiCardCollection: {
    borderTopWidth: 3.5,
    borderTopColor: '#10B981',
  },
  kpiCardProfit: {
    borderTopWidth: 3.5,
    borderTopColor: '#F59E0B',
  },
  kpiCardStock: {
    borderTopWidth: 3.5,
    borderTopColor: '#8B5CF6',
  },
  kpiTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kpiIconBox: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiTitle: {
    fontSize: 13,
    fontWeight: '700',
    color: '#5B728F',
    marginTop: 2,
  },
  kpiBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
    borderWidth: 1,
  },
  kpiBadgeText: {
    fontSize: 11.5,
    fontWeight: '800',
  },
  kpiAmount: {
    fontSize: 24,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginVertical: 2,
  },
  kpiFooterWrap: {
    borderTopWidth: 1,
    borderTopColor: '#EDF5FC',
    paddingTop: 8,
    marginTop: 2,
  },
  kpiFooterLink: {
    fontSize: 12.5,
    fontWeight: '700',
  },

  /* 3. FINANCIAL SNAPSHOT RIBBON */
  financialRibbonCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#D2E3F3',
    borderBottomWidth: 3.5,
    borderBottomColor: '#B6D7F6',
    padding: 18,
    marginBottom: 20,
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 6px 18px rgba(28, 112, 185, 0.06)',
    } as any : { elevation: 2 }),
  },
  ribbonHeaderWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F6FC',
    marginBottom: 12,
  },
  ribbonDotIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#1c70b9',
  },
  ribbonHeadingText: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F1E36',
  },
  ribbonContentRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 16,
  },
  ribbonItem: {
    flex: 1,
    minWidth: 220,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 6,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  ribbonItemIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#FEE2E2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ribbonLabel: {
    fontSize: 12.5,
    color: '#5B728F',
    fontWeight: '700',
  },
  ribbonVal: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 2,
    letterSpacing: -0.3,
  },
  ribbonSub: {
    fontSize: 11.5,
    color: '#8497AD',
    fontWeight: '600',
    marginTop: 2,
  },
  ribbonDivider: {
    width: 1.5,
    height: 46,
    backgroundColor: '#E2E8F0',
  },

  /* 4. MAIN OPERATING 2-COLUMN SECTION */
  mainLayout: {
    gap: 18,
  },
  columnCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#D2E3F3',
    borderBottomWidth: 3.5,
    borderBottomColor: '#B6D7F6',
    padding: 20,
    gap: 16,
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 6px 18px rgba(28, 112, 185, 0.06)',
    } as any : { elevation: 2 }),
  },
  sectionIndicatorCircle: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  cardTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 10,
    paddingBottom: 14,
    borderBottomWidth: 1.5,
    borderBottomColor: '#F0F6FC',
  },
  cardHeading: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F1E36',
  },
  cardSubheading: {
    fontSize: 12.5,
    color: '#5B728F',
    fontWeight: '500',
    marginTop: 2,
  },
  pillGroup: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#F1F5F9',
    padding: 4,
    borderRadius: 10,
  },
  pill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  pillActive: {
    backgroundColor: '#1c70b9',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 2px 6px rgba(28, 112, 185, 0.25)',
    } as any : {}),
  },
  pillText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
  },
  pillTextActive: {
    color: '#FFFFFF',
  },
  invoiceList: {
    gap: 10,
  },
  invoiceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#F8FBFE',
    borderWidth: 1.5,
    borderColor: '#E2EDF8',
    borderBottomWidth: 2.5,
    borderBottomColor: '#CBDDF0',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer', transition: 'all 0.15s ease' } as any) : {}),
  },
  invLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  invNoBadge: {
    backgroundColor: '#E0F0FE',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  invNoText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#0369A1',
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
  },
  invCust: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F1E36',
  },
  invDate: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 2,
  },
  invRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  invTotal: {
    fontSize: 15,
    fontWeight: '800',
    color: '#0F1E36',
  },
  invDue: {
    fontSize: 12,
    fontWeight: '700',
    color: '#DC2626',
    marginTop: 2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 1,
  },
  statusBadgeText: {
    fontSize: 12,
    fontWeight: '800',
  },
  cardBottom: {
    borderTopWidth: 1,
    borderTopColor: '#F0F6FC',
    paddingTop: 10,
    alignItems: 'center',
  },
  bottomLinkButton: {
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  bottomLinkText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1c70b9',
  },
  headerSmallBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    backgroundColor: '#ECFDF5',
    borderWidth: 1,
    borderColor: '#A7F3D0',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  headerSmallBtnText: {
    fontSize: 12,
    fontWeight: '800',
    color: '#047857',
  },
  stockList: {
    gap: 10,
  },
  stockRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: '#F8FBFE',
    borderWidth: 1.5,
    borderColor: '#E2EDF8',
    borderBottomWidth: 2.5,
    borderBottomColor: '#CBDDF0',
  },
  stockName: {
    fontSize: 14,
    fontWeight: '800',
    color: '#0F1E36',
  },
  lowTag: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  lowTagText: {
    fontSize: 10.5,
    fontWeight: '800',
    color: '#DC2626',
  },
  stockMeta: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 3,
  },
  stockBagsPill: {
    backgroundColor: '#E0F0FE',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  stockBags: {
    fontSize: 13.5,
    fontWeight: '800',
    color: '#0369A1',
  },
  stockKg: {
    fontSize: 11.5,
    color: '#64748B',
    marginTop: 3,
  },
  emptyWrap: {
    padding: 32,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  emptyMessage: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
  },
  emptyAddBtn: {
    backgroundColor: '#1c70b9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    marginTop: 4,
  },
  emptyAddBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
});
