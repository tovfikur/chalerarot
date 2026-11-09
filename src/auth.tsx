import React, { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import {
  ActivityIndicator, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, useWindowDimensions, View,
} from 'react-native';
import { api, AppUser, onAuthExpired } from './api';
import { color } from './ui';
import { AppIcon, icons } from './icons';
import { Lang } from './i18n';
import { showEntryError } from './entryDialog';

type AuthContext = { user: AppUser; setUser: (u: AppUser) => void; logout: () => Promise<void> };
const Auth = createContext<AuthContext>(null as any);
export const useAuth = () => useContext(Auth);

/** Shared field used by the profile / user-management screens. */
export function AuthField({ label, value, onChange, password = false, required = false }: { label: string; value: string; onChange: (v: string) => void; password?: boolean; required?: boolean }) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.fieldLabel}>{label}{required ? <Text style={{ color: '#DC2626', fontWeight: '900' }}> *</Text> : null}</Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onChangeText={onChange}
        secureTextEntry={password}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={color.muted}
        style={styles.input}
      />
    </View>
  );
}

const WEB = Platform.OS === 'web';

/** Brand mark used in the header and the desktop side panel. */
function BrandMark({ size = 52 }: { size?: number }) {
  return (
    <View style={[styles.brandMark, { width: size, height: size, borderRadius: size * 0.28 }]}>
      <AppIcon name={icons.stock} size={size * 0.52} iconColor="#fff" />
    </View>
  );
}

function BrandPanel({ lang }: { lang: Lang }) {
  const text = (bn: string, en: string) => lang === 'bn' ? bn : en;
  return (
    <View style={styles.brandPanel}>
      <View style={styles.brandTop}>
        <BrandMark size={58} />
        <View style={{ marginTop: 20 }}>
          <Text style={styles.brandName}>{text('চালের আড়ত', 'Chaler Arot')}</Text>
          <Text style={styles.brandSub}>Chaler Arot</Text>
        </View>
      </View>
      <Text style={styles.brandTag}>{text('আপনার আড়তের স্টক, বিক্রয়, ক্রয় ও হিসাব — এক জায়গায়, সহজে।', 'Manage your inventory, sales, purchases, and accounts in one place.')}</Text>
      <View style={{ gap: 14, marginTop: 34 }}>
        {([
          [icons.products, text('স্টক ও মজুদ', 'Stock and inventory')],
          [icons.sale, text('বিক্রয় ও চালান', 'Sales and invoices')],
          [icons.purchase, text('ক্রয় ও মহাজন', 'Purchases and vendors')],
          [icons.accounts, text('হিসাব ও লেনদেন', 'Accounts and transactions')],
        ] as const).map(([icon, label]) => (
          <View key={label} style={styles.feature}>
            <View style={styles.featureIcon}><AppIcon name={icon} size={18} iconColor="#fff" /></View>
            <Text style={styles.featureText}>{label}</Text>
          </View>
        ))}
      </View>
      <View style={styles.brandFooter}><Text style={styles.brandFooterText}>{text('নির্ভরযোগ্য আড়ত ম্যানেজমেন্ট', 'Reliable business management')}</Text></View>
    </View>
  );
}

