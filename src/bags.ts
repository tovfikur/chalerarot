import type { Product } from './store';

// Single shared quantity system for Sales and Purchase.
// Stock is ALWAYS kept in KG internally. Bags/Ton are only entry units.
export type BagUnit = 'kg' | 'small' | 'medium' | 'large' | 'ton';

export const KG_PER_TON = 1000;
export const DEFAULT_BAGS = { small: 25, medium: 40, large: 50 };

type BagHolder = Pick<Product, 'smallBagKg' | 'mediumBagKg' | 'largeBagKg'>;

export const bagKgOf = (p: BagHolder | undefined, unit: 'small' | 'medium' | 'large'): number => {
  const v = !p ? 0 : unit === 'small' ? p.smallBagKg : unit === 'medium' ? p.mediumBagKg : p.largeBagKg;
  return v > 0 ? v : DEFAULT_BAGS[unit];
};

// KG represented by ONE unit of the given type for this product.
export const kgPerUnit = (p: BagHolder | undefined, unit: BagUnit): number => {
  if (unit === 'kg') return 1;
  if (unit === 'ton') return KG_PER_TON;
  return bagKgOf(p, unit);
};

// Convert an entered quantity into KG (the only unit that ever touches stock).
export const toKg = (p: BagHolder | undefined, unit: BagUnit, qty: number): number => qty * kgPerUnit(p, unit);

// Cart keeps the KG values for stock/money plus the original entry for display.
export type CartLine = {
  productId: string;
  unit: BagUnit;
  enteredQty: number;
  qtyKg: number;
  rate: number; // per KG
};

export const lineTotal = (l: Pick<CartLine, 'qtyKg' | 'rate'>): number => l.qtyKg * l.rate;
