-- =============================================================================
-- DrisPRO · a licence is saved in one step
--   The licence window used to save the dates and status, then the package (or the extra modules) in a
--   second call. When the second was refused (a limit below the units or tills the client has), the
--   client was left on "package" with no modules. Now both happen together, or neither does.
-- =============================================================================
create or replace function public.platform_save_licence(p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare v_company uuid := (p ->> 'company')::uuid;
begin
  perform app.require_super_admin();
  perform public.platform_save_license(v_company, p ->> 'plan', (p ->> 'max_users')::int, (p ->> 'valid_from')::date, (p ->> 'valid_until')::date,
                                       p ->> 'status', nullif(p ->> 'notes', ''));
  if jsonb_typeof(p -> 'package') = 'object' then
    perform public.platform_set_package(v_company, jsonb_build_object('package', p -> 'package' ->> 'key', 'modules', coalesce(p -> 'package' -> 'modules', '[]'::jsonb),
      'max_users', p -> 'max_users', 'apply_type', coalesce((p -> 'package' ->> 'apply_type')::boolean, false))
      || case when p -> 'package' ? 'max_stores' then jsonb_build_object('max_stores', p -> 'package' -> 'max_stores') else '{}'::jsonb end
      || case when p -> 'package' ? 'max_tills' then jsonb_build_object('max_tills', p -> 'package' -> 'max_tills') else '{}'::jsonb end);
  elsif jsonb_typeof(p -> 'extra_features') = 'array' then
    perform public.platform_set_plan_extras(v_company, array(select jsonb_array_elements_text(p -> 'extra_features')), nullif(p ->> 'max_warehouses', '')::int);
  end if;
end $$;
revoke execute on function public.platform_save_licence(jsonb) from public, anon;
grant execute on function public.platform_save_licence(jsonb) to authenticated;

-- =============================================================================
-- the supplier's invoice for goods received without an order: its own number and date, asked for
-- (they go to the purchase VAT book; the receipt's number and date are not the invoice's)
-- =============================================================================
do $$
declare v_def text;
begin
  v_def := pg_get_functiondef('public.create_bill_from_receipt(uuid)'::regprocedure);
  v_def := replace(v_def, 'create_bill_from_receipt(p_receipt uuid)', 'create_bill_from_receipt(p_receipt uuid, p_number text DEFAULT NULL::text, p_date date DEFAULT NULL::date)');
  v_def := replace(v_def, $x$values (r.company_id, r.vendor_id, coalesce(nullif(r.vendor_delivery_note, ''), r.number), r.receipt_date, r.receipt_date + coalesce(v_days, 0),$x$,
                          $x$values (r.company_id, r.vendor_id, coalesce(nullif(btrim(p_number), ''), nullif(r.vendor_delivery_note, ''), r.number), coalesce(p_date, r.receipt_date),
          coalesce(p_date, r.receipt_date) + coalesce(v_days, 0),$x$);
  v_def := replace(v_def, $x$'Bill for ' || r.number)$x$, $x$'Fatura për fletëpranimin ' || r.number)$x$);
  if position('p_number' in v_def) = 0 or position('Fatura për' in v_def) = 0 then raise exception 'patch for create_bill_from_receipt does not apply'; end if;
  drop function public.create_bill_from_receipt(uuid);
  execute v_def;
end $$;
revoke execute on function public.create_bill_from_receipt(uuid, text, date) from public, anon;
grant execute on function public.create_bill_from_receipt(uuid, text, date) to authenticated;
