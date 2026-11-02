import React, { useState, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Platform,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { useApp } from './store';
import { color, useMoney, useNum, toBnDigits } from './ui';
import { AppIcon, icons } from './icons';
import { toEnDigits, parseNum } from './bn';
import { DetailShell } from './screens';

export type BulkKind = 'product' | 'customer' | 'vendor';

interface BulkUploadModalProps {
  kind: BulkKind;
  onClose: () => void;
  onSuccess?: () => void;
}

export type ParsedRow = {
  rowNum: number;
  valid: boolean;
  error?: string;
  data: Record<string, any>;
};

// Robust CSV & TSV parser handling quotes, commas, tabs and newlines
export function parseCSV(text: string): string[][] {
  const lines: string[][] = [];
  const clean = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!clean.trim()) return lines;

  let row: string[] = [];
  let inQuotes = false;
  let currentToken = '';

  for (let i = 0; i < clean.length; i++) {
    const char = clean[i];
    const nextChar = clean[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentToken += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        currentToken += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',' || char === '\t') {
        row.push(currentToken.trim());
        currentToken = '';
      } else if (char === '\n') {
        row.push(currentToken.trim());
        // Only add non-empty rows
        if (row.some(cell => cell.length > 0)) {
          lines.push(row);
        }
        row = [];
        currentToken = '';
      } else {
        currentToken += char;
      }
    }
  }

  if (currentToken.length > 0 || row.length > 0) {
    row.push(currentToken.trim());
    if (row.some(cell => cell.length > 0)) {
      lines.push(row);
    }
  }

  return lines;
}

const normalizeHeader = (h: string): string => {
  return h.toLowerCase().replace(/[\s_\-\.\(\)]/g, '');
};

const mapHeaders = (rawHeaders: string[], kind: BulkKind): Record<number, string> => {
  const indexToKey: Record<number, string> = {};

  rawHeaders.forEach((h, index) => {
    const norm = normalizeHeader(h);
    if (kind === 'product') {
      if (['code', 'productcode', 'itemcode', 'কোড', 'পণ্যকোড'].includes(norm)) indexToKey[index] = 'code';
      else if (['name', 'productname', 'itemname', 'পণ্যেরনাম', 'নাম', 'পণ্য'].includes(norm)) indexToKey[index] = 'name';
      else if (['price', 'saleprice', 'rate', 'বিক্রয়মূল্য', 'দর', 'বিক্রয়দর'].includes(norm)) indexToKey[index] = 'price';
      else if (['cost', 'costprice', 'purchaserate', 'ক্রয়মূল্য', 'কেনাদর', 'ক্রয়দর'].includes(norm)) indexToKey[index] = 'cost';
      else if (['opening', 'openingqty', 'stock', 'qty', 'প্রারম্ভিকমজুদ', 'মজুদ', 'শুরুরপরিমাণ'].includes(norm)) indexToKey[index] = 'opening';
      else if (['bagkg', 'bagweight', 'বস্তারওজন', 'ওজন'].includes(norm)) indexToKey[index] = 'bagKg';
      else if (['uom', 'unit', 'একক'].includes(norm)) indexToKey[index] = 'uom';
      else if (['description', 'desc', 'note', 'বিবরণ'].includes(norm)) indexToKey[index] = 'description';
    } else {
      // customer or vendor
      if (['code', 'customercode', 'vendorcode', 'কোড', 'কাস্টমারকোড', 'সরবরাহকারীকোড'].includes(norm)) indexToKey[index] = 'code';
      else if (['name', 'customername', 'vendorname', 'partyname', 'নাম', 'কাস্টমারনাম', 'সরবরাহকারীনাম', 'প্রতিষ্ঠানেরনাম'].includes(norm)) indexToKey[index] = 'name';
      else if (['mobile', 'phone', 'contact', 'মোবাইল', 'ফোন', 'নাম্বার'].includes(norm)) indexToKey[index] = 'mobile';
      else if (['address', 'ঠিকানা'].includes(norm)) indexToKey[index] = 'address';
      else if (['opening', 'openingdue', 'openingpayable', 'due', 'balance', 'বাকি', 'দেনা', 'পূর্বেরবাকি', 'পূর্বেরদেনা'].includes(norm)) indexToKey[index] = 'opening';
    }
  });

  return indexToKey;
};

