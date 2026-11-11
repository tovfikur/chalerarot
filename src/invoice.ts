import { toBnDigits } from './ui';

export type UnitNames = { kg: string; small: string; medium: string; large: string; ton: string };

export type InvLabels = {
  shop: string; docTitle: string; invoiceNo: string; date: string; time: string;
  partyLabel: string; mobile: string; product: string; qty: string; rate: string;
  total: string; paid: string; due: string; payDate: string; thanks: string;
  paymentBreakdown: string; transactionId: string; description: string; account: string;
  totalDue: string; fullyPaid: string; transportPayment: string; advancePayment: string; invoicePayment: string;
  purchaseInvoice: string; salesInvoice: string;
};

export type InvLine = { name: string; detail: string; total: string };

export type InvData = {
  no: string; date: string; time: string;
  partyName: string; partyMobile: string;
  lines: InvLine[]; total: string; paid: string; due: string; next?: string;
  labels: InvLabels;
  extra?: { label: string; value: string; tone?: 'loss' }[];
  payments?: { transactionId: string; date?: string; description?: string; accountName?: string; amount: string }[];
  fullyPaid?: boolean;
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

export function invoicePaymentDescription(payment: { description?: string; descriptionCode?: 'transport' | 'advance' | 'invoice'; contraPurchaseInvoiceNo?: string; contraSaleInvoiceNo?: string; contraCustomerName?: string }, lang: 'bn' | 'en'): string {
  const isBn = lang === 'bn';
  const defaultTransport = 'Transport payment (paid directly by customer)';
  let raw = payment.description?.trim();
  if (isBn && raw) {
    const knownSystemDescriptions: [string, string][] = [
      ['Direct customer transport settlement against', 'গ্রাহকের পরিবহন ব্যয়ের সরাসরি সমন্বয়'],
      ['Transport payment (paid directly by customer)', 'গ্রাহকের সরাসরি পরিশোধিত পরিবহন ব্যয়'],
      ['Transport payment', 'পরিবহন পেমেন্ট'],
      ['Advance payment applied', 'অগ্রিম পেমেন্ট সমন্বয়'],
      ['Invoice payment', 'ইনভয়েস পেমেন্ট'],
    ];
    const known = knownSystemDescriptions.find(([english]) => raw!.startsWith(english));
    if (known) raw = `${known[1]}${raw.slice(known[0].length)}`;
  }
  for (const reference of [payment.contraPurchaseInvoiceNo, payment.contraSaleInvoiceNo]) {
    if (reference && raw?.endsWith(reference)) raw = raw.slice(0, -reference.length).replace(/\s*[·-]\s*$/, '').trim();
  }
  const parts = raw && raw !== defaultTransport ? [raw] : [
    payment.descriptionCode === 'transport' ? (isBn ? 'পরিবহন পেমেন্ট' : 'Transport payment')
      : payment.descriptionCode === 'advance' ? (isBn ? 'অগ্রিম পেমেন্ট সমন্বয়' : 'Advance payment applied')
        : (isBn ? 'ইনভয়েস পেমেন্ট' : 'Invoice payment'),
  ];
  if (payment.descriptionCode === 'transport' && payment.contraCustomerName) {
    parts.push(`${isBn ? 'গ্রাহক' : 'Customer'}: ${payment.contraCustomerName}`);
  }
  if (payment.contraPurchaseInvoiceNo) parts.push(`${isBn ? 'ক্রয় ইনভয়েস' : 'Purchase invoice'} ${payment.contraPurchaseInvoiceNo}`);
  if (payment.contraSaleInvoiceNo) parts.push(`${isBn ? 'বিক্রয় ইনভয়েস' : 'Sales invoice'} ${payment.contraSaleInvoiceNo}`);
  return parts.join(' · ');
}

export const invoicePaymentAmount = (payments: { amount: number }[] | undefined, fallbackPaid: number, total: number) => {
  const paid = payments?.length ? payments.reduce((sum, payment) => sum + payment.amount, 0) : fallbackPaid;
  const normalizedPaid = Math.round(paid * 100) / 100;
  return { paid: normalizedPaid, due: Math.max(0, Math.round((total - normalizedPaid) * 100) / 100), fullyPaid: total - normalizedPaid <= 0.005 };
};

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
  if (d.payments?.length) out.push('----------------------------------', '', `${L.total}: ${d.total}`, '', L.paymentBreakdown);
  if (d.payments?.length) {
    for (const payment of d.payments) {
      out.push(`${L.transactionId}: ${payment.transactionId}`);
      if (payment.date) out.push(`${L.date}: ${payment.date}`);
      if (payment.description) out.push(`${L.description}: ${payment.description}`);
      if (payment.accountName) out.push(`${L.account}: ${payment.accountName}`);
      out.push(`${L.paid}: ${payment.amount}`, '');
    }
  }
  out.push(
    '----------------------------------', '',
    ...(d.payments?.length ? [] : [`${L.total}: ${d.total}`]),
    ...(d.hidePay ? [] : [`${L.paid}: ${d.paid}`, d.fullyPaid ? L.fullyPaid : `${L.totalDue}: ${d.due}`]),
    ...(d.extra ?? []).map(e => `${e.label}: ${e.value}`),
    d.next ? `${L.payDate}: ${d.next}` : '',
    '', '----------------------------------', '', L.thanks,
  );
  return out.filter(x => x !== undefined).join('\n');
}

