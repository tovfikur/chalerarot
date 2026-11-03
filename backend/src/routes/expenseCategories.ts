import { Router } from 'express';
import { db } from '../db';

const KINDS = ['operating', 'landing', 'transport', 'other'];

export const expenseCategories = Router();

expenseCategories.get('/', async (_req, res) => {
  const rows = await db.expenseCategory.findMany({ orderBy: { createdAt: 'asc' } });
  res.json(rows);
});

expenseCategories.post('/', async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const kind = String(req.body?.kind ?? 'operating');
  if (!name || name.length > 60) {
    return res.status(400).json({ error: 'Category name is required (max 60 characters).' });
  }
  if (!KINDS.includes(kind)) {
    return res.status(400).json({ error: 'Invalid category type.' });
  }
  const existing = await db.expenseCategory.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing) {
    return res.status(409).json({ error: 'A category with this name already exists.' });
  }
  try {
    const row = await db.expenseCategory.create({ data: { name, kind } });
    res.status(201).json(row);
  } catch {
    res.status(409).json({ error: 'A category with this name already exists.' });
  }
});

expenseCategories.put('/:id', async (req, res) => {
  const id = String(req.params.id);
  const name = String(req.body?.name ?? '').trim();
  const kind = String(req.body?.kind ?? 'operating');
  if (!name || name.length > 60) return res.status(400).json({ error: 'Category name is required (max 60 characters).' });
  if (!KINDS.includes(kind)) return res.status(400).json({ error: 'Invalid category type.' });
  const current = await db.expenseCategory.findUnique({ where: { id } });
  if (!current) return res.status(404).json({ error: 'Category not found.' });
  const duplicate = await db.expenseCategory.findFirst({
    where: { id: { not: id }, name: { equals: name, mode: 'insensitive' } },
  });
  if (duplicate) return res.status(409).json({ error: 'A category with this name already exists.' });
  try {
    const row = await db.$transaction(async tx => {
      const updated = await tx.expenseCategory.update({ where: { id }, data: { name, kind } });
      if (current.name !== name) {
        await tx.expense.updateMany({ where: { category: 'other', customName: current.name }, data: { customName: name } });
      }
      return updated;
    });
    res.json(row);
  } catch {
    res.status(409).json({ error: 'A category with this name already exists.' });
  }
});

expenseCategories.delete('/:id', async (req, res) => {
  const current = await db.expenseCategory.findUnique({ where: { id: String(req.params.id) } });
  if (!current) return res.status(404).json({ error: 'Category not found.' });
  await db.$transaction(async tx => {
    // Keep all historical expense records, but detach them from the custom category.
    await tx.expense.updateMany({ where: { category: 'other', customName: current.name }, data: { customName: null } });
    await tx.expenseCategory.delete({ where: { id: current.id } });
  });
  res.json({ id: current.id });
});
