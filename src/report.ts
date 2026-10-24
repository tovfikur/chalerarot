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
  neg?: boolean;      // render the right column in red
  bold?: boolean;
};

export type ReportSection = { title?: string; rows: ReportRow[] };

export type ReportDoc = {
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
      ${sec.rows.map(r => `<tr class="${r.bold ? 'b' : ''}">
        <td class="l">${esc(r.label)}${r.sub ? `<div class="s">${esc(r.sub)}</div>` : ''}</td>
        <td class="r ${r.neg ? 'neg' : ''}">${esc(r.right)}</td></tr>`).join('')}
    </table>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(d.title)}</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; margin: 0; padding: 16px; color: #1C2B22; background: #fff; }
  .sheet { max-width: 720px; margin: 0 auto; }
  h1 { font-size: 20px; text-align: center; margin: 0 0 2px; }
  h2 { font-size: 16px; text-align: center; margin: 0 0 2px; color: #1B7F4B; }
  .period { text-align: center; color: #6B7A70; font-size: 14px; margin-bottom: 12px; }
  h3 { font-size: 15px; margin: 14px 0 4px; color: #1B7F4B; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 5px 0; border-bottom: 1px solid #E3E8E4; font-size: 14px; vertical-align: top; }
  td.r { text-align: right; white-space: nowrap; font-weight: 600; padding-left: 10px; }
  td.r.neg { color: #C62828; }
  td .s { font-size: 12px; color: #6B7A70; font-weight: 400; }
  tr.b td { font-weight: 700; }
  .meta { font-size: 13px; color: #444; }
  .total { margin-top: 12px; border-top: 2px solid #1B7F4B; padding-top: 8px; display: flex; justify-content: space-between; font-size: 16px; font-weight: 700; }
  .total.neg { color: #C62828; }
  .note { margin-top: 10px; font-size: 13px; color: #6B7A70; }
  .foot { margin-top: 14px; font-size: 12px; color: #6B7A70; text-align: right; }
  .bar { position: fixed; top: 8px; right: 8px; display: flex; gap: 8px; z-index: 9; }
  .bar button { font: inherit; font-size: 14px; padding: 8px 14px; border-radius: 8px; border: 1px solid #1B7F4B; background: #1B7F4B; color: #fff; cursor: pointer; }
  .bar button.ghost { background: #fff; color: #1B7F4B; }
  @media print {
    body { padding: 0; }
    .bar { display: none !important; }
    .sheet { max-width: none; }
  }
</style></head><body>
<div class="bar">
  <button onclick="window.print()">${esc(d.printLabel)}</button>
  ${d.closeLabel ? `<button class="ghost" onclick="window.close()">${esc(d.closeLabel)}</button>` : ''}
</div>
<div class="sheet">
  <h1>${esc(d.shop)}</h1>
  <h2>${esc(d.title)}</h2>
  <div class="period">${esc(d.period)}</div>
  ${(d.meta ?? []).map(m => `<div class="meta">${esc(m.label)}: ${esc(m.value)}</div>`).join('')}
  ${sections}
  ${d.total ? `<div class="total ${d.total.neg ? 'neg' : ''}"><span>${esc(d.total.label)}</span><span>${esc(d.total.value)}</span></div>` : ''}
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

/** "04-10-2026" style stamp for the printed footer, localised digits. */
export function printedAtStamp(locale: boolean | 'bn' | 'en'): string {
  const bn = locale === true || locale === 'bn';
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const s = `${p(now.getDate())}-${p(now.getMonth() + 1)}-${now.getFullYear()} ${p(now.getHours())}:${p(now.getMinutes())}`;
  return bn ? toBnDigits(s) : s;
}
