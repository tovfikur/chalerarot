import { expect, test } from '@playwright/test';

const bootstrap = {
  products: [{ id: 'p1', code: 'RICE-001', name: 'Test rice', description: '', cost: 900, price: 1200, opening: 40, qty: 40, uom: 'kg', smallBagKg: 25, mediumBagKg: 50, largeBagKg: 50 }],
  customers: [{ id: 'c1', code: '340', name: 'Test customer', mobile: '01700000000', opening: 0 }],
  vendors: [{ id: 'v1', code: 'VEN-982', name: 'Test vendor', mobile: '01800000000', opening: 0 }],
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

  await page.getByLabel('Open calendar').click();
  const calendar = page.getByTestId('invoice-calendar-modal');
  await expect(calendar).toBeVisible();
  await page.getByLabel(/^Choose \d{4}-\d{2}-15$/).click();
  await expect(page.getByLabel('Invoice date')).toHaveValue(/\d{2}\/\d{2}\/\d{4}/);

  await page.getByLabel('Product code 1').fill('RICE-001');
  await expect(page.getByTestId('add-product-row')).toHaveCount(1);
  const productDropdown = await page.getByTestId('product-dropdown-1').boundingBox();
  expect(productDropdown?.width ?? 0).toBeGreaterThan(320);
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

test('completes the sale workflow with keyboard navigation', async ({ page }) => {
  let savedSale: Record<string, unknown> | undefined;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/bootstrap')) return route.fulfill({ json: bootstrap });
    if (path.endsWith('/sales') && route.request().method() === 'POST') {
      savedSale = route.request().postDataJSON();
      return route.fulfill({ json: { id: 'sale-keyboard-e2e', invoiceNo: 'SAL-KEY-1', total: 6000 } });
    }
    if (path.endsWith('/reminders')) return route.fulfill({ json: { reminders: [] } });
    return route.fulfill({ json: [] });
  });

  const bootstrapResponse = page.waitForResponse(response => response.url().endsWith('/api/bootstrap'));
  await page.goto('/');
  await bootstrapResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  const saleNavigation = page.getByTestId('nav-sale');
  await saleNavigation.focus();
  await page.keyboard.press('Enter');

  const memo = page.getByLabel('Sale memo number');
  await expect(memo).toBeFocused();
  await memo.fill('KEY-1');
  await memo.press('Enter');

  const customerCode = page.getByLabel('Customer code');
  await expect(customerCode).toBeFocused();
  await customerCode.fill('340');
  await customerCode.press('ArrowDown');
  await customerCode.press('Enter');

  const date = page.getByLabel('Invoice date');
  await expect(date).toBeFocused();
  const calendarButton = page.getByLabel('Open calendar');
  await calendarButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('invoice-calendar-modal')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('invoice-calendar-modal')).toBeHidden();
  await date.focus();
  await date.press('Enter');

  const productCode = page.getByLabel('Product code 1');
  await expect(productCode).toBeFocused();
  await expect(productCode).not.toHaveAttribute('placeholder');
  await productCode.press('ArrowDown');
  await productCode.press('Enter');

  const quantity = page.getByLabel('Quantity 1');
  await expect(quantity).toBeFocused();
  await quantity.fill('2');
  await quantity.press('Enter');

  const purchaseCost = page.getByLabel('Purchase cost 1');
  await expect(purchaseCost).toBeFocused();
  await purchaseCost.fill('1000');
  await purchaseCost.press('Enter');

  const saleRate = page.getByLabel('Sale rate 1');
  await expect(saleRate).toBeFocused();
  await saleRate.fill('3000');
  await saleRate.press('Enter');
  const complete = page.getByTestId('complete-invoice');
  await complete.focus();
  await page.keyboard.press('Enter');

  const cash = page.getByLabel('Cash paid');
  await expect(cash).toBeFocused();
  await cash.press('Enter');
  await page.getByLabel('Bank paid').press('Enter');
  await page.getByLabel('Discount').press('Enter');
  await page.getByLabel('Transport cost').press('Enter');
  await page.getByLabel('Landing cost').press('Enter');
  await page.getByTestId('execute-invoice').focus();
  await page.keyboard.press('Enter');

  await expect.poll(() => savedSale).toBeTruthy();
  expect(savedSale).toMatchObject({
    customerId: 'c1',
    lines: [{ productId: 'p1', unit: 'medium', enteredQty: 2, rate: 60 }],
  });
});

