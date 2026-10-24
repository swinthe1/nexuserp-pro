# Demo data

`supabase/seed/demo.sql` builds two companies with a realistic month of work in every module.

- **Ylli Retail sh.p.k.** (Tiranë, ALL): a shop in Blloku with two tills, a central warehouse, a small coffee roastery, wholesale to hotels and bars, a web shop and two delivery vans.
- **Ylli Kosova L.L.C.** (Prishtinë, EUR): its sister company.

The companies' own data is written in Albanian: products, customers, notes, memos and reasons. Some names are created by the database itself, such as the chart of accounts, pipeline stages, leave types and default warehouse. Those are shown in the user's language by the app.

## Loading it

The seed goes into an **empty** database, after all migrations, connected as `postgres`:

```bash
DATABASE_URL=postgres://postgres:…@db.<project>.supabase.co:5432/postgres npm run db:seed
# same as: psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/seed/demo.sql
```

- **Where it works:**
  - **Supabase:** users are created confirmed, with password `demo1234`, an `auth.identities` row and a hashed password via pgcrypto.
  - **Plain-Postgres test stack** (`supabase/tests/00_supabase_stub.sql`): also works.
- **Why `psql` is needed:** the script uses psql variables. That is why it is not `supabase/seed.sql`; the Supabase CLI's seed runner does not support them.
- **Loading twice:** it refuses to run a second time in the same database.
- **Dates:** most documents are relative to the day you load it, such as "yesterday's route" or "a lot expiring in 9 days". The Phase 8 history is fixed to the months July–October 2026: payroll, VAT returns and service invoices.
- **Permissions:** the seed briefly sets `session_replication_role = replica` to backdate a few records. The `postgres` role on Supabase is allowed to do this.

## Who to sign in as

Every password is `demo1234`.

| Login | Person | Role | Try this |
|---|---|---|---|
| arta@ylli.al | Arta Hoxha, managing director | Company admin (also in Ylli Kosova) | Approve the big T-shirt purchase order (over 100 000 ALL) and October payroll. Read the finance overview and the VAT books, and switch to the Kosovo company. |
| elira@ylli.al | Elira Dervishi, sales manager | Sales manager | Pipeline (one deal in each stage), Dritan's leave request, the overdue invoice of Bar Komiteti, and the web shop orders (one failed) |
| dritan@ylli.al | Dritan Shehu, sales rep | Sales rep | Hotel Rogner's quote and order, the follow-up task for Klea, his own leave request |
| besnik@ylli.al | Besnik Krasniqi, warehouse lead | Inventory manager | Approve the theft write-off. Also the half-done stock count, the pick list for Spar, low-stock alerts and milk lots near expiry. |
| genta@ylli.al | Genta Mema, buyer | Procurement manager | The requisition waiting for her, the bill from Ujë Glina that does not match the receipt, replenishment suggestions, the supplier credit note |
| mira@ylli.al | Mira Leka, cashier | Cashier | Till 1 is open with three sales; yesterday's Z-report was 200 ALL short |
| ardit@ylli.al | Ardit Gjoka, cashier | Cashier | This morning's closed and balanced session on till 2 |
| klodian@ylli.al | Klodian Meta, head roaster | Production manager | A roast on the roaster now, 1 kg packs released and waiting, gift sets planned for December |
| vjosa@ylli.al | Vjosa Dema, HR and payroll | HR manager | October payroll calculated and waiting for approval, leave requests, the attendance grid, 12 employees |
| florian@ylli.al | Florian Hysa, logistics | Logistics manager | Today's route out on the road, tomorrow's route planned, yesterday's failed delivery now going by post, cash on delivery to settle |

## What is in it

Counts below come from a fresh load. They are not hand-counted.

### Companies and master data

| | Ylli Retail (AL) | Ylli Kosova (XK) |
|---|---|---|
| Products / variants | 16 / 23 (T-shirt in 4 sizes × 2 colours, coffee, milk with lots, water, mugs, roastery materials and packs) | — (invoices by description) |
| Customers / vendors | 9 / 7 | 3 / 4 |
| Warehouses / locations | 2 / 17 (shop floor, back room, aisles, cold room, roastery) | 1 / 9 |
| Price lists | 3 (Pakicë, Shumicë HoReCa, Distributorët e Kosovës in EUR) | — |
| Employees | 12 with contracts, 7 departments | 4 (one with a second employer) |
| Chart of accounts | 61 accounts | 60 accounts |
| Active users | 10 | 1 (Arta) |

### Documents, by state

