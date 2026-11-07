-- =============================================================================
-- "Raporti i stokut", phase 3: the lots and their expiry, what looks wrong with the stock, the stock against the books,
-- and a permission to see what the goods cost ("Kostot e stokut"): without it a person sees quantities and sale prices only.
-- =============================================================================

-- besides seeing, changing, deleting and approving, a permission may let someone see what things cost
alter table public.permissions drop constraint if exists permissions_action_check;
alter table public.permissions add constraint permissions_action_check check (action in ('read', 'write', 'delete', 'approve', 'costs'));
insert into public.permissions (key, module, action, description) values
  ('inventory.costs', 'inventory', 'costs', 'See what the goods cost: average and last purchase cost, stock value, margins')
on conflict (key) do nothing;
-- those who saw the costs until now keep seeing them; the till, the sales reps and the warehouse floor do not
insert into public.role_permissions (role_id, permission)
select r.id, 'inventory.costs' from public.roles r
 where r.key in ('accountant', 'auditor', 'finance_manager', 'procurement_manager', 'production_manager', 'store_manager', 'sales_manager')
    or (r.company_id is not null and exists (select 1 from public.role_permissions rp where rp.role_id = r.id
                                              and rp.permission in ('finance.read', 'finance.*', 'inventory.write', 'procurement.write', 'procurement.*')))
on conflict do nothing;

create or replace function app._patch_function(p_name text, p_old text, p_new text)
returns void language plpgsql as $$
declare v_def text; v_oid oid;
begin
  select p.oid into v_oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname || '.' || p.proname = p_name order by p.oid desc limit 1;
  if v_oid is null then raise exception 'function % not found', p_name; end if;
  v_def := pg_get_functiondef(v_oid);
  if position(p_new in v_def) > 0 then return; end if;   -- already done
  if position(p_old in v_def) = 0 then raise exception 'patch for % does not apply', p_name; end if;
  execute replace(v_def, p_old, p_new);
end $$;

-- the analysis reports keep their quantities; the values go to those who may see the costs
select app._patch_function('public.stock_analysis',
  $x$  v_count := jsonb_array_length(v_rows);$x$,
  $x$  v_count := jsonb_array_length(v_rows);
  if not app.has_permission(p_company, 'inventory.costs') then
    v_rows := coalesce((select jsonb_agg(e - array['value', 'avg_cost', 'opening_value', 'in_value', 'out_value', 'revaluation', 'sold_value'] order by i)
                          from jsonb_array_elements(v_rows) with ordinality t (e, i)), '[]');
  end if;$x$);
drop function app._patch_function(text, text, text);

