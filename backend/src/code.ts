import { Prisma } from '@prisma/client';

export type CodedEntity = 'product' | 'customer' | 'supplier';

/**
 * Serialize claims for a normalized code across all coded entities. The lock
 * closes the race between the cross-table check and insert/update.
 */
export async function lockAndCheckCode(
  tx: Prisma.TransactionClient,
  code: string,
  exclude?: { entity: CodedEntity; id: string },
): Promise<{ normalized: string; conflict?: CodedEntity; invalid?: boolean }> {
  const normalized = code.trim();
  if (!normalized) return { normalized };
  const comparisonKey = normalized.toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9._/-]{0,49}$/.test(comparisonKey)) return { normalized, invalid: true };

  // Return a supported scalar type from Prisma's raw query. Selecting the lock
  // function directly returns PostgreSQL `void`, which Prisma cannot decode.
  await tx.$queryRaw`WITH acquired AS MATERIALIZED (SELECT pg_advisory_xact_lock(hashtext(${comparisonKey}))) SELECT 1 AS locked FROM acquired`;
  const [product, customer, supplier] = await Promise.all([
    tx.product.findFirst({ where: { code: { equals: comparisonKey, mode: 'insensitive' }, ...(exclude?.entity === 'product' ? { id: { not: exclude.id } } : {}) }, select: { id: true } }),
    tx.customer.findFirst({ where: { code: { equals: comparisonKey, mode: 'insensitive' }, ...(exclude?.entity === 'customer' ? { id: { not: exclude.id } } : {}) }, select: { id: true } }),
    tx.vendor.findFirst({ where: { code: { equals: comparisonKey, mode: 'insensitive' }, ...(exclude?.entity === 'supplier' ? { id: { not: exclude.id } } : {}) }, select: { id: true } }),
  ]);
  if (product) return { normalized, conflict: 'product' };
  if (customer) return { normalized, conflict: 'customer' };
  if (supplier) return { normalized, conflict: 'supplier' };
  return { normalized };
}
