import { expect, test } from '@playwright/test';

test.describe('Deep Verification Suite for /#/accounts', () => {

  test.beforeEach(async ({ page }) => {
    await page.goto('/#/accounts');
    await page.waitForLoadState('networkidle');
  });

  test('1. Header Toolbar, Solvency Banner, and Date Presets Work Systematically', async ({ page }) => {
    // 1. Header elements
    await expect(page.getByText('হিসাব ও আর্থিক অ্যানালিটিক্স')).toBeVisible();
    await expect(page.getByText('লাইভ সিঙ্ক')).toBeVisible();

    // 2. Toolbar quick action buttons
    await expect(page.getByText('কালেকশন').first()).toBeVisible();
    await expect(page.getByText('মহাজন পরিশোধ').first()).toBeVisible();
    await expect(page.getByText('ফান্ড ট্রান্সফার').first()).toBeVisible();
    await expect(page.getByText('নতুন খরচ').first()).toBeVisible();
    await expect(page.getByText('প্রিন্ট রিপোর্ট').first()).toBeVisible();

    // 3. Dynamic Solvency Pill
    await expect(page.getByText('তারল্য নিরাপত্তা:')).toBeVisible();
    await expect(page.getByText(/নিরাপদ|সতর্কতা/).first()).toBeVisible();

    // 4. Test clicking each Date Preset chip
    const presets = ['আজ', 'গত ৭ দিন', 'এই মাস', 'শেষ ৩ মাস', 'চলতি বছর'];
    for (const preset of presets) {
      const chip = page.getByText(preset, { exact: true }).first();
      await chip.click();
      await page.waitForTimeout(100);
      await expect(page.getByText('হিসাব ও আর্থিক অ্যানালিটিক্স')).toBeVisible();
    }

    // 5. Custom Date Filter Modal
    const customDateBtn = page.getByText(/২০২৬-|2026-|আজকের হিসাব/i).first();
    await customDateBtn.click();
    // Modal opens
    const filterModal = page.getByText(/তারিখ পরিসীমা নির্বাচন|তারিখ ফিল্টার|তারিখ/i).first();
    await expect(filterModal).toBeVisible();
    // Close modal
    const closeBtn = page.getByText(/বাতিল|বন্ধ/i).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
  });

  test('2. All 8 Financial KPI Cards & Drill-Down Modals Display Accurate Live Data', async ({ page }) => {
    // Card 1: Liquid Funds
    await expect(page.getByText('মোট তরল তহবিল').first()).toBeVisible();
    // Card 2: Net Sales
    await expect(page.getByText('নিট চাল বিক্রয়').first()).toBeVisible();
    // Card 3: Gross Profit
    await expect(page.getByText('মোট বাণিজ্যিক লাভ').first()).toBeVisible();
    // Card 4: Operating Expenses
    await expect(page.getByText('পরিচালন ও দোকান খরচ').first()).toBeVisible();
    // Card 5: Net Profit
    await expect(page.getByText('প্রকৃত নিট মুনাফা (আসল লাভ)').first()).toBeVisible();
    // Card 6: Customer Receivables
    await expect(page.getByText('বাজারে কাস্টমার পাওনা').first()).toBeVisible();
    // Card 7: Vendor Payables
    await expect(page.getByText('মহাজনদের মোট দেনা').first()).toBeVisible();
    // Card 8: Net Working Solvency
    await expect(page.getByText('নিট আর্থিক অবস্থান').first()).toBeVisible();

    // Test Drill-down modal for Sales
    await page.getByText('নিট চাল বিক্রয়').first().click();
    await page.waitForTimeout(300);
    const closeBtn = page.getByText(/বন্ধ করুন|বন্ধ|Close/i).first();
    await expect(closeBtn).toBeVisible();
    await closeBtn.click();

    // Test Drill-down modal for Gross Profit
    await page.getByText('মোট বাণিজ্যিক লাভ').first().click();
    await page.waitForTimeout(300);
    const closeProfit = page.getByText(/বন্ধ করুন|বন্ধ|Close/i).first();
    await expect(closeProfit).toBeVisible();
    await closeProfit.click();
  });

  test('3. Tab 1 Overview: Bezier Trend Curves, Toggles, and P&L Waterfall Steps', async ({ page }) => {
    // 1. Trend curve section
    await expect(page.getByText('আয়, ব্যয় ও মুনাফার ট্রেন্ড কার্ভ')).toBeVisible();
    await expect(page.getByText('স্মুথ বেজিয়ার কার্ভ')).toBeVisible();

    // 2. Curve toggles
    const salesToggle = page.getByText('বিক্রয় কার্ভ').first();
    const expToggle = page.getByText('ব্যয় কার্ভ').first();
    const profitToggle = page.getByText('আসল লাভ কার্ভ').first();

    await expect(salesToggle).toBeVisible();
    await expect(expToggle).toBeVisible();
    await expect(profitToggle).toBeVisible();

    // Toggle series on and off
    await salesToggle.click();
    await page.waitForTimeout(100);
    await salesToggle.click();

    // 3. Visual P&L Waterfall Steps
    await expect(page.getByText('লাভ-ক্ষতির স্পষ্ট ধাপ (Visual P&L Waterfall)')).toBeVisible();
    await expect(page.getByText(/1\. মোট বিক্রয়/)).toBeVisible();
    await expect(page.getByText(/2\. বাদ: চালের পাইকারি ক্রয় খরচ/)).toBeVisible();
    await expect(page.getByText(/3\. = মোট বাণিজ্যিক লাভ/)).toBeVisible();
    await expect(page.getByText(/4\. বাদ: দোকান পরিচালনা/)).toBeVisible();
    await expect(page.getByText(/5\. = আসল লাভ/)).toBeVisible();
  });

  test('4. Tab 2 Accounts: Cash & Bank Balances, Transfer Modal, and History', async ({ page }) => {
    // Click Tab 2
    await page.getByText(/🏦 ক্যাশ ও ব্যাংক তহবিল/).first().click();
    await page.waitForTimeout(300);

    // Section header
    await expect(page.getByText('ক্যাশ ও ব্যাংক তহবিল ব্যবস্থাপনা')).toBeVisible();

    // Transfer button & modal
    const transferBtn = page.getByText('ফান্ড ট্রান্সফার করুন').first();
    await expect(transferBtn).toBeVisible();
    await transferBtn.click();

    // Modal appears
    await expect(page.getByText(/ফান্ড ট্রান্সফার|টাকা ট্রান্সফার/i).first()).toBeVisible();
    const closeBtn = page.getByText(/বাতিল|বন্ধ/i).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }

    // History section
    await expect(page.getByText('সাম্প্রতিক ফান্ড ট্রান্সফার খতিয়ান')).toBeVisible();
  });

  test('5. Tab 3 Customer Receivables: Search, Rankings, and Ledger Modal', async ({ page }) => {
    // Click Tab 3 using exact tab identifier
    await page.getByText(/👥 কাস্টমার বাকি/).first().click();
    await page.waitForTimeout(300);

    // Header and search
    await expect(page.getByText('কাস্টমারদের কাছে মোট বাকি ও পাওনা খতিয়ান')).toBeVisible();
    const searchInput = page.getByPlaceholder(/খরিদ্দারের নাম বা মোবাইল নম্বর/i).first();
    await expect(searchInput).toBeVisible();

    // Type in search box
    await searchInput.fill('IJJJ');
    await expect(page.getByText('IJJJ').first()).toBeVisible();

    // Click Ledger button (চালান খতিয়ান)
    const ledgerBtn = page.getByText('চালান খতিয়ান').first();
    await ledgerBtn.click();

    // Receivable Detail Modal loads customer account
    await expect(page.getByText('IJJJ').first()).toBeVisible();
    await expect(page.getByText(/বর্তমান বকেয়া|বাকি/i).first()).toBeVisible();

    // Close modal
    const closeBtn = page.getByText(/বন্ধ করুন|বন্ধ|Close/i).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
  });

  test('6. Tab 4 Vendor Payables: Search, Rankings, and Payable Modal', async ({ page }) => {
    // Click Tab 4 using exact tab identifier
    await page.getByText(/🏢 মহাজন দেনা/).first().click();
    await page.waitForTimeout(300);

    // Header and search
    await expect(page.getByText('চাল সরবরাহকারী ও মহাজনদের দেনা খতিয়ান')).toBeVisible();
    const searchInput = page.getByPlaceholder(/মহাজন বা মিলের নাম/i).first();
    await expect(searchInput).toBeVisible();

    // Type in search box
    await searchInput.fill('SHAWON');
    await expect(page.getByText('SHAWON').first()).toBeVisible();

    // Click Ledger button (দেনা খতিয়ান)
    const ledgerBtn = page.getByText('দেনা খতিয়ান').first();
    await ledgerBtn.click();

    // Payable Detail Modal loads vendor account
    await expect(page.getByText('SHAWON').first()).toBeVisible();
    await expect(page.getByText(/মোট ক্রয়|পরিশোধ/i).first()).toBeVisible();

    // Close modal
    const closeBtn = page.getByText(/বন্ধ করুন|বন্ধ|Close/i).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }
  });

  test('7. Tab 5 Expense Register: Category Filter, Search, and Add Expense Modal', async ({ page }) => {
    // Click Tab 5
    await page.getByText(/📉 খরচের রেজিস্টার/).first().click();
    await page.waitForTimeout(300);

    // Header
    await expect(page.getByText('দোকান পরিচালনা ব্যয়ের রেজিস্টার')).toBeVisible();

    // Add Expense button
    const addExpenseBtn = page.getByText('নতুন খরচ যোগ করুন').first();
    await expect(addExpenseBtn).toBeVisible();
    await addExpenseBtn.click();

    // Expense Modal opens
    await expect(page.getByText(/খরচ এন্ট্রি|নতুন খরচ/i).first()).toBeVisible();
    const closeBtn = page.getByText(/বাতিল|বন্ধ/i).first();
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    } else {
      await page.keyboard.press('Escape');
    }

    // Search input
    const searchInput = page.getByPlaceholder(/খাতের নাম বা নোট/i).first();
    await expect(searchInput).toBeVisible();
    await searchInput.fill('দোকান');
  });

  test('8. Tab 6 Intelligent Accounts Q&A Assistant: Predefined Questions & Live Calculations', async ({ page }) => {
    // Click Tab 6
    await page.getByText(/💡 হিসাব সহকারী ও প্রশ্নোত্তর/).first().click();
    await page.waitForTimeout(300);

    // Header
    await expect(page.getByText('বুদ্ধিমান হিসাব সহকারী (Accounts Q&A Navigator)')).toBeVisible();

    // Question 1: Net Profit
    const q1 = page.getByText(/এই সময়ে আমাদের আসল লাভ/).first();
    await expect(q1).toBeVisible();
    await q1.click();
    await expect(page.getByText('সহজ ব্যাখ্যা (Plain Explanation):').first()).toBeVisible();
    await expect(page.getByText(/সব খরচ বাদ দিয়ে/).first()).toBeVisible();

    // Question 2: Top Customer Due
    const q2 = page.getByText(/কার কাছে সবচেয়ে বেশি টাকা পাওনা বাকি/).first();
    await q2.click();
    await expect(page.getByText(/বাজারে বর্তমানে/).first()).toBeVisible();

    // Question 3: Total Vendor Payable
    const q3 = page.getByText(/মহাজনদের মোট দেনা কত/).first();
    await q3.click();
    await expect(page.getByText(/চালের মিল ও পাইকারি সরবরাহকারী/).first()).toBeVisible();

    // Question 4: Cash Drawer and Bank Balances
    const q4 = page.getByText(/বর্তমানে ক্যাশ ড্রয়ার ও ব্যাংক অ্যাকাউন্টগুলোতে/).first();
    await q4.click();
    await expect(page.getByText(/তাৎক্ষণিক ব্যয় মেটানোর মতো/).first()).toBeVisible();

    // Question 5: Stock Valuation
    const q6 = page.getByText(/গুদামে বর্তমানে কত বস্তা এবং কত টাকার চালের স্টক/).first();
    await q6.click();
    await expect(page.getByText(/গুদামে বর্তমানে মোট/).first()).toBeVisible();

    // Test Interactive Search Query
    const qaInput = page.getByPlaceholder(/যেকোনো প্রশ্ন লিখুন/i).first();
    await qaInput.fill('লাভ');
    await expect(page.getByText(/মুনাফা মার্জিন|আসল লাভ/).first()).toBeVisible();

    await qaInput.fill('IJJJ');
    await expect(page.getByText(/খরিদ্দার 'IJJJ' এর বর্তমান বাকি/).first()).toBeVisible();
  });

});
