import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { View, Text, TextInput, Alert, TouchableOpacity, Pressable, Modal, ActivityIndicator, ScrollView, Share } from 'react-native';
import { useApp, today, Party, Product, type PeriodFinance } from './store';
import { BagUnit, CartLine, kgPerUnit, toKg, lineTotal } from './bags';
import { Card, Title, Muted, Btn, Field, Chips, Row, Empty, Screen, SectionHead, ListPageHeader, ListTable, type TableColumn, type TableSort, AccountPicker, ACCOUNT_TYPES, methodIcon, methodName, useMoney, useNum, useDateStr, color } from './ui';
import { AppIcon, icons } from './icons';
import { RGrid, TwoPanel, FormGrid, useFs, useBreakpoint } from './responsive';
import { SearchToggle, SearchableSelect, SearchDropdown, NoResult, matchProduct, matchParty } from './search';
import { api, ApiError, type TxnPayment, type SettlementStatus, DetailItem, RecvDetail, PayDetail, TrashItem, SaleDetail, PurchaseDetail, ReturnDetail, ReturnableTxn, type AccountType, type Expense, type MoneyBalance, type MoneyMethod } from './api';
import { unitDetail, fmtTime, buildInvoiceText, buildInvoiceHTML, InvData, UnitNames } from './invoice';
import { tp, Key } from './i18n';
import { toEnDigits, toBnDigits, parseNum } from './bn';
import { printReport, printedAtStamp, type ReportDoc, type ReportRow } from './report';
import { TradeDashboardForm } from './screens/TradeDashboardForm';
import { StockDashboard } from './screens/StockDashboard';
import { ExpenseDashboard } from './screens/ExpenseDashboard';
import { HomeDashboard } from './screens/HomeDashboard';
export { TradeDashboardForm, StockDashboard, ExpenseDashboard, HomeDashboard };

export type Nav = (r: string) => void;
const num = (v: string) => parseNum(v);

// Shop-friendly unit labels. Never expose technical UOM terms.
const useUnitLabel = () => {
  const { t } = useApp(); const kg = t('kg');
  const label = (u: BagUnit) => (u === 'kg' ? kg : u === 'ton' ? t('ton') : u === 'small' ? t('smallBag') : u === 'medium' ? t('mediumBag') : t('largeBag'));
  return { kg, label };
};

// [ কেজি ] [ ছোট বস্তা ] [ মাঝারি বস্তা ] [ বড় বস্তা ] [ টন ]
function UnitChips({ value, onPick }: { value: BagUnit; onPick: (u: BagUnit) => void }) {
  const { label } = useUnitLabel();
  const fs = useFs(15, 14);
  const opts: BagUnit[] = ['kg', 'small', 'medium', 'large', 'ton'];
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 }}>
      {opts.map(u => (
        <TouchableOpacity key={u} onPress={() => onPick(u)} style={{ paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 22, backgroundColor: value === u ? color.primary : '#E8EFE9' }}>
          <Text style={{ color: value === u ? '#fff' : color.text, fontSize: fs, fontWeight: value === u ? '700' : '400' }}>{label(u)}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// KG → decimal input, bags/ton → simple integer stepper. Shared by Sales and Purchase.
function QtyInput({ unit, value, onChange }: { unit: BagUnit; value: string; onChange: (v: string) => void }) {
  const { t } = useApp(); const { kg, label } = useUnitLabel();
  const fs = useFs(20, 16);
  const isKg = unit === 'kg';
  // KG allows decimals, bags/ton stay whole numbers.
  const clean = (v: string) => {
    const s = toEnDigits(v);
    if (isKg) {
      const c = s.replace(/[^0-9.]/g, '');
      const i = c.indexOf('.');
      return i === -1 ? c : c.slice(0, i + 1) + c.slice(i + 1).replace(/\./g, '');
    }
    return s.replace(/[^0-9]/g, '');
  };
  const cur = isKg ? parseNum(value) : parseInt(toEnDigits(value || '0'), 10);
  const bump = (d: number) => {
    const next = cur + d;
    onChange(String(next <= 0 ? 0 : isKg ? Math.round(next * 100) / 100 : Math.floor(next)));
  };
  return (
    <View style={{ marginBottom: 10 }}>
      <Muted>{t('qty')} ({isKg ? kg : label(unit)})</Muted>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 12, marginTop: 6, width: '100%' }}>
        <TouchableOpacity onPress={() => bump(-1)} style={{ minHeight: 52, minWidth: 52, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#fff', borderWidth: 1.5, borderColor: color.primary }}>
          <AppIcon name={icons.minus} size={24} iconColor={color.primary} />
        </TouchableOpacity>
        <TextInput
          value={value}
          onChangeText={v => onChange(clean(v))}
          keyboardType="numeric"
          textAlign="center"
          selectionColor={color.primary}
          style={{ width: 72, minHeight: 52, fontSize: fs, fontWeight: '700', color: color.text, backgroundColor: color.bg, borderRadius: 14, paddingHorizontal: 4, outlineStyle: 'none' } as any}
        />
        <TouchableOpacity onPress={() => bump(1)} style={{ minHeight: 52, minWidth: 52, flexShrink: 0, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: color.primary }}>
          <AppIcon name={icons.plus} size={24} iconColor="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  );
}

export function Home({ go }: { go?: (r: string) => void } = {}) {
  const { t, lang, stats, customers, sales, cTx, expenses, returns, financeToday } = useApp();
  const m = useMoney(); const n = useNum(); const fd = useDateStr(); const s = stats();
  const [view, setView] = useState<null | 'sale' | 'due' | 'collect' | 'profit' | 'cogs' | 'pexp'>(null);
  const [cgroup, setCgroup] = useState<string | null>(null);
  const [inv, setInv] = useState<string | null>(null);
  const [rc, setRc] = useState<string | null>(null);
  const [retV, setRetV] = useState<string | null>(null);
  const td = today();
  const tSales = sales.filter(x => x.date === td);
  const tRet = returns.filter(r => r.kind === 'sale' && r.date === td);
  const tPays = cTx.filter(x => x.kind === 'payment' && x.date === td);
  const tExp = expenses.filter(e => e.date === td);
  const custName = (id?: string) => {
    if (!id || id === 'cash') return t('cashSale');
    return customers.find(c => c.id === id)?.name ?? t('cashSale');
  };
  const Stat = ({ l, v, icon, iconColor, iconBg, onPress }: { l: string; v: number; icon: React.ComponentProps<typeof AppIcon>['name']; iconColor: string; iconBg: string; onPress: () => void }) => {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.8} style={{ flex: 1, minWidth: 220, backgroundColor: '#fff', borderRadius: 12, padding: 16, borderWidth: 1, borderColor: '#E2E8E4', flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <View style={{ width: 50, height: 50, borderRadius: 25, backgroundColor: iconBg, alignItems: 'center', justifyContent: 'center' }}>
          <AppIcon name={icon} size={24} iconColor={iconColor} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500', marginBottom: 4 }}>{l}</Text>
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#0F172A' }}>{m(v)}</Text>
        </View>
      </TouchableOpacity>
    );
  };
  const Head = ({ title, back }: { title: string; back: () => void }) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <TouchableOpacity onPress={back} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
        <AppIcon name={icons.back} size={22} iconColor={color.primary} />
      </TouchableOpacity>
      <Title>{title}</Title>
    </View>
  );
  const dash = (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
      <Stat l={t('todaySale')} v={s.todaySale} icon={icons.sale} iconColor="#1B7F4B" iconBg="#E8F5E9" onPress={() => setView('sale')} />
      <Stat l={t('todayDue')} v={s.todayDue} icon={icons.collect} iconColor="#DC2626" iconBg="#FEE2E2" onPress={() => setView('due')} />
      <Stat l={t('todayCollect')} v={s.todayCollect} icon={icons.collect} iconColor="#2563EB" iconBg="#EFF6FF" onPress={() => setView('collect')} />
      <Stat l={t('todayProfit')} v={s.todayProfit} icon={icons.profit} iconColor="#D97706" iconBg="#FEF3C7" onPress={() => setView('profit')} />
    </View>
  );
  const detail = () => {
    if (view === 'sale') {
      return (
        <View>
          <Head title={t('todaySale')} back={() => setView(null)} />
          <Card>
            <Row left={t('totalSales')} right={m(s.todaySale)} />
            {tSales.map(x => (
              <TouchableOpacity key={x.id} onPress={() => setInv(x.id)}>
                <Row left={x.invoiceNo ?? t('sale')} sub={`${custName(x.customerId)} • ${x.createdAt ? fmtTime(x.createdAt, lang === 'bn') : fd(x.date)}`} right={m(x.total)} />
              </TouchableOpacity>
            ))}
            {tRet.map(r => (
              <TouchableOpacity key={r.id} onPress={() => setRetV(r.id)}>
                <Row left={r.returnNo ?? t('saleReturn')} sub={fd(r.date)} right={m(-r.amount)} neg />
              </TouchableOpacity>
            ))}
            {!tSales.length && !tRet.length ? <Empty /> : null}
          </Card>
        </View>
      );
    }
    if (view === 'due') {
      const dueSales = tSales.filter(x => x.total - x.paid > 0);
      return (
        <View>
          <Head title={t('todayDue')} back={() => setView(null)} />
          <Card>
            <Row left={t('totalDue')} right={m(s.todayDue)} neg={s.todayDue > 0} />
            {s.todayDue <= 0 ? <Muted>{t('noNewDue')}</Muted> : null}
            {dueSales.map(x => (
              <TouchableOpacity key={x.id} onPress={() => setInv(x.id)}>
                <View>
                  <Row left={x.invoiceNo ?? t('sale')} sub={custName(x.customerId)} right={m(x.total - x.paid)} neg />
                  <Muted>{t('total')}: {m(x.total)} • {t('paid')}: {m(x.paid)} • {t('due')}: {m(x.total - x.paid)}</Muted>
                </View>
              </TouchableOpacity>
            ))}
          </Card>
        </View>
      );
    }
    if (view === 'collect') {
      const groups = new Map<string, typeof tPays>();
      for (const x of tPays) {
        const g = groups.get(x.partyId) ?? [];
        g.push(x);
        groups.set(x.partyId, g);
      }
      const sorted = [...groups.entries()].sort((a, b) => {
        const last = (g: typeof tPays) => g.map(x => x.createdAt ?? x.date).sort().reverse()[0] ?? '';
        return last(b[1]) < last(a[1]) ? -1 : 1;
      });
      if (cgroup) {
        const items = [...(groups.get(cgroup) ?? [])].sort((a, b) => {
          const ka = a.createdAt ?? a.date, kb = b.createdAt ?? b.date;
          return ka < kb ? 1 : -1;
        });
        const gTotal = items.reduce((s, x) => s + x.amount, 0);
        return (
          <View>
            <Head title={custName(cgroup)} back={() => setCgroup(null)} />
            <Card>
              <Row left={t('totalPaid')} right={m(gTotal)} />
              {items.map(x => (
                <TouchableOpacity
                  key={x.id}
                  onPress={() => {
                    if (x.saleId && tSales.some(y => y.id === x.saleId)) setInv(x.saleId!);
                    else if (x.partyId !== 'cash') setRc(x.partyId);
                  }}
                >
                  <Row left={x.saleId ? (tSales.find(y => y.id === x.saleId)?.invoiceNo ?? t('sale')) : t('payment')} sub={x.createdAt ? fmtTime(x.createdAt, lang === 'bn') : fd(x.date)} right={m(x.amount)} />
                </TouchableOpacity>
              ))}
            </Card>
          </View>
        );
      }
      return (
        <View>
          <Head title={t('todayCollect')} back={() => setView(null)} />
          <Card>
            <Row left={t('totalPaid')} right={m(s.todayCollect)} />
            {sorted.length ? sorted.map(([pid, items]) => (
              <TouchableOpacity key={pid} onPress={() => setCgroup(pid)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.line }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: color.text }}>{custName(pid)}</Text>
                  </View>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: color.primary }}>{m(items.reduce((a, x) => a + x.amount, 0))}</Text>
                  <AppIcon name={icons.chevR} size={22} iconColor={color.muted} />
                </View>
              </TouchableOpacity>
            )) : <Empty />}
          </Card>
        </View>
      );
    }
    if (view === 'profit') {
      // Canonical figures only: Net Sales - COGS = Gross Profit - Expenses.
      const f = financeToday;
      return (
        <View>
          <Head title={t('todayProfit')} back={() => setView(null)} />
          <Card>
            <SectionHead icon={icons.profit}>{t('todayProfit')}</SectionHead>
            {f ? <ProfitBreakdown f={f} onOpenCogs={() => setView('cogs')} />
              : <Muted>{t('wait')}</Muted>}
            <TouchableOpacity onPress={() => setView('sale')}><Row icon={icons.sale} left={t('totalSales')} right={m(s.todaySale)} /></TouchableOpacity>
            <TouchableOpacity onPress={() => setView('pexp')}><Row icon={icons.calc} left={t('todayExpense')} right={m(s.todayExpense)} neg={s.todayExpense > 0} /></TouchableOpacity>
          </Card>
        </View>
      );
    }
    if (view === 'cogs') {
      // Per-invoice COGS from the stored historical cost snapshot.
      const f = financeToday;
      return (
        <View>
          <Head title={t('cogs')} back={() => setView('profit')} />
          <Card>
            <SectionHead icon={icons.calc}>{t('cogs')}</SectionHead>
            <Row left={t('openingStock')} right={m(f?.openingStockValue ?? 0)} />
            <Row left={t('purchase')} right={m(f?.purchase ?? 0)} />
            {f?.purchaseReturn ? <Row left={`(${t('purchaseReturnLabel')})`} right={m(f.purchaseReturn)} neg /> : null}
            <Row left={`(${t('closingStock')})`} right={m(f?.closingStockValue ?? 0)} neg />
            <Row left={t('cogs')} right={m(f?.cogs ?? 0)} neg={(f?.cogs ?? 0) > 0} />
            {tSales.map(x => (
              <TouchableOpacity key={x.id} onPress={() => setInv(x.id)}>
                <Row left={x.invoiceNo ?? t('sale')} sub={custName(x.customerId)} right={m(x.total - x.profit)} neg />
              </TouchableOpacity>
            ))}
            {!tSales.length ? <Empty /> : null}
          </Card>
        </View>
      );
    }
    if (view === 'pexp') {
      return (
        <View>
          <Head title={t('todayExpense')} back={() => setView('profit')} />
          <Card>
            {tExp.map(e => <Row key={e.id} left={e.category === 'other' && e.customName ? e.customName : t(exKey(e.category))} sub={fd(e.date)} right={m(e.amount)} neg />)}
            {!tExp.length ? <Empty /> : null}
          </Card>
        </View>
      );
    }
    return null;
  };
  return (
    <Screen>
      {view ? detail() : (
        <HomeDashboard
          go={go}
          onOpenInvoice={(id) => setInv(id)}
          onOpenRecv={(id) => setRc(id)}
          onOpenReturn={(id) => setRetV(id)}
          onDrillDown={(v) => setView(v)}
        />
      )}
      {inv ? <InvoiceModal kind="sale" id={inv} onClose={() => setInv(null)} /> : null}
      {rc ? <ReceivableModal id={rc} onClose={() => setRc(null)} /> : null}
      {retV ? <ReturnModal id={retV} onClose={() => setRetV(null)} /> : null}
    </Screen>
  );
}

// Reusable POS product card with a fixed content sequence:
// 1. icon + name (reserved 2-line height) → 2. price/kg → 3. stock (KG) → unit + qty → 4. action pinned at bottom.
// Equal-height rows come from the grid (stretch) + Card flex:1 + spacer below.
const NAME_LINES = 2;
const NAME_LINE_HEIGHT = 30;
/**
 * One POS product tile.
 *
 * Memoized on purpose: the product grid must stay visually stable while the cart
 * changes, so a tile only re-renders when its own product / in-cart quantity
 * changes. `onAdd` is a stable callback and `inCartKg` is a plain number, so
 * adding to the cart re-renders exactly one tile instead of the whole grid.
 *
 * `inCartKg` is only cart state (unsaved), so the "available" figure is derived
 * locally - the Products list is never refetched while building a sale.
 */
export const ProductCard = React.memo(function ProductCard({
  p,
  cartLine,
  inCartKg,
  onAdd,
}: {
  p: Product;
  cartLine?: CartLine;
  inCartKg: number;
  /** Returns true when the quantity actually landed in the cart. */
  onAdd: (p: Product, unit: BagUnit, enteredQty: number) => boolean;
}) {
  const { t } = useApp(); const m = useMoney(); const n = useNum();
  const { kg, label } = useUnitLabel();
  const nameFs = useFs(20, 16);
  const priceFs = useFs(18, 15);
  const totalFs = useFs(16, 14);
  // Draft state (this tile only): the quantity being prepared with -/+.
  // It is deliberately NOT the cart quantity - the cart lives in QuickSale - and
  // it is cleared after a successful add so the next add starts from 0.
  const [unit, setUnit] = useState<BagUnit>('kg');
  const [qv, setQv] = useState('0');
  const per = kgPerUnit(p, unit);
  const entered = parseNum(qv);
  const wKg = entered * per;
  const shown = unit === 'kg' ? n(entered) : n(Math.floor(entered));
  const bump = (d: number) => {
    const next = unit === 'kg' ? entered + d : Math.floor(entered) + d;
    setQv(String(next <= 0 ? 0 : unit === 'kg' ? Math.round(next * 100) / 100 : next));
  };
  // Add hands the draft quantity to the cart, then clears only the draft. The
  // chosen UOM is kept so repeat adds of the same product/UOM merge into one
  // cart line. Stock, cart and product data are untouched here.
  const addToCart = () => {
    if (onAdd(p, unit, entered)) setQv('0');
  };
  return (
    <Card style={{ flex: 1 }}>
      <View style={{ minHeight: NAME_LINES * NAME_LINE_HEIGHT, marginBottom: 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={{ marginTop: 4 }}>
            <AppIcon name={icons.products} size={22} iconColor={color.muted} />
          </View>
          <Text numberOfLines={NAME_LINES} style={{ flex: 1, flexWrap: 'wrap', fontSize: nameFs, fontWeight: '700', color: color.text, lineHeight: NAME_LINE_HEIGHT }}>
            {p.name}
          </Text>
        </View>
      </View>
      <Text style={{ fontSize: priceFs, fontWeight: '700', color: color.primary }}>{m(p.price)} / {kg}</Text>
      <Muted>{t('currentStock')}: {n(p.qty)} {kg}</Muted>
      {cartLine ? <Muted>{t('inCart')}: {label(cartLine.unit)} × {n(cartLine.enteredQty)} ({n(cartLine.qtyKg)} {kg})</Muted> : null}
      {inCartKg > 0 ? <Muted>{t('available')}: {n(Math.max(0, p.qty - inCartKg))} {kg}</Muted> : null}
      <Muted>{t('saleType')}</Muted>
      <UnitChips value={unit} onPick={u => { setUnit(u); setQv(''); }} />
      {unit !== 'kg' ? <Muted>{n(per)} {kg} / {label(unit)}</Muted> : null}
      {entered > 0 ? <Text style={{ fontSize: totalFs, fontWeight: '700', color: color.primary }}>{t('totalWeight')}: {n(wKg)} {kg} = {m(wKg * p.price)}</Text> : null}
      <View style={{ flex: 1, minHeight: 8 }} />
      <Muted>{t('qty')}</Muted>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6, marginBottom: 8 }}>
        <TouchableOpacity onPress={() => bump(-1)} style={{ minHeight: 52, minWidth: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#fff', borderWidth: 1.5, borderColor: color.primary }}>
          <AppIcon name={icons.minus} size={24} iconColor={color.primary} />
        </TouchableOpacity>
        <Text style={{ fontSize: 20, fontWeight: '700', flex: 1, textAlign: 'center' }}>{shown}</Text>
        <TouchableOpacity onPress={() => bump(1)} style={{ minHeight: 52, minWidth: 52, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: color.primary }}>
          <AppIcon name={icons.plus} size={24} iconColor="#fff" />
        </TouchableOpacity>
      </View>
      <Btn kind="ghost" icon={icons.add} label={t('tapAdd')} onPress={addToCart} />
    </Card>
  );
});

// Product grid itself is the simple POS: tap to add, +/- quantity, multi-product cart.
export function QuickSale({ done }: { done?: () => void }) {
  const { t, products, customers, bal, sale } = useApp(); const m = useMoney(); const n = useNum();
  const { kg, label } = useUnitLabel();
  const { isMobile } = useBreakpoint();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [party, setParty] = useState<string>();
  const [paid, setPaid] = useState(''); const [next, setNext] = useState(''); const [query, setQuery] = useState('');
  const [accountId, setAccountId] = useState<string>();
  const [success, setSuccess] = useState<{ invoiceNo: string; total: number; id: string } | null>(null);
  // Cart-only state. `cartRef` mirrors it synchronously so `addItem` can stay a
  // stable callback (stable props => memoized tiles don't re-render).
  const cartRef = useRef<CartLine[]>(cart);
  const total = cart.reduce((s, l) => s + lineTotal(l), 0);
  const due = total - num(paid);
  const paidAmt = num(paid);
  const q = query.trim();
  const visible = products.filter(p => matchProduct(p, q));

  const addItem = useCallback((p: Product, unit: BagUnit, enteredQty: number) => {
    if (!(enteredQty > 0)) { Alert.alert(t('invalid')); return false; }
    // Cart identity is product + sale type: same product + same type merges by
    // adding quantities, same product + different type stays a separate line.
    const qs = cartRef.current;
    const i = qs.findIndex(l => l.productId === p.id && l.unit === unit);
    const sum = (i === -1 ? 0 : qs[i].enteredQty) + enteredQty;
    const qtyKg = toKg(p, unit, sum);
    const othersKg = qs.reduce((s, l, j) => (l.productId === p.id && j !== i ? s + l.qtyKg : s), 0);
    if (othersKg + qtyKg > p.qty) { Alert.alert(t('outOfStock'), `${p.name}: ${n(p.qty)} ${kg}`); return false; }
    // Keep the rate captured when the line was first added; only a brand new
    // line takes today's price.
    const line: CartLine = { productId: p.id, unit, enteredQty: sum, qtyKg, rate: i === -1 ? p.price : qs[i].rate };
    const next = i === -1 ? [...qs, line] : qs.map((l, j) => (j === i ? line : l));
    cartRef.current = next;
    setCart(next);
    return true;
  }, [t, n, kg]);

  // Total KG already in the (unsaved) cart per product. Local cart state only -
  // no Products refetch, so the grid never reloads while a sale is being built.
  const inCartByProduct = useMemo(() => {
    const m: Record<string, number> = {};
    for (const l of cart) m[l.productId] = (m[l.productId] ?? 0) + l.qtyKg;
    return m;
  }, [cart]);

  const confirm = () => {
    if (!cart.length || total <= 0 || due < 0) return Alert.alert(t('invalid'));
    if (due > 0 && !party) return Alert.alert(t('needCustomer'));
    // Money only moves for the amount actually received, so the method is
    // only asked for then.
    if (paidAmt > 0 && !accountId) return Alert.alert(t('needAccount'));
    // Validate combined KG across all lines of the same product.
    const need: Record<string, number> = {};
    for (const l of cart) need[l.productId] = (need[l.productId] ?? 0) + l.qtyKg;
    for (const pid of Object.keys(need)) {
      const p = products.find(x => x.id === pid)!;
      if (need[pid] > p.qty) return Alert.alert(t('outOfStock'), p.name);
    }
    (async () => {
      try {
        const r = await sale({ customerId: party, lines: cart.map(l => ({ productId: l.productId, unit: l.unit, enteredQty: l.enteredQty, rate: l.rate })), discount: 0, paid: paidAmt, accountId, next: next || undefined });
        cartRef.current = [];
        setCart([]); setPaid(''); setParty(undefined); setNext(''); setAccountId(undefined);
        setSheetOpen(false);
        setSuccess({ invoiceNo: r.invoiceNo ?? '', total: r.total, id: r.id });
      } catch (e) {
        Alert.alert(e instanceof Error ? e.message : t('invalid'));
      }
    })();
  };

  const searchBar = (
    <SearchDropdown
      items={products}
      query={query}
      setQuery={setQuery}
      placeholder={t('searchProducts')}
      match={matchProduct}
      subOf={p => `${m(p.price)} / ${kg} • ${t('currentStock')}: ${n(p.qty)} ${kg}`}
      emptyText={t('noProduct')}
      onSelect={p => setQuery(p.name)}
    />
  );
  const productGrid = (
    <View>
      <RGrid mobile={2} tablet={3} desktop={3}>
        {visible.map(p => (
          <ProductCard
            key={p.id}
            p={p}
            cartLine={cart.find(l => l.productId === p.id)}
            inCartKg={inCartByProduct[p.id] ?? 0}
            onAdd={addItem}
          />
        ))}
      </RGrid>
      {!visible.length ? <Card><NoResult /></Card> : null}
    </View>
  );
  const cartItems = cart.length ? cart.map(l => {
    const p = products.find(x => x.id === l.productId)!;
    const per = kgPerUnit(p, l.unit);
    const sub = l.unit === 'kg'
      ? `${n(l.enteredQty)} ${kg} × ${m(l.rate)}`
      : `${label(l.unit)} × ${n(l.enteredQty)} • ${n(per)} ${kg} / ${label(l.unit)} • ${t('totalWeight')} ${n(l.qtyKg)} ${kg}`;
    return (
      <View key={`${l.productId}:${l.unit}`}>
        <Row left={p.name} sub={sub} right={m(lineTotal(l))} />
        <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
          <TouchableOpacity onPress={() => setCart(qs => qs.filter(x => !(x.productId === l.productId && x.unit === l.unit)))} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name={icons.del} size={20} iconColor={color.red} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }) : <Empty />;
  const checkout = (
    <View>
      <Row left={t('total')} right={m(total)} />
      <Field label={t('paid')} value={paid} onChange={setPaid} num />
      {paidAmt > 0 ? <AccountPicker accountId={accountId} onPick={setAccountId} label={t('paymentAccount')} required /> : null}
      <Row left={t('due')} right={m(due)} neg={due > 0} />
      <Muted>{t('customer')} — {t('customerNote')}</Muted>
      <SearchableSelect
        items={customers}
        value={party}
        onPick={id => setParty(id)}
        placeholder={t('searchCustomers')}
        match={matchParty}
        subOf={c => c.mobile}
        rightOf={c => ({ text: m(bal('c', c.id).balance), sub: t('receivable'), neg: bal('c', c.id).balance > 0 })}
        emptyText={t('noCustomer')}
      />
      <DateField label={t('payDate')} value={next} onChange={setNext} clearable allowPast={false} />
      <Btn icon={icons.sale} label={t('confirmSale')} onPress={confirm} />
    </View>
  );
  // Mobile: products scroll normally; a sticky cart bar opens the cart sheet.
  // Desktop/tablet keep the existing side-by-side arrangement.
  if (isMobile) {
    return (
      <View style={{ flex: 1 }}>
        <View style={{ flex: 1 }}>
          {searchBar}
          {productGrid}
          <View style={{ height: 76 }} />
        </View>
        <View style={{ position: 'sticky', bottom: 0, zIndex: 5 } as any}>
          <TouchableOpacity
            disabled={!cart.length}
            onPress={() => setSheetOpen(true)}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: cart.length ? color.primary : color.muted, borderRadius: 14, minHeight: 56, paddingHorizontal: 16, marginTop: 8 }}
          >
            <AppIcon name={icons.sale} size={24} iconColor="#fff" />
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700', flex: 1 }} numberOfLines={1}>
              {cart.length ? `${n(cart.length)} ${t('itemsUnit')}   ${t('total')} ${m(total)}` : `${t('cart')}   ${m(0)}`}
            </Text>
            {cart.length ? <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{t('view')}</Text> : null}
          </TouchableOpacity>
        </View>
        <Modal visible={sheetOpen} transparent animationType="slide" onRequestClose={() => setSheetOpen(false)}>
          <TouchableOpacity activeOpacity={1} onPress={() => setSheetOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end' }}>
            <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ backgroundColor: color.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '85%', overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 14, paddingRight: 4, paddingVertical: 4 }}>
                <Text style={{ fontSize: 20, fontWeight: '700', color: color.text }}>{t('cart')}</Text>
                <TouchableOpacity onPress={() => setSheetOpen(false)} style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name={icons.cancel} size={22} iconColor={color.muted} />
                </TouchableOpacity>
              </View>
              <ScrollView style={{ paddingHorizontal: 14 }} contentContainerStyle={{ paddingBottom: 8 }} keyboardShouldPersistTaps="handled">
                {cartItems}
              </ScrollView>
              <View style={{ paddingHorizontal: 14, paddingBottom: 20 }}>
                {checkout}
              </View>
            </TouchableOpacity>
          </TouchableOpacity>
        </Modal>
        {success ? (
          <SuccessModal kind="sale" invoiceNo={success.invoiceNo} total={success.total} txnId={success.id} onClose={() => { setSuccess(null); done?.(); }} />
        ) : null}
      </View>
    );
  }
  const grid = (
    <View style={{ flex: 1 }}>
      {searchBar}
      {productGrid}
    </View>
  );
  const cartCard = (
    <Card>
      <SectionHead icon={icons.sale}>{t('cart')}</SectionHead>
      {cartItems}
      {checkout}
    </Card>
  );
  // Desktop ~72/28 split: more room for products, compact cart panel.
  return (
    <View style={{ flex: 1 }}>
      <TwoPanel left={grid} right={cartCard} leftFlex={5} rightFlex={2} />
      {success ? (
        <SuccessModal kind="sale" invoiceNo={success.invoiceNo} total={success.total} txnId={success.id} onClose={() => { setSuccess(null); done?.(); }} />
      ) : null}
    </View>
  );
}