-- reports 1–7 and 13 (what looks wrong)
create or replace function public.stock_report(p_company uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_report text := coalesce(nullif(p ->> 'report', ''), 'avg');
  v_tz text := coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane');
  v_today date := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  v_asof date;
  v_units uuid[] := app.detail_units(p_company, p);
  v_restricted boolean := public.my_warehouse_access(p_company) is not null;
  v_split boolean := coalesce((p ->> 'split')::boolean, false);
  v_cats uuid[] := app.detail_ids(p, 'categories'); v_prod text[] := app.detail_texts(p, 'producers'); v_brands text[] := app.detail_texts(p, 'brands');
  v_vendors uuid[] := app.detail_ids(p, 'vendors'); v_items uuid[] := app.detail_ids(p, 'items'); v_rates numeric[] := app.detail_nums(p, 'vat_rates');
  v_types text[] := app.detail_texts(p, 'types');
  v_active text := coalesce(nullif(p ->> 'active', ''), 'active');
  v_stock text := coalesce(nullif(p ->> 'stock', ''), case when coalesce(nullif(p ->> 'report', ''), 'avg') = 'price_list' then 'all' else 'nonzero' end);
  v_limit int := least(coalesce((p ->> 'limit')::int, 20000), 50000);
  v_all_units uuid[];
  v_one uuid;
  v_costs boolean := app.has_permission(p_company, 'inventory.costs');
  v_rows jsonb; v_count int;
begin
  perform app.require_permission(p_company, 'inventory.read');
  if v_report not in ('avg', 'avg_sale', 'last_cost', 'price_list', 'sheet', 'by_producer', 'sale', 'anomalies') then
    raise exception 'Unknown report: %', v_report using errcode = '22023';
  end if;
  if v_stock not in ('nonzero', 'positive', 'all', 'negative', 'zero', 'below_min') then raise exception 'Unknown stock filter: %', v_stock using errcode = '22023'; end if;
  -- the reports at cost are for those who may see what the goods cost
  if v_report in ('avg', 'avg_sale', 'last_cost', 'by_producer', 'anomalies') and not v_costs then
    raise exception 'You may not see what the stock cost' using errcode = '42501';
  end if;
  v_asof := least(coalesce(nullif(p ->> 'as_of', '')::date, v_today), v_today);
  if v_restricted and cardinality(v_units) = 0 then return jsonb_build_object('rows', '[]'::jsonb, 'count', 0, 'truncated', false, 'as_of', v_asof); end if;
  -- the units the zero rows are made for: those asked, else every unit of the company
  v_all_units := case when cardinality(v_units) > 0 then v_units else array(
    select id from public.warehouses where company_id = p_company and deleted_at is null and is_active and warehouse_type <> 'transit') end;
  -- one unit asked and not split: its prices are the prices
  v_one := case when cardinality(v_units) = 1 then v_units[1] end;

  create temp table if not exists pg_temp.sr_keys (variant_id uuid, unit_id uuid, qty numeric, value numeric, last_in date, last_out date) on commit drop;
  truncate pg_temp.sr_keys;
  insert into pg_temp.sr_keys
  select s.variant_id, case when v_split then s.warehouse_id end, sum(s.qty), sum(s.value), max(s.last_in), max(s.last_out)
    from app.stock_as_of(p_company, v_asof) s
   where cardinality(v_units) = 0 or s.warehouse_id = any (v_units)
   group by 1, 2;
  -- the items with nothing in stock, when they are asked for
  if v_stock in ('all', 'zero', 'below_min') then
    insert into pg_temp.sr_keys
    select v.id, u.u, 0, 0, null, null
      from public.product_variants v join public.products pr on pr.id = v.product_id
      cross join (select unnest(case when v_split then v_all_units else array[null::uuid] end) as u) u
     where v.company_id = p_company and v.deleted_at is null and pr.deleted_at is null
       and (pr.product_type <> 'service' or v_report = 'price_list')
       and not exists (select 1 from pg_temp.sr_keys k where k.variant_id = v.id and k.unit_id is not distinct from u.u);
  end if;

  with base as (
    select k.*, v.sku, coalesce(nullif(v.name, ''), pr.name) as item, pr.code as product_code, pr.product_type, pr.is_active and v.is_active as active,
           pr.category_id, c.name as category, coalesce(pc.name, c.name) as grp, coalesce(c.parent_id, c.id) as group_id,
           pr.manufacturer as producer, pr.brand, u.code as uom, coalesce(tc.rate, 0) as vat_rate, w.name as unit, w.code as unit_code,
           coalesce(v.sales_price_override, pr.sales_price, 0) as price_now, v.standard_cost,
           (select b.barcode from public.product_barcodes b where b.variant_id = v.id and b.deleted_at is null order by b.is_primary desc, b.created_at limit 1) as barcode,
           coalesce(k.unit_id, v_one) as price_unit
      from pg_temp.sr_keys k
      join public.product_variants v on v.id = k.variant_id
      join public.products pr on pr.id = v.product_id
      left join public.product_categories c on c.id = pr.category_id
      left join public.product_categories pc on pc.id = c.parent_id
      left join public.units_of_measure u on u.id = pr.uom_id
      left join public.tax_codes tc on tc.id = pr.sales_tax_code_id
      left join public.warehouses w on w.id = k.unit_id
     where (cardinality(v_items) = 0 or k.variant_id = any (v_items))
       and (cardinality(v_cats) = 0 or pr.category_id = any (v_cats) or c.parent_id = any (v_cats))
       and (cardinality(v_prod) = 0 or coalesce(pr.manufacturer, '') = any (v_prod))
       and (cardinality(v_brands) = 0 or coalesce(pr.brand, '') = any (v_brands))
       and (cardinality(v_rates) = 0 or coalesce(tc.rate, 0) = any (v_rates))
       and (cardinality(v_types) = 0 or pr.product_type = any (v_types))
       and (v_active = 'all' or (v_active = 'active') = (pr.is_active and v.is_active))),
  priced as (
    select b.*,
           lc.cost as last_cost, coalesce(lc.d, mo.d) as last_date, lc.vendor_id as last_vendor_id, lv.name as last_vendor, mo.cost as made_cost,
           -- the sale price on that day: the unit's till price list, else the price history, else the item's price
           round(coalesce(
             (select case when pl.prices_include_tax then li.price / (1 + b.vat_rate / 100) else li.price end
                from public.pos_registers r
                join public.price_lists pl on pl.id = r.price_list_id and pl.deleted_at is null and pl.is_active
                join public.price_list_items li on li.price_list_id = pl.id and li.variant_id = b.variant_id and li.deleted_at is null
                     and coalesce(li.min_quantity, 1) <= 1 and (li.valid_from is null or li.valid_from <= v_asof) and (li.valid_to is null or li.valid_to >= v_asof)
               where r.warehouse_id = b.price_unit and r.is_active and r.deleted_at is null
               order by li.min_quantity desc nulls last limit 1),
             case when v_asof < v_today then coalesce(
               (select h.new_price from public.price_changes h
                 where h.company_id = p_company and h.variant_id = b.variant_id and h.changed_on <= v_asof
                   and (h.warehouse_id is null or h.warehouse_id = b.price_unit)
                 order by h.changed_on desc, (h.warehouse_id is not null) desc, h.created_at desc limit 1),
               (select h.old_price from public.price_changes h
                 where h.company_id = p_company and h.variant_id = b.variant_id and h.changed_on > v_asof
                   and (h.warehouse_id is null or h.warehouse_id = b.price_unit) and h.old_price is not null
                 order by h.changed_on, h.created_at limit 1)) end,
             b.price_now), 4) as sale_net,
           (select sum(rr.min_qty) from public.replenishment_rules rr
             where rr.variant_id = b.variant_id and rr.is_active and rr.deleted_at is null
               and (rr.warehouse_id = b.unit_id or (b.unit_id is null and (cardinality(v_units) = 0 or rr.warehouse_id = any (v_units))))) as min_qty
      from base b
      left join lateral (
        select round((gl.quantity * gl.unit_cost + coalesce(gl.landed_cost_amount, 0)) / nullif(gl.quantity, 0), 4) as cost, g.receipt_date as d, g.vendor_id
          from public.goods_receipt_lines gl join public.goods_receipts g on g.id = gl.receipt_id
         where gl.variant_id = b.variant_id and g.company_id = p_company and g.status = 'done' and g.deleted_at is null
           and g.receipt_date <= v_asof and gl.quantity > 0
         order by g.receipt_date desc, g.done_at desc nulls last limit 1) lc on true
      left join public.business_partners lv on lv.id = lc.vendor_id
      -- made here and never bought: the cost of the last batch made
      left join lateral (
        select round(m.unit_cost, 4) as cost, (m.movement_date at time zone v_tz)::date as d
          from public.stock_movements m
         where lc.cost is null and m.company_id = p_company and m.variant_id = b.variant_id and m.movement_type = 'production_output'
           and (m.movement_date at time zone v_tz)::date <= v_asof
         order by m.movement_date desc limit 1) mo on true),
  r0 as (
    select x.*, round(x.qty, 3) as q, round(x.value, 2) as val,
           round(x.value / nullif(x.qty, 0), 4) as avg_cost,
           round(x.sale_net * (1 + x.vat_rate / 100), 2) as sale_gross,
           coalesce(x.last_cost, x.made_cost, nullif(x.standard_cost, 0), round(x.value / nullif(x.qty, 0), 4)) as cost_last
      from priced x
     where (case v_stock when 'nonzero' then x.qty <> 0 or round(x.value, 2) <> 0 when 'positive' then x.qty > 0 when 'negative' then x.qty < 0
                         when 'zero' then x.qty = 0 when 'below_min' then x.min_qty is not null and x.qty <= x.min_qty else true end)
       and (cardinality(v_vendors) = 0 or x.last_vendor_id = any (v_vendors)
            or exists (select 1 from public.replenishment_rules rr where rr.variant_id = x.variant_id and rr.preferred_vendor_id = any (v_vendors) and rr.deleted_at is null))),
  -- what looks wrong with an item: negative stock, stock without a cost, value without stock, a sale price under the cost or none,
  -- an average far from the last purchase
  r as (
    select r0.*, array_remove(array[
             case when r0.q < 0 then 'negative' end,
             case when r0.q > 0 and coalesce(r0.avg_cost, 0) <= 0 then 'no_cost' end,
             case when r0.q = 0 and r0.val <> 0 then 'value_no_qty' end,
             case when r0.sale_net > 0 and coalesce(r0.avg_cost, 0) > 0 and r0.sale_net < r0.avg_cost then 'below_cost' end,
             case when coalesce(r0.sale_net, 0) <= 0 and r0.product_type = 'stockable' then 'no_price' end,
             case when coalesce(r0.last_cost, 0) > 0 and coalesce(r0.avg_cost, 0) > 0
                       and (r0.avg_cost > r0.last_cost * 1.5 or r0.avg_cost < r0.last_cost * 0.5) then 'cost_jump' end], null) as problems
      from r0)
  select count(*)::int, coalesce((select jsonb_agg(q order by q ->> 'group', q ->> 'item', q ->> 'unit') from (
      select jsonb_build_object(
               'variant_id', variant_id, 'unit_id', unit_id, 'unit', unit, 'unit_code', unit_code,
               'code', sku, 'barcode', barcode, 'item', item, 'category', category, 'group', grp, 'producer', producer, 'brand', brand,
               'uom', uom, 'vat_rate', vat_rate, 'type', product_type, 'active', active,
               'qty', q, 'value', val, 'avg_cost', avg_cost,
               'last_cost', cost_last, 'last_date', last_date, 'last_vendor', last_vendor,
               'value_last', round(q * cost_last, 2), 'diff_last', round(q * cost_last, 2) - val,
               'sale_net', sale_net, 'sale_gross', sale_gross,
               'value_sale_net', round(q * sale_net, 2), 'value_sale_gross', round(q * sale_gross, 2),
               'margin', round(q * sale_net, 2) - val, 'margin_pct', round(100 * (round(q * sale_net, 2) - val) / nullif(round(q * sale_net, 2), 0), 1),
               'markup_pct', round(100 * (sale_net - avg_cost) / nullif(avg_cost, 0), 1),
               'vat_in_sale', round(q * sale_gross, 2) - round(q * sale_net, 2),
               'min_qty', min_qty, 'last_in', last_in, 'last_out', last_out, 'problems', to_jsonb(problems)) q
        from r where v_report <> 'anomalies' or cardinality(problems) > 0
       order by grp, item, unit limit v_limit + 1) z), '[]')
    into v_count, v_rows
    from r;
  v_count := jsonb_array_length(v_rows);
  -- what the goods cost stays with those who may see it
  if not v_costs then
    v_rows := coalesce((select jsonb_agg(e - array['value', 'avg_cost', 'last_cost', 'last_vendor', 'value_last', 'diff_last', 'margin', 'margin_pct', 'markup_pct']
                                order by i) from jsonb_array_elements(v_rows) with ordinality t (e, i)), '[]');
  end if;
  if v_count > v_limit then
    v_rows := (select jsonb_agg(e order by i) from jsonb_array_elements(v_rows) with ordinality t (e, i) where i <= v_limit);
  end if;
  return jsonb_build_object('report', v_report, 'as_of', v_asof, 'rows', v_rows, 'count', least(v_count, v_limit), 'truncated', v_count > v_limit,
    'currency', (select base_currency from public.companies where id = p_company),
    'company', (select jsonb_build_object('name', name, 'tax_number', tax_number) from public.companies where id = p_company),
    'units', coalesce((select jsonb_agg(w.name order by w.code) from public.warehouses w where w.id = any (v_units)), '[]'));
end $$;
revoke execute on function public.stock_report(uuid, jsonb) from public, anon;
grant execute on function public.stock_report(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------- 12. the lots and their expiry
-- p: as_of (today when left out), units[], split, the item filters, within (days: only what expires within them; null = every lot),
--    expired (true: also what has expired), limit
create or replace function public.stock_expiry(p_company uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  v_units uuid[] := app.detail_units(p_company, p);
  v_restricted boolean := public.my_warehouse_access(p_company) is not null;
  v_split boolean := coalesce((p ->> 'split')::boolean, false);
  v_within int := nullif(p ->> 'within', '')::int;
  v_expired boolean := coalesce((p ->> 'expired')::boolean, true);
  v_costs boolean := app.has_permission(p_company, 'inventory.costs');
  v_limit int := least(coalesce((p ->> 'limit')::int, 20000), 50000);
  v_rows jsonb; v_count int;
begin
  perform app.require_permission(p_company, 'inventory.read');
  if v_restricted and cardinality(v_units) = 0 then return jsonb_build_object('rows', '[]'::jsonb, 'count', 0, 'truncated', false); end if;
  with s as (
    select sl.variant_id, sl.lot_id, case when v_split then sl.warehouse_id end as unit_id, sum(sl.on_hand) as qty
      from public.stock_levels sl
     where sl.company_id = p_company and sl.lot_id is not null and (cardinality(v_units) = 0 or sl.warehouse_id = any (v_units))
     group by 1, 2, 3 having sum(sl.on_hand) <> 0),
  r as (
    select s.*, i.sku, i.item, i.category, i.grp, i.producer, i.brand, i.uom, i.barcode, l.lot_number, l.expiry_date, l.manufacture_date,
           bp.name as vendor, w.name as unit, (l.expiry_date - v_today) as days_left,
           coalesce((select ic.avg_cost from public.item_costs ic where ic.variant_id = s.variant_id), 0) as cost
      from s
      join app.stock_report_items(p_company, p) i on i.variant_id = s.variant_id
      join public.lots l on l.id = s.lot_id
      left join public.business_partners bp on bp.id = l.vendor_id
      left join public.warehouses w on w.id = s.unit_id
     where (v_within is null or l.expiry_date <= v_today + v_within)
       and (v_expired or l.expiry_date is null or l.expiry_date >= v_today))
  select count(*)::int, coalesce((select jsonb_agg(q order by (q ->> 'expiry_date') nulls last, q ->> 'item') from (
      select jsonb_build_object('variant_id', variant_id, 'lot_id', lot_id, 'unit_id', unit_id, 'unit', unit, 'code', sku, 'barcode', barcode, 'item', item,
               'category', category, 'group', grp, 'producer', producer, 'brand', brand, 'uom', uom, 'lot', lot_number, 'expiry_date', expiry_date,
               'made_on', manufacture_date, 'vendor', vendor, 'qty', round(qty, 3), 'days_left', days_left,
               'bucket', case when expiry_date is null then 'none' when days_left < 0 then 'expired' when days_left <= 30 then 'd30'
                              when days_left <= 60 then 'd60' when days_left <= 90 then 'd90' else 'later' end)
             || case when v_costs then jsonb_build_object('avg_cost', round(cost, 4), 'value', round(qty * cost, 2)) else '{}'::jsonb end as q
        from r order by expiry_date nulls last, item limit v_limit + 1) z), '[]')
    into v_count, v_rows from r;
  v_count := jsonb_array_length(v_rows);
  if v_count > v_limit then
    v_rows := (select jsonb_agg(e order by i) from jsonb_array_elements(v_rows) with ordinality t (e, i) where i <= v_limit);
  end if;
  return jsonb_build_object('report', 'expiry', 'as_of', v_today, 'rows', v_rows, 'count', least(v_count, v_limit), 'truncated', v_count > v_limit,
    'currency', (select base_currency from public.companies where id = p_company));
end $$;
revoke execute on function public.stock_expiry(uuid, jsonb) from public, anon;
grant execute on function public.stock_expiry(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------------------------------- 14. the stock against the books
-- per stock account: the value of the stock on that day, counted from the stock movements, and the balance of the account in the
-- statutory books on the same day; a difference means a movement without its entry, or an entry by hand on the stock account
create or replace function public.stock_books_check(p_company uuid, p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_today date := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  v_asof date := least(coalesce(nullif(p ->> 'as_of', '')::date, v_today), v_today);
  v_rows jsonb;
begin
  perform app.require_permission(p_company, 'inventory.costs');
  perform app.require_permission(p_company, 'finance.read');
  with stock as (
    select app.item_acct(p_company, s.variant_id, 'inventory') as account_id, sum(s.value) as value, count(distinct s.variant_id) as items
      from app.stock_as_of(p_company, v_asof) s group by 1),
  accts as (
    select account_id from stock where account_id is not null
    union select id from public.accounts a where a.company_id = p_company and a.deleted_at is null
              and (a.id in (select inventory_account_id from public.product_categories where company_id = p_company and inventory_account_id is not null)
                   or a.id = app.acct(p_company, 'inventory'))),
  books as (
    select jl.account_id, sum(jl.debit - jl.credit) as balance, count(*) filter (where not e.is_automatic) as manual_lines
      from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
     where e.company_id = p_company and e.status = 'posted' and e.deleted_at is null and e.reporting_ledger = 'STATUTORY'
       and e.entry_date <= v_asof and jl.account_id in (select account_id from accts)
     group by 1)
  select coalesce(jsonb_agg(jsonb_build_object('account_id', a.id, 'code', a.code, 'account', a.name,
           'items', coalesce(s.items, 0), 'stock_value', round(coalesce(s.value, 0), 2), 'books', round(coalesce(b.balance, 0), 2),
           'difference', round(coalesce(b.balance, 0) - coalesce(s.value, 0), 2), 'manual_lines', coalesce(b.manual_lines, 0)) order by a.code), '[]')
    into v_rows
    from accts x join public.accounts a on a.id = x.account_id
    left join stock s on s.account_id = a.id left join books b on b.account_id = a.id;
  return jsonb_build_object('report', 'books', 'as_of', v_asof, 'rows', v_rows, 'currency', (select base_currency from public.companies where id = p_company));
end $$;
revoke execute on function public.stock_books_check(uuid, jsonb) from public, anon;
grant execute on function public.stock_books_check(uuid, jsonb) to authenticated;