| Area | What is there |
|---|---|
| CRM | 5 leads: new, contacted, qualified and lost. 8 opportunities across New, Qualified, Proposal, Negotiation, Won and Lost. Calls, meetings, an email and a task logged by the sales team. |
| Sales | Quotes: converted, sent, draft and expired. 20 orders: draft, confirmed, partially delivered, delivered and closed. 16 deliveries: done, ready to ship and draft. 46 invoices in Albania (paid, partly paid, unpaid). A credit note in Kosovo. |
| Purchasing | Requisitions: submitted, approved and ordered. 6 purchase orders: draft, waiting for approval, sent and late, partly received, closed. 38 vendor bills, including one stopped by the three-way match and a supplier credit note. Landed costs for an import from Italy, with its customs declaration. |
| Inventory and warehouse | 15 posted goods receipts and one draft. Adjustments, including a theft write-off waiting for approval. 2 transfers done and one prepared. 6 open low-stock alerts. Milk lots expiring in 9–12 days. Pick and put-away tasks, and a stock count in progress. |
| Point of sale | 2 registers, 42 receipts including a refund. Sessions: yesterday closed 200 ALL short, this morning closed and balanced, till 1 open now. 2 receipts failed fiscalization (shown in the monitor). |
| Production | 4 BOMs: roast → 1 kg / 250 g packs → gift set. Work orders closed with variance, in progress on the roaster, released, and planned with a sub-assembly. |
| Finance | 348 posted entries in Albania, including a summarised prior year and fixed assets with depreciation (one disposed, one draft). September's bank statement is reconciled. October's is open, with 7 lines to match, among them Komiteti's payment that nobody has recorded yet. A draft accrual is waiting for review. |
| Tax | Albania: VAT returns for July and August accepted and September submitted. Kosovo: September submitted. Exports at 0 %, reverse charge, a farmer purchase and exempt training in Kosovo. 92 fiscalized documents, 2 failed. |
| People | Payroll: July–September paid, with contributions paid to the tax office; October calculated and waiting for approval. Kosovo payroll for September posted. 6 leave requests approved, 3 waiting. Attendance for every working day this month. |
| Logistics | 3 routes: yesterday completed (one failed stop, now with Posta Shqiptare), today in progress, tomorrow planned. 10 shipments, including older ones tracked by the post. Cash on delivery collected and settled. |
| Web shop | Channel shop.ylli.al with 4 orders: 3 imported into sales orders, 1 failed (`GIFT-XMAS` is not a known product). |
| Replenishment | Automation set to draft purchase orders. Suggestions from the last run, including a transfer from the warehouse to the shop. |
| Approvals and notifications | Pending: the T-shirt purchase order (Arta), the theft write-off (Besnik), the requisition (Genta), 3 leave requests (managers) and October payroll (Arta). 86 unread notifications spread over the team. |
| Admin | 2 approval workflows (write-offs over 10 000 ALL, purchase orders over 100 000 ALL) and a custom role "Përgjegjës dyqani" (shop supervisor). |

### Stories in the data

- **Bar Komiteti pays late.** Its invoice from last month is overdue. Elira has written that she called the owner. The money has arrived in the October bank statement, but nobody has matched it yet.
- **Spar** pays its latest invoice in two halves, and let a quote expire.
- **Ujë Glina** billed 960 bottles but delivered only 600. The bill is stopped in drafts as a match exception.
- **Fermat Lushnja** billed milk at 93.40 instead of 92.00, then sent a credit note for the difference.
- **The milk lots in the cold room** expire within 9–12 days.
- **Yesterday's failed delivery:** Klea Basha in Durrës was not at home. The parcel is now with Posta Shqiptare, tracking RR204517865AL.
- **Till 1** closed yesterday 200 ALL short, with the reason noted on the Z-report.
- **Hotel Rogner** wants Christmas banqueting coffee. 1 kg packs for that order are released in the roastery, waiting for today's roast.
- **The theft write-off** of 12 kg of espresso is waiting for the inventory manager's approval.

### Figures to check against

These are for Ylli Retail on a fresh load, year to date:
- Revenue 6 673 928.08 ALL, net profit 582 373.15 ALL, cash and bank 2 013 681.24 ALL.
- The trial balance balances, with 0 unbalanced entries.
- The VAT books equal accounts 4456 / 4457 for every month. In October, 1 124 ALL of POS VAT sits in the open till session.

## Known gaps

- No file attachments: they need Supabase Storage objects, and the seed only writes to the database.
- The Kosovo company has no products or stock, only invoices, bills, payroll and a VAT return.
- Only one person signs in to the Kosovo company (Arta). Its employees are payroll records without logins.
- The web shop, carrier tracking and fiscalization use the built-in test simulations. No real connector is called.
- Emails from notifications are not sent; only in-app notifications are created.
