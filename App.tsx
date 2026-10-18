import React, { useState, useEffect } from 'react';
import { SafeAreaView, View, Text, TextInput, TouchableOpacity, StatusBar, Modal, ScrollView, Platform } from 'react-native';
import { AppProvider, useApp } from './src/store';
import { Key, tp } from './src/i18n';
import { color, useMoney, useDateStr } from './src/ui';
import { Home, Trade, Products, Parties, Money, Stock, Accounts, More, Trash, DetailShell, InvoiceModal, ReturnHome, ReturnModal, BankCash, StockDashboard, ExpenseDashboard } from './src/screens';
import { api, Reminder, GSearchRes } from './src/api';

import { AppIcon, icons, TAB_ICON_SIZE, IconName } from './src/icons';
import { useBreakpoint, useFs } from './src/responsive';

const tabs: { r: string; k: Key; icon: IconName }[] = [
  { r: 'home', k: 'home', icon: icons.home },
  { r: 'sale', k: 'sale', icon: icons.sale },
  { r: 'purchase', k: 'purchase', icon: icons.purchase },
  { r: 'accounts', k: 'accounts', icon: icons.accounts },
  { r: 'more', k: 'more', icon: icons.more },
];

// Desktop sidebar: Home, Purchase, Purchase Return, Sales, Sales Return,
// Products, Accounts, Settings. Customers / Vendors / Stock / Trash /
// Receive / Pay stay reachable from the More (Settings) screen, global search
// and the Accounts screen - no feature was removed.
const sidebar: { r: string; k: Key; icon: IconName }[] = [
  { r: 'home', k: 'home', icon: icons.home },
  { r: 'purchase', k: 'purchase', icon: icons.purchase },
  { r: 'return-purchase', k: 'purchaseReturn', icon: icons.retPurchase },
  { r: 'vendors', k: 'vendors', icon: icons.vendors },
  { r: 'products', k: 'products', icon: icons.products },
  { r: 'sale', k: 'sale', icon: icons.sale },
  { r: 'return-sale', k: 'saleReturn', icon: icons.retSale },
  { r: 'customers', k: 'customers', icon: icons.customers },
  { r: 'stock', k: 'stockDashboard', icon: icons.stock },
  { r: 'expense', k: 'expenseDashboard', icon: icons.expense },
  { r: 'accounts', k: 'accountsLabel', icon: icons.accounts },
  { r: 'bank', k: 'bankCash', icon: icons.bankCash },
  { r: 'more', k: 'office', icon: icons.office },
  { r: 'trash', k: 'trash', icon: icons.del },
];
// Desktop-only sidebar density. Pointer input, so rows can be tighter than the
// 48px mobile touch target: 42px row + 2px gap keeps every label readable and
// clickable while fitting all 14 menus without scrolling on a normal screen.
const SIDE_ROW_H = 40;
const SIDE_ROW_GAP = 1;
const tabOf = (r: string) => (tabs.some(x => x.r === r) ? r : 'more');
// Sub-routes highlight their sidebar parent.
const sideActive = (route: string, r: string) => {
  if (route === r) return true;
  if (r === 'products' && route === 'stock') return false;
  if (r === 'accounts' && (route === 'collect' || route === 'pay')) return true;
  // The generic `return` route (deep link / old bookmark) must not light up
  // either return entry: the two return contexts are separate.
  if ((r === 'return-sale' || r === 'return-purchase') && route === 'return') return false;
  if (r === 'more' && (route === 'collect' || route === 'pay')) return false;
  return false;
};
const titleKey: Record<string, Key> = {
  collect: 'collect', pay: 'pay', products: 'products', customers: 'customers', vendors: 'vendors',
  stock: 'stockDashboard', expense: 'expenseDashboard', trash: 'trash', return: 'ret', 'return-sale': 'saleReturn', 'return-purchase': 'purchaseReturn',
  bank: 'bankCash',
};

