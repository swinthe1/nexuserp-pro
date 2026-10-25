-- =============================================================================
-- DrisPRO · the agents send "" for a missing number; treat it as no value
-- ("invalid input syntax for type numeric" on receipts with no tax or paid amount)
-- =============================================================================

create or replace function app.jsonb_blank_to_null(j jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select case jsonb_typeof(j)
    when 'object' then (select coalesce(jsonb_object_agg(e.k, app.jsonb_blank_to_null(e.v)), '{}'::jsonb)
                          from jsonb_each(j) as e(k, v) where e.v <> '""'::jsonb)
    when 'array' then (select coalesce(jsonb_agg(app.jsonb_blank_to_null(a.v) order by a.o), '[]'::jsonb)
                         from jsonb_array_elements(j) with ordinality as a(v, o))
    else j end
$$;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('public.sync_history',
  $x$  perform set_config('request.jwt.claim.sub', c.run_as::text, true);$x$,
  $x$  perform set_config('request.jwt.claim.sub', c.run_as::text, true);
  p_rows := app.jsonb_blank_to_null(p_rows);$x$);

drop function app._patch_function(text, text, text);
