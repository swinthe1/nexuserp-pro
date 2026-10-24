# Finance & accounting (Phase 5)

Migration `20261023001600_finance_engine.sql` adds the general ledger engine on top of the Phase 1 tables. Tests: `supabase/tests/05_finance.sql` (54 assertions).

The rule behind everything: **operational documents post their own journal entries, inside the same transaction.** Nobody types a journal entry for a sale, a purchase or a stock movement. Each automatic entry is linked to the document that created it, and the document is linked back to it. Users can only write journal entries by hand for accruals, reclassifications, opening balances and corrections.

## Chart of accounts

Every new company gets an Albanian SKK-style chart. Existing companies get it through a backfill.

- **Accounts:** classes 1–7 as group accounts, with about 55 postable accounts underneath.
- **Journals:** SAL, PUR, INV, BNK, CSH, GEN, POS, DEP, MFG and PAY.
- **Bank and cash accounts:** a main bank account and a cash box.
- **Fixed asset categories:** three, one each for equipment, vehicles, and furniture & IT.
- **Posting accounts:** a mapping in `company_account_defaults` from each posting purpose to an account. The purposes include receivable, payable, GRNI, COGS, VAT in and out, exchange gains and losses, depreciation and others. You can edit the mapping under *Finance → Setup → Posting accounts*.
- **Overrides:**
  - Product categories can override the inventory, revenue, COGS, expense and price-difference accounts.
  - Partners can override the receivable or payable account.
  - Tax codes carry their own VAT accounts.

`app.acct(company, key)` raises a clear error when a purpose has no account. Postings therefore fail loudly instead of landing in the wrong place.

## The posting engine

`app.gl_post(company, journal, date, source_type, source_id, reference, memo, lines, posting_key, currency, reversal_of)` is the only way the system creates a journal entry.

- **Lines** are passed as `{account_id, amount (+ debit / − credit), partner_id, cost_center_id, tax_code_id, variant_id, description, currency_code, amount_currency}`. Identical lines are merged.
- **Balance:** the entry must balance. A difference of up to 1.00 caused by rounding goes to the rounding account; anything larger raises an error.
- **Periods:** the date must fall in an open fiscal period.
- **Duplicates:** a unique index on `(company, source type, source id, posting_key)` stops the same document from posting twice.

### What posts what

