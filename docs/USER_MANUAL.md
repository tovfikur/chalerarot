# Chaler Arot User Manual and Workflows

**Practical guide for rice wholesale operations**  
Version 1.0 | Reviewed against the current application screens and code | 20 November 2026

This guide explains the working concepts and the normal operating paths for sales, purchases, stock, party balances, cash and bank, expenses, labour, returns, and reports. Screen labels are shown in English; the application can display Bengali or English.

<!-- pagebreak -->

## 1. What the system records

Chaler Arot keeps connected business records. A purchase adds rice to stock and creates or reduces an amount payable to a vendor. A sale removes sellable stock and creates or reduces an amount receivable from a customer. Payments change the party balance and the selected cash or bank account. Returns reverse the relevant sale or purchase and record the condition and settlement. Expenses and labour records track costs. Reports summarize these dated records.

The system uses kilograms (kg) as the common stock quantity. Bag and ton quantities are converted using the sizes saved on each product. Entered quantities and their converted kg are retained on transaction details. Sale cost is based on the cost attached to stock when it is sold; purchase landed costs can include purchase, transport, and other per-bag costs. Accurate opening data and timely entries are necessary for reliable stock valuation and profit figures.

### Roles

- **Administrator:** can manage business and inventory settings, language, users, expense categories, activity log, and operational records.
- **Staff:** can use the operating screens and their profile, but cannot manage users or change business settings. Some configuration and sensitive reporting controls are administrator-only.
- Each user signs in with an email address and password. Sessions expire after 12 hours. Changing a password, editing a user, or deactivating a user revokes existing sessions.

## 2. First login and initial setup

There is no pre-created default user. On a new installation, create the first administrator through the sign-in screen's first-account setup, or use the server's documented `POST /api/auth/setup` endpoint. Enter a name, phone, email, and password with at least 10 characters. Setup closes after the first account is created. Later accounts are created by an administrator from **Settings > Users**.

Complete this setup order before recording live transactions:

1. **Business settings:** enter the business name, address, phone, currency, fiscal-year starting month, and preferred language. Save changes.
2. **Cash and bank accounts:** open **Bank & Cash**, add the real cash box and bank accounts, and enter each opening balance with its effective opening date. Do not create duplicate accounts for the same real balance.
3. **Products:** open **Stock**, add each rice/product name and optional code, set the small, medium, and large bag weights used by the business, and enter opening quantity and opening unit cost. Check the sale price per kg. Opening quantity is the starting stock count, not a later purchase.
4. **Customers and vendors:** create party records with names, contact details, and optional codes. Enter opening due/payable only for balances already outstanding at the start date. Record a next follow-up date when useful.
5. **Inventory policy:** in **Settings > Inventory settings**, decide whether negative-stock sales should be permitted. It is off by default. Keep it off when stock must be verified before sale. When enabled, later purchases reconcile earlier negative units using actual landed cost.
6. **Staff and categories:** the administrator may add user accounts and create custom expense categories before staff begin daily work.

Use one consistent cutover date for opening stock, party balances, and money-account balances. Do not enter an opening balance again as a normal sale, purchase, payment, or deposit.

## 3. Navigation and common controls

The desktop sidebar and mobile bottom navigation expose Home, Sale, Purchase, Accounts, Labour / Landing Costs, and Settings. Other common screens include Customers, Vendors, Stock, Expense, and Bank & Cash. On desktop these appear in the sidebar; on mobile, use Settings/More or the links in Accounts and the dashboard. The exact arrangement changes with screen width.

- The business header includes global search and a reminder bell. Search finds invoices, returns, customers, and vendors. Select a result to open its record.
- The reminder bell lists customer collections or vendor payments due today or tomorrow when a next date is recorded. Opening a reminder takes you to the related party/account view.
- Forms show required fields and validation messages. Dates use the app's calendar. Numeric fields accept Bengali or English digits.
- Lists commonly support search, date and status filters, sorting, pagination, and PDF or CSV export. Exports reflect the current filtered list where the screen indicates filtered results.
- On the web, invoices and reports can be printed or saved as PDF through the browser print dialog. CSV files open in spreadsheet programs.

## 4. Daily sales workflow

**Record a sale**

