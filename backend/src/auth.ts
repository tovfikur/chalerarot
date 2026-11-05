import { Router, Request, Response, NextFunction } from 'express';
import { randomBytes, scrypt, timingSafeEqual, createHash } from 'crypto';
import { promisify } from 'util';
import { db } from './db';
const derive = promisify(scrypt);
const publicFields = { id: true, name: true, phone: true, email: true, role: true, active: true } as const;
const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const cookie = (req: Request) => (req.headers.cookie ?? '').split(';').map(s => s.trim()).find(s => s.startsWith('arot_session='))?.slice(13) ?? '';
const cookieOptions = { httpOnly: true, sameSite: 'strict' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}
async function verify(password: string, stored: string) {
  const [salt, hex] = stored.split(':');
  const key = await derive(password, salt, 64) as Buffer;
  const expected = Buffer.from(hex, 'hex');
  return expected.length === key.length && timingSafeEqual(expected, key);
}
const wrap = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => { fn(req, res, next).catch(e => {
    res.status(e?.code === 'P2002' ? 409 : 500).json({ error: e?.code === 'P2002' ? 'এই ইমেইলটি ইতিমধ্যে ব্যবহৃত হয়েছে' : 'অনুরোধ সম্পন্ন করা যায়নি' });
  }); };
