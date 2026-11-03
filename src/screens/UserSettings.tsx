import React, { useEffect, useState } from 'react';
import { View, Text } from 'react-native';
import { api, AppUser, UserInput } from '../api';
import { useAuth, AuthField } from '../auth';
import { useApp } from '../store';
import { Card, Title, Btn, Chips } from '../ui';

export function UserSettings({ section }: { section: 'profile' | 'users' }) {
  const { user, setUser, logout } = useAuth();
  const { lang } = useApp();
  const l = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const [name, setName] = useState(user.name), [phone, setPhone] = useState(user.phone);
  const [password, setPassword] = useState(''), [currentPassword, setCurrentPassword] = useState('');
  const [rows, setRows] = useState<AppUser[]>([]), [draft, setDraft] = useState<UserInput | null>(null), [editId, setEditId] = useState<string>();
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [listError, setListError] = useState('');
  const load = async () => { try { setRows(await api.users()); setListError(''); } catch { setListError(l('ব্যবহারকারীর তালিকা লোড করা যায়নি', 'Could not load users')); } };
  useEffect(() => { if (user.role === 'admin' && section === 'users') load(); }, [user.role, section]);
  const run = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setMessage(''); try { await work(); setMessage(l('সংরক্ষিত হয়েছে', 'Saved')); } catch (e) { setMessage(e instanceof Error ? e.message : l('সংরক্ষণ করা যায়নি', 'Could not save')); } finally { setBusy(false); } };
  const update = (key: keyof UserInput, value: string | boolean) => setDraft(d => d ? { ...d, [key]: value } : d);
  return <View style={{ gap: 16 }}>
    {section === 'profile' ? <Card><Title>{l('আমার প্রোফাইল', 'My profile')}</Title>
      <Text style={{ marginBottom: 14 }}>{user.username} · {user.role === 'admin' ? l('প্রশাসক', 'Administrator') : l('কর্মী', 'Staff')}</Text>
      <AuthField label={l('নাম', 'Name')} value={name} onChange={setName} />
      <AuthField label={l('ফোন নম্বর', 'Phone number')} value={phone} onChange={setPhone} />
      <AuthField label={l('বর্তমান পাসওয়ার্ড', 'Current password')} value={currentPassword} onChange={setCurrentPassword} password />
      <AuthField label={l('নতুন পাসওয়ার্ড (অপরিবর্তিত রাখতে খালি রাখুন)', 'New password (leave blank to keep)')} value={password} onChange={setPassword} password />
      <Btn label={busy ? l('অপেক্ষা করুন…', 'Please wait…') : l('প্রোফাইল সংরক্ষণ', 'Save profile')} onPress={() => run(async () => { setUser(await api.profile({ name, phone, password, currentPassword })); setPassword(''); setCurrentPassword(''); })} />
      <Btn kind="ghost" label={l('লগআউট', 'Log out')} onPress={() => run(logout)} testID="logout" />
    </Card> : null}
    {section === 'users' && user.role === 'admin' ? <Card><Title>{l('ব্যবহারকারী', 'Users')}</Title>
      <Btn label={l('নতুন ব্যবহারকারী', 'Add user')} onPress={() => { setEditId(undefined); setDraft({ name: '', phone: '', username: '', password: '', role: 'staff', active: true }); setMessage(''); }} testID="add-user" />
      {listError ? <><Text>{listError}</Text><Btn kind="ghost" label={l('আবার চেষ্টা করুন', 'Retry')} onPress={load} /></> : null}
      {rows.map(row => <View key={row.id} style={{ paddingVertical: 14, borderBottomWidth: 1, borderColor: '#E2E8F0' }}>
        <Text style={{ fontWeight: '700' }}>{row.name} · {row.username}</Text><Text>{row.phone} · {row.role === 'admin' ? l('প্রশাসক', 'Admin') : l('কর্মী', 'Staff')}{!row.active ? l(' · নিষ্ক্রিয়', ' · Inactive') : ''}</Text>
        {row.id !== user.id ? <Btn kind="ghost" label={l('সম্পাদনা', 'Edit')} onPress={() => { setEditId(row.id); setDraft({ ...row, password: '' }); setMessage(''); }} /> : null}
      </View>)}
      {draft ? <View style={{ marginTop: 20 }}>
        <Title>{editId ? l('ব্যবহারকারী সম্পাদনা', 'Edit user') : l('নতুন ব্যবহারকারী', 'New user')}</Title>
        <AuthField label={l('পূর্ণ নাম', 'Full name')} value={draft.name} onChange={v => update('name', v)} />
        <AuthField label={l('যোগাযোগের ফোন', 'Contact phone')} value={draft.phone} onChange={v => update('phone', v)} />
        <AuthField label={l('ব্যবহারকারীর নাম', 'Username')} value={draft.username} onChange={v => update('username', v)} />
        <AuthField label={l(editId ? 'নতুন পাসওয়ার্ড (ঐচ্ছিক)' : 'পাসওয়ার্ড (অন্তত ১০ অক্ষর)', editId ? 'New password (optional)' : 'Password (at least 10 characters)')} value={draft.password} onChange={v => update('password', v)} password />
        <Chips items={[{ id: 'staff', name: l('কর্মী', 'Staff') }, { id: 'admin', name: l('প্রশাসক', 'Administrator') }]} value={draft.role} onPick={v => update('role', v)} />
        {editId ? <Chips items={[{ id: 'yes', name: l('সক্রিয়', 'Active') }, { id: 'no', name: l('নিষ্ক্রিয়', 'Inactive') }]} value={draft.active ? 'yes' : 'no'} onPick={v => update('active', v === 'yes')} /> : null}
        <Btn label={busy ? l('অপেক্ষা করুন…', 'Please wait…') : l('ব্যবহারকারী সংরক্ষণ', 'Save user')} onPress={() => run(async () => { await api.saveUser(draft, editId); setDraft(null); await load(); })} testID="save-user" />
        <Btn kind="ghost" label={l('বাতিল', 'Cancel')} onPress={() => setDraft(null)} />
      </View> : null}
    </Card> : null}
    {message ? <Text accessibilityRole="alert">{message}</Text> : null}
  </View>;
}
