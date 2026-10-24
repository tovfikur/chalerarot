import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView } from 'react-native';
import { useApp, Product, Party } from './store';
import { Chips, Muted, color } from './ui';
import { useFs } from './responsive';
import { AppIcon, icons } from './icons';

// Bangla-safe case-insensitive normalize (toLowerCase is a no-op for Bengali script).
export const norm = (s: string) => (s ?? '').toLowerCase().trim();

export const matchProduct = (p: Product, q: string) => {
  const nq = norm(q);
  if (!nq) return true;
  return norm(p.name).includes(nq) || norm(p.id).includes(nq);
};

export const matchParty = (p: Party, q: string) => {
  const nq = norm(q);
  if (!nq) return true;
  return norm(p.name).includes(nq) || norm(p.mobile).includes(nq);
};

export function NoResult() {
  const { t } = useApp();
  const fs = useFs(15, 13);
  return <Text style={{ textAlign: 'center', padding: 16, color: color.muted, fontSize: fs }}>{t('noResult')}</Text>;
}

// Shared input row: magnify icon left + field + clear icon right (only when text exists).
export function SearchField({
  value,
  onChange,
  placeholder,
  autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const { t } = useApp();
  // Green focus indicator only: same width/radius in both states so nothing shifts.
  const [focused, setFocused] = useState(false);
  const fs = useFs(17, 15);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: focused ? color.primary : color.line, borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 12, minHeight: 52, marginBottom: 8 }}>
      <AppIcon name={icons.search} size={20} iconColor={focused ? color.primary : color.muted} />
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder={placeholder ?? t('search')}
        placeholderTextColor={color.muted}
        autoFocus={autoFocus}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        selectionColor={color.primary}
        style={{ flex: 1, fontSize: fs, color: color.text, minHeight: 50, outlineStyle: 'none' } as any}
      />
      {value ? (
        <TouchableOpacity
          onPress={() => onChange('')}
          style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <AppIcon name={icons.cancel} size={20} iconColor={color.muted} />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

// Always-visible search bar (same style as the Purchase screen).
// One shared component, full width on mobile/tablet/desktop — never icon-only.
export function SearchToggle({
  query,
  setQuery,
  placeholder,
  alwaysOpen,
}: {
  query: string;
  setQuery: (v: string) => void;
  placeholder?: string;
  alwaysOpen?: boolean;
}) {
  return (
    <SearchField
      value={query}
      onChange={setQuery}
      placeholder={placeholder}
      autoFocus={!!alwaysOpen}
    />
  );
}

// Searchable chips selector for customers / vendors / products.
export function SearchChips<T extends { id: string; name: string }>({
  items,
  value,
  onPick,
  placeholder,
  match,
}: {
  items: T[];
  value?: string;
  onPick: (id: string) => void;
  placeholder?: string;
  match: (item: T, q: string) => boolean;
}) {
  const [q, setQ] = useState('');
  const vis = q.trim() ? items.filter(i => match(i, q)) : items;
  return (
    <View>
      <SearchToggle query={q} setQuery={setQ} placeholder={placeholder} />
      <Chips items={vis} value={value} onPick={onPick} />
      {q.trim() && !vis.length ? <NoResult /> : null}
    </View>
  );
}

// Shared attached dropdown panel: bounded height, internal scroll, hover rows.
function DropPanel({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ borderWidth: 1, borderColor: color.line, borderTopWidth: 0, borderRadius: 12, borderTopLeftRadius: 0, borderTopRightRadius: 0, backgroundColor: '#fff', marginTop: -8, marginBottom: 8, maxHeight: 300, overflow: 'hidden' }}>
      <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled" style={{ maxHeight: 300 }}>
        {children}
      </ScrollView>
    </View>
  );
}

function DropRow({ onPress, children }: { onPress: () => void; children: React.ReactNode }) {
  // TouchableOpacity: the press primitive used by every verified tap target
  // in the app (buttons, steppers, chips, invoice actions).
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 60, paddingVertical: 8, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: color.line, backgroundColor: '#fff' }}
    >
      {children}
    </TouchableOpacity>
  );
}

