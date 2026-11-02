import { test, expect } from '@playwright/test';

test.describe('Purchase other cost per bag feature', () => {
  test('verifies other cost per bag input in purchase and vendor invoice separation', async ({ page }) => {
    await page.goto('http://localhost:3001/#/purchase');
    await page.waitForLoadState('networkidle');

    // 1. Verify header has "অন্যান্য খরচ/বস্তা (৳)"
    await expect(page.getByText('অন্যান্য খরচ/বস্তা (৳)')).toBeVisible();

    // 2. In sale mode it should NOT be visible (only for purchases)
    await page.goto('http://localhost:3001/#/sale');
    await page.waitForLoadState('networkidle');
    await expect(page.getByText('অন্যান্য খরচ/বস্তা (৳)')).not.toBeVisible();

    // 3. Return to purchase mode
    await page.goto('http://localhost:3001/#/purchase');
    await page.waitForLoadState('networkidle');

    // Select vendor
    const vendorInput = page.getByLabel('Vendor code');
    await vendorInput.click();
    await vendorInput.fill('103');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // 4. Fill in product code or select product
    const codeInput = page.getByLabel('Product code 1');
    await codeInput.click();
    await codeInput.fill('01');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // 5. Fill in quantity (বস্তা)
    const qtyInput = page.getByLabel('Quantity 1');
    await qtyInput.click();
    await qtyInput.fill('10');

    // 6. Fill in purchase rate (ক্রয় দর)
    const rateInput = page.getByLabel('Purchase rate 1');
    await rateInput.click();
    await rateInput.fill('3000');

    // 7. Fill in other cost per bag
    const otherCostInput = page.getByLabel('Other cost per bag 1');
    await otherCostInput.click();
    await otherCostInput.fill('50');

    await page.waitForTimeout(400);

    // 8. Verify "আমার দর: ৳৩,০৫০" appears
    await expect(page.getByText(/আমার দর:\s*৳৩,০৫০/)).toBeVisible();

    // 9. Total column should still strictly be vendor payment: 10 * 3000 = ৳30,000 (NOT 30,500)
    await expect(page.getByText('৳৩০,০০০')).toBeVisible();

    // 10. Open review confirmation modal
    const completeBtn = page.getByTestId('complete-invoice');
    await completeBtn.click();
    await page.waitForTimeout(400);

    // 11. Modal should show vendor invoice amount strictly as ৳৩০০০০ (10 * 3000)
    await expect(page.getByText('ক্রয় নিশ্চিতকরণ ও বিবরণ পর্যালোচনা')).toBeVisible();
    await expect(page.getByText(/মোট ইনভয়েস মূল্য:\s*৳৩০০০০/)).toBeVisible();
    await expect(page.getByLabel('Cash paid')).toHaveValue('30000');

    // 12. Modal should show per-bag other cost summary (10 * 50 = 500)
    await expect(page.getByText(/মোট বস্তা প্রতি খরচ/)).toBeVisible();

    // 13. Execute purchase invoice
    const executeBtn = page.getByTestId('execute-invoice');
    await executeBtn.click();
    await page.waitForTimeout(1200);

    // 14. Check /#/expense to verify the per-bag other cost is recorded
    await page.goto('http://localhost:3001/#/expense');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // Verify ৳500 expense appears
    await expect(page.getByText('৳৫০০').first()).toBeVisible();
    await expect(page.getByText(/ক্রয় খরচ \(প্রতি বস্তা\)|বস্তা প্রতি খরচ/).first()).toBeVisible();
  });
});