const attempts = new Map<string, { count: number; until: number }>();
function throttle(req: Request, res: Response, next: NextFunction) {
  const now = Date.now();
  for (const [key, value] of attempts) if (value.until < now) attempts.delete(key);
  const key = req.ip ?? 'local';
  const value = attempts.get(key) ?? { count: 0, until: now + 15 * 60 * 1000 };
  value.count++; attempts.set(key, value);
  if (value.count > 20) { res.status(429).json({ error: 'অনেকবার চেষ্টা হয়েছে। ১৫ মিনিট পরে চেষ্টা করুন' }); return; }
  next();
}
async function session(req: Request) {
  const token = cookie(req);
  if (!token) return null;
  const row = await db.session.findUnique({ where: { id: hashToken(token) }, include: { user: { select: publicFields } } });
  return row && row.expiresAt > new Date() && row.user.active ? row : null;
}
async function signIn(res: Response, userId: string) {
  const token = randomBytes(32).toString('hex');
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.session.create({ data: { id: hashToken(token), userId, expiresAt: new Date(Date.now() + 12 * 3600000) } });
  res.cookie('arot_session', token, { ...cookieOptions, maxAge: 12 * 3600000 });
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
function validContact(b: any) {
  const phone = typeof b.phone === 'string'
    ? b.phone.replace(/[\u09E6-\u09EF]/g, (digit: string) => String(digit.charCodeAt(0) - 0x09E6))
    : '';
  return typeof b.name === 'string' && b.name.trim().length > 0 && b.name.length <= 120 &&
    typeof b.phone === 'string' && /^[+0-9 ()-]{6,30}$/.test(phone);
}function validProfile(b: any) {
  return validContact(b) &&
    typeof b.email === 'string' && b.email.length <= 160 && EMAIL_RE.test(b.email.trim());
}
const validPassword = (p: unknown): p is string => typeof p === 'string' && p.length >= 10 && p.length <= 128;
export const requireAuth = wrap(async (req, res, next) => {
  const row = await session(req);
  if (!row) return res.status(401).json({ error: 'লগইন করুন', code: 'UNAUTHENTICATED' });
  res.locals.user = row.user; next();
});
export function requireAdmin(_req: Request, res: Response, next: NextFunction) {
  if (res.locals.user?.role !== 'admin') { res.status(403).json({ error: 'শুধু প্রশাসকের অনুমতি আছে' }); return; }
  next();
}
export const auth = Router();
auth.get('/status', wrap(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({ setup: await db.user.count() === 0, user: (await session(req))?.user ?? null });
}));
auth.post('/setup', throttle, wrap(async (req, res) => {
  const b = req.body;
  if (!validProfile(b) || !validPassword(b.password)) return res.status(400).json({ error: 'সঠিক নাম, ফোন, ইমেইল ও অন্তত ১০ অক্ষরের পাসওয়ার্ড দিন' });
  const passwordHash = await hashPassword(b.password);
  const user = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(918276)`;
    if (await tx.user.count()) return null;
    const email = b.email.trim().toLowerCase();
    return tx.user.create({ data: { name: b.name.trim(), phone: b.phone.trim(), email, legacyUsername: email, passwordHash, role: 'admin' }, select: publicFields });
  });
  if (!user) return res.status(409).json({ error: 'প্রথম ব্যবহারকারী ইতিমধ্যে তৈরি হয়েছে' });
  await signIn(res, user.id); res.status(201).json(user);
}));
auth.post('/login', throttle, wrap(async (req, res) => {
  const { email, password } = req.body;
  if (typeof email !== 'string' || typeof password !== 'string' || password.length > 128) return res.status(400).json({ error: 'লগইন তথ্য সঠিক নয়' });
  const identifier = email.trim();
  const normalized = identifier.toLowerCase();
  const user = await db.user.findUnique({ where: { email: normalized } })
    ?? await db.user.findFirst({ where: { legacyUsername: { in: [identifier, normalized] } } });
  // Perform the same expensive password derivation for unknown users.
  const ok = await verify(password, user?.passwordHash ?? '00000000000000000000000000000000:' + '00'.repeat(64));
  if (!user?.active || !ok) return res.status(401).json({ error: 'ইমেইল বা পাসওয়ার্ড সঠিক নয়' });
  await signIn(res, user.id);
  res.json(await db.user.findUnique({ where: { id: user.id }, select: publicFields }));
}));
auth.post('/logout', wrap(async (req, res) => {
  await db.session.deleteMany({ where: { id: hashToken(cookie(req)) } });
  res.clearCookie('arot_session', cookieOptions); res.json({ ok: true });
}));
auth.use(requireAuth);
auth.put('/profile', throttle, wrap(async (req, res) => {
  const b = req.body;
  if (!validProfile(b) || (b.password && !validPassword(b.password))) return res.status(400).json({ error: 'সঠিক নাম, ফোন ও ইমেইল দিন; পাসওয়ার্ড অন্তত ১০ অক্ষর হতে হবে' });
  const user = await db.user.findUniqueOrThrow({ where: { id: res.locals.user.id } });
  if (b.password && (typeof b.currentPassword !== 'string' || b.currentPassword.length > 128 || !await verify(b.currentPassword, user.passwordHash))) return res.status(400).json({ error: 'বর্তমান পাসওয়ার্ড সঠিক নয়' });
  const updated = await db.$transaction(async tx => {
    const result = await tx.user.update({ where: { id: user.id }, data: { name: b.name.trim(), phone: b.phone.trim(), email: b.email.trim().toLowerCase(), ...(b.password ? { passwordHash: await hashPassword(b.password) } : {}) }, select: publicFields });
    if (b.password) await tx.session.deleteMany({ where: { userId: user.id } });
    return result;
  });
  if (b.password) await signIn(res, user.id);
  res.json(updated);
}));
export const users = Router();
users.use(requireAdmin);
users.get('/', wrap(async (_req, res) => { res.json(await db.user.findMany({ select: publicFields, orderBy: { createdAt: 'desc' } })); }));
users.post('/', wrap(async (req, res) => {
  const b = req.body;
  if (!validProfile(b) || !validPassword(b.password) || !['admin', 'staff'].includes(b.role)) return res.status(400).json({ error: 'সঠিক তথ্য দিন; পাসওয়ার্ড অন্তত ১০ অক্ষর হতে হবে' });
  const email = b.email.trim().toLowerCase();
  res.status(201).json(await db.user.create({ data: { name: b.name.trim(), phone: b.phone.trim(), email, legacyUsername: email, role: b.role, passwordHash: await hashPassword(b.password) }, select: publicFields }));
}));
users.put('/:id', wrap(async (req, res) => {
  const b = req.body;
  if (!validProfile(b) || !['admin', 'staff'].includes(b.role) || typeof b.active !== 'boolean' || (b.password && !validPassword(b.password))) return res.status(400).json({ error: 'সঠিক ব্যবহারকারীর তথ্য দিন' });
  if (req.params.id === res.locals.user.id && (!b.active || b.role !== 'admin')) return res.status(400).json({ error: 'নিজের প্রশাসক অ্যাকাউন্ট নিষ্ক্রিয় করা যাবে না' });
  const result = await db.$transaction(async tx => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(918276)`;
    const actor = await tx.user.findUnique({ where: { id: res.locals.user.id } });
    if (!actor?.active || actor.role !== 'admin') return null;
    const updated = await tx.user.update({ where: { id: req.params.id }, data: { name: b.name.trim(), phone: b.phone.trim(), email: b.email.trim().toLowerCase(), role: b.role, active: b.active, ...(b.password ? { passwordHash: await hashPassword(b.password) } : {}) }, select: publicFields });
    await tx.session.deleteMany({ where: { userId: updated.id } });
    return updated;
  });
  if (!result) return res.status(403).json({ error: 'অনুমতি নেই' });
  if (result.id === res.locals.user.id) await signIn(res, result.id);
  res.json(result);
}));