/**
 * ক্রয় / বিক্রয় module. Both already had a creation form; what was missing was
 * any way to see the records they produce, so the module is now list-first:
 * the completed document list, with the existing New form one tap away.
 */
export function Trade({ mode }: { mode: 'sale' | 'purchase' }) {
  const [view, setView] = useState<'list' | 'new'>('new');
  const [focusId, setFocusId] = useState<string | null>(null);
  if (view === 'new') {
    return <TradeDashboardForm mode={mode} onDone={() => setView('list')} />;
  }
  return <TxnHistory kind={mode} onNew={() => setView('new')} focus={focusId} onFocusDone={() => setFocusId(null)} />;
}

/**
 * Completed Purchase / Sale records for this module.
 *
 * Both read the records the app already keeps in the store (populated by
 * /bootstrap and refreshed by every create), so a finished transaction shows up
 * here without any extra fetch and without a reload. Desktop gets the shared
 * Odoo-style table; mobile keeps the card pattern.
 */
type TxnRow = { id: string; no: string; date: string; partyId?: string; partyName: string; total: number; paid: number; due: number; status: SettlementStatus };
// Canonical status label: paid (due 0) / partial (some paid, due remains) / due.
const statusLabel = (t: (k: Key) => string, r: { due: number; status?: SettlementStatus }) => {
  const st: SettlementStatus = r.status ?? (r.due > 0 ? 'due' : 'paid');
  return st === 'paid' ? t('statusPaid') : st === 'partial' ? t('statusPartial') : t('statusDue');
};
function TxnHistory({ kind, onNew, focus, onFocusDone }: {
  kind: 'sale' | 'purchase'; onNew: () => void; focus?: string | null; onFocusDone?: () => void;
}) {
  const { t, sales, purchases, customers, vendors } = useApp();
  const m = useMoney(); const fd = useDateStr();
  const { isDesktop } = useBreakpoint();
  const isSale = kind === 'sale';
  // List state kept here so it survives opening a document.
  const [q, setQ] = useState('');
  const [period, setPeriod] = useState<'today' | 'all'>('all');
  const [status, setStatus] = useState<'all' | 'paid' | 'due'>('all');
  const [sort, setSort] = useState<TableSort | null>(null);
  const [inv, setInv] = useState<string | null>(focus ?? null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const [restoreTo, setRestoreTo] = useState<number | null>(null);
  const onScrollY = useCallback((y: number) => { scrollY.current = y; }, []);
  useEffect(() => { if (focus) setInv(focus); onFocusDone?.(); }, [focus]);
  // Opening the document is a modal, so the list underneath keeps its search,
  // filter, sort and scroll exactly as they were.
  const closeInv = useCallback(() => {
    setInv(null);
    setRestoreTo(scrollY.current);
  }, []);
  useEffect(() => {
    if (inv || restoreTo === null) return;
    const y = restoreTo;
    setRestoreTo(null);
    const id = setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 0);
    return () => clearTimeout(id);
  }, [inv, restoreTo]);

  const nameOf = (id?: string) => (isSale
    ? (customers.find(c => c.id === id)?.name ?? t('cashSale'))
    : (vendors.find(v => v.id === id)?.name ?? '-'));
  const rowsAll: TxnRow[] = useMemo(() => (isSale
    ? sales.map(s => ({ id: s.id, no: s.invoiceNo ?? s.id, date: s.date, partyId: s.customerId, partyName: nameOf(s.customerId), total: s.total, paid: s.paid, due: s.due, status: s.status }))
    : purchases.map(p => ({ id: p.id, no: p.invoiceNo ?? p.id, date: p.date, partyId: p.vendorId, partyName: nameOf(p.vendorId), total: p.total, paid: p.paid, due: p.due, status: p.status }))),
  // Newest first by default: a transaction just completed is the first row.
  [sales, purchases, customers, vendors, isSale, t]);

  const today = new Date().toISOString().slice(0, 10);
  const needle = q.trim().toLowerCase();
  const base = useMemo(() => rowsAll.filter(r => {
    if (period === 'today' && r.date !== today) return false;
    if (status === 'paid' && r.status !== 'paid') return false;
    if (status === 'due' && r.status === 'paid') return false;
    return true;
  }), [rowsAll, period, status]);
  const shown = base.filter(r => !needle || r.no.toLowerCase().includes(needle) || r.partyName.toLowerCase().includes(needle));
  const rows = useMemo(() => [...shown].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)), [shown]);

  const money = (v: number) => <Text style={{ fontSize: 14, fontWeight: '600', color: color.text }}>{m(v)}</Text>;
  const statusCell = (r: TxnRow) => (
    <Text style={{ fontSize: 14, fontWeight: '600', color: r.status === 'paid' ? color.primary : color.red }}>
      {statusLabel(t, r)}
    </Text>
  );
  const columns: TableColumn<TxnRow>[] = useMemo(() => [
    { key: 'no', label: isSale ? t('saleNo') : t('purchaseNo'), flex: 1.7, sort: r => r.no,
      render: (r, fs) => <Text numberOfLines={1} style={{ fontSize: fs, fontWeight: '600', color: color.text }}>{r.no}</Text> },
    { key: 'date', label: t('date'), flex: 1.1, sort: r => r.date, render: r => <Text style={{ fontSize: 14, color: color.text }}>{fd(r.date)}</Text> },
    { key: 'party', label: isSale ? t('customer') : t('vendor'), flex: 1.8, sort: r => r.partyName,
      render: r => <Text numberOfLines={1} style={{ fontSize: 14, color: color.text }}>{r.partyName}</Text> },
    { key: 'total', label: t('total'), flex: 1.2, align: 'right', sort: r => r.total, render: r => money(r.total) },
    { key: 'paid', label: t('paid'), flex: 1.2, align: 'right', sort: r => r.paid, render: r => money(r.paid) },
    { key: 'due', label: t('due'), flex: 1.2, align: 'right', sort: r => r.due, render: r => money(r.due) },
    { key: 'status', label: t('status'), flex: 1, sort: r => (r.status === 'paid' ? 0 : r.status === 'partial' ? 1 : 2), render: r => statusCell(r) },
  ], [isSale, t, m, fd]);

  // Display-only filter chips.
  const chip = (label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={label} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: color.line, backgroundColor: on ? color.primary : color.card }}>
      <Text style={{ color: on ? '#fff' : color.text, fontSize: 14, fontWeight: on ? '700' : '400' }}>{label}</Text>
    </TouchableOpacity>
  );
  const sums = rows.reduce((s, r) => ({ total: s.total + r.total, paid: s.paid + r.paid, due: s.due + r.due }), { total: 0, paid: 0, due: 0 });

  return (
    <Screen scrollRef={scrollRef} onScrollY={onScrollY}>
      <ListPageHeader title={isSale ? t('saleHistory') : t('purchaseHistory')} addLabel={isSale ? t('newSale') : t('newPurchase')} onAdd={onNew} />
      <SearchDropdown
        items={base as (TxnRow & { name: string })[]}
        query={q}
        setQuery={setQ}
        placeholder={isSale ? t('searchSales') : t('searchPurchases')}
        match={(r, _n) => {
          const n = q.trim().toLowerCase();
          return !n || r.no.toLowerCase().includes(n) || r.partyName.toLowerCase().includes(n);
        }}
        titleOf={r => r.no}
        subOf={r => `${fd(r.date)} • ${r.partyName}`}
        rightOf={r => ({ text: m(r.total), sub: statusLabel(t, r), neg: r.status !== 'paid' })}
        emptyText={isSale ? t('noSale') : t('noPurchase')}
        onSelect={r => setInv(r.id)}
      />
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
        {chip(t('today'), period === 'today', () => setPeriod(period === 'today' ? 'all' : 'today'))}
        {chip(t('all'), period === 'all', () => setPeriod('all'))}
        {chip(t('statusPaid'), status === 'paid', () => setStatus(status === 'paid' ? 'all' : 'paid'))}
        {chip(t('statusDue'), status === 'due', () => setStatus(status === 'due' ? 'all' : 'due'))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
        <View style={{ flex: 1, minWidth: 200, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8E4', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name={icons.calc} size={22} iconColor="#1B7F4B" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500' }}>{t('total')}</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#0F172A' }}>{m(sums.total)}</Text>
          </View>
        </View>

        <View style={{ flex: 1, minWidth: 200, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8E4', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name={icons.collect} size={22} iconColor="#2563EB" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500' }}>{t('paid')}</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#1B7F4B' }}>{m(sums.paid)}</Text>
          </View>
        </View>

        <View style={{ flex: 1, minWidth: 200, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8E4', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name={icons.pay} size={22} iconColor="#DC2626" />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500' }}>{t('due')}</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: sums.due > 0 ? '#DC2626' : '#1B7F4B' }}>{m(sums.due)}</Text>
          </View>
        </View>
      </View>
      {isDesktop ? (
        <ListTable<TxnRow>
          columns={columns}
          rows={rows}
          rowKey={r => r.id}
          sort={sort}
          onSortChange={setSort}
          onRowPress={r => setInv(r.id)}
          empty={<View style={{ padding: 8 }}>{needle ? <NoResult /> : <Empty />}</View>}
        />
      ) : (
        rows.length ? rows.map(r => (
          <Card key={r.id}>
            <Row left={r.no} sub={`${fd(r.date)} • ${r.partyName}`} right={m(r.total)} />
            <Row left={t('paid')} right={m(r.paid)} />
            <Row left={t('due')} right={m(r.due)} neg={r.due > 0} />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Btn kind="ghost" icon={icons.history} label={t('view')} onPress={() => setInv(r.id)} /></View>
            </View>
          </Card>
        )) : <Card>{needle ? <NoResult /> : <Empty />}</Card>
      )}
      {inv ? <InvoiceModal kind={isSale ? 'sale' : 'purchase'} id={inv} onClose={closeInv} onBack={closeInv} /> : null}
    </Screen>
  );
}

/** New Purchase form (existing behaviour, unchanged). */
function NewPurchase({ onDone }: { onDone: () => void }) {
  const { t, products, vendors, bal, purchase } = useApp(); const m = useMoney(); const n = useNum();
  const { kg, label } = useUnitLabel();
  const [party, setParty] = useState<string>(); const [pid, setPid] = useState<string>();
  const [unit, setUnit] = useState<BagUnit>('kg'); const [qv, setQv] = useState(''); const [rate, setRate] = useState('');
  const [cart, setCart] = useState<CartLine[]>([]); const [paid, setPaid] = useState(''); const [next, setNext] = useState('');
  const [accountId, setAccountId] = useState<string>();
  const [success, setSuccess] = useState<{ invoiceNo: string; total: number; id: string } | null>(null);
  const sel = products.find(x => x.id === pid);
  const paidAmt = num(paid);
  const total = cart.reduce((s, l) => s + lineTotal(l), 0), due = total - paidAmt;
  const pick = (id: string) => { setPid(id); const p = products.find(x => x.id === id)!; setRate(String(p.cost)); setUnit('kg'); setQv(''); };
  const entered = parseNum(qv);
  const addItem = () => {
    if (!sel || !(entered > 0) || !(num(rate) > 0)) return Alert.alert(t('invalid'));
    const qtyKg = toKg(sel, unit, entered);
    const line: CartLine = { productId: sel.id, unit, enteredQty: entered, qtyKg, rate: num(rate) };
    setCart(cs => cs.some(l => l.productId === sel.id) ? cs.map(l => (l.productId === sel.id ? line : l)) : [...cs, line]);
    setQv(''); setPid(undefined); setUnit('kg');
  };
  const confirm = () => {
    if (!cart.length || due < 0 || !party) return Alert.alert(t('invalid'));
    if (paidAmt > 0 && !accountId) return Alert.alert(t('needAccount'));
    (async () => {
      try {
        const r = await purchase({ vendorId: party!, lines: cart.map(l => ({ productId: l.productId, unit: l.unit, enteredQty: l.enteredQty, rate: l.rate })), paid: paidAmt, accountId, next: next || undefined });
        setCart([]); setPaid(''); setParty(undefined); setNext(''); setAccountId(undefined);
        setSuccess({ invoiceNo: r.invoiceNo ?? '', total: r.total, id: r.id });
      } catch (e) {
        Alert.alert(e instanceof Error ? e.message : t('invalid'));
      }
    })();
  };
  return (
    <Screen>
      <TwoPanel
        left={
          <Card>
            <Muted>{t('vendor')}</Muted>
            <SearchableSelect
              items={vendors}
              value={party}
              onPick={id => setParty(id)}
              placeholder={t('searchVendors')}
              match={matchParty}
              subOf={v => v.mobile}
              rightOf={v => ({ text: m(bal('v', v.id).balance), sub: t('payable'), neg: bal('v', v.id).balance > 0 })}
              emptyText={t('noVendor')}
            />
            <Muted>{t('product')}</Muted>
            <SearchableSelect
              items={products}
              value={pid}
              onPick={id => { if (id) pick(id); else { setPid(undefined); setRate(''); setUnit('kg'); setQv(''); } }}
              placeholder={t('searchProducts')}
              match={matchProduct}
              subOf={p => `${m(p.price)} / ${kg} • ${t('currentStock')}: ${n(p.qty)} ${kg}`}
              emptyText={t('noProduct')}
            />
            {sel ? <Muted>{t('currentStock')}: {n(sel.qty)} {kg}</Muted> : null}
            <Muted>{t('purchaseType')}</Muted>
            <UnitChips value={unit} onPick={u => { setUnit(u); setQv(''); }} />
            {sel && unit !== 'kg' ? <Muted>{n(kgPerUnit(sel, unit))} {kg} / {label(unit)}</Muted> : null}
            <QtyInput unit={unit} value={qv} onChange={setQv} />
            {sel && entered > 0 ? <Muted>{t('totalWeight')}: {n(toKg(sel, unit, entered))} {kg}</Muted> : null}
            <Field label={t('costPerKg')} value={rate} onChange={setRate} num />
            <Btn kind="ghost" icon={icons.add} label={t('add')} onPress={addItem} />
          </Card>
        }
        right={
          <Card>
            {cart.length ? cart.map(l => {
              const p = products.find(x => x.id === l.productId)!;
              const per = kgPerUnit(p, l.unit);
              const sub = l.unit === 'kg'
                ? `${n(l.enteredQty)} ${kg} × ${m(l.rate)}`
                : `${label(l.unit)} × ${n(l.enteredQty)} • ${n(per)} ${kg} / ${label(l.unit)} • ${t('totalWeight')} ${n(l.qtyKg)} ${kg}`;
              return (
                <View key={l.productId}>
                  <Row left={p.name} sub={sub} right={m(lineTotal(l))} />
                  <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
                    <TouchableOpacity onPress={() => setCart(cs => cs.filter(x => x.productId !== l.productId))} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
                      <AppIcon name={icons.del} size={20} iconColor={color.red} />
                    </TouchableOpacity>
                  </View>
                </View>
              );
            }) : <Empty />}
            <Row left={t('total')} right={m(total)} />
            <Field label={t('paid')} value={paid} onChange={setPaid} num />
            {paidAmt > 0 ? <AccountPicker accountId={accountId} onPick={setAccountId} label={t('paymentAccount')} required /> : null}
            <Row left={t('due')} right={m(due)} neg={due > 0} />
<DateField label={t('payDate')} value={next} onChange={setNext} clearable allowPast={false} />
            <Btn icon={icons.purchase} label={t('confirmPurchase')} onPress={confirm} />
          </Card>
        }
      />
      {success ? (
        <SuccessModal kind="purchase" invoiceNo={success.invoiceNo} total={success.total} txnId={success.id} onClose={() => { setSuccess(null); onDone(); }} />
      ) : null}
    </Screen>
  );
}

