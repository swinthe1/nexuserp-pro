-- =============================================================================
-- DrisPRO · the platform console: overview, one client in full, the diary (runs after 01–49)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

reset role;
select email as boss from public.profiles where is_super_admin limit 1 \gset
select c.id as co, c.name as co_name from public.companies c join public.licenses l on l.company_id = c.id where c.deleted_at is null order by c.created_at limit 1 \gset
select email as plain from public.profiles p where not is_super_admin and exists (select 1 from public.company_members m where m.user_id = p.id) limit 1 \gset

set role authenticated;
select t.login(:'boss');
select public.platform_overview() as ov \gset
select t.ok((:'ov'::jsonb ->> 'clients')::int > 0, 'the overview counts the clients');
select t.ok(jsonb_typeof(:'ov'::jsonb -> 'attention') = 'array' and jsonb_array_length(:'ov'::jsonb -> 'new_by_month') = 12, 'with what needs attention and twelve months of new clients');

-- a licence change is written in the diary, with what changed
reset role;
select plan, max_users + 1 as mu, valid_from, valid_until, status from public.licenses where company_id = :'co' \gset l_
set role authenticated;
select t.login(:'boss');
select public.platform_save_license(:'co', :'l_plan', :'l_mu', :'l_valid_from', :'l_valid_until', :'l_status');
select public.platform_events(:'co', 5) as ev \gset
select t.ok((:'ev'::jsonb -> 0 ->> 'kind') = 'licence_changed' and (:'ev'::jsonb -> 0 -> 'details') ? 'max_users', 'the licence change is in the diary, with the users');
select t.ok((:'ev'::jsonb -> 0 ->> 'actor_email') = :'boss', 'and who made it');

select public.platform_client_detail(:'co') as d \gset
select t.ok((:'d'::jsonb -> 'company' ->> 'name') = :'co_name' and jsonb_typeof(:'d'::jsonb -> 'members') = 'array', 'one client in full: data and people');
select t.ok(jsonb_array_length(:'d'::jsonb -> 'usage' -> 'activity_by_day') = 30, 'and thirty days of activity');
select t.ok((:'d'::jsonb -> 'licence') ? 'backup_key' = false, 'the backup key is not shown');

select public.platform_log_visit(:'co');
select public.platform_log_visit(:'co');
reset role;
select t.ok((select count(*) from app.platform_events where kind = 'support_visit' and company_id = :'co') = 1, 'a visit is written once an hour');

set role authenticated;
select t.login(:'plain');
select t.throws('select public.platform_overview()', 'Super Admin|super admin|Only', 'only the Super Admin sees the overview');
select t.throws($$select public.platform_events()$$, 'Super Admin|super admin|Only', 'and the diary');

\set QUIET off
select count(*) as assertions_passed from t.results;
