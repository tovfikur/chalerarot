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
import { showEntryError } from './entryDialog';

export type BulkKind = 'product' | 'customer' | 'vendor';

interface BulkUploadModalProps {
  kind: BulkKind;
  onClose: () => void;
  onSuccess?: () => void;
}

export type ParsedRow = {
  rowNum: number;
  valid: boolean;
  imported?: boolean;
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
  return h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s_\-\.\(\)]/g, '');
};

const readUploadNumber = (value: unknown, fallback = 0) => {
  const raw = String(value ?? '').trim();
  if (!raw) return { value: fallback, valid: true };
  const parsed = Number(toEnDigits(raw).replace(/,/g, ''));
  return { value: parsed, valid: Number.isFinite(parsed) };
};

const mapHeaders = (rawHeaders: string[], kind: BulkKind): Record<number, string> => {
  const indexToKey: Record<number, string> = {};

  rawHeaders.forEach((h, index) => {
    const norm = normalizeHeader(h);
    if (kind === 'product' && ['costperbag', 'bagcost', 'purchasecostperbag'].includes(norm)) {
      indexToKey[index] = 'costPerBag';
      return;
    }
    if (kind === 'product' && ['openingbags', 'openingbag', 'openingqtybags', 'openingqtyinbags', 'openingstockbags', 'openingquantitybags', 'qtybags', 'bags'].includes(norm)) {
      indexToKey[index] = 'openingBags';
      return;
    }
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
  const { bulkUploadProducts, bulkUploadParties, products, customers, vendors, lang, business } = useApp();
  const m = useMoney();
  const n = useNum();
  const fileInputRef = useRef<any>(null);

  const [rawText, setRawText] = useState('');
  const [parsedRows, setParsedRows] = useState<ParsedRow[]>([]);
  const [hasParsed, setHasParsed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [importReport, setImportReport] = useState<string | null>(null);
  const [importReportSuccess, setImportReportSuccess] = useState(false);
  const [showErrorsOnly, setShowErrorsOnly] = useState(false);
  const [editRows, setEditRows] = useState(false);

  const isBn = lang === 'bn';

  const modalTitle = useMemo(() => {
    if (kind === 'product') return isBn ? 'বাল্ক পণ্য আপলোড' : 'Bulk Product Upload';
    if (kind === 'customer') return isBn ? 'বাল্ক কাস্টমার আপলোড' : 'Bulk Customer Upload';
    return isBn ? 'বাল্ক সরবরাহকারী আপলোড' : 'Bulk Vendor Upload';
  }, [kind, isBn]);

  const templateCsv = useMemo(() => {
    if (kind === 'product') {
      return 'code,name,costPerBag,openingBags,bagKg,uom,description\n' +
        'BR-28,BR-28 Rice,2600,100,50,বস্তা,ভালো মানের চাল\n' +
        'MIN-50,Miniket Rice,3250,200,50,বস্তা,কুষ্টিয়ার প্রিমিয়াম মিনিকেট\n';
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
        ? 'এখানে CSV বা Excel থেকে কপি করে পেস্ট করুন:\ncode,name,costPerBag,openingBags,bagKg,uom,description\nBR-28,BR-28 Rice,2600,100,50,বস্তা,ভালো মানের চাল'
        : 'Paste CSV or copy from Excel here:\ncode,name,costPerBag,openingBags,bagKg,uom,description\nBR-28,BR-28 Rice,2600,100,50,বস্তা,Standard rice';
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
        ? { 0: 'code', 1: 'name', 2: 'costPerBag', 3: 'openingBags', 4: 'bagKg', 5: 'uom', 6: 'description' }
        : { 0: 'code', 1: 'name', 2: 'mobile', 3: 'address', 4: 'opening' };
    }

    const rows: ParsedRow[] = [];
    const usedCodes = new Map<string, number>();
    const existingCodes = new Set([...products, ...customers, ...vendors]
      .map(row => String(row.code ?? '').trim().toUpperCase()).filter(Boolean));

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
      const rowErrors: string[] = [];
      const addError = (message: string) => { if (!rowErrors.includes(message)) rowErrors.push(message); };
      const name = String(item.name ?? '').trim();
      if (!name) addError('Name is required');

      if (kind === 'product') {
        const salePrice = readUploadNumber(item.price, 0);
        if (!salePrice.valid || salePrice.value < 0) addError('Sale price must be a valid non-negative number');
        item.price = salePrice.valid ? salePrice.value : 0;

        const bagInput = readUploadNumber(item.bagKg, 50);
        if (!bagInput.valid || bagInput.value <= 0) addError('Bag weight must be greater than 0 kg');
        item.bagKg = bagInput.valid && bagInput.value > 0 ? bagInput.value : 50;

        if (item.costPerBag !== undefined) {
          const costInput = readUploadNumber(item.costPerBag, 0);
          if (!costInput.valid || costInput.value < 0) addError('Cost per bag must be a non-negative number');
          item.costPerBag = costInput.valid && costInput.value >= 0 ? costInput.value : 0;
          item.cost = Math.round((item.costPerBag / item.bagKg) * 100) / 100;
        } else {
          const costInput = readUploadNumber(item.cost, 0);
          if (!costInput.valid || costInput.value < 0) addError('Cost per kg must be a non-negative number');
          item.cost = costInput.valid && costInput.value >= 0 ? costInput.value : 0;
          item.costPerBag = Math.round(item.cost * item.bagKg * 100) / 100;
        }

        if (item.openingBags !== undefined) {
          const openingInput = readUploadNumber(item.openingBags, 0);
          if (!openingInput.valid || (!business.allowNegativeStock && openingInput.value < 0)) addError('Opening bag quantity cannot be negative unless negative stock is enabled');
          item.openingBags = openingInput.valid && (business.allowNegativeStock || openingInput.value >= 0) ? openingInput.value : 0;
          item.opening = Math.round(item.openingBags * item.bagKg * 100) / 100;
        } else {
          const openingInput = readUploadNumber(item.opening, 0);
          if (!openingInput.valid || (!business.allowNegativeStock && openingInput.value < 0)) addError('Opening stock cannot be negative unless negative stock is enabled');
          item.opening = openingInput.valid && (business.allowNegativeStock || openingInput.value >= 0) ? openingInput.value : 0;
          item.openingBags = Math.round((item.opening / item.bagKg) * 100) / 100;
        }
        item.uom = String(item.uom ?? '').trim() || 'bag';
      } else {
        const openingInput = readUploadNumber(item.opening, 0);
        item.opening = openingInput.valid ? openingInput.value : 0;
        if (!openingInput.valid) addError('Opening balance must be a valid number');
      }

      const code = String(item.code ?? '').trim();
      if (kind !== 'product' && !code) addError(`${kind === 'customer' ? 'Customer' : 'Supplier'} code is required`);
      if (code) {
        const codeKey = code.toUpperCase();
        if (!/^[A-Z0-9][A-Z0-9._/-]{0,49}$/.test(codeKey)) {
          addError('Code must use English letters or numbers; hyphen, underscore, dot and slash are allowed');
        }
        if (existingCodes.has(codeKey)) {
          addError(`Code '${code}' already exists`);
        } else if (usedCodes.has(codeKey)) {
          const message = `Duplicate code '${code}' in this file`;
          addError(message);
          const prior = rows[usedCodes.get(codeKey)!];
          if (prior) {
            prior.valid = false;
            prior.error = [prior.error, message].filter(Boolean).join('\n');
          }
        } else {
          usedCodes.set(codeKey, rows.length);
        }
      }

      rows.push({ rowNum, valid: rowErrors.length === 0, error: rowErrors.length ? rowErrors.join('\n') : undefined, data: item });
    }

    setParsedRows(rows);
    setHasParsed(true);
    setImportReport(null);
    setShowErrorsOnly(false);
  };

  const validRows = useMemo(() => parsedRows.filter(r => r.valid && !r.imported), [parsedRows]);
  const invalidRows = useMemo(() => parsedRows.filter(r => !r.valid), [parsedRows]);
  const previewRows = useMemo(() => showErrorsOnly ? parsedRows.filter(r => !r.valid) : parsedRows, [parsedRows, showErrorsOnly]);

  const revalidateEditedRows = (candidateRows: ParsedRow[]) => {
    const knownCodes = new Set([...products, ...customers, ...vendors]
      .map(row => String(row.code ?? '').trim().toUpperCase()).filter(Boolean));
    const errors = candidateRows.map(() => [] as string[]);
    const dataRows = candidateRows.map(row => ({ ...row.data }));
    const seenCodes = new Map<string, number>();

    candidateRows.forEach((row, index) => {
      if (row.imported) return;
      const data = dataRows[index];
      if (!String(data.name ?? '').trim()) errors[index].push('Name is required');
      const code = String(data.code ?? '').trim();
      if (kind !== 'product' && !code) errors[index].push(`${kind === 'customer' ? 'Customer' : 'Supplier'} code is required`);
      const key = code.toUpperCase();
      if (code && !/^[A-Z0-9][A-Z0-9._/-]{0,49}$/.test(key)) errors[index].push('Code must use English letters or numbers; hyphen, underscore, dot and slash are allowed');
      if (code && knownCodes.has(key)) errors[index].push(`Code '${code}' already exists`);
      if (code && seenCodes.has(key)) {
        errors[index].push(`Duplicate code '${code}' in this file`);
        errors[seenCodes.get(key)!].push(`Duplicate code '${code}' in this file`);
      } else if (code) seenCodes.set(key, index);

      if (kind === 'product') {
        const bag = readUploadNumber(data.bagKg, 50);
        if (!bag.valid || bag.value <= 0) errors[index].push('Bag weight must be greater than 0 kg');
        const bagKg = bag.valid && bag.value > 0 ? bag.value : 50;
        const costPerBag = readUploadNumber(data.costPerBag, 0);
        if (!costPerBag.valid || costPerBag.value < 0) errors[index].push('Cost per bag must be a non-negative number');
        const openingBags = readUploadNumber(data.openingBags, 0);
        if (!openingBags.valid || (!business.allowNegativeStock && openingBags.value < 0)) errors[index].push('Opening bag quantity cannot be negative unless negative stock is enabled');
        data.bagKg = bag.valid ? bag.value : data.bagKg;
        data.costPerBag = costPerBag.valid ? costPerBag.value : data.costPerBag;
        data.openingBags = openingBags.valid ? openingBags.value : data.openingBags;
        data.cost = Math.round(((costPerBag.valid ? costPerBag.value : 0) / bagKg) * 100) / 100;
        data.opening = Math.round(((openingBags.valid ? openingBags.value : 0) * bagKg) * 100) / 100;
      } else {
        const opening = readUploadNumber(data.opening, 0);
        if (!opening.valid) errors[index].push('Opening balance must be a valid number');
        if (opening.valid) data.opening = opening.value;
      }
    });

    return candidateRows.map((row, index) => row.imported ? row : {
      ...row,
      data: dataRows[index],
      valid: errors[index].length === 0,
      error: errors[index].length ? [...new Set(errors[index])].join('\n') : undefined,
    });
  };

  const updatePreviewCell = (rowNum: number, key: string, value: string) => {
    setParsedRows(current => revalidateEditedRows(current.map(row => row.rowNum === rowNum
      ? { ...row, data: { ...row.data, [key]: value } }
      : row)));
  };

  const previewCell = (row: ParsedRow, key: string, width: number, display: string, numeric = false, oneLine = false) => editRows && !row.imported
    ? <TextInput
        value={String(row.data[key] ?? '')}
        onChangeText={value => updatePreviewCell(row.rowNum, key, value)}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        accessibilityLabel={`Row ${row.rowNum} ${key}`}
        style={[styles.previewInput, { width }]}
      />
    : <Text style={[styles.td, { width }]} numberOfLines={oneLine ? 1 : undefined}>{display || '-'}</Text>;

  const handleSubmit = async () => {
    if (!validRows.length) {
      const message = lang === 'bn' ? 'আপলোড করার মতো সঠিক সারি নেই। চিহ্নিত ভুলগুলো ঠিক করে আবার চেষ্টা করুন।' : 'There are no valid rows to upload. Fix the highlighted errors and try again.';
      setImportReport(message);
      showEntryError(lang, message);
      setImportReportSuccess(false);
      return;
    }

    setLoading(true);
    setImportReport(null);
    setImportReportSuccess(false);

    try {
      const payload = validRows.map(r => ({ ...r.data, rowNum: r.rowNum }));
      const result = kind === 'product'
        ? await bulkUploadProducts(payload)
        : await bulkUploadParties(kind === 'customer' ? 'c' : 'v', payload);
      setLoading(false);

      if (result.errors?.length) {
        const errorsByRow = new Map<number, string>(result.errors.map((entry: any) => [Number(entry.row), String(entry.error ?? 'Import failed')]));
        const submittedRows = new Set(validRows.map(row => row.rowNum));
        setParsedRows(current => current.map(row => {
          const error = errorsByRow.get(row.rowNum);
          if (error) return { ...row, valid: false, error };
          if (submittedRows.has(row.rowNum)) return { ...row, imported: true };
          return row;
        }));
        setImportReport(`${result.successCount} imported; ${result.errors.length} row(s) need correction.`);
        setImportReportSuccess(false);
        if (result.successCount > 0) onSuccess?.();
        return;
      }

      if (result.successCount > 0) {
        setParsedRows(current => current.map(row => validRows.some(submitted => submitted.rowNum === row.rowNum) ? { ...row, imported: true } : row));
        setImportReport(`Successfully imported ${result.successCount} records.`);
        setImportReportSuccess(true);
        onSuccess?.();
      } else {
        setImportReport(result.errors?.[0]?.error || 'Upload failed: the server imported no rows.');
        setImportReportSuccess(false);
      }
    } catch (e) {
      setLoading(false);
      setImportReport(e instanceof Error ? e.message : 'Upload failed. Check the server connection and try again.');
      setImportReportSuccess(false);
    }
  };

  return (
    <DetailShell title={hasParsed ? `${modalTitle} · ${isBn ? 'প্রিভিউ' : 'Preview'}` : modalTitle} onClose={onClose} maxHeightPct="92%" fullScreen={hasParsed} bodyScroll={false}>
      <ScrollView style={styles.container} contentContainerStyle={styles.content} nestedScrollEnabled keyboardShouldPersistTaps="handled">
        {/* Top instruction banner */}
        {!hasParsed ? <View style={styles.topBanner}>
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
        </View> : null}

        {/* File chooser button (Web) */}
        {!hasParsed && Platform.OS === 'web' && (
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
        {!hasParsed ? <View style={styles.inputCard}>
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
        </View> : null}

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
              {parsedRows.some(row => row.imported) ? (
                <View style={styles.summaryBadgeValid}>
                  <Text style={styles.summaryBadgeValidText}>{isBn ? `যোগ হয়েছে: ${toBnDigits(parsedRows.filter(row => row.imported).length)}` : `Imported: ${parsedRows.filter(row => row.imported).length}`}</Text>
                </View>
              ) : null}
              <TouchableOpacity style={styles.clearBtn} onPress={() => setEditRows(value => !value)}>
                <Text style={[styles.clearBtnText, editRows && { color: '#1D4ED8', fontWeight: '700' }]}>{editRows ? 'Done editing' : 'Edit rows'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.clearBtn} onPress={() => setHasParsed(false)}>
                <Text style={styles.clearBtnText}>{isBn ? 'ফাইলে ফিরে যান' : 'Back to file'}</Text>
              </TouchableOpacity>
            </View>

            {kind === 'product' ? (
              <View style={styles.calculationHint}>
                <Text style={styles.calculationTitle}>{isBn ? 'স্বয়ংক্রিয় হিসাব' : 'Automatic calculations'}</Text>
                <Text style={styles.calculationText}>Cost/kg = cost per bag ÷ bag weight. Opening kg = opening bags × bag weight.</Text>
              </View>
            ) : null}

            {invalidRows.length > 0 ? (
              <View style={styles.errorBanner}>
                <View style={styles.errorIcon}><Text style={styles.errorIconText}>!</Text></View>
                <Text style={styles.errorBannerText}>
                  {invalidRows.length} {isBn ? 'টি সারিতে সমস্যা আছে। এগুলো ঠিক না করা পর্যন্ত আপলোড হবে না।' : 'row(s) have errors. Invalid rows are highlighted and skipped; fix them to include them.'}
                </Text>
                <TouchableOpacity style={styles.errorFilterButton} onPress={() => setShowErrorsOnly(value => !value)}>
                  <Text style={styles.errorFilterText}>{showErrorsOnly ? 'Show all rows' : 'Show errors only'}</Text>
                </TouchableOpacity>
              </View>
            ) : null}

            {importReport ? <View style={{ padding: 10, borderRadius: 8, backgroundColor: importReportSuccess ? '#F0FDF4' : '#FFF1F2', borderWidth: 1, borderColor: importReportSuccess ? '#86EFAC' : '#FECDD3' }}><Text style={{ color: importReportSuccess ? '#15803D' : '#B91C1C', fontWeight: '700' }}>{importReport}</Text></View> : null}

            {previewRows.length === 0 ? (
              <View style={styles.emptyWrap}>
                <Text style={styles.emptyText}>
                  {isBn ? 'কোনো তথ্য পাওয়া যায়নি।' : (showErrorsOnly ? 'No error rows to show.' : 'No data found to preview.')}
                </Text>
              </View>
            ) : (
              <ScrollView horizontal nestedScrollEnabled style={styles.tableScroll} showsHorizontalScrollIndicator={true}>
                <View style={[styles.table, { minWidth: kind === 'product' ? 1150 : 1000 }]}>
                  {/* Table Header */}
                  <View style={styles.tableHeaderRow}>
                    <Text style={[styles.th, { width: 50 }]}>#</Text>
                    <Text style={[styles.th, { width: 80 }]}>{isBn ? 'অবস্থা' : 'Status'}</Text>
                    <Text style={[styles.th, { width: 90 }]}>{isBn ? 'কোড' : 'Code'}</Text>
                    <Text style={[styles.th, { width: 160 }]}>{isBn ? 'নাম' : 'Name'}</Text>
                    {kind === 'product' ? (
                      <>
                        <Text style={[styles.th, { width: 100, textAlign: 'right' }]}>Cost/Bag</Text>
                        <Text style={[styles.th, { width: 110, textAlign: 'right' }]}>Cost/Kg (Auto)</Text>
                        <Text style={[styles.th, { width: 100, textAlign: 'right' }]}>Opening Bags</Text>
                        <Text style={[styles.th, { width: 120, textAlign: 'right' }]}>Opening Kg (Auto)</Text>
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
                    <Text style={[styles.th, { width: 260 }]}>Validation</Text>
                  </View>

                  {/* Table Rows */}
                  {previewRows.map((r, idx) => (
                    <View
                      key={idx}
                      style={[
                        styles.tableRow,
                        !r.valid ? styles.tableRowInvalid : r.imported ? styles.tableRowImported : idx % 2 === 1 ? styles.tableRowAlt : null,
                      ]}
                    >
                      <Text style={[styles.td, { width: 50 }]}>{r.rowNum}</Text>
                      <View style={{ width: 80, justifyContent: 'center' }}>
                        <View style={r.valid ? styles.pillValid : styles.pillInvalid}>
                          <Text style={r.valid ? styles.pillValidText : styles.pillInvalidText}>
                            {r.imported ? (isBn ? 'যোগ হয়েছে' : 'Imported') : r.valid ? (isBn ? 'বৈধ' : 'Valid') : (isBn ? 'ত্রুটি' : 'Error')}
                          </Text>
                        </View>
                      </View>
                      {previewCell(r, 'code', 90, r.data.code || '-')}
                      {previewCell(r, 'name', 160, r.data.name || '-', false, true)}

                      {kind === 'product' ? (
                        <>
                          {previewCell(r, 'costPerBag', 100, r.data.costPerBag !== undefined ? m(Number(r.data.costPerBag) || 0) : '-', true)}
                          <Text style={[styles.td, { width: 110, textAlign: 'right' }]}>
                            {r.data.cost !== undefined ? m(r.data.cost) : '-'}
                          </Text>
                          {previewCell(r, 'openingBags', 100, r.data.openingBags !== undefined ? n(Number(r.data.openingBags) || 0) : '-', true)}
                          <Text style={[styles.td, { width: 120, textAlign: 'right' }]}>
                            {r.data.opening !== undefined ? `${n(r.data.opening)} kg` : '-'}
                          </Text>
                          {previewCell(r, 'bagKg', 80, r.data.bagKg !== undefined ? `${n(Number(r.data.bagKg) || 0)} kg` : '-', true)}
                        </>
                      ) : (
                        <>
                          {previewCell(r, 'mobile', 120, r.data.mobile || '-')}
                          {previewCell(r, 'address', 140, r.data.address || '-', false, true)}
                          {previewCell(r, 'opening', 100, r.data.opening !== undefined ? m(Number(r.data.opening) || 0) : '-', true)}
                        </>
                      )}

                      <View style={[styles.validationCell, { width: 260 }]}><Text style={r.valid ? styles.validationReady : styles.validationError} numberOfLines={3}>{r.error || (r.imported ? 'Imported successfully' : 'Ready to import')}</Text></View>
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
            onPress={hasParsed ? () => setHasParsed(false) : onClose}
            disabled={loading}
          >
            <Text style={styles.cancelActionText}>{hasParsed ? (isBn ? 'ফাইলে ফিরে যান' : 'Back to file') : (isBn ? 'বাতিল' : 'Cancel')}</Text>
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
    flexGrow: 1,
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
    flexWrap: 'wrap',
    gap: 8,
  },
  calculationHint: { backgroundColor: '#EFF6FF', borderColor: '#BFDBFE', borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 9, gap: 3 },
  calculationTitle: { color: '#1D4ED8', fontSize: 12, fontWeight: '700' },
  calculationText: { color: '#334155', fontSize: 12 },
  errorBanner: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8, backgroundColor: '#FFF1F2', borderColor: '#FECDD3', borderWidth: 1, borderRadius: 8, padding: 10 },
  errorIcon: { width: 22, height: 22, borderRadius: 11, backgroundColor: '#DC2626', alignItems: 'center', justifyContent: 'center' },
  errorIconText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  errorBannerText: { color: '#9F1239', fontSize: 12, fontWeight: '600', flex: 1, minWidth: 200 },
  errorFilterButton: { backgroundColor: '#FFFFFF', borderColor: '#FDA4AF', borderWidth: 1, borderRadius: 6, paddingHorizontal: 10, paddingVertical: 6 },
  errorFilterText: { color: '#BE123C', fontSize: 12, fontWeight: '700' },
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
  tableScroll: { flexGrow: 0 },
  table: { alignSelf: 'flex-start' },
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
  tableRowImported: { backgroundColor: '#F0FDF4' },
  validationCell: { paddingHorizontal: 4, justifyContent: 'center' },
  validationReady: { color: '#15803D', fontSize: 11 },
  validationError: { color: '#B91C1C', fontSize: 11, fontWeight: '600' },
  td: {
    fontSize: 12,
    color: '#0F172A',
    paddingHorizontal: 4,
  },
  previewInput: {
    minHeight: 30,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 5,
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
    fontSize: 12,
    paddingHorizontal: 6,
    paddingVertical: 3,
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
