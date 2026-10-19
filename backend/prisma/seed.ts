// Database cleanup and clean baseline setup.
// Removes all mock/dummy data and initializes clean baseline accounts for production.
import { db } from '../src/db';

async function main() {
  console.log('Cleaning up mock data from PostgreSQL...');

  // Wipe all mock transactions, items, movements, and records in FK-safe order
  await db.stockMovement.deleteMany();
  await db.saleItem.deleteMany();
  await db.purchaseItem.deleteMany();
  await db.customerPayment.deleteMany();
  await db.vendorPayment.deleteMany();
  await db.expense.deleteMany();
  await db.moneyMovement.deleteMany();
  await db.moneyTransfer.deleteMany();
  await db.moneyAccount.deleteMany();
  await db.productReturnItem.deleteMany();
  await db.productReturn.deleteMany();
  await db.notification.deleteMany();
  await db.sale.deleteMany();
  await db.purchase.deleteMany();
  await db.product.deleteMany();
  await db.customer.deleteMany();
  await db.vendor.deleteMany();
  await db.sequence.deleteMany();

  console.log('All mock data wiped successfully.');

  // Create clean initial baseline accounts with 0 balance for live operation
  const today = new Date().toISOString().slice(0, 10);
  const baselineAccounts = [
    { id: 'cash', name: 'ক্যাশ বাক্স (Main Cash)', type: 'cash', legacyMethod: 'cash', openingBalance: 0, openingDate: today, active: true },
    { id: 'bank', name: 'প্রধান ব্যাংক একাউন্ট', type: 'bank', legacyMethod: 'bank', openingBalance: 0, openingDate: today, active: true },
    { id: 'bkash', name: 'বিকাশ (bKash)', type: 'bkash', legacyMethod: 'bkash', openingBalance: 0, openingDate: today, active: true },
    { id: 'nagad', name: 'নগদ (Nagad)', type: 'nagad', legacyMethod: 'nagad', openingBalance: 0, openingDate: today, active: true },
  ];

  for (const acc of baselineAccounts) {
    await db.moneyAccount.create({ data: acc });
  }

  console.log('Clean baseline accounts initialized with 0 balance.');
}

main()
  .catch(e => {
    console.error('Failed to clean database:', e);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