1. Open **Sale** and choose **New Sale** if the history list is showing. Select a customer by code/name, or leave the party blank for a cash sale. A frequently used customer code can be set as the default from the form.
2. Set the bill date. The form can lock a date for repeated entry; unlock it when you move to another date.
3. Add one or more products. For each line choose kg, small bag, medium bag, large bag, or ton; enter quantity and the sale rate per kg. Product stock and converted kg are shown. The form calculates line totals and invoice total; apply any invoice discount shown by the form.
4. Enter the amount received now. If money is received, choose the cash/bank account where it was received. Choose a customer for any unpaid balance and optionally set the next collection date. A credit sale needs a customer; money received needs a payment account.
5. Review product, quantities, rate, discount, paid amount, due, date, and party. Confirm the sale. The app creates an invoice, updates stock and party balance, and records the received money.
6. Print, preview, or share the invoice from the success/detail view where available. To find it later, use Sale history, customer transactions, or global search.

**Sale status:** paid means no balance remains; partial means some money was received and some remains due; due means nothing has been allocated/paid. A cash sale is recorded without a customer account. If negative stock is disabled, the form blocks quantities above available stock. If enabled, sales can make stock negative; this affects later cost reconciliation and should be monitored.

**Correct a sale:** open its invoice from history or a customer's transactions and use Edit when offered. Editing revalidates the transaction and updates linked stock, balances, payment allocations, and accounting. Review the revised invoice and party balance afterward. Deleted transactions are not a normal correction path.

## 5. Purchase and landed-cost workflow

1. Open **Purchase > New Purchase**. Select or create the vendor. Enter the supplier memo/reference if used and set the bill date. Purchase memo numbers are generated/remembered by the form and can be adjusted where the field is available.
2. Add each received product. Enter unit and quantity, supplier purchase rate per kg, and the additional per-bag costs offered by the form (other cost and transport). Confirm the product's bag size is correct because per-bag costs are converted into per-kg inventory cost. The form automatically records the other-cost portion as stock-in/stock-out labour landing entries and transport as a transport landing entry.
3. Enter any amount paid now and select the account used. The unpaid remainder is recorded as payable to the vendor. Review the total, paid amount, due, and line costs, then confirm.
4. Confirm the goods physically received match the purchase lines. Stock increases in kg. Purchase rates and landed costs update the product's weighted-average cost; the transaction retains its historical detail.
5. Open the purchase invoice or vendor record to review, print, edit, or return goods later.

Both purchase-line other cost and transport cost are included in the purchase's per-kg inventory cost. Their linked landing entries support the landing-cost accounts and later settlements. Use **Labour / Landing Costs** to record separate operation-level transport or labour that was not captured on a purchase line. Avoid recording the same cost twice.

## 6. Customer collections and vendor payments

Use **Accounts** or the **Customers/Vendors** list to choose a party and inspect its opening balance, invoices, payments, returns, and current balance. The account's balance is the amount still owed to you for a customer, or still owed by you for a vendor.

**Receive from a customer:** choose **Collect / Receive**, select the customer, date, amount, and cash/bank account. Enter an optional note and follow-up date. If prompted to allocate the receipt across open invoices, choose the invoices and amounts. Save, then check the customer balance and the selected money-account balance. A receipt may be split across multiple accounts using the split payment option.

**Pay a vendor:** choose **Pay**, select the vendor, date, amount, and cash/bank account; add a note and allocate to open purchases where prompted. Save and confirm that the vendor payable and bank/cash balance both decrease. Payments can also be split across accounts.

The app generates payment numbers and keeps payment records in party history. Use the receipt/payment report or receipt print action where available. Do not record a party payment as a general deposit or withdrawal as well; that would count the same cash movement twice.

## 7. Sales returns and purchase returns

Start a return from the related invoice or the Returns flow. Choose the original sale or purchase and the item(s) being returned. Enter the returned quantity and classify its condition as good, partial damage, or damaged; include a damage reason or note when appropriate. The application limits the return to quantities still returnable on that invoice.

- A **sale return** reduces net sales/receivable or records a refund/settlement, and returned good rice goes back to sellable stock. Damaged rice is tracked separately from sellable stock.
- A **purchase return** reduces the purchase/vendor payable or records the amount settled with the vendor, and returned goods leave stock. Damaged status and return notes are included in the return detail.
- Check the return total, settlement, item condition, and original invoice before confirming. Print the return note for the counterparty when needed.

