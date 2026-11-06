import { toBnDigits } from './bn';
import { Platform } from 'react-native';
import { Lang } from './i18n';

const englishReport = (html: string, lang: Lang) => {
  if (lang !== 'en') return html;
  const labels: Record<string, string> = {
    'বিক্রয়': 'Sale', 'ক্রয়': 'Purchase', 'বিক্রয় ফেরত': 'Sales return', 'ক্রয় ফেরত': 'Purchase return',
    'প্রারম্ভিক মজুদ': 'Opening stock', 'স্টক সমন্বয়': 'Stock adjustment', 'নষ্ট চাল': 'Damaged stock', 'মুভমেন্ট': 'Movement',
    'চালের আড়ৎ': 'Chaler Arot', 'তারিখ:': 'Date:', 'পণ্য কোড': 'Product code', 'পণ্যের নাম': 'Product name',
    'বস্তার সাইজ': 'Bag size', 'বস্তার সাইজ (কেজি)': 'Bag size (kg)', 'মজুদ (বস্তা)': 'Stock (bags)', 'মজুদ (কেজি)': 'Stock (kg)',
    'ক্রয় দর': 'Purchase rate', 'বিক্রয় দর': 'Sale rate', 'স্টক মূল্য (৳)': 'Stock value (৳)', 'মুভমেন্ট টাইপ': 'Movement type',
    'পরিমাণ (কেজি)': 'Quantity (kg)', 'সর্বমোট': 'Total', 'সর্বমোট:': 'Total:',
    'প্রিন্টের তারিখ:': 'Printed on:', 'প্রিন্টের সময়:': 'Printed at:', 'মোট আইটেম সংখ্যা:': 'Total items:',
    'মোট মজুদ (বস্তা)': 'Total stock (bags)', 'মোট মজুদ (কেজি)': 'Total stock (kg)', 'মোট স্টক মূল্যায়ন (৳)': 'Total stock value (৳)',
    'ফিল্টার:': 'Filter:', 'মোট পণ্য সংখ্যা:': 'Products:', 'মোট বস্তা:': 'Bags:', 'মোট কেজি:': 'Kilograms:',
    'মোট স্টক মূল্য (৳):': 'Stock value (৳):', 'চালের আড়ৎ - পাইকারি চালের মজুদ ও স্টক বিবরণী': 'Chaler Arot - Rice inventory report',
    'চালের আড়ৎ - স্টক মুভমেন্ট বিবরণী': 'Chaler Arot - Stock movement report', 'মজুদ চাল ও স্টক বিবরণী রিপোর্ট': 'Rice inventory report',
    'মজুদ চাল ও স্টক মূল্যায়ন বিবরণী রিপোর্ট': 'Rice inventory valuation report', 'স্টক মুভমেন্ট রিপোর্ট': 'Stock movement report',
    'স্টক মুভমেন্ট বিবরণী রিপোর্ট': 'Stock movement report', 'প্রিন্ট / পিডিএফ হিসেবে সংরক্ষণ (Save as PDF)': 'Print / Save as PDF',
    'বন্ধ করুন': 'Close', 'টি': '', 'এটি একটি কম্পিউটার জেনারেটেড রিপোর্ট • চালের আড়ৎ ম্যানেজমেন্ট সিস্টেম': 'This is a computer generated report • Chaler Arot Management System',
  };
  let result = html.replace(/[০-৯]/g, digit => String('০১২৩৪৫৬৭৮৯'.indexOf(digit))).replace(/ঢাকা/g, 'Dhaka');
  for (const [bn, en] of Object.entries(labels).sort(([a], [b]) => b.length - a.length)) result = result.replaceAll(bn, en);
  return result.replace('<html lang="bn">', '<html lang="en">');
};

