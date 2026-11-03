import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { ScrollView, View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { api, AppUser, onAuthExpired } from './api';

type AuthContext = { user: AppUser; setUser: (u: AppUser) => void; logout: () => Promise<void> };
const Auth = createContext<AuthContext>(null as any);
export const useAuth = () => useContext(Auth);
export function AuthField({ label, value, onChange, password = false }: { label: string; value: string; onChange: (v: string) => void; password?: boolean }) {
  return <View style={{ marginBottom: 14 }}><Text style={{ color: '#334155', marginBottom: 6 }}>{label}</Text><TextInput accessibilityLabel={label} value={value} onChangeText={onChange} secureTextEntry={password} autoCapitalize="none" autoCorrect={false} style={styles.input} /></View>;
}
export function AuthGate({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null), [setup, setSetup] = useState(false), [loading, setLoading] = useState(true);
  const [name, setName] = useState(''), [phone, setPhone] = useState(''), [username, setUsername] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [connected, setConnected] = useState(false);
  const load = async () => {
    setLoading(true); setError('');
    try { const result = await api.authStatus(); setUser(result.user); setSetup(result.setup); setConnected(true); }
    catch { setError('সার্ভারে সংযোগ করা যায়নি'); setConnected(false); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); onAuthExpired(() => setUser(null)); return () => onAuthExpired(); }, []);
  const submit = async () => {
    if (busy) return;
    if (setup && password !== confirm) { setError('পাসওয়ার্ড দুটি মিলছে না'); return; }
    setBusy(true); setError('');
    try {
      const current = setup ? await api.setup({ name, phone, username, password, role: 'admin', active: true }) : await api.login(username, password);
      setUser(current); setPassword(''); setConfirm(''); setSetup(false);
    } catch (e) { setError(e instanceof Error ? e.message : 'লগইন করা যায়নি'); }
    finally { setBusy(false); }
  };
  if (loading) return <View style={styles.center}><Text>অপেক্ষা করুন…</Text></View>;
  if (user) return <Auth.Provider value={{ user, setUser, logout: async () => { await api.logout(); setUser(null); setPassword(''); } }}>{children}</Auth.Provider>;
  return <ScrollView contentContainerStyle={styles.center} keyboardShouldPersistTaps="handled"><View style={styles.card}>
    <Text style={styles.title}>{setup ? 'প্রথম প্রশাসক তৈরি করুন' : 'লগইন'}</Text>
    {connected ? <>
      {setup ? <><AuthField label="নাম" value={name} onChange={setName} /><AuthField label="ফোন নম্বর" value={phone} onChange={setPhone} /></> : null}
      <AuthField label="ব্যবহারকারীর নাম" value={username} onChange={setUsername} />
      <AuthField label={setup ? 'পাসওয়ার্ড (অন্তত ১০ অক্ষর)' : 'পাসওয়ার্ড'} value={password} onChange={setPassword} password />
      {setup ? <AuthField label="পাসওয়ার্ড নিশ্চিত করুন" value={confirm} onChange={setConfirm} password /> : null}
    </> : null}
    {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
    <TouchableOpacity accessibilityRole="button" testID="login-submit" disabled={busy} onPress={connected ? submit : load} style={styles.button}><Text style={{ color: '#fff', fontWeight: '700' }}>{busy ? 'অপেক্ষা করুন…' : !connected ? 'আবার চেষ্টা করুন' : setup ? 'অ্যাকাউন্ট তৈরি করুন' : 'লগইন করুন'}</Text></TouchableOpacity>
  </View></ScrollView>;
}
const styles = StyleSheet.create({ center: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#F0F6FC' }, card: { width: '100%', maxWidth: 440, padding: 26, backgroundColor: '#fff', borderRadius: 18 }, title: { fontSize: 25, fontWeight: '700', marginBottom: 24, color: '#123D64' }, input: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 10, padding: 12, fontSize: 16 }, error: { color: '#DC2626', marginBottom: 14 }, button: { backgroundColor: '#1c70b9', borderRadius: 10, padding: 15, alignItems: 'center' } });