Returns are not the same as stock adjustments. Use a return only when goods move back under a specific sale or purchase; use stock audit/adjustment for a physical count discrepancy.

## 8. Products, stock counts, and stock reports

**Stock > Products** shows product code/name, current quantity, bag equivalent, and valuation. Search by code or name; open a product detail for its configured bag weights and information. Add or edit a product here. Bulk upload can be used for supported product/customer/vendor sheets; use the template and review rejected rows or duplicate codes before relying on imported balances.

**Stock > Movements** provides the dated stock movement history (opening stock, purchases, sales, returns, adjustments, and related movements). Use it to trace why a current quantity changed. Product and stock reports can be downloaded/printed from the relevant screen.

**Physical stock audit workflow**

1. Count the physical bags/kg by product before changing system stock.
2. Open **Stock > Audit**. Enter physical bag quantity and/or kg using that product's configured medium-bag conversion. Filter to discrepancies if useful.
3. Review system quantity, physical quantity, shortage/surplus, and the reason/note for each difference.
4. Apply the adjustment only after checking the physical count and selected date. The system writes a dated adjustment and history entry; it also affects stock valuation and the stock-adjustment expense view.
5. Open adjustment history or stock movements to confirm what was applied.

Do not use audit to silently rewrite an invoice error; correct the source transaction when possible. Negative-stock mode can make a count and cost history less intuitive; resolve missing purchase records and cutover quantities before interpreting valuation.

## 9. Expenses, labour, and household withdrawals

**Operating expenses:** open **Expense**, select date and category, enter description (required for Other), amount, cash/bank account, and optional note. Save. The expense appears in the expense register and reduces profit. Custom categories can be managed by an administrator. Categories distinguish operating expense from landing cost or other classifications; use the closest correct type.

**Labour / Landing Costs:** add a labourer, then record stock-in labour cost, stock-out wages (bags x wage per bag, shared among selected workers), or transport/landing costs. Review each worker/operation balance. Record a payment or advance from the selected cash/bank account, allocate to the relevant worker(s) or operation, and verify the unpaid amount. Advances reduce the amount left to settle later. Use the dedicated labour workflow when worker-level balances matter; avoid duplicate general expenses.

**House expense / owner withdrawal:** Accounts includes a separate house-expense withdrawal record with date, one or more cash/bank account amounts, and a description. Use it for money taken out for personal/household use, not for a shop operating cost. It reduces business cash/bank, but it is not the same as a trade supplier payment.

## 10. Cash, bank, and financial accounts

Open **Bank & Cash** to see active account balances and recent movements. Add accounts for real cash boxes, bank accounts, or supported mobile financial accounts. Set the opening balance and date once. Account detail shows dated movements; accounts with history cannot be permanently deleted. Inactive accounts can be archived/hidden from normal entry while retaining history.

- **Deposit / Withdraw:** use for money entering or leaving the business that is not already recorded by a sale, party payment, expense, labour settlement, or other linked transaction. Enter date, amount, account, and description.
- **Transfer:** move money between two business accounts. Choose different source and destination accounts, amount, date, and note. This reduces one balance and increases the other; it is not income or expense.
- **Opening balance:** use only for the cutover amount and effective date. Avoid setting it again after the account has live movements.
- **Bank & Cash report:** choose a date range and account (or all accounts) to print/save PDF or download CSV with opening, movements, debit/credit, running, and closing balances.

**Accounts dashboard and accounting reports:** use date presets/custom range to review sales, collections, dues, vendor payables, expenses, profit, and trends. Report Center includes profit and loss, cash flow, balance sheet, aged receivables/payables, expense register, cash/bank statement, general ledger, and journal entries where applicable. In the profit and loss report, net sales less cost of goods sold (COGS) gives gross profit; operating and other income/expense then determine net profit or loss. Aged balances group open invoices by invoice date; opening balances without invoice dates appear in the 90+ day group. Reports use the saved dated transaction history and account classifications.

Normal sales, purchases, payments, expenses, returns, and transfers create their own linked accounting and stock records. Do not enter a second manual journal for a transaction already recorded through its operating screen. Use the chart of accounts and manual journal tools only when authorized and familiar with accounting: each journal must balance total debits and credits. Draft entries are not posted results; confirm a posted status before expecting them in reports.

## 11. Dashboard, search, reminders, and exports

