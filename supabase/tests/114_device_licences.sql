-- =============================================================================
-- A licence for every computer: every new computer waits for the Super Admin (since 163, also within
-- the client's limits and an older installation); the program checks its licence with its own key;
-- a blocked computer is told so.
-- (after 113: the Mini market "Mini Market Arbëri", 2 tills, 2 office computers)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on
reset role;
select set_config('request.jwt.claims', '', false);
select id as mini from public.companies where name = 'Mini Market Arbëri' \gset
update public.licenses set code = 'NXS-TEST-MINI-0001' where company_id = :'mini';
select max_registers as tills from public.licenses where company_id = :'mini' \gset
set role anon;
create function pg_temp.act(p_kind text, p_name text, p_extra jsonb default '{}') returns jsonb language sql as $$
  select public.device_activate('nxs-test-mini-0001', jsonb_build_object('kind', p_kind, 'name', p_name, 'hostname', 'PC-' || p_name,
    'secret', repeat(md5(p_name), 2), 'version', '1.8.0', 'platform', 'win32') || p_extra) $$;

-- 1. the tills: every one waits for the Super Admin, numbered; he approves two
select pg_temp.act('till', 'Arka 1') as a1 \gset
select pg_temp.act('till', 'Arka 2') as a2 \gset
select pg_temp.act('till', 'Arka 3') as a3 \gset
select t.ok(:'a1'::jsonb ->> 'status' = 'pending' and :'a2'::jsonb ->> 'status' = 'pending' and :'a1'::jsonb ->> 'label' = 'PC-0001', 'every new till waits for the Super Admin, numbered');
select t.ok(:'a3'::jsonb ->> 'status' = 'pending', 'the third till waits too');
reset role;
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_device_set((:'a1'::jsonb ->> 'id')::uuid, '{"status": "active"}');
select public.platform_device_set((:'a2'::jsonb ->> 'id')::uuid, '{"status": "active"}');
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
set role anon;

-- 2. the program checks its licence with its own key
select t.ok(public.device_ping((:'a1'::jsonb ->> 'id')::uuid, repeat(md5('Arka 1'), 2), '{"version": "1.8.1"}') ->> 'status' = 'active', 'the till checks its licence');
select t.ok(public.device_ping((:'a1'::jsonb ->> 'id')::uuid, 'wrong', '{}') ->> 'status' = 'unknown', 'with another key it learns nothing');
select t.throws($q$select public.device_activate('NXS-NONE-NONE-NONE', '{"kind": "till", "secret": "0123456789abcdef0123456789abcdef"}')$q$, 'not known', 'an unknown code activates nothing');
select t.throws(format($q$select public.device_activate('NXS-TEST-MINI-0001', jsonb_build_object('kind', 'till', 'device_id', %L, 'secret', repeat('x', 40)))$q$, :'a1'::jsonb ->> 'id'),
  'another key', 'a computer cannot be taken over with another key');

-- 3. an office computer; an older installation registers itself approved even beyond the limits
select pg_temp.act('office', 'Zyra') as o1 \gset
select pg_temp.act('till', 'Arka e vjetër', '{"migrated": true}') as old \gset
select t.ok(:'o1'::jsonb ->> 'status' = 'pending' and :'o1'::jsonb ->> 'kind' = 'office', 'the office computer waits too');
select t.ok(:'old'::jsonb ->> 'status' = 'pending' and (:'old'::jsonb ->> 'migrated')::boolean, 'one that says it was there before waits too');
reset role;
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_device_set((:'o1'::jsonb ->> 'id')::uuid, '{"status": "active"}');
select public.platform_device_set((:'old'::jsonb ->> 'id')::uuid, '{"status": "active"}');
reset role;
select set_config('request.jwt.claims', '', false), set_config('request.jwt.claim.sub', '', false);
set role anon;

-- 4. the Super Admin approves the waiting till, blocks another; the program learns it
reset role;
set role authenticated;
select t.login('zoe@platform.io');
select t.ok((public.platform_devices(:'mini') -> 'devices' -> 0 ->> 'status') = 'pending', 'the waiting computer comes first in the console');
select public.platform_device_set((:'a3'::jsonb ->> 'id')::uuid, '{"status": "active"}');
select public.platform_device_set((:'a2'::jsonb ->> 'id')::uuid, '{"status": "blocked"}');
reset role;
set role anon;
select t.ok(public.device_ping((:'a3'::jsonb ->> 'id')::uuid, repeat(md5('Arka 3'), 2)) ->> 'status' = 'active', 'approved: the third till opens');
select t.ok(public.device_ping((:'a2'::jsonb ->> 'id')::uuid, repeat(md5('Arka 2'), 2)) ->> 'status' = 'blocked', 'blocked: the till is told');

-- 5. every computer waits when the Super Admin asks for it; a client cannot see or change computers
reset role;
set role authenticated;
select t.login('zoe@platform.io');
select public.platform_device_limits(:'mini', '{"approval": "request"}');
reset role;
set role anon;
select t.ok(pg_temp.act('office', 'Zyra 2') ->> 'status' = 'pending', 'with approval asked, an office computer waits too');
reset role;
set role authenticated;
select t.login('pronari@arberi.xk');
select t.throws($q$select public.platform_devices()$q$, 'platform administrator', 'the client does not see the console''s computers');
reset role;
select t.ok((select count(*) from app.platform_events where company_id = :'mini' and kind in ('device_activated', 'device_requested', 'device_approved', 'device_blocked')) >= 6,
  'every computer is in the diary');

\set QUIET off
select count(*) as assertions_passed from t.results;
