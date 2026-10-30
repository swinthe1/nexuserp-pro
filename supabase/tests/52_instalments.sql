-- =============================================================================
-- DrisPRO · paying in instalments (runs after 51; uses "Tatim Kosova")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

reset role;
select id as co from public.companies where name = 'Tatim Kosova' \gset
select id as bank from public.bank_accounts where company_id = :'co' and account_kind = 'bank' limit 1 \gset
select b.id as bill, b.total, b.amount_due, b.bill_date from public.vendor_bills b
 where b.company_id = :'co' and b.status = 'posted' and b.document_type = 'vendor_bill' and b.amount_due > 0 order by b.amount_due desc limit 1 \gset

-- a term that splits the total: 40% now, 60% in 30 days; a wrong split is refused
set role authenticated;
select t.login('alice@alba.al');
insert into public.payment_terms (company_id, code, name, due_days, instalments)
values (:'co', 'K2', '40% tani, 60% pas 30 ditësh', 30, '[{"pct": 40, "days": 0}, {"pct": 60, "days": 30}]') returning id as term \gset
select t.throws($$insert into public.payment_terms (company_id, code, name, due_days, instalments) values ('$$ || :'co' || $$', 'BAD', 'Bad', 30, '[{"pct": 40, "days": 0}, {"pct": 50, "days": 30}]')$$,
  'instalments_ok', 'instalments that do not add up to 100% are refused');
select t.throws($$insert into public.payment_terms (company_id, code, name, due_days, instalments) values ('$$ || :'co' || $$', 'BAD2', 'Bad', 30, '[{"pct": 50, "days": 30}, {"pct": 50, "days": 0}]')$$,
  'instalments_ok', 'instalments must go forward in time');

-- the schedule made from the term
reset role;
update public.vendor_bills set payment_term_id = :'term' where id = :'bill';
select app.make_instalments(null, :'bill') as made \gset
select t.ok(:made = 2, 'two instalments from the term');
select t.ok((select sum(amount) from public.document_instalments where vendor_bill_id = :'bill') = :'total'::numeric, 'they add up to the total');
select t.ok((select amount from public.document_instalments where vendor_bill_id = :'bill' and seq = 1) = round(:'total'::numeric * 0.4, 2), 'the first is 40%');
select t.ok((select due_date from public.document_instalments where vendor_bill_id = :'bill' and seq = 2) = :'bill_date'::date + 30, 'the second is 30 days later');

-- by hand: the first part due already, the rest in 40 days
set role authenticated;
select t.login('alice@alba.al');
select t.throws($$select public.set_instalments('vendor_bill', '$$ || :'bill' || $$', '[{"due_date": "$$ || :'bill_date' || $$", "amount": 1}, {"due_date": "$$ || (:'bill_date'::date + 40) || $$", "amount": 1}]')$$,
  'add up to', 'a schedule that does not add up to the bill is refused');
select t.throws($$select public.set_instalments('vendor_bill', '$$ || :'bill' || $$', '[{"due_date": "$$ || (:'bill_date'::date - 5) || $$", "amount": $$ || (:'total'::numeric - 10) || $$}, {"due_date": "$$ || (:'bill_date'::date + 40) || $$", "amount": 10}]')$$,
  'before the document date', 'not due before the bill itself');
select public.set_instalments('vendor_bill', :'bill', jsonb_build_array(
  jsonb_build_object('due_date', :'bill_date', 'amount', :'total'::numeric - 100),
  jsonb_build_object('due_date', :'bill_date'::date + 40, 'amount', 100)));
select t.ok((select count(*) from public.document_instalment_list('vendor_bill', :'bill')) = 2, 'the schedule has two lines');
select t.ok((select sum(paid) from public.document_instalment_list('vendor_bill', :'bill')) = :'total'::numeric - :'amount_due'::numeric, 'what is paid sits on the instalments');
select t.ok((select open from public.document_instalment_list('vendor_bill', :'bill') where seq = 2) = 100, 'the oldest instalment is paid first; the last one is still whole');

-- the proposal proposes only what is due now; Debts put the last instalment in "not due"
select t.ok((select due_now from public.payment_proposal(:'co') where bill_id = :'bill') = :'amount_due'::numeric - 100, 'the proposal pays what is due now, not the later instalment');
select t.ok((select instalments from public.payment_proposal(:'co') where bill_id = :'bill') = 2, 'and says the bill is in instalments');
select t.ok((select not_due from public.partner_aging(:'co', 'ap') a join public.vendor_bills b on b.vendor_id = a.partner_id where b.id = :'bill') >= 100, 'the later instalment is not due yet in Debts');
select t.ok((select count(*) from jsonb_array_elements(public.cash_forecast(:'co') -> 'flows') f where f ->> 'ref' = :'bill') = 2, 'the forecast shows both instalments');

-- pay what is due now: the bill keeps only the last instalment
select public.pay_vendor_bills(:'co', :'bank', current_date, jsonb_build_array(jsonb_build_object('bill', :'bill', 'amount', :'amount_due'::numeric - 100)));
select t.ok((select count(*) from public.document_instalment_list('vendor_bill', :'bill') where open > 0) = 1, 'after paying, one instalment is left');
select t.ok((select count(*) from jsonb_array_elements(public.cash_forecast(:'co') -> 'flows') f where f ->> 'ref' = :'bill') = 1, 'and the forecast shows only it');

-- removing the schedule; strangers cannot touch it
select public.set_instalments('vendor_bill', :'bill', '[]');
select t.ok(not exists (select 1 from public.document_instalments where vendor_bill_id = :'bill'), 'an empty list removes the schedule');
select t.login('bob@kosova.xk');
select t.throws($$select public.set_instalments('vendor_bill', '$$ || :'bill' || $$', '[]')$$, '', 'someone from another company cannot change it');
select t.throws($$select * from public.document_instalment_list('vendor_bill', '$$ || :'bill' || $$')$$, '', 'nor read it');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
