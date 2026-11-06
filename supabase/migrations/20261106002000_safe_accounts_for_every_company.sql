-- =============================================================================
-- "Para rrugës për në bankë" (582) and "Tërheqjet e pronarit" (1095) were set only for the companies of
-- the day these accounts came, and later only when a safe was created; a company made since then found
-- them empty on the accounting setup page. Now every company with a chart has them, and a new chart
-- comes with them.
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('app.seed_finance_defaults',
  $x$code = '681'));
  end loop;$x$,
  $x$code = '681'));
  end loop;
  perform app.ensure_safe_accounts(p_company);$x$);

drop function app._patch_function(text, text, text);

select app.ensure_safe_accounts(id) from public.companies;
