import { Router, Request, Response } from 'express';
import { db } from '../db';
import { revalueStock, round2, writeMovement } from '../valuation';
import { businessToday } from '../units';
import { lockAndCheckCode } from '../code';

const num = (v: unknown, d = 0) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : d;
};

export const products = Router();

// Sale Price = Product.price = the DEFAULT selling rate only.
// It is completely independent of `cost` (the running AVCO): saving a new price
// must never touch cost, stockValue, openingValue or COGS. Old SaleItem rows
// keep their own `rate` snapshot, so past invoices/profit/reports are untouched.
// Money precision follows the rest of the app: 2 decimals, must be > 0.
const parsePrice = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').trim());
  if (!Number.isFinite(n) || !(n > 0)) return null;
  return round2(n);
};
const priceError = { error: 'Sale price must be a number greater than 0', code: 'PRICE_INVALID' };

export const productJson = (p: {
  id: string; code: string | null; name: string; description: string | null; uom: string; cost: number; price: number; openingQtyKg: number; qtyKg: number;
  damagedQtyKg: number; stockValue: number; damagedValue: number;
  openingUnitCost: number; openingValue: number; smallBagKg: number; mediumBagKg: number; largeBagKg: number;
}) => ({
  id: p.id, code: p.code ?? undefined, name: p.name, description: p.description ?? undefined, cost: p.cost, price: p.price,
  opening: p.openingQtyKg, qty: p.qtyKg, damagedQty: p.damagedQtyKg, uom: p.uom,
  // Inventory value (weighted average cost of the stock on hand). This is
  // stock value, NOT available cash.
  stockValue: p.stockValue, damagedValue: p.damagedValue,
  openingUnitCost: p.openingUnitCost, openingValue: p.openingValue,
  smallBagKg: p.smallBagKg, mediumBagKg: p.mediumBagKg, largeBagKg: p.largeBagKg,
});

// GET /api/products (active only — trash excluded)
products.get('/', async (_req: Request, res: Response) => {
  const list = await db.product.findMany({ where: { deletedAt: null }, orderBy: { name: 'asc' } });
  res.json(list.map(productJson));
});

