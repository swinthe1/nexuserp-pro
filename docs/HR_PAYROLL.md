# Human resources and payroll (Phase 8)

Migration `20261024001910_hr_payroll_engine.sql`. Tests: `supabase/tests/09_hr_payroll.sql` (34 assertions). The expected payslip figures are worked out by hand in the file header.

Pages: `/hr` (overview), `/hr/employees`, `/hr/leave`, `/hr/attendance`, `/hr/payroll`, `/hr/setup` (leave types, holidays, departments, positions), and `/hr/me` (self-service: my payslips, my leave, clock in/out, and my team's requests for managers).

## Calendar

- **Holidays.** `public_holidays` is per company. `app.seed_holidays(company, year)` fills it with the official days for the company's country. Days that move when a holiday falls on a weekend are included.
  - Albania 2026: 15 days, from the Bank of Albania calendar.
  - Kosovo 2026: 12 days.
  - HR can add or remove days on `/hr/setup`.
- **Working days.** `app.working_days(company, from, to)` counts Monday to Friday, minus holidays. Leave days and payroll proration both use it.

## Leave

| Step | Function | Who |
|---|---|---|
| Draft | insert into `leave_requests` | the employee (self-service) or HR |
| Submit | `submit_leave_request(id)` | the employee or HR |
| Decide | `decide_leave_request(id, approve, note)` | HR (`hr.approve`) or the employee's manager |
| Cancel | `cancel_leave_request(id)` | the employee while it is a draft or submitted; HR also after approval, unless payroll for those dates is already approved |

How the rules are enforced:
- **Days.** A trigger computes the days from the calendar, so clients cannot set them.
- **Status.** Only the decide action can set approved or rejected (`tg_system_statuses`).
- **Submitting** checks two things:
  - the request does not overlap another submitted or approved request;
  - for paid types with an annual entitlement, the balance is enough.
- **Balances.** `leave_balances(company, year, employee?)` returns, per employee and type: entitlement, taken, pending and remaining.
- **Notifications.** The manager and HR are notified on submit; the employee is notified on the decision.
  - A manager without `hr.read` gets a link to `/hr/me#team`, where they can decide.
  - People with `hr.read` get the HR leave page.

## Attendance

- `attendance_month(company, month, department?)` returns one row per employee, with a day code for every day of the month:
  - `P` present, `L` paid leave, `U` unpaid leave, `H` holiday, `W` weekend, `A` absent;
  - empty when the person was not employed yet, or for future days.
  - Each row also has totals for worked hours and overtime.
- `clock_attendance(employee?)` clocks in or out. Without an argument it clocks the signed-in user's own employee record.

## Payroll

### Parameters

Rules are data. `payroll_parameters` is keyed by country and valid-from date and is read-only for clients. `payroll_params(country, date)` returns the set in force on that date.

**Albania, 2026**

| Item | Employee | Employer | Base |
|---|---|---|---|
| Social insurance | 9.5 % | 15 % | Gross, limited to 50,000 – 186,416 ALL |
| Health insurance | 1.7 % | 1.7 % | Gross |

**Albania, income tax (TAP).** The tax is calculated on gross salary.

| Monthly gross (ALL) | TAP |
|---|---|
| up to 50,000 | 0 |
| 50,001 – 60,000 | 13 % of (gross − 35,000) |
| 60,001 – 200,000 | 13 % of (gross − 30,000) |
| above 200,000 | 22,100 + 23 % of (gross − 200,000) |

**Kosovo**

| Item | Rate |
|---|---|
| Pension (Trust) | 5 % employee + 5 % employer, on gross |
| Income tax, primary employer | on gross less employee pension: 0 % to €250, 8 % on €250 – 450, 10 % above |
| Income tax, secondary employer | a flat 10 % (contract with `is_primary_employer = false`) |

The overtime premium is 25 % in Albania and 30 % in Kosovo. Overtime hours come from attendance.

### The run

| Step | Function | Effect |
|---|---|---|
| Create | `create_payroll_run(company, year, month, pay_date?)` | One run per month. Includes every employee with a contract active in the month. |
| Extra earnings | insert into `payroll_run_items` | Bonuses and allowances, taxable or not, added before calculating. |
| Calculate | `calculate_payroll(run)` | One payslip per employee, with lines. Gross is prorated for joiners, leavers and unpaid leave by working days. Recalculating replaces the payslips. |
| Approve | `approve_payroll(run)` | Needs `payroll.approve`. The person who calculated the run cannot approve it. |
| Reopen | `reopen_payroll(run)` | Calculated or approved runs only; the run goes back to draft. |
| Post | `post_payroll(run)` | Books the payroll entry (below). Employees can see their payslips once the run is posted. |
| Pay | `pay_payroll(run, bank_account, date?)` | Dr 421 / Cr bank, for the net salaries. |
| Cancel | `cancel_payroll(run)` | Draft or calculated runs only. A posted run is corrected by a new run. |

**The payroll entry**

| Account | Debit | Credit |
|---|---|---|
| 641 Salaries | gross | |
| 644 Employer contributions | employer share | |
| 421 Salaries payable | | net |
| 431 Social security | | employee + employer contributions |
| 442 Income tax payable | | income tax withheld |

Contributions and income tax are paid to the tax office with an ordinary bank entry (Dr 431 / 442, Cr bank). Until that entry is made, the amount shows as `payroll_due` in the finance overview and on the tax calendar.

**Reports**
- `payroll_register(run)` is the register: per employee, gross, each contribution, taxable base, tax and net, with totals. It exports to Excel.
- `hr_overview(company)` returns headcount, joiners and leavers, today's absences, pending leave requests, the payroll trend and contracts ending soon.

### Hand-checked example (Albania, gross 120,000 ALL)

| Item | Calculation | Amount |
|---|---|---|
| Social, employee | 9.5 % × 120,000 | 11,400 |
| Health, employee | 1.7 % × 120,000 | 2,040 |
| TAP | 13 % × (120,000 − 30,000) | 11,700 |
| **Net** | 120,000 − 11,400 − 2,040 − 11,700 | **94,860** |
| Employer cost | 120,000 + 15 % + 1.7 % | 140,040 |

## Known limits

- Payroll does not handle these yet:
  - mid-month salary changes, which take the contract in force at the end of the month;
  - retroactive corrections;
  - the annual TAP reconciliation.
- The official payroll declarations (the Albanian E-SIG 025 list, the Kosovo monthly WS form) are not generated. The register has the figures they need.
- Paying salaries needs a bank account, so HR staff without finance access can calculate and post a run but not pay it.

## Sources

- Albanian contributions and TAP for 2026: alprofitconsult.com, easypos.al and sherbimekontabiliteti.al payroll guides (social 9.5 % / 15 % with the 50,000 – 186,416 base; health 1.7 % / 1.7 %; TAP brackets as above).
- Kosovo: ATK general information on personal income tax withholding, and the Trust pension contributions at 5 % / 5 %.
- Holidays: Bank of Albania official holidays 2026; officeholidays.com for Kosovo 2026.
