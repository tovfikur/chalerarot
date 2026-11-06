import React, { useState } from 'react';
import { ScrollView, View, Text, TouchableOpacity } from 'react-native';
import { useApp } from '../store';
import { Card, Title, Field, Btn, Chips } from '../ui';
import { Trash } from '../screens';
import { UserSettings } from './UserSettings';
import { ActivityLog } from './ActivityLog';
import { useAuth } from '../auth';
import { AppIcon, icons, IconName } from '../icons';

export function Settings() {
  const { user } = useAuth();
  const { business, saveBusiness, lang } = useApp();
  const [draft, setDraft] = useState(business);
  const [section, setSection] = useState<'business' | 'language' | 'inventory' | 'profile' | 'users' | 'log' | 'trash' | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);
  const label = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const change = (key: keyof typeof draft, value: string | number) => { setDraft({ ...draft, [key]: value }); setMessage(''); };
  const months = Array.from({ length: 12 }, (_, i) => ({ id: String(i + 1), name: new Intl.DateTimeFormat(lang === 'bn' ? 'bn-BD' : 'en', { month: 'long' }).format(new Date(2024, i, 1)) }));
  const save = async () => {
    if (busy) return;
    if (!draft.name.trim()) { setFailed(true); setMessage(label('ব্যবসার নাম লিখুন', 'Enter a business name')); return; }
    setBusy(true); setMessage('');
    try { await saveBusiness(draft); setFailed(false); setMessage(draft.language === 'bn' ? 'সেটিংস সংরক্ষিত হয়েছে' : 'Settings saved'); }
    catch { setFailed(true); setMessage(label('সংরক্ষণ করা যায়নি। আবার চেষ্টা করুন।', 'Could not save. Please try again.')); }
    finally { setBusy(false); }
  };
  const open = (next: typeof section) => { setDraft(business); setMessage(''); setSection(next); };
  const back = <Btn kind="ghost" label={label('সেটিংসে ফিরুন', 'Back to Settings')} icon={icons.back} onPress={() => open(null)} testID="settings-back" />;
  const menus: { id: NonNullable<typeof section>; title: string; icon: IconName; admin?: boolean }[] = [
    { id: 'business', title: label('ব্যবসার তথ্য', 'Business settings'), icon: icons.office, admin: true },
    { id: 'inventory', title: label('Inventory settings', 'Inventory settings'), icon: icons.stock, admin: true },
    { id: 'language', title: label('ভাষা', 'Language'), icon: icons.language, admin: true },
    { id: 'profile', title: label('আমার প্রোফাইল', 'My profile'), icon: icons.customers },
    { id: 'users', title: label('ব্যবহারকারী', 'Users'), icon: icons.customers, admin: true },
    { id: 'log', title: label('লগ নোট', 'Log Note'), icon: icons.history, admin: true },
    { id: 'trash', title: label('ট্র্যাশ', 'Trash'), icon: icons.del },
  ];
  if (section === 'trash') return <View style={{ flex: 1 }}><View style={{ padding: 16 }}>{back}</View><Trash /></View>;
  return <ScrollView contentContainerStyle={{ padding: 20, gap: 16, maxWidth: 900, width: '100%', alignSelf: 'center' }}>
    {section ? back : <Title>{label('সেটিংস', 'Settings')}</Title>}
    {!section ? <View style={{ gap: 10 }}>{menus.filter(item => !item.admin || user.role === 'admin').map(item =>
      <TouchableOpacity key={item.id} testID={`settings-${item.id}`} accessibilityRole="button" onPress={() => open(item.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 20, borderRadius: 14, backgroundColor: '#fff', borderWidth: 1, borderColor: '#DCE6EF', minHeight: 72 }}>
        <View style={{ padding: 10, borderRadius: 12, backgroundColor: '#EAF2FC' }}><AppIcon name={item.icon} size={22} iconColor="#1c70b9" /></View>
        <Text style={{ flex: 1, fontSize: 17, fontWeight: '600', color: '#0F1E36' }}>{item.title}</Text>
        <AppIcon name={icons.chevR} size={20} iconColor="#64748B" />
      </TouchableOpacity>
    )}</View> : null}
    {section === 'profile' || section === 'users' ? <UserSettings key={section} section={section} /> : null}
    {section === 'log' ? <ActivityLog /> : null}
    {user.role === 'admin' && section === 'inventory' ? <>
      <Card>
        <Title>Inventory settings</Title>
        <Text style={{ color: '#475569', fontSize: 14, lineHeight: 20, marginBottom: 12 }}>When enabled, sales can make stock negative. The next purchase will match those sold units at its actual landed average cost and update COGS.</Text>
        <TouchableOpacity onPress={() => { setDraft({ ...draft, allowNegativeStock: !draft.allowNegativeStock }); setMessage(''); }} accessibilityRole="switch" accessibilityState={{ checked: draft.allowNegativeStock }}
          style={{ minHeight: 56, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1.5, borderColor: draft.allowNegativeStock ? '#059669' : '#CBD5E1', backgroundColor: draft.allowNegativeStock ? '#ECFDF5' : '#F8FAFC', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: draft.allowNegativeStock ? '#047857' : '#334155', fontSize: 15, fontWeight: '800' }}>Allow negative stock sales</Text>
          <View style={{ minWidth: 88, minHeight: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: draft.allowNegativeStock ? '#059669' : '#64748B' }}><Text style={{ color: '#FFFFFF', fontWeight: '900' }}>{draft.allowNegativeStock ? 'ON' : 'OFF'}</Text></View>
        </TouchableOpacity>
      </Card>
      {message ? <Text accessibilityRole="alert" style={{ color: failed ? '#DC2626' : '#15803D' }}>{message}</Text> : null}
      <Btn label={busy ? 'Saving…' : 'Save inventory settings'} onPress={save} testID="save-settings" />
    </> : null}
    {user.role === 'admin' && (section === 'business' || section === 'language') ? <>
    {section === 'business' ?
    <Card>
      <Title>{label('ব্যবসার তথ্য', 'Business details')}</Title>
      <Field label={label('ব্যবসার নাম', 'Business name')} value={draft.name} onChange={v => change('name', v)} />
      <Field label={label('ঠিকানা', 'Address')} value={draft.address} onChange={v => change('address', v)} />
      <Field label={label('ফোন নম্বর', 'Phone number')} value={draft.phone} onChange={v => change('phone', v)} />
      <Text>{label('মুদ্রা', 'Currency')}</Text>
      <Chips items={['BDT', 'USD', 'INR', 'EUR', 'GBP'].map(id => ({ id, name: id }))} value={draft.currency} onPick={v => change('currency', v)} />
      <Text>{label('অর্থবছর শুরুর মাস', 'Fiscal year starting month')}</Text>
      <Chips items={months} value={String(draft.fiscalStartMonth)} onPick={v => change('fiscalStartMonth', Number(v))} />
    </Card> :
    <Card><Title>{label('ভাষা', 'Language')}</Title><Chips items={[{ id: 'bn', name: 'বাংলা' }, { id: 'en', name: 'English' }]} value={draft.language} onPick={v => change('language', v)} /></Card>}
    {message ? <Text accessibilityRole="alert" style={{ color: failed ? '#DC2626' : '#15803D' }}>{message}</Text> : null}
    <Btn label={busy ? label('সংরক্ষণ হচ্ছে…', 'Saving…') : label('সংরক্ষণ করুন', 'Save settings')} onPress={save} testID="save-settings" />
    </> : null}
  </ScrollView>;
}
