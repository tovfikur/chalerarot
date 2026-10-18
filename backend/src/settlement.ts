// Canonical per-invoice settlement: the ONE place that decides how much of
// every sale/purchase invoice has been paid.
//
// Business rules (all deterministic, no new tables, no new columns):
//   1. Money created WITH an invoice — sale-time / purchase-time payment rows
//      (saleId / purchaseId set), including return credit memos via their
//      ProductReturn row — is attributed to THAT invoice.
//   2. Unattributed (floating) payments settle a party's own invoices
//      oldest-first (FIFO by date, then creation order).
//   3. Invoice status is derived, never stored: paid when due <= 0, partial
//      when something was paid but due remains, due otherwise.
//
// Every read path (bootstrap, lists, documents, reminders, account detail)
// derives paid/due/status from this. Write paths additionally re-materialize
// the stored paid/due columns through `syncPartyInvoices` inside the same
// transaction, so the columns stay aligned — a cache refresh, never a second
// source of truth.
import { db } from './db';
import type { TxClient } from './routes/transactions';

export type SettlementStatus = 'paid' | 'partial' | 'due';
export type InvoiceSettlement = { paid: number; due: number; status: SettlementStatus };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function statusOf(total: number, paid: number): SettlementStatus {
  const due = round2(total - paid);
  if (due <= 0) return 'paid';
  if (paid > 0) return 'partial';
  return 'due';
}

export type InvoiceLike = {
  id: string; partyId: string; date: string; total: number;
  createdAt?: Date | string | null;
};
export type ReturnLike = { invoiceId: string | null; amount: number };
export type PayLike = {
  partyId: string; invoiceId: string | null; returnId: string | null;
  date: string; amount: number; createdAt?: Date | string | null;
};

const stamp = (d?: Date | string | null) =>
  d instanceof Date ? d.toISOString() : String(d ?? '');

// Oldest-invoice-first allocation of one party's floating money across that
// party's own invoices, after dedicated money has been attributed.
export function allocateParty(
  invoices: InvoiceLike[],
  dedicated: { invoiceId: string; amount: number }[],
  floating: { date: string; createdAt?: Date | string | null; amount: number }[],
): Map<string, InvoiceSettlement> {
  const byDate = (a: { date: string; createdAt?: Date | string | null; id?: string }, b: { date: string; createdAt?: Date | string | null; id?: string }) =>
    a.date < b.date ? -1 : a.date > b.date ? 1
    : stamp(a.createdAt) < stamp(b.createdAt) ? -1 : stamp(a.createdAt) > stamp(b.createdAt) ? 1
    : (a.id ?? '') < (b.id ?? '') ? -1 : (a.id ?? '') > (b.id ?? '') ? 1 : 0;
  const invs = [...invoices].sort(byDate);
  const pool = [...floating].sort(byDate);
  const ded = new Map<string, number>();
  for (const p of dedicated) ded.set(p.invoiceId, round2((ded.get(p.invoiceId) ?? 0) + p.amount));
  let pi = 0;
  let left = pool.length ? Math.max(0, pool[0].amount) : 0;
  const out = new Map<string, InvoiceSettlement>();
  for (const inv of invs) {
    let need = round2(inv.total - (ded.get(inv.id) ?? 0));
    while (need > 0 && pi < pool.length) {
      const take = Math.min(need, left);
      need = round2(need - take);
      left = round2(left - take);
      if (left <= 0) { pi++; left = pi < pool.length ? Math.max(0, pool[pi].amount) : 0; }
    }
    const paid = round2(Math.min(inv.total, inv.total - Math.max(0, need)));
    const due = round2(inv.total - paid);
    out.set(inv.id, { paid, due, status: statusOf(inv.total, paid) });
  }
  return out;
}

// Pure core: attribution first (per-invoice payments + return credits), then
// FIFO for whatever is left floating. Partitions work by party so one
// customer's money can never leak onto another's invoices.
export function buildSettlement(
  invoices: InvoiceLike[],
  returns: ReturnLike[],
  pays: PayLike[],
): Map<string, InvoiceSettlement> {
  const byId = new Map(invoices.map(i => [i.id, i]));
  const slots = new Map<string, {
    invs: InvoiceLike[];
    dedicated: { invoiceId: string; amount: number }[];
    floating: { date: string; createdAt?: Date | string | null; amount: number }[];
  }>();
  const slot = (partyId: string) => {
    let s = slots.get(partyId);
    if (!s) { s = { invs: [], dedicated: [], floating: [] }; slots.set(partyId, s); }
    return s;
  };
  for (const inv of invoices) slot(inv.partyId).invs.push(inv);
  // Return credit memos are linked to their own invoice: attributed first.
  for (const r of returns) {
    if (!r.invoiceId) continue;
    const inv = byId.get(r.invoiceId);
    slot(inv ? inv.partyId : '').dedicated.push({ invoiceId: r.invoiceId, amount: r.amount });
  }
  for (const p of pays) {
    // A return credit memo row and its ProductReturn credit describe the same
    // single credit; only the return row is attributed, so memo rows must
    // never float into the pool (that would double-count them).
    if (p.returnId) continue;
    if (p.invoiceId) {
      const inv = byId.get(p.invoiceId);
      slot(inv ? inv.partyId : p.partyId).dedicated.push({ invoiceId: p.invoiceId, amount: p.amount });
    } else {
      slot(p.partyId).floating.push({ date: p.date, createdAt: p.createdAt, amount: p.amount });
    }
  }
  const out = new Map<string, InvoiceSettlement>();
  for (const s of slots.values()) {
    for (const [id, st] of allocateParty(s.invs, s.dedicated, s.floating)) out.set(id, st);
  }
  return out;
}

