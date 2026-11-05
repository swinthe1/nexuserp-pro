-- =============================================================================
-- From the meeting with the administrative staff (answers of 5 November):
--   #17 the highest value of one till receipt, set by the company (e.g. 1 000 €): above it the
--       sale is not made
--   #20 the restaurant: the bar's printer gets the whole order, the kitchen's only the food; each
--       station prints to its own printer
--   #9  the expiry date as the last column of every line of a purchase invoice; items not kept by
--       lot show it in Short dates too
--   #28 supplier contracts: terms, dates, the signed file, a reminder before they end
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

-- ---------------------------------------------------------------- 17. the highest value of a receipt
alter table public.company_settings add column if not exists pos_receipt_max numeric(18,2) check (pos_receipt_max is null or pos_receipt_max > 0);

select app._patch_function('public.automation_settings_save',
  $x$'pos_void_notify_over', 'pos_void_whatsapp'] then$x$,
  $x$'pos_void_notify_over', 'pos_void_whatsapp', 'pos_receipt_max'] then$x$);
select app._patch_function('public.automation_settings_save',
  $x$    pos_payouts = coalesce(p_patch ->> 'pos_payouts', pos_payouts),$x$,
  $x$    pos_payouts = coalesce(p_patch ->> 'pos_payouts', pos_payouts),
    pos_receipt_max = case when p_patch ? 'pos_receipt_max' then nullif(p_patch ->> 'pos_receipt_max', '')::numeric else pos_receipt_max end,$x$);
select app._patch_function('public.pos_till_options',
  $x$    'void_notify', coalesce($x$,
  $x$    'receipt_max', (select pos_receipt_max from public.company_settings where company_id = v_co),
    'void_notify', coalesce($x$);

-- the server says no too (a sale made offline, before the till knew the limit, is kept)
select app._patch_function('public.pos_submit_order',
  $x$  -- payments
  select total into v_total from public.pos_orders where id = v_id;$x$,
  $x$  -- payments
  select total into v_total from public.pos_orders where id = v_id;
  if not v_refund and not v_offline and v_total > coalesce((select pos_receipt_max from public.company_settings where company_id = s.company_id), 'infinity'::numeric) then
    raise exception 'One receipt can be at most %; this one is %', to_char((select pos_receipt_max from public.company_settings where company_id = s.company_id), 'FM999G999G990D00'),
      to_char(v_total, 'FM999G999G990D00') using errcode = '23514';
  end if;$x$);

-- ---------------------------------------------------------------- 20. the bar gets the whole order
alter table public.kitchen_stations
  add column if not exists whole_order boolean not null default false,   -- prints every item of the order (the bar)
  add column if not exists printer     text;                              -- the printer of this station on the till's computer

create or replace function public.restaurant_send(p_tab uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare o public.table_orders; v_out jsonb;
begin
  o := app.tab_for_update(p_tab);
  with sent as (
    update public.table_order_lines set status = 'sent', sent_at = now()
     where table_order_id = o.id and status = 'new' returning *),
  st as (select * from public.kitchen_stations where company_id = o.company_id and warehouse_id = o.warehouse_id and deleted_at is null),
  -- a station that prints the whole order gets every item; the others only their own
  t as (
    select st.id, st.name, st.sort_order, st.printer, st.whole_order,
           (select jsonb_agg(jsonb_build_object('name', s.name, 'quantity', s.quantity, 'note', s.note) order by s.created_at)
              from sent s where st.whole_order or s.station_id = st.id) as lines
      from st
    union all
    select null, '', 999, null, false,
           (select jsonb_agg(jsonb_build_object('name', s.name, 'quantity', s.quantity, 'note', s.note) order by s.created_at)
              from sent s where s.station_id is null or not exists (select 1 from st where st.id = s.station_id))
     where not exists (select 1 from st where st.whole_order))
  select coalesce(jsonb_agg(jsonb_build_object('station', t.name, 'station_id', t.id, 'printer', t.printer, 'whole', t.whole_order, 'lines', t.lines)
                            order by t.whole_order desc, t.sort_order), '[]'::jsonb) into v_out
    from t where t.lines is not null;
  return jsonb_build_object('number', o.number, 'table', (select name from public.restaurant_tables where id = o.table_id), 'label', o.label,
    'waiter', (select coalesce(full_name, '') from public.profiles where id = auth.uid()), 'at', now(), 'tickets', v_out);
end $$;

-- the floor knows each station's printer and whether it prints the whole order
select app._patch_function('public.restaurant_floor',
  $x$jsonb_build_object('id', s.id, 'name', s.name, 'category_ids', s.category_ids, 'is_default', s.is_default)$x$,
  $x$jsonb_build_object('id', s.id, 'name', s.name, 'category_ids', s.category_ids, 'is_default', s.is_default, 'whole_order', s.whole_order, 'printer', s.printer)$x$);

-- ---------------------------------------------------------------- 9. expiry dates from the purchase invoice
-- an item not kept by lot: its expiry date stays on the invoice line; Short dates shows it with the
-- stock the unit still has of it (no more than came in on that invoice)
create or replace function app.bill_short_dates(p_company uuid, p_warehouse uuid, p_until date, p_today date)
returns table (variant_id uuid, warehouse_id uuid, expiry_date date, ref text, quantity numeric, supplier_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct on (l.variant_id, b.warehouse_id, l.expiry_date)
         l.variant_id, b.warehouse_id, l.expiry_date, coalesce(b.vendor_invoice_number, b.number),
         least(l.quantity, coalesce((select sum(sl.on_hand) from public.stock_levels sl where sl.variant_id = l.variant_id and sl.warehouse_id = b.warehouse_id), 0)),
         b.vendor_id
    from public.vendor_bill_lines l join public.vendor_bills b on b.id = l.bill_id
    join public.product_variants v on v.id = l.variant_id join public.products p on p.id = v.product_id
   where b.company_id = p_company and b.status = 'posted' and b.deleted_at is null and l.expiry_date is not null
     and p.tracking = 'none' and l.expiry_date <= p_until and l.expiry_date >= p_today - 30
     and (p_warehouse is null or b.warehouse_id = p_warehouse)
   order by l.variant_id, b.warehouse_id, l.expiry_date, b.bill_date desc
$$;
revoke execute on function app.bill_short_dates(uuid, uuid, date, date) from public, anon, authenticated;

select app._patch_function('public.expiry_overview',
  $x$         group by l.id, v.id, w.id) q), '[]'::jsonb),$x$,
  $x$         group by l.id, v.id, w.id
        union all
        select jsonb_build_object('lot_id', null, 'lot_number', bs.ref, 'from_invoice', true, 'variant_id', v.id, 'sku', v.sku, 'name', v.name,
                 'warehouse_id', w.id, 'warehouse', w.name, 'expiry_date', bs.expiry_date, 'days_left', bs.expiry_date - v_today,
                 'on_hand', bs.quantity, 'value', round(bs.quantity * coalesce((select avg_cost from public.item_costs where variant_id = v.id), 0), 2),
                 'price', p.sales_price, 'supplier_id', bs.supplier_id, 'supplier', (select name from public.business_partners where id = bs.supplier_id),
                 'category_id', p.category_id, 'group_id', (select coalesce(c.parent_id, c.id) from public.product_categories c where c.id = p.category_id),
                 'markdown', (select jsonb_build_object('id', em.id, 'status', em.status, 'discount_pct', em.discount_pct)
                                from public.expiry_markdowns em where em.lot_id is null and em.variant_id = v.id and em.warehouse_id = w.id
                                 and em.expiry_date = bs.expiry_date and em.status in ('proposed', 'approved') order by em.created_at desc limit 1))
          from app.bill_short_dates(p_company, p_warehouse, v_today + greatest(coalesce(p_days, 7), 0), v_today) bs
          join public.product_variants v on v.id = bs.variant_id join public.products p on p.id = v.product_id
          join public.warehouses w on w.id = bs.warehouse_id
         where bs.quantity > 0) q), '[]'::jsonb),$x$);

