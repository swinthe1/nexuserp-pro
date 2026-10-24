-- =============================================================================
-- NexusERP Pro · Phase 9 tests: language preference and live updates (runs after 01–11)
-- =============================================================================
\set QUIET on
\set ON_ERROR_STOP on

insert into auth.users (email, raw_user_meta_data) values ('lena@lang.al', '{"full_name":"Lena Language"}');
select t.ok((select locale from public.profiles where email = 'lena@lang.al') = 'sq', 'new people get Shqip by default');

set role authenticated;
select t.login('lena@lang.al');
update public.profiles set locale = 'en' where id = auth.uid();
select t.ok((select locale from public.profiles where id = auth.uid()) = 'en', 'a person can switch to English');
select t.ok((select (preferences ->> 'locale_chosen')::boolean from public.profiles where id = auth.uid()), 'the choice is remembered as deliberate');
select t.throws($$ update public.profiles set locale = 'de' where id = auth.uid() $$, 'profiles_locale_check', 'only Shqip and English are allowed');
-- nobody changes someone else's language
select t.login('alice@alba.al');
update public.profiles set locale = 'sq' where email = 'lena@lang.al';
reset role;
select t.ok((select locale from public.profiles where email = 'lena@lang.al') = 'en', 'others cannot change a person''s language');

-- live updates: when the realtime publication exists, the day-to-day tables are in it
select t.ok(not exists (select 1 from pg_publication where pubname = 'supabase_realtime')
            or (select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and tablename in
                ('shipments','delivery_routes','route_stops','leave_requests','attendance_records','channel_orders','fiscalization_records',
                 'pos_sessions','cycle_counts','replenishment_runs','payroll_runs','vat_declarations','sales_invoices','payments')) = 14,
            'live-update tables are published');

\set QUIET off
select count(*) as assertions_passed from t.results;