export function Products() {
  const { t, products, saveProduct, deleteProduct } = useApp(); const m = useMoney(); const n = useNum();
  const { kg } = useUnitLabel();
  const [f, setF] = useState<Product | null>(null);
  const [v, setV] = useState({ name: '', cost: '', price: '', opening: '', sb: '25', mb: '40', lb: '50' });
  const [pq, setPq] = useState('');
  const listed = products.filter(p => matchProduct(p, pq));
  const open = (p?: Product) => {
    setF(p ?? { id: '', name: '', cost: 0, price: 0, opening: 0, qty: 0, uom: 'kg', smallBagKg: 25, mediumBagKg: 40, largeBagKg: 50 });
    setV(p
      ? { name: p.name, cost: String(p.cost), price: String(p.price), opening: String(p.opening || ''), sb: String(p.smallBagKg > 0 ? p.smallBagKg : 25), mb: String(p.mediumBagKg > 0 ? p.mediumBagKg : 40), lb: String(p.largeBagKg > 0 ? p.largeBagKg : 50) }
      : { name: '', cost: '', price: '', opening: '', sb: '25', mb: '40', lb: '50' });
  };
  const save = () => {
    if (!v.name.trim()) return Alert.alert(t('invalid'));
    if (!(num(v.sb) > 0) || !(num(v.mb) > 0) || !(num(v.lb) > 0)) return Alert.alert(t('invalidBag'));
    // Sale Price: numeric and > 0, at the app's 2-decimal money precision.
    // Blank/garbage used to be saved as 0, which silently sold the product free.
    const price = parseNum(v.price);
    if (!Number.isFinite(price) || !(price > 0)) return Alert.alert(t('invalidSalePrice'));
    const o = num(v.opening), id = f!.id || 'p' + Date.now();
    (async () => {
      try {
        await saveProduct({ id, name: v.name, cost: num(v.cost), price: Math.round(price * 100) / 100, opening: o, qty: f!.id ? f!.qty + (o - f!.opening) : o, uom: f!.uom || 'kg', smallBagKg: num(v.sb), mediumBagKg: num(v.mb), largeBagKg: num(v.lb) });
        setF(null);
      } catch (e) {
        Alert.alert(e instanceof Error ? e.message : t('invalid'));
      }
    })();
  };
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const [delError, setDelError] = useState<string | null>(null);
  const remove = (id: string) => setConfirmDel(id);
  const doDelete = async () => {
    if (!confirmDel) return;
    const id = confirmDel;
    setConfirmDel(null);
    try {
      await deleteProduct(id);
    } catch (e) {
      setDelError(e instanceof Error ? e.message : t('invalid'));
    }
  };
  if (f) return <Screen><Card>
    <FormGrid>
      <Field label={t('productName')} value={v.name} onChange={x => setV({ ...v, name: x })} /><Field label={t('costPerKg')} value={v.cost} onChange={x => setV({ ...v, cost: x })} num />
      <Field label={t('pricePerKg')} value={v.price} onChange={x => setV({ ...v, price: x })} num /><Field label={`${t('openingStock')} (${kg})`} value={v.opening} onChange={x => setV({ ...v, opening: x })} num />
    </FormGrid>
    <Muted>{t('bagWeight')}</Muted>
    <FormGrid>
      <Field label={`${t('smallBag')} (${kg})`} value={v.sb} onChange={x => setV({ ...v, sb: x })} num />
      <Field label={`${t('mediumBag')} (${kg})`} value={v.mb} onChange={x => setV({ ...v, mb: x })} num />
      <Field label={`${t('largeBag')} (${kg})`} value={v.lb} onChange={x => setV({ ...v, lb: x })} num />
    </FormGrid>
    <Btn icon={icons.save} label={t('save')} onPress={save} /><Btn kind="ghost" icon={icons.cancel} label={t('cancel')} onPress={() => setF(null)} /></Card></Screen>;
  return <Screen>
    <ListPageHeader title={t('products')} addLabel={t('add')} onAdd={() => open()} />
    <SearchDropdown
      items={products}
      query={pq}
      setQuery={setPq}
      placeholder={t('searchProducts')}
      match={matchProduct}
      subOf={p => `${m(p.price)} / ${kg} • ${t('currentStock')}: ${n(p.qty)} ${kg}`}
      emptyText={t('noProduct')}
      onSelect={p => setPq(p.name)}
    />
    <RGrid mobile={1} tablet={2} desktop={3}>
      {listed.length ? listed.map(p => <Card key={p.id}><Title>{p.name}</Title>
        <Row icon={icons.stock} left={t('currentStock')} right={`${n(p.qty)} ${kg}`} neg={p.qty <= 0} /><Row left={t('cost')} right={m(p.cost)} /><Row left={t('price')} right={m(p.price)} />
        {(p.damagedQty ?? 0) > 0 ? <Row left={t('damagedStock')} right={`${n(p.damagedQty ?? 0)} ${kg}`} neg /> : null}
        <Muted>{t('bagWeight')}: {n(p.smallBagKg)} / {n(p.mediumBagKg)} / {n(p.largeBagKg)} {kg}</Muted>
        <View style={{ flexDirection: 'row', gap: 8 }}><View style={{ flex: 1 }}><Btn kind="ghost" icon={icons.edit} label={t('edit')} onPress={() => open(p)} /></View>
          <View style={{ flex: 1 }}><Btn kind="danger" icon={icons.del} label={t('del')} onPress={() => remove(p.id)} /></View></View></Card>) : <Card>{pq.trim() ? <NoResult /> : <Empty />}</Card>}
    </RGrid>
    {confirmDel ? (
      <DetailShell title={t('del')} onClose={() => setConfirmDel(null)}>
        <Card>
          <Text style={{ fontSize: 16, color: color.text, marginBottom: 12 }}>{t('trashAskP')}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <View style={{ flex: 1 }}><Btn kind="ghost" label={t('cancel')} onPress={() => setConfirmDel(null)} /></View>
            <View style={{ flex: 1 }}><Btn kind="danger" icon={icons.del} label={t('trashMoveBtn')} onPress={doDelete} /></View>
          </View>
        </Card>
      </DetailShell>
    ) : null}
    {delError ? (
      <DetailShell title={t('del')} onClose={() => setDelError(null)}>
        <Card>
          <Text style={{ fontSize: 16, color: color.text, marginBottom: 12 }}>{delError}</Text>
          <Btn label={t('ok')} onPress={() => setDelError(null)} />
        </Card>
      </DetailShell>
    ) : null}
  </Screen>;
}

// Shared Customers / Vendors screen
export function Parties({ kind, focus, onFocusDone, onReturn }: { kind: 'c' | 'v'; focus?: string | null; onFocusDone?: () => void; onReturn?: (kind: 'sale' | 'purchase', id: string) => void }) {
  const { t, lang, customers, vendors, saveParty, deleteParty, bal, cTx, vTx } = useApp(); const m = useMoney(); const isC = kind === 'c';
  const fd = useDateStr();
  // Desktop gets the Odoo-style table; mobile/tablet keep the existing cards.
  const { isDesktop } = useBreakpoint();
  const txs = isC ? cTx : vTx;
  const list = isC ? customers : vendors; const [sel, setSel] = useState<Party | null>(null); const [f, setF] = useState<Party | null>(null);
  const subOpen = sel !== null || f !== null; // a form/detail is showing instead of the list
  const subOpenRef = useRef(subOpen); subOpenRef.current = subOpen;
  const [inv, setInv] = useState<{ kind: 'sale' | 'purchase'; id: string } | null>(null);
  const [retId, setRetId] = useState<string | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [v, setV] = useState({ name: '', mobile: '', address: '', opening: '' });
  const [pq, setPq] = useState('');
  const balFs = useFs(30, 24);
  const listed = list.filter(p => matchParty(p, pq));
  // Newest transaction date per party, from the same local ledger that backs
  // the detail view. No extra request, no new financial calculation.
  const lastDateOf = useMemo(() => {
    const m2: Record<string, string> = {};
    for (const x of txs) if (!m2[x.partyId] || x.date > m2[x.partyId]) m2[x.partyId] = x.date;
    return m2;
  }, [txs]);
  const searchPh = isC ? t('searchCustomers') : t('searchVendors');
  // ---- List <-> detail navigation -------------------------------------------
  // Search text (pq) and sort live in this component, so they are never lost by
  // opening a row. The scroll offset is captured while the LIST is on screen and
  // restored when Back returns to it, so the user does not jump to the top.
  const [sort, setSort] = useState<TableSort | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const scrollY = useRef(0);
  const [restoreTo, setRestoreTo] = useState<number | null>(null);
  const onScrollY = useCallback((y: number) => { if (!subOpenRef.current) scrollY.current = y; }, []);
  const isWeb = typeof window !== 'undefined' && typeof window.location !== 'undefined';
  // Web: the detail is deliberately NOT a separate hash route, so no route is
  // duplicated. One history entry per drill-down makes the browser Back button
  // close exactly what the visible Back button closes.
  const pushed = useRef(0);
  const pushSub = () => { if (isWeb) { pushed.current += 1; window.history.pushState({ partySub: true }, ''); } };
  // Which sub-view is on top, readable from the stable popstate handler.
  const fOpenRef = useRef(false); const selOpenRef = useRef(false);
  useEffect(() => { fOpenRef.current = f !== null; selOpenRef.current = sel !== null; }, [f, sel]);
  // Close exactly ONE level, so Back from the edit form returns to the detail it
  // was opened from, while Back from a brand new form returns to the list.
  const closeTop = useCallback(() => {
    setRestoreTo(scrollY.current);
    if (fOpenRef.current) { setF(null); return; }
    setSel(null); setConfirmDel(false); setBlocked(null); setRetId(null); setInv(null);
  }, []);
  const back = () => {
    if (isWeb && pushed.current > 0) { pushed.current -= 1; window.history.back(); return; }
    closeTop();
  };
  useEffect(() => {
    if (!isWeb) return;
    const onPop = () => {
      // Only intercept while a form/detail is open; otherwise the hash router
      // handles the navigation as usual.
      if (!subOpenRef.current) return;
      if (pushed.current > 0) pushed.current -= 1;
      closeTop();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [isWeb, closeTop]);
  useEffect(() => {
    if (subOpen || restoreTo === null) return;
    const y = restoreTo;
    setRestoreTo(null);
    const id = setTimeout(() => scrollRef.current?.scrollTo({ y, animated: false }), 0);
    return () => clearTimeout(id);
  }, [subOpen, restoreTo]);
  const backLabel = isC ? t('backToCustomers') : t('backToVendors');
  const BackLink = ({ onPress, label }: { onPress: () => void; label: string }) => (
    <TouchableOpacity onPress={onPress} accessibilityRole="button" accessibilityLabel={label}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', minHeight: 44, paddingRight: 8, marginBottom: 10 }}>
      <AppIcon name={icons.back} size={22} iconColor={color.primary} />
      <Text style={{ fontSize: 16, fontWeight: '600', color: color.primary }}>{label}</Text>
    </TouchableOpacity>
  );
  // Opening a party by focus (global search / drill-down) is the same
  // navigation as clicking a row, so it gets the same history entry.
  useEffect(() => {
    if (!focus) return;
    const p = list.find(x => x.id === focus);
    if (p) { pushSub(); setSel(p); }
    onFocusDone?.();
  }, [focus]);
  const openDetail = (p: Party) => { pushSub(); setSel(p); };
  const open = (p?: Party) => { pushSub(); setF(p ?? { id: '', name: '', mobile: '', opening: 0 }); setV({ name: p?.name ?? '', mobile: p?.mobile ?? '', address: p?.address ?? '', opening: p ? String(p.opening) : '' }); };
  const [confirmDel, setConfirmDel] = useState(false);
  const [blocked, setBlocked] = useState<{ title: Key; body: string } | null>(null);
  const doDelete = async () => {
    if (!sel) return;
    setConfirmDel(false);
    try {
      await deleteParty(kind, sel.id);
      back();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'CUSTOMER_HAS_BALANCE' || e.code === 'VENDOR_HAS_BALANCE')) {
        setBlocked({
          title: isC ? 'delCustTitle' : 'delVendTitle',
          body: tp(lang, isC ? 'cantDeleteCustomerDue' : 'cantDeleteVendorDue', { amount: m(e.amount ?? 0) }),
        });
      } else if (e instanceof ApiError && e.code?.endsWith('HAS_TRANSACTIONS')) {
        setBlocked({ title: isC ? 'delCustTitle' : 'delVendTitle', body: t(isC ? 'delCustBody' : 'delVendBody') });
      } else {
        Alert.alert(e instanceof Error ? e.message : t('invalid'));
      }
    }
  };
  // Same column architecture for both screens; only labels and the meaning of
  // the last money column differ (Due/Receivable vs Payable).
  const money = (v: number) => <Text style={{ fontSize: 14, fontWeight: '600', color: color.text }}>{m(v)}</Text>;
  const partyColumns: TableColumn<Party>[] = useMemo(() => [
    {
      key: 'name', label: isC ? t('customers') : t('vendors'), flex: 2.2, sort: p => p.name,
      render: (p, fs) => (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <AppIcon name={isC ? icons.customers : icons.vendors} size={18} iconColor={color.muted} />
          <Text numberOfLines={1} style={{ fontSize: fs, fontWeight: '600', color: color.text, flex: 1 }}>{p.name}</Text>
        </View>
      ),
    },
    { key: 'mobile', label: t('mobile'), flex: 1.4, sort: p => p.mobile, render: (p, fs) => <Text style={{ fontSize: fs, color: color.text }}>{p.mobile || '-'}</Text> },
    { key: 'total', label: isC ? t('totalSales') : t('totalPurchase'), flex: 1.2, align: 'right', sort: p => bal(kind, p.id).total, render: p => money(bal(kind, p.id).total) },
    { key: 'paid', label: t('totalPaid'), flex: 1.2, align: 'right', sort: p => bal(kind, p.id).paid, render: p => money(bal(kind, p.id).paid) },
    {
      key: 'balance', label: isC ? t('currentDue') : t('currentPayable'), flex: 1.2, align: 'right',
      sort: p => bal(kind, p.id).balance,
      render: (p, fs) => {
        const b2 = bal(kind, p.id).balance;
        return <Text style={{ fontSize: fs, fontWeight: '700', color: b2 > 0 ? color.red : color.primary }}>{m(b2)}</Text>;
      },
    },
    { key: 'last', label: t('lastTransaction'), flex: 1.2, align: 'right', sort: p => lastDateOf[p.id] ?? '', render: p => <Text style={{ fontSize: 14, color: color.muted }}>{fd(lastDateOf[p.id])}</Text> },
  ], [isC, kind, t, m, fd, bal, lastDateOf]);

  if (f) return <Screen scrollRef={scrollRef} onScrollY={onScrollY}><BackLink label={sel ? t('back') : backLabel} onPress={back} />
    <Card>
    <FormGrid>
      <Field label={t('name')} value={v.name} onChange={x => setV({ ...v, name: x })} /><Field label={t('mobile')} value={v.mobile} onChange={x => setV({ ...v, mobile: x })} num />
      <Field label={t('address')} value={v.address} onChange={x => setV({ ...v, address: x })} /><Field label={isC ? t('opening') : t('currentPayable')} value={v.opening} onChange={x => setV({ ...v, opening: x })} num />
    </FormGrid>
    <Btn icon={icons.save} label={t('save')} onPress={() => {
      if (!v.name.trim()) return Alert.alert(t('invalid'));
      (async () => {
        try {
          await saveParty(kind, { ...f, id: f.id || kind + Date.now(), name: v.name, mobile: v.mobile, address: v.address, opening: num(v.opening) });
          setF(null); setSel(null);
        } catch (e) {
          Alert.alert(e instanceof Error ? e.message : t('invalid'));
        }
      })();
    }} />
    <Btn kind="ghost" icon={icons.cancel} label={t('cancel')} onPress={back} /></Card></Screen>;
  if (sel) {
    const b = bal(kind, sel.id), txs = (isC ? cTx : vTx).filter(x => x.partyId === sel.id);
    const lbl = (k: string) => (k === 'payment' ? t('payment') : k === 'sreturn' ? t('saleReturn') : k === 'preturn' ? t('purchaseReturn') : isC ? t('sale') : t('purchase'));
    return <Screen scrollRef={scrollRef} onScrollY={onScrollY}><BackLink label={backLabel} onPress={back} />
      <Card><Title>{sel.name}</Title><Muted>{sel.mobile}</Muted>
      <Text style={{ fontSize: balFs, fontWeight: '700', color: b.balance > 0 ? '#C62828' : '#1B7F4B' }}>{m(b.balance)}</Text><Muted>{isC ? t('currentDue') : t('currentPayable')}</Muted>
      <Row left={isC ? t('totalSales') : t('totalPurchase')} right={m(b.total)} /><Row left={t('totalPaid')} right={m(b.paid)} /><Row left={t('nextDate')} right={fd(sel.next)} />
      <Btn icon={isC ? icons.collect : icons.pay} label={t(isC ? 'receivePayment' : 'payPayment')} onPress={() => setPayOpen(true)} />
      <View style={{ flexDirection: 'row', gap: 10 }}><View style={{ flex: 1 }}><Btn kind="ghost" icon={icons.edit} label={t('edit')} onPress={() => open(sel)} /></View><View style={{ flex: 1 }}><Btn kind="danger" icon={icons.del} label={t('del')} onPress={() => setConfirmDel(true)} /></View></View></Card>
      <Card><SectionHead icon={icons.history}>{t('history')}</SectionHead><Row left={t('prevDue')} right={m(sel.opening)} />{txs.map(x => {
        const row = <Row key={x.id} left={x.kind === 'payment' ? lbl(x.kind) : (x.ref ?? lbl(x.kind))} sub={fd(x.date)} right={m(x.amount)} neg={x.kind !== 'payment'} />;
        const payRow = x.kind === 'payment' && (x.account || x.note)
          ? <Row key={x.id} left={lbl(x.kind)} sub={[fd(x.date), x.account, x.note].filter(Boolean).join(' • ')} right={m(x.amount)} />
          : null;
        if (x.kind === 'payment') return payRow ?? row;
        if ((x.kind === 'sreturn' || x.kind === 'preturn') && x.returnId) {
          return (
            <TouchableOpacity key={`${x.id}:ret`} onPress={() => setRetId(x.returnId!)}>
              <View pointerEvents="none">{row}</View>
            </TouchableOpacity>
          );
        }
        return (
          <View key={`${x.id}:inv`} style={{ flexDirection: 'row', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>{row}</View>
            <TouchableOpacity onPress={() => setInv({ kind: isC ? 'sale' : 'purchase', id: x.id })} style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name={icons.print} size={22} iconColor={color.primary} />
            </TouchableOpacity>
          </View>
        );
      })}</Card>
      {retId ? <ReturnModal id={retId} onClose={() => setRetId(null)} /> : null}
      {payOpen && sel ? <QuickPaymentModal kind={kind} partyId={sel.id} partyName={sel.name} onClose={() => setPayOpen(false)} /> : null}
      {inv ? <InvoiceModal kind={inv.kind} id={inv.id} onClose={() => setInv(null)} onReturn={onReturn ? () => { const v = inv; setInv(null); onReturn!(v.kind, v.id); } : undefined} /> : null}
      {confirmDel ? (
        <DetailShell title={sel.name} onClose={() => setConfirmDel(false)}>
          <Card>
            <Text style={{ fontSize: 16, color: color.text, marginBottom: 12 }}>{isC ? t('trashAskC') : t('trashAskV')}</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}><Btn kind="ghost" label={t('cancel')} onPress={() => setConfirmDel(false)} /></View>
              <View style={{ flex: 1 }}><Btn kind="danger" icon={icons.del} label={t('trashMoveBtn')} onPress={doDelete} /></View>
            </View>
          </Card>
        </DetailShell>
      ) : null}
      {blocked ? (
        <DetailShell title={t(blocked.title)} onClose={() => setBlocked(null)}>
          <Card>
            <Text style={{ fontSize: 16, color: color.text, marginBottom: 12 }}>{blocked.body}</Text>
            <Btn label={t('ok')} onPress={() => setBlocked(null)} />
          </Card>
        </DetailShell>
      ) : null}
    </Screen>;
  }
  return <Screen scrollRef={scrollRef} onScrollY={onScrollY}>
    <ListPageHeader title={isC ? t('customers') : t('vendors')} addLabel={t('add')} onAdd={() => open()} />
    {/* Top Summary Cards */}
    {(() => {
      const totalParties = list.length;
      const totalDueBal = list.reduce((sum, p) => sum + Math.max(0, bal(kind, p.id).balance), 0);
      const activeCount = list.filter(p => bal(kind, p.id).balance > 0).length;
      return (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 14 }}>
          <View style={{ flex: 1, minWidth: 200, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8E4', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#E8F5E9', alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name={isC ? icons.customers : icons.vendors} size={22} iconColor="#1B7F4B" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500' }}>{isC ? 'মোট কাস্টমার' : 'মোট সরবরাহকারী'}</Text>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#0F172A' }}>{totalParties} জন</Text>
            </View>
          </View>

          <View style={{ flex: 1, minWidth: 200, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8E4', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#FEE2E2', alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name={icons.collect} size={22} iconColor="#DC2626" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500' }}>{isC ? 'মোট বাকি' : 'মোট প্রদেয়'}</Text>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#DC2626' }}>{m(totalDueBal)}</Text>
            </View>
          </View>

          <View style={{ flex: 1, minWidth: 200, backgroundColor: '#fff', borderRadius: 12, padding: 14, borderWidth: 1, borderColor: '#E2E8E4', flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: '#EFF6FF', alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name={icons.calc} size={22} iconColor="#2563EB" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 13, color: '#64748B', fontWeight: '500' }}>বাকি থাকা একাউন্ট</Text>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#0F172A' }}>{activeCount} টি</Text>
            </View>
          </View>
        </View>
      );
    })()}
    <SearchDropdown
      items={list}
      query={pq}
      setQuery={setPq}
      placeholder={searchPh}
      match={matchParty}
      subOf={p => p.mobile}
      rightOf={p => ({ text: m(bal(kind, p.id).balance), neg: bal(kind, p.id).balance > 0 })}
      emptyText={isC ? t('noCustomer') : t('noVendor')}
      onSelect={p => setPq(p.name)}
    />
    {isDesktop ? (
      // Desktop list view. `bal()` is the app's canonical due/payable source and
      // is used unchanged, so the table can never disagree with the detail card.
      <ListTable<Party>
        columns={partyColumns as TableColumn<Party>[]}
        rows={listed}
        rowKey={p => p.id}
        sort={sort}
        onSortChange={setSort}
        onRowPress={openDetail}
        empty={<View style={{ padding: 8 }}>{pq.trim() ? <NoResult /> : <Empty />}</View>}
      />
    ) : (
      <RGrid mobile={1} tablet={2} desktop={3}>
        {listed.length ? listed.map(p => <Card key={p.id}><Row icon={isC ? icons.customers : icons.vendors} left={p.name} sub={p.mobile} right={m(bal(kind, p.id).balance)} neg={bal(kind, p.id).balance > 0} /><Btn kind="ghost" icon={icons.history} label={t('history')} onPress={() => openDetail(p)} /></Card>) : <Card>{pq.trim() ? <NoResult /> : <Empty />}</Card>}
      </RGrid>
    )}</Screen>;
}

// Shared Collection / Vendor Payment screen
export function Money({ kind, done }: { kind: 'c' | 'v'; done: () => void }) {
  const { t, lang, money, moneyBalances, bal, customers, vendors, moneyAccounts } = useApp(); const isC = kind === 'c';
  const m = useMoney();
  const [id, setId] = useState<string>(); const [amt, setAmt] = useState(''); const [date, setDate] = useState(dhakaToday()); const [note, setNote] = useState(''); const [next, setNext] = useState('');
  const [accountId, setAccountId] = useState<string>();
  const party = id ? (isC ? customers : vendors).find(p => p.id === id) : undefined;
  const due = id ? Math.max(0, Math.round(bal(kind, id).balance * 100) / 100) : 0;
  return <Screen>
    <MoneyBalanceCard balances={moneyBalances} />
    {!isC && id ? <Card>
      <Muted>{t('vendor')}</Muted>
      <Title>{party?.name ?? id}</Title>
      <Text style={{ fontSize: 26, fontWeight: '700', color: due > 0 ? '#C62828' : '#1B7F4B' }}>{m(due)}</Text>
      <Muted>{t('currentPayable')}</Muted>
    </Card> : null}
    <Card>
    <PartyPicker kind={kind} value={id} onPick={setId} />
    <FormGrid>
      <Field label={t(isC ? 'amount' : 'payAmountQ')} value={amt} onChange={setAmt} num /><DateField label={t('date')} value={date} onChange={setDate} allowPast={false} />
      <Field label={t('note')} value={note} onChange={setNote} /><DateField label={t('nextDate')} value={next} onChange={setNext} clearable allowPast={false} />
    </FormGrid>
    <AccountPicker accountId={accountId} onPick={setAccountId} label={t('paymentAccount')} required />
    <Btn icon={isC ? icons.save : icons.pay} label={t(isC ? 'save' : 'payNow')} onPress={() => {
      const a = num(amt);
      if (!id || !(a > 0)) return Alert.alert(t('invalid'));
      if (!accountId) return Alert.alert(t('needAccount'));
      if (!isC) {
        if (a > due) return Alert.alert(t('overpayV'));
        const acc = moneyAccounts.find(x => x.id === accountId);
        if (acc && acc.balance < a) return Alert.alert(tp(lang, 'notEnoughInAcc', { account: acc.name }));
      }
      (async () => {
        try {
          await money(kind, { partyId: id, amount: a, accountId, date, note, next: next || undefined });
          Alert.alert(t('done')); done();
        } catch (e) {
          Alert.alert(e instanceof Error ? e.message : t('invalid'));
        }
      })();
    }} /></Card></Screen>;
}

