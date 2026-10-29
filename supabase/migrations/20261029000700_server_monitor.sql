-- =============================================================================
-- The VPS itself in the console: every minute deploy/coolify/server-monitor.py (run
-- by cron on the server, installed by the server update) reports here:
--   * the machine: CPU, load, memory, swap, disks, network, uptime
--   * every Docker container: state, health, restarts, CPU, memory
--   * error and warning lines from the containers' logs (secrets hidden before they
--     leave the server), and the last lines of each container's log
--   * the website and the API answering, and their SSL certificate
-- Seven days are kept. Only the Super Admin reads it (platform_server_status).
-- =============================================================================
create schema if not exists drispro_meta;
revoke all on schema drispro_meta from public, anon, authenticated;

create table if not exists drispro_meta.server_samples (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  cpu_pct numeric(5,1), load1 numeric(7,2), load5 numeric(7,2), load15 numeric(7,2), cores int,
  mem_total bigint, mem_available bigint, swap_total bigint, swap_used bigint,
  net_rx bigint, net_tx bigint, uptime_s bigint,
  disks jsonb not null default '[]',
  checks jsonb not null default '[]',
  host jsonb not null default '{}'
);
create index if not exists server_samples_at on drispro_meta.server_samples (at desc);

create table if not exists drispro_meta.server_containers (
  name text primary key,
  at timestamptz not null default now(),
  image text, state text, status text, health text, restarts int, started_at timestamptz,
  cpu_pct numeric(6,1), mem_bytes bigint, mem_limit bigint, net_io text, block_io text
);

create table if not exists drispro_meta.server_logs (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  container text not null,
  level text not null default 'error',
  line text not null
);
create index if not exists server_logs_at on drispro_meta.server_logs (at desc);
create index if not exists server_logs_container on drispro_meta.server_logs (container, at desc);

create table if not exists drispro_meta.server_log_tail (
  container text primary key,
  at timestamptz not null default now(),
  lines text not null default ''
);

-- what the monitor sends (as the database owner, from inside the server)
create or replace function drispro_meta.server_report(p jsonb)
returns void language plpgsql set search_path = '' as $$
declare s jsonb := p -> 'sample'; c jsonb;
begin
  if s is not null then
    insert into drispro_meta.server_samples (cpu_pct, load1, load5, load15, cores, mem_total, mem_available, swap_total, swap_used, net_rx, net_tx, uptime_s, disks, checks, host)
    values ((s ->> 'cpu_pct')::numeric, (s ->> 'load1')::numeric, (s ->> 'load5')::numeric, (s ->> 'load15')::numeric, (s ->> 'cores')::int,
            (s ->> 'mem_total')::bigint, (s ->> 'mem_available')::bigint, (s ->> 'swap_total')::bigint, (s ->> 'swap_used')::bigint,
            (s ->> 'net_rx')::bigint, (s ->> 'net_tx')::bigint, (s ->> 'uptime_s')::bigint,
            coalesce(s -> 'disks', '[]'), coalesce(s -> 'checks', '[]'), coalesce(s -> 'host', '{}'));
  end if;
  if p ? 'containers' then
    delete from drispro_meta.server_containers where not (name = any (array(select x ->> 'name' from jsonb_array_elements(p -> 'containers') x)));
    for c in select * from jsonb_array_elements(p -> 'containers') loop
      insert into drispro_meta.server_containers as t (name, at, image, state, status, health, restarts, started_at, cpu_pct, mem_bytes, mem_limit, net_io, block_io)
      values (c ->> 'name', now(), c ->> 'image', c ->> 'state', c ->> 'status', nullif(c ->> 'health', ''), (c ->> 'restarts')::int,
              nullif(c ->> 'started_at', '')::timestamptz, (c ->> 'cpu_pct')::numeric, (c ->> 'mem_bytes')::bigint, (c ->> 'mem_limit')::bigint, c ->> 'net_io', c ->> 'block_io')
      on conflict (name) do update set at = now(), image = excluded.image, state = excluded.state, status = excluded.status, health = excluded.health,
        restarts = excluded.restarts, started_at = excluded.started_at, cpu_pct = excluded.cpu_pct, mem_bytes = excluded.mem_bytes,
        mem_limit = excluded.mem_limit, net_io = excluded.net_io, block_io = excluded.block_io;
    end loop;
  end if;
  if p ? 'logs' then
    insert into drispro_meta.server_logs (at, container, level, line)
    select coalesce(nullif(x ->> 'at', '')::timestamptz, now()), x ->> 'container', coalesce(x ->> 'level', 'error'), left(x ->> 'line', 2000)
      from jsonb_array_elements(p -> 'logs') x;
  end if;
  if p ? 'tails' then
    insert into drispro_meta.server_log_tail (container, at, lines)
    select x ->> 'container', now(), left(x ->> 'lines', 60000) from jsonb_array_elements(p -> 'tails') x
    on conflict (container) do update set at = now(), lines = excluded.lines;
    delete from drispro_meta.server_log_tail where at < now() - interval '1 day';
  end if;
  -- seven days are enough
  delete from drispro_meta.server_samples where at < now() - interval '7 days';
  delete from drispro_meta.server_logs where at < now() - interval '7 days';
