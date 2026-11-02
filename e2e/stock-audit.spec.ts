import { test, expect } from '@playwright/test';

test.describe('Stock Audit & Adjustment Feature', () => {
  test('manual stock audit, pdf/excel buttons, and stock adjustment flow', async ({ page }) => {
    // 1. Go to stock dashboard
    await page.goto('http://localhost:3001/#/stock');
    await page.waitForLoadState('networkidle');

    // 2. Check header
    await expect(page.getByText('মজুদ চাল ও স্টক বিবরণ')).toBeVisible();

    // 3. Switch to Audit tab
    const auditTabBtn = page.getByText('স্টক অডিট ও সমন্বয়');
    await expect(auditTabBtn).toBeVisible();
    await auditTabBtn.click();

    // 4. Verify action buttons
    await expect(page.getByText('অটো-পূরণ')).toBeVisible();
    await expect(page.getByText('মুছুন')).toBeVisible();
    await expect(page.getByText('অডিট রিপোর্ট (PDF)')).toBeVisible();
    await expect(page.getByText('অডিট শিট (Excel)')).toBeVisible();

    // 5. Test prefill
    await page.getByText('অটো-পূরণ').click();
    await page.waitForTimeout(500);

    // 6. Verify table columns
    await expect(page.getByText('পণ্য ও সাইজ')).toBeVisible();
    await expect(page.getByText('সিস্টেম মজুদ')).toBeVisible();
    await expect(page.getByText('বাস্তব বস্তা')).toBeVisible();
    await expect(page.getByText('বাস্তব কেজি')).toBeVisible();
    await expect(page.getByText('পার্থক্য', { exact: true })).toBeVisible();
    await expect(page.getByText('আর্থিক প্রভাব', { exact: true })).toBeVisible();

    // 7. Verify bottom action bar
    await expect(page.getByText('অডিটকৃত পণ্য:')).toBeVisible();
    await expect(page.getByText('পার্থক্যযুক্ত পণ্য:')).toBeVisible();

    // 8. Find first physical bags input and change its value
    const firstBagsInput = page.locator('input').nth(1); // First input in table after search
    await firstBagsInput.click();
    await firstBagsInput.fill('999');
    await page.waitForTimeout(300);

    // 9. Verify discrepancy badge appeared
    await expect(page.getByText('পার্থক্যযুক্ত পণ্য:')).toBeVisible();
    const applyBtn = page.getByText(/স্টক সমন্বয় প্রয়োগ করুন/);
    await expect(applyBtn).toBeVisible();
    await expect(applyBtn).toBeEnabled();

    // 10. Click apply button to open Confirmation Modal
    await applyBtn.click();
    await expect(page.getByText('স্টক সমন্বয় নিশ্চিতকরণ (Stock Adjustment)')).toBeVisible();
    await expect(page.getByText('সমন্বয়যোগ্য পণ্যসমূহের বিবরণ:')).toBeVisible();
    await expect(page.getByText('নিশ্চিত ও সমন্বয় সংরক্ষণ করুন')).toBeVisible();

    // 11. Close modal
    await page.getByText('বাতিল').click();
    await expect(page.getByText('স্টক সমন্বয় নিশ্চিতকরণ (Stock Adjustment)')).not.toBeVisible();

    // 12. Save screenshot of the audit table
    await page.screenshot({ path: 'audit-screen.png' });
  });
});