/**
 * Quick Receive Payment (customer) / Pay Payment (vendor) launched from the
 * party detail card. It is the same canonical money entry as Accounts →
 * Receive Money / Pay Money: the store `money()` action hits the identical
 * /customer-payments and /vendor-payments endpoints, which create ONE payment
 * row + ONE MoneyMovement (IN/OUT) atomically. No second payment system.
 */
function QuickPaymentModal({ kind, partyId, partyName, onClose }: { kind: 'c' | 'v'; partyId: string; partyName: string; onClose: () => void }) {
  const { t, lang, money, bal, moneyAccounts } = useApp(); const m = useMoney();
  const isC = kind === 'c';
  const due = Math.max(0, Math.round(bal(kind, partyId).balance * 100) / 100);
  const [amt, setAmt] = useState('');
  const [date, setDate] = useState(dhakaToday());
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    const a = num(amt);
    if (!(a > 0)) return Alert.alert(t('invalidAmount'));
    if (!accountId) return Alert.alert(t('needAccount'));
    if (a > due) return Alert.alert(t(isC ? 'overpayC' : 'overpayV'));
    if (!isC) {
      const acc = moneyAccounts.find(x => x.id === accountId);
      if (acc && acc.balance < a) return Alert.alert(tp(lang, 'notEnoughInAcc', { account: acc.name }));
    }
    setBusy(true);
    try {
      await money(kind, { partyId, amount: a, accountId, date, note: note.trim() || undefined });
      Alert.alert(t('done'));
      onClose();
    } catch (e) {
      Alert.alert(e instanceof Error ? e.message : t('invalid'));
      setBusy(false);
    }
  };
  return (
    <DetailShell title={t(isC ? 'receivePayment' : 'payPayment')} onClose={onClose}
      footer={<View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}><Btn kind="ghost" label={t('cancel')} onPress={onClose} /></View>
        <View style={{ flex: 1 }}><Btn icon={isC ? icons.collect : icons.pay} label={t(isC ? 'receivePayment' : 'payPayment')} onPress={submit} /></View>
      </View>}>
      <Card>
        <Muted>{isC ? t('customer') : t('vendor')}</Muted>
        <Title>{partyName}</Title>
        <Text style={{ fontSize: 26, fontWeight: '700', color: due > 0 ? '#C62828' : '#1B7F4B' }}>{m(due)}</Text>
        <Muted>{isC ? t('currentDue') : t('currentPayable')}</Muted>
      </Card>
      <Card>
        <FormGrid>
          <Field label={t(isC ? 'receiveAmount' : 'payAmount')} value={amt} onChange={setAmt} num />
          <DateField label={t('date')} value={date} onChange={setDate} allowPast={false} />
          <Field label={t('note')} value={note} onChange={setNote} />
        </FormGrid>
      </Card>
      <Card>
        <AccountPicker accountId={accountId} onPick={setAccountId} label={t(isC ? 'moneyInAcc' : 'moneyFromAcc')} required />
      </Card>
    </DetailShell>
  );
}

/** Current money per method. Always "right now", never filtered by a period. */
export function MoneyBalanceCard({ balances, onPress }: { balances: MoneyBalance[]; onPress?: () => void }) {
  const { t } = useApp(); const m = useMoney();
  const sum = balances.reduce((a, b) => a + b.balance, 0);
  const body = (
    <Card>
      <SectionHead icon={icons.accounts}>{t('currentMoney')}</SectionHead>
      <RGrid mobile={2} tablet={4} desktop={4}>
        {balances.map(b => (
          <View key={b.method}>
            <Muted>{methodName(b.method, t)}</Muted>
            <Text style={{ fontSize: 20, fontWeight: '700', color: b.balance < 0 ? color.red : color.primary }}>{m(b.balance)}</Text>
            {b.todayIn > 0 || b.todayOut > 0 ? (
              <Muted>{`${t('moneyToday')}: ${b.todayIn > 0 ? `+${m(b.todayIn)}` : ''}${b.todayIn > 0 && b.todayOut > 0 ? ' / ' : ''}${b.todayOut > 0 ? `-${m(b.todayOut)}` : ''}`}</Muted>
            ) : null}
          </View>
        ))}
      </RGrid>
      <View style={{ height: 8 }} />
      <Row icon={icons.accounts} left={t('totalMoney')} right={m(sum)} neg={sum < 0} />
      {onPress ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingTop: 10 }}>
          <AppIcon name={icons.opening} size={20} iconColor={color.primary} />
          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: color.primary }}>{t('openingMoney')}</Text>
          <AppIcon name={icons.chevR} size={22} iconColor={color.muted} />
        </View>
      ) : null}
    </Card>
  );
  return onPress ? <TouchableOpacity onPress={onPress} activeOpacity={0.8}>{body}</TouchableOpacity> : body;
}

// Searchable customer/vendor autocomplete: opens the full list on focus,
// filters while typing, tap a row to select. One component for both kinds.
function PartyPicker({ kind, value, onPick }: { kind: 'c' | 'v'; value?: string; onPick: (id: string | undefined) => void }) {
  const { t, customers, vendors, bal } = useApp(); const m = useMoney(); const isC = kind === 'c';
  const list = isC ? customers : vendors;
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const sel = list.find(p => p.id === value);
  const dueLabel = isC ? t('receivable') : t('payable');
  if (sel) {
    const b = bal(kind, sel.id).balance;
    return (
      <View>
        <Muted>{isC ? t('customer') : t('vendor')}</Muted>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: color.line, borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 12, minHeight: 52, marginBottom: 8 }}>
          <Text numberOfLines={1} style={{ flex: 1, fontSize: 17, fontWeight: '600', color: color.text }}>{sel.name}</Text>
          <TouchableOpacity onPress={() => { onPick(undefined); setQ(''); setOpen(true); }} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name={icons.cancel} size={20} iconColor={color.muted} />
          </TouchableOpacity>
        </View>
        <Text style={{ fontSize: 24, fontWeight: '700', color: b > 0 ? '#C62828' : '#1B7F4B' }}>{m(b)}</Text>
        <Muted>{isC ? t('currentDue') : t('currentPayable')}</Muted>
      </View>
    );
  }
  const vis = q.trim() ? list.filter(p => matchParty(p, q)) : list;
  return (
    <View style={{ zIndex: 10 }}>
      <Muted>{isC ? t('customer') : t('vendor')}</Muted>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: focused || open ? color.primary : color.line, borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 12, minHeight: 52, marginBottom: 0 }}>
        <AppIcon name={icons.search} size={20} iconColor={focused || open ? color.primary : color.muted} />
        <TextInput
          value={q}
          onChangeText={v => { setQ(v); setOpen(true); }}
          placeholder={isC ? t('searchCustomers') : t('searchVendors')}
          placeholderTextColor={color.muted}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onBlur={() => { setFocused(false); setTimeout(() => setOpen(false), 200); }}
          onKeyPress={(e: any) => { if (e?.nativeEvent?.key === 'Escape') setOpen(false); }}
          selectionColor={color.primary}
          style={{ flex: 1, fontSize: 17, color: color.text, minHeight: 50, outlineStyle: 'none' } as any}
        />
        {q ? (
          <TouchableOpacity onPress={() => setQ('')} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name={icons.cancel} size={20} iconColor={color.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
      {open ? (
        <View style={{ borderWidth: 1, borderColor: color.line, borderTopWidth: 0, borderRadius: 12, borderTopLeftRadius: 0, borderTopRightRadius: 0, backgroundColor: '#fff', marginTop: -8, marginBottom: 8, maxHeight: 280, overflow: 'hidden' }}>
          <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 280 }}>
            {vis.length ? vis.map(p => {
              const b = bal(kind, p.id).balance;
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => { onPick(p.id); setQ(''); setOpen(false); }}
                  activeOpacity={0.7}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 60, paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: color.line, backgroundColor: '#fff' }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: color.text }}>{p.name}</Text>
                    <Muted>{p.mobile}</Muted>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: b > 0 ? color.red : color.primary }}>{m(b)}</Text>
                    <Muted>{dueLabel}</Muted>
                  </View>
                </TouchableOpacity>
              );
            }) : (
              <Text style={{ textAlign: 'center', padding: 16, color: color.muted, fontSize: 15 }}>{isC ? t('noCustomer') : t('noVendor')}</Text>
            )}
          </ScrollView>
        </View>
      ) : <View style={{ marginBottom: 8 }} />}
    </View>
  );
}

export function Stock() {
  return <StockDashboard />;
}

const EXPENSE_CATS = [
  'salary', 'rent', 'electricity', 'water', 'gas', 'internet',
  'lunch', 'tea', 'labour', 'loading', 'transport', 'vehicle',
  'fuel', 'bags', 'shopRepair', 'vehicleRepair', 'cleaning',
  'office', 'bankCharge', 'other',
] as const;
const exKey = (id: string) => `ex${id.charAt(0).toUpperCase()}${id.slice(1)}` as Key;

/** Inclusive business-date range: any single day up to any multi-year span. */
export type AcctFilter = { from: string; to: string };

const pad2n = (n: number) => String(n).padStart(2, '0');
/** Business-date arithmetic (UTC): safe from DST/timezone drift on YYYY-MM-DD strings. */
const addDays = (ds: string, delta: number) => {
  const [y, m1, d] = ds.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m1 - 1, d + delta));
  return `${dt.getUTCFullYear()}-${pad2n(dt.getUTCMonth() + 1)}-${pad2n(dt.getUTCDate())}`;
};
const monthStart = (ds: string) => `${ds.slice(0, 7)}-01`;
const monthEnd = (ds: string) => {
  const [y, m1] = ds.split('-').map(Number);
  return `${ds.slice(0, 7)}-${pad2n(new Date(Date.UTC(y, m1, 0)).getUTCDate())}`;
};
const monthShiftStart = (ds: string, delta: number) => {
  const [y, m1] = ds.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m1 - 1 + delta, 1));
  return `${dt.getUTCFullYear()}-${pad2n(dt.getUTCMonth() + 1)}-01`;
};
/** Quick-range presets; every one resolves to a concrete {from,to}. */
const presetRange = (id: 'today' | 'last7' | 'thisMonth' | 'last3m' | 'thisYear', td: string): AcctFilter => {
  if (id === 'last7') return { from: addDays(td, -6), to: td };
  if (id === 'thisMonth') return { from: monthStart(td), to: monthEnd(td) };
  if (id === 'last3m') return { from: monthStart(monthShiftStart(td, -3)), to: monthEnd(monthShiftStart(td, -1)) };
  if (id === 'thisYear') return { from: `${td.slice(0, 4)}-01-01`, to: `${td.slice(0, 4)}-12-31` };
  return { from: td, to: td };
};

export function Accounts({ go, focus, onFocusDone }: { go?: Nav; focus?: { kind: 'c' | 'v'; id: string } | null; onFocusDone?: () => void }) {
  const { t, lang, stats, customers, vendors, bal, expenses, saveExpense, deleteExpense, cTx, moneyBalances } = useApp();
  const m = useMoney(); const n = useNum(); const s = stats(); const fd = useDateStr();
  const [transferOpen, setTransferOpen] = useState(false);
  const [kpi, setKpi] = useState<KpiKind | null>(null);
  const due = customers.map(c => ({ c, b: bal('c', c.id).balance })).filter(x => x.b > 0);
  const pay = vendors.map(c => ({ c, b: bal('v', c.id).balance })).filter(x => x.b > 0);
  const [flt, setFlt] = useState<AcctFilter>(() => { const d = today(); return { from: d, to: d }; });
  const [fltOpen, setFltOpen] = useState(false);
  // Inclusive string compare on canonical YYYY-MM-DD business dates (no TZ).
  const inPeriod = (d: string) => d >= flt.from && d <= flt.to;
  // Money collection is not a profit figure, so it stays local to the period.
  const fCollect = cTx.filter(x => x.kind === 'payment' && inPeriod(x.date)).reduce((a, x) => a + x.amount, 0);
  // Sales / COGS / Gross / Expenses / Net Profit come from the ONE canonical
  // backend service for this exact range (any From..To).
  const finKey = `${flt.from}|${flt.to}`;
  const [finFor, setFinFor] = useState('');
  const { loadFinance, financePeriod } = useApp();
  useEffect(() => {
    let on = true;
    loadFinance('range', flt.from, flt.to).then(() => { if (on) setFinFor(finKey); }).catch(() => { if (on) setFinFor(''); });
    return () => { on = false; };
  }, [finKey]);
  const f: PeriodFinance | null = finFor === finKey ? financePeriod : null;
  const fSale = f?.netSales ?? 0;
  const fExp = f?.expense ?? 0;
  const fProfit = f?.netProfit ?? 0;
  const isToday = flt.from === today() && flt.to === today();
  const monName = (mo: number) => t(MON_KEYS[Math.min(12, Math.max(1, mo)) - 1]);
  const fmtD = (ds: string) => {
    const [y, mo, d] = ds.split('-').map(Number);
    const s = lang === 'bn' ? `${pad2n(d)} ${monName(mo)} ${n(y)}` : `${monName(mo)} ${d}, ${n(y)}`;
    return lang === 'bn' ? toBnDigits(s) : s;
  };
  const fltLabel = flt.from === flt.to ? fmtD(flt.from) : `${fmtD(flt.from)} – ${fmtD(flt.to)}`;
  const [rc, setRc] = useState<string | null>(null);
  const [vp, setVp] = useState<string | null>(null);
  useEffect(() => {
    if (focus) {
      if (focus.kind === 'c') { setRc(focus.id); setTab('due'); }
      else { setVp(focus.id); setTab('pay'); }
      onFocusDone?.();
    }
  }, [focus]);
  const [tab, setTab] = useState<'due' | 'pay' | 'expense'>('due');
  const [eq, setEq] = useState('');
  const [ef, setEf] = useState<Expense | null | undefined>(undefined);
  const exLabel = (e: Expense) => (e.category === 'other' && e.customName ? e.customName : t(exKey(e.category)));
  const q = eq.trim().toLowerCase();
  const exListed = [...expenses]
    .filter(e => !q || t(exKey(e.category)).toLowerCase().includes(q) || (e.customName ?? '').toLowerCase().includes(q) || (e.note ?? '').toLowerCase().includes(q))
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const todayExpTotal = exListed.filter(e => e.date === today()).reduce((a, e) => a + e.amount, 0);
  return (
    <Screen>
      {/* Current money is always "right now" and is deliberately not affected
          by the day/month/year filter below. */}
      <MoneyBalanceCard balances={moneyBalances} />
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><SectionHead icon={icons.calc}>{t('accounts')}</SectionHead></View>
          <TouchableOpacity onPress={() => setFltOpen(true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 44, paddingHorizontal: 12, borderRadius: 12, backgroundColor: '#fff', borderWidth: 1.5, borderColor: color.primary }}>
            <AppIcon name={icons.filter} size={20} iconColor={color.primary} />
            <Text style={{ fontSize: 14, fontWeight: '600', color: color.primary }}>{fltLabel}</Text>
          </TouchableOpacity>
        </View>
        <RGrid mobile={2} tablet={3} desktop={6}>
          <KpiTile label={isToday ? t('todaySale') : t('fSale')} value={m(fSale)} onPress={() => setKpi('sales')} />
          <KpiTile label={isToday ? t('todayCollect') : t('fCollect')} value={m(fCollect)} onPress={() => setKpi('collect')} />
          <KpiTile label={t('cogs')} value={m(f?.cogs ?? 0)} neg onPress={() => setKpi('cogs')} />
          <KpiTile label={isToday ? t('todayExpense') : t('expense')} value={m(fExp)} neg onPress={() => setKpi('expense')} />
          <KpiTile label={isToday ? t('todayProfit') : t('netProfitLabel')} value={m(fProfit)} neg={fProfit < 0} onPress={() => setKpi('profit')} />
          <KpiTile label={t('totalDue')} value={m(s.due)} onPress={() => setKpi('recv')} />
          <KpiTile label={t('totalPayable')} value={m(s.payable)} neg onPress={() => setKpi('pay')} />
        </RGrid>
      </Card>
      {fltOpen ? <FilterModal init={flt} onClose={() => setFltOpen(false)} onApply={f => { setFlt(f); setFltOpen(false); }} /> : null}
      <Card>
        <SectionHead icon={icons.profit}>{t('netProfitLabel')}</SectionHead>
        {f ? <ProfitBreakdown f={f} /> : <Muted>{t('wait')}</Muted>}
      </Card>
      {go && <View style={{ marginVertical: 4 }}><Btn kind="ghost" icon={icons.collect} label={t('collect')} onPress={() => go('collect')} /><Btn kind="ghost" icon={icons.pay} label={t('pay')} onPress={() => go('pay')} /><Btn kind="ghost" icon={icons.transfer} label={t('transferMoney')} onPress={() => setTransferOpen(true)} /><Btn kind="ghost" icon={icons.add} label={t('addExpense')} onPress={() => setEf(null)} /></View>}
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        <View style={{ flex: 1 }}><Btn kind={tab === 'due' ? 'primary' : 'ghost'} label={t('toReceive')} onPress={() => setTab('due')} /></View>
        <View style={{ flex: 1 }}><Btn kind={tab === 'pay' ? 'primary' : 'ghost'} label={t('toPay')} onPress={() => setTab('pay')} /></View>
        <View style={{ flex: 1 }}><Btn kind={tab === 'expense' ? 'primary' : 'ghost'} icon={icons.calc} label={t('expense')} onPress={() => setTab('expense')} /></View>
      </View>
      {tab === 'due' ? (
        <Card><SectionHead icon={icons.collect}>{t('toReceive')}</SectionHead>{due.length ? due.map(x => <DueRow key={x.c.id} icon={icons.customers} name={x.c.name} sub={x.c.next ? fd(x.c.next) : ''} amount={m(x.b)} neg onPress={() => setRc(x.c.id)} />) : <Empty />}</Card>
      ) : tab === 'pay' ? (
        <Card><SectionHead icon={icons.pay}>{t('toPay')}</SectionHead>{pay.length ? pay.map(x => <DueRow key={x.c.id} icon={icons.vendors} name={x.c.name} sub={x.c.next ? fd(x.c.next) : ''} amount={m(x.b)} neg onPress={() => setVp(x.c.id)} />) : <Empty />}</Card>
      ) : (
        <View>
          <SearchToggle query={eq} setQuery={setEq} placeholder={t('expenseHistory')} />
          <Card>
            <SectionHead icon={icons.calc}>{t('expenseHistory')}</SectionHead>
            <Row left={t('todayExpense')} right={m(todayExpTotal)} neg={todayExpTotal > 0} />
            {exListed.length ? exListed.map(e => (
              <TouchableOpacity key={e.id} onPress={() => setEf(e)}>
                <Row left={exLabel(e)} sub={`${e.method ? `${methodName(e.method, t)} • ` : ''}${fd(e.date)}${e.note ? ` • ${e.note}` : ''}`} right={m(e.amount)} neg />
              </TouchableOpacity>
            )) : <Empty />}
          </Card>
        </View>
      )}
      {kpi ? (
        <KpiDetailModal
          kind={kpi}
          period={{ label: fltLabel, inPeriod, isCurrent: isToday }}
          fin={f}
          kpiTotal={fSale}
          collectTotal={fCollect}
          dueTotal={s.due}
          payTotal={s.payable}
          onClose={() => setKpi(null)}
        />
      ) : null}
      {transferOpen ? <MoneyTransferModal onClose={() => setTransferOpen(false)} /> : null}
      {rc ? <ReceivableModal id={rc} onClose={() => setRc(null)} /> : null}
      {vp ? <PayableModal id={vp} onClose={() => setVp(null)} /> : null}
      {ef !== undefined ? (
        <ExpenseModal
          init={ef}
          onClose={() => setEf(undefined)}
          onSave={async v => { await saveExpense(v); setEf(undefined); }}
          onTrash={async id => { await deleteExpense(id); setEf(undefined); }}
        />
      ) : null}
    </Screen>
  );
}

