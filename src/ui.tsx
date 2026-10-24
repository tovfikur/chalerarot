import React, { ReactNode, useState, useMemo } from 'react';
import { View, Text, TextInput, TouchableOpacity, Pressable, ScrollView, StyleSheet, useWindowDimensions, Platform } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useApp } from './store';
import type { Key } from './i18n';
import { MONEY_METHODS, type AccountType, type MoneyAccountRow, type MoneyMethod } from './api';
import { toBnDigits } from './bn';
import { AppIcon, icons } from './icons';
import { CONTENT_MAX, contentPadding, useBreakpoint, useFs } from './responsive';

type IconName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

export const color = {
  bg: '#F0F6FC', // Ultra-light luminous icy azure pearl background
  card: '#FFFFFF',
  primary: '#1c70b9', // Vibrant Royal Azure Blue
  primaryDark: '#135591',
  primaryLight: '#E0F0FE', // Light flashy sky tint
  primaryGlow: 'rgba(28, 112, 185, 0.25)',
  text: '#0F1E36', // Crisp slate navy
  muted: '#5B728F', // Refined slate steel
  red: '#EF4444',
  green: '#10B981',
  amber: '#F59E0B',
  purple: '#8B5CF6',
  cyan: '#06B6D4',
  line: '#D2E3F3', // Soft crisp divider
};

// Central number localization (display only — state/API stay numeric).
// bn-BD digit output is produced with an explicit map so it works even
// where the runtime lacks full ICU data; en keeps existing formatting.
export { toBnDigits } from './bn';
const grouped = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const fmtNum = (n: number, bn: boolean) => {
  if (!Number.isFinite(n)) return '-';
  const s = grouped(n);
  return bn ? toBnDigits(s) : s;
};
export const useMoney = () => {
  const { lang } = useApp();
  // Sign goes in front of the currency symbol: -৳1,255 (not ৳-1,255).
  return (n: number) => { const v = Math.round(n); return (v < 0 ? '-' : '') + '৳' + fmtNum(Math.abs(v), lang === 'bn'); };
};
// Quantities/weights/stock (keeps decimals, e.g. 25.5 → ২৫.৫).
export const useNum = () => { const { lang } = useApp(); const bn = lang === 'bn'; return (n: number) => fmtNum(n, bn); };
// Display dates only (YYYY-MM-DD → digit-localized). Stored value unchanged.
export const useDateStr = () => { const { lang } = useApp(); return (d?: string) => (!d ? '-' : lang === 'bn' ? toBnDigits(d) : d); };

