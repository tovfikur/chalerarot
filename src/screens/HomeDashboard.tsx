import React, { useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, StyleSheet, Platform } from 'react-native';
import { useApp, today, Product, SaleRec } from '../store';
import { useMoney, useNum, useDateStr, toBnDigits, color } from '../ui';
import { AppIcon, icons } from '../icons';
import { useBreakpoint, useFs } from '../responsive';
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
    t,
    lang,
    stats,
    customers,
    vendors,
    sales,
    products,
    expenses,
    returns,
    moneyAccounts,
    bal,
  } = useApp();

  const m = useMoney();
  const n = useNum();
  const fd = useDateStr();
  const s = stats();
  const td = today();
  const { isDesktop, isTablet, isMobile } = useBreakpoint();

  // Invoice tab filter: 'today' | 'due' | 'all'
  const [invoiceTab, setInvoiceTab] = useState<'today' | 'due' | 'all'>('today');
  // Stock search filter
  const [stockQuery, setStockQuery] = useState('');

  // Today's data
  const tSales = useMemo(() => sales.filter(x => x.date === td), [sales, td]);
  const tExp = useMemo(() => expenses.filter(e => e.date === td), [expenses, td]);

  // Customer helper
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
    // Return newest first (limit 8 for dashboard view)
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
  const totalStockKg = useMemo(() => products.reduce((sum, p) => sum + Math.max(0, p.qty), 0), [products]);
  const totalStockVal = useMemo(() => stockSummary.reduce((sum, item) => sum + item.stockVal, 0), [stockSummary]);

  // Filtered products for stock widget
  const filteredStock = useMemo(() => {
    const q = stockQuery.trim().toLowerCase();
    if (!q) return stockSummary.slice(0, 6);
    return stockSummary.filter(item => item.product.name.toLowerCase().includes(q)).slice(0, 6);
  }, [stockSummary, stockQuery]);

  // Total cash & bank balances
  const totalLiquidMoney = useMemo(() => {
    return moneyAccounts.reduce((sum, acc) => sum + (acc.balance || 0), 0);
  }, [moneyAccounts]);

  // Top due customers
  const topDueCustomers = useMemo(() => {
    return customers
      .map(c => ({ customer: c, due: bal('c', c.id).balance }))
      .filter(item => item.due > 0)
      .sort((a, b) => b.due - a.due)
      .slice(0, 5);
  }, [customers, bal]);

  // Active counts
  const activeDueCustCount = useMemo(() => customers.filter(c => bal('c', c.id).balance > 0).length, [customers, bal]);
  const activePayableVendCount = useMemo(() => vendors.filter(v => bal('v', v.id).balance > 0).length, [vendors, bal]);

  // Format today's date in a pleasant display string
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
    <View style={dashStyles.container}>
      {/* 1. Header: Welcome Banner & Fast Actions */}
      <View style={dashStyles.headerCard}>
        <View style={dashStyles.headerLeft}>
          <View style={dashStyles.brandBadge}>
            <AppIcon name={icons.stock} size={28} iconColor="#1B7F4B" />
          </View>
          <View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={dashStyles.headerTitle}>
                {lang === 'bn' ? 'চালের আড়ত ড্যাশবোর্ড' : 'Chaler Arot Dashboard'}
              </Text>
              <View style={dashStyles.statusLiveBadge}>
                <View style={dashStyles.statusDot} />
                <Text style={dashStyles.statusText}>
                  {lang === 'bn' ? 'সিস্টেম লাইভ' : 'Live'}
                </Text>
              </View>
            </View>
            <Text style={dashStyles.headerSubtitle}>
              {lang === 'bn'
                ? `আজকের তারিখ: ${formattedToday} • চালের পাইকারি আড়ত ও সার্বিক হিসাব`
                : `Date: ${formattedToday} • Rice Wholesale & Financial Overview`}
            </Text>
          </View>
        </View>

        {/* Quick Action Navigation Buttons */}
        <View style={dashStyles.actionsBar}>
          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => go?.('sale')}
            style={[dashStyles.actionBtn, { backgroundColor: '#1B7F4B' }]}
          >
            <AppIcon name={icons.sale} size={18} iconColor="#fff" />
            <Text style={dashStyles.actionBtnText}>{lang === 'bn' ? 'নতুন বিক্রয়' : 'New Sale'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => go?.('purchase')}
            style={[dashStyles.actionBtn, { backgroundColor: '#1E3A8A' }]}
          >
            <AppIcon name={icons.purchase} size={18} iconColor="#fff" />
            <Text style={dashStyles.actionBtnText}>{lang === 'bn' ? 'চাল ক্রয়' : 'Purchase'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => go?.('collect')}
            style={[dashStyles.actionBtn, { backgroundColor: '#0284C7' }]}
          >
            <AppIcon name={icons.collect} size={18} iconColor="#fff" />
            <Text style={dashStyles.actionBtnText}>{lang === 'bn' ? 'টাকা আদায়' : 'Collect'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => go?.('expense')}
            style={[dashStyles.actionBtn, { backgroundColor: '#D97706' }]}
          >
            <AppIcon name={icons.expense} size={18} iconColor="#fff" />
            <Text style={dashStyles.actionBtnText}>{lang === 'bn' ? 'খরচ এন্ট্রি' : 'Expense'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            activeOpacity={0.85}
            onPress={() => go?.('stock')}
            style={[dashStyles.actionBtn, { backgroundColor: '#475569' }]}
          >
            <AppIcon name={icons.stock} size={18} iconColor="#fff" />
            <Text style={dashStyles.actionBtnText}>{lang === 'bn' ? 'স্টক রিপোর্ট' : 'Stock'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* 2. Today's Core Performance KPIs (Clickable Drilldown) */}
      <View style={dashStyles.sectionHeaderRow}>
        <Text style={dashStyles.sectionTitle}>
          {lang === 'bn' ? 'আজকের ব্যবসায়িক হিসাব (Today\'s Overview)' : 'Today\'s Business Summary'}
        </Text>
        <Text style={dashStyles.sectionHint}>
          {lang === 'bn' ? '* কার্ডে ক্লিক করে বিস্তারিত হিসাব দেখুন' : '* Click card for detailed breakdown'}
        </Text>
      </View>

      <View style={dashStyles.kpiGrid}>
        {/* Today's Sales */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onDrillDown('sale')}
          style={dashStyles.kpiCard}
        >
          <View style={dashStyles.kpiTop}>
            <View style={[dashStyles.kpiIconWrapper, { backgroundColor: '#E8F5E9' }]}>
              <AppIcon name={icons.sale} size={24} iconColor="#1B7F4B" />
            </View>
            <View style={[dashStyles.kpiBadge, { backgroundColor: '#DCFCE7' }]}>
              <Text style={[dashStyles.kpiBadgeText, { color: '#15803D' }]}>
                {lang === 'bn' ? `${toBnDigits(tSales.length)} টি চালান` : `${tSales.length} Invoices`}
              </Text>
            </View>
          </View>
          <Text style={dashStyles.kpiLabel}>{lang === 'bn' ? 'আজকের মোট বিক্রয়' : 'Today\'s Sales'}</Text>
          <Text style={[dashStyles.kpiValue, { color: '#1B7F4B' }]}>{m(s.todaySale)}</Text>
          <View style={dashStyles.kpiFooter}>
            <Text style={dashStyles.kpiFooterText}>
              {lang === 'bn' ? 'চাল বিক্রয় ও চালান তালিকা →' : 'View sales invoices →'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Today's Collection */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onDrillDown('collect')}
          style={dashStyles.kpiCard}
        >
          <View style={dashStyles.kpiTop}>
            <View style={[dashStyles.kpiIconWrapper, { backgroundColor: '#EFF6FF' }]}>
              <AppIcon name={icons.collect} size={24} iconColor="#2563EB" />
            </View>
            <View style={[dashStyles.kpiBadge, { backgroundColor: '#DBEAFE' }]}>
              <Text style={[dashStyles.kpiBadgeText, { color: '#1E40AF' }]}>
                {lang === 'bn' ? 'ক্যাশ ও ব্যাংক' : 'Cash & Bank'}
              </Text>
            </View>
          </View>
          <Text style={dashStyles.kpiLabel}>{lang === 'bn' ? 'আজকের নগদ আদায়' : 'Today\'s Collection'}</Text>
          <Text style={[dashStyles.kpiValue, { color: '#2563EB' }]}>{m(s.todayCollect)}</Text>
          <View style={dashStyles.kpiFooter}>
            <Text style={dashStyles.kpiFooterText}>
              {lang === 'bn' ? 'কাস্টমারদের জমার খাতা →' : 'Customer payments →'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Today's Due */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onDrillDown('due')}
          style={dashStyles.kpiCard}
        >
          <View style={dashStyles.kpiTop}>
            <View style={[dashStyles.kpiIconWrapper, { backgroundColor: '#FEE2E2' }]}>
              <AppIcon name={icons.pay} size={24} iconColor="#DC2626" />
            </View>
            <View style={[dashStyles.kpiBadge, { backgroundColor: '#FEE2E2' }]}>
              <Text style={[dashStyles.kpiBadgeText, { color: '#B91C1C' }]}>
                {lang === 'bn' ? 'নতুন বাকি' : 'New Due'}
              </Text>
            </View>
          </View>
          <Text style={dashStyles.kpiLabel}>{lang === 'bn' ? 'আজকের নতুন বাকি' : 'Today\'s Due'}</Text>
          <Text style={[dashStyles.kpiValue, { color: s.todayDue > 0 ? '#DC2626' : '#10B981' }]}>
            {m(s.todayDue)}
          </Text>
          <View style={dashStyles.kpiFooter}>
            <Text style={dashStyles.kpiFooterText}>
              {lang === 'bn' ? 'আজকের বাকি চালানসমূহ →' : 'Today\'s due invoices →'}
            </Text>
          </View>
        </TouchableOpacity>

        {/* Today's Net Profit */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => onDrillDown('profit')}
          style={dashStyles.kpiCard}
        >
          <View style={dashStyles.kpiTop}>
            <View style={[dashStyles.kpiIconWrapper, { backgroundColor: '#FEF3C7' }]}>
              <AppIcon name={icons.profit} size={24} iconColor="#D97706" />
            </View>
            <View style={[dashStyles.kpiBadge, { backgroundColor: '#FEF3C7' }]}>
              <Text style={[dashStyles.kpiBadgeText, { color: '#B45309' }]}>
                {lang === 'bn' ? 'নীট লাভ' : 'Net Margin'}
              </Text>
            </View>
          </View>
          <Text style={dashStyles.kpiLabel}>{lang === 'bn' ? 'আজকের নীট লাভ' : 'Today\'s Profit'}</Text>
          <Text style={[dashStyles.kpiValue, { color: s.todayProfit >= 0 ? '#15803D' : '#DC2626' }]}>
            {m(s.todayProfit)}
          </Text>
          <View style={dashStyles.kpiFooter}>
            <Text style={dashStyles.kpiFooterText}>
              {lang === 'bn' ? 'লাভ ও ব্যয়ের বিশ্লেষণ →' : 'Profit breakdown →'}
            </Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* 3. Secondary Financial Snapshot & Stock Valuation */}
      <View style={dashStyles.snapshotRow}>
        {/* Total Market Due */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => go?.('customers')}
          style={dashStyles.snapshotCard}
        >
          <View style={dashStyles.snapshotIcon}>
            <AppIcon name={icons.customers} size={22} iconColor="#DC2626" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={dashStyles.snapshotLabel}>{lang === 'bn' ? 'মোট বাজার বাকি (কাস্টমার)' : 'Total Market Due'}</Text>
            <Text style={[dashStyles.snapshotVal, { color: '#DC2626' }]}>{m(s.due)}</Text>
            <Text style={dashStyles.snapshotSub}>
              {lang === 'bn' ? `${toBnDigits(activeDueCustCount)} জন কাস্টমারের বাকি` : `${activeDueCustCount} parties`}
            </Text>
          </View>
          <AppIcon name={icons.chevR} size={20} iconColor="#94A3B8" />
        </TouchableOpacity>

        {/* Total Vendor Payables */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => go?.('vendors')}
          style={dashStyles.snapshotCard}
        >
          <View style={dashStyles.snapshotIcon}>
            <AppIcon name={icons.vendors} size={22} iconColor="#D97706" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={dashStyles.snapshotLabel}>{lang === 'bn' ? 'মিল ও মহাজন দেনা' : 'Vendor Payables'}</Text>
            <Text style={[dashStyles.snapshotVal, { color: '#D97706' }]}>{m(s.payable)}</Text>
            <Text style={dashStyles.snapshotSub}>
              {lang === 'bn' ? `${toBnDigits(activePayableVendCount)} টি মিল/সরবরাহকারী` : `${activePayableVendCount} vendors`}
            </Text>
          </View>
          <AppIcon name={icons.chevR} size={20} iconColor="#94A3B8" />
        </TouchableOpacity>

        {/* Liquid Cash & Bank */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => go?.('bank')}
          style={dashStyles.snapshotCard}
        >
          <View style={dashStyles.snapshotIcon}>
            <AppIcon name={icons.bankCash} size={22} iconColor="#2563EB" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={dashStyles.snapshotLabel}>{lang === 'bn' ? 'হাতে নগদ ও ব্যাংক ব্যালেন্স' : 'Liquid Cash & Bank'}</Text>
            <Text style={[dashStyles.snapshotVal, { color: '#2563EB' }]}>{m(totalLiquidMoney)}</Text>
            <Text style={dashStyles.snapshotSub}>
              {lang === 'bn' ? `${toBnDigits(moneyAccounts.length)} টি একাউন্ট স্থিতি` : `${moneyAccounts.length} accounts`}
            </Text>
          </View>
          <AppIcon name={icons.chevR} size={20} iconColor="#94A3B8" />
        </TouchableOpacity>

        {/* Rice Godown Stock */}
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={() => go?.('stock')}
          style={dashStyles.snapshotCard}
        >
          <View style={dashStyles.snapshotIcon}>
            <AppIcon name={icons.stock} size={22} iconColor="#1B7F4B" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={dashStyles.snapshotLabel}>{lang === 'bn' ? 'গুদামে চালের মোট মজুদ' : 'Total Rice in Stock'}</Text>
            <Text style={[dashStyles.snapshotVal, { color: '#1B7F4B' }]}>
              {lang === 'bn' ? `${toBnDigits(totalStockBags)} বস্তা` : `${totalStockBags} Bags`}
            </Text>
            <Text style={dashStyles.snapshotSub}>
              {lang === 'bn' ? `মূল্য আনুমানিক ${m(totalStockVal)}` : `Est: ${m(totalStockVal)}`}
            </Text>
          </View>
          <AppIcon name={icons.chevR} size={20} iconColor="#94A3B8" />
        </TouchableOpacity>
      </View>

      {/* 4. Main Two-Column Analytics Grid */}
      <View style={[dashStyles.mainGrid, isDesktop ? { flexDirection: 'row' } : { flexDirection: 'column' }]}>
        
        {/* Left Column: Recent Sales Invoices */}
        <View style={[dashStyles.gridCol, isDesktop ? { flex: 1.2 } : { width: '100%' }]}>
          <View style={dashStyles.panelCard}>
            <View style={dashStyles.panelHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[dashStyles.panelHeaderIcon, { backgroundColor: '#E8F5E9' }]}>
                  <AppIcon name={icons.sale} size={20} iconColor="#1B7F4B" />
                </View>
                <View>
                  <Text style={dashStyles.panelTitle}>
                    {lang === 'bn' ? 'সাম্প্রতিক চাল বিক্রয় ও চালান' : 'Recent Sales & Invoices'}
                  </Text>
                  <Text style={dashStyles.panelSubtitle}>
                    {lang === 'bn' ? 'আজকের বিক্রয় ও বকেয়া চালানসমূহ' : 'Latest invoice records'}
                  </Text>
                </View>
              </View>

              {/* Segmented Filter Pills */}
              <View style={dashStyles.pillFilterRow}>
                <TouchableOpacity
                  onPress={() => setInvoiceTab('today')}
                  style={[dashStyles.filterPill, invoiceTab === 'today' && dashStyles.filterPillActive]}
                >
                  <Text style={[dashStyles.filterPillText, invoiceTab === 'today' && dashStyles.filterPillTextActive]}>
                    {lang === 'bn' ? `আজকের (${toBnDigits(tSales.length)})` : `Today (${tSales.length})`}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setInvoiceTab('due')}
                  style={[dashStyles.filterPill, invoiceTab === 'due' && dashStyles.filterPillActive]}
                >
                  <Text style={[dashStyles.filterPillText, invoiceTab === 'due' && dashStyles.filterPillTextActive]}>
                    {lang === 'bn' ? 'বাকি চালান' : 'Due'}
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setInvoiceTab('all')}
                  style={[dashStyles.filterPill, invoiceTab === 'all' && dashStyles.filterPillActive]}
                >
                  <Text style={[dashStyles.filterPillText, invoiceTab === 'all' && dashStyles.filterPillTextActive]}>
                    {lang === 'bn' ? 'সকল চালান' : 'All'}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* Invoices List */}
            <View style={dashStyles.invoicesList}>
              {displaySales.length === 0 ? (
                <View style={dashStyles.emptyState}>
                  <AppIcon name={icons.calc} size={36} iconColor="#94A3B8" />
                  <Text style={dashStyles.emptyText}>
                    {lang === 'bn' ? 'এই তালিকায় কোনো চালান পাওয়া যায়নি।' : 'No invoices found.'}
                  </Text>
                  <TouchableOpacity
                    onPress={() => go?.('sale')}
                    style={dashStyles.emptyBtn}
                  >
                    <Text style={dashStyles.emptyBtnText}>
                      {lang === 'bn' ? '+ নতুন চালান তৈরি করুন' : '+ Create Invoice'}
                    </Text>
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
                      style={dashStyles.invoiceRow}
                    >
                      <View style={dashStyles.invoiceRowLeft}>
                        <View style={dashStyles.invBadge}>
                          <Text style={dashStyles.invBadgeText}>
                            {sale.invoiceNo || (lang === 'bn' ? 'চালান' : 'INV')}
                          </Text>
                        </View>
                        <View>
                          <Text style={dashStyles.invCustomerName}>
                            {custName(sale.customerId)}
                          </Text>
                          <Text style={dashStyles.invTime}>
                            {sale.createdAt ? fmtTime(sale.createdAt, lang === 'bn') : fd(sale.date)}
                          </Text>
                        </View>
                      </View>

                      <View style={dashStyles.invoiceRowRight}>
                        <View style={{ alignItems: 'flex-end', marginRight: 10 }}>
                          <Text style={dashStyles.invTotal}>{m(sale.total)}</Text>
                          {isDue ? (
                            <Text style={dashStyles.invDue}>
                              {lang === 'bn' ? `বাকি: ${m(sale.total - sale.paid)}` : `Due: ${m(sale.total - sale.paid)}`}
                            </Text>
                          ) : (
                            <Text style={dashStyles.invPaid}>{lang === 'bn' ? 'সম্পূর্ণ পরিশোধ' : 'Fully Paid'}</Text>
                          )}
                        </View>

                        <View style={[
                          dashStyles.statusPill,
                          isPaid ? { backgroundColor: '#DCFCE7' } : isPartial ? { backgroundColor: '#FEF3C7' } : { backgroundColor: '#FEE2E2' }
                        ]}>
                          <Text style={[
                            dashStyles.statusPillText,
                            isPaid ? { color: '#15803D' } : isPartial ? { color: '#B45309' } : { color: '#B91C1C' }
                          ]}>
                            {isPaid ? (lang === 'bn' ? 'পরিশোধিত' : 'Paid') : isPartial ? (lang === 'bn' ? 'আংশিক' : 'Partial') : (lang === 'bn' ? 'বাকি' : 'Due')}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })
              )}
            </View>

            <View style={dashStyles.panelFooter}>
              <TouchableOpacity
                onPress={() => go?.('sale')}
                style={dashStyles.footerLink}
              >
                <Text style={dashStyles.footerLinkText}>
                  {lang === 'bn' ? 'সকল বিক্রয় চালান ও বিস্তারিত খাতা দেখুন →' : 'View full sales ledger →'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Right Column: Rice Godown Stock Status */}
        <View style={[dashStyles.gridCol, isDesktop ? { flex: 1 } : { width: '100%' }]}>
          <View style={dashStyles.panelCard}>
            <View style={dashStyles.panelHeader}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={[dashStyles.panelHeaderIcon, { backgroundColor: '#EFF6FF' }]}>
                  <AppIcon name={icons.stock} size={20} iconColor="#2563EB" />
                </View>
                <View>
                  <Text style={dashStyles.panelTitle}>
                    {lang === 'bn' ? 'চালের গুদাম ও স্টক স্থিতি' : 'Rice Godown Inventory'}
                  </Text>
                  <Text style={dashStyles.panelSubtitle}>
                    {lang === 'bn' ? `মোট চাল: ${toBnDigits(totalStockBags)} বস্তা (${n(totalStockKg)} কেজি)` : `${totalStockBags} Bags in stock`}
                  </Text>
                </View>
              </View>

              <TouchableOpacity
                onPress={() => go?.('stock')}
                style={dashStyles.headerSmallBtn}
              >
                <Text style={dashStyles.headerSmallBtnText}>{lang === 'bn' ? 'স্টক খাতা' : 'Stock'}</Text>
              </TouchableOpacity>
            </View>

            {/* Quick search input */}
            <View style={dashStyles.searchBox}>
              <AppIcon name={icons.search} size={18} iconColor="#94A3B8" />
              <TextInput
                value={stockQuery}
                onChangeText={setStockQuery}
                placeholder={lang === 'bn' ? 'চালের নাম দিয়ে খুঁজুন (মিনিকেট, নাজিরশাইল...)' : 'Search rice variety...'}
                placeholderTextColor="#94A3B8"
                style={dashStyles.searchInput}
              />
              {stockQuery.length > 0 && (
                <TouchableOpacity onPress={() => setStockQuery('')}>
                  <AppIcon name={icons.cancel} size={18} iconColor="#94A3B8" />
                </TouchableOpacity>
              )}
            </View>

            {/* Stock List */}
            <View style={dashStyles.stockList}>
              {filteredStock.length === 0 ? (
                <View style={dashStyles.emptyState}>
                  <Text style={dashStyles.emptyText}>
                    {lang === 'bn' ? 'কোনো চাল পাওয়া যায়নি।' : 'No products found.'}
                  </Text>
                </View>
              ) : (
                filteredStock.map((item, idx) => {
                  const p = item.product;
                  // Calculate stock health meter (0 to 100%)
                  const progressPct = Math.min(100, Math.max(8, (item.physicalBags / 150) * 100));
                  return (
                    <View key={p.id || idx} style={dashStyles.stockRow}>
                      <View style={dashStyles.stockRowMain}>
                        <View style={{ flex: 1 }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                            <Text style={dashStyles.stockName}>{p.name}</Text>
                            {item.isLow && (
                              <View style={dashStyles.lowStockTag}>
                                <Text style={dashStyles.lowStockText}>
                                  {lang === 'bn' ? 'স্বল্প স্টক' : 'Low'}
                                </Text>
                              </View>
                            )}
                          </View>
                          <Text style={dashStyles.stockWeight}>
                            {lang === 'bn' ? `${toBnDigits(item.bagWeight)} কেজি বস্তা • বিক্রয় দর: ${m(p.price)}` : `${item.bagWeight}kg bag • Price: ${m(p.price)}`}
                          </Text>
                        </View>

                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={[dashStyles.stockBags, item.isLow && { color: '#DC2626' }]}>
                            {lang === 'bn' ? `${toBnDigits(item.physicalBags)} বস্তা` : `${item.physicalBags} Bags`}
                          </Text>
                          <Text style={dashStyles.stockKg}>
                            {lang === 'bn' ? `${n(p.qty)} কেজি` : `${n(p.qty)} KG`}
                          </Text>
                        </View>
                      </View>

                      {/* Stock Level Bar */}
                      <View style={dashStyles.progressBarTrack}>
                        <View
                          style={[
                            dashStyles.progressBarFill,
                            {
                              width: `${progressPct}%`,
                              backgroundColor: item.isLow ? '#EF4444' : progressPct > 60 ? '#10B981' : '#F59E0B'
                            }
                          ]}
                        />
                      </View>
                    </View>
                  );
                })
              )}
            </View>

            <View style={dashStyles.panelFooter}>
              <TouchableOpacity
                onPress={() => go?.('stock')}
                style={dashStyles.footerLink}
              >
                <Text style={dashStyles.footerLinkText}>
                  {lang === 'bn' ? 'সম্পূর্ণ চালের গুদাম স্টক ড্যাশবোর্ড দেখুন →' : 'Open full stock manager →'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>

      </View>

      {/* 5. Bottom 3 Management Insights: Cash/Bank, Expenses, Top Due Parties */}
      <View style={dashStyles.bottomGrid}>

        {/* Card A: Cash & Bank Accounts */}
        <View style={dashStyles.bottomCard}>
          <View style={dashStyles.bottomCardHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppIcon name={icons.bankCash} size={20} iconColor="#2563EB" />
              <Text style={dashStyles.bottomCardTitle}>
                {lang === 'bn' ? 'ক্যাশ ড্রয়ার ও ব্যাংক একাউন্ট' : 'Cash & Bank Accounts'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => go?.('bank')}>
              <Text style={dashStyles.cardActionText}>{lang === 'bn' ? 'ব্যবস্থাপনা →' : 'Manage →'}</Text>
            </TouchableOpacity>
          </View>

          <View style={dashStyles.accountsList}>
            {moneyAccounts.slice(0, 4).map((acc, idx) => (
              <View key={acc.id || idx} style={dashStyles.accRow}>
                <View style={dashStyles.accRowLeft}>
                  <View style={[dashStyles.accIcon, { backgroundColor: acc.type === 'cash' ? '#DCFCE7' : '#DBEAFE' }]}>
                    <AppIcon
                      name={acc.type === 'cash' ? icons.cash : acc.type === 'bank' ? icons.bank : icons.bkash}
                      size={18}
                      iconColor={acc.type === 'cash' ? '#15803D' : '#1E40AF'}
                    />
                  </View>
                  <View>
                    <Text style={dashStyles.accName}>{acc.name}</Text>
                    <Text style={dashStyles.accSub}>
                      {acc.type === 'cash'
                        ? (lang === 'bn' ? 'আড়ত ক্যাশ ড্রয়ার' : 'Shop Cash')
                        : (acc.accountNumber ? `${acc.bankName || ''} • ${acc.accountNumber}` : (lang === 'bn' ? 'ব্যাংক একাউন্ট' : 'Bank Account'))}
                    </Text>
                  </View>
                </View>
                <Text style={[dashStyles.accBalance, (acc.balance || 0) < 0 && { color: '#DC2626' }]}>
                  {m(acc.balance || 0)}
                </Text>
              </View>
            ))}
          </View>
        </View>

        {/* Card B: Today's Expenses Breakdown */}
        <View style={dashStyles.bottomCard}>
          <View style={dashStyles.bottomCardHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppIcon name={icons.expense} size={20} iconColor="#D97706" />
              <Text style={dashStyles.bottomCardTitle}>
                {lang === 'bn' ? 'আজকের ব্যয়ের বিবরণ' : 'Today\'s Expenses'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => go?.('expense')}>
              <Text style={dashStyles.cardActionText}>{lang === 'bn' ? '+ খরচ এন্ট্রি' : '+ Add'}</Text>
            </TouchableOpacity>
          </View>

          <View style={dashStyles.accountsList}>
            {tExp.length === 0 ? (
              <View style={dashStyles.emptyStateSmall}>
                <Text style={dashStyles.emptyTextSmall}>
                  {lang === 'bn' ? 'আজকের কোনো খরচ এন্ট্রি করা হয়নি।' : 'No expenses recorded today.'}
                </Text>
              </View>
            ) : (
              tExp.slice(0, 4).map((e, idx) => (
                <View key={e.id || idx} style={dashStyles.accRow}>
                  <View style={dashStyles.accRowLeft}>
                    <View style={[dashStyles.accIcon, { backgroundColor: '#FEF3C7' }]}>
                      <AppIcon name={icons.calc} size={18} iconColor="#D97706" />
                    </View>
                    <View>
                      <Text style={dashStyles.accName}>
                        {e.customName || e.category || (lang === 'bn' ? 'আড়ত খরচ' : 'General')}
                      </Text>
                      <Text style={dashStyles.accSub}>
                        {e.note || fd(e.date)}
                      </Text>
                    </View>
                  </View>
                  <Text style={[dashStyles.accBalance, { color: '#DC2626' }]}>
                    -{m(e.amount)}
                  </Text>
                </View>
              ))
            )}
            <View style={dashStyles.expenseTotalRow}>
              <Text style={dashStyles.expenseTotalLabel}>
                {lang === 'bn' ? 'আজকের মোট খরচ:' : 'Total Expense Today:'}
              </Text>
              <Text style={dashStyles.expenseTotalVal}>
                {m(s.todayExpense)}
              </Text>
            </View>
          </View>
        </View>

        {/* Card C: Top Due Customers */}
        <View style={dashStyles.bottomCard}>
          <View style={dashStyles.bottomCardHeader}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <AppIcon name={icons.customers} size={20} iconColor="#DC2626" />
              <Text style={dashStyles.bottomCardTitle}>
                {lang === 'bn' ? 'শীর্ষ বাকিদার কাস্টমার' : 'Top Outstanding Due'}
              </Text>
            </View>
            <TouchableOpacity onPress={() => go?.('customers')}>
              <Text style={dashStyles.cardActionText}>{lang === 'bn' ? 'খাতা দেখুন →' : 'View All →'}</Text>
            </TouchableOpacity>
          </View>

          <View style={dashStyles.accountsList}>
            {topDueCustomers.length === 0 ? (
              <View style={dashStyles.emptyStateSmall}>
                <Text style={dashStyles.emptyTextSmall}>
                  {lang === 'bn' ? 'কোনো কাস্টমারের বাকি নেই!' : 'No due balance recorded.'}
                </Text>
              </View>
            ) : (
              topDueCustomers.map((item, idx) => (
                <View key={item.customer.id || idx} style={dashStyles.accRow}>
                  <View style={dashStyles.accRowLeft}>
                    <View style={[dashStyles.accIcon, { backgroundColor: '#FEE2E2' }]}>
                      <AppIcon name={icons.customers} size={18} iconColor="#DC2626" />
                    </View>
                    <View>
                      <Text style={dashStyles.accName}>{item.customer.name}</Text>
                      <Text style={dashStyles.accSub}>
                        {item.customer.mobile || (lang === 'bn' ? 'মোবাইল নেই' : 'No mobile')}
                      </Text>
                    </View>
                  </View>
                  <Text style={[dashStyles.accBalance, { color: '#DC2626' }]}>
                    {m(item.due)}
                  </Text>
                </View>
              ))
            )}
          </View>
        </View>

      </View>

    </View>
  );
}

const dashStyles = StyleSheet.create({
  container: {
    paddingBottom: 28,
  },
  headerCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#E2E8E4',
    marginBottom: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 14,
    ...(Platform.OS === 'web' ? { boxShadow: '0 2px 4px rgba(0,0,0,0.03)' } : { elevation: 2 }),
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  brandBadge: {
    width: 52,
    height: 52,
    borderRadius: 14,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#0F172A',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#64748B',
    marginTop: 2,
    fontWeight: '500',
  },
  statusLiveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    gap: 5,
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#16A34A',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#15803D',
  },
  actionsBar: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  actionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 10,
  },
  actionBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    marginTop: 4,
    paddingHorizontal: 2,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1E293B',
  },
  sectionHint: {
    fontSize: 12,
    color: '#64748B',
  },
  kpiGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    minWidth: 220,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderColor: '#E2E8E4',
    ...(Platform.OS === 'web' ? { boxShadow: '0 2px 4px rgba(0,0,0,0.03)' } : { elevation: 2 }),
  },
  kpiTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  kpiIconWrapper: {
    width: 46,
    height: 46,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kpiBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 8,
  },
  kpiBadgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  kpiLabel: {
    fontSize: 13,
    color: '#64748B',
    fontWeight: '500',
    marginBottom: 4,
  },
  kpiValue: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 10,
  },
  kpiFooter: {
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 8,
  },
  kpiFooterText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  snapshotRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginBottom: 16,
  },
  snapshotCard: {
    flex: 1,
    minWidth: 220,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8E4',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  snapshotIcon: {
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  snapshotLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
    marginBottom: 2,
  },
  snapshotVal: {
    fontSize: 17,
    fontWeight: '700',
  },
  snapshotSub: {
    fontSize: 11,
    color: '#94A3B8',
    marginTop: 1,
  },
  mainGrid: {
    gap: 14,
    marginBottom: 16,
  },
  gridCol: {
    minWidth: 300,
  },
  panelCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8E4',
    overflow: 'hidden',
  },
  panelHeader: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  panelHeaderIcon: {
    width: 38,
    height: 38,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panelTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0F172A',
  },
  panelSubtitle: {
    fontSize: 12,
    color: '#64748B',
    marginTop: 1,
  },
  pillFilterRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 8,
    padding: 2,
    gap: 2,
  },
  filterPill: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
  },
  filterPillActive: {
    backgroundColor: '#FFFFFF',
  },
  filterPillText: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500',
  },
  filterPillTextActive: {
    color: '#1B7F4B',
    fontWeight: '700',
  },
  headerSmallBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    backgroundColor: '#EFF6FF',
  },
  headerSmallBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#2563EB',
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F8FAFC',
    margin: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  searchInput: {
    flex: 1,
    fontSize: 13,
    color: '#0F172A',
    outlineStyle: 'none',
  } as any,
  invoicesList: {
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  invoiceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  invoiceRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  invBadge: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  invBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
  },
  invCustomerName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  invTime: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  invoiceRowRight: {
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
    marginTop: 1,
  },
  invPaid: {
    fontSize: 11,
    color: '#16A34A',
    marginTop: 1,
  },
  statusPill: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    minWidth: 54,
    alignItems: 'center',
  },
  statusPillText: {
    fontSize: 11,
    fontWeight: '600',
  },
  stockList: {
    paddingHorizontal: 14,
    paddingBottom: 6,
  },
  stockRow: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  stockRowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  stockName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#0F172A',
  },
  stockWeight: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  lowStockTag: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: 4,
  },
  lowStockText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#B91C1C',
  },
  stockBags: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1B7F4B',
  },
  stockKg: {
    fontSize: 11,
    color: '#64748B',
    marginTop: 1,
  },
  progressBarTrack: {
    height: 5,
    backgroundColor: '#F1F5F9',
    borderRadius: 3,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 3,
  },
  panelFooter: {
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    alignItems: 'center',
    backgroundColor: '#FAFAFA',
  },
  footerLink: {
    paddingVertical: 2,
  },
  footerLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1B7F4B',
  },
  bottomGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 14,
  },
  bottomCard: {
    flex: 1,
    minWidth: 280,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8E4',
  },
  bottomCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
    paddingBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
  },
  bottomCardTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  cardActionText: {
    fontSize: 12,
    color: '#2563EB',
    fontWeight: '600',
  },
  accountsList: {
    gap: 6,
  },
  accRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 7,
    borderBottomWidth: 1,
    borderBottomColor: '#F8FAFC',
  },
  accRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  accIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  accName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#0F172A',
  },
  accSub: {
    fontSize: 11,
    color: '#64748B',
  },
  accBalance: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  expenseTotalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
  },
  expenseTotalLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#64748B',
  },
  expenseTotalVal: {
    fontSize: 14,
    fontWeight: '700',
    color: '#D97706',
  },
  emptyState: {
    paddingVertical: 28,
    alignItems: 'center',
    gap: 8,
  },
  emptyText: {
    fontSize: 13,
    color: '#64748B',
  },
  emptyBtn: {
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 6,
  },
  emptyBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#1B7F4B',
  },
  emptyStateSmall: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  emptyTextSmall: {
    fontSize: 12,
    color: '#94A3B8',
  },
});
