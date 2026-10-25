-- =============================================================================
-- DrisPRO · the program's own name in what the server says (it was NexusERP)
-- =============================================================================
do $$
declare r record;
begin
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname in ('public', 'app') and (case when p.prokind = 'f' then pg_get_functiondef(p.oid) end) like '%your NexusERP supplier%' loop
    execute replace(pg_get_functiondef(r.oid), 'your NexusERP supplier', 'your DrisPRO supplier');
  end loop;
end $$;
