-- =============================================================================
-- NexusERP Pro · till sales that Logmicro writes only as stock exits ('FD'), with their value,
-- so today's sales per store count every till, not only the ones that write receipts
-- =============================================================================

create table public.sync_till_sales (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references public.companies(id),
  ext_id       text not null,
  warehouse_id uuid not null,
  variant_id   uuid not null,
  sold_at      timestamptz not null,
  quantity     numeric(18,4) not null,          -- sold (a return is negative)
  amount       numeric(18,2) not null,          -- at the sales price with VAT
  reference    text,
  foreign key (company_id, warehouse_id) references public.warehouses(company_id, id),
  foreign key (company_id, variant_id) references public.product_variants(company_id, id),
  unique (company_id, ext_id)
);
select app.register_table('public.sync_till_sales', 'invoicing', p_soft_delete => false, p_client_write => false, p_audit => false);
create index sync_till_sales_day_idx on public.sync_till_sales (company_id, sold_at, warehouse_id);

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_oid oid; v_def text;
begin
  select p.oid into strict v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname || '.' || p.proname = p_name;
  v_def := pg_get_functiondef(v_oid);
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply: %', p_name, p_old; end if;
  execute replace(v_def, p_old, p_new);
end $$;

select app._patch_function('app.sync_movements',
  $x$    perform set_config('app.external_ref', '', true);
    v_done := v_done + 1;$x$,
  $x$    perform set_config('app.external_ref', '', true);
    if v_type = 'FD' then
      insert into public.sync_till_sales (company_id, ext_id, warehouse_id, variant_id, sold_at, quantity, amount, reference)
      select p_company, r ->> 'ext_id', wl.warehouse_id, v_variant, v_at, -v_qty,
             round(-v_qty * coalesce(v.sales_price_override, p.sales_price) * (1 + coalesce(tc.rate, 0) / 100), 2), nullif(btrim(r ->> 'reference'), '')
        from public.warehouse_locations wl, public.product_variants v
        join public.products p on p.id = v.product_id
        left join public.tax_codes tc on tc.id = p.sales_tax_code_id
       where wl.id = v_loc and v.id = v_variant
      on conflict (company_id, ext_id) do nothing;
    end if;
    v_done := v_done + 1;$x$);

drop function app._patch_function(text, text, text);

-- today's and this month's sales: receipts from the old program, and for a store whose tills
-- write only stock exits, those exits at their sales price. A store that writes both is counted once
-- (the larger of the two, as receipts and exits describe the same sales).
drop function if exists public.history_live(uuid, date);
create or replace function public.history_live(p_company uuid, p_today date default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_tz text := coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'); v_month date;
begin
  p_today := coalesce(p_today, (now() at time zone v_tz)::date);
  v_month := date_trunc('month', p_today)::date;
  perform app.require_permission(p_company, 'sales.read');
  if not exists (select 1 from public.history_documents where company_id = p_company)
     and not exists (select 1 from public.sync_till_sales where company_id = p_company) then
    return jsonb_build_object('has_history', false);
  end if;
  return (
    with d as (
      select h.id, h.kind, h.doc_date, h.total, h.net, h.warehouse_id, h.warehouse_code
        from public.history_documents h
       where h.company_id = p_company and h.doc_date between v_month and p_today
         and h.kind in ('sale', 'pos_sale', 'sale_return', 'purchase', 'purchase_return')),
    s as (
      select d.*, case when d.kind = 'sale_return' then -abs(d.total) else d.total end as signed,
             case when d.kind = 'sale_return' then -abs(coalesce(d.net, d.total)) else coalesce(d.net, d.total) end as signed_net
        from d where d.kind in ('sale', 'pos_sale', 'sale_return')),
    c as (
      select sum(case when s.kind = 'sale_return' then -abs(l.quantity) else l.quantity end * l.unit_cost) as cost
        from s join public.history_document_lines l on l.document_id = s.id
       where l.unit_cost is not null),
    -- per store and day: receipts, and stock exits
    rcp as (
      select coalesce(s.warehouse_id::text, 'code:' || coalesce(s.warehouse_code, '—')) as wkey, s.warehouse_id, s.warehouse_code, s.doc_date as day,
             sum(s.signed) as amount, count(*) filter (where s.kind <> 'sale_return') as receipts
        from s group by 1, 2, 3, 4),
    fd as (
      select t.warehouse_id::text as wkey, t.warehouse_id, (t.sold_at at time zone v_tz)::date as day,
             sum(t.amount) as amount, count(distinct coalesce(t.reference, t.ext_id)) filter (where t.quantity > 0) as receipts
        from public.sync_till_sales t
       where t.company_id = p_company and (t.sold_at at time zone v_tz)::date between v_month and p_today
       group by 1, 2, 3),
    day_store as (
      select coalesce(r.wkey, f.wkey) as wkey, coalesce(r.warehouse_id, f.warehouse_id) as warehouse_id, r.warehouse_code,
             coalesce(r.day, f.day) as day,
             case when coalesce(f.amount, 0) > coalesce(r.amount, 0) then f.amount else coalesce(r.amount, 0) end as amount,
             case when coalesce(f.amount, 0) > coalesce(r.amount, 0) then f.receipts else coalesce(r.receipts, 0) end as receipts,
             coalesce(f.amount, 0) > coalesce(r.amount, 0) as from_exits
        from rcp r full join fd f on f.wkey = r.wkey and f.day = r.day)
    select jsonb_build_object(
      'has_history', true,
      'last_date', (select max(day) from day_store),
      'today', coalesce((select sum(amount) from day_store where day = p_today), 0),
      'today_receipts', coalesce((select sum(receipts) from day_store where day = p_today), 0),
      'month', coalesce((select sum(amount) from day_store), 0),
      'month_net', coalesce((select sum(signed_net) from s), 0),
      'month_receipts', coalesce((select sum(receipts) from day_store), 0),
      'month_cost', (select cost from c),
      'month_from_exits', coalesce((select sum(amount) from day_store where from_exits), 0),
      'month_purchases', coalesce((select sum(case when kind = 'purchase_return' then -abs(total) else total end) from d where kind in ('purchase', 'purchase_return')), 0),
      'by_store', coalesce((select jsonb_agg(x order by x.month desc) from (
          select coalesce(w.name, ds.warehouse_code, '—') as store, ds.warehouse_id,
                 sum(ds.amount) filter (where ds.day = p_today) as today,
                 coalesce(sum(ds.receipts) filter (where ds.day = p_today), 0) as today_receipts,
                 sum(ds.amount) as month,
                 bool_or(ds.from_exits) as from_exits
            from day_store ds left join public.warehouses w on w.id = ds.warehouse_id
           group by 1, 2) x), '[]'::jsonb)));
end $$;
revoke execute on function public.history_live(uuid, date) from public;
grant execute on function public.history_live(uuid, date) to authenticated;
