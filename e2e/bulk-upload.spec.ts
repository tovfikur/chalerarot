import { expect, test } from '@playwright/test';

test.describe('Bulk Upload Suite (Product, Customer, Vendor)', () => {

  test('1. Bulk Product Upload: template, parse preview, validation and submission', async ({ page }) => {
    // Listen for alert dialogs
    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    await page.goto('/#/stock');
    await page.waitForLoadState('networkidle');

    // Check bulk upload button exists in stock dashboard header
    const bulkBtn = page.getByTestId('stock-bulk-upload');
    await expect(bulkBtn).toBeVisible();
    await bulkBtn.click();

    // Verify modal is open
    await expect(page.getByRole('dialog').getByText('বাল্ক পণ্য আপলোড')).toBeVisible();
    await expect(page.getByTestId('bulk-download-template')).toBeVisible();

    // Enter test product CSV
    const testCode1 = `BP-${Date.now().toString().slice(-4)}-1`;
    const testCode2 = `BP-${Date.now().toString().slice(-4)}-2`;
    const csvContent = [
      'code,name,price,cost,opening,bagKg,uom,description',
      `${testCode1},বাল্ক টেস্ট মিনিকেট চাল,68,58,100,50,বস্তা,টেস্ট মিনিকেট`,
      `${testCode2},বাল্ক টেস্ট নাজির চাল,78,66,200,50,বস্তা,টেস্ট নাজির`,
    ].join('\n');

    const textInput = page.getByTestId('bulk-text-input');
    await textInput.fill(csvContent);

    // Click Parse & Preview
    const parseBtn = page.getByTestId('bulk-parse-btn');
    await parseBtn.click();

    // Verify preview results via testID
    await expect(page.getByTestId('bulk-summary-total')).toContainText(/২|2/);
    await expect(page.getByTestId('bulk-summary-valid')).toContainText(/২|2/);
    await expect(page.getByText(testCode1, { exact: true })).toBeVisible();
    await expect(page.getByText(testCode2, { exact: true })).toBeVisible();

    // Click upload submit
    const submitBtn = page.getByTestId('bulk-submit-btn');
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();

    // After success dialog, modal closes and newly uploaded product is in list
    await page.waitForTimeout(1000);
    await expect(page.getByText('বাল্ক টেস্ট মিনিকেট চাল').first()).toBeVisible({ timeout: 10000 });
  });

  test('2. Bulk Customer Upload: parse preview and submission', async ({ page }) => {
    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    await page.goto('/#/customers');
    await page.waitForLoadState('networkidle');

    // Check bulk upload button in customer header
    const bulkBtn = page.getByTestId('bulk-customer-upload');
    await expect(bulkBtn).toBeVisible();
    await bulkBtn.click();

    // Verify modal is open
    await expect(page.getByRole('dialog').getByText('বাল্ক কাস্টমার আপলোড')).toBeVisible();

    const custCode1 = `BC-${Date.now().toString().slice(-4)}-1`;
    const custCode2 = `BC-${Date.now().toString().slice(-4)}-2`;
    const csvContent = [
      'code,name,mobile,address,opening',
      `${custCode1},বাল্ক টেস্ট কাস্টমার ক,01711998877,ঢাকা বাদামতলী,3500`,
      `${custCode2},বাল্ক টেস্ট কাস্টমার খ,01811998877,নারায়ণগঞ্জ,1200`,
    ].join('\n');

    const textInput = page.getByTestId('bulk-text-input');
    await textInput.fill(csvContent);

    const parseBtn = page.getByTestId('bulk-parse-btn');
    await parseBtn.click();

    await expect(page.getByTestId('bulk-summary-total')).toContainText(/২|2/);
    await expect(page.getByTestId('bulk-summary-valid')).toContainText(/২|2/);
    await expect(page.getByText(custCode1, { exact: true })).toBeVisible();

    const submitBtn = page.getByTestId('bulk-submit-btn');
    await submitBtn.click();

    await page.waitForTimeout(1000);
    await expect(page.getByText('বাল্ক টেস্ট কাস্টমার ক').first()).toBeVisible({ timeout: 10000 });
  });

  test('3. Bulk Vendor Upload: parse preview and submission', async ({ page }) => {
    page.on('dialog', async dialog => {
      await dialog.accept();
    });

    await page.goto('/#/vendors');
    await page.waitForLoadState('networkidle');

    // Check bulk upload button in vendor header
    const bulkBtn = page.getByTestId('bulk-vendor-upload');
    await expect(bulkBtn).toBeVisible();
    await bulkBtn.click();

    // Verify modal is open
    await expect(page.getByRole('dialog').getByText('বাল্ক সরবরাহকারী আপলোড')).toBeVisible();

    const vendCode1 = `BV-${Date.now().toString().slice(-4)}-1`;
    const vendCode2 = `BV-${Date.now().toString().slice(-4)}-2`;
    const csvContent = [
      'code,name,mobile,address,opening',
      `${vendCode1},বাল্ক টেস্ট মহাজন ক,01911998877,নওগাঁ সদর,8000`,
      `${vendCode2},বাল্ক টেস্ট মহাজন খ,01611998877,দিনাজপুর,4500`,
    ].join('\n');

    const textInput = page.getByTestId('bulk-text-input');
    await textInput.fill(csvContent);

    const parseBtn = page.getByTestId('bulk-parse-btn');
    await parseBtn.click();

    await expect(page.getByTestId('bulk-summary-total')).toContainText(/২|2/);
    await expect(page.getByTestId('bulk-summary-valid')).toContainText(/২|2/);
    await expect(page.getByText(vendCode1, { exact: true })).toBeVisible();

    const submitBtn = page.getByTestId('bulk-submit-btn');
    await submitBtn.click();

    await page.waitForTimeout(1000);
    await expect(page.getByText('বাল্ক টেস্ট মহাজন ক').first()).toBeVisible({ timeout: 10000 });
  });

  test('4. Bulk Upload validation: invalid rows flagged before upload', async ({ page }) => {
    await page.goto('/#/stock');
    await page.waitForLoadState('networkidle');

    const bulkBtn = page.getByTestId('stock-bulk-upload');
    await bulkBtn.click();

    // Provide invalid rows: missing name, invalid price (0)
    const invalidCsv = [
      'code,name,price,cost,opening',
      ',,70,60,10', // missing name
      'ERR-2,ভুল পণ্য,0,50,0', // invalid price
      'VALID-1,সঠিক পণ্য,65,55,10', // valid
    ].join('\n');

    const textInput = page.getByTestId('bulk-text-input');
    await textInput.fill(invalidCsv);

    const parseBtn = page.getByTestId('bulk-parse-btn');
    await parseBtn.click();

    // Verify summary counts via testID
    await expect(page.getByTestId('bulk-summary-total')).toContainText(/৩|3/);
    await expect(page.getByTestId('bulk-summary-valid')).toContainText(/১|1/);
    await expect(page.getByTestId('bulk-summary-invalid')).toContainText(/২|2/);

    // Error pills visible
    await expect(page.getByText('ত্রুটি').first()).toBeVisible();

    // Cancel modal
    await page.getByText('বাতিল', { exact: true }).click();
    await expect(page.getByRole('dialog').getByText('বাল্ক পণ্য আপলোড')).not.toBeVisible();
  });

});