end $$;
revoke execute on function drispro_meta.server_report(jsonb) from public, anon, authenticated;

-- everything the console's server page shows
create or replace function public.platform_server_status(p_hours integer default 24)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_last drispro_meta.server_samples; v_hours int := least(greatest(coalesce(p_hours, 24), 1), 168);
  v_bucket interval; v_db jsonb; v_alerts jsonb := '[]'; d jsonb; c record;
begin
  perform app.require_super_admin();
  select * into v_last from drispro_meta.server_samples order by at desc limit 1;
  v_bucket := make_interval(mins => greatest(1, (v_hours * 60) / 240));

  -- the database itself (read here, it needs no monitor)
  begin
    v_db := jsonb_build_object(
      'version', split_part(version(), ' on ', 1),
      'size', pg_database_size(current_database()),
      'connections', (select count(*) from pg_stat_activity where datname = current_database()),
      'active', (select count(*) from pg_stat_activity where datname = current_database() and state = 'active'),
      'idle_in_tx', (select count(*) from pg_stat_activity where datname = current_database() and state like 'idle in transaction%'),
      'max_connections', current_setting('max_connections')::int,
      'longest_s', (select coalesce(max(extract(epoch from now() - query_start)), 0)::int from pg_stat_activity
                     where datname = current_database() and state = 'active' and pid <> pg_backend_pid()),
      'cache_hit', (select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) from pg_stat_database where datname = current_database()),
      'deadlocks', (select deadlocks from pg_stat_database where datname = current_database()),
      'started_at', pg_postmaster_start_time(),
      'tables', (select coalesce(jsonb_agg(jsonb_build_object('name', relname, 'size', sz, 'rows', n_live_tup) order by sz desc), '[]'::jsonb) from (
          select s.relname, pg_total_relation_size(s.relid) sz, s.n_live_tup from pg_stat_user_tables s where s.schemaname = 'public'
           order by pg_total_relation_size(s.relid) desc limit 10) x));
  exception when others then v_db := jsonb_build_object('error', sqlerrm);
  end;

  -- what is wrong now
  if v_last.id is null or v_last.at < now() - interval '5 minutes' then
    v_alerts := v_alerts || jsonb_build_object('kind', 'monitor_quiet', 'at', v_last.at);
  else
    if (select avg(cpu_pct) from drispro_meta.server_samples where at > now() - interval '10 minutes') > 90 then
      v_alerts := v_alerts || jsonb_build_object('kind', 'cpu_high', 'value', (select round(avg(cpu_pct)) from drispro_meta.server_samples where at > now() - interval '10 minutes')); end if;
    if v_last.mem_total > 0 and v_last.mem_available::numeric / v_last.mem_total < 0.1 then
      v_alerts := v_alerts || jsonb_build_object('kind', 'mem_high', 'value', round(100 - 100.0 * v_last.mem_available / v_last.mem_total)); end if;
    for d in select * from jsonb_array_elements(v_last.disks) loop
      if (d ->> 'total')::numeric > 0 and (d ->> 'used')::numeric / (d ->> 'total')::numeric > 0.85 then
        v_alerts := v_alerts || jsonb_build_object('kind', 'disk_high', 'name', d ->> 'mount', 'value', round(100.0 * (d ->> 'used')::numeric / (d ->> 'total')::numeric)); end if;
    end loop;
    for d in select * from jsonb_array_elements(v_last.checks) loop
      if not coalesce((d ->> 'ok')::boolean, false) then v_alerts := v_alerts || jsonb_build_object('kind', 'check_failed', 'name', d ->> 'name', 'detail', d ->> 'error'); end if;
      if (d ->> 'cert_days')::int < 14 then v_alerts := v_alerts || jsonb_build_object('kind', 'cert_soon', 'name', d ->> 'name', 'value', (d ->> 'cert_days')::int); end if;
    end loop;
    for c in select * from drispro_meta.server_containers where state <> 'running' or health = 'unhealthy' loop
      v_alerts := v_alerts || jsonb_build_object('kind', case when c.state <> 'running' then 'container_down' else 'container_unhealthy' end, 'name', c.name, 'detail', c.status);
    end loop;
  end if;
  if (select count(*) from drispro_meta.server_logs where level = 'error' and at > now() - interval '1 hour') >= 20 then
    v_alerts := v_alerts || jsonb_build_object('kind', 'many_errors', 'value', (select count(*) from drispro_meta.server_logs where level = 'error' and at > now() - interval '1 hour'));
  end if;

  return jsonb_build_object(
    'last', case when v_last.id is null then null else to_jsonb(v_last) - 'id' end,
    'series', coalesce((select jsonb_agg(jsonb_build_object('at', b, 'cpu', cpu, 'mem', mem, 'load', ld, 'rx', rx, 'tx', tx) order by b) from (
        -- bytes a second: the counters' growth from one report to the next (a restart of the server starts them again: left out)
        select date_bin(v_bucket, at, timestamptz '2000-01-01') b, round(avg(cpu_pct), 1) cpu, round(avg(mem_pct), 1) mem, round(avg(load1), 2) ld,
               round(avg(rx_s) filter (where rx_s >= 0)) rx, round(avg(tx_s) filter (where tx_s >= 0)) tx
          from (select at, cpu_pct, load1, 100 - 100.0 * mem_available / nullif(mem_total, 0) mem_pct,
                       (net_rx - lag(net_rx) over w) / nullif(extract(epoch from at - lag(at) over w), 0) rx_s,
                       (net_tx - lag(net_tx) over w) / nullif(extract(epoch from at - lag(at) over w), 0) tx_s
                  from drispro_meta.server_samples where at > now() - make_interval(hours => v_hours) - interval '10 minutes'
                  window w as (order by at)) x
         where at > now() - make_interval(hours => v_hours)
         group by 1) y), '[]'::jsonb),
    'containers', coalesce((select jsonb_agg(to_jsonb(c2) order by (c2.state = 'running'), c2.name) from drispro_meta.server_containers c2), '[]'::jsonb),
    'errors', coalesce((select jsonb_agg(to_jsonb(l) order by l.at desc) from (
        select id, at, container, level, line from drispro_meta.server_logs where at > now() - make_interval(hours => v_hours) order by at desc limit 300) l), '[]'::jsonb),
    'error_counts', coalesce((select jsonb_object_agg(container, n) from (
        select container, count(*) n from drispro_meta.server_logs where level = 'error' and at > now() - make_interval(hours => v_hours) group by 1) x), '{}'::jsonb),
    'tails', coalesce((select jsonb_agg(jsonb_build_object('container', container, 'at', at) order by container) from drispro_meta.server_log_tail), '[]'::jsonb),
    'database', v_db,
    'alerts', v_alerts);
end $$;
revoke execute on function public.platform_server_status(integer) from public, anon;
grant execute on function public.platform_server_status(integer) to authenticated;

-- the last lines of one container's log
create or replace function public.platform_server_log(p_container text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform app.require_super_admin();
  return (select jsonb_build_object('container', container, 'at', at, 'lines', lines) from drispro_meta.server_log_tail where container = p_container);
end $$;
revoke execute on function public.platform_server_log(text) from public, anon;
grant execute on function public.platform_server_log(text) to authenticated;
