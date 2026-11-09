import React, { useEffect, useState } from 'react';
import { Modal, Text, TouchableOpacity, View } from 'react-native';
import type { Lang } from './i18n';

type EntryDialogMessage = { lang: Lang; message: string; nextStep?: string };
const listeners = new Set<(value: EntryDialogMessage | null) => void>();
let current: EntryDialogMessage | null = null;

export function showEntryError(lang: Lang, message: string, nextStep?: string) {
  current = { lang, message, nextStep };
  listeners.forEach(listener => listener(current));
}

export function EntryDialogHost() {
  const [dialog, setDialog] = useState<EntryDialogMessage | null>(current);
  useEffect(() => {
    listeners.add(setDialog);
    return () => { listeners.delete(setDialog); };
  }, []);
  if (!dialog) return null;
  const bn = dialog.lang === 'bn';
  const close = () => { current = null; listeners.forEach(listener => listener(null)); };
  return <Modal visible transparent animationType="fade" onRequestClose={close}>
    <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.52)', alignItems: 'center', justifyContent: 'center', padding: 18 }}>
      <View accessibilityRole="alert" style={{ width: '100%', maxWidth: 440, backgroundColor: '#FFFFFF', borderRadius: 20, padding: 22, borderWidth: 1, borderColor: '#FECACA', shadowColor: '#0F172A', shadowOpacity: 0.22, shadowRadius: 24, elevation: 12 }}>
        <View style={{ width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FEF2F2', marginBottom: 14 }}>
          <Text style={{ color: '#DC2626', fontSize: 24, fontWeight: '800' }}>!</Text>
        </View>
        <Text style={{ color: '#0F172A', fontSize: 20, fontWeight: '800', marginBottom: 9 }}>{bn ? 'তথ্য যাচাই করুন' : 'Check the required information'}</Text>
        <Text style={{ color: '#334155', fontSize: 16, lineHeight: 24 }}>{dialog.message}</Text>
        <View style={{ marginTop: 14, padding: 12, borderRadius: 12, backgroundColor: '#F8FAFC' }}>
          <Text style={{ color: '#475569', fontSize: 13, fontWeight: '700', marginBottom: 4 }}>{bn ? 'কী করবেন' : 'What to do'}</Text>
          <Text style={{ color: '#475569', fontSize: 14, lineHeight: 21 }}>{dialog.nextStep ?? (bn ? 'উপরে উল্লেখ করা তথ্যটি পূরণ বা ঠিক করে আবার চেষ্টা করুন।' : 'Complete or correct the information above, then try again.')}</Text>
        </View>
        <TouchableOpacity accessibilityRole="button" onPress={close} style={{ marginTop: 18, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#1D4ED8' }}>
          <Text style={{ color: '#FFFFFF', fontSize: 16, fontWeight: '800' }}>{bn ? 'ঠিক আছে' : 'Got it'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  </Modal>;
}