function FilterModal({ init, onClose, onApply }: { init: AcctFilter; onClose: () => void; onApply: (f: AcctFilter) => void }) {
  const { t } = useApp();
  const td = today();
  const [from, setFrom] = useState(init.from);
  const [to, setTo] = useState(init.to);
  const invalid = from > to;
  const apply = () => {
    if (invalid) return Alert.alert(t('invalidRange'));
    onApply({ from, to });
  };
  const quick = (id: 'today' | 'last7' | 'thisMonth' | 'last3m' | 'thisYear') => {
    const r = presetRange(id, td);
    setFrom(r.from); setTo(r.to);
  };
  const quickChips: { id: Parameters<typeof quick>[0]; label: string }[] = [
    { id: 'today', label: t('todayQ') },
    { id: 'last7', label: t('last7') },
    { id: 'thisMonth', label: t('thisMonthQ') },
    { id: 'last3m', label: t('last3m') },
    { id: 'thisYear', label: t('thisYearQ') },
  ];
  return (
    <DetailShell title={t('filter')} onClose={onClose}>
      <Card>
        <SectionHead icon={icons.calendar}>{t('timeRange')}</SectionHead>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          {quickChips.map(q => (
            <TouchableOpacity key={q.id} onPress={() => quick(q.id)} style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 14, borderRadius: 12, backgroundColor: '#E8EFE9' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: color.primary }}>{q.label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <FormGrid>
          <DateField label={t('startDate')} value={from} onChange={setFrom} />
          <DateField label={t('endDate')} value={to} onChange={setTo} />
        </FormGrid>
        {invalid ? <Text style={{ color: color.red, fontSize: 13, marginBottom: 8 }}>{t('invalidRange')}</Text> : null}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <View style={{ flex: 1 }}><Btn kind="ghost" label={t('reset')} onPress={() => onApply({ from: td, to: td })} /></View>
          <View style={{ flex: 1 }}><Btn kind="ghost" label={t('cancel')} onPress={onClose} /></View>
          <View style={{ flex: 1 }}><Btn icon={icons.save} label={t('apply')} onPress={apply} /></View>
        </View>
      </Card>
    </DetailShell>
  );
}

const MON_KEYS = ['mon1', 'mon2', 'mon3', 'mon4', 'mon5', 'mon6', 'mon7', 'mon8', 'mon9', 'mon10', 'mon11', 'mon12'] as const;
const DOW_KEYS = ['dow0', 'dow1', 'dow2', 'dow3', 'dow4', 'dow5', 'dow6'] as const;

// Shop-local "today" (Asia/Dhaka) as YYYY-MM-DD. The UTC-based today() can
// still be yesterday during 00:00–06:00 Dhaka time, which would wrongly ban
// the current business day — date constraints always use this instead.
const dhakaToday = (): string => {
  try {
    const s = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : today();
  } catch {
    return today();
  }
};

function MonthCal({ selected, onPick, minDate, maxDate }: {
  selected: string; onPick: (date: string) => void; minDate?: string; maxDate?: string;
}) {
  const { t } = useApp(); const n = useNum();
  const parts = selected.split('-');
  const [vy, setVy] = useState(+(parts[0] || new Date().getFullYear()));
  const [vm, setVm] = useState(Math.min(12, Math.max(1, +(parts[1] || 1))));
  const pad = (v: number) => String(v).padStart(2, '0');
  const shift = (d: number) => {
    let y = vy, m = vm + d;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setVy(y); setVm(m);
  };
  const first = new Date(Date.UTC(vy, vm - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(vy, vm, 0)).getUTCDate();
  const cells: (number | null)[] = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const todayS = today();
  // Out-of-range days are shown dimmed and are NOT pressable — the mistake is
  // prevented in the calendar instead of corrected afterwards.
  const blocked = (ds: string) => (minDate ? ds < minDate : false) || (maxDate ? ds > maxDate : false);
  const navBtn = (icon: 'back' | 'next', fn: () => void) => (
    <TouchableOpacity onPress={fn} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
      <AppIcon name={icon === 'back' ? icons.back : icons.chevR} size={22} iconColor={color.primary} />
    </TouchableOpacity>
  );
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 4 }}>
        {navBtn('back', () => shift(-1))}
        <Text style={{ fontSize: 17, fontWeight: '700', color: color.text }}>{t(MON_KEYS[vm - 1])} {n(vy)}</Text>
        {navBtn('next', () => shift(1))}
      </View>
      <View style={{ flexDirection: 'row' }}>
        {[0, 1, 2, 3, 4, 5, 6].map(d => (
          <Text key={d} style={{ flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '700', color: color.muted, paddingVertical: 4 }}>{t(DOW_KEYS[d])}</Text>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
        {cells.map((d, i) => {
          if (d === null) return <View key={`e${i}`} style={{ width: `${100 / 7}%`, minHeight: 44 }} />;
          const ds = `${vy}-${pad(vm)}-${pad(d)}`;
          const off = blocked(ds);
          const isSel = ds === selected && !off;
          const isToday = ds === todayS;
          const dayText = (
            <Text style={{ fontSize: 16, fontWeight: isSel ? '700' : '400', color: isSel ? '#fff' : off ? color.muted : color.text }}>{n(d)}</Text>
          );
          if (off) {
            return (
              <View key={ds} style={{ width: `${100 / 7}%`, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 }}>
                <View style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, opacity: 0.5 }}>
                  {dayText}
                </View>
              </View>
            );
          }
          return (
            <View key={ds} style={{ width: `${100 / 7}%`, alignItems: 'center', justifyContent: 'center', paddingVertical: 2 }}>
              <TouchableOpacity onPress={() => onPick(ds)} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: isSel ? color.primary : 'transparent', borderWidth: isToday && !isSel ? 1.5 : 0, borderColor: color.primary }}>
                {dayText}
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * Reusable date input: the whole field is tappable and opens the same in-app
 * calendar (MonthCal) that the Accounts day-filter uses — no third-party
 * picker, identical i18n/day labels. Value stays the canonical `YYYY-MM-DD`
 * string the rest of the app already uses.
 *
 * Constraints (operational fields pass `allowPast={false}`; report/filter
 * fields leave the default `true` so history stays selectable):
 * - `allowPast={false}` → past dates are disabled in the calendar and any
 *   past pick that still arrives is rejected with a warning popup and never
 *   forwarded to `onChange` (never saved).
 * - `minDate` / `maxDate` override or narrow the range explicitly.
 */
function DateField({ label, value, onChange, clearable, allowPast = true, minDate, maxDate }: {
  label: string; value: string; onChange: (v: string) => void; clearable?: boolean;
  allowPast?: boolean; minDate?: string; maxDate?: string;
}) {
  const { t } = useApp();
  const fs = useFs(17, 15);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);
  const [warn, setWarn] = useState(false);
  const effMin = minDate ?? (allowPast ? undefined : dhakaToday());
  const bad = (d: string) => !!d && ((effMin ? d < effMin : false) || (maxDate ? d > maxDate : false));
  // Last committed date that passed the constraint — business today when there
  // is none. A rejected pick reverts the calendar highlight here.
  const lastValid = useRef(value && !bad(value) ? value : dhakaToday());
  const openCal = () => { setDraft(value); setOpen(true); };
  const commit = (d: string) => {
    if (bad(d)) {
      setDraft(lastValid.current);
      setWarn(true);
      return;
    }
    lastValid.current = d;
    onChange(d); setOpen(false);
  };
  return (
    <View style={{ marginBottom: 10 }}>
      <Muted>{label}</Muted>
      <TouchableOpacity onPress={openCal} accessibilityRole="button" style={{ borderWidth: 1, borderColor: color.line, borderRadius: 12, minHeight: 48, paddingHorizontal: 12, backgroundColor: '#fff', flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, fontSize: fs, color: value ? color.text : color.muted }}>{value || t('chooseDate')}</Text>
        {clearable && value ? (
          <TouchableOpacity onPress={e => { e.stopPropagation(); onChange(''); }} accessibilityRole="button" style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name={icons.cancel} size={18} iconColor={color.muted} />
          </TouchableOpacity>
        ) : null}
        <AppIcon name={icons.calendar} size={20} iconColor={color.primary} />
      </TouchableOpacity>
      {open ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
            <View style={{ width: '100%', maxWidth: 360, backgroundColor: color.bg, borderRadius: 16, overflow: 'hidden' }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 14, paddingRight: 4, backgroundColor: color.primary }}>
                <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700', flex: 1 }} numberOfLines={1}>{t('chooseDate')}</Text>
                <TouchableOpacity onPress={() => setOpen(false)} accessibilityRole="button" style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}>
                  <AppIcon name={icons.cancel} size={22} iconColor="#fff" />
                </TouchableOpacity>
              </View>
              <View style={{ padding: 14 }}>
                <MonthCal selected={draft} onPick={commit} minDate={effMin} maxDate={maxDate} />
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  {clearable ? (
                    <View style={{ flex: 1 }}><Btn kind="ghost" label={t('clearDate')} onPress={() => { onChange(''); setOpen(false); }} /></View>
                  ) : null}
                  <View style={{ flex: 1 }}><Btn kind="ghost" label={t('cancel')} onPress={() => setOpen(false)} /></View>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
      {warn ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setWarn(false)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
            <View style={{ width: '100%', maxWidth: 360, backgroundColor: color.bg, borderRadius: 16, padding: 18 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: color.text, marginBottom: 8 }}>{t('pastDateTitle')}</Text>
              <Text style={{ fontSize: 15, color: color.text, marginBottom: 14 }}>{t('pastDateMsg')}</Text>
              <Btn label={t('ok')} onPress={() => setWarn(false)} />
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

function ExpenseModal({ init, onClose, onSave, onTrash }: {
  init: Expense | null;
  onClose: () => void;
  onSave: (v: { id?: string; category: string; customName?: string; amount: number; accountId: string; date: string; note?: string }) => Promise<void>;
  onTrash: (id: string) => Promise<void>;
}) {
  const { t } = useApp();
  const [cat, setCat] = useState(init?.category ?? '');
  const [name, setName] = useState(init?.customName ?? '');
  const [amt, setAmt] = useState(init ? String(init.amount) : '');
  const [date, setDate] = useState(init?.date ?? dhakaToday());
  const [note, setNote] = useState(init?.note ?? '');
  const [accountId, setAccountId] = useState<string | undefined>(init?.accountId);
  const save = () => {
    if (!cat) return Alert.alert(t('selectType'));
    if (!(num(amt) > 0)) return Alert.alert(t('invalidAmount'));
    if (cat === 'other' && !name.trim()) return Alert.alert(t('needExpName'));
    if (!accountId) return Alert.alert(t('needAccount'));
    (async () => {
      try {
        await onSave({ id: init?.id, category: cat, customName: cat === 'other' ? name.trim() : undefined, amount: num(amt), accountId, date: date || today(), note: note.trim() || undefined });
      } catch (e) {
        Alert.alert(e instanceof Error ? e.message : t('invalid'));
      }
    })();
  };
  const trash = () => {
    if (!init) return;
    Alert.alert(t('sure'), t('deleteExpenseAsk'), [{ text: t('cancel') }, {
      text: t('trashMoveBtn'), onPress: () => {
        (async () => {
          try { await onTrash(init.id); }
          catch (e) { Alert.alert(e instanceof Error ? e.message : t('invalid')); }
        })();
      },
    }]);
  };
  return (
    <DetailShell title={init ? (init.category === 'other' && init.customName ? init.customName : t(exKey(init.category))) : t('addExpense')} onClose={onClose}>
      <Card>
        <Muted>{t('expenseType')}</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 }}>
          {EXPENSE_CATS.map(c => (
            <TouchableOpacity key={c} onPress={() => setCat(c)} style={{ paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 22, backgroundColor: cat === c ? color.primary : '#E8EFE9' }}>
              <Text style={{ color: cat === c ? '#fff' : color.text, fontSize: 15, fontWeight: cat === c ? '700' : '400' }}>{t(exKey(c))}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {cat === 'other' ? <Field label={t('expenseName')} value={name} onChange={setName} /> : null}
        <FormGrid>
          <Field label={t('amount')} value={amt} onChange={setAmt} num />
          <DateField label={t('date')} value={date} onChange={setDate} allowPast={false} />
        </FormGrid>
        <AccountPicker accountId={accountId} onPick={setAccountId} label={t('paymentAccount')} required />
        <Field label={t('note')} value={note} onChange={setNote} />
        <Btn icon={icons.save} label={t('saveExpense')} onPress={save} />
        {init ? <Btn kind="danger" icon={icons.del} label={t('trashMoveBtn')} onPress={trash} /> : <Btn kind="ghost" icon={icons.cancel} label={t('cancel')} onPress={onClose} />}
      </Card>
    </DetailShell>
  );
}

/**
 * Transfer money between two of the shop's own accounts.
 * OUT on one account + IN on the other under ONE transfer reference. Total
 * money never changes and no sale / expense / profit is touched.
 */
function MoneyTransferModal({ onClose }: { onClose: () => void }) {
  const { t, lang, moneyAccounts, transferMoney } = useApp();
  const m = useMoney(); const fd = useDateStr();
  const active = moneyAccounts.filter(a => a.active);
  const [fromId, setFromId] = useState<string>(active[0]?.id ?? '');
  const [toId, setToId] = useState<string>(active[1]?.id ?? active[0]?.id ?? '');
  const [amt, setAmt] = useState('');
  const [date, setDate] = useState(dhakaToday());
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const available = moneyAccounts.find(a => a.id === fromId)?.balance ?? 0;
  const amount = parseNum(amt);
  // Insufficient-balance popup data (dynamic: source name, live balance,
  // requested amount). One modal state, so the frontend pre-check and the
  // backend rejection can never produce two popups for one attempt.
  const [insuf, setInsuf] = useState<{ account: string; balance: string; amount: string } | null>(null);
  const showInsuf = () => setInsuf({
    account: moneyAccounts.find(a => a.id === fromId)?.name ?? '',
    balance: m(available),
    amount: m(amount),
  });

  const submit = () => {
    if (busy) return;
    if (!fromId || !toId) return Alert.alert(t('needAccount'));
    if (fromId === toId) return Alert.alert(t('sameAccount'));
    if (!(amount > 0)) return Alert.alert(t('needAmount'));
    // Fast local guard (boundary: exactly-available is allowed). The backend
    // TRANSFER_FUNDS check stays authoritative for races/stale balances.
    if (amount > available) return showInsuf();
    setBusy(true);
    (async () => {
      try {
        await transferMoney({ fromId, toId, amount, date: date || today(), note: note.trim() || undefined });
        setAmt(''); setNote('');
        Alert.alert(t('transferDone'));
        onClose();
      } catch (e) {
        // Backend is authoritative: surface its insufficient-balance verdict
        // through the same popup instead of a technical error. Anything else
        // keeps the previous generic alert.
        if (e instanceof ApiError && e.code === 'TRANSFER_FUNDS') showInsuf();
        else Alert.alert(e instanceof Error ? e.message : t('invalid'));
      } finally {
        setBusy(false);
      }
    })();
  };

  const nameOf = (id: string) => moneyAccounts.find(a => a.id === id)?.name ?? '';
  const balanceOf = (id: string) => moneyAccounts.find(a => a.id === id)?.balance ?? 0;
  const row = (label: string, value: string, neg?: boolean) => <Row left={label} right={value} neg={neg} />;

  return (
    <DetailShell title={t('transferMoney')} onClose={onClose}>
      <Card>
        <Muted>{t('fromAccount')}</Muted>
        <View style={{ marginVertical: 6 }}>
          {active.map(a => (
            <TouchableOpacity key={a.id} onPress={() => setFromId(a.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12, borderRadius: 12, marginBottom: 6, backgroundColor: fromId === a.id ? '#E8EFE9' : '#fff', borderWidth: 1.5, borderColor: fromId === a.id ? color.primary : color.line }}>
              <AppIcon name={methodIcon(a.type)} size={20} iconColor={color.primary} />
              <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: color.text }}>{a.name}</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: color.primary }}>{m(balanceOf(a.id))}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Muted>{`${t('currentBalance')}: ${m(available)}`}</Muted>
        <View style={{ height: 12 }} />
        <Muted>{t('toAccount')}</Muted>
        <View style={{ marginVertical: 6 }}>
          {active.filter(a => a.id !== fromId).map(a => (
            <TouchableOpacity key={a.id} onPress={() => setToId(a.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, paddingHorizontal: 12, borderRadius: 12, marginBottom: 6, backgroundColor: toId === a.id ? '#E8EFE9' : '#fff', borderWidth: 1.5, borderColor: toId === a.id ? color.primary : color.line }}>
              <AppIcon name={methodIcon(a.type)} size={20} iconColor={color.primary} />
              <Text style={{ flex: 1, fontSize: 16, fontWeight: '600', color: color.text }}>{a.name}</Text>
              <Text style={{ fontSize: 15, fontWeight: '700', color: color.primary }}>{m(balanceOf(a.id))}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <FormGrid>
          <Field label={t('amount')} value={amt} onChange={setAmt} num />
          <DateField label={t('date')} value={date} onChange={setDate} allowPast={false} />
        </FormGrid>
        <Field label={t('note')} value={note} onChange={setNote} />
        <Btn icon={icons.transfer} label={t('doTransfer')} onPress={submit} />
        {busy ? <Muted>{t('wait')}</Muted> : null}
        <Btn kind="ghost" icon={icons.cancel} label={t('close')} onPress={onClose} />
      </Card>
      <TransferHistory />
      {insuf ? (
        <Modal visible transparent animationType="fade" onRequestClose={() => setInsuf(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
            <View style={{ width: '100%', maxWidth: 360, backgroundColor: color.bg, borderRadius: 16, padding: 18 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: color.text, marginBottom: 8 }}>{t('insufTitle')}</Text>
              <Text style={{ fontSize: 15, color: color.text, marginBottom: 8 }}>
                {tp(lang, 'insufMsg', { account: insuf.account, balance: insuf.balance, amount: insuf.amount })}
              </Text>
              <Text style={{ fontSize: 15, fontWeight: '600', color: color.text, marginBottom: 14 }}>
                {tp(lang, 'insufMax', { balance: insuf.balance })}
              </Text>
              <Btn label={t('ok')} onPress={() => setInsuf(null)} />
            </View>
          </View>
        </Modal>
      ) : null}
    </DetailShell>
  );
}

/** Transfers shown as ONE business event (name -> name), never two rows. */
function TransferHistory({ limit = 8 }: { limit?: number }) {
  const { t, moneyTransfers, moneyAccounts } = useApp();
  const m = useMoney(); const fd = useDateStr();
  const nameOf = (id?: string) => moneyAccounts.find(a => a.id === id)?.name ?? '';
  return (
    <Card>
      <SectionHead icon={icons.transfer}>{t('recentTx')}</SectionHead>
      {moneyTransfers.length ? moneyTransfers.slice(0, limit).map(x => (
        <Row key={x.id} left={`${nameOf(x.fromId)} \u2192 ${nameOf(x.toId)}`} sub={`${x.transferNo} \u2022 ${fd(x.date)}`} right={m(x.amount)} />
      )) : <Empty />}
    </Card>
  );
}

/**
 * ব্যাংক ও ক্যাশ / Bank & Cash
 *
 * The one place where the shop's actual money lives: the accounts, their
 * opening balances, their derived current balances, transfers and history.
 * Total Money is only the sum of the ACTIVE account balances - never sales,
 * profit, receivable, payable or inventory value.
 */
export function BankCash() {
  const { t, moneyAccounts, moneyTransfers } = useApp();
  const m = useMoney();
  const [addOpen, setAddOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);
  const active = moneyAccounts.filter(a => a.active);
  const archived = moneyAccounts.filter(a => !a.active);
  const total = active.reduce((sum, a) => sum + a.balance, 0);
  // Active accounts are the default view; archived ones stay hidden until asked
  // for, so the main screen is not cluttered.
  const [showArchived, setShowArchived] = useState(false);
  const chip = (label: string, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={label} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={{ paddingHorizontal: 14, minHeight: 40, justifyContent: 'center', borderRadius: 20, borderWidth: 1, borderColor: color.line, backgroundColor: on ? color.primary : color.card }}>
      <Text style={{ color: on ? '#fff' : color.text, fontSize: 14, fontWeight: on ? '700' : '400' }}>{label}</Text>
    </TouchableOpacity>
  );

  const card = (a: (typeof moneyAccounts)[number]) => (
    <TouchableOpacity key={a.id} onPress={() => setDetailId(a.id)} activeOpacity={0.85}
      accessibilityRole="button" accessibilityLabel={a.name}
      style={{ backgroundColor: color.card, borderRadius: 14, borderWidth: 1.5, borderColor: color.line, padding: 14, marginBottom: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <AppIcon name={methodIcon(a.type)} size={26} iconColor={color.primary} />
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: color.text }}>{a.name}</Text>
          <Muted>{methodName(a.type, t)}</Muted>
        </View>
        <AppIcon name={icons.chevR} size={22} iconColor={color.muted} />
      </View>
      {[a.bankName, a.branch, a.accountNumber, a.mobileNumber].filter(Boolean).length ? (
        <Muted>{[a.bankName, a.branch, a.accountNumber, a.mobileNumber].filter(Boolean).join(' \u2022 ')}</Muted>
      ) : null}
      <View style={{ height: 6 }} />
      <Row left={t('accountBalanceLabel')} right={m(a.balance)} neg={a.balance < 0} />
    </TouchableOpacity>
  );

  return (
    <Screen>
      <Card><SectionHead icon={icons.accounts}>{t('bankCash')}</SectionHead></Card>
      <Card>
        <Muted>{t('totalMoneyLabel')}</Muted>
        <Text style={{ fontSize: 30, fontWeight: '700', color: color.primary }}>{m(total)}</Text>
      </Card>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        <View style={{ flex: 1 }}><Btn kind="ghost" icon={icons.add} label={t('addAccount')} onPress={() => setAddOpen(true)} /></View>
        <View style={{ flex: 1 }}><Btn kind="ghost" icon={icons.transfer} label={t('transferMoney')} onPress={() => setTransferOpen(true)} /></View>
      </View>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
        {chip(t('activeAccountsTab'), !showArchived, () => setShowArchived(false))}
        {archived.length ? chip(`${t('inactiveAccountsTab')} (${archived.length})`, showArchived, () => setShowArchived(true)) : null}
      </View>
      {!showArchived ? (
        active.length ? active.map(card) : <Card><Empty /></Card>
      ) : (
        archived.length ? archived.map(card) : <Card><Empty /></Card>
      )}
      <TransferHistory limit={10} />
      {addOpen ? <AccountFormModal onClose={() => setAddOpen(false)} /> : null}
      {editId ? <AccountFormModal id={editId} onClose={() => setEditId(null)} /> : null}
      {detailId ? <AccountDetailModal id={detailId} onClose={() => setDetailId(null)} onEdit={() => { setEditId(detailId); setDetailId(null); }} /> : null}
      {transferOpen ? <MoneyTransferModal onClose={() => setTransferOpen(false)} /> : null}
    </Screen>
  );
}

/** Add / edit one money account. Bank + wallet details only when relevant. */
function AccountFormModal({ id, onClose }: { id?: string; onClose: () => void }) {
  const { t, moneyAccounts, saveAccount, setAccountOpening } = useApp();
  const cur = id ? moneyAccounts.find(a => a.id === id) : undefined;
  const [name, setName] = useState(cur?.name ?? '');
  const [type, setType] = useState<string>(cur?.type ?? 'cash');
  const [opening, setOpening] = useState(cur ? String(cur.openingBalance) : '');
  const [bankName, setBankName] = useState(cur?.bankName ?? '');
  const [accountNumber, setAccountNumber] = useState(cur?.accountNumber ?? '');
  const [branch, setBranch] = useState(cur?.branch ?? '');
  const [mobileNumber, setMobileNumber] = useState(cur?.mobileNumber ?? '');
  const [note, setNote] = useState(cur?.note ?? '');
  const [activeOn, setActiveOn] = useState(cur ? cur.active : true);
  const [busy, setBusy] = useState(false);
  const isBank = type === 'bank';
  const isMobile = type === 'bkash' || type === 'nagad' || type === 'rocket';

  const save = () => {
    if (!name.trim()) return Alert.alert(t('accountName'));
    if (busy) return;
    setBusy(true);
    (async () => {
      try {
        const openingVal = opening.trim() === '' ? 0 : parseNum(opening);
        if (openingVal < 0) return Alert.alert(t('invalidAmount'));
        const payload = {
          name: name.trim(), type: type as AccountType,
          bankName: isBank ? bankName.trim() : '', accountNumber: isBank ? accountNumber.trim() : '',
          branch: isBank ? branch.trim() : '', mobileNumber: isMobile ? mobileNumber.trim() : '',
          note: note.trim(), active: activeOn,
        };
        if (cur) {
          await saveAccount({ ...payload, id: cur.id });
          // Opening balance is changed through its own safe endpoint so
          // historical movements are never silently rewritten.
          if (openingVal !== cur.openingBalance) await setAccountOpening(cur.id, openingVal);
        } else {
          await saveAccount({ ...payload, openingBalance: openingVal });
        }
        Alert.alert(t('done'));
        onClose();
      } catch (e) {
        Alert.alert(e instanceof Error ? e.message : t('invalid'));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <DetailShell title={cur ? t('editAccount') : t('addAccount')} onClose={onClose}>
      <Card>
        <Field label={`${t('accountName')} *`} value={name} onChange={setName} />
        <Muted>{`${t('accountType')} *`}</Muted>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 }}>
          {ACCOUNT_TYPES.map(ty => (
            <TouchableOpacity key={ty} onPress={() => setType(ty)}
              style={{ paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 22, backgroundColor: type === ty ? color.primary : '#E8EFE9' }}>
              <Text style={{ color: type === ty ? '#fff' : color.text, fontSize: 15, fontWeight: type === ty ? '700' : '400' }}>{methodName(ty, t)}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Field label={t('openingBalanceLabel')} value={opening} onChange={setOpening} num />
        {isBank ? (
          <>
            <Field label={t('bankName')} value={bankName} onChange={setBankName} />
            <Field label={t('accountNumber')} value={accountNumber} onChange={setAccountNumber} />
            <Field label={t('branch')} value={branch} onChange={setBranch} />
          </>
        ) : null}
        {isMobile ? <Field label={t('mobileNumber')} value={mobileNumber} onChange={setMobileNumber} /> : null}
        <Field label={t('note')} value={note} onChange={setNote} />
        {cur ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 8 }}>
            <Text style={{ flex: 1, fontSize: 15, color: color.text }}>{activeOn ? t('activeAccount') : t('inactiveAccount')}</Text>
            <Btn kind={activeOn ? 'ghost' : 'primary'} label={activeOn ? t('deactivateAccount') : t('activateAccount')} onPress={() => setActiveOn(v => !v)} />
          </View>
        ) : null}
        <Btn icon={icons.save} label={t('save')} onPress={save} />
        {busy ? <Muted>{t('wait')}</Muted> : null}
        <Btn kind="ghost" icon={icons.cancel} label={t('cancel')} onPress={onClose} />
      </Card>
    </DetailShell>
  );
}

/** One account: current balance + its own ledger, in plain shop language. */
function AccountDetailModal({ id, onClose, onEdit }: { id: string; onClose: () => void; onEdit: () => void }) {
  const { t, lang, moneyAccounts, saveAccount, deleteAccount } = useApp();
  const m = useMoney(); const fd = useDateStr();
  // Account lifecycle: edit, deactivate/reactivate, and a delete that the API
  // only allows while there is no financial history at all.
  const [ask, setAsk] = useState<'delete' | 'deactivate' | null>(null);
  const [blocked, setBlocked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<{ account: (typeof moneyAccounts)[number]; movements: { id: string; date: string; direction: 'in' | 'out'; amount: number; sourceType: string; note?: string; transferNo?: string; counterpartyAccountId?: string; balance: number }[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    api.moneyAccountDetail(id).then(d => { if (on) setData(d); }).catch(e => { if (on) setErr(e instanceof Error ? e.message : t('invalid')); });
    return () => { on = false; };
  }, [id]);
  const acc = data?.account;
  // History flags come from the backend (movements + both transfer sides).
  const local = moneyAccounts.find(a => a.id === id);
  const hasHistory = (acc?.hasHistory ?? local?.hasHistory) || (acc?.movementCount ?? local?.movementCount ?? 0) > 0 || (acc?.transferCount ?? local?.transferCount ?? 0) > 0;
  const setActive = async (next: boolean) => {
    if (!acc) return;
    setBusy(true);
    try {
      await saveAccount({ ...acc, active: next });
      setData(d => (d ? { ...d, account: { ...d.account, active: next } } : d));
      setAsk(null); setBlocked(null);
    } catch (e) {
      // Money still inside: keep it visible in the total instead of archiving.
      const code = (e as { code?: string })?.code;
      setBlocked(code === 'ACCOUNT_NOT_EMPTY' ? tp(lang, 'accountNotEmpty', { amount: m(acc.balance) })
        : e instanceof Error ? e.message : t('invalid'));
    } finally { setBusy(false); }
  };
  const doDelete = async () => {
    if (!acc) return;
    setBusy(true);
    try {
      await deleteAccount(acc.id);
      onClose();
    } catch (e) {
      const code = (e as { code?: string })?.code;
      const msg = e instanceof Error ? e.message : t('invalid');
      setAsk(null);
      if (code === 'ACCOUNT_HAS_HISTORY') setBlocked(t('accountHasHistory'));
      else if (code === 'ACCOUNT_HAS_OPENING') setBlocked(t('accountHasOpening'));
      else setBlocked(msg);
    } finally { setBusy(false); }
  };
  const nameOf = (aid?: string) => moneyAccounts.find(a => a.id === aid)?.name ?? '';
  const desc = (mv: { sourceType: string; transferNo?: string; counterpartyAccountId?: string; direction: string }) => {
    if (mv.sourceType === 'sale') return `${t('sale')} \u2022 ${t('collect')}`;
    if (mv.sourceType === 'purchase') return `${t('purchase')} \u2022 ${t('pay')}`;
    if (mv.sourceType === 'customerPayment') return t('collect');
    if (mv.sourceType === 'vendorPayment') return t('pay');
    if (mv.sourceType === 'expense') return t('expense');
    if (mv.sourceType === 'saleReturn') return t('saleReturnLabel2');
    if (mv.sourceType === 'purchaseReturn') return t('purchaseReturnLabel');
    if (mv.sourceType === 'transferOut') return `${t('transferMoney')} \u2192 ${nameOf(mv.counterpartyAccountId)}`;
    if (mv.sourceType === 'transferIn') return `${t('transferMoney')} \u2190 ${nameOf(mv.counterpartyAccountId)}`;
    if (mv.sourceType === 'openingAdjust') return t('openingMoney');
    return mv.sourceType;
  };
  // Confirmations swap the sheet body instead of stacking another RN Modal.
  const confirmBody = (body: string, confirmLabel: string, icon: React.ComponentProps<typeof AppIcon>['name'], run: () => void) => (
    <Card>
      <Text style={{ fontSize: 16, color: color.text, marginBottom: 12 }}>{body}</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <View style={{ flex: 1 }}><Btn kind="ghost" label={t('cancel')} onPress={() => { setAsk(null); setBlocked(null); }} /></View>
        <View style={{ flex: 1 }}><Btn kind="danger" icon={icon} label={confirmLabel} onPress={run} /></View>
      </View>
    </Card>
  );
  if (ask === 'delete') {
    return (
      <DetailShell title={t('confirmDeleteAccount')} onClose={() => setAsk(null)}>
        {confirmBody(t('deleteAccountBody'), t('del'), icons.del, doDelete)}
      </DetailShell>
    );
  }
  if (ask === 'deactivate') {
    return (
      <DetailShell title={t('deactivateAccount')} onClose={() => setAsk(null)}>
        {confirmBody(acc && Math.round(acc.balance * 100) !== 0
          ? tp(lang, 'accountNotEmpty', { amount: m(acc.balance) })
          : t('inactiveAccountHint'), t('deactivateAccount'), icons.cancel, () => setActive(false))}
      </DetailShell>
    );
  }
  if (blocked) {
    return (
      <DetailShell title={t('inactiveAccount')} onClose={() => setBlocked(null)}>
        <Card>
          <Text style={{ fontSize: 16, color: color.text, marginBottom: 12 }}>{blocked}</Text>
          <Btn label={t('ok')} onPress={() => setBlocked(null)} />
        </Card>
      </DetailShell>
    );
  }
  return (
    <DetailShell title={acc?.name ?? t('accountHistory')} onClose={onClose}>
      <Card>
        <Muted>{t('accountBalanceLabel')}</Muted>
        <Text style={{ fontSize: 28, fontWeight: '700', color: color.primary }}>{m(acc?.balance ?? 0)}</Text>
        <Row left={t('openingMoney')} right={m(acc?.openingBalance ?? 0)} />
        <Row left={t('accountType')} right={methodName(acc?.type ?? 'cash', t)} />
        <View style={{ height: 6 }} />
        <SectionHead icon={icons.history}>{t('accountHistory')}</SectionHead>
        {err ? <Muted>{err}</Muted> : null}
        {!acc && !err ? <Muted>{t('wait')}</Muted> : null}
        {data?.movements.map(mv => (
          <Row key={mv.id} left={desc(mv)} sub={`${fd(mv.date)}${mv.transferNo ? ` \u2022 ${mv.transferNo}` : ''}`} right={`${mv.direction === 'in' ? '+' : '-'}${m(mv.amount)}`} neg={mv.direction === 'out'} />
        ))}
        {data && !data.movements.length ? <Empty /> : null}
        <View style={{ height: 8 }} />
        <Muted>{acc?.active === false ? t('inactiveAccount') : t('activeAccount')}</Muted>
        <View style={{ height: 8 }} />
        <Btn kind="ghost" icon={icons.edit} label={t('editAccount')} onPress={onEdit} />
        {acc?.active === false ? (
          <Btn kind="ghost" icon={icons.accounts} label={t('activateAccount')} onPress={() => setActive(true)} />
        ) : (
          <Btn kind="ghost" icon={icons.cancel} label={t('deactivateAccount')} onPress={() => setAsk('deactivate')} />
        )}
        {!hasHistory ? <Btn kind="danger" icon={icons.del} label={t('deleteAccount')} onPress={() => setAsk('delete')} /> : null}
        <Btn kind="ghost" icon={icons.cancel} label={t('close')} onPress={onClose} />
      </Card>
    </DetailShell>
  );
}

// Clickable balance row with trailing chevron.
function DueRow({ name, sub, amount, neg, icon, onPress }: {
  name: string; sub?: string; amount: string; neg?: boolean;
  icon: React.ComponentProps<typeof AppIcon>['name']; onPress: () => void;
}) {
  const fs = useFs(16, 14);
  return (
    <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.line }}>
      <AppIcon name={icon} size={20} iconColor={color.muted} />
      <View style={{ flex: 1, marginLeft: 10 }}>
        <Text style={{ fontSize: fs, fontWeight: '600', color: color.text }}>{name}</Text>
        {sub ? <Muted>{sub}</Muted> : null}
      </View>
      <Text style={{ fontSize: fs, fontWeight: '600', color: neg ? color.red : color.primary }}>{amount}</Text>
      <AppIcon name={icons.chevR} size={22} iconColor={color.muted} />
    </TouchableOpacity>
  );
}

export function DetailShell({ title, onClose, children, footer, bodyScroll = true, maxHeightPct = '90%', overlay }: {
  title: string; onClose: () => void; children: React.ReactNode;
  /** Pinned to the bottom of the sheet; the body scrolls behind it. */
  footer?: React.ReactNode;
  /** Set false when the child manages its own single scroll area. */
  bodyScroll?: boolean;
  maxHeightPct?: number | `${number}%`;
  /** Dim strength behind the sheet; defaults keep the previous look. */
  overlay?: string;
}) {
  const { isDesktop } = useBreakpoint();
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: overlay ?? 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 12 }}>
        <View style={{ width: '100%', maxWidth: isDesktop ? (footer ? 640 : 560) : 560, maxHeight: maxHeightPct, backgroundColor: color.bg, borderRadius: 16, overflow: 'hidden' }}>
          {/* fixed header */}
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 14, paddingRight: 4, backgroundColor: color.primary }}>
            <Text style={{ color: '#fff', fontSize: 18, fontWeight: '700', flex: 1 }} numberOfLines={1}>{title}</Text>
            <TouchableOpacity onPress={onClose} style={{ minHeight: 48, minWidth: 48, alignItems: 'center', justifyContent: 'center' }}>
              <AppIcon name={icons.cancel} size={22} iconColor="#fff" />
            </TouchableOpacity>
          </View>
          {/* scrollable body (single scroll container) */}
          {bodyScroll ? (
            <ScrollView style={{ padding: 14 }} contentContainerStyle={{ paddingBottom: 20 }} keyboardShouldPersistTaps="handled">
              {children}
            </ScrollView>
          ) : (
            <View style={{ flex: 1, minHeight: 0 }}>{children}</View>
          )}
          {/* fixed footer */}
          {footer ? <View style={{ borderTopWidth: 1, borderTopColor: color.line, backgroundColor: color.card, paddingHorizontal: 14, paddingTop: 8, paddingBottom: 12 }}>{footer}</View> : null}
        </View>
      </View>
    </Modal>
  );
}

function TxnItem({ it }: { it: DetailItem }) {
  const m = useMoney(); const n = useNum();
  const { kg, label } = useUnitLabel();
  const u = it.unit as BagUnit;
  const per = it.enteredQty ? Math.round((it.qtyKg / it.enteredQty) * 100) / 100 : 0;
  const sub = u === 'kg'
    ? `${n(it.enteredQty)} ${kg} × ${m(it.rate)}`
    : `${n(it.enteredQty)} ${label(u)} × ${n(per)} ${kg} = ${n(it.qtyKg)} ${kg} • ${m(it.rate)}/${kg}`;
  return <Row left={it.productName} sub={sub} right={m(it.qtyKg * it.rate)} />;
}

// Shared invoice assembly + print/share actions for saved transactions.
function useInvoice() {
  const { t, lang } = useApp(); const m = useMoney(); const n = useNum(); const fd = useDateStr();
  const { kg } = useUnitLabel();
  const un: UnitNames = { kg, small: t('smallBag'), medium: t('mediumBag'), large: t('largeBag'), ton: t('ton') };
  const toDoc = (
    kind: 'sale' | 'purchase',
    d: SaleDetail | PurchaseDetail,
  ): InvData => {
    const isSale = kind === 'sale';
    const sd = d as SaleDetail, pd = d as PurchaseDetail;
    const party = isSale ? sd.customer : pd.vendor;
    return {
      no: (d.invoiceNo ?? '').toString(),
      date: fd(d.date),
      time: fmtTime(d.createdAt, lang === 'bn'),
      partyName: party?.name ?? t('cashSale'),
      partyMobile: party?.mobile ?? '',
      lines: d.items.map(it => ({
        name: it.productName,
        detail: `${unitDetail(it.unit, it.enteredQty, it.qtyKg, un, n)} • ${m(it.rate)}/${kg}`,
        total: m(it.qtyKg * it.rate),
      })),
      total: m(d.total),
      paid: m(d.paid),
      due: m(d.due),
      next: d.nextDate ? fd(d.nextDate) : undefined,
      labels: {
        shop: 'চালের আড়ৎ',
        docTitle: isSale ? t('saleInvoice') : t('purchaseInvoice'),
        invoiceNo: t('invoiceNo'), date: t('date'), time: t('time'),
        partyLabel: isSale ? t('customer') : t('vendor'),
        mobile: t('mobile'), product: t('product'), qty: t('qty'), rate: t('rate'),
        total: t('total'), paid: t('paid'), due: t('due'), payDate: t('payDate'), thanks: t('thanks'),
      },
    };
  };
  const fetchDoc = async (kind: 'sale' | 'purchase', id: string): Promise<InvData> => {
    const d = kind === 'sale' ? await api.saleDetail(id) : await api.purchaseDetail(id);
    return toDoc(kind, d);
  };
  // Open the print window synchronously (user gesture) so blockers allow it,
  // then fill it once the saved transaction loads.
  // Preview and Print share this one function, so there is a single document
  // rendering path and no duplicated preview markup. The window contains only
  // the document - never the app chrome.
  const openDoc = (kind: 'sale' | 'purchase', id: string, doPrint: boolean) => {
    if (typeof window === 'undefined') return;
    const w = window.open('', '_blank');
    if (w) w.document.write('<html><body>...</body></html>');
    fetchDoc(kind, id).then(
      doc => {
        if (!w || w.closed) return;
        w.document.open();
        w.document.write(buildInvoiceHTML(doc));
        w.document.close();
        w.focus();
        if (doPrint) w.print();
      },
      () => { if (w && !w.closed) w.close(); },
    );
  };
  const printTxn = (kind: 'sale' | 'purchase', id: string) => openDoc(kind, id, true);
  const previewTxn = (kind: 'sale' | 'purchase', id: string) => openDoc(kind, id, false);
  const shareTxn = (kind: 'sale' | 'purchase', id: string) => {
    fetchDoc(kind, id).then(
      doc => {
        try {
          const r = Share.share({ message: buildInvoiceText(doc) });
          if (r && typeof (r as Promise<unknown>).catch === 'function') (r as Promise<unknown>).catch(() => {});
        } catch (e) { /* share unavailable */ }
      },
      () => {},
    );
  };
  const condLabel = (c: string) => (c === 'damaged' ? t('damaged') : c === 'partial' ? t('partialDamaged') : t('good'));
  const reasonLabel = (r?: string) => {
    if (!r) return '';
    const map: Record<string, string> = { torn: t('dmgTorn'), wet: t('dmgWet'), pest: t('dmgPest'), spoiled: t('dmgSpoiled'), transport: t('dmgTransport'), other: t('exOther') };
    return map[r] ?? r;
  };
  const toRetDoc = (d: ReturnDetail): InvData => {
    const isSale = d.kind === 'sale';
    return {
      no: d.returnNo ?? '',
      date: fd(d.date),
      time: fmtTime(d.createdAt, lang === 'bn'),
      partyName: d.party?.name ?? (isSale ? t('cashSale') : ''),
      partyMobile: d.party?.mobile ?? '',
      lines: d.items.map(it => {
        const bits = [unitDetail(it.unit, it.enteredQty, it.qtyKg, un, n), condLabel(it.condition)];
        if (it.condition === 'partial') bits.push(`${t('goodQty')}: ${n(it.goodKg)} ${kg}, ${t('dmgQty')}: ${n(it.damagedKg)} ${kg}`);
        if (it.damageReason) bits.push(`${t('dmgReason')}: ${reasonLabel(it.damageReason)}`);
        if (it.note) bits.push(it.note);
        bits.push(`${m(it.rate)}/${kg}`);
        return { name: it.productName, detail: bits.join(' • '), total: m(it.amount) };
      }),
      total: m(d.totalAmount),
      paid: '',
      due: '',
      hidePay: true,
      extra: [
        { label: t('origInvoice'), value: `${d.origInvoiceNo ?? ''}` },
        { label: t('settleHow'), value: d.settlement === 'refund' ? t('refundMoney') : (isSale ? t('keepCredit') : t('keepVendorCredit')) },
      ],
      labels: {
        shop: 'চালের আড়ৎ',
        docTitle: `${isSale ? t('saleReturn') : t('purchaseReturn')} ${t('invoice')}`,
        invoiceNo: t('returnNo'), date: t('date'), time: t('time'),
        partyLabel: isSale ? t('customer') : t('vendor'),
        mobile: t('mobile'), product: t('product'), qty: t('qty'), rate: t('rate'),
        total: t('returnValue'), paid: t('paid'), due: t('due'), payDate: t('payDate'), thanks: t('thanks'),
      },
    };
  };
  const printReturn = (id: string) => {
    if (typeof window === 'undefined') return;
    const w = window.open('', '_blank');
    if (w) w.document.write('<html><body>...</body></html>');
    api.returnDetail(id).then(
      d => {
        if (!w || w.closed) return;
        const doc = toRetDoc(d);
        w.document.open();
        w.document.write(buildInvoiceHTML(doc));
        w.document.close();
        w.focus();
        w.print();
      },
      () => { if (w && !w.closed) w.close(); },
    );
  };
  return { toDoc, fetchDoc, printTxn, previewTxn, shareTxn, toRetDoc, printReturn, condLabel, reasonLabel };
}

// Full saved-transaction invoice preview with Print / Share / Close.
export function InvoiceModal({ kind, id, onClose, onReturn, onBack }: {
  kind: 'sale' | 'purchase'; id: string; onClose: () => void; onReturn?: () => void;
  /** Set when the document was opened from its module list: shows Back to list. */
  onBack?: () => void;
}) {
  const { t } = useApp(); const m = useMoney(); const fd = useDateStr();
  const { fetchDoc, printTxn, previewTxn, shareTxn } = useInvoice();
  const [doc, setDoc] = useState<InvData | null>(null);
  const [rets, setRets] = useState<{ id: string; returnNo?: string; date: string; amount: number }[]>([]);
  const [extra, setExtra] = useState<{ discount?: number; payment?: TxnPayment }>({});
  useEffect(() => {
    let on = true;
    fetchDoc(kind, id).then(d => { if (on) setDoc(d); }).catch(() => {});
    (kind === 'sale' ? api.saleDetail(id) : api.purchaseDetail(id)).then(
      d => {
        if (!on) return;
        const x = d as { returns?: typeof rets; discount?: number; payment?: TxnPayment };
        setRets(x.returns ?? []);
        setExtra({ discount: x.discount, payment: x.payment ?? null });
      },
      () => {},
    );
    return () => { on = false; };
  }, [kind, id]);
  return (
    <DetailShell title={doc ? `${doc.labels.docTitle} • ${doc.no}` : t('invoice')} onClose={onClose}>
      {!doc ? <ActivityIndicator size="large" color={color.primary} /> : (
        <View>
          {onBack ? (
            <TouchableOpacity onPress={onBack} accessibilityRole="button"
              accessibilityLabel={kind === 'sale' ? t('backToSales') : t('backToPurchases')}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', minHeight: 44, paddingRight: 8, marginBottom: 10 }}>
              <AppIcon name={icons.back} size={22} iconColor={color.primary} />
              <Text style={{ fontSize: 16, fontWeight: '600', color: color.primary }}>
                {kind === 'sale' ? t('backToSales') : t('backToPurchases')}
              </Text>
            </TouchableOpacity>
          ) : null}
          <Card>
            <Text style={{ fontSize: 20, fontWeight: '700', color: color.text, textAlign: 'center' }}>{doc.labels.shop}</Text>
            <Text style={{ fontSize: 16, fontWeight: '700', color: color.text, textAlign: 'center', marginBottom: 8 }}>{doc.labels.docTitle}</Text>
            <Row left={doc.labels.invoiceNo} right={doc.no} />
            <Row left={doc.labels.date} right={doc.date} />
            <Row left={doc.labels.time} right={doc.time} />
            <Row left={doc.labels.partyLabel} right={doc.partyName} />
            {doc.partyMobile ? <Row left={doc.labels.mobile} right={doc.partyMobile} /> : null}
          </Card>
          <Card>
            {doc.lines.map((l, i) => <Row key={i} left={l.name} sub={l.detail} right={l.total} />)}
            {(extra.discount ?? 0) > 0 ? <Row left={t('discount')} right={`-${m(extra.discount!)}`} /> : null}
            <Row left={doc.labels.total} right={doc.total} />
            <Row left={doc.labels.paid} right={doc.paid} />
            <Row left={doc.labels.due} right={doc.due} neg />
            {doc.next ? <Row left={doc.labels.payDate} right={doc.next} /> : null}
            {extra.payment && extra.payment.amount > 0 ? (
              <Row left={t('paymentAccount')} right={`${extra.payment.accountName ?? methodName(extra.payment.method as AccountType, t)} • ${m(extra.payment.amount)}`} />
            ) : null}
          </Card>
          <Btn icon={icons.print} label={t('printInvoice')} onPress={() => printTxn(kind, id)} />
          <Btn kind="ghost" icon={icons.print} label={t('preview')} onPress={() => previewTxn(kind, id)} />
          <Btn kind="ghost" icon={icons.share} label={t('share')} onPress={() => shareTxn(kind, id)} />
          {rets.length ? (
            <Card>
              <SectionHead icon={icons.history}>{t('returns')}</SectionHead>
              {rets.map(r => <Row key={r.id} left={r.returnNo ?? ''} sub={fd(r.date)} right={m(r.amount)} />)}
            </Card>
          ) : null}
          {onReturn ? <Btn kind="ghost" icon={icons.add} label={t('doReturn')} onPress={onReturn} /> : null}
          <Btn kind="ghost" label={t('close')} onPress={onClose} />
          <Card><Text style={{ textAlign: 'center', color: color.muted }}>{doc.labels.thanks}</Text></Card>
        </View>
      )}
    </DetailShell>
  );
}

// Post-completion sheet: saved invoice number + total + Print/Close.
export function SuccessModal({ kind, invoiceNo, total, txnId, onClose }: {
  kind: 'sale' | 'purchase'; invoiceNo: string; total: number; txnId: string; onClose: () => void;
}) {
  const { t } = useApp(); const m = useMoney();
  const { printTxn } = useInvoice();
  return (
    <DetailShell title="" onClose={onClose}>
      <Card>
        <View style={{ alignItems: 'center', marginBottom: 8 }}>
          <AppIcon name={icons.done} size={44} iconColor={color.primary} />
        </View>
        <Text style={{ fontSize: 20, fontWeight: '700', color: color.text, textAlign: 'center', marginBottom: 12 }}>
          {kind === 'sale' ? t('saleDone') : t('purchaseDone')}
        </Text>
        <Row left={t('invoice')} right={invoiceNo} />
        <Row left={t('total')} right={m(total)} />
      </Card>
      <Btn icon={icons.print} label={t('printInvoice')} onPress={() => printTxn(kind, txnId)} />
      <Btn kind="ghost" label={t('close')} onPress={onClose} />
    </DetailShell>
  );
}

const refNo = (id: string) => id.slice(-4).toUpperCase();

export function ReceivableModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useApp(); const m = useMoney(); const fd = useDateStr();
  const [d, setD] = useState<RecvDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    api.receivableDetail(id).then(r => { if (on) setD(r); }).catch(e => { if (on) setErr(e instanceof Error ? e.message : t('invalid')); });
    return () => { on = false; };
  }, [id]);
  return (
    <DetailShell title={d ? d.party.name : ''} onClose={onClose}>
      {!d ? (err ? <Muted>{err}</Muted> : <ActivityIndicator size="large" color={color.primary} />) : (
        <View>
          <Card>
            <Muted>{d.party.mobile}</Muted>
            <Text style={{ fontSize: 28, fontWeight: '700', color: d.balance > 0 ? '#C62828' : '#1B7F4B' }}>{m(d.balance)}</Text>
            <Muted>{t('currentDue')}</Muted>
            {d.opening > 0 ? <Row left={t('prevDue')} right={m(d.opening)} /> : null}
          </Card>
          {d.sales.map(s => (
            <Card key={s.id}>
              <SectionHead icon={icons.sale}>{t('sale')} {s.invoiceNo ?? `#${refNo(s.id)}`} • {fd(s.date)}</SectionHead>
              {s.items.map((it, i) => <TxnItem key={i} it={it} />)}
              <Row left={t('total')} right={m(s.total)} />
              <Row left={t('paid')} right={m(s.paid)} />
              <Row left={t('due')} right={m(s.due)} neg={s.due > 0} />
              <Row left={t('status')} right={statusLabel(t, s)} />
            </Card>
          ))}
          {d.payments.length ? (
            <Card>
              <SectionHead icon={icons.collect}>{t('collect')}</SectionHead>
              {d.payments.map(p => <Row key={p.id} icon={icons.collect} left={t('payment')} sub={fd(p.date)} right={m(p.amount)} />)}
            </Card>
          ) : null}
          <Card>
            <Row left={t('totalSales')} right={m(d.totalSales)} />
            <Row left={t('totalPaid')} right={m(d.totalPaid)} />
            <Row left={t('currentDue')} right={m(d.balance)} neg={d.balance > 0} />
          </Card>
        </View>
      )}
    </DetailShell>
  );
}

function PayableModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useApp(); const m = useMoney(); const fd = useDateStr();
  const [d, setD] = useState<PayDetail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let on = true;
    api.payableDetail(id).then(r => { if (on) setD(r); }).catch(e => { if (on) setErr(e instanceof Error ? e.message : t('invalid')); });
    return () => { on = false; };
  }, [id]);
  return (
    <DetailShell title={d ? d.party.name : ''} onClose={onClose}>
      {!d ? (err ? <Muted>{err}</Muted> : <ActivityIndicator size="large" color={color.primary} />) : (
        <View>
          <Card>
            <Muted>{d.party.mobile}</Muted>
            <Text style={{ fontSize: 28, fontWeight: '700', color: d.balance > 0 ? '#C62828' : '#1B7F4B' }}>{m(d.balance)}</Text>
            <Muted>{t('currentPayable')}</Muted>
            {d.opening > 0 ? <Row left={t('prevDue')} right={m(d.opening)} /> : null}
          </Card>
          {d.purchases.map(p => (
            <Card key={p.id}>
              <SectionHead icon={icons.purchase}>{t('purchase')} {p.invoiceNo ?? `#${refNo(p.id)}`} • {fd(p.date)}</SectionHead>
              {p.items.map((it, i) => <TxnItem key={i} it={it} />)}
              <Row left={t('total')} right={m(p.total)} />
              <Row left={t('paid')} right={m(p.paid)} />
              <Row left={t('due')} right={m(p.due)} neg={p.due > 0} />
              <Row left={t('status')} right={statusLabel(t, p)} />
            </Card>
          ))}
          {d.payments.length ? (
            <Card>
              <SectionHead icon={icons.pay}>{t('pay')}</SectionHead>
              {d.payments.map(p => <Row key={p.id} icon={icons.pay} left={t('payment')} sub={fd(p.date)} right={m(p.amount)} />)}
            </Card>
          ) : null}
          <Card>
            <Row left={t('totalPurchase')} right={m(d.totalPurchase)} />
            <Row left={t('totalPaid')} right={m(d.totalPaid)} />
            <Row left={t('currentPayable')} right={m(d.balance)} neg={d.balance > 0} />
          </Card>
        </View>
      )}
    </DetailShell>
  );
}

