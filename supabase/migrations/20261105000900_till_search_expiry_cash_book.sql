-- =============================================================================
-- From the meeting with the administrative staff:
--   #19 the till's search shows each item in detail: the catalog also gives the unit of measure
--   #14 the expiry dates filtered by supplier, group and sub-group
--   #16b the cash book: each cash account day by day (opening, in, out, closing), by unit
-- =============================================================================

-- ---------------------------------------------------------------- 19. the till's catalog with the unit
drop function if exists public.pos_catalog(uuid);
create function public.pos_catalog(p_register uuid)
returns table (variant_id uuid, sku text, name text, category text, barcodes jsonb, price numeric, tax_code_id uuid, tax_rate numeric,
               tracking text, on_hand numeric, image_path text, product_type text, uom text)
language sql stable set search_path = '' as $$
  select v.id, v.sku, v.name, c.name,
         coalesce((select jsonb_agg(jsonb_build_object('code', b.barcode, 'qty', b.quantity)) from public.product_barcodes b
                    where b.variant_id = v.id and b.deleted_at is null), '[]'::jsonb),
         round(coalesce(gp.unit_price * (1 - coalesce(gp.discount_pct, 0) / 100), coalesce(v.sales_price_override, p.sales_price))
               * (1 + coalesce(t.rate, 0) / 100), 2),
         p.sales_tax_code_id, coalesce(t.rate, 0), p.tracking,
         coalesce((select sum(sl.on_hand) from public.stock_levels sl where sl.variant_id = v.id and sl.location_id = r.location_id), 0),
         p.image_path, p.product_type, u.code
    from public.pos_registers r
    join public.product_variants v on v.company_id = r.company_id and v.is_active and v.deleted_at is null
    join public.products p on p.id = v.product_id and p.is_active and p.is_sellable and p.deleted_at is null
    left join public.product_categories c on c.id = p.category_id
    left join public.units_of_measure u on u.id = p.uom_id
    left join public.tax_codes t on t.id = p.sales_tax_code_id
    left join lateral public.get_price(r.company_id, r.default_customer_id, v.id, 1, current_date, r.price_list_id) gp on true
   where r.id = p_register
   order by v.name
$$;
revoke execute on function public.pos_catalog(uuid) from public, anon;
grant execute on function public.pos_catalog(uuid) to authenticated;