-- ---------------------------------------------------------------- 28. supplier contracts
create table if not exists public.supplier_contracts (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id),
  vendor_id       uuid not null,
  number          text not null,
  title           text,
  start_date      date not null,
  end_date        date,
  payment_days    int check (payment_days is null or payment_days between 0 and 365),
  rebate_pct      numeric(6,2) check (rebate_pct is null or rebate_pct between 0 and 100),
  rebate_terms    text,          -- e.g. "3% when the year's purchases pass 50 000 €"
  delivery_days   int check (delivery_days is null or delivery_days between 0 and 365),
  min_order       numeric(18,2),
  returns_expired boolean not null default false,
  returns_terms   text,
  other_terms     text,
  file_path       text,          -- the signed contract, in the company's private files
  file_name       text,
  remind_days     int not null default 30 check (remind_days between 0 and 365),
  status          text not null default 'active' check (status in ('draft', 'active', 'ended')),
  notes           text,
  foreign key (company_id, vendor_id) references public.business_partners(company_id, id),
  unique (company_id, number)
);
select app.register_table('public.supplier_contracts', 'procurement');
create index if not exists supplier_contracts_vendor_idx on public.supplier_contracts (company_id, vendor_id) where deleted_at is null;

-- the contract in force for a supplier on a day (the purchase invoice shows its terms)
create or replace function public.supplier_contract_for(p_vendor uuid, p_date date default current_date)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select to_jsonb(c) from public.supplier_contracts c
   where c.vendor_id = p_vendor and c.deleted_at is null and c.status = 'active'
     and c.start_date <= p_date and (c.end_date is null or c.end_date >= p_date)
   order by c.start_date desc limit 1
$$;
revoke execute on function public.supplier_contract_for(uuid, date) from public, anon;
grant execute on function public.supplier_contract_for(uuid, date) to authenticated;

-- a contract that reaches its end date is ended; the buyers are told before (on the day chosen, a week and a day before)
select app._patch_function('public.run_daily_reminders',
  $x$    -- what slipped through in the books$x$,
  $x$    update public.supplier_contracts set status = 'ended' where company_id = c.id and status = 'active' and end_date < current_date and deleted_at is null;
    for l in select sc.id, sc.number, sc.end_date, bp.name as vendor from public.supplier_contracts sc join public.business_partners bp on bp.id = sc.vendor_id
              where sc.company_id = c.id and sc.status = 'active' and sc.deleted_at is null and sc.end_date is not null
                and (sc.end_date - current_date) in (sc.remind_days, 7, 1) loop
      v_n := v_n + app.remind(c.id, array['procurement_manager', 'company_admin'], 'Contract ' || l.number || ' with ' || l.vendor || ' ends ' || to_char(l.end_date, 'DD.MM.YYYY'),
                              null, '/procurement/contracts?c=' || l.id, 'supplier_contracts', l.id);
    end loop;
    -- what slipped through in the books$x$);

drop function app._patch_function(text, text, text);
