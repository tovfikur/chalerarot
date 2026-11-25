import { Router } from 'express';
import { db } from '../db';
export const settings = Router();
const defaults = { name: 'চালের আড়ত', address: '', phone: '', currency: 'BDT', fiscalStartMonth: 7, language: 'bn', allowNegativeStock: false, bagTransportRates: '{"25":3,"50":6}' };
const toClientSettings = <T extends { bagTransportRates: string }>(row: T) => {
  let bagTransportRates: Record<string, number> = { '25': 3, '50': 6 };
  try {
    const parsed = JSON.parse(row.bagTransportRates);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) bagTransportRates = Object.fromEntries(Object.entries(parsed).filter(([kg, rate]) => Number(kg) > 0 && Number.isFinite(Number(rate)) && Number(rate) >= 0).map(([kg, rate]) => [String(Number(kg)), Number(rate)]));
  } catch {}
  return { ...row, bagTransportRates };
};
settings.get('/', async (_req, res) => {
  try { res.json(toClientSettings((await db.businessSettings.findUnique({ where: { id: 'main' } })) ?? defaults)); }
  catch { res.status(500).json({ error: 'Could not load settings' }); }
});
settings.put('/', async (req, res) => {
  const { name, address, phone, currency, fiscalStartMonth, language } = req.body;
  const rawRates = req.body.bagTransportRates ?? { '25': 3, '50': 6 };
  const validRates = rawRates && typeof rawRates === 'object' && !Array.isArray(rawRates) && Object.entries(rawRates).every(([kg, rate]) => Number.isFinite(Number(kg)) && Number(kg) > 0 && Number.isFinite(Number(rate)) && Number(rate) >= 0);
  const allowNegativeStock = req.body.allowNegativeStock === true;
  if (typeof name !== 'string' || !name.trim() || name.length > 120 ||
      typeof address !== 'string' || address.length > 500 || typeof phone !== 'string' || phone.length > 40 ||
      !['BDT', 'USD', 'INR', 'EUR', 'GBP'].includes(currency) ||
      !Number.isInteger(fiscalStartMonth) || fiscalStartMonth < 1 || fiscalStartMonth > 12 ||
      !['bn', 'en'].includes(language) || !validRates) {
    return res.status(400).json({ error: 'Invalid business settings' });
  }
  try {
    const rates = Object.fromEntries(Object.entries(rawRates).map(([kg, rate]) => [String(Number(kg)), Number(rate)]));
    const data = { name: name.trim(), address: address.trim(), phone: phone.trim(), currency, fiscalStartMonth, language, allowNegativeStock, bagTransportRates: JSON.stringify(rates) };
    res.json(toClientSettings(await db.businessSettings.upsert({ where: { id: 'main' }, create: { id: 'main', ...data }, update: data })));
  } catch { res.status(500).json({ error: 'Could not save settings' }); }
});
