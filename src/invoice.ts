import { toBnDigits } from './ui';

export type UnitNames = { kg: string; small: string; medium: string; large: string; ton: string };

export type InvLabels = {
  shop: string; docTitle: string; invoiceNo: string; date: string; time: string;
  partyLabel: string; mobile: string; product: string; qty: string; rate: string;
  total: string; paid: string; due: string; payDate: string; thanks: string;
};

export type InvLine = { name: string; detail: string; total: string };

export type InvData = {
  no: string; date: string; time: string;
  partyName: string; partyMobile: string;
  lines: InvLine[]; total: string; paid: string; due: string; next?: string;
  labels: InvLabels;
  extra?: { label: string; value: string }[];
  hidePay?: boolean;
};

// Actual transaction UOM plus converted KG (never KG-only).
export function unitDetail(u: string, entered: number, qtyKg: number, un: UnitNames, nf: (n: number) => string): string {
  if (u === 'kg') return `${nf(entered)} ${un.kg}`;
  const uname = u === 'ton' ? un.ton : u === 'small' ? un.small : u === 'medium' ? un.medium : un.large;
  const per = entered ? Math.round((qtyKg / entered) * 100) / 100 : 0;
  return `${nf(entered)} ${uname} × ${nf(per)} ${un.kg} = ${nf(qtyKg)} ${un.kg}`;
}

export function fmtTime(iso: string, bn: boolean): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const h = d.getHours(), ap = h < 12 ? 'AM' : 'PM', h12 = h % 12 || 12;
  const mm = String(d.getMinutes()).padStart(2, '0');
  const s = `${String(h12).padStart(2, '0')}:${mm} ${ap}`;
  return bn ? toBnDigits(s) : s;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function buildInvoiceText(d: InvData): string {
  const L = d.labels;
  const out: string[] = [
    L.shop, '----------------------------------', '',
    L.docTitle, '',
    `${L.invoiceNo}: ${d.no}`, `${L.date}: ${d.date}`, `${L.time}: ${d.time}`, '',
    `${L.partyLabel}:`, d.partyName, d.partyMobile ? `${L.mobile}: ${d.partyMobile}` : '',
    '', '----------------------------------', '',
  ];
  for (const l of d.lines) out.push(l.name, l.detail, l.total, '');
  out.push(
    '----------------------------------', '',
    `${L.total}: ${d.total}`,
    ...(d.hidePay ? [] : [`${L.paid}: ${d.paid}`, `${L.due}: ${d.due}`]),
    ...(d.extra ?? []).map(e => `${e.label}: ${e.value}`),
    d.next ? `${L.payDate}: ${d.next}` : '',
    '', '----------------------------------', '', L.thanks,
  );
  return out.filter(x => x !== undefined).join('\n');
}

export function buildInvoiceHTML(d: InvData): string {
  const L = d.labels;
  const rows = d.lines.map(l => `
    <div class="item"><div class="iname">${esc(l.name)}</div><div class="idetail">${esc(l.detail)}</div><div class="itotal">${esc(l.total)}</div></div>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(d.no)}</title>
<style>
  body { font-family: sans-serif; margin: 0; padding: 16px; color: #111; }
  .sheet { max-width: 440px; margin: 0 auto; }
  h1 { font-size: 22px; text-align: center; margin: 0 0 4px; }
  h2 { font-size: 17px; text-align: center; margin: 0 0 12px; }
  hr { border: none; border-top: 1px dashed #888; margin: 10px 0; }
  .row { display: flex; justify-content: space-between; padding: 2px 0; font-size: 15px; }
  .item { padding: 6px 0; }
  .iname { font-size: 16px; font-weight: 700; }
  .idetail { font-size: 14px; color: #444; }
  .itotal { font-size: 15px; font-weight: 700; text-align: right; }
  .big { font-size: 17px; font-weight: 700; }
  .center { text-align: center; margin-top: 12px; font-size: 16px; }
  @media print { body { padding: 0; } }
</style></head><body><div class="sheet">
<h1>${esc(L.shop)}</h1><h2>${esc(L.docTitle)}</h2>
<div class="row"><span>${esc(L.invoiceNo)}</span><span>${esc(d.no)}</span></div>
<div class="row"><span>${esc(L.date)}</span><span>${esc(d.date)}</span></div>
<div class="row"><span>${esc(L.time)}</span><span>${esc(d.time)}</span></div>
<div class="row"><span>${esc(L.partyLabel)}</span><span>${esc(d.partyName)}</span></div>
${d.partyMobile ? `<div class="row"><span>${esc(L.mobile)}</span><span>${esc(d.partyMobile)}</span></div>` : ''}
<hr />${rows}<hr />
<div class="row big"><span>${esc(L.total)}</span><span>${esc(d.total)}</span></div>
${d.hidePay ? '' : `<div class="row"><span>${esc(L.paid)}</span><span>${esc(d.paid)}</span></div>
<div class="row"><span>${esc(L.due)}</span><span>${esc(d.due)}</span></div>`}
${(d.extra ?? []).map(e => `<div class="row"><span>${esc(e.label)}</span><span>${esc(e.value)}</span></div>`).join('')}
${d.next ? `<div class="row"><span>${esc(L.payDate)}</span><span>${esc(d.next)}</span></div>` : ''}
<hr /><div class="center">${esc(L.thanks)}</div>
</div></body></html>`;
}