// POST /api/products/bulk
products.post('/bulk', async (req: Request, res: Response) => {
  try {
    const { items } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }
    const day = businessToday();
    const createdList: any[] = [];
    const errors: { row: number; name?: string; error: string }[] = [];

    await db.$transaction(async tx => {
      const allowNegativeStock = (await tx.businessSettings.findUnique({ where: { id: 'main' }, select: { allowNegativeStock: true } }))?.allowNegativeStock ?? false;
      const usedCodes = new Set<string>();

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const rowNum = Number.isInteger(item.rowNum) && item.rowNum > 0 ? item.rowNum : i + 1;
        const name = String(item.name ?? '').trim();
        if (!name) {
          errors.push({ row: rowNum, error: 'Product name is required' });
          continue;
        }
        const rawPrice = item.price;
        const price = rawPrice === undefined || rawPrice === null || String(rawPrice).trim() === '' || Number(rawPrice) === 0 ? 0 : parsePrice(rawPrice);
        if (price === null) {
          errors.push({ row: rowNum, name, error: 'Sale price must be greater than 0 when provided' });
          continue;
        }
        let code = String(item.code ?? '').trim() || null;
        if (code) {
          const codeCheck = await lockAndCheckCode(tx, code, 'product');
          const codeKey = codeCheck.normalized.toUpperCase();
          if (codeCheck.invalid) {
            errors.push({ row: rowNum, name, error: 'Code must use English letters or numbers; hyphen, underscore, dot and slash are allowed' });
            continue;
          }
          if (usedCodes.has(codeKey) || codeCheck.conflict) {
            const conflictName = codeCheck.conflict === 'customer' ? 'Customer' : codeCheck.conflict === 'supplier' ? 'Supplier' : 'Product';
            const error = codeCheck.conflict && codeCheck.conflict !== 'product'
              ? `Code '${code}' is already used by a ${conflictName.toLowerCase()}`
              : `Product code '${code}' is already in use`;
            errors.push({ row: rowNum, name, error });
            continue;
          }
          code = codeCheck.normalized;
          usedCodes.add(codeKey);
        }
        const sb = num(item.smallBagKg, 25);
        const rawMb = num(item.mediumBagKg ?? item.bagKg, 50);
        const mb = rawMb > 0 ? rawMb : 50;
        const lb = num(item.largeBagKg, 50);
        const costPerBag = item.costPerBag !== undefined && String(item.costPerBag).trim() !== ''
          ? Math.max(0, num(item.costPerBag)) : null;
        const openingBags = item.openingBags !== undefined && String(item.openingBags).trim() !== ''
          ? num(item.openingBags) : null;
        const o = round2(openingBags !== null ? openingBags * mb : num(item.opening ?? item.openingQtyKg));
        if (o < 0 && !allowNegativeStock) {
          errors.push({ row: rowNum, name, error: 'Negative opening stock is disabled in inventory settings' });
          continue;
        }
        const c = round2(Math.max(0, costPerBag !== null ? costPerBag / (mb > 0 ? mb : 50) : num(item.cost)));
        const openingValue = round2(o * c);

        const created = await tx.product.create({
          data: {
            code,
            name,
            description: String(item.description ?? '').trim() || null,
            uom: String(item.uom ?? 'বস্তা').trim() || 'বস্তা',
            cost: c,
            price,
            openingQtyKg: o,
            qtyKg: 0,
            openingUnitCost: c,
            openingValue,
            stockValue: 0,
            smallBagKg: sb > 0 ? sb : 25,
            mediumBagKg: mb > 0 ? mb : 50,
            largeBagKg: lb > 0 ? lb : 50,
          },
        });
        const postedStock = o !== 0 ? await writeMovement(tx, created.id, {
            type: 'OPENING',
            bucket: 'sellable',
            qtyKg: o,
            unitCost: c,
            date: day,
            refId: created.id,
            note: o < 0 ? 'bulk-negative-opening-stock' : null,
          }) : null;
        createdList.push(productJson(postedStock ? {
          ...created, qtyKg: postedStock.qtyAfter, stockValue: postedStock.valueAfter, cost: postedStock.avgAfter,
        } : created));
      }
    }, { maxWait: 10_000, timeout: 60_000 });

    res.status(201).json({
      total: items.length,
      successCount: createdList.length,
      errors,
      created: createdList,
    });
  } catch (e) {
    console.error('Bulk product import failed:', e);
    res.status(500).json({ error: e instanceof Error ? `Failed to bulk import products: ${e.message}` : 'Failed to bulk import products' });
  }
});

// POST /api/products
products.post('/', async (req: Request, res: Response) => {
  try {
    const { code, name, description, uom, cost, opening, smallBagKg, mediumBagKg, largeBagKg } = req.body ?? {};
    if (!String(name ?? '').trim()) return res.status(400).json({ error: 'Product name is required' });
    const rawPrice = (req.body ?? {}).price;
    const price = rawPrice === undefined || rawPrice === null || String(rawPrice).trim() === '' || Number(rawPrice) === 0 ? 0 : parsePrice(rawPrice);
    if (price === null) return res.status(400).json(priceError);
    const sb = num(smallBagKg, 25), mb = num(mediumBagKg, 40), lb = num(largeBagKg, 50);
    if (!(sb > 0) || !(mb > 0) || !(lb > 0)) return res.status(400).json({ error: 'Bag weights must be greater than 0' });
    const o = Math.max(0, num(opening));
    const c = num(cost);
    const day = businessToday();
    // Opening stock is valued ONCE, here, at the cost entered on this form.
    const openingValue = round2(o * c);
    const p = await db.$transaction(async tx => {
      const codeValue = String(code ?? '').trim();
      const codeCheck = codeValue ? await lockAndCheckCode(tx, codeValue, 'product') : { normalized: '' };
      if (codeCheck.invalid) throw Object.assign(new Error('Code must use English letters or numbers; hyphen, underscore, dot and slash are allowed'), { code: 'CODE_INVALID' });
      if (codeCheck.conflict) throw Object.assign(new Error('Code is already in use'), { code: 'CODE_EXISTS', conflict: codeCheck.conflict });
      const created = await tx.product.create({
        data: {
          code: codeCheck.normalized || null,
          name: String(name).trim(), description: String(description ?? '').trim() || null,
          uom: String(uom ?? 'kg').trim() || 'kg', cost: c, price,
          openingQtyKg: o, qtyKg: 0, openingUnitCost: c, openingValue,
          stockValue: 0, smallBagKg: sb, mediumBagKg: mb, largeBagKg: lb,
        },
      });
      const postedStock = o > 0 ? await writeMovement(tx, created.id, {
          type: 'OPENING', bucket: 'sellable', qtyKg: o, unitCost: c, date: day, refId: created.id,
        }) : null;
      return postedStock ? {
        ...created, qtyKg: postedStock.qtyAfter, stockValue: postedStock.valueAfter, cost: postedStock.avgAfter,
      } : created;
    });
    // The row is returned so the client can patch this one product in place
    // instead of refetching the whole product list.
    res.status(201).json({ id: p.id, product: productJson(p) });
  } catch (e) {
    if ((e as { code?: string })?.code === 'CODE_INVALID') return res.status(400).json({ error: (e as Error).message, code: 'CODE_INVALID' });
    if ((e as { code?: string })?.code === 'CODE_EXISTS') {
      const type = (e as { conflict?: string }).conflict;
      return res.status(409).json({ error: `Code is already in use${type ? ` by a ${type}` : ''}`, code: 'CODE_EXISTS' });
    }
    if ((e as { code?: string })?.code === 'P2002') return res.status(409).json({ error: 'Product code is already in use', code: 'PRODUCT_CODE_EXISTS' });
    res.status(500).json({ error: 'Failed to create product' });
  }
});