-- ---------------------------------------------------------------- 14. expiry dates with supplier and groups
-- the supplier of a lot: the one it came from, else the item's usual supplier
create or replace function public.expiry_overview(p_company uuid, p_warehouse uuid default null, p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_today date;
begin
  perform app.require_permission(p_company, 'inventory.read');
  v_today := (now() at time zone coalesce((select timezone from public.companies where id = p_company), 'Europe/Tirane'))::date;
  return jsonb_build_object(
    'today', v_today,
    'can', jsonb_build_object('propose', app.expiry_can(p_company, 'propose'), 'decide', app.expiry_can(p_company, 'decide'),
                              'write_off', app.has_permission(p_company, 'inventory.write')),
    'lots', coalesce((select jsonb_agg(x order by x ->> 'expiry_date', x ->> 'name') from (
        with sup as (select * from app.item_suppliers(p_company))
        select jsonb_build_object('lot_id', l.id, 'lot_number', l.lot_number, 'variant_id', v.id, 'sku', v.sku, 'name', v.name,
                 'warehouse_id', w.id, 'warehouse', w.name, 'expiry_date', l.expiry_date, 'days_left', l.expiry_date - v_today,
                 'on_hand', sum(sl.on_hand), 'value', round(sum(sl.on_hand) * coalesce(max(ic.avg_cost), 0), 2),
                 'price', max(p.sales_price),
                 'supplier_id', coalesce(l.vendor_id, (select supplier_id from sup where variant_id = v.id)),
                 'supplier', (select name from public.business_partners where id = coalesce(l.vendor_id, (select supplier_id from sup where variant_id = v.id))),
                 'category_id', (select category_id from public.products where id = v.product_id),
                 'group_id', (select coalesce(c.parent_id, c.id) from public.products pp join public.product_categories c on c.id = pp.category_id where pp.id = v.product_id),
                 'markdown', (select jsonb_build_object('id', em.id, 'status', em.status, 'discount_pct', em.discount_pct)
                                from public.expiry_markdowns em where em.lot_id = l.id and em.warehouse_id = w.id and em.status in ('proposed', 'approved')
                               order by em.created_at desc limit 1)) as x
          from public.lots l
          join public.stock_levels sl on sl.lot_id = l.id and sl.on_hand > 0
          join public.warehouses w on w.id = sl.warehouse_id
          join public.product_variants v on v.id = l.variant_id
          join public.products p on p.id = v.product_id
          left join public.item_costs ic on ic.variant_id = l.variant_id
         where l.company_id = p_company and l.deleted_at is null and l.expiry_date is not null
           and l.expiry_date <= v_today + greatest(coalesce(p_days, 7), 0)
           and (p_warehouse is null or w.id = p_warehouse)
         group by l.id, v.id, w.id) q), '[]'::jsonb),
    'markdowns', coalesce((with sup as (select * from app.item_suppliers(p_company)) select jsonb_agg(jsonb_build_object('id', em.id, 'status', em.status, 'variant_id', em.variant_id, 'sku', v.sku, 'name', v.name,
                 'warehouse_id', em.warehouse_id, 'warehouse', w.name, 'lot_number', l.lot_number, 'expiry_date', em.expiry_date,
                 'days_left', em.expiry_date - v_today, 'quantity', em.quantity, 'discount_pct', em.discount_pct, 'note', em.note,
                 'price', p.sales_price, 'proposed_by', app.person_name(em.proposed_by), 'decided_by', app.person_name(em.decided_by),
                 'created_at', em.created_at, 'decided_at', em.decided_at, 'mine', em.proposed_by = auth.uid(),
                 'supplier_id', coalesce(l.vendor_id, (select supplier_id from sup where variant_id = v.id)),
                 'supplier', (select name from public.business_partners where id = coalesce(l.vendor_id, (select supplier_id from sup where variant_id = v.id))),
                 'category_id', p.category_id,
                 'group_id', (select coalesce(c.parent_id, c.id) from public.product_categories c where c.id = p.category_id),
                 'adjustment_number', (select number from public.stock_adjustments where id = em.adjustment_id),
                 'adjustment_status', (select status from public.stock_adjustments where id = em.adjustment_id))
               order by case em.status when 'proposed' then 0 when 'approved' then 1 else 2 end, em.expiry_date, v.name)
          from public.expiry_markdowns em
          join public.product_variants v on v.id = em.variant_id
          join public.products p on p.id = v.product_id
          join public.warehouses w on w.id = em.warehouse_id
          left join public.lots l on l.id = em.lot_id
         where em.company_id = p_company and (p_warehouse is null or em.warehouse_id = p_warehouse)
           and (em.status in ('proposed', 'approved') or em.decided_at > now() - interval '14 days')), '[]'::jsonb));
end $$;
revoke execute on function public.expiry_overview(uuid, uuid, int) from public, anon;
grant execute on function public.expiry_overview(uuid, uuid, int) to authenticated;

-- ---------------------------------------------------------------- 16b. the cash book
-- the cash accounts with the units they belong to (a till's drawer, a unit's safe)
create or replace function public.cash_accounts(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if not (app.has_permission(p_company, 'finance.read') or app.has_permission(p_company, 'invoicing.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name, 'kind', b.account_kind, 'currency', b.currency_code, 'account', a.code,
             'units', coalesce((select jsonb_agg(distinct jsonb_build_object('id', w.id, 'name', w.name))
                                  from public.warehouses w
                                 where w.id in (select r.warehouse_id from public.pos_registers r where r.cash_account_id = b.id and r.deleted_at is null
                                                union select s.warehouse_id from public.safes s where s.bank_account_id = b.id and s.deleted_at is null)), '[]'::jsonb))
           order by b.account_kind <> 'cash', b.name)
      from public.bank_accounts b join public.accounts a on a.id = b.account_id
     where b.company_id = p_company and b.deleted_at is null and b.is_active), '[]'::jsonb);
end $$;
revoke execute on function public.cash_accounts(uuid) from public, anon;
grant execute on function public.cash_accounts(uuid) to authenticated;

