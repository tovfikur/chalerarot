import { test, expect } from '@playwright/test';

test.describe('Sale other cost per bag and expense sync feature', () => {
  test('creates a sale with per-bag other cost and checks it appears in /#/expense', async ({ page }) => {
    // 1. Navigate to sale
    await page.goto('http://localhost:3001/#/sale');
    await page.waitForLoadState('networkidle');

    // Verify "অন্যান্য খরচ/বস্তা (৳)" header is present
    await expect(page.getByText('অন্যান্য খরচ/বস্তা (৳)')).toBeVisible();

    // Select customer
    const partyInput = page.getByLabel('Customer code');
    await partyInput.click();
    await partyInput.fill('888');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Fill in product
    const codeInput = page.getByLabel('Product code 1');
    await codeInput.click();
    await codeInput.fill('456T');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Quantity (বস্তা)
    const qtyInput = page.getByLabel('Quantity 1');
    await qtyInput.click();
    await qtyInput.fill('10');

    // Sale rate (দর)
    const rateInput = page.getByLabel('Sale rate 1');
    await rateInput.click();
    await rateInput.fill('3200');

    // Other cost per bag (বস্তা প্রতি খরচ)
    const otherCostInput = page.getByLabel('Other cost per bag 1');
    await otherCostInput.click();
    await otherCostInput.fill('30');

    await page.waitForTimeout(400);

    // Verify helper calculation "খরচ: ৳৩০০" (10 bags * 30 = 300)
    await expect(page.getByText(/খরচ:\s*৳৩০০/)).toBeVisible();

    // Open confirmation review modal
    const completeBtn = page.getByTestId('complete-invoice');
    await completeBtn.click();
    await page.waitForTimeout(400);

    // Review modal checks
    await expect(page.getByText('বিক্রয় নিশ্চিতকরণ ও বিবরণ পর্যালোচনা')).toBeVisible();
    await expect(page.getByText(/মোট বস্তা প্রতি খরচ/)).toBeVisible();

    // Execute the transaction
    const executeBtn = page.getByTestId('execute-invoice');
    await executeBtn.click();
    await page.waitForTimeout(1500);

    // Go to Expense dashboard
    await page.goto('http://localhost:3001/#/expense');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(800);

    // Verify the expense record with ৳300 exists
    await expect(page.getByText('৳৩০০').first()).toBeVisible();
    await expect(page.getByText(/বস্তা প্রতি খরচ/).first()).toBeVisible();
  });
});
