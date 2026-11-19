export type LandingCostType = 'transport' | 'stockInLabour' | 'stockOutLabour';
export type ExpenseLandingType = LandingCostType | 'splitLabour' | null | undefined;

export const landingAccount = (type: LandingCostType) => ({
  transport: 'Transport Cost Payable',
  stockInLabour: 'Stock In Labour Payable',
  stockOutLabour: 'Stock Out Labour Payable',
}[type]);

export function expenseLandingType(expense: {
  landingType?: string | null; capitalized?: boolean; customName?: string | null; note?: string | null;
}): ExpenseLandingType {
  if (expense.landingType === 'transport' || expense.landingType === 'stockInLabour' || expense.landingType === 'stockOutLabour' || expense.landingType === 'splitLabour') return expense.landingType;
  const label = `${expense.customName ?? ''} ${expense.note ?? ''}`;
  if (/transport|পরিবহন/i.test(label)) return 'transport';
  if (expense.capitalized && label.includes('#')) return 'splitLabour';
  return null;
}

export function landingShares(amount: number, type: ExpenseLandingType): Partial<Record<LandingCostType, number>> {
  if (type === 'splitLabour') {
    const stockInLabour = Math.round(amount / 2 * 100) / 100;
    return { stockInLabour, stockOutLabour: Math.round((amount - stockInLabour) * 100) / 100 };
  }
  if (type === 'transport') return { transport: amount };
  if (type === 'stockInLabour') return { stockInLabour: amount };
  if (type === 'stockOutLabour') return { stockOutLabour: amount };
  return {};
}

export function linkedLandedExpenseId(sourceId: string, expenseIds: ReadonlySet<string>): string | null {
  const separator = sourceId.indexOf(':');
  const expenseId = separator < 0 ? sourceId : sourceId.slice(0, separator);
  return expenseIds.has(expenseId) ? expenseId : null;
}

export function landedPaymentType(sourceId: string, expenseId: string): LandingCostType | null {
  if (!sourceId.startsWith(`${expenseId}:`)) return null;
  const suffix = sourceId.slice(expenseId.length + 1);
  const match = suffix.match(/^(transport|stockInLabour|stockOutLabour):/);
  return match ? match[1] as LandingCostType : null;
}

type WageCost = { id: string; labourerId: string; direction: string; amount: number; advanceApplied: number; date: string; createdAt: Date };
type WagePayment = { id: string; labourerId: string; amount: number; date: string; createdAt: Date; direction?: string | null };

/** Allocates each labour payment to the oldest unpaid wage for that worker. */
export function allocateLabourPayments(costs: WageCost[], payments: WagePayment[]) {
  const unpaidByCost = new Map(costs.map(cost => [cost.id, Math.max(0, Math.round((cost.amount - cost.advanceApplied) * 100) / 100)]));
  const paidByCost = new Map<string, number>();
  const paidByPayment = new Map<string, { stockInLabour: number; stockOutLabour: number }>();
  const events = [
    ...costs.map(cost => ({ date: cost.date, createdAt: cost.createdAt.getTime(), order: 0, cost })),
    ...payments.map(payment => ({ date: payment.date, createdAt: payment.createdAt.getTime(), order: 1, payment })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt || a.order - b.order);
  const open: WageCost[] = [];
  for (const event of events) {
    if ('cost' in event) {
      open.push(event.cost);
      continue;
    }
    let remaining = Math.round(event.payment.amount * 100) / 100;
    const allocation = { stockInLabour: 0, stockOutLabour: 0 };
    for (const cost of open) {
      if (remaining <= 0) break;
      if (cost.labourerId !== event.payment.labourerId) continue;
      if (event.payment.direction && event.payment.direction !== cost.direction) continue;
      const available = unpaidByCost.get(cost.id) ?? 0;
      const applied = Math.min(available, remaining);
      if (applied <= 0) continue;
      unpaidByCost.set(cost.id, Math.round((available - applied) * 100) / 100);
      paidByCost.set(cost.id, Math.round(((paidByCost.get(cost.id) ?? 0) + applied) * 100) / 100);
      const type = cost.direction === 'stockOut' ? 'stockOutLabour' : 'stockInLabour';
      allocation[type] = Math.round((allocation[type] + applied) * 100) / 100;
      remaining = Math.round((remaining - applied) * 100) / 100;
    }
    paidByPayment.set(event.payment.id, allocation);
  }
  return { paidByCost, paidByPayment, unpaidByCost };
}
