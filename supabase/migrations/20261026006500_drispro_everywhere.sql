-- =============================================================================
-- DrisPRO · the old name (NexusERP) leaves the database too
--   * the schema of the update bookkeeping and the copies is drispro_meta (setup-database.sh renames
--     it before the updates run; this covers a database put back from an older copy)
--   * every function that still names the old schema is rewritten
--   * the timed jobs are called drispro-…
-- =============================================================================
do $$
declare v_old text := 'nexus' || '_meta'; r record;
begin
  if exists (select 1 from pg_namespace where nspname = v_old) and not exists (select 1 from pg_namespace where nspname = 'drispro_meta') then
    execute format('alter schema %I rename to drispro_meta', v_old);
  end if;
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'app') and (case when p.prokind = 'f' then pg_get_functiondef(p.oid) end) like '%' || v_old || '.%' loop
    execute replace(pg_get_functiondef(r.oid), v_old || '.', 'drispro_meta.');
  end loop;
end $$;

do $$
declare j record; v_old text := 'nexus' || 'erp-';
begin
  if to_regclass('cron.job') is null then return; end if;
  for j in select jobid, jobname, schedule, command from cron.job where jobname like v_old || '%' loop
    perform cron.unschedule(j.jobid);
    perform cron.schedule('drispro-' || substr(j.jobname, length(v_old) + 1), j.schedule, j.command);
  end loop;
end $$;