export function BulkUploadModal({ kind, onClose, onSuccess }: BulkUploadModalProps) {
  const { bulkUploadProducts, bulkUploadParties, lang } = useApp();
  const m = useMoney();
  const n = useNum();
  const fileInputRef = useRef<any>(null);

  const [rawText, setRawText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [hasParsed, setHasParsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importReport, setImportReport] = useState<string | null>(null);

  const isBn = lang === 'bn';

  const modalTitle = useMemo(() => {
    if (kind === 'product') return isBn ? 'বাল্ক পণ্য আপলোড' : 'Bulk Product Upload';
    if (kind === 'customer') return isBn ? 'বাল্ক কাস্টমার আপলোড' : 'Bulk Customer Upload';
    return isBn ? 'বাল্ক সরবরাহকারী আপলোড' : 'Bulk Vendor Upload';
  }, [kind, isBn]);

  const templateCsv = useMemo(() => {
    if (kind === 'product') {
      return 'code,name,price,cost,opening,bagKg,uom,description\n' +
        'BR-28,বিআর-২৮ চাল,৬০,৫২,১০০,৫০,বস্তা,ভালো মানের চাল\n' +
        'MIN-50,মিনিকেট চাল,৭২,৬৫,২০০,৫০,বস্তা,কুষ্টিয়ার প্রিমিয়াম মিনিকেট\n';
    }
    if (kind === 'customer') {
      return 'code,name,mobile,address,opening\n' +
        'C-101,রহিম ট্রেডার্স,01711000000,চকবাজার ঢাকা,৫০০০\n' +
        'C-102,করিম স্টোর,01812000000,কারওয়ান বাজার ঢাকা,০\n';
    }
    return 'code,name,mobile,address,opening\n' +
      'V-201,নওগাঁ রাইস মিল,01913000000,নওগাঁ সদর,১০০০০\n' +
      'V-202,দিনাজপুর অটো রাইস,01714000000,দিনাজপুর,০\n';
  }, [kind]);

  const placeholderText = useMemo(() => {
    if (kind === 'product') {
      return isBn
        ? 'এখানে CSV বা Excel থেকে কপি করে পেস্ট করুন:\ncode,name,price,cost,opening,bagKg,uom,description\nBR-28,বিআর-২৮ চাল,৬০,৫২,১০০,৫০,বস্তা,ভালো মানের চাল'
        : 'Paste CSV or copy from Excel here:\ncode,name,price,cost,opening,bagKg,uom,description\nBR-28,BR-28 Rice,60,52,100,50,বস্তা,Standard rice';
    }
    if (kind === 'customer') {
      return isBn
        ? 'এখানে CSV বা Excel থেকে কপি করে পেস্ট করুন:\ncode,name,mobile,address,opening\nC-101,রহিম ট্রেডার্স,01711000000,চকবাজার ঢাকা,৫০০০'
        : 'Paste CSV or copy from Excel here:\ncode,name,mobile,address,opening\nC-101,Rahim Traders,01711000000,Dhaka,5000';
    }
    return isBn
      ? 'এখানে CSV বা Excel থেকে কপি করে পেস্ট করুন:\ncode,name,mobile,address,opening\nV-201,নওগাঁ রাইস মিল,01913000000,নওগাঁ,১০০০০'
      : 'Paste CSV or copy from Excel here:\ncode,name,mobile,address,opening\nV-201,Naogaon Rice Mill,01913000000,Naogaon,10000';
  }, [kind, isBn]);

  const handleDownloadTemplate = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      const blob = new Blob(['\uFEFF' + templateCsv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${kind}_bulk_template.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } else {
      Alert.alert('টেমপ্লেট', templateCsv);
    }
  };

  const handleFileChange = (e: any) => {
    const file = e?.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      const text = String(event.target?.result ?? '');
      setRawText(text);
      validateAndPreview(text);
    };
    reader.readAsText(file, 'utf-8');
  };

  const validateAndPreview = (textToParse?: string) => {
    const text = textToParse !== undefined ? textToParse : rawText;
    const lines = parseCSV(text);
    if (!lines.length) {
      setParsedRows([]);
      setHasParsed(true);
      return;
    }

    const firstLine = lines[0];
    const headerMap = mapHeaders(firstLine, kind);
    const hasHeaderName = Object.values(headerMap).includes('name');

    // If first row has headers, parse starting from row 1; otherwise parse from row 0 with positional fallback
    let startIndex = 1;
    let finalHeaderMap = headerMap;

    if (!hasHeaderName) {
      startIndex = 0;
      finalHeaderMap = kind === 'product'
        ? { 0: 'code', 1: 'name', 2: 'price', 3: 'cost', 4: 'opening', 5: 'bagKg', 6: 'uom', 7: 'description' }
        : { 0: 'code', 1: 'name', 2: 'mobile', 3: 'address', 4: 'opening' };
    }

    const rows: ParsedRow[] = [];
    const usedCodes = new Set<string>();

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i];
      if (!line || !line.some(c => c.trim().length > 0)) continue;

      const item: Record<string, any> = {};
      line.forEach((cell, cellIdx) => {
        const key = finalHeaderMap[cellIdx];
        if (key) {
          item[key] = cell.trim();
        }
      });

      const rowNum = i + 1;
      let valid = true;
      let error = '';

      const name = String(item.name ?? '').trim();
      if (!name) {
        valid = false;
        error = isBn ? 'নাম আবশ্যক' : 'Name is required';
      }

      if (kind === 'product') {
        const priceNum = parseNum(toEnDigits(String(item.price ?? '')));
        if (!Number.isFinite(priceNum) || priceNum <= 0) {
          valid = false;
          error = isBn ? 'বিক্রয় মূল্য ০-এর বেশি হতে হবে' : 'Sale price must be > 0';
        } else {
          item.price = priceNum;
        }

        const costNum = parseNum(toEnDigits(String(item.cost ?? '0')));
        item.cost = Number.isFinite(costNum) && costNum >= 0 ? costNum : 0;

        const openingNum = parseNum(toEnDigits(String(item.opening ?? '0')));
        item.opening = Number.isFinite(openingNum) && openingNum >= 0 ? openingNum : 0;

        const bagKgNum = parseNum(toEnDigits(String(item.bagKg ?? '50')));
        item.bagKg = Number.isFinite(bagKgNum) && bagKgNum > 0 ? bagKgNum : 50;
        item.uom = String(item.uom ?? 'বস্তা').trim() || 'বস্তা';
      } else {
        const openingNum = parseNum(toEnDigits(String(item.opening ?? '0')));
        item.opening = Number.isFinite(openingNum) ? openingNum : 0;
      }

      const code = String(item.code ?? '').trim();
      if (code) {
        const codeLower = code.toLowerCase();
        if (usedCodes.has(codeLower)) {
          valid = false;
          error = isBn ? `ডুপ্লিকেট কোড '${code}'` : `Duplicate code '${code}'`;
        } else {
          usedCodes.add(codeLower);
        }
      }

      rows.push({
        rowNum,
        valid,
        error: error || undefined,
        data: item,
      });
    }

    setParsedRows(rows);
    setHasParsed(true);
    setImportReport(null);
  };

  const validRows = useMemo(() => parsedRows.filter(r => r.valid), [parsedRows]);
  const invalidRows = useMemo(() => parsedRows.filter(r => !r.valid), [parsedRows]);

  const handleSubmit = async () => {
    if (!validRows.length) {
      Alert.alert(isBn ? 'সতর্কতা' : 'Warning', isBn ? 'আপলোড করার মতো কোনো বৈধ রেকর্ড পাওয়া যায়নি।' : 'No valid records to upload.');
      return;
    }

    setLoading(true);
    setImportReport(null);

    try {
      const payload = validRows.map(r => r.data);
      let result: { total: number; successCount: number; errors: any[] };

      if (kind === 'product') {
        result = await bulkUploadProducts(payload);
      } else {
        result = await bulkUploadParties(kind === 'customer' ? 'c' : 'v', payload);
      }

      setLoading(false);

      if (result.successCount > 0) {
        const msg = isBn
          ? `সফলভাবে ${result.successCount} টি রেকর্ড আপলোড করা হয়েছে!${result.errors?.length ? ` (${result.errors.length} টি ব্যর্থ)` : ''}`
          : `Successfully imported ${result.successCount} records!${result.errors?.length ? ` (${result.errors.length} failed)` : ''}`;

        Alert.alert(isBn ? 'সফল' : 'Success', msg, [
          {
            text: isBn ? 'ঠিক আছে' : 'OK',
            onPress: () => {
              onSuccess?.();
              onClose();
            },
          },
        ]);
      } else {
        const errorMsg = result.errors?.[0]?.error || (isBn ? 'আপলোড ব্যর্থ হয়েছে।' : 'Upload failed.');
        Alert.alert(isBn ? 'ব্যর্থ' : 'Failed', errorMsg);
      }
    } catch (e) {
      setLoading(false);
      Alert.alert(isBn ? 'ত্রুটি' : 'Error', e instanceof Error ? e.message : (isBn ? 'সার্ভার যোগাযোগে ব্যর্থতা।' : 'Failed to reach server.'));
    }
  };

  return (
    <DetailShell title={modalTitle} onClose={onClose} maxHeightPct="92%">
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        {/* Top instruction banner */}
        <View style={styles.topBanner}>
          <View style={styles.topBannerLeft}>
            <AppIcon name={icons.excel} size={24} iconColor="#1c70b9" />
            <View style={{ flex: 1 }}>
              <Text style={styles.bannerTitle}>
                {isBn ? 'সহজেই বাল্ক এক্সেল / CSV আপলোড করুন' : 'Easy Bulk Excel / CSV Upload'}
              </Text>
              <Text style={styles.bannerSubtitle}>
                {isBn
                  ? 'টেমপ্লেট ডাউনলোড করুন অথবা এক্সেল থেকে সরাসরি কপি করে নিচের ঘরে পেস্ট করুন।'
                  : 'Download template or copy-paste directly from Excel into the box below.'}
              </Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.templateBtn}
            onPress={handleDownloadTemplate}
            testID="bulk-download-template"
            accessibilityLabel="Download CSV Template"
          >
            <AppIcon name={icons.download} size={18} iconColor="#1c70b9" />
            <Text style={styles.templateBtnText}>{isBn ? 'টেমপ্লেট ডাউনলোড' : 'Template'}</Text>
          </TouchableOpacity>
        </View>

        {/* File chooser button (Web) */}
        {Platform.OS === 'web' && (
          <View style={styles.filePickerRow}>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />
            <TouchableOpacity
              style={styles.filePickerBtn}
              onPress={() => fileInputRef.current?.click()}
              testID="bulk-file-select"
            >
              <AppIcon name={icons.upload} size={18} iconColor="#FFFFFF" />
              <Text style={styles.filePickerBtnText}>
                {isBn ? 'CSV ফাইল সিলেক্ট করুন' : 'Choose CSV File'}
              </Text>
            </TouchableOpacity>
            <Text style={styles.orText}>{isBn ? 'অথবা নিচে পেস্ট করুন' : 'or paste below'}</Text>
          </View>
        )}

        {/* Text Input area */}
        <View style={styles.inputCard}>
          <TextInput
            multiline
            numberOfLines={6}
            value={rawText}
            onChangeText={t => {
              setRawText(t);
              setHasParsed(false);
            }}
            placeholder={placeholderText}
            placeholderTextColor="#94A3B8"
            style={styles.textArea}
            testID="bulk-text-input"
          />

          <View style={styles.parseActions}>
            <TouchableOpacity
              style={[styles.parseBtn, !rawText.trim() && styles.btnDisabled]}
              disabled={!rawText.trim()}
              onPress={() => validateAndPreview()}
              testID="bulk-parse-btn"
            >
              <AppIcon name={icons.search} size={16} iconColor="#FFFFFF" />
              <Text style={styles.parseBtnText}>
                {isBn ? 'যাচাই ও প্রিভিউ দেখুন' : 'Parse & Preview'}
              </Text>
            </TouchableOpacity>
            {rawText.trim().length > 0 && (
              <TouchableOpacity
                style={styles.clearBtn}
                onPress={() => {
                  setRawText('');
                  setParsedRows([]);
                  setHasParsed(false);
                }}
              >
                <Text style={styles.clearBtnText}>{isBn ? 'পরিষ্কার করুন' : 'Clear'}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Preview section */}
        {hasParsed && (
          <View style={styles.previewSection}>
            <View style={styles.summaryBar}>
              <View style={styles.summaryBadgeTotal}>
                <Text style={styles.summaryBadgeText} testID="bulk-summary-total">
                  {isBn ? `মোট: ${toBnDigits(parsedRows.length)}` : `Total: ${parsedRows.length}`}
                </Text>
              </View>
              <View style={styles.summaryBadgeValid}>
                <Text style={styles.summaryBadgeValidText} testID="bulk-summary-valid">
                  {isBn ? `বৈধ: ${toBnDigits(validRows.length)}` : `Valid: ${validRows.length}`}
                </Text>
              </View>
              {invalidRows.length > 0 && (
                <View style={styles.summaryBadgeInvalid}>
                  <Text style={styles.summaryBadgeInvalidText} testID="bulk-summary-invalid">
                    {isBn ? `ত্রুটিযুক্ত: ${toBnDigits(invalidRows.length)}` : `Invalid: ${invalidRows.length}`}
                  </Text>
                </View>
              )}
            </View>

            {parsedRows.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>
                  {isBn ? 'কোনো তথ্য পাওয়া যায়নি।' : 'No data found to preview.'}
                </Text>
              </View>
            ) : (
              <ScrollView horizontal style={styles.tableScroll} showsHorizontalScrollIndicator={true}>
                <View style={styles.table}>
                  {/* Table Header */}
                  <View style={styles.tableHeaderRow}>
                    <Text style={[styles.th, { width: 50 }]}>#</Text>
                    <Text style={[styles.th, { width: 80 }]}>{isBn ? 'অবস্থা' : 'Status'}</Text>
                    <Text style={[styles.th, { width: 90 }]}>{isBn ? 'কোড' : 'Code'}</Text>
                    <Text style={[styles.th, { width: 160 }]}>{isBn ? 'নাম' : 'Name'}</Text>
                    {kind === 'product' ? (
                      <>
                        <Text style={[styles.th, { width: 90, textAlign: 'right' }]}>{isBn ? 'বিক্রয় দর' : 'Price'}</Text>
                        <Text style={[styles.th, { width: 90, textAlign: 'right' }]}>{isBn ? 'ক্রয় দর' : 'Cost'}</Text>
                        <Text style={[styles.th, { width: 90, textAlign: 'right' }]}>{isBn ? 'মজুদ (কেজি)' : 'Opening Kg'}</Text>
                        <Text style={[styles.th, { width: 80 }]}>{isBn ? 'বস্তা ওজন' : 'Bag Kg'}</Text>
                      </>
                    ) : (
                      <>
                        <Text style={[styles.th, { width: 120 }]}>{isBn ? 'মোবাইল' : 'Mobile'}</Text>
                        <Text style={[styles.th, { width: 140 }]}>{isBn ? 'ঠিকানা' : 'Address'}</Text>
                        <Text style={[styles.th, { width: 100, textAlign: 'right' }]}>
                          {kind === 'customer' ? (isBn ? 'পূর্বের বাকি' : 'Opening Due') : (isBn ? 'পূর্বের দেনা' : 'Opening Pay')}
                        </Text>
                      </>
                    )}
                    <Text style={[styles.th, { width: 150 }]}>{isBn ? 'মন্তব্য/ত্রুটি' : 'Remark/Error'}</Text>
                  </View>

                  {/* Table Rows */}
                  {parsedRows.map((r, idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.tableRow,
                        !r.valid ? styles.tableRowInvalid : idx % 2 === 1 ? styles.tableRowAlt : null,
                      ]}
                    >
                      <Text style={[styles.td, { width: 50 }]}>{r.rowNum}</Text>
                      <View style={{ width: 80, justifyContent: 'center' }}>
                        <View style={r.valid ? styles.pillValid : styles.pillInvalid}>
                          <Text style={r.valid ? styles.pillValidText : styles.pillInvalidText}>
                            {r.valid ? (isBn ? 'বৈধ' : 'Valid') : (isBn ? 'ত্রুটি' : 'Error')}
                          </Text>
                        </View>
                      </View>
                      <Text style={[styles.td, { width: 90, fontWeight: '600' }]}>{r.data.code || '-'}</Text>
                      <Text style={[styles.td, { width: 160 }]} numberOfLines={1}>{r.data.name || '-'}</Text>

                      {kind === 'product' ? (
                        <>
                          <Text style={[styles.td, { width: 90, textAlign: 'right', fontWeight: '700' }]}>
                            {r.data.price !== undefined ? m(r.data.price) : '-'}
                          </Text>
                          <Text style={[styles.td, { width: 90, textAlign: 'right' }]}>
                            {r.data.cost !== undefined ? m(r.data.cost) : '-'}
                          </Text>
                          <Text style={[styles.td, { width: 90, textAlign: 'right' }]}>
                            {r.data.opening !== undefined ? `${n(r.data.opening)} কেজি` : '-'}
                          </Text>
                          <Text style={[styles.td, { width: 80 }]}>
                            {r.data.bagKg !== undefined ? `${n(r.data.bagKg)} কেজি` : '-'}
                          </Text>
                        </>
                      ) : (
                        <>
                          <Text style={[styles.td, { width: 120 }]}>{r.data.mobile || '-'}</Text>
                          <Text style={[styles.td, { width: 140 }]} numberOfLines={1}>{r.data.address || '-'}</Text>
                          <Text style={[styles.td, { width: 100, textAlign: 'right', fontWeight: '700' }]}>
                            {r.data.opening !== undefined ? m(r.data.opening) : '-'}
                          </Text>
                        </>
                      )}

                      <Text
                        style={[
                          styles.td,
                          { width: 150, color: r.valid ? '#16A34A' : '#DC2626', fontSize: 12 },
                        ]}
                        numberOfLines={1}
                      >
                        {r.error || (isBn ? 'ঠিক আছে' : 'OK')}
                      </Text>
                    </View>
                  ))}
                </View>
              </ScrollView>
            )}
          </View>
        )}

        {/* Submit & Cancel Actions */}
        <View style={styles.footerRow}>
          <TouchableOpacity
            style={styles.cancelActionBtn}
            onPress={onClose}
            disabled={loading}
          >
            <Text style={styles.cancelActionText}>{isBn ? 'বাতিল' : 'Cancel'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.submitActionBtn,
              (!validRows.length || loading) && styles.btnDisabled,
            ]}
            disabled={!validRows.length || loading}
            onPress={handleSubmit}
            testID="bulk-submit-btn"
          >
            {loading ? (
              <ActivityIndicator color="#FFFFFF" size="small" />
            ) : (
              <>
                <AppIcon name={icons.upload} size={18} iconColor="#FFFFFF" />
                <Text style={styles.submitActionText}>
                  {isBn
                    ? `আপলোড করুন (${validRows.length})`
                    : `Upload Now (${validRows.length})`}
                </Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </DetailShell>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    padding: 14,
    gap: 12,
  },
  topBanner: {
    backgroundColor: '#EFF6FF',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap',
  },
  topBannerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 220,
  },
  bannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E3A8A',
  },
  bannerSubtitle: {
    fontSize: 12,
    color: '#475569',
    marginTop: 2,
  },
  templateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },
  templateBtnText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1c70b9',
  },
  filePickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  filePickerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1c70b9',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  filePickerBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  orText: {
    fontSize: 13,
    color: '#64748B',
  },
  inputCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    gap: 8,
  },
  textArea: {
    fontFamily: Platform.OS === 'web' ? 'monospace' : undefined,
    fontSize: 13,
    color: '#0F172A',
    minHeight: 110,
    maxHeight: 160,
    textAlignVertical: 'top',
    padding: 8,
    backgroundColor: '#F8FAFC',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    outlineStyle: 'none',
  } as any,
  parseActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  parseBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563EB',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
  },
  parseBtnText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  clearBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  clearBtnText: {
    color: '#64748B',
    fontSize: 13,
  },
  previewSection: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
    gap: 8,
  },
  summaryBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  summaryBadgeTotal: {
    backgroundColor: '#F1F5F9',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  summaryBadgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
  summaryBadgeValid: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  summaryBadgeValidText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#15803D',
  },
  summaryBadgeInvalid: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  summaryBadgeInvalidText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#B91C1C',
  },
  emptyWrap: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    color: '#94A3B8',
    fontSize: 14,
  },
  tableScroll: {
    maxHeight: 240,
  },
  table: {
    minWidth: 500,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    paddingVertical: 8,
    paddingHorizontal: 6,
    borderBottomWidth: 1.5,
    borderBottomColor: '#CBD5E1',
    alignItems: 'center',
  },
  th: {
    fontSize: 12,
    fontWeight: '700',
    color: '#475569',
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#F1F5F9',
    alignItems: 'center',
  },
  tableRowAlt: {
    backgroundColor: '#F8FAFC',
  },
  tableRowInvalid: {
    backgroundColor: '#FFF1F2',
  },
  td: {
    fontSize: 12,
    color: '#0F172A',
    paddingHorizontal: 4,
  },
  pillValid: {
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  pillValidText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#16A34A',
  },
  pillInvalid: {
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    alignSelf: 'flex-start',
  },
  pillInvalidText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#DC2626',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#E2E8F0',
  },
  cancelActionBtn: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#F1F5F9',
  },
  cancelActionText: {
    color: '#475569',
    fontSize: 14,
    fontWeight: '600',
  },
  submitActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: '#16A34A',
  },
  submitActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  btnDisabled: {
    opacity: 0.5,
  },
});
