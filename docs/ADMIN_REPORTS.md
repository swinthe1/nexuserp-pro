# Admin, reports, notifications and search (Phase 8)

Migration `20261024001940_platform_admin_reports.sql`. Tests: `supabase/tests/11_admin_reports.sql` (44 assertions).

## Admin and settings (`/settings`)

| Page | What it does | Functions |
|---|---|---|
| Company | Legal details (NIPT / NUI, address, base currency), business rules (credit limits, negative stock, approvals), and fiscal setup (business unit, TCR and software codes, test or production) | `company_settings` table, admin only |
| Users | Invite by email with roles, change roles, suspend, remove. Shows the last sign-in. | `invite_member`, `company_users`, `set_member_roles`, `set_member_status` |
| Roles | A permission matrix per module (see, change, delete, approve). The built-in roles are fixed; custom roles belong to the company. | `save_custom_role`, `delete_custom_role` |
| Approval workflows | Per document type, from an amount, with a priority. Steps are approved in order by a role or a person, with a minimum number of approvals. | `save_approval_workflow` (header and steps in one call) |
| Numbering | Prefix, padding, yearly or no reset, and the next number per document type | `numbering_overview`, `save_numbering` |
| Audit log | Every change, with the person's name, the fields before and after, and a link to the record | `audit_feed` |
| Import | CSV or Excel files of products, customers and vendors, employees, or opening stock | `import_rows` |

Safety rules, enforced in the database:
- **Admins.**
  - Nobody can change their own roles or status.
  - The last active admin cannot be removed, suspended or demoted (`app.admins_left`).
- **Invites.** An invite is refused if the email is invalid or the person is already a member.
- **Custom roles.**
  - Permissions must come from the catalog, or be `module.*` / `*.action` patterns.
  - A role cannot be deleted while people still have it.
- **Numbering** can only move forward. Setting the next number below one already issued is refused, so numbers are never reused.
- **Imports.**
  - Run with `dry_run = true` first: every row is validated and the response lists errors by row and field, without changing anything.
  - Each row is all-or-nothing.
  - Opening stock is posted as one stock adjustment, into the first row's warehouse main location, at the given unit costs.
  - Import needs the permission of the module it writes to.

## Reports (`/reports`)

One entry point, `run_report(company, key, {from, to, group_by, filters})`, returns columns, rows and totals for the chosen grouping. Running a report needs the module's read permission, plus either `reports.read` or that module's write permission.

| Key | Report | Groupings |
|---|---|---|
| `sales` | Sales analysis: invoices and POS receipts together, net of credit notes | month, customer, product, category, salesperson, channel, city, document |
| `margin` | Margin by product: revenue − cost of goods at the cost recorded on the movement | same as sales |
| `purchases` | Purchase analysis: vendor bills less vendor credit notes, with VAT | month, vendor, product, category, account, document |
| `inventory` | Inventory valuation on any date | warehouse, category, age, product |
| `stock_aging` | Stock by days since the last movement (0–30, 31–90, 91–180, over 180) | age, warehouse, category, product |
| `receivables` | Open receivables with aging buckets | customer, bucket, document |
| `vat` | Output and input VAT by month and treatment, from the same entries as the VAT books | month, treatment, partner, document |
| `payroll` | Payroll cost: gross, contributions, tax, net, employer cost | month, department, employee |
| `production` | Closed work orders, planned against actual cost | month, product, document |

- **Drill-down.** Clicking a row runs the next grouping with that value added to the filters. The breadcrumb shows the path. The last level lists documents with links to them.
- **Export.** Every level exports to Excel, with a title line, the period and filters, number formats and totals. CSV and print are also available.
- **Where the figures come from:**
  - Sales come from posted documents in the base currency (`app.sales_facts`).
  - Inventory value on a date is rebuilt from the stock movements (`app.stock_as_of`).
- **Checks against the ledger.** On the demo company:
  - The inventory report equals the valuation (and account 31x to within rounding).
  - Sales revenue equals invoices plus POS (account 70x).
  - The VAT report equals the VAT books.

## Notifications (`/notifications`)

- **Categories.** Every notification has one: approvals, people, tax, stock, sales, logistics, general. A trigger assigns it from the type and the record it points to.
- **Inbox.** Filter by category, show unread only, mark read or unread. The bell in the top bar shows the unread count.
- **Preferences.** Each user can mute categories in the app (`notification_preferences`). Approvals cannot be muted. A muted category is never delivered.
- **Email.** The email switch is saved now. Emails are sent once a `notify-email` function is connected to a mail service; until then, email is a placeholder.
- **Daily reminders.** `run_daily_reminders()` runs at 06:00 through pg_cron, when pg_cron is available. It sends:
  - VAT and payroll deadlines from the tax calendar, from five days before they are due until they are met;
  - employment contracts ending in the next 30 days;
  - lots with stock on hand that expire within 14 days.

  The same reminder is not sent to the same person twice on one day.

## Global search (⌘K)

Search ignores Albanian letters, so `fature` finds "Faturë" and `cmim` finds "Çmim" (`app.fold`, migration 2000). With an empty search box, the palette offers the pages opened from it recently. Typing a menu name works in both languages.


`global_search(company, query, limit)` searches everything the user may see, subject to RLS and permissions. Phase 8 adds:
- employees, by name, number or personal number;
- shipments, by number or tracking number;
- delivery routes;
- VAT declarations;
- payroll runs;
- leave requests;
- web shop orders, by external id.

The command palette also has actions for the new modules: new employee, request leave, run payroll, prepare the VAT return, plan deliveries, invite a user, import data from a file, run a report.

## Language

The app opens in Shqip; English is the second language. The **SQ | EN** switch is in the top bar (a language icon on phones), in the user menu and on the sign-in page. The choice is saved to the person's profile (`profiles.locale`), so it follows them to other devices.

The database writes its messages, notifications and labels in English. The app translates them when it shows them (`tServer`, `td`), so two people can read the same notification in different languages. How to add or change text: `src/i18n/HOWTO.md`; terminology: `src/i18n/GLOSSARY.md`; `npm run i18n:check` must report zero.