const closeOnEsc = (setOpen: (v: boolean) => void) => (e: any) => {
  if (e?.nativeEvent?.key === 'Escape') setOpen(false);
};
// Common searchable dropdown selector for Customer / Vendor / Product.
// Focus opens all options, typing filters, tap selects, × clears, Esc closes.
export function SearchableSelect<T extends { id: string; name: string }>({
  items,
  value,
  onPick,
  placeholder,
  match,
  titleOf,
  subOf,
  rightOf,
  emptyText,
}: {
  items: T[];
  value?: string;
  onPick: (id: string | undefined) => void;
  placeholder?: string;
  match: (item: T, q: string) => boolean;
  titleOf?: (item: T) => string;
  subOf?: (item: T) => string | undefined;
  rightOf?: (item: T) => { text: string; sub?: string; neg?: boolean } | undefined;
  emptyText?: string;
}) {
  const { t } = useApp();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const fs = useFs(17, 15);
  const sel = items.find(i => i.id === value);
  if (sel) {
    return (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: color.line, borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 12, minHeight: 52, marginBottom: 8 }}>
        <Text numberOfLines={1} style={{ flex: 1, fontSize: fs, fontWeight: '600', color: color.text }}>{(titleOf ?? (i => i.name))(sel)}</Text>
        <TouchableOpacity onPress={() => { onPick(undefined); setQ(''); setOpen(true); }} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
          <AppIcon name={icons.cancel} size={20} iconColor={color.muted} />
        </TouchableOpacity>
      </View>
    );
  }
  const vis = q.trim() ? items.filter(i => match(i, q)) : items;
  return (
    <View style={{ position: 'relative', zIndex: open ? 100 : 1, elevation: open ? 12 : 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: focused || open ? color.primary : color.line, borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 12, minHeight: 52, marginBottom: 0 }}>
        <AppIcon name={icons.search} size={20} iconColor={focused || open ? color.primary : color.muted} />
        <TextInput
          value={q}
          onChangeText={v => { setQ(v); setOpen(true); }}
          placeholder={placeholder ?? t('search')}
          placeholderTextColor={color.muted}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onBlur={() => { setFocused(false); setTimeout(() => setOpen(false), 200); }}
          onKeyPress={closeOnEsc(setOpen)}
          selectionColor={color.primary}
          style={{ flex: 1, fontSize: fs, color: color.text, minHeight: 50, outlineStyle: 'none' } as any}
        />
        {q ? (
          <TouchableOpacity onPress={() => setQ('')} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name={icons.cancel} size={20} iconColor={color.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
      {open ? (
        <DropPanel>
          {vis.length ? vis.map(item => {
            const sub = subOf?.(item);
            const right = rightOf?.(item);
            return (
              <DropRow key={item.id} onPress={() => { onPick(item.id); setQ(''); setOpen(false); }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: color.text }}>{(titleOf ?? (i => i.name))(item)}</Text>
                  {sub ? <Muted>{sub}</Muted> : null}
                </View>
                {right ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: right.neg ? color.red : color.primary }}>{right.text}</Text>
                    {right.sub ? <Muted>{right.sub}</Muted> : null}
                  </View>
                ) : null}
              </DropRow>
            );
          }) : (
            <Text style={{ textAlign: 'center', padding: 16, color: color.muted, fontSize: 15 }}>{emptyText ?? t('noResult')}</Text>
          )}
        </DropPanel>
      ) : <View style={{ marginBottom: 8 }} />}
    </View>
  );
}

// List-page search with focus-open dropdown: click shows all records,
// typing filters, tapping a row calls onSelect (e.g. filter to that record).
// Same panel, hover, Esc, and empty-state behavior as the selectors above.
export function SearchDropdown<T extends { id: string; name: string }>({
  items,
  query,
  setQuery,
  placeholder,
  match,
  titleOf,
  subOf,
  rightOf,
  emptyText,
  onSelect,
}: {
  items: T[];
  query: string;
  setQuery: (v: string) => void;
  placeholder?: string;
  match: (item: T, q: string) => boolean;
  titleOf?: (item: T) => string;
  subOf?: (item: T) => string | undefined;
  rightOf?: (item: T) => { text: string; sub?: string; neg?: boolean } | undefined;
  emptyText?: string;
  onSelect: (item: T) => void;
}) {
  const { t } = useApp();
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const fs = useFs(17, 15);
  const vis = query.trim() ? items.filter(i => match(i, query)) : items;
  return (
    <View style={{ position: 'relative', zIndex: open ? 100 : 1, elevation: open ? 12 : 0 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderWidth: 1.5, borderColor: focused || open ? color.primary : color.line, borderRadius: 12, backgroundColor: '#fff', paddingHorizontal: 12, minHeight: 52, marginBottom: 0 }}>
        <AppIcon name={icons.search} size={20} iconColor={focused || open ? color.primary : color.muted} />
        <TextInput
          value={query}
          onChangeText={v => { setQuery(v); setOpen(true); }}
          placeholder={placeholder ?? t('search')}
          placeholderTextColor={color.muted}
          onFocus={() => { setFocused(true); setOpen(true); }}
          onBlur={() => { setFocused(false); setTimeout(() => setOpen(false), 200); }}
          onKeyPress={closeOnEsc(setOpen)}
          selectionColor={color.primary}
          style={{ flex: 1, fontSize: fs, color: color.text, minHeight: 50, outlineStyle: 'none' } as any}
        />
        {query ? (
          <TouchableOpacity onPress={() => setQuery('')} style={{ minHeight: 44, minWidth: 44, alignItems: 'center', justifyContent: 'center' }}>
            <AppIcon name={icons.cancel} size={20} iconColor={color.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
      {open ? (
        <DropPanel>
          {vis.length ? vis.map(item => {
            const sub = subOf?.(item);
            const right = rightOf?.(item);
            return (
              <DropRow key={item.id} onPress={() => { onSelect(item); setOpen(false); }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: color.text }}>{(titleOf ?? (i => i.name))(item)}</Text>
                  {sub ? <Muted>{sub}</Muted> : null}
                </View>
                {right ? (
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: right.neg ? color.red : color.primary }}>{right.text}</Text>
                    {right.sub ? <Muted>{right.sub}</Muted> : null}
                  </View>
                ) : null}
              </DropRow>
            );
          }) : (
            <Text style={{ textAlign: 'center', padding: 16, color: color.muted, fontSize: 15 }}>{emptyText ?? t('noResult')}</Text>
          )}
        </DropPanel>
      ) : <View style={{ marginBottom: 8 }} />}
    </View>
  );
}