| Source | Entry |
|---|---|
| Goods receipt (from a vendor) | Dr inventory · Cr goods received not invoiced (GRNI), at receipt cost |
| Goods receipt (other), adjustment, scrap | Dr/Cr inventory · Cr/Dr inventory adjustments; opening stock goes against opening-balance equity |
| Delivery, POS sale, returns | Dr cost of goods sold · Cr inventory, at weighted average cost |
| Production consumption / output | Dr/Cr work in progress against inventory (journal MFG) |
| Sales invoice | Dr receivable (gross) · Cr revenue per line (category account or default) · Cr VAT output per tax code. Credit notes post the reverse |
| Vendor bill | Dr GRNI at receipt value for received goods. The price difference goes to inventory while the stock is on hand, otherwise to purchase price variance. Stock items billed without a receipt go to cost of sales; services and other lines go to their own or the default expense account. Dr VAT input · Cr payable |
| Landed cost | Dr inventory (capitalised part) / COGS (part already sold) · Cr landed-cost clearing |
| Customer receipt / vendor payment | Bank against receivable/payable, at the payment rate on the bank side and the document rate on the open item. The difference is booked as a realised exchange gain or loss |
| Fixed asset activation | Dr asset account · Cr the account you pick, or no entry when the vendor bill already booked the asset |
| Depreciation run | One DEP entry per month: Dr depreciation (with the asset's cost center) · Cr accumulated depreciation |
| Disposal | Depreciation is caught up first, then: Dr accumulated depreciation, Dr proceeds account · Cr asset cost · gain or loss |
| Bank statement line booked to an account | Bank against the chosen account (fees, interest, transfers) |

**Inventory entries.** Stock entries come from a deferred constraint trigger on `stock_movements`. The trigger posts one entry per source document per transaction. It then writes `journal_entry_id` onto each movement and onto the receipt, delivery or adjustment. Because of this, **GL inventory always equals the stock valuation**; tests and the demo check it.

**Traceability.** Every automatic entry stores `source_doc_type` and `source_doc_id`, and every posted document stores `journal_entry_id`. Posted entries are immutable. The only exception is a system update that fills `journal_entry_id` when it is still empty. Corrections are made by reversal:

- `reverse_journal_entry` reverses a manual entry.
- `reverse_payment` reverses a payment.
- Credit notes reverse sales invoices and vendor bills.

## Receivables, payables and payments

`partner_aging(company, 'ar'|'ap', as_of)` returns, for each partner:

- the open amount in five buckets: not due, 1–30, 31–60, 61–90 and over 90 days;
- unapplied payments;
- the total, the oldest due date and the number of open documents.

The figures are in base currency and can be calculated for any past date.

A payment has a bank or cash account and is allocated to invoices or bills. `post_payment` checks each allocation:

- same partner;
- the document is posted;
- same currency;
- the amount does not exceed what is still open.

Vendor payments go through the approval engine first. When no approval workflow applies, they are approved directly. Any amount left unallocated is held as an advance on the partner's account.

## Bank reconciliation

1. **Import a statement.** Paste the e-banking CSV. The parser accepts:
   - `;`, `,` or tab separators;
   - ISO or European dates;
   - `1.234,56` style amounts;
   - either signed amounts or separate debit and credit columns.
2. **Match lines.** `auto_match_statement` matches each line in two passes:
   1. a posted payment on the same account with the same amount (in the account's currency), within ±7 days, preferring a matching reference;
   2. otherwise, a posted journal line on the bank's ledger account with the same amount.
3. **Deal with what is left.** Unmatched lines can be matched by hand, booked to an account (`book_statement_line`), turned into a receipt or payment, or ignored.
4. **Reconcile.** `reconcile_statement` requires two things: opening balance + lines = closing balance, and no unmatched lines. The statement page also shows the difference between the statement and the ledger.

## Cost centers

Journal lines, fixed assets and bill lines can carry a cost center. Depreciation inherits the asset's cost center.

- `account_balances(company, from, to, cost_center)` filters by cost center.
- The cost-center page shows revenue, cost of sales, expenses, profit and margin for each cost center. It also shows what has no cost center, so the rows add up to the company total.

## Fixed assets

- **Methods:** straight line or declining balance. Declining balance switches to straight line when that gives the larger charge.
- **Schedule:** `app.asset_schedule` builds the monthly plan when the asset is put in service.
- **Depreciation:** `run_depreciation(company, through)` posts every planned month up to the given date, once.
- **Disposal:** `dispose_fixed_asset` handles both sales and scrapping, and books the gain or loss.

## Financial statements

All four reports are built in the browser from `account_balances`, which returns opening, debit, credit and closing for each account (debit-positive). They read posted and reversed entries.

| Report | How it is built |
|---|---|
| **Profit and loss** | Revenue, cost of sales, gross profit, operating expenses, operating profit, other income and expenses, net profit |
| **Balance sheet** | Current and non-current assets, current and long-term liabilities, equity. Equity adds a computed *profit for the year* and *result of earlier years not yet closed*. An "Out of balance" row appears if assets ≠ liabilities + equity, which should never happen |
| **Cash flow** (indirect method) | Starts from net profit and adds back depreciation. Then come the working-capital changes by account subtype, investing (fixed assets, plus depreciation written off on disposals) and financing (equity, long-term debt). It is reconciled against the change in cash and bank accounts |
| **Trial balance** | Opening, period and closing debit/credit for each account, with a balanced check |

**Multi-period comparison.**

- Choose a period: year to date, a fiscal year, a quarter, a month or custom dates.
- Compare it with the 1, 2 or 4 previous years, or break it down month by month or quarter by quarter. Year-on-year comparisons show a change % column and a chart.
- The P&L and trial balance can be filtered by cost center.
- Every report exports to CSV and prints cleanly.

## Periods

- `create_fiscal_year` creates twelve monthly periods for a fiscal year.
- `set_period_status` needs `finance.approve`:
  - **closed** stops postings dated in the period, and the period can be reopened;
  - **locked** is final.
- Documents, payments and journal entries dated in a closed period are refused with a message that names the period.

## T-account view

Every posted operational document has an **Accounting** tab: invoices, bills, receipts, deliveries, adjustments, landed costs, payments and fixed assets. It shows the entries the document created, either as T-accounts or as journal lines, with links to each entry and on to the account ledgers. The account ledger links every line back to its source document.

## Not covered yet

- Year-end closing entries (moving the result to retained earnings). The balance sheet computes the result instead.
- Reverse-charge VAT and VAT returns. These arrive with the tax module in Phase 8.
- Ledger backfill for documents posted before this migration. Existing companies get the chart, but historical documents are not reposted.
