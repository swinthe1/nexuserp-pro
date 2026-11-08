-- =============================================================================
-- The till hears at once when an item, a price or the stock changes, and can ask whether the server
-- is there. (after 122, on "Kontrolle Test", which has tills)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select p.id as prod from public.products p where p.company_id = :'co' and p.deleted_at is null order by p.created_at limit 1 \gset

-- 1. a price change touches the company's pulse
delete from public.pos_catalog_pulse where company_id = :'co';
update public.products set sales_price = sales_price + 0.01 where id = :'prod';
select t.ok(exists (select 1 from public.pos_catalog_pulse where company_id = :'co'), 'a new price wakes the tills of the company');

-- 2. busy tills: within 2 seconds the pulse is not touched again (no queue on one row)
update public.pos_catalog_pulse set changed_at = now() - interval '1 second' where company_id = :'co';
select changed_at as before from public.pos_catalog_pulse where company_id = :'co' \gset
update public.products set sales_price = sales_price - 0.01 where id = :'prod';
select t.ok((select changed_at from public.pos_catalog_pulse where company_id = :'co') = :'before'::timestamptz, 'a second change right after does not touch it again');
update public.pos_catalog_pulse set changed_at = now() - interval '1 minute' where company_id = :'co';
update public.stock_levels set updated_at = now() where id = (select id from public.stock_levels where company_id = :'co' limit 1);
select t.ok((select changed_at > now() - interval '5 seconds' from public.pos_catalog_pulse where company_id = :'co'), 'a stock change wakes them too');

-- 3. only the company's own people read it, and they may ask whether the server is there
set role authenticated;
select t.login('zoe@platform.io');
select t.ok(public.pos_ping() = 1, 'the till asks whether the server is there');
reset role;
select t.ok(not has_function_privilege('anon', 'public.pos_ping()', 'execute'), 'not without signing in');
select t.ok(exists (select 1 from pg_policies where tablename = 'pos_catalog_pulse' and qual like '%pos.read%'), 'the pulse is read only with the till right');

\set QUIET off
select count(*) as assertions_passed from t.results;
