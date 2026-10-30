-- =============================================================================
-- DrisPRO · training: a person marks lessons; the owner sees who finished what
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Tatim Kosova' \gset
select id as alice from auth.users where email = 'alice@alba.al' \gset
set role authenticated;
select t.login('alice@alba.al');
select public.training_mark(:'co', 'sales.invoice');
select public.training_mark(:'co', 'sales.invoice');
select public.training_mark(:'co', 'sales.debts');
select t.ok((select count(*) from public.training_progress where user_id = :'alice' and company_id = :'co') = 2, 'two lessons done, marking twice counts once');
select public.training_mark(:'co', 'sales.debts', false);
select t.ok((select count(*) from public.training_progress where user_id = :'alice' and company_id = :'co') = 1, 'a lesson can be unmarked');
select t.ok((select lessons from public.training_overview(:'co') where user_id = :'alice') = array['sales.invoice'], 'the owner sees what each person finished');
select t.login('mira@lider.xk');
select t.throws($$select public.training_mark('$$ || :'co' || $$', 'x')$$, 'Not a member', 'someone outside the company cannot mark lessons there');
select t.throws($$select * from public.training_overview('$$ || :'co' || $$')$$, '', 'nor see who is trained');
select t.ok((select count(*) from public.training_progress where company_id = :'co') = 0, 'nor read the progress');
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