// Hash routes for web so refresh + Back/Forward restore the page.
// Native keeps plain in-memory navigation (window is undefined there).
// `return` stays for old bookmarks; the sidebar uses the two split routes.
const ROUTES = ['home', 'sale', 'purchase', 'accounts', 'more', 'products', 'customers', 'vendors', 'stock', 'expense', 'collect', 'pay', 'trash', 'return', 'return-sale', 'return-purchase', 'bank'] as const;
const isWeb = typeof window !== 'undefined' && typeof window.location !== 'undefined';
const routeFromHash = (): string => {
  if (!isWeb) return 'home';
  const h = window.location.hash.replace(/^#\/?/, '').split('?')[0];
  return (ROUTES as readonly string[]).includes(h) ? h : 'home';
};

function Shell() {
  const { t, lang, ready, loadError, retry } = useApp();
  const m = useMoney();
  const [route, setRouteState] = useState<string>(routeFromHash);
  const [notifs, setNotifs] = useState<Reminder[]>([]);
  const [bellOpen, setBellOpen] = useState(false);
  const [focus, setFocus] = useState<{ kind: 'c' | 'v'; id: string } | null>(null);
  const [qOpen, setQOpen] = useState(false);
  const [q, setQ] = useState('');
  const [qLim, setQLim] = useState(6);
  const [res, setRes] = useState<GSearchRes | null>(null);
  const [inv, setInv] = useState<{ kind: 'sale' | 'purchase'; id: string } | null>(null);
  const [retView, setRetView] = useState<string | null>(null);
  const [partyFocus, setPartyFocus] = useState<{ kind: 'c' | 'v'; id: string } | null>(null);
  const [returnFocus, setReturnFocus] = useState<{ kind: 'sale' | 'purchase'; id: string } | null>(null);
  const fd = useDateStr();
  const setRoute = (r: string) => {
    setRouteState(r);
    if (isWeb) {
      const h = `#/${r === 'home' ? '' : r}`;
      if (window.location.hash !== h) window.location.hash = h;
    }
  };
  const home = () => setRoute('home');
  useEffect(() => {
    if (!isWeb) return;
    const onHash = () => setRouteState(routeFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  // Reminder center: persisted server-side, refreshed on load + navigation.
  useEffect(() => {
    if (!ready) return;
    let on = true;
    api.reminders().then(r => { if (on) setNotifs(r.reminders); }).catch(() => {});
    return () => { on = false; };
  }, [ready, route]);
  // Global search with small debounce; empty query shows only the hint.
  useEffect(() => {
    const query = q.trim();
    if (!query) { setRes(null); return; }
    const h = setTimeout(() => {
      api.gsearch(query, qLim).then(r => setRes(r)).catch(() => {});
    }, 250);
    return () => clearTimeout(h);
  }, [q, qLim]);
  const closeSearch = () => { setQOpen(false); setQ(''); setRes(null); setQLim(6); };
  const openNotif = (r: Reminder) => {
    setNotifs(ns => ns.filter(x => x.id !== r.id));
    setBellOpen(false);
    api.reminderRead(r.id).catch(() => {});
    setFocus({ kind: r.partyKind, id: r.partyId });
    setRoute('accounts');
  };
  const notifText = (r: Reminder) => {
    const vars = { name: r.partyName, amount: m(r.amount) };
    if (r.partyKind === 'c') return tp(lang, r.occasion === 'today' ? 'notifRecvToday' : 'notifRecvTomorrow', vars);
    return tp(lang, r.occasion === 'today' ? 'notifPayToday' : 'notifPayTomorrow', vars);
  };
  const { isDesktop } = useBreakpoint();
  const headerFs = useFs(20, 19);
  if (!ready) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color.bg, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        {loadError ? (
          <View style={{ alignItems: 'center', gap: 12 }}>
            <Text style={{ fontSize: 16, color: color.text, textAlign: 'center' }}>{loadError}</Text>
            <TouchableOpacity onPress={retry} style={{ backgroundColor: color.primary, borderRadius: 14, minHeight: 52, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>↻</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={{ fontSize: 16, color: color.muted }}>…</Text>
        )}
      </SafeAreaView>
    );
  }
  const body = {
    home: <Home go={setRoute} />, sale: <Trade key="s" mode="sale" />, purchase: <Trade key="p" mode="purchase" />, accounts: <Accounts go={setRoute} focus={focus} onFocusDone={() => setFocus(null)} />, more: <More go={setRoute} />,
    products: <Products />, customers: <Parties kind="c" focus={partyFocus?.kind === 'c' ? partyFocus.id : null} onFocusDone={() => setPartyFocus(null)} onReturn={(k, id) => openReturnFlow(k, id)} />, vendors: <Parties kind="v" focus={partyFocus?.kind === 'v' ? partyFocus.id : null} onFocusDone={() => setPartyFocus(null)} onReturn={(k, id) => openReturnFlow(k, id)} />, stock: <StockDashboard />, expense: <ExpenseDashboard />, collect: <Money key="c" kind="c" done={home} />, pay: <Money key="v" kind="v" done={home} />, trash: <Trash />,
    return: <ReturnHome focus={returnFocus} onFocusDone={() => setReturnFocus(null)} />,
    'return-sale': <ReturnHome key="rs" initialKind="sale" focus={returnFocus} onFocusDone={() => setReturnFocus(null)} />,
    'return-purchase': <ReturnHome key="rp" initialKind="purchase" focus={returnFocus} onFocusDone={() => setReturnFocus(null)} />,
    bank: <BankCash />,
  }[route];
  const openInv = (kind: 'sale' | 'purchase', id: string) => { closeSearch(); setInv({ kind, id }); };
  const openParty = (kind: 'c' | 'v', id: string) => { closeSearch(); setPartyFocus({ kind, id }); setRoute(kind === 'c' ? 'customers' : 'vendors'); };
  const openReturnFlow = (kind: 'sale' | 'purchase', id: string) => {
    setInv(null); setReturnFocus({ kind, id });
    setRoute(kind === 'sale' ? 'return-sale' : 'return-purchase');
  };
  const openRet = (id: string) => { closeSearch(); setRetView(id); };
  const gRow = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 8, paddingVertical: 10, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: color.line, minHeight: 60 };
  const gHead = { fontSize: 13, fontWeight: '700' as const, color: color.muted, paddingHorizontal: 12, paddingTop: 10, paddingBottom: 2 };
  const searchPanel = !qOpen ? null : (
    <View style={{ position: 'absolute', top: '100%', left: 8, right: 8, zIndex: 60, elevation: 8, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: color.line, maxHeight: 420, overflow: 'hidden' }}>
      {Platform.OS === 'web' ? (
        <TouchableOpacity activeOpacity={1} onPress={closeSearch} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 55 } as any} />
      ) : null}
      <ScrollView keyboardShouldPersistTaps="handled">
        {!q.trim() ? (
          <Text style={{ textAlign: 'center', padding: 20, color: color.muted, fontSize: 15 }}>{t('searchHint')}</Text>
        ) : !res ? null : (!res.invoices.length && !res.returns.length && !res.customers.length && !res.vendors.length ? (
          <Text style={{ textAlign: 'center', padding: 20, color: color.muted, fontSize: 15 }}>{t('noResult')}</Text>
        ) : (
          <View>
            {res.invoices.length ? (
              <View>
                <Text style={gHead}>{t('invoice')}</Text>
                {res.invoices.map(r => (
                  <TouchableOpacity key={r.kind + r.id} onPress={() => openInv(r.kind, r.id)} style={gRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: color.text }}>{r.no}</Text>
                      <Text style={{ fontSize: 14, color: color.muted }}>{(r.kind === 'sale' ? t('sale') : t('purchase'))} • {r.partyName ?? t('cashSale')}</Text>
                      <Text style={{ fontSize: 14, color: color.muted }}>{m(r.total)} • {fd(r.date)}</Text>
                    </View>
                    <AppIcon name={icons.chevR} size={22} iconColor={color.muted} />
                  </TouchableOpacity>
                ))}
                {res.more.invoices && qLim <= 6 ? (
                  <TouchableOpacity onPress={() => setQLim(50)} style={{ padding: 12, alignItems: 'center' }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: color.primary }}>{t('viewMore')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
            {res.returns.length ? (
              <View>
                <Text style={gHead}>{t('ret')}</Text>
                {res.returns.map(r => (
                  <TouchableOpacity key={r.kind + r.id} onPress={() => openRet(r.id)} style={gRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: '700', color: color.text }}>{r.no}</Text>
                      <Text style={{ fontSize: 14, color: color.muted }}>{(r.kind === 'sreturn' ? t('saleReturn') : t('purchaseReturn'))} • {r.partyName ?? ''}</Text>
                      <Text style={{ fontSize: 14, color: color.muted }}>{m(r.total)} • {fd(r.date)}</Text>
                    </View>
                    <AppIcon name={icons.chevR} size={22} iconColor={color.muted} />
                  </TouchableOpacity>
                ))}
                {res.more.returns && qLim <= 6 ? (
                  <TouchableOpacity onPress={() => setQLim(50)} style={{ padding: 12, alignItems: 'center' }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: color.primary }}>{t('viewMore')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
            {res.customers.length ? (
              <View>
                <Text style={gHead}>{t('customers')}</Text>
                {res.customers.map(c => (
                  <TouchableOpacity key={c.id} onPress={() => openParty('c', c.id)} style={gRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: '600', color: color.text }}>{c.name}</Text>
                      <Text style={{ fontSize: 14, color: color.muted }}>{c.mobile}</Text>
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: c.balance > 0 ? color.red : color.primary }}>{m(c.balance)}</Text>
                    <AppIcon name={icons.chevR} size={22} iconColor={color.muted} />
                  </TouchableOpacity>
                ))}
                {res.more.customers && qLim <= 6 ? (
                  <TouchableOpacity onPress={() => setQLim(50)} style={{ padding: 12, alignItems: 'center' }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: color.primary }}>{t('viewMore')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
            {res.vendors.length ? (
              <View>
                <Text style={gHead}>{t('vendors')}</Text>
                {res.vendors.map(v => (
                  <TouchableOpacity key={v.id} onPress={() => openParty('v', v.id)} style={gRow}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: '600', color: color.text }}>{v.name}</Text>
                      <Text style={{ fontSize: 14, color: color.muted }}>{v.mobile}</Text>
                    </View>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: v.balance > 0 ? color.red : color.primary }}>{m(v.balance)}</Text>
                    <AppIcon name={icons.chevR} size={22} iconColor={color.muted} />
                  </TouchableOpacity>
                ))}
                {res.more.vendors && qLim <= 6 ? (
                  <TouchableOpacity onPress={() => setQLim(50)} style={{ padding: 12, alignItems: 'center' }}>
                    <Text style={{ fontSize: 15, fontWeight: '700', color: color.primary }}>{t('viewMore')}</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            ) : null}
          </View>
        ))}
      </ScrollView>
    </View>
  );
  const header = (
    <View style={{ position: 'relative', zIndex: 50 }}>
      <View style={{
        padding: 14,
        backgroundColor: color.primary,
        borderBottomWidth: 3,
        borderBottomColor: '#124c7e',
        borderTopWidth: 1,
        borderTopColor: '#5faef2',
        ...(Platform.OS === 'web' ? {
          backgroundImage: 'linear-gradient(135deg, #258fe8 0%, #1c70b9 52%, #135591 100%)',
          boxShadow: '0 4px 14px rgba(28, 112, 185, 0.3), inset 0 1px 0 rgba(255,255,255,0.4)',
        } as any : {}),
        flexDirection: 'row',
        alignItems: 'center',
      }}>
        {qOpen ? (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <TouchableOpacity onPress={closeSearch} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name={icons.back} size={22} iconColor="#fff" />
            </TouchableOpacity>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#fff', borderRadius: 12, paddingHorizontal: 12, minHeight: 48 }}>
              <AppIcon name={icons.search} size={20} iconColor={color.muted} />
              <TextInput
                value={q}
                onChangeText={v => { setQ(v); setQLim(6); }}
                placeholder={t('searchGlobal')}
                placeholderTextColor={color.muted}
                autoFocus
                onKeyPress={(e: any) => { if (e?.nativeEvent?.key === 'Escape') closeSearch(); }}
                selectionColor={color.primary}
                style={{ flex: 1, fontSize: 16, color: color.text, minHeight: 46, outlineStyle: 'none' } as any}
              />
              {q ? (
                <TouchableOpacity onPress={() => { setQ(''); setQLim(6); }} style={{ minHeight: 40, minWidth: 40, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name={icons.cancel} size={20} iconColor={color.muted} />
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        ) : (
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}>
            {route in titleKey && !isDesktop && <TouchableOpacity onPress={() => setRoute('more')} style={{ marginRight: 12, minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}><AppIcon name={icons.back} size={22} iconColor="#fff" /></TouchableOpacity>}
            <Text style={{ color: '#fff', fontSize: headerFs, fontWeight: '700', flex: 1 }} numberOfLines={1}>{titleKey[route] ? t(titleKey[route]) : 'চালের আড়ৎ'}</Text>
            <TouchableOpacity onPress={() => setQOpen(true)} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name={icons.search} size={24} iconColor="#fff" />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setBellOpen(true)} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
              <View>
                <AppIcon name={icons.bell} size={24} iconColor="#fff" />
                {notifs.length ? (
                  <View style={{ position: 'absolute', top: -6, right: -8, backgroundColor: '#C62828', borderRadius: 10, minWidth: 20, minHeight: 20, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
                    <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{notifs.length > 9 ? '9+' : String(notifs.length)}</Text>
                  </View>
                ) : null}
              </View>
            </TouchableOpacity>
          </View>
        )}
      </View>
      {searchPanel}
    </View>
  );
  const bellList = (
    <Modal visible={bellOpen} transparent animationType="fade" onRequestClose={() => setBellOpen(false)}>
      <TouchableOpacity activeOpacity={1} onPress={() => setBellOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
        <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ width: '100%', maxWidth: 480, maxHeight: '85%', backgroundColor: color.bg, borderRadius: 16, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 14, paddingRight: 4, backgroundColor: color.primary }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700' }}>{t('notifications')}</Text>
            <TouchableOpacity onPress={() => setBellOpen(false)} style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name={icons.cancel} size={22} iconColor="#fff" />
            </TouchableOpacity>
          </View>
          <ScrollView style={{ padding: 14 }} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
            {!notifs.length ? <Text style={{ textAlign: 'center', padding: 24, color: color.muted }}>{t('noNotif')}</Text> : null}
            {notifs.some(r => r.occasion === 'today') ? (
              <View>
                <Text style={{ fontSize: 15, fontWeight: '700', color: color.text, marginVertical: 6 }}>{t('today')}</Text>
                {notifs.filter(r => r.occasion === 'today').map(r => (
                  <TouchableOpacity key={r.id} onPress={() => openNotif(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: color.line, padding: 12, marginBottom: 8, minHeight: 60 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.primary }} />
                    <Text style={{ flex: 1, fontSize: 15, color: color.text }}>{notifText(r)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
            {notifs.some(r => r.occasion === 'tomorrow') ? (
              <View>
                <Text style={{ fontSize: 15, fontWeight: '700', color: color.text, marginVertical: 6 }}>{t('tomorrow')}</Text>
                {notifs.filter(r => r.occasion === 'tomorrow').map(r => (
                  <TouchableOpacity key={r.id} onPress={() => openNotif(r)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: color.line, padding: 12, marginBottom: 8, minHeight: 60 }}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color.primary }} />
                    <Text style={{ flex: 1, fontSize: 15, color: color.text }}>{notifText(r)}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : null}
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
  if (isDesktop) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: color.bg, paddingTop: StatusBar.currentHeight }}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ width: 248, backgroundColor: '#FFFFFF', borderRightWidth: 1.5, borderRightColor: '#D8E7F5', paddingVertical: 14, paddingHorizontal: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 8, paddingVertical: 12, marginBottom: 8 }}>
              <View style={{
                height: 42,
                width: 42,
                borderRadius: 12,
                backgroundColor: color.primary,
                alignItems: 'center',
                justifyContent: 'center',
                borderBottomWidth: 3,
                borderBottomColor: '#124c7e',
                borderTopWidth: 1,
                borderTopColor: '#5faef2',
                ...(Platform.OS === 'web' ? {
                  backgroundImage: 'linear-gradient(135deg, #2b91e8 0%, #1c70b9 55%, #145994 100%)',
                  boxShadow: '0 4px 12px rgba(28, 112, 185, 0.35), inset 0 1px 1px rgba(255,255,255,0.45)',
                } as any : {}),
              }}>
                <AppIcon name={icons.stock} size={22} iconColor="#fff" />
              </View>
              <View>
                <Text style={{ fontSize: 18, fontWeight: '800', color: '#0F1E36', letterSpacing: 0.3 }}>চালের আড়ৎ</Text>
                <Text style={{ fontSize: 11, fontWeight: '600', color: '#1c70b9' }}>স্মার্ট ম্যানেজমেন্ট</Text>
              </View>
            </View>
            {sidebar.map(x => {
              const on = sideActive(route, x.r);
              return (
                <TouchableOpacity
                  key={x.r}
                  onPress={() => setRoute(x.r)}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    minHeight: SIDE_ROW_H,
                    paddingHorizontal: 12,
                    borderRadius: 12,
                    backgroundColor: on ? '#E0F0FE' : 'transparent',
                    borderWidth: on ? 1.5 : 0,
                    borderColor: on ? '#BEE0FA' : 'transparent',
                    borderLeftWidth: on ? 4 : 0,
                    borderLeftColor: on ? color.primary : 'transparent',
                    marginVertical: SIDE_ROW_GAP,
                    ...(Platform.OS === 'web' && on ? {
                      backgroundImage: 'linear-gradient(135deg, #E6F3FE 0%, #D8ECFD 100%)',
                      boxShadow: '0 2px 8px rgba(28, 112, 185, 0.12), inset 0 1px 0 #FFFFFF',
                    } as any : {}),
                  }}
                >
                  <AppIcon name={x.icon} size={22} iconColor={on ? color.primary : '#5A7391'} />
                  <Text style={{ fontSize: 14, color: on ? color.primary : '#1E293B', fontWeight: on ? '700' : '500' }}>{t(x.k)}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
          <View style={{ flex: 1 }}>
            {(!isDesktop || (route !== 'home' && route !== 'accounts' && route !== 'stock' && route !== 'expense' && route !== 'purchase' && route !== 'sale')) && header}
            <View style={{ flex: 1 }}>{body}</View>
            {bellList}
      {retView ? <ReturnModal id={retView} onClose={() => setRetView(null)} /> : null}
            {inv ? <InvoiceModal kind={inv.kind} id={inv.id} onClose={() => setInv(null)} onReturn={() => { const v = inv; setInv(null); openReturnFlow(v.kind, v.id); }} /> : null}
          </View>
        </View>
      </SafeAreaView>
    );
  }
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: color.bg, paddingTop: StatusBar.currentHeight }}>
      {header}
      <View style={{ flex: 1 }}>{body}</View>
      {bellList}
      {retView ? <ReturnModal id={retView} onClose={() => setRetView(null)} /> : null}
      {inv ? <InvoiceModal kind={inv.kind} id={inv.id} onClose={() => setInv(null)} onReturn={() => { const v = inv; setInv(null); openReturnFlow(v.kind, v.id); }} /> : null}
      <View style={{ flexDirection: 'row', backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: color.line }}>
        {tabs.map(x => {
          const active = tabOf(route) === x.r;
          return (
            <TouchableOpacity key={x.r} onPress={() => setRoute(x.r)} style={{ flex: 1, alignItems: 'center', paddingVertical: 8, minHeight: 56, gap: 2 }}>
              <AppIcon name={x.icon} size={TAB_ICON_SIZE} iconColor={active ? color.primary : color.muted} />
              <Text style={{ fontSize: 12, color: active ? color.primary : color.muted, fontWeight: active ? '700' : '400' }}>{t(x.k)}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </SafeAreaView>
  );
}
export default function App() { return <AppProvider><Shell /></AppProvider>; }
