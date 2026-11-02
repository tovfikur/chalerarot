import { test, expect } from '@playwright/test';

test.describe('Product Add and Edit Modal Fixes', () => {
  test('verifies placeholder removal, new product creation, and editing older product', async ({ page }) => {
    // 1. Go to stock page
    await page.goto('http://localhost:3001/#/stock');
    await page.waitForLoadState('networkidle');

    // 2. Open Add Product Modal
    const addProductBtn = page.getByTestId('stock-add-product');
    await expect(addProductBtn).toBeVisible();
    await addProductBtn.click();
    await page.waitForTimeout(300);

    // 3. Verify Modal Title & placeholder "খুদ চাল" is NOT present
    await expect(page.getByText('নতুন পণ্য যোগ করুন')).toBeVisible();
    const nameInput = page.getByTestId('stock-product-name');
    await expect(nameInput).toBeVisible();
    // Verify "খুদ চাল" placeholder is NOT there
    await expect(page.getByPlaceholder('খুদ চাল')).toHaveCount(0);
    await expect(page.getByPlaceholder('পণ্যের নাম লিখুন...')).toBeVisible();

    // 4. Fill in new product details
    const testCode = `TEST-${Date.now().toString().slice(-4)}`;
    const testName = `টেস্ট চাল ${Date.now().toString().slice(-4)}`;
    await page.getByTestId('stock-product-code').fill(testCode);
    await nameInput.fill(testName);
    await page.getByTestId('stock-product-bag-kg').fill('50');
    await page.getByTestId('stock-product-cost').fill('60');
    await page.getByTestId('stock-product-price').fill('70');

    // 5. Save the product
    await page.getByTestId('stock-save-product').click();
    await page.waitForTimeout(1000);

    // 6. Verify newly created product appears in the list
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(testName)).toBeVisible();

    // 7. Find and click Edit button for the created product
    const editBtn = page.locator(`[aria-label="Edit product ${testName}"]`);
    await expect(editBtn).toBeVisible();
    await editBtn.click();
    await page.waitForTimeout(300);

    // 8. Verify Edit Modal opens with title "পণ্য সম্পাদনা" and product data prefilled
    await expect(page.getByText('পণ্য সম্পাদনা')).toBeVisible();
    await expect(page.getByTestId('stock-product-name')).toHaveValue(testName);
    await expect(page.getByTestId('stock-save-product')).toContainText('আপডেট করুন');

    // 9. Modify name and price
    const updatedName = `${testName} আপডেট`;
    await page.getByTestId('stock-product-name').fill(updatedName);
    await page.getByTestId('stock-product-price').fill('75');
    await page.getByTestId('stock-save-product').click();
    await page.waitForTimeout(1000);

    // 10. Verify updated name is now shown on the page
    await page.reload();
    await page.waitForLoadState('networkidle');
    await expect(page.getByText(updatedName)).toBeVisible();
  });
});