// PUT /api/products/:id (opening change shifts current stock by the delta)
products.put('/:id', async (req: Request, res: Response) => {
  try {
    const { code, name, description, uom, cost, price, opening, smallBagKg, mediumBagKg, largeBagKg } = req.body ?? {};
    const cur = await db.product.findUnique({ where: { id: req.params.id } });
    if (!cur || cur.deletedAt) return res.status(404).json({ error: 'Product not found' });
    if (name !== undefined && !String(name).trim()) return res.status(400).json({ error: 'Product name is required' });
    // Sale Price only: validated here, then written on its own. `cost` keeps its
    // own revaluation path further down and is never derived from the price.
    const nextPrice = price === undefined ? undefined
      : price === null || String(price).trim() === '' || Number(price) === 0 ? 0 : parsePrice(price);
    if (price !== undefined && nextPrice === null) return res.status(400).json(priceError);
    const sb = num(smallBagKg, cur.smallBagKg), mb = num(mediumBagKg, cur.mediumBagKg), lb = num(largeBagKg, cur.largeBagKg);
    if (!(sb > 0) || !(mb > 0) || !(lb > 0)) return res.status(400).json({ error: 'Bag weights must be greater than 0' });
    const o = opening === undefined ? cur.openingQtyKg : Math.max(0, num(opening));
    const day = businessToday();
    const updated = await db.$transaction(async tx => {
      const nextCode = code === undefined ? cur.code : String(code ?? '').trim();
      const codeCheck = nextCode ? await lockAndCheckCode(tx, nextCode, 'product', { entity: 'product', id: cur.id }) : { normalized: '' };
      if (codeCheck.invalid) throw Object.assign(new Error('Code must use English letters or numbers; hyphen, underscore, dot and slash are allowed'), { code: 'CODE_INVALID' });
      if (codeCheck.conflict) throw Object.assign(new Error('Code is already in use'), { code: 'CODE_EXISTS', conflict: codeCheck.conflict });
      const data: Record<string, unknown> = {
        code: code === undefined ? cur.code : (codeCheck.normalized || null),
        name: name === undefined ? cur.name : String(name).trim(),
        description: description === undefined ? cur.description : (String(description ?? '').trim() || null),
        uom: uom === undefined ? cur.uom : (String(uom ?? '').trim() || 'kg'),
        price: nextPrice === undefined ? cur.price : nextPrice,
        openingQtyKg: o,
        smallBagKg: sb, mediumBagKg: mb, largeBagKg: lb,
      };
      // Changing the cost price re-values the stock on hand so the books stay
      // consistent, and records a dated REVALUE movement for the audit trail.
      if (cost !== undefined && num(cost) !== cur.cost) {
        await revalueStock(tx, cur.id, num(cost), day);
      }
      // Changing the opening quantity keeps the original opening valuation
      // frozen and books the difference as a dated ADJUSTMENT movement, so past
      // stock calculations stay reproducible.
      const delta = round2(o - cur.openingQtyKg);
      if (delta !== 0) {
        await writeMovement(tx, cur.id, {
          type: 'ADJUSTMENT', bucket: 'sellable', qtyKg: delta,
          unitCost: cur.stockValue > 0 && cur.qtyKg > 0 ? round2(cur.stockValue / cur.qtyKg) : (cost !== undefined ? num(cost) : cur.cost),
          date: day, refId: cur.id,
        });
      }
      return tx.product.update({ where: { id: cur.id }, data });
    });
    res.json({ id: updated.id, product: productJson(updated) });
  } catch (e) {
    if ((e as { code?: string })?.code === 'CODE_INVALID') return res.status(400).json({ error: (e as Error).message, code: 'CODE_INVALID' });
    if ((e as { code?: string })?.code === 'CODE_EXISTS') {
      const type = (e as { conflict?: string }).conflict;
      return res.status(409).json({ error: `Code is already in use${type ? ` by a ${type}` : ''}`, code: 'CODE_EXISTS' });
    }
    if ((e as { code?: string })?.code === 'P2002') return res.status(409).json({ error: 'Product code is already in use', code: 'PRODUCT_CODE_EXISTS' });
    res.status(500).json({ error: 'Failed to update product' });
  }
});

