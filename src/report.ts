import { toBnDigits } from './bn';

/**
 * One report model drives the on-screen detail, the preview window and the
 * printed page, so Card = Detail = Preview = Print by construction: the same
 * rows and totals are rendered by all three.
 */

export type ReportRow = {
  label: string;      // left column (invoice no, customer, category, label...)
  sub?: string;       // optional second line under the label
  right: string;      // right column (already formatted, e.g. ৳1,234)
  cells?: string[];
  neg?: boolean;      // render the right column in red
  bold?: boolean;
};

export type ReportSection = { title?: string; columns?: string[]; rightAlignColumns?: number[]; rows: ReportRow[] };

export type ReportDoc = {
  kind?: 'report' | 'receipt';
  landscape?: boolean;
  language?: 'bn' | 'en';
  shop: string;
  title: string;
  /** Selected period / filter, exactly as shown on the KPI card. */
  period: string;
  /** Extra meta lines (date range, "current balances" note...). */
  meta?: { label: string; value: string }[];
  sections: ReportSection[];
  total?: { label: string; value: string; neg?: boolean };
  note?: string;
  printedAt: string;
  printLabel: string;
  closeLabel?: string;
};

export function downloadReportCSV(d: ReportDoc, filename: string): boolean {
  if (typeof document === 'undefined') return false;
  const cell = (value: string) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const headings = d.language === 'bn'
    ? ['বিবরণ', 'বিস্তারিত', 'পরিমাণ']
    : ['Description', 'Details', 'Amount'];
  const rows: string[] = [[d.shop, d.title, d.period].map(cell).join(',')];
  for (const meta of d.meta ?? []) rows.push([meta.label, meta.value].map(cell).join(','));
  for (const section of d.sections) {
    if (section.title) rows.push('', cell(section.title));
    rows.push((section.columns ?? headings).map(cell).join(','));
    for (const row of section.rows) rows.push((row.cells ?? [row.label, row.sub ?? '', row.right]).map(cell).join(','));
  }
  if (d.total) rows.push('', [cell(d.total.label), '', cell(d.total.value)].join(','));
  try {
    const blob = new Blob(['\uFEFF' + rows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch { return false; }
}

/** Download a self-contained, printable HTML copy of a report or receipt. */
export function downloadReportHTML(d: ReportDoc, filename: string): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const blob = new Blob([buildReportHTML(d, false)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename.toLowerCase().endsWith('.html') ? filename : `${filename}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch { return false; }
}

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function reportText(d: ReportDoc): string {
  const out: string[] = [d.shop, '='.repeat(34), d.title, d.period, ''];
  for (const m of d.meta ?? []) out.push(`${m.label}: ${m.value}`);
  if ((d.meta ?? []).length) out.push('');
  for (const sec of d.sections) {
    if (sec.title) out.push(sec.title, '-'.repeat(sec.title.length));
    for (const r of sec.rows) {
      out.push(`${r.label}${r.sub ? ` (${r.sub})` : ''}`.padEnd(34) + r.right);
    }
    out.push('');
  }
  if (d.total) out.push('-'.repeat(34), `${d.total.label}`.padEnd(34) + d.total.value);
  if (d.note) out.push('', d.note);
  out.push('', `${d.printedAt}`);
  return out.join('\n');
}

export function buildReportHTML(d: ReportDoc, autoPrint: boolean): string {
  const sections = d.sections.map(sec => `
    ${sec.title ? `<h3>${esc(sec.title)}</h3>` : ''}
    <table>
      ${sec.columns ? `<thead><tr>${sec.columns.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead>` : ''}
      ${sec.rows.map(r => r.cells ? `<tr class="${r.bold ? 'b' : ''}">${r.cells.map((cell, i) => `<td class="${(sec.rightAlignColumns?.includes(i) || i === r.cells!.length - 1) ? `r ${r.neg ? 'neg' : ''}` : 'l'}">${esc(cell)}</td>`).join('')}</tr>` : `<tr class="${r.bold ? 'b' : ''}">
        <td class="l">${esc(r.label)}${r.sub ? `<div class="s">${esc(r.sub)}</div>` : ''}</td>
        <td class="r ${r.neg ? 'neg' : ''}">${esc(r.right)}</td></tr>`).join('')}
    </table>`).join('');
  return `<!DOCTYPE html><html lang="${d.language === 'bn' ? 'bn' : 'en'}"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(d.title)}</title>
<style>
  ${d.landscape ? '@page { size: A4 landscape; }' : ''}
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 20px; color: #172554; background: #F5F8FF; }
  .sheet { max-width: 780px; margin: 24px auto; padding: 28px; border: 1px solid #D7E2F4; border-radius: 16px; background: #fff; box-shadow: 0 8px 24px rgba(15,23,42,.06); }
  .sheet.receipt { max-width: 440px; padding: 16px 18px; border: 0; border-radius: 0; box-shadow: none; }
  .receipt h1 { font-size: 21px; margin-bottom: 3px; }
  .receipt h2 { font-size: 16px; margin-bottom: 12px; }
  .receipt .period { display: none; }
  .receipt .meta { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; font-size: 14px; }
  .receipt .meta strong { text-align: right; }
  .receipt h3 { border-top: 1px dashed #94A3B8; padding-top: 10px; margin-top: 12px; color: #111827; font-size: 16px; }
  .receipt td { padding: 6px 5px; }
  .receipt .total { margin-top: 8px; border-top: 1px solid #64748B; border-bottom: 1px solid #CBD5E1; padding: 7px 2px; font-size: 17px; }
  h1 { font-size: 20px; text-align: center; margin: 0 0 2px; }
  h2 { font-size: 16px; text-align: center; margin: 0 0 2px; color: #1D4ED8; }
  .period { text-align: center; color: #526583; font-size: 14px; margin-bottom: 16px; }
  h3 { font-size: 15px; margin: 14px 0 4px; color: #1D4ED8; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 8px 6px; border-bottom: 1px solid #E2E8F0; font-size: 14px; vertical-align: top; }
  th { text-align: left; padding: 8px 6px; border-bottom: 2px solid #CBD5E1; font-size: 12px; }
  th:not(:first-child) { text-align: right; }
  table:has(thead) th { text-align: left; }
  table:has(thead) th:nth-child(8), table:has(thead) th:nth-child(9), table:has(thead) th:nth-child(10), table:has(thead) th:nth-child(11), table:has(thead) th:nth-child(12) { text-align: right; }
  td.r { text-align: right; white-space: nowrap; font-weight: 600; padding-left: 10px; }
  td.r.neg { color: #C62828; }
  td .s { font-size: 12px; color: #526583; font-weight: 400; }
  tr.b td { font-weight: 700; }
  .meta { font-size: 13px; color: #334155; padding: 3px 0; }
  .total { margin-top: 14px; border-top: 2px solid #2563EB; padding-top: 10px; display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; }
  .total.neg { color: #C62828; }
  .note { margin-top: 10px; font-size: 13px; color: #526583; }
  .signatures { display: flex; justify-content: space-between; gap: 32px; margin-top: 44px; }
  .signatures span { width: 42%; border-top: 1px solid #94A3B8; padding-top: 6px; text-align: center; color: #526583; font-size: 12px; }
  .foot { margin-top: 14px; font-size: 12px; color: #526583; text-align: right; }
  .bar { position: fixed; top: 8px; right: 8px; display: flex; gap: 8px; z-index: 9; }
  .bar button { font: inherit; font-size: 14px; padding: 8px 14px; border-radius: 8px; border: 1px solid #1D4ED8; background: #1D4ED8; color: #fff; cursor: pointer; }
  .bar button.ghost { background: #fff; color: #1D4ED8; }
  .receipt .amount, .receipt .signatures { display: none; }
  .receipt-thanks { text-align: center; margin-top: 14px; padding-top: 10px; border-top: 1px dashed #94A3B8; font-size: 15px; }
  @media print {
    body { padding: 0; background: #fff; }
    .bar { display: none !important; }
    .sheet { max-width: none; margin: 0; padding: 8px; border: 0; border-radius: 0; box-shadow: none; }
    .sheet.receipt { max-width: 440px; padding: 0; }
  }
</style></head><body>
<div class="bar">
  <button onclick="window.print()">${esc(d.printLabel)}</button>
  ${d.closeLabel ? `<button class="ghost" onclick="window.close()">${esc(d.closeLabel)}</button>` : ''}
</div>
<div class="sheet ${d.kind === 'receipt' ? 'receipt' : ''}">
  <h1>${esc(d.shop)}</h1>
  <h2>${esc(d.title)}</h2>
  <div class="period">${esc(d.period)}</div>
  ${(d.meta ?? []).map(m => d.kind === 'receipt' ? `<div class="meta"><span>${esc(m.label)}</span><strong>${esc(m.value)}</strong></div>` : `<div class="meta">${esc(m.label)}: ${esc(m.value)}</div>`).join('')}
  ${sections}
  ${d.total ? `<div class="total ${d.total.neg ? 'neg' : ''}"><span>${esc(d.total.label)}</span><span>${esc(d.total.value)}</span></div>` : ''}
  ${d.kind === 'receipt' ? `<div class="receipt-thanks">${d.language === 'bn' ? 'ধন্যবাদ' : 'Thank you'}</div>` : ''}
  ${d.note ? `<div class="note">${esc(d.note)}</div>` : ''}
  <div class="foot">${esc(d.printedAt)}</div>
</div>
${autoPrint ? '<script>window.onload=function(){setTimeout(function(){window.print()},150)}<\/script>' : ''}
</body></html>`;
}

/**
 * Print exactly ONE report.
 *
 * The printable document is built from the same ReportDoc as the on-screen
 * detail and preview, but it is written into a short-lived hidden iframe that
 * is removed again as soon as the print dialog is done. Nothing is appended to
 * the app DOM, nothing is left mounted, and repeated presses never stack
 * documents. Because the print document is built from the data (not from the
 * on-screen scroll area) it always contains EVERY record.
 */
export function printReport(d: ReportDoc): boolean {
  if (typeof document === 'undefined') return false;
  const frame = document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.style.opacity = '0';
  frame.style.pointerEvents = 'none';
  document.body.appendChild(frame);

  const cleanup = () => {
    // Give the dialog a moment to read the document, then always clean up.
    window.setTimeout(() => {
      try { frame.parentNode?.removeChild(frame); } catch { /* already gone */ }
    }, 1000);
  };

  try {
    const doc = frame.contentDocument;
    if (!doc) { cleanup(); return false; }
    doc.open();
    // autoPrint false: we trigger print ourselves once the frame is loaded.
    doc.write(buildReportHTML(d, false));
    doc.close();
    const win = frame.contentWindow as (Window & { focus?: () => void }) | null;
    frame.onload = () => {
      try { win?.focus(); win?.print(); } catch { /* printing unavailable */ }
      cleanup();
    };
    window.setTimeout(() => { try { win?.print(); } catch { /* noop */ } cleanup(); }, 350);
    return true;
  } catch {
    cleanup();
    return false;
  }
}

/** Open a read-only browser preview without invoking the print dialog. */
export function previewReport(d: ReportDoc): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  const preview = window.open('', '_blank');
  if (!preview) return false;
  try {
    preview.document.open();
    preview.document.write(buildReportHTML(d, false));
    preview.document.close();
    return true;
  } catch {
    preview.close();
    return false;
  }
}

/** "04-10-2026" style stamp for the printed footer, localised digits. */
export function printedAtStamp(locale: boolean | 'bn' | 'en'): string {
  const bn = locale === true || locale === 'bn';
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const s = `${p(now.getDate())}-${p(now.getMonth() + 1)}-${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}`;
  return bn ? toBnDigits(s) : s;
}
