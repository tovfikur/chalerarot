export type PartyBalanceTransaction = {
  id: string;
  partyId: string;
  kind: 'sale' | 'purchase' | 'payment' | 'sreturn' | 'preturn';
  amount: number;
  date: string;
  createdAt?: string;
  returnId?: string;
  saleId?: string;
  purchaseId?: string;
  ref?: string;
  transactionNo?: string;
  account?: string;
  note?: string;
};

export type PartyBalanceSnapshot = { previousDue: number; amount: number; currentDue: number };
export type PartyBalanceTimelineRow = { transaction: PartyBalanceTransaction; previousDue: number; currentDue: number };

/** Balance immediately before and after a transaction, using the same debit
 * and credit signs as the customer and supplier account views. */
export function partyBalanceSnapshot(
  transactions: PartyBalanceTransaction[],
  partyId: string,
  transactionId: string,
  opening: number,
): PartyBalanceSnapshot | undefined {
  const row = partyBalanceTimeline(transactions, partyId, opening).find(item => item.transaction.id === transactionId || item.transaction.returnId === transactionId);
  return row ? { previousDue: row.previousDue, amount: row.transaction.amount, currentDue: row.currentDue } : undefined;
}

export function partyBalanceTimeline(transactions: PartyBalanceTransaction[], partyId: string, opening: number): PartyBalanceTimelineRow[] {
  const rows = transactions.filter(row => row.partyId === partyId)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      const aTime = String(a.createdAt ?? ''), bTime = String(b.createdAt ?? '');
      if (aTime !== bTime) return aTime.localeCompare(bTime);
      const linkedToB = a.kind === 'payment' && (a.saleId === b.id || a.purchaseId === b.id || a.returnId === b.id);
      const linkedToA = b.kind === 'payment' && (b.saleId === a.id || b.purchaseId === a.id || b.returnId === a.id);
      if (linkedToB !== linkedToA) return linkedToB ? 1 : -1;
      return a.id.localeCompare(b.id);
    });
  let balance = opening;
  const result: PartyBalanceTimelineRow[] = [];
  for (const row of rows) {
    const previousDue = Math.round(balance * 100) / 100;
    const effect = row.kind === 'sale' || row.kind === 'purchase' ? row.amount : -row.amount;
    balance = Math.round((balance + effect) * 100) / 100;
    result.push({ transaction: row, previousDue, currentDue: balance });
  }
  return result;
}
