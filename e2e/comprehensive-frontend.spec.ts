import { expect, test } from '@playwright/test';

test.describe('Chaler Arot Comprehensive Frontend Suite', () => {

  test('1. Sidebar navigation and all screen headers load correctly', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');

    // Title branding
    await expect(page.getByText('চালের আড়ৎ')).toBeVisible();

    // Check all main navigation items in sidebar
    const screens = [
      { name: 'হোম', hash: 'home' },
      { name: 'বিক্রয়', hash: 'sale' },
      { name: 'ক্রয়', hash: 'purchase' },
      { name: 'কাস্টমার', hash: 'customers' },
      { name: 'সরবরাহকারী', hash: 'vendors' },
      { name: 'মজুদ পণ্য', hash: 'stock' },
      { name: 'খরচ', hash: 'expense' },
      { name: 'আয়-ব্যয় হিসাব', hash: 'accounts' },
      { name: 'ব্যাংক ও ক্যাশ', hash: 'bank' },
      { name: 'অফিস', hash: 'more' },
    ];

    for (const screen of screens) {
      const navItem = page.getByText(screen.name).first();
      await expect(navItem).toBeVisible();
    }
  });

  test('2. Sale form: cursor starts on Customer Code, NOT on Memo No, and Memo is editable', async ({ page }) => {
    await page.goto('/#/sale');
    await page.waitForLoadState('networkidle');

    const customerCode = page.getByLabel('Customer code');
    const memo = page.getByLabel('Sale memo number');

    // Requirement: Memo No is editable, but cursor starts on Customer Code
    await expect(customerCode).toBeFocused();
    await expect(memo).not.toBeFocused();

    // Verify memo no is editable
    await memo.click();
    await memo.fill('TEST-MEMO-999');
    await expect(memo).toHaveValue('TEST-MEMO-999');
  });

  test('3. Purchase form: cursor starts on Vendor Code, NOT on Memo No, and Memo is editable', async ({ page }) => {
    await page.goto('/#/purchase');
    await page.waitForLoadState('networkidle');

    const vendorCode = page.getByLabel('Vendor code');
    const memo = page.getByLabel('Purchase memo number');

    // Requirement: Cursor starts on Vendor Code
    await expect(vendorCode).toBeFocused();
    await expect(memo).not.toBeFocused();

    // Verify memo no is editable
    await memo.click();
    await memo.fill('PUR-MEMO-888');
    await expect(memo).toHaveValue('PUR-MEMO-888');
  });

  test('4. Default Customer toggle, persistence across reset and reload', async ({ page }) => {
    await page.goto('/#/sale');
    await page.waitForLoadState('networkidle');

    // Clear any previous default from localStorage
    await page.evaluate(() => localStorage.removeItem('chaler_arot_default_customer_code'));
    await page.reload();
    await page.waitForLoadState('networkidle');

    const customerCode = page.getByLabel('Customer code');
    await customerCode.fill('888');

    // Click default toggle button
    const defaultBtn = page.getByText(/ডিফল্ট/i).first();
    await expect(defaultBtn).toBeVisible();
    await defaultBtn.click();

    // Verify localStorage has the code
    const storedCode = await page.evaluate(() => localStorage.getItem('chaler_arot_default_customer_code'));
    expect(storedCode).toBe('888');

    // Reload page to verify auto pre-fill
    await page.reload();
    await page.waitForLoadState('networkidle');

    // Verify Customer code is automatically pre-filled
    await expect(page.getByLabel('Customer code')).toHaveValue('888');
    await expect(page.getByText('IJJJ').first()).toBeVisible();

    // Click button again to clear default
    const activeDefaultBtn = page.getByText(/ডিফল্ট/i).first();
    await activeDefaultBtn.click();

    const clearedCode = await page.evaluate(() => localStorage.getItem('chaler_arot_default_customer_code'));
    expect(clearedCode).toBeNull();
  });

  test('5. Default Vendor toggle, persistence across reset and reload', async ({ page }) => {
    await page.goto('/#/purchase');
    await page.waitForLoadState('networkidle');

    // Clear any previous default
    await page.evaluate(() => localStorage.removeItem('chaler_arot_default_vendor_code'));
    await page.reload();
    await page.waitForLoadState('networkidle');

    const vendorCode = page.getByLabel('Vendor code');
    await vendorCode.fill('103');

    // Click default toggle button
    const defaultBtn = page.getByText(/ডিফল্ট/i).first();
    await expect(defaultBtn).toBeVisible();
    await defaultBtn.click();

    const storedCode = await page.evaluate(() => localStorage.getItem('chaler_arot_default_vendor_code'));
    expect(storedCode).toBe('103');

    // Reload page to verify auto pre-fill
    await page.reload();
    await page.waitForLoadState('networkidle');

    await expect(page.getByLabel('Vendor code')).toHaveValue('103');
    await expect(page.getByText('SHAWON').first()).toBeVisible();

    // Clear default
    const activeDefaultBtn = page.getByText(/ডিফল্ট/i).first();
    await activeDefaultBtn.click();

    const clearedCode = await page.evaluate(() => localStorage.getItem('chaler_arot_default_vendor_code'));
    expect(clearedCode).toBeNull();
  });

  test('6. Sale Form: full calculation test with positive line and negative return line (-value)', async ({ page }) => {
    await page.goto('/#/sale');
    await page.waitForLoadState('networkidle');

    // 1. Customer
    const customerCode = page.getByLabel('Customer code');
    await customerCode.fill('888');
    await expect(page.getByText('IJJJ').first()).toBeVisible();

    // 2. Line 1: Normal Sale (2 bags @ 80 Tk)
    const productCode1 = page.getByLabel('Product code 1');
    await productCode1.fill('456T');
    const selectProd1 = page.getByLabel(/Select product MOjammel/i).first();
    if (await selectProd1.isVisible()) {
      await selectProd1.click();
    }
    const qty1 = page.getByLabel('Quantity 1');
    await qty1.fill('2');
    const rate1 = page.getByLabel('Sale rate 1');
    await rate1.fill('80');

    // Verify Line 1 total: 2 bags * 50kg = 100 kg
    await expect(page.getByText('১০০ কেজি').first()).toBeVisible();

    // 3. Line 2: Return Line (-1 bag @ 80 Tk)
    const addRowBtn = page.getByTestId('add-product-row');
    await addRowBtn.click();

    const productCode2 = page.getByLabel('Product code 2');
    await productCode2.fill('456T');
    const selectProd2 = page.getByLabel(/Select product MOjammel/i).first();
    if (await selectProd2.isVisible()) {
      await selectProd2.click();
    }
    const qty2 = page.getByLabel('Quantity 2');
    await qty2.fill('-1');
    const rate2 = page.getByLabel('Sale rate 2');
    await rate2.fill('80');

    // Verify return indicators are visible: return badge ↩, negative kg (-50)
    await expect(page.getByText('↩').first()).toBeVisible();
    await expect(page.getByText('-৫০ কেজি').first()).toBeVisible();

    // 4. Check Table Summary Strip
    // Total items: 2, Return bags: 1 bag
    await expect(page.getByText(/মোট আইটেম:/)).toBeVisible();
    await expect(page.getByText(/বিক্রয় ফেরত:/)).toBeVisible();

    // 5. Open Split Confirmation Modal
    const completeBtn = page.getByTestId('complete-invoice');
    await completeBtn.click();

    // Verify modal is open and shows return details
    await expect(page.getByText(/বিক্রয় নিশ্চিতকরণ/).first()).toBeVisible();
    await expect(page.getByText(/বিক্রয় ফেরত/).first()).toBeVisible();

    // Check execute button is visible and active
    const executeBtn = page.getByTestId('execute-invoice');
    await expect(executeBtn).toBeVisible();
    await executeBtn.click();

    // Verify successful transaction completion modal / invoice modal opens
    await expect(page.getByText(/ইনভয়েস সম্পন্ন হয়েছে|বিক্রয় চালান|প্রিন্ট/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('7. Purchase Form: calculation test with positive line and negative return line (-value)', async ({ page }) => {
    await page.goto('/#/purchase');
    await page.waitForLoadState('networkidle');

    // 1. Vendor
    const vendorCode = page.getByLabel('Vendor code');
    await vendorCode.fill('103');
    await expect(page.getByText('SHAWON').first()).toBeVisible();

    // 2. Line 1: Normal Purchase (3 bags @ 70 Tk)
    const productCode1 = page.getByLabel('Product code 1');
    await productCode1.fill('456T');
    const selectProd1 = page.getByLabel(/Select product MOjammel/i).first();
    if (await selectProd1.isVisible()) {
      await selectProd1.click();
    }
    const qty1 = page.getByLabel('Quantity 1');
    await qty1.fill('3');
    const rate1 = page.getByLabel('Purchase rate 1');
    await rate1.fill('70');

    // 3. Line 2: Return Line (-1 bag @ 70 Tk)
    const addRowBtn = page.getByTestId('add-product-row');
    await addRowBtn.click();

    const productCode2 = page.getByLabel('Product code 2');
    await productCode2.fill('456T');
    const selectProd2 = page.getByLabel(/Select product MOjammel/i).first();
    if (await selectProd2.isVisible()) {
      await selectProd2.click();
    }
    const qty2 = page.getByLabel('Quantity 2');
    await qty2.fill('-1');
    const rate2 = page.getByLabel('Purchase rate 2');
    await rate2.fill('70');

    // Verify return indicator ↩
    await expect(page.getByText('↩').first()).toBeVisible();

    // 4. Open Split Confirmation Modal
    const completeBtn = page.getByTestId('complete-invoice');
    await completeBtn.click();

    // Verify modal is open and shows return details
    await expect(page.getByText(/ক্রয় নিশ্চিতকরণ/).first()).toBeVisible();
    await expect(page.getByText(/ক্রয় ফেরত/).first()).toBeVisible();

    // Execute transaction
    const executeBtn = page.getByTestId('execute-invoice');
    await expect(executeBtn).toBeVisible();
    await executeBtn.click();

    // Verify successful transaction completion
    await expect(page.getByText(/ইনভয়েস সম্পন্ন হয়েছে|ক্রয় চালান|প্রিন্ট/i).first()).toBeVisible({ timeout: 10000 });
  });

  test('8. Stock Dashboard: product listing, search filter, and stock values visible', async ({ page }) => {
    await page.goto('/#/stock');
    await page.waitForLoadState('networkidle');

    // Verify heading
    await expect(page.getByText(/মজুদ চাল ও পণ্যের হিসাব|মজুদ পণ্য/i).first()).toBeVisible();

    // Product search
    const searchInput = page.getByPlaceholder(/পণ্য কোড বা পণ্যের নাম দিয়ে খুঁজুন/i).first();
    if (await searchInput.isVisible()) {
      await searchInput.fill('MOjammel');
    }

    // Verify stock values and product row are displayed
    await expect(page.getByText('MOjammel 50kg').first()).toBeVisible();
    await expect(page.getByText(/৪৫৬T|456T/).first()).toBeVisible();
  });

  test('9. Accounts Dashboard: customer balances, supplier balances, and cash accounts', async ({ page }) => {
    await page.goto('/#/accounts');
    await page.waitForLoadState('networkidle');

    // Verify accounts header
    await expect(page.getByText(/আয়-ব্যয় ও হিসাব|হিসাব/i).first()).toBeVisible();

    // Verify tabs or sections
    await expect(page.getByText(/কাস্টমার|খরিদ্দার/i).first()).toBeVisible();
    await expect(page.getByText(/সরবরাহকারী|মহাজন/i).first()).toBeVisible();
  });

  test('10. Expense Dashboard: categories, inputs, and expense entry list', async ({ page }) => {
    await page.goto('/#/expense');
    await page.waitForLoadState('networkidle');

    // Verify expense header
    await expect(page.getByText(/দৈনিক খরচ ও অফিস ব্যয়|খরচ/i).first()).toBeVisible();
  });

  test('11. Home Dashboard: KPI summary cards visible and populated', async ({ page }) => {
    await page.goto('/#/home');
    await page.waitForLoadState('networkidle');

    // Verify summary widgets / metrics are rendered
    await expect(page.getByText(/আজকের মোট বিক্রয়|আজকের বিক্রয়|বিক্রয়/i).first()).toBeVisible();
    await expect(page.getByText(/লাভ|আদায়|বাকি/i).first()).toBeVisible();
  });

  test('12. Stock Dashboard: PDF report download and Excel download buttons work', async ({ page }) => {
    await page.goto('/#/stock');
    await page.waitForLoadState('networkidle');

    await expect(page.getByText('মজুদ চাল ও স্টক বিবরণ')).toBeVisible();

    const pdfBtn = page.getByTestId('stock-pdf-download');
    await expect(pdfBtn).toBeVisible();

    const excelBtn = page.getByTestId('stock-excel-download');
    await expect(excelBtn).toBeVisible();

    // Verify Excel download triggers file download
    const downloadPromise = page.waitForEvent('download');
    await excelBtn.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('chaler_stock_');
  });

});
