-- =============================================================================
-- DrisPRO · a customer's own discount from the old program
--   the importer (spreadsheet and live link) takes discount_pct: the customer's standing
--   discount in %, used on every sale to them (business_partners.default_discount_pct).
--   On an update it changes only when the column is sent, so a sheet without it keeps it.
-- =============================================================================

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('public.import_rows',
  $x$tax_number, email, phone, payment_term_id, credit_limit)$x$,
  $x$tax_number, email, phone, payment_term_id, credit_limit, default_discount_pct)$x$);
select app._patch_function('public.import_rows',
  $x$coalesce(nullif(r ->> 'credit_limit', '')::numeric, 0))
            returning id into v_id;$x$,
  $x$coalesce(nullif(r ->> 'credit_limit', '')::numeric, 0),
                    least(greatest(coalesce(nullif(r ->> 'discount_pct', '')::numeric, 0), 0), 100))
            returning id into v_id;$x$);
select app._patch_function('public.import_rows',
  $x$credit_limit = coalesce(nullif(r ->> 'credit_limit', '')::numeric, credit_limit)
             where id = v_id;$x$,
  $x$credit_limit = coalesce(nullif(r ->> 'credit_limit', '')::numeric, credit_limit),
                   default_discount_pct = case when r ? 'discount_pct' then least(greatest(coalesce(nullif(r ->> 'discount_pct', '')::numeric, 0), 0), 100) else default_discount_pct end
             where id = v_id;$x$);

drop function app._patch_function(text, text, text);
