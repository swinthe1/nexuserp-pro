-- =============================================================================
-- Server monitor: Coolify's builder (moby/buildkit) runs only while an app is built; when it
-- stands still it is not a problem, whatever its restart setting says.
-- =============================================================================
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
    -- a container meant to run all the time that stopped, keeps restarting, or reports a problem;
    -- helpers that run once and stop (a bucket made, a build) are not problems
    for c in select * from drispro_meta.server_containers
              where (health = 'unhealthy' or state = 'restarting'
                 or (state <> 'running' and coalesce(restart_policy, '') in ('always', 'unless-stopped')))
                -- Coolify's builder runs only while it builds an app
                and not (state <> 'running' and (coalesce(image, '') like 'moby/buildkit%' or name like 'buildx_buildkit%'))
                 or (state <> 'running' and restart_policy = 'on-failure' and coalesce(exit_code, 0) <> 0) loop
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
    'containers', coalesce((select jsonb_agg(to_jsonb(c2) order by
        -- problems first, then the running ones, the helpers that finished last
        case when (c2.health = 'unhealthy' or c2.state = 'restarting' or (c2.state <> 'running' and coalesce(c2.restart_policy, '') in ('always', 'unless-stopped')))
                  and not (c2.state <> 'running' and (coalesce(c2.image, '') like 'moby/buildkit%' or c2.name like 'buildx_buildkit%')) then 0
             when c2.state = 'running' then 1 else 2 end, c2.name) from drispro_meta.server_containers c2), '[]'::jsonb),
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
