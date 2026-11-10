import React from 'react';
import { View } from 'react-native';
import { useApp } from './store';
import { Btn } from './ui';
import { icons } from './icons';
import { downloadReportCSV, printReport, ReportDoc } from './report';

export function EntryReportButtons({ doc, filename }: { doc: ReportDoc; filename: string }) {
  const { lang } = useApp();
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
    <Btn kind="ghost" icon={icons.print} label={lang === 'bn' ? 'প্রিন্ট' : 'Print'} onPress={() => { printReport(doc); }} />
    <Btn kind="ghost" icon={icons.excel} label={lang === 'bn' ? 'ডাউনলোড' : 'Download'} onPress={() => { downloadReportCSV(doc, filename); }} />
  </View>;
}
