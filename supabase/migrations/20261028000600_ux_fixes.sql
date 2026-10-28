-- =============================================================================
-- Fixes found in the review of every page.
-- =============================================================================
create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

do $$ begin
  -- the profit tax counted no expenses when no account was set for the profit-tax expense
  -- ("is the profit-tax account" was unknown, and unknown threw every expense out)
  perform app._patch_function('app.cit_compute',
    $o$a.id = (select account_id from public.company_account_defaults where company_id = p_company and key = 'cit_expense') is_cit,$o$,
    $n$coalesce(a.id = (select account_id from public.company_account_defaults where company_id = p_company and key = 'cit_expense'), false) is_cit,$n$);
end $$;

drop function app._patch_function(text, text, text);
