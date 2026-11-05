import 'dotenv/config';
import { randomBytes, scrypt as scryptCallback } from 'crypto';
import { promisify } from 'util';
import { db } from '../src/db';

const scrypt = promisify(scryptCallback);

type SeedRole = 'admin' | 'staff';
type SeedUser = { role: SeedRole; name: string; phone: string; email: string; password: string };

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function readUser(role: SeedRole): SeedUser {
  const prefix = `SEED_${role.toUpperCase()}`;
  const user = {
    role,
    name: required(`${prefix}_NAME`),
    phone: required(`${prefix}_PHONE`),
    email: required(`${prefix}_EMAIL`).toLowerCase(),
    password: required(`${prefix}_PASSWORD`),
  };
  if (user.password.length < 10 || user.password.length > 128) {
    throw new Error(`${prefix}_PASSWORD must be between 10 and 128 characters`);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(user.email)) {
    throw new Error(`${prefix}_EMAIL must be a valid email address`);
  }
  if (!/^[+0-9 ()-]{6,30}$/.test(user.phone)) {
    throw new Error(`${prefix}_PHONE must be a valid phone number`);
  }
  return user;
}

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64) as Buffer;
  return `${salt}:${key.toString('hex')}`;
}

async function main() {
  // Validate both records before writing either one.
  const users = [readUser('admin'), readUser('staff')];
  if (users[0].email === users[1].email) throw new Error('Admin and staff seed emails must be different');

  for (const user of users) {
    const existing = await db.user.findUnique({ where: { email: user.email }, select: { id: true } });
    if (existing) {
      console.log(`Skipped ${user.role}: ${user.email} already exists; existing account was left unchanged.`);
      continue;
    }

    await db.user.create({ data: {
      name: user.name,
      phone: user.phone,
      email: user.email,
      legacyUsername: user.email,
      role: user.role,
      passwordHash: await hashPassword(user.password),
    } });
    console.log(`Created ${user.role} user: ${user.email}`);
  }
}

main()
  .catch(error => { console.error('Failed to seed users:', error); process.exitCode = 1; })
  .finally(async () => { await db.$disconnect(); });
