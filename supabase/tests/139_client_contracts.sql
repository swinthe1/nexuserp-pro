-- =============================================================================
-- Client contracts: DrisPRO's own company invoices its clients by contract; the licence follows the contract.
-- (after 138: "Kosova Trade" plays DrisPRO's own company, "SEF Test" the client)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as billing from public.companies where name = 'Kosova Trade L.L.C.' limit 1 \gset
select id as client from public.companies where name = 'SEF Test' and tax_number = '810123456' \gset

set role authenticated;
-- 1. only the platform admin
select t.login('besa@kt.al');
select t.throws('select public.platform_contracts()', 'super|platform|Permission', 'a company user does not see the contracts');
select t.login('zoe@platform.io');
select t.throws(format($q$select public.platform_contract_activate(public.platform_contract_save('{"client_company_id":"%s","lines":[{"description":"X","quantity":1,"unit_price":1}]}'))$q$, :'client'),
  'own company for the invoices', 'without DrisPRO''s own company nothing is invoiced');
select public.platform_billing_save(jsonb_build_object('billing_company_id', :'billing', 'tax_code', 'VAT18', 'post', true, 'email', false, 'grace_days', 15));

-- 2. a yearly contract: a package and two extra users each month, the installation once
select public.platform_contract_save(jsonb_build_object('client_company_id', :'client', 'start_date', current_date, 'every_months', 1, 'invoice_day', 1, 'payment_days', 15,
  'lines', jsonb_build_array(jsonb_build_object('description', 'DrisPRO Standard', 'quantity', 1, 'unit_price', 49),
                             jsonb_build_object('description', 'Përdorues shtesë', 'quantity', 2, 'unit_price', 5),
                             jsonb_build_object('description', 'Instalimi dhe trajnimi', 'quantity', 1, 'unit_price', 150, 'once', true)),
  'licence', jsonb_build_object('max_users', 7, 'max_registers', 3))) as k \gset
select public.platform_contract_get(:'k') as c0 \gset
select t.ok((:'c0'::jsonb ->> 'year_value')::numeric = 708 and (:'c0'::jsonb ->> 'once_value')::numeric = 150 and :'c0'::jsonb ->> 'number' like 'KON-%'
        and (:'c0'::jsonb ->> 'end_date')::date = (current_date + interval '12 months')::date - 1, 'a draft: 708 a year, 150 once, one year long');

-- 3. activating: the client becomes a customer, the invoices are planned, the one-time items invoiced, the licence follows
select public.platform_contract_activate(:'k') as act \gset
reset role;
select t.ok(exists (select 1 from public.business_partners where id = (:'act'::jsonb ->> 'partner_id')::uuid and company_id = :'billing' and tax_number = '810123456' and is_customer),
  'the client is a customer of DrisPRO''s company, found by its NUI');
select t.ok((select is_active and every_months = 1 and post and company_id = :'billing' and jsonb_array_length(lines) = 2 from public.recurring_invoices where id = (:'act'::jsonb ->> 'recurring_id')::uuid),
  'the monthly invoices are planned in DrisPRO''s company');
select t.ok((select status = 'posted' and total = 177 from public.sales_invoices where id = (:'act'::jsonb ->> 'setup_invoice_id')::uuid), 'the installation is invoiced at once: 150 + 18% VAT = 177');
select t.ok((select valid_until = (current_date + interval '12 months')::date - 1 + 15 and max_users = 7 and max_registers = 3 from public.licenses where company_id = :'client'),
  'the licence runs to the contract''s end plus 15 days, with its limits');
select public.run_recurring_invoices();
select t.ok((select total from public.sales_invoices where recurring_id = (:'act'::jsonb ->> 'recurring_id')::uuid order by invoice_date limit 1) = 69.62,
  'the first month is invoiced the day it starts: 59 + 18% VAT');

-- 4. a new price carries to the coming invoices; renewing adds a year with a price change; ending stops the invoices
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_contract_save(jsonb_build_object('id', :'k', 'client_company_id', :'client', 'start_date', current_date, 'every_months', 3, 'invoice_day', 1, 'payment_days', 15,
  'lines', jsonb_build_array(jsonb_build_object('description', 'DrisPRO Standard', 'quantity', 1, 'unit_price', 59)), 'licence', '{}'::jsonb));
reset role;
select t.ok((select every_months = 3 and (lines -> 0 ->> 'unit_price')::numeric = 177 from public.recurring_invoices where id = (:'act'::jsonb ->> 'recurring_id')::uuid),
  'every three months now: 3 × 59 on each invoice');
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_contract_renew(:'k', 10);
select public.platform_contract_get(:'k') as c1 \gset
select t.ok((:'c1'::jsonb ->> 'end_date')::date = (current_date + interval '24 months')::date - 1 and (:'c1'::jsonb -> 'lines' -> 0 ->> 'unit_price')::numeric = 64.9
        and (:'c1'::jsonb ->> 'renewals')::int = 1, 'renewed for one more year at +10%');
select t.ok(jsonb_array_length(:'c1'::jsonb -> 'invoices') >= 2 and (:'c1'::jsonb ->> 'open')::numeric > 0, 'the contract shows its invoices and what is still open');
select t.throws(format($q$select public.platform_contract_end('%s', '')$q$, :'k'), 'reason', 'ending needs a reason');
select public.platform_contract_end(:'k', 'Klienti mbylli biznesin', current_date + 30);
reset role;
select t.ok((select status = 'ended' from app.client_contracts where id = :'k') and not (select is_active from public.recurring_invoices where id = (:'act'::jsonb ->> 'recurring_id')::uuid)
        and (select valid_until = current_date + 30 + 15 from public.licenses where company_id = :'client'), 'ended: no more invoices, the licence runs to the end date plus grace');

-- 5. every morning: a contract past its end renews by itself when it says so
insert into app.client_contracts (number, client_company_id, status, start_date, end_date, auto_renew, lines)
values ('KON-T-139', :'client', 'active', current_date - 400, current_date - 35, true, '[{"description":"X","quantity":1,"unit_price":10,"once":false}]') returning id as k2 \gset
select app.client_contracts_daily();
select t.ok((select end_date = (current_date - 35 + interval '12 months')::date and renewals = 1 from app.client_contracts where id = :'k2'), 'a contract that renews by itself goes on for a year');

\set QUIET off
select count(*) as assertions_passed from t.results;
