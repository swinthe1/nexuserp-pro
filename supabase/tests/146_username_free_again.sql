-- =============================================================================
-- A removed person's user name can be given again; a suspended person keeps theirs.
-- (after 145, on "Tatim Test" where alice is the owner)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Tatim Test' \gset

set role authenticated;
select t.login('alice@alba.al');
select public.company_user_create(:'co', 'Albert Bujupi', 'albert.bujupi', '482915', array['pos_cashier']) as mem \gset
select public.set_member_status(:'mem', 'suspended');
select t.throws(format($q$select public.company_user_create(%L, 'Albert Tjetër', 'albert.bujupi', '583926', array['pos_cashier'])$q$, :'co'),
  'is taken', 'a suspended person keeps their user name');
delete from public.company_members where id = :'mem';
select public.company_user_create(:'co', 'Albert Bujupi', 'albert.bujupi', '583926', array['pos_cashier']) as mem2 \gset
select t.ok(:'mem2' <> :'mem', 'the user name of a removed person is given again');
reset role;
select t.ok((select count(*) = 1 from app.user_logins where username = 'albert.bujupi'), 'and one person holds it');
\set QUIET off
select count(*) as assertions_passed from t.results;
