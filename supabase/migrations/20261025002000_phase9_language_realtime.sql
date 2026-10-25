-- =============================================================================
-- DrisPRO · 2000 · Language and live updates (Phase 9)
--
-- * Shqip is the default language. profiles.locale is 'sq' or 'en'; people
--   who never chose a language get Shqip. Text is stored in English by the
--   database and translated in the app (src/i18n), so each person reads
--   notifications and messages in their own language.
-- * Live updates: more tables are published to Supabase Realtime, so lists
--   that people watch during the day (shipments and routes, leave requests,
--   attendance, web orders, fiscalization, POS sessions, cycle counts,
--   replenishment runs) refresh by themselves. RLS still decides who
--   receives which change.
-- =============================================================================

update public.profiles set locale = 'sq' where locale is null or locale not in ('sq', 'en');
-- nobody had a real choice before Phase 9 (the app was English only)
update public.profiles set locale = 'sq' where locale = 'en' and (preferences ->> 'locale_chosen') is null;
alter table public.profiles alter column locale set default 'sq';
alter table public.profiles drop constraint if exists profiles_locale_check;
alter table public.profiles add constraint profiles_locale_check check (locale in ('sq', 'en'));

-- the person choosing a language marks it as chosen, so a later default change never overrides it
create or replace function app.tg_profile_locale_chosen()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.locale is distinct from old.locale then
    new.preferences := coalesce(new.preferences, '{}'::jsonb) || jsonb_build_object('locale_chosen', true);
  end if;
  return new;
end $$;
drop trigger if exists trg_profile_locale_chosen on public.profiles;
create trigger trg_profile_locale_chosen before update of locale on public.profiles
  for each row execute function app.tg_profile_locale_chosen();

-- -----------------------------------------------------------------------------
-- Realtime
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array['shipments','delivery_routes','route_stops','leave_requests','attendance_records','channel_orders',
                             'fiscalization_records','pos_sessions','cycle_counts','replenishment_runs','payroll_runs',
                             'vat_declarations','sales_invoices','payments'] loop
      if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
    end loop;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Search without Albanian letters: "fature" finds "Faturë", "cmim" finds "Çmim".
-- app.fold lower-cases and maps ë → e, ç → c; global_search compares folded
-- text on both sides. The function body is rewritten in place so it stays
-- identical to the Phase 8 version apart from the comparison.
-- -----------------------------------------------------------------------------
create or replace function app.fold(p text) returns text language sql immutable parallel safe set search_path = '' as $$
  select translate(lower(p), 'ëçé', 'ece')
$$;
grant execute on function app.fold(text) to authenticated, service_role;

do $$
declare d text;
begin
  d := pg_get_functiondef('public.global_search(uuid, text, int)'::regprocedure);
  if position('app.fold' in d) > 0 then return; end if;
  d := replace(d, '|| ''%'' as pat)', '|| ''%'' as pat, app.fold(''%'' || replace(replace(btrim(p_query), ''%'', ''\%''), ''_'', ''\_'') || ''%'') as fpat)');
  d := regexp_replace(d, '([a-z]+\.[a-z_]+) ilike q\.pat', 'app.fold(\1) like q.fpat', 'g');
  execute d;
end $$;