export const Card = ({ children, style }: { children: ReactNode; style?: object }) => <View style={[s.card, style]}>{children}</View>;
export const Title = ({ children }: { children: ReactNode }) => {
  const fs = useFs(20, 18);
  return <Text style={[s.title, { fontSize: fs, lineHeight: fs + 10 }]}>{children}</Text>;
};
export const SectionHead = ({ icon, children }: { icon?: IconName; children: ReactNode }) => {
  const fs = useFs(20, 18);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 }}>
      {icon ? <MaterialCommunityIcons name={icon} size={22} color={color.primary} /> : null}
      <Text style={[s.title, { marginBottom: 0, fontSize: fs, lineHeight: fs + 10 }]}>{children}</Text>
    </View>
  );
};
export const Muted = ({ children }: { children: ReactNode }) => {
  const fs = useFs(14, 13);
  return <Text style={[s.muted, { fontSize: fs }]}>{children}</Text>;
};
export const Btn = ({ label, onPress, kind = 'primary', icon, testID }: { label: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; icon?: IconName; testID?: string }) => {
  const fs = useFs(17, 15);
  return (
    <TouchableOpacity onPress={onPress} testID={testID} style={[s.btn, kind === 'ghost' && s.ghost, kind === 'danger' && s.dangerBtn]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        {icon ? <MaterialCommunityIcons name={icon} size={20} color={kind === 'ghost' ? '#1c70b9' : '#fff'} /> : null}
        <Text style={[s.btnT, kind === 'ghost' && { color: '#0F2B48' }, { fontSize: fs }]}>{label}</Text>
      </View>
    </TouchableOpacity>
  );
};
export const Field = ({ label, value, onChange, num, accessibilityLabel }: { label: string; value: string; onChange: (v: string) => void; num?: boolean; accessibilityLabel?: string }) => {
  const fs = useFs(17, 15);
  return (
    <View style={{ marginBottom: 10 }}>
      <Muted>{label}</Muted>
      <TextInput value={value} onChangeText={onChange} accessibilityLabel={accessibilityLabel ?? label} keyboardType={num ? 'numeric' : 'default'} inputMode={num ? 'decimal' : undefined} style={[s.input, { fontSize: fs }]} />
    </View>
  );
};
export function Chips<T extends { id: string; name: string }>({ items, value, onPick }: { items: T[]; value?: string; onPick: (id: string) => void }) {
  const fs = useFs(15, 14);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 6 }}>
      {items.map(i => (
        <TouchableOpacity key={i.id} onPress={() => onPick(i.id)} style={[s.chip, value === i.id && { backgroundColor: color.primary }]}>
          <Text style={{ color: value === i.id ? '#fff' : color.text, fontSize: fs }}>{i.name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}
const METHOD_ICON: Record<AccountType, IconName> = {
  cash: icons.cash, bkash: icons.bkash, nagad: icons.nagad, bank: icons.bank, rocket: icons.nagad,
};
const METHOD_KEY: Record<AccountType, Key> = {
  cash: 'mCash', bkash: 'mBkash', nagad: 'mNagad', bank: 'mBank', rocket: 'mRocket',
};
export const ACCOUNT_TYPES: AccountType[] = ['cash', 'bank'];
export const methodName = (m: string, t: (k: Key) => string) => t(METHOD_KEY[m as AccountType] ?? 'mCash');
export const methodIcon = (m?: string): IconName => (m && METHOD_ICON[m as AccountType]) || icons.accounts;

/**
 * Money account picker used everywhere money actually moves.
 * Step 1 picks the account TYPE. If that type has exactly one active account
 * it is chosen automatically; with several accounts the user picks the exact
 * one. Nothing here is accounting jargon.
 */
export function AccountPicker({ accountId, onPick, label, required }: {
  accountId?: string; onPick: (id: string) => void; label?: string; required?: boolean;
}) {
  const { t, moneyAccounts } = useApp();
  const fs = useFs(15, 14);
  const active = moneyAccounts.filter(a => a.active);
  const selected = active.find(a => a.id === accountId);
  const byType = (type: string) => active.filter(a => a.type === type);
  const types = ACCOUNT_TYPES.filter(type => byType(type).length > 0);
  const [openType, setOpenType] = useState<string | null>(null);
  const expanded = openType ?? (selected && byType(selected.type).length > 1 ? selected.type : null);
  if (!active.length) return <Muted>{t('noMoneyAccountYet')}</Muted>;
  const pickType = (type: string) => {
    const rows = byType(type);
    if (rows.length === 1) { onPick(rows[0].id); setOpenType(null); return; }
    setOpenType(type === expanded ? null : type);
  };
  const chip = (key: string, name: string, icon: IconName, on: boolean, onPress: () => void) => (
    <TouchableOpacity key={key} onPress={onPress} accessibilityRole="button" accessibilityState={{ selected: on }}
      style={[s.chip, { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14 }, on && { backgroundColor: color.primary }]}>
      <MaterialCommunityIcons name={icon} size={fs + 4} color={on ? '#fff' : color.text} />
      <Text style={{ color: on ? '#fff' : color.text, fontSize: fs, fontWeight: on ? '700' : '500' }}>{name}</Text>
    </TouchableOpacity>
  );
  return (
    <View style={{ marginBottom: 10 }}>
      {label ? <Muted>{label}{required ? ' *' : ''}</Muted> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
        {types.map(type => {
          const rows = byType(type);
          const on = selected?.type === type;
          return chip(`t-${type}`, t(METHOD_KEY[type]), METHOD_ICON[type], on, () => pickType(type));
        })}
      </View>
      {expanded && byType(expanded).length > 1 ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 8, paddingLeft: 8, borderLeftWidth: 2, borderLeftColor: color.line }}>
          {byType(expanded).map(a => chip(`a-${a.id}`, a.name, icons.accounts, a.id === accountId, () => onPick(a.id)))}
        </View>
      ) : null}
    </View>
  );
}

/** Account name lookup for read-only rows (reports, history). */
export function useAccountName() {
  const { moneyAccounts } = useApp();
  return (id?: string) => moneyAccounts.find(a => a.id === id)?.name ?? '';
}

/** Shared payment-method picker: Cash / bKash / Nagad / Bank. */
export function MethodChips({ value, onPick, label }: { value?: MoneyMethod; onPick: (m: MoneyMethod) => void; label?: string }) {
  const { t } = useApp();
  const fs = useFs(15, 14);
  return (
    <View style={{ marginBottom: 10 }}>
      {label ? <Muted>{label}</Muted> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', marginTop: 6 }}>
        {MONEY_METHODS.map(m => {
          const on = value === m;
          return (
            <TouchableOpacity
              key={m}
              onPress={() => onPick(m)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              style={[s.chip, { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14 }, on && { backgroundColor: color.primary }]}
            >
              <MaterialCommunityIcons name={METHOD_ICON[m]} size={fs + 4} color={on ? '#fff' : color.text} />
              <Text style={{ color: on ? '#fff' : color.text, fontSize: fs, fontWeight: on ? '700' : '500' }}>{t(METHOD_KEY[m])}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

export const Row = ({ left, right, sub, neg, icon }: { left: string; right?: string; sub?: string; neg?: boolean; icon?: IconName }) => {
  const fs = useFs(16, 14);
  return (
    <View style={s.row}>
      {icon ? <MaterialCommunityIcons name={icon} size={20} color={color.muted} style={{ marginRight: 10 }} /> : null}
      <View style={{ flex: 1 }}><Text style={[s.rowT, { fontSize: fs }]}>{left}</Text>{sub ? <Muted>{sub}</Muted> : null}</View>
      {right ? <Text style={[s.rowT, { fontSize: fs, color: neg ? color.red : color.primary }]}>{right}</Text> : null}
    </View>
  );
};
export const Empty = () => { const { t } = useApp(); return <Text style={[s.muted, { textAlign: 'center', padding: 24 }]}>{t('empty')}</Text>; };
// Executive Skeuomorphic Page Header (shared across all pages)
export const PageHeader = ({
  title,
  subtitle,
  icon,
  liveTag,
  onBack,
  actions,
}: {
  title: string;
  subtitle?: string;
  icon?: any;
  liveTag?: string;
  onBack?: () => void;
  actions?: ReactNode;
}) => {
  return (
    <View style={s.pageHeaderBar}>
      <View style={s.pageHeaderGloss} pointerEvents="none" />
      <View style={s.pageHeaderLeft}>
        {onBack ? (
          <TouchableOpacity onPress={onBack} style={s.pageHeaderBackBtn} accessibilityLabel="Back">
            <AppIcon name={icons.back} size={20} iconColor="#FFFFFF" />
          </TouchableOpacity>
        ) : null}
        {icon ? (
          <View style={s.pageHeaderIconBadge}>
            <AppIcon name={icon} size={22} iconColor="#FFFFFF" />
          </View>
        ) : null}
        <View style={{ flexShrink: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <Text style={s.pageHeaderTitle}>{title}</Text>
            {liveTag ? (
              <View style={s.pageHeaderLiveTag}>
                <View style={s.pageHeaderLiveDot} />
                <Text style={s.pageHeaderLiveText}>{liveTag}</Text>
              </View>
            ) : null}
          </View>
          {subtitle ? <Text style={s.pageHeaderSub}>{subtitle}</Text> : null}
        </View>
      </View>
      {actions ? <View style={s.pageHeaderRight}>{actions}</View> : null}
    </View>
  );
};

// List page header shared by Customers / Vendors / Bank / Trash etc.
export const ListPageHeader = ({
  title,
  subtitle,
  icon = icons.customers,
  addLabel,
  onAdd,
  badge = 'সক্রিয়',
  extraActions,
}: {
  title: string;
  subtitle?: string;
  icon?: any;
  addLabel?: string;
  onAdd?: () => void;
  badge?: string;
  extraActions?: ReactNode;
}) => {
  return (
    <PageHeader
      title={title}
      subtitle={subtitle}
      icon={icon}
      liveTag={badge}
      actions={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {extraActions}
          {onAdd && addLabel ? (
            <TouchableOpacity
              onPress={onAdd}
              testID="list-page-add"
              style={s.pageHeaderAddBtn}
              activeOpacity={0.85}
            >
              <AppIcon name={icons.plus} size={18} iconColor="#FFFFFF" />
              <Text style={s.pageHeaderAddBtnText}>{addLabel}</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      }
    />
  );
};
export type TableColumn<T> = {
  key: string;
  label: string;
  /** Share of the row width. Amounts usually use a small fixed flex. */
  flex?: number;
  align?: 'left' | 'right';
  /** Provide to make the column sortable (client side, no refetch). */
  sort?: (row: T) => string | number;
  /** `fs` is the resolved row font size, so columns stay typographically even. */
  render: (row: T, fs: number) => ReactNode;
};

export type TableSort = { key: string; dir: 'asc' | 'desc' };

/**
 * Desktop list/table (Odoo-style) shared by Customers / Vendors.
 *
 * - full-width rows with subtle separators, sticky header while the page scrolls
 * - compact rows with hover + selected feedback, whole row clickable
 * - optional client-side sorting per column; no data fetching happens here
 * Presentation only: every value is rendered by the caller, so each screen keeps
 * using its own canonical totals.
 */
export function ListTable<T>({
  columns,
  rows,
  rowKey,
  onRowPress,
  selectedKey,
  empty,
  sort: sortProp,
  onSortChange,
}: {
  columns: TableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowPress?: (row: T) => void;
  selectedKey?: string | null;
  empty?: ReactNode;
  /** Lift the sort state out so a list that unmounts (detail view) can keep it. */
  sort?: TableSort | null;
  onSortChange?: (s: TableSort | null) => void;
}) {
  const fs = useFs(15, 14);
  const [ownSort, setOwnSort] = useState<TableSort | null>(null);
  const sort = sortProp === undefined ? ownSort : sortProp;
  const setSort = (next: TableSort | null) => { if (onSortChange) onSortChange(next); else setOwnSort(next); };
  const sorted = useMemo(() => {
    const col = sort ? columns.find(c => c.key === sort.key) : undefined;
    if (!col?.sort) return rows;
    const dir = sort!.dir === 'asc' ? 1 : -1;
    // Copy first: the caller's list must not be reordered in place.
    return [...rows].sort((a, b) => {
      const av = col.sort!(a), bv = col.sort!(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sort, columns]);
  const tap = (k: string) => setSort(sort?.key === k ? (sort?.dir === 'asc' ? { key: k, dir: 'desc' } : null) : { key: k, dir: 'asc' });
  const cell = (c: TableColumn<T>, row: T, header: boolean) => {
    const right = c.align === 'right';
    return (
      <View key={c.key} style={{ flex: c.flex ?? 1, alignItems: right ? 'flex-end' : 'flex-start', paddingHorizontal: 8 }}>
        {header ? (
          <Pressable
            onPress={c.sort ? () => tap(c.key) : undefined}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: right ? 'flex-end' : 'flex-start', ...(c.sort ? { cursor: 'pointer' } : null) }}
          >
            <Text style={{ fontSize: fs - 1, fontWeight: '700', color: color.muted }}>{c.label}</Text>
            {c.sort && sort?.key === c.key ? (
              <Text style={{ fontSize: fs - 2, color: color.primary, fontWeight: '700' }}>{sort.dir === 'asc' ? '\u2191' : '\u2193'}</Text>
            ) : null}
          </Pressable>
        ) : c.render(row, fs)}
      </View>
    );
  };
  return (
    <View style={{ backgroundColor: color.card, borderRadius: 16, borderWidth: 1, borderColor: color.line, overflow: 'hidden' }}>
      <View
        style={{
          flexDirection: 'row', alignItems: 'center', minHeight: 44, paddingHorizontal: 4,
          backgroundColor: color.card, borderBottomWidth: 1.5, borderBottomColor: color.line,
          // Desktop/web only: keeps the header visible while the rows scroll,
          // without adding a second scroll container.
          position: 'sticky', top: 0, zIndex: 3,
        } as any}
      >
        {columns.map(c => cell(c, null as T, true))}
      </View>
      {sorted.length ? sorted.map(row => (
        <RowPressable key={rowKey(row)} row={row} selected={selectedKey === rowKey(row)} onPress={onRowPress} columns={columns} />
      )) : (empty ?? <Empty />)}
    </View>
  );
}

/** One table row: compact, hoverable, whole-row tap target. */
function RowPressable<T>({ row, selected, onPress, columns }: { row: T; selected: boolean; onPress?: (row: T) => void; columns: TableColumn<T>[] }) {
  const fs = useFs(15, 14);
  const [hover, setHover] = useState(false);
  return (
    <Pressable
      onPress={onPress ? () => onPress(row) : undefined}
      onHoverIn={() => setHover(true)}
      onHoverOut={() => setHover(false)}
      accessibilityRole={onPress ? 'button' : undefined}
      style={({ pressed }) => ({
        flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: 4,
        borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: color.line,
        backgroundColor: selected ? '#E8EFE9' : pressed || hover ? '#F1F7F3' : color.card,
        ...(onPress ? { cursor: 'pointer' } : null),
      })}
    >
      {columns.map(c => (
        <View key={c.key} style={{ flex: c.flex ?? 1, alignItems: c.align === 'right' ? 'flex-end' : 'flex-start', paddingHorizontal: 8, justifyContent: 'center' }}>
          {c.render(row, fs)}
        </View>
      ))}
    </Pressable>
  );
}

/**
 * Page shell. The optional scroll props let a screen that swaps its own body
 * (list -> detail) remember where the list was scrolled to and come back to it.
 */
export const Screen = ({ children, maxWidth, scrollRef, onScrollY }: {
  children: ReactNode; maxWidth?: number;
  scrollRef?: React.Ref<ScrollView>;
  onScrollY?: (y: number) => void;
}) => {
  const { width } = useWindowDimensions();
  const pad = contentPadding(width);
  return (
    <ScrollView
      ref={scrollRef}
      onScroll={onScrollY ? (e: { nativeEvent: { contentOffset: { y: number } } }) => onScrollY(e.nativeEvent.contentOffset.y) : undefined}
      scrollEventThrottle={onScrollY ? 32 : undefined}
      style={{ flex: 1, backgroundColor: color.bg }}
      contentContainerStyle={{ padding: pad, paddingBottom: 40 }}
      keyboardShouldPersistTaps="handled">
      <View style={{ width: '100%', ...(maxWidth ? { maxWidth, alignSelf: 'center' } : {}) }}>{children}</View>
    </ScrollView>
  );
};

const s = StyleSheet.create({
  card: {
    backgroundColor: color.card,
    borderRadius: 16,
    padding: 16,
    marginBottom: 14,
    borderWidth: 1.5,
    borderColor: '#D8E7F5',
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 8px 24px rgba(28, 112, 185, 0.08), 0 2px 6px rgba(0, 0, 0, 0.03), inset 0 1px 0 #FFFFFF',
    } as any : {
      elevation: 3,
      shadowColor: '#1c70b9',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
    }),
  },
  title: { fontSize: 20, fontWeight: '700', color: color.text, marginBottom: 8, lineHeight: 30 },
  muted: { fontSize: 14, color: color.muted, lineHeight: 22 },
  btn: {
    backgroundColor: color.primary,
    borderRadius: 14,
    minHeight: 50,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    marginVertical: 4,
    borderBottomWidth: 3.5,
    borderBottomColor: '#124e82',
    borderTopWidth: 1,
    borderTopColor: '#5faef2',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(180deg, #2b91e8 0%, #1c70b9 52%, #145994 100%)',
      boxShadow: '0 6px 16px rgba(28, 112, 185, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.45)',
      cursor: 'pointer',
    } as any : {}),
  },
  ghost: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
    borderBottomWidth: 3,
    borderBottomColor: '#1c70b9',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'none',
      boxShadow: '0 3px 10px rgba(28, 112, 185, 0.12), inset 0 1px 0 #FFFFFF',
      cursor: 'pointer',
    } as any : {}),
  },
  dangerBtn: {
    backgroundColor: color.red,
    borderBottomWidth: 3.5,
    borderBottomColor: '#991B1B',
    borderTopWidth: 1,
    borderTopColor: '#FCA5A5',
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(180deg, #F43F5E 0%, #E11D48 52%, #BE123C 100%)',
      boxShadow: '0 6px 16px rgba(225, 29, 72, 0.35), inset 0 1px 1px rgba(255, 255, 255, 0.45)',
      cursor: 'pointer',
    } as any : {}),
  },
  btnT: { color: '#fff', fontSize: 17, fontWeight: '700' },
  input: {
    borderWidth: 1.5,
    borderColor: '#CCE0F2',
    borderRadius: 12,
    minHeight: 46,
    paddingHorizontal: 12,
    fontSize: 16,
    backgroundColor: '#F8FAFD',
    color: color.text,
    ...(Platform.OS === 'web' ? {
      boxShadow: 'inset 0 2px 4px rgba(28, 112, 185, 0.05)',
      outlineStyle: 'none',
    } as any : {}),
  },
  chip: {
    paddingHorizontal: 16,
    minHeight: 42,
    justifyContent: 'center',
    borderRadius: 21,
    backgroundColor: '#E4F1FD',
    borderWidth: 1,
    borderColor: '#CCE2F7',
    marginRight: 8,
    ...(Platform.OS === 'web' ? {
      boxShadow: '0 2px 5px rgba(28, 112, 185, 0.08), inset 0 1px 0 #FFFFFF',
      cursor: 'pointer',
    } as any : {}),
  },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: color.line },
  rowT: { fontSize: 16, fontWeight: '600', color: color.text, lineHeight: 24 },
  pageHeaderBar: {
    backgroundColor: '#1c70b9',
    borderRadius: 16,
    paddingHorizontal: 18,
    paddingVertical: 14,
    marginBottom: 16,
    borderTopWidth: 1.5,
    borderTopColor: '#60b0f4',
    borderBottomWidth: 3.5,
    borderBottomColor: '#124c7e',
    overflow: 'hidden',
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 12,
    ...(Platform.OS === 'web' ? {
      backgroundImage: 'linear-gradient(135deg, #2592ed 0%, #1c70b9 52%, #12518e 100%)',
      boxShadow: '0 8px 22px rgba(28, 112, 185, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.45)',
    } as any : {
      elevation: 4,
    }),
  },
  pageHeaderGloss: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  pageHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    zIndex: 2,
    flex: 1,
    minWidth: 240,
  },
  pageHeaderBackBtn: {
    width: 36,
    height: 36,
    borderRadius: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.4)',
    borderBottomWidth: 2,
    borderBottomColor: 'rgba(0, 0, 0, 0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    ...(Platform.OS === 'web' ? ({ cursor: 'pointer' } as any) : {}),
  },
  pageHeaderIconBadge: {
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
  pageHeaderTitle: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: '800',
    letterSpacing: 0.3,
  },
  pageHeaderLiveTag: {
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
  pageHeaderLiveDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#86EFAC',
  },
  pageHeaderLiveText: {
    color: '#FFFFFF',
    fontSize: 11,
    fontWeight: '800',
  },
  pageHeaderSub: {
    color: '#DCEBFA',
    fontSize: 12.5,
    fontWeight: '500',
    marginTop: 2,
  },
  pageHeaderRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 2,
    flexWrap: 'wrap',
  },
  pageHeaderAddBtn: {
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
  pageHeaderAddBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '800',
  },
});