// ---------------------------------------------------------------------
// Accounts KPI cards: clickable tiles + one shared detail/preview/print view
// ---------------------------------------------------------------------

export type KpiKind = 'sales' | 'collect' | 'cogs' | 'expense' | 'profit' | 'recv' | 'pay';

export type KpiPeriod = {
  label: string;
  inPeriod: (d: string) => boolean;
  isCurrent: boolean; // true when the filter is today
};

const SHOP_NAME = '\u099a\u09be\u09b2\u09c7\u09b0 \u0986\u09a1\u09bc\u09cd\u09b0\u09a4';

/** Whole-card tap target with subtle hover/press feedback. */
function KpiTile({ label, value, neg, onPress }: { label: string; value: string; neg?: boolean; onPress: () => void }) {
  const [hover, setHover] = useState(false);
  const fs = useFs(20, 18);
  return (
    <Pressable
      onPress={onPress}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole="button"
      style={({ pressed }) => ({
        borderRadius: 12,
        borderWidth: 1.5,
        borderColor: pressed || hover ? color.primary : 'transparent',
        backgroundColor: pressed || hover ? '#F1F7F3' : 'transparent',
        paddingVertical: 8,
        paddingHorizontal: 8,
        minHeight: 56,
        justifyContent: 'center',
        cursor: 'pointer',
      })}
    >
      <Muted>{label}</Muted>
      <Text style={{ fontSize: fs, fontWeight: '700', color: neg ? color.red : color.primary }}>{value}</Text>
    </Pressable>
  );
}

