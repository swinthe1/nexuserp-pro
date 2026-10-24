# Moving a client from another program

Company menu → **Move from another program** (`/settings/migration`), or on the platform page: client actions → *Move data from the old program*.

1. Pick the **cut-over date**: the day the client stops using the old program. Export every list from the old program on that date.
2. Work through the steps in order. Each step takes a CSV or .xlsx export, recognises common Albanian column names (Shifra, Emërtimi, Njësia, Çmimi/Qmimi, Saldo, Afati, NUI…) and reads numbers written as `1.250,50`. Columns it does not recognise are matched by hand once and saved as a **template** (the platform administrator can share a template with every client; only column names are stored).
3. **Check the file** first: nothing is saved, every row is validated. Steps that go in as one entry (opening stock, open invoices, open bills, account balances) need every row to be fine.
4. **Check the totals** (step 9) against the old program's reports for the cut-over date.

| Step | Becomes | Accounting |
|---|---|---|
| Products, customers and vendors, employees | master data (existing importer) | — |
| Opening stock | one opening stock adjustment | Dr inventory / Cr 1091 |
| Price lists | price lists and their prices | — |
| Open customer invoices | posted invoices marked *opening*, old numbers and dates kept; they age, take payments and count in credit limits | one entry on the cut-over date: Dr 411 / Cr 1091 |
| Open vendor bills | posted bills marked *opening* | one entry: Dr 1091 / Cr 401 |
| Account balances | trial balance without customers, vendors and stock (refused there to avoid counting twice) | one entry; the difference to 1091 |

Opening invoices and bills stay out of sales and purchase figures, the VAT books and the sales/purchase books. After everything is in, account **1091 holds the opening capital**; it is zero when the capital accounts were part of the trial balance.

Database: `supabase/migrations/20261026002300_migration_center.sql` (`migration_import`, `migration_check`, `migration_runs`, `import_templates`). Tests: `supabase/tests/14_migration_center.sql`.

Planned next: an agent installed on the client's server that reads the old program's database directly and fills these same steps (column mapping proposed by AI, approved by a person).