test('completes the purchase workflow with keyboard navigation', async ({ page }) => {
  let savedPurchase: Record<string, unknown> | undefined;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/bootstrap')) return route.fulfill({ json: bootstrap });
    if (path.endsWith('/purchases') && route.request().method() === 'POST') {
      savedPurchase = route.request().postDataJSON();
      return route.fulfill({ json: { id: 'purchase-keyboard-e2e', invoiceNo: 'PUR-KEY-1', total: 6000 } });
    }
    if (path.endsWith('/reminders')) return route.fulfill({ json: { reminders: [] } });
    return route.fulfill({ json: [] });
  });

  const bootstrapResponse = page.waitForResponse(response => response.url().endsWith('/api/bootstrap'));
  await page.goto('/');
  await bootstrapResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

  const purchaseNavigation = page.getByTestId('nav-purchase');
  await purchaseNavigation.focus();
  await page.keyboard.press('Enter');

  const memo = page.getByLabel('Purchase memo number');
  await expect(memo).toBeFocused();
  await expect(memo).not.toHaveAttribute('placeholder');
  await memo.fill('KEY-2');
  await memo.press('Enter');

  const vendorCode = page.getByLabel('Vendor code');
  await vendorCode.fill('VEN-982');
  await vendorCode.press('ArrowDown');
  await vendorCode.press('Enter');
  await expect(vendorCode).toHaveValue('VEN-982');
  await page.getByLabel('Invoice date').press('Enter');

  const productCode = page.getByLabel('Product code 1');
  await expect(productCode).not.toHaveAttribute('placeholder');
  await productCode.fill('RICE-001');
  await productCode.press('Enter');
  await page.getByLabel('Quantity 1').fill('2');
  await page.getByLabel('Quantity 1').press('Enter');
  const purchaseRate = page.getByLabel('Purchase rate 1');
  await expect(purchaseRate).not.toHaveAttribute('placeholder');
  await purchaseRate.fill('3000');
  await purchaseRate.press('Enter');
  const complete = page.getByTestId('complete-invoice');
  await complete.focus();
  await page.keyboard.press('Enter');

  await page.getByLabel('Cash paid').press('Enter');
  await page.getByLabel('Bank paid').press('Enter');
  await page.getByLabel('Discount').press('Enter');
  await page.getByLabel('Transport cost').press('Enter');
  await page.getByLabel('Landing cost').press('Enter');
  await page.getByTestId('execute-invoice').focus();
  await page.keyboard.press('Enter');

  await expect.poll(() => savedPurchase).toBeTruthy();
  expect(savedPurchase).toMatchObject({
    vendorId: 'v1',
    lines: [{ productId: 'p1', unit: 'medium', enteredQty: 2, rate: 60 }],
  });
});

test('saves and reloads the vendor code entered in the party form', async ({ page }) => {
  let savedVendor: Record<string, unknown> | undefined;
  const vendors = [...bootstrap.vendors];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/bootstrap')) return route.fulfill({ json: { ...bootstrap, vendors } });
    if (path.endsWith('/vendors') && route.request().method() === 'POST') {
      savedVendor = route.request().postDataJSON();
      vendors.push({ id: 'v-new', ...savedVendor } as typeof bootstrap.vendors[number]);
      return route.fulfill({ status: 201, json: { id: 'v-new' } });
    }
    if (path.endsWith('/reminders')) return route.fulfill({ json: { reminders: [] } });
    return route.fulfill({ json: [] });
  });

  const bootstrapResponse = page.waitForResponse(response => response.url().endsWith('/api/bootstrap'));
  await page.goto('/');
  await bootstrapResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.getByTestId('nav-vendors').click();
  await page.getByTestId('list-page-add').click();
  await page.getByLabel('Party code').fill('VEND-ALPHA-01');
  await page.getByLabel('Party name').fill('Code persistence test');
  await page.getByTestId('save-party').click();

  await expect.poll(() => savedVendor?.code).toBe('VEND-ALPHA-01');
  await expect(page.getByText('VEND-ALPHA-01')).toBeVisible();
});

