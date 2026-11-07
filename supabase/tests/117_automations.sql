-- =============================================================================
-- The work the program does by itself, once a day and once an hour per company: expired quotes, follow-up
-- tasks, the supplier's invoice asked for, the next financial year, appointments that nobody came to.
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);

-- two quotes of one company: one sent long ago and past its validity, one sent four days ago and still valid
select q.company_id as qco, q.partner_id as qp, q.currency_code as qcur from public.sales_quotes q where q.deleted_at is null and q.status = 'draft' order by q.created_at limit 1 \gset
insert into public.sales_quotes (company_id, number, partner_id, currency_code, quote_date, valid_until)
values (:'qco', 'T-AUTO-1', :'qp', :'qcur', current_date - 20, current_date - 2) returning id as quote \gset
insert into public.sales_quotes (company_id, number, partner_id, currency_code, quote_date, valid_until)
values (:'qco', 'T-AUTO-2', :'qp', :'qcur', current_date - 4, current_date + 10) returning id as quote2 \gset
update public.sales_quotes set status = 'sent' where id in (:'quote', :'quote2');

select app.automations_daily(:'qco') as r \gset
select t.ok((select status from public.sales_quotes where id = :'quote') = 'expired', 'a sent quote past its validity becomes expired');
select t.ok(exists (select 1 from public.tasks where company_id = :'qco' and auto_key = 'quote_follow:' || :'quote2'), 'a quote sent days ago gets a call-the-customer task');
select app.automations_daily(:'qco') as r2 \gset
select t.ok((select count(*) from public.tasks where company_id = :'qco' and auto_key = 'quote_follow:' || :'quote2') = 1, 'run again, the task is not made twice');

-- the worker's tick runs them
select t.ok(position('automations_daily' in pg_get_functiondef('public.automation_tick'::regproc)) > 0
        and position('automations_hourly' in pg_get_functiondef('public.automation_tick'::regproc)) > 0, 'the tick runs the daily and hourly work');
select t.ok((app.automations_hourly(:'qco')) ? 'orders_reserved', 'the hourly work runs');

select t.ok(app.automations_daily_more(:'qco') ?& array['approval_tasks', 'open_clock_ins', 'rooms_to_clean', 'desk_tasks', 'renewal_mails'], 'the other daily work runs');
select t.ok(position('status = ''sent''' in pg_get_functiondef('app.tg_po_email'::regproc)) > 0, 'an order e-mailed to the supplier is marked sent');

\set QUIET off
select count(*) as assertions_passed from t.results;
