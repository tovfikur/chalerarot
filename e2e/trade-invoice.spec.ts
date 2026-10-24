import { expect, test } from '@playwright/test';

const bootstrap = {
  products: [{ id: 'p1', name: 'Test rice', cost: 900, price: 1200, opening: 40, qty: 40, uom: 'kg', smallBagKg: 25, mediumBagKg: 50, largeBagKg: 50 }],
  customers: [{ id: 'c1', code: '340', name: 'Test customer', mobile: '01700000000', opening: 0 }],
  vendors: [{ id: 'v1', code: '340', name: 'Test vendor', mobile: '01800000000', opening: 0 }],
  sales: [], purchases: [], customerPayments: [], vendorPayments: [], movements: [], expenses: [], returns: [],
  money: [], moneyAccounts: [], transfers: [], finance: { today: {}, lifetime: {} },
};

test('creates a sale invoice with explicit rates and selected party', async ({ page }) => {
  let savedSale: Record<string, unknown> | undefined;
  page.on('pageerror', error => console.log('page error', error.stack));
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/bootstrap')) return route.fulfill({ json: bootstrap });
    if (path.endsWith('/sales') && route.request().method() === 'POST') {
      savedSale = route.request().postDataJSON();
      return route.fulfill({ json: { id: 'sale-e2e-1', invoiceNo: 'SAL-E2E-1', total: 6000 } });
    }
    if (path.endsWith('/reminders')) return route.fulfill({ json: { reminders: [] } });
    return route.fulfill({ json: [] });
  });

  const bootstrapResponse = page.waitForResponse(response => response.url().endsWith('/api/bootstrap'));
  await page.goto('/');
  await bootstrapResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.getByTestId('nav-sale').click();

  await page.getByLabel('Product code 1').fill('1');
  const rate = page.getByLabel('Sale rate 1');
  await expect(rate).toHaveValue('');
  await page.getByLabel('Quantity 1').fill('2');

  await page.getByTestId('complete-invoice').click();
  await expect(page.getByRole('alert')).toContainText('Select a customer');
  expect(savedSale).toBeUndefined();

  await page.getByLabel('Customer code').fill('340');
  await page.getByTestId('complete-invoice').click();
  await expect(page.getByRole('alert')).toContainText('Enter a sale rate');
  expect(savedSale).toBeUndefined();

  await rate.fill('3000');
  await page.getByTestId('complete-invoice').click();
  await expect(page.getByText('Test customer').last()).toBeVisible();
  await page.getByTestId('execute-invoice').click();

  await expect.poll(() => savedSale).toBeTruthy();
  expect(savedSale).toMatchObject({
    customerId: 'c1',
    lines: [{ productId: 'p1', unit: 'medium', enteredQty: 2, rate: 60 }],
  });
  await expect(page.getByText('SAL-E2E-1')).toBeVisible();
});