test('saves and reloads product code, description, and unit through the database API', async ({ page }) => {
  let savedProduct: Record<string, unknown> | undefined;
  let updatedProduct: Record<string, unknown> | undefined;
  page.on('dialog', dialog => dialog.accept());
  const products = [...bootstrap.products];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/bootstrap')) return route.fulfill({ json: { ...bootstrap, products } });
    if (path.endsWith('/products') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      savedProduct = body;
      const product: typeof bootstrap.products[number] = {
        id: 'p-new', code: String(body.code), name: String(body.name), description: String(body.description),
        cost: Number(body.cost), price: Number(body.price), opening: 0, qty: 0, uom: String(body.uom),
        smallBagKg: Number(body.smallBagKg), mediumBagKg: Number(body.mediumBagKg), largeBagKg: Number(body.largeBagKg),
      };
      products.push(product);
      return route.fulfill({ status: 201, json: { id: product.id, product } });
    }
    if (path.endsWith('/products/p-new') && route.request().method() === 'PUT') {
      const body = route.request().postDataJSON() as Record<string, unknown>;
      updatedProduct = body;
      const index = products.findIndex(product => product.id === 'p-new');
      products[index] = {
        ...products[index], code: String(body.code), description: String(body.description),
        uom: String(body.uom), cost: Number(body.cost), price: Number(body.price),
      };
      return route.fulfill({ json: { id: 'p-new', product: products[index] } });
    }
    if (path.endsWith('/reminders')) return route.fulfill({ json: { reminders: [] } });
    return route.fulfill({ json: [] });
  });

  const bootstrapResponse = page.waitForResponse(response => response.url().endsWith('/api/bootstrap'));
  await page.goto('/');
  await bootstrapResponse;
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.getByTestId('nav-stock').click();
  await page.getByTestId('stock-add-product').click();
  await page.getByTestId('stock-product-code').fill('RICE-ALPHA');
  await page.getByTestId('stock-product-name').fill('Product persistence test');
  await page.getByTestId('stock-product-bag-kg').fill('50');
  await page.getByTestId('stock-product-description').fill('Saved product details');
  await page.getByTestId('stock-product-cost').fill('42');
  await page.getByTestId('stock-product-price').fill('55');
  const reloadedBootstrap = page.waitForResponse(response => response.url().endsWith('/api/bootstrap'));
  await page.getByTestId('stock-save-product').click();
  await reloadedBootstrap;

  await expect.poll(() => savedProduct?.code).toBe('RICE-ALPHA');
  expect(savedProduct?.description).toBe('Saved product details');
  expect(savedProduct?.uom).toBe('বস্তা');
  expect(savedProduct?.mediumBagKg).toBe(50);
  await expect(page.getByText('RICE-ALPHA')).toBeVisible();
  await page.getByTestId('edit-product-p-new').click();
  await page.getByTestId('stock-product-code').fill('RICE-ALPHA-UPDATED');
  await page.getByTestId('stock-product-description').fill('Updated product details');
  await page.getByTestId('stock-save-product').click();
  await expect.poll(() => updatedProduct?.code).toBe('RICE-ALPHA-UPDATED');
  expect(updatedProduct?.description).toBe('Updated product details');
  await expect(page.getByText('RICE-ALPHA-UPDATED')).toBeVisible();
  await page.getByTestId('view-product-p-new').click();
  await expect(page.getByTestId('product-details-description')).toHaveText('Updated product details');
});
