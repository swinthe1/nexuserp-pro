-- =============================================================================
-- NexusERP Pro · work done without internet, sent later
--   public.offline_call(op, fn, args): one step from a device's outbox. Each step has its own id
--   (op); a step that arrives twice gives back the first answer and is not done again.
--   A document made offline is known on the device by the id of the step that created it; later
--   steps that use that id (save it again, post it) are pointed at the real document.
--   Only these steps can wait: saving a goods receipt, a sales quote, order or invoice as a draft,
--   posting a goods receipt, and counting an item in a stock count.
--
--   public.scan_catalog(company): every active item with its barcodes and lots, compact, so a
--   device can recognise what is scanned without internet.
-- =============================================================================

create table app.offline_ops (
  id          uuid primary key,
  user_id     uuid not null,
  fn          text not null,
  result      jsonb,
  created_at  timestamptz not null default now()
);
create index offline_ops_user_idx on app.offline_ops (user_id, created_at);

-- the first answer to a step already done by this person
create or replace function app.offline_op_result(p_op uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('result', o.result) from app.offline_ops o where o.id = p_op and o.user_id = auth.uid()
$$;
create or replace function app.offline_op_save(p_op uuid, p_fn text, p_result jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into app.offline_ops (id, user_id, fn, result) values (p_op, auth.uid(), p_fn, p_result) on conflict (id) do nothing
$$;
-- ids the device made up (the step that created a document) → the document's real id
create or replace function app.offline_map_ids(p_args jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_text text := p_args::text; r record;
begin
  for r in
    select o.id::text as tmp, coalesce(case when jsonb_typeof(o.result) = 'string' then o.result #>> '{}' end, o.result ->> 'id') as real
      from app.offline_ops o
     where o.user_id = auth.uid()
       and o.id::text in (select m[1] from regexp_matches(v_text, '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})', 'g') m)
  loop
    if r.real is not null then v_text := replace(v_text, r.tmp, r.real); end if;
  end loop;
  return v_text::jsonb;
end $$;
revoke execute on function app.offline_op_result(uuid), app.offline_op_save(uuid, text, jsonb), app.offline_map_ids(jsonb) from public, anon;
grant execute on function app.offline_op_result(uuid), app.offline_op_save(uuid, text, jsonb), app.offline_map_ids(jsonb) to authenticated;

-- runs as the person (their permissions apply to the step itself)
create or replace function public.offline_call(p_op uuid, p_fn text, p_args jsonb)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_prev jsonb; v_args jsonb; v_list text; v_res jsonb;
begin
  if p_op is null then raise exception 'The step needs its id' using errcode = '23502'; end if;
  if p_fn not in ('save_document', 'post_goods_receipt', 'count_item') then
    raise exception 'This cannot be done without internet: %', p_fn using errcode = '42501';
  end if;
  if p_fn = 'save_document' and coalesce(p_args ->> 'p_table', '') not in ('goods_receipts', 'sales_quotes', 'sales_orders', 'sales_invoices') then
    raise exception 'This cannot be done without internet: %', p_args ->> 'p_table' using errcode = '42501';
  end if;
  v_prev := app.offline_op_result(p_op);
  if v_prev is not null then return v_prev -> 'result'; end if;

  v_args := app.offline_map_ids(coalesce(p_args, '{}'::jsonb));
  -- named arguments, each cast to the type the function takes
  select string_agg(format('%I => %s', a.name,
           case when a.typ = 'jsonb'::regtype then format('$1 -> %L', a.name)
                when a.typ = 'json'::regtype then format('($1 -> %L)::json', a.name)
                when format_type(a.typ, null) like '%[]' then format('array(select jsonb_array_elements_text($1 -> %L))::%s', a.name, format_type(a.typ, null))
                else format('($1 ->> %L)::%s', a.name, format_type(a.typ, null)) end), ', ' order by a.ord)
    into v_list
    from (select x.name, x.typ, x.ord
            from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                 unnest(p.proargnames[1:p.pronargs], p.proargtypes::oid[]) with ordinality as x(name, typ, ord)
           where n.nspname = 'public' and p.proname = p_fn) a
   where v_args ? a.name;
  execute format('select to_jsonb(public.%I(%s))', p_fn, coalesce(v_list, '')) into v_res using v_args;
  perform app.offline_op_save(p_op, p_fn, coalesce(v_res, 'null'::jsonb));
  return v_res;
end $$;
revoke execute on function public.offline_call(uuid, text, jsonb) from public, anon;
grant execute on function public.offline_call(uuid, text, jsonb) to authenticated;

-- what a device needs to recognise a scan offline: [{v, p, s, n, t, b: [[barcode, qty]...]}], and lots [{id, v, l, e}]
create or replace function public.scan_catalog(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (p_company = any (app.my_company_ids())) then raise exception 'Not allowed' using errcode = '42501'; end if;
  return jsonb_build_object(
    'at', now(),
    'items', coalesce((select jsonb_agg(jsonb_build_array(v.id, v.product_id, v.sku, v.name, p.tracking,
                               coalesce((select jsonb_agg(jsonb_build_array(b.barcode, b.quantity)) from public.product_barcodes b
                                          where b.variant_id = v.id and b.deleted_at is null), '[]'::jsonb),
                               coalesce(v.sales_price_override, p.sales_price), v.standard_cost))
                        from public.product_variants v join public.products p on p.id = v.product_id and p.deleted_at is null
                       where v.company_id = p_company and v.deleted_at is null and v.is_active), '[]'::jsonb),
    'lots', coalesce((select jsonb_agg(jsonb_build_array(l.id, l.variant_id, l.lot_number, l.expiry_date))
                       from public.lots l where l.company_id = p_company and l.deleted_at is null
                        and (l.expiry_date is null or l.expiry_date > current_date - 365)), '[]'::jsonb));
end $$;
revoke execute on function public.scan_catalog(uuid) from public, anon;
grant execute on function public.scan_catalog(uuid) to authenticated;
