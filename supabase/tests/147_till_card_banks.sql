-- =============================================================================
-- A card payment at the till names the bank whose terminal took it: the till gets the company's banks by name,
-- and someone outside the company gets nothing. (after 146: Mini Market Arbëri)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as mini from public.companies where name = 'Mini Market Arbëri' \gset
select id as reg from public.pos_registers where company_id = :'mini' and deleted_at is null order by created_at limit 1 \gset
select count(distinct coalesce(nullif(btrim(bank_name), ''), name)) as banks from public.bank_accounts
 where company_id = :'mini' and account_kind = 'bank' and is_active and deleted_at is null \gset

set role authenticated;
select t.login('pronari@arberi.xk');
select t.ok(jsonb_typeof(public.till_card_banks(:'reg')) = 'array' and jsonb_array_length(public.till_card_banks(:'reg')) = :banks,
  'the till gets the banks of the company, each once, and no cash drawer among them');
reset role;
select u.email as outsider from auth.users u
 where not exists (select 1 from public.company_members m where m.user_id = u.id and m.company_id = :'mini' and m.status = 'active')
   and not coalesce((select p.is_super_admin from public.profiles p where p.id = u.id), false)
 limit 1 \gset
set role authenticated;
select t.login(:'outsider');
select t.throws(format('select public.till_card_banks(%L)', :'reg'), '', 'someone outside the company gets no banks');
reset role;
\set QUIET off
select count(*) as assertions_passed from t.results;
