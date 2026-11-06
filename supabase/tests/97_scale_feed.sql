-- =============================================================================
-- #8, all automatic through RLS1000: the service of the store computer reads what goes on its scale with a key
-- of its own, every minute; an error it meets shows on the scale page  (after 96 on "Kontrolle Test")
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as co from public.companies where name = 'Kontrolle Test' \gset
select email as boss from public.profiles where is_super_admin limit 1 \gset
select id as sc from public.scales where company_id = :'co' and name = 'Peshorja e frutave' \gset
select id as banp, ltrim(scale_plu, '0') as banplu from public.products where company_id = :'co' and name = 'Banane' \gset
set role authenticated;
select t.login(:'boss');
update public.scales set is_active = true where id = :'sc';
select public.scale_agent_key(:'sc', 'C:\RLS1000\rtplu_EN.txp') as key \gset
select t.ok(:'key' like 'drs\_%' and (select key_hash is not null and key_prefix = left(:'key', 10) from public.scales where id = :'sc'), 'a key of its own; only its hash is kept');

-- the service: no login, only the key (in the header, as the installer sends it)
reset role;
set role anon;
select set_config('request.headers', json_build_object('x-scale-key', :'key')::text, false);
select public.scale_feed(null, 'ARKA-1') as feed \gset
select t.ok((:'feed'::jsonb ->> 'active')::boolean and jsonb_array_length(:'feed'::jsonb -> 'items') >= 1, 'it gets the items of the scale');
select t.ok((select x ->> 'name' = 'BANANE' and (x ->> 'price')::numeric > 0 from jsonb_array_elements(:'feed'::jsonb -> 'items') x
             where x ->> 'plu' = :'banplu'), 'the name as the scale shows it, the price with VAT');
select t.throws('select public.scale_feed(''drs_wrong'')', 'Unknown scale key', 'a wrong key reads nothing');
select public.scale_feed_error(null, 'RLS1000 file not found');
select set_config('request.headers', '', false);
reset role;
set role authenticated;
select t.login(:'boss');
select t.ok((select last_error = 'RLS1000 file not found' and agent = 'ARKA-1' and last_sync_at is not null from public.scales where id = :'sc'), 'the scale page shows the computer, the last sync and the error');
select t.ok(jsonb_array_length(public.scale_pending(:'sc') -> 'upsert') = 0, 'what the service wrote counts as sent');
select public.scale_agent_key(:'sc') as key2 \gset
reset role;
set role anon;
select t.throws(format('select public.scale_feed(%L)', :'key'), 'Unknown scale key', 'a new key: the old one stops working');
reset role;

\set QUIET off
select count(*) as assertions_passed from t.results;
