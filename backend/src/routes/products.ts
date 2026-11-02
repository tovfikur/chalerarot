import { Router, Request, Response } from 'express';
import { db } from '../db';
import { revalueStock, round2, writeMovement } from '../valuation';
import { businessToday } from '../units';

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
      const existing = await tx.product.findMany({
        where: { deletedAt: null, code: { not: null } },
        select: { code: true },
      });
      const usedCodes = new Set(
        existing.map(p => p.code?.trim().toLowerCase()).filter(Boolean)
      );

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const rowNum = i + 1;
        const name = String(item.name ?? '').trim();
        if (!name) {
          errors.push({ row: rowNum, error: 'Product name is required' });
          continue;
        }
        const price = parsePrice(item.price);
        if (price === null) {
          errors.push({ row: rowNum, name, error: 'Sale price must be a number greater than 0' });
          continue;
        }
        let code = String(item.code ?? '').trim() || null;
        if (code) {
          const codeLower = code.toLowerCase();
          if (usedCodes.has(codeLower)) {
            errors.push({ row: rowNum, name, error: `Product code '${code}' is already in use` });
            continue;
          }
          usedCodes.add(codeLower);
        }
        const sb = num(item.smallBagKg, 25);
        const mb = num(item.mediumBagKg ?? item.bagKg, 50);
        const lb = num(item.largeBagKg, 50);
        const o = Math.max(0, num(item.opening ?? item.openingQtyKg));
        const c = Math.max(0, num(item.cost));
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
            qtyKg: o,
            openingUnitCost: c,
            openingValue,
            stockValue: openingValue,
            smallBagKg: sb > 0 ? sb : 25,
            mediumBagKg: mb > 0 ? mb : 50,
            largeBagKg: lb > 0 ? lb : 50,
          },
        });
        if (o > 0) {
          await writeMovement(tx, created.id, {
            type: 'OPENING',
            bucket: 'sellable',
            qtyKg: o,
            unitCost: c,
            date: day,
            refId: created.id,
          });
        }
        createdList.push(productJson(created));
      }
    });

    res.status(201).json({
      total: items.length,
      successCount: createdList.length,
      errors,
      created: createdList,
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to bulk import products' });
  }
});

// POST /api/products
products.post('/', async (req: Request, res: Response) => {
  try {
    const { code, name, description, uom, cost, opening, smallBagKg, mediumBagKg, largeBagKg } = req.body ?? {};
    if (!String(name ?? '').trim()) return res.status(400).json({ error: 'Product name is required' });
    const price = parsePrice((req.body ?? {}).price);
    if (price === null) return res.status(400).json(priceError);
    const sb = num(smallBagKg, 25), mb = num(mediumBagKg, 40), lb = num(largeBagKg, 50);
    if (!(sb > 0) || !(mb > 0) || !(lb > 0)) return res.status(400).json({ error: 'Bag weights must be greater than 0' });
    const o = Math.max(0, num(opening));
    const c = num(cost);
    const day = businessToday();
    // Opening stock is valued ONCE, here, at the cost entered on this form.
    const openingValue = round2(o * c);
    const p = await db.$transaction(async tx => {
      const created = await tx.product.create({
        data: {
          code: String(code ?? '').trim() || null,
          name: String(name).trim(), description: String(description ?? '').trim() || null,
          uom: String(uom ?? 'kg').trim() || 'kg', cost: c, price,
          openingQtyKg: o, qtyKg: o, openingUnitCost: c, openingValue,
          stockValue: openingValue, smallBagKg: sb, mediumBagKg: mb, largeBagKg: lb,
        },
      });
      if (o > 0) {
        await writeMovement(tx, created.id, {
          type: 'OPENING', bucket: 'sellable', qtyKg: o, unitCost: c, date: day, refId: created.id,
        });
      }
      return created;
    });
    // The row is returned so the client can patch this one product in place
    // instead of refetching the whole product list.
    res.status(201).json({ id: p.id, product: productJson(p) });
  } catch (e) {
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
    const nextPrice = price === undefined ? undefined : parsePrice(price);
    if (price !== undefined && nextPrice === null) return res.status(400).json(priceError);
    const sb = num(smallBagKg, cur.smallBagKg), mb = num(mediumBagKg, cur.mediumBagKg), lb = num(largeBagKg, cur.largeBagKg);
    if (!(sb > 0) || !(mb > 0) || !(lb > 0)) return res.status(400).json({ error: 'Bag weights must be greater than 0' });
    const o = opening === undefined ? cur.openingQtyKg : Math.max(0, num(opening));
    const day = businessToday();
    const updated = await db.$transaction(async tx => {
      const data: Record<string, unknown> = {
        code: code === undefined ? cur.code : (String(code ?? '').trim() || null),
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
          await writeMovement(tx, cur.id, {
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