/**
 * Builds the report rows. Every total comes from the canonical source that the
 * matching card already uses, so Detail = Preview = Print = Card.
 */
function useKpiReport(kind: KpiKind, period: KpiPeriod, fin: PeriodFinance | null, kpiTotal: number, collectTotal: number, dueTotal: number, payTotal: number) {
  const { t, lang, sales, returns, cTx, expenses, customers, vendors, bal } = useApp();
  const m = useMoney(); const fd = useDateStr();
  // One pure builder: the same function feeds Detail, Preview and Print, so
  // the three can never disagree.
  const build = React.useCallback((): ReportDoc => {
    const printedAt = printedAtStamp(lang === 'bn');
    const base = { shop: SHOP_NAME, period: period.label, printedAt, printLabel: t('print'), closeLabel: t('cancel') };
    const inP = period.inPeriod;

    if (kind === 'recv' || kind === 'pay') {
      const isC = kind === 'recv';
      const list = (isC ? customers : vendors)
        .map(p => ({ p, b: bal(isC ? 'c' : 'v', p.id).balance }))
        .filter(x => x.b > 0)
        .sort((a, b2) => b2.b - a.b);
      const total = isC ? dueTotal : payTotal;
      return {
        ...base,
        title: isC ? t('recvDetail') : t('payDetail'),
        meta: [{ label: t('accounts'), value: t('currentBalanceNote') }],
        sections: [{ rows: list.map(x => ({
          label: x.p.name,
          sub: [x.p.mobile, x.p.next ? `${t('nextDate')}: ${fd(x.p.next)}` : ''].filter(Boolean).join(' \u2022 '),
          right: m(x.b), neg: true,
        })) }],
        total: { label: isC ? t('totalDue') : t('totalPayable'), value: m(total), neg: true },
      };
    }

    if (kind === 'collect') {
      const rows = cTx.filter(x => x.kind === 'payment' && inP(x.date))
        .map(x => ({
          label: x.partyId === 'cash' ? t('cashSaleRow') : (customers.find(c => c.id === x.partyId)?.name ?? ''),
          sub: [fd(x.date), x.method ? methodName(x.method as MoneyMethod, t) : '', x.saleId ? (sales.find(s => s.id === x.saleId)?.invoiceNo ?? '') : '', x.note ?? ''].filter(Boolean).join(' \u2022 '),
          right: m(x.amount),
        }))
        .sort((a, b2) => (a.sub < b2.sub ? 1 : -1));
      return {
        ...base,
        title: t('collectDetail'),
        sections: [{ title: t('fCollect'), rows: rows.length ? rows : [{ label: t('empty'), right: '' }] }],
        total: { label: t('totalPaid'), value: m(collectTotal) },
      };
    }

    if (kind === 'expense') {
      const rows = expenses.filter(e => inP(e.date)).map(e => ({
        label: e.category === 'other' && e.customName ? e.customName : t(exKey(e.category)),
        sub: [fd(e.date), e.method ? methodName(e.method, t) : '', e.note ?? ''].filter(Boolean).join(' \u2022 '),
        right: m(e.amount), neg: true,
      }));
      return {
        ...base,
        title: t('expenseDetail'),
        sections: [{ rows: rows.length ? rows : [{ label: t('empty'), right: '' }] }],
        total: { label: t('expense'), value: m(fin?.expense ?? 0), neg: true },
      };
    }

    if (kind === 'cogs') {
      const inv = (sales.filter(x => inP(x.date)) || []).map(x => ({
        label: x.invoiceNo ?? t('sale'),
        sub: [fd(x.date), customers.find(c => c.id === x.customerId)?.name ?? t('cashSaleRow')].filter(Boolean).join(' \u2022 '),
        right: m(x.cogs ?? 0), neg: true,
      }));
      return {
        ...base,
        title: t('cogsDetail'),
        meta: [{ label: t('cogs'), value: t('stockValueFrom') }],
        sections: [
          {
            rows: [
              { label: t('openingStock'), right: m(fin?.openingStockValue ?? 0) },
              { label: `(+)${t('purchase')}`, right: m(fin?.purchase ?? 0) },
              { label: `(-)${t('purchaseReturnLabel')}`, right: m(fin?.purchaseReturn ?? 0), neg: true },
              { label: `(-)${t('closingStock')}`, right: m(fin?.closingStockValue ?? 0), neg: true },
              { label: t('cogs'), right: m(fin?.cogs ?? 0), neg: true, bold: true },
            ],
          },
          { title: t('totalSales'), rows: inv.length ? inv : [{ label: t('empty'), right: '' }] },
        ],
        total: { label: t('cogs'), value: m(fin?.cogs ?? 0), neg: true },
      };
    }

    if (kind === 'profit') {
      const f = fin;
      const rows: ReportRow[] = f ? [
        { label: t('totalSales'), right: m(f.sales) },
        { label: `(-)${t('salesReturnLabel')}`, right: m(f.salesReturn), neg: true },
        { label: t('netSalesLabel'), right: m(f.netSales), bold: true },
        { label: t('openingStock'), right: m(f.openingStockValue) },
        { label: `(+)${t('purchase')}`, right: m(f.purchase) },
        { label: `(-)${t('purchaseReturnLabel')}`, right: m(f.purchaseReturn), neg: true },
        { label: `(-)${t('closingStock')}`, right: m(f.closingStockValue), neg: true },
        { label: t('cogs'), right: m(f.cogs), neg: true, bold: true },
        { label: t('grossProfit'), right: m(f.grossProfit), bold: true },
        { label: `(-)${t('expense')}`, right: m(f.expense), neg: true },
        { label: t('netProfitLabel'), right: m(f.netProfit), bold: true, neg: f.netProfit < 0 },
      ] : [];
      return {
        ...base,
        title: t('profitDetail'),
        sections: [{ rows: rows.length ? rows : [{ label: t('empty'), right: '' }] }],
        total: { label: t('netProfitLabel'), value: m(f?.netProfit ?? 0), neg: (f?.netProfit ?? 0) < 0 },
        note: t('stockValueFrom'),
      };
    }

    // sales
    const saleRows = sales.filter(x => inP(x.date)).map(x => ({
      label: x.invoiceNo ?? t('sale'),
      sub: [fd(x.date), customers.find(c => c.id === x.customerId)?.name ?? t('cashSaleRow')].filter(Boolean).join(' \u2022 '),
      right: m(x.total),
    }));
    const retRows = returns.filter(r => r.kind === 'sale' && inP(r.date)).map(r => ({
      label: r.returnNo ?? t('ret'),
      sub: fd(r.date),
      right: m(r.amount), neg: true,
    }));
    return {
      ...base,
      title: t('salesDetail'),
      sections: [
        { title: t('totalSales'), rows: saleRows.length ? saleRows : [{ label: t('empty'), right: '' }] },
        { title: t('salesReturnLabel'), rows: retRows.length ? retRows : [{ label: t('empty'), right: '' }] },
      ],
      total: { label: t('netSalesLabel'), value: m(kpiTotal) },
    };
  }, [kind, period.label, period.inPeriod, fin, kpiTotal, collectTotal, dueTotal, payTotal, t, m, fd, lang, sales, returns, cTx, expenses, customers, vendors, bal]);
  return build;
}

/** Detail + Preview + Print for one KPI. Totals come from the card itself. */
/**
 * KPI report sheet.
 *
 * Exactly ONE sheet is mounted. Inside it there are exactly two views -
 * detail and preview - and only one of them is ever rendered at a time, so a
 * report can never appear twice. The layout is fixed header / scrolling body /
 * fixed footer, so long lists scroll instead of stretching the page, and the
 * total plus the actions stay reachable without scrolling.
 */
function KpiDetailModal({ kind, period, fin, kpiTotal, collectTotal, dueTotal, payTotal, onClose }: {
  kind: KpiKind; period: KpiPeriod; fin: PeriodFinance | null;
  kpiTotal: number; collectTotal: number; dueTotal: number; payTotal: number;
  onClose: () => void;
}) {
  const { t } = useApp();
  const build = useKpiReport(kind, period, fin, kpiTotal, collectTotal, dueTotal, payTotal);
  const doc = React.useMemo(build, [build]);
  const [mode, setMode] = useState<'detail' | 'preview'>('detail');
  // Any sheet-level state is discarded when the sheet closes, so reopening
  // always starts from the detail view with no leftovers.
  useEffect(() => { setMode('detail'); }, [kind]);

  const rowCount = doc.sections.reduce((a, sec) => a + sec.rows.length, 0);

  const footer = (
    <View>
      {doc.total ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 }}>
          <Text style={{ fontSize: 16, fontWeight: '700', color: color.text }}>{doc.total.label}</Text>
          <Text style={{ fontSize: 18, fontWeight: '700', color: doc.total.neg ? color.red : color.primary }}>{doc.total.value}</Text>
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', gap: 8 }}>
        {mode === 'detail' ? (
          <>
            <View style={{ flex: 1 }}><Btn kind="ghost" icon={icons.search} label={t('preview')} onPress={() => setMode('preview')} /></View>
            <View style={{ flex: 1 }}><Btn kind="ghost" icon={icons.print} label={t('print')} onPress={() => printReport(doc)} /></View>
            <View style={{ flex: 1 }}><Btn kind="ghost" icon={icons.cancel} label={t('close')} onPress={onClose} /></View>
          </>
        ) : (
          <>
            <View style={{ flex: 1 }}><Btn kind="ghost" icon={icons.back} label={t('back')} onPress={() => setMode('detail')} /></View>
            <View style={{ flex: 1 }}><Btn icon={icons.print} label={t('print')} onPress={() => printReport(doc)} /></View>
          </>
        )}
      </View>
    </View>
  );

  return (
    <DetailShell
      title={mode === 'detail' ? doc.title : `${doc.title} \u2014 ${t('preview')}`}
      onClose={onClose}
      bodyScroll={false}
      maxHeightPct="86%"
      overlay="rgba(0,0,0,0.62)"
      footer={footer}
    >
      {/* the single scrollable region of the sheet */}
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingBottom: 16 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ backgroundColor: color.card, borderRadius: 14, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6 }}>
          <Text style={{ fontSize: 15, fontWeight: '700', color: color.text }}>{SHOP_NAME}</Text>
          <Text style={{ fontSize: 14, color: color.muted }}>{doc.period}</Text>
          {(doc.meta ?? []).map((x, i) => (
            <Text key={i} style={{ fontSize: 13, color: color.muted }}>{`${x.label}: ${x.value}`}</Text>
          ))}
          {mode === 'preview' && rowCount > 0 ? <Muted>{`${rowCount} \u099f\u09be`}</Muted> : null}
        </View>
        <View style={{ height: 10 }} />
        {doc.sections.map((sec, si) => (
          <View key={si} style={{ backgroundColor: color.card, borderRadius: 14, paddingHorizontal: 14, paddingVertical: 4, marginBottom: 10 }}>
            {sec.title ? <SectionHead icon={icons.history}>{sec.title}</SectionHead> : null}
            {sec.rows.map((r, ri) => (
              <Row key={ri} left={r.label} sub={r.sub} right={r.right} neg={r.neg} />
            ))}
          </View>
        ))}
        {doc.note && mode === 'detail' ? <Muted>{doc.note}</Muted> : null}
      </ScrollView>
    </DetailShell>
  );
}

/**
 * The canonical profit breakdown, in shop-friendly words. Every number comes
 * from the backend finance service; nothing here is derived or plugged.
 */
export function ProfitBreakdown({ f, onOpenCogs }: { f: PeriodFinance; onOpenCogs?: () => void }) {
  const { t } = useApp(); const m = useMoney();
  const line = (label: string, value: number, neg?: boolean) => (
    <Row left={label} right={m(value)} neg={neg} />
  );
  const total = (label: string, value: number) => (
    <View style={{ borderTopWidth: 1, borderTopColor: color.line, marginTop: 4, paddingTop: 4 }}>
      <Text style={{ fontSize: 15, fontWeight: '700', color: color.primary, lineHeight: 24 }}>{label}</Text>
      <Text style={{ fontSize: 16, fontWeight: '700', color: value < 0 ? color.red : color.primary, textAlign: 'right' }}>{m(value)}</Text>
    </View>
  );
  return (
    <View>
      {line(t('totalSales'), f.sales)}
      {f.salesReturn ? line(`(${t('salesReturnLabel')})`, f.salesReturn, true) : null}
      {total(t('netSalesLabel'), f.netSales)}
      <View style={{ height: 10 }} />
      {onOpenCogs ? (
        <TouchableOpacity onPress={onOpenCogs}><Row icon={icons.calc} left={t('cogs')} right={m(f.cogs)} neg={f.cogs > 0} /></TouchableOpacity>
      ) : line(t('cogs'), f.cogs, f.cogs > 0)}
      <Muted>{`${t('openingStock')} ${m(f.openingStockValue)} \u2022 (${t('purchase')} ${m(f.purchase)}) \u2022 (${t('purchaseReturnLabel')} ${m(f.purchaseReturn)}) \u2022 (${t('closingStock')} ${m(f.closingStockValue)})`}</Muted>
      <View style={{ height: 10 }} />
      {total(t('grossProfit'), f.grossProfit)}
      {line(`(${t('expense')})`, f.expense, f.expense > 0)}
      {total(t('netProfitLabel'), f.netProfit)}
    </View>
  );
}

export function More({ go }: { go: Nav }) {
  const { t, lang, setLang } = useApp();
  const items = [
    { k: 'products' as const, icon: icons.products },
    { k: 'customers' as const, icon: icons.customers },
    { k: 'vendors' as const, icon: icons.vendors },
    { k: 'stock' as const, icon: icons.stock },
    { k: 'collect' as const, icon: icons.collect },
    { k: 'pay' as const, icon: icons.pay },
    { k: 'trash' as const, icon: icons.del },
    { k: 'ret' as const, r: 'return' as const, icon: icons.ret },
  ];
  return <Screen>
    <RGrid mobile={1} tablet={2} desktop={2}>
      {items.map(it => <Btn key={it.k} kind="ghost" icon={it.icon} label={t(it.k)} onPress={() => go('r' in it ? it.r! : it.k)} />)}
    </RGrid>
    {/* Opening balances and accounts are managed in Bank & Cash, not here. */}
    <Card><SectionHead icon={icons.language}>{t('language')}</SectionHead><View style={{ flexDirection: 'row', gap: 8 }}>
      <View style={{ flex: 1 }}><Btn kind={lang === 'bn' ? 'primary' : 'ghost'} label="বাংলা" onPress={() => setLang('bn')} /></View>
      <View style={{ flex: 1 }}><Btn kind={lang === 'en' ? 'primary' : 'ghost'} label="English" onPress={() => setLang('en')} /></View></View></Card></Screen>;
}

const TRASH_DAYS = 30;
const remainDays = (deletedAt: string) =>
  Math.max(0, TRASH_DAYS - Math.floor((Date.now() - new Date(deletedAt).getTime()) / 86400000));

export function Trash() {
  const { t, lang } = useApp(); const fd = useDateStr(); const n = useNum();
  const [items, setItems] = useState<TrashItem[]>([]);
  const [f, setF] = useState<'all' | TrashItem['kind']>('all');
  const load = async () => {
    try { setItems(await api.trashList()); }
    catch (e) { Alert.alert(e instanceof Error ? e.message : t('invalid')); }
  };
  useEffect(() => { load(); }, []);
  const shown = items.filter(i => f === 'all' || i.kind === f);
  const expired = items.filter(i => remainDays(i.deletedAt) <= 0);
  const kindName = (k: TrashItem['kind']) => (k === 'product' ? t('products') : k === 'customer' ? t('customers') : k === 'vendor' ? t('vendors') : t('expense'));
  const restore = (it: TrashItem) => {
    (async () => {
      try { await api.trashRestore(it.kind, it.id); load(); }
      catch (e) { Alert.alert(e instanceof Error ? e.message : t('invalid')); }
    })();
  };
  const purgeAll = () => Alert.alert(t('sure'), t('purgeExpired'), [{ text: t('cancel') }, {
    text: t('purgeExpired'), onPress: () => {
      (async () => {
        try { await api.trashPurgeExpired(); load(); }
        catch (e) { Alert.alert(e instanceof Error ? e.message : t('invalid')); }
      })();
    },
  }]);
  return (
    <Screen>
      <Card>
        <SectionHead icon={icons.del}>{t('trash')}</SectionHead>
        {expired.length ? <Btn kind="danger" icon={icons.del} label={t('purgeExpired')} onPress={purgeAll} /> : null}
      </Card>
      <Chips
        items={[{ id: 'all', name: t('all') }, { id: 'product', name: t('products') }, { id: 'customer', name: t('customers') }, { id: 'vendor', name: t('vendors') }, { id: 'expense', name: t('expense') }]}
        value={f}
        onPick={id => setF(id as typeof f)}
      />
      <RGrid mobile={1} tablet={2} desktop={3}>
        {shown.length ? shown.map(it => {
          const rem = remainDays(it.deletedAt);
          return (
            <Card key={`${it.kind}:${it.id}`}>
              <Title>{it.name}</Title>
              <Muted>{kindName(it.kind)}</Muted>
              <Row left={t('deletedOn')} right={fd(it.deletedAt.slice(0, 10))} />
              <Row left={rem > 0 ? tp(lang, 'daysLeft', { n: n(rem) }) : t('expired')} right="" />
              <Btn kind="ghost" icon={icons.history} label={t('restore')} onPress={() => restore(it)} />
            </Card>
          );
        }) : <Card><Empty /></Card>}
      </RGrid>
    </Screen>
  );
}