-- p: from, to, accounts[] (bank_accounts), units[]; without accounts: every cash account (of the units chosen)
-- returns {accounts:[…], days:[{date, opening, in, out, closing, lines:[{account, description, document, partner, in, out}]}], opening, closing}
create or replace function public.cash_book(p_company uuid, p jsonb)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_from date := coalesce((p ->> 'from')::date, date_trunc('month', current_date)::date);
  v_to date := coalesce((p ->> 'to')::date, current_date);
  v_acc uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'accounts', '[]'))::uuid);
  v_units uuid[] := array(select jsonb_array_elements_text(coalesce(p -> 'units', '[]'))::uuid);
  v_banks uuid[]; v_gl uuid[]; v_open numeric; v_days jsonb;
begin
  if not (app.has_permission(p_company, 'finance.read') or app.has_permission(p_company, 'invoicing.read')) then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if v_to < v_from or v_to - v_from > 400 then raise exception 'Check the dates' using errcode = '22023'; end if;

  select array_agg(b.id), array_agg(distinct b.account_id) into v_banks, v_gl
    from public.bank_accounts b
   where b.company_id = p_company and b.deleted_at is null
     and (case when cardinality(v_acc) > 0 then b.id = any (v_acc) else b.account_kind = 'cash' end)
     and (cardinality(v_units) = 0 or b.id in (select r.cash_account_id from public.pos_registers r where r.warehouse_id = any (v_units) and r.deleted_at is null
                                                union select s.bank_account_id from public.safes s where s.warehouse_id = any (v_units) and s.deleted_at is null));
  v_gl := coalesce(v_gl, '{}');

  select coalesce(sum(jl.debit - jl.credit), 0) into v_open
    from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id
   where jl.company_id = p_company and jl.account_id = any (v_gl) and e.status in ('posted', 'reversed') and e.entry_date < v_from;

  with l as (
    select e.entry_date as d, e.number as entry_no, coalesce(nullif(jl.description, ''), e.memo) as description, e.source_doc_type as source_type, e.source_doc_id as source_id,
           coalesce((select name from public.business_partners where id = jl.partner_id),
                    (select bp.name from public.payments py join public.business_partners bp on bp.id = py.partner_id where py.id = e.source_doc_id)) as partner,
           a.code as account,
           jl.debit as cin, jl.credit as cout, e.created_at
      from public.journal_lines jl join public.journal_entries e on e.id = jl.entry_id join public.accounts a on a.id = jl.account_id
     where jl.company_id = p_company and jl.account_id = any (v_gl) and e.status in ('posted', 'reversed') and e.entry_date between v_from and v_to),
  d as (
    select d, sum(cin) as cin, sum(cout) as cout,
           jsonb_agg(jsonb_build_object('account', account, 'entry', entry_no, 'description', description, 'partner', partner,
                     'source_type', source_type, 'source_id', source_id, 'in', cin, 'out', cout) order by created_at, entry_no) as lines
      from l group by d),
  r as (select d.*, v_open + sum(cin - cout) over (order by d) as closing from d)
  select jsonb_agg(jsonb_build_object('date', d, 'in', cin, 'out', cout, 'opening', closing - cin + cout, 'closing', closing, 'lines', lines) order by d)
    into v_days from r;

  return jsonb_build_object('from', v_from, 'to', v_to, 'opening', v_open,
    'in', coalesce((select sum((x ->> 'in')::numeric) from jsonb_array_elements(v_days) x), 0),
    'out', coalesce((select sum((x ->> 'out')::numeric) from jsonb_array_elements(v_days) x), 0),
    'closing', v_open + coalesce((select sum((x ->> 'in')::numeric - (x ->> 'out')::numeric) from jsonb_array_elements(v_days) x), 0),
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'name', b.name)) from public.bank_accounts b where b.id = any (coalesce(v_banks, '{}'))), '[]'::jsonb),
    'days', coalesce(v_days, '[]'::jsonb),
    'currency', (select base_currency from public.companies where id = p_company));
end $$;
revoke execute on function public.cash_book(uuid, jsonb) from public, anon;
grant execute on function public.cash_book(uuid, jsonb) to authenticated;
