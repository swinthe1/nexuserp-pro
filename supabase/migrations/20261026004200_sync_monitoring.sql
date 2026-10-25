-- =============================================================================
-- NexusERP Pro · watching the live link
--   * the agent streams its own log here (seen in the app, no remote desktop needed) and
--     sends a heartbeat even when nothing changed, so silence really means it stopped
--   * when an active link is silent for 10 minutes the company admins are told, and told
--     again when it comes back (checked every 5 minutes by pg_cron, and on every read)
-- =============================================================================

alter table public.sync_connections
  add column down_since    timestamptz,     -- set while the link is silent; cleared on the next contact
  add column agent_version text;
grant select (down_since, agent_version) on public.sync_connections to authenticated;

create table public.sync_agent_logs (
  id            bigint generated always as identity primary key,
  connection_id uuid not null references public.sync_connections(id) on delete cascade,
  company_id    uuid not null references public.companies(id) on delete cascade,
  at            timestamptz not null,
  level         text not null check (level in ('info', 'ok', 'warn', 'error')),
  msg           text not null
);
create index sync_agent_logs_conn_idx on public.sync_agent_logs (connection_id, at desc);
alter table public.sync_agent_logs enable row level security;
revoke all on public.sync_agent_logs from anon, authenticated;
-- read through sync_agent_log() only
create policy sync_agent_logs_no_direct on public.sync_agent_logs for select to authenticated using (false);

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- any contact after a silence closes the outage and tells the admins how long it lasted
select app._patch_function('app.sync_connection',
  $x$  update public.sync_connections set last_seen_at = now() where id = c.id;$x$,
  $x$  update public.sync_connections set last_seen_at = now(), down_since = null where id = c.id;
  if c.down_since is not null then
    perform app.notify_role(c.company_id, (select id from public.roles where key = 'company_admin'), 'system',
      'Live link back: ' || c.name,
      'The link with the old program is sending again after ' || greatest(1, round(extract(epoch from now() - c.down_since) / 60))::int || ' min of silence.',
      '/settings/migration');
  end if;$x$);
drop function app._patch_function(text, text, text);

-- the agent's log lines: [{at, level, msg}] (also a heartbeat when empty)
create or replace function public.sync_log(p_key text, p_items jsonb default '[]', p_version text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare c public.sync_connections; v_n int;
begin
  c := app.sync_connection(p_key);
  if jsonb_typeof(coalesce(p_items, '[]')) <> 'array' then raise exception 'Items must be a list' using errcode = '22023'; end if;
  insert into public.sync_agent_logs (connection_id, company_id, at, level, msg)
  select c.id, c.company_id, coalesce(nullif(x ->> 'at', '')::timestamptz, now()),
         case when x ->> 'level' in ('info', 'ok', 'warn', 'error') then x ->> 'level' else 'info' end,
         left(coalesce(x ->> 'msg', ''), 2000)
    from (select x from jsonb_array_elements(coalesce(p_items, '[]')) x limit 500) s
   where coalesce(x ->> 'msg', '') <> '';
  get diagnostics v_n = row_count;
  if nullif(btrim(coalesce(p_version, '')), '') is not null then
    update public.sync_connections set agent_version = left(btrim(p_version), 20) where id = c.id and agent_version is distinct from left(btrim(p_version), 20);
  end if;
  -- keep a week
  delete from public.sync_agent_logs where connection_id = c.id and at < now() - interval '7 days';
  return jsonb_build_object('ok', true, 'saved', v_n);
end $$;
revoke execute on function public.sync_log(text, jsonb, text) from public;
grant execute on function public.sync_log(text, jsonb, text) to anon, authenticated;

-- reading the log: the platform administrator, or the company's own admins
create or replace function public.sync_agent_log(p_connection uuid, p_level text default null, p_limit int default 300)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_co uuid;
begin
  select company_id into v_co from public.sync_connections where id = p_connection;
  if v_co is null then raise exception 'Connection not found' using errcode = 'P0002'; end if;
  if not app.is_super_admin() then perform app.require_permission(v_co, 'admin.read'); end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'at', l.at, 'level', l.level, 'msg', l.msg) order by l.at desc, l.id desc)
    from (select * from public.sync_agent_logs
           where connection_id = p_connection
             and (p_level is null or level = p_level or (p_level = 'problems' and level in ('warn', 'error')))
           order by at desc, id desc limit least(greatest(coalesce(p_limit, 300), 1), 2000)) l), '[]'::jsonb);
end $$;
revoke execute on function public.sync_agent_log(uuid, text, int) from public, anon;
grant execute on function public.sync_agent_log(uuid, text, int) to authenticated;

-- a silent link: told once, when it has been quiet for 10 minutes
create or replace function public.check_sync_health()
returns int language plpgsql security definer set search_path = '' as $$
declare c record; v_n int := 0;
begin
  for c in
    select * from public.sync_connections
     where is_active and down_since is null and last_seen_at is not null and last_seen_at < now() - interval '10 minutes'
     for update skip locked
  loop
    update public.sync_connections set down_since = c.last_seen_at where id = c.id;
    perform app.notify_role(c.company_id, (select id from public.roles where key = 'company_admin'), 'alert',
      'Live link stopped: ' || c.name,
      'Nothing has come from the old program since ' || to_char(c.last_seen_at at time zone coalesce((select timezone from public.companies where id = c.company_id), 'Europe/Tirane'), 'DD.MM.YYYY HH24:MI')
        || '. Check that the agent runs on the client''s server and that it has internet.',
      '/settings/migration');
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;
revoke execute on function public.check_sync_health() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('nexuserp-sync-health', '*/5 * * * *', 'select public.check_sync_health()');
  end if;
exception when others then
  raise notice 'pg_cron not available (%); schedule public.check_sync_health() every 5 minutes elsewhere', sqlerrm;
end $$;