// Return detail + printable receipt.
export function ReturnModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { t } = useApp(); const m = useMoney(); const n = useNum(); const fd = useDateStr();
  const { printReturn, condLabel, reasonLabel } = useInvoice();
  const [d, setD] = useState<ReturnDetail | null>(null);
  useEffect(() => {
    let on = true;
    api.returnDetail(id).then(r => { if (on) setD(r); }).catch(() => {});
    return () => { on = false; };
  }, [id]);
  if (!d) {
    return (
      <DetailShell title={t('ret')} onClose={onClose}>
        <ActivityIndicator size="large" color={color.primary} />
      </DetailShell>
    );
  }
  const isSale = d.kind === 'sale';
  return (
    <DetailShell title={`${isSale ? t('saleReturn') : t('purchaseReturn')} • ${d.returnNo ?? ''}`} onClose={onClose}>
      <Card>
        <Row left={t('returnNo')} right={d.returnNo ?? ''} />
        <Row left={t('origInvoice')} right={d.origInvoiceNo ?? ''} />
        <Row left={t('date')} right={fd(d.date)} />
        <Row left={isSale ? t('customer') : t('vendor')} right={d.party?.name ?? (isSale ? t('cashSale') : '')} />
        {d.party?.mobile ? <Row left={t('mobile')} right={d.party.mobile} /> : null}
      </Card>
      <Card>
        {d.items.map((it, i) => (
          <Row
            key={i}
            left={it.productName}
            sub={`${unitDetail(it.unit, it.enteredQty, it.qtyKg, { kg: t('kg'), small: t('smallBag'), medium: t('mediumBag'), large: t('largeBag'), ton: t('ton') }, n)} • ${condLabel(it.condition)}${it.condition === 'partial' ? ` (${t('goodQty')}: ${n(it.goodKg)}, ${t('dmgQty')}: ${n(it.damagedKg)})` : ''}${it.damageReason ? ` • ${reasonLabel(it.damageReason)}` : ''}${it.note ? ` • ${it.note}` : ''}`}
            right={m(it.amount)}
          />
        ))}
        <Row left={t('returnValue')} right={m(d.totalAmount)} />
        <Row left={t('settleHow')} right={d.settlement === 'refund' ? t('refundMoney') : (isSale ? t('keepCredit') : t('keepVendorCredit'))} />
        {d.settlement === 'refund' ? <Row left={t('paid')} right={m(d.refundAmount)} /> : null}
      </Card>
      <Btn icon={icons.print} label={t('printInvoice')} onPress={() => printReturn(d.id)} />
      <Btn kind="ghost" label={t('close')} onPress={onClose} />
    </DetailShell>
  );
}


type RetLine = {
  lineId: string; productId: string; productName: string;
  origUnit: string; origEntered: number; origKg: number; rate: number;
  bags: { small: number; medium: number; large: number };
  remaining: number;
  checked: boolean; unit: string; qv: string; manual: string;
  cond: 'good' | 'damaged' | 'partial'; good: string; dmg: string;
  reason: string; note: string; source: 'available' | 'damaged';
};

const RET_UNITS = ['kg', 'small', 'medium', 'large', 'ton', 'others'];
const RET_CONDS = ['good', 'damaged', 'partial'];
const RET_REASONS = ['torn', 'wet', 'pest', 'spoiled', 'transport', 'other'];

function MiniChips({ options, value, onPick }: { options: { id: string; label: string }[]; value: string; onPick: (id: string) => void }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 6 }}>
      {options.map(o => (
        <TouchableOpacity key={o.id} onPress={() => onPick(o.id)} style={{ paddingHorizontal: 14, minHeight: 44, justifyContent: 'center', borderRadius: 22, backgroundColor: value === o.id ? color.primary : '#E8EFE9' }}>
          <Text style={{ color: value === o.id ? '#fff' : color.text, fontSize: 15, fontWeight: value === o.id ? '700' : '400' }}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

export function ReturnHome({ focus, onFocusDone, initialKind }: {
  focus?: { kind: 'sale' | 'purchase'; id: string } | null;
  onFocusDone?: () => void;
  /** Sidebar entry that opened this screen (Sales Return / Purchase Return). */
  initialKind?: 'sale' | 'purchase';
}) {
  const { t, products, saveReturn } = useApp();
  const m = useMoney(); const n = useNum(); const fd = useDateStr();
  const { kg } = useUnitLabel();
  const [kind, setKind] = useState<'sale' | 'purchase'>(initialKind ?? 'sale');
  const [invoices, setInvoices] = useState<{ id: string; no: string; date: string; total: number; partyName: string | null; partyMobile: string | null }[]>([]);
  const [iq, setIq] = useState('');
  const [txnId, setTxnId] = useState<string>();
  const [txn, setTxn] = useState<ReturnableTxn | null>(null);
  const [lines, setLines] = useState<RetLine[]>([]);
  const [settlement, setSettlement] = useState<'credit' | 'refund'>('credit');
  // Only asked when money actually moves (a refund), never for a credit memo.
  const [accountId, setAccountId] = useState<string>();
  const [rdate, setRdate] = useState(dhakaToday());
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState<{ returnNo: string; totalAmount: number; id: string } | null>(null);
  const [retView, setRetView] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [formErr, setFormErr] = useState<string | null>(null);
  const { printReturn } = useInvoice();

  const unitName = (u: string) => (u === 'kg' ? kg : u === 'ton' ? t('ton') : u === 'small' ? t('smallBag') : u === 'medium' ? t('mediumBag') : u === 'large' ? t('largeBag') : t('otherUnit'));
  const condName = (c: string) => (c === 'damaged' ? t('damaged') : c === 'partial' ? t('partialDamaged') : t('good'));
  const reasonName = (r: string) => {
    const map: Record<string, string> = { torn: t('dmgTorn'), wet: t('dmgWet'), pest: t('dmgPest'), spoiled: t('dmgSpoiled'), transport: t('dmgTransport'), other: t('exOther') };
    return map[r] ?? r;
  };
  const perBag = (l: RetLine): number => (l.unit === 'small' ? l.bags.small : l.unit === 'medium' ? l.bags.medium : l.unit === 'large' ? l.bags.large : 1000);
  const lineKgOf = (unit: string, qv: string, manual: string, bags: RetLine['bags']): number => {
    if (unit === 'others') return Math.round(parseNum(manual) * 100) / 100;
    const entered = parseNum(qv);
    if (!(entered > 0)) return 0;
    if (unit === 'kg') return Math.round(entered * 100) / 100;
    if (unit === 'ton') return Math.round(entered * 1000 * 100) / 100;
    const per = unit === 'small' ? bags.small : unit === 'medium' ? bags.medium : bags.large;
    return Math.round(entered * per * 100) / 100;
  };
  // ALWAYS the original transaction line's rate (SaleItem.rate /
  // PurchaseItem.rate), for every unit. The product's current price must never
  // be used to value a return against an older document.
  const lineRateOf = (l: RetLine): number => l.rate;

  const pickKind = (k: 'sale' | 'purchase') => {
    setKind(k); setTxn(null); setTxnId(undefined); setLines([]); setSuccess(null); setIq(''); setFormErr(null); setLoadErr(null);
  };

  useEffect(() => {
    let on = true;
    setInvoices([]); setTxnId(undefined); setTxn(null); setLines([]); setIq('');
    api.returnInvoices(kind).then(r => { if (on) setInvoices(r); }).catch(() => {});
    return () => { on = false; };
  }, [kind]);

  const loadTxn = async (id: string) => {
    setTxnId(id);
    setLoadErr(null);
    setFormErr(null);
    try {
      const d = kind === 'sale' ? await api.saleReturnable(id) : await api.purchaseReturnable(id);
      setTxn(d);
      setLines(d.items.map(it => ({
        lineId: it.id, productId: it.productId, productName: it.productName,
        origUnit: it.unit, origEntered: it.enteredQty, origKg: it.qtyKg, rate: it.rate,
        bags: it.bags, remaining: Math.round((it.qtyKg - it.returnedQty) * 100) / 100,
        checked: false, unit: it.unit === 'others' ? 'kg' : it.unit, qv: '', manual: '',
        cond: 'good' as const, good: '', dmg: '',
        reason: '', note: '', source: 'available' as const,
      })));
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : t('invalid'));
    }
  };

  useEffect(() => {
    if (focus) {
      setKind(focus.kind);
      loadTxn(focus.id);
      onFocusDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus]);

  // Coming from the sidebar (Sales Return / Purchase Return) opens that tab
  // directly instead of always starting on Sales Return.
  useEffect(() => {
    if (initialKind) setKind(initialKind);
  }, [initialKind]);

  const upd = (lineId: string, patch: Partial<RetLine>) =>
    setLines(ls => ls.map(l => (l.lineId === lineId ? { ...l, ...patch } : l)));

  const selLines = lines.filter(l => l.checked);
  const lineVal = (l: RetLine): { qtyKg: number; err: string | null } => {
    const qtyKg = l.unit === 'others'
      ? Math.round(parseNum(l.manual) * 100) / 100
      : lineKgOf(l.unit, l.qv, l.manual, l.bags);
    if (!(qtyKg > 0)) return { qtyKg: 0, err: t('invalidAmount') };
    if (l.unit === 'others' && !l.note.trim()) return { qtyKg: 0, err: t('needExpName') };
    if (qtyKg - l.remaining > 0.009) return { qtyKg: 0, err: t('retTooMuch') };
    if (l.cond === 'partial') {
      const g = parseNum(l.good), dg = parseNum(l.dmg);
      if (Math.abs(g + dg - qtyKg) > 0.01) return { qtyKg: 0, err: t('splitMismatch') };
    }
    if (l.cond !== 'good') {
      if (!l.reason) return { qtyKg: 0, err: t('selectType') };
      if (l.reason === 'other' && !l.note.trim()) return { qtyKg: 0, err: t('needExpName') };
    }
    return { qtyKg, err: null };
  };
  const lineAmount = (l: RetLine, qtyKg: number) => Math.round(qtyKg * lineRateOf(l) * 100) / 100;
  const totalValue = Math.round(selLines.reduce((s, l) => {
    const v = lineVal(l);
    return v.err ? s : s + lineAmount(l, v.qtyKg);
  }, 0) * 100) / 100;

  const stockFx = (l: RetLine, qtyKg: number): string => {
    if (kind === 'sale') {
      if (l.cond === 'good') return `+${n(qtyKg)} ${kg}`;
      if (l.cond === 'damaged') return `${t('damagedStock')} +${n(qtyKg)} ${kg}`;
      const g = parseNum(l.good), dg = parseNum(l.dmg);
      return `+${n(g)} ${kg}, ${t('damagedStock')} +${n(dg)} ${kg}`;
    }
    return `-${n(qtyKg)} ${kg}${l.source === 'damaged' ? ` (${t('damagedStock')})` : ''}`;
  };

  const doSubmit = () => {
    if (!txn || busy) return;
    setBusy(true);
    setConfirm(false);
    (async () => {
      try {
        const r = await saveReturn({
          kind,
          saleId: kind === 'sale' ? txn.id : undefined,
          purchaseId: kind === 'purchase' ? txn.id : undefined,
          lines: selLines.map(l => {
            const v = lineVal(l);
            const goodKg = l.cond === 'good' ? v.qtyKg : l.cond === 'damaged' ? 0 : Math.round(parseNum(l.good) * 100) / 100;
            const damagedKg = l.cond === 'damaged' ? v.qtyKg : l.cond === 'partial' ? Math.round(parseNum(l.dmg) * 100) / 100 : 0;
            return {
              // Always pass the original line reference, including for the
              // 'others' unit: it is how the backend finds the historical rate
              // to value this return at.
              ...(l.lineId ? (kind === 'sale' ? { saleItemId: l.lineId } : { purchaseItemId: l.lineId }) : {}),
              productId: l.productId, unit: l.unit,
              enteredQty: l.unit === 'others' ? v.qtyKg : parseNum(l.qv),
              manualKg: l.unit === 'others' ? v.qtyKg : undefined,
              condition: l.cond, goodKg, damagedKg,
              damageReason: l.cond === 'good' ? undefined : l.reason || undefined,
              note: l.note.trim() || undefined,
              source: l.source,
            };
          }),
          settlement, accountId: settlement === 'refund' ? accountId : undefined, date: rdate || today(),
        });
        setSuccess({ returnNo: r.returnNo ?? '', totalAmount: r.totalAmount, id: r.id });
        setTxn(null); setTxnId(undefined); setLines([]);
      } catch (e) {
        setFormErr(e instanceof Error ? e.message : t('invalid'));
      } finally {
        setBusy(false);
      }
    })();
  };

  const tryConfirm = () => {
    if (!txn || !selLines.length) return setFormErr(t('invalid'));
    if (settlement === 'refund' && !accountId) return setFormErr(t('needAccount'));
    for (const l of selLines) {
      const e = lineVal(l);
      if (e.err) return setFormErr(e.err);
      if (kind === 'purchase') {
        const p = products.find(x => x.id === l.productId);
        const avail = l.source === 'damaged' ? (p?.damagedQty ?? 0) : (p?.qty ?? 0);
        if (e.qtyKg - avail > 0.009) return setFormErr(`${t('outOfStock')}: ${l.productName}`);
      }
    }
    setFormErr(null);
    setConfirm(true);
  };

  return (
    <Screen>
      <Card>
        <SectionHead icon={icons.del}>{t('ret')}</SectionHead>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <View style={{ flex: 1 }}><Btn kind={kind === 'sale' ? 'primary' : 'ghost'} label={t('saleReturn')} onPress={() => pickKind('sale')} /></View>
          <View style={{ flex: 1 }}><Btn kind={kind === 'purchase' ? 'primary' : 'ghost'} label={t('purchaseReturn')} onPress={() => pickKind('purchase')} /></View>
        </View>
      </Card>
      <Card>
        <Muted>{t('searchInvoice')}</Muted>
        <SearchDropdown
          items={invoices.map(v => ({ ...v, name: v.no }))}
          query={iq}
          setQuery={setIq}
          placeholder={t('searchInvoice')}
          match={(it: any, qq: string) => {
            const nq = qq.trim().toLowerCase();
            return it.no.toLowerCase().includes(nq)
              || (it.partyName ?? '').toLowerCase().includes(nq)
              || (it.partyMobile ?? '').toLowerCase().includes(nq);
          }}
          subOf={(it: any) => `${it.partyName ?? ''} • ${fd(it.date)}`}
          emptyText={t('noResult')}
          onSelect={(it: any) => loadTxn(it.id)}
        />
        {txn ? (
          <View>
            <Row left={t('origInvoice')} right={txn.invoiceNo ?? ''} />
            <Row left={kind === 'sale' ? t('customer') : t('vendor')} right={(kind === 'sale' ? txn.customer?.name : txn.vendor?.name) ?? ''} />
          </View>
        ) : null}
        {loadErr ? <Text style={{ color: color.red, fontSize: 15, marginTop: 8 }}>{loadErr}</Text> : null}
      </Card>
      {txn ? (
        <View>
          {lines.map(l => {
            const v = lineVal(l);
            const qtyKg = v.qtyKg;
            return (
              <Card key={l.lineId}>
                <TouchableOpacity onPress={() => upd(l.lineId, { checked: !l.checked })} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <View style={{ minHeight: 28, minWidth: 28, borderRadius: 8, borderWidth: 1.5, borderColor: color.primary, backgroundColor: l.checked ? color.primary : '#fff', alignItems: 'center', justifyContent: 'center' }}>
                    {l.checked ? <AppIcon name={icons.done} size={18} iconColor="#fff" /> : null}
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 17, fontWeight: '700', color: color.text }}>{l.productName}</Text>
                    <Muted>{n(l.origEntered)} {unitName(l.origUnit)} = {n(l.origKg)} {kg} • {m(l.rate)}/{kg}</Muted>
                    <Muted>{t('alreadyReturned')}: {n(l.origKg - l.remaining)} {kg} • {t('remaining')}: {n(l.remaining)} {kg}</Muted>
                  </View>
                </TouchableOpacity>
                {l.checked ? (
                  <View style={{ marginTop: 6 }}>
                    <MiniChips options={RET_UNITS.map(u => ({ id: u, label: unitName(u) }))} value={l.unit} onPick={u => upd(l.lineId, { unit: u, qv: '', manual: '' })} />
                    {l.unit === 'others' ? (
                      <View>
                        <Field label={t('descNote')} value={l.note} onChange={x => upd(l.lineId, { note: x })} />
                        <Field label={t('actualKg')} value={l.manual} onChange={x => upd(l.lineId, { manual: x.replace(/[^0-9.]/g, '') })} num />
                      </View>
                    ) : (
                      <QtyInput unit={l.unit as BagUnit} value={l.qv} onChange={x => upd(l.lineId, { qv: x })} />
                    )}
                    {l.unit !== 'kg' && l.unit !== 'others' ? <Muted>{n(perBag(l))} {kg} / {unitName(l.unit)}</Muted> : null}
                    <Muted>{t('cond')}</Muted>
                    <MiniChips options={[{ id: 'good', label: t('good') }, { id: 'damaged', label: t('damaged') }, { id: 'partial', label: t('partialDamaged') }]} value={l.cond} onPick={x => upd(l.lineId, { cond: x as RetLine['cond'] })} />
                    {l.cond === 'partial' ? (
                      <FormGrid>
                        <Field label={`${t('goodQty')} (${kg})`} value={l.good} onChange={x => upd(l.lineId, { good: x.replace(/[^0-9.]/g, '') })} num />
                        <Field label={`${t('dmgQty')} (${kg})`} value={l.dmg} onChange={x => upd(l.lineId, { dmg: x.replace(/[^0-9.]/g, '') })} num />
                      </FormGrid>
                    ) : null}
                    {l.cond !== 'good' ? (
                      <View>
                        <Muted>{t('dmgReason')}</Muted>
                        <MiniChips
                          options={[{ id: 'torn', label: t('dmgTorn') }, { id: 'wet', label: t('dmgWet') }, { id: 'pest', label: t('dmgPest') }, { id: 'spoiled', label: t('dmgSpoiled') }, { id: 'transport', label: t('dmgTransport') }, { id: 'other', label: t('exOther') }]}
                          value={l.reason}
                          onPick={x => upd(l.lineId, { reason: x })}
                        />
                        {l.reason === 'other' && l.unit !== 'others' ? <Field label={t('note')} value={l.note} onChange={x => upd(l.lineId, { note: x })} /> : null}
                      </View>
                    ) : null}
                    {kind === 'purchase' ? (
                      <View>
                        <Muted>{t('fromStock')}</Muted>
                        <MiniChips
                          options={[{ id: 'available', label: t('currentStock') }, { id: 'damaged', label: t('damagedStock') }]}
                          value={l.source}
                          onPick={x => upd(l.lineId, { source: x as RetLine['source'] })}
                        />
                      </View>
                    ) : null}
                    {qtyKg > 0 ? <Text style={{ fontSize: 16, fontWeight: '700', color: color.primary }}>{t('totalWeight')}: {n(qtyKg)} {kg} = {m(qtyKg * lineRateOf(l))}</Text> : null}
                  </View>
                ) : null}
              </Card>
            );
          })}
          <Card>
            <Row left={t('returnValue')} right={m(totalValue)} />
            {formErr ? <Text style={{ color: color.red, fontSize: 15, marginVertical: 8 }}>{formErr}</Text> : null}
            <MiniChips
              options={kind === 'sale'
                ? [{ id: 'refund', label: t('refundMoney') }, { id: 'credit', label: t('keepCredit') }]
                : [{ id: 'refund', label: t('refundMoney') }, { id: 'credit', label: t('keepVendorCredit') }]}
              value={settlement}
              onPick={x => { setSettlement(x as 'credit' | 'refund'); if (x === 'credit') setAccountId(undefined); }}
            />
            {settlement === 'refund' ? <AccountPicker accountId={accountId} onPick={setAccountId} label={t('paymentAccount')} required /> : null}
            <DateField label={t('date')} value={rdate} onChange={setRdate} allowPast={false} />
            <Btn icon={icons.save} label={t('completeReturn')} onPress={tryConfirm} />
          </Card>
        </View>
      ) : null}
      {confirm && txn ? (
        <DetailShell title={t('confirmReturn')} onClose={() => setConfirm(false)}>
          <Card>
            <Row left={t('origInvoice')} right={txn.invoiceNo ?? ''} />
            <Row left={kind === 'sale' ? t('customer') : t('vendor')} right={(kind === 'sale' ? txn.customer?.name : txn.vendor?.name) ?? ''} />
            {selLines.map(l => {
              const v = lineVal(l);
              return <Row key={l.lineId} left={l.productName} sub={`${unitName(l.unit)} × ${l.unit === 'others' ? n(v.qtyKg) : l.qv} = ${n(v.qtyKg)} ${kg} • ${condName(l.cond)}`} right={m(v.qtyKg * lineRateOf(l))} />;
            })}
            <Row left={t('returnValue')} right={m(totalValue)} />
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
              <View style={{ flex: 1 }}><Btn kind="ghost" label={t('cancel')} onPress={() => setConfirm(false)} /></View>
              <View style={{ flex: 1 }}><Btn icon={icons.save} label={t('completeReturn')} onPress={doSubmit} /></View>
            </View>
          </Card>
        </DetailShell>
      ) : null}
      {success ? (
        <DetailShell title="" onClose={() => setSuccess(null)}>
          <Card>
            <View style={{ alignItems: 'center', marginBottom: 8 }}>
              <AppIcon name={icons.done} size={44} iconColor={color.primary} />
            </View>
            <Text style={{ fontSize: 20, fontWeight: '700', color: color.text, textAlign: 'center', marginBottom: 12 }}>
              {kind === 'sale' ? t('saleReturnDone') : t('purchaseReturnDone')}
            </Text>
            <Row left={t('returnNo')} right={success.returnNo} />
            <Row left={t('returnValue')} right={m(success.totalAmount)} />
          </Card>
          <Btn icon={icons.print} label={t('viewReceipt')} onPress={() => setRetView(success.id)} />
          <Btn kind="ghost" icon={icons.print} label={t('printInvoice')} onPress={() => printReturn(success.id)} />
          <Btn kind="ghost" label={t('close')} onPress={() => setSuccess(null)} />
        </DetailShell>
      ) : null}
      {retView ? <ReturnModal id={retView} onClose={() => setRetView(null)} /> : null}
    </Screen>
  );
}