// DELETE /api/products/:id → always soft-delete (Trash), even with history.
// Unlike customers/vendors, products may be trashed with transaction
// history: the rows stay in the DB so history keeps resolving. Stock and
// new sales/purchases are unaffected except the product leaves active lists.
products.delete('/:id', async (req: Request, res: Response) => {
  try {
    const id = req.params.id;
    const cur = await db.product.findUnique({ where: { id } });
    if (!cur || cur.deletedAt) return res.status(404).json({ error: 'Product not found' });
    await db.product.update({ where: { id }, data: { deletedAt: new Date() } });
    res.json({ id });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete product' });
  }
});

// POST /api/products/adjust - batch stock adjustments from manual inventory audit
products.post('/adjust', async (req: Request, res: Response) => {
  try {
    const { items, date, note } = req.body ?? {};
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is required' });
    }
    const day = date ? String(date).slice(0, 10) : businessToday();
    const auditNote = note && String(note).trim() ? String(note).trim() : 'ম্যানুয়াল স্টক অডিট সমন্বয়';

    const results = await db.$transaction(async tx => {
      const adjusted: any[] = [];
      for (const it of items) {
        const productId = String(it.productId ?? '');
        if (!productId) continue;
        const cur = await tx.product.findUnique({ where: { id: productId } });
        if (!cur || cur.deletedAt) continue;

        let deltaKg = 0;
        if (it.physicalQtyKg !== undefined) {
          const targetKg = Math.max(0, round2(num(it.physicalQtyKg)));
          deltaKg = round2(targetKg - cur.qtyKg);
        } else if (it.deltaKg !== undefined) {
          deltaKg = round2(num(it.deltaKg));
        }

        if (deltaKg !== 0) {
          const unitCost = cur.stockValue > 0 && cur.qtyKg > 0 ? round2(cur.stockValue / cur.qtyKg) : cur.cost;
          const lineReason = it.reason ? `${auditNote} - ${String(it.reason).trim()}` : auditNote;
          const movement = await writeMovement(tx, cur.id, {
            type: 'ADJUSTMENT',
            bucket: 'sellable',
            qtyKg: deltaKg,
            unitCost,
            date: day,
            refId: lineReason,
          });
          adjusted.push({
            id: cur.id,
            name: cur.name,
            code: cur.code,
            beforeKg: cur.qtyKg,
            deltaKg,
            afterKg: round2(cur.qtyKg + deltaKg),
            unitCost,
            value: movement.value,
            reason: lineReason,
          });
        }
      }
      return adjusted;
    });

    res.json({ success: true, count: results.length, adjusted: results });
  } catch (e) {
    console.error('Stock adjust error:', e);
    res.status(500).json({ error: e instanceof Error ? e.message : 'Failed to adjust stock' });
  }
});
