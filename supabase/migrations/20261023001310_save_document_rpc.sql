-- =============================================================================
-- DrisPRO · 1310 · Atomic draft save for documents with lines
--
-- public.save_document(table, header, children) inserts or updates a document
-- header and REPLACES its child rows in one transaction. It runs as SECURITY
-- INVOKER, so every statement is checked by the caller's RLS policies and by
-- the draft-only line guards. System-managed columns (number, status, totals,
-- posting stamps, audit columns, generated columns) can never be written
-- through it.
-- =============================================================================

create table app.document_children (
  parent_table text not null,
  child_table  text not null,
  fk_column    text not null,
  primary key (parent_table, child_table)
);
insert into app.document_children values
  ('goods_receipts',    'goods_receipt_lines',    'receipt_id'),
  ('stock_adjustments', 'stock_adjustment_lines', 'adjustment_id'),
  ('stock_transfers',   'stock_transfer_lines',   'transfer_id'),
  ('landed_costs',      'landed_cost_charges',    'landed_cost_id'),
  ('landed_costs',      'landed_cost_receipts',   'landed_cost_id'),
  ('cycle_counts',      'cycle_count_lines',      'cycle_count_id'),
  ('purchase_orders',   'purchase_order_lines',   'purchase_order_id'),
  ('sales_orders',      'sales_order_lines',      'sales_order_id'),
  ('sales_quotes',      'sales_quote_lines',      'quote_id');
grant select on app.document_children to authenticated;

-- Columns a client may write on a table
create or replace function app.writable_columns(p_table text, p_keys text[])
returns text[] language sql stable set search_path = '' as $$
  select coalesce(array_agg(a.attname::text order by a.attnum), '{}')
    from pg_catalog.pg_attribute a
   where a.attrelid = ('public.' || quote_ident(p_table))::regclass
     and a.attnum > 0 and not a.attisdropped and a.attgenerated = ''
     and a.attname::text = any (p_keys)
     and a.attname::text not in (
       'id','number','status','created_at','created_by','updated_at','updated_by','deleted_at','deleted_by',
       'posted_at','journal_entry_id','total_value','total_amount','done_at','shipped_at','received_at',
       'subtotal','discount_total','tax_total','total','amount_paid','tax_rate','quantity_done',
       'landed_cost_amount','clearance_status','cleared_at','qty_received','qty_billed','qty_delivered',
       'qty_invoiced','qty_reserved','approved_at','confirmed_at','payment_status','invoice_status','billing_status')
$$;

create or replace function public.save_document(p_table text, p_header jsonb, p_children jsonb default '{}'::jsonb)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare
  v_id uuid := nullif(p_header ->> 'id', '')::uuid;
  v_company uuid;
  v_cols text[];
  v_list text;
  c record;
  v_rows jsonb;
  v_row jsonb;
begin
  if not exists (select 1 from app.document_children where parent_table = p_table) then
    raise exception 'save_document does not support %', p_table using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_children, '{}'::jsonb)) k
              where k not in (select child_table from app.document_children where parent_table = p_table)) then
    raise exception 'Unsupported child collection for %', p_table using errcode = '42501';
  end if;

  v_cols := app.writable_columns(p_table, array(select jsonb_object_keys(p_header)));
  if v_id is null then
    if not ('company_id' = any (v_cols)) then raise exception 'company_id is required' using errcode = '23502'; end if;
    v_list := (select string_agg(quote_ident(x), ', ') from unnest(v_cols) x);
    execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1) returning id, company_id',
                   p_table, v_list)
      into v_id, v_company using p_header;
  else
    v_cols := array_remove(v_cols, 'company_id');
    if cardinality(v_cols) > 0 then
      v_list := (select string_agg(quote_ident(x), ', ') from unnest(v_cols) x);
      execute format('update public.%1$I set (%2$s) = (select %2$s from jsonb_populate_record(null::public.%1$I, $1)) where id = $2',
                     p_table, v_list)
        using p_header, v_id;
    end if;
    execute format('select company_id from public.%I where id = $1', p_table) into v_company using v_id;
    if v_company is null then raise exception 'Document not found' using errcode = 'P0002'; end if;
  end if;

  for c in select * from app.document_children where parent_table = p_table and p_children ? child_table loop
    v_rows := p_children -> c.child_table;
    execute format('delete from public.%I where %I = $1', c.child_table, c.fk_column) using v_id;
    for v_row in select * from jsonb_array_elements(coalesce(v_rows, '[]'::jsonb)) loop
      v_row := (v_row - 'id') || jsonb_build_object('company_id', v_company, c.fk_column, v_id);
      v_cols := app.writable_columns(c.child_table, array(select jsonb_object_keys(v_row)));
      v_list := (select string_agg(quote_ident(x), ', ') from unnest(v_cols) x);
      execute format('insert into public.%1$I (%2$s) select %2$s from jsonb_populate_record(null::public.%1$I, $1)', c.child_table, v_list)
        using v_row;
    end loop;
  end loop;
  return v_id;
end $$;

revoke execute on function public.save_document from public, anon;
grant execute on function public.save_document to authenticated;

-- Lots are created by whoever receives goods: warehouse staff (wms.write), not only inventory managers
drop policy lots_insert on public.lots;
drop policy lots_update on public.lots;
create policy lots_insert on public.lots for insert to authenticated
  with check (company_id = any ((select app.company_ids_with('wms.write'))::uuid[])
           or company_id = any ((select app.company_ids_with('inventory.write'))::uuid[]));
create policy lots_update on public.lots for update to authenticated
  using (company_id = any ((select app.company_ids_with('wms.write'))::uuid[])
      or company_id = any ((select app.company_ids_with('inventory.write'))::uuid[]))
  with check (company_id = any ((select app.company_ids_with('wms.write'))::uuid[])
           or company_id = any ((select app.company_ids_with('inventory.write'))::uuid[]));
