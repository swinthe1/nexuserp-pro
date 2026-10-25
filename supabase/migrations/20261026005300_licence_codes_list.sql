-- =============================================================================
-- DrisPRO · every licence has its code from the start, and the client list shows it
-- =============================================================================
update public.licenses set code = app.new_licence_code() where code is null;
alter table public.licenses alter column code set default app.new_licence_code();

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;
select app._patch_function('public.platform_clients',
  $x$'plan', l.plan, 'max_users', l.max_users,$x$,
  $x$'plan', l.plan, 'licence_code', l.code, 'deployment', l.deployment, 'local_seen_at', l.local_seen_at, 'max_users', l.max_users,$x$);
drop function app._patch_function(text, text, text);