const esc = (s: any) => String(s ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

export const movementTypeLabel = (type: string, lang: Lang = 'bn'): string => {
  const labels: Record<string, [string, string]> = {
    SALE: ['বিক্রয়', 'Sale'], PURCHASE: ['ক্রয়', 'Purchase'], SRETURN: ['বিক্রয় ফেরত', 'Sales return'],
    PRETURN: ['ক্রয় ফেরত', 'Purchase return'], OPENING: ['প্রারম্ভিক মজুদ', 'Opening stock'],
    ADJUST: ['স্টক সমন্বয়', 'Stock adjustment'], DAMAGE: ['নষ্ট চাল', 'Damaged stock'],
    SALE_EDIT_REVERSAL: ['বিক্রয় সংশোধন', 'Sale edit reversal'],
    PURCHASE_EDIT_REVERSAL: ['ক্রয় সংশোধন', 'Purchase edit reversal'],
  };
  labels.NEGATIVE_STOCK_COGS_ADJUSTMENT = ['Negative stock COGS adjustment', 'Negative stock COGS adjustment'];
  const key = type?.toUpperCase();
  if (labels[key]) return labels[key][lang === 'bn' ? 0 : 1];
  switch (type?.toUpperCase()) {
    default: return type || (lang === 'bn' ? 'মুভমেন্ট' : 'Movement');
  }
};

export function downloadCSV(filename: string, csvContent: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch (err) {
    console.error('CSV download error:', err);
    return false;
  }
}

export function exportStockExcel({
  activeTab,
  items,
  movements,
  totalBags,
  totalKg,
  totalValuation,
  lang = 'bn',
}: {
  activeTab: 'products' | 'movements';
  items: Array<{
    code: string;
    name: string;
    bags: number;
    totalKg: number;
    stockVal: number;
    product: {
      cost?: number;
      price?: number;
      mediumBagKg?: number;
      uom?: string;
    };
  }>;
  movements: Array<{
    id: string;
    date: string;
    productName?: string;
    type: string;
    qty: number;
  }>;
  totalBags: number;
  totalKg: number;
  totalValuation: number;
  lang?: Lang;
}): boolean {
  const dateStr = new Date().toISOString().slice(0, 10);
  const escapeCsv = (val: any) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  if (activeTab === 'products') {
    const lines: string[] = [
      ['চালের আড়ৎ - পাইকারি চালের মজুদ ও স্টক বিবরণী'].map(escapeCsv).join(','),
      ['তারিখ:', dateStr].map(escapeCsv).join(','),
      ['মোট পণ্য সংখ্যা:', items.length, 'মোট বস্তা:', totalBags, 'মোট কেজি:', Math.round(totalKg), 'মোট স্টক মূল্য (৳):', Math.round(totalValuation)].map(escapeCsv).join(','),
      '',
      ['#', 'পণ্য কোড', 'পণ্যের নাম', 'বস্তার সাইজ (কেজি)', 'মজুদ (বস্তা)', 'মজুদ (কেজি)', 'ক্রয় দর (৳/কেজি)', 'বিক্রয় দর (৳/কেজি)', 'মোট স্টক মূল্য (৳)'].map(escapeCsv).join(','),
    ];

    items.forEach((it, idx) => {
      lines.push([
        idx + 1,
        it.code || '-',
        it.name,
        it.product.mediumBagKg || 50,
        it.bags,
        Math.round(it.totalKg),
        it.product.cost || 0,
        it.product.price || 0,
        Math.round(it.stockVal),
      ].map(escapeCsv).join(','));
    });

    lines.push([
      'সর্বমোট',
      '',
      '',
      '',
      totalBags,
      Math.round(totalKg),
      '',
      '',
      Math.round(totalValuation),
    ].map(escapeCsv).join(','));

    return downloadCSV(`chaler_stock_${dateStr}.csv`, englishReport(lines.join('\r\n'), lang));
  } else {
    const lines: string[] = [
      ['চালের আড়ৎ - স্টক মুভমেন্ট বিবরণী'].map(escapeCsv).join(','),
      ['তারিখ:', dateStr].map(escapeCsv).join(','),
      '',
      ['#', 'তারিখ', 'পণ্যের নাম', 'মুভমেন্ট টাইপ', 'পরিমাণ (কেজি)'].map(escapeCsv).join(','),
    ];

    movements.forEach((mv, idx) => {
      lines.push([
        idx + 1,
        mv.date,
        mv.productName || 'পণ্য',
        movementTypeLabel(mv.type),
        mv.qty,
      ].map(escapeCsv).join(','));
    });

    return downloadCSV(`chaler_stock_movements_${dateStr}.csv`, englishReport(lines.join('\r\n'), lang));
  }
}

export function buildStockReportHTML({
  activeTab,
  items,
  movements,
  totalBags,
  totalKg,
  totalValuation,
  searchQuery,
  lang = 'bn',
}: {
  activeTab: 'products' | 'movements';
  items: Array<{
    code: string;
    name: string;
    bags: number;
    totalKg: number;
    stockVal: number;
    product: {
      cost?: number;
      price?: number;
      mediumBagKg?: number;
      uom?: string;
    };
  }>;
  movements: Array<{
    id: string;
    date: string;
    productName?: string;
    type: string;
    qty: number;
  }>;
  totalBags: number;
  totalKg: number;
  totalValuation: number;
  searchQuery?: string;
  lang?: Lang;
}): string {
  const isProducts = activeTab === 'products';
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB');
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  const rowsHtml = isProducts
    ? items.map((it, idx) => `
      <tr>
        <td style="text-align: center; color: #64748B;">${toBnDigits(String(idx + 1))}</td>
        <td style="font-weight: 700; color: #1E293B;">${esc(it.code || '-')}</td>
        <td style="font-weight: 600; color: #0F172A;">${esc(it.name)}</td>
        <td style="text-align: center; color: #475569;">${toBnDigits(String(it.product.mediumBagKg || 50))} কেজি</td>
        <td style="text-align: right; font-weight: 700; color: #0F172A;">${toBnDigits(it.bags.toLocaleString('en-IN'))}</td>
        <td style="text-align: right; color: #334155;">${toBnDigits(Math.round(it.totalKg).toLocaleString('en-IN'))}</td>
        <td style="text-align: right; color: #475569;">৳${toBnDigits(String(it.product.cost || 0))}</td>
        <td style="text-align: right; color: #475569;">৳${toBnDigits(String(it.product.price || 0))}</td>
        <td style="text-align: right; font-weight: 800; color: #1c70b9;">৳${toBnDigits(Math.round(it.stockVal).toLocaleString('en-IN'))}</td>
      </tr>
    `).join('')
    : movements.map((mv, idx) => `
      <tr>
        <td style="text-align: center; color: #64748B;">${toBnDigits(String(idx + 1))}</td>
        <td style="color: #334155;">${esc(toBnDigits(mv.date))}</td>
        <td style="font-weight: 600; color: #0F172A;">${esc(mv.productName || 'পণ্য')}</td>
        <td style="font-weight: 700; color: #1E293B;">${esc(movementTypeLabel(mv.type))}</td>
        <td style="text-align: right; font-weight: 800; color: ${mv.qty >= 0 ? '#16A34A' : '#DC2626'};">
          ${toBnDigits(String(mv.qty))} কেজি
        </td>
      </tr>
    `).join('');

  const tableHeader = isProducts
    ? `
      <tr>
        <th style="width: 45px; text-align: center;">#</th>
        <th style="width: 100px;">পণ্য কোড</th>
        <th>পণ্যের নাম</th>
        <th style="width: 90px; text-align: center;">বস্তার সাইজ</th>
        <th style="width: 100px; text-align: right;">মজুদ (বস্তা)</th>
        <th style="width: 110px; text-align: right;">মজুদ (কেজি)</th>
        <th style="width: 95px; text-align: right;">ক্রয় দর</th>
        <th style="width: 95px; text-align: right;">বিক্রয় দর</th>
        <th style="width: 125px; text-align: right;">স্টক মূল্য (৳)</th>
      </tr>
    `
    : `
      <tr>
        <th style="width: 45px; text-align: center;">#</th>
        <th style="width: 120px;">তারিখ</th>
        <th>পণ্যের নাম</th>
        <th style="width: 140px;">মুভমেন্ট টাইপ</th>
        <th style="width: 140px; text-align: right;">পরিমাণ (কেজি)</th>
      </tr>
    `;

  const tableFooter = isProducts
    ? `
      <tfoot>
        <tr style="background: #F1F5F9; font-weight: 800; border-top: 2px solid #0F172A;">
          <td colspan="4" style="padding: 10px; text-align: right; font-size: 15px; color: #0F172A;">সর্বমোট:</td>
          <td style="padding: 10px; text-align: right; font-size: 16px; color: #0F172A;">${toBnDigits(totalBags.toLocaleString('en-IN'))} বস্তা</td>
          <td style="padding: 10px; text-align: right; font-size: 15px; color: #0F172A;">${toBnDigits(Math.round(totalKg).toLocaleString('en-IN'))} কেজি</td>
          <td colspan="2"></td>
          <td style="padding: 10px; text-align: right; font-size: 17px; color: #1c70b9;">৳${toBnDigits(Math.round(totalValuation).toLocaleString('en-IN'))}</td>
        </tr>
      </tfoot>
    `
    : '';

  const html = `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${isProducts ? 'মজুদ চাল ও স্টক বিবরণী রিপোর্ট' : 'স্টক মুভমেন্ট রিপোর্ট'} - চালের আড়ৎ</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 24px;
      color: #0F172A;
      background: #FFFFFF;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .report-wrap {
      max-width: 1000px;
      margin: 0 auto;
    }
    .header-box {
      border-bottom: 2.5px solid #1c70b9;
      padding-bottom: 14px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .shop-title {
      font-size: 24px;
      font-weight: 900;
      color: #0F172A;
      margin: 0 0 4px;
    }
    .report-title {
      font-size: 16px;
      font-weight: 700;
      color: #1c70b9;
      margin: 0;
    }
    .meta-box {
      text-align: right;
      font-size: 12px;
      color: #64748B;
      line-height: 1.5;
    }
    .kpi-banner {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }
    .kpi-card {
      flex: 1;
      background: #F8FAFC;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .kpi-label {
      font-size: 12px;
      font-weight: 700;
      color: #475569;
      margin-bottom: 4px;
    }
    .kpi-val {
      font-size: 18px;
      font-weight: 900;
      color: #0F172A;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 13px;
      margin-bottom: 24px;
    }
    .data-table thead {
      display: table-header-group;
    }
    .data-table th {
      background: #F1F5F9;
      color: #1E293B;
      font-weight: 700;
      padding: 8px 10px;
      text-align: left;
      border-top: 1.5px solid #CBD5E1;
      border-bottom: 1.5px solid #CBD5E1;
    }
    .data-table td {
      padding: 7px 10px;
      border-bottom: 1px solid #E2E8F0;
      vertical-align: middle;
    }
    .data-table tbody tr:nth-child(even) {
      background: #F8FAFC;
    }
    .data-table tr {
      page-break-inside: avoid;
    }
    .footer-note {
      text-align: center;
      font-size: 11px;
      color: #94A3B8;
      border-top: 1px dashed #CBD5E1;
      padding-top: 12px;
      margin-top: 20px;
    }
    .action-bar {
      position: fixed;
      top: 14px;
      right: 18px;
      display: flex;
      gap: 10px;
      z-index: 9999;
      background: rgba(255, 255, 255, 0.95);
      padding: 8px;
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      border: 1px solid #E2E8F0;
    }
    .btn {
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      border: none;
      transition: all 0.15s ease;
    }
    .btn-primary {
      background: #1c70b9;
      color: #FFFFFF;
    }
    .btn-primary:hover {
      background: #155d9b;
    }
    .btn-close {
      background: #E2E8F0;
      color: #334155;
    }
    .btn-close:hover {
      background: #CBD5E1;
    }
    @media print {
      body {
        padding: 0;
      }
      .action-bar {
        display: none !important;
      }
      .report-wrap {
        max-width: 100%;
      }
      .kpi-card {
        border-color: #94A3B8;
      }
      .data-table th {
        background: #F1F5F9 !important;
      }
    }
  </style>
</head>
<body>
  <div class="action-bar">
    <button class="btn btn-primary" onclick="window.print()">🖨️ প্রিন্ট / পিডিএফ হিসেবে সংরক্ষণ (Save as PDF)</button>
    <button class="btn btn-close" onclick="window.close()">✕ বন্ধ করুন</button>
  </div>

  <div class="report-wrap">
    <div class="header-box">
      <div>
        <div class="shop-title">চালের আড়ৎ</div>
        <div class="report-title">${isProducts ? 'মজুদ চাল ও স্টক মূল্যায়ন বিবরণী রিপোর্ট' : 'স্টক মুভমেন্ট বিবরণী রিপোর্ট'}</div>
        ${searchQuery ? `<div style="font-size: 12px; color: #64748B; margin-top: 3px;">ফিল্টার: "${esc(searchQuery)}"</div>` : ''}
      </div>
      <div class="meta-box">
        <div>প্রিন্টের তারিখ: <strong>${toBnDigits(dateStr)}</strong></div>
        <div>প্রিন্টের সময়: <strong>${toBnDigits(timeStr)}</strong></div>
        <div>মোট আইটেম সংখ্যা: <strong>${toBnDigits(String(isProducts ? items.length : movements.length))} টি</strong></div>
      </div>
    </div>

    ${isProducts ? `
      <div class="kpi-banner">
        <div class="kpi-card">
          <div class="kpi-label">মোট মজুদ (বস্তা)</div>
          <div class="kpi-val">${toBnDigits(totalBags.toLocaleString('en-IN'))} বস্তা</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">মোট মজুদ (কেজি)</div>
          <div class="kpi-val">${toBnDigits(Math.round(totalKg).toLocaleString('en-IN'))} কেজি</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">মোট স্টক মূল্যায়ন (৳)</div>
          <div class="kpi-val" style="color: #1c70b9;">৳${toBnDigits(Math.round(totalValuation).toLocaleString('en-IN'))}</div>
        </div>
      </div>
    ` : ''}

    <table class="data-table">
      <thead>
        ${tableHeader}
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
      ${tableFooter}
    </table>

    <div class="footer-note">
      এটি একটি কম্পিউটার জেনারেটেড রিপোর্ট • চালের আড়ৎ ম্যানেজমেন্ট সিস্টেম
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 300);
    };
  </script>
</body>
</html>`;
  return englishReport(html, lang);
}

export function exportStockPDF({
  activeTab,
  items,
  movements,
  totalBags,
  totalKg,
  totalValuation,
  searchQuery,
  lang = 'bn',
}: {
  activeTab: 'products' | 'movements';
  items: Array<{
    code: string;
    name: string;
    bags: number;
    totalKg: number;
    stockVal: number;
    product: {
      cost?: number;
      price?: number;
      mediumBagKg?: number;
      uom?: string;
    };
  }>;
  movements: Array<{
    id: string;
    date: string;
    productName?: string;
    type: string;
    qty: number;
  }>;
  totalBags: number;
  totalKg: number;
  totalValuation: number;
  searchQuery?: string;
  lang?: Lang;
}): boolean {
  if (typeof window === 'undefined') return false;
  const html = buildStockReportHTML({
    activeTab,
    items,
    movements,
    totalBags,
    totalKg,
    totalValuation,
    searchQuery,
    lang,
  });

  const w = window.open('', '_blank');
  if (!w) return false;

  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}

export type AuditRow = {
  id: string;
  code: string;
  name: string;
  bagKg: number;
  systemBags: number;
  systemKg: number;
  physicalBags: number | null;
  physicalKg: number | null;
  deltaBags: number;
  deltaKg: number;
  deltaValue: number;
  cost: number;
  reason?: string;
};

export function exportAuditExcel({
  auditRows,
  summary,
}: {
  auditRows: AuditRow[];
  summary: {
    totalItems: number;
    discrepancyCount: number;
    totalSystemBags: number;
    totalSystemKg: number;
    totalPhysicalBags: number;
    totalPhysicalKg: number;
    totalDeltaKg: number;
    totalDeltaValue: number;
  };
}): boolean {
  const dateStr = new Date().toISOString().slice(0, 10);
  const escapeCsv = (val: any) => {
    const str = String(val ?? '');
    if (str.includes(',') || str.includes('"') || str.includes('\n') || str.includes('\r')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines: string[] = [
    ['চালের আড়ৎ - ম্যানুয়াল স্টক অডিট ও নিরীক্ষা বিবরণী'].map(escapeCsv).join(','),
    ['তারিখ:', dateStr].map(escapeCsv).join(','),
    [
      'মোট অডিটকৃত পণ্য:', summary.totalItems,
      'পার্থক্যযুক্ত পণ্য:', summary.discrepancyCount,
      'মোট সিস্টেম কেজি:', Math.round(summary.totalSystemKg),
      'মোট বাস্তব কেজি:', Math.round(summary.totalPhysicalKg),
      'পার্থক্য (কেজি):', Math.round(summary.totalDeltaKg),
      'আর্থিক সমন্বয় প্রভাব (৳):', Math.round(summary.totalDeltaValue),
    ].map(escapeCsv).join(','),
    '',
    [
      '#',
      'পণ্য কোড',
      'পণ্যের নাম',
      'বস্তার সাইজ (কেজি)',
      'সিস্টেম মজুদ (বস্তা)',
      'সিস্টেম মজুদ (কেজি)',
      'বাস্তব গণনা (বস্তা)',
      'বাস্তব গণনা (কেজি)',
      'পার্থক্য (বস্তা)',
      'পার্থক্য (কেজি)',
      'গড় ক্রয় দর (৳/কেজি)',
      'আর্থিক প্রভাব (৳)',
      'কারণ / মন্তব্য',
    ].map(escapeCsv).join(','),
  ];

  auditRows.forEach((row, idx) => {
    lines.push([
      idx + 1,
      row.code || '-',
      row.name,
      row.bagKg,
      row.systemBags,
      Math.round(row.systemKg),
      row.physicalBags !== null ? row.physicalBags : '',
      row.physicalKg !== null ? Math.round(row.physicalKg) : '',
      row.deltaBags,
      Math.round(row.deltaKg),
      row.cost,
      Math.round(row.deltaValue),
      row.reason || '',
    ].map(escapeCsv).join(','));
  });

  lines.push([
    'সর্বমোট',
    '',
    '',
    '',
    summary.totalSystemBags,
    Math.round(summary.totalSystemKg),
    summary.totalPhysicalBags,
    Math.round(summary.totalPhysicalKg),
    Math.round(summary.totalDeltaKg / 50),
    Math.round(summary.totalDeltaKg),
    '',
    Math.round(summary.totalDeltaValue),
    '',
  ].map(escapeCsv).join(','));

  return downloadCSV(`stock_audit_${dateStr}.csv`, lines.join('\r\n'));
}

export function buildAuditReportHTML({
  auditRows,
  summary,
  date,
  note,
}: {
  auditRows: AuditRow[];
  summary: {
    totalItems: number;
    discrepancyCount: number;
    totalSystemBags: number;
    totalSystemKg: number;
    totalPhysicalBags: number;
    totalPhysicalKg: number;
    totalDeltaKg: number;
    totalDeltaValue: number;
  };
  date?: string;
  note?: string;
}): string {
  const now = new Date();
  const dateStr = date || now.toLocaleDateString('en-GB');
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });

  const rowsHtml = auditRows.map((r, idx) => {
    const isShortage = r.deltaKg < 0;
    const isSurplus = r.deltaKg > 0;
    const statusColor = isShortage ? '#DC2626' : isSurplus ? '#16A34A' : '#64748B';
    const statusBg = isShortage ? '#FEF2F2' : isSurplus ? '#F0FDF4' : 'transparent';
    const sign = isSurplus ? '+' : '';

    return `
      <tr style="background: ${statusBg};">
        <td style="text-align: center; color: #64748B;">${toBnDigits(String(idx + 1))}</td>
        <td style="font-weight: 700; color: #1E293B;">${esc(r.code || '-')}</td>
        <td style="font-weight: 600; color: #0F172A;">${esc(r.name)}</td>
        <td style="text-align: center; color: #475569;">${toBnDigits(String(r.bagKg))} কেজি</td>
        <td style="text-align: right; color: #334155;">
          <strong>${toBnDigits(r.systemBags.toLocaleString('en-IN'))}</strong> বস্তা
          <div style="font-size: 11px; color: #64748B;">(${toBnDigits(Math.round(r.systemKg).toLocaleString('en-IN'))} কেজি)</div>
        </td>
        <td style="text-align: right; color: #0F172A; font-weight: 700;">
          ${r.physicalBags !== null ? `${toBnDigits(r.physicalBags.toLocaleString('en-IN'))} বস্তা` : '<span style="color:#94A3B8;">—</span>'}
          ${r.physicalKg !== null ? `<div style="font-size: 11px; color: #64748B;">(${toBnDigits(Math.round(r.physicalKg).toLocaleString('en-IN'))} কেজি)</div>` : ''}
        </td>
        <td style="text-align: right; font-weight: 800; color: ${statusColor};">
          ${r.deltaKg !== 0 ? `${sign}${toBnDigits(Math.round(r.deltaKg).toLocaleString('en-IN'))} কেজি` : '<span style="color:#64748B;">০ (মিল)</span>'}
          ${r.deltaBags !== 0 ? `<div style="font-size: 11px; color: ${statusColor};">(${sign}${toBnDigits(String(r.deltaBags))} বস্তা)</div>` : ''}
        </td>
        <td style="text-align: right; font-weight: 800; color: ${statusColor};">
          ${r.deltaValue !== 0 ? `${sign}৳${toBnDigits(Math.round(Math.abs(r.deltaValue)).toLocaleString('en-IN'))}` : '৳০'}
        </td>
        <td style="color: #475569; font-size: 12px;">${esc(r.reason || '—')}</td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>ম্যানুয়াল স্টক অডিট ও নিরীক্ষা রিপোর্ট - চালের আড়ৎ</title>
  <style>
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
      margin: 0;
      padding: 24px;
      color: #0F172A;
      background: #FFFFFF;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .report-wrap {
      max-width: 1050px;
      margin: 0 auto;
    }
    .header-box {
      border-bottom: 2.5px solid #1c70b9;
      padding-bottom: 14px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
    }
    .shop-title {
      font-size: 24px;
      font-weight: 900;
      color: #0F172A;
      margin: 0 0 4px;
    }
    .report-title {
      font-size: 17px;
      font-weight: 800;
      color: #1c70b9;
      margin: 0;
    }
    .meta-box {
      text-align: right;
      font-size: 12px;
      color: #64748B;
      line-height: 1.5;
    }
    .kpi-banner {
      display: flex;
      gap: 12px;
      margin-bottom: 16px;
    }
    .kpi-card {
      flex: 1;
      background: #F8FAFC;
      border: 1px solid #CBD5E1;
      border-radius: 8px;
      padding: 10px 14px;
    }
    .kpi-label {
      font-size: 12px;
      font-weight: 700;
      color: #475569;
      margin-bottom: 4px;
    }
    .kpi-val {
      font-size: 18px;
      font-weight: 900;
      color: #0F172A;
    }
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12.5px;
      margin-bottom: 24px;
    }
    .data-table thead {
      display: table-header-group;
    }
    .data-table th {
      background: #F1F5F9;
      color: #1E293B;
      font-weight: 700;
      padding: 8px 10px;
      text-align: left;
      border-top: 1.5px solid #CBD5E1;
      border-bottom: 1.5px solid #CBD5E1;
    }
    .data-table td {
      padding: 7px 10px;
      border-bottom: 1px solid #E2E8F0;
      vertical-align: middle;
    }
    .data-table tr {
      page-break-inside: avoid;
    }
    .signatures-box {
      display: flex;
      justify-content: space-between;
      margin-top: 48px;
      padding-top: 12px;
      page-break-inside: avoid;
    }
    .signature-slot {
      width: 28%;
      border-top: 1.5px solid #475569;
      text-align: center;
      padding-top: 8px;
      font-size: 13px;
      font-weight: 700;
      color: #334155;
    }
    .signature-role {
      font-size: 11px;
      color: #64748B;
      margin-top: 2px;
    }
    .footer-note {
      text-align: center;
      font-size: 11px;
      color: #94A3B8;
      border-top: 1px dashed #CBD5E1;
      padding-top: 12px;
      margin-top: 24px;
    }
    .action-bar {
      position: fixed;
      top: 14px;
      right: 18px;
      display: flex;
      gap: 10px;
      z-index: 9999;
      background: rgba(255, 255, 255, 0.95);
      padding: 8px;
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.15);
      border: 1px solid #E2E8F0;
    }
    .btn {
      font-family: inherit;
      font-size: 13px;
      font-weight: 700;
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      border: none;
    }
    .btn-primary {
      background: #1c70b9;
      color: #FFFFFF;
    }
    .btn-close {
      background: #E2E8F0;
      color: #334155;
    }
    @media print {
      body {
        padding: 0;
      }
      .action-bar {
        display: none !important;
      }
      .report-wrap {
        max-width: 100%;
      }
      .kpi-card {
        border-color: #94A3B8;
      }
      .data-table th {
        background: #F1F5F9 !important;
      }
    }
  </style>
</head>
<body>
  <div class="action-bar">
    <button class="btn btn-primary" onclick="window.print()">🖨️ প্রিন্ট / পিডিএফ হিসেবে সংরক্ষণ (Save as PDF)</button>
    <button class="btn btn-close" onclick="window.close()">✕ বন্ধ করুন</button>
  </div>

  <div class="report-wrap">
    <div class="header-box">
      <div>
        <div class="shop-title">চালের আড়ৎ</div>
        <div class="report-title">ম্যানুয়াল স্টক অডিট ও নিরীক্ষা বিবরণী রিপোর্ট</div>
        ${note ? `<div style="font-size: 13px; color: #475569; margin-top: 4px;">অডিট নোট: <strong>${esc(note)}</strong></div>` : ''}
      </div>
      <div class="meta-box">
        <div>অডিটের তারিখ: <strong>${toBnDigits(dateStr)}</strong></div>
        <div>প্রিন্টের সময়: <strong>${toBnDigits(timeStr)}</strong></div>
        <div>মোট অডিটকৃত পণ্য: <strong>${toBnDigits(String(summary.totalItems))} টি</strong></div>
      </div>
    </div>

    <div class="kpi-banner">
      <div class="kpi-card">
        <div class="kpi-label">মোট পণ্য / অমিল</div>
        <div class="kpi-val">${toBnDigits(String(summary.totalItems))} টি / <span style="color: ${summary.discrepancyCount > 0 ? '#DC2626' : '#16A34A'};">${toBnDigits(String(summary.discrepancyCount))} অমিল</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">সিস্টেম মজুদ (বস্তা / কেজি)</div>
        <div class="kpi-val">${toBnDigits(summary.totalSystemBags.toLocaleString('en-IN'))} বস্তা <span style="font-size: 13px; color: #64748B;">(${toBnDigits(Math.round(summary.totalSystemKg).toLocaleString('en-IN'))} কেজি)</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">বাস্তব গণনা (বস্তা / কেজি)</div>
        <div class="kpi-val">${toBnDigits(summary.totalPhysicalBags.toLocaleString('en-IN'))} বস্তা <span style="font-size: 13px; color: #64748B;">(${toBnDigits(Math.round(summary.totalPhysicalKg).toLocaleString('en-IN'))} কেজি)</span></div>
      </div>
      <div class="kpi-card">
        <div class="kpi-label">নিট পার্থক্য ও আর্থিক প্রভাব</div>
        <div class="kpi-val" style="color: ${summary.totalDeltaKg < 0 ? '#DC2626' : summary.totalDeltaKg > 0 ? '#16A34A' : '#0F172A'};">
          ${summary.totalDeltaKg > 0 ? '+' : ''}${toBnDigits(Math.round(summary.totalDeltaKg).toLocaleString('en-IN'))} কেজি
          <span style="font-size: 14px;">(৳${toBnDigits(Math.round(Math.abs(summary.totalDeltaValue)).toLocaleString('en-IN'))})</span>
        </div>
      </div>
    </div>

    <table class="data-table">
      <thead>
        <tr>
          <th style="width: 40px; text-align: center;">#</th>
          <th style="width: 95px;">পণ্য কোড</th>
          <th>পণ্যের নাম</th>
          <th style="width: 85px; text-align: center;">সাইজ</th>
          <th style="width: 120px; text-align: right;">সিস্টেম মজুদ</th>
          <th style="width: 120px; text-align: right;">বাস্তব গণনা</th>
          <th style="width: 110px; text-align: right;">পার্থক্য</th>
          <th style="width: 110px; text-align: right;">আর্থিক প্রভাব</th>
          <th style="width: 130px;">কারণ / মন্তব্য</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
      <tfoot>
        <tr style="background: #F1F5F9; font-weight: 800; border-top: 2px solid #0F172A;">
          <td colspan="4" style="padding: 10px; text-align: right; font-size: 14px; color: #0F172A;">সর্বমোট:</td>
          <td style="padding: 10px; text-align: right; font-size: 13px; color: #0F172A;">
            ${toBnDigits(summary.totalSystemBags.toLocaleString('en-IN'))} বস্তা
            <div style="font-size: 11px; color: #64748B;">(${toBnDigits(Math.round(summary.totalSystemKg).toLocaleString('en-IN'))} কেজি)</div>
          </td>
          <td style="padding: 10px; text-align: right; font-size: 13px; color: #0F172A;">
            ${toBnDigits(summary.totalPhysicalBags.toLocaleString('en-IN'))} বস্তা
            <div style="font-size: 11px; color: #64748B;">(${toBnDigits(Math.round(summary.totalPhysicalKg).toLocaleString('en-IN'))} কেজি)</div>
          </td>
          <td style="padding: 10px; text-align: right; font-size: 14px; color: ${summary.totalDeltaKg < 0 ? '#DC2626' : summary.totalDeltaKg > 0 ? '#16A34A' : '#0F172A'};">
            ${summary.totalDeltaKg > 0 ? '+' : ''}${toBnDigits(Math.round(summary.totalDeltaKg).toLocaleString('en-IN'))} কেজি
          </td>
          <td style="padding: 10px; text-align: right; font-size: 15px; color: ${summary.totalDeltaValue < 0 ? '#DC2626' : summary.totalDeltaValue > 0 ? '#16A34A' : '#0F172A'};">
            ${summary.totalDeltaValue > 0 ? '+' : ''}৳${toBnDigits(Math.round(Math.abs(summary.totalDeltaValue)).toLocaleString('en-IN'))}
          </td>
          <td></td>
        </tr>
      </tfoot>
    </table>

    <div class="signatures-box">
      <div class="signature-slot">
        গণনাকারী / নিরীক্ষক
        <div class="signature-role">স্বাক্ষর ও তারিখ</div>
      </div>
      <div class="signature-slot">
        গুদাম ইনচার্জ
        <div class="signature-role">স্বাক্ষর ও তারিখ</div>
      </div>
      <div class="signature-slot">
        ব্যবস্থাপক / স্বত্বাধিকারী
        <div class="signature-role">অনুমোদন ও তারিখ</div>
      </div>
    </div>

    <div class="footer-note">
      এটি একটি কম্পিউটার জেনারেটেড স্টক অডিট ও নিরীক্ষা রিপোর্ট • চালের আড়ৎ ম্যানেজমেন্ট সিস্টেম
    </div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(function() {
        window.print();
      }, 300);
    };
  </script>
</body>
</html>`;
}

export function exportAuditPDF({
  auditRows,
  summary,
  date,
  note,
}: {
  auditRows: AuditRow[];
  summary: {
    totalItems: number;
    discrepancyCount: number;
    totalSystemBags: number;
    totalSystemKg: number;
    totalPhysicalBags: number;
    totalPhysicalKg: number;
    totalDeltaKg: number;
    totalDeltaValue: number;
  };
  date?: string;
  note?: string;
}): boolean {
  if (typeof window === 'undefined') return false;
  const html = buildAuditReportHTML({
    auditRows,
    summary,
    date,
    note,
  });

  const w = window.open('', '_blank');
  if (!w) return false;

  w.document.open();
  w.document.write(html);
  w.document.close();
  return true;
}
