-- =============================================================================
-- "Paratë e pronarit": the owner pays a supplier from his own pocket; the company owes it to him (455),
-- the cash box and the bank do not move, and the money views leave it out.  (on "Tatim Kosova", after 51)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Tatim Kosova' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as acc455 from public.accounts where company_id = :'co' and code = '455' and deleted_at is null \gset
select id as acc531 from public.accounts where company_id = :'co' and code = '531' and deleted_at is null \gset
select id as gen from public.journals where company_id = :'co' and code = 'GEN' \gset
select t.ok((select account_type = 'liability' from public.accounts where id = :'acc455'), 'every company has the owner''s current account (455)');
set role authenticated;
select t.login(:'boss');

select t.throws(format($q$insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id) values (%L, 'Pronari', 'owner', 'EUR', %L)$q$, :'co', :'acc531'),
                'not to a cash or bank account', 'the owner''s money is not booked to the cash box');
insert into public.bank_accounts (company_id, name, account_kind, currency_code, account_id, journal_id)
values (:'co', 'Paratë e pronarit', 'owner', 'EUR', :'acc455', :'gen') returning id as own \gset

select bill_id as bill from public.payment_proposal(:'co') order by bill_id limit 1 \gset
select public.pay_vendor_bills(:'co', :'own', current_date, jsonb_build_array(jsonb_build_object('bill', :'bill', 'amount', 10))) as paid \gset
select id as pay, method, journal_entry_id as je from public.payments where bank_account_id = :'own' order by created_at desc limit 1 \gset
select t.ok(:'method' = 'other', 'paid by the owner: neither the company''s cash nor its transfer');
select t.ok((select credit = 10 from public.journal_lines where entry_id = :'je' and account_id = :'acc455'), 'the company owes it to the owner (credit 455)');
select t.ok(not exists (select 1 from public.journal_lines jl join public.accounts a on a.id = jl.account_id
                         where jl.entry_id = :'je' and a.account_subtype in ('cash', 'bank')), 'the cash box and the bank do not move');
select t.ok(not exists (select 1 from jsonb_array_elements(public.cash_accounts(:'co')) x where x ->> 'id' = :'own'), 'it is not in the cash book');
select t.ok(not exists (select 1 from jsonb_array_elements(public.bank_position(:'co', current_date) -> 'accounts') x where x ->> 'id' = :'own'), 'nor in the money of the company');

\set QUIET off
select count(*) as assertions_passed from t.results;
