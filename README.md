# NexusERP Pro

Multi-company ERP for retail, wholesale, production and distribution companies in Albania and Kosovo. Built with React 18, TypeScript, Vite, Tailwind CSS and shadcn/ui on Supabase.

## Status

| Phase | Scope | State |
|---|---|---|
| 1 | Schema + RLS for all modules, auth, company context and switcher, layout, ⌘K, dashboard skeleton, advanced data table, soft deletes and audit | ✅ |
| 2 | Inventory & advanced costing: products and variants, barcodes, multi-warehouse, weighted average cost, imports with landed cost, stock levels and movements, low-stock alerts | ✅ |
| 3 | CRM & sales: leads → pipeline (Kanban + list) → quotes → orders → deliveries → invoices; price lists, customer prices, discounts, credit limits, stock reservations, sales metrics | ✅ |
| 4 | Procurement: requisitions with approval, purchase orders with approval limits, vendor price lists, replenishment, receiving from POs, vendor bills with three-way match and overrides, vendor credit notes, purchasing metrics | ✅ |
| 5 | Finance: SKK chart of accounts, automatic GL postings from sales, purchases, inventory, payments, production and assets with links back to the source; AR/AP aging and payments; bank statements and reconciliation; cost centers; fixed assets and depreciation; P&L, balance sheet, cash flow and trial balance with multi-year comparison; T-account view on documents | ✅ |
| 6 | Warehouse floor: scan-first receiving, putaway suggestions, pick lists, shipping confirmation, bin moves, cycle counts, lot/expiry tracing and recall. POS: keyboard-first till with barcode scanning, split payments, 80 mm receipts, refunds, cash in/out, Z-report close with GL postings, offline selling with a sync queue | ✅ |
| 7 | Manufacturing: multi-level BOMs with operations and cost roll-up, work orders with sub-assembly orders, release with shortage check, lot-picked or backflushed consumption, labour and overhead absorption, finished-goods receipt with lots, close with variance, lot genealogy both ways, production plan, work-center load | ✅ |
| 8 | Tax: Sales and Purchase books in the ATK (Kosovo) and DPT (Albania) layouts, VAT declarations with ledger check, settlement and period lock, reverse charge, import VAT, fiscalization queue (test-mode simulation), tax calendar. HR & payroll: employees and contracts, holidays, leave with balances and approvals, attendance grid, AL / XK payroll with register and GL posting. Logistics: shipments with tracking, route planning for the own fleet, carrier hand-off, cash on delivery. OMS: demand-netted replenishment, transfers, scheduled PO generation, fulfilment queue. Reports with drill-down and Excel export. Admin: users, custom roles, approval workflows, numbering, audit log, imports. E-commerce connector placeholders, notifications centre with preferences and reminders, extended global search | ✅ |
| 9 | Shqip as the default language with English as the second (every label, message, report, printout and notification; switcher in the top bar, the user menu and the sign-in page; each person's choice saved to their profile). Plain-language pass for cashiers, warehouse staff and sales reps; role-based start screens. Albanian demo data across all modules (`supabase/seed/demo.sql`). Live updates on the lists people watch during the day. PWA: install, offline start, update prompt, app shortcuts. Page-level error recovery, offline banner, error and empty states, optimistic updates. Accent-insensitive search | ✅ |
| 10 | Clients and licences: only the platform administrator creates client companies (with the client's admin account and licence), sign-up only by invitation, a licence per company (plan, user limit, start and end, pause), access stops outside the licence while the data is kept, ending-soon banner, change password, support visits. Simpler menu: personal favourites (star) or most-used pages at the top, folding menu parts, company admins hide parts the company does not use (Company settings → Menu). See [docs/PLATFORM.md](docs/PLATFORM.md) | ✅ |

## Getting started

```bash
cp .env.example .env.local          # fill in your Supabase URL + anon key
npm install
supabase db reset                   # local stack; or `supabase db push` for a hosted project
npm run dev
```

**On a Windows computer**, one script starts everything locally (Supabase in Docker, the demo company, the app): see [deploy/windows/README.md](deploy/windows/README.md).

To try it with data, load the demo after the migrations: `DATABASE_URL=… npm run db:seed` (see [docs/DEMO_DATA.md](docs/DEMO_DATA.md); all demo logins use the password `demo1234`).

The app opens in Shqip; switch to English with **SQ | EN** in the top bar.

Sign up, create a company, and you are its admin. Creating a company also sets up:

- the main warehouse and its bins;
- VAT codes for AL or XK;
- units of measure;
- payment terms;
- the fiscal year;
- the CRM pipeline stages.

### Useful scripts

| Script | What it does |
|---|---|
| `npm run build` | Typecheck and production build (PWA service worker included) |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` from a database (`DATABASE_URL=...`) |
| `npm run i18n:check` | Report text that is not translated and Albanian keys that are missing (must be zero) |
| `npm run db:seed` | Load the Albanian demo company into a database that has the migrations (`DATABASE_URL=...`) |
| `npm run db:test` | Run the 633 SQL assertions on a throwaway Postgres (`DATABASE_URL=...`) |

## Repository layout

```
docs/
  SCHEMA.md          tables, relationships, RLS strategy
  INVENTORY.md       costing rules, imports, alerts
  SALES.md           CRM & sales flow, pricing, validations, reservations
  PROCUREMENT.md     requisitions, PO approval, three-way match, replenishment
  FINANCE.md         posting rules, payments, reconciliation, assets, statements, periods
  WMS_POS.md         warehouse floor screens, cycle counts, lot trace; the till, offline sync, Z-report and postings
  MANUFACTURING.md   BOMs, work-order lifecycle, costing and WIP, postings, genealogy, planning
  TAX.md             VAT books and declaration layouts (AL / XK), settlement, reverse charge, import VAT, fiscalization
  HR_PAYROLL.md      holidays, leave, attendance, payroll rules and postings (AL 2026, XK)
  LOGISTICS_OMS.md   shipments, routes, cash on delivery; replenishment automation; e-commerce channels
  ADMIN_REPORTS.md   users and roles, workflows, numbering, audit, imports; reports; notifications; search
  DEMO_DATA.md       the demo company: logins, what is in each module, stories to try, known gaps
supabase/
  migrations/        0100 core … 1200 platform (Phase 1) · 1300 inventory engine · 1310 atomic document save · 1400 sales engine · 1500 procurement engine · 1600 finance engine · 1700 WMS + POS engine · 1800 manufacturing engine · 1900 tax engine · 1910 HR & payroll · 1920 logistics + e-commerce · 1930 OMS automation · 1940 admin, reports, notifications · 2000 language, live updates, accent-insensitive search
  tests/             00 stub (plain Postgres only) · 01 RLS & invariants (82) · 02 inventory engine (69) · 03 sales flow (57) · 04 procurement (76) · 05 finance (54) · 06 WMS + POS (66) · 07 manufacturing (59) · 08 tax (46) · 09 HR & payroll (34) · 10 logistics + OMS (40) · 11 admin + reports (44) · 12 language + live updates (6)
  seed/demo.sql      Albanian demo data for every module (psql script; `npm run db:seed`)
scripts/
  i18n-check.mjs     finds untranslated text and missing Albanian keys
  gen-db-types.py    supabase-js Database types incl. FK relationships, straight from Postgres
src/
  app/               providers (theme, auth, company + permissions), router, layouts, navigation
  components/
    ui/              shadcn/ui primitives
    data-table/      advanced table: search, faceted filters, sort, column visibility, saved views,
                     bulk actions, CSV/PDF export, server-side mode
    layout/          sidebar, top bar, company switcher, ⌘K palette, notifications (realtime)
    …                page header, stat card, stock bar, activity timeline, confirm dialog, forms
  features/
    auth/            sign in/up, password reset, onboarding (create company)
    dashboard/       executive dashboard (inventory, sales, receivables, payables and profit live)
    approvals/       approvals inbox
    inventory/       api.ts (TanStack Query hooks), schemas.ts (Zod), components/, pages/
    sales/           CRM, quotes/orders/deliveries/invoices, price lists, customers, sales overview
    procurement/     requisitions, purchase orders, vendor bills, replenishment, vendor prices, purchasing overview
    wms/             handheld screens: receive, put away, pick, ship, move, count, lots
    pos/             registers, sessions and Z-reports, the full-screen till, offline queue (IndexedDB), receipt printing
    manufacturing/   production overview and plan, work orders (list, board, detail), BOM editor, work centers, lot genealogy
    finance/         chart of accounts and ledgers, journal entries, payments, aging, bank, assets, cost centers, statements, setup
    tax/             VAT books, declarations, fiscalization queue, tax codes, tax calendar
    hr/              employees, leave, attendance, payroll runs and payslips, setup, self-service (/hr/me)
    logistics/       dispatch board, routes, shipments and tracking, carriers and vehicles
    oms/             fulfilment queue (replenishment lives in procurement/)
    ecommerce/       web shop channels, channel orders, product links, stock sync
    reports/         report catalog, drill-down report page with Excel export
    settings/        company, users, roles, workflows, numbering, audit, import, notifications
  i18n/              t()/tn()/td()/tServer(), language switcher, Albanian dictionary per area (sq/dict), database message templates;
                     HOWTO.md (how to translate) and GLOSSARY.md (the Albanian terms used everywhere)
  lib/               supabase client, generated types, errors, formatting (follows the language), export
```

## Conventions

- **Permissions.** The UI checks the same `module.action` permissions as RLS, via `can('inventory.write')` and `<Can>`. RLS is the real guard; the UI only hides what the user cannot do.
- **Writes.**
  - Simple master data is written directly through RLS.
  - Documents are saved atomically with `save_document`: the header and its lines are saved in one transaction.
  - Documents are posted through `post_*` RPCs. Clients never write stock, costs or ledgers.
- **Forms** use React Hook Form with Zod. The Zod rules mirror the database checks, such as the barcode check digit and lot requirements, so errors show while typing.
- **Language.** Shqip is the default, English the second language. English text in the code is the translation key: `t('Save changes')`; Albanian lives in `src/i18n/sq/dict`. The database writes English and the app translates it (`tServer`, `td`), so each person reads in their own language. See `src/i18n/HOWTO.md`; `npm run i18n:check` must report zero.
- **Queries** use TanStack Query with company-scoped keys. The cache is cleared on company switch, and bulk product actions update the list optimistically.
