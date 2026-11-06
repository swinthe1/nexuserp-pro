-- =============================================================================
-- The management ledger: internal adjustments beside the statutory books, never instead of them
-- (on "Tatim Kosova", after 100)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Tatim Kosova' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as gen from public.journals where company_id = :'co' and code = 'GEN' \gset
select id as mgmt, code as mgmt_code from public.accounts where company_id = :'co' and is_management and deleted_at is null \gset
select id as exp from public.accounts where company_id = :'co' and account_type = 'expense' and is_postable and is_active and deleted_at is null order by code limit 1 \gset
select id as cash from public.accounts where company_id = :'co' and code = '531' and deleted_at is null \gset
select t.ok((select account_type = 'equity' from public.accounts where id = :'mgmt'), 'every company has the management adjustments account');
set role authenticated;
select t.login(:'boss');

select debit as stat_before from public.account_balances(:'co', date_trunc('year', current_date)::date, current_date) where account_id = :'exp' \gset

-- an internal adjustment: imputed rent for a unit, only for management
select public.save_document('journal_entries',
  jsonb_build_object('company_id', :'co', 'journal_id', :'gen', 'entry_date', current_date, 'memo', 'Qira e imputuar', 'reporting_ledger', 'MANAGEMENT'),
  jsonb_build_object('journal_lines', jsonb_build_array(
    jsonb_build_object('line_no', 1, 'account_id', :'exp', 'debit', 100, 'credit', 0),
    jsonb_build_object('line_no', 2, 'account_id', :'mgmt', 'debit', 0, 'credit', 100)))) as je \gset
update public.journal_entries set status = 'posted' where id = :'je';
select t.ok((select status = 'posted' and reporting_ledger = 'MANAGEMENT' from public.journal_entries where id = :'je'), 'a manual management adjustment is posted');
select t.ok((select debit from public.account_balances(:'co', date_trunc('year', current_date)::date, current_date) where account_id = :'exp') = :'stat_before'::numeric,
            'the statutory balances do not see it');
select t.ok((select debit from public.account_balances(:'co', date_trunc('year', current_date)::date, current_date, null, 'MANAGEMENT') where account_id = :'exp') = :'stat_before'::numeric + 100,
            'the management balances do');
select t.ok(not exists (select 1 from public.account_balances(:'co', date_trunc('year', current_date)::date, current_date) where account_id = :'mgmt'),
            'the management adjustments account is not in the statutory chart');
select t.ok(not exists (select 1 from public.view_statutory_ledger where entry_id = :'je') and exists (select 1 from public.view_management_ledger where entry_id = :'je'),
            'the two ledger views');

-- no real money in a management entry, no management account in the statutory books
select public.save_document('journal_entries',
  jsonb_build_object('company_id', :'co', 'journal_id', :'gen', 'entry_date', current_date, 'reporting_ledger', 'MANAGEMENT'),
  jsonb_build_object('journal_lines', jsonb_build_array(
    jsonb_build_object('line_no', 1, 'account_id', :'cash', 'debit', 50, 'credit', 0),
    jsonb_build_object('line_no', 2, 'account_id', :'mgmt', 'debit', 0, 'credit', 50)))) as je2 \gset
select t.throws(format($q$do $d$ begin update public.journal_entries set status = 'posted' where id = %L; set constraints all immediate; end $d$$q$, :'je2'), 'only income and expense accounts', 'a management entry cannot touch the cash');
select public.save_document('journal_entries',
  jsonb_build_object('company_id', :'co', 'journal_id', :'gen', 'entry_date', current_date),
  jsonb_build_object('journal_lines', jsonb_build_array(
    jsonb_build_object('line_no', 1, 'account_id', :'exp', 'debit', 50, 'credit', 0),
    jsonb_build_object('line_no', 2, 'account_id', :'mgmt', 'debit', 0, 'credit', 50)))) as je3 \gset
select t.throws(format($q$do $d$ begin update public.journal_entries set status = 'posted' where id = %L; set constraints all immediate; end $d$$q$, :'je3'), 'not used in the statutory books', 'the statutory books never use the management account');
select t.throws(format($q$update public.journal_entries set reporting_ledger = 'STATUTORY' where id = %L$q$, :'je'), 'immutable', 'a posted entry does not change ledger');

-- the reversal of a management entry stays in the management ledger
select public.reverse_journal_entry(:'je', current_date, null) as rev \gset
select t.ok((select reporting_ledger = 'MANAGEMENT' from public.journal_entries where id = :'rev'), 'its reversal stays in the management ledger');

-- entries made by documents are statutory, always
reset role;
select t.throws(format($q$insert into public.journal_entries (company_id, journal_id, entry_date, source_doc_type, source_doc_id, is_automatic, reporting_ledger)
                          values (%L, %L, current_date, 'sales_invoice', gen_random_uuid(), true, 'MANAGEMENT')$q$, :'co', :'gen'),
                'always go to the statutory books', 'an invoice''s entry cannot go to the management ledger');
select t.ok(not exists (select 1 from public.journal_entries where reporting_ledger = 'MANAGEMENT' and (is_automatic or source_doc_type is not null) and reversal_of_id is null),
            'no entry of a document is in the management ledger');

-- the views keep each company's books its own
set role authenticated;
select t.login('olga@drita.xk');
select t.ok(not exists (select 1 from public.view_management_ledger where company_id = :'co') and not exists (select 1 from public.view_statutory_ledger where company_id = :'co'),
            'another company''s user sees nothing of these books');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
