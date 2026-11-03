import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity } from 'react-native';
import { api, AppUser, UserInput } from '../api';
import { useAuth, AuthField } from '../auth';
import { useApp } from '../store';
import { Card, Title, Btn, Chips, color } from '../ui';
import { AppIcon, icons } from '../icons';

const isEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export function UserSettings({ section }: { section: 'profile' | 'users' }) {
  const { user, setUser, logout } = useAuth();
  const { lang } = useApp();
  const l = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const [name, setName] = useState(user.name), [phone, setPhone] = useState(user.phone), [email, setEmail] = useState(user.email);
  const [password, setPassword] = useState(''), [currentPassword, setCurrentPassword] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);
  const [rows, setRows] = useState<AppUser[]>([]), [draft, setDraft] = useState<UserInput | null>(null), [editId, setEditId] = useState<string>();
  const [message, setMessage] = useState(''), [busy, setBusy] = useState(false), [listError, setListError] = useState('');
  const load = async () => { try { setRows(await api.users()); setListError(''); } catch { setListError(l('ব্যবহারকারীর তালিকা লোড করা যায়নি', 'Could not load users')); } };
  useEffect(() => { if (user.role === 'admin' && section === 'users') load(); }, [user.role, section]);
  const run = async (work: () => Promise<void>) => { if (busy) return; setBusy(true); setMessage(''); try { await work(); setMessage(l('সংরক্ষিত হয়েছে', 'Saved')); } catch (e) { setMessage(e instanceof Error ? e.message : l('সংরক্ষণ করা যায়নি', 'Could not save')); } finally { setBusy(false); } };
  const update = (key: keyof UserInput, value: string | boolean) => setDraft(d => d ? { ...d, [key]: value } : d);
  const saveDraftUser = () => {
    if (!draft) return;
    const phone = draft.phone.replace(/[\u09E6-\u09EF]/g, digit => String(digit.charCodeAt(0) - 0x09E6));
    if (!draft.name.trim()) { setMessage(l('নাম লিখুন।', 'Enter the user name.')); return; }
    if (!isEmail(draft.email)) { setMessage(l('সঠিক ইমেইল লিখুন।', 'Enter a valid email address.')); return; }
    if (!/^[+0-9 ()-]{6,30}$/.test(phone)) { setMessage(l('সঠিক ফোন নম্বর লিখুন।', 'Enter a valid phone number.')); return; }
    if (!editId && draft.password.length < 10) { setMessage(l('পাসওয়ার্ড অন্তত ১০ অক্ষরের হতে হবে।', 'Password must be at least 10 characters.')); return; }
    void run(async () => {
      const saved = await api.saveUser(draft, editId);
      if (saved.id === user.id) { setUser(saved); setEmail(saved.email); setName(saved.name); setPhone(saved.phone); }
      setDraft(null); await load();
    });
  };

  const startProfileEdit = () => {
    setName(user.name); setPhone(user.phone); setEmail(user.email);
    setPassword(''); setCurrentPassword(''); setMessage(''); setEditingProfile(true);
  };

  const openUser = (row: AppUser) => {
    setEditId(row.id); setDraft({ ...row, password: '' }); setMessage('');
  };

  const roleLabel = (role: 'admin' | 'staff') => role === 'admin' ? l('প্রশাসক', 'Administrator') : l('কর্মী', 'Staff');

  return <View style={{ gap: 16 }}>
    {section === 'profile' ? <Card><Title>{l('আমার প্রোফাইল', 'My profile')}</Title>
      {!editingProfile ? <View style={{ gap: 14 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={styles.avatar}><Text style={styles.avatarText}>{user.name.trim().slice(0, 1).toUpperCase()}</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.profileName}>{user.name}</Text>
            <Text style={styles.profileRole}>{roleLabel(user.role)}{!user.active ? l(' · নিষ্ক্রিয়', ' · Inactive') : ''}</Text>
          </View>
        </View>
        <View style={{ gap: 10 }}>
          <View style={styles.infoRow}><AppIcon name={icons.mail} size={18} iconColor={color.primary} /><Text style={styles.infoText}>{user.email}</Text></View>
          <View style={styles.infoRow}><AppIcon name={icons.phone} size={18} iconColor={color.primary} /><Text style={styles.infoText}>{user.phone}</Text></View>
        </View>
        {!isEmail(user.email) ? <Text style={styles.hint}>{l('লগইনের জন্য একটি বৈধ ইমেইল যোগ করুন।', 'Add a valid email address for login.')}</Text> : null}
        <Btn label={l('প্রোফাইল সম্পাদনা', 'Edit profile')} icon={icons.edit} onPress={startProfileEdit} testID="edit-profile" />
        <Btn kind="ghost" label={l('লগআউট', 'Log out')} onPress={() => run(logout)} testID="logout" />
      </View> : <View>
        <AuthField label={l('নাম', 'Name')} value={name} onChange={setName} />
        <AuthField label={l('ইমেইল', 'Email')} value={email} onChange={setEmail} />
        <AuthField label={l('ফোন নম্বর', 'Phone number')} value={phone} onChange={setPhone} />
        <AuthField label={l('বর্তমান পাসওয়ার্ড', 'Current password')} value={currentPassword} onChange={setCurrentPassword} password />
        <AuthField label={l('নতুন পাসওয়ার্ড (অপরিবর্তিত রাখতে খালি রাখুন)', 'New password (leave blank to keep)')} value={password} onChange={setPassword} password />
        <Btn label={busy ? l('অপেক্ষা করুন…', 'Please wait…') : l('প্রোফাইল সংরক্ষণ', 'Save profile')} onPress={() => run(async () => {
          const saved = await api.profile({ name, phone, email, password, currentPassword });
          setUser(saved); setEmail(saved.email); setName(saved.name); setPhone(saved.phone);
          setPassword(''); setCurrentPassword(''); setEditingProfile(false);
        })} />
        <Btn kind="ghost" label={l('বাতিল', 'Cancel')} onPress={() => { setEditingProfile(false); setPassword(''); setCurrentPassword(''); setMessage(''); }} />
      </View>}
    </Card> : null}
    {section === 'users' && user.role === 'admin' ? <Card><Title>{l('ব্যবহারকারী', 'Users')}</Title>
      <Btn label={l('নতুন ব্যবহারকারী', 'Add user')} onPress={() => { setEditId(undefined); setDraft({ name: '', phone: '', email: '', password: '', role: 'staff', active: true }); setMessage(''); }} testID="add-user" />
      {listError ? <><Text>{listError}</Text><Btn kind="ghost" label={l('আবার চেষ্টা করুন', 'Retry')} onPress={load} /></> : null}
      <View style={{ marginTop: 12 }}>
        {rows.map(row => <TouchableOpacity key={row.id} accessibilityRole="button" testID={'user-row-' + row.id} onPress={() => openUser(row)} style={[styles.userRow, editId === row.id && styles.userRowActive]}>
          <View style={{ flex: 1 }}>
            <Text style={{ fontWeight: '700', color: color.text }}>{row.name} · {row.email}</Text>
            <Text style={{ color: color.muted, marginTop: 2 }}>{row.phone} · {roleLabel(row.role)}{!row.active ? l(' · নিষ্ক্রিয়', ' · Inactive') : ''}</Text>
          </View>
          <AppIcon name={icons.chevR} size={20} iconColor={color.muted} />
        </TouchableOpacity>)}
        {!rows.length && !listError ? <Text style={{ color: color.muted, paddingVertical: 12 }}>{l('কোনো ব্যবহারকারী নেই', 'No users yet')}</Text> : null}
      </View>
      {draft ? <View style={{ marginTop: 20 }}>
        <Title>{editId ? l('ব্যবহারকারী সম্পাদনা', 'Edit user') : l('নতুন ব্যবহারকারী', 'New user')}</Title>
        <AuthField label={l('পূর্ণ নাম', 'Full name')} value={draft.name} onChange={v => update('name', v)} />
        <AuthField label={l('যোগাযোগের ফোন', 'Contact phone')} value={draft.phone} onChange={v => update('phone', v)} />
        <AuthField label={l('ইমেইল', 'Email')} value={draft.email} onChange={v => update('email', v)} />
        <AuthField label={l(editId ? 'নতুন পাসওয়ার্ড (ঐচ্ছিক)' : 'পাসওয়ার্ড (অন্তত ১০ অক্ষর)', editId ? 'New password (optional)' : 'Password (at least 10 characters)')} value={draft.password} onChange={v => update('password', v)} password />
        {editId === user.id ? <Text style={styles.hint}>{l('নিজের ভূমিকা ও সক্রিয়তা এখান থেকে বদলানো যাবে না।', 'You cannot change your own role or active status here.')}</Text> : <>
          <Chips items={[{ id: 'staff', name: l('কর্মী', 'Staff') }, { id: 'admin', name: l('প্রশাসক', 'Administrator') }]} value={draft.role} onPick={v => update('role', v)} />
          {editId ? <Chips items={[{ id: 'yes', name: l('সক্রিয়', 'Active') }, { id: 'no', name: l('নিষ্ক্রিয়', 'Inactive') }]} value={draft.active ? 'yes' : 'no'} onPick={v => update('active', v === 'yes')} /> : null}
        </>}
        {message ? <Text accessibilityRole="alert" style={{ color: color.red, marginVertical: 8 }}>{message}</Text> : null}
        <Btn label={busy ? l('অপেক্ষা করুন…', 'Please wait…') : l('ব্যবহারকারী সংরক্ষণ', 'Save user')} onPress={saveDraftUser} testID="save-user" />
        <Btn kind="ghost" label={l('বাতিল', 'Cancel')} onPress={() => setDraft(null)} />
      </View> : null}
    </Card> : null}
    {message && !draft ? <Text accessibilityRole="alert">{message}</Text> : null}
  </View>;
}

const styles = {
  avatar: { width: 54, height: 54, borderRadius: 16, backgroundColor: color.primaryLight, alignItems: 'center' as const, justifyContent: 'center' as const },
  avatarText: { color: color.primary, fontSize: 22, fontWeight: '800' as const },
  profileName: { color: color.text, fontSize: 18, fontWeight: '700' as const },
  profileRole: { color: color.muted, fontSize: 13, marginTop: 2 },
  infoRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10 },
  infoText: { color: color.text, fontSize: 15 },
  hint: { color: color.muted, fontSize: 13, marginBottom: 4 },
  userRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 10, paddingVertical: 14, paddingHorizontal: 12, borderBottomWidth: 1, borderColor: color.line },
  userRowActive: { backgroundColor: color.primaryLight, borderRadius: 10, borderBottomColor: 'transparent' },
};
