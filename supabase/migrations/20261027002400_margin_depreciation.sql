-- =============================================================================
-- Feedback of accountants, part two
--   · Margin analysis: what the discounts cost, the markup on cost, the lines sold below cost,
--     and the margin by warehouse and by supplier (the item's preferred supplier).
--   · Depreciation books itself every month when the company wants it (one entry per month,
--     the same as the button), and tells finance what it recorded.
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

-- -----------------------------------------------------------------------------
-- 1. The sales facts carry the price before discount, the warehouse and the supplier
-- -----------------------------------------------------------------------------
drop function if exists app.sales_facts(uuid, date, date);
create function app.sales_facts(p_company uuid, p_from date, p_to date)
returns table (doc_type text, doc_id uuid, doc_number text, href text, doc_date date, partner_id uuid, partner text, salesperson_id uuid,
               channel text, variant_id uuid, product text, category_id uuid, category text, warehouse text, city text,
               qty numeric, net numeric, cost numeric, gross numeric, warehouse_id uuid, vendor_id uuid, vendor text)
language sql stable security definer set search_path = '' as $$
  select i.document_type, i.id, i.number, '/sales/invoices/' || i.id, i.invoice_date, i.partner_id, p.name, coalesce(i.salesperson_id, so.salesperson_id),
         coalesce(so.channel, 'direct'), l.variant_id, coalesce(v.sku || ' · ' || v.name, l.description), pr.category_id,
         case when l.variant_id is null then 'Services and other lines' else coalesce(c.name, 'No category') end,
         w.name, (select a.city from public.partner_addresses a where a.partner_id = i.partner_id and a.deleted_at is null order by a.is_default desc limit 1),
         s.s * l.quantity, s.s * round(l.line_subtotal * i.exchange_rate, 2),
         s.s * round(l.quantity * coalesce(dl.unit_cost, ic.avg_cost, v.standard_cost, 0), 2),
         s.s * round(case when coalesce(l.discount_pct, 0) between 0.0001 and 99.9999 then l.line_subtotal / (1 - l.discount_pct / 100) else l.line_subtotal end * i.exchange_rate, 2),
         w.id, sup.vendor_id, sup.vendor
    from public.sales_invoices i
    join public.sales_invoice_lines l on l.invoice_id = i.id
    join public.business_partners p on p.id = i.partner_id
    left join public.sales_orders so on so.id = i.sales_order_id
    left join public.warehouses w on w.id = so.warehouse_id
    left join public.delivery_lines dl on dl.id = l.delivery_line_id
    left join public.product_variants v on v.id = l.variant_id
    left join public.products pr on pr.id = v.product_id
    left join public.product_categories c on c.id = pr.category_id
    left join public.item_costs ic on ic.variant_id = l.variant_id
    left join lateral (select vp.vendor_id, bp.name as vendor from public.vendor_products vp join public.business_partners bp on bp.id = vp.vendor_id
                        where vp.variant_id = l.variant_id and vp.deleted_at is null order by vp.is_preferred desc, vp.updated_at desc limit 1) sup on true
    cross join lateral (select case when i.document_type = 'credit_note' then -1 else 1 end as s) s
   where i.company_id = p_company and i.status = 'posted' and i.deleted_at is null and i.source <> 'pos' and not i.is_opening and i.invoice_date between p_from and p_to
  union all
  select case when o.is_refund then 'credit_note' else 'pos' end, o.id, o.number, '/pos?register=' || o.register_id, (o.order_at at time zone co.timezone)::date,
         o.partner_id, coalesce(p.name, 'Retail customers'), o.cashier_id, 'pos', l.variant_id, coalesce(v.sku || ' · ' || v.name, l.description),
         pr.category_id, coalesce(c.name, 'No category'), w.name, null,
         l.quantity, l.line_subtotal, round(l.quantity * coalesce(l.unit_cost, 0), 2),
         round(case when coalesce(l.discount_pct, 0) between 0.0001 and 99.9999 then l.line_subtotal / (1 - l.discount_pct / 100) else l.line_subtotal end, 2),
         w.id, sup.vendor_id, sup.vendor
    from public.pos_orders o
    join public.companies co on co.id = o.company_id
    join public.pos_order_lines l on l.pos_order_id = o.id
    join public.pos_registers r on r.id = o.register_id
    left join public.warehouses w on w.id = r.warehouse_id
    left join public.business_partners p on p.id = o.partner_id
    left join public.product_variants v on v.id = l.variant_id
    left join public.products pr on pr.id = v.product_id
    left join public.product_categories c on c.id = pr.category_id
    left join lateral (select vp.vendor_id, bp.name as vendor from public.vendor_products vp join public.business_partners bp on bp.id = vp.vendor_id
                        where vp.variant_id = l.variant_id and vp.deleted_at is null order by vp.is_preferred desc, vp.updated_at desc limit 1) sup on true
   where o.company_id = p_company and o.status = 'paid' and o.deleted_at is null and (o.order_at at time zone co.timezone)::date between p_from and p_to
  union all
  -- selling below zero: the cost corrected when the goods arrived, on that item and day
  select 'cost_correction', m.id, coalesce(m.reference, 'Kosto e rregulluar'), null, (m.movement_date at time zone co.timezone)::date,
         null, 'Cost settled when the goods arrived', null, 'direct', m.variant_id, coalesce(v.sku || ' · ' || v.name, ''), pr.category_id,
         coalesce(c.name, 'No category'), w.name, null, 0, 0, round(-m.total_cost, 2), 0, w.id, sup.vendor_id, sup.vendor
    from public.stock_movements m
    join public.companies co on co.id = m.company_id
    left join public.product_variants v on v.id = m.variant_id
    left join public.products pr on pr.id = v.product_id
    left join public.product_categories c on c.id = pr.category_id
    left join public.warehouses w on w.id = m.to_warehouse_id
    left join lateral (select vp.vendor_id, bp.name as vendor from public.vendor_products vp join public.business_partners bp on bp.id = vp.vendor_id
                        where vp.variant_id = m.variant_id and vp.deleted_at is null order by vp.is_preferred desc, vp.updated_at desc limit 1) sup on true
   where m.company_id = p_company and m.movement_type = 'revaluation' and m.notes like 'Negative stock settled%'
     and (m.movement_date at time zone co.timezone)::date between p_from and p_to
$$;
revoke all on function app.sales_facts(uuid, date, date) from public;

-- -----------------------------------------------------------------------------
-- 2. The reports: warehouse and supplier groupings; the margin report adds discounts and markup
-- -----------------------------------------------------------------------------
do $$ begin
  perform app._patch_function('public.run_report',
    E'      ''customer'', jsonb_build_array(''coalesce(partner_id::text, ''''retail'''')'', ''min(partner)'', ''sum(net) desc''),',
    E'      ''customer'', jsonb_build_array(''coalesce(partner_id::text, case when doc_type = ''''cost_correction'''' then ''''correction'''' else ''''retail'''' end)'', ''min(partner)'', ''sum(net) desc''),\n'
    || E'      ''warehouse'', jsonb_build_array(''coalesce(warehouse_id::text, ''''none'''')'', ''coalesce(min(warehouse), ''''No warehouse'''')'', ''sum(net) desc''),\n'
    || E'      ''vendor'', jsonb_build_array(''coalesce(vendor_id::text, ''''none'''')'', ''coalesce(min(vendor), ''''No supplier'''')'', ''sum(net) desc''),');
  perform app._patch_function('public.run_report',
    E'      jsonb_build_object(''key'',''margin'',''label'',''Margin'',''type'',''money''), jsonb_build_object(''key'',''margin_pct'',''label'',''Margin %'',''type'',''pct''));\n    if v_dim = ''document'' then v_href := ''min(href)''; end if;\n  elsif p_report = ''purchases'' then',
    E'      jsonb_build_object(''key'',''margin'',''label'',''Margin'',''type'',''money''), jsonb_build_object(''key'',''margin_pct'',''label'',''Margin %'',''type'',''pct''));\n'
    || E'    if p_report = ''margin'' then\n'
    || E'      v_measures := v_measures || '', round(sum(gross) - sum(net), 2) as discount, round(100 * (sum(net) - sum(cost)) / nullif(sum(cost), 0), 1) as markup_pct, ''\n'
    || E'                 || ''count(*) filter (where qty > 0 and net < cost) as below_cost'';\n'
    || E'      v_cols := v_cols || jsonb_build_array(jsonb_build_object(''key'',''discount'',''label'',''Discounts given'',''type'',''money''),\n'
    || E'        jsonb_build_object(''key'',''markup_pct'',''label'',''Markup on cost %'',''type'',''pct''), jsonb_build_object(''key'',''below_cost'',''label'',''Lines below cost'',''type'',''int''));\n'
    || E'    end if;\n'
    || E'    if v_dim = ''document'' then v_href := ''min(href)''; end if;\n  elsif p_report = ''purchases'' then');
end $$;

-- -----------------------------------------------------------------------------
-- 3. Depreciation by itself every month
-- -----------------------------------------------------------------------------
alter table public.company_settings add column if not exists depreciation_auto boolean not null default false;

create or replace function public.set_depreciation_auto(p_company uuid, p_on boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform app.require_permission(p_company, 'finance.write');
  update public.company_settings set depreciation_auto = coalesce(p_on, false) where company_id = p_company;
end $$;
revoke all on function public.set_depreciation_auto(uuid, boolean) from public, anon;
grant execute on function public.set_depreciation_auto(uuid, boolean) to authenticated;

-- on the first days of a month: every planned month up to the end of the previous one
create or replace function app.depreciation_monthly()
returns int language plpgsql security definer set search_path = '' as $$
declare c record; v_through date; r jsonb; n int := 0;
begin
  for c in select s.company_id, coalesce(co.timezone, 'Europe/Tirane') as tz, co.base_currency as cur from public.company_settings s join public.companies co on co.id = s.company_id
            where s.depreciation_auto and co.deleted_at is null and co.is_active loop
    v_through := (date_trunc('month', now() at time zone c.tz) - interval '1 day')::date;
    if not exists (select 1 from public.asset_depreciation_lines dl join public.fixed_assets fa on fa.id = dl.asset_id
                    where dl.company_id = c.company_id and dl.status = 'planned' and dl.period_date <= v_through and fa.status = 'active') then continue; end if;
    begin
      r := public.run_depreciation(c.company_id, v_through, null);
      if coalesce((r ->> 'lines')::int, 0) > 0 then
        perform app.notify_permission(c.company_id, 'finance.write', 'info', 'Depreciation up to ' || to_char(v_through, 'MM/YYYY') || ' is recorded',
          format('Amount: %s', app.money_txt((r ->> 'amount')::numeric, c.cur)), '/finance/assets');
        n := n + 1;
      end if;
    exception when others then
      perform app.notify_permission(c.company_id, 'finance.write', 'warning', 'Depreciation could not be recorded', sqlerrm, '/finance/assets');
    end;
  end loop;
  return n;
end $$;
revoke all on function app.depreciation_monthly() from public;

do $$ begin
  perform app._patch_function('public.automation_tick',
    E'    perform app.memberships_daily();\n',
    E'    perform app.memberships_daily();\n    perform app.depreciation_monthly();\n');
end $$;

drop function app._patch_function(text, text, text);