Home summarizes today's sales, collections, profit, and stock value, plus customer due, vendor payable, and cash/bank position. Click a KPI to drill into its underlying items. Recent invoices have Today, Due, and All views. Treat dashboard figures as a quick view; use the relevant report and date filter for reconciliation.

Global search searches invoice numbers, return numbers, customers, and vendors. Click a result to open its invoice, return detail, or party record. Search does not replace list filters for detailed reporting.

Use list filters before exporting. Sales and purchase history can export a filtered report as PDF or Excel-compatible CSV. Stock, expense, cash/bank, payment, and account screens provide their own reports or CSV/PDF actions. In the web app, choose **Print / Save PDF**, then choose **Save as PDF** in the browser print dialog. Review paper size and page orientation if a wide table is clipped.

## 12. Settings, corrections, and record safety

**Settings** contains Business details, Inventory settings, Language, My profile, Users (administrator), Activity Log, and Trash. Profile edits can require the current password; new passwords must be at least 10 characters. An administrator can create staff/admin users, edit users, reset a password, or deactivate a user. Deactivation revokes sessions.

Products, customers, vendors, and expenses moved to Trash can be restored for 30 days. Trash shows remaining days and offers purge for expired items; after permanent purge, the record cannot be restored. Deleting an account with financial history is blocked. Prefer editing a mistaken transaction or restoring a deleted master record over creating a duplicate.

The activity log is useful for reviewing who changed records. Before closing a shift, compare cash and bank against actual balances, review due and payable lists, check recent invoices and returns, confirm stock movement/audit entries, and export important reports for your records. Arrange regular database backups with the system administrator; a printed report is not a restorable backup.

## 13. Recommended operating workflows

**Open a new business file:** administrator setup -> business settings -> cash/bank accounts and dated openings -> product bag sizes and opening stock/cost -> customer/vendor master records and opening balances -> staff accounts -> verify dashboard and stock list.

**Receive and sell rice:** purchase invoice -> inspect landed cost and payment/account -> confirm stock receipt -> sale invoice -> collect money to the correct account or record customer due -> print invoice -> collect later through customer account -> reconcile cash/bank.

**Settle a vendor:** record purchase and due -> record vendor payment with the account used and invoice allocation -> check vendor balance -> check bank/cash ledger.

**Handle returned goods:** find original invoice -> create linked return -> record returned quantity and condition -> confirm refund/credit settlement -> inspect stock buckets and party balance -> print return note.

**Close the day:** review dashboard drill-downs -> verify all sales, purchases, receipts, payments, expenses, and returns -> reconcile physical stock exceptions -> reconcile each cash/bank account -> review customer collections/vendor payments due -> export cash and transaction reports.

**Review a month:** set the month date range -> review profit and loss and cash flow -> review aged receivables and payables -> inspect inventory valuation and adjustments -> review account ledgers/journals -> save PDF/CSV reports. Confirm the fiscal-year starting month in Business settings before year reporting.

## 14. Quick troubleshooting

- **Cannot sign in:** check that the account exists and is active; use the exact email address. Ask the administrator to reset the password. Sessions end after 12 hours.
- **No user can be created from setup:** initial administrator setup is one-time. Ask an administrator to add a user in Settings > Users.
- **Sale is blocked:** check product stock and selected unit conversion. If negative stock is intentionally required, an administrator can review Inventory settings.
- **Payment cannot be saved:** make sure an active cash/bank account is set up, the amount is positive, and the customer/vendor is selected where required.
- **Stock or profit looks wrong:** check product opening quantity/cost and bag weights, missing purchase/return records, landed costs, date filters, and any negative-stock interval. Trace movements before applying an adjustment.
- **A report appears incomplete:** clear search/status filters, check the date range, and confirm relevant entries are saved/posted. Some reports are web print/save flows.
- **Deleted product or party needed:** open Settings > Trash and restore it before its retention period ends.

## Functional coverage checked

This manual was prepared by reviewing the current navigation, screen forms, API capabilities, and data model for authentication/roles, product and party records, purchases and sales, collections and payables, returns, stock movements/audits, expenses, labour/landing costs, cash/bank accounts and transfers, reports/accounting, activity log, reminders, search, and Trash. It describes the implemented workflows at a user level. It is not a formal accounting certification or a claim that every edge case has been runtime-tested.
