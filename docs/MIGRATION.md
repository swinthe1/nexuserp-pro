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

## Agent for Logmicro (Compiere/ADempiere on SQL Server)

`deploy/agent/` runs on the client's server and only reads:

- `DrisPRO-Agjenti.ps1` (*Nis-Agjentin.bat*): structure report of any SQL Server database (tables, columns, keys, row counts, optional sample rows; password-like columns and user tables are never read).
- `DrisPRO-Nxjerrja.ps1` (*Nis-Nxjerrjen.bat*): extracts a Logmicro database into the migration centre's files, numbered by step: products (active with movements in the last N years or with stock; main price list converted to prices without VAT; invalid or duplicate barcodes dropped), partners (NUI cleaned and de-duplicated), stores, stock per store (from `M_STORAGE`, cost from `M_COST`; negative stock left out and reported), price lists, open customer and vendor documents (from the `BP_LEDGER` partner cards, per `C_ORDER`, remaining payments as one `SALDO-<code>` line), chart of accounts and trial balance (`FACT_ACCT`, without the receivable/payable/inventory control accounts, profit of the year to 109). `PERMBLEDHJA.txt` lists totals, everything left out and Logmicro's control-account balances to compare.

## Live link and training companies

- **Training company** (platform page → client actions → *Live link and training*): staff practise on live data; nothing is fiscalized (enforced in the database) and every screen shows a banner.
- **Live link** (one way, old program → DrisPRO): make a key there, download `lidhja.json` and put it next to `deploy/agent/DrisPRO-Lidhja.ps1` on the client's server. *Nis-Lidhjen.bat* does the first full load; *Instalo-Lidhjen.bat* makes it a background task (Task Scheduler, restarted within 5 minutes after a crash or reboot); *Ndalo-Lidhjen.bat* stops it.
- Every 30 seconds the agent reads what changed in Logmicro (`UPDATED` / `CREATED` columns, read-only) and calls `sync_push(key, batch)`: stores, products, partners and prices through the importers, stock set to Logmicro's quantity with one correction adjustment per store, and the partners' unpaid documents into `external_documents` (shown on the migration page; they do not touch DrisPRO's books).
- Only a SHA-256 hash of the key is stored; a key works for one company, can be switched off, and stops when the licence ends. Pushes are limited to 3,000 rows.
- Writing back into Logmicro is deliberately not done: it needs Logmicro's own integration interface (their mobile POS uses one), otherwise its numbering, stock, ledger and fiscalization could be corrupted.

Database: `supabase/migrations/20261026002500_live_sync.sql`; tests: `supabase/tests/15_live_sync.sql`.
