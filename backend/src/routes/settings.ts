import { Router } from 'express';
import { db } from '../db';
export const settings = Router();
const defaults = { name: 'চালের আড়ত', address: '', phone: '', currency: 'BDT', fiscalStartMonth: 7, language: 'bn', allowNegativeStock: false };
settings.get('/', async (_req, res) => {
  try { res.json((await db.businessSettings.findUnique({ where: { id: 'main' } })) ?? defaults); }
  catch { res.status(500).json({ error: 'Could not load settings' }); }
});
settings.put('/', async (req, res) => {
  const { name, address, phone, currency, fiscalStartMonth, language } = req.body;
  const allowNegativeStock = req.body.allowNegativeStock === true;
  if (typeof name !== 'string' || !name.trim() || name.length > 120 ||
      typeof address !== 'string' || address.length > 500 || typeof phone !== 'string' || phone.length > 40 ||
      !['BDT', 'USD', 'INR', 'EUR', 'GBP'].includes(currency) ||
      !Number.isInteger(fiscalStartMonth) || fiscalStartMonth < 1 || fiscalStartMonth > 12 ||
      !['bn', 'en'].includes(language)) {
    return res.status(400).json({ error: 'Invalid business settings' });
  }
  try {
    const data = { name: name.trim(), address: address.trim(), phone: phone.trim(), currency, fiscalStartMonth, language, allowNegativeStock };
    res.json(await db.businessSettings.upsert({ where: { id: 'main' }, create: { id: 'main', ...data }, update: data }));
  } catch { res.status(500).json({ error: 'Could not save settings' }); }
});