type DbLike = typeof db | TxClient;

// Whole-table settlement for one document kind (lists, bootstrap, reminders).
export async function settleAll(
  kind: 'sale' | 'purchase',
  client: DbLike = db,
): Promise<Map<string, InvoiceSettlement>> {
  const [invoices, returns, pays] = await Promise.all([
    kind === 'sale'
      ? client.sale.findMany({ select: { id: true, customerId: true, date: true, total: true, createdAt: true } })
      : client.purchase.findMany({ select: { id: true, vendorId: true, date: true, total: true, createdAt: true } }),
    client.productReturn.findMany({
      where: kind === 'sale' ? { saleId: { not: null } } : { purchaseId: { not: null } },
      select: { saleId: true, purchaseId: true, totalAmount: true },
    }),
    kind === 'sale'
      ? client.customerPayment.findMany({ select: { customerId: true, saleId: true, returnId: true, date: true, amount: true, createdAt: true } })
      : client.vendorPayment.findMany({ select: { vendorId: true, purchaseId: true, returnId: true, date: true, amount: true, createdAt: true } }),
  ]);
  return buildSettlement(
    invoices.map(inv => ({
      id: inv.id,
      partyId: kind === 'sale'
        ? ((inv as { customerId?: string | null }).customerId ?? '')
        : (inv as { vendorId: string }).vendorId,
      date: inv.date, total: inv.total, createdAt: inv.createdAt,
    })),
    returns.map(r => ({
      invoiceId: (r as { saleId?: string | null }).saleId ?? (r as { purchaseId?: string | null }).purchaseId ?? null,
      amount: r.totalAmount,
    })),
    pays.map(p => ({
      partyId: kind === 'sale'
        ? ((p as { customerId?: string | null }).customerId ?? '')
        : ((p as { vendorId?: string }).vendorId ?? ''),
      invoiceId: (p as { saleId?: string | null }).saleId ?? (p as { purchaseId?: string | null }).purchaseId ?? null,
      returnId: p.returnId ?? null,
      date: p.date, amount: p.amount, createdAt: p.createdAt,
    })),
  );
}

// One party's settlement (single-invoice views, write-time sync).
export async function settleParty(
  kind: 'sale' | 'purchase',
  partyId: string,
  client: DbLike = db,
): Promise<Map<string, InvoiceSettlement>> {
  const invoices = kind === 'sale'
    ? await client.sale.findMany({
        where: { customerId: partyId },
        select: { id: true, date: true, total: true, createdAt: true },
      })
    : await client.purchase.findMany({
        where: { vendorId: partyId },
        select: { id: true, date: true, total: true, createdAt: true },
      });
  const ids = invoices.map(i => i.id);
  const returns = ids.length
    ? await client.productReturn.findMany({
        where: kind === 'sale' ? { saleId: { in: ids } } : { purchaseId: { in: ids } },
        select: { saleId: true, purchaseId: true, totalAmount: true },
      })
    : [];
  const pays = kind === 'sale'
    ? await client.customerPayment.findMany({
        where: { customerId: partyId },
        select: { saleId: true, returnId: true, date: true, amount: true, createdAt: true },
      })
    : await client.vendorPayment.findMany({
        where: { vendorId: partyId },
        select: { purchaseId: true, returnId: true, date: true, amount: true, createdAt: true },
      });
  return buildSettlement(
    invoices.map(inv => ({ id: inv.id, partyId, date: inv.date, total: inv.total, createdAt: inv.createdAt })),
    returns.map(r => ({
      invoiceId: (r as { saleId?: string | null }).saleId ?? (r as { purchaseId?: string | null }).purchaseId ?? null,
      amount: r.totalAmount,
    })),
    pays.map(p => ({
      partyId,
      invoiceId: (p as { saleId?: string | null }).saleId ?? (p as { purchaseId?: string | null }).purchaseId ?? null,
      returnId: p.returnId ?? null,
      date: p.date, amount: p.amount, createdAt: p.createdAt,
    })),
  );
}

// Re-materialize ONE party's stored paid/due columns from the canonical
// settlement. Call this inside the same write transaction that changed the
// party's payments — never anywhere else.
export async function syncPartyInvoices(
  kind: 'sale' | 'purchase',
  partyId: string | null | undefined,
  client: TxClient,
): Promise<void> {
  if (!partyId) return;
  const settled = await settleParty(kind, partyId, client);
  if (kind === 'sale') {
    for (const [id, st] of settled) await client.sale.update({ where: { id }, data: { paid: st.paid, due: st.due } });
  } else {
    for (const [id, st] of settled) await client.purchase.update({ where: { id }, data: { paid: st.paid, due: st.due } });
  }
}
