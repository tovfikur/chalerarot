import React, { useEffect, useState } from 'react';
import { Text } from 'react-native';
import { api } from '../api';
import { useApp } from '../store';
import { Btn, Card, Field, Row, color, useDateStr, useMoney } from '../ui';
import { DetailShell } from '../screens';
import { parseNum, toEnDigits } from '../bn';

export type MoneyMovementItem = {
  id: string; amount: number; date: string; direction: 'in' | 'out'; sourceType: string;
  sourceId?: string; note?: string; transferNo?: string; moneyAccount?: { name: string; type: string };
};

export function MoneyMovementDetail({ movement, accountName, onClose, onSaved }: {
  movement: MoneyMovementItem; accountName?: string; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const { lang } = useApp();
  const l = (bn: string, en: string) => lang === 'bn' ? bn : en;
  const m = useMoney(), fd = useDateStr();
  const [editing, setEditing] = useState(false), [amount, setAmount] = useState(String(movement.amount));
  const [note, setNote] = useState(movement.note ?? ''), [busy, setBusy] = useState(false), [error, setError] = useState('');
  useEffect(() => { setAmount(String(movement.amount)); setNote(movement.note ?? ''); setEditing(false); setError(''); }, [movement.id, movement.amount, movement.note]);
  const editable = movement.sourceType === 'deposit' || movement.sourceType === 'withdrawal';
  const save = async () => {
    const parsed = parseNum(toEnDigits(amount));
    if (!Number.isFinite(parsed) || parsed <= 0) { setError(l('সঠিক পরিমাণ লিখুন', 'Enter a valid amount')); return; }
    if (note.length > 500) { setError(l('নোট ৫০০ অক্ষরের মধ্যে লিখুন', 'Keep the note under 500 characters')); return; }
    setBusy(true); setError('');
    try { await api.updateMoneyEntry(movement.id, { amount: parsed, note }); await onSaved(); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : l('লেনদেন আপডেট করা যায়নি', 'Could not update transaction')); }
    finally { setBusy(false); }
  };
  return <DetailShell title={l('লেনদেনের বিবরণ', 'Transaction details')} onClose={onClose}>
    <Card>
      <Row left={l('লেনদেনের তারিখ', 'Date')} right={fd(movement.date)} />
      <Row left={l('ধরন', 'Direction')} right={movement.direction === 'in' ? l('জমা', 'Money in') : l('উত্তোলন', 'Money out')} />
      {accountName || movement.moneyAccount?.name ? <Row left={l('অ্যাকাউন্ট', 'Account')} right={accountName ?? movement.moneyAccount?.name ?? ''} /> : null}
      {!editing ? <>
        <Row left={l('পরিমাণ', 'Amount')} right={m(movement.amount)} />
        <Row left={l('নোট', 'Note')} right={movement.note || '—'} />
        {editable ? <Btn label={l('লেনদেন সম্পাদনা', 'Edit transaction')} onPress={() => setEditing(true)} /> : <Text style={{ color: color.muted, marginTop: 12 }}>{l('এই লেনদেনটি উৎস মডিউল থেকে সম্পাদনা করতে হবে।', 'Edit this transaction in its source module.')}</Text>}
      </> : <>
        <Field label={l('পরিমাণ', 'Amount')} value={amount} onChange={setAmount} num />
        <Field label={l('লগ নোট', 'Log note')} value={note} onChange={setNote} />
        {error ? <Text accessibilityRole="alert" style={{ color: color.red, marginBottom: 10 }}>{error}</Text> : null}
        <Btn label={busy ? l('অপেক্ষা করুন…', 'Saving…') : l('পরিবর্তন সংরক্ষণ', 'Save changes')} onPress={save} />
        <Btn kind="ghost" label={l('বাতিল', 'Cancel')} onPress={() => { setEditing(false); setAmount(String(movement.amount)); setNote(movement.note ?? ''); setError(''); }} />
      </>}
    </Card>
  </DetailShell>;
}