function LoginField({
  label, value, onChange, icon, password, secure, onToggle, testID, onSubmit, lang, required = false,
}: {
  label: string; value: string; onChange: (v: string) => void; lang: Lang; required?: boolean;
  icon: React.ComponentProps<typeof AppIcon>['name'];
  password?: boolean; secure?: boolean; onToggle?: () => void; testID?: string; onSubmit?: () => void;
}) {
  const text = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const [focused, setFocused] = useState(false);
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={styles.fieldLabel}>{label}{required ? <Text style={{ color: '#DC2626', fontWeight: '900' }}> *</Text> : null}</Text>
      <View style={[styles.inputWrap, focused && styles.inputWrapFocused]}>
        <AppIcon name={icon} size={20} iconColor={focused ? color.primary : color.muted} />
        <TextInput
          accessibilityLabel={label}
          testID={testID}
          value={value}
          onChangeText={onChange}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          secureTextEntry={secure}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={password ? 'current-password' : 'email'}
          keyboardType={password ? 'default' : 'email-address'}
          placeholder={label}
          placeholderTextColor={color.muted}
          onSubmitEditing={onSubmit}
          returnKeyType={onSubmit ? 'go' : 'next'}
          style={styles.inputInner}
        />
        {password && onToggle ? (
          <TouchableOpacity accessibilityRole="button" accessibilityLabel={secure ? text('পাসওয়ার্ড দেখান', 'Show password') : text('পাসওয়ার্ড লুকান', 'Hide password')} onPress={onToggle} style={styles.eyeBtn}>
            <AppIcon name={secure ? icons.eye : 'eye-off-outline'} size={20} iconColor={color.muted} />
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Lang>(() => {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem('chaler-arot-language') === 'en' ? 'en' : 'bn'; } catch { return 'bn'; }
  });
  const text = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const changeLang = (next: Lang) => { setLang(next); try { localStorage.setItem('chaler-arot-language', next); } catch {} };
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [firstRun, setFirstRun] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { width } = useWindowDimensions();
  const wide = width >= 900;

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const result = await api.authStatus();
      setUser(result.user);
      setFirstRun(result.setup);
      setConnected(true);
    } catch {
      setError(text('সার্ভারে সংযোগ করা যায়নি। ইন্টারনেট ও সার্ভার চালু আছে কিনা দেখুন।', 'Could not connect to the server. Check your internet connection and that the server is running.'));
      setConnected(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); onAuthExpired(() => setUser(null)); return () => onAuthExpired(); }, []);

  const submit = async () => {
    if (busy) return;
    if (!email.trim()) { const message = text('ইমেইল লিখুন', 'Enter your email'); setError(message); showEntryError(lang, message); return; }
    if (!password) { const message = text('পাসওয়ার্ড লিখুন', 'Enter your password'); setError(message); showEntryError(lang, message); return; }
    setBusy(true);
    setError('');
    try {
      const current = await api.login(email.trim(), password);
      setUser(current);
      setPassword('');
    } catch (e) {
      const message = e instanceof Error ? e.message : text('লগইন করা যায়নি', 'Unable to sign in'); setError(message); showEntryError(lang, message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.page, styles.center]}>
        <BrandMark size={60} />
        <Text style={styles.loadingText}>{text('অপেক্ষা করুন…', 'Please wait…')}</Text>
      </View>
    );
  }

  if (user) {
    return (
      <Auth.Provider value={{ user, setUser, logout: async () => { await api.logout(); setUser(null); setPassword(''); } }}>
        {children}
      </Auth.Provider>
    );
  }

  return (
    <View style={styles.page}>
      {/* Soft themed decoration */}
      <View pointerEvents="none" style={[styles.blob, styles.blobA]} />
      <View pointerEvents="none" style={[styles.blob, styles.blobB]} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={[styles.shell, wide && styles.shellWide]}>
            {wide ? <BrandPanel lang={lang} /> : null}
            <View style={[styles.card, wide && styles.cardWide]}>
              {!wide ? (
                <View style={{ alignItems: 'center', marginBottom: 22 }}>
                  <BrandMark size={56} />
                  <Text style={styles.mobileBrand}>{text('চালের আড়ত', 'Chaler Arot')}</Text>
                  <Text style={styles.mobileBrandSub}>Chaler Arot</Text>
                </View>
              ) : null}

              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.title}>{wide ? text('লগইন', 'Sign in') : text('স্বাগতম', 'Welcome')}</Text>
                <View style={{ flexDirection: 'row', gap: 6 }}>
                  {(['bn', 'en'] as Lang[]).map(value => <TouchableOpacity key={value} accessibilityRole="button" accessibilityLabel={value === 'bn' ? 'বাংলা' : 'English'} onPress={() => changeLang(value)} style={{ padding: 8, borderRadius: 8, backgroundColor: lang === value ? '#EAF2FC' : '#F8FAFC' }}><Text style={{ color: '#1c70b9', fontWeight: '700' }}>{value === 'bn' ? 'বাংলা' : 'English'}</Text></TouchableOpacity>)}
                </View>
              </View>
              <Text style={styles.subtitle}>{text('আপনার আড়তের হিসাব চালিয়ে যেতে লগইন করুন', 'Sign in to continue to your business')}</Text>

              {firstRun ? (
                <View style={styles.notice}>
                  <AppIcon name={icons.lock} size={18} iconColor={color.amber} />
                  <Text style={styles.noticeText}>{text('এখনও কোনো অ্যাকাউন্ট তৈরি হয়নি। প্রথম প্রশাসক অ্যাকাউন্ট তৈরি হলে এখানে লগইন করুন।', 'No account exists yet. Sign in here after the first administrator account is created.')}</Text>
                </View>
              ) : null}

              {connected ? (
                <>
                  <LoginField
                    label={text('ইমেইল', 'Email')}
                    lang={lang}
                    required
                    value={email}
                    onChange={v => { setEmail(v); setError(''); }}
                    icon={icons.mail}
                    testID="login-email"
                    onSubmit={submit}
                  />
                  <LoginField
                    label={text('পাসওয়ার্ড', 'Password')}
                    lang={lang}
                    required
                    value={password}
                    onChange={v => { setPassword(v); setError(''); }}
                    icon={icons.lock}
                    password
                    secure={!reveal}
                    onToggle={() => setReveal(r => !r)}
                    testID="login-password"
                    onSubmit={submit}
                  />
                </>
              ) : null}

              {error ? (
                <View accessibilityRole="alert" style={styles.errorBox}>
                  <AppIcon name="alert-circle-outline" size={18} iconColor={color.red} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                accessibilityRole="button"
                testID="login-submit"
                disabled={busy}
                onPress={connected ? submit : load}
                style={[styles.submit, busy && { opacity: 0.7 }]}
                activeOpacity={0.85}
              >
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Text style={styles.submitText}>{connected ? text('লগইন করুন', 'Sign in') : text('আবার চেষ্টা করুন', 'Try again')}</Text>
                    {connected ? <AppIcon name={icons.chevR} size={20} iconColor="#fff" /> : null}
                  </>
                )}
              </TouchableOpacity>

              <Text style={styles.footer}>© {new Date().getFullYear()} {text('চালের আড়ত · সর্বস্বত্ব সংরক্ষিত', 'Chaler Arot · All rights reserved')}</Text>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: color.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  loadingText: { color: color.muted, fontSize: 15 },
  scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', padding: 20 },
  shell: { width: '100%', maxWidth: 480 },
  shellWide: {
    maxWidth: 1000,
    flexDirection: 'row',
    alignItems: 'stretch',
    borderRadius: 26,
    overflow: 'hidden',
    backgroundColor: '#fff',
    ...(WEB ? { boxShadow: '0 28px 70px -24px rgba(28, 112, 185, 0.45), 0 4px 18px rgba(15, 30, 54, 0.08)' } as any : {}),
  },
  card: { width: '100%', padding: 26, backgroundColor: '#fff', borderRadius: 22 },
  cardWide: { flex: 1, maxWidth: 480, padding: 42, borderRadius: 0 },
  brandPanel: {
    width: 400,
    padding: 40,
    backgroundColor: color.primary,
    ...(WEB ? {
      backgroundImage: 'linear-gradient(150deg, #2b91e8 0%, #1c70b9 55%, #135591 100%)',
      boxShadow: 'inset -1px 0 0 rgba(255,255,255,0.08)',
    } as any : {}),
  },
  brandTop: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  brandMark: {
    alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)',
    ...(WEB ? { boxShadow: '0 10px 24px rgba(9, 40, 70, 0.32), inset 0 1px 0 rgba(255,255,255,0.5)' } as any : {}),
  },
  brandName: { color: '#fff', fontSize: 28, fontWeight: '800', letterSpacing: 0.4 },
  brandSub: { color: 'rgba(255,255,255,0.72)', fontSize: 14, fontWeight: '600', marginTop: 2, letterSpacing: 1.2 },
  brandTag: { color: 'rgba(255,255,255,0.9)', fontSize: 16, lineHeight: 25, marginTop: 26 },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  featureIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.22)' },
  featureText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  brandFooter: { marginTop: 'auto', paddingTop: 30 },
  brandFooterText: { color: 'rgba(255,255,255,0.6)', fontSize: 13 },
  title: { fontSize: 27, fontWeight: '800', color: color.text, marginBottom: 6 },
  subtitle: { fontSize: 15, color: color.muted, marginBottom: 24, lineHeight: 22 },
  mobileBrand: { fontSize: 23, fontWeight: '800', color: color.text, marginTop: 12 },
  mobileBrandSub: { fontSize: 12, fontWeight: '600', color: color.muted, letterSpacing: 1.4, marginTop: 2 },
  fieldLabel: { color: color.text, fontSize: 14, fontWeight: '600', marginBottom: 7 },
  inputWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#F7FAFE', borderWidth: 1.5, borderColor: color.line,
    borderRadius: 13, paddingHorizontal: 14, minHeight: 54,
  },
  inputWrapFocused: {
    borderColor: color.primary,
    backgroundColor: '#fff',
    ...(WEB ? { boxShadow: '0 0 0 4px rgba(28, 112, 185, 0.12)' } as any : {}),
  },
  inputInner: {
    flex: 1, fontSize: 16, color: color.text, paddingVertical: 12,
    ...(WEB ? { outlineStyle: 'none' } as any : {}),
  },
  eyeBtn: { minHeight: 44, minWidth: 40, alignItems: 'center', justifyContent: 'center' },
  input: { borderWidth: 1, borderColor: color.line, borderRadius: 10, padding: 12, fontSize: 16, color: color.text, backgroundColor: '#F7FAFE' },
  submit: {
    marginTop: 8, minHeight: 54, borderRadius: 13, backgroundColor: color.primary,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    ...(WEB ? { cursor: 'pointer', boxShadow: '0 12px 24px -10px rgba(28, 112, 185, 0.8)' } as any : {}),
  },
  submitText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14,
    backgroundColor: '#FEF2F2', borderWidth: 1, borderColor: '#FECACA', borderRadius: 11, padding: 12,
  },
  errorText: { flex: 1, color: '#B91C1C', fontSize: 14, lineHeight: 20 },
  notice: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16,
    backgroundColor: '#FFFBEB', borderWidth: 1, borderColor: '#FDE68A', borderRadius: 11, padding: 12,
  },
  noticeText: { flex: 1, color: '#92400E', fontSize: 13, lineHeight: 19 },
  footer: { textAlign: 'center', color: color.muted, fontSize: 12, marginTop: 24 },
  blob: { position: 'absolute', borderRadius: 999, backgroundColor: color.primaryLight, opacity: 0.55 },
  blobA: { width: 420, height: 420, top: -160, right: -120 },
  blobB: { width: 320, height: 320, bottom: -140, left: -100, opacity: 0.4 },
});
