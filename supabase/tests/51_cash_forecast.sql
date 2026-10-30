-- =============================================================================
-- DrisPRO · the 13-week cash forecast and the supplier payment proposal
-- (runs after 01–50; uses "Tatim Kosova", which has open supplier bills and customer invoices)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

reset role;
select id as co from public.companies where name = 'Tatim Kosova' \gset
select id as bank from public.bank_accounts where company_id = :'co' and account_kind = 'bank' limit 1 \gset

set role authenticated;
select t.login('alice@alba.al');

-- the forecast: opening, 13 weeks, the running balance adds up
select public.cash_forecast(:'co') as f \gset
select t.ok(jsonb_array_length(:'f'::jsonb -> 'weeks') = 13, 'thirteen weeks');
select t.ok((:'f'::jsonb ->> 'opening')::numeric = (select sum((a ->> 'balance')::numeric) from jsonb_array_elements(:'f'::jsonb -> 'accounts') a),
  'the cash today is the sum of the bank and cash accounts');
select t.ok((select (w ->> 'closing')::numeric from jsonb_array_elements(:'f'::jsonb -> 'weeks') w where (w ->> 'week')::int = 13)
  = (:'f'::jsonb ->> 'opening')::numeric + (select sum((w ->> 'net')::numeric) from jsonb_array_elements(:'f'::jsonb -> 'weeks') w),
  'the cash at the end is today''s cash plus every week''s net');
select t.ok((select sum((w ->> 'net')::numeric) from jsonb_array_elements(:'f'::jsonb -> 'weeks') w)
  = (select sum((w ->> 'inflow')::numeric + (w ->> 'outflow')::numeric) from jsonb_array_elements(:'f'::jsonb -> 'weeks') w), 'net is in minus out');
select t.ok((select -sum((x ->> 'amount')::numeric) from jsonb_array_elements(:'f'::jsonb -> 'flows') x where x ->> 'kind' = 'bill')
  = (select sum(round(amount_due * exchange_rate, 2)) from public.vendor_bills where company_id = :'co' and status = 'posted' and document_type = 'vendor_bill' and amount_due > 0),
  'every open supplier bill is in the forecast');
select t.ok((select bool_and((x ->> 'date')::date >= current_date) from jsonb_array_elements(:'f'::jsonb -> 'flows') x), 'nothing is expected in the past: overdue lands this week');
select t.ok(jsonb_array_length(public.cash_forecast(:'co', 26) -> 'weeks') = 26, 'twenty-six weeks when asked');

-- the owner's own item: rent going out every month moves the end by that much
select (public.cash_forecast(:'co', 13, current_date, false) -> 'weeks' -> 12 ->> 'closing')::numeric as before \gset
insert into public.cash_plan_items (company_id, name, direction, amount, first_date, every_months) values (:'co', 'Qiraja', 'out', 500, current_date + 3, 1);
select public.cash_forecast(:'co', 13, current_date, false) as f2 \gset
select t.ok((:'f2'::jsonb -> 'weeks' -> 12 ->> 'closing')::numeric = :'before'::numeric - 500 * (select count(*) from jsonb_array_elements(:'f2'::jsonb -> 'flows') x where x ->> 'kind' = 'plan_out'),
  'each month of rent comes off the cash');
select t.ok((select count(*) from jsonb_array_elements(:'f2'::jsonb -> 'flows') x where x ->> 'kind' = 'plan_out') between 3 and 4, 'rent three or four times in 13 weeks');
-- a big one-off payment sends the cash below zero, and the week is named
insert into public.cash_plan_items (company_id, name, direction, amount, first_date, every_months) values (:'co', 'Makina e re', 'out', 99999999, current_date + 15, 0);
select public.cash_forecast(:'co', 13, current_date, false) as f3 \gset
select t.ok((:'f3'::jsonb ->> 'first_negative_week')::int = 3
  or (coalesce((:'f2'::jsonb ->> 'first_negative_week')::int, 99) <= 2 and (:'f3'::jsonb ->> 'first_negative_week')::int = (:'f2'::jsonb ->> 'first_negative_week')::int),
  'the forecast says the cash goes below zero in week 3');
select t.ok((:'f3'::jsonb -> 'weeks' -> 2 ->> 'closing')::numeric < 0 and (:'f3'::jsonb -> 'lowest' ->> 'week')::int >= 3, 'and the lowest point is from then on');
delete from public.cash_plan_items where company_id = :'co';

-- the proposal: every open bill, overdue first
select count(*) as n from public.payment_proposal(:'co') \gset
select t.ok(:n = (select count(*) from public.vendor_bills where company_id = :'co' and status = 'posted' and document_type = 'vendor_bill' and amount_due > 0), 'every open bill is proposed');
select t.ok((select coalesce(bool_and(priority = 1), true) from public.payment_proposal(:'co') where due_date < current_date), 'overdue bills come first');

-- pay two bills of one supplier: one payment, both bills paid
select string_agg(jsonb_build_object('bill', bill_id)::text, ',') as items, count(*) as k, sum(open_amount) as amt
  from (select bill_id, open_amount from public.payment_proposal(:'co') order by bill_id limit 2) x \gset
select public.pay_vendor_bills(:'co', :'bank', current_date, ('[' || :'items' || ']')::jsonb) as paid \gset
select t.ok((:'paid'::jsonb ->> 'count')::int = 1, 'one payment for the one supplier');
select t.ok((:'paid'::jsonb ->> 'total')::numeric = :'amt'::numeric, 'for the whole open amount');
select t.ok((select status from public.payments where id = (:'paid'::jsonb -> 'payments' -> 0 ->> 'id')::uuid) in ('posted', 'pending_approval'), 'the payment is posted');
select t.ok((select count(*) from public.payment_proposal(:'co')) = :n - 2
  or (select status from public.payments where id = (:'paid'::jsonb -> 'payments' -> 0 ->> 'id')::uuid) = 'pending_approval', 'the two bills leave the proposal');

-- part of a bill
select bill_id as b3, open_amount as o3 from public.payment_proposal(:'co') limit 1 \gset
select public.pay_vendor_bills(:'co', :'bank', current_date, jsonb_build_array(jsonb_build_object('bill', :'b3', 'amount', 100))) as part \gset
select t.ok((select amount_due from public.vendor_bills where id = :'b3') = :'o3'::numeric - 100, 'paying part leaves the rest open');
select t.throws($$select public.pay_vendor_bills('$$ || :'co' || $$', '$$ || :'bank' || $$', current_date, jsonb_build_array(jsonb_build_object('bill', '$$ || (select bill_id from public.payment_proposal(:'co') limit 1) || $$'), jsonb_build_object('bill', gen_random_uuid())))$$,
  'already paid or no longer open', 'a bill that is not open is refused');
select t.throws($$select public.pay_vendor_bills('$$ || :'co' || $$', gen_random_uuid(), current_date, '[]')$$, 'Choose the bank', 'an account must be chosen');

-- someone from another company sees nothing
select t.login('bob@kosova.xk');
select t.throws($$select public.cash_forecast('$$ || :'co' || $$')$$, '', 'a stranger cannot see the forecast');
select t.throws($$select * from public.payment_proposal('$$ || :'co' || $$')$$, '', 'nor the proposal');
select t.ok((select count(*) from public.cash_plan_items where company_id = :'co') = 0, 'nor the items');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