export function buildInvoiceHTML(d: InvData): string {
  const L = d.labels;
  const rows = d.lines.map(l => `<tr><td class="product">${esc(l.name)}</td><td class="details">${esc(l.detail)}</td><td class="amount">${esc(l.total)}</td></tr>`).join('');
  const payments = d.payments?.length ? `<table class="payment-table"><thead><tr><th>${esc(L.transactionId)} / ${esc(L.description)}</th><th>${esc(L.paid)}</th></tr></thead><tbody>${d.payments.map(payment => `<tr><td><strong>${esc(payment.transactionId)}</strong>${payment.date ? `<div>${esc(L.date)}: ${esc(payment.date)}</div>` : ''}${payment.description ? `<div>${esc(L.description)}: ${esc(payment.description)}</div>` : ''}${payment.accountName ? `<div>${esc(L.account)}: ${esc(payment.accountName)}</div>` : ''}</td><td class="amount">${esc(payment.amount)}</td></tr>`).join('')}</tbody></table>` : '';
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
  .row.loss { color: #DC2626; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; table-layout: fixed; }
  th, td { padding: 7px 5px; border-bottom: 1px solid #D1D5DB; text-align: left; vertical-align: top; overflow-wrap: anywhere; }
  th { background: #F3F4F6; font-size: 12px; font-weight: 700; }
  td { font-size: 12px; }
  .items th:first-child, .items td:first-child { width: 27%; }
  .items th:nth-child(2), .items td:nth-child(2) { width: 48%; }
  .items th:last-child, .items td:last-child { width: 25%; }
  .amount { text-align: right; white-space: nowrap; font-weight: 700; }
  .summary { margin-top: 8px; border-top: 1px solid #888; }
  .summary .row { border-bottom: 1px solid #D1D5DB; padding: 6px 2px; }
  .payment-table { margin: 7px 0 10px; }
  .payment-table th:first-child, .payment-table td:first-child { width: 72%; }
  .payment-table th:last-child, .payment-table td:last-child { width: 28%; }
  .payment-table td div { margin-top: 3px; color: #444; }
  .payment-table td strong { display: block; margin-bottom: 2px; }
  .big { font-size: 17px; font-weight: 700; }
  .payments { margin: 10px 0; padding: 8px 0; border-top: 1px dashed #888; }
  .payments-title { font-weight: 700; margin-bottom: 4px; }
  .payment { padding: 5px 0; border-bottom: 1px dotted #CCC; font-size: 12px; color: #333; }
  .payment-id { font-weight: 700; }
  .payment-amount { text-align: right; font-weight: 700; font-size: 13px; }
  .center { text-align: center; margin-top: 12px; font-size: 16px; }
  @media print { body { padding: 0; } }
</style></head><body><div class="sheet">
<h1>${esc(L.shop)}</h1><h2>${esc(L.docTitle)}</h2>
<div class="row"><span>${esc(L.invoiceNo)}</span><span>${esc(d.no)}</span></div>
<div class="row"><span>${esc(L.date)}</span><span>${esc(d.date)}</span></div>
<div class="row"><span>${esc(L.time)}</span><span>${esc(d.time)}</span></div>
<div class="row"><span>${esc(L.partyLabel)}</span><span>${esc(d.partyName)}</span></div>
${d.partyMobile ? `<div class="row"><span>${esc(L.mobile)}</span><span>${esc(d.partyMobile)}</span></div>` : ''}
<table class="items"><thead><tr><th>${esc(L.product)}</th><th>${esc(L.description)}</th><th class="amount">${esc(L.total)}</th></tr></thead><tbody>${rows}</tbody></table>
<div class="summary"><div class="row big"><span>${esc(L.total)}</span><span>${esc(d.total)}</span></div></div>
${d.payments?.length ? `<div class="payments"><div class="payments-title">${esc(L.paymentBreakdown)}</div>${payments}</div>` : ''}
${d.hidePay ? '' : `<div class="summary"><div class="row"><span>${esc(L.paid)}</span><span>${esc(d.paid)}</span></div>
${d.fullyPaid ? `<div class="row"><span>${esc(L.fullyPaid)}</span><span>✓</span></div>` : `<div class="row"><span>${esc(L.totalDue)}</span><span>${esc(d.due)}</span></div>`}</div>`}
${(d.extra ?? []).map(e => `<div class="row${e.tone === 'loss' ? ' loss' : ''}"><span>${esc(e.label)}</span><span>${esc(e.value)}</span></div>`).join('')}
${d.next ? `<div class="row"><span>${esc(L.payDate)}</span><span>${esc(d.next)}</span></div>` : ''}
<hr /><div class="center">${esc(L.thanks)}</div>
</div></body></html>`;
}
